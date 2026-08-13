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
const { placedResolution, SURFACE_KEYS, DESIGN_MASTER_CONTRACT } = require("./design-master.cjs");
const { outlineStringSvg } = require("./opentype-outline.cjs");

const RENDER_CONTRACT = "designpro.production-surface-render.v1";
const DEFAULT_BLEED_INCHES = 5;
// Fixed encoder settings. Any variation here changes bytes without changing
// artwork, which would defeat the reproducibility gate.
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });
const RESAMPLER = "lanczos3";
const VECTOR_DENSITY = 300;
// Peak working set per surface, as a bound rather than a hope. Layers are
// composited one at a time into a raw canvas, so at any moment memory holds the
// canvas, the incoming layer (never larger than the canvas after clipping) and
// one transient copy. Anything above the budget fails closed rather than
// discovering the ceiling on a production host.
const PEAK_BYTES_PER_PIXEL = 3 * 4;
const DEFAULT_MAX_SURFACE_BYTES = 4 * 1024 * 1024 * 1024;

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

function surfaceBudget(window, maxSurfaceBytes) {
  const peakBytes = window.widthPx * window.heightPx * PEAK_BYTES_PER_PIXEL;
  return { peakBytes, maxSurfaceBytes, withinBudget: peakBytes <= maxSurfaceBytes };
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
 * v1.1 makes this authoritative. The renderer no longer infers that global
 * artwork "means" the whole design space or that a string's width can be
 * estimated from its character count — manufacturing behaviour does not belong
 * in renderer heuristics.
 */
function layerExtentIn(layer) {
  return [layer.extent.widthIn, layer.extent.heightIn];
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

async function loadVerifiedFont(font, loadFont) {
  const bytes = await loadFont(font);
  if (!Buffer.isBuffer(bytes) || !bytes.length) fail("render_font_empty", `${font.fontId} produced no bytes`);
  // A substituted font is the defect this whole route exists to remove.
  if (sha256(bytes) !== font.contentHash) fail("render_font_hash_mismatch", `${font.fontId} bytes do not match the hash the master declares`);
  return bytes;
}

/**
 * An SVG rasterised to exactly the box it was asked for.
 *
 * sharp reads SVG user units against a 96 DPI baseline, so rendering at a
 * higher density silently returns a larger bitmap than the declared extent.
 * Every downstream calculation — clipping, mirroring, placement — is in surface
 * pixels, so the raster has to be the size the layer says it is.
 */
async function rasterizeSvgExact(svg, widthPx, heightPx) {
  return sharp(svg, { density: 96 }).resize(widthPx, heightPx, { fit: "fill", kernel: RESAMPLER }).png(PNG_OPTIONS).toBuffer();
}

/**
 * A window onto content that is drawn at full layer size.
 *
 * The viewBox is what makes production dimensions survivable. A global graphic
 * spans the whole design space, which for an F-250 at 150 px/in is about
 * 98,400 x 11,400 pixels — over a billion, and unrenderable. Only the part a
 * surface actually manufactures is ever rasterised, while the geometry stays
 * computed against the full layer so a gradient or an outline lands in the same
 * place on every surface it crosses.
 */
function windowedSvg(body, layerWidthPx, layerHeightPx, region) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${region.w}" height="${region.h}" viewBox="${region.x} ${region.y} ${region.w} ${region.h}">${body}</svg>`);
}

function solidBody(widthPx, heightPx, colours) {
  if (colours.length === 1) return `<rect width="${widthPx}" height="${heightPx}" fill="${colours[0]}"/>`;
  const stops = colours.map((colour, index) => `<stop offset="${(index / (colours.length - 1)).toFixed(6)}" stop-color="${colour}"/>`).join("");
  return `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs><rect width="${widthPx}" height="${heightPx}" fill="url(#g)"/>`;
}

/** The matching sub-rectangle of a raster source, never the whole thing. */
function sourceRegion(region, layerWidthPx, layerHeightPx, srcWidth, srcHeight) {
  const clamp = (value, max) => Math.max(0, Math.min(max, value));
  const left = clamp(Math.floor((region.x / layerWidthPx) * srcWidth), srcWidth - 1);
  const top = clamp(Math.floor((region.y / layerHeightPx) * srcHeight), srcHeight - 1);
  const width = Math.max(1, Math.min(srcWidth - left, Math.ceil((region.w / layerWidthPx) * srcWidth)));
  const height = Math.max(1, Math.min(srcHeight - top, Math.ceil((region.h / layerHeightPx) * srcHeight)));
  return { left, top, width, height };
}

/**
 * The pixels a single layer contributes *for one region of one surface*.
 *
 * Nothing is ever rasterised at full layer size. `region` is in layer-local
 * pixels and is always bounded by the surface window, so the largest buffer any
 * layer can produce is one surface.
 */
async function renderLayerRegion(layer, context, layerWidthPx, layerHeightPx, region) {
  const { assets, palette, textObjects, fonts, pxPerInch, loadAsset } = context;

  if (layer.type === "solid" || layer.type === "gradient" || layer.type === "pattern") {
    const colours = layer.colorTokens.map((token) => palette.get(token).srgb);
    return rasterizeSvgExact(windowedSvg(solidBody(layerWidthPx, layerHeightPx, colours), layerWidthPx, layerHeightPx, region), region.w, region.h);
  }

  if (layer.type === "raster" || layer.type === "vector" || layer.type === "logo") {
    const asset = layer.type === "logo"
      ? assets.get(context.logoObjects.get(`${layer.space}:${layer.logoIdentityKey}`).assetId)
      : assets.get(layer.assetId);
    const bytes = await loadVerifiedAsset(asset, loadAsset);

    if (asset.kind === "raster") {
      // A structurally valid master can still be unprintable. The floor is
      // checked against the whole placement, on both axes, before any pixels.
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
      const crop = sourceRegion(region, layerWidthPx, layerHeightPx, asset.intrinsic.widthPx, asset.intrinsic.heightPx);
      return sharp(bytes, { limitInputPixels: false }).extract(crop)
        .resize(region.w, region.h, { fit: "fill", kernel: RESAMPLER }).png(PNG_OPTIONS).toBuffer();
    }
    // Vector content is drawn at full layer size inside a viewBox, so only the
    // needed window is ever rasterised.
    const inner = bytes.toString("utf8").replace(/^[\s\S]*?<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
    const scaled = `<g transform="scale(${layerWidthPx / (region.assetWidth || layerWidthPx)})">${inner}</g>`;
    void scaled;
    return rasterizeSvgExact(
      windowedSvg(`<svg x="0" y="0" width="${layerWidthPx}" height="${layerHeightPx}" preserveAspectRatio="none" viewBox="0 0 ${region.assetWidth} ${region.assetHeight}">${inner}</svg>`, layerWidthPx, layerHeightPx, region),
      region.w, region.h);
  }

  if (layer.type === "text") {
    const text = textObjects.get(layer.textId);
    const font = fonts.get(text.fontId);
    // Never fontconfig. The pinned file is the authority, so the glyphs are cut
    // out of those exact bytes and emitted as outlines.
    if (typeof context.loadFont !== "function") {
      fail("render_font_loader_required", `${layer.layerId} renders ${JSON.stringify(text.string)} and no font loader was supplied`);
    }
    const fontBytes = await loadVerifiedFont(font, context.loadFont);
    const outlined = outlineStringSvg({
      fontBytes, string: text.string,
      sizeIn: text.sizeIn * layer.transform.scale, pxPerInch,
      fill: palette.get(text.colorToken).srgb,
      boxWidthPx: layerWidthPx, boxHeightPx: layerHeightPx,
    });
    return rasterizeSvgExact(windowedSvg(`<path d="${outlined.path}" fill="${palette.get(text.colorToken).srgb}" fill-rule="nonzero"/>`, layerWidthPx, layerHeightPx, region), region.w, region.h);
  }

  return fail("render_layer_type_unsupported", `${layer.layerId} is of unsupported type ${layer.type}`);
}

async function applyMask(layerBytes, layer, context, layerWidthPx, layerHeightPx, region) {
  if (!layer.mask || layer.mask.type === "none") return layerBytes;
  const asset = context.assets.get(layer.mask.assetId);
  const maskBytes = await loadVerifiedAsset(asset, context.loadAsset);
  const widthPx = region.w;
  const heightPx = region.h;
  let mask;
  if (asset.kind === "vector") {
    const inner = maskBytes.toString("utf8").replace(/^[\s\S]*?<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
    mask = await sharp(windowedSvg(`<svg x="0" y="0" width="${layerWidthPx}" height="${layerHeightPx}" preserveAspectRatio="none" viewBox="0 0 ${region.assetWidth} ${region.assetHeight}">${inner}</svg>`, layerWidthPx, layerHeightPx, region), { density: 96 })
      .resize(widthPx, heightPx, { fit: "fill", kernel: RESAMPLER }).greyscale().toColourspace("b-w").png(PNG_OPTIONS).toBuffer();
  } else {
    const crop = sourceRegion(region, layerWidthPx, layerHeightPx, asset.intrinsic.widthPx, asset.intrinsic.heightPx);
    mask = await sharp(maskBytes, { limitInputPixels: false }).extract(crop)
      .resize(widthPx, heightPx, { fit: "fill", kernel: RESAMPLER }).greyscale().toColourspace("b-w").png(PNG_OPTIONS).toBuffer();
  }
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
  const budget = surfaceBudget(window, context.maxSurfaceBytes);
  if (!budget.withinBudget) {
    fail("render_surface_exceeds_budget",
      `${surfaceKey} at ${window.widthPx}x${window.heightPx} needs about ${(budget.peakBytes / 1e9).toFixed(2)} GB, above the ${(budget.maxSurfaceBytes / 1e9).toFixed(2)} GB production budget`);
  }

  const composites = [];
  const layerIds = [];
  const textIdentities = [];
  const logoIdentities = [];

  for (const raw of orderedLayers(master)) {
    if (!appliesToSurface(raw, surfaceKey)) continue;
    const layer = effectiveLayer(raw, surfaceKey);
    if (!layer.visible) continue;

    const sized = { ...layer, sizeIn: layerExtentIn(layer) };
    const layerWidthPx = Math.max(1, Math.round(sized.sizeIn[0] * layer.transform.scale * pxPerInch));
    const layerHeightPx = Math.max(1, Math.round(sized.sizeIn[1] * layer.transform.scale * pxPerInch));

    const spot = placement(sized, surface, window, context.bounds, pxPerInch);
    // Mirroring moves the placement; whether the pixels also mirror depends on
    // whether the contract protects the object.
    const protectedObject = layer.type === "text" || layer.type === "logo";
    const left = surface.mirror ? window.widthPx - (spot.leftPx + layerWidthPx) : spot.leftPx;
    const top = spot.topPx;

    const clipLeft = Math.max(0, left);
    const clipTop = Math.max(0, top);
    const clipRight = Math.min(window.widthPx, left + layerWidthPx);
    const clipBottom = Math.min(window.heightPx, top + layerHeightPx);
    if (clipRight <= clipLeft || clipBottom <= clipTop) continue;

    const regionWidth = clipRight - clipLeft;
    const regionHeight = clipBottom - clipTop;
    const localX = clipLeft - left;
    const flipPixels = surface.mirror && !protectedObject;
    const region = {
      // In the layer's own unflipped coordinates, so the source is sampled once
      // and the flip is applied to the finished region.
      x: flipPixels ? layerWidthPx - (localX + regionWidth) : localX,
      y: clipTop - top,
      w: regionWidth,
      h: regionHeight,
    };
    if (layer.type === "vector" || layer.type === "logo" || layer.mask?.type === "path") {
      const vectorAsset = layer.type === "logo"
        ? context.assets.get(context.logoObjects.get(`${layer.space}:${layer.logoIdentityKey}`).assetId)
        : context.assets.get(layer.assetId || layer.mask.assetId);
      if (vectorAsset && vectorAsset.kind === "vector") {
        const meta = await sharp(await loadVerifiedAsset(vectorAsset, context.loadAsset)).metadata();
        region.assetWidth = meta.width || layerWidthPx;
        region.assetHeight = meta.height || layerHeightPx;
      }
    }
    if (layer.mask?.type === "path" && region.assetWidth === undefined) {
      const maskMeta = await sharp(await loadVerifiedAsset(context.assets.get(layer.mask.assetId), context.loadAsset)).metadata();
      region.assetWidth = maskMeta.width;
      region.assetHeight = maskMeta.height;
    }

    let input = await renderLayerRegion(sized, context, layerWidthPx, layerHeightPx, region);
    input = await applyMask(input, sized, context, layerWidthPx, layerHeightPx, region);
    input = await applyOpacity(input, layer.opacity, regionWidth, regionHeight);
    if (flipPixels) input = await sharp(input).flop().png(PNG_OPTIONS).toBuffer();

    composites.push({ input, left: clipLeft, top: clipTop, blend: BLEND_OPERATORS[layer.blend] });
    layerIds.push(layer.layerId);
    if (layer.type === "text") textIdentities.push({ textId: layer.textId, string: context.textObjects.get(layer.textId).string });
    if (layer.type === "logo") {
      const logo = context.logoObjects.get(`${layer.space}:${layer.logoIdentityKey}`);
      logoIdentities.push({ identityKey: logo.identityKey, contentHash: logo.contentHash });
    }
  }

  // Four channels between steps, not three. Dropping alpha at each hand-off
  // changes how the next layer blends, and the difference is real: the same
  // three layers composited through RGB intermediates disagreed with a single
  // batch composite on 1,960 of 8,192 bytes. Carried as RGBA it agrees exactly,
  // so bounding memory costs nothing in correctness.
  const raw = { width: window.widthPx, height: window.heightPx, channels: 4 };
  let canvas = await sharp({ create: { ...raw, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).raw().toBuffer();
  for (const item of composites) {
    canvas = await sharp(canvas, { raw }).composite([item]).ensureAlpha().raw().toBuffer();
  }
  const bytes = await sharp(canvas, { raw }).removeAlpha().png(PNG_OPTIONS).toBuffer();
  canvas = null;

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
async function renderProductionSurfaces({ master, loadAsset, loadFont = null, pxPerInch, bleedInches = DEFAULT_BLEED_INCHES, maxSurfaceBytes = DEFAULT_MAX_SURFACE_BYTES }) {
  if (!master || master.contract !== DESIGN_MASTER_CONTRACT) fail("render_master_invalid", `a validated ${DESIGN_MASTER_CONTRACT} master is required`);
  if (typeof loadAsset !== "function") fail("render_loader_required", "loadAsset is required");
  if (!Number.isFinite(pxPerInch) || pxPerInch <= 0) fail("render_resolution_invalid", "pxPerInch must be a positive number");
  if (!Number.isFinite(bleedInches) || bleedInches < 0) fail("render_bleed_invalid", "bleedInches must be zero or greater");
  if (!Number.isFinite(maxSurfaceBytes) || maxSurfaceBytes <= 0) fail("render_budget_invalid", "maxSurfaceBytes must be a positive number");

  const context = {
    assets: indexById(master.assets, "assetId"),
    palette: indexById(master.palette, "token"),
    fonts: indexById(master.fonts, "fontId"),
    textObjects: indexById(master.textObjects, "textId"),
    logoObjects: new Map(master.logoObjects.map((logo) => [`${logo.surfaceKey}:${logo.identityKey}`, logo])),
    pxPerInch, bleedInches, loadAsset, loadFont, maxSurfaceBytes,
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
    maxSurfaceBytes,
    peakBytesPerSurface: Math.max(...surfaces.map((surface) => surface.pixelWidth * surface.pixelHeight * PEAK_BYTES_PER_PIXEL)),
    surfaces,
    // One identity over all six surfaces. Two renders of one master must agree
    // here, and a render of a changed master must not.
    renderHash: sha256(Buffer.from(surfaces.map((surface) => `${surface.surfaceKey}:${surface.contentHash}`).join("\n"))),
  });
}

module.exports = {
  RENDER_CONTRACT,
  DEFAULT_BLEED_INCHES,
  DEFAULT_MAX_SURFACE_BYTES,
  PEAK_BYTES_PER_PIXEL,
  PNG_OPTIONS,
  BLEND_OPERATORS,
  RenderError,
  renderProductionSurfaces,
  _test: { orderedLayers, surfaceWindow, effectiveLayer, appliesToSurface, placement, designSpaceBounds, layerExtentIn, surfaceBudget },
};
