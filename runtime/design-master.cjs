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
 * identity, mirroring and placement. Nothing downstream may heal, invent or
 * substitute any of them.
 *
 * PHASE 1 SCOPE. Contract only: shape, canonical form, identity hash and
 * fail-closed validation. It renders nothing and is wired to nothing.
 *
 * NAMING HONESTY. The shared coordinate system here is a 2D design space in
 * inches, not a general vehicle UV parameterisation. Each production surface is
 * placed in it as a rectangle, which is exactly what GENIE resolves today
 * (widthInches x heightInches per surface). Calling that "UV" would be a label
 * over another flat atlas. Every surface therefore carries an explicit `mapping`
 * identity declaring how its rectangle projects onto physical geometry; v1
 * admits only `planar-developable`, and a richer parameterisation arrives as a
 * new mapping kind without reshaping this contract.
 */

const { createHash } = require("node:crypto");

const DESIGN_MASTER_CONTRACT = "designpro.design-master.v1";
const DESIGN_SPACE_CONTRACT = "designpro.design-space.v1";

// The same six surfaces the GENIE manifest and every downstream stage already
// use. Surface identity is closed; surface *appearance* deliberately is not.
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);

// Edges are named in the surface's own orientation, not vehicle-relative.
// "front" is ambiguous for a hood — its forward edge is the grille end, but its
// seam to a flank is a side edge. Rectangle-local names are unambiguous for
// every surface; where a surface sits is carried by originIn.
const SEAM_EDGES = Object.freeze(["left", "right", "top", "bottom"]);
const SEAM_ORIENTATIONS = Object.freeze(["same", "reversed"]);
const SEAM_CONTINUITY = Object.freeze(["exact", "tolerance", "none"]);

// v1 projects a rectangle onto a surface that can be flattened without
// distortion. Anything else is a different mapping kind, declared as such.
const MAPPING_KINDS = Object.freeze(["planar-developable"]);

const LAYER_TYPES = Object.freeze(["raster", "vector", "text", "logo", "gradient", "pattern", "solid"]);
// The compositor's primitive set is the ceiling on achievable design quality. A
// master that cannot express a multiply blend or a feathered mask forces a
// template look no matter how good the creative upstream is.
const BLEND_MODES = Object.freeze(["normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "darken", "lighten"]);
const MASK_TYPES = Object.freeze(["none", "path", "raster"]);
const ASSET_KINDS = Object.freeze(["raster", "vector"]);
const SPELLING_AUTHORITIES = Object.freeze(["revision-snapshot"]);
// A per-surface override may adjust placement, never identity. mirror, content,
// blend and z-order are surface- or master-level authority and are absent here
// deliberately: an untyped escape hatch would let per-surface state bypass the
// canonical rules this contract exists to enforce.
const SURFACE_OVERRIDE_KEYS = Object.freeze(["visible", "opacity", "transform"]);
const TRANSFORM_KEYS = Object.freeze(["x", "y", "scale", "rotate", "skew"]);
const GLOBAL_SPACE = "global";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SRGB_RE = /^#[0-9a-f]{6}$/;
const SEAM_EPSILON = 1e-9;

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

function requireClosedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail("master_unknown_property", `${label}.${key} is not a permitted property`);
  }
  return value;
}

// -------------------------------------------------------------------- seams

/**
 * Where a point on one seam lands on its partner.
 *
 * Reciprocal adjacency alone says two edges touch; it does not say whether 20%
 * along one edge meets 20% or 80% along the other. Without that, a graphic
 * crossing the seam cannot be placed, and the renderer would be free to invent
 * the correspondence. `span` -> `joinSpan` is a linear map on normalised edge
 * parameters, and `orientation` is a redundant declaration of its direction so
 * an authoring mistake fails here rather than becoming renderer behaviour.
 */
function seamPoint(seam, t) {
  const [a, b] = seam.span;
  const [c, d] = seam.joinSpan;
  return c + ((t - a) / (b - a)) * (d - c);
}

function validateSeamSpan(raw, label) {
  const span = requireArray(raw, label);
  if (span.length !== 2) fail("seam_span_invalid", `${label} must be [t0, t1]`);
  const t0 = requireFinite(span[0], `${label}[0]`, { min: 0, max: 1 });
  const t1 = requireFinite(span[1], `${label}[1]`, { min: 0, max: 1 });
  if (Math.abs(t1 - t0) < SEAM_EPSILON) fail("seam_span_invalid", `${label} must cover a non-zero range`);
  return [t0, t1];
}

function validateSeam(raw, surfaceKey) {
  const seam = requireObject(raw, `${surfaceKey}.seams[]`);
  requireOneOf(seam.edge, SEAM_EDGES, `${surfaceKey}.seam.edge`);
  const joins = requireOneOf(seam.joins, SURFACE_KEYS, `${surfaceKey}.seam.joins`);
  if (joins === surfaceKey) fail("seam_self", `${surfaceKey} cannot seam to itself`);
  requireOneOf(seam.joinEdge, SEAM_EDGES, `${surfaceKey}.seam.joinEdge`);
  requireOneOf(seam.continuity, SEAM_CONTINUITY, `${surfaceKey}.seam.continuity`);

  const span = validateSeamSpan(seam.span, `${surfaceKey}.seam.span`);
  if (span[1] <= span[0]) fail("seam_span_invalid", `${surfaceKey}.seam.span must increase; direction is carried by joinSpan`);
  const joinSpan = validateSeamSpan(seam.joinSpan, `${surfaceKey}.seam.joinSpan`);

  const orientation = requireOneOf(seam.orientation, SEAM_ORIENTATIONS, `${surfaceKey}.seam.orientation`);
  const observed = joinSpan[1] > joinSpan[0] ? "same" : "reversed";
  if (orientation !== observed) {
    fail("seam_orientation_mismatch", `${surfaceKey}.${seam.edge} declares ${orientation} but its joinSpan runs ${observed}`);
  }
  return { ...seam, span, joinSpan, orientation };
}

/**
 * A seam is a claim about physical adjacency, so both sides must claim it, and
 * their correspondences must be mutual inverses. Checking the endpoints and the
 * midpoint is sufficient for a linear map and catches a reversed or truncated
 * partner span, which is the mistake authoring will actually make.
 */
function assertSeamsAgree(surfaces) {
  const byKey = new Map(surfaces.map((surface) => [surface.surfaceKey, surface]));
  for (const surface of surfaces) {
    for (const seam of surface.seams) {
      const partner = byKey.get(seam.joins);
      const back = partner.seams.find((other) => other.joins === surface.surfaceKey && other.edge === seam.joinEdge && other.joinEdge === seam.edge);
      if (!back) fail("seam_not_reciprocal", `${surface.surfaceKey}.${seam.edge} claims ${seam.joins}.${seam.joinEdge} but the claim is not returned`);
      if (back.continuity !== seam.continuity) fail("seam_continuity_disagrees", `${surface.surfaceKey}.${seam.edge} and ${seam.joins}.${seam.joinEdge} disagree on continuity`);
      if (back.orientation !== seam.orientation) fail("seam_orientation_disagrees", `${surface.surfaceKey}.${seam.edge} and ${seam.joins}.${seam.joinEdge} disagree on orientation`);
      for (const t of [seam.span[0], (seam.span[0] + seam.span[1]) / 2, seam.span[1]]) {
        const roundTrip = seamPoint(back, seamPoint(seam, t));
        if (Math.abs(roundTrip - t) > 1e-6) {
          fail("seam_mapping_not_invertible", `${surface.surfaceKey}.${seam.edge} -> ${seam.joins}.${seam.joinEdge} does not map back onto itself`);
        }
      }
    }
  }
}

// ------------------------------------------------------------- design space

function validateDesignSpace(raw) {
  const space = requireObject(raw, "designSpace");
  if (space.contract !== DESIGN_SPACE_CONTRACT) fail("design_space_contract_invalid", `designSpace.contract must be ${DESIGN_SPACE_CONTRACT}`);
  requireUuid(space.designSpaceId, "designSpace.designSpaceId");
  requireFinite(space.unitsPerInch, "designSpace.unitsPerInch", { positive: true });

  const surfaces = requireArray(space.surfaces, "designSpace.surfaces", { min: SURFACE_KEYS.length });
  const seen = new Set();
  const normalised = [];
  for (const entry of surfaces) {
    const surface = requireObject(entry, "designSpace.surfaces[]");
    const key = requireOneOf(surface.surfaceKey, SURFACE_KEYS, "surfaceKey");
    // Surface IDENTITY is unique. Surface APPEARANCE deliberately carries no
    // constraint: driver and passenger are routinely mirrors of one another and
    // on many wraps are identical. The retired guards rejected exactly that and
    // killed a real production run for it.
    if (seen.has(key)) fail("design_space_surface_duplicate", `${key} appears twice`);
    seen.add(key);

    const origin = requireArray(surface.originIn, `${key}.originIn`);
    if (origin.length !== 2) fail("design_space_origin_invalid", `${key}.originIn must be [x, y] in inches`);
    requireFinite(origin[0], `${key}.originIn[0]`);
    requireFinite(origin[1], `${key}.originIn[1]`);
    requireFinite(surface.widthIn, `${key}.widthIn`, { positive: true });
    requireFinite(surface.heightIn, `${key}.heightIn`, { positive: true });
    if (typeof surface.mirror !== "boolean") fail("design_space_mirror_invalid", `${key}.mirror must be a boolean`);

    // How this rectangle reaches physical geometry, declared rather than assumed.
    const mapping = requireObject(surface.mapping, `${key}.mapping`);
    requireOneOf(mapping.kind, MAPPING_KINDS, `${key}.mapping.kind`);
    requireUuid(mapping.mappingId, `${key}.mapping.mappingId`);
    requireHash(mapping.mappingHash, `${key}.mapping.mappingHash`);

    const seams = requireArray(surface.seams, `${key}.seams`).map((seam) => validateSeam(seam, key));
    normalised.push({ ...surface, surfaceKey: key, seams });
  }
  if (SURFACE_KEYS.some((key) => !seen.has(key))) fail("design_space_surface_set_incomplete", "the design space must cover all six surfaces");
  assertSeamsAgree(normalised);
  return { ...space, surfaces: normalised };
}

// ------------------------------------------------------------------- assets

/**
 * A structured master does not fix resolution on its own. If AI hands over a
 * 2048px texture and it is placed across 153 inches, the result is the same
 * 27 px/in that made the retired path unusable — just in a tidier wrapper.
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
    byId.set(assetId, { ...asset, assetId, kind });
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

// -------------------------------------------------- text and logo identities

/**
 * Text is an object with one canonical string, not pixels to be re-rendered per
 * view. A real job shipped PrecisionClimateAZ.com on one side and
 * PrecisionsClimateAz.com on the other because the passenger composition was
 * mirrored and its type separately re-rendered. Under this contract that
 * divergence has nowhere to occur.
 *
 * Placement lives on the layer, exactly as it does for every other layer type.
 * A text object owns content identity only, so there is never a second opinion
 * about where a string sits.
 */
function validateTextObjects(raw, { fonts, palette }) {
  const textObjects = requireArray(raw, "textObjects");
  const byId = new Map();
  for (const entry of textObjects) {
    const text = requireObject(entry, "textObjects[]");
    const textId = requireToken(text.textId, "text.textId");
    if (byId.has(textId)) fail("text_duplicate", `text object ${textId} is declared twice`);

    if (typeof text.string !== "string" || !text.string.length) fail("text_string_invalid", `${textId}.string must be a non-empty string`);
    const fontId = requireToken(text.fontId, `${textId}.fontId`);
    if (!fonts.has(fontId)) fail("text_font_unknown", `${textId} references undeclared font ${fontId}`);
    requireFinite(text.sizeIn, `${textId}.sizeIn`, { positive: true });
    if (text.tracking !== undefined) requireFinite(text.tracking, `${textId}.tracking`);
    if (!palette.has(requireToken(text.colorToken, `${textId}.colorToken`))) fail("text_color_unknown", `${textId} references undeclared colour token ${text.colorToken}`);

    // Type on a mirrored surface must not mirror with it. This is the whole
    // reason the retired path needed a second generative pass over the
    // passenger side, and the whole reason that pass could corrupt a domain.
    if (text.neverMirror !== true) fail("text_never_mirror_required", `${textId}.neverMirror must be true — type is never mirrored with its surface`);
    requireOneOf(text.spellingAuthority, SPELLING_AUTHORITIES, `${textId}.spellingAuthority`);
    byId.set(textId, text);
  }
  return byId;
}

/**
 * Logo identity is a stored file, never drawn. logos.extract already works this
 * way in the existing pipeline; this carries the same rule into the master.
 * Mirroring is stated rather than left to the compositor's ordering: an
 * overlay that happens to be applied after a mirror is an implementation
 * detail, and implementation details are not production authority.
 */
function validateLogoObjects(raw, { assets, surfaceKeys }) {
  const logoObjects = requireArray(raw, "logoObjects");
  const byKey = new Map();
  for (const entry of logoObjects) {
    const logo = requireObject(entry, "logoObjects[]");
    const identityKey = requireToken(logo.identityKey, "logo.identityKey");
    const surfaceKey = requireOneOf(logo.surfaceKey, [...surfaceKeys], "logo.surfaceKey");
    const placementKey = `${surfaceKey}:${identityKey}`;
    if (byKey.has(placementKey)) fail("logo_duplicate", `logo placement ${placementKey} is declared twice`);

    const assetId = requireToken(logo.assetId, `${identityKey}.assetId`);
    if (!assets.has(assetId)) fail("logo_asset_unknown", `${identityKey} references undeclared asset ${assetId}`);
    requireHash(logo.contentHash, `${identityKey}.contentHash`);
    if (assets.get(assetId).contentHash !== logo.contentHash) fail("logo_asset_hash_mismatch", `${identityKey}.contentHash does not match its asset`);
    if (logo.neverRasterizeIntoBase !== true) fail("logo_never_rasterize_required", `${identityKey}.neverRasterizeIntoBase must be true — logos overlay, they are never drawn into base artwork`);
    if (logo.neverMirror !== true) fail("logo_never_mirror_required", `${identityKey}.neverMirror must be true — a mirrored logo is a corrupted logo`);
    byKey.set(placementKey, { ...logo, identityKey, surfaceKey, placementKey });
  }
  return byKey;
}

// ------------------------------------------------------------------- layers

function validateTransform(raw, label, { partial = false } = {}) {
  const transform = requireObject(raw, label);
  requireClosedKeys(transform, TRANSFORM_KEYS, label);
  if (!partial) {
    requireFinite(transform.x, `${label}.x`);
    requireFinite(transform.y, `${label}.y`);
    requireFinite(transform.scale, `${label}.scale`, { positive: true });
    requireFinite(transform.rotate, `${label}.rotate`, { min: -360, max: 360 });
  } else {
    if (transform.x !== undefined) requireFinite(transform.x, `${label}.x`);
    if (transform.y !== undefined) requireFinite(transform.y, `${label}.y`);
    if (transform.scale !== undefined) requireFinite(transform.scale, `${label}.scale`, { positive: true });
    if (transform.rotate !== undefined) requireFinite(transform.rotate, `${label}.rotate`, { min: -360, max: 360 });
  }
  if (transform.skew !== undefined) requireFinite(transform.skew, `${label}.skew`, { min: -89, max: 89 });
  return transform;
}

function validateSurfaceOverrides(raw, label, surfaceKeys) {
  const overrides = requireObject(raw, label);
  for (const [key, value] of Object.entries(overrides)) {
    if (!surfaceKeys.has(key)) fail("layer_override_surface_unknown", `${label} references unknown surface ${key}`);
    const override = requireObject(value, `${label}.${key}`);
    // Closed by construction. An override adjusts placement, never identity:
    // mirror, content, blend and z-order are absent deliberately.
    requireClosedKeys(override, SURFACE_OVERRIDE_KEYS, `${label}.${key}`);
    if (Object.keys(override).length === 0) fail("layer_override_empty", `${label}.${key} declares no override`);
    if (override.visible !== undefined && typeof override.visible !== "boolean") fail("layer_override_invalid", `${label}.${key}.visible must be a boolean`);
    if (override.opacity !== undefined) requireFinite(override.opacity, `${label}.${key}.opacity`, { min: 0, max: 1 });
    if (override.transform !== undefined) validateTransform(override.transform, `${label}.${key}.transform`, { partial: true });
  }
  return overrides;
}

function validateMask(raw, label, assets) {
  const mask = requireObject(raw, label);
  const type = requireOneOf(mask.type, MASK_TYPES, `${label}.type`);
  if (type === "none") {
    if (mask.assetId !== undefined) fail("layer_mask_ref_unexpected", `${label} declares an asset for a mask of type none`);
    return mask;
  }
  // A mask decides which pixels manufacture. An arbitrary string is not
  // production authority; it has to resolve to a hashed, declared asset.
  const assetId = requireToken(mask.assetId, `${label}.assetId`);
  const asset = assets.get(assetId);
  if (!asset) fail("layer_mask_asset_unknown", `${label} references undeclared asset ${assetId}`);
  const expected = type === "path" ? "vector" : "raster";
  if (asset.kind !== expected) fail("layer_mask_kind_mismatch", `${label} is a ${type} mask and requires a ${expected} asset`);
  return mask;
}

function validateLayers(raw, { assets, palette, surfaceKeys, textObjects, logoObjects }) {
  const layers = requireArray(raw, "layers", { min: 1 });
  const ids = new Set();
  const boundText = new Map();
  const boundLogos = new Map();

  for (const entry of layers) {
    const layer = requireObject(entry, "layers[]");
    const layerId = requireToken(layer.layerId, "layer.layerId");
    if (ids.has(layerId)) fail("layer_duplicate", `layer ${layerId} is declared twice`);
    ids.add(layerId);

    const type = requireOneOf(layer.type, LAYER_TYPES, `${layerId}.type`);
    // "global" places the layer in the shared design coordinate system, which is
    // what lets one graphic run driver -> hood -> front as a single object
    // instead of six tiles that happen to abut.
    const space = String(layer.space || "").trim();
    if (space !== GLOBAL_SPACE && !surfaceKeys.has(space)) fail("layer_space_invalid", `${layerId}.space must be "${GLOBAL_SPACE}" or a surface key`);

    validateTransform(layer.transform, `${layerId}.transform`);
    requireFinite(layer.zOrder, `${layerId}.zOrder`);
    requireFinite(layer.opacity, `${layerId}.opacity`, { min: 0, max: 1 });
    requireOneOf(layer.blend, BLEND_MODES, `${layerId}.blend`);
    validateMask(layer.mask, `${layerId}.mask`, assets);

    if (layer.clipTo !== undefined) {
      for (const key of requireArray(layer.clipTo, `${layerId}.clipTo`)) {
        if (!surfaceKeys.has(String(key))) fail("layer_clip_invalid", `${layerId}.clipTo references unknown surface ${key}`);
      }
    }
    if (layer.surfaceOverrides !== undefined) validateSurfaceOverrides(layer.surfaceOverrides, `${layerId}.surfaceOverrides`, surfaceKeys);

    if (type === "raster" || type === "vector") {
      const assetId = requireToken(layer.assetId, `${layerId}.assetId`);
      const asset = assets.get(assetId);
      if (!asset) fail("layer_asset_unknown", `${layerId} references undeclared asset ${assetId}`);
      if (asset.kind !== type) fail("layer_asset_kind_mismatch", `${layerId} is a ${type} layer but ${assetId} is a ${asset.kind} asset`);
    }
    if (type === "solid" || type === "gradient" || type === "pattern") {
      for (const token of requireArray(layer.colorTokens, `${layerId}.colorTokens`, { min: 1 })) {
        if (!palette.has(String(token))) fail("layer_color_unknown", `${layerId} references undeclared colour token ${token}`);
      }
    }

    // A text layer that names no canonical string would defeat the spelling
    // authority this contract exists to establish.
    if (type === "text") {
      const textId = requireToken(layer.textId, `${layerId}.textId`);
      if (!textObjects.has(textId)) fail("layer_text_unknown", `${layerId} references undeclared text object ${textId}`);
      if (boundText.has(textId)) fail("layer_text_bound_twice", `text object ${textId} is placed by both ${boundText.get(textId)} and ${layerId}`);
      boundText.set(textId, layerId);
    } else if (layer.textId !== undefined) {
      fail("layer_text_unexpected", `${layerId} is a ${type} layer and must not name a text object`);
    }

    if (type === "logo") {
      const identityKey = requireToken(layer.logoIdentityKey, `${layerId}.logoIdentityKey`);
      if (space === GLOBAL_SPACE) fail("layer_logo_space_invalid", `${layerId} is a logo layer and must sit on a named surface`);
      const placementKey = `${space}:${identityKey}`;
      if (!logoObjects.has(placementKey)) fail("layer_logo_unknown", `${layerId} references undeclared logo placement ${placementKey}`);
      if (boundLogos.has(placementKey)) fail("layer_logo_bound_twice", `logo placement ${placementKey} is placed by both ${boundLogos.get(placementKey)} and ${layerId}`);
      boundLogos.set(placementKey, layerId);
    } else if (layer.logoIdentityKey !== undefined) {
      fail("layer_logo_unexpected", `${layerId} is a ${type} layer and must not name a logo`);
    }
  }

  // Binding runs both ways. A declared string or logo that nothing places is a
  // silent omission from manufacturing.
  for (const textId of textObjects.keys()) {
    if (!boundText.has(textId)) fail("text_not_placed", `text object ${textId} is declared but no layer places it`);
  }
  for (const placementKey of logoObjects.keys()) {
    if (!boundLogos.has(placementKey)) fail("logo_not_placed", `logo placement ${placementKey} is declared but no layer places it`);
  }
  return ids;
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

  const designSpace = validateDesignSpace(master.designSpace);
  const surfaceKeys = new Set(designSpace.surfaces.map((surface) => surface.surfaceKey));
  const assets = validateAssets(master.assets);
  const palette = validatePalette(master.palette);
  const fonts = validateFonts(master.fonts);
  const textObjects = validateTextObjects(master.textObjects, { fonts, palette });
  const logoObjects = validateLogoObjects(master.logoObjects, { assets, surfaceKeys });

  validateLayers(master.layers, { assets, palette, surfaceKeys, textObjects, logoObjects });

  const computed = designMasterHash(master);
  if (master.masterHash !== undefined && String(master.masterHash).toLowerCase() !== computed) {
    fail("master_hash_mismatch", "masterHash does not match the canonical form of this master");
  }
  return Object.freeze({ ...master, masterHash: computed });
}

/**
 * Whether a placed raster actually carries the resolution it promises.
 *
 * Width alone is not production safety: a 6000x1200 asset stretched to 163x66
 * inches passes a width check at 36 px/in horizontally while delivering 18
 * px/in vertically. Both axes are measured and the worst one governs.
 *
 * Rotation and skew are derated conservatively. A rotated raster resampled onto
 * an axis-aligned output grid draws each output row from a diagonal through the
 * source, so the worst-case source sampling interval grows by
 * |cos t| + |sin t|; skew adds |tan s|. This is a bound, not an optical model,
 * and it is deliberately pessimistic — a contract that flatters a placement is
 * worse than one that rejects a usable asset.
 */
function placedResolution(asset, placement) {
  const item = requireObject(asset, "asset");
  if (item.kind !== "raster") return Object.freeze({ vector: true, ok: true });

  const { widthIn, heightIn, rotate = 0, skew = 0 } = requireObject(placement, "placement");
  const width = requireFinite(widthIn, "placement.widthIn", { positive: true });
  const height = requireFinite(heightIn, "placement.heightIn", { positive: true });
  const rotateDeg = requireFinite(rotate, "placement.rotate", { min: -360, max: 360 });
  const skewDeg = requireFinite(skew, "placement.skew", { min: -89, max: 89 });

  const radians = (rotateDeg * Math.PI) / 180;
  const derate = Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)) + Math.abs(Math.tan((skewDeg * Math.PI) / 180));
  const ppiX = Number(item.intrinsic.widthPx) / width;
  const ppiY = Number(item.intrinsic.heightPx) / height;
  const effectivePpi = Math.min(ppiX, ppiY) / derate;
  const required = Number(item.minPxPerInch);

  return Object.freeze({
    vector: false,
    ppiX, ppiY, derate, effectivePpi, required,
    limitingAxis: ppiX <= ppiY ? "x" : "y",
    ok: effectivePpi >= required,
  });
}

module.exports = {
  DESIGN_MASTER_CONTRACT,
  DESIGN_SPACE_CONTRACT,
  SURFACE_KEYS,
  SEAM_EDGES,
  SEAM_ORIENTATIONS,
  SEAM_CONTINUITY,
  MAPPING_KINDS,
  LAYER_TYPES,
  BLEND_MODES,
  MASK_TYPES,
  ASSET_KINDS,
  SURFACE_OVERRIDE_KEYS,
  GLOBAL_SPACE,
  DesignMasterError,
  canonical,
  designMasterHash,
  validateDesignMaster,
  placedResolution,
  seamPoint,
  _test: { validateDesignSpace, validateAssets, validatePalette, validateFonts, validateLayers, validateTextObjects, validateLogoObjects, validateSeam },
};
