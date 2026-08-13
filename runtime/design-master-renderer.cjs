"use strict";

/**
 * Phase 2: the deterministic production-surface renderer.
 *
 * Takes a frozen Design Master and produces the six authoritative production
 * surfaces. No model, no inference, no healing. The same master rendered twice
 * yields byte-identical surfaces, which is the whole point: manufacturing truth
 * has to be reproducible, and the retired path could not reproduce anything
 * because its master did not exist until a model invented one.
 *
 * PHASE 2 SCOPE. Rendering only. Nothing here is wired to a stage, no schema
 * changes, and Call 8 still holds production authority until Phase 6.
 *
 * BLEED IS SAMPLED, NOT GENERATED. Every surface is rendered from a window on
 * the shared design space that is already larger than trim by the bleed on all
 * four sides. Artwork in the bleed is the same artwork that continues past the
 * trim line, so a graphic crossing a seam extends correctly instead of being
 * invented at the edge.
 *
 * MIRRORING IS APPLIED TO PLACEMENT, NOT TO THE OUTPUT. A mirrored surface
 * flips each layer's position and each layer's own bitmap, except for objects
 * the contract marks neverMirror — type and logos — whose position mirrors but
 * whose pixels do not. Flipping the finished composite instead would have
 * forced type to be composited last and destroyed z-order.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { placedResolution, SURFACE_KEYS } = require("./design-master.cjs");

const RENDER_CONTRACT = "designpro.production-surface-render.v1";
const DEFAULT_BLEED_INCHES = 5;
// Fixed encoder settings. Any variation here changes bytes without changing
// artwork, which would defeat the reproducibility gate.
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });
const RESAMPLER = "lanczos3";
const VECTOR_DENSITY = 300;

// Contract blend names to libvips operators.
const BLEND_OPERATORS = Object.freeze({
  normal: "over", multiply: "multiply", screen: "screen", overlay: "overlay",
  "soft-light": "soft-light", "hard-light": "hard-light", darken: "darken", lighten: "lighten",
});

class RenderError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "RenderError";
  }
}

function fail(code, message) {
  throw new RenderError(code, message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Layer order is (zOrder, layerId). The identifier tiebreak matters: two layers
 * at the same depth must stack the same way on every run and on every machine,
 * and array order in the master is not a contract.
 */
function orderedLayers(master) {
  return [...master.layers].sort((left, right) => (
    left.zOrder - right.zOrder || (left.layerId < right.layerId ? -1 : left.layerId > right.layerId ? 1 : 0)
  ));
}

function surfaceByKey(master, surfaceKey) {
  const surface = master.designSpace.surfaces.find((item) => item.surfaceKey === surfaceKey);
  if (!surface) fail("render_surface_unknown", `${surfaceKey} is not in the design space`);
  return surface;
}

function indexById(list, key) {
  return new Map(list.map((item) => [item[key], item]));
}

/** The design-space window this surface manufactures, trim plus bleed. */
function surfaceWindow(surface, bleedInches, pxPerInch) {
  const printWidthIn = surface.widthIn + bleedInches * 2;
  const printHeightIn = surface.heightIn + bleedInches * 2;
  return {
    originIn: [surface.originIn[0] - bleedInches, surface.originIn[1] - bleedInches],
    trimWidthIn: surface.widthIn,
    trimHeightIn: surface.heightIn,
    printWidthIn, printHeightIn, bleedInches,
    widthPx: Math.round(printWidthIn * pxPerInch),
    heightPx: Math.round(printHeightIn * pxPerInch),
  };
}

function effectiveLayer(layer, surfaceKey) {
  const override = layer.surfaceOverrides?.[surfaceKey];
  if (!override) return { ...layer, visible: true };
  return {
    ...layer,
    visible: override.visible !== false,
    opacity: override.opacity !== undefined ? override.opacity : layer.opacity,
    transform: { ...layer.transform, ...(override.transform || {}) },
  };
}

function appliesToSurface(layer, surfaceKey) {
  if (layer.space !== "global" && layer.space !== surfaceKey) return false;
  if (Array.isArray(layer.clipTo) && !layer.clipTo.includes(surfaceKey)) return false;
  return true;
}

/** The full design space, bleed included, that global artwork is painted into. */
function designSpaceBounds(master, bleedInches) {
  const surfaces = master.designSpace.surfaces;
  const minX = Math.min(...surfaces.map((s) => s.originIn[0])) - bleedInches;
  const minY = Math.min(...surfaces.map((s) => s.originIn[1])) - bleedInches;
  const maxX = Math.max(...surfaces.map((s) => s.originIn[0] + s.widthIn)) + bleedInches;
  const maxY = Math.max(...surfaces.map((s) => s.originIn[1] + s.heightIn)) + bleedInches;
  return { originIn: [minX, minY], widthIn: maxX - minX, heightIn: maxY - minY };
}

/**
 * How large a layer is, in inches, before its scale is applied.
 *
 * PHASE 2 FINDING. The frozen contract gives a layer a transform but no extent,
 * so a raster layer's size is undefined by v1. Rendering cannot proceed without
 * one, so this is the documented interim rule and `widthIn`/`heightIn` on a
 * layer is a proposed v1.1 amendment rather than something invented silently:
 *
 *   explicit widthIn/heightIn   use them
 *   text                        derived from the text object's sizeIn
 *   global                      the whole design space, so one graphic is
 *                               painted once and every surface samples it
 *   surface-local               that surface's print window
 */
function layerExtentIn(layer, window, bounds, textObjects) {
  if (Number.isFinite(layer.widthIn) && Number.isFinite(layer.heightIn)) return [layer.widthIn, layer.heightIn];
  if (layer.type === "text") {
    const sizeIn = textObjects.get(layer.textId).sizeIn;
    return [sizeIn * String(textObjects.get(layer.textId).string).length * 0.62, sizeIn * 1.35];
  }
  if (layer.space === "global") return [bounds.widthIn, bounds.heightIn];
  return [window.printWidthIn, window.printHeightIn];
}

/**
 * Where a layer lands, in this surface's pixels.
 *
 * A global layer is positioned in shared design-space inches — the same
 * position for every surface, which is what makes one graphic cross a seam. A
 * surface-local layer is positioned relative to its own surface's trim origin.
 */
function placement(layer, surface, window, bounds, pxPerInch) {
  const { x, y } = layer.transform;
  const originXIn = layer.space === "global" ? bounds.originIn[0] + x : surface.originIn[0] + x;
  const originYIn = layer.space === "global" ? bounds.originIn[1] + y : surface.originIn[1] + y;
  return {
    leftPx: Math.round((originXIn - window.originIn[0]) * pxPerInch),
    topPx: Math.round((originYIn - window.originIn[1]) * pxPerInch),
  };
}

async function loadVerifiedAsset(asset, loadAsset) {
  const bytes = await loadAsset(asset);
  if (!Buffer.isBuffer(bytes) || !bytes.length) fail("render_asset_empty", `${asset.assetId} produced no bytes`);
  // The master names an exact file. Anything else is a substitution, and a
  // substituted asset is the same failure as a substituted font.
  if (sha256(bytes) !== asset.contentHash) fail("render_asset_hash_mismatch", `${asset.assetId} bytes do not match the hash the master declares`);
  return bytes;
}

function solidSvg(widthPx, heightPx, colours) {
  if (colours.length === 1) {
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}"><rect width="${widthPx}" height="${heightPx}" fill="${colours[0]}"/></svg>`);
  }
  const stops = colours.map((colour, index) => `<stop offset="${(index / (colours.length - 1)).toFixed(6)}" stop-color="${colour}"/>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs><rect width="${widthPx}" height="${heightPx}" fill="url(#g)"/></svg>`);
}

/**
 * The pixels a single layer contributes, already at its placed size.
 */
async function renderLayerBitmap(layer, context) {
  const { assets, palette, textObjects, pxPerInch, loadAsset, rasterizeText, fonts } = context;
  const widthPx = Math.max(1, Math.round(layer.sizeIn[0] * pxPerInch * layer.transform.scale));
  const heightPx = Math.max(1, Math.round(layer.sizeIn[1] * pxPerInch * layer.transform.scale));

  if (layer.type === "solid" || layer.type === "gradient" || layer.type === "pattern") {
    const colours = layer.colorTokens.map((token) => palette.get(token).srgb);
    return { bytes: await sharp(solidSvg(widthPx, heightPx, colours), { density: VECTOR_DENSITY }).png(PNG_OPTIONS).toBuffer(), widthPx, heightPx };
  }

  if (layer.type === "raster" || layer.type === "vector" || layer.type === "logo") {
    const asset = layer.type === "logo" ? assets.get(context.logoObjects.get(`${layer.space}:${layer.logoIdentityKey}`).assetId) : assets.get(layer.assetId);
    const bytes = await loadVerifiedAsset(asset, loadAsset);
    if (asset.kind === "raster") {
      // A structurally valid master can still be unprintable. The floor is
      // checked at the placed size, on both axes, before any pixels are made.
      const resolution = placedResolution(asset, {
        widthIn: layer.sizeIn[0] * layer.transform.scale,
        heightIn: layer.sizeIn[1] * layer.transform.scale,
        rotate: layer.transform.rotate || 0,
        skew: layer.transform.skew || 0,
      });
      if (!resolution.ok) {
        fail("render_resolution_below_floor",
          `${layer.layerId}: ${asset.assetId} delivers ${resolution.effectivePpi.toFixed(1)} px/in on the ${resolution.limitingAxis} axis, below its declared floor of ${resolution.required}`);
      }
    }
    const pipeline = asset.kind === "vector" ? sharp(bytes, { density: VECTOR_DENSITY }) : sharp(bytes, { limitInputPixels: false });
    return { bytes: await pipeline.resize(widthPx, heightPx, { fit: "fill", kernel: RESAMPLER }).png(PNG_OPTIONS).toBuffer(), widthPx, heightPx };
  }

  if (layer.type === "text") {
    const text = textObjects.get(layer.textId);
    // Fail closed. libvips resolves font-family through fontconfig and silently
    // substitutes: an embedded @font-face data URI is discarded, and a
    // nonexistent family renders identically to a real one. Rasterising type
    // that way would put glyphs into production that are not the glyphs the
    // master specifies — the same class of defect as the mutated domain that
    // motivated this architecture, only harder to notice. A caller must supply
    // a rasteriser that honours the pinned, hashed font file.
    if (typeof rasterizeText !== "function") {
      fail("render_text_rasterizer_required",
        `${layer.layerId} renders the canonical string ${JSON.stringify(text.string)} and no font-honouring text rasteriser was supplied`);
    }
    const font = fonts.get(text.fontId);
    const rendered = await rasterizeText({ text, font, pxPerInch, widthPx, heightPx, layerId: layer.layerId });
    if (!rendered || !Buffer.isBuffer(rendered.bytes) || !rendered.bytes.length) {
      fail("render_text_produced_nothing", `${layer.layerId} rasterised ${JSON.stringify(text.string)} to nothing`);
    }
    return { bytes: rendered.bytes, widthPx: rendered.widthPx || widthPx, heightPx: rendered.heightPx || heightPx };
  }

  return fail("render_layer_type_unsupported", `${layer.layerId} is of unsupported type ${layer.type}`);
}

async function applyMask(layerBytes, layer, context, widthPx, heightPx) {
  if (!layer.mask || layer.mask.type === "none") return layerBytes;
  const asset = context.assets.get(layer.mask.assetId);
  const maskBytes = await loadVerifiedAsset(asset, context.loadAsset);
  const pipeline = asset.kind === "vector" ? sharp(maskBytes, { density: VECTOR_DENSITY }) : sharp(maskBytes, { limitInputPixels: false });
  const mask = await pipeline.resize(widthPx, heightPx, { fit: "fill", kernel: RESAMPLER }).greyscale().toColourspace("b-w").png(PNG_OPTIONS).toBuffer();
  // dest-in keeps the layer only where the mask carries coverage.
  return sharp(layerBytes).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png(PNG_OPTIONS).toBuffer();
}

async function applyOpacity(layerBytes, opacity, widthPx, heightPx) {
  if (opacity >= 1) return layerBytes;
  const veil = await sharp({ create: { width: widthPx, height: heightPx, channels: 4, background: { r: 0, g: 0, b: 0, alpha: opacity } } }).png(PNG_OPTIONS).toBuffer();
  return sharp(layerBytes).ensureAlpha().composite([{ input: veil, blend: "dest-in" }]).png(PNG_OPTIONS).toBuffer();
}

/**
 * One production surface: trim plus bleed, at the target resolution, composed
 * from the master alone.
 */
async function renderSurface(master, surfaceKey, context) {
  const { pxPerInch, bleedInches } = context;
  const surface = surfaceByKey(master, surfaceKey);
  const window = surfaceWindow(surface, bleedInches, pxPerInch);

  const composites = [];
  const layerIds = [];
  const textIdentities = [];
  const logoIdentities = [];

  for (const raw of orderedLayers(master)) {
    if (!appliesToSurface(raw, surfaceKey)) continue;
    const layer = effectiveLayer(raw, surfaceKey);
    if (!layer.visible) continue;

    const sized = { ...layer, sizeIn: layerExtentIn(layer, window, context.bounds, context.textObjects) };

    const bitmap = await renderLayerBitmap(sized, context);
    const masked = await applyMask(bitmap.bytes, sized, context, bitmap.widthPx, bitmap.heightPx);
    const faded = await applyOpacity(masked, layer.opacity, bitmap.widthPx, bitmap.heightPx);

    const spot = placement(sized, surface, window, context.bounds, pxPerInch);
    let left = spot.leftPx;
    let input = faded;

    if (surface.mirror) {
      // Position mirrors for everything; pixels mirror for everything except
      // objects the contract protects. Type and logos read forward on a
      // mirrored flank without being composited out of z-order.
      left = window.widthPx - (spot.leftPx + bitmap.widthPx);
      const protectedObject = layer.type === "text" || layer.type === "logo";
      if (!protectedObject) input = await sharp(faded).flop().png(PNG_OPTIONS).toBuffer();
    }

    // A global layer is painted once across the whole design space, so most of
    // it falls outside any one surface. Clip to the window after mirroring,
    // because the flip decides which part of the field this surface sees.
    const clipLeft = Math.max(0, left);
    const clipTop = Math.max(0, spot.topPx);
    const clipRight = Math.min(window.widthPx, left + bitmap.widthPx);
    const clipBottom = Math.min(window.heightPx, spot.topPx + bitmap.heightPx);
    if (clipRight <= clipLeft || clipBottom <= clipTop) continue;

    if (clipLeft !== left || clipTop !== spot.topPx || clipRight - clipLeft !== bitmap.widthPx || clipBottom - clipTop !== bitmap.heightPx) {
      input = await sharp(input).extract({
        left: clipLeft - left, top: clipTop - spot.topPx,
        width: clipRight - clipLeft, height: clipBottom - clipTop,
      }).png(PNG_OPTIONS).toBuffer();
    }

    composites.push({ input, left: clipLeft, top: clipTop, blend: BLEND_OPERATORS[layer.blend] });
    layerIds.push(layer.layerId);
    if (layer.type === "text") textIdentities.push({ textId: layer.textId, string: context.textObjects.get(layer.textId).string });
    if (layer.type === "logo") {
      const logo = context.logoObjects.get(`${layer.space}:${layer.logoIdentityKey}`);
      logoIdentities.push({ identityKey: logo.identityKey, contentHash: logo.contentHash });
    }
  }

  const bytes = await sharp({ create: { width: window.widthPx, height: window.heightPx, channels: 3, background: "#ffffff" } })
    .composite(composites)
    .removeAlpha()
    .png(PNG_OPTIONS)
    .toBuffer();

  return Object.freeze({
    surfaceKey,
    bytes,
    contentHash: sha256(bytes),
    byteSize: bytes.length,
    // Field names match what panels.build already emits, so PanelPro, Topaz,
    // output verification, ZIP and WrapBox need no rewrite.
    pixelWidth: window.widthPx,
    pixelHeight: window.heightPx,
    trimWidthIn: window.trimWidthIn,
    trimHeightIn: window.trimHeightIn,
    printWidthIn: window.printWidthIn,
    printHeightIn: window.printHeightIn,
    bleedIn: bleedInches,
    surfaceSqFt: Math.round((window.trimWidthIn * window.trimHeightIn / 144) * 100) / 100,
    pxPerInch,
    mirror: surface.mirror,
    layerIds,
    textIdentities,
    logoIdentities,
  });
}

/**
 * Render all six production surfaces from one frozen master.
 */
async function renderProductionSurfaces({ master, loadAsset, pxPerInch, bleedInches = DEFAULT_BLEED_INCHES, rasterizeText = null }) {
  if (!master || master.contract !== "designpro.design-master.v1") fail("render_master_invalid", "a validated design master is required");
  if (typeof loadAsset !== "function") fail("render_loader_required", "loadAsset is required");
  if (!Number.isFinite(pxPerInch) || pxPerInch <= 0) fail("render_resolution_invalid", "pxPerInch must be a positive number");
  if (!Number.isFinite(bleedInches) || bleedInches < 0) fail("render_bleed_invalid", "bleedInches must be zero or greater");

  const context = {
    assets: indexById(master.assets, "assetId"),
    palette: indexById(master.palette, "token"),
    fonts: indexById(master.fonts, "fontId"),
    textObjects: indexById(master.textObjects, "textId"),
    logoObjects: new Map(master.logoObjects.map((logo) => [`${logo.surfaceKey}:${logo.identityKey}`, logo])),
    pxPerInch, bleedInches, loadAsset, rasterizeText,
    bounds: designSpaceBounds(master, bleedInches),
  };

  const surfaces = [];
  for (const surfaceKey of SURFACE_KEYS) surfaces.push(await renderSurface(master, surfaceKey, context));

  return Object.freeze({
    contract: RENDER_CONTRACT,
    masterHash: master.masterHash,
    dimensionManifestId: master.dimensionManifestId,
    manifestHash: master.manifestHash,
    revisionId: master.revisionId,
    pxPerInch,
    bleedIn: bleedInches,
    surfaces,
    // One identity over all six surfaces. Two renders of one master must agree
    // here, and a render of a changed master must not.
    renderHash: sha256(Buffer.from(surfaces.map((surface) => `${surface.surfaceKey}:${surface.contentHash}`).join("\n"))),
  });
}

module.exports = {
  RENDER_CONTRACT,
  DEFAULT_BLEED_INCHES,
  PNG_OPTIONS,
  BLEND_OPERATORS,
  RenderError,
  renderProductionSurfaces,
  _test: { orderedLayers, surfaceWindow, effectiveLayer, appliesToSurface, placement, designSpaceBounds, layerExtentIn },
};
