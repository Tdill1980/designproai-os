import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * THE SIBLING CONTRACT AT THE CALL 8 -> CALL 9 SEAM.
 *
 * One approved design origin produces two things: the visible 2D production
 * proof the customer signs, and the six clean per-side branded masters that
 * print. They are siblings, not parent and child. This test locks the three
 * properties that keep them that way:
 *
 *   1. Call 8 records, per side, where that side's master appears on the proof
 *      and the digest of the master those pixels came from.
 *   2. That region is provenance only. Call 9 checks it for BINDING and never
 *      reads it for pixels, so the proof's rules, captions and white ground can
 *      never reach a print file.
 *   3. The display transform preserves the source. A contain-fit leaves empty
 *      space; the predecessor system filled that space by mirroring the artwork
 *      outward, which is a fabricated pixel carrying the master's digest. The
 *      fit is kept, the fill is refused, and it is refused in code rather than
 *      in a comment.
 */
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(workspace, relative), "utf8");

const proofSheet = read("runtime/master-proof-sheet.cjs");
const claimant = read("runtime/designpro-standalone-claimant.cjs");
const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];

// ── 1. The proof records a region per side, from the placement it composited ──
assert.match(proofSheet, /REGION_TRANSFORM_CONTRACT = "designpro\.proof-region-transform\.v1"/,
  "the 2D proof must name its region transform contract");
assert.match(proofSheet, /REGION_TRANSFORM_MODE = "contain-fit-no-fill"/,
  "the region transform must be the contain fit that writes nothing into the gutter");
assert.match(proofSheet, /surfaceRegions\.push\(/,
  "every surface's region must be recorded from the placement that was composited");
assert.match(proofSheet, /surfaceRegions\.push\(Object\.freeze\(\{[\s\S]{0,400}sourceContentHash: surface\.contentHash/,
  "a recorded region must carry the digest of the master it was scaled from");
assert.match(proofSheet, /sourcePreserving: true[\s\S]{0,200}fill: "none"/,
  "the returned transform receipt must declare no fill");

// The fill is refused structurally: the only composite is the resized surface
// itself, and the sheet's own background. Nothing mirrors artwork outward.
for (const banned of ["mirror-fill", "mirrorFill", "contain-mirror-fill"]) {
  assert.ok(!proofSheet.includes(banned),
    `the 2D proof must never fill a region's gutter by mirroring artwork (${banned})`);
}

// ── 2. Call 8 freezes the per-side registry ──────────────────────────────────
assert.match(claimant, /SURFACE_REGISTRAR_CONTRACT = "designpro\.proof-region-surface\.v1"/,
  "Call 8 must name the per-side registrar contract Call 9 accepts");
for (const field of ["brandedMaster", "proofRegion", "transformReceipt"]) {
  assert.ok(claimant.includes(`${field}:`), `Call 8 must freeze ${field} on every surface`);
}
assert.match(claimant, /call8_region_transform_not_source_preserving/,
  "Call 8 must refuse a proof whose region transform writes pixels the master does not carry");
assert.match(claimant, /call8_proof_region_source_drift/,
  "Call 8 must refuse a region scaled from bytes other than the master it stored");
assert.match(claimant, /surfaceMastersHash: surfaceMastersHash\(surfacePanels\)/,
  "Call 8 must record one digest over the whole frozen registry");

// ── 3. Call 9 stays a byte registrar under that contract ─────────────────────
for (const guard of [
  "call9_surface_contract_invalid",
  "call9_region_transform_not_source_preserving",
  "call9_surface_registry_drift",
  "call9_surface_identity_invalid",
  "call9_branded_master_side_mismatch",
  "call9_branded_master_unbound",
  "call9_proof_region_invalid",
  "call9_proof_region_unbound",
  "call9_promotion_altered_bytes",
]) {
  assert.ok(claimant.includes(guard), `Call 9 must fail closed on ${guard}`);
}

// Side identity is structural. Call 9 reads the side's OWN master by path and
// promotes those exact bytes; it never locates, crops, resizes or mirrors.
assert.match(claimant, /const bytes = await storageBytes\(sb, master\.storagePath\);/,
  "Call 9 must read each side's own branded master by its own path");
assert.match(claimant, /promotedWithoutTransform: true, pixelOperations: 0/,
  "Call 9 must declare that it performed no pixel operation");

const call9 = claimant.slice(
  claimant.indexOf('if (stage.stage_key === "panels.build")'),
  claimant.indexOf('if (stage.stage_key === "logos.extract")'),
);
assert.ok(call9.length > 500, "the Call 9 stage body must be locatable");
for (const operation of [".extract(", ".resize(", ".flop(", ".flip(", ".rotate(", ".composite(", "sharp("]) {
  assert.ok(!call9.includes(operation),
    `Call 9 is a byte registrar and must perform no pixel operation (${operation})`);
}
// A locator, a vision pass or a proof crop must never return to this stage.
// Named exactly: "genie-universal-panelizer" is the DIMENSIONS authority Call 9
// legitimately cites, and a substring ban on "panelize" would forbid it.
for (const banned of [
  "panelize-artboard", "panelizeArtboard", "proofTileBoxes", "tileCrop",
  "locateSide", "detectSide", "generateImage", "generateSpecification", "sourceProofBytes",
]) {
  assert.ok(!call9.includes(banned),
    `Call 9 must not reintroduce localisation or generation (${banned})`);
}

// ── The six canonical identities, named the same way on both sides ───────────
for (const surface of SURFACES) {
  assert.ok(proofSheet.includes(`"${surface}"`), `the 2D proof must order ${surface}`);
}
assert.match(claimant, /call8_proof_regions_incomplete/,
  "Call 8 must refuse a proof that did not record a region for all six surfaces");

console.log("proof-region registrar contract passed: six sibling regions, source-preserving transform, Call 9 promotes bytes only");
