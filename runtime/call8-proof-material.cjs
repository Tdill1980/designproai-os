"use strict";

/**
 * The Call 8 material identity — the deterministic one.
 *
 * WHAT THIS REPLACES, AND WHY IT IS A DIFFERENT KIND OF THING.
 *
 * Call 8 used to hash `{ the seven 3D proofs, the six surfaces, the revision,
 * the text lock, THE IMAGE MODEL }` and hand that to a Gemini pass which
 * FLATTENED each of the seven photographs into a "surface field", then
 * gridsliced those fields into panels. The model was in the hash because the
 * output depended on it. That whole shape is gone: the six surface inputs are
 * now the six deterministic Call-1 panels, and nothing between them and the
 * sheet is generative.
 *
 * So there is no model in this hash, and there cannot be — a model id in a
 * deterministic identity is a standing invitation to put a model back behind
 * it. Same six panels, same six GENIE surfaces, same revision, same text lock,
 * same sheet, byte for byte, on any worker, forever.
 *
 * Owner, 2026-08-29: "No pixel originating from a 3D proof may ever become a
 * Call-8 surface, production panel, print file, or ZIP asset."
 */

const { createHash } = require("node:crypto");
const { canonicalTenantKey, safeStoragePath } = require("./runtime-contract.cjs");
const { normalizeTextLock, SURFACE_KEYS } = require("./gemini-flat-surface.cjs");

const CALL8_PROOF_CONTRACT = "designpro.call8-panel-proof.v1";
const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_PANEL_BYTES = 512 * 1024 * 1024;
const PANEL_CONTENT_TYPES = new Set(["image/png"]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((accumulator, key) => {
      if (value[key] !== undefined) accumulator[key] = canonical(value[key]);
      return accumulator;
    }, {});
  }
  return value;
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * A Call-1 panel, as an identity Call 8 may read.
 *
 * The fence is CONTENT ADDRESSING, not a namespace guess. Call 1 writes each
 * panel to `designpro/<tenantKey>/<generationId>/flat-first/v1/revisions/<n>/
 * panels/<sha256>.png`, so the filename IS the hash — a path that does not name
 * its own bytes is not a Call-1 panel, whatever else it may be. That is a
 * stronger check than a prefix match, and it is what stops a run-scoped
 * `panels/driver.png` (or, more to the point, anything at all under the run's
 * `proof-masters/` prefix, where the deleted Gemini flattener wrote) from being
 * passed off as one.
 */
function normalizeCallOnePanelAsset(value, tenantValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Call 1 panel identity is required");
  }
  if (["url", "signedUrl", "publicUrl", "downloadUrl"].some((key) => value[key] != null)) {
    throw new Error("Call 1 panel identity must not contain a public or expiring URL");
  }
  const tenantKey = canonicalTenantKey(tenantValue);
  const surfaceKey = String(value.surfaceKey || "").trim().toLowerCase();
  const bucket = String(value.bucket || "wrap-files").trim();
  const storagePath = safeStoragePath(value.storagePath);
  const contentHash = String(value.contentHash || "").trim().toLowerCase();
  const byteSize = Number(value.byteSize);
  const contentType = String(value.contentType || "image/png").trim().toLowerCase();
  if (!SURFACE_KEYS.includes(surfaceKey)) throw new Error(`Call 1 panel surface ${surfaceKey || "?"} is not canonical`);
  if (bucket !== "wrap-files") throw new Error("Call 1 panel must be in private wrap-files Storage");
  if (!HASH_RE.test(contentHash)) throw new Error("Call 1 panel requires a sha256 contentHash");
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_PANEL_BYTES) throw new Error("Call 1 panel byteSize is invalid");
  if (!PANEL_CONTENT_TYPES.has(contentType)) throw new Error("Call 1 panel must be a PNG");
  if (!storagePath.startsWith(`designpro/${tenantKey}/`)) {
    throw new Error("Call 1 panel is outside its owner namespace");
  }
  const filename = storagePath.split("/").pop() || "";
  if (filename.split(".")[0]?.toLowerCase() !== contentHash) {
    throw new Error("Call 1 panel filename is not content-addressed");
  }
  const trimWidthIn = round2(value.trimWidthIn);
  const trimHeightIn = round2(value.trimHeightIn);
  const printWidthIn = round2(value.printWidthIn);
  const printHeightIn = round2(value.printHeightIn);
  if (!(trimWidthIn > 0 && trimHeightIn > 0 && printWidthIn > 0 && printHeightIn > 0)) {
    throw new Error(`Call 1 panel ${surfaceKey} carries no trim/print geometry`);
  }
  return Object.freeze({
    surfaceKey, bucket, storagePath, contentHash, byteSize, contentType,
    trimWidthIn, trimHeightIn, printWidthIn, printHeightIn,
  });
}

/**
 * Exactly the six canonical surfaces, each a distinct Call-1 panel.
 *
 * Distinctness is asserted on the HASHES, not only on the keys: six entries all
 * naming the driver panel would otherwise satisfy a key check and print the
 * driver's artwork on every side of the vehicle. `source.verify`'s
 * exactly-six-distinct assertion exists for the same reason downstream.
 */
function normalizeCallOnePanelSet(panels, tenantValue) {
  const list = Array.isArray(panels) ? panels : [];
  if (list.length !== SURFACE_KEYS.length) {
    throw new Error(`Call 8 requires exactly ${SURFACE_KEYS.length} Call-1 panels, received ${list.length}`);
  }
  const bySurface = new Map();
  for (const raw of list) {
    const panel = normalizeCallOnePanelAsset(raw, tenantValue);
    if (bySurface.has(panel.surfaceKey)) throw new Error(`Call 1 panel ${panel.surfaceKey} appears twice`);
    bySurface.set(panel.surfaceKey, panel);
  }
  if (SURFACE_KEYS.some((key) => !bySurface.has(key))) {
    throw new Error("Call 1 panel set does not cover the six canonical surfaces");
  }
  const hashes = new Set(SURFACE_KEYS.map((key) => bySurface.get(key).contentHash));
  if (hashes.size !== SURFACE_KEYS.length) {
    throw new Error("Call 1 panels are not six distinct surfaces");
  }
  return SURFACE_KEYS.map((key) => bySurface.get(key));
}

function normalizeProofSurfaces(surfaces) {
  const bySurface = new Map();
  for (const surface of Array.isArray(surfaces) ? surfaces : []) {
    const surfaceKey = String(surface?.surfaceKey || "").trim().toLowerCase();
    const widthInches = round2(surface?.widthInches);
    const heightInches = round2(surface?.heightInches);
    if (!SURFACE_KEYS.includes(surfaceKey) || !(widthInches > 0 && heightInches > 0)) continue;
    bySurface.set(surfaceKey, {
      surfaceKey, widthInches, heightInches,
      surfaceSqFt: round2((widthInches * heightInches) / 144),
    });
  }
  if (SURFACE_KEYS.some((key) => !bySurface.has(key))) {
    throw new Error("Call 8 requires all six GENIE surfaces");
  }
  return SURFACE_KEYS.map((key) => bySurface.get(key));
}

/**
 * The material identity of one Call-8 sheet. Pure, no model, no network.
 */
function call8ProofMaterialHash({ panels, surfaces, revisionId, textLock, tenantKey }) {
  const panelSet = normalizeCallOnePanelSet(panels, tenantKey);
  return hashJson({
    contract: CALL8_PROOF_CONTRACT,
    revisionId: String(revisionId || "").trim().toLowerCase(),
    textLock: normalizeTextLock(textLock),
    panels: panelSet.map((panel) => ({
      surfaceKey: panel.surfaceKey,
      storagePath: panel.storagePath,
      contentHash: panel.contentHash,
      byteSize: panel.byteSize,
      trimWidthIn: panel.trimWidthIn,
      trimHeightIn: panel.trimHeightIn,
      printWidthIn: panel.printWidthIn,
      printHeightIn: panel.printHeightIn,
    })),
    surfaces: normalizeProofSurfaces(surfaces),
  });
}

module.exports = {
  CALL8_PROOF_CONTRACT,
  call8ProofMaterialHash,
  normalizeCallOnePanelAsset,
  normalizeCallOnePanelSet,
  normalizeProofSurfaces,
  _test: { canonical, hashJson, round2 },
};
