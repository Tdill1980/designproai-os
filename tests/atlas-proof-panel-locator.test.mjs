// FIND THE PANELS IN A RETURNED PROOF, rather than assuming where they are.
// Owner ruling, Trish 2026-09-18: the PROOF_REGIONS slicer becomes an active
// enforcement gate. Live sheet d5314267 proved the assumed-position version of
// that gate measures the wrong rectangles, so the panels are located instead.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const locator = require("../runtime/atlas-proof-panel-locator.cjs");
const sharp = require("../runtime/node_modules/sharp");

// A PROOF SHEET, SYNTHESISED WITH THE PROPERTIES THAT BROKE THE REAL ONE:
// a GREY page (not white), panels whose interiors are WHITE, and thin rules
// running between the panels the way dimension lines do.
async function fixture({ page = 233, panels, rules = [] }) {
  const rects = panels.map((p) =>
    `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="#ffffff" stroke="#1d4ed8" stroke-width="6"/>`
    + `<rect x="${p.x + 10}" y="${p.y + p.h * 0.6}" width="${p.w - 20}" height="${p.h * 0.3}" fill="#1d4ed8"/>`).join("");
  const lines = rules.map((r) =>
    `<line x1="${r.x1}" y1="${r.y1}" x2="${r.x2}" y2="${r.y2}" stroke="#111827" stroke-width="3"/>`).join("");
  const grey = `rgb(${page},${page},${page})`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="600">`
    + `<rect width="100%" height="100%" fill="${grey}"/>${rects}${lines}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const WHOLE = { x: 0, y: 0, w: 1, h: 1 };

test("the page colour is MEASURED, so a grey page is not mistaken for ink", async () => {
  // The first version assumed the page was white and masked everything below
  // luma 236. On the real sheet the page is grey 233 and the panel interiors
  // are white 255, so that returned ONE component spanning the entire band.
  const bytes = await fixture({ panels: [
    { x: 100, y: 120, w: 500, h: 360 }, { x: 700, y: 120, w: 500, h: 360 },
    { x: 1300, y: 120, w: 400, h: 360 },
  ] });
  const out = await locator.locatePanels({ proofBytes: bytes, band: WHOLE, sharp });
  assert.equal(out.pageLuma, 233, "the grey page must be detected as the page");
  assert.equal(out.panels.length, 3,
    `expected 3 panels on a grey page, got ${out.panels.length}`);
});

test("dimension rules between panels do not bridge them into one component", async () => {
  // Measured on d5314267: without erosion the arrows and extension lines
  // chained driver, passenger and roof into a single 3050px component.
  const panels = [
    { x: 100, y: 120, w: 500, h: 360 }, { x: 700, y: 120, w: 500, h: 360 },
    { x: 1300, y: 120, w: 400, h: 360 },
  ];
  const rules = [{ x1: 100, y1: 90, x2: 1700, y2: 90 }, { x1: 650, y1: 120, x2: 650, y2: 480 }];
  const bridged = await fixture({ panels, rules });
  const out = await locator.locatePanels({ proofBytes: bridged, band: WHOLE, sharp });
  assert.equal(out.panels.length, 3,
    `rules bridged the panels into ${out.panels.length} components`);
  assert.ok(out.panels.every((p) => p.w < 700),
    "a bridged component would be far wider than any single panel");
});

test("it counts what is there — which is what convicts a duplicate or a gap", async () => {
  // This is the whole reason to locate rather than assume. On the live sheet
  // ZONE 1 carries SEVEN panels (FRONT drawn twice) and ZONE 3 leaves boxes
  // empty. A density check over assumed cells convicts neither, because it
  // never knew how many panels there should be.
  const five = await fixture({ panels: [0, 1, 2, 3, 4].map((i) => (
    { x: 60 + i * 340, y: 140, w: 300, h: 320 })) });
  const seven = await fixture({ panels: [0, 1, 2, 3, 4, 5, 6].map((i) => (
    { x: 40 + i * 250, y: 140, w: 210, h: 320 })) });
  assert.equal((await locator.locatePanels({ proofBytes: five, band: WHOLE, sharp })).panels.length, 5);
  assert.equal((await locator.locatePanels({ proofBytes: seven, band: WHOLE, sharp })).panels.length, 7);
});

test("erosion removes thin structures and keeps solid blocks", async () => {
  const w = 60; const h = 40;
  const mask = new Uint8Array(w * h);
  for (let y = 10; y < 30; y += 1) for (let x = 10; x < 30; x += 1) mask[y * w + x] = 1; // block
  for (let x = 0; x < w; x += 1) mask[20 * w + x] = 1; // a 1px rule straight through
  const eroded = locator._test.erode(mask, w, h, locator.ERODE_PASSES);
  assert.equal(eroded[20 * w + 50], 0, "the thin rule must not survive erosion");
  assert.equal(eroded[20 * w + 20], 1, "the block's interior must survive erosion");
});
