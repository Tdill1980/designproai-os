"use strict";

// Integration boundary for the NEW shared application. This module neither
// authors artwork nor pretends the external application has been deployed.
const { createHash } = require("node:crypto");
const CONTRACT = "designpro.panelpro-file-output-handoff.v1";
const SOURCE_APPS = Object.freeze(["DesignPro", "RecreatePro", "GraphicsPro", "WallPro"]);
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function digest(value) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function id(value) { if (typeof value !== "string" || !ID.test(value)) fail("panelprofile_identity_invalid"); return value; }
function hash(value) { if (typeof value !== "string" || !HASH.test(value)) fail("panelprofile_hash_invalid"); return value; }
function positive(value) { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail("panelprofile_dimension_invalid"); return value; }
function ref(value) {
  if (!value || typeof value.storagePath !== "string" || !value.storagePath
    || value.storagePath.startsWith("/") || value.storagePath.includes(":")
    || value.storagePath.split("/").some((part) => part === ".." || !part)) fail("panelprofile_storage_identity_invalid");
  return { storagePath: value.storagePath, contentHash: hash(value.contentHash) };
}

/**
 * Called only with owner-scoped, server-resolved inputs. A signed download URL
 * is not an immutable identity. The existing GenerationID / revision / order
 * identifiers are carried through, never reminted by this application.
 * Geometry below is inches at full size; drawing scale only affects exports.
 */
function buildPanelProFileOutputHandoff(input) {
  if (!input || !SOURCE_APPS.includes(input.sourceApp)) fail("panelprofile_source_app_invalid");
  if (!Array.isArray(input.pieces) || !input.pieces.length || input.pieces.length > 128) fail("panelprofile_piece_set_invalid");
  const template = input.template;
  if (!template || template.geometryValidated !== true || template.cutAreasReviewed !== true) fail("panelprofile_template_validation_required");
  if (template.displayOrigin !== "generated-branded") fail("panelprofile_branded_template_required");
  if (!Array.isArray(input.availableAssets)) fail("panelprofile_asset_inventory_required");
  const assets = input.availableAssets.map((asset) => ({
    assetId: id(asset.assetId), kind: asset.kind === "vector" ? "vector" : asset.kind === "raster" ? "raster" : fail("panelprofile_asset_kind_invalid"),
    ...ref(asset), separable: asset.separable === true,
  })).sort((a, b) => a.assetId.localeCompare(b.assetId));
  if (new Set(assets.map((a) => a.assetId)).size !== assets.length) fail("panelprofile_duplicate_asset");
  const assetIds = new Set(assets.map((a) => a.assetId));
  const pieces = input.pieces.map((piece) => {
    if (!Array.isArray(piece.protectedElements) || !Array.isArray(piece.cutAreas)) fail("panelprofile_coverage_review_required");
    if (piece.protectedElements.length > 64 || piece.cutAreas.length > 64) fail("panelprofile_coverage_complexity_exceeded");
    const protectedElements = piece.protectedElements.map((element) => {
      if (!assetIds.has(element.assetId)) fail("panelprofile_protected_asset_missing");
      const b = element.boundsInches;
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) fail("panelprofile_protected_bounds_invalid");
      return { elementId: id(element.elementId), assetId: element.assetId,
        boundsInches: { x: b.x, y: b.y, width: positive(b.width), height: positive(b.height) },
        canTranslate: element.canTranslate === true && assets.find((a) => a.assetId === element.assetId).separable,
      };
    });
    if (new Set(protectedElements.map((e) => e.elementId)).size !== protectedElements.length) fail("panelprofile_duplicate_element");
    const cutAreas = piece.cutAreas.map((area) => {
      if (!Array.isArray(area.pointsInches) || area.pointsInches.length < 3 || area.pointsInches.length > 1024
        || area.pointsInches.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((n) => typeof n !== "number" || !Number.isFinite(n)))) fail("panelprofile_cut_polygon_invalid");
      return { areaId: id(area.areaId), pointsInches: area.pointsInches.map((point) => [...point]) };
    });
    const widthInches = positive(piece.widthInches);
    const heightInches = positive(piece.heightInches);
    if (widthInches > 10000 || heightInches > 10000) fail("panelprofile_dimension_invalid");
    if (new Set(cutAreas.map((a) => a.areaId)).size !== cutAreas.length) fail("panelprofile_duplicate_cut_area");
    return { pieceId: id(piece.pieceId), sourceSurfaceKey: id(piece.sourceSurfaceKey), source: ref(piece.source),
      // width/height already include measured bumper/trunk returns. Bleed is
      // a separate addition; it must never substitute for those measurements.
      widthInches, heightInches, bleedInches: { top: 5, right: 5, bottom: 5, left: 5 },
      outputWidthInches: widthInches + 10, outputHeightInches: heightInches + 10,
      protectedElements, cutAreas,
      composition: piece.composition ? {
        background: ref(piece.composition.background),
        layerSeparationVerified: piece.composition.layerSeparationVerified === true,
      } : null,
    };
  }).sort((a, b) => a.pieceId.localeCompare(b.pieceId));
  if (new Set(pieces.map((p) => p.pieceId)).size !== pieces.length) fail("panelprofile_duplicate_piece");
  const request = {
    contractVersion: CONTRACT,
    sourceApp: input.sourceApp,
    tenantKey: id(input.tenantKey), sourceJobId: id(input.sourceJobId),
    generationId: input.generationId == null ? null : id(input.generationId),
    designId: input.designId == null ? null : id(input.designId),
    orderId: input.orderId == null ? null : id(input.orderId),
    revisionId: id(input.revisionId), master: ref(input.master),
    dimensionManifestHash: hash(input.dimensionManifestHash),
    template: { templateId: id(template.templateId), version: id(template.version),
      profileHash: hash(template.profileHash), geometryHash: hash(template.geometryHash),
      display: ref(template.display), displayOrigin: "generated-branded", geometryValidated: true, cutAreasReviewed: true },
    availableAssets: assets, pieces,
    outputPolicy: {
      fullSizePpi: positive(input.fullSizePpi ?? 150), outputScale: 0.1,
      printableWidthInches: positive(input.printableWidthInches),
      protectedClearanceInches: input.protectedClearanceInches == null ? null : positive(input.protectedClearanceInches),
      formats: ["pdf", "png", "tiff"],
      reuseAvailableAssetsFirst: true, allowCreativeRegeneration: false,
      allowImplicitMirroring: false, allowBackgroundFabrication: false,
      cutMaskPurpose: "placement-and-review-only", continuousRectangularArtwork: true,
      unsafePlacement: "return-for-human-correction", approval: "existing-human-qc",
      mutateSourceArtifacts: false, releaseToCustomer: false,
    },
  };
  if (request.outputPolicy.fullSizePpi < 150) fail("panelprofile_print_resolution_too_low");
  if (input.sourceApp === "DesignPro" && !request.generationId) fail("panelprofile_generation_identity_required");
  return { ...request, inputHash: digest(request) };
}

// Candidate application subgraph. Installing these nodes in a durable run is
// a separate migration/adapter change, after the actual app can execute them.
// The existing pipeline continues to use its current human QC until then.
function panelProFileOutputGraph({ validatedTemplateCacheHit = false } = {}) {
  return [
    { key: "template.lookup", dependsOn: ["manifest.resolve"] },
    ...(!validatedTemplateCacheHit ? [
      { key: "template.recreate", dependsOn: ["template.lookup"] },
      { key: "template.brand", dependsOn: ["template.recreate"] },
      { key: "template.validate", dependsOn: ["template.brand"] },
      { key: "template.bank", dependsOn: ["template.validate"] },
    ] : []),
    { key: "panelprofileoutput.fit", dependsOn: ["source.verify", validatedTemplateCacheHit ? "template.lookup" : "template.bank"] },
    { key: "panelprofileoutput.protect", dependsOn: ["panelprofileoutput.fit"] },
    { key: "panelprofileoutput.bleed", dependsOn: ["panelprofileoutput.protect"] },
    { key: "panelprofileoutput.proof", dependsOn: ["panelprofileoutput.bleed"] },
    { key: "await_panelpro_preflight_qc", dependsOn: ["source.verify", "panelprofileoutput.proof"] },
  ];
}

module.exports = { CONTRACT, SOURCE_APPS, buildPanelProFileOutputHandoff, panelProFileOutputGraph };
