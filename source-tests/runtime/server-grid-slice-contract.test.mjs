import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import gridSliceModule from "../../runtime/server-grid-slice.cjs";

const claimant = readFileSync(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../../runtime/index.js", import.meta.url), "utf8");
const surface = readFileSync(new URL("../../runtime/gemini-flat-surface.cjs", import.meta.url), "utf8");
const grid = readFileSync(new URL("../../runtime/server-grid-slice.cjs", import.meta.url), "utf8");
const { gridSliceAll, gridSlicePanel } = gridSliceModule;

function fieldSvg(surfaceKey, color) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200">
    <rect width="800" height="1200" fill="${color}"/>
    <text x="400" y="600" font-size="80" text-anchor="middle" fill="white">${surfaceKey}</text>
  </svg>`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// ⛔ CALL 8 CONSUMES THE SIX CALL-1 PANELS. IT DOES NOT CONSUME THE SEVEN
//    3D PROOFS. (Trish 2026-08-29.)
//
// This test used to assert the inverse, line for line: that the claimant passed
// `frozenViews.viewReceipts` into `call8ProofRequest`, and that the runtime
// entry still reached `authorFlatSurfaceFields` -- the Gemini pass that
// flattened each 3D proof PHOTOGRAPH into a "surface field". Those fields were
// the sheet's tiles and, through `panels.build`'s fail-open arm, the customer's
// print files. It was a faithful lock on a source-authority inversion.
test("Call 8 consumes the six Call-1 panels and composes the dimensioned proof deterministically", () => {
  assert.match(claimant, /call8ProofRequest\(rebound, manifest, panelSources, frozenViews\.viewReceipts/);
  assert.match(claimant, /const callOnePanels = await callOnePanelSet\(sb, run\);/);
  assert.match(claimant, /call8_production_panels_not_created/);
  assert.match(claimant, /callTool\(baseUrl, secret, "\/compose-proof-sheet"/);
  assert.match(runtime, /renderProofSheet/);
  assert.match(claimant, /proofKind: "flattened-2d-proof"/);
  // The receipt says, in fields a query can read, what the sheet is made of.
  assert.match(claimant, /assembledFrom: "atlas-call1-panels"/);
  assert.match(claimant, /imageRequestCount: 0/);
  assert.match(claimant, /proofPixelsUsed: false/);
  // And nothing on the Call-8 path generates an image any more. The patterns
  // are call and endpoint syntax, not bare words, so the comments recording
  // what was removed -- which are the point of removing it -- stay legal.
  for (const generative of [/authorFlatSurfaceFields\(/, /generativelanguage\.googleapis/, /:generateContent/]) {
    assert.doesNotMatch(runtime, generative, "the Call 8 endpoint must make no image request");
    assert.doesNotMatch(surface, generative, "the shared surface vocabulary must author nothing");
  }
});

// CALL 9 IS PROMOTION, NOT CUTTING. Call 1 already cut the six panels from the
// accepted master; `panels.build` re-reads those exact bytes, re-hashes them and
// copies them into the run's namespace. It used to gridslice the flattened
// photographs instead, which is why the markers below moved off the claimant.
// The geometry module itself is unchanged and still asserted -- it is pure
// deterministic pixel math, and the assertions on it are the ones worth keeping.
test("Call 9 promotes the Call-1 panels, and the deterministic geometry stays AI-free", () => {
  for (const marker of [
    "promotedFrom: \"atlas-call1\"",
    "deterministic: true",
    "call9_call1_panel_changed",
    "call9_call1_panel_promotion_drift",
  ]) assert.ok(claimant.includes(marker), marker);
  // Every panel a run ships is a copy of a Call-1 artifact, or the stage fails.
  assert.match(claimant, /production_panels_not_created/);
  assert.doesNotMatch(claimant, /gridSliceAll\(/, "Call 9 must not cut anything");
  assert.match(grid, /resize\(crop\.resizedWidth, crop\.resizedHeight/);
  assert.match(grid, /\.extract\(\{ left: crop\.left, top: crop\.top/);
  assert.match(grid, /extendWith: "mirror"/);
  assert.match(grid, /const ppi = Math\.min\(MAX_PPI, maxCanvas \/ Math\.max\(printWidthIn, printHeightIn\)\)/);
  for (const forbidden of ["generativelanguage", "generateContent", "Gemini", "Railway", "railway"]) {
    assert.doesNotMatch(grid, new RegExp(forbidden), `${forbidden} must not exist in deterministic gridslice`);
  }
});

test("every Call-8 tile and every Call-9 panel is hash-bound to its own Call-1 artifact", () => {
  // Call 8: the tile must be the panel, by hash and by path.
  assert.match(claimant, /String\(tile\.sourcePanelHash \|\| ""\)\.toLowerCase\(\) !== panel\.contentHash/);
  assert.match(claimant, /tile\.sourcePanelPath !== panel\.storagePath/);
  assert.match(claimant, /call8_call1_panel_changed/);
  // Call 9: the promoted copy must hash to the Call-1 panel it copied.
  assert.match(claimant, /observed !== String\(panel\.contentHash \|\| ""\)\.toLowerCase\(\)/);
  assert.match(claimant, /String\(stored\.hash\)\.toLowerCase\(\) !== observed/);
  // And six surfaces means six distinct sets of bytes, at both calls.
  assert.match(claimant, /new Set\(Object\.values\(panelHashes\)\)\.size !== SURFACE_KEYS\.length/);
});

// Owner decision 2026-08-23: the A.T.L.A.S. split path is wired to the ONE
// existing file-output pipeline. Both pipelines reach the same idempotent
// handoff, so the customer page can never again be a seven-image dead end for
// one of them.
test("both pipelines enter the standard handoff, and neither forks a second producer", () => {
  const hook = readFileSync(new URL("../../app/src/hooks/useDesignPanelProLogic.ts", import.meta.url), "utf8");
  assert.match(hook, /await handoffGeneration\(request\.requestId\)/);
  assert.doesNotMatch(
    hook,
    /if \(acceptedPipelineMode !== FLAT_FIRST_ATLAS_PIPELINE_MODE\) \{[\s\S]*?handoffGeneration/,
    "A.T.L.A.S. must not be excluded from the production handoff again",
  );
  assert.equal((hook.match(/handoffGeneration\(/g) || []).length, 1, "one handoff call site, not one per pipeline");
});

test("executable gridslice produces deterministic GENIE trim plus exact five-inch mirror bleed", async () => {
  const source = fieldSvg("driver", "#b91c1c");
  const surface = { surfaceKey: "driver", widthInches: 10, heightInches: 20 };
  const first = await gridSlicePanel(source, surface, { bleedInches: 5, maxCanvas: 1500 });
  const second = await gridSlicePanel(source, surface, { bleedInches: 5, maxCanvas: 1500 });

  assert.equal(first.contentHash, second.contentHash);
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.effectivePpi, 50);
  assert.equal(first.pixelWidth, 1000);
  assert.equal(first.pixelHeight, 1500);
  assert.equal(first.printWidthIn, 20);
  assert.equal(first.printHeightIn, 30);
  assert.equal(first.bleedIn, 5);
});

test("executable gridslice uses six exact own-surface fields and never reuses a panel", async () => {
  const surfaces = [
    { surfaceKey: "driver", widthInches: 10, heightInches: 20 },
    { surfaceKey: "passenger", widthInches: 20, heightInches: 20 },
    { surfaceKey: "hood", widthInches: 5, heightInches: 15 },
    { surfaceKey: "roof", widthInches: 10, heightInches: 15 },
    { surfaceKey: "front", widthInches: 15, heightInches: 15 },
    { surfaceKey: "rear", widthInches: 20, heightInches: 40 },
  ];
  const colors = ["#b91c1c", "#1d4ed8", "#15803d", "#7e22ce", "#c2410c", "#0f766e"];
  const fields = new Map(surfaces.map((surface, index) => [
    surface.surfaceKey,
    fieldSvg(surface.surfaceKey, colors[index]),
  ]));

  const panels = await gridSliceAll(fields, surfaces, { bleedInches: 5, maxCanvas: 1500 });

  assert.deepEqual(panels.map((panel) => panel.surfaceKey), surfaces.map((surface) => surface.surfaceKey));
  assert.equal(new Set(panels.map((panel) => panel.contentHash)).size, 6);
  for (const panel of panels) {
    assert.equal(panel.sourceFieldHash, sha256(fields.get(panel.surfaceKey)));
    assert.equal(panel.bleedIn, 5);
    assert.equal(panel.deterministic, true);
    assert.equal(panel.step, "gridslice");
  }
});

// DELETED WITH THE FLATTENER THEY EXERCISED (Trish 2026-08-29):
//
//   "server Call 8 runs the proven own-side GENERATE -> QC -> RETRY gate
//    before persistence"
//   "server Call 8 refuses three own-side fields that fail hard QC"
//
// Both drove `authorFlatSurfaceFields` end to end -- generate a surface from
// its own 3D proof photograph, judge it, retry up to three times, refuse on
// hard QC. The gate worked exactly as written. What it was gating was the
// conversion of a photograph into production artwork, so the gate is gone with
// the conversion, and there is nothing left on the Call-8 path for a judge to
// judge: the six tiles ARE the panels, verified by sha256 rather than by a
// model's opinion. See `proof-sheet-panel-tiles.test.mjs` for the contract that
// replaced them.
