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
/**
 * `png` IS NULLABLE, AND THAT IS THE WHOLE POINT (2026-09-22).
 *
 * The detector answers with a label, a box, a class AND a grayscale mask PNG.
 * Until now the edge handler dropped the ENTIRE item when that PNG was
 * missing, malformed or over 2 MB — box and label with it — so a model that
 * located the window perfectly and fumbled only the mask produced zero
 * protected areas and the customer saw nothing at all. The deployed handler's
 * own comment records how fragile that channel is: "every thinking-on call
 * today answered 0 masks".
 *
 * The system had exactly two states — a pixel-perfect outline, or nothing —
 * and no middle. The owner asked for the middle, with a photograph of it
 * (2026-09-22, three labelled rectangles over the drapes, the window and the
 * door): "It should be doing this." A rectangle needs no mask PNG.
 *
 * So a box-only item survives with `png: null` and is rasterised as its own
 * rectangle. It is a COARSER answer, deliberately marked as one, and it is
 * preview-only like every mask here — print panels stay full rectangles — so
 * over-covering the wall beside a drape costs preview fidelity, never a file.
 */
export type DetectedMask = { label: string; box: { x0: number; y0: number; x1: number; y1: number }; png: string | null; class?: OcclusionClass };
export const MASK_THRESHOLD = 127;
export const MASK_MAX_EDGE = 1600;

/**
 * ⚠️ `crossOrigin` IS LOAD-BEARING HERE, AND ITS ABSENCE WAS A LIVE CRASH
 * (owner, Trish 2026-09-23, from her phone: "The operation is insecure.").
 *
 * That sentence is Safari's wording for a SecurityError, and the error was
 * real: a mask arrives as a SIGNED SUPABASE URL, which is a different origin
 * from os.designproai.com. An <img> loaded WITHOUT `crossOrigin` taints the
 * canvas it is drawn into, and every `getImageData` in this file then throws.
 * The masks are exactly what this page reads pixels back from, so the one
 * loader that had to be CORS-clean was the one that was not.
 *
 * Its sibling one file away -- `loadWallImage` in `wallpro-render.ts`, which
 * imports `maskFlags` FROM here -- has always set it, and loads from the same
 * bucket. So the header was known to work; this loader simply never got it.
 *
 * TWO LOADERS, ONE FILE APART, AND THE UNGUARDED ONE WAS THE ONE THAT READS
 * PIXELS. Do not add a third: if another module needs to decode a mask, import
 * this one.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('A protected-area mask could not be read.'));
    img.src = src;
  });
}

/**
 * A mask that cannot be read means NOTHING IS PROTECTED -- it never means the
 * page is broken.
 *
 * The taint above threw from `getImageData`, not from the load, so the two
 * `try { await loadImage(...) } catch` guards below could not catch it: the
 * image loaded fine and the READBACK was refused. A protected area is a
 * preview refinement (print panels stay full rectangles either way), so it has
 * no business taking down a generation. This keeps every readback soft, so a
 * future taint, a zero-sized canvas or a browser with canvas reads disabled
 * degrades to "nothing protected" instead of a red error over Generate.
 */
function readPixels(ctx: CanvasRenderingContext2D, width: number, height: number): ImageData | null {
  try { return ctx.getImageData(0, 0, width, height); } catch { return null; }
}

/** Rasterises detection masks into one union canvas sized to the photo (capped
 * at MASK_MAX_EDGE on the long side). Returns null when nothing survived. */
export async function rasterizeDetectionMasks(masks: DetectedMask[], photoWidth: number, photoHeight: number): Promise<HTMLCanvasElement | null> {
  if (!masks.length || !(photoWidth > 0) || !(photoHeight > 0)) return null;
  const scale = Math.min(1, MASK_MAX_EDGE / Math.max(photoWidth, photoHeight));
  const width = Math.max(1, Math.round(photoWidth * scale)), height = Math.max(1, Math.round(photoHeight * scale));
  const union = document.createElement('canvas'); union.width = width; union.height = height;
  const uctx = union.getContext('2d', { willReadFrequently: true })!;
  // A blank canvas read can only fail on a browser that refuses canvas reads
  // outright; there is nothing to protect with if it does.
  const out = readPixels(uctx, width, height);
  if (!out) return null;
  let painted = 0;
  const fill = (left: number, top: number, w: number, h: number) => {
    for (let y = 0; y < h; y++) {
      const oy = top + y; if (oy < 0 || oy >= height) continue;
      for (let x = 0; x < w; x++) {
        const ox = left + x; if (ox < 0 || ox >= width) continue;
        const o = (oy * width + ox) * 4;
        out.data[o] = 255; out.data[o + 1] = 255; out.data[o + 2] = 255; out.data[o + 3] = 255; painted++;
      }
    }
  };
  for (const mask of masks) {
    const left = Math.round(mask.box.x0 * width), top = Math.round(mask.box.y0 * height);
    const w = Math.max(1, Math.round((mask.box.x1 - mask.box.x0) * width)), h = Math.max(1, Math.round((mask.box.y1 - mask.box.y0) * height));
    // NO OUTLINE, BUT A BOX IS STILL AN ANSWER. An item whose mask PNG never
    // arrived, or arrived unreadable, is filled as its own rectangle rather
    // than discarded -- the difference between the customer seeing her window
    // protected roughly and seeing nothing protected at all. `loadImage`
    // failing is the SAME case as `png` being null and takes the same path;
    // it used to `continue`, silently losing the object.
    let img: HTMLImageElement | null = null;
    if (mask.png) { try { img = await loadImage(mask.png); } catch { img = null; } }
    if (!img) { fill(left, top, w, h); continue; }
    const scratch = document.createElement('canvas'); scratch.width = w; scratch.height = h;
    const sctx = scratch.getContext('2d', { willReadFrequently: true })!;
    sctx.drawImage(img, 0, 0, w, h);
    const scratchPixels = readPixels(sctx, w, h);
    // Unreadable pixels are the same case as a missing PNG: fall back to the
    // coarse box rather than losing the object entirely.
    if (!scratchPixels) { fill(left, top, w, h); continue; }
    const data = scratchPixels.data;
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
/**
 * THE IDENTITY OF "WHAT IS PROTECTED RIGHT NOW" (owner, 2026-09-24: "i drew a
 * mask on inside of closet yet still wrapped", then "I masked the inside it
 * should nothave wrapped that").
 *
 * Her mask was correct, it was saved, and it was never sent. The AI room view
 * is cached, and its currency test compared the ARTWORK, the PHOTO and the
 * SCALE — never the masks. So the sequence that every customer actually
 * follows broke it:
 *
 *   1. design generates -> the view auto-paints with no mask yet
 *   2. she marks the closet
 *   3. the cached view is still "current", so nothing repaints, ever
 *
 * The closet stayed wrapped no matter how carefully she marked it, and the
 * button said "On your wall" the whole time. This key is what that test was
 * missing: change a protected area and the view is stale, exactly as changing
 * the design or the pattern scale already made it stale.
 *
 * It keys on the stored PATH, falling back to the url only while the upload is
 * still in flight, because a signed url is re-signed on every reopen and would
 * invalidate a perfectly good view for no reason. Polygons round to 4 decimals
 * -- finer than a pixel on any photo -- and a polygon with under three points
 * is ignored here for the same reason `buildProtectedAreaMask` ignores it: it
 * paints nothing, so it may not cost a render.
 */
export function wallMaskKey(exclusions: Point[][], detected: string | null, remove: string | null): string {
  const polygons = exclusions
    .filter(poly => poly.length >= 3)
    .map(poly => poly.map(p => p.x.toFixed(4) + ',' + p.y.toFixed(4)).join(' '))
    .join(';');
  return [polygons, detected || '', remove || ''].join('|');
}

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
  const pixels = readPixels(ctx, width, height);
  const flags = new Uint8Array(width * height);
  // All-zero flags read downstream as "nothing protected", which is exactly
  // the honest answer when the mask could not be measured.
  if (!pixels) return flags;
  const data = pixels.data;
  for (let i = 0; i < flags.length; i++) flags[i] = data[i * 4 + 3] > MASK_THRESHOLD ? 1 : 0;
  return flags;
}
