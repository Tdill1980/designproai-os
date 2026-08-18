import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const claimant = readFileSync(new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
const proofSheet = readFileSync(new URL("../runtime/master-proof-sheet.cjs", import.meta.url), "utf8");
const SIDES = ["driver", "passenger", "hood", "roof", "front", "rear"];

const panelsBuild = (() => {
  const stage = claimant.slice(claimant.indexOf('stage.stage_key === "panels.build"'));
  return stage.slice(0, stage.indexOf('stage.stage_key === "logos.extract"'));
})();

/**
 * The proof composer always computed each side's rectangle and never returned
 * it, so a panel could only be tied to the approved sheet by side LABEL. A name
 * is not a location, and a panel bound by label alone cannot prove the customer
 * approved the artwork it carries.
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

/**
 * The region is where the customer saw this side. The artwork is the
 * full-resolution surface Call 8 rendered. Cutting the panel back out of the
 * proof raster would manufacture from a masked, downsampled composite -- the
 * vehicle silhouette baked in and the side reduced to its share of one sheet.
 */
test("panels manufacture from the approved surface, never from the proof raster", () => {
  assert.match(panelsBuild, /const bytes = await storageBytes\(sb, surface\.storagePath\);/,
    "the panel's pixels must be the full-resolution approved surface");
  assert.match(panelsBuild, /extractedFromProofRaster: false/);
  assert.doesNotMatch(panelsBuild, /\.extract\(\{ left: proofRegion/,
    "no panel may be cropped out of the vehicle-shaped proof sheet");
  assert.doesNotMatch(panelsBuild, /\.resize\(/,
    "the approved surface is already at its GENIE geometry; resampling it is not manufacturing");
});

/** The identity chain that makes a shared sheet safe to bind against. */
test("region, approved surface and produced panel must be one artwork", () => {
  assert.match(panelsBuild, /String\(proofRegion\.surfaceContentHash \|\| ""\)\.toLowerCase\(\) !== observed/,
    "the region's depicted hash must equal the surface hash the panel carries");
  assert.match(panelsBuild, /sourceContentHash: observed/);
  assert.match(panelsBuild, /sourceRegionHashes\[key\] = observed;/);
});

test("side selection is an exact canonical key lookup and nothing else", () => {
  // Comments stripped: the prose here names the forbidden matches in order to
  // forbid them, and a rule must not fail on its own statement.
  const code = panelsBuild.replace(/\/\/[^\n]*/g, "");
  assert.match(panelsBuild, /proofRegionByKey\.get\(key\)/);
  assert.match(panelsBuild, /SURFACE_KEYS\.includes\(String\(region\.surfaceKey\)\)/,
    "only canonical surface keys may address a region");
  for (const inferred of [/\.includes\("side"\)/, /startsWith\(/, /indexOf\(key\)/, /proofRegions\[\s*\d/, /alias/i, /nearest/i, /similar/i]) {
    assert.doesNotMatch(code, inferred, "no substring, alias, positional, nearest or similarity match may pick a side");
  }
});

test("panels.build fails closed on every broken binding", () => {
  for (const code of [
    "call9_proof_regions_missing",              // no anchors at all -> would be guessing
    "call9_proof_region_missing",               // this side has no anchor
    "call9_proof_region_out_of_bounds",         // rect off the sheet -> the anchor does not describe this side
    "call9_proof_region_surface_mismatch",      // region depicts artwork the panel does not carry
    "call9_proof_region_proof_mismatch",        // anchor belongs to a sheet the customer did not approve
    "call9_proof_region_revision_mismatch",     // stale revision's anchors -> new views, old panels
    "call9_proof_region_manifest_mismatch",     // measured against different GENIE geometry
    "call9_proof_identity_missing",             // nothing to bind to
    "call9_proof_changed",                      // the signed sheet is not the sheet bound
    "call9_surface_changed",                    // the artwork moved between Call 8 and Call 9
  ]) {
    assert.match(panelsBuild, new RegExp(code), `panels.build must fail closed on ${code}`);
  }
});

test("each region carries the proof, revision and GENIE identity it was measured under", () => {
  const proofBuild = claimant.slice(claimant.indexOf('proofRegionContract: built.proof2d.proofRegionContract'));
  for (const field of ["proofContentHash", "revisionId", "dimensionManifestId", "manifestHash"]) {
    assert.match(proofBuild.slice(0, 1200), new RegExp(`${field}:`), `regions must carry ${field}`);
  }
});

test("no model call may run in the stage that builds panels", () => {
  for (const forbidden of [/generativelanguage/, /generateContent/i, /renderFlatTile/, /sidefieldFlatten/, /clean-artboard/]) {
    assert.doesNotMatch(panelsBuild, forbidden, "Call 9 is arithmetic and binding; nothing here may call a model");
  }
});

test("the six sides are the six sides, and the database agrees", () => {
  assert.match(claimant, /PANEL_SOURCE_RULE = "one-own-surface-region-per-output-side"/);
  for (const side of SIDES) assert.match(proofSheet, new RegExp(`"${side}"`), `${side} must be an addressable region`);
});

/**
 * Ported from restylepro-os worker/designpro-proof-extract-v3.cjs
 * `canonicalTileBoxes`. Two sides pointing at one rectangle is the exact defect
 * that sent the driver's artwork to every side: the extractor gets one location
 * under six names and has no way to tell them apart.
 */
test("no two sides may point at the same region of the proof", () => {
  assert.match(proofSheet, /proof_region_duplicate/);
  assert.match(proofSheet, /proof_required_surface_missing/);
  assert.match(proofSheet, /new Set\(proofRegions\.map\(\(region\) => `\$\{region\.x\}:\$\{region\.y\}:\$\{region\.w\}:\$\{region\.h\}`\)\)/);
});
