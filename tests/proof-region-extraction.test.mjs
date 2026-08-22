import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const claimant = readFileSync(new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
const surfaceAuthor = readFileSync(new URL("../runtime/gemini-flat-surface.cjs", import.meta.url), "utf8");
const gridSlice = readFileSync(new URL("../runtime/server-grid-slice.cjs", import.meta.url), "utf8");
const SIDES = ["driver", "passenger", "hood", "roof", "front", "rear"];

const panelsBuild = (() => {
  const stage = claimant.slice(claimant.indexOf('stage.stage_key === "panels.build"'));
  return stage.slice(0, stage.indexOf('stage.stage_key === "logos.extract"'));
})();

test("Call 8 freezes one flat field from each surface's own DesignPanel render", () => {
  assert.match(surfaceAuthor, /const ownReference = await verifiedReference\(sources\.get\(surfaceKey\)\)/);
  assert.match(surfaceAuthor, /ownSourceViewKey: surfaceKey/);
  assert.match(surfaceAuthor, /ownSourceViewSha256: sources\.get\(surfaceKey\)\.contentHash/);
  assert.match(surfaceAuthor, /Do not import, recall, mirror, or continue artwork from the driver side/);
  assert.match(surfaceAuthor, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\)/);
  assert.match(surfaceAuthor, /const verdict = await judge/);
  assert.doesNotMatch(surfaceAuthor, /cross-vehicle design anchor/i);
});

test("Call 9 gridslices each immutable field at GENIE trim plus five-inch mirror bleed", () => {
  assert.match(panelsBuild, /gridSliceAll\(fieldSources, manifest\.expectedSurfaces, \{ bleedInches: 5, maxCanvas: 4000 \}\)/);
  assert.match(gridSlice, /const ppi = Math\.min\(MAX_PPI, maxCanvas \/ Math\.max\(printWidthIn, printHeightIn\)\)/);
  assert.match(gridSlice, /\.extract\(\{ left: crop\.left, top: crop\.top, width: crop\.width, height: crop\.height \}\)/);
  assert.match(gridSlice, /extendWith: "mirror"/);
  assert.match(gridSlice, /production gridslice requires exactly \$\{BLEED_INCHES\} inches of bleed/);
});

test("side selection is exact and cannot fall back to another field", () => {
  assert.match(panelsBuild, /fieldSources\.set\(key, \{ bytes \}\)/);
  assert.match(panelsBuild, /field\.ownSourceViewKey !== key/);
  assert.match(panelsBuild, /recordedByKey\.get\(key\)/);
  assert.match(gridSlice, /sourceBytesFor\(surfaceSources, surfaceKey\)/);
  for (const inferred of [/\.includes\("side"\)/, /nearest/i, /similar/i, /alias/i]) {
    assert.doesNotMatch(panelsBuild.replace(/\/\/[^\n]*/g, ""), inferred);
  }
});

test("Call 9 fails closed on field, geometry, receipt and reuse drift", () => {
  for (const code of [
    "call9_surface_set_invalid",
    "call9_surface_fields_missing",
    "call9_surface_field_binding_drift",
    "call9_surface_field_changed",
    "call9_gridslice_failed",
    "call9_genie_identity_missing",
    "call9_gridslice_receipt_mismatch",
    "call9_surface_reuse",
    "call9_driver_passenger_reuse",
  ]) assert.match(panelsBuild, new RegExp(code));
});

test("the gridslice stage contains no model or external-function call", () => {
  for (const forbidden of [/generativelanguage/, /generateContent/i, /callTool\(/, /functions\.invoke/, /fetch\(/]) {
    assert.doesNotMatch(panelsBuild, forbidden);
    assert.doesNotMatch(gridSlice, forbidden);
  }
});

test("the exact six production sides remain canonical", () => {
  assert.match(claimant, /PANEL_SOURCE_RULE = "one-own-surface-region-per-output-side"/);
  for (const side of SIDES) assert.match(surfaceAuthor, new RegExp(`"${side}"`));
});
