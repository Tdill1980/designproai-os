"use strict";

/**
 * Historical loader plus release-owned A.T.L.A.S. teaching assets.
 *
 * The Houdini pair remains available for forensic compatibility but stays
 * dormant. Production Call 1 uses the separately named Flamingo cohesion pair,
 * selected by the owner after canary 51ea0e06 proved that prose plus an
 * anonymous mask could still yield a montage of vehicle anatomy. Its flat half
 * was repaired into six solid rectangles before it became a teaching asset.
 *
 * Security boundary:
 * - each release-owned pair is immutable and hash-pinned;
 * - the active view is readable by `service_role` only;
 * - every object must live below the server-owned system prefix;
 * - guide, manifest and master bytes are verified against the immutable row;
 * - an optional database example exposes only its neutral before/guide bytes;
 * - the active cohesion pair is relationship-only: it teaches installed proof
 *   versus flat artwork, never its artwork, palette, wording or brand;
 * - database metadata, prompts and storage URLs never enter the model request.
 *
 * The revision schema records at most one database example identity, and Gemini
 * inline requests have a hard byte budget, so more than one enabled database
 * row is a configuration error rather than an invitation to pick one
 * nondeterministically.
 */

const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { BUCKET } = require("./generation-store.cjs");

const ACTIVE_EXAMPLES_VIEW = "designpro_active_flat_atlas_examples";
const EXAMPLE_PURPOSE = "topology-only";
const DESIGNPANEL_ARTBOARD_EXAMPLE_BUCKET = "wrap-files flat panel";
const DESIGNPANEL_ARTBOARD_EXAMPLE_MAX_BYTES = 8 * 1024 * 1024;
const SYSTEM_PREFIX = "designpro/system/flat-first/examples/";
const BUNDLED_PAIR = Object.freeze({
  exampleKey: "houdini-flat-to-finished",
  version: 1,
  flattenedTopView: Object.freeze({
    path: join(__dirname, "atlas-examples", "houdini-flattened-top-view.jpg"),
    contentHash: "aa5d811b529d5b5b26696cc92414799446d0db5aee948e86ee852a5faebe7b1c",
    contentType: "image/jpeg",
  }),
  finished3dProof: Object.freeze({
    path: join(__dirname, "atlas-examples", "houdini-finished-3d-proof.jpg"),
    contentHash: "2ea78a755f62c0158e4142f928bef61274c6d69bc7a8863c6bec5435ba4e2a85",
    contentType: "image/jpeg",
  }),
});
const COHESION_PAIR = Object.freeze({
  contract: "designpro.atlas-design-teaching-pair.v1",
  purpose: "flat-to-installed-relationship-only",
  exampleKey: "flamingo-solid-rectangles-to-installed",
  version: 1,
  historicalVehicle: "2022 Ford F-250 Crew Cab",
  historicalGenerationId: "5b2eb96c-77b5-4705-8cad-fef00af677fe",
  historicalRevisionId: "b1941528-e375-4d93-bef7-2fd48213370a",
  historicalCanonicalMasterHash: "f9015398d87eca57d16b121ba83d5dcf7843d8086b2f0a697ffc4cc6271921bb",
  historicalDriverProofHash: "c7fbd5b6fda9674ce1944256c63b4f2c1fc580b190513ec09885cf0ba3afbfc7",
  outputRule: "six-solid-full-bleed-print-art-rectangles",
  flattenedTopView: Object.freeze({
    path: join(__dirname, "atlas-examples", "flamingo-rectangular-atlas.jpg"),
    contentHash: "20085eb547251d46c8113014108b088e35a4d41e2ce77b9a152b2786e79c37fa",
    contentType: "image/jpeg",
  }),
  finished3dProof: Object.freeze({
    path: join(__dirname, "atlas-examples", "flamingo-installed-driver-proof.jpg"),
    contentHash: "4449c3274f7d5cd9c383c49a81b0407f99ae0251b8052cad1ee3927c41ac1fdc",
    contentType: "image/jpeg",
  }),
});
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

function readBundledPairAsset(identity, label) {
  let bytes;
  try {
    bytes = readFileSync(identity.path);
  } catch (cause) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_bundled_example_missing",
      `${label} is missing from the exact server release: ${cause.message}`,
    );
  }
  if (!bytes.length || sha256(bytes) !== identity.contentHash) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_bundled_example_hash_mismatch",
      `${label} does not match its release-pinned SHA-256 identity`,
    );
  }
  return Object.freeze({
    bytes,
    contentHash: identity.contentHash,
    byteSize: bytes.length,
    contentType: identity.contentType,
  });
}

function loadBundledFlatToFinishedExample() {
  const flattenedTopView = readBundledPairAsset(
    BUNDLED_PAIR.flattenedTopView,
    "Bundled A.T.L.A.S. flattened top-view example",
  );
  const finished3dProof = readBundledPairAsset(
    BUNDLED_PAIR.finished3dProof,
    "Bundled A.T.L.A.S. finished 3D proof example",
  );
  return Object.freeze({
    kind: "paired-flat-to-finished",
    purpose: EXAMPLE_PURPOSE,
    identity: Object.freeze({
      exampleId: null,
      exampleKey: BUNDLED_PAIR.exampleKey,
      version: BUNDLED_PAIR.version,
      source: "exact-server-release",
      flattenedTopViewContentHash: flattenedTopView.contentHash,
      finished3dProofContentHash: finished3dProof.contentHash,
    }),
    flattenedTopView,
    finished3dProof,
  });
}

function loadBundledAtlasCohesionExample() {
  const flattenedTopView = readBundledPairAsset(
    COHESION_PAIR.flattenedTopView,
    "Release-pinned Flamingo rectangular A.T.L.A.S. example",
  );
  const finished3dProof = readBundledPairAsset(
    COHESION_PAIR.finished3dProof,
    "Release-pinned Flamingo installed Driver proof",
  );
  return Object.freeze({
    kind: "atlas-cohesion-flat-installed-pair",
    purpose: COHESION_PAIR.purpose,
    identity: Object.freeze({
      contract: COHESION_PAIR.contract,
      purpose: COHESION_PAIR.purpose,
      exampleId: null,
      exampleKey: COHESION_PAIR.exampleKey,
      version: COHESION_PAIR.version,
      source: "exact-server-release",
      historicalGenerationId: COHESION_PAIR.historicalGenerationId,
      historicalRevisionId: COHESION_PAIR.historicalRevisionId,
      historicalVehicle: COHESION_PAIR.historicalVehicle,
      historicalCanonicalMasterHash: COHESION_PAIR.historicalCanonicalMasterHash,
      historicalDriverProofHash: COHESION_PAIR.historicalDriverProofHash,
      historicalProofLineageFields: "legacy-null; owner-approved matching generation export",
      outputRule: COHESION_PAIR.outputRule,
      flattenedTopViewContentHash: flattenedTopView.contentHash,
      flattenedTopViewByteSize: flattenedTopView.byteSize,
      flattenedTopViewContentType: flattenedTopView.contentType,
      flattenedTopViewDimensions: "1254x1254",
      finished3dProofContentHash: finished3dProof.contentHash,
      finished3dProofByteSize: finished3dProof.byteSize,
      finished3dProofContentType: finished3dProof.contentType,
      finished3dProofDimensions: "1254x700",
    }),
    flattenedTopView,
    finished3dProof,
  });
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
  if (rows.length > 1) {
    throw new FlatAtlasTopologyExampleError(
      "flat_atlas_topology_example_ambiguous",
      "Enable exactly one server-owned A.T.L.A.S. topology example at a time",
    );
  }

  const examples = [loadBundledFlatToFinishedExample()];
  if (!rows.length) return examples;

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

  examples.push(Object.freeze({
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
  }));
  return examples;
}

/**
 * Server-native port of `_shared/artboard-template-os.ts#loadArtboardExamples`.
 *
 * Deliberately preserves the existing DesignPanel behavior: list ten objects
 * at the bucket root, take at most the first two supported images, skip an
 * object over 8 MiB, and treat storage/configuration failure as non-fatal. The
 * only A.T.L.A.S. adaptation is semantic: its deterministic guide remains the
 * sole topology authority, while these exact existing examples set the proven
 * DesignPanel artboard production-quality floor.
 */
async function loadDesignPanelArtboardExamples(supabase, max = 2) {
  const out = [];
  try {
    const storage = supabase.storage.from(DESIGNPANEL_ARTBOARD_EXAMPLE_BUCKET);
    const { data: files } = await storage.list("", { limit: 10 });
    const boundedMax = Math.min(10, Math.max(0, Number(max) || 0));
    const images = (files || [])
      .filter((file) => /\.(png|jpe?g|webp)$/i.test(String(file?.name || "")))
      .slice(0, boundedMax);
    for (const file of images) {
      const { data: blob } = await storage.download(file.name);
      if (!blob) continue;
      const bytes = Buffer.from(await blob.arrayBuffer());
      if (!bytes.length || bytes.length > DESIGNPANEL_ARTBOARD_EXAMPLE_MAX_BYTES) continue;
      const declaredType = String(blob.type || "").toLowerCase();
      const extension = String(file.name).toLowerCase().split(".").pop();
      const fallbackType = extension === "jpg" || extension === "jpeg"
        ? "image/jpeg" : extension === "webp" ? "image/webp" : "image/png";
      const contentType = ["image/png", "image/jpeg", "image/webp"].includes(declaredType)
        ? declaredType : fallbackType;
      out.push(Object.freeze({
        kind: "designpanel-artboard-quality",
        purpose: "production-quality-only",
        bytes,
        contentType,
        identity: Object.freeze({
          source: "design-panel-ai-generate-loadArtboardExamples",
          bucket: DESIGNPANEL_ARTBOARD_EXAMPLE_BUCKET,
          objectName: String(file.name),
          contentHash: sha256(bytes),
          byteSize: bytes.length,
        }),
      }));
    }
  } catch (_error) {
    // Exact source behavior: examples improve quality but a bucket outage does
    // not silently replace the hash-pinned topology lesson or kill authoring.
  }
  return out;
}

module.exports = {
  ACTIVE_EXAMPLES_VIEW,
  DESIGNPANEL_ARTBOARD_EXAMPLE_BUCKET,
  DESIGNPANEL_ARTBOARD_EXAMPLE_MAX_BYTES,
  EXAMPLE_PURPOSE,
  FlatAtlasTopologyExampleError,
  loadBundledAtlasCohesionExample,
  loadBundledFlatToFinishedExample,
  loadDesignPanelArtboardExamples,
  loadActiveFlatAtlasTopologyExamples,
  _test: {
    BUNDLED_PAIR,
    COHESION_PAIR,
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
