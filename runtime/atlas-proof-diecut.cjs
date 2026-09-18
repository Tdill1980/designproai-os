"use strict";
/**
 * runtime/atlas-proof-diecut.cjs — CONVICT A PANEL DRAWN AS A VEHICLE SHAPE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Live sheet 35389031759 (Cedar & Stone, 2019 Ford Transit) came back with the
 * windshield and side window CUT OUT of the driver and passenger panels in both
 * Zone 1 and Zone 2 — a picture of a van instead of the rectangle of vinyl that
 * gets laid onto one. That is the failure RULE 0.32 exists to name:
 *
 *   "A wheel opening, window, fender, door seam, glass area, light, handle or
 *    any other physical vehicle feature must NEVER become missing artwork
 *    inside the rectangular A.T.L.A.S. panel."
 *
 * and it is the model's most persistent prior — CLAUDE.md's own measurement is
 * 36 of 52 failures over three weeks, across five prompt versions that each
 * tried to talk it out of this and did not.
 *
 * SO THIS MEASURES IT INSTEAD OF ARGUING WITH IT.
 *
 * WHAT A HOLE IS, and it is NOT darkness. Every hole predicate in this
 * repository is a darkness test, and the output-class section records what that
 * cost: efca5e03 was die-cut on an rgb(88,88,88) surround and read 0.073
 * against a 0.35 limit, because the surround was luma 88 and the predicate only
 * convicts near-black. On a proof sheet the surround is the PAGE — white here,
 * grey on another run — so the page colour is MEASURED (its modal luma) and a
 * hole is page colour the artwork has closed around.
 *
 * "CLOSED AROUND" IS THE WHOLE TEST, and it is decided by a flood from the
 * band's own border. Page colour that can walk to the edge is the margin
 * between panels. Page colour that cannot is enclosed by artwork, which on a
 * full-bleed panel is impossible by construction.
 *
 * AND IT COUNTS SHAPES, NEVER AN AGGREGATE. This is RULE 0.15's lesson applied
 * unchanged: "Ink scattered as specks is design; ink concentrated in shapes is
 * a hole." The aggregate does not separate the two sheets — measured, zone 1:
 * 0.0074 enclosed on the good sheet against 0.0198 on the die-cut one, a ratio
 * of 2.7 that no honest threshold sits inside. The good sheet's 0.0074 is white
 * lettering counters and a white shirt in a photograph. Per COMPONENT it is not
 * close:
 *
 * | sheet                          | largest enclosed | components >= 0.0012 |
 * |--------------------------------|------------------|----------------------|
 * | 35387642102 zone 1 (correct)   | 0.0004           | 0                    |
 * | 35387642102 zone 2 (correct)   | 0.0001           | 0                    |
 * | 35389031759 zone 1 (die-cut)   | 0.0053           | 4                    |
 * | 35389031759 zone 2 (die-cut)   | 0.0153           | 4                    |
 *
 * Thirteen times between the largest legitimate speck and the smallest real
 * opening, and the count is 0 against 4 — the two windows on each flank, in
 * each of the two panel zones, which is exactly what a human sees on the sheet.
 *
 * ⚠️ TWO LIVE SHEETS ARE TWO LIVE SHEETS, NOT A LAW. The threshold sits three
 * times above the highest legitimate component ever measured and twice below
 * the lowest convicting one; that is the balance point of the evidence that
 * exists, and it is a small amount of evidence. A wrap whose design genuinely
 * encloses a large page-coloured shape — a white-filled logo counter, a
 * knocked-out headline block on a light ground — would convict here, and that
 * is a real false positive waiting to happen. It refuses a PROBE, not a
 * customer's generation, and it must not be promoted to a customer path on the
 * strength of these two rows. RULE 0.32 says this in as many words about the
 * detector that came before it: "Do not promote it without a new discriminator."
 */

/** Coarse width the band is measured at. Cheap, and a hole is never subtle. */
const COARSE_WIDTH = 1000;
/** How far from the page's own luma a pixel may sit and still BE the page. */
const PAGE_LUMA_TOLERANCE = 10;
/** ...and how little colour it may carry. Artwork at page brightness has hue. */
const PAGE_CHROMA_TOLERANCE = 14;
/**
 * The floor between a speck of design and an opening, as a fraction of the
 * band. See the table above: 0.0004 is the largest legitimate component
 * measured, 0.0025 the smallest convicting one.
 */
const MIN_HOLE_BAND_FRACTION = 0.0012;

/**
 * Measure one zone band of a returned proof.
 *
 * @param band {x,y,w,h} in FRACTIONS of the sheet — PROOF_REGIONS' own shape.
 * @returns {{pageLuma,holes,largestHoleFraction,enclosedFraction,dieCut}}
 */
async function detectDieCut({ proofBytes, band, sharp = require("sharp") }) {
  const meta = await sharp(proofBytes).metadata();
  const region = {
    left: Math.round(band.x * meta.width),
    top: Math.round(band.y * meta.height),
    width: Math.round(band.w * meta.width),
    height: Math.round(band.h * meta.height),
  };
  const { data, info } = await sharp(proofBytes)
    .extract(region).resize({ width: COARSE_WIDTH })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const area = width * height;

  // THE PAGE COLOUR IS MEASURED, NEVER ASSUMED. On a proof sheet the single
  // commonest tone is the paper the document is printed on.
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += channels) {
    histogram[Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])] += 1;
  }
  let pageLuma = 0;
  for (let l = 1; l < 256; l += 1) if (histogram[l] > histogram[pageLuma]) pageLuma = l;

  const isPage = new Uint8Array(area);
  for (let i = 0, p = 0; i < data.length; i += channels, p += 1) {
    const r = data[i];
    const g = data[i + 1] ?? r;
    const b = data[i + 2] ?? r;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (Math.abs(luma - pageLuma) <= PAGE_LUMA_TOLERANCE && chroma <= PAGE_CHROMA_TOLERANCE) {
      isPage[p] = 1;
    }
  }

  // FLOOD THE PAGE INWARD FROM THE BORDER. What it reaches is margin; what it
  // cannot reach is enclosed by artwork.
  const reached = new Uint8Array(area);
  const stack = new Int32Array(area);
  let top = 0;
  const seed = (p) => { if (isPage[p] && !reached[p]) { reached[p] = 1; stack[top] = p; top += 1; } };
  for (let x = 0; x < width; x += 1) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { seed(y * width); seed(y * width + width - 1); }
  while (top > 0) {
    top -= 1;
    const i = stack[top];
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) seed(i - 1);
    if (x + 1 < width) seed(i + 1);
    if (y > 0) seed(i - width);
    if (y + 1 < height) seed(i + width);
  }

  // LABEL WHAT IS LEFT, ONE SHAPE AT A TIME.
  const labelled = new Uint8Array(area);
  const holes = [];
  let enclosed = 0;
  for (let start = 0; start < area; start += 1) {
    if (!isPage[start] || reached[start] || labelled[start]) continue;
    let t = 0;
    stack[t] = start; t += 1; labelled[start] = 1;
    let size = 0;
    let minX = width; let maxX = -1; let minY = height; let maxY = -1;
    while (t > 0) {
      t -= 1;
      const i = stack[t];
      size += 1;
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const push = (n) => {
        if (n >= 0 && isPage[n] && !reached[n] && !labelled[n]) { labelled[n] = 1; stack[t] = n; t += 1; }
      };
      if (x > 0) push(i - 1);
      if (x + 1 < width) push(i + 1);
      if (y > 0) push(i - width);
      if (y + 1 < height) push(i + width);
    }
    enclosed += size;
    const fraction = size / area;
    if (fraction >= MIN_HOLE_BAND_FRACTION) {
      holes.push({
        bandFraction: Number(fraction.toFixed(4)),
        x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
      });
    }
  }
  holes.sort((a, b) => b.bandFraction - a.bandFraction);

  return {
    pageLuma,
    band: { width, height },
    holes,
    largestHoleFraction: holes.length ? holes[0].bandFraction : 0,
    // The aggregate is REPORTED and never judged on: it does not separate the
    // two live sheets, and recording it is what makes that checkable next time.
    enclosedFraction: Number((enclosed / area).toFixed(4)),
    dieCut: holes.length > 0,
  };
}

module.exports = {
  COARSE_WIDTH,
  PAGE_LUMA_TOLERANCE,
  PAGE_CHROMA_TOLERANCE,
  MIN_HOLE_BAND_FRACTION,
  detectDieCut,
};
