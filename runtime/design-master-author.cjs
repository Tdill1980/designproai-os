"use strict";

/**
 * Phase 6: the Design Master author.
 *
 * This is the piece Phases 1-5 deliberately left out. They built the contract,
 * the deterministic renderer, the two derived proofs, and revision/approval
 * identity — everything downstream of a master. Nothing produced one.
 *
 * THE DIVISION OF AUTHORITY, MADE MECHANICAL.
 *
 * A model is very good at imagery and very bad at being a system of record. So
 * a model may generate photography, backgrounds, textures, patterns, abstract
 * graphics and decorative artwork, and may recommend how those are composed.
 * Everything a customer could be harmed by getting wrong — the spelling of
 * their own domain, which file their logo is, how big a panel is, where the
 * trim line falls, which flank mirrors — is assembled here from sources that
 * are already authoritative:
 *
 *   canonical text     <- the frozen revision snapshot
 *   logo identity      <- the expected logo inventory
 *   surface geometry   <- the GENIE dimension manifest
 *   extents/transforms <- declared, and clamped into the design space
 *
 * WHY THIS IS NOT THE OLD CALL 8 UNDER A NEW NAME. Call 8 asked a model to draw
 * the finished flat artwork, so the model's picture *was* the manufacturing
 * master: the lettering in it was the lettering that printed, and production
 * panels were cut out of it. Here a creative asset is a layer — one input among
 * several, composited under type and logos that this module places itself. A
 * creative asset that arrived with a customer's URL painted into it would still
 * not be the source of that URL, and the checks below refuse it outright rather
 * than let it become one quietly.
 *
 * The model never sees a brief containing canonical strings or logo files, and
 * never supplies geometry. Both are enforced, not documented.
 */

const { createHash } = require("node:crypto");
const {
  DESIGN_MASTER_CONTRACT, DESIGN_SPACE_CONTRACT, SURFACE_KEYS, GLOBAL_SPACE,
  LAYER_TYPES, BLEND_MODES, TRANSFORM_KEYS, validateDesignMaster,
} = require("./design-master.cjs");

const AUTHOR_CONTRACT = "designpro.design-master-author.v1";
const CREATIVE_BRIEF_CONTRACT = "designpro.creative-brief.v1";

// What a model is allowed to contribute. Every one of these is decoration: none
// of them carries identity, and none of them can be the source of a fact.
const CREATIVE_ROLES = Object.freeze([
  "photography", "background", "texture", "pattern", "abstract", "decorative",
]);
// A creative asset is imagery. Type and marks are placed by this module, so
// those layer types are not available to creative input.
const CREATIVE_LAYER_TYPES = Object.freeze(["raster", "vector", "gradient", "pattern", "solid"]);

const HASH_RE = /^[0-9a-f]{64}$/;
const BLEED_INCHES = 5;
// Gap between surfaces in the shared design space, matching the renderer's
// windowing: two bleeds plus a separator, so no surface samples its neighbour.
const SURFACE_GUTTER_IN = 2;

class AuthorError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "AuthorError";
  }
}

function fail(code, message) {
  throw new AuthorError(code, message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireString(value, label) {
  const text = String(value == null ? "" : value).trim();
  if (!text) fail("author_field_missing", `${label} is required`);
  return text;
}

function requireHash(value, label) {
  const text = String(value || "").trim().toLowerCase();
  if (!HASH_RE.test(text)) fail("author_hash_invalid", `${label} must be a sha256 hex digest`);
  return text;
}

function requireFinite(value, label, { min = -1e9, max = 1e9 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    fail("author_number_invalid", `${label} must be a finite number between ${min} and ${max}`);
  }
  return number;
}

// ------------------------------------------------------------------ geometry

/**
 * The design space, built from the GENIE manifest and from nothing else.
 *
 * Surface geometry is manufacturing truth: it decides how much vinyl is cut and
 * where the trim line falls. It is read here from the bound dimension manifest,
 * never measured off a render and never suggested by a model. Reconstructing
 * geometry from a picture of a vehicle is the inverse problem that made the
 * retired path unsafe, and it does not get a second entrance through the author.
 */
function designSpaceFromManifest(manifest, { designSpaceId, mappings }) {
  const expected = Array.isArray(manifest?.expectedSurfaces) ? manifest.expectedSurfaces : null;
  if (!expected) fail("author_manifest_missing", "the author requires the bound GENIE dimension manifest");

  const byKey = new Map();
  for (const entry of expected) {
    const surfaceKey = String(entry?.surfaceKey || "").trim().toLowerCase();
    if (!SURFACE_KEYS.includes(surfaceKey)) continue;
    const widthIn = requireFinite(entry.widthInches, `${surfaceKey}.widthInches`, { min: 0.01, max: 1e5 });
    const heightIn = requireFinite(entry.heightInches, `${surfaceKey}.heightInches`, { min: 0.01, max: 1e5 });
    if (byKey.has(surfaceKey)) fail("author_manifest_surface_duplicated", `the manifest declares ${surfaceKey} twice`);
    byKey.set(surfaceKey, { widthIn, heightIn });
  }
  const missing = SURFACE_KEYS.filter((key) => !byKey.has(key));
  if (missing.length) fail("author_manifest_incomplete", `the manifest is missing ${missing.join(", ")}`);

  let x = 0;
  const surfaces = SURFACE_KEYS.map((surfaceKey) => {
    const { widthIn, heightIn } = byKey.get(surfaceKey);
    const mapping = mappings?.[surfaceKey];
    if (!mapping) fail("author_mapping_missing", `${surfaceKey} has no declared surface mapping`);
    const surface = {
      surfaceKey,
      originIn: [x, 0],
      widthIn,
      heightIn,
      // The passenger flank mirrors. This is a property of the vehicle, so it
      // is set here rather than left to a composition recommendation.
      mirror: surfaceKey === "passenger",
      mapping: {
        kind: "planar-developable",
        mappingId: requireString(mapping.mappingId, `${surfaceKey}.mappingId`),
        mappingHash: requireHash(mapping.mappingHash, `${surfaceKey}.mappingHash`),
      },
      seams: [],
    };
    x += widthIn + BLEED_INCHES * 2 + SURFACE_GUTTER_IN;
    return surface;
  });
  return {
    space: {
      contract: DESIGN_SPACE_CONTRACT,
      designSpaceId: requireString(designSpaceId, "designSpaceId"),
      unitsPerInch: 1,
      surfaces,
    },
    widthIn: x,
    // Bleed on both edges, because artwork is meant to run past the trim line.
    // Bounding the space at trim would refuse exactly the full-bleed designs the
    // renderer samples bleed for.
    heightIn: Math.max(...surfaces.map((surface) => surface.heightIn)) + BLEED_INCHES * 2,
  };
}

// ------------------------------------------------------------------ creative

/**
 * The brief a model is given, with everything it must not see removed.
 *
 * A model that is handed the customer's strings will put them in the picture —
 * that is what it is for — and then the artwork contains lettering nobody
 * placed and nothing verifies. So the brief is checked before it is sent, and
 * a brief carrying a canonical string, a logo file or panel geometry is refused
 * rather than sanitised. Sanitising would let a caller keep making the same
 * mistake and never find out.
 */
function assertCreativeBriefIsClean(brief, { textStrings, logoHashes }) {
  if (!brief || brief.contract !== CREATIVE_BRIEF_CONTRACT) {
    fail("author_brief_contract_invalid", `the creative brief must declare ${CREATIVE_BRIEF_CONTRACT}`);
  }
  const serialised = JSON.stringify(brief);
  const haystack = serialised.toLowerCase();
  for (const string of textStrings) {
    const needle = String(string).trim().toLowerCase();
    // Short strings collide with ordinary prose; long ones are the ones that
    // matter, and are exactly what a model would letter into artwork.
    if (needle.length >= 4 && haystack.includes(needle)) {
      fail("author_brief_carries_canonical_text",
        `the creative brief contains the canonical string "${string}", which the model must not letter into artwork`);
    }
  }
  for (const hash of logoHashes) {
    if (haystack.includes(hash)) {
      fail("author_brief_carries_logo", "the creative brief references a logo file, which the model must not draw");
    }
  }
  for (const field of ["widthInches", "heightInches", "surfaceSqFt", "bleed", "trimWidthIn", "expectedSurfaces", "dimensionManifestId"]) {
    if (serialised.includes(field)) {
      fail("author_brief_carries_geometry",
        `the creative brief contains ${field}: production geometry comes from the manifest, and a model must not be in a position to return it`);
    }
  }
  return brief;
}

/**
 * A creative asset: imagery, and only imagery.
 *
 * The role is declared and closed. An asset presenting itself as a logo, or
 * claiming to carry canonical text, is refused — not because the check could
 * detect lettering inside a raster, but because accepting the claim is what
 * would make it authoritative. Identity in this system comes from the
 * inventory and the revision snapshot; an asset cannot promote itself.
 */
function validateCreativeAsset(asset, index) {
  const label = `creativeAssets[${index}]`;
  if (!asset || typeof asset !== "object") fail("author_creative_invalid", `${label} must be an object`);
  const role = String(asset.role || "").trim().toLowerCase();
  if (!CREATIVE_ROLES.includes(role)) {
    fail("author_creative_role_unknown", `${label}.role must be one of ${CREATIVE_ROLES.join(", ")}`);
  }
  if (asset.textId !== undefined || asset.logoIdentityKey !== undefined || asset.carriesText || asset.carriesLogo) {
    fail("author_creative_claims_identity",
      `${label} presents itself as carrying canonical text or a logo; identity comes from the revision snapshot and the logo inventory, never from generated artwork`);
  }
  const kind = String(asset.kind || "").trim();
  if (kind !== "raster" && kind !== "vector") fail("author_creative_kind_invalid", `${label}.kind must be raster or vector`);
  const validated = {
    assetId: requireString(asset.assetId, `${label}.assetId`),
    kind,
    contentHash: requireHash(asset.contentHash, `${label}.contentHash`),
    storagePath: requireString(asset.storagePath, `${label}.storagePath`),
    role,
    // Recorded so the finished master says which of its pixels were generated
    // and which were placed. A design nobody can audit later is a design that
    // has to be trusted.
    generatedBy: requireString(asset.generatedBy, `${label}.generatedBy`),
  };
  if (kind === "raster") {
    const intrinsic = asset.intrinsic || {};
    validated.intrinsic = {
      widthPx: requireFinite(intrinsic.widthPx, `${label}.intrinsic.widthPx`, { min: 1, max: 1e6 }),
      heightPx: requireFinite(intrinsic.heightPx, `${label}.intrinsic.heightPx`, { min: 1, max: 1e6 }),
    };
    validated.minPxPerInch = requireFinite(asset.minPxPerInch ?? 1, `${label}.minPxPerInch`, { min: 0.01, max: 1e4 });
  }
  return validated;
}

/**
 * A composition recommendation, clamped into the design space.
 *
 * A model may say where it thinks a texture should sit and how it should blend.
 * It may not say how big the panel is, which surface mirrors, or what any of it
 * means. Every value below is bounded by geometry the manifest already fixed,
 * so an over-confident recommendation produces a design that is merely not to
 * taste rather than one that is wrong.
 */
function creativeLayer(placement, index, { assets, space }) {
  const label = `composition.layers[${index}]`;
  if (!placement || typeof placement !== "object") fail("author_composition_invalid", `${label} must be an object`);
  const assetId = requireString(placement.assetId, `${label}.assetId`);
  const asset = assets.get(assetId);
  if (!asset) fail("author_composition_asset_unknown", `${label} places ${assetId}, which is not a creative asset`);

  const type = String(placement.type || asset.kind).trim();
  if (!CREATIVE_LAYER_TYPES.includes(type) || !LAYER_TYPES.includes(type)) {
    fail("author_composition_type_invalid", `${label}.type must be one of ${CREATIVE_LAYER_TYPES.join(", ")}`);
  }
  const surfaceKey = placement.space === undefined || placement.space === GLOBAL_SPACE
    ? GLOBAL_SPACE
    : String(placement.space).trim();
  if (surfaceKey !== GLOBAL_SPACE && !SURFACE_KEYS.includes(surfaceKey)) {
    fail("author_composition_space_invalid", `${label}.space must be ${GLOBAL_SPACE} or one of the six surfaces`);
  }
  const bounds = surfaceKey === GLOBAL_SPACE
    ? { widthIn: space.widthIn, heightIn: space.heightIn }
    : (() => {
      const surface = space.space.surfaces.find((item) => item.surfaceKey === surfaceKey);
      return { widthIn: surface.widthIn + BLEED_INCHES * 2, heightIn: surface.heightIn + BLEED_INCHES * 2 };
    })();

  const extent = placement.extent || {};
  const blend = String(placement.blend || "normal");
  if (!BLEND_MODES.includes(blend)) fail("author_composition_blend_invalid", `${label}.blend is not a blend mode`);

  const transform = { x: 0, y: 0, scale: 1, rotate: 0 };
  for (const [key, value] of Object.entries(placement.transform || {})) {
    if (!TRANSFORM_KEYS.includes(key)) fail("author_composition_transform_key_unknown", `${label}.transform.${key} is not a transform field`);
    transform[key] = requireFinite(value, `${label}.transform.${key}`);
  }
  return {
    layerId: requireString(placement.layerId, `${label}.layerId`),
    type,
    space: surfaceKey,
    assetId,
    extent: {
      widthIn: requireFinite(extent.widthIn, `${label}.extent.widthIn`, { min: 0.01, max: bounds.widthIn }),
      heightIn: requireFinite(extent.heightIn, `${label}.extent.heightIn`, { min: 0.01, max: bounds.heightIn }),
    },
    transform,
    // Creative layers occupy the lower band of the z-order by construction, so
    // no recommendation can put decoration on top of type or a mark.
    zOrder: 10 + Math.min(499, Math.max(0, Math.round(requireFinite(placement.zOrder ?? index, `${label}.zOrder`, { min: 0, max: 499 })))),
    opacity: requireFinite(placement.opacity ?? 1, `${label}.opacity`, { min: 0, max: 1 }),
    blend,
    mask: { type: "none" },
  };
}

// ------------------------------------------------------- authoritative layers

const TYPE_Z_BASE = 600;
const LOGO_Z_BASE = 800;

/**
 * Canonical text, placed deterministically.
 *
 * The string comes from the frozen revision snapshot and is copied, never
 * regenerated or re-typed. That is the whole lesson of the defect that started
 * this work: a second rendering of one string is a second chance to get it
 * wrong, and "PrecisionsClimateAz.com" is what that looks like on a vehicle.
 */
function textLayers(bodyText, { space, typography }) {
  const objects = [];
  const layers = [];
  const entries = Array.isArray(bodyText) ? bodyText : [];
  entries.forEach((entry, index) => {
    const textId = requireString(entry?.textId, `bodyText[${index}].textId`);
    const string = requireString(entry?.string, `bodyText[${index}].string`);
    const surfaceKey = String(entry?.surfaceKey || "").trim();
    if (!SURFACE_KEYS.includes(surfaceKey)) fail("author_text_surface_invalid", `bodyText[${index}].surfaceKey must be one of the six surfaces`);
    const surface = space.space.surfaces.find((item) => item.surfaceKey === surfaceKey);

    if (!objects.some((item) => item.textId === textId)) {
      objects.push({
        textId, string,
        fontId: requireString(entry.fontId || typography.fontId, `bodyText[${index}].fontId`),
        sizeIn: requireFinite(entry.sizeIn, `bodyText[${index}].sizeIn`, { min: 0.05, max: surface.heightIn }),
        colorToken: requireString(entry.colorToken || typography.colorToken, `bodyText[${index}].colorToken`),
        // Type never mirrors, on any surface, ever.
        neverMirror: true,
        spellingAuthority: "revision-snapshot",
      });
    } else {
      const existing = objects.find((item) => item.textId === textId);
      if (existing.string !== string) {
        fail("author_text_identity_conflict", `${textId} is declared with two different strings`);
      }
    }
    layers.push({
      layerId: `text-${textId}-${surfaceKey}`,
      type: "text",
      space: surfaceKey,
      textId,
      extent: {
        widthIn: requireFinite(entry.extent?.widthIn, `bodyText[${index}].extent.widthIn`, { min: 0.05, max: surface.widthIn + BLEED_INCHES * 2 }),
        heightIn: requireFinite(entry.extent?.heightIn, `bodyText[${index}].extent.heightIn`, { min: 0.05, max: surface.heightIn + BLEED_INCHES * 2 }),
      },
      transform: {
        x: requireFinite(entry.transform?.x ?? 0, `bodyText[${index}].transform.x`),
        y: requireFinite(entry.transform?.y ?? 0, `bodyText[${index}].transform.y`),
        scale: 1, rotate: requireFinite(entry.transform?.rotate ?? 0, `bodyText[${index}].transform.rotate`, { min: -180, max: 180 }),
      },
      zOrder: TYPE_Z_BASE + index,
      opacity: 1,
      blend: "normal",
      mask: { type: "none" },
    });
  });
  return { objects, layers };
}

/**
 * Logos, placed from the inventory by identity and digest.
 *
 * A logo is a file, not a picture of a file. Its identity here is the pair the
 * inventory froze, so a mark can be placed many times and every placement is
 * provably the same file — and a mark that is a different file on two panels
 * is refused downstream by the proof rather than printed.
 */
function logoLayers(inventory, { space, placements }) {
  const objects = [];
  const layers = [];
  inventory.forEach((item, index) => {
    const identityKey = requireString(item?.identityKey, `logoInventory[${index}].identityKey`);
    const surfaceKey = String(item?.surfaceKey || item?.targetSurfaceKey || "").trim();
    if (!SURFACE_KEYS.includes(surfaceKey)) fail("author_logo_surface_invalid", `logoInventory[${index}].surfaceKey must be one of the six surfaces`);
    const surface = space.space.surfaces.find((entry) => entry.surfaceKey === surfaceKey);
    const contentHash = requireHash(item.contentHash, `logoInventory[${index}].contentHash`);
    const assetId = `logo-${identityKey}`;
    const placement = placements?.[`${identityKey}:${surfaceKey}`] || placements?.[identityKey];
    if (!placement) fail("author_logo_placement_missing", `${identityKey} on ${surfaceKey} has no declared placement`);

    if (!objects.some((entry) => entry.identityKey === identityKey && entry.surfaceKey === surfaceKey)) {
      objects.push({
        identityKey, assetId, contentHash, surfaceKey,
        neverMirror: true,
        neverRasterizeIntoBase: true,
      });
    }
    layers.push({
      layerId: `logo-${identityKey}-${surfaceKey}`,
      type: "logo",
      space: surfaceKey,
      logoIdentityKey: identityKey,
      extent: {
        widthIn: requireFinite(placement.widthIn, `${identityKey}.widthIn`, { min: 0.05, max: surface.widthIn + BLEED_INCHES * 2 }),
        heightIn: requireFinite(placement.heightIn, `${identityKey}.heightIn`, { min: 0.05, max: surface.heightIn + BLEED_INCHES * 2 }),
      },
      transform: {
        x: requireFinite(placement.x ?? 0, `${identityKey}.x`),
        y: requireFinite(placement.y ?? 0, `${identityKey}.y`),
        scale: 1, rotate: 0,
      },
      zOrder: LOGO_Z_BASE + index,
      opacity: 1,
      blend: "normal",
      mask: { type: "none" },
    });
  });
  return { objects, layers };
}

// -------------------------------------------------------------------- author

/**
 * Assemble a canonical Design Master.
 *
 * Creative input goes in underneath; canonical text and logos go on top, placed
 * by this module from sources that were already authoritative. The result is
 * validated against the Phase 1 contract in full, so an assembly that breaks
 * any manufacturing rule fails here rather than at a renderer or a printer.
 */
function authorDesignMaster({
  identity, revisionSnapshot, manifest,
  creativeBrief, creativeAssets = [], composition = {},
  typography, logoPlacements, palette, fonts,
}) {
  const snapshot = revisionSnapshot && typeof revisionSnapshot === "object" ? revisionSnapshot : null;
  if (!snapshot || snapshot.contractVersion !== "designpro.revision-snapshot.v1") {
    fail("author_revision_snapshot_invalid", "the author requires the frozen designpro.revision-snapshot.v1");
  }
  // FAIL LOUDLY ON A MALFORMED bodyText. This used to read
  //   Array.isArray(snapshot.bodyText) ? snapshot.bodyText : []
  // and that ternary hid the whole branding defect. The handoff froze bodyText
  // as a STRING (the brief prose) and the canary as an OBJECT
  // ({designName}); both are non-arrays, both silently became zero text
  // layers, and the master went on to report textIdentities:[] as though the
  // design genuinely carried no type. Six unbranded panels shipped with no
  // error raised at any stage. An absent bodyText is a real state -- a design
  // may carry no type -- but a bodyText of the WRONG SHAPE is a broken
  // producer, and the two must never look identical again.
  if (snapshot.bodyText !== undefined && snapshot.bodyText !== null && !Array.isArray(snapshot.bodyText)) {
    fail("author_body_text_malformed",
      `the revision snapshot froze bodyText as ${Array.isArray(snapshot.bodyText) ? "an array" : typeof snapshot.bodyText}; it must be an array of text-layer specs, and a non-array is a producer defect rather than a design without type`);
  }
  const bodyText = Array.isArray(snapshot.bodyText) ? snapshot.bodyText : [];
  const inventory = Array.isArray(snapshot.expectedLogoInventory) ? snapshot.expectedLogoInventory : null;
  if (!inventory) fail("author_logo_inventory_missing", "the revision snapshot must freeze expectedLogoInventory");

  const space = designSpaceFromManifest(manifest, {
    designSpaceId: identity?.designSpaceId,
    mappings: identity?.surfaceMappings,
  });

  // The brief is checked against the very things it must not contain, taken
  // from the snapshot rather than from the caller's word for it.
  assertCreativeBriefIsClean(creativeBrief, {
    textStrings: bodyText.map((entry) => entry?.string).filter(Boolean),
    logoHashes: inventory.map((item) => String(item?.contentHash || "").toLowerCase()).filter(Boolean),
  });

  const creative = creativeAssets.map(validateCreativeAsset);
  const creativeById = new Map(creative.map((asset) => [asset.assetId, asset]));
  if (creativeById.size !== creative.length) fail("author_creative_duplicated", "two creative assets share one assetId");

  // Checked before anything is placed. An asset that occupies a logo identity's
  // slot is wrong whether or not the composition happens to reference it, and
  // catching it only when placed would make the guard depend on the layout.
  for (const item of inventory) {
    const reserved = `logo-${String(item?.identityKey || "").trim()}`;
    if (creativeById.has(reserved)) {
      fail("author_creative_shadows_logo", `a creative asset is using ${reserved}, which belongs to a logo identity`);
    }
  }

  const placements = Array.isArray(composition.layers) ? composition.layers : [];
  if (!placements.length) fail("author_composition_empty", "a design must place at least one creative asset");
  const creativeLayers = placements.map((placement, index) => creativeLayer(placement, index, { assets: creativeById, space }));

  const text = textLayers(bodyText, { space, typography: typography || {} });
  const logos = logoLayers(inventory, { space, placements: logoPlacements });

  // Logo files enter the asset table by identity and digest, from the
  // inventory. A creative asset may not occupy one of these ids.
  const logoAssets = [];
  for (const object of logos.objects) {
    if (creativeById.has(object.assetId)) {
      fail("author_creative_shadows_logo", `a creative asset is using ${object.assetId}, which belongs to a logo identity`);
    }
    if (!logoAssets.some((asset) => asset.assetId === object.assetId)) {
      const item = inventory.find((entry) => entry.identityKey === object.identityKey);
      logoAssets.push({
        assetId: object.assetId,
        kind: String(item.kind || "vector") === "raster" ? "raster" : "vector",
        contentHash: object.contentHash,
        storagePath: requireString(item.storagePath, `${object.identityKey}.storagePath`),
        ...(String(item.kind || "") === "raster" ? {
          intrinsic: {
            widthPx: requireFinite(item.intrinsic?.widthPx, `${object.identityKey}.intrinsic.widthPx`, { min: 1, max: 1e6 }),
            heightPx: requireFinite(item.intrinsic?.heightPx, `${object.identityKey}.intrinsic.heightPx`, { min: 1, max: 1e6 }),
          },
          minPxPerInch: 1,
        } : {}),
      });
    }
  }

  const master = validateDesignMaster({
    contract: DESIGN_MASTER_CONTRACT,
    masterId: requireString(identity?.masterId, "identity.masterId"),
    revisionId: requireString(identity?.revisionId, "identity.revisionId"),
    vehicleId: requireString(identity?.vehicleId, "identity.vehicleId"),
    dimensionManifestId: requireString(identity?.dimensionManifestId, "identity.dimensionManifestId"),
    manifestHash: requireHash(identity?.manifestHash, "identity.manifestHash"),
    designId: requireString(snapshot.designId, "revisionSnapshot.designId"),
    revisionSequence: Number.isInteger(identity?.revisionSequence) ? identity.revisionSequence : 0,
    designSpace: space.space,
    assets: [...creative.map(({ role, generatedBy, ...asset }) => asset), ...logoAssets],
    palette: palette || [],
    fonts: fonts || [],
    layers: [...creativeLayers, ...text.layers, ...logos.layers],
    textObjects: text.objects,
    logoObjects: logos.objects,
    // Provenance: which pixels were generated, and by what. Recorded on the
    // master so an audit never has to reconstruct it.
    creativeProvenance: creative.map(({ assetId, role, generatedBy, contentHash }) => ({ assetId, role, generatedBy, contentHash })),
    authorContract: AUTHOR_CONTRACT,
    masterHash: undefined,
  });

  return Object.freeze({
    master,
    // Everything a caller needs to load what the master references, without
    // going back to the snapshot and re-deriving the mapping.
    assetSources: Object.freeze([
      ...creative.map((asset) => ({ assetId: asset.assetId, storagePath: asset.storagePath, contentHash: asset.contentHash })),
      ...logoAssets.map((asset) => ({ assetId: asset.assetId, storagePath: asset.storagePath, contentHash: asset.contentHash })),
    ]),
  });
}

module.exports = {
  AUTHOR_CONTRACT,
  CREATIVE_BRIEF_CONTRACT,
  CREATIVE_ROLES,
  CREATIVE_LAYER_TYPES,
  BLEED_INCHES,
  AuthorError,
  authorDesignMaster,
  assertCreativeBriefIsClean,
  _test: { designSpaceFromManifest, validateCreativeAsset, creativeLayer, textLayers, logoLayers, sha256 },
};
