/**
 * THE PRINT PANELS GET THEIR OWN CANVAS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every number below is generation `848be1c6` / revision `a9d6dd85`'s own
 * geometry, read off the row: the sheet came back 5056x3392, Zone 1 is 25.8%
 * of its height, and six panels sit ACROSS it — so each cell is ~843 px and a
 * 166.8" passenger flank is 5 px/in.
 *
 * The owner's three complaints all reduce to that one number, so this file
 * asserts the number moves and that nothing else can be lost while it does.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const {
  refineZone, pixelsPerInch, panelRefineEnabled, refineZoneOnePanels,
  PANEL_REFINE_CONTRACT, REFINE_LONG_EDGE_PX,
} = require("../runtime/atlas-panel-refine.cjs");

/** revision a9d6dd85: the six Zone 1 cells and their print rectangles. */
const LIVE = [
  { surfaceKey: "driver", widthIn: 166.8, heightIn: 59.4, cellPx: 985 },
  { surfaceKey: "passenger", widthIn: 166.8, heightIn: 59.4, cellPx: 985 },
  { surfaceKey: "roof", widthIn: 89.8, heightIn: 54.8, cellPx: 530 },
  { surfaceKey: "hood", widthIn: 65.6, heightIn: 39.6, cellPx: 389 },
  { surfaceKey: "front", widthIn: 75.3, heightIn: 32.2, cellPx: 445 },
  { surfaceKey: "rear", widthIn: 75.3, heightIn: 53.1, cellPx: 445 },
];

test("the live sheet's panels are unprintable, and per-panel fixes that", () => {
  for (const s of LIVE) {
    const before = pixelsPerInch(s.cellPx, s.widthIn);
    const after = pixelsPerInch(refineZone(s.surfaceKey, s.widthIn, s.heightIn).w, s.widthIn);
    // Every surface at least triples; the flanks — the panels a customer reads
    // the wrap from, and the worst offenders — do better than 4x.
    assert.ok(after / before >= 3, `${s.surfaceKey}: ${before} -> ${after} px/in is under 3x`);
    assert.ok(before < 25, `${s.surfaceKey}: the live cell should be the problem, not already fine`);
  }
  const driverBefore = pixelsPerInch(985, 166.8);
  const driverAfter = pixelsPerInch(refineZone("driver", 166.8, 59.4).w, 166.8);
  assert.equal(driverBefore, 5.91);
  assert.equal(driverAfter, 24.56);
});

test("the canvas preserves the panel's own print aspect", () => {
  // A rounded pair whose ratio drifted would spend evaluateAuthored's
  // contain-fit budget for nothing.
  for (const s of LIVE) {
    const z = refineZone(s.surfaceKey, s.widthIn, s.heightIn);
    assert.equal(Math.max(z.w, z.h), REFINE_LONG_EDGE_PX);
    const drift = (z.w / z.h) / (s.widthIn / s.heightIn);
    assert.ok(Math.abs(drift - 1) < 0.002, `${s.surfaceKey}: aspect drifted ${drift}`);
  }
});

test("a panel with no print rectangle yields no canvas, never a guessed one", () => {
  // `Number(null)` is 0 and would produce an infinite scale. Absence stays absence.
  assert.equal(refineZone("hood", null, 39.6), null);
  assert.equal(refineZone("hood", 65.6, undefined), null);
  assert.equal(refineZone("hood", 0, 39.6), null);
  assert.equal(pixelsPerInch(4096, 0), null);
  assert.equal(pixelsPerInch(4096, null), null);
});

test("only the exact word 'on' enables it", () => {
  assert.equal(panelRefineEnabled({ DESIGNPRO_ATLAS_PANEL_REFINE: "on" }), true);
  assert.equal(panelRefineEnabled({ DESIGNPRO_ATLAS_PANEL_REFINE: " ON " }), true);
  for (const v of ["off", "", "true", "1", "yes", "no", undefined]) {
    assert.equal(panelRefineEnabled({ DESIGNPRO_ATLAS_PANEL_REFINE: v }), false, `${v} must not enable it`);
  }
  assert.equal(panelRefineEnabled({}), false);
});

const cell = (surfaceKey, widthIn, heightIn) => ({
  surfaceKey, widthIn, heightIn, bytes: Buffer.from(`${surfaceKey}-cell`), pixelWidth: 843,
});

test("a refused panel KEEPS its original — the design is never lost", async () => {
  // The whole safety case. `authorSurface` is reached through callEdge, so a
  // throwing transport is a refused surface.
  const out = await refineZoneOnePanels({
    zone1: LIVE.map((s) => cell(s.surfaceKey, s.widthIn, s.heightIn)),
    callEdge: async () => { throw Object.assign(new Error("provider down"), { code: "flat_atlas_x" }); },
    store: {},
  });
  assert.equal(out.contract, PANEL_REFINE_CONTRACT);
  assert.equal(out.applied, false);
  assert.equal(out.panels.size, 0, "no panel may be replaced when every one refused");
  assert.equal(out.surfaces.length, 6);
  assert.ok(out.surfaces.every((s) => s.refined === false && s.reason));
  // Every surface still reports what it WAS, so a reader can see the run
  // happened and changed nothing.
  assert.ok(out.surfaces.every((s) => typeof s.pxPerInchBefore === "number"));
});

test("with no transport it is a clean no-op", async () => {
  const out = await refineZoneOnePanels({ zone1: [cell("driver", 166.8, 59.4)], callEdge: null });
  assert.equal(out.applied, false);
  assert.equal(out.panels.size, 0);
  assert.deepEqual(out.surfaces, []);
});

test("it is a resolution pass, not a second design authority", () => {
  const raw = readFileSync(new URL("../runtime/atlas-panel-refine.cjs", import.meta.url), "utf8");
  // COMMENTS ARE NOT CODE, and this assertion is about code. The module's own
  // docs NAME `createAtlasAuthorTransport` to say which transport the caller
  // must hand it — scanning the raw text convicts the documentation for
  // describing the rule it follows. (Caught by this very case on its first
  // run, which is the argument for stripping rather than for vaguer wording.)
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  // RULE 0.26: one Call-1 network door. This file must reach the model only
  // through the transport its caller hands it, never by building its own.
  assert.ok(!/createAtlasAuthorTransport|callAtlasAuthorEdge|fetch\(/.test(src),
    "the refine pass must not open its own door to the provider");
  // ...and the stripper must not blind the lock: an injected real call is caught.
  const injected = src.replace("authorSurface({", "await fetch('https://x'); authorSurface({");
  assert.ok(/fetch\(/.test(injected), "the comment stripper must still see real code");
  // RULE 0.21: one producer. It re-uses authorSurface rather than re-typing
  // the author/evaluate/contain/fill chain.
  assert.match(src, /require\("\.\/atlas-hero-driver\.cjs"\)/);
  assert.match(src, /authorSurface\(/);
  // Each panel is shown ITS OWN accepted cell, which is what makes this a
  // re-draw of an approved design rather than a fresh one.
  assert.match(src, /neighbours: \[\{ surfaceKey: cell\.surfaceKey, bytes: cell\.bytes \}/);
});
