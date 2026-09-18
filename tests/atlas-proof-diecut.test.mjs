/**
 * A PANEL DRAWN AS A PICTURE OF THE VEHICLE IS CONVICTED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Live sheet 35389031759 came back with the windshield and side window cut out
 * of the driver and passenger panels, in both panel zones. RULE 0.32 names that
 * exactly — "the entire rectangular region is printable artwork" — and it is
 * the model's most persistent prior: 36 of 52 failures across five prompt
 * versions that each tried to talk it out of this.
 *
 * TWO DISCRIMINATORS WERE MEASURED AND ONE WAS THROWN AWAY. Bounding-box fill
 * looked obvious and does not work: the correct sheet's panels scored a minimum
 * of 0.677 and the die-cut sheet's 0.684, overlapping, with the die-cut sheet
 * holding the two HIGHEST values on either sheet. It is recorded here because a
 * later session will have the same idea.
 *
 * What does work is enclosure, per shape. The fixtures below are synthetic
 * because the real sheets are 6.4 MB each, and they reproduce the two cases the
 * live measurement separated — a solid rectangle, and one with a window-shaped
 * piece of page colour inside it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const { detectDieCut, MIN_HOLE_BAND_FRACTION } = require("../runtime/atlas-proof-diecut.cjs");

const W = 1600;
const H = 280;
/** The whole fixture IS the band, so the band covers the whole sheet. */
const BAND = { x: 0, y: 0, w: 1, h: 1 };

/**
 * A panel zone: page ground, six solid artwork rectangles, optional openings.
 *
 * @param holes  rectangles of PAGE COLOUR painted inside a panel.
 * @param specks tiny enclosed page-coloured marks — white lettering counters
 *               and the highlights in a photograph, which the good live sheet
 *               carries 399 of and which must never convict.
 */
async function band({ page = "#ffffff", holes = [], specks = 0 } = {}) {
  const panels = [];
  for (let i = 0; i < 6; i += 1) {
    const x = 40 + i * 255;
    panels.push(`<rect x="${x}" y="60" width="215" height="160" fill="#1f6b3a"/>`);
  }
  const cut = holes.map(({ panel, x, y, w, h }) =>
    `<rect x="${40 + panel * 255 + x}" y="${60 + y}" width="${w}" height="${h}" fill="${page}"/>`).join("");
  let dots = "";
  for (let i = 0; i < specks; i += 1) {
    dots += `<rect x="${60 + (i % 40) * 30}" y="${80 + Math.floor(i / 40) * 12}" `
      + `width="6" height="6" fill="${page}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
    + `<rect width="100%" height="100%" fill="${page}"/>${panels.join("")}${cut}${dots}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test("six solid rectangles are clean", async () => {
  const verdict = await detectDieCut({ proofBytes: await band(), band: BAND, sharp });
  assert.equal(verdict.dieCut, false);
  assert.equal(verdict.holes.length, 0);
  assert.equal(verdict.largestHoleFraction, 0);
});

test("a window cut out of a panel convicts, and says where", async () => {
  // The two flanks, each with a windshield-shaped opening — the live shape.
  const proofBytes = await band({ holes: [
    { panel: 0, x: 130, y: 10, w: 70, h: 55 },
    { panel: 1, x: 15, y: 10, w: 70, h: 55 },
  ] });
  const verdict = await detectDieCut({ proofBytes, band: BAND, sharp });
  assert.equal(verdict.dieCut, true);
  assert.equal(verdict.holes.length, 2, "both flanks must be named, not just the first");
  assert.ok(verdict.largestHoleFraction >= MIN_HOLE_BAND_FRACTION);
  // Two openings of the same size, so the boxes must be comparable — a detector
  // that found one and merged the other would still report dieCut: true and be
  // useless for saying what is wrong.
  const [a, b] = verdict.holes;
  assert.ok(Math.abs(a.w - b.w) <= 2 && Math.abs(a.h - b.h) <= 2);
});

test("white lettering counters are design, not holes — RULE 0.15's own rule", async () => {
  // The correct live sheet carried 399 enclosed page-coloured components and
  // zero convicting ones; its largest was 0.0004 of the band. An AGGREGATE
  // measure convicts this fixture, which is why the aggregate is reported and
  // never judged on.
  const proofBytes = await band({ specks: 400 });
  const verdict = await detectDieCut({ proofBytes, band: BAND, sharp });
  assert.equal(verdict.dieCut, false, "400 specks of white must not read as a die-cut panel");
  assert.ok(verdict.enclosedFraction > 0, "they are still counted, just not convicted");
});

test("a hole is page colour, not darkness — the efca5e03 correction", async () => {
  // Every other hole predicate in this repo is a darkness test, and efca5e03
  // was die-cut on an rgb(88,88,88) surround: edgeHoleRatio read 0.073 against
  // a 0.35 limit because the surround was luma 88. The page here is mid-grey
  // and the opening is the same mid-grey; a darkness test sees nothing.
  const proofBytes = await band({ page: "#585858", holes: [{ panel: 2, x: 60, y: 30, w: 80, h: 70 }] });
  const verdict = await detectDieCut({ proofBytes, band: BAND, sharp });
  assert.equal(verdict.pageLuma, 88, "the page colour must be measured, never assumed white");
  assert.equal(verdict.dieCut, true);
});

test("an opening that reaches the panel's edge is a margin, not a hole", async () => {
  // Enclosure is the whole test. A page-coloured region touching the outside is
  // the gap between panels, and a detector that counted it would convict every
  // correct sheet ever produced.
  const proofBytes = await band({ holes: [{ panel: 3, x: 150, y: 0, w: 65, h: 60 }] });
  const verdict = await detectDieCut({ proofBytes, band: BAND, sharp });
  assert.equal(verdict.dieCut, false);
});

test("the threshold sits between the two live sheets it was measured on", () => {
  // 0.0004 is the largest legitimate enclosed component measured on
  // 35387642102; 0.0025 the smallest convicting one on 35389031759. A change
  // that moves the floor outside that band is a change that either stops
  // catching the defect or starts convicting lettering.
  assert.ok(MIN_HOLE_BAND_FRACTION > 0.0004,
    "below this, white lettering counters on a correct sheet convict");
  assert.ok(MIN_HOLE_BAND_FRACTION < 0.0025,
    "above this, the live die-cut windows stop being caught");
});

test("the probe runs the gate on the returned pixels and ships it to the droplet", async () => {
  const { readFileSync } = await import("node:fs");
  const probe = readFileSync(new URL("../scripts/atlas-panel-proof-probe.mjs", import.meta.url), "utf8");
  assert.match(probe, /detectDieCut\(\{ proofBytes: bytes, band: PROOF_REGIONS\[zone\] \}\)/,
    "the gate must run on the bytes that were actually returned and hash-verified");
  assert.match(probe, /DIE-CUT PANELS/, "a convicted sheet must say so loudly");
  assert.match(probe, /diecut\.json/, "the verdict must be exported beside the sheet");

  // AND THE MODULE MUST REACH THE DROPLET. The probe runs inside the runtime
  // image from a payload tar; a module the tar does not carry cannot run, and
  // the pinned format sheet's first live run died on exactly that.
  const workflow = readFileSync(
    new URL("../.github/workflows/atlas-panel-proof-probe.yml", import.meta.url), "utf8");
  for (const file of ["runtime/atlas-proof-diecut.cjs", "runtime/atlas-panel-proof-contract.cjs"]) {
    assert.ok(workflow.includes(file), `the probe workflow does not ship ${file} to the droplet`);
  }
});
