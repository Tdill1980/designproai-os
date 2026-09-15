#!/usr/bin/env node
/**
 * NORMALIZE A BEFORE/AFTER PAIR SO THE TWO PHOTOGRAPHS SIT IN REGISTER.
 *
 * Owner, 2026-09-15, looking at a gym pair whose bare-wall frame was 283x189
 * and whose finished frame was 518x282: "crop the blank one so its same height."
 *
 * WHY A SCRIPT AND NOT A HAND CROP. The band in WallProHeroProof wipes one
 * photograph across the other in a single fixed box, and both halves are
 * `object-cover` at the SAME object-position. That only lands the ceiling line,
 * the floor and the wall edges in the same place if the two sources share an
 * aspect ratio. Give it 1.50 and 1.84 and the room visibly jumps as the handle
 * crosses -- which reads as two different rooms, and the comparison collapses.
 *
 * So the rule is: a pair is normalized to ONE canvas before it ships, and the
 * component is left alone. Doing it in CSS instead would mean per-pair object
 * positions in the brand table -- a second place to get the geometry wrong,
 * tuned by eye, for every pair forever.
 *
 * The crop is `cover`: fill the canvas, crop the overflow, never letterbox and
 * never squash. A room photograph distorted to fit is worse than one cropped.
 *
 *   node scripts/wallpro-proof-normalize.mjs \
 *     --before ~/Desktop/gym-blank.jpg \
 *     --after  ~/Desktop/gym-wrapped.jpg \
 *     --slug   gym
 *
 * writes app/public/wallpro/proof-gym-before.jpg and proof-gym-after.jpg, both
 * 1600x1200, which is the size the spa pair already ships at.
 *
 * VERTICAL BIAS. `--bias top|center|bottom` (default center) picks which part
 * survives when a wide source is cropped to 4:3. A room shot with a lot of
 * ceiling wants `bottom`; one shot low wants `top`. Pass the SAME bias to both
 * halves -- that is the whole point -- which is why it is one flag, not two.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
// sharp lives in the runtime image's dependency tree, not at the repo root.
const sharp = require('../runtime/node_modules/sharp');

const DEFAULT_WIDTH = 1600;
const DEFAULT_HEIGHT = 1200;
const OUT_DIR = path.resolve(process.cwd(), 'app/public/wallpro');
const BIASES = { top: 'top', center: 'centre', centre: 'centre', bottom: 'bottom' };

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    out[key] = value;
    i += 1;
  }
  return out;
}

async function main() {
  const opts = args(process.argv.slice(2));
  for (const required of ['before', 'after', 'slug']) {
    if (!opts[required]) throw new Error(`Missing --${required}. See the header of this file for an example.`);
  }
  if (!/^[a-z0-9-]+$/.test(opts.slug)) throw new Error('--slug must be lowercase letters, digits and hyphens (it becomes a filename).');

  const width = Number(opts.width ?? DEFAULT_WIDTH);
  const height = Number(opts.height ?? DEFAULT_HEIGHT);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 240) {
    throw new Error('--width/--height must be whole pixels, at least 320x240.');
  }
  const position = BIASES[opts.bias ?? 'center'];
  if (!position) throw new Error(`--bias must be one of ${Object.keys(BIASES).join(', ')}`);

  await mkdir(OUT_DIR, { recursive: true });

  const results = [];
  for (const half of ['before', 'after']) {
    const source = path.resolve(opts[half]);
    const bytes = await readFile(source).catch(() => {
      throw new Error(`Could not read the ${half} image at ${source}. Copy it into the repository first -- a path on your own desktop is not visible from here.`);
    });
    const input = sharp(bytes);
    const meta = await input.metadata();
    // Reject an obviously unusable source loudly rather than shipping a soft
    // upscale: blowing a 283px-wide thumbnail up to 1600 produces mush, and
    // mush on the first thing a visitor sees is worse than no band at all.
    if (!meta.width || !meta.height) throw new Error(`The ${half} image is not a readable picture.`);
    if (meta.width < width * 0.6 || meta.height < height * 0.6) {
      throw new Error(
        `The ${half} image is ${meta.width}x${meta.height}, too small for a ${width}x${height} band -- that is a thumbnail, not the original. `
        + 'Send the full-size photograph (an emailed or pasted copy is often downscaled; the file off the camera or phone is not).',
      );
    }
    const out = await input
      .rotate() // honour the EXIF orientation before cropping, or a phone photo crops sideways
      .resize(width, height, { fit: 'cover', position })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
    const file = path.join(OUT_DIR, `proof-${opts.slug}-${half}.jpg`);
    await writeFile(file, out);
    results.push({ half, source, from: `${meta.width}x${meta.height}`, file, bytes: out.length });
  }

  for (const r of results) {
    console.log(`${r.half.padEnd(6)} ${r.from.padStart(11)} -> ${width}x${height}  ${path.relative(process.cwd(), r.file)}  ${(r.bytes / 1024).toFixed(0)} KB`);
  }
  console.log(`\nBoth halves are now ${width}x${height}, cropped ${position}, so the wipe holds register.`);
  console.log(`Add the pair to WALL_BRANDS.weprintwraps.proofs in app/src/lib/wallpro-brand.ts:\n`);
  console.log(`      {
        before: '/wallpro/proof-${opts.slug}-before.jpg',
        after: '/wallpro/proof-${opts.slug}-after.jpg',
        alt: 'DESCRIBE THE ROOM BARE AND WRAPPED',
        headline: 'SHORT LINE',
        caption: 'WHAT THIS ROOM IS. Drag to compare.',
      },`);
}

main().catch(error => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});
