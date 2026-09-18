// THE INSPECTOR GATE, POINTED AT THE PANEL CELLS (owner ruling, Trish
// 2026-09-18): "The validation logic must actively slice the generated sheet
// using PROOF_REGIONS to evaluate individual panel cells ... rather than
// judging the blank white canvas around it."
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const gate = require("../runtime/atlas-proof-zone-gate.cjs");
const container = require("../runtime/atlas-proof-container-template.cjs");

const ROWS = [
  'DRIVER: 165.7" wide x 49.6" high', 'PASSENGER: 165.7" wide x 49.6" high',
  'ROOF: 43" wide x 56" high', 'HOOD: 50" wide x 41" high',
  'FRONT: 50" wide x 22" high', 'REAR: 58" wide x 40" high',
];
const manifest = container.parsePanelRows(ROWS);
const sheet = (name) => readFileSync(new URL(`../runtime/atlas-examples/${name}`, import.meta.url));

/**
 * THE BLANK CONTAINER IS RENDERED HERE, NOT READ FROM A PINNED PNG.
 *
 * It used to slice `atlas-examples/panel-proof-container-template.png`, a
 * pre-rendered sheet — and that file stopped being what the code draws the
 * moment the cell gap moved (the height tags needed 56px of clearance, not 42,
 * or their leading digits clipped). The cells this test computes then landed on
 * the fixture's gutters and two of them convicted, reporting the LAYOUT CHANGE
 * as a gate failure.
 *
 * A fixture that is not the real thing cannot test the real thing — the fifth
 * time this repository has recorded that shape. The blank container for THIS
 * manifest is one call away, so there is no reason to hold a stale copy of it.
 */
const blankContainer = () => container.renderContainerTemplate({
  manifest, companyName: "BRIGHT SMILES DENTAL", vehicle: "2012 TOYOTA PRIUS", bleedInches: 5,
});

test("SLICING ALONE PASSES A BLANK PROOF — ink is the discriminator", async () => {
  // This is the whole reason the gate measures ink at all, and it was found by
  // running the gate rather than by reasoning about it. Every predicate
  // atlas-master-qc contributes is a DARKNESS test (holeAt <= 24), so an empty
  // white panel cell is not a hole by any of them. A gate that only sliced
  // would wave a proof with six blank boxes straight through -- the efca5e03
  // shape, where a luma-88 surround scored 0.073 against a 0.35 limit.
  const empty = await gate.inspectProofZones({ proofBytes: await blankContainer(), manifest });
  assert.equal(empty.blocking.length, 0,
    "if the imported predicates ever DO convict the blank container, this comment is stale");
  for (const cell of empty.cells) {
    assert.equal(cell.edgeHoleRatio, 0, `${cell.surfaceKey}: white is not dark`);
    assert.ok(cell.nonBlackFraction > 0.99, `${cell.surfaceKey}: white is not black`);
  }

  // The owner's filled twin is the same document with artwork in the cells.
  const filled = await gate.inspectProofZones({
    proofBytes: sheet("panel-proof-zones-filled.png"), manifest });
  assert.equal(filled.cells.length, 6);

  // INK SEPARATES THEM AND NOTHING ELSE DOES. Measured: empty 0.023-0.055,
  // filled 0.255-0.583. The worst pair is front, 0.055 against 0.255.
  const inkOf = (r) => Object.fromEntries(r.cells.map((c) => [c.surfaceKey, c.inkFraction]));
  const e = inkOf(empty);
  const f = inkOf(filled);
  for (const key of ["driver", "passenger", "roof", "hood", "front", "rear"]) {
    assert.ok(e[key] < 0.1, `${key}: an empty cell must read near zero, got ${e[key]}`);
    assert.ok(f[key] > 0.2, `${key}: a filled cell must read high, got ${f[key]}`);
    assert.ok(f[key] > e[key] * 3,
      `${key}: filled ${f[key]} is not separated from empty ${e[key]}`);
  }
});

test("the cells come from the code that DREW them, and scale with the sheet", async () => {
  // RULE 0.27 applied to validation. Deriving the rectangles a second time is
  // how the drawing and the checking drift apart, so the gate asks the renderer.
  const layout = container.containerLayout(manifest);
  assert.equal(layout.zone1.length, 6);
  assert.equal(layout.width, 1536);
  assert.equal(layout.height, 1024);

  // A 4K request does not come back at the container's pixel size, so every
  // rectangle scales by the sheet's own width. A gate that assumed 1536 would
  // measure a strip of margin on a 3072-wide sheet and report it as a panel.
  const scaled = gate._test.scaleCells(layout.zone1, layout, { width: 3072, height: 2048 });
  assert.equal(scaled[0].x, layout.zone1[0].x * 2);
  assert.equal(scaled[0].w, layout.zone1[0].w * 2);
  assert.ok(scaled.every((c) => Number.isSafeInteger(c.x) && Number.isSafeInteger(c.w)),
    "validatedZone requires safe integers and throws otherwise");
});

test("a re-flowed sheet is REFUSED rather than measured", async () => {
  // If the model returns a different aspect it has re-flowed the layout, and
  // scaled rectangles then point at the wrong parts of the page. Reporting a
  // confident number about the wrong rectangle is worse than reporting none.
  const sharp = require("../runtime/node_modules/sharp");
  const square = await sharp({ create: { width: 1024, height: 1024, channels: 3,
    background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  const out = await gate.inspectProofZones({ proofBytes: square, manifest });
  assert.match(out.refused || "", /proof_zone_gate_aspect_drift/);
  assert.equal(out.cells.length, 0, "a refused sheet reports no cell measurements");
});
