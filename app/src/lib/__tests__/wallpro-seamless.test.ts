import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import JSZip from 'jszip';
import { measureSeam, blendSeamless, seamLadder, shouldTryBlend, seamlessReceipt, tileCoordinate, SEAM_RATIO_MAX } from '../wallpro-seamless';
import { artworkPoint } from '../wallpro-geometry';
import { assertSeamlessForPrint, buildWallPrintPack } from '../wallpro-print-export';
import { DEFAULT_WALL_PRINT } from '../wallpro-print-plan';

// Deterministic fixtures. A gradient joins 255 against 0 at the wrap: the
// classic hard seam. A tiled sine field is periodic, so its edges join like any
// interior neighbours: the shape a genuinely seamless tile measures as.
function gradientTile(size = 96) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = Math.round(255 * x / (size - 1)); data[i + 3] = 255; }
  return { data, size };
}
function periodicTile(size = 96) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    data[i] = Math.round(127 + 120 * Math.sin(2 * Math.PI * 3 * x / size)); data[i + 1] = Math.round(127 + 120 * Math.cos(2 * Math.PI * 2 * y / size)); data[i + 2] = Math.round(127 + 90 * Math.sin(2 * Math.PI * (x + y) / size)); data[i + 3] = 255;
  }
  return { data, size };
}

describe('WallPro seam measurement', () => {
  it('convicts a hard wrap-around seam and clears a periodic tile', () => {
    const bad = gradientTile(), good = periodicTile();
    const badReport = measureSeam(bad.data, bad.size, bad.size), goodReport = measureSeam(good.data, good.size, good.size);
    expect(badReport.seamless).toBe(false); expect(badReport.ratio).toBeGreaterThan(20);
    expect(goodReport.seamless).toBe(true); expect(goodReport.ratio).toBeLessThanOrEqual(SEAM_RATIO_MAX);
    expect(() => measureSeam(new Uint8ClampedArray(4), 1, 1)).toThrow();
  });
  it('closes a hard seam deterministically without an image request', () => {
    const { data, size } = gradientTile();
    const blended = blendSeamless(data, size, size);
    const report = measureSeam(blended, size, size);
    expect(report.seamless).toBe(true); expect(report.edge).toBeLessThan(measureSeam(data, size, size).edge / 20);
    // Same input, same bytes: the repair is a function, not a roll.
    expect(Buffer.compare(Buffer.from(blendSeamless(data, size, size)), Buffer.from(blended))).toBe(0);
    expect(() => blendSeamless(data, size, size, 0.6)).toThrow();
  });
  /**
   * ⚠️ THIS CASE USED TO ENCODE THE DEFECT, AND ITS OWN TITLE SAID SO.
   *
   * It read "chooses verified-as-generated only when the measurement proves
   * it, OTHERWISE MIRROR" and asserted exactly that — so the customer path's
   * straight-to-kaleidoscope fallback was pinned as correct behaviour while
   * the batch path (`batchSeamDecision`, 2026-09-14) had already been fixed to
   * climb blend first. A green suite sat over two halves of one product
   * disagreeing about the same tile. It now pins the ladder both halves share.
   */
  it('climbs verified → blend → mirror, and only reaches mirror when a MEASURED blend fails', () => {
    const bad = gradientTile(), good = periodicTile();
    const badReport = measureSeam(bad.data, bad.size, bad.size), goodReport = measureSeam(good.data, good.size, good.size);
    const blendedOk = measureSeam(blendSeamless(bad.data, bad.size, bad.size), bad.size, bad.size);
    expect(blendedOk.seamless).toBe(true);

    expect(seamLadder(goodReport, null, 'auto')).toBe('verified');
    // The whole fix: a tile that does not join is BLENDED, not flipped.
    expect(seamLadder(badReport, blendedOk, 'auto')).toBe('blend');
    // Mirror survives as the last rung — a blend that was run and did not close.
    expect(seamLadder(badReport, badReport, 'auto')).toBe('mirror');
    // ...and as the answer when no blend was attempted at all, which is what a
    // caller that skips the attempt is really saying.
    expect(seamLadder(badReport, null, 'auto')).toBe('mirror');
    // An explicit preference is obeyed whatever the pixels say.
    expect(seamLadder(goodReport, null, 'mirror')).toBe('mirror');
    expect(seamLadder(badReport, null, 'blend')).toBe('blend');

    // A blend is attempted exactly when it could change the answer.
    expect(shouldTryBlend(badReport, 'auto')).toBe(true);
    expect(shouldTryBlend(goodReport, 'auto')).toBe(false);
    expect(shouldTryBlend(goodReport, 'blend')).toBe(true);
    expect(shouldTryBlend(badReport, 'mirror')).toBe(false);

    expect(seamlessReceipt('auto', badReport, null, 'mirror').verified).toBe(true); // mirror by construction
    expect(seamlessReceipt('blend', badReport, badReport, 'blend').verified).toBe(false); // blend must be re-measured
    expect(seamlessReceipt('blend', badReport, blendedOk, 'blend').verified).toBe(true);
  });
  it('mirror repeat maps every join onto its own copy, in preview sampling and print geometry alike', () => {
    expect(tileCoordinate(1.25, true)).toEqual({ index: 1, u: 0.75 });
    expect(tileCoordinate(2.25, true)).toEqual({ index: 2, u: 0.25 });
    expect(tileCoordinate(1.25, false).u).toBeCloseTo(0.25, 10);
    // Tile -1 is odd, so it flips too: t = 0- and t = 0+ both sample u ≈ 0.
    expect(tileCoordinate(-0.25, true).u).toBeCloseTo(0.25, 10);
    expect(tileCoordinate(-0.001, true).u).toBeCloseTo(0.001, 6);
    const layout = { width: 120, height: 96, mode: 'repeat' as const, repeatWidth: 24, mirror: true };
    // Just left and just right of the first seam (x = 24 in) sample the same texel column.
    const left = artworkPoint({ x: 23.99 / 120, y: 0.3 }, layout, 1)!, right = artworkPoint({ x: 24.01 / 120, y: 0.3 }, layout, 1)!;
    expect(Math.abs(left.x - right.x)).toBeLessThan(0.002);
    const plain = artworkPoint({ x: 24.01 / 120, y: 0.3 }, { ...layout, mirror: false }, 1)!;
    expect(plain.x).toBeCloseTo(0.01 / 24, 6);
  });
});

function pageContentStreams(pdf: Uint8Array): string[] {
  const text = Buffer.from(pdf).toString('latin1');
  const streams: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { try { streams.push(inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')); } catch { /* not a Flate stream (e.g. the image) */ } }
  return streams;
}

describe('WallPro print export seam gate', () => {
  const tile = async (size: number) => new Uint8Array(await sharp({ create: { width: size, height: size, channels: 3, background: '#2266aa' } }).png().toBuffer());
  const layout = { width: 60, height: 40, mode: 'repeat' as const, repeatWidth: 4 };
  it('refuses a repeat without a verified seam receipt and accepts murals without one', async () => {
    const bytes = await tile(600);
    const bad = gradientTile();
    const unverified = seamlessReceipt('blend', measureSeam(bad.data, bad.size, bad.size), measureSeam(bad.data, bad.size, bad.size), 'blend');
    await expect(buildWallPrintPack({ name: 'No receipt', layout, settings: DEFAULT_WALL_PRINT, source: { bytes, width: 600, height: 600 } })).rejects.toThrow('seam check');
    await expect(buildWallPrintPack({ name: 'Unverified', layout, settings: DEFAULT_WALL_PRINT, source: { bytes, width: 600, height: 600 }, seamless: unverified })).rejects.toThrow('does not join');
    expect(() => assertSeamlessForPrint({ ...layout, mirror: true }, seamlessReceipt('blend', unverified.before, unverified.after, 'blend'))).toThrow('disagree');
    expect(() => assertSeamlessForPrint({ ...layout, mode: 'cover' }, null)).not.toThrow();
  });
  it('prints mirror repeat with flipped odd tiles and records the receipt in the manifest', async () => {
    const bytes = await tile(600);
    const bad = gradientTile();
    // Mirror is now the LAST rung, so this fixture states it outright: a
    // blend was run against this tile and did not close it.
    const badReport = measureSeam(bad.data, bad.size, bad.size);
    const receipt = seamlessReceipt('auto', badReport, null, seamLadder(badReport, badReport, 'auto'));
    expect(receipt.method).toBe('mirror');
    const pack = await buildWallPrintPack({ name: 'Mirror', layout: { ...layout, mirror: true }, settings: DEFAULT_WALL_PRINT, source: { bytes, width: 600, height: 600 }, seamless: receipt });
    const zip = await JSZip.loadAsync(pack.zip);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.seamless).toMatchObject({ contract: 'wallpro.seamless.v1', method: 'mirror', verified: true });
    expect(manifest.placement.mirror).toBe(true);
    const content = pageContentStreams(pack.files[0].bytes).join('\n');
    // Odd columns flip horizontally, odd rows vertically: both negative scales appear as PDF cm operators.
    // jsPDF writes numbers as "1." / "-144." / "1008.5"; assert the flips as cm operators.
    const n = '-?\\d+(?:\\.\\d*)?';
    expect(content).toMatch(new RegExp(`-1\\. 0\\. 0\\. 1\\. ${n} 0\\. cm`));
    expect(content).toMatch(new RegExp(`1\\. 0\\. 0\\. -1\\. 0\\. ${n} cm`));
    expect(content).toMatch(new RegExp(`-1\\. 0\\. 0\\. -1\\. ${n} ${n} cm`));
    expect(await zip.file('PRINT-INSTRUCTIONS.txt')!.async('string')).toContain('mirror repeat');
    const goodReport = measureSeam(periodicTile().data, 96, 96);
    const verified = seamlessReceipt('auto', goodReport, null, seamLadder(goodReport, null, 'auto'));
    expect(verified.method).toBe('verified');
    const plain = await buildWallPrintPack({ name: 'Verified', layout, settings: DEFAULT_WALL_PRINT, source: { bytes, width: 600, height: 600 }, seamless: verified });
    expect(pageContentStreams(plain.files[0].bytes).join('\n')).not.toMatch(/-1\. 0\. 0\. /);
  });
});
