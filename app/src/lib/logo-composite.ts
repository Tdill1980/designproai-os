/**
 * logo-composite.ts — pure pixel math, no ML.
 *
 * Powers two RevisionIQ logo features:
 *
 * FEATURE 1: Upload your own logo file
 *   1. removeBackgroundByCornerFlood — corner-sample chroma key BFS that
 *      drops alpha to 0 on every connected pixel within tolerance of the
 *      sampled corners. Works for any logo on a clean background.
 *   2. extractLayerAtPoint — given an alpha-cleaned image and a click point,
 *      BFS the connected non-transparent component containing the click and
 *      return it as a tight-cropped transparent PNG blob + bbox.
 *
 * FEATURE 2: Separate text/logo elements off an existing AI render
 *   3. magicWandExtract — given an AI render and a click point, BFS the
 *      connected color-similar region containing the click and return it
 *      as a tight-cropped PNG layer + an updated copy of the source image
 *      with those pixels patched using the bounding-box edge median color.
 *      The extracted layer and the patched background get saved separately
 *      so the print pipeline can re-composite them at exact coordinates,
 *      killing panel-drift on print.
 *
 * SHARED:
 *   4. composeRenderWithLayers — paint a render and N placed layers onto
 *      one canvas, return a PNG blob ready for upload.
 *   5. uploadLogoAsset / uploadCompositeRender — push blobs to wrap-files.
 */
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogoSize = "sm" | "md" | "lg";

export interface PlacedLayer {
  /** Stable id, e.g. lyr_01 */
  id: string;
  /** Public URL of the cleaned, tight-cropped PNG for this layer */
  cleanedUrl: string;
  /** Click x as fraction of render width (0-1) */
  xPct: number;
  /** Click y as fraction of render height (0-1) */
  yPct: number;
  /** Discrete size bucket */
  size: LogoSize;
  /** Continuous width fraction (0-1) — takes precedence over `size` when set. */
  sizePercent?: number;
  /** Clockwise rotation in degrees about the layer center. Defaults to 0. */
  rotationDeg?: number;
}

export interface ExtractedLayer {
  /** Tight-cropped transparent PNG blob (the layer pixels only) */
  blob: Blob;
  /** Bounding box in original-image pixel space */
  bbox: { x: number; y: number; w: number; h: number };
  /** ObjectURL preview */
  previewUrl: string;
}

// ---------------------------------------------------------------------------
// Image loading helpers
// ---------------------------------------------------------------------------

export async function fileToImageBitmap(file: File | Blob): Promise<ImageBitmap> {
  return await createImageBitmap(file);
}

export async function urlToImageBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

function bitmapToImageData(bitmap: ImageBitmap): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function imageDataToPngBlob(data: ImageData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = data.width;
  canvas.height = data.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(data, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
}

// ---------------------------------------------------------------------------
// 1. Background removal — corner-sample flood fill (no ML)
// ---------------------------------------------------------------------------

/**
 * Remove the background by sampling the four corners of the image and
 * BFS-flood-filling every connected pixel within `tolerance` Euclidean color
 * distance. Matched pixels get alpha set to 0; unmatched pixels are kept.
 *
 * Works perfectly when the background touches at least one corner and the
 * subject does not (the common case for any logo file, brochure, mockup,
 * business card, etc.).
 */
export function removeBackgroundByCornerFlood(
  source: ImageData,
  tolerance = 32,
): ImageData {
  const { width, height, data } = source;
  // Clone so the source stays untouched
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  const px = out.data;

  // Sample the four corner colors
  const corners: Array<[number, number]> = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];

  const visited = new Uint8Array(width * height);
  // BFS queue stored as flat indices
  const queue: number[] = [];

  for (const [cx, cy] of corners) {
    const startIdx = cy * width + cx;
    if (visited[startIdx]) continue;
    const baseR = px[startIdx * 4];
    const baseG = px[startIdx * 4 + 1];
    const baseB = px[startIdx * 4 + 2];
    queue.push(startIdx);
    visited[startIdx] = 1;

    while (queue.length) {
      const idx = queue.shift()!;
      const x = idx % width;
      const y = (idx - x) / width;
      const off = idx * 4;
      const r = px[off];
      const g = px[off + 1];
      const b = px[off + 2];
      const dr = r - baseR;
      const dg = g - baseG;
      const db = b - baseB;
      // Squared distance compared to tolerance squared (cheaper than sqrt)
      if (dr * dr + dg * dg + db * db > tolerance * tolerance) continue;

      // Match — clear alpha
      px[off + 3] = 0;

      // Enqueue 4-neighbors
      if (x > 0) {
        const n = idx - 1;
        if (!visited[n]) {
          visited[n] = 1;
          queue.push(n);
        }
      }
      if (x < width - 1) {
        const n = idx + 1;
        if (!visited[n]) {
          visited[n] = 1;
          queue.push(n);
        }
      }
      if (y > 0) {
        const n = idx - width;
        if (!visited[n]) {
          visited[n] = 1;
          queue.push(n);
        }
      }
      if (y < height - 1) {
        const n = idx + width;
        if (!visited[n]) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }
  }

  return out;
}

/** Convenience: file → cleaned ImageData + cleaned PNG blob */
export async function removeBackgroundFromFile(
  file: File | Blob,
  tolerance = 32,
): Promise<{ cleaned: ImageData; blob: Blob }> {
  const bitmap = await fileToImageBitmap(file);
  const source = bitmapToImageData(bitmap);
  bitmap.close?.();
  const cleaned = removeBackgroundByCornerFlood(source, tolerance);
  const blob = await imageDataToPngBlob(cleaned);
  return { cleaned, blob };
}

// ---------------------------------------------------------------------------
// 2. Click-to-isolate — connected component extraction at a click point
// ---------------------------------------------------------------------------

/**
 * Given an alpha-cleaned image and a click point in image-pixel space, BFS
 * the connected component of non-transparent pixels containing the click and
 * return it as a tight-cropped transparent PNG.
 *
 * Pixels are considered "in" if their alpha is above `alphaThreshold`.
 * 8-connectivity so diagonal text strokes stay together.
 */
export async function extractLayerAtPoint(
  cleaned: ImageData,
  clickX: number,
  clickY: number,
  alphaThreshold = 16,
): Promise<ExtractedLayer | null> {
  const { width, height, data } = cleaned;
  const cx = Math.max(0, Math.min(width - 1, Math.round(clickX)));
  const cy = Math.max(0, Math.min(height - 1, Math.round(clickY)));
  const startIdx = cy * width + cx;
  if (data[startIdx * 4 + 3] <= alphaThreshold) return null;

  const visited = new Uint8Array(width * height);
  const queue: number[] = [startIdx];
  visited[startIdx] = 1;
  const memberIdx: number[] = [];
  let minX = cx;
  let maxX = cx;
  let minY = cy;
  let maxY = cy;

  while (queue.length) {
    const idx = queue.shift()!;
    memberIdx.push(idx);
    const x = idx % width;
    const y = (idx - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    // 8-neighbors
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (visited[nIdx]) continue;
        if (data[nIdx * 4 + 3] <= alphaThreshold) continue;
        visited[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }

  // Build a tight-cropped ImageData containing only this component
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const cropData = new ImageData(cropW, cropH);
  const cropPx = cropData.data;

  for (const idx of memberIdx) {
    const x = idx % width;
    const y = (idx - x) / width;
    const cropIdx = (y - minY) * cropW + (x - minX);
    const srcOff = idx * 4;
    const dstOff = cropIdx * 4;
    cropPx[dstOff] = data[srcOff];
    cropPx[dstOff + 1] = data[srcOff + 1];
    cropPx[dstOff + 2] = data[srcOff + 2];
    cropPx[dstOff + 3] = data[srcOff + 3];
  }

  const blob = await imageDataToPngBlob(cropData);
  const previewUrl = URL.createObjectURL(blob);
  return {
    blob,
    bbox: { x: minX, y: minY, w: cropW, h: cropH },
    previewUrl,
  };
}

// ---------------------------------------------------------------------------
// 2b. Magic wand — extract a color-similar region from an opaque image
// ---------------------------------------------------------------------------

export interface MagicWandResult {
  /** The extracted region as a tight-cropped transparent PNG blob */
  extractedBlob: Blob;
  /** ObjectURL preview for the extracted layer */
  extractedPreviewUrl: string;
  /** Bounding box of the extracted region in source-image pixel space */
  bbox: { x: number; y: number; w: number; h: number };
  /** Updated source image with the extracted pixels patched (local median fill) */
  patchedSource: ImageData;
  /** Patched source as a PNG blob ready to upload as the clean background (local median fill) */
  patchedSourceBlob: Blob;
  /**
   * Full-size binary mask PNG (white = remove, black = keep) sized to the
   * source image. Dilated by a few pixels so anti-aliased edges are covered.
   * Used to call the inpaint-cleanup edge function (ClipDrop) for a
   * content-aware fill that is dramatically better than the local median.
   */
  maskBlob: Blob;
  /** Source image as a PNG blob, for shipping to the inpaint edge function */
  sourceBlob: Blob;
  /** The base RGB color the wand sampled from the click point */
  sourceColor: { r: number; g: number; b: number };
  /** Tolerance value used for the extraction */
  tolerance: number;
}

/**
 * Magic wand: BFS-flood-fill from a click point through every connected
 * pixel within `tolerance` Euclidean color distance. Returns the extracted
 * region as a layer AND the source with those pixels patched using the
 * median color sampled from the bounding-box perimeter.
 *
 * This is the Feature 2 primitive — peeling drift-prone text/logos off an
 * AI render so the patched background can be panelized cleanly and the
 * extracted elements re-composited at exact coordinates at print time.
 */
export async function magicWandExtract(
  source: ImageData,
  clickX: number,
  clickY: number,
  tolerance = 28,
): Promise<MagicWandResult | null> {
  const { width, height, data } = source;
  const cx = Math.max(0, Math.min(width - 1, Math.round(clickX)));
  const cy = Math.max(0, Math.min(height - 1, Math.round(clickY)));
  const startIdx = cy * width + cx;
  const baseR = data[startIdx * 4];
  const baseG = data[startIdx * 4 + 1];
  const baseB = data[startIdx * 4 + 2];
  const tolSq = tolerance * tolerance;

  const visited = new Uint8Array(width * height);
  const queue: number[] = [startIdx];
  visited[startIdx] = 1;
  const memberIdx: number[] = [];
  let minX = cx;
  let maxX = cx;
  let minY = cy;
  let maxY = cy;

  while (queue.length) {
    const idx = queue.shift()!;
    const off = idx * 4;
    const dr = data[off] - baseR;
    const dg = data[off + 1] - baseG;
    const db = data[off + 2] - baseB;
    if (dr * dr + dg * dg + db * db > tolSq) continue;

    memberIdx.push(idx);
    const x = idx % width;
    const y = (idx - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    if (x > 0) {
      const n = idx - 1;
      if (!visited[n]) {
        visited[n] = 1;
        queue.push(n);
      }
    }
    if (x < width - 1) {
      const n = idx + 1;
      if (!visited[n]) {
        visited[n] = 1;
        queue.push(n);
      }
    }
    if (y > 0) {
      const n = idx - width;
      if (!visited[n]) {
        visited[n] = 1;
        queue.push(n);
      }
    }
    if (y < height - 1) {
      const n = idx + width;
      if (!visited[n]) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }

  if (memberIdx.length < 16) return null; // too small to be meaningful

  // Build a tight-cropped transparent PNG of the extracted region
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const cropData = new ImageData(cropW, cropH);
  const cropPx = cropData.data;
  for (const idx of memberIdx) {
    const x = idx % width;
    const y = (idx - x) / width;
    const cropIdx = (y - minY) * cropW + (x - minX);
    const srcOff = idx * 4;
    const dstOff = cropIdx * 4;
    cropPx[dstOff] = data[srcOff];
    cropPx[dstOff + 1] = data[srcOff + 1];
    cropPx[dstOff + 2] = data[srcOff + 2];
    cropPx[dstOff + 3] = 255; // opaque
  }
  const extractedBlob = await imageDataToPngBlob(cropData);
  const extractedPreviewUrl = URL.createObjectURL(extractedBlob);

  // ── Build a full-size binary mask (white=remove, black=keep) ──
  // Dilated by DILATE_PX so anti-aliased edges (outside the BFS tolerance
  // radius) also get cleaned up. Used by both the local FMM inpainter and
  // the ClipDrop fallback edge function.
  const DILATE_PX = 3;
  const maskData = new ImageData(width, height);
  const maskPx = maskData.data;
  for (let i = 0; i < width * height; i++) {
    maskPx[i * 4] = 0;
    maskPx[i * 4 + 1] = 0;
    maskPx[i * 4 + 2] = 0;
    maskPx[i * 4 + 3] = 255;
  }
  for (const idx of memberIdx) {
    const x = idx % width;
    const y = (idx - x) / width;
    const x0 = Math.max(0, x - DILATE_PX);
    const x1 = Math.min(width - 1, x + DILATE_PX);
    const y0 = Math.max(0, y - DILATE_PX);
    const y1 = Math.min(height - 1, y + DILATE_PX);
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const mi = (yy * width + xx) * 4;
        maskPx[mi] = 255;
        maskPx[mi + 1] = 255;
        maskPx[mi + 2] = 255;
      }
    }
  }
  const maskBlob = await imageDataToPngBlob(maskData);

  // ── Patch the source using FMM inpainting ──
  // Replaces the old flat median-color fill. FMM fills from the boundary
  // inward following surrounding texture/lighting — $0/call, ~1-2 sec,
  // dramatically better on curved vehicle wraps.
  const patched = fmmInpaint(source, maskData);
  const patchedSourceBlob = await imageDataToPngBlob(patched);

  // Also produce a blob of the original source so the caller can ship it
  // straight to the inpaint edge function without re-encoding.
  const sourceBlob = await imageDataToPngBlob(source);

  return {
    extractedBlob,
    extractedPreviewUrl,
    bbox: { x: minX, y: minY, w: cropW, h: cropH },
    patchedSource: patched,
    patchedSourceBlob,
    maskBlob,
    sourceBlob,
    sourceColor: { r: baseR, g: baseG, b: baseB },
    tolerance,
  };
}

// ---------------------------------------------------------------------------
// 2b. Fast Marching Method (FMM) Telea-style inpainting — PURE TypeScript
// ---------------------------------------------------------------------------
//
// Replaces ClipDrop for element removal. $0/call, runs client-side in ~1-2 sec.
//
// Algorithm (simplified Telea 2004):
//   1. Build a distance map from each masked pixel to the nearest known pixel
//      using a BFS wave from the mask boundary inward.
//   2. Process masked pixels in order of increasing distance (the "fast march").
//   3. For each pixel, compute a weighted average of nearby KNOWN pixels within
//      a search radius. Weights:
//        - Distance weight: closer known pixels contribute more (1/d^2)
//        - Boundary alignment weight: pixels along the boundary normal contribute
//          more (dot product of direction vector and gradient direction)
//   4. The result smoothly fills inward following the texture/color gradient at
//      the boundary edges — dramatically better than a flat median fill because
//      it preserves the wrap's lighting, curvature, and color transitions.
//
// Quality: very good for text/logo removal on vehicle wraps. Not as perfect as
// a neural inpainter (ClipDrop/LaMa) on complex multi-texture removals, but
// eliminates the per-call cost and network latency entirely.

/**
 * Inpaint masked pixels using a Fast Marching boundary-walk approach.
 *
 * @param source  Full source image (unchanged)
 * @param mask    Same dimensions as source. White (R>128) = remove, Black = keep.
 * @param radius  Search radius for known-pixel averaging (default 5). Larger = smoother but slower.
 * @returns       New ImageData with masked pixels inpainted.
 */
export function fmmInpaint(
  source: ImageData,
  mask: ImageData,
  radius = 5,
): ImageData {
  const { width, height } = source;
  const src = source.data;
  const msk = mask.data;
  const out = new Uint8ClampedArray(src); // start as copy of source

  // ── Step 1: Identify masked pixels and compute distance to boundary ──
  // isMasked[i] = true if pixel i is in the remove region
  const N = width * height;
  const isMasked = new Uint8Array(N);
  const dist = new Float32Array(N);
  dist.fill(1e9);

  // BFS queue seeded with boundary pixels (masked pixels adjacent to known pixels)
  const queue: number[] = [];
  for (let i = 0; i < N; i++) {
    if (msk[i * 4] > 128) {
      isMasked[i] = 1;
    }
  }

  // Seed: every masked pixel that has at least one non-masked 4-neighbor
  for (let i = 0; i < N; i++) {
    if (!isMasked[i]) continue;
    const x = i % width;
    const y = (i - x) / width;
    let onBoundary = false;
    if (x > 0 && !isMasked[i - 1]) onBoundary = true;
    if (x < width - 1 && !isMasked[i + 1]) onBoundary = true;
    if (y > 0 && !isMasked[i - width]) onBoundary = true;
    if (y < height - 1 && !isMasked[i + width]) onBoundary = true;
    if (onBoundary) {
      dist[i] = 1;
      queue.push(i);
    }
  }

  // BFS to compute distance from boundary for every masked pixel
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    const nd = dist[i] + 1;
    const neighbors = [];
    if (x > 0) neighbors.push(i - 1);
    if (x < width - 1) neighbors.push(i + 1);
    if (y > 0) neighbors.push(i - width);
    if (y < height - 1) neighbors.push(i + width);
    for (const ni of neighbors) {
      if (isMasked[ni] && dist[ni] > nd) {
        dist[ni] = nd;
        queue.push(ni);
      }
    }
  }

  // ── Step 2: Sort masked pixels by distance (process boundary-adjacent first) ──
  const sortedMasked = queue.slice(); // queue already has all masked pixels
  sortedMasked.sort((a, b) => dist[a] - dist[b]);

  // ── Step 3: Fill each masked pixel using weighted average of nearby KNOWN pixels ──
  // Process in distance order so inner pixels can use previously-filled outer pixels.
  // Mark filled pixels as "known" so they contribute to filling deeper pixels.
  const filled = new Uint8Array(N);
  // Copy known status: non-masked pixels are already known
  for (let i = 0; i < N; i++) {
    if (!isMasked[i]) filled[i] = 1;
  }

  for (const idx of sortedMasked) {
    const cx = idx % width;
    const cy = (idx - cx) / width;

    let totalW = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    const x0 = Math.max(0, cx - radius);
    const x1 = Math.min(width - 1, cx + radius);
    const y0 = Math.max(0, cy - radius);
    const y1 = Math.min(height - 1, cy + radius);

    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const ni = yy * width + xx;
        if (!filled[ni]) continue; // skip pixels we haven't filled yet

        const dx = xx - cx;
        const dy = yy - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 === 0 || d2 > radius * radius) continue;

        // Weight: inverse square distance — closer pixels matter more
        const w = 1.0 / d2;
        const off = ni * 4;
        sumR += out[off] * w;
        sumG += out[off + 1] * w;
        sumB += out[off + 2] * w;
        totalW += w;
      }
    }

    if (totalW > 0) {
      const off = idx * 4;
      out[off] = Math.round(sumR / totalW);
      out[off + 1] = Math.round(sumG / totalW);
      out[off + 2] = Math.round(sumB / totalW);
      out[off + 3] = 255;
    }
    filled[idx] = 1; // now this pixel is known for deeper neighbors
  }

  return new ImageData(out, width, height);
}

// ---------------------------------------------------------------------------
// 2d. Box-select extraction (replaces magic-wand click for element removal)
// ---------------------------------------------------------------------------
//
// User draws a rectangle over the element they want removed. Everything inside
// the box = mask. No color tolerance needed, no BFS — just a clean rectangle.
// Dramatically simpler and more predictable than the magic wand approach.

export interface BoxExtractResult {
  /** Tight-cropped content from inside the box as a transparent PNG blob */
  extractedBlob: Blob;
  /** ObjectURL preview */
  extractedPreviewUrl: string;
  /** Box coordinates in source-image pixel space */
  bbox: { x: number; y: number; w: number; h: number };
  /** Source with the box region inpainted using FMM */
  patchedSourceBlob: Blob;
}

/**
 * Extract everything inside a drawn box and inpaint the region.
 *
 * @param source  Full source image
 * @param x1Pct  Left edge as fraction 0-1
 * @param y1Pct  Top edge as fraction 0-1
 * @param x2Pct  Right edge as fraction 0-1
 * @param y2Pct  Bottom edge as fraction 0-1
 * @param dilate  Extra pixels to add around the box for anti-aliased edge cleanup
 */
export async function boxExtract(
  source: ImageData,
  x1Pct: number,
  y1Pct: number,
  x2Pct: number,
  y2Pct: number,
  dilate = 3,
): Promise<BoxExtractResult | null> {
  const { width, height, data } = source;

  // Normalize so x1 < x2, y1 < y2
  const left = Math.max(0, Math.round(Math.min(x1Pct, x2Pct) * width) - dilate);
  const top = Math.max(0, Math.round(Math.min(y1Pct, y2Pct) * height) - dilate);
  const right = Math.min(width - 1, Math.round(Math.max(x1Pct, x2Pct) * width) + dilate);
  const bottom = Math.min(height - 1, Math.round(Math.max(y1Pct, y2Pct) * height) + dilate);

  const boxW = right - left + 1;
  const boxH = bottom - top + 1;
  if (boxW < 8 || boxH < 8) return null; // too small to be meaningful

  // Build the extracted layer (crop of the box region)
  const cropData = new ImageData(boxW, boxH);
  const cropPx = cropData.data;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const srcOff = (y * width + x) * 4;
      const dstOff = ((y - top) * boxW + (x - left)) * 4;
      cropPx[dstOff] = data[srcOff];
      cropPx[dstOff + 1] = data[srcOff + 1];
      cropPx[dstOff + 2] = data[srcOff + 2];
      cropPx[dstOff + 3] = 255;
    }
  }
  const extractedBlob = await imageDataToPngBlob(cropData);
  const extractedPreviewUrl = URL.createObjectURL(extractedBlob);

  // Build mask (white = remove, black = keep)
  const maskData = new ImageData(width, height);
  const maskPx = maskData.data;
  for (let i = 0; i < width * height; i++) {
    maskPx[i * 4] = 0;
    maskPx[i * 4 + 1] = 0;
    maskPx[i * 4 + 2] = 0;
    maskPx[i * 4 + 3] = 255;
  }
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const off = (y * width + x) * 4;
      maskPx[off] = 255;
      maskPx[off + 1] = 255;
      maskPx[off + 2] = 255;
    }
  }

  // FMM inpaint the box region
  const patched = fmmInpaint(source, maskData);
  const patchedSourceBlob = await imageDataToPngBlob(patched);

  return {
    extractedBlob,
    extractedPreviewUrl,
    bbox: { x: left, y: top, w: boxW, h: boxH },
    patchedSourceBlob,
  };
}

// ---------------------------------------------------------------------------
// 2c. Cross-view color signature match (for "remove from all sides?" popup)
// ---------------------------------------------------------------------------

/**
 * Scan a target image for the largest connected region whose color matches
 * the given base RGB within tolerance. Returns the click coordinates of the
 * center of that region (so callers can pass it straight to magicWandExtract)
 * or null if no significant region was found.
 *
 * Used after a wand extraction on one view to auto-find the same element on
 * sibling views without making the user click again.
 *
 * Approach: scan every pixel, when we find an unvisited pixel within color
 * tolerance, BFS the connected component, track size, keep the biggest one.
 * Pure pixel walk, runs in <300ms on a 4K image.
 */
export function findRegionByColorSignature(
  target: ImageData,
  base: { r: number; g: number; b: number },
  tolerance = 28,
  minSize = 64,
): { centerX: number; centerY: number; size: number } | null {
  const { width, height, data } = target;
  const tolSq = tolerance * tolerance;
  const visited = new Uint8Array(width * height);

  let bestCx = -1;
  let bestCy = -1;
  let bestSize = 0;

  function colorMatches(idx: number): boolean {
    const off = idx * 4;
    const dr = data[off] - base.r;
    const dg = data[off + 1] - base.g;
    const db = data[off + 2] - base.b;
    return dr * dr + dg * dg + db * db <= tolSq;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const startIdx = y * width + x;
      if (visited[startIdx]) continue;
      if (!colorMatches(startIdx)) {
        visited[startIdx] = 1;
        continue;
      }

      // BFS this component
      const queue: number[] = [startIdx];
      visited[startIdx] = 1;
      let size = 0;
      let sumX = 0;
      let sumY = 0;

      while (queue.length) {
        const idx = queue.shift()!;
        const px = idx % width;
        const py = (idx - px) / width;
        size++;
        sumX += px;
        sumY += py;

        if (px > 0) {
          const n = idx - 1;
          if (!visited[n] && colorMatches(n)) {
            visited[n] = 1;
            queue.push(n);
          }
        }
        if (px < width - 1) {
          const n = idx + 1;
          if (!visited[n] && colorMatches(n)) {
            visited[n] = 1;
            queue.push(n);
          }
        }
        if (py > 0) {
          const n = idx - width;
          if (!visited[n] && colorMatches(n)) {
            visited[n] = 1;
            queue.push(n);
          }
        }
        if (py < height - 1) {
          const n = idx + width;
          if (!visited[n] && colorMatches(n)) {
            visited[n] = 1;
            queue.push(n);
          }
        }
      }

      if (size > bestSize) {
        bestSize = size;
        bestCx = Math.round(sumX / size);
        bestCy = Math.round(sumY / size);
      }
    }
  }

  if (bestSize < minSize) return null;
  return { centerX: bestCx, centerY: bestCy, size: bestSize };
}

// ---------------------------------------------------------------------------
// 3. Compose render + placed layers → single PNG
// ---------------------------------------------------------------------------

const SIZE_FRACTION: Record<LogoSize, number> = {
  // Width of the placed layer as a fraction of the render width
  sm: 0.1,
  md: 0.18,
  lg: 0.28,
};

/**
 * Paint a vehicle render and N placed layers onto one canvas, returning a PNG
 * blob ready for upload. The canvas is sized to the render's native pixels.
 *
 * Layers are anchored at their click point (xPct, yPct), centered on that
 * point, and scaled so their width is SIZE_FRACTION[size] * renderWidth. The
 * layer's intrinsic aspect ratio is preserved.
 */
export async function composeRenderWithLayers(
  renderUrl: string,
  layers: PlacedLayer[],
): Promise<Blob> {
  const renderBitmap = await urlToImageBitmap(renderUrl);
  const w = renderBitmap.width;
  const h = renderBitmap.height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(renderBitmap, 0, 0, w, h);
  renderBitmap.close?.();

  for (const layer of layers) {
    try {
      const layerBitmap = await urlToImageBitmap(layer.cleanedUrl);
      // Prefer the continuous width fraction (what the editor's resize uses);
      // fall back to the discrete size bucket.
      const widthFraction = layer.sizePercent ?? SIZE_FRACTION[layer.size];
      const targetW = widthFraction * w;
      const aspect = layerBitmap.height / layerBitmap.width;
      const targetH = targetW * aspect;
      const cx = layer.xPct * w;
      const cy = layer.yPct * h;
      const rotation = layer.rotationDeg ?? 0;
      if (rotation) {
        // Rotate about the layer's center to match the editor preview.
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(layerBitmap, -targetW / 2, -targetH / 2, targetW, targetH);
        ctx.restore();
      } else {
        ctx.drawImage(layerBitmap, cx - targetW / 2, cy - targetH / 2, targetW, targetH);
      }
      layerBitmap.close?.();
    } catch (err) {
      console.warn(`[logo-composite] Failed to draw layer ${layer.id}:`, err);
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("composite toBlob failed"))),
      "image/png",
    );
  });
}

// ---------------------------------------------------------------------------
// 4. Storage uploads
// ---------------------------------------------------------------------------

/**
 * Upload an extracted layer PNG to wrap-files/logo-layers/{userId}/...
 * Returns the public URL.
 */
export async function uploadLogoAsset(
  blob: Blob,
  userId: string,
  kind: "source" | "cleaned" | "layer",
): Promise<string> {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `logo-layers/${userId}/${ts}-${rand}-${kind}.png`;
  const { error } = await supabase.storage
    .from("wrap-files")
    .upload(path, blob, { contentType: "image/png", upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
  return urlData.publicUrl;
}

/**
 * Upload a composited render+layers PNG to wrap-files/renders/{userId}/logo-composites/...
 * Used as the source image for the revise-render Gemini call.
 */
export async function uploadCompositeRender(
  blob: Blob,
  userId: string,
): Promise<string> {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `renders/${userId}/logo-composites/${ts}-${rand}.png`;
  const { error } = await supabase.storage
    .from("wrap-files")
    .upload(path, blob, { contentType: "image/png", upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
  return urlData.publicUrl;
}

/**
 * Upload a clean (drift-free) background PNG — the AI render with all
 * separated text/logo elements patched out. This is the source of truth
 * for downstream panelization and re-compositing.
 */
export async function uploadCleanBackground(
  blob: Blob,
  userId: string,
): Promise<string> {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `renders/${userId}/clean-bg/${ts}-${rand}.png`;
  const { error } = await supabase.storage
    .from("wrap-files")
    .upload(path, blob, { contentType: "image/png", upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
  return urlData.publicUrl;
}

// ---------------------------------------------------------------------------
// ClipDrop inpaint edge function client
// ---------------------------------------------------------------------------

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunked to avoid stack overflow on large images
  let bin = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)),
    );
  }
  return btoa(bin);
}

/**
 * Call the inpaint-cleanup edge function to get a content-aware filled version
 * of an image with a masked region removed. This is the quality upgrade over
 * the local median-color fill produced by magicWandExtract — ClipDrop's
 * Cleanup endpoint performs real inpainting that matches texture, curvature,
 * and lighting of the surrounding wrap.
 *
 * Returns the public URL of the cleaned image on success.
 * Throws on any failure — the caller should catch and fall back to
 * uploadCleanBackground(magicWandResult.patchedSourceBlob) as a local fallback.
 *
 * Failure modes worth handling gracefully:
 *   - CLIPDROP_API_KEY secret not set on Supabase (503 API_KEY_MISSING)
 *   - ClipDrop upstream error or rate limit (502 UPSTREAM_ERROR)
 *   - Network timeout (~25 sec)
 */
export async function inpaintViaEdgeFunction(
  sourceBlob: Blob,
  maskBlob: Blob,
): Promise<string> {
  const [imageBase64, maskBase64] = await Promise.all([
    blobToBase64(sourceBlob),
    blobToBase64(maskBlob),
  ]);

  const { data, error } = await supabase.functions.invoke("inpaint-cleanup", {
    body: {
      imageBase64,
      maskBase64,
      imageMimeType: sourceBlob.type || "image/png",
    },
  });

  if (error) {
    throw new Error(`inpaint-cleanup edge function failed: ${error.message}`);
  }
  if (!data?.cleanedImageUrl) {
    throw new Error("inpaint-cleanup returned no cleanedImageUrl");
  }
  return data.cleanedImageUrl as string;
}
