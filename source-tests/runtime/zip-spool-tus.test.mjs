import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  MAX_STANDARD_UPLOAD_BYTES,
  TUS_CHUNK_BYTES,
  directTusEndpoint,
  spoolImmutableBuffer,
  spoolDeterministicZip64,
  uploadSpoolWithTus,
} = require("../../runtime/zip-spool.cjs");

const runId = "55555555-5555-4555-8555-555555555555";
const materialHash = "a".repeat(64);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function* slowBytes(values) {
  for (const value of values) {
    await new Promise((resolve) => setImmediate(resolve));
    yield Buffer.from(value);
  }
}

function storageFixture(objects = new Map()) {
  return {
    objects,
    supabase: {
      storage: {
        from(bucket) {
          assert.equal(bucket, "wrap-files");
          return {
            download(path) {
              return {
                asStream: async () => objects.has(path)
                  ? { data: slowBytes([objects.get(path).subarray(0, 2), objects.get(path).subarray(2)]), error: null }
                  : { data: null, error: { status: 404, message: "not found" } },
              };
            },
          };
        },
      },
    },
  };
}

test("persistent spool streams, fsyncs, and reuses one exact material-addressed winner", async () => {
  const root = await mkdtemp(join(tmpdir(), "designpro-spool-test-"));
  try {
    const first = await spoolDeterministicZip64({
      spoolDir: root,
      runId,
      materialHash,
      createStream: () => slowBytes(["deterministic-", "zip64-bytes"]),
    });
    assert.equal(first.contentHash, sha(Buffer.from("deterministic-zip64-bytes")));
    assert.equal(first.byteSize, 25);
    assert.equal(first.idempotent, false);
    const second = await spoolDeterministicZip64({
      spoolDir: root,
      runId,
      materialHash,
      createStream: () => { throw new Error("winner should be reused without rebuilding"); },
    });
    assert.equal(second.filePath, first.filePath);
    assert.equal(second.contentHash, first.contentHash);
    assert.equal(second.idempotent, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a mid-stream builder crash leaves no visible or partial spool winner", async () => {
  const root = await mkdtemp(join(tmpdir(), "designpro-spool-crash-"));
  try {
    await assert.rejects(spoolDeterministicZip64({
      spoolDir: root,
      runId,
      materialHash,
      createStream: () => (async function* crash() { yield Buffer.from("partial"); throw new Error("forced crash"); }()),
    }), (error) => error.code === "zip_spool_write_failed");
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("TUS uses direct Storage, 6MiB chunks, create-only metadata, and verifies bytes after a slow upload", async () => {
  const root = await mkdtemp(join(tmpdir(), "designpro-tus-test-"));
  try {
    const spool = await spoolDeterministicZip64({ spoolDir: root, runId, materialHash, createStream: () => slowBytes(["zip", "-body"]) });
    const target = `designpro/user_11111111-1111-4111-8111-111111111111/${runId}/production-pack.zip`;
    const fixture = storageFixture();
    const uploads = [];
    class FakeUrlStorage { constructor(path) { this.path = path; } }
    class FakeUpload {
      constructor(input, options) { this.input = input; this.options = options; this.url = "https://upload.example/one"; uploads.push(this); }
      async findPreviousUploads() { return [{ uploadUrl: this.url }]; }
      resumeFromPreviousUpload(value) { this.resumed = value; }
      start() {
        void (async () => {
          const chunks = [];
          for await (const chunk of this.input) { await new Promise((resolve) => setImmediate(resolve)); chunks.push(Buffer.from(chunk)); }
          fixture.objects.set(this.options.metadata.objectName, Buffer.concat(chunks));
          this.options.onSuccess();
        })().catch((error) => this.options.onError(error));
      }
      async abort() { this.aborted = true; }
    }
    const result = await uploadSpoolWithTus({
      supabase: fixture.supabase,
      supabaseUrl: "https://wozyamlnygaddievzuwn.supabase.co",
      serviceRoleKey: "s".repeat(40),
      spoolDir: root,
      spool,
      storagePath: target,
      Upload: FakeUpload,
      FileUrlStorage: FakeUrlStorage,
    });
    assert.equal(result.contentHash, spool.contentHash);
    assert.equal(result.byteSize, spool.byteSize);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].options.endpoint, "https://wozyamlnygaddievzuwn.storage.supabase.co/storage/v1/upload/resumable");
    assert.equal(uploads[0].options.chunkSize, TUS_CHUNK_BYTES);
    assert.equal(uploads[0].options.headers["x-upsert"], "false");
    assert.deepEqual(uploads[0].options.metadata, { bucketName: "wrap-files", objectName: target, contentType: "application/zip", cacheControl: "3600" });
    assert.ok(uploads[0].resumed);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an exact pre-existing Storage winner is reused and a collision with changed bytes fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "designpro-tus-collision-"));
  try {
    const spool = await spoolDeterministicZip64({ spoolDir: root, runId, materialHash, createStream: () => slowBytes(["exact-existing"]) });
    const target = `designpro/user_11111111-1111-4111-8111-111111111111/${runId}/production-pack.zip`;
    const exact = storageFixture(new Map([[target, Buffer.from("exact-existing")]]));
    class MustNotUpload { constructor() { throw new Error("exact collision must not re-upload"); } }
    const reused = await uploadSpoolWithTus({ supabase: exact.supabase, supabaseUrl: "https://wozyamlnygaddievzuwn.supabase.co", serviceRoleKey: "s".repeat(40), spoolDir: root, spool, storagePath: target, Upload: MustNotUpload, FileUrlStorage: class {} });
    assert.equal(reused.idempotent, true);

    const drift = storageFixture(new Map([[target, Buffer.from("different")]]));
    await assert.rejects(uploadSpoolWithTus({ supabase: drift.supabase, supabaseUrl: "https://wozyamlnygaddievzuwn.supabase.co", serviceRoleKey: "s".repeat(40), spoolDir: root, spool, storagePath: target, Upload: MustNotUpload, FileUrlStorage: class {} }), (error) => error.code === "artifact_immutable_path_drift");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("configured TUS endpoint cannot leave the direct Supabase Storage origin", () => {
  assert.equal(directTusEndpoint("https://wozyamlnygaddievzuwn.supabase.co"), "https://wozyamlnygaddievzuwn.storage.supabase.co/storage/v1/upload/resumable");
  assert.throws(() => directTusEndpoint("https://wozyamlnygaddievzuwn.supabase.co", "https://example.com/upload"), (error) => error.code === "tus_endpoint_invalid");
});

test("an output larger than the standard-upload threshold is persistently spooled and sent through create-only TUS", async () => {
  const root = await mkdtemp(join(tmpdir(), "designpro-output-tus-"));
  try {
    const body = Buffer.alloc(MAX_STANDARD_UPLOAD_BYTES + 257, 0x5a);
    const spool = await spoolImmutableBuffer({ spoolDir: root, runId, materialHash: "b".repeat(64), bytes: body });
    assert.equal(spool.byteSize, body.length);
    assert.equal(spool.contentHash, sha(body));
    const target = `designpro/user_11111111-1111-4111-8111-111111111111/${runId}/outputs/driver.png`;
    const fixture = storageFixture();
    const uploads = [];
    class FakeUpload {
      constructor(input, options) { this.input = input; this.options = options; uploads.push(this); }
      async findPreviousUploads() { return []; }
      start() {
        void (async () => {
          const chunks = [];
          for await (const chunk of this.input) chunks.push(Buffer.from(chunk));
          fixture.objects.set(this.options.metadata.objectName, Buffer.concat(chunks));
          this.options.onSuccess();
        })().catch((error) => this.options.onError(error));
      }
      async abort() {}
    }
    const stored = await uploadSpoolWithTus({
      supabase: fixture.supabase,
      supabaseUrl: "https://wozyamlnygaddievzuwn.supabase.co",
      serviceRoleKey: "s".repeat(40), spoolDir: root, spool, storagePath: target,
      contentType: "image/png", Upload: FakeUpload, FileUrlStorage: class {},
    });
    assert.equal(stored.contentHash, sha(body));
    assert.equal(stored.byteSize, body.length);
    assert.equal(uploads[0].options.chunkSize, 6 * 1024 * 1024);
    assert.equal(uploads[0].options.headers["x-upsert"], "false");
    assert.deepEqual(uploads[0].options.metadata, { bucketName: "wrap-files", objectName: target, contentType: "image/png", cacheControl: "3600" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
