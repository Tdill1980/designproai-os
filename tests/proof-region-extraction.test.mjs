// ⛔ THE PRODUCTION PANEL IS A CROP OF THE MASTER. IT IS NEVER A FLATTENED 3D
//    PROOF. (Trish 2026-08-29.)
//
// This file was the lock on the old "proof region extraction" architecture, and
// every assertion in it held right up to the day it was deleted:
//
//   "Call 8 freezes one flat field from each surface's own DesignPanel render"
//   "Call 9 gridslices each immutable field at GENIE trim plus five-inch mirror bleed"
//   "side selection is exact and cannot fall back to another field"
//   "Call 9 fails closed on field, geometry, receipt and reuse drift"
//
// A "field" was that surface's own 3D PROOF PHOTOGRAPH, flattened by one Gemini
// call. The isolation was genuine -- each surface was flattened from its own
// view, never from the driver hero, which is what the "Do not import, recall,
// mirror, or continue artwork from the driver side" assertion protected. Six
// carefully isolated photographs is still six photographs, and Call 9 gridsliced
// them into the customer's print files.
//
// The authority chain runs one way and only one way:
//
//   Call-1 flattened A.T.L.A.S. master
//     -> exact deterministic container crop
//       -> Call-1 panel        <- the ONLY production artwork
//         -> 3D proof          <- presentation, downstream, terminal
//
// So this file now locks the inverse: Call 8 composes the six Call-1 panels,
// Call 9 promotes those exact bytes, and neither stage contains a model call or
// reaches for a view.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const claimant = readFileSync(new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
const surfaceVocabulary = readFileSync(new URL("../runtime/gemini-flat-surface.cjs", import.meta.url), "utf8");
const runtimeEntry = readFileSync(new URL("../runtime/index.js", import.meta.url), "utf8");
const gridSlice = readFileSync(new URL("../runtime/server-grid-slice.cjs", import.meta.url), "utf8");
const proofSheet = readFileSync(new URL("../runtime/proof-sheet.cjs", import.meta.url), "utf8");
const SIDES = ["driver", "passenger", "hood", "roof", "front", "rear"];

const panelsBuild = (() => {
  const stage = claimant.slice(claimant.indexOf('stage.stage_key === "panels.build"'));
  return stage.slice(0, stage.indexOf('stage.stage_key === "logos.extract"'));
})();

const call8 = (() => {
  const start = claimant.indexOf("async function buildCall8Proof(");
  return claimant.slice(start, claimant.indexOf("\nasync function executeEntice(", start));
})();

test("Call 8's six surface inputs are the six Call-1 panels", () => {
  assert.match(call8, /const callOnePanels = await callOnePanelSet\(sb, run\);/);
  assert.match(call8, /call8_production_panels_not_created/);
  // Re-read and re-hashed before they are proofed: the snapshot states the
  // identity, storage has to still agree with it.
  assert.match(call8, /hashBytes\(bytes\) !== contentHash \|\| bytes\.length !== Number\(panel\.byteSize\)/);
  assert.match(call8, /call8_call1_panel_changed/);
  // And each tile on the returned sheet is bound to its own panel, by hash.
  assert.match(call8, /String\(tile\.sourcePanelHash \|\| ""\)\.toLowerCase\(\) !== panel\.contentHash/);
  assert.match(call8, /tile\.sourcePanelPath !== panel\.storagePath/);
});

test("Call 8 makes no image request, and says so in the receipt", () => {
  assert.match(call8, /result\.imageRequestCount !== 0/);
  assert.match(call8, /imageRequestCount: 0/);
  assert.match(call8, /deterministic: true/);
  assert.match(call8, /assembledFrom: "atlas-call1-panels"/);
  // The seven proofs are recorded as LINEAGE and nothing more. The negative is
  // stated as a field rather than left to be inferred from an absence.
  assert.match(call8, /viewLineageRole: "presentation-only"/);
  assert.match(call8, /proofPixelsUsed: false/);
  // The contract version is the fence: a v3 server returns Gemini-flattened
  // `surfaceFields`, and naming v4 is what refuses a half-rolled droplet.
  assert.match(call8, /result\.contract !== "designpro\.call8-panel-proof\.v4"/);
  assert.match(call8, /result\.surfaceFields !== undefined/);
  assert.match(call8, /result\.surfacePanels !== undefined/);
});

test("Call 9 promotes the Call-1 bytes and cuts nothing", () => {
  assert.match(panelsBuild, /const callOnePanels = await callOnePanelSet\(sb, run\);/);
  assert.match(panelsBuild, /promotedFrom: "atlas-call1"/);
  assert.match(panelsBuild, /source: "atlas-call1-panel"/);
  assert.doesNotMatch(panelsBuild, /gridSliceAll\(/);
  // A run with no Call-1 panel set produces no panels at all. It does not fall
  // through to anything.
  assert.match(panelsBuild, /production_panels_not_created/);
});

test("Call 9 fails closed on byte drift, promotion drift and surface collision", () => {
  for (const code of [
    "call9_call1_panel_changed",
    "call9_call1_panel_promotion_drift",
    "call9_panel_identity_collision",
    "production_panels_not_created",
  ]) assert.match(panelsBuild, new RegExp(code));
  // The set-shape guards live in the helper that reads the snapshot.
  const helper = claimant.slice(
    claimant.indexOf("async function callOnePanelSet"),
    claimant.indexOf("async function storageBytes"),
  );
  for (const code of [
    "call9_revision_source_drift",
    "call9_call1_panel_set_invalid",
    "call9_call1_panel_surface_missing",
    "call9_call1_panel_identity_invalid",
  ]) assert.match(helper, new RegExp(code));
});

test("neither Call 8 nor Call 9 contains a model call", () => {
  for (const forbidden of [/generativelanguage/, /generateContent/i, /functions\.invoke/, /fetch\(/]) {
    assert.doesNotMatch(panelsBuild, forbidden);
    assert.doesNotMatch(gridSlice, forbidden);
    assert.doesNotMatch(proofSheet, forbidden);
  }
  // Call 8 still calls ONE tool -- `/compose-proof-sheet` -- and that endpoint
  // is now pure composition, so the tool call is named rather than forbidden.
  assert.match(call8, /callTool\(baseUrl, secret, "\/compose-proof-sheet", spec\.request\)/);
  assert.equal((call8.match(/callTool\(/g) || []).length, 1);
  const endpoint = runtimeEntry.slice(
    runtimeEntry.indexOf('app.post("/compose-proof-sheet"'),
    runtimeEntry.indexOf("\napp.listen(PORT,"),
  );
  for (const forbidden of [/generativelanguage/, /generateContent/i, /authorFlatSurfaceFields\(/, /gridSliceAll\(/]) {
    assert.doesNotMatch(endpoint, forbidden, "the Call 8 endpoint composes; it does not generate");
  }
});

test("the surface vocabulary module authors nothing", () => {
  for (const gone of [/function authorFlatSurfaceFields/, /function generateOneSurface/, /function judgeSurface/,
                      /function flatPrompt/, /Do not import, recall, mirror, or continue artwork/]) {
    assert.doesNotMatch(surfaceVocabulary, gone, "the flat-surface authoring pass must stay deleted");
  }
});

test("the exact six production sides remain canonical", () => {
  assert.match(claimant, /PANEL_SOURCE_RULE = "one-own-surface-region-per-output-side"/);
  for (const side of SIDES) assert.match(surfaceVocabulary, new RegExp(`"${side}"`));
  for (const side of SIDES) assert.match(proofSheet, new RegExp(`${side}:`));
});
