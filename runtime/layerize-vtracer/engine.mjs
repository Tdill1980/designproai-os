import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initSync, to_svg } from "./vtracer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
let initialized = false;

function ensureInit() {
  if (initialized) return;
  const base64 = readFileSync(join(__dirname, "vtracer.wasm.b64"), "utf8").replace(/\s+/g, "");
  const wasmBytes = Buffer.from(base64, "base64");
  initSync({ module: wasmBytes });
  initialized = true;
}

/**
 * Fidelity-first preset for Layerize.
 * - no post-trace simplification
 * - one-pixel speckles retained unless VTracer itself proves them empty
 * - maximum practical colour/path precision
 * - deliberately less smoothing than the generic detailed preset
 */
export const PRESET_FIDELITY = Object.freeze({
  binary: false,
  mode: "spline",
  hierarchical: "stacked",
  cornerThreshold: 60,
  lengthThreshold: 2.0,
  maxIterations: 12,
  spliceThreshold: 45,
  filterSpeckle: 1,
  colorPrecision: 8,
  layerDifference: 8,
  pathPrecision: 8,
});

export function vectorizeFidelity(pixels, width, height) {
  ensureInit();
  const expected = width * height * 4;
  if (pixels.byteLength !== expected) {
    throw new Error(
      `layerize vtracer: pixel buffer length ${pixels.byteLength} does not match width*height*4=${expected} (${width}x${height})`,
    );
  }
  return to_svg(pixels, width, height, PRESET_FIDELITY);
}
