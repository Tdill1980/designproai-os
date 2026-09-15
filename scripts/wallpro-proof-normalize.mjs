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
 *
 * ALIGNMENT. A matching aspect ratio is not the same thing as a matching
 * FRAMING. WallPro's own room renders come back framed slightly wider or
 * tighter than the photograph they were made from, so the sofa and the curtain
 * rod sit a few percent off and the room still slides under the wipe. So an
 * `--after` can be registered against an already-shipped frame:
 *
 *   node scripts/wallpro-proof-normalize.mjs \
 *     --after ~/render.png --align-to app/public/wallpro/proof-spa-before.jpg \
 *     --slug studio-slat
 *
 * The search is a normalized cross-correlation over scale and offset, scored
 * ONLY on the bottom-centre band -- floor, sofa, curtains. That band is the
 * part a wall wrap does not change, so it is the one region where the two
 * frames should agree; scoring the whole frame would penalise exactly the
 * difference the band exists to show. The best score is printed: above ~0.75
 * the pair holds, below that look at the result before shipping it.
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

/**
 * Find the scale and offset that best registers `file` onto `referenceFile`.
 *
 * Both are reduced to one small greyscale grid, because this is looking for a
 * few percent of scale and a few percent of pan -- detail below that is noise
 * that slows the search without moving the answer.
 */
const GRID_W = 400, GRID_H = 300;
// Floor, sofa and curtains: the part of the frame a wall wrap does not change.
const MATCH = { x0: 72, x1: 328, y0: 165, y1: GRID_H };

async function greyGrid(file, w, h) {
  return sharp(file).rotate().resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer();
}

async function findAlignment(file, referenceFile) {
  const ref = await greyGrid(referenceFile, GRID_W, GRID_H);
  let best = null;
  for (let s = 0.85; s <= 1.4001; s += 0.01) {
    const w = Math.round(GRID_W * s), h = Math.round(GRID_H * s);
    const cand = await greyGrid(file, w, h);
    for (let dx = -(w - GRID_W); dx <= 0; dx += 1) {
      for (let dy = -(h - GRID_H); dy <= 0; dy += 1) {
        let n = 0, sa = 0, sb = 0;
        for (let y = MATCH.y0; y < MATCH.y1; y += 2) for (let x = MATCH.x0; x < MATCH.x1; x += 2) {
          sa += ref[y * GRID_W + x]; sb += cand[(y - dy) * w + (x - dx)]; n += 1;
        }
        const ma = sa / n, mb = sb / n;
        let num = 0, da = 0, db = 0;
        for (let y = MATCH.y0; y < MATCH.y1; y += 2) for (let x = MATCH.x0; x < MATCH.x1; x += 2) {
          const u = ref[y * GRID_W + x] - ma, v = cand[(y - dy) * w + (x - dx)] - mb;
          num += u * v; da += u * u; db += v * v;
        }
        const score = num / Math.sqrt(da * db || 1);
        if (!best || score > best.score) best = { score, scale: s, dx, dy, gridW: w };
      }
    }
  }
  if (!best) throw new Error('Alignment search found nothing — is --align-to a readable image?');
  return best;
}

async function main() {
  const opts = args(process.argv.slice(2));
  if (opts['align-to'] && !opts.before) opts.before = null; // aligning re-uses the reference as the before
  for (const required of opts['align-to'] ? ['after', 'slug'] : ['before', 'after', 'slug']) {
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

  // Aligning registers ONE new frame onto a reference that already ships, so
  // the reference stays the `before` and only the `after` is written.
  let alignment = null;
  if (opts['align-to']) {
    const reference = path.resolve(opts['align-to']);
    process.stdout.write(`Registering against ${path.relative(process.cwd(), reference)} … `);
    alignment = await findAlignment(path.resolve(opts.after), reference);
    console.log(`best ${alignment.score.toFixed(3)} at ${Math.round(alignment.scale * 100)}% scale`);
    if (alignment.score < 0.6) {
      throw new Error(
        `The best register is only ${alignment.score.toFixed(3)} — these two frames are not the same camera position. `
        + 'A before/after wipe needs one camera; two angles read as two rooms.',
      );
    }
    if (alignment.score < 0.75) {
      console.warn(`  WARNING: ${alignment.score.toFixed(3)} is a loose register. Look at the result before shipping it.`);
    }
  }

  const results = [];
  for (const half of alignment ? ['after'] : ['before', 'after']) {
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
    // .rotate() honours the EXIF orientation before cropping, or a phone photo
    // crops sideways.
    let pipeline = input.rotate();
    if (alignment) {
      // The search worked on a GRID_W-wide grid of the candidate scaled to
      // `gridW`; map that window back to the source's own pixels.
      const f = meta.width / alignment.gridW;
      pipeline = pipeline.extract({
        left: Math.round(-alignment.dx * f),
        top: Math.round(-alignment.dy * f),
        width: Math.round(GRID_W * f),
        height: Math.round(GRID_H * f),
      }).resize(width, height, { fit: 'fill' });
    } else {
      pipeline = pipeline.resize(width, height, { fit: 'cover', position });
    }
    const out = await pipeline.jpeg({ quality: 86, mozjpeg: true }).toBuffer();
    const file = path.join(OUT_DIR, `proof-${opts.slug}-${half}.jpg`);
    await writeFile(file, out);
    results.push({ half, source, from: `${meta.width}x${meta.height}`, file, bytes: out.length });
  }

  for (const r of results) {
    console.log(`${r.half.padEnd(6)} ${r.from.padStart(11)} -> ${width}x${height}  ${path.relative(process.cwd(), r.file)}  ${(r.bytes / 1024).toFixed(0)} KB`);
  }
  const beforePath = alignment
    ? `/${path.relative(path.resolve(process.cwd(), 'app/public'), path.resolve(opts['align-to'])).split(path.sep).join('/')}`
    : `/wallpro/proof-${opts.slug}-before.jpg`;
  console.log(alignment
    ? `\nRegistered onto the reference at ${width}x${height}, so the wipe holds.`
    : `\nBoth halves are now ${width}x${height}, cropped ${position}, so the wipe holds register.`);
  console.log(`Add the pair to WALL_BRANDS.weprintwraps.proofs in app/src/lib/wallpro-brand.ts:\n`);
  console.log(`      {
        before: '${beforePath}',
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
