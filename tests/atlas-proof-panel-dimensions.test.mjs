// CALL 2 IS TOLD THE PANEL'S PRINTED SIZE (owner ruling, Trish 2026-09-20:
// "it may be smarter to add the dimensions at call 2 which is the 3d vehicle
// proof — on call 2 the production panel proof must be shown to ai so it can
// quickly use to wrap the photoreal vehicle").
//
// `cutCallOnePanels` has always stamped trim/print inches, bleed and square
// feet onto every Call-1 panel. `atlasPanelForProofView` dropped all of them,
// so the photographer was handed Zone 1's six rectangles — a driver flank near
// 3.3:1 beside a front fascia near 2.3:1 — with no statement of which is which
// size, and had to infer the mapping from the picture.
//
// That inference is what the only real proof rejections convict: 16 of 16
// non-transport rejections in the five days to 2026-09-20 are
// `atlasContinuityContract=fail` — the artwork on the vehicle not matching the
// authority crop.

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const runtimeRequire = createRequire(join(HERE, "..", "runtime", "package.json"));
const { atlasPanelForProofView } = runtimeRequire(join(HERE, "..", "runtime", "flat-first-atlas.cjs"));
const { atlasProofRequestBody } = runtimeRequire(join(HERE, "..", "runtime", "designpanel-server-provider.cjs"));

// A 2012 Prius driver flank, exactly as the owner's own 2D Production Proof
// dimensions it: 165.7" x 49.6" print, 161.7" x 45.6" trim, 5" bleed, 60.1 sq ft.
const DRIVER = {
  surfaceKey: "driver", storagePath: "panels/driver.png", contentHash: "a".repeat(64),
  contentType: "image/png", sourceMasterHash: "b".repeat(64),
  trimWidthIn: 161.7, trimHeightIn: 45.6, printWidthIn: 165.7, printHeightIn: 49.6,
  surfaceSqFt: 60.1, bleedInches: 5, geometryPurpose: "calls-1-7-layout-only",
};
const atlas = { callOnePanels: [DRIVER], master: { contentHash: "b".repeat(64) } };

test("the Call-1 panel carries its printed size through to the proof view", () => {
  const panel = atlasPanelForProofView(atlas, "side");
  assert.equal(panel.surfaceKey, "driver");
  assert.equal(panel.printWidthIn, 165.7);
  assert.equal(panel.printHeightIn, 49.6);
  assert.equal(panel.trimWidthIn, 161.7);
  assert.equal(panel.surfaceSqFt, 60.1);
  assert.equal(panel.bleedInches, 5);
  assert.equal(panel.geometryPurpose, "calls-1-7-layout-only",
    "GENIE stays the geometry authority; these are design-time inches");

  // `Number(null)` is 0 and a 0" panel reads as fact. Absence stays absent.
  const bare = atlasPanelForProofView(
    { callOnePanels: [{ ...DRIVER, printWidthIn: null, surfaceSqFt: undefined }] }, "side");
  assert.equal(bare.printWidthIn, null);
  assert.equal(bare.surfaceSqFt, null);
});

const options = { requestId: "r", generationId: "g", claimToken: "c" };
const input = { vehicle: { year: 2012, make: "Toyota", model: "Prius" }, finish: "Gloss" };

test("the three-zone proof request states the panel's printed size to Call 2", () => {
  const panel = atlasPanelForProofView(atlas, "side");
  const body = atlasProofRequestBody({
    options, input, sourceViewType: "side", revisionId: "rev",
    authority: { storagePath: "sheet.png", contentHash: "c".repeat(64), contentType: "image/png",
      role: "three-zone-production-proof", contract: "designpro.atlas-three-zone-proof-authority.v1",
      surfaceKey: "driver", surfaceSelection: "fixed-by-surface", panel },
  });
  assert.equal(body.panelPrintWidthIn, 165.7);
  assert.equal(body.panelPrintHeightIn, 49.6);
  assert.equal(body.panelTrimWidthIn, 161.7);
  assert.equal(body.panelSquareFeet, 60.1);
  assert.equal(body.panelBleedIn, 5);
  // The three-zone sheet and the isolated target panel still ride with it.
  assert.equal(body.targetPanelStoragePath, "panels/driver.png");
  assert.equal(body.sourcePanelStoragePath, "sheet.png");
});

test("a panel with no stated size sends no dimension at all", () => {
  const panel = atlasPanelForProofView(
    { callOnePanels: [{ ...DRIVER, printWidthIn: null, printHeightIn: null }] }, "side");
  const body = atlasProofRequestBody({
    options, input, sourceViewType: "side", revisionId: "rev",
    authority: { storagePath: "sheet.png", contentHash: "c".repeat(64), contentType: "image/png",
      role: "three-zone-production-proof", contract: "x", surfaceKey: "driver",
      surfaceSelection: "fixed-by-surface", panel },
  });
  for (const key of ["panelPrintWidthIn", "panelPrintHeightIn", "panelSquareFeet", "panelBleedIn"]) {
    assert.equal(key in body, false, `${key} must be absent, never a fabricated 0"`);
  }
});

test("the photographer states the proportion and never paints the annotation", () => {
  const source = readFileSync(
    join(HERE, "..", "supabase", "functions", "persona-photographer-render", "index.ts"), "utf8");
  assert.match(source, /body\.panelPrintWidthIn/);
  assert.match(source, /aspect ratio of \$\{\(panelW \/ panelH\)\.toFixed\(2\)\}:1/);
  assert.match(source, /do not stretch, squeeze, crop or re-scale it/);
  assert.match(source, /bleed is trimmed at installation and is never visible/);
  // The line is emitted only when both dimensions are real.
  assert.match(source, /Number\.isFinite\(panelW\) && panelW > 0 && Number\.isFinite\(panelH\) && panelH > 0/);
  // Unchanged: document chrome is still forbidden on the vehicle.
  assert.match(source, /NEVER render those annotations on the vehicle/);
});
