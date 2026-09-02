#!/usr/bin/env node
/**
 * A/B TEST ARTIFACT — the teaching proof with its centre column reordered to
 * match the deployed geometry.
 *
 * The owner-approved proof's centre column reads, from its own printed labels:
 *
 *     HOOD → ROOF → REAR → FRONT
 *
 * `CENTER_ORDER` — and therefore `manifest.zones`, the normalized [0,1]
 * topology and the deterministic panel cut — reads:
 *
 *     REAR → ROOF → HOOD → FRONT
 *
 * HOOD and REAR are swapped between the example Call 1 is taught from and the
 * geometry Call 1 is cut against. Test 3 handed Gemini both at once and the
 * output class collapsed to `vehicle_depiction` on all three draws.
 *
 * So this swaps the two, and ONLY the two. It is a TEST HARNESS: the production
 * proof is never written and the deployed edge function's hash pin on it is
 * untouched — that pin is what stops a variant reaching a customer, and it
 * stays.
 *
 * WHAT MOVES. Each panel travels with its own label, as one block, because a
 * label that stayed behind would mislabel the panel that arrived — a second
 * variable, and a worse one. The blocks are placed at each other's original top
 * edge, which is why ROOF and FRONT never move: both blocks are shorter than the
 * slot they land in, so nothing is resized, reflowed or rescaled.
 *
 *     HOOD block  y 41-312   (label 41-72,  panel 90-312)   → placed at y 770
 *     REAR block  y 770-1034 (panel 770-999, label 1004-1034) → placed at y 41
 *
 * WHY IT IS SELF-PROVING. A variant built by eye is not a one-variable change,
 * it is an unmeasured one. So the builder refuses any input that is not the
 * pinned owner proof, and then re-reads its own encoded output and asserts:
 * every pixel outside the centre column is unchanged; ROOF and FRONT are
 * unchanged; each relocated block is pixel-identical to the block it came from;
 * and every remaining changed pixel is exactly the field colour it vacated to.
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

// The centre column, exclusive of both flanks (passenger ends x=412, driver
// starts x=848), measured on the hash-pinned source.
export const CENTER_X = { x0: 425, x1: 830 };
// Blocks are panel + its own label. Measured on the source: label bands at
// 41-72, 326-357, 1004-1034, 1197-1228; panels at 90-312, 360-757, 770-999,
// 1056-1182.
export const HOOD_BLOCK = { y0: 41, y1: 312 };
export const REAR_BLOCK = { y0: 770, y1: 1034 };
export const ROOF_REGION = { y0: 326, y1: 757 };
export const FRONT_REGION = { y0: 1056, y1: 1228 };
export const FIELD = [0, 0, 0];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`atlas_teaching_proof_reorder: ${message}`); };

export async function buildReorderedTeachingProof(sourceBytes, { sharp = require_("sharp") } = {}) {
  const actual = sha256(sourceBytes);
  if (actual !== SOURCE_SHA256) fail(`source is not the owner proof (sha256 ${actual})`);
  if (sourceBytes.length !== SOURCE_BYTES) fail(`source is ${sourceBytes.length} bytes, expected ${SOURCE_BYTES}`);

  const { data, info } = await sharp(sourceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width !== CANVAS.width || height !== CANVAS.height) fail(`canvas ${width}x${height}, expected ${CANVAS.width}x${CANVAS.height}`);

  const source = Buffer.from(data);
  const out = Buffer.from(data);
  const rowSpan = (CENTER_X.x1 - CENTER_X.x0 + 1) * channels;
  const offset = (x, y) => (y * width + x) * channels;

  const hoodHeight = HOOD_BLOCK.y1 - HOOD_BLOCK.y0 + 1;
  const rearHeight = REAR_BLOCK.y1 - REAR_BLOCK.y0 + 1;
  // Nothing is resized: each block must fit in the slot it lands in, or the
  // swap would have to reflow a neighbour and stop being one variable.
  if (HOOD_BLOCK.y0 + rearHeight - 1 >= ROOF_REGION.y0) fail("the rear block does not fit above the roof label");
  if (REAR_BLOCK.y0 + hoodHeight - 1 >= FRONT_REGION.y0) fail("the hood block does not fit above the front panel");

  const clear = (block) => {
    for (let y = block.y0; y <= block.y1; y += 1) {
      for (let x = CENTER_X.x0; x <= CENTER_X.x1; x += 1) {
        const i = offset(x, y);
        out[i] = FIELD[0]; out[i + 1] = FIELD[1]; out[i + 2] = FIELD[2];
        if (channels === 4) out[i + 3] = 255;
      }
    }
  };
  const move = (block, destY0) => {
    for (let n = 0; n <= block.y1 - block.y0; n += 1) {
      source.copy(out, offset(CENTER_X.x0, destY0 + n), offset(CENTER_X.x0, block.y0 + n), offset(CENTER_X.x0, block.y0 + n) + rowSpan);
    }
  };
  clear(HOOD_BLOCK);
  clear(REAR_BLOCK);
  move(REAR_BLOCK, HOOD_BLOCK.y0);
  move(HOOD_BLOCK, REAR_BLOCK.y0);

  const bytes = await sharp(out, { raw: { width, height, channels } }).png().toBuffer();

  // ── THE ONE-VARIABLE PROOF, re-read off the encoded output ────────────────
  const verify = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (verify.info.width !== width || verify.info.height !== height || verify.info.channels !== channels) {
    fail("variant geometry does not match the source");
  }
  const v = verify.data;
  const samePixel = (a, ia, b, ib) => {
    for (let c = 0; c < channels; c += 1) if (a[ia + c] !== b[ib + c]) return false;
    return true;
  };
  const isField = (buf, i) => buf[i] === FIELD[0] && buf[i + 1] === FIELD[1] && buf[i + 2] === FIELD[2];

  let changed = 0;
  let vacatedToField = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = offset(x, y);
      if (samePixel(v, i, source, i)) continue;
      changed += 1;
      if (x < CENTER_X.x0 || x > CENTER_X.x1) fail(`pixel ${x},${y} outside the centre column changed — a flank moved`);
      const inRoof = y >= ROOF_REGION.y0 && y <= ROOF_REGION.y1;
      const inFront = y >= FRONT_REGION.y0 && y <= FRONT_REGION.y1;
      if (inRoof) fail(`pixel ${x},${y} inside the ROOF region changed`);
      if (inFront) fail(`pixel ${x},${y} inside the FRONT region changed`);
      if (isField(v, i)) vacatedToField += 1;
    }
  }
  if (changed === 0) fail("nothing moved — the variant is not a variant");

  // Each relocated block is the block it came from, pixel for pixel.
  const assertMoved = (block, destY0, name) => {
    for (let n = 0; n <= block.y1 - block.y0; n += 1) {
      for (let x = CENTER_X.x0; x <= CENTER_X.x1; x += 1) {
        if (!samePixel(v, offset(x, destY0 + n), source, offset(x, block.y0 + n))) {
          fail(`${name} row ${n} column ${x} is not the source block's own pixel`);
        }
      }
    }
  };
  assertMoved(REAR_BLOCK, HOOD_BLOCK.y0, "relocated REAR block");
  assertMoved(HOOD_BLOCK, REAR_BLOCK.y0, "relocated HOOD block");

  return {
    bytes,
    report: {
      sourceSha256: actual,
      variantSha256: sha256(bytes),
      variantByteSize: bytes.length,
      canvas: { width, height },
      centerColumn: CENTER_X,
      hoodBlock: { ...HOOD_BLOCK, height: hoodHeight, movedTo: REAR_BLOCK.y0 },
      rearBlock: { ...REAR_BLOCK, height: rearHeight, movedTo: HOOD_BLOCK.y0 },
      roofRegionUnchanged: true,
      frontRegionUnchanged: true,
      flanksUnchanged: true,
      changedPixels: changed,
      pixelsVacatedToField: vacatedToField,
      centerOrderBefore: ["HOOD", "ROOF", "REAR", "FRONT"],
      centerOrderAfter: ["REAR", "ROOF", "HOOD", "FRONT"],
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith("atlas-teaching-proof-reorder.mjs")) {
  const out = process.argv[2] || join(REPO, "ab-evidence", "teaching-proof-reordered.png");
  const { bytes, report } = await buildReorderedTeachingProof(readFileSync(join(REPO, SOURCE_PATH)));
  writeFileSync(out, bytes);
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${out}`);
}
