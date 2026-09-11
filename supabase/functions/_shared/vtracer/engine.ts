/**
 * vtracer-engine — VTracer WASM wrapper for Supabase Edge Functions
 *
 * Loads the vendored vtracer WASM (visioncortex/vtracer compiled to WebAssembly
 * via wasm-bindgen) once per function instance and exposes `vectorize()` for
 * raster→SVG conversion. Runs fully inside Deno Edge — no external API, no
 * per-call cost, no rate limits.
 *
 * Source: https://github.com/jsscheller/vtracer-wasm (MIT)
 * Upstream: https://github.com/visioncortex/vtracer
 *
 * The .js glue + .wasm binary are vendored in this folder. Because the
 * Supabase Functions bundler only walks static .ts/.js imports and will not
 * include the raw .wasm file in the deployed bundle, the binary is also
 * embedded as base64 in `wasm-base64.ts` and loaded synchronously via
 * `initSync` at first call.
 */

// @ts-ignore — vendored wasm-bindgen glue has no types for initSync default export
import { initSync } from "./vtracer.js";
import { getWasmBytes } from "./wasm-base64.ts";

let initialized = false;

function ensureInit(): void {
  if (initialized) return;
  // @ts-ignore — initSync accepts raw bytes per wasm-bindgen convention
  initSync({ module: getWasmBytes() });
  initialized = true;
}

// ── Config types — camelCase wire format consumed by vtracer-wasm ──
export type VTracerMode = "polygon" | "spline" | "pixel";
export type VTracerHierarchical = "stacked" | "cutout";

export interface VTracerConfig {
  binary: boolean;
  mode: VTracerMode;
  hierarchical: VTracerHierarchical;
  cornerThreshold: number;    // 0-180, sharper corners preserved at lower values
  lengthThreshold: number;    // path segment min length, 3.5 is vtracer default
  maxIterations: number;      // curve fitting iterations, 10 default
  spliceThreshold: number;    // 0-180, 45 default
  filterSpeckle: number;      // min region size in pixels, 4 default
  colorPrecision: number;     // 1-8 bits per channel, 6 default
  layerDifference: number;    // color distance between hierarchical layers, 16 default
  pathPrecision: number;      // decimals of precision in path coords, 8 default
}

// ── Sensible defaults for each preset ──
export const PRESET_LOGO: VTracerConfig = {
  binary: false,
  mode: "spline",
  hierarchical: "stacked",
  cornerThreshold: 60,        // preserve sharp corners on logos
  lengthThreshold: 4.0,
  maxIterations: 10,
  spliceThreshold: 45,
  filterSpeckle: 4,
  colorPrecision: 6,
  layerDifference: 16,
  pathPrecision: 8,
};

export const PRESET_DETAILED: VTracerConfig = {
  binary: false,
  mode: "spline",
  hierarchical: "stacked",
  cornerThreshold: 90,
  lengthThreshold: 4.0,
  maxIterations: 10,
  spliceThreshold: 45,
  filterSpeckle: 4,
  colorPrecision: 7,          // more colors for photo-traced artwork
  layerDifference: 12,
  pathPrecision: 8,
};

export const PRESET_SILHOUETTE: VTracerConfig = {
  binary: true,               // single bi-level trace
  mode: "spline",
  hierarchical: "stacked",
  cornerThreshold: 60,
  lengthThreshold: 4.0,
  maxIterations: 10,
  spliceThreshold: 45,
  filterSpeckle: 6,
  colorPrecision: 6,
  layerDifference: 16,
  pathPrecision: 8,
};

export const PRESET_CENTERLINE: VTracerConfig = {
  binary: true,
  mode: "pixel",              // preserve pixel-accurate strokes
  hierarchical: "cutout",
  cornerThreshold: 60,
  lengthThreshold: 4.0,
  maxIterations: 10,
  spliceThreshold: 45,
  filterSpeckle: 4,
  colorPrecision: 6,
  layerDifference: 16,
  pathPrecision: 8,
};

/**
 * Vectorize raw RGBA pixel data to an SVG string.
 *
 * @param pixels  RGBA buffer, length = width * height * 4
 * @param width   image width in pixels
 * @param height  image height in pixels
 * @param config  VTracer configuration (use a PRESET_* constant or customize)
 * @returns       SVG document as a string
 */
// @ts-ignore — to_svg is a wasm-bindgen export on the glue module
import { to_svg } from "./vtracer.js";

export async function vectorize(
  pixels: Uint8Array,
  width: number,
  height: number,
  config: VTracerConfig = PRESET_LOGO,
): Promise<string> {
  ensureInit();
  const expected = width * height * 4;
  if (pixels.byteLength !== expected) {
    throw new Error(
      `vtracer.vectorize: pixel buffer length ${pixels.byteLength} ` +
      `does not match width*height*4=${expected} (${width}x${height})`,
    );
  }
  const svg: string = to_svg(pixels, width, height, config);
  return svg;
}

/**
 * Decode a PNG/JPEG blob to raw RGBA using imagescript (already a dependency).
 * Returned object is what vectorize() expects.
 */
export async function decodeToRgba(
  bytes: Uint8Array,
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const { Image } = await import("https://deno.land/x/imagescript@1.2.15/mod.ts");
  const img = await Image.decode(bytes);
  // imagescript stores pixels as Uint32 0xRRGGBBAA — convert to RGBA bytes
  const w = img.width;
  const h = img.height;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = img.getPixelAt(x + 1, y + 1);
      const i = (y * w + x) * 4;
      rgba[i]     = (px >> 24) & 0xFF; // R
      rgba[i + 1] = (px >> 16) & 0xFF; // G
      rgba[i + 2] = (px >> 8)  & 0xFF; // B
      rgba[i + 3] = px & 0xFF;         // A
    }
  }
  return { pixels: rgba, width: w, height: h };
}

/**
 * Convenience: bytes (PNG/JPEG) → SVG in one call.
 */
export async function bytesToSvg(
  bytes: Uint8Array,
  config: VTracerConfig = PRESET_LOGO,
): Promise<{ svg: string; width: number; height: number }> {
  const { pixels, width, height } = await decodeToRgba(bytes);
  const svg = await vectorize(pixels, width, height, config);
  return { svg, width, height };
}
