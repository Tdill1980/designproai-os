// Pixel-accurate protected areas for the on-wall preview. Detection returns one
// grayscale PNG per object that fills its box (photo-normalized); the union of
// those, thresholded, is one RGBA mask at preview resolution: white and opaque
// where the design must not paint, transparent elsewhere. Preview-only: print
// panels stay full rectangles and the installer trims on site.
import type { Point } from './wallpro-geometry';
/** See wallpro-occlusion.ts: `fixed` is protected (kept exactly as
 * photographed), `movable` is disregarded (the covering paints through it,
 * as an installer would after clearing the room). Unclassified/legacy data
 * defaults to `fixed` -- protecting something that should have been removed
 * is a cosmetic miss, not a wrong reveal. */
export type OcclusionClass = 'fixed' | 'movable';
export type DetectedMask = { label: string; box: { x0: number; y0: number; x1: number; y1: number }; png: string; class?: OcclusionClass };
export const MASK_THRESHOLD = 127;
export const MASK_MAX_EDGE = 1600;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('A protected-area mask could not be read.')); img.src = src; });
}

/** Rasterises detection masks into one union canvas sized to the photo (capped
 * at MASK_MAX_EDGE on the long side). Returns null when nothing survived. */
export async function rasterizeDetectionMasks(masks: DetectedMask[], photoWidth: number, photoHeight: number): Promise<HTMLCanvasElement | null> {
  if (!masks.length || !(photoWidth > 0) || !(photoHeight > 0)) return null;
  const scale = Math.min(1, MASK_MAX_EDGE / Math.max(photoWidth, photoHeight));
  const width = Math.max(1, Math.round(photoWidth * scale)), height = Math.max(1, Math.round(photoHeight * scale));
  const union = document.createElement('canvas'); union.width = width; union.height = height;
  const uctx = union.getContext('2d', { willReadFrequently: true })!;
  const out = uctx.getImageData(0, 0, width, height);
  let painted = 0;
  for (const mask of masks) {
    let img: HTMLImageElement;
    try { img = await loadImage(mask.png); } catch { continue; }
    const left = Math.round(mask.box.x0 * width), top = Math.round(mask.box.y0 * height);
    const w = Math.max(1, Math.round((mask.box.x1 - mask.box.x0) * width)), h = Math.max(1, Math.round((mask.box.y1 - mask.box.y0) * height));
    const scratch = document.createElement('canvas'); scratch.width = w; scratch.height = h;
    const sctx = scratch.getContext('2d', { willReadFrequently: true })!;
    sctx.drawImage(img, 0, 0, w, h);
    const data = sctx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) {
      const oy = top + y; if (oy < 0 || oy >= height) continue;
      for (let x = 0; x < w; x++) {
        const ox = left + x; if (ox < 0 || ox >= width) continue;
        const i = (y * w + x) * 4;
        // Segmentation PNGs carry the probability in the colour channels; an
        // alpha-only PNG carries it in alpha. Take whichever is present.
        const value = data[i + 3] < 255 && data[i] === 0 ? data[i + 3] : data[i];
        if (value > MASK_THRESHOLD) { const o = (oy * width + ox) * 4; out.data[o] = 255; out.data[o + 1] = 255; out.data[o + 2] = 255; out.data[o + 3] = 255; painted++; }
      }
    }
  }
  if (!painted) return null;
  uctx.putImageData(out, 0, 0);
  return union;
}

/** Combines hand-drawn exclusion polygons and any already-detected protected-
 * area mask into ONE white-on-transparent PNG at (capped) photo resolution.
 * The deterministic "on your wall" composite already reads `exclusions` and
 * the detected mask directly during its own render; this gives the AI
 * photorealistic view (and the post-generation recomposite that makes its
 * result a guarantee, not a hope) the exact same protected areas instead of
 * prose alone. Returns null when nothing is protected, so the AI view's
 * request is byte-for-byte unchanged in the common case. */
export async function buildProtectedAreaMask(exclusions: Point[][], detectedMaskUrl: string | null, photoWidth: number, photoHeight: number): Promise<HTMLCanvasElement | null> {
  if (!exclusions.length && !detectedMaskUrl) return null;
  const scale = Math.min(1, MASK_MAX_EDGE / Math.max(photoWidth, photoHeight));
  const width = Math.max(1, Math.round(photoWidth * scale)), height = Math.max(1, Math.round(photoHeight * scale));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  let painted = false;
  if (detectedMaskUrl) {
    try { const img = await loadImage(detectedMaskUrl); ctx.drawImage(img, 0, 0, width, height); painted = true; } catch { /* union continues without it */ }
  }
  if (exclusions.length) {
    ctx.fillStyle = '#ffffff';
    for (const poly of exclusions) {
      if (poly.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(poly[0].x * width, poly[0].y * height);
      for (const p of poly.slice(1)) ctx.lineTo(p.x * width, p.y * height);
      ctx.closePath(); ctx.fill();
      painted = true;
    }
  }
  return painted ? canvas : null;
}

/** Reads a mask image into a per-pixel protected flag at the given size. */
export async function maskFlags(maskUrl: string, width: number, height: number): Promise<Uint8Array> {
  const img = await loadImage(maskUrl);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const flags = new Uint8Array(width * height);
  for (let i = 0; i < flags.length; i++) flags[i] = data[i * 4 + 3] > MASK_THRESHOLD ? 1 : 0;
  return flags;
}
