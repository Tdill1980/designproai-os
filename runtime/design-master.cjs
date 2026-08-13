"use strict";

/**
 * The canonical Design Master: the single authority for everything that gets
 * manufactured.
 *
 * The architecture this replaces asked an image model to reconstruct a flat
 * production master from rendered vehicle imagery. That is an inverse problem —
 * the master did not exist until it was inferred, so there was no artwork to
 * validate the inference against, and none of the failure modes (body lines
 * becoming artwork, mutated spelling, mirrored duplicates) were detectable even
 * in principle. A real job proved it: two approved renders of one design
 * disagreed on the customer's own domain name, and every structural contract in
 * the pipeline still passed.
 *
 * Here the master is authored, not inferred. AI owns creative direction,
 * imagery, texture, gradient, pattern and composition; those arrive as frozen
 * assets. This module owns geometry, coordinates, bleed, spelling, logo
 * identity, mirroring and placement. Nothing downstream is permitted to heal,
 * invent or substitute any of them.
 *
 * PHASE 1 SCOPE. This is the contract only: shape, canonical form, identity
 * hash and fail-closed validation. It renders nothing and is wired to nothing.
 */

const { createHash } = require("node:crypto");

const DESIGN_MASTER_CONTRACT = "designpro.design-master.v1";
const UNWRAP_CONTRACT = "designpro.vehicle-unwrap.v1";

// The same six surfaces the GENIE manifest and every downstream stage already
// use. Surface identity is closed; surface *appearance* deliberately is not.
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
// Edges are named in the surface's own UV orientation, not vehicle-relative.
// "front" is ambiguous for a hood — its forward edge is the grille end, but its
// seam to a flank is a side edge. Rectangle-local names are unambiguous for
// every surface, and where the surface sits on the vehicle is already carried
// by originUV.
const SEAM_EDGES = Object.freeze(["left", "right", "top", "bottom"]);
const SEAM_CONTINUITY = Object.freeze(["exact", "tolerance", "none"]);
const LAYER_TYPES = Object.freeze(["raster", "vector", "text", "logo", "gradient", "pattern", "solid"]);
// The compositor's primitive set is the ceiling on achievable design quality.
// A master that cannot express a multiply blend or a feathered mask forces a
// template look no matter how good the creative upstream is.
const BLEND_MODES = Object.freeze(["normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "darken", "lighten"]);
const MASK_TYPES = Object.freeze(["none", "path", "raster"]);
const ASSET_KINDS = Object.freeze(["raster", "vector"]);
const SPELLING_AUTHORITIES = Object.freeze(["revision-snapshot"]);
const GLOBAL_SPACE = "global";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SRGB_RE = /^#[0-9a-f]{6}$/;

class DesignMasterError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "DesignMasterError";
  }
}

function fail(code, message) {
  throw new DesignMasterError(code, message);
}

/**
 * Deterministic canonical form. Keys sorted, undefined dropped. Two masters
 * that differ only in key order are the same master and must hash identically;
 * two that differ in any authoritative value must not.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

/** The master's identity. Never includes masterHash itself. */
function designMasterHash(master) {
  const { masterHash, ...authoritative } = master || {};
  return createHash("sha256").update(Buffer.from(JSON.stringify(canonical(authoritative)))).digest("hex");
}

// ---------------------------------------------------------------- primitives

function requireUuid(value, label) {
  const text = String(value || "").trim().toLowerCase();
  if (!UUID_RE.test(text)) fail("master_uuid_invalid", `${label} must be a UUID`);
  return text;
}

function requireHash(value, label) {
  const text = String(value || "").trim().toLowerCase();
  if (!HASH_RE.test(text)) fail("master_hash_invalid", `${label} must be a sha256 hex digest`);
  return text;
}

function requireToken(value, label) {
  const text = String(value || "").trim();
  if (!TOKEN_RE.test(text)) fail("master_token_invalid", `${label} must be a lowercase identifier`);
  return text;
}

function requireFinite(value, label, { min = -Infinity, max = Infinity, positive = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail("master_number_invalid", `${label} must be a finite number`);
  if (positive && number <= 0) fail("master_number_invalid", `${label} must be greater than zero`);
  if (number < min || number > max) fail("master_number_invalid", `${label} must be between ${min} and ${max}`);
  return number;
}

function requireOneOf(value, allowed, label) {
  const text = String(value || "").trim();
  if (!allowed.includes(text)) fail("master_enum_invalid", `${label} must be one of ${allowed.join(", ")}`);
  return text;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("master_object_invalid", `${label} must be an object`);
  return value;
}

function requireArray(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) fail("master_array_invalid", `${label} must be an array of at least ${min}`);
  return value;
}

// ------------------------------------------------------------------- unwrap

/**
 * The vehicle unwrap. Adjacency lives here and nowhere else.
 *
 * The retired architecture packed six surfaces into an atlas whose canvas
 * adjacency had no relationship to vehicle adjacency — driver on row one, hood
 * on row three — so a graphic that flowed continuously across the canvas was
 * discontinuous on the truck. Continuity was not weakly guaranteed; it was not
 * represented. Seams are declared here so a spanning graphic can be validated
 * against real topology.
 */
function validateUnwrap(raw) {
  const unwrap = requireObject(raw, "unwrap");
  if (unwrap.contract !== UNWRAP_CONTRACT) fail("unwrap_contract_invalid", `unwrap.contract must be ${UNWRAP_CONTRACT}`);
  requireUuid(unwrap.unwrapId, "unwrap.unwrapId");
  requireFinite(unwrap.unitsPerInch, "unwrap.unitsPerInch", { positive: true });

  const surfaces = requireArray(unwrap.surfaces, "unwrap.surfaces", { min: SURFACE_KEYS.length });
  const seen = new Set();
  for (const entry of surfaces) {
    const surface = requireObject(entry, "unwrap.surfaces[]");
    const key = requireOneOf(surface.surfaceKey, SURFACE_KEYS, "surfaceKey");
    // Surface IDENTITY is unique. Surface APPEARANCE deliberately is not
    // constrained: driver and passenger are routinely mirrors of one another,
    // and on many wraps are identical. The retired guards rejected exactly
    // that, and killed a real production run for it.
    if (seen.has(key)) fail("unwrap_surface_duplicate", `${key} appears twice in the unwrap`);
    seen.add(key);

    const origin = requireArray(surface.originUV, `${key}.originUV`, { min: 2 });
    if (origin.length !== 2) fail("unwrap_origin_invalid", `${key}.originUV must be [u, v]`);
    requireFinite(origin[0], `${key}.originUV[0]`);
    requireFinite(origin[1], `${key}.originUV[1]`);
    requireFinite(surface.widthIn, `${key}.widthIn`, { positive: true });
    requireFinite(surface.heightIn, `${key}.heightIn`, { positive: true });
    if (typeof surface.mirror !== "boolean") fail("unwrap_mirror_invalid", `${key}.mirror must be a boolean`);

    for (const seamEntry of requireArray(surface.seams, `${key}.seams`)) {
      const seam = requireObject(seamEntry, `${key}.seams[]`);
      requireOneOf(seam.edge, SEAM_EDGES, `${key}.seam.edge`);
      const joins = requireOneOf(seam.joins, SURFACE_KEYS, `${key}.seam.joins`);
      if (joins === key) fail("unwrap_seam_self", `${key} cannot seam to itself`);
      requireOneOf(seam.joinEdge, SEAM_EDGES, `${key}.seam.joinEdge`);
      requireOneOf(seam.continuity, SEAM_CONTINUITY, `${key}.seam.continuity`);
    }
  }
  if (SURFACE_KEYS.some((key) => !seen.has(key))) fail("unwrap_surface_set_incomplete", "the unwrap must cover all six surfaces");

  // A seam is a claim about physical adjacency, so both sides must claim it.
  const byKey = new Map(surfaces.map((surface) => [surface.surfaceKey, surface]));
  for (const surface of surfaces) {
    for (const seam of surface.seams) {
      const partner = byKey.get(seam.joins);
      const reciprocal = partner.seams.some((other) => other.joins === surface.surfaceKey && other.edge === seam.joinEdge && other.joinEdge === seam.edge);
      if (!reciprocal) fail("unwrap_seam_not_reciprocal", `${surface.surfaceKey}.${seam.edge} claims ${seam.joins}.${seam.joinEdge} but the claim is not returned`);
    }
  }
  return unwrap;
}

// ------------------------------------------------------------------- assets

/**
 * A structured master does not fix resolution on its own. If AI hands over a
 * 2048px texture and it is placed across 153 inches, the result is the same
 * 27 px/in that made the retired path unusable — just in a tidier wrapper.
 * minPxPerInch is the contract that stops it, and it is checked against the
 * placed size, not the intrinsic size.
 */
function validateAssets(raw) {
  const assets = requireArray(raw, "assets");
  const byId = new Map();
  for (const entry of assets) {
    const asset = requireObject(entry, "assets[]");
    const assetId = requireToken(asset.assetId, "asset.assetId");
    if (byId.has(assetId)) fail("asset_duplicate", `asset ${assetId} is declared twice`);
    const kind = requireOneOf(asset.kind, ASSET_KINDS, `${assetId}.kind`);
    requireHash(asset.contentHash, `${assetId}.contentHash`);
    if (!String(asset.storagePath || "").trim()) fail("asset_storage_path_invalid", `${assetId}.storagePath is required`);
    if (kind === "raster") {
      const intrinsic = requireObject(asset.intrinsic, `${assetId}.intrinsic`);
      requireFinite(intrinsic.widthPx, `${assetId}.intrinsic.widthPx`, { positive: true });
      requireFinite(intrinsic.heightPx, `${assetId}.intrinsic.heightPx`, { positive: true });
      requireFinite(asset.minPxPerInch, `${assetId}.minPxPerInch`, { positive: true });
    }
    byId.set(assetId, asset);
  }
  return byId;
}

function validatePalette(raw) {
  const palette = requireArray(raw, "palette");
  const tokens = new Set();
  for (const entry of palette) {
    const colour = requireObject(entry, "palette[]");
    const token = requireToken(colour.token, "palette.token");
    if (tokens.has(token)) fail("palette_duplicate", `colour token ${token} is declared twice`);
    if (!SRGB_RE.test(String(colour.srgb || "").toLowerCase())) fail("palette_srgb_invalid", `${token}.srgb must be #rrggbb`);
    // cmyk and spot stay optional: whether v1 ships an ICC-managed pipeline is
    // an open decision, and the contract must not foreclose either answer.
    if (colour.cmyk !== undefined) {
      if (!Array.isArray(colour.cmyk) || colour.cmyk.length !== 4) fail("palette_cmyk_invalid", `${token}.cmyk must have exactly four components`);
      for (const component of colour.cmyk) requireFinite(component, `${token}.cmyk[]`, { min: 0, max: 100 });
    }
    tokens.add(token);
  }
  return tokens;
}

function validateFonts(raw) {
  const fonts = requireArray(raw, "fonts");
  const byId = new Map();
  for (const entry of fonts) {
    const font = requireObject(entry, "fonts[]");
    const fontId = requireToken(font.fontId, "font.fontId");
    if (byId.has(fontId)) fail("font_duplicate", `font ${fontId} is declared twice`);
    for (const field of ["family", "version", "license"]) {
      if (!String(font[field] || "").trim()) fail("font_field_missing", `${fontId}.${field} is required`);
    }
    // Deterministic type needs the exact file, not a family name. Silent
    // substitution is a production failure that looks correct on screen.
    requireHash(font.contentHash, `${fontId}.contentHash`);
    byId.set(fontId, font);
  }
  return byId;
}

// ------------------------------------------------------------------- layers

function validateTransform(raw, label) {
  const transform = requireObject(raw, `${label}.transform`);
  requireFinite(transform.x, `${label}.transform.x`);
  requireFinite(transform.y, `${label}.transform.y`);
  requireFinite(transform.scale, `${label}.transform.scale`, { positive: true });
  requireFinite(transform.rotate, `${label}.transform.rotate`, { min: -360, max: 360 });
  if (transform.skew !== undefined) requireFinite(transform.skew, `${label}.transform.skew`, { min: -89, max: 89 });
  return transform;
}

function validateLayers(raw, { assets, palette, surfaceKeys }) {
  const layers = requireArray(raw, "layers", { min: 1 });
  const ids = new Set();
  for (const entry of layers) {
    const layer = requireObject(entry, "layers[]");
    const layerId = requireToken(layer.layerId, "layer.layerId");
    if (ids.has(layerId)) fail("layer_duplicate", `layer ${layerId} is declared twice`);
    ids.add(layerId);

    const type = requireOneOf(layer.type, LAYER_TYPES, `${layerId}.type`);
    // "global" places the layer in the shared creative coordinate system, which
    // is what lets one graphic run driver -> hood -> front as a single object
    // instead of six tiles that happen to abut.
    const space = String(layer.space || "").trim();
    if (space !== GLOBAL_SPACE && !surfaceKeys.has(space)) fail("layer_space_invalid", `${layerId}.space must be "${GLOBAL_SPACE}" or a surface key`);

    validateTransform(layer.transform, layerId);
    requireFinite(layer.zOrder, `${layerId}.zOrder`);
    requireFinite(layer.opacity, `${layerId}.opacity`, { min: 0, max: 1 });
    requireOneOf(layer.blend, BLEND_MODES, `${layerId}.blend`);

    const mask = requireObject(layer.mask, `${layerId}.mask`);
    const maskType = requireOneOf(mask.type, MASK_TYPES, `${layerId}.mask.type`);
    if (maskType !== "none" && !String(mask.ref || "").trim()) fail("layer_mask_ref_missing", `${layerId}.mask.ref is required for a ${maskType} mask`);

    if (layer.clipTo !== undefined) {
      for (const key of requireArray(layer.clipTo, `${layerId}.clipTo`)) {
        if (!surfaceKeys.has(String(key))) fail("layer_clip_invalid", `${layerId}.clipTo references unknown surface ${key}`);
      }
    }
    if (layer.surfaceOverrides !== undefined) {
      const overrides = requireObject(layer.surfaceOverrides, `${layerId}.surfaceOverrides`);
      for (const key of Object.keys(overrides)) {
        if (!surfaceKeys.has(key)) fail("layer_override_invalid", `${layerId}.surfaceOverrides references unknown surface ${key}`);
        requireObject(overrides[key], `${layerId}.surfaceOverrides.${key}`);
      }
    }

    if (type === "raster" || type === "vector") {
      const assetId = requireToken(layer.assetId, `${layerId}.assetId`);
      if (!assets.has(assetId)) fail("layer_asset_unknown", `${layerId} references undeclared asset ${assetId}`);
    }
    if (type === "solid" || type === "gradient") {
      for (const token of requireArray(layer.colorTokens, `${layerId}.colorTokens`, { min: 1 })) {
        if (!palette.has(String(token))) fail("layer_color_unknown", `${layerId} references undeclared colour token ${token}`);
      }
    }
  }
  return ids;
}

// ---------------------------------------------------- text and logo identity

/**
 * Text is an object with one canonical string, not pixels to be re-rendered
 * per view. A real job shipped PrecisionClimateAZ.com on one side and
 * PrecisionsClimateAz.com on the other because the passenger composition was
 * mirrored and its type was separately re-rendered. Under this contract that
 * divergence has nowhere to occur: one string produces the print surface and
 * the proof.
 */
function validateTextObjects(raw, { fonts, palette, surfaceKeys }) {
  const textObjects = requireArray(raw, "textObjects");
  const ids = new Set();
  for (const entry of textObjects) {
    const text = requireObject(entry, "textObjects[]");
    const textId = requireToken(text.textId, "text.textId");
    if (ids.has(textId)) fail("text_duplicate", `text object ${textId} is declared twice`);
    ids.add(textId);

    if (typeof text.string !== "string" || !text.string.length) fail("text_string_invalid", `${textId}.string must be a non-empty string`);
    const fontId = requireToken(text.fontId, `${textId}.fontId`);
    if (!fonts.has(fontId)) fail("text_font_unknown", `${textId} references undeclared font ${fontId}`);
    requireFinite(text.sizeIn, `${textId}.sizeIn`, { positive: true });
    if (text.tracking !== undefined) requireFinite(text.tracking, `${textId}.tracking`);
    if (!palette.has(requireToken(text.colorToken, `${textId}.colorToken`))) fail("text_color_unknown", `${textId} references undeclared colour token ${text.colorToken}`);

    const space = String(text.space || "").trim();
    if (space !== GLOBAL_SPACE && !surfaceKeys.has(space)) fail("text_space_invalid", `${textId}.space must be "${GLOBAL_SPACE}" or a surface key`);
    validateTransform(text.transform, textId);

    // Type on a mirrored surface must not mirror with it. This is the whole
    // reason the retired path needed a second generative pass over the
    // passenger side, and the whole reason that pass could corrupt a domain.
    if (text.neverMirror !== true) fail("text_never_mirror_required", `${textId}.neverMirror must be true — type is never mirrored with its surface`);
    requireOneOf(text.spellingAuthority, SPELLING_AUTHORITIES, `${textId}.spellingAuthority`);
  }
  return ids;
}

/**
 * Logo identity is a stored file, never drawn. logos.extract already works this
 * way in the existing pipeline; this carries the same rule into the master.
 */
function validateLogoObjects(raw, { assets, surfaceKeys }) {
  const logoObjects = requireArray(raw, "logoObjects");
  const keys = new Set();
  for (const entry of logoObjects) {
    const logo = requireObject(entry, "logoObjects[]");
    const identityKey = requireToken(logo.identityKey, "logo.identityKey");
    const surfaceKey = requireOneOf(logo.surfaceKey, [...surfaceKeys], "logo.surfaceKey");
    const placement = `${surfaceKey}:${identityKey}`;
    if (keys.has(placement)) fail("logo_duplicate", `logo placement ${placement} is declared twice`);
    keys.add(placement);

    const assetId = requireToken(logo.assetId, `${identityKey}.assetId`);
    if (!assets.has(assetId)) fail("logo_asset_unknown", `${identityKey} references undeclared asset ${assetId}`);
    requireHash(logo.contentHash, `${identityKey}.contentHash`);
    if (assets.get(assetId).contentHash !== logo.contentHash) fail("logo_asset_hash_mismatch", `${identityKey}.contentHash does not match its asset`);
    validateTransform(logo.transform, identityKey);
    if (logo.neverRasterizeIntoBase !== true) fail("logo_never_rasterize_required", `${identityKey}.neverRasterizeIntoBase must be true — logos overlay, they are never drawn into base artwork`);
  }
  return keys;
}

// ---------------------------------------------------------------- the master

/**
 * Fail-closed validation of a complete Design Master. Returns the master with
 * its computed identity; never repairs, defaults or coerces.
 */
function validateDesignMaster(raw) {
  const master = requireObject(raw, "design master");
  if (master.contract !== DESIGN_MASTER_CONTRACT) fail("master_contract_invalid", `contract must be ${DESIGN_MASTER_CONTRACT}`);

  requireUuid(master.masterId, "masterId");
  requireUuid(master.revisionId, "revisionId");
  requireUuid(master.vehicleId, "vehicleId");
  requireUuid(master.dimensionManifestId, "dimensionManifestId");
  requireHash(master.manifestHash, "manifestHash");
  if (!String(master.designId || "").trim()) fail("master_design_id_missing", "designId is required");

  const unwrap = validateUnwrap(master.unwrap);
  const surfaceKeys = new Set(unwrap.surfaces.map((surface) => surface.surfaceKey));
  const assets = validateAssets(master.assets);
  const palette = validatePalette(master.palette);
  const fonts = validateFonts(master.fonts);

  validateLayers(master.layers, { assets, palette, surfaceKeys });
  validateTextObjects(master.textObjects, { fonts, palette, surfaceKeys });
  validateLogoObjects(master.logoObjects, { assets, surfaceKeys });

  const computed = designMasterHash(master);
  if (master.masterHash !== undefined && String(master.masterHash).toLowerCase() !== computed) {
    fail("master_hash_mismatch", "masterHash does not match the canonical form of this master");
  }
  return Object.freeze({ ...master, masterHash: computed });
}

/**
 * Whether a placed raster actually carries the resolution it promises. The
 * renderer calls this per placement; a master can be structurally perfect and
 * still be unprintable if its artwork is too small for the surface it covers.
 */
function placedResolution(asset, placedWidthIn) {
  const width = requireFinite(placedWidthIn, "placedWidthIn", { positive: true });
  if (asset.kind !== "raster") return { vector: true, ok: true };
  const pxPerInch = Number(asset.intrinsic.widthPx) / width;
  return { vector: false, pxPerInch, required: Number(asset.minPxPerInch), ok: pxPerInch >= Number(asset.minPxPerInch) };
}

module.exports = {
  DESIGN_MASTER_CONTRACT,
  UNWRAP_CONTRACT,
  SURFACE_KEYS,
  SEAM_EDGES,
  SEAM_CONTINUITY,
  LAYER_TYPES,
  BLEND_MODES,
  MASK_TYPES,
  ASSET_KINDS,
  GLOBAL_SPACE,
  DesignMasterError,
  canonical,
  designMasterHash,
  validateDesignMaster,
  placedResolution,
  _test: { validateUnwrap, validateAssets, validatePalette, validateFonts, validateLayers, validateTextObjects, validateLogoObjects },
};
