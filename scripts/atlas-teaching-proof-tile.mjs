#!/usr/bin/env node
/**
 * A/B TEST ARTIFACT — the teaching proof with its six panels TILED edge to edge.
 *
 * Six isolated variables have now changed the field's colour, the guide, the
 * topology text, the centre order, one clause of the output contract and the
 * printed labels. Every one was null, and every draw of all six tests scored 0
 * compliant zones. What none of them touched is the example's MORPHOLOGY:
 *
 *   the owner proof shows six panels FLOATING IN A SEPARATION FIELD.
 *
 * That is precisely the defect the outputs reproduce — rectangles drawn smaller
 * than the region they were given, sitting in a field. The example demonstrates
 * "six panels placed on a sheet"; the contract wants "these six regions ARE the
 * printable artwork". This variant makes the example show the second thing.
 *
 * Each panel is scaled to its own share of the canvas so the six tile it
 * completely: flanks as full-height columns left and right, the four centre
 * panels stacked in their existing order at heights proportional to their
 * originals. No panel is cropped, reordered or recoloured — only scaled — and
 * afterwards NO field pixel remains anywhere.
 *
 * TWO THINGS CHANGE, AND THE SECOND IS ALREADY CLEARED. Tiling necessarily
 * removes the gutters, and the six technical labels live in the gutters. Test 6
 * (run 33589628761) measured label erasure on its own and found it null — arm B
 * still printed labels, including "A.T.L.A.S. ARTBOARD", a string that appears
 * nowhere in the image — so the leak is textual and label removal is a variable
 * with no measured effect. It rides along here as a known, quantified null
 * rather than as an unexamined confound.
 *
 * Harness only: the production proof is never written and its hash pin stands.
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

// Source panels, measured on the hash-pinned proof. `column` says where each
// one tiles to; the centre four keep the proof's own top-to-bottom order.
export const SOURCE_PANELS = [
  { key: "left-flank", x0: 86, y0: 92, x1: 412, y1: 1190, column: "left" },
  { key: "right-flank", x0: 848, y0: 98, x1: 1170, y1: 1190, column: "right" },
  { key: "centre-1", x0: 432, y0: 90, x1: 822, y1: 312, column: "centre", order: 1 },
  { key: "centre-2", x0: 432, y0: 360, x1: 822, y1: 757, column: "centre", order: 2 },
  { key: "centre-3", x0: 432, y0: 770, x1: 823, y1: 998, column: "centre", order: 3 },
  { key: "centre-4", x0: 432, y0: 1056, x1: 822, y1: 1182, column: "centre", order: 4 },
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`atlas_teaching_proof_tile: ${message}`); };
const spanW = (p) => p.x1 - p.x0 + 1;
const spanH = (p) => p.y1 - p.y0 + 1;

/**
 * Column widths in proportion to the source panels' own widths, so the tiled
 * example keeps the proof's left/centre/right balance rather than inventing one.
 */
export function tileLayout(width = CANVAS.width, height = CANVAS.height) {
  const left = SOURCE_PANELS.find((p) => p.column === "left");
  const right = SOURCE_PANELS.find((p) => p.column === "right");
  const centre = SOURCE_PANELS.filter((p) => p.column === "centre").sort((a, b) => a.order - b.order);
  const totalW = spanW(left) + spanW(right) + Math.max(...centre.map(spanW));
  const leftW = Math.round((spanW(left) / totalW) * width);
  const rightW = Math.round((spanW(right) / totalW) * width);
  const centreW = width - leftW - rightW;

  const totalH = centre.reduce((n, p) => n + spanH(p), 0);
  let y = 0;
  const rects = [
    { key: left.key, source: left, x: 0, y: 0, w: leftW, h: height },
    { key: right.key, source: right, x: leftW + centreW, y: 0, w: rightW, h: height },
  ];
  centre.forEach((p, i) => {
    // The last tile absorbs the rounding so the column closes exactly.
    const h = i === centre.length - 1 ? height - y : Math.round((spanH(p) / totalH) * height);
    rects.push({ key: p.key, source: p, x: leftW, y, w: centreW, h });
    y += h;
  });
  return rects;
}

export async function buildTiledTeachingProof(sourceBytes, { sharp = require_("sharp") } = {}) {
  const actual = sha256(sourceBytes);
  if (actual !== SOURCE_SHA256) fail(`source is not the owner proof (sha256 ${actual})`);
  if (sourceBytes.length !== SOURCE_BYTES) fail(`source is ${sourceBytes.length} bytes, expected ${SOURCE_BYTES}`);

  const meta = await sharp(sourceBytes).metadata();
  if (meta.width !== CANVAS.width || meta.height !== CANVAS.height) {
    fail(`canvas ${meta.width}x${meta.height}, expected ${CANVAS.width}x${CANVAS.height}`);
  }

  const rects = tileLayout();
  // The six tiles must partition the canvas exactly: no overlap, no remainder.
  const covered = new Uint8Array(CANVAS.width * CANVAS.height);
  for (const r of rects) {
    if (r.w < 1 || r.h < 1) fail(`${r.key} tiles to ${r.w}x${r.h}`);
    for (let y = r.y; y < r.y + r.h; y += 1) {
      for (let x = r.x; x < r.x + r.w; x += 1) {
        const i = y * CANVAS.width + x;
        if (covered[i]) fail(`${r.key} overlaps another tile at ${x},${y}`);
        covered[i] = 1;
      }
    }
  }
  const uncovered = covered.reduce((n, v) => n + (v ? 0 : 1), 0);
  if (uncovered !== 0) fail(`${uncovered} canvas pixels are not covered by any tile`);

  const tiles = [];
  for (const r of rects) {
    const panel = await sharp(sourceBytes)
      .extract({ left: r.source.x0, top: r.source.y0, width: spanW(r.source), height: spanH(r.source) })
      .resize(r.w, r.h, { fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();
    tiles.push({ input: panel, left: r.x, top: r.y, rect: r });
  }

  const bytes = await sharp({
    create: { width: CANVAS.width, height: CANVAS.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  }).composite(tiles.map(({ input, left, top }) => ({ input, left, top }))).png().toBuffer();

  // ── PROOF ─────────────────────────────────────────────────────────────────
  // 1. Each tile is exactly the resize of its own source panel.
  const verify = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = verify.info;
  if (width !== CANVAS.width || height !== CANVAS.height) fail("variant geometry does not match the canvas");
  for (const t of tiles) {
    const want = await sharp(t.input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < t.rect.h; y += 1) {
      for (let x = 0; x < t.rect.w; x += 1) {
        const a = ((t.rect.y + y) * width + (t.rect.x + x)) * channels;
        const b = (y * want.info.width + x) * want.info.channels;
        for (let c = 0; c < 3; c += 1) {
          if (verify.data[a + c] !== want.data[b + c]) {
            fail(`${t.rect.key} differs from its own scaled source at ${x},${y}`);
          }
        }
      }
    }
  }
  // 2. No separation field survives anywhere — that is the whole point.
  let fieldPixels = 0;
  for (let p = 0; p < width * height; p += 1) {
    const i = p * channels;
    if (verify.data[i] === FIELD[0] && verify.data[i + 1] === FIELD[1] && verify.data[i + 2] === FIELD[2]) fieldPixels += 1;
  }
  if (fieldPixels > width * height * 0.005) {
    fail(`${fieldPixels} pure-field pixels remain (${((100 * fieldPixels) / (width * height)).toFixed(2)}%) — the tiling left separation behind`);
  }

  return {
    bytes,
    report: {
      sourceSha256: actual,
      variantSha256: sha256(bytes),
      variantByteSize: bytes.length,
      canvas: CANVAS,
      tiles: rects.map((r) => ({
        key: r.key,
        from: { x: r.source.x0, y: r.source.y0, w: spanW(r.source), h: spanH(r.source) },
        to: { x: r.x, y: r.y, w: r.w, h: r.h },
      })),
      canvasFullyCovered: true,
      tilesOverlapping: 0,
      residualFieldPixels: fieldPixels,
      residualFieldShare: Number((fieldPixels / (width * height)).toFixed(5)),
      alsoRemoved: "the six technical labels, which live in the gutters — measured null on its own by test 6 (run 33589628761)",
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith("atlas-teaching-proof-tile.mjs")) {
  const out = process.argv[2] || join(REPO, "ab-evidence", "teaching-proof-tiled.png");
  const { bytes, report } = await buildTiledTeachingProof(readFileSync(join(REPO, SOURCE_PATH)));
  writeFileSync(out, bytes);
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${out}`);
}
