"use strict";

/**
 * ⛔ NO PIXEL ORIGINATING FROM A 3D PROOF MAY EVER BECOME A CALL-8 SURFACE,
 *    PRODUCTION PANEL, PRINT FILE, OR ZIP ASSET. (Trish 2026-08-29.)
 *
 * That sentence is the whole rule, and this file is the only place it is
 * mechanically checked. It exists because the pipeline violated it for eight
 * days without a single check noticing, and every OTHER check passed the whole
 * time: the panels were correctly dimensioned by GENIE, correctly bound to
 * their surface keys, correctly hashed, correctly six and distinct. They were
 * pictures of a truck.
 *
 * WHAT THE ANCESTRY OF A PRODUCTION ARTIFACT MUST BE:
 *
 *   Call-1 flattened A.T.L.A.S. master
 *     -> exact deterministic container crop
 *       -> Call-1 panel                      <- the only production artwork
 *         -> promoted panel / Call-8 tile    <- byte copies of that panel
 *
 * and the 3D proof stack hangs off the END of it:
 *
 *   Call-1 panel -> 3D proof                 <- presentation, terminal
 *
 * Information never flows back up. A production artifact whose metadata names a
 * view, a photographer render, or the deleted Gemini flat-surface pass is
 * refused here rather than printed.
 *
 * TWO KINDS OF EVIDENCE, AND BOTH ARE REQUIRED.
 *
 * POSITIVE: the artifact must say what it IS -- promoted from `atlas-call1`,
 * naming the Call-1 path and hash it copies and the master it was cut from.
 * NEGATIVE: it must carry none of the markers of the inverted chain. Neither
 * alone is enough. The proof-derived panels of 2026-08-21 would have passed a
 * pure negative check, because their metadata described a "surface field"
 * rather than a "view"; they fail the positive one instantly, because there is
 * no `atlas-call1` anywhere in their ancestry.
 */

const HASH_RE = /^[0-9a-f]{64}$/;

class ProvenanceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// The metadata keys and values that only ever appear on an artifact descended
// from a 3D proof or from the deleted Gemini flattener. `ownSourceViewKey` and
// `ownSourceViewSha256` are the exact fields the 2026-08-21 gridslice arm
// stamped, and they are how the Northgate trace joined all six "production
// panels" to `designpro_generation_views` in one query.
const FORBIDDEN_METADATA_KEYS = Object.freeze([
  "ownSourceViewKey",
  "ownSourceViewSha256",
  "sourceFieldPath",
  "sourceFieldHash",
  "sourceViewKey",
  "sourceViewSha256",
  "viewKey",
  "shotKey",
]);

// Substrings that name a producer on the wrong side of the boundary, wherever
// they appear in the artifact's metadata values.
const FORBIDDEN_PRODUCERS = Object.freeze([
  "gemini-flat-surface",
  "persona-photographer",
  "atlas-proof",
  "designpro_generation_views",
  "proof-region",
  "call7-proof-region",
]);

const LEGAL_PANEL_SOURCES = Object.freeze(["atlas-call1-panel"]);
const LEGAL_PANEL_PROMOTIONS = Object.freeze(["atlas-call1"]);

function collectStringValues(value, into = [], depth = 0) {
  if (depth > 6) return into;
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStringValues(item, into, depth + 1);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectStringValues(item, into, depth + 1);
  return into;
}

function assertNoProofAncestry(label, metadata) {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  for (const key of FORBIDDEN_METADATA_KEYS) {
    if (meta[key] !== undefined) {
      throw new ProvenanceError(
        "production_ancestry_contains_3d_proof",
        `${label} carries ${key}: its ancestry runs through a 3D proof, which may never reach production`,
      );
    }
  }
  const haystack = collectStringValues(meta).join("\n").toLowerCase();
  for (const producer of FORBIDDEN_PRODUCERS) {
    if (haystack.includes(producer)) {
      throw new ProvenanceError(
        "production_ancestry_contains_3d_proof",
        `${label} names ${producer}: its ancestry runs through a 3D proof or the deleted flat-surface pass`,
      );
    }
  }
}

/**
 * A production PANEL. Positive evidence plus the negative sweep.
 */
function assertPanelAncestry(panel) {
  const surfaceKey = String(panel?.surfaceKey || panel?.surface_key || "unknown");
  const label = `panel ${surfaceKey}`;
  const meta = panel?.metadata && typeof panel.metadata === "object" ? panel.metadata : {};
  if (!LEGAL_PANEL_SOURCES.includes(String(meta.source || ""))) {
    throw new ProvenanceError(
      "production_ancestry_not_atlas_call1",
      `${label} does not declare source ${LEGAL_PANEL_SOURCES[0]}; the only production artwork is a deterministic crop of the accepted A.T.L.A.S. master`,
    );
  }
  if (!LEGAL_PANEL_PROMOTIONS.includes(String(meta.promotedFrom || ""))) {
    throw new ProvenanceError(
      "production_ancestry_not_atlas_call1",
      `${label} is not promoted from ${LEGAL_PANEL_PROMOTIONS[0]}`,
    );
  }
  if (meta.deterministic !== true) {
    throw new ProvenanceError("production_ancestry_not_deterministic", `${label} does not claim a deterministic lineage`);
  }
  for (const field of ["sourceStoragePath", "sourceContentHash", "sourceMasterHash"]) {
    if (!String(meta[field] || "").trim()) {
      throw new ProvenanceError("production_ancestry_incomplete", `${label} does not record ${field}`);
    }
  }
  if (!HASH_RE.test(String(meta.sourceContentHash).toLowerCase())
    || !HASH_RE.test(String(meta.sourceMasterHash).toLowerCase())) {
    throw new ProvenanceError("production_ancestry_incomplete", `${label} records a malformed source or master hash`);
  }
  assertNoProofAncestry(label, meta);
}

/**
 * The Call-8 2D Production Proof. Its six tiles are the six panels, so its
 * ancestry is theirs.
 */
function assertProofSheetAncestry(proof) {
  const label = "2D production proof";
  const meta = proof?.metadata && typeof proof.metadata === "object" ? proof.metadata : {};
  if (String(meta.assembledFrom || "") !== "atlas-call1-panels") {
    throw new ProvenanceError(
      "production_ancestry_not_atlas_call1",
      `${label} does not declare that it was assembled from the Call-1 panels`,
    );
  }
  if (meta.deterministic !== true) {
    throw new ProvenanceError("production_ancestry_not_deterministic", `${label} does not claim a deterministic assembly`);
  }
  const tiles = meta.sourcePanelHashes && typeof meta.sourcePanelHashes === "object" ? meta.sourcePanelHashes : null;
  if (!tiles) throw new ProvenanceError("production_ancestry_incomplete", `${label} does not name the panel behind each tile`);
  const hashes = Object.values(tiles).map((hash) => String(hash).toLowerCase());
  if (hashes.length !== 6 || hashes.some((hash) => !HASH_RE.test(hash)) || new Set(hashes).size !== 6) {
    throw new ProvenanceError("production_ancestry_incomplete", `${label} must name six distinct panel hashes`);
  }
  // `sourcePanelHashes` is a map of hashes, so the tile map is checked above
  // rather than swept -- but the rest of the metadata still must not name a
  // producer on the wrong side of the boundary.
  const { sourcePanelHashes: _tiles, ...rest } = meta;
  assertNoProofAncestry(label, rest);
}

/**
 * Every production surface of one run, against the panels the customer's own
 * revision snapshot records. This is the check that would have caught the
 * Northgate substitution at the gate instead of in a trace eight days later.
 */
function assertRunProductionAncestry({ panels, proof, acceptedPanels }) {
  const list = Array.isArray(panels) ? panels : [];
  for (const panel of list) assertPanelAncestry(panel);
  if (proof) assertProofSheetAncestry(proof);
  if (Array.isArray(acceptedPanels) && acceptedPanels.length) {
    // Declaring `atlas-call1` is not the same as BEING one of this revision's
    // Call-1 panels. Every production panel's recorded source hash has to be a
    // panel the customer's accepted revision actually holds.
    const accepted = new Set(acceptedPanels
      .map((panel) => String(panel?.contentHash || "").toLowerCase())
      .filter((hash) => HASH_RE.test(hash)));
    for (const panel of list) {
      const source = String(panel?.metadata?.sourceContentHash || "").toLowerCase();
      if (!accepted.has(source)) {
        throw new ProvenanceError(
          "production_ancestry_not_this_revision",
          `panel ${panel?.surfaceKey || panel?.surface_key || "unknown"} names a Call-1 panel this revision never accepted`,
        );
      }
    }
  }
  return {
    contract: "designpro.production-ancestry.v1",
    panelCount: list.length,
    proofVerified: Boolean(proof),
    ancestry: "atlas-call1",
  };
}

module.exports = {
  FORBIDDEN_METADATA_KEYS,
  FORBIDDEN_PRODUCERS,
  ProvenanceError,
  assertNoProofAncestry,
  assertPanelAncestry,
  assertProofSheetAncestry,
  assertRunProductionAncestry,
};
