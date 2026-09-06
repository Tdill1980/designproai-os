"use strict";

/**
 * Deterministic bridge from the proven three-register creative field to the
 * canonical six-surface A.T.L.A.S. master.
 *
 * Gemini authors artwork, not production geometry. Its upper, middle and
 * lower registers are creative source regions only. Code maps the upper
 * register to Driver, the middle register to Passenger, and the supporting
 * lower register independently into Hood, Roof, Front and Rear. Every target
 * is the exact GENIE rectangle later consumed by cutCallOnePanels.
 *
 * This is composition, not repair: no generated pixel is inferred, healed,
 * relocated after acceptance or borrowed from a 3D proof. A fixed inset keeps
 * the field contract's optional presentation gutters out of the source crop;
 * the same arithmetic runs for every image and reads no pixel content.
 */

const sharp = require("sharp");

const FIELD_COMPOSE_CONTRACT = "designpro.atlas-field-compose.v1";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const BAND_INDEX = Object.freeze({ driver: 0, passenger: 1, hood: 2, roof: 2, front: 2, rear: 2 });
const SOURCE_INSET_X_RATIO = 0.0125;
const SOURCE_INSET_Y_RATIO = 0.04;
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });

class AtlasFieldComposeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "AtlasFieldComposeError";
    this.retryable = false;
  }
}

function fail(code, message) {
  throw new AtlasFieldComposeError(code, message);
}

function validateManifest(manifest) {
  const width = Number(manifest?.canvas?.widthPx);
  const height = Number(manifest?.canvas?.heightPx);
  const zones = Array.isArray(manifest?.zones) ? manifest.zones : [];
  if (!(width > 0) || !(height > 0)) fail("atlas_field_compose_manifest_invalid", "A.T.L.A.S. canvas dimensions are required");
  if (zones.length !== SURFACE_KEYS.length) fail("atlas_field_compose_manifest_invalid", "A.T.L.A.S. requires exactly six GENIE zones");
  const byKey = new Map();
  for (const zone of zones) {
    const key = String(zone?.surfaceKey || "").trim().toLowerCase();
    if (!SURFACE_KEYS.includes(key) || byKey.has(key)) {
      fail("atlas_field_compose_manifest_invalid", `Invalid or duplicate A.T.L.A.S. surface ${key || "?"}`);
    }
    for (const dimension of ["x", "y", "w", "h"]) {
      if (!Number.isInteger(zone[dimension]) || zone[dimension] < 0 || ((dimension === "w" || dimension === "h") && zone[dimension] < 1)) {
        fail("atlas_field_compose_manifest_invalid", `${key}.${dimension} is not a valid pixel dimension`);
      }
    }
    if (zone.x + zone.w > width || zone.y + zone.h > height) {
      fail("atlas_field_compose_manifest_invalid", `${key} falls outside the A.T.L.A.S. canvas`);
    }
    byKey.set(key, zone);
  }
  for (const key of SURFACE_KEYS) if (!byKey.has(key)) fail("atlas_field_compose_manifest_invalid", `A.T.L.A.S. is missing ${key}`);
  return { width, height, zones: SURFACE_KEYS.map((key) => byKey.get(key)) };
}

function sourceBand(width, height, surfaceKey) {
  const index = BAND_INDEX[surfaceKey];
  if (!Number.isInteger(index)) fail("atlas_field_compose_surface_unknown", `Unknown A.T.L.A.S. surface ${surfaceKey}`);
  const rawTop = Math.round((height * index) / 3);
  const rawBottom = Math.round((height * (index + 1)) / 3);
  const rawHeight = rawBottom - rawTop;
  const insetX = Math.max(1, Math.round(width * SOURCE_INSET_X_RATIO));
  const insetY = Math.max(1, Math.round(rawHeight * SOURCE_INSET_Y_RATIO));
  const region = {
    left: insetX,
    top: rawTop + insetY,
    width: width - insetX * 2,
    height: rawHeight - insetY * 2,
  };
  if (region.width < 1 || region.height < 1 || region.left + region.width > width || region.top + region.height > height) {
    fail("atlas_field_compose_source_invalid", `The ${surfaceKey} source register is outside the creative field`);
  }
  return region;
}

function naturalZoneSize(zone) {
  return Number(zone.rotationDegrees) === 0
    ? { width: zone.w, height: zone.h }
    : { width: zone.h, height: zone.w };
}

async function zoneLayer(fieldBytes, source, zone) {
  const region = sourceBand(source.width, source.height, zone.surfaceKey);
  const natural = naturalZoneSize(zone);
  let bytes = await sharp(fieldBytes, { limitInputPixels: false })
    .extract(region)
    .resize({ width: natural.width, height: natural.height, fit: "cover", position: "centre", kernel: "lanczos3" })
    .png(PNG_OPTIONS)
    .toBuffer();
  if (Number(zone.rotationDegrees) !== 0) {
    bytes = await sharp(bytes, { limitInputPixels: false })
      .rotate(Number(zone.rotationDegrees))
      .png(PNG_OPTIONS)
      .toBuffer();
  }
  const metadata = await sharp(bytes, { limitInputPixels: false }).metadata();
  if (metadata.width !== zone.w || metadata.height !== zone.h) {
    fail(
      "atlas_field_compose_zone_size_mismatch",
      `${zone.surfaceKey} composed at ${metadata.width || 0}x${metadata.height || 0}, expected ${zone.w}x${zone.h}`,
    );
  }
  return { bytes, region };
}

async function composeAtlasFromField({ fieldBytes, manifest }) {
  if (!Buffer.isBuffer(fieldBytes) || !fieldBytes.length) {
    fail("atlas_field_compose_source_required", "The creative field bytes are required");
  }
  const target = validateManifest(manifest);
  const metadata = await sharp(fieldBytes, { limitInputPixels: false }).metadata();
  const source = { width: Number(metadata.width), height: Number(metadata.height), byteSize: fieldBytes.length };
  if (!(source.width >= 1024) || !(source.height >= 1024)) {
    fail("atlas_field_compose_source_too_small", `Creative field is ${source.width || 0}x${source.height || 0}; at least 1024x1024 is required`);
  }
  const aspect = source.width / source.height;
  if (Math.abs(aspect - 1) > 0.08) {
    fail("atlas_field_compose_source_aspect_invalid", `Creative field is ${source.width}x${source.height}; the source contract is square`);
  }

  const composites = [];
  const mappings = [];
  for (const zone of target.zones) {
    const layer = await zoneLayer(fieldBytes, source, zone);
    composites.push({ input: layer.bytes, left: zone.x, top: zone.y });
    mappings.push(Object.freeze({
      surfaceKey: zone.surfaceKey,
      sourceRegister: BAND_INDEX[zone.surfaceKey] === 0 ? "upper" : BAND_INDEX[zone.surfaceKey] === 1 ? "middle" : "lower",
      sourceRect: layer.region,
      targetRect: { x: zone.x, y: zone.y, w: zone.w, h: zone.h, rotationDegrees: Number(zone.rotationDegrees) || 0 },
    }));
  }

  const bytes = await sharp({
    create: {
      width: target.width,
      height: target.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
    limitInputPixels: false,
  }).composite(composites).png(PNG_OPTIONS).toBuffer();

  return {
    contract: FIELD_COMPOSE_CONTRACT,
    bytes,
    source,
    mappings,
    zonesComposed: mappings.length,
  };
}

module.exports = {
  FIELD_COMPOSE_CONTRACT,
  AtlasFieldComposeError,
  composeAtlasFromField,
  _test: { BAND_INDEX, SOURCE_INSET_X_RATIO, SOURCE_INSET_Y_RATIO, naturalZoneSize, sourceBand, validateManifest, zoneLayer },
};
