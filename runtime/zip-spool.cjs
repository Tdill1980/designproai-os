"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { createReadStream, createWriteStream } = require("node:fs");
const { link, lstat, open, readdir, unlink } = require("node:fs/promises");
const { isAbsolute, join, resolve } = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const tus = require("tus-js-client");

const BUCKET = "wrap-files";
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
const MAX_STANDARD_UPLOAD_BYTES = 6 * 1024 * 1024;
const MAX_PACK_BYTES = 50 * 1024 * 1024 * 1024;
const HASH_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class ZipSpoolError extends Error {
  constructor(code, message, retryable = true) {
    super(message);
    this.name = "ZipSpoolError";
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code, message, retryable = true) {
  throw new ZipSpoolError(code, message, retryable);
}

function assertIdentity(runId, materialHash) {
  const run = String(runId || "").toLowerCase();
  const material = String(materialHash || "").toLowerCase();
  if (!UUID_RE.test(run) || !HASH_RE.test(material)) fail("zip_spool_identity_invalid", "ZIP spool requires a canonical run UUID and material hash", false);
  return { run, material };
}

async function validatedSpoolRoot(value) {
  const raw = String(value || "").trim();
  if (!raw || !isAbsolute(raw) || resolve(raw) !== raw || raw === "/") {
    fail("zip_spool_root_invalid", "DESIGNPRO_SPOOL_DIR must be a specific absolute persistent directory", false);
  }
  let info;
  try { info = await lstat(raw); }
  catch (error) { fail("zip_spool_root_missing", `${raw}: ${error.message}`, false); }
  if (!info.isDirectory() || info.isSymbolicLink()) fail("zip_spool_root_invalid", "ZIP spool root must be a real directory, not a symlink", false);
  return raw;
}

function asReadable(value) {
  if (value && typeof value.pipe === "function") return value;
  if (value && (typeof value[Symbol.asyncIterator] === "function" || typeof value[Symbol.iterator] === "function")) return Readable.from(value);
  fail("zip_stream_invalid", "Deterministic ZIP source is not a byte stream", false);
}

async function digestIterable(source, { maximumBytes = MAX_PACK_BYTES, signal } = {}) {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const value of source) {
    if (signal?.aborted) fail("stage_lease_lost", "Stage lease was lost during ZIP streaming");
    if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) fail("zip_stream_chunk_invalid", "ZIP stream yielded a non-byte chunk", false);
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    byteSize += chunk.length;
    if (!Number.isSafeInteger(byteSize) || byteSize > maximumBytes) fail("zip_pack_size_limit", `Production ZIP exceeds ${maximumBytes} bytes`, false);
    hash.update(chunk);
  }
  return Object.freeze({ contentHash: hash.digest("hex"), byteSize });
}

async function digestFile(filePath, options) {
  return digestIterable(createReadStream(filePath), options);
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, "r");
  try { await handle.sync(); }
  finally { await handle.close(); }
}

async function existingSpool(root, run, material, signal) {
  const prefix = `${run}-${material}-`;
  const candidates = (await readdir(root)).filter((name) => name.startsWith(prefix) && name.endsWith(".zip"));
  if (candidates.length > 1) fail("zip_spool_identity_collision", `Multiple spool winners exist for ${run}/${material}`, false);
  if (!candidates.length) return null;
  const match = candidates[0].match(new RegExp(`^${run}-${material}-([0-9a-f]{64})\\.zip$`));
  if (!match) fail("zip_spool_filename_invalid", `Invalid spool winner ${candidates[0]}`, false);
  const filePath = join(root, candidates[0]);
  const digest = await digestFile(filePath, { signal });
  if (digest.contentHash !== match[1]) fail("zip_spool_content_drift", "Persistent ZIP spool bytes do not match their filename identity", false);
  return Object.freeze({ ...digest, filePath, materialHash: material, idempotent: true });
}

async function spoolDeterministicZip64({ spoolDir, runId, materialHash, createStream, signal } = {}) {
  const root = await validatedSpoolRoot(spoolDir);
  const { run, material } = assertIdentity(runId, materialHash);
  if (typeof createStream !== "function") fail("zip_stream_factory_missing", "ZIP spool requires a repeatable deterministic stream factory", false);
  const winner = await existingSpool(root, run, material, signal);
  if (winner) return winner;

  const partial = join(root, `.${run}-${material}.${process.pid}.${randomUUID()}.partial`);
  const hash = createHash("sha256");
  let byteSize = 0;
  const monitor = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        if (signal?.aborted) fail("stage_lease_lost", "Stage lease was lost during ZIP construction");
        byteSize += chunk.length;
        if (!Number.isSafeInteger(byteSize) || byteSize > MAX_PACK_BYTES) fail("zip_pack_size_limit", `Production ZIP exceeds ${MAX_PACK_BYTES} bytes`, false);
        hash.update(chunk);
        callback(null, chunk);
      } catch (error) { callback(error); }
    },
  });
  try {
    await pipeline(asReadable(createStream()), monitor, createWriteStream(partial, { flags: "wx", mode: 0o600 }));
    if (byteSize < 1) fail("zip_spool_empty", "Deterministic ZIP stream is empty", false);
    const contentHash = hash.digest("hex");
    const handle = await open(partial, "r");
    try { await handle.sync(); }
    finally { await handle.close(); }
    const filePath = join(root, `${run}-${material}-${contentHash}.zip`);
    try { await link(partial, filePath); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const observed = await digestFile(filePath, { signal });
      if (observed.contentHash !== contentHash || observed.byteSize !== byteSize) fail("zip_spool_content_drift", "Concurrent ZIP spool winner has different bytes", false);
    }
    await fsyncDirectory(root);
    return Object.freeze({ filePath, materialHash: material, contentHash, byteSize, idempotent: false });
  } catch (error) {
    if (error instanceof ZipSpoolError) throw error;
    throw new ZipSpoolError("zip_spool_write_failed", error.message, true);
  } finally {
    await unlink(partial).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function spoolImmutableBuffer({ spoolDir, runId, materialHash, bytes, signal } = {}) {
  const root = await validatedSpoolRoot(spoolDir);
  const { run, material } = assertIdentity(runId, materialHash);
  const body = Buffer.isBuffer(bytes) ? bytes : bytes instanceof Uint8Array
    ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
  if (!body || body.length < 1 || body.length > MAX_PACK_BYTES) fail("artifact_spool_identity_invalid", "Artifact spool requires exact bounded bytes", false);
  if (signal?.aborted) fail("stage_lease_lost", "Stage lease was lost before artifact spooling");
  const contentHash = createHash("sha256").update(body).digest("hex");
  const filePath = join(root, `${run}-${material}-${contentHash}.artifact`);
  try {
    const observed = await digestFile(filePath, { signal });
    if (observed.contentHash !== contentHash || observed.byteSize !== body.length) fail("artifact_spool_content_drift", "Persistent artifact spool bytes changed", false);
    return Object.freeze({ filePath, materialHash: material, contentHash, byteSize: body.length, idempotent: true });
  } catch (error) {
    if (error instanceof ZipSpoolError) throw error;
    if (error.code !== "ENOENT") throw new ZipSpoolError("artifact_spool_read_failed", error.message, true);
  }
  const partial = join(root, `.${run}-${material}.${process.pid}.${randomUUID()}.artifact.partial`);
  try {
    await pipeline(Readable.from([body]), createWriteStream(partial, { flags: "wx", mode: 0o600 }));
    const handle = await open(partial, "r");
    try { await handle.sync(); }
    finally { await handle.close(); }
    try { await link(partial, filePath); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const observed = await digestFile(filePath, { signal });
      if (observed.contentHash !== contentHash || observed.byteSize !== body.length) fail("artifact_spool_content_drift", "Concurrent artifact spool winner has different bytes", false);
    }
    await fsyncDirectory(root);
    return Object.freeze({ filePath, materialHash: material, contentHash, byteSize: body.length, idempotent: false });
  } finally {
    await unlink(partial).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

function directTusEndpoint(supabaseUrl, configuredEndpoint) {
  const source = String(configuredEndpoint || "").trim();
  let endpoint;
  if (source) endpoint = new URL(source);
  else {
    const project = new URL(String(supabaseUrl || ""));
    const match = project.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/);
    if (project.protocol !== "https:" || !match) fail("tus_endpoint_invalid", "SUPABASE_URL cannot be converted to a direct Storage TUS endpoint", false);
    endpoint = new URL(`https://${match[1]}.storage.supabase.co/storage/v1/upload/resumable`);
  }
  if (endpoint.protocol !== "https:" || !/^[a-z0-9-]+\.storage\.supabase\.co$/.test(endpoint.hostname)
    || endpoint.pathname !== "/storage/v1/upload/resumable" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    fail("tus_endpoint_invalid", "TUS endpoint must be the direct HTTPS Supabase Storage resumable endpoint", false);
  }
  return endpoint.toString();
}

function streamDownload(client, storagePath) {
  const builder = client.download(storagePath);
  return typeof builder?.asStream === "function" ? builder.asStream() : builder;
}

function iterableStorageBody(data) {
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) return [data];
  if (data && typeof data[Symbol.asyncIterator] === "function") return data;
  if (data && typeof data.stream === "function") return data.stream();
  fail("zip_storage_stream_invalid", "Storage download did not return a readable byte stream");
}

function isNotFound(error) {
  return String(error?.statusCode || error?.status || "") === "404" || /not found|does not exist|no such/i.test(String(error?.message || ""));
}

async function verifyStoredArtifact({ supabase, storagePath, contentHash, byteSize, signal } = {}) {
  const client = supabase.storage.from(BUCKET);
  const { data, error } = await streamDownload(client, storagePath);
  if (error) {
    if (isNotFound(error)) return null;
    fail("zip_storage_read_failed", `${storagePath}: ${error.message}`);
  }
  if (!data) return null;
  const digest = await digestIterable(iterableStorageBody(data), { signal });
  if (digest.contentHash !== contentHash || digest.byteSize !== byteSize) fail("artifact_immutable_path_drift", `${storagePath} exists with different ZIP bytes`, false);
  return Object.freeze({ storagePath, contentHash, byteSize, idempotent: true });
}

const verifyStoredZip = verifyStoredArtifact;

function uploadPromise(upload, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => {
      Promise.resolve(upload.abort(false)).finally(() => finish(reject, new ZipSpoolError("stage_lease_lost", "Stage lease was lost during resumable ZIP upload", true)));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    upload.options.onError = (error) => finish(reject, error);
    upload.options.onSuccess = () => finish(resolve, upload.url);
    Promise.resolve(upload.findPreviousUploads())
      .then((previous) => {
        if (Array.isArray(previous) && previous.length) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch((error) => finish(reject, error));
  });
}

async function uploadSpoolWithTus({
  supabase,
  supabaseUrl,
  serviceRoleKey,
  endpoint,
  spoolDir,
  spool,
  storagePath,
  contentType = "application/zip",
  signal,
  Upload = tus.Upload,
  FileUrlStorage = tus.FileUrlStorage,
} = {}) {
  if (!supabase?.storage || !spool || !HASH_RE.test(String(spool.contentHash || ""))
    || !Number.isSafeInteger(Number(spool.byteSize)) || Number(spool.byteSize) < 1
    || Number(spool.byteSize) > MAX_PACK_BYTES) fail("tus_upload_identity_invalid", "TUS upload requires an exact bounded spool identity", false);
  const token = String(serviceRoleKey || "").trim();
  if (!token || token.length < 32 || /\s/.test(token)) fail("tus_service_token_invalid", "Supabase service bearer is missing or invalid", false);
  const target = String(storagePath || "");
  const targetMatch = target.match(/^designpro\/user_[0-9a-f-]{36}\/[0-9a-f-]{36}\/(production-pack\.zip|stamped-call8-proof\.png|outputs\/[a-z0-9-]+\.(?:png|tiff|eps)|proof-masters\/(?:raw\/)?[a-z0-9-]+-[0-9a-f]{24}\.png|proof\/(?:flat-wrap-layout|call8-2d-production-proof)-[0-9a-f]{24}\.png)$/);
  if (!targetMatch) fail("tus_storage_path_invalid", "Resumable artifact path is outside the exact DesignPro run allowlist", false);
  const extension = target.split(".").pop().toLowerCase();
  const expectedType = ({ zip: "application/zip", png: "image/png", tiff: "image/tiff", eps: "application/postscript" })[extension];
  if (!expectedType || String(contentType || "").toLowerCase() !== expectedType) fail("tus_content_type_invalid", "Resumable artifact content type does not match its exact extension", false);
  const existing = await verifyStoredArtifact({ supabase, storagePath: target, contentHash: spool.contentHash, byteSize: spool.byteSize, signal });
  if (existing) return existing;

  const tusEndpoint = directTusEndpoint(supabaseUrl, endpoint);
  const root = await validatedSpoolRoot(spoolDir);
  const input = createReadStream(spool.filePath);
  const urlStorage = new FileUrlStorage(join(root, ".tus-upload-urls.json"));
  const upload = new Upload(input, {
    endpoint: tusEndpoint,
    uploadSize: spool.byteSize,
    chunkSize: TUS_CHUNK_BYTES,
    retryDelays: [0, 1_000, 3_000, 5_000, 10_000, 20_000],
    headers: { Authorization: `Bearer ${token}`, "x-upsert": "false" },
    metadata: { bucketName: BUCKET, objectName: target, contentType: expectedType, cacheControl: "3600" },
    fingerprint: async () => `designpro-artifact:${target}:${spool.contentHash}:${spool.byteSize}`,
    urlStorage,
    removeFingerprintOnSuccess: true,
    onError() {},
    onSuccess() {},
  });
  try { await uploadPromise(upload, signal); }
  catch (error) {
    const collision = Number(error?.originalResponse?.getStatus?.()) === 409 || /already exists|duplicate|conflict/i.test(String(error?.message || ""));
    if (!collision) throw new ZipSpoolError(error.code || "tus_upload_failed", String(error.message || error), error.retryable !== false);
  }
  const verified = await verifyStoredArtifact({ supabase, storagePath: target, contentHash: spool.contentHash, byteSize: spool.byteSize, signal });
  if (!verified) fail("tus_upload_visibility_missing", "TUS upload completed without an exact readable Storage object");
  return Object.freeze({ ...verified, idempotent: false });
}

async function removeCommittedSpool(spool) {
  if (!spool?.filePath) return;
  await unlink(spool.filePath).catch((error) => { if (error.code !== "ENOENT") throw error; });
}

module.exports = Object.freeze({
  BUCKET,
  MAX_PACK_BYTES,
  MAX_STANDARD_UPLOAD_BYTES,
  TUS_CHUNK_BYTES,
  ZipSpoolError,
  digestIterable,
  directTusEndpoint,
  removeCommittedSpool,
  spoolImmutableBuffer,
  spoolDeterministicZip64,
  uploadSpoolWithTus,
  verifyStoredArtifact,
  verifyStoredZip,
});
