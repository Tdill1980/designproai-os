// Reproducible diagnostic files from the same exporter used by the browser.
// Usage: node scripts/verify-wallpro-print.mjs /absolute/output/directory
import { build } from 'esbuild';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = resolve(process.argv[2] || '../wallpro-print-verification');
const cache = resolve('node_modules/.cache/wallpro-verification');
await mkdir(cache, { recursive: true }); await mkdir(output, { recursive: true });
const bundle = resolve(cache, 'export.mjs');
await build({ entryPoints: ['src/lib/wallpro-print-export.ts'], bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: bundle });
const { buildWallPrintPack } = await import(pathToFileURL(bundle).href);
async function source(width, height) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    raw[i] = Math.floor(x * 255 / (width - 1)); raw[i + 1] = Math.floor(y * 255 / (height - 1)); raw[i + 2] = ((Math.floor(x / (width / 6)) + Math.floor(y / (height / 4))) % 2) ? 220 : 25;
  }
  return { bytes: new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer()), width, height };
}
const tile = await source(600, 400);
const mural = await source(1200, 800);
const jobs = [
  { key: 'repeat', name: 'WallPro overlap diagnostic', layout: { width: 120, height: 75, mode: 'repeat', repeatWidth: 4 }, settings: { bleed: 1, overlap: .5, minPpi: 150 }, source: tile },
  { key: 'mural', name: 'WallPro mirror bleed diagnostic', layout: { width: 12, height: 8, mode: 'cover', repeatWidth: 4 }, settings: { bleed: 1, overlap: .5, minPpi: 100 }, source: mural },
  { key: 'contain', name: 'WallPro fit margins diagnostic', layout: { width: 16, height: 8, mode: 'contain', repeatWidth: 4 }, settings: { bleed: 1, overlap: .5, minPpi: 100 }, source: mural },
];
for (const job of jobs) {
  const pack = await buildWallPrintPack(job);
  const dir = resolve(output, job.key); await mkdir(dir, { recursive: true });
  for (const file of pack.files) { const path = resolve(dir, file.name); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, file.bytes); }
  await writeFile(resolve(dir, pack.filename), pack.zip);
  console.log(JSON.stringify({ mode: job.key, folder: dir, zip: pack.filename, panels: pack.manifest.panels.length }));
}
