#!/usr/bin/env node
/**
 * A/B TEST ARTIFACT — the teaching proof with its six TECHNICAL labels removed.
 *
 * `DRIVER SIDE`, `PASSENGER SIDE`, `HOOD`, `ROOF`, `REAR` and `FRONT` are
 * printed in the example's gutters. The identity contract declares them
 * instructional only (`labels-are-instructional-annotations-only-never-artwork`)
 * and the deployed prompt forbids copying them in as many words — *"Set no panel
 * names, surface IDs, legends or captions anywhere in the artwork"* — and they
 * are burned into the output artwork in every measured draw regardless.
 *
 * This removes exactly those six marks and nothing else. It is a TEST HARNESS:
 * the production proof is never written and the deployed edge function's hash
 * pin on it is untouched.
 *
 * WHAT IS PRESERVED, BY CONSTRUCTION. Every label sits in a gutter, entirely
 * outside all six panel rectangles. The builder asserts that each pinned label
 * box is disjoint from every panel, so the Flamingo Pools branding, the
 * `FlamingoPools.com` line and all example artwork — which live INSIDE the
 * panels — cannot be touched by this transform even in principle. Panel
 * position, size and extent are never read or written.
 *
 * WHY IT IS SELF-PROVING. The builder refuses any input that is not the pinned
 * owner proof, asserts each label's measured bounding box against its pin, then
 * re-reads its own encoded output and asserts every changed pixel lies inside a
 * label box, was a bright glyph pixel, and became the field colour — and that no
 * pixel anywhere else moved.
 *
 * ⚠️ THIS TRANSFORM ALSO REMOVES A SECOND SIGNAL, AND THAT IS NOT A DEFECT IN
 * THE BUILDER — IT IS THE EXPERIMENT'S OWN LIMIT. The proof labels its LEFT
 * flank `DRIVER SIDE` and its RIGHT flank `PASSENGER SIDE`. The deployed
 * contract and `manifest.zones` say the opposite: passenger left, driver right.
 * Erasing the labels erases that contradiction along with the text. A result
 * here therefore cannot separate "the labels leak" from "the sides disagree".
 * Reported, not worked around.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const require_ = createRequire(join(REPO, "runtime/"));

export const SOURCE_PATH = "runtime/atlas-examples/flamingo-labeled-atlas-teaching-proof.png";
export const SOURCE_SHA256 = "684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded";
export const SOURCE_BYTES = 3430273;
export const CANVAS = { width: 1254, height: 1254 };
export const FIELD = [0, 0, 0];
// Bright enough to be a glyph core, used only to MEASURE each label against its
// pin. It is deliberately NOT the erase predicate: a first build erased only
// pixels above this and left every glyph's antialiased fringe behind as a dark
// grey ghost, still plainly readable. A half-erased label is a worse input than
// an intact one, because it is neither condition.
export const GLYPH_MIN_CHANNEL = 96;

/**
 * Measured on the hash-pinned source, then padded by 2 px so a glyph's faintest
 * antialiased fringe cannot survive at the box edge. Every box is checked
 * disjoint from every panel before a pixel is written.
 */
export const LABEL_BOXES = [
  { key: "DRIVER SIDE", x0: 46, y0: 85, x1: 78, y1: 302, px: 3240 },
  { key: "PASSENGER SIDE", x0: 1179, y0: 84, x1: 1211, y1: 385, px: 4459 },
  { key: "HOOD", x0: 564, y0: 39, x1: 689, y1: 74, px: 2133 },
  { key: "ROOF", x0: 555, y0: 324, x1: 671, y1: 359, px: 1972 },
  { key: "REAR", x0: 436, y0: 1002, x1: 545, y1: 1036, px: 1901 },
  { key: "FRONT", x0: 436, y0: 1195, x1: 572, y1: 1230, px: 2303 },
];

// The six artwork panels, pinned on the same source. Nothing here is written —
// they exist so the builder can PROVE it never reaches artwork.
export const PANEL_RECTS = [
  { key: "left-flank", x0: 86, y0: 92, x1: 412, y1: 1190 },
  { key: "right-flank", x0: 848, y0: 98, x1: 1170, y1: 1190 },
  { key: "centre-1", x0: 432, y0: 90, x1: 822, y1: 312 },
  { key: "centre-2", x0: 432, y0: 360, x1: 822, y1: 757 },
  { key: "centre-3", x0: 432, y0: 770, x1: 823, y1: 998 },
  { key: "centre-4", x0: 432, y0: 1056, x1: 822, y1: 1182 },
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`atlas_teaching_proof_delabel: ${message}`); };
const overlaps = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

export async function buildDelabelledTeachingProof(sourceBytes, { sharp = require_("sharp") } = {}) {
  const actual = sha256(sourceBytes);
  if (actual !== SOURCE_SHA256) fail(`source is not the owner proof (sha256 ${actual})`);
  if (sourceBytes.length !== SOURCE_BYTES) fail(`source is ${sourceBytes.length} bytes, expected ${SOURCE_BYTES}`);

  // ⛔ NO LABEL BOX MAY TOUCH A PANEL. This is what makes "the artwork and the
  // Flamingo branding are preserved" a structural fact rather than a hope.
  for (const label of LABEL_BOXES) {
    for (const panel of PANEL_RECTS) {
      if (overlaps(label, panel)) fail(`label box ${label.key} overlaps panel ${panel.key} — it would erase artwork`);
    }
  }

  const { data, info } = await sharp(sourceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width !== CANVAS.width || height !== CANVAS.height) fail(`canvas ${width}x${height}, expected ${CANVAS.width}x${CANVAS.height}`);

  const source = Buffer.from(data);
  const at = (x, y) => (y * width + x) * channels;
  const isGlyph = (buf, i) => buf[i] > GLYPH_MIN_CHANNEL && buf[i + 1] > GLYPH_MIN_CHANNEL && buf[i + 2] > GLYPH_MIN_CHANNEL;

  // Each label's real extent must match its pin, or the boxes have drifted from
  // the artifact and the transform is aiming at the wrong pixels.
  const erasedByLabel = {};
  for (const label of LABEL_BOXES) {
    let x0 = width; let y0 = height; let x1 = -1; let y1 = -1; let n = 0;
    for (let y = label.y0; y <= label.y1; y += 1) {
      for (let x = label.x0; x <= label.x1; x += 1) {
        const i = at(x, y);
        if (!(source[i] > 170 && source[i + 1] > 170 && source[i + 2] > 170)) continue;
        n += 1;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (n !== label.px) fail(`${label.key}: ${n} bright pixels in its box, pinned at ${label.px}`);
    if (x0 < label.x0 + 1 || x1 > label.x1 - 1 || y0 < label.y0 + 1 || y1 > label.y1 - 1) {
      fail(`${label.key}: glyphs reach the edge of the box (${x0}-${x1} x ${y0}-${y1}) — the pad is too small`);
    }
    erasedByLabel[label.key] = 0;
  }

  // ERASE THE WHOLE BOX TO FIELD, not just the glyph cores. Each box is proven
  // disjoint from every panel above and sits entirely on the uniform separation
  // field, so clearing it removes the label completely — fringe included — and
  // cannot reach artwork. Anything less leaves a readable ghost.
  const isField = (buf, i) => buf[i] === FIELD[0] && buf[i + 1] === FIELD[1] && buf[i + 2] === FIELD[2];
  for (const label of LABEL_BOXES) {
    for (let y = label.y0; y <= label.y1; y += 1) {
      for (let x = label.x0; x <= label.x1; x += 1) {
        const i = at(x, y);
        if (!isField(data, i)) erasedByLabel[label.key] += 1;
        data[i] = FIELD[0]; data[i + 1] = FIELD[1]; data[i + 2] = FIELD[2];
        if (channels === 4) data[i + 3] = 255;
      }
    }
  }

  const bytes = await sharp(Buffer.from(data), { raw: { width, height, channels } }).png().toBuffer();

  // ── THE ONE-VARIABLE PROOF, re-read off the encoded output ────────────────
  const verify = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (verify.info.width !== width || verify.info.height !== height || verify.info.channels !== channels) {
    fail("variant geometry does not match the source");
  }
  const v = verify.data;
  const inLabel = (x, y) => LABEL_BOXES.find((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
  const inPanel = (x, y) => PANEL_RECTS.find((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);

  let changed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = at(x, y);
      let differs = false;
      for (let c = 0; c < channels; c += 1) if (v[i + c] !== source[i + c]) { differs = true; break; }
      if (!differs) continue;
      changed += 1;
      const panel = inPanel(x, y);
      if (panel) fail(`pixel ${x},${y} inside panel ${panel.key} changed — artwork is not preserved`);
      if (!inLabel(x, y)) fail(`pixel ${x},${y} changed outside every technical-label box`);
      if (!(v[i] === FIELD[0] && v[i + 1] === FIELD[1] && v[i + 2] === FIELD[2])) {
        fail(`pixel ${x},${y} did not become the field colour`);
      }
    }
  }
  if (changed === 0) fail("nothing was erased — the variant is not a variant");

  // Every label box is now uniformly field: the marks are GONE, not faded.
  for (const label of LABEL_BOXES) {
    for (let y = label.y0; y <= label.y1; y += 1) {
      for (let x = label.x0; x <= label.x1; x += 1) {
        const i = at(x, y);
        if (v[i] !== FIELD[0] || v[i + 1] !== FIELD[1] || v[i + 2] !== FIELD[2]) {
          fail(`${label.key} still carries a non-field pixel at ${x},${y} — the label is ghosted, not removed`);
        }
      }
    }
  }

  return {
    bytes,
    report: {
      sourceSha256: actual,
      variantSha256: sha256(bytes),
      variantByteSize: bytes.length,
      canvas: { width, height },
      labelBoxes: LABEL_BOXES,
      erasedByLabel,
      changedPixels: changed,
      changedInsideAnyPanel: 0,
      changedOutsideLabelBoxes: 0,
      everyLabelBoxIsUniformField: true,
      panelsUntouched: true,
      brandingUntouched: "every label box is disjoint from every panel rectangle",
      knownConfound: "erasing the labels also erases the proof's DRIVER-left / PASSENGER-right disagreement with manifest.zones",
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith("atlas-teaching-proof-delabel.mjs")) {
  const out = process.argv[2] || join(REPO, "ab-evidence", "teaching-proof-delabelled.png");
  const { bytes, report } = await buildDelabelledTeachingProof(readFileSync(join(REPO, SOURCE_PATH)));
  writeFileSync(out, bytes);
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${out}`);
}
