"use strict";

const { createHash } = require("node:crypto");

const TENANT_KEY_RE = /^user_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/tiff", "image/webp"]);
const ALLOWED_LOGO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml", "application/pdf"]);
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const STORAGE_NAMESPACE_RES = Object.freeze([
  new RegExp(`^users/${UUID_PART}/revisions/${UUID_PART}/inputs/[A-Za-z0-9_-]+/[0-9a-f]{64}\\.[A-Za-z0-9]+$`),
  // Calls 1-7 authored creative assets (creative-authoring.cjs writes
  // users/<owner>/revisions/<revision>/authoring/<assetId>.<ext>). The proof
  // stage's verified loader re-hashes every downloaded byte against the
  // master's pinned contentHash, so recognising the namespace does not trust
  // the path. Missing here was live failure unsafe_storage_path (canary
  // 32072921253).
  new RegExp(`^users/${UUID_PART}/revisions/${UUID_PART}/authoring/[A-Za-z0-9._-]+\\.[A-Za-z0-9]+$`),
  new RegExp(`^designpro/user_${UUID_PART}/${UUID_PART}/[A-Za-z0-9._/-]+$`),
  new RegExp(`^wrapbox/user_${UUID_PART}/${UUID_PART}/${UUID_PART}/[A-Za-z0-9._/-]+$`),
]);

function canonicalTenantKey(value) {
  const key = String(value || "").trim();
  if (!TENANT_KEY_RE.test(key)) {
    throw new Error("tenant_key must be canonical user_<lowercase-uuid>");
  }
  return key;
}

function safeStoragePath(value) {
  const path = String(value || "").trim();
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("//") || !/^[A-Za-z0-9._/-]+$/.test(path)) {
    throw new Error("storagePath is not a safe relative Storage path");
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("storagePath contains an unsafe path segment");
  }
  if (!STORAGE_NAMESPACE_RES.some((pattern) => pattern.test(path))) {
    throw new Error("storagePath is outside DesignPro-owned namespaces");
  }
  return path;
}

function canonicalUuid(value, label) {
  const uuid = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid)) {
    throw new Error(`${label} must be a lowercase UUID`);
  }
  return uuid;
}

function normalizeSourceAsset(value, tenantValue, revisionValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("source asset identity is required");
  }
  if (["url", "signedUrl", "publicUrl", "downloadUrl"].some((key) => value[key] != null)) {
    throw new Error("source asset identity must not contain a public or expiring URL");
  }
  const tenantKey = canonicalTenantKey(tenantValue);
  const ownerId = tenantKey.slice("user_".length);
  const revisionId = canonicalUuid(revisionValue, "revisionId");
  const bucket = String(value.bucket || "wrap-files").trim();
  const storagePath = safeStoragePath(value.storagePath);
  const contentHash = String(value.contentHash || "").trim().toLowerCase();
  const byteSize = Number(value.byteSize);
  const contentType = String(value.contentType || "").trim().toLowerCase();
  if (bucket !== "wrap-files") throw new Error("source asset must be in private wrap-files Storage");
  if (!HASH_RE.test(contentHash)) throw new Error("source asset requires a sha256 contentHash");
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_SOURCE_BYTES) throw new Error("source asset byteSize is invalid");
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) throw new Error("source asset contentType is not allowed");
  const segments = storagePath.split("/");
  const expectedPrefix = `users/${ownerId}/revisions/${revisionId}/inputs/`;
  if (!storagePath.startsWith(expectedPrefix) || segments.length !== 7 || !segments[5]) {
    throw new Error("source asset is outside its immutable owner/revision input namespace");
  }
  const filenameHash = segments[6].split(".")[0]?.toLowerCase();
  if (filenameHash !== contentHash) throw new Error("source asset filename is not content-addressed");
  return Object.freeze({ bucket, storagePath, contentHash, byteSize, contentType });
}

function normalizeLogoAsset(value, tenantValue, revisionValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("logo asset identity is required");
  if (["url", "signedUrl", "publicUrl", "downloadUrl"].some((key) => value[key] != null)) throw new Error("logo asset identity must not contain a public or expiring URL");
  const tenantKey = canonicalTenantKey(tenantValue);
  const ownerId = tenantKey.slice("user_".length);
  const revisionId = canonicalUuid(revisionValue, "revisionId");
  const bucket = String(value.bucket || "wrap-files").trim();
  const storagePath = safeStoragePath(value.storagePath);
  const contentHash = String(value.contentHash || "").trim().toLowerCase();
  const byteSize = Number(value.byteSize);
  const contentType = String(value.contentType || "").trim().toLowerCase();
  if (bucket !== "wrap-files" || !HASH_RE.test(contentHash) || !Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_SOURCE_BYTES || !ALLOWED_LOGO_TYPES.has(contentType)) throw new Error("logo asset evidence is invalid");
  const segments = storagePath.split("/");
  if (!storagePath.startsWith(`users/${ownerId}/revisions/${revisionId}/inputs/logo/`) || segments.length !== 7 || segments[5] !== "logo") throw new Error("logo asset is outside its immutable owner/revision logo namespace");
  if (segments[6].split(".")[0]?.toLowerCase() !== contentHash) throw new Error("logo asset filename is not content-addressed");
  return Object.freeze({ bucket, storagePath, contentHash, byteSize, contentType });
}

function verifySourceBytes(asset, bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (body.length !== asset.byteSize) throw new Error("source asset byteSize changed");
  const observed = createHash("sha256").update(body).digest("hex");
  if (observed !== asset.contentHash) throw new Error("source asset contentHash changed");
  return body;
}

function isDuplicateStorageError(error) {
  return Boolean(error) && (error.error === "Duplicate" || String(error.statusCode || error.status || "") === "409");
}

async function immutableStorageUpload(storage, bucket, storagePath, bytes, contentType) {
  const path = safeStoragePath(storagePath);
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const contentHash = createHash("sha256").update(body).digest("hex");
  const client = storage.from(bucket);
  const { error } = await client.upload(path, body, { contentType, upsert: false });
  if (error && !isDuplicateStorageError(error)) throw new Error(`Storage create failed: ${error.message}`);
  if (error) {
    const { data, error: downloadError } = await client.download(path);
    if (downloadError || !data) throw new Error(`Storage idempotency read failed: ${downloadError?.message || "empty object"}`);
    const existing = Buffer.from(await data.arrayBuffer());
    if (existing.length !== body.length || createHash("sha256").update(existing).digest("hex") !== contentHash) {
      throw new Error("immutable Storage path already exists with different bytes");
    }
  }
  return Object.freeze({ storagePath: path, byteSize: body.length, contentHash, idempotent: Boolean(error) });
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_LOGO_TYPES,
  HASH_RE,
  MAX_SOURCE_BYTES,
  STORAGE_NAMESPACE_RES,
  TENANT_KEY_RE,
  canonicalUuid,
  canonicalTenantKey,
  immutableStorageUpload,
  isDuplicateStorageError,
  normalizeLogoAsset,
  normalizeSourceAsset,
  safeStoragePath,
  verifySourceBytes,
};
