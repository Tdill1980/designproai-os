/**
 * bilinear-sampler.ts — Sub-pixel Image Sampling
 *
 * Reads pixels from a source image at fractional coordinates
 * using bilinear interpolation for smooth, alias-free results.
 *
 * Works with ImageScript's RGBA pixel format (32-bit packed).
 *
 * No external dependencies.
 */

/**
 * Sample a pixel at fractional coordinates using bilinear interpolation.
 *
 * @param pixels - Raw RGBA pixel data as Uint32Array (1 uint32 per pixel)
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param sx - Fractional x coordinate in source image
 * @param sy - Fractional y coordinate in source image
 * @returns RGBA packed as uint32 (0xRRGGBBAA)
 */
export function sampleBilinear(
  pixels: Uint32Array,
  width: number,
  height: number,
  sx: number,
  sy: number,
): number {
  // Clamp to image bounds
  if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) {
    // Edge: clamp coordinates
    sx = Math.max(0, Math.min(width - 1.001, sx));
    sy = Math.max(0, Math.min(height - 1.001, sy));
  }

  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);

  const fx = sx - x0; // fractional x (0-1)
  const fy = sy - y0; // fractional y (0-1)

  // Four neighbor pixels
  const p00 = pixels[y0 * width + x0];
  const p10 = pixels[y0 * width + x1];
  const p01 = pixels[y1 * width + x0];
  const p11 = pixels[y1 * width + x1];

  // Interpolate each channel separately
  const r = bilerp(
    (p00 >>> 24) & 0xFF, (p10 >>> 24) & 0xFF,
    (p01 >>> 24) & 0xFF, (p11 >>> 24) & 0xFF,
    fx, fy,
  );
  const g = bilerp(
    (p00 >>> 16) & 0xFF, (p10 >>> 16) & 0xFF,
    (p01 >>> 16) & 0xFF, (p11 >>> 16) & 0xFF,
    fx, fy,
  );
  const b = bilerp(
    (p00 >>> 8) & 0xFF, (p10 >>> 8) & 0xFF,
    (p01 >>> 8) & 0xFF, (p11 >>> 8) & 0xFF,
    fx, fy,
  );
  const a = bilerp(
    p00 & 0xFF, p10 & 0xFF,
    p01 & 0xFF, p11 & 0xFF,
    fx, fy,
  );

  return ((r & 0xFF) << 24) | ((g & 0xFF) << 16) | ((b & 0xFF) << 8) | (a & 0xFF);
}

/**
 * Bilinear interpolation of 4 values.
 * p00--p10
 *  |    |
 * p01--p11
 */
function bilerp(
  p00: number, p10: number,
  p01: number, p11: number,
  fx: number, fy: number,
): number {
  const top = p00 + (p10 - p00) * fx;
  const bot = p01 + (p11 - p01) * fx;
  return Math.round(top + (bot - top) * fy);
}

/**
 * Extract raw RGBA pixel data from an ImageScript Image as Uint32Array.
 * ImageScript stores pixels as RGBA packed uint32 (big-endian: 0xRRGGBBAA).
 *
 * @param img - ImageScript Image instance
 * @returns Uint32Array of packed RGBA pixels
 */
export function imageToPixels(img: any): Uint32Array {
  const w = img.width;
  const h = img.height;
  const pixels = new Uint32Array(w * h);
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      pixels[(y - 1) * w + (x - 1)] = img.getPixelAt(x, y);
    }
  }
  return pixels;
}

/**
 * Write RGBA pixel data back into an ImageScript Image.
 *
 * @param img - ImageScript Image instance (must be pre-allocated to correct size)
 * @param pixels - Uint32Array of packed RGBA pixels
 */
export function pixelsToImage(img: any, pixels: Uint32Array): void {
  const w = img.width;
  const h = img.height;
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      img.setPixelAt(x, y, pixels[(y - 1) * w + (x - 1)]);
    }
  }
}
