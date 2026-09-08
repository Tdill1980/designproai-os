"use strict";

// Admission to PanelProFileOutput may use the exact Call-1 crop or its verified
// Call-12 enhancement. A larger bitmap or matching DPI tag is not lineage.
// Physical geometry, effective pixel density and human detail QC remain the
// renderer's independent gates after this check.
const CONTRACT = "designpro.panelprofile-source-binding.v1";
const TOPAZ_CONTRACT = "designpro.call12-topaz-enhance.v1";
const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
// Aliases here are spelling variants only. Inches are compared only to inches;
// a marketing wheelbase/roof label is never converted into a guessed size.
const VEHICLE_VARIANTS = [
  { key: "bodyStyle", aliases: ["bodyStyle", "body_style"] },
  { key: "wheelbase", aliases: ["wheelbase"] },
  { key: "wheelbaseInches", aliases: ["wheelbaseInches", "wheelbase_inches", "wheelbase_in"], inches: true },
  { key: "roofHeight", aliases: ["roofHeight", "roof_height"] },
  { key: "roofHeightInches", aliases: ["roofHeightInches", "roof_height_inches", "roof_height_in"], inches: true },
  { key: "cabStyle", aliases: ["cabStyle", "cab_style", "cabType", "cab_type"] },
  { key: "bedLength", aliases: ["bedLength", "bed_length"] },
  { key: "bedLengthInches", aliases: ["bedLengthInches", "bed_length_inches", "bed_length_in"], inches: true },
  { key: "subType", aliases: ["subType", "sub_type"] },
  { key: "trim", aliases: ["trim"] },
];
function fail(code, retryable = false) {
  throw Object.assign(new Error(code), { code, status: retryable ? 503 : 409, retryable });
}
function rows(result) {
  if (result?.error) fail("panelprofile_source_binding_lookup_failed", true);
  if (!Array.isArray(result?.data)) fail("panelprofile_source_binding_lookup_invalid");
  return result.data;
}
const sourceKey = source => `${source.storagePath}\n${source.contentHash}`;

function vehicleValue(value, { inches = false } = {}) {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  if (inches) {
    if ((typeof value !== "number" && typeof value !== "string")
      || (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim()))) fail("panelprofile_vehicle_identity_invalid");
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > 10000) fail("panelprofile_vehicle_identity_invalid");
    return number;
  }
  if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) fail("panelprofile_vehicle_identity_invalid");
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized.length > 160) fail("panelprofile_vehicle_identity_invalid");
  return normalized;
}

function normalizedVehicle(vehicle) {
  if (!vehicle || typeof vehicle !== "object" || Array.isArray(vehicle)) fail("panelprofile_vehicle_identity_required");
  const result = {};
  for (const key of ["year", "make", "model"]) {
    const value = vehicleValue(vehicle[key]);
    if (value == null || (key === "year" && !/^\d{4}$/.test(value))) fail("panelprofile_vehicle_identity_required");
    result[key] = value;
  }
  for (const variant of VEHICLE_VARIANTS) {
    const supplied = variant.aliases.map(alias => vehicleValue(vehicle[alias], variant)).filter(value => value != null);
    if (new Set(supplied).size > 1) fail("panelprofile_vehicle_variant_alias_conflict");
    if (supplied.length) result[variant.key] = supplied[0];
  }
  return result;
}

/** A reviewed geometry file is not proof that it belongs to this vehicle.
 * Existing source identity is immutable; missing variants are acknowledged in
 * a separate, exact-bound staff review and are never copied into that source. */
function verifyDesignProTemplateVehicle({ input, revision, geometry, reviewerId, canReview = false }) {
  if (!revision || revision.revision_id !== input?.revisionId) fail("panelprofile_canonical_revision_mismatch");
  const sourceVehicle = normalizedVehicle(revision.snapshot?.vehicle);
  const templateVehicle = normalizedVehicle(geometry?.vehicle);
  if (["year", "make", "model"].some(key => sourceVehicle[key] !== templateVehicle[key])) fail("panelprofile_template_vehicle_mismatch");
  const missingSourceVariants = [];
  for (const { key } of VEHICLE_VARIANTS) {
    if (sourceVehicle[key] != null && templateVehicle[key] == null) fail("panelprofile_template_vehicle_variant_missing");
    if (sourceVehicle[key] != null && sourceVehicle[key] !== templateVehicle[key]) fail("panelprofile_template_vehicle_variant_mismatch");
    if (sourceVehicle[key] == null && templateVehicle[key] != null) missingSourceVariants.push(key);
  }
  const review = input.templateVehicleReview;
  if (!review && missingSourceVariants.length) fail("panelprofile_template_vehicle_review_required");
  let templateVehicleReview = null;
  if (review != null) {
    const keys = ["reviewId", "revisionId", "geometryHash", "dimensionManifestHash", "missingVariantsReviewed", "reviewedBy"];
    if (canReview !== true || !UUID.test(String(reviewerId || ""))) fail("panelprofile_qc_permission_required");
    if (typeof review !== "object" || Array.isArray(review) || Object.keys(review).some(key => !keys.includes(key))
      || !ID.test(String(review.reviewId || "")) || review.missingVariantsReviewed !== true
      || review.revisionId !== revision.revision_id
      || !HASH.test(input.template?.geometryHash) || input.template.geometryHash !== input.template.geometry?.contentHash
      || review.geometryHash !== input.template.geometryHash
      || !HASH.test(input.dimensionManifestHash) || review.dimensionManifestHash !== input.dimensionManifestHash) {
      fail("panelprofile_template_vehicle_review_mismatch");
    }
    templateVehicleReview = { reviewId: review.reviewId, revisionId: revision.revision_id,
      geometryHash: input.template.geometryHash, dimensionManifestHash: input.dimensionManifestHash,
      missingVariantsReviewed: true, reviewedBy: reviewerId };
  }
  return { sourceVehicle, templateVehicle, missingSourceVariants, templateVehicleReview };
}

async function verifyDesignProPieceSources({ supabase, input, revision }) {
  const panels = revision?.snapshot?.callOnePanels;
  if (!revision?.owner_id || revision.revision_id !== input?.revisionId
    || revision.generation_id !== input?.generationId
    || !Array.isArray(panels) || panels.length !== SURFACES.length
    || new Set(panels.map(panel => panel.surfaceKey)).size !== SURFACES.length
    || !SURFACES.every(key => panels.some(panel => panel.surfaceKey === key))
    || panels.some(panel => !HASH.test(panel.contentHash) || panel.sourceMasterHash !== input.master?.contentHash)
    || !Array.isArray(input.pieces) || !input.pieces.length || input.pieces.length > 128) {
    fail("panelprofile_canonical_panel_mismatch");
  }
  const bySurface = new Map(panels.map(panel => [panel.surfaceKey, panel]));
  const bindings = [], pending = new Map();
  for (const piece of input.pieces) {
    const canonical = bySurface.get(piece.sourceSurfaceKey), source = piece.source;
    if (!canonical || !source || !HASH.test(source.contentHash) || typeof source.storagePath !== "string") {
      fail("panelprofile_canonical_panel_mismatch");
    }
    if (source.storagePath === canonical.storagePath && source.contentHash === canonical.contentHash) {
      bindings.push({ pieceId: piece.pieceId, surfaceKey: piece.sourceSurfaceKey, kind: "canonical-panel",
        storagePath: source.storagePath, contentHash: source.contentHash, canonicalPanelHash: canonical.contentHash });
    } else pending.set(sourceKey(source), { source, canonical });
  }
  if (!pending.size) return { contractVersion: CONTRACT, revisionId: revision.revision_id,
    generationId: revision.generation_id, ownerId: revision.owner_id, bindings, nativeDetailVerified: false };
  if (!HASH.test(input.dimensionManifestHash)) fail("panelprofile_enhanced_manifest_required");
  const requested = [...pending.values()];
  const artifacts = rows(await supabase.from("designpro_artifacts")
    .select("id,run_id,stage_id,artifact_kind,surface_key,storage_path,content_hash,byte_size,metadata")
    .eq("artifact_kind", "upscaled-panel")
    .in("storage_path", [...new Set(requested.map(item => item.source.storagePath))])
    .in("content_hash", [...new Set(requested.map(item => item.source.contentHash))]).limit(129));
  if (artifacts.length !== pending.size) fail("panelprofile_enhanced_source_not_verified");
  const runIds = [...new Set(artifacts.map(artifact => artifact.run_id))];
  const [runResult, receiptResult] = await Promise.all([
    supabase.from("designpro_workflow_runs").select("id,owner_id,tenant_key,revision_id,manifest_hash,workflow_type")
      .in("id", runIds).eq("owner_id", revision.owner_id).eq("revision_id", revision.revision_id)
      .eq("manifest_hash", input.dimensionManifestHash),
    supabase.from("designpro_stage_receipts").select("run_id,stage_id,receipt_kind,identity,receipt")
      .in("run_id", runIds).eq("receipt_kind", "call12.topaz-upscale"),
  ]);
  const runs = rows(runResult), receipts = rows(receiptResult), verified = new Map();
  for (const { source, canonical } of requested) {
    const matches = artifacts.filter(artifact => artifact.storage_path === source.storagePath
      && artifact.content_hash === source.contentHash && artifact.surface_key === canonical.surfaceKey);
    if (matches.length !== 1) fail("panelprofile_enhanced_source_not_verified");
    const artifact = matches[0], meta = artifact.metadata;
    const run = runs.find(candidate => candidate.id === artifact.run_id);
    const matchingReceipts = receipts.filter(receipt => receipt.run_id === artifact.run_id && receipt.stage_id === artifact.stage_id);
    const recorded = matchingReceipts[0], receipt = recorded?.receipt;
    if (!run || run.owner_id !== revision.owner_id || run.revision_id !== revision.revision_id
      || run.workflow_type !== "designpro.production_pack" || run.tenant_key !== `user_${revision.owner_id}`
      || run.manifest_hash !== input.dimensionManifestHash
      || !source.storagePath.startsWith(`designpro/${run.tenant_key}/${run.id}/`)
      || source.storagePath.includes("..") || source.storagePath.includes("//")
      || artifact.artifact_kind !== "upscaled-panel" || !(Number(artifact.byte_size) > 0)
      || meta?.sourcePanelHash !== canonical.contentHash || meta?.brandedPanelHash !== canonical.contentHash
      || meta?.sourceArtifactKind !== "panel" || meta?.humanCorrected !== false
      || matchingReceipts.length !== 1 || recorded.receipt_kind !== "call12.topaz-upscale"
      || receipt?.verified !== true || receipt?.receiptKind !== "call12.topaz-upscale" || receipt?.call !== 12
      || receipt?.contract !== TOPAZ_CONTRACT || receipt?.enhancedHashes?.[canonical.surfaceKey] !== source.contentHash
      || recorded.identity?.workflowRunId !== run.id || recorded.identity?.revisionId !== revision.revision_id
      || recorded.identity?.manifestHash !== input.dimensionManifestHash
      || receipt?.humanCorrectedSurfaces?.includes(canonical.surfaceKey)) {
      fail("panelprofile_enhanced_source_lineage_invalid");
    }
    verified.set(sourceKey(source), { surfaceKey: canonical.surfaceKey, kind: "verified-call12-upscaled-panel",
      storagePath: source.storagePath, contentHash: source.contentHash, canonicalPanelHash: canonical.contentHash,
      manufacturingRunId: run.id, enhancementStageId: artifact.stage_id, dimensionManifestHash: run.manifest_hash });
  }
  for (const piece of input.pieces) {
    const enhanced = verified.get(sourceKey(piece.source));
    if (enhanced) {
      if (enhanced.surfaceKey !== piece.sourceSurfaceKey) fail("panelprofile_canonical_panel_mismatch");
      bindings.push({ pieceId: piece.pieceId, ...enhanced });
    }
  }
  return { contractVersion: CONTRACT, revisionId: revision.revision_id, generationId: revision.generation_id,
    ownerId: revision.owner_id, bindings, nativeDetailVerified: false };
}

module.exports = { CONTRACT, verifyDesignProPieceSources, verifyDesignProTemplateVehicle };
