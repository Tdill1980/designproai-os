"use strict";

/**
 * Loads the optional, globally curated A.T.L.A.S. topology example.
 *
 * Security boundary:
 * - the active view is readable by `service_role` only;
 * - every object must live below the server-owned system prefix;
 * - guide, manifest and master bytes are verified against the immutable row;
 * - only the neutral before/guide bytes are exposed as `bytes` to Gemini;
 *   customer-style artwork, database metadata, prompts and storage URLs never
 *   enter the model request.
 *
 * The revision schema records one example identity, and Gemini inline requests
 * have a hard byte budget, so more than one enabled row is a configuration
 * error rather than an invitation to pick one nondeterministically.
 */

const { createHash } = require("node:crypto");
const { BUCKET } = require("./generation-store.cjs");

const ACTIVE_EXAMPLES_VIEW = "designpro_active_flat_atlas_examples";
const EXAMPLE_PURPOSE = "topology-only";
const SYSTEM_PREFIX = "designpro/system/flat-first/examples/";
const HASH_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXAMPLE_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const SELECT_COLUMNS = [
  "id", "example_key", "version", "purpose",
  "guide_storage_path", "guide_content_hash", "guide_byte_size", "guide_content_type",
  "manifest_storage_path", "manifest_content_hash", "manifest_byte_size", "manifest_content_type",
  "master_storage_path", "master_content_hash", "master_byte_size", "master_content_type",
  "manifest",
].join(",");

// Exact keys that would turn a topology allowlist into a creative/style input.
// `styleAuthority: false` in a geometry manifest remains valid; an actual
// `style`, `palette`, `brand`, `prompt` or customer-art field does not.
const STYLE_KEYS = new Set([
  "artwork", "brand", "brief", "business", "color", "colors", "creative",
  "customer", "font", "fonts", "logo", "logos", "palette", "prompt", "style",
  "typography",
]);
const SURFACE_KEYS = new Set(["driver", "passenger", "hood", "roof", "front", "rear"]);

class FlatAtlasTopologyExampleError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = "FlatAtlasTopologyExampleError";
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function positiveInteger(value, maximum, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_identity_invalid",
      `${label} is outside its immutable schema bounds`,
    );
  }
  return parsed;
}

function assertSystemPath(path, hash, extension, label) {
  const value = String(path || "");
  if (!value.startsWith(SYSTEM_PREFIX)
    || value.includes("..")
    || !/^[A-Za-z0-9._/-]+$/.test(value)
    || !value.endsWith(`/${hash}.${extension}`)) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_path_invalid",
      `${label} is not an immutable server-owned A.T.L.A.S. example path`,
    );
  }
  return value;
}

function assertNoStyleFields(value, path = "manifest") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoStyleFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (STYLE_KEYS.has(key.toLowerCase())) {
      throw new FlatAtlasTopologyExampleError(
        "flat_atlas_topology_example_style_leak",
        `${path}.${key} is creative/style data, not topology`,
      );
    }
    assertNoStyleFields(child, `${path}.${key}`);
  }
}

function assertTopologyManifest(manifest) {
  if (!manifest || Array.isArray(manifest) || typeof manifest !== "object") {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_manifest_invalid",
      "The active example manifest must be a topology object",
    );
  }
  assertNoStyleFields(manifest);
  if (!Array.isArray(manifest.zones) || manifest.zones.length !== SURFACE_KEYS.size) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_manifest_invalid",
      "The active example manifest must identify exactly six A.T.L.A.S. zones",
    );
  }
  const seen = new Set();
  for (const zone of manifest.zones) {
    const surfaceKey = String(zone?.surfaceKey || "").trim().toLowerCase();
    const numbers = [zone?.x, zone?.y, zone?.w, zone?.h].map(Number);
    if (!SURFACE_KEYS.has(surfaceKey) || seen.has(surfaceKey)
      || numbers.some((value) => !Number.isFinite(value))
      || numbers[0] < 0 || numbers[1] < 0 || numbers[2] <= 0 || numbers[3] <= 0) {
      throw new FlatAtlasTopologyExampleError(
        "flat_atlas_topology_example_manifest_invalid",
        `The active example contains an invalid ${surfaceKey || "unknown"} topology zone`,
      );
    }
    seen.add(surfaceKey);
  }
}

function validatedRow(row) {
  if (!row || !UUID_RE.test(String(row.id || ""))
    || !EXAMPLE_KEY_RE.test(String(row.example_key || ""))
    || row.purpose !== EXAMPLE_PURPOSE) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_identity_invalid",
      "The active A.T.L.A.S. example identity is invalid or is not topology-only",
    );
  }
  const version = positiveInteger(row.version, 2_147_483_647, "example version");
  const guideHash = String(row.guide_content_hash || "");
  const manifestHash = String(row.manifest_content_hash || "");
  const masterHash = String(row.master_content_hash || "");
  if (![guideHash, manifestHash, masterHash].every((hash) => HASH_RE.test(hash))) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_identity_invalid",
      "The active A.T.L.A.S. example has an invalid SHA-256 identity",
    );
  }
  if (row.guide_content_type !== "image/png"
    || row.manifest_content_type !== "application/json"
    || !["image/png", "image/jpeg", "image/webp"].includes(row.master_content_type)) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_identity_invalid",
      "The active A.T.L.A.S. example has an unapproved content type",
    );
  }
  assertTopologyManifest(row.manifest);
  const masterExtension = row.master_content_type === "image/jpeg"
    ? "jpg" : row.master_content_type.split("/")[1];
  return {
    exampleId: String(row.id),
    exampleKey: String(row.example_key),
    version,
    purpose: EXAMPLE_PURPOSE,
    guide: {
      storagePath: assertSystemPath(row.guide_storage_path, guideHash, "png", "guide path"),
      contentHash: guideHash,
      byteSize: positiveInteger(row.guide_byte_size, 1024 ** 3, "guide byte size"),
      contentType: "image/png",
    },
    manifestAsset: {
      storagePath: assertSystemPath(row.manifest_storage_path, manifestHash, "json", "manifest path"),
      contentHash: manifestHash,
      byteSize: positiveInteger(row.manifest_byte_size, 16 * 1024 ** 2, "manifest byte size"),
      contentType: "application/json",
    },
    master: {
      storagePath: assertSystemPath(row.master_storage_path, masterHash, masterExtension, "master path"),
      contentHash: masterHash,
      byteSize: positiveInteger(row.master_byte_size, 1024 ** 3, "master byte size"),
      contentType: row.master_content_type,
    },
    manifest: row.manifest,
  };
}

async function blobBytes(blob, label) {
  if (!blob || typeof blob.arrayBuffer !== "function") {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_download_failed",
      `${label} returned no downloadable bytes`,
      true,
    );
  }
  return Buffer.from(await blob.arrayBuffer());
}

async function downloadVerified(storage, identity, label) {
  const { data, error } = await storage.download(identity.storagePath);
  if (error || !data) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_download_failed",
      `${label}: ${error?.message || "missing server-owned object"}`,
      true,
    );
  }
  const bytes = await blobBytes(data, label);
  if (bytes.length !== identity.byteSize || sha256(bytes) !== identity.contentHash) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_hash_mismatch",
      `${label} bytes do not match the immutable active-example row`,
    );
  }
  return bytes;
}

async function loadActiveFlatAtlasTopologyExamples(supabase) {
  if (!supabase || typeof supabase.from !== "function" || !supabase.storage?.from) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_runtime_missing",
      "A server Supabase client is required to load A.T.L.A.S. examples",
    );
  }
  const { data, error } = await supabase.from(ACTIVE_EXAMPLES_VIEW)
    .select(SELECT_COLUMNS)
    .order("example_key", { ascending: true })
    .order("version", { ascending: false })
    .limit(2);
  if (error) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_lookup_failed",
      error.message || "The service-only active example view could not be read",
      true,
    );
  }
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) return [];
  if (rows.length > 1) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_ambiguous",
      "Enable exactly one server-owned A.T.L.A.S. topology example at a time",
    );
  }

  const row = validatedRow(rows[0]);
  // The runtime receives a service-role client. Querying the security-invoker
  // view and downloading from the private bucket deliberately preserves its
  // RLS/storage boundary; no signed or public URL fallback exists here.
  const storage = supabase.storage.from(BUCKET);
  const [guideBytes, manifestBytes, masterBytes] = await Promise.all([
    downloadVerified(storage, row.guide, "A.T.L.A.S. example guide"),
    downloadVerified(storage, row.manifestAsset, "A.T.L.A.S. example manifest"),
    downloadVerified(storage, row.master, "A.T.L.A.S. example master"),
  ]);
  let storedManifest;
  try { storedManifest = JSON.parse(manifestBytes.toString("utf8")); }
  catch {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_manifest_invalid",
      "The server-owned A.T.L.A.S. example manifest is not JSON",
    );
  }
  assertTopologyManifest(storedManifest);
  if (!sameJson(storedManifest, row.manifest)) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_manifest_mismatch",
      "The stored A.T.L.A.S. topology manifest differs from its immutable database copy",
    );
  }

  return [Object.freeze({
    // `flat-first-atlas.cjs` consumes only this field when building Gemini
    // parts. It is the verified neutral before/guide, never the example's
    // designed after/master and never an arbitrary URL.
    bytes: guideBytes,
    purpose: EXAMPLE_PURPOSE,
    identity: Object.freeze({
      exampleId: row.exampleId,
      exampleKey: row.exampleKey,
      version: row.version,
      guideContentHash: row.guide.contentHash,
      manifestContentHash: row.manifestAsset.contentHash,
      masterContentHash: row.master.contentHash,
    }),
    // Retained for audit/reconciliation. The current Gemini adapter consumes
    // neither object directly; only `bytes` above enters the request.
    guide: Object.freeze({ ...row.guide, bytes: guideBytes }),
    master: Object.freeze({ ...row.master, bytes: masterBytes }),
  })];
}

module.exports = {
  ACTIVE_EXAMPLES_VIEW,
  EXAMPLE_PURPOSE,
  FlatAtlasTopologyExampleError,
  loadActiveFlatAtlasTopologyExamples,
  _test: {
    SELECT_COLUMNS,
    STYLE_KEYS,
    assertNoStyleFields,
    assertTopologyManifest,
    canonical,
    sameJson,
    sha256,
    validatedRow,
  },
};
