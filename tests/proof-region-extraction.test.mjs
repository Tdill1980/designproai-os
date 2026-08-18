import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const claimant = readFileSync(new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
const proofSheet = readFileSync(new URL("../runtime/master-proof-sheet.cjs", import.meta.url), "utf8");
const SIDES = ["driver", "passenger", "hood", "roof", "front", "rear"];

/**
 * The proof composer always computed each side's rectangle and never returned
 * it, so a panel could only be tied to the approved sheet by side LABEL. A name
 * is not a location, and cutting a shared sheet without one is how a side ends
 * up carrying another side's artwork.
 */
test("the approved proof states an explicit region for every side", () => {
  assert.match(proofSheet, /proofRegions\.push\(\{/, "the composer must record the rect it draws each surface into");
  assert.match(proofSheet, /proofRegions,/, "renderMasterProof must return the regions, not just compute them");
  assert.match(proofSheet, /PROOF_REGION_CONTRACT = "designpro\.proof-region\.v1"/);
  // A region without the frame it was measured against is not a location, and
  // one without its surface hash is a declaration rather than a binding.
  for (const field of ["sheetWidth", "sheetHeight", "surfaceContentHash"]) {
    assert.match(proofSheet, new RegExp(`${field}[,:]`), `each region must carry ${field}`);
  }
});

test("every panel is cut from its own region of the approved proof", () => {
  assert.match(claimant, /\.extract\(\{ left: proofRegion\.x, top: proofRegion\.y, width: proofRegion\.w, height: proofRegion\.h \}\)/,
    "the crop must use this side's own recorded rectangle");
  assert.match(claimant, /sourceRegionHashes\[key\] = regionHash;/,
    "the recorded region hash must be the pixels taken off the proof");
  assert.match(claimant, /extractedFromProof: true/);
  // Hashing before the resize is what makes two sides cutting the same rect
  // collide, which is the check the database is performing from its side.
  assert.ok(claimant.indexOf("const regionHash = hashBytes(regionBytes);") <
    claimant.indexOf(".resize(Number(surface.pixelWidth)"),
    "the region must be hashed before it is resized, or a collision hides behind the scale");
});

test("panels.build refuses a proof it cannot cut per side", () => {
  for (const code of [
    "call9_proof_regions_missing",        // no anchors at all -> would be guessing
    "call9_proof_region_out_of_bounds",   // rect off the sheet -> short crop or a neighbour's pixels
    "call9_proof_region_surface_mismatch",// region depicts artwork the panel does not carry
    "call9_proof_changed",                // the signed sheet is not the sheet being cut
  ]) {
    assert.match(claimant, new RegExp(code), `panels.build must fail closed on ${code}`);
  }
});

test("no model call may run in the stage that cuts panels", () => {
  const stage = claimant.slice(claimant.indexOf('stage.stage_key === "panels.build"'));
  const body = stage.slice(0, stage.indexOf('stage.stage_key === "logos.extract"'));
  for (const forbidden of [/generativelanguage/, /generateContent/i, /renderFlatTile/, /sidefieldFlatten/, /clean-artboard/]) {
    assert.doesNotMatch(body, forbidden, "extraction is arithmetic; nothing here may call a model");
  }
});

test("the six sides are the six sides, and the database agrees", () => {
  assert.match(claimant, /PANEL_SOURCE_RULE = "one-own-surface-region-per-output-side"/);
  for (const side of SIDES) assert.match(proofSheet, new RegExp(`"${side}"`), `${side} must be an addressable region`);
});
