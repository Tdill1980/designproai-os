"use strict";

/**
 * Deterministic Call 8 artboard geometry and Call 9 panel extraction.
 *
 * The artboard is one clean, unlabelled raster that carries all six GENIE
 * production surfaces at exact trim plus five-inch bleed, each at a fixed
 * integer pixel rectangle. The human 2D proof is that same artboard with the
 * dimension overlay drawn on top, so the proof and the artboard share one
 * geometry.
 *
 * Call 9 never asks an image model for anything. It downloads the immutable
 * artboard, cuts each surface out at its recorded rectangle, and refuses the
 * stage unless the cut bytes hash to the value Call 8 recorded. Two surfaces
 * therefore cannot share artwork by accident: they are different regions of
 * one image, and a repeated cut always reproduces the same bytes.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");

const ARTBOARD_CONTRACT = "designpro.deterministic-artboard.v1";
const EXTRACTION_CONTRACT = "designpro.deterministic-artboard-extract.v1";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const BLEED_INCHES = 5;
const MARGIN_INCHES = 4;
const GUTTER_INCHES = 6;
const ARTBOARD_MAX_PIXELS = 48_000_000;
const MIN_SCALE = 6;
const MAX_SCALE = 150;
const PNG_OPTIONS = Object.freeze({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true });

class ArtboardError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizedSurfaces(surfaces) {
  if (!Array.isArray(surfaces) || surfaces.length !== SURFACE_KEYS.length) {
    throw new ArtboardError("artboard_surface_set_invalid", "The artboard requires exactly six GENIE surfaces");
  }
  const byKey = new Map();
  for (const surface of surfaces) {
    const surfaceKey = String(surface?.surfaceKey || surface?.key || "").trim().toLowerCase();
    const trimWidthIn = Number(surface?.widthInches ?? surface?.trimWidthIn);
    const trimHeightIn = Number(surface?.heightInches ?? surface?.trimHeightIn);
    const bleedIn = surface?.bleedIn == null ? BLEED_INCHES : Number(surface.bleedIn);
    if (!SURFACE_KEYS.includes(surfaceKey) || byKey.has(surfaceKey)) {
      throw new ArtboardError("artboard_surface_identity_invalid", `Invalid artboard surface ${surfaceKey || "?"}`);
    }
    if (!(trimWidthIn > 0 && trimHeightIn > 0) || trimWidthIn > 1000 || trimHeightIn > 1000) {
      throw new ArtboardError("artboard_surface_geometry_invalid", `${surfaceKey} trim geometry is not a validated GENIE measurement`);
    }
    if (bleedIn !== BLEED_INCHES) {
      throw new ArtboardError("artboard_bleed_invalid", `${surfaceKey} must carry exactly ${BLEED_INCHES} inches of bleed on every edge`);
    }
    byKey.set(surfaceKey, { surfaceKey, trimWidthIn, trimHeightIn });
  }
  if (SURFACE_KEYS.some((key) => !byKey.has(key))) {
    throw new ArtboardError("artboard_surface_set_incomplete", "The six-surface artboard set is incomplete");
  }
  return SURFACE_KEYS.map((key) => byKey.get(key));
}

/**
 * Pure function of the validated GENIE manifest. The claimant and the runtime
 * both compute it independently and must agree byte for byte.
 */
function artboardLayout(surfaces) {
  const ordered = normalizedSurfaces(surfaces);
  const printWidthsIn = ordered.map((item) => item.trimWidthIn + BLEED_INCHES * 2);
  const printHeightsIn = ordered.map((item) => item.trimHeightIn + BLEED_INCHES * 2);
  const canvasWidthIn = MARGIN_INCHES * 2 + Math.max(...printWidthsIn);
  const canvasHeightIn = MARGIN_INCHES * 2 + printHeightsIn.reduce((total, value) => total + value + GUTTER_INCHES, 0);
  const budgetScale = Math.floor(Math.sqrt(ARTBOARD_MAX_PIXELS / (canvasWidthIn * canvasHeightIn)));
  const scalePxPerInch = Math.min(MAX_SCALE, Math.max(MIN_SCALE, budgetScale));
  if (budgetScale < MIN_SCALE) {
    throw new ArtboardError("artboard_geometry_exceeds_budget", `Validated GENIE geometry needs ${Math.round(canvasWidthIn * canvasHeightIn * MIN_SCALE * MIN_SCALE / 1e6)} MP, above the bounded artboard budget`);
  }
  const marginPx = Math.round(MARGIN_INCHES * scalePxPerInch);
  const gutterPx = Math.round(GUTTER_INCHES * scalePxPerInch);
  const bleedPx = Math.round(BLEED_INCHES * scalePxPerInch);
  let cursor = marginPx;
  const cells = ordered.map((item) => {
    const trimWidthPx = Math.max(1, Math.round(item.trimWidthIn * scalePxPerInch));
    const trimHeightPx = Math.max(1, Math.round(item.trimHeightIn * scalePxPerInch));
    const width = trimWidthPx + bleedPx * 2;
    const height = trimHeightPx + bleedPx * 2;
    cursor += gutterPx;
    const top = cursor;
    cursor += height;
    return {
      surfaceKey: item.surfaceKey,
      x: marginPx, y: top, w: width, h: height,
      bleedPx, trimWidthPx, trimHeightPx,
      trim: { x: marginPx + bleedPx, y: top + bleedPx, w: trimWidthPx, h: trimHeightPx },
      labelBaselineY: top - Math.round(gutterPx * 0.35),
      trimWidthIn: item.trimWidthIn,
      trimHeightIn: item.trimHeightIn,
      bleedIn: BLEED_INCHES,
      printWidthIn: item.trimWidthIn + BLEED_INCHES * 2,
      printHeightIn: item.trimHeightIn + BLEED_INCHES * 2,
      surfaceSqFt: round2(item.trimWidthIn * item.trimHeightIn / 144),
    };
  });
  const width = marginPx * 2 + Math.max(...cells.map((cell) => cell.w));
  const height = cursor + marginPx;
  if (width * height > ARTBOARD_MAX_PIXELS * 1.35) {
    throw new ArtboardError("artboard_geometry_exceeds_budget", "Resolved artboard raster exceeds the bounded worker budget");
  }
  return {
    contract: ARTBOARD_CONTRACT,
    scalePxPerInch, width, height, marginPx, gutterPx, bleedInches: BLEED_INCHES,
    cells,
    totalSqFt: round2(cells.reduce((total, cell) => total + cell.trimWidthIn * cell.trimHeightIn / 144, 0)),
  };
}

function layoutIdentity(layout) {
  return sha256(Buffer.from(JSON.stringify({
    contract: layout.contract, scalePxPerInch: layout.scalePxPerInch,
    width: layout.width, height: layout.height,
    cells: layout.cells.map((cell) => [cell.surfaceKey, cell.x, cell.y, cell.w, cell.h, cell.trimWidthIn, cell.trimHeightIn, cell.bleedIn]),
  })));
}

/**
 * Refuses a caller-supplied layout that is not the exact recomputation of the
 * validated GENIE manifest. Geometry is never taken on trust.
 */
function assertLayoutMatches(claimed, surfaces) {
  const expected = artboardLayout(surfaces);
  if (!claimed || typeof claimed !== "object") throw new ArtboardError("artboard_layout_missing", "Call 8 requires the deterministic artboard layout");
  if (layoutIdentity(expected) !== layoutIdentity(claimed)) {
    throw new ArtboardError("artboard_layout_drift", "Supplied artboard layout is not the deterministic layout of the validated GENIE manifest");
  }
  return expected;
}

function cellFor(layout, surfaceKey) {
  const cell = layout.cells.find((item) => item.surfaceKey === surfaceKey);
  if (!cell) throw new ArtboardError("artboard_cell_missing", `${surfaceKey} has no artboard cell`);
  return cell;
}

function assertCellInside(layout, cell) {
  if (!(cell.x >= 0 && cell.y >= 0 && cell.w > 0 && cell.h > 0 && cell.x + cell.w <= layout.width && cell.y + cell.h <= layout.height)) {
    throw new ArtboardError("artboard_cell_out_of_bounds", `${cell.surfaceKey} rectangle falls outside the artboard`);
  }
}

/**
 * The only Call 9 operation. No resampling, no healing, no model: an exact
 * pixel cut of the immutable artboard, encoded with fixed PNG options.
 */
async function extractPanel(artboardBytes, layout, surfaceKey) {
  const cell = cellFor(layout, surfaceKey);
  assertCellInside(layout, cell);
  const image = sharp(artboardBytes, { limitInputPixels: false });
  const metadata = await image.metadata();
  if (metadata.width !== layout.width || metadata.height !== layout.height) {
    throw new ArtboardError("artboard_raster_drift", `Artboard raster is ${metadata.width}x${metadata.height}, not the recorded ${layout.width}x${layout.height}`);
  }
  const bytes = await image
    .extract({ left: cell.x, top: cell.y, width: cell.w, height: cell.h })
    .removeAlpha()
    .png(PNG_OPTIONS)
    .toBuffer();
  return { surfaceKey, cell, bytes, contentHash: sha256(bytes), byteSize: bytes.length };
}

async function extractAllPanels(artboardBytes, layout) {
  const panels = [];
  for (const cell of layout.cells) panels.push(await extractPanel(artboardBytes, layout, cell.surfaceKey));
  if (new Set(panels.map((panel) => panel.contentHash)).size !== panels.length) {
    throw new ArtboardError("artboard_panel_reuse", "Two artboard regions produced identical panel bytes");
  }
  return panels;
}

/**
 * A 64-bit mean fingerprint of the panel content. Two surfaces whose artwork
 * is visually the same collapse to the same fingerprint even when their bytes
 * differ, which is exactly the failure that shipped AI-healed driver artwork
 * onto every side.
 */
async function perceptualFingerprint(bytes) {
  const raw = await sharp(bytes, { limitInputPixels: false })
    .removeAlpha().greyscale().resize(8, 8, { fit: "fill", kernel: "lanczos3" })
    .raw().toBuffer();
  const average = raw.reduce((total, value) => total + value, 0) / raw.length;
  let fingerprint = "";
  for (let index = 0; index < raw.length; index += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit += 1) if (raw[index + bit] >= average) nibble |= 1 << bit;
    fingerprint += nibble.toString(16);
  }
  return fingerprint;
}

async function assertSurfacesAreDistinct(panels) {
  const fingerprints = new Map();
  for (const panel of panels) {
    const fingerprint = await perceptualFingerprint(panel.bytes);
    const clash = [...fingerprints.entries()].find(([, value]) => value === fingerprint);
    if (clash) {
      throw new ArtboardError("artboard_surface_artwork_reused", `${panel.surfaceKey} carries the same artwork as ${clash[0]}`);
    }
    fingerprints.set(panel.surfaceKey, fingerprint);
  }
  return Object.fromEntries(fingerprints);
}

module.exports = {
  ARTBOARD_CONTRACT,
  ARTBOARD_MAX_PIXELS,
  BLEED_INCHES,
  EXTRACTION_CONTRACT,
  MAX_SCALE,
  MIN_SCALE,
  PNG_OPTIONS,
  SURFACE_KEYS,
  ArtboardError,
  artboardLayout,
  assertLayoutMatches,
  assertSurfacesAreDistinct,
  cellFor,
  extractAllPanels,
  extractPanel,
  layoutIdentity,
  perceptualFingerprint,
  _test: { normalizedSurfaces, round2, sha256 },
};
