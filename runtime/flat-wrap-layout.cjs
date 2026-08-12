"use strict";

/**
 * The Call 8 flat wrap layout and the Call 9 cut map.
 *
 * Call 8 authors ONE continuous flat 2D design for the whole vehicle, the way
 * a wrap is actually drawn: a single graphic running across a template. Call 9
 * then cuts the six production panels straight out of it at fixed rectangles,
 * each the validated GENIE trim plus five inches of bleed on all four edges.
 *
 * Because the design is continuous, every rectangle is a valid piece of it: no
 * image model has to honour cell boundaries, and no panel is ever regenerated.
 * Cut the same layout twice and the bytes are identical, which is what makes
 * the downstream chain checkable rather than merely repeated.
 *
 * The cut panels are the print-ready BASE. Customer logos are composited on
 * top from the frozen Call 10 inventory; they are never drawn into the base.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");

const LAYOUT_CONTRACT = "designpro.flat-wrap-layout.v1";
const EXTRACTION_CONTRACT = "designpro.flat-wrap-cut.v1";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
// Fixed packing: the two long sides on their own rows, then the smaller
// surfaces two-up. Fixed, never derived from the data, so the same vehicle
// always yields the same rectangles.
const ROWS = Object.freeze([["driver"], ["passenger"], ["hood", "roof"], ["front", "rear"]]);
const BLEED_INCHES = 5;
const MARGIN_INCHES = 2;
const GUTTER_INCHES = 2;
const LAYOUT_MAX_PIXELS = 48_000_000;
const MIN_SCALE = 6;
const MAX_SCALE = 150;
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });

class LayoutError extends Error {
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
    throw new LayoutError("layout_surface_set_invalid", "The flat wrap layout requires exactly six GENIE surfaces");
  }
  const byKey = new Map();
  for (const surface of surfaces) {
    const surfaceKey = String(surface?.surfaceKey || surface?.key || "").trim().toLowerCase();
    const trimWidthIn = Number(surface?.widthInches ?? surface?.trimWidthIn);
    const trimHeightIn = Number(surface?.heightInches ?? surface?.trimHeightIn);
    const bleedIn = surface?.bleedIn == null ? BLEED_INCHES : Number(surface.bleedIn);
    if (!SURFACE_KEYS.includes(surfaceKey) || byKey.has(surfaceKey)) {
      throw new LayoutError("layout_surface_identity_invalid", `Invalid layout surface ${surfaceKey || "?"}`);
    }
    if (!(trimWidthIn > 0 && trimHeightIn > 0) || trimWidthIn > 1000 || trimHeightIn > 1000) {
      throw new LayoutError("layout_surface_geometry_invalid", `${surfaceKey} trim geometry is not a validated GENIE measurement`);
    }
    if (bleedIn !== BLEED_INCHES) {
      throw new LayoutError("layout_bleed_invalid", `${surfaceKey} must carry exactly ${BLEED_INCHES} inches of bleed on every edge`);
    }
    byKey.set(surfaceKey, {
      surfaceKey, trimWidthIn, trimHeightIn,
      printWidthIn: trimWidthIn + BLEED_INCHES * 2,
      printHeightIn: trimHeightIn + BLEED_INCHES * 2,
    });
  }
  if (SURFACE_KEYS.some((key) => !byKey.has(key))) {
    throw new LayoutError("layout_surface_set_incomplete", "The six-surface layout set is incomplete");
  }
  return byKey;
}

/**
 * Pure function of the validated GENIE manifest. The claimant and the runtime
 * derive it independently and refuse the call if they disagree.
 */
function flatWrapLayout(surfaces) {
  const byKey = normalizedSurfaces(surfaces);
  const rowWidthsIn = ROWS.map((row) => row.reduce((total, key, index) => total + byKey.get(key).printWidthIn + (index ? GUTTER_INCHES : 0), 0));
  const rowHeightsIn = ROWS.map((row) => Math.max(...row.map((key) => byKey.get(key).printHeightIn)));
  const canvasWidthIn = MARGIN_INCHES * 2 + Math.max(...rowWidthsIn);
  const canvasHeightIn = MARGIN_INCHES * 2 + rowHeightsIn.reduce((total, value, index) => total + value + (index ? GUTTER_INCHES : 0), 0);
  const budgetScale = Math.floor(Math.sqrt(LAYOUT_MAX_PIXELS / (canvasWidthIn * canvasHeightIn)));
  if (budgetScale < MIN_SCALE) {
    throw new LayoutError("layout_geometry_exceeds_budget", "Validated GENIE geometry exceeds the bounded flat-layout raster budget");
  }
  const scalePxPerInch = Math.min(MAX_SCALE, budgetScale);
  const marginPx = Math.round(MARGIN_INCHES * scalePxPerInch);
  const gutterPx = Math.round(GUTTER_INCHES * scalePxPerInch);
  const bleedPx = Math.round(BLEED_INCHES * scalePxPerInch);
  const cells = [];
  let top = marginPx;
  for (const row of ROWS) {
    let left = marginPx;
    let rowHeight = 0;
    for (const key of row) {
      const surface = byKey.get(key);
      const trimWidthPx = Math.max(1, Math.round(surface.trimWidthIn * scalePxPerInch));
      const trimHeightPx = Math.max(1, Math.round(surface.trimHeightIn * scalePxPerInch));
      const w = trimWidthPx + bleedPx * 2;
      const h = trimHeightPx + bleedPx * 2;
      cells.push({
        surfaceKey: key, x: left, y: top, w, h,
        bleedPx, trimWidthPx, trimHeightPx,
        trim: { x: left + bleedPx, y: top + bleedPx, w: trimWidthPx, h: trimHeightPx },
        trimWidthIn: surface.trimWidthIn, trimHeightIn: surface.trimHeightIn, bleedIn: BLEED_INCHES,
        printWidthIn: surface.printWidthIn, printHeightIn: surface.printHeightIn,
        surfaceSqFt: round2(surface.trimWidthIn * surface.trimHeightIn / 144),
      });
      left += w + gutterPx;
      rowHeight = Math.max(rowHeight, h);
    }
    top += rowHeight + gutterPx;
  }
  const width = marginPx * 2 + Math.max(...ROWS.map((row) => row.reduce((total, key, index) => {
    const cell = cells.find((item) => item.surfaceKey === key);
    return total + cell.w + (index ? gutterPx : 0);
  }, 0)));
  const height = top - gutterPx + marginPx;
  const ordered = SURFACE_KEYS.map((key) => cells.find((cell) => cell.surfaceKey === key));
  for (const cell of ordered) {
    if (!(cell.x >= 0 && cell.y >= 0 && cell.x + cell.w <= width && cell.y + cell.h <= height)) {
      throw new LayoutError("layout_cell_out_of_bounds", `${cell.surfaceKey} rectangle falls outside the flat layout`);
    }
  }
  return {
    contract: LAYOUT_CONTRACT,
    scalePxPerInch, width, height, marginPx, gutterPx, bleedInches: BLEED_INCHES,
    canvasWidthIn: round2(canvasWidthIn), canvasHeightIn: round2(canvasHeightIn),
    cells: ordered,
    totalSqFt: round2(ordered.reduce((total, cell) => total + cell.trimWidthIn * cell.trimHeightIn / 144, 0)),
  };
}

function layoutIdentity(layout) {
  return sha256(Buffer.from(JSON.stringify({
    contract: layout.contract, scalePxPerInch: layout.scalePxPerInch,
    width: layout.width, height: layout.height,
    cells: layout.cells.map((cell) => [cell.surfaceKey, cell.x, cell.y, cell.w, cell.h, cell.trimWidthIn, cell.trimHeightIn, cell.bleedIn]),
  })));
}

function assertLayoutMatches(claimed, surfaces) {
  const expected = flatWrapLayout(surfaces);
  if (!claimed || typeof claimed !== "object") throw new LayoutError("layout_missing", "Call 8 requires the deterministic flat wrap layout");
  if (layoutIdentity(expected) !== layoutIdentity(claimed)) {
    throw new LayoutError("layout_drift", "Supplied flat wrap layout is not the deterministic layout of the validated GENIE manifest");
  }
  return expected;
}

/**
 * Normalises whatever the image model returned into the exact layout canvas.
 * Deterministic: fixed resampler, fixed geometry, no cropping decisions.
 */
async function normalizeGeneratedLayout(bytes, layout) {
  const image = sharp(bytes, { limitInputPixels: false });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width < 512 || metadata.height < 512) {
    throw new LayoutError("layout_render_too_small", "The generated flat wrap layout is missing or too small");
  }
  const aspect = metadata.width / metadata.height;
  const expectedAspect = layout.width / layout.height;
  if (Math.abs(aspect - expectedAspect) / expectedAspect > 0.12) {
    throw new LayoutError("layout_render_aspect_drift", `The generated layout is ${aspect.toFixed(3)}:1, too far from the required ${expectedAspect.toFixed(3)}:1`);
  }
  return image
    .resize(layout.width, layout.height, { fit: "fill", kernel: "lanczos3" })
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .png(PNG_OPTIONS)
    .toBuffer();
}

/**
 * The only Call 9 operation: an exact pixel cut of the immutable flat layout.
 * No resampling, no healing, no model.
 */
async function cutPanel(layoutBytes, layout, surfaceKey) {
  const cell = layout.cells.find((item) => item.surfaceKey === surfaceKey);
  if (!cell) throw new LayoutError("layout_cell_missing", `${surfaceKey} has no layout rectangle`);
  const image = sharp(layoutBytes, { limitInputPixels: false });
  const metadata = await image.metadata();
  if (metadata.width !== layout.width || metadata.height !== layout.height) {
    throw new LayoutError("layout_raster_drift", `Flat layout raster is ${metadata.width}x${metadata.height}, not the recorded ${layout.width}x${layout.height}`);
  }
  const bytes = await image
    .extract({ left: cell.x, top: cell.y, width: cell.w, height: cell.h })
    .removeAlpha()
    .png(PNG_OPTIONS)
    .toBuffer();
  return { surfaceKey, cell, bytes, contentHash: sha256(bytes), byteSize: bytes.length };
}

async function cutAllPanels(layoutBytes, layout) {
  const panels = [];
  for (const cell of layout.cells) panels.push(await cutPanel(layoutBytes, layout, cell.surfaceKey));
  if (new Set(panels.map((panel) => panel.contentHash)).size !== panels.length) {
    throw new LayoutError("layout_panel_reuse", "Two layout rectangles produced identical panel bytes");
  }
  return panels;
}

/**
 * A 64-bit mean fingerprint. Two surfaces whose artwork is visually the same
 * collapse to the same fingerprint even when their bytes differ, which is the
 * failure that shipped driver artwork onto every side.
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
    if (clash) throw new LayoutError("layout_surface_artwork_reused", `${panel.surfaceKey} carries the same artwork as ${clash[0]}`);
    fingerprints.set(panel.surfaceKey, fingerprint);
  }
  return Object.fromEntries(fingerprints);
}

module.exports = {
  BLEED_INCHES,
  EXTRACTION_CONTRACT,
  LAYOUT_CONTRACT,
  LAYOUT_MAX_PIXELS,
  MAX_SCALE,
  MIN_SCALE,
  PNG_OPTIONS,
  ROWS,
  SURFACE_KEYS,
  LayoutError,
  assertLayoutMatches,
  assertSurfacesAreDistinct,
  cutAllPanels,
  cutPanel,
  flatWrapLayout,
  layoutIdentity,
  normalizeGeneratedLayout,
  perceptualFingerprint,
  _test: { normalizedSurfaces, round2, sha256 },
};
