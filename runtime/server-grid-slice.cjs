"use strict";

/**
 * Server-native port of panel-artboard-generator step:"gridslice".
 *
 * The input is the immutable clean artboard authored at Call 8. Each output is
 * a pure geometric cover crop at the exact GENIE trim aspect, followed by the
 * required five-inch mirrored bleed. There is no model, prompt, vision lookup,
 * repair pass, or per-side regeneration in this module.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");

const GRID_SLICE_CONTRACT = "designpro.panel-artboard-generator.gridslice.server.v1";
const BLEED_INCHES = 5;
const MAX_CANVAS = 4000;
const MAX_PPI = 150;
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });

class GridSliceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "GridSliceError";
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function positive(value, label) {
  const number = Number(value);
  if (!(number > 0) || !Number.isFinite(number)) {
    throw new GridSliceError("gridslice_geometry_invalid", `${label} must be a positive finite number`);
  }
  return number;
}

function coverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight, anchor = "center") {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const resizedWidth = Math.max(targetWidth, Math.ceil(sourceWidth * scale));
  const resizedHeight = Math.max(targetHeight, Math.ceil(sourceHeight * scale));
  const left = Math.max(0, Math.min(resizedWidth - targetWidth, Math.floor((resizedWidth - targetWidth) / 2)));
  const top = anchor === "top"
    ? 0
    : Math.max(0, Math.min(resizedHeight - targetHeight, Math.floor((resizedHeight - targetHeight) / 2)));
  return { resizedWidth, resizedHeight, left, top, width: targetWidth, height: targetHeight };
}

async function boundedArtboard(bytes, maxCanvas) {
  const input = sharp(bytes, { limitInputPixels: false }).rotate().flatten({ background: "#ffffff" });
  const metadata = await input.metadata();
  if (!metadata.width || !metadata.height) {
    throw new GridSliceError("gridslice_artboard_unreadable", "Call 8 clean artboard is not a decodable raster");
  }
  if (metadata.width <= maxCanvas && metadata.height <= maxCanvas) {
    return { bytes: await input.png(PNG_OPTIONS).toBuffer(), width: metadata.width, height: metadata.height };
  }
  const resized = await input
    .resize({ width: maxCanvas, height: maxCanvas, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .png(PNG_OPTIONS)
    .toBuffer();
  const bounded = await sharp(resized, { limitInputPixels: false }).metadata();
  return { bytes: resized, width: bounded.width, height: bounded.height };
}

async function gridSlicePanel(artboardBytes, surface, options = {}) {
  const surfaceKey = String(surface?.surfaceKey || surface?.key || "").trim().toLowerCase();
  if (!surfaceKey) throw new GridSliceError("gridslice_surface_missing", "surfaceKey is required");
  const trimWidthIn = positive(surface?.widthInches ?? surface?.trimWidthIn, `${surfaceKey} trim width`);
  const trimHeightIn = positive(surface?.heightInches ?? surface?.trimHeightIn, `${surfaceKey} trim height`);
  const bleedIn = options.bleedInches == null ? BLEED_INCHES : positive(options.bleedInches, "bleedInches");
  if (bleedIn !== BLEED_INCHES) {
    throw new GridSliceError("gridslice_bleed_invalid", `production gridslice requires exactly ${BLEED_INCHES} inches of bleed`);
  }
  const maxCanvas = Math.min(MAX_CANVAS, Math.max(1500, Math.floor(Number(options.maxCanvas) || MAX_CANVAS)));
  const printWidthIn = trimWidthIn + bleedIn * 2;
  const printHeightIn = trimHeightIn + bleedIn * 2;
  const ppi = Math.min(MAX_PPI, maxCanvas / Math.max(printWidthIn, printHeightIn));
  const bleedPx = Math.max(1, Math.round(bleedIn * ppi));
  const trimWidthPx = Math.max(1, Math.round(trimWidthIn * ppi));
  const trimHeightPx = Math.max(1, Math.round(trimHeightIn * ppi));
  const artboard = await boundedArtboard(artboardBytes, maxCanvas);
  const crop = coverCrop(artboard.width, artboard.height, trimWidthPx, trimHeightPx, options.cropAnchor === "top" ? "top" : "center");
  const trim = await sharp(artboard.bytes, { limitInputPixels: false })
    .resize(crop.resizedWidth, crop.resizedHeight, { fit: "fill", kernel: "lanczos3" })
    .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
    .png(PNG_OPTIONS)
    .toBuffer();
  const bytes = await sharp(trim, { limitInputPixels: false })
    .extend({ top: bleedPx, bottom: bleedPx, left: bleedPx, right: bleedPx, extendWith: "mirror" })
    .removeAlpha()
    .png(PNG_OPTIONS)
    .withMetadata({ density: Math.max(1, Math.round(ppi)) })
    .toBuffer();
  const metadata = await sharp(bytes, { limitInputPixels: false }).metadata();
  return Object.freeze({
    contract: GRID_SLICE_CONTRACT,
    deterministic: true,
    step: "gridslice",
    surfaceKey,
    bytes,
    contentHash: sha256(bytes),
    byteSize: bytes.length,
    trimWidthIn,
    trimHeightIn,
    printWidthIn,
    printHeightIn,
    bleedIn: BLEED_INCHES,
    effectivePpi: Math.max(1, Math.round(ppi)),
    pixelWidth: metadata.width,
    pixelHeight: metadata.height,
    sourceCanvas: { width: artboard.width, height: artboard.height, maxCanvas },
    crop,
  });
}

function sourceBytesFor(surfaceSources, surfaceKey) {
  if (Buffer.isBuffer(surfaceSources) || surfaceSources instanceof Uint8Array) {
    return Buffer.from(surfaceSources);
  }
  const entry = surfaceSources instanceof Map
    ? surfaceSources.get(surfaceKey)
    : Array.isArray(surfaceSources)
      ? surfaceSources.find((item) => String(item?.surfaceKey || item?.key || "").toLowerCase() === surfaceKey)
      : surfaceSources?.[surfaceKey];
  const bytes = Buffer.isBuffer(entry) || entry instanceof Uint8Array ? entry : entry?.bytes;
  if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) || !bytes.length) {
    throw new GridSliceError("gridslice_surface_source_missing", `${surfaceKey} own-surface field is required`);
  }
  return Buffer.from(bytes);
}

async function gridSliceAll(surfaceSources, surfaces, options = {}) {
  if (!Array.isArray(surfaces) || surfaces.length !== 6) {
    throw new GridSliceError("gridslice_surface_set_invalid", "exactly six GENIE surfaces are required");
  }
  const outputs = [];
  for (const surface of surfaces) {
    const surfaceKey = String(surface?.surfaceKey || surface?.key || "").trim().toLowerCase();
    const sourceBytes = sourceBytesFor(surfaceSources, surfaceKey);
    const panel = await gridSlicePanel(sourceBytes, surface, options);
    outputs.push(Object.freeze({ ...panel, sourceFieldHash: sha256(sourceBytes) }));
  }
  if (new Set(outputs.map((item) => item.surfaceKey)).size !== outputs.length) {
    throw new GridSliceError("gridslice_surface_identity_reused", "each gridslice output must name one canonical surface");
  }
  if (new Set(outputs.map((item) => item.contentHash)).size !== outputs.length) {
    throw new GridSliceError("gridslice_output_reused", "each gridslice output must have its own byte identity");
  }
  return outputs;
}

module.exports = {
  BLEED_INCHES,
  GRID_SLICE_CONTRACT,
  MAX_CANVAS,
  MAX_PPI,
  GridSliceError,
  gridSliceAll,
  gridSlicePanel,
  _test: { boundedArtboard, coverCrop, positive, sha256, sourceBytesFor },
};
