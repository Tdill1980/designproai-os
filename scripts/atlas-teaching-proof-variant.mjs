#!/usr/bin/env node
/**
 * A/B TEST ARTIFACT — the neutral-field copy of the labeled Flamingo
 * A.T.L.A.S. teaching proof.
 *
 * The owner's Test 1 changes ONE variable: the black separation/background
 * field surrounding the six panels becomes a neutral non-black field. Every
 * artwork pixel inside every panel, every label glyph and every relative
 * placement stays exactly as it is.
 *
 * This is a TEST HARNESS. It never writes the production proof
 * (`runtime/atlas-examples/flamingo-labeled-atlas-teaching-proof.png`) and the
 * deployed edge function's hash pin is untouched — that pin is what stops a
 * variant reaching a customer, and it stays.
 *
 * WHY THE TRANSFORM IS SELF-PROVING. A variant built by eye is not a
 * one-variable change, it is an unmeasured one. So the builder:
 *   1. refuses any input whose sha256 is not the pinned owner proof;
 *   2. derives the six panel rectangles from the image itself, then asserts
 *      them against the pinned rectangles — a silent detection change fails
 *      the run instead of quietly moving a boundary;
 *   3. recolours ONLY pixels that are near-black AND outside every rectangle;
 *   4. re-reads its own output and asserts every pixel inside every rectangle
 *      is byte-identical to the source, and that every changed pixel was
 *      near-black in the source.
 *
 * Assertion 4 is the experiment's validity. Without it "we changed one thing"
 * is a claim; with it, it is a measurement.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// sharp lives in the runtime workspace (and in the deployed runtime image at
// /app/node_modules); nothing installs a root copy.
const require_ = createRequire(join(REPO, "runtime/"));

export const SOURCE_PATH = "runtime/atlas-examples/flamingo-labeled-atlas-teaching-proof.png";
export const SOURCE_SHA256 = "684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded";
export const SOURCE_BYTES = 3430273;
export const CANVAS = { width: 1254, height: 1254 };

// The near-black predicate is the QC gate's own FLAT_BLACK_CHANNEL_MAX, so the
// field this replaces is the same ink the detector convicts inside a master.
export const DARK_MAX = 40;
export const NEUTRAL = [128, 128, 128];

// Pinned for the hash-pinned source above. Derived, then asserted — see the
// header. Inclusive pixel bounds.
export const PANEL_RECTS = [
  { key: "driver", x0: 86, y0: 92, x1: 412, y1: 1190 },
  { key: "passenger", x0: 848, y0: 98, x1: 1170, y1: 1190 },
  { key: "roof", x0: 432, y0: 360, x1: 822, y1: 757 },
  { key: "rear", x0: 432, y0: 770, x1: 823, y1: 998 },
  { key: "hood", x0: 432, y0: 90, x1: 822, y1: 312 },
  { key: "front", x0: 432, y0: 1056, x1: 822, y1: 1182 },
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => {
  throw new Error(`atlas_teaching_proof_variant: ${message}`);
};

/**
 * Connected components of NON-dark pixels on a stride-2 grid, kept when they
 * cover >1% of the canvas, then trimmed inward past any row/column that is
 * overwhelmingly dark.
 *
 * The trim is load-bearing, not tidiness. A label's white glyphs merge into the
 * panel component and drag its bounding box out over the separation band behind
 * it. On the first build that happened to ROOF, which would have left a black
 * band beside the ONE surface that comes back with zero defect — a confound
 * planted in the control surface of the experiment.
 */
export function detectPanelRects(data, width, height, channels) {
  const dark = (i) => data[i] < DARK_MAX && data[i + 1] < DARK_MAX && data[i + 2] < DARK_MAX;
  const S = 2;
  const gw = Math.ceil(width / S);
  const gh = Math.ceil(height / S);
  const bright = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      bright[gy * gw + gx] = dark((gy * S * width + gx * S) * channels) ? 0 : 1;
    }
  }
  const seen = new Uint8Array(gw * gh);
  const boxes = [];
  for (let s = 0; s < gw * gh; s += 1) {
    if (!bright[s] || seen[s]) continue;
    let x0 = gw; let y0 = gh; let x1 = -1; let y1 = -1; let n = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop();
      const px = p % gw;
      const py = (p / gw) | 0;
      n += 1;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const q = ny * gw + nx;
        if (bright[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (n > gw * gh * 0.01) boxes.push({ x0: x0 * S, y0: y0 * S, x1: x1 * S, y1: y1 * S, area: n });
  }
  boxes.sort((a, b) => b.area - a.area);

  const rowDark = (b, y) => {
    let d = 0; let n = 0;
    for (let x = b.x0; x <= b.x1; x += 1) { n += 1; if (dark((y * width + x) * channels)) d += 1; }
    return d / n;
  };
  const colDark = (b, x) => {
    let d = 0; let n = 0;
    for (let y = b.y0; y <= b.y1; y += 1) { n += 1; if (dark((y * width + x) * channels)) d += 1; }
    return d / n;
  };
  return boxes.slice(0, 6).map((b) => {
    const t = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
    while (t.y0 < t.y1 && rowDark(t, t.y0) > 0.70) t.y0 += 1;
    while (t.y1 > t.y0 && rowDark(t, t.y1) > 0.70) t.y1 -= 1;
    while (t.x0 < t.x1 && colDark(t, t.x0) > 0.70) t.x0 += 1;
    while (t.x1 > t.x0 && colDark(t, t.x1) > 0.70) t.x1 -= 1;
    return t;
  });
}

export async function buildNeutralFieldVariant(sourceBytes, { sharp = require_("sharp") } = {}) {
  const actual = sha256(sourceBytes);
  if (actual !== SOURCE_SHA256) fail(`source is not the owner proof (sha256 ${actual})`);
  if (sourceBytes.length !== SOURCE_BYTES) fail(`source is ${sourceBytes.length} bytes, expected ${SOURCE_BYTES}`);

  const { data, info } = await sharp(sourceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width !== CANVAS.width || height !== CANVAS.height) fail(`canvas ${width}x${height}, expected ${CANVAS.width}x${CANVAS.height}`);

  const detected = detectPanelRects(data, width, height, channels);
  if (detected.length !== 6) fail(`detected ${detected.length} panel rectangles, expected 6`);
  const asKey = (r) => `${r.x0},${r.y0},${r.x1},${r.y1}`;
  const detectedKeys = detected.map(asKey).sort();
  const pinnedKeys = PANEL_RECTS.map(asKey).sort();
  if (detectedKeys.join(" | ") !== pinnedKeys.join(" | ")) {
    fail(`detected rectangles drifted from the pin\n  detected: ${detectedKeys.join("  ")}\n  pinned:   ${pinnedKeys.join("  ")}`);
  }

  const source = Buffer.from(data);
  const inPanel = (x, y) => PANEL_RECTS.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
  const isDark = (buf, i) => buf[i] < DARK_MAX && buf[i + 1] < DARK_MAX && buf[i + 2] < DARK_MAX;

  let recoloured = 0;
  let darkInsidePanels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      if (!isDark(source, i)) continue;
      if (inPanel(x, y)) { darkInsidePanels += 1; continue; }
      data[i] = NEUTRAL[0];
      data[i + 1] = NEUTRAL[1];
      data[i + 2] = NEUTRAL[2];
      recoloured += 1;
    }
  }
  if (recoloured === 0) fail("no background pixel changed — the variant is not a variant");

  const bytes = await sharp(Buffer.from(data), { raw: { width, height, channels } }).png().toBuffer();

  // ── THE ONE-VARIABLE PROOF ────────────────────────────────────────────────
  // Re-read the encoded output rather than trusting the buffer we just wrote,
  // so a PNG round-trip that quantised a pixel cannot pass unnoticed.
  const verify = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (verify.info.width !== width || verify.info.height !== height || verify.info.channels !== channels) {
    fail("variant geometry does not match the source");
  }
  let changedPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      let differs = false;
      for (let c = 0; c < channels; c += 1) if (verify.data[i + c] !== source[i + c]) { differs = true; break; }
      if (!differs) continue;
      changedPixels += 1;
      if (inPanel(x, y)) fail(`pixel ${x},${y} inside a panel rectangle changed — artwork is not preserved`);
      if (!isDark(source, i)) fail(`pixel ${x},${y} was not near-black in the source but changed`);
    }
  }
  if (changedPixels !== recoloured) fail(`expected ${recoloured} changed pixels, verified ${changedPixels}`);

  return {
    bytes,
    report: {
      sourceSha256: actual,
      variantSha256: sha256(bytes),
      variantByteSize: bytes.length,
      canvas: { width, height },
      panelRects: PANEL_RECTS,
      recolouredPixels: recoloured,
      recolouredShareOfCanvas: Number((recoloured / (width * height)).toFixed(6)),
      darkPixelsPreservedInsidePanels: darkInsidePanels,
      neutral: NEUTRAL,
      darkMax: DARK_MAX,
      changedPixelsVerified: changedPixels,
      changedInsidePanels: 0,
      changedThatWereNotNearBlack: 0,
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith("atlas-teaching-proof-variant.mjs")) {
  const out = process.argv[2] || join(REPO, "ab-evidence", "teaching-proof-neutral-field.png");
  const src = readFileSync(join(REPO, SOURCE_PATH));
  const { bytes, report } = await buildNeutralFieldVariant(src);
  writeFileSync(out, bytes);
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${out}`);
}
