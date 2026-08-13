"use strict";

/**
 * Standalone DesignProAI OS claimant.
 *
 * This is the only queue conductor.  Browser code may enqueue work and approve
 * the two explicit human gates, but it cannot execute or complete a stage.
 * Every durable completion is fenced by the database lease and contains
 * byte-hashed evidence persisted in designpro_artifacts.
 */
const { createHash } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const sharp = require("sharp");
const { canonicalTenantKey, immutableStorageUpload, normalizeLogoAsset, normalizeSourceAsset, safeStoragePath, verifySourceBytes } = require("./runtime-contract.cjs");
const { resolveOrQueueUniversalDimensions } = require("./genie-universal-resolver.cjs");
const { selectedImageModel, SURFACE_KEYS, VIEW_KEYS } = require("./gemini-flat-surface.cjs");
const { flatWrapInputHash } = require("./gemini-flat-wrap.cjs");
const { EXTRACTION_CONTRACT, assertSurfacesAreDistinct, cutAllPanels, flatWrapLayout, layoutIdentity } = require("./flat-wrap-layout.cjs");
const { buildDeterministicRasterEps, createDeterministicZip64Stream, verifyProductionOutputSet } = require("./output-qc.cjs");
const { assertDeliverySnapshot, MANIFEST_CONTRACT } = require("./wrapbox-delivery.cjs");
const { MAX_STANDARD_UPLOAD_BYTES, removeCommittedSpool, spoolDeterministicZip64, spoolImmutableBuffer, uploadSpoolWithTus, verifyStoredArtifact, verifyStoredZip } = require("./zip-spool.cjs");
const { TOPAZ_CONTRACT, enhancePanel, topazReadiness } = require("./topaz-upscale.cjs");

const CLAIM_SECONDS = 900;
const HEARTBEAT_MS = 30_000;
const BUCKET = "wrap-files";
const HASH_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const stageLeaseContext = new AsyncLocalStorage();
const STAGES = Object.freeze([
  "revision.freeze", "manifest.resolve", "proof.build", "panels.build",
  "logos.extract", "pack.verify", "pack.activate", "source.verify",
  "await_panelpro_preflight_qc", "enhance.upscale", "output.build", "output.verify",
  "await_final_human_qc", "stamp.build", "zip.build", "wrapbox.deliver",
]);
const RECEIPTS = Object.freeze([
  "views.seven-source", "call8.flat-proof", "call9.surface-panels", "call10.logo-inventory",
  "call12.topaz-upscale", "output.verified", "final.human-qc", "stamp", "zip", "wrapbox.delivery",
]);
const ARTIFACT_KINDS = Object.freeze([
  "flat-proof", "panel", "upscaled-panel", "logo", "output", "stamp", "zip", "wrapbox-manifest",
]);
const CLAIMANT_CONTRACT = "designpro.server-claimant.v2";

class StageError extends Error {
  constructor(code, message, retryable = true) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value) {
  return hashBytes(Buffer.from(JSON.stringify(canonical(value))));
}

function assertStageLeaseActive() {
  const context = stageLeaseContext.getStore();
  if (context?.lost || context?.controller?.signal?.aborted) {
    throw new StageError("stage_lease_lost", "Stage lease was lost; current work is aborted before persistence", true);
  }
}

const REQUIRED_REVISION_VIEWS = Object.freeze({
  driver: ["driver", "driver_side", "driver-side", "side"],
  passenger: ["passenger", "passenger_side", "passenger-side", "opposite_side"],
  hood: ["hood", "hood_detail"],
  roof: ["roof", "top"],
  front: ["front"],
  rear: ["rear", "back"],
  hero3d: ["hero3d", "hero_3d", "hero", "angle", "three_quarter"],
});

function tenantKey(value) {
  try { return canonicalTenantKey(value); }
  catch (error) { throw new StageError("unsafe_tenant_key", error.message, false); }
}

function sourceAsset(value, tenant, revisionId) {
  try { return normalizeSourceAsset(value, tenant, revisionId); }
  catch (error) { throw new StageError("invalid_source_asset", error.message, false); }
}

function exactSevenViews(snapshot, tenantValue, revisionId) {
  const tenant = tenantKey(tenantValue);
  const assets = requiredObject(snapshot?.renderAssets, "revision snapshot renderAssets");
  const normalized = Object.fromEntries(Object.entries(assets).map(([key, value]) => [String(key).toLowerCase(), value]));
  const resolved = {};
  for (const [role, aliases] of Object.entries(REQUIRED_REVISION_VIEWS)) {
    const key = aliases.find((candidate) => normalized[candidate] && typeof normalized[candidate] === "object");
    if (!key) throw new StageError("seven_views_incomplete", `Required ${role} view is missing`, false);
    resolved[role] = sourceAsset(normalized[key], tenant, revisionId);
  }
  if (new Set(Object.values(resolved).map((item) => item.storagePath)).size !== 7
    || new Set(Object.values(resolved).map((item) => item.contentHash)).size !== 7) {
    throw new StageError("seven_views_not_distinct", "All seven required views must have distinct paths and byte identities", false);
  }
  return resolved;
}

function uuidFromHash(hash) {
  const text = hash.slice(0, 32).split("");
  text[12] = "5"; text[16] = ["8", "9", "a", "b"][parseInt(text[16], 16) % 4];
  const value = text.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function round2(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }

async function fingerprintSevenViews(views, sb, tenantValue, revisionId) {
  const tenant = tenantKey(tenantValue);
  const identities = [];
  for (const [viewKey, rawAsset] of Object.entries(views)) {
    const asset = sourceAsset(rawAsset, tenant, revisionId);
    const bytes = await storageBytes(sb, asset.storagePath);
    try { verifySourceBytes(asset, bytes); }
    catch (error) { throw new StageError("view_fingerprint_failed", `${viewKey}: ${error.message}`, false); }
    identities.push({ viewKey, storagePath: asset.storagePath, contentHash: asset.contentHash, byteSize: asset.byteSize, contentType: asset.contentType });
  }
  if (identities.length !== 7 || new Set(identities.map((item) => item.contentHash)).size !== 7) throw new StageError("seven_view_identity_reuse", "Seven unique view byte identities are required", false);
  return identities;
}

function call8TextLock(snapshot) {
  if (!snapshot || snapshot.bodyText == null || !Array.isArray(snapshot.expectedLogoInventory)) {
    throw new StageError("call8_text_lock_missing", "Revision must freeze bodyText and expected logo placements", false);
  }
  return {
    bodyText: snapshot.bodyText,
    logoPlacements: snapshot.expectedLogoInventory.map((item) => ({
      identityKey: requiredString(item?.identityKey, "logo identityKey"),
      displayName: requiredString(item?.displayName, "logo displayName"),
      targetSurfaceKey: requiredString(item?.surfaceKey, "logo target surface"),
      contentHash: requiredString(item?.contentHash, "logo contentHash").toLowerCase(),
    })),
  };
}

function call8ProofRequest(run, manifest, viewLineage, textLock, proofMeta) {
  const tenant = tenantKey(run.tenant_key);
  const surfaces = manifest.expectedSurfaces || [];
  if (surfaces.length !== 6) throw new StageError("call8_surface_set_invalid", "Exactly six production surfaces are required", false);
  if (!Array.isArray(viewLineage) || viewLineage.length !== 7) throw new StageError("call8_view_lineage_invalid", "Call 8 requires all seven immutable source identities", false);
  const sourceAssets = VIEW_KEYS.map((viewKey) => {
    const item = viewLineage.find((candidate) => String(candidate?.viewKey) === viewKey);
    if (!item) throw new StageError("call8_view_lineage_invalid", `Call 8 is missing ${viewKey}`, false);
    return { viewKey, bucket: "wrap-files", storagePath: item.storagePath, contentHash: item.contentHash, byteSize: item.byteSize, contentType: item.contentType };
  });
  // The cut map is derived here from the validated manifest and derived again
  // inside the runtime. Both sides must agree before a single pixel is authored.
  let layout;
  try { layout = flatWrapLayout(surfaces.map(({ sourceAsset, ...surface }) => surface)); }
  catch (error) { throw new StageError(error.code || "call8_cut_map_invalid", error.message, false); }
  const totalSqFt = round2(surfaces.reduce((total, item) => total + Number(item.widthInches) * Number(item.heightInches) / 144, 0));
  if (Number(manifest.totalSqFt) !== totalSqFt || Number(layout.totalSqFt) !== totalSqFt) {
    throw new StageError("genie_total_square_feet_mismatch", "GENIE total square footage does not match raw per-surface dimensions", false);
  }
  const materialHash = flatWrapInputHash({ sourceViews: sourceAssets, layout, revisionId: run.revision_id, textLock, model: selectedImageModel() });
  return {
    request: {
      tenantKey: tenant, workflowRunId: run.id, revisionId: run.revision_id,
      layout, surfaces: surfaces.map(({ sourceAsset, ...surface }) => surface),
      sourceAssets, textLock, flatMaterialHash: materialHash,
      vehicle: manifest.vehicle, proofMeta: proofMeta || {},
    },
    layout, totalSqFt, materialHash,
  };
}

async function resolveGenieManifest(sb, run, stage) {
  const { data: source, error: sourceError } = await sb.from("designpro_revision_sources").select("snapshot,snapshot_hash").eq("revision_id", run.revision_id).maybeSingle();
  if (sourceError || !source || source.snapshot_hash !== run.revision_snapshot_hash) throw new StageError("revision_source_drift", "Immutable revision source is missing or changed", false);
  const views = exactSevenViews(source.snapshot, run.tenant_key, run.revision_id);
  const vehicle = requiredObject(source.snapshot.vehicle, "revision vehicle");
  const make = requiredString(vehicle.make, "vehicle make"); const model = requiredString(vehicle.model, "vehicle model"); const year = Number(vehicle.year);
  // Legacy designpro_vehicle_dimensions rows do not carry validator identity or
  // exact six-surface evidence. They are never print authority. Every vehicle,
  // known or unknown, resolves through the validated Universal GENIE gate.
  const row = await resolveOrQueueUniversalDimensions(sb, vehicle, stage, run.id);
  const dim = (width, height, surfaceKey, sourceAssetValue) => {
    const widthInches = Number(width); const heightInches = Number(height);
    if (!(widthInches > 0 && heightInches > 0)) throw new StageError("genie_surface_dimensions_missing", `GENIE dimensions missing for ${surfaceKey}`, false);
    return { surfaceKey, sourceAsset: sourceAssetValue, widthInches, heightInches, surfaceSqFt: round2(widthInches * heightInches / 144), bleed: { top: 5, right: 5, bottom: 5, left: 5 } };
  };
  const expectedSurfaces = [
    dim(row.side_width, row.side_height, "driver", views.driver),
    dim(row.passenger_width || row.side_width, row.passenger_height || row.side_height, "passenger", views.passenger),
    dim(row.hood_width, row.hood_length, "hood", views.hood),
    dim(row.roof_width, row.roof_length, "roof", views.roof),
    dim(row.front_width, row.front_height, "front", views.front),
    dim(row.rear_width, row.rear_height, "rear", views.rear),
  ];
  const dimensionBasis = { recordId: row.id, make: row.make, model: row.model, year, universalValidation: row.universalValidation || null, expectedSurfaces: expectedSurfaces.map(({ sourceAsset, ...item }) => item) };
  const dimensionBasisHash = hashJson(dimensionBasis);
  const totalSqFt = round2(expectedSurfaces.reduce((total, item) => total + (item.widthInches * item.heightInches / 144), 0));
  const manifest = { contract: "designpro.genie-dimension-manifest.v1", genieVerified: true, sevenViewsVerified: true, requiredViewCount: 7, dimensionsAuthority: "genie-universal-panelizer", vehicle: { type: vehicle.type || vehicle.vehicleClass, year, make, model }, bleedInches: 5, totalSqFt, squareFootRounding: "nearest-0.01-after-raw-sum", dimensionBasisHash, expectedSurfaces };
  return { source, views, manifest, dimensionBasisHash, dimensionManifestId: uuidFromHash(dimensionBasisHash) };
}

function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StageError("invalid_stage_input", `${label} is required`, false);
  }
  return value;
}

function requiredString(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new StageError("invalid_stage_input", `${label} is required`, false);
  return text;
}

function safePath(value, label) {
  try { return safeStoragePath(requiredString(value, label)); }
  catch (error) { throw new StageError("unsafe_storage_path", `${label}: ${error.message}`, false); }
}

function identity(run) {
  const result = {
    workflowRunId: run.id,
    revisionId: run.revision_id,
    enticePackId: run.entice_pack_id,
    dimensionManifestId: run.dimension_manifest_id,
    sourceContractHash: run.source_contract_hash,
    manifestHash: run.manifest_hash,
    artifactSetHash: run.artifact_set_hash,
  };
  for (const [key, value] of Object.entries(result)) {
    if (value == null) delete result[key];
  }
  return result;
}

function artifact(kind, storagePath, contentHash, bytes, surfaceKey = "", metadata = {}) {
  if (!ARTIFACT_KINDS.includes(kind) || !HASH_RE.test(contentHash) || !(bytes > 0)) {
    throw new StageError("invalid_artifact_evidence", `Invalid ${kind} artifact evidence`, false);
  }
  return { kind, storagePath: safePath(storagePath, "artifact storagePath"), contentHash, byteSize: bytes, surfaceKey, metadata };
}

async function storageBytes(sb, storagePath) {
  const path = safePath(storagePath, "storagePath");
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) throw new StageError("artifact_download_failed", `Unable to download ${path}: ${error?.message || "empty object"}`);
  const bytes = Buffer.from(await data.arrayBuffer());
  if (!bytes.length) throw new StageError("artifact_empty", `${path} is empty`, false);
  return bytes;
}

async function upload(sb, storagePath, bytes, contentType) {
  assertStageLeaseActive();
  const path = safePath(storagePath, "storagePath");
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (body.length > MAX_STANDARD_UPLOAD_BYTES) throw new StageError("artifact_requires_resumable_transport", `${path} exceeds the explicit standard-upload threshold`, false);
  try {
    const stored = await immutableStorageUpload(sb.storage, BUCKET, path, body, contentType);
    return { storagePath: stored.storagePath, bytes: stored.byteSize, hash: stored.contentHash };
  } catch (error) {
    const drift = /different bytes/.test(String(error.message || error));
    throw new StageError(drift ? "artifact_immutable_path_drift" : "artifact_upload_failed", `${path}: ${error.message}`, !drift);
  }
}

async function uploadProducedBytes(sb, run, stage, runtimeConfig, storagePath, bytes, contentType) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (body.length <= MAX_STANDARD_UPLOAD_BYTES) return { ...(await upload(sb, storagePath, body, contentType)), spool: null };
  const path = safePath(storagePath, "resumable storagePath");
  const contentHash = hashBytes(body);
  const materialHash = hashJson({ storagePath: path, contentHash, byteSize: body.length, contentType });
  const signal = stageLeaseContext.getStore()?.controller?.signal;
  const spool = await spoolImmutableBuffer({ spoolDir: runtimeConfig.spoolDir, runId: run.id, materialHash, bytes: body, signal });
  const stored = await uploadSpoolWithTus({
    supabase: sb, supabaseUrl: runtimeConfig.supabaseUrl, serviceRoleKey: runtimeConfig.serviceRoleKey,
    endpoint: runtimeConfig.tusEndpoint, spoolDir: runtimeConfig.spoolDir, spool, storagePath: path,
    contentType, signal,
  });
  return { storagePath: stored.storagePath, bytes: stored.byteSize, hash: stored.contentHash, spool };
}

async function exactStoredArtifact(sb, candidate, expectedKind) {
  const item = requiredObject(candidate, `${expectedKind} artifact`);
  const bytes = await storageBytes(sb, item.storagePath);
  const observed = hashBytes(bytes);
  const expected = String(item.contentHash || observed).toLowerCase();
  if (!HASH_RE.test(expected) || observed !== expected || (item.byteSize != null && Number(item.byteSize) !== bytes.length)) {
    throw new StageError("artifact_hash_mismatch", `${item.storagePath} changed`, false);
  }
  return artifact(expectedKind, item.storagePath, observed, bytes.length, String(item.surfaceKey || ""), item.metadata || {});
}

async function callTool(baseUrl, secret, route, body) {
  assertStageLeaseActive();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14 * 60_000);
  const stageSignal = stageLeaseContext.getStore()?.controller?.signal;
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: stageSignal ? AbortSignal.any([controller.signal, stageSignal]) : controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) {
      throw new StageError("tool_execution_failed", `${route}: ${result.error || `HTTP ${response.status}`}`, response.status >= 500 || response.status === 429);
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function getRun(sb, runId) {
  const { data, error } = await sb.from("designpro_workflow_runs").select("*").eq("id", runId).maybeSingle();
  if (error || !data) throw new StageError("workflow_missing", error?.message || "Workflow missing", false);
  return data;
}

async function stageOutput(sb, runId, stageKey) {
  const { data, error } = await sb.from("designpro_workflow_stages")
    .select("status,output,verification,output_hash").eq("run_id", runId).eq("stage_key", stageKey).maybeSingle();
  if (error || !data || data.status !== "completed" || data.verification?.verified !== true) {
    throw new StageError("prior_stage_unverified", `${stageKey} is not verified`, false);
  }
  return data.output || {};
}

async function receipt(sb, runId, kind) {
  if (!RECEIPTS.includes(kind)) throw new StageError("receipt_kind_invalid", kind, false);
  const { data, error } = await sb.from("designpro_stage_receipts")
    .select("receipt,receipt_hash,identity").eq("run_id", runId).eq("receipt_kind", kind).maybeSingle();
  if (error || !data || !HASH_RE.test(String(data.receipt_hash || ""))) {
    throw new StageError("receipt_missing", `${kind} receipt is missing`, false);
  }
  return data;
}

async function artifacts(sb, runId, kinds) {
  const { data, error } = await sb.from("designpro_artifacts").select("artifact_kind,surface_key,storage_path,content_hash,byte_size,metadata")
    .eq("run_id", runId).in("artifact_kind", kinds);
  if (error) throw new StageError("artifact_ledger_read_failed", error.message);
  return data || [];
}

async function complete(sb, stage, run, receiptValue, receiptHash = null, produced = []) {
  assertStageLeaseActive();
  const finalHash = receiptHash || hashJson(receiptValue);
  const { data, error } = await sb.rpc("complete_designpro_stage", {
    p_stage_id: stage.id,
    p_lease_token: stage.lease_token,
    p_identity: identity(run),
    p_receipt: receiptValue,
    p_receipt_hash: finalHash,
    p_artifacts: produced,
  });
  if (error) throw new StageError("stage_completion_rejected", error.message, false);
  if (data !== true) throw new StageError("stage_lease_lost", `Lease lost for ${stage.stage_key}`);
}

async function ensureAutomaticProduction(sb, enticeRunId) {
  const { data, error } = await sb.rpc("create_designpro_production_workflow", {
    p_entice_run_id: enticeRunId,
    p_idempotency_key: `auto-production:${enticeRunId}`,
    p_input: { trigger: "designpro.os.auto" },
  });
  if (error) throw new StageError("automatic_production_enqueue_failed", error.message, true);
  return data;
}

async function reconcileAutomaticProduction(sb) {
  const { data, error } = await sb.rpc("reconcile_designpro_automatic_production");
  if (error) throw new StageError("automatic_production_reconciliation_failed", error.message, true);
  return data;
}

async function withHeavyOutputLease(sb, stage, work) {
  assertStageLeaseActive();
  const payload = {
    p_stage_id: stage.id,
    p_lease_token: stage.lease_token,
    p_worker: requiredString(stage.lease_owner, "heavy lease worker"),
    p_lease_seconds: 120,
  };
  const acquired = await sb.rpc("acquire_designpro_heavy_lease", payload);
  if (acquired.error) throw new StageError("heavy_output_lease_failed", acquired.error.message, true);
  if (acquired.data !== true) throw new StageError("heavy_output_capacity_busy", "Another worker is using the bounded high-resolution output slot", true);
  const context = stageLeaseContext.getStore();
  const renew = setInterval(async () => {
    const result = await sb.rpc("acquire_designpro_heavy_lease", payload);
    if (result.error || result.data !== true) {
      if (context) {
        context.lost = true;
        context.controller.abort(new Error(result.error?.message || "heavy output lease expired"));
      }
    }
  }, 30_000);
  renew.unref?.();
  try {
    return await work();
  } finally {
    clearInterval(renew);
    // Do not release here: the caller must still durably complete or fail the
    // stage. The database stage transition releases the exact slot atomically,
    // so there is no gap in which a heartbeat can lose the heavy-work fence.
  }
}

async function executeEntice(sb, baseUrl, secret, supabaseUrl, stage, run, runtimeConfig) {
  const input = requiredObject(run.input, "workflow input");
  if (stage.stage_key === "revision.freeze") {
    const { data, error } = await sb.from("designpro_revision_sources").select("snapshot,snapshot_hash").eq("revision_id", run.revision_id).maybeSingle();
    if (error || !data || data.snapshot_hash !== run.revision_snapshot_hash) throw new StageError("revision_source_drift", "Immutable revision source does not match workflow", false);
    const views = exactSevenViews(data.snapshot, run.tenant_key, run.revision_id);
    const viewIdentities = await fingerprintSevenViews(views, sb, run.tenant_key, run.revision_id);
    return complete(sb, stage, run, { verified: true, receiptKind: "views.seven-source", revisionSnapshotHash: data.snapshot_hash, requiredViewCount: 7, viewReceipts: viewIdentities, distinctViewsVerified: true });
  }
  if (stage.stage_key === "manifest.resolve") {
    const resolved = await resolveGenieManifest(sb, run, stage);
    const spec = resolved.manifest;
    const manifestId = resolved.dimensionManifestId;
    const basisHash = resolved.dimensionBasisHash;
    const { data, error } = await sb.rpc("bind_designpro_entice_manifest", {
      p_run_id: run.id, p_stage_id: stage.id, p_lease_token: stage.lease_token,
      p_dimension_manifest_id: manifestId, p_manifest: spec, p_manifest_hash: null,
      p_dimension_basis_hash: basisHash,
    });
    if (error) throw new StageError("manifest_bind_failed", error.message, false);
    const rebound = await getRun(sb, run.id);
    return complete(sb, stage, rebound, { verified: true, ...data, dimensionBasisHash: basisHash });
  }
  if (stage.stage_key === "proof.build") {
    const rebound = await getRun(sb, run.id);
    const manifest = requiredObject(rebound.results?.dimensionManifest, "bound GENIE dimension manifest");
    const frozenViews = await stageOutput(sb, run.id, "revision.freeze");
    const { data: revisionSource, error: revisionError } = await sb.from("designpro_revision_sources").select("snapshot,snapshot_hash").eq("revision_id", run.revision_id).maybeSingle();
    if (revisionError || !revisionSource || revisionSource.snapshot_hash !== run.revision_snapshot_hash) throw new StageError("call8_revision_source_drift", "Frozen Call 8 text source changed", false);
    const textLock = call8TextLock(revisionSource.snapshot);
    const snapshot = revisionSource.snapshot || {};
    const spec = call8ProofRequest(rebound, manifest, frozenViews.viewReceipts, textLock, {
      designName: snapshot.designName || snapshot.delivery?.designName || "",
      finish: snapshot.finish || "",
      designId: snapshot.designId || "",
      orderNumber: snapshot.orderNumber || "",
    });
    const result = await callTool(baseUrl, secret, "/compose-proof-sheet", spec.request);
    if (result.contract !== "designpro.call8-flat-proof.v2" || result.flatMaterialHash !== spec.materialHash || result.imageModel !== selectedImageModel()
      || !Array.isArray(result.surfacePanels) || result.surfacePanels.length !== SURFACE_KEYS.length) {
      throw new StageError("call8_result_invalid", "Call 8 did not return the flat wrap layout, the 2D production proof and the exact six cut identities", false);
    }
    const flatLayout = requiredObject(result.flatLayout, "Call 8 flat wrap layout");
    const proofSheet = requiredObject(result.proof, "Call 8 2D production proof");
    if (flatLayout.layoutHash !== layoutIdentity(spec.layout) || Number(flatLayout.width) !== spec.layout.width || Number(flatLayout.height) !== spec.layout.height) {
      throw new StageError("call8_cut_map_drift", "Call 8 authored a layout that is not the deterministic GENIE cut map", false);
    }
    // The customer document is the primary flat-proof artifact. The authored
    // layout is registered beside it as the immutable source the Call 9 cuts
    // come out of.
    const proofArtifact = await exactStoredArtifact(sb, {
      storagePath: proofSheet.storagePath, contentHash: String(proofSheet.contentHash).toLowerCase(), byteSize: Number(proofSheet.byteSize),
      surfaceKey: "", metadata: {
        role: "customer-2d-production-proof", contract: proofSheet.contract,
        widthPx: proofSheet.width, heightPx: proofSheet.height, totalSqFt: proofSheet.totalSqFt,
        bleedInches: 5, dimensionsAuthority: "genie-universal-panelizer",
      },
    }, "flat-proof");
    const layoutArtifact = await exactStoredArtifact(sb, {
      storagePath: flatLayout.storagePath, contentHash: String(flatLayout.contentHash).toLowerCase(), byteSize: Number(flatLayout.byteSize),
      surfaceKey: "flat-wrap-layout", metadata: {
        role: "call9-cut-source", contract: flatLayout.contract, extractionContract: flatLayout.extractionContract,
        widthPx: flatLayout.width, heightPx: flatLayout.height, scalePxPerInch: flatLayout.scalePxPerInch,
        layoutHash: flatLayout.layoutHash, reusedImmutableWinner: flatLayout.reusedImmutableWinner === true,
      },
    }, "flat-proof");
    return complete(sb, stage, await getRun(sb, run.id), {
      // proofKind is a frozen literal in complete_designpro_stage's Call 8
      // contract, not a label. It must read exactly "flattened-2d-proof" or the
      // RPC rejects the completed stage with call8_flat_proof_contract_failed.
      verified: true, receiptKind: "call8.flat-proof", call: 8, proofKind: "flattened-2d-proof",
      dimensionsAuthority: "genie-universal-panelizer", bleedInches: 5,
      sourceProofHash: proofArtifact.contentHash, storagePath: proofArtifact.storagePath, totalSqFt: manifest.totalSqFt,
      dimensionManifestId: rebound.dimension_manifest_id, manifestHash: rebound.manifest_hash,
      perSurfaceDimensions: manifest.expectedSurfaces.map(({ sourceAsset, ...surface }) => surface),
      viewLineage: frozenViews.viewReceipts, flatMaterialHash: spec.materialHash, imageModel: result.imageModel,
      textLock: result.textLock, requiresPanelProTextReview: true,
      flatLayout: {
        storagePath: layoutArtifact.storagePath, contentHash: layoutArtifact.contentHash, byteSize: layoutArtifact.byteSize,
        width: flatLayout.width, height: flatLayout.height, scalePxPerInch: flatLayout.scalePxPerInch, layoutHash: flatLayout.layoutHash,
      },
      surfacePanels: result.surfacePanels,
    }, null, [proofArtifact, layoutArtifact]);
  }
  if (stage.stage_key === "panels.build") {
    const proof = await stageOutput(sb, run.id, "proof.build");
    const manifest = requiredObject(run.results?.dimensionManifest, "bound GENIE dimension manifest");
    const expected = new Map((manifest.expectedSurfaces || []).map((item) => [String(item.surfaceKey), item]));
    const flatLayout = requiredObject(proof.flatLayout, "Call 8 flat wrap layout receipt");
    let layout;
    try { layout = flatWrapLayout((manifest.expectedSurfaces || []).map(({ sourceAsset, ...surface }) => surface)); }
    catch (error) { throw new StageError(error.code || "call9_cut_map_invalid", error.message, false); }
    if (layoutIdentity(layout) !== flatLayout.layoutHash) throw new StageError("call9_cut_map_drift", "The Call 9 cut map no longer matches the approved Call 8 layout", false);

    // Cut, never generate. The authored layout is downloaded, verified byte for
    // byte, and the six panels are lifted straight out of it.
    const layoutBytes = await storageBytes(sb, flatLayout.storagePath);
    if (hashBytes(layoutBytes) !== String(flatLayout.contentHash).toLowerCase()) throw new StageError("call9_layout_changed", "The approved flat wrap layout changed after Call 8", false);
    let cuts;
    let fingerprints;
    try {
      cuts = await cutAllPanels(layoutBytes, layout);
      fingerprints = await assertSurfacesAreDistinct(cuts);
    } catch (error) { throw new StageError(error.code || "call9_cut_failed", error.message, false); }

    const recorded = new Map((Array.isArray(proof.surfacePanels) ? proof.surfacePanels : []).map((item) => [String(item.key), item]));
    const produced = [];
    const spools = [];
    const sourceRegionHashes = {};
    const artworkFingerprints = {};
    for (const cut of cuts) {
      const key = cut.surfaceKey;
      const dims = expected.get(key);
      if (!dims || !Object.values(dims.bleed || {}).every((value) => Number(value) === 5)) throw new StageError("call9_genie_identity_missing", key, false);
      const call8Panel = recorded.get(key);
      // The cut must reproduce the exact bytes Call 8 recorded. If it does not,
      // something between the two stages moved, and the stage fails closed.
      if (!call8Panel || String(call8Panel.contentHash).toLowerCase() !== cut.contentHash) {
        throw new StageError("call9_cut_hash_mismatch", `${key} cut does not reproduce the hash Call 8 recorded`, false);
      }
      if (Number(call8Panel.pixelWidth) !== cut.cell.w || Number(call8Panel.pixelHeight) !== cut.cell.h) throw new StageError("call9_geometry_drift", `${key} cut geometry drifted`, false);
      const storagePath = `designpro/${tenantKey(run.tenant_key)}/${run.id}/panels/${key}.png`;
      const stored = await uploadProducedBytes(sb, run, stage, runtimeConfig, storagePath, cut.bytes, "image/png");
      if (stored.spool) spools.push(stored.spool);
      sourceRegionHashes[key] = cut.contentHash;
      artworkFingerprints[key] = fingerprints[key];
      produced.push(artifact("panel", stored.storagePath, stored.hash, stored.bytes, key, {
        call: 9, sourceRule: "deterministic-cut-of-approved-call8-flat-wrap-layout",
        extractionContract: EXTRACTION_CONTRACT,
        sourceRegionHash: cut.contentHash,
        sourceLayoutPath: flatLayout.storagePath, sourceLayoutHash: flatLayout.contentHash,
        cutRect: { x: cut.cell.x, y: cut.cell.y, w: cut.cell.w, h: cut.cell.h },
        trimRect: cut.cell.trim, artworkFingerprint: fingerprints[key],
        trimWidthInches: dims.widthInches, trimHeightInches: dims.heightInches,
        bleed: { top: 5, right: 5, bottom: 5, left: 5 },
        surfaceSqFt: dims.surfaceSqFt, scalePxPerInch: layout.scalePxPerInch,
        pixelWidth: cut.cell.w, pixelHeight: cut.cell.h,
        printWidthInches: cut.cell.printWidthIn, printHeightInches: cut.cell.printHeightIn,
        dpi: 1500, outputScale: 0.1, regenerated: false,
      }));
    }
    const panelHashes = Object.fromEntries(produced.map((item) => [item.surfaceKey, item.contentHash]));
    if (new Set(Object.values(panelHashes)).size !== produced.length) throw new StageError("call9_surface_reuse", "Every panel must be a distinct cut of the approved layout", false);
    if (panelHashes.driver === panelHashes.passenger) throw new StageError("call9_driver_passenger_reuse", "Driver artwork cannot be reused for passenger", false);
    const trimDimensions = Object.fromEntries(manifest.expectedSurfaces.map((item) => [item.surfaceKey, { widthInches: item.widthInches, heightInches: item.heightInches, surfaceSqFt: item.surfaceSqFt }]));
    const completed = await complete(sb, stage, run, {
      verified: true, receiptKind: "call9.surface-panels", call: 9,
      sourceRule: "deterministic-cut-of-approved-call8-flat-wrap-layout",
      extractionContract: EXTRACTION_CONTRACT, regenerated: false,
      sides: cuts.map((cut) => cut.surfaceKey), panelHashes, sourceRegionHashes, artworkFingerprints,
      sourceLayoutHash: flatLayout.contentHash, layoutHash: flatLayout.layoutHash, scalePxPerInch: layout.scalePxPerInch,
      dimensionsAuthority: "genie-universal-panelizer", bleedInches: 5, dpi: 1500, outputScale: 0.1,
      dimensionManifestId: run.dimension_manifest_id, manifestHash: run.manifest_hash,
      totalSqFt: manifest.totalSqFt, trimDimensions,
    }, null, produced);
    for (const spool of spools) await removeCommittedSpool(spool).catch((error) => console.error(`[DESIGNPRO-OS] committed Call 9 panel spool cleanup failed: ${error.message}`));
    return completed;
  }
  if (stage.stage_key === "logos.extract") {
    const { data: revisionSource, error: revisionError } = await sb.from("designpro_revision_sources").select("snapshot,snapshot_hash").eq("revision_id", run.revision_id).maybeSingle();
    if (revisionError || !revisionSource || revisionSource.snapshot_hash !== run.revision_snapshot_hash) throw new StageError("call10_revision_source_drift", "Immutable logo inventory source changed", false);
    if (!Array.isArray(revisionSource.snapshot?.expectedLogoInventory)) throw new StageError("call10_inventory_not_frozen", "Revision snapshot must freeze expectedLogoInventory", false);
    const expected = revisionSource.snapshot.expectedLogoInventory;
    const attestation = revisionSource.snapshot.logoInventoryAttestation;
    if (!attestation || attestation.attested !== true || !["none", "listed"].includes(attestation.mode)
      || (attestation.mode === "none" && expected.length !== 0) || (attestation.mode === "listed" && expected.length === 0)) {
      throw new StageError("call10_inventory_attestation_invalid", "Logo inventory must be explicitly attested as none or listed", false);
    }
    const call9 = await stageOutput(sb, run.id, "panels.build");
    const regionHashes = call9.sourceRegionHashes || {};
    const produced = [];
    for (let index = 0; index < expected.length; index++) {
      const identityKey = requiredString(expected[index]?.identityKey, `expectedInventory[${index}].identityKey`);
      const displayName = requiredString(expected[index]?.displayName, `${identityKey}.displayName`);
      const targetSurfaceKey = requiredString(expected[index]?.surfaceKey, `${identityKey}.surfaceKey`);
      if (!SURFACE_KEYS.includes(targetSurfaceKey)) throw new StageError("call10_logo_surface_invalid", `${identityKey}: ${targetSurfaceKey}`, false);
      const sourceRegionHash = requiredString(regionHashes[targetSurfaceKey], `${identityKey} verified source region`).toLowerCase();
      const placementKey = `${targetSurfaceKey}:${identityKey}:${index}`;
      let logoAsset;
      try { logoAsset = normalizeLogoAsset(expected[index], run.tenant_key, run.revision_id); }
      catch (error) { throw new StageError("call10_logo_asset_invalid", `${identityKey}: ${error.message}`, false); }
      produced.push(await exactStoredArtifact(sb, { ...logoAsset, surfaceKey: placementKey, metadata: { placementKey, identityKey, displayName, targetSurfaceKey, contentType: logoAsset.contentType, sourceRegionHash, separationContract: "designpro.deterministic-stored-overlay.v1" } }, "logo"));
    }
    const inventory = expected.map((item, index) => ({ placementKey: produced[index]?.metadata?.placementKey, identityKey: item.identityKey, targetSurfaceKey: item.surfaceKey, contentHash: produced[index]?.contentHash || null }));
    const inventoryHash = hashJson(inventory);
    return complete(sb, stage, run, { verified: true, receiptKind: "call10.logo-inventory", call: 10, inventoryContract: "designpro.expected-logo-inventory.v1", exactSetVerified: true, inventoryHash, inventory }, null, produced);
  }
  if (stage.stage_key === "pack.verify") {
    const views = await receipt(sb, run.id, "views.seven-source");
    const call8 = await receipt(sb, run.id, "call8.flat-proof");
    const call9 = await receipt(sb, run.id, "call9.surface-panels");
    const call10 = await receipt(sb, run.id, "call10.logo-inventory");
    const sourceContract = { revisionSnapshotHash: run.revision_snapshot_hash, manifestHash: run.manifest_hash, views: views.receipt_hash, call8: call8.receipt_hash, call9: call9.receipt_hash, call10: call10.receipt_hash };
    const packReceipt = { verified: true, exactCallSet: [8, 9, 10], sevenViewsVerified: true, sourceContract };
    const { data, error } = await sb.rpc("finalize_designpro_entice_identity", { p_run_id: run.id, p_stage_id: stage.id, p_lease_token: stage.lease_token, p_source_contract_hash: null, p_artifact_set_hash: null, p_pack_receipt: packReceipt });
    if (error) throw new StageError("pack_identity_finalize_failed", error.message, false);
    return complete(sb, stage, await getRun(sb, run.id), { verified: true, ...packReceipt, ...data });
  }
  if (stage.stage_key === "pack.activate") {
    await stageOutput(sb, run.id, "pack.verify");
    await complete(sb, stage, run, { verified: true, active: true, activatedAt: new Date().toISOString() });
    return ensureAutomaticProduction(sb, run.id);
  }
  throw new StageError("unsupported_entice_stage", stage.stage_key, false);
}

async function buildPrintOutputs(sb, run, input, stage, runtimeConfig) {
  const sourceRunId = requiredString(run.results?.sourceEnticeRunId || input.sourceEnticeRunId, "sourceEnticeRunId");
  // Production files are rendered from the Call 12 enhanced masters, which are
  // already at full print geometry. The Call 9 panels stay bound as lineage but
  // are never the raster source here: stretching them would discard the
  // enhancement the customer is paying for.
  const call12 = await receipt(sb, run.id, "call12.topaz-upscale");
  const panels = await artifacts(sb, run.id, ["upscaled-panel"]);
  if (panels.length !== SURFACE_KEYS.length || new Set(panels.map((item) => item.surface_key)).size !== SURFACE_KEYS.length) throw new StageError("enhanced_panels_missing", "Exact six Call 12 enhanced panels are required", false);
  for (const panel of panels) {
    if (String(panel.content_hash).toLowerCase() !== String(call12.receipt?.enhancedHashes?.[panel.surface_key] || "").toLowerCase()) {
      throw new StageError("enhanced_panel_receipt_mismatch", `Call 12 ${panel.surface_key} receipt and stored enhanced panel differ`, false);
    }
  }
  const dimensionManifest = requiredObject(input.dimensionManifest, "production dimensionManifest");
  const dimensions = new Map((dimensionManifest.expectedSurfaces || []).map((item) => [String(item.surfaceKey), item]));
  const produced = [];
  const spools = [];
  for (const panel of panels) {
    const dims = dimensions.get(String(panel.surface_key));
    if (!dims || !Object.values(dims.bleed || {}).every((value) => Number(value) === 5)) throw new StageError("output_dimensions_missing", `GENIE dimensions missing for ${panel.surface_key}`, false);
    const source = await storageBytes(sb, panel.storage_path);
    if (hashBytes(source) !== panel.content_hash) throw new StageError("source_panel_changed", panel.surface_key, false);
    const width = Math.round((Number(dims.widthInches) + 10) * 150);
    const height = Math.round((Number(dims.heightInches) + 10) * 150);
    if (!(width > 0 && height > 0 && width * height <= 650_000_000)) throw new StageError("output_geometry_invalid", panel.surface_key, false);
    let contained = await sharp(source, { limitInputPixels: false }).resize(width, height, { fit: "inside", kernel: "lanczos3" }).flatten().png().toBuffer();
    const containedMeta = await sharp(contained).metadata();
    const left = Math.floor((width - containedMeta.width) / 2); const right = width - containedMeta.width - left;
    const top = Math.floor((height - containedMeta.height) / 2); const bottom = height - containedMeta.height - top;
    if (left || right || top || bottom) contained = await sharp(contained).extend({ left, right, top, bottom, extendWith: "mirror" }).png().toBuffer();
    const raster = await sharp(contained).removeAlpha().toColourspace("srgb").png({ compressionLevel: 6 }).withMetadata({ density: 1500 }).toBuffer();
    const slug = String(panel.surface_key).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const base = `designpro/${tenantKey(run.tenant_key)}/${run.id}/outputs/${slug}`;
    const png = await uploadProducedBytes(sb, run, stage, runtimeConfig, `${base}.png`, raster, "image/png");
    if (png.spool) spools.push(png.spool);
    produced.push(artifact("output", png.storagePath, png.hash, png.bytes, panel.surface_key, { format: "png", width: width, height: height, dpi: 1500, outputScale: 0.1, fullScaleBleedInches: 5, colorMode: "sRGB", physicalWidthInches: width / 1500, physicalHeightInches: height / 1500, productionWidthInches: Number(dims.widthInches) + 10, productionHeightInches: Number(dims.heightInches) + 10 }));
    const tiffBytes = await sharp(contained).removeAlpha().toColourspace("srgb").tiff({ compression: "lzw", predictor: "horizontal", bitdepth: 8 }).withMetadata({ density: 1500 }).toBuffer();
    const tiff = await uploadProducedBytes(sb, run, stage, runtimeConfig, `${base}.tiff`, tiffBytes, "image/tiff");
    if (tiff.spool) spools.push(tiff.spool);
    produced.push(artifact("output", tiff.storagePath, tiff.hash, tiff.bytes, panel.surface_key, { format: "tiff", width: width, height: height, dpi: 1500, outputScale: 0.1, fullScaleBleedInches: 5, colorMode: "sRGB", physicalWidthInches: width / 1500, physicalHeightInches: height / 1500, productionWidthInches: Number(dims.widthInches) + 10, productionHeightInches: Number(dims.heightInches) + 10 }));
    const { data: rgb, info } = await sharp(contained).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== width || info.height !== height || info.channels !== 3) throw new StageError("eps_raster_geometry_invalid", panel.surface_key, false);
    const epsBytes = buildDeterministicRasterEps({
      rgb,
      widthPixels: width,
      heightPixels: height,
      trimWidthInches: Number(dims.widthInches),
      trimHeightInches: Number(dims.heightInches),
    });
    const eps = await uploadProducedBytes(sb, run, stage, runtimeConfig, `${base}.eps`, epsBytes, "application/postscript");
    if (eps.spool) spools.push(eps.spool);
    produced.push(artifact("output", eps.storagePath, eps.hash, eps.bytes, panel.surface_key, { format: "eps", width: width, height: height, dpi: 1500, outputScale: 0.1, fullScaleBleedInches: 5, colorMode: "sRGB", rasterSha256: hashBytes(rgb), physicalWidthInches: width / 1500, physicalHeightInches: height / 1500, productionWidthInches: Number(dims.widthInches) + 10, productionHeightInches: Number(dims.heightInches) + 10 }));
  }
  return { produced, spools };
}

function canonicalDesignId(generationId) {
  const value = String(generationId || "").trim().toLowerCase();
  if (!UUID_RE.test(value)) throw new StageError("stamp_generation_identity_invalid", "Immutable generationId is not a canonical UUID", false);
  return `DID-${value.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function immutableBusinessIdentity(revisionSource, run) {
  const snapshot = requiredObject(revisionSource?.snapshot, "immutable revision snapshot");
  const generationId = requiredString(snapshot.generationId, "revisionSnapshot.generationId").toLowerCase();
  const designId = canonicalDesignId(generationId);
  const orderNumber = requiredString(snapshot.orderNumber, "revisionSnapshot.orderNumber");
  if (String(revisionSource.generation_id || "").toLowerCase() !== generationId || snapshot.designId !== designId || snapshot.delivery?.orderNumber !== orderNumber
    || orderNumber !== orderNumber.trim() || orderNumber.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._/# -]*$/.test(orderNumber)
    || revisionSource.snapshot_hash !== run.revision_snapshot_hash || revisionSource.owner_id !== run.owner_id || revisionSource.tenant_key !== run.tenant_key) {
    throw new StageError("stamp_business_identity_drift", "DesignID or Order # is missing, noncanonical, or no longer bound to the immutable revision", false);
  }
  return { designId, orderNumber };
}

function stampSvg(verifiedBy, designId, orderNumber, date) {
  const escape = (text) => String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000"><defs><path id="qc-ring" d="M 145,500 A 355,355 0 0,1 855,500"/></defs><circle cx="500" cy="500" r="455" fill="none" stroke="#059669" stroke-width="28"/><circle cx="500" cy="500" r="410" fill="none" stroke="#10b981" stroke-width="10"/><text font-family="Arial" font-size="56" font-weight="700" fill="#059669" letter-spacing="4"><textPath href="#qc-ring" startOffset="50%" text-anchor="middle">DESIGNPROAI · QUALITY CONTROL</textPath></text><text x="500" y="385" text-anchor="middle" font-family="Arial" font-size="72" font-weight="700" fill="#065f46">QUALITY</text><text x="500" y="480" text-anchor="middle" font-family="Arial" font-size="88" font-weight="700" fill="#059669">APPROVED</text><text x="500" y="565" text-anchor="middle" font-family="Arial" font-size="43" font-weight="700" fill="#065f46">DesignID: ${escape(designId)}</text><text x="500" y="625" text-anchor="middle" font-family="Arial" font-size="39" font-weight="700" fill="#065f46">Order #: ${escape(orderNumber)}</text><text x="500" y="692" text-anchor="middle" font-family="Arial" font-size="31" font-weight="700" fill="#065f46">Quality Checked by ${escape(verifiedBy).slice(0, 120)}</text><text x="500" y="745" text-anchor="middle" font-family="Arial" font-size="29" fill="#6b7280">${escape(date)}</text></svg>`);
}

async function storageStream(sb, storagePath) {
  const path = safePath(storagePath, "storagePath");
  const builder = sb.storage.from(BUCKET).download(path);
  const { data, error } = await (typeof builder?.asStream === "function" ? builder.asStream() : builder);
  if (error || !data) throw new StageError("artifact_download_failed", `Unable to stream ${path}: ${error?.message || "empty object"}`);
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) return [data];
  if (typeof data[Symbol.asyncIterator] === "function") return data;
  if (typeof data.stream === "function") return data.stream();
  throw new StageError("artifact_stream_invalid", `${path} did not return a readable byte stream`);
}

async function* verifiedArtifactChunks(sb, row) {
  const hash = createHash("sha256");
  let byteSize = 0;
  const source = await storageStream(sb, row.storage_path);
  for await (const value of source) {
    assertStageLeaseActive();
    if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) throw new StageError("artifact_stream_chunk_invalid", row.storage_path, false);
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    byteSize += chunk.length;
    hash.update(chunk);
    yield chunk;
  }
  if (byteSize !== Number(row.byte_size) || hash.digest("hex") !== String(row.content_hash).toLowerCase()) {
    throw new StageError("zip_source_changed", row.storage_path, false);
  }
}

function zipArtifactEntries(sb, rows) {
  const names = new Set();
  const entries = [];
  const ordered = [...rows].sort((left, right) => {
    const leftKey = `${left.artifact_kind}/${left.surface_key}/${left.storage_path}`;
    const rightKey = `${right.artifact_kind}/${right.surface_key}/${right.storage_path}`;
    return leftKey.localeCompare(rightKey);
  });
  for (const row of ordered) {
    if (!HASH_RE.test(String(row.content_hash || "")) || !Number.isSafeInteger(Number(row.byte_size)) || Number(row.byte_size) < 1) throw new StageError("zip_source_identity_invalid", row.storage_path, false);
    const leaf = String(row.storage_path).split("/").pop() || "file";
    const safeSurface = String(row.surface_key || "artifact").replace(/[^A-Za-z0-9_-]+/g, "-");
    const name = `${row.artifact_kind}/${safeSurface}-${row.content_hash.slice(0, 12)}-${leaf}`;
    if (names.has(name)) throw new StageError("zip_entry_collision", name, false);
    names.add(name);
    entries.push({ name, byteSize: Number(row.byte_size), open: () => verifiedArtifactChunks(sb, row) });
  }
  return entries;
}

function bufferZipEntry(name, bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return {
    name,
    byteSize: body.length,
    open: async function* open() { yield body; },
  };
}

function sourceViewZipEntries(sb, viewReceipts) {
  if (!Array.isArray(viewReceipts) || viewReceipts.length !== VIEW_KEYS.length) {
    throw new StageError("zip_source_views_incomplete", "ZIP requires all seven immutable source views", false);
  }
  const seen = new Set();
  return [...viewReceipts].sort((left, right) => String(left.viewKey).localeCompare(String(right.viewKey))).map((item) => {
    const viewKey = requiredString(item.viewKey, "source view key");
    if (!VIEW_KEYS.includes(viewKey) || seen.has(viewKey)) throw new StageError("zip_source_view_identity_invalid", viewKey, false);
    seen.add(viewKey);
    const storagePath = safePath(item.storagePath, `${viewKey} source storagePath`);
    const contentHash = requiredString(item.contentHash, `${viewKey} source hash`).toLowerCase();
    const byteSize = Number(item.byteSize);
    if (!HASH_RE.test(contentHash) || !Number.isSafeInteger(byteSize) || byteSize < 1) throw new StageError("zip_source_view_identity_invalid", viewKey, false);
    const extension = String(storagePath).split(".").pop().toLowerCase();
    if (!/^(png|jpe?g|webp)$/.test(extension)) throw new StageError("zip_source_view_extension_invalid", viewKey, false);
    const row = { storage_path: storagePath, content_hash: contentHash, byte_size: byteSize };
    return { name: `source-views/${viewKey}-${contentHash.slice(0, 12)}.${extension}`, byteSize, open: () => verifiedArtifactChunks(sb, row) };
  });
}

async function copyVerifiedZip(sb, sourcePath, targetPath, contentHash, byteSize) {
  assertStageLeaseActive();
  const client = sb.storage.from(BUCKET);
  const { error } = await client.copy(safePath(sourcePath, "source ZIP"), safePath(targetPath, "delivered ZIP"));
  if (error && !/already exists|duplicate|conflict|resourcealreadyexists/i.test(`${error.code || ""} ${error.message || ""}`)) {
    throw new StageError("delivery_zip_copy_failed", error.message);
  }
  try {
    const observed = await verifyStoredZip({ supabase: sb, storagePath: targetPath, contentHash, byteSize, signal: stageLeaseContext.getStore()?.controller?.signal });
    if (!observed) throw new StageError("delivery_zip_copy_missing", "Server-side ZIP copy is not readable");
    return observed;
  } catch (errorValue) {
    if (errorValue instanceof StageError) throw errorValue;
    throw new StageError(errorValue.code || "delivery_zip_copy_invalid", errorValue.message, errorValue.retryable !== false);
  }
}

async function copyPinnedSourceArtifact(sb, run, row, kind, relativePath, contentType, metadata = {}) {
  const target = `designpro/${tenantKey(run.tenant_key)}/${run.id}/source/${relativePath}`;
  const client = sb.storage.from(BUCKET);
  const { error } = await client.copy(safePath(row.storage_path, "source artifact"), safePath(target, "copied artifact"));
  if (error && !/already exists|duplicate|conflict|resourcealreadyexists/i.test(`${error.code || ""} ${error.message || ""}`)) throw new StageError("production_source_copy_failed", error.message);
  const observed = await verifyStoredArtifact({ supabase: sb, storagePath: target, contentHash: String(row.content_hash).toLowerCase(), byteSize: Number(row.byte_size), signal: stageLeaseContext.getStore()?.controller?.signal });
  if (!observed) throw new StageError("production_source_copy_missing", target, true);
  return artifact(kind, observed.storagePath, observed.contentHash, observed.byteSize, String(row.surface_key || ""), {
    ...row.metadata, ...metadata, sourceEnticeRunId: run.results?.sourceEnticeRunId || run.input?.sourceEnticeRunId,
    sourceStoragePath: row.storage_path, sourceContentHash: row.content_hash,
  });
}

async function executeProduction(sb, stage, run, runtimeConfig) {
  const input = requiredObject(run.input, "workflow input");
  const sourceRunId = requiredString(run.results?.sourceEnticeRunId || input.sourceEnticeRunId, "sourceEnticeRunId");
  if (stage.stage_key === "source.verify") {
    const call8 = await receipt(sb, sourceRunId, "call8.flat-proof");
    const call9 = await receipt(sb, sourceRunId, "call9.surface-panels");
    const call10 = await receipt(sb, sourceRunId, "call10.logo-inventory");
    const sourceProofs = await artifacts(sb, sourceRunId, ["flat-proof"]);
    const sourcePanels = await artifacts(sb, sourceRunId, ["panel"]);
    const sourceLogos = await artifacts(sb, sourceRunId, ["logo"]);
    const customerProof = sourceProofs.find((item) => String(item.surface_key || "") === "");
    const wrapLayout = sourceProofs.find((item) => String(item.surface_key || "") === "flat-wrap-layout");
    if (!customerProof || !wrapLayout || sourceProofs.length !== 2 || sourcePanels.length !== SURFACE_KEYS.length || new Set(sourcePanels.map((item) => item.surface_key)).size !== SURFACE_KEYS.length) {
      throw new StageError("production_source_set_incomplete", "The 2D production proof, the approved flat wrap layout and the exact six Call 9 cuts are required", false);
    }
    if (customerProof.content_hash !== call8.receipt?.sourceProofHash) throw new StageError("production_call8_receipt_mismatch", "Call 8 receipt and 2D production proof differ", false);
    if (wrapLayout.content_hash !== call8.receipt?.flatLayout?.contentHash) throw new StageError("production_call8_layout_mismatch", "Call 8 receipt and approved flat wrap layout differ", false);
    for (const surface of SURFACE_KEYS) {
      const row = sourcePanels.find((item) => item.surface_key === surface);
      if (!row || row.content_hash !== call9.receipt?.panelHashes?.[surface]) throw new StageError("production_call9_receipt_mismatch", `Call 9 ${surface} receipt differs`, false);
    }
    const receiptPlacements = Array.isArray(call10.receipt?.inventory) ? [...call10.receipt.inventory].sort((a, b) => String(a.placementKey).localeCompare(String(b.placementKey))) : [];
    const observedPlacements = sourceLogos.map((row) => ({ placementKey: row.metadata?.placementKey, identityKey: row.metadata?.identityKey, targetSurfaceKey: row.metadata?.targetSurfaceKey, contentHash: row.content_hash })).sort((a, b) => String(a.placementKey).localeCompare(String(b.placementKey)));
    if (JSON.stringify(receiptPlacements) !== JSON.stringify(observedPlacements)) throw new StageError("production_logo_evidence_mismatch", "Call 10 logo placement receipt and immutable logo bytes differ", false);

    const produced = [];
    produced.push(await copyPinnedSourceArtifact(sb, run, customerProof, "flat-proof", "call8-2d-production-proof.png", "image/png", { sourceReceiptHash: call8.receipt_hash }));
    produced.push(await copyPinnedSourceArtifact(sb, run, wrapLayout, "flat-proof", "call8-flat-wrap-layout.png", "image/png", { sourceReceiptHash: call8.receipt_hash }));
    for (const row of [...sourcePanels].sort((a, b) => a.surface_key.localeCompare(b.surface_key))) {
      produced.push(await copyPinnedSourceArtifact(sb, run, row, "panel", `panels/${row.surface_key}.png`, "image/png", { sourceReceiptHash: call9.receipt_hash }));
    }
    for (const row of [...sourceLogos].sort((a, b) => String(a.surface_key).localeCompare(String(b.surface_key)))) {
      const extension = String(row.storage_path).split(".").pop().toLowerCase();
      const contentType = row.metadata?.contentType || ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf" })[extension];
      const slug = String(row.surface_key).replace(/[^A-Za-z0-9_-]+/g, "-");
      produced.push(await copyPinnedSourceArtifact(sb, run, row, "logo", `logos/${slug}.${extension}`, contentType, { sourceReceiptHash: call10.receipt_hash }));
    }
    return complete(sb, stage, run, {
      verified: true,
      call8: { receiptKind: "call8.flat-proof", receiptHash: call8.receipt_hash },
      call9: { receiptKind: "call9.surface-panels", receiptHash: call9.receipt_hash },
      call10: { receiptKind: "call10.logo-inventory", receiptHash: call10.receipt_hash },
      sourceArtifactCount: produced.length, logoPlacements: receiptPlacements,
    }, null, produced);
  }
  if (stage.stage_key === "await_panelpro_preflight_qc" || stage.stage_key === "await_final_human_qc") {
    const { error } = await sb.rpc("request_designpro_human_gate", { p_run_id: run.id, p_stage_key: stage.stage_key, p_details: { requestedBy: "designpro-standalone-claimant", requestedAt: new Date().toISOString() } });
    if (error) throw new StageError("human_gate_request_failed", error.message, false);
    return;
  }
  if (stage.stage_key === "enhance.upscale") {
    // Call 12. Every approved panel is enhanced to full print geometry before a
    // single production file is rendered, so the PNG/TIFF/EPS are built FROM
    // the enhanced master rather than from an interpolated stretch.
    const readiness = topazReadiness(process.env);
    if (!readiness.configurationValid) throw new StageError("topaz_configuration_invalid", readiness.detail, false);
    if (!readiness.enabled) throw new StageError("topaz_disabled", "Call 12 is disabled; a production pack cannot be built without the approved enhancement", false);
    const panels = await artifacts(sb, run.id, ["panel"]);
    if (panels.length !== SURFACE_KEYS.length || new Set(panels.map((item) => item.surface_key)).size !== SURFACE_KEYS.length) {
      throw new StageError("enhance_source_panels_missing", "Exact six approved source panels are required", false);
    }
    const dimensionManifest = requiredObject(input.dimensionManifest, "production dimensionManifest");
    const dimensions = new Map((dimensionManifest.expectedSurfaces || []).map((item) => [String(item.surfaceKey), item]));
    const produced = [];
    const spools = [];
    const enhancedHashes = {};
    const plans = {};
    const enhanced = await withHeavyOutputLease(sb, stage, async () => {
      const results = [];
      for (const panel of [...panels].sort((a, b) => String(a.surface_key).localeCompare(String(b.surface_key)))) {
        assertStageLeaseActive();
        const key = String(panel.surface_key);
        const dims = dimensions.get(key);
        if (!dims || !Object.values(dims.bleed || {}).every((value) => Number(value) === 5)) throw new StageError("enhance_dimensions_missing", `GENIE dimensions missing for ${key}`, false);
        const source = await storageBytes(sb, panel.storage_path);
        if (hashBytes(source) !== panel.content_hash) throw new StageError("enhance_source_panel_changed", key, false);
        const targetWidthPx = Math.round((Number(dims.widthInches) + 10) * 150);
        const targetHeightPx = Math.round((Number(dims.heightInches) + 10) * 150);
        // An immutable winner at a material-addressed path. Topaz is not
        // reproducible, so a retry reuses the approved bytes instead of
        // authoring a second, different enhancement.
        const storagePath = `designpro/${tenantKey(run.tenant_key)}/${run.id}/enhanced/${key}-${String(panel.content_hash).slice(0, 24)}.png`;
        const existing = await storageBytes(sb, storagePath).catch(() => null);
        if (existing && existing.length) {
          const metadata = await sharp(existing, { limitInputPixels: false }).metadata();
          if (metadata.width !== targetWidthPx || metadata.height !== targetHeightPx) throw new StageError("enhance_winner_geometry_drift", key, false);
          results.push({ key, bytes: existing, reused: true, dims, targetWidthPx, targetHeightPx, detail: null });
          continue;
        }
        let outcome;
        try {
          outcome = await enhancePanel({
            readiness, surfaceKey: key, bytes: source, mimeType: "image/png",
            targetWidthPx, targetHeightPx, signal: stageLeaseContext.getStore()?.controller?.signal,
          });
        } catch (error) { throw new StageError(error.code || "topaz_enhance_failed", error.message, error.retryable === true); }
        results.push({ key, bytes: outcome.bytes, reused: false, dims, targetWidthPx, targetHeightPx, detail: outcome, storagePath });
      }
      return results;
    });

    for (const item of enhanced) {
      const key = item.key;
      const storagePath = `designpro/${tenantKey(run.tenant_key)}/${run.id}/enhanced/${key}-${String(panels.find((p) => p.surface_key === key).content_hash).slice(0, 24)}.png`;
      const stored = await uploadProducedBytes(sb, run, stage, runtimeConfig, storagePath, item.bytes, "image/png");
      if (stored.spool) spools.push(stored.spool);
      enhancedHashes[key] = stored.hash;
      plans[key] = item.detail ? item.detail.plan : { reusedImmutableWinner: true };
      produced.push(artifact("upscaled-panel", stored.storagePath, stored.hash, stored.bytes, key, {
        call: 12, contract: TOPAZ_CONTRACT, engine: "topaz-image-enhance", model: readiness.model,
        sourcePanelPath: panels.find((p) => p.surface_key === key).storage_path,
        sourcePanelHash: panels.find((p) => p.surface_key === key).content_hash,
        enhancedSha256: item.detail?.enhancedSha256 || stored.hash,
        reusedImmutableWinner: item.reused === true,
        plan: item.detail?.plan || null,
        clampedByEngineCeiling: item.detail?.plan?.clampedByEngineCeiling === true,
        widthPx: item.targetWidthPx, heightPx: item.targetHeightPx,
        trimWidthInches: item.dims.widthInches, trimHeightInches: item.dims.heightInches,
        bleed: { top: 5, right: 5, bottom: 5, left: 5 },
        surfaceSqFt: item.dims.surfaceSqFt, dpi: 1500, outputScale: 0.1,
      }));
    }
    if (new Set(Object.values(enhancedHashes)).size !== SURFACE_KEYS.length) throw new StageError("enhance_surface_reuse", "Every enhanced panel must be distinct", false);
    const completed = await complete(sb, stage, run, {
      verified: true, receiptKind: "call12.topaz-upscale", call: 12,
      contract: TOPAZ_CONTRACT, engine: "topaz-image-enhance", model: readiness.model,
      enhancedHashes, plans, surfaces: Object.keys(enhancedHashes).sort(),
      authoredWinner: true, deterministic: false,
      note: "Topaz output is not reproducible; downstream stages bind these exact hashes.",
    }, null, produced);
    for (const spool of spools) await removeCommittedSpool(spool).catch((error) => console.error(`[DESIGNPRO-OS] committed Call 12 spool cleanup failed: ${error.message}`));
    return completed;
  }
  if (stage.stage_key === "output.build") {
    const built = await withHeavyOutputLease(sb, stage, () => buildPrintOutputs(sb, run, input, stage, runtimeConfig));
    const completed = await complete(sb, stage, run, { verified: true, outputCount: built.produced.length, outputSetHash: hashJson(built.produced.map((item) => ({ path: item.storagePath, hash: item.contentHash }))) }, null, built.produced);
    for (const spool of built.spools) await removeCommittedSpool(spool).catch((error) => console.error(`[DESIGNPRO-OS] committed output spool cleanup failed: ${error.message}`));
    return completed;
  }
  if (stage.stage_key === "output.verify") {
    const rows = await artifacts(sb, run.id, ["output"]);
    const dimensionManifest = requiredObject(input.dimensionManifest, "production dimensionManifest");
    let verified;
    try {
      verified = await withHeavyOutputLease(sb, stage, () => verifyProductionOutputSet({
          artifacts: rows,
          dimensionManifest,
          readBytes: async (row) => storageBytes(sb, row.storage_path ?? row.storagePath),
        }));
    } catch (error) {
      throw new StageError(error.code || "output_verification_failed", error.message, false);
    }
    return complete(sb, stage, run, {
      ...verified,
      verified: true,
      receiptKind: "output.verified",
      exactSurfaceFormatCount: 18,
      structuralVerification: verified.files,
    }, null, []);
  }
  if (stage.stage_key === "stamp.build") {
    const finalQc = await receipt(sb, run.id, "final.human-qc");
    const verifiedBy = requiredString(finalQc.receipt?.verifiedBy, "final QC verifiedBy");
    const approvalRef = requiredString(finalQc.receipt?.approvalRef, "final QC approvalRef");
    const approvedAt = requiredString(finalQc.receipt?.approvedAt, "final QC approvedAt");
    const approvalDate = new Date(approvedAt);
    if (!Number.isFinite(approvalDate.getTime())) throw new StageError("final_qc_time_invalid", "final QC approvedAt is invalid", false);
    const { data: revisionSource, error: revisionError } = await sb.from("designpro_revision_sources").select("generation_id,snapshot,snapshot_hash,owner_id,tenant_key").eq("revision_id", run.revision_id).maybeSingle();
    if (revisionError || !revisionSource) throw new StageError("stamp_revision_source_missing", revisionError?.message || "Immutable revision source is missing", false);
    const { designId, orderNumber } = immutableBusinessIdentity(revisionSource, run);
    if (finalQc.receipt?.qc?.designId !== designId || finalQc.receipt?.qc?.orderNumber !== orderNumber) {
      throw new StageError("final_qc_business_identity_drift", "Final QC did not approve this immutable DesignID and Order #", false);
    }
    const svg = stampSvg(verifiedBy, designId, orderNumber, approvalDate.toISOString().slice(0, 10));
    const png = await sharp(svg).png().toBuffer();
    const sealStored = await upload(sb, `designpro/${tenantKey(run.tenant_key)}/${run.id}/qc-approval-stamp.png`, png, "image/png");
    const proofRows = await artifacts(sb, run.id, ["flat-proof"]);
    if (proofRows.length !== 1) throw new StageError("stamp_source_proof_missing", "Exact copied Call 8 proof is required for stamping", false);
    const proofBytes = await storageBytes(sb, proofRows[0].storage_path);
    if (hashBytes(proofBytes) !== proofRows[0].content_hash) throw new StageError("stamp_source_proof_changed", "Call 8 proof changed before stamp", false);
    const proofMeta = await sharp(proofBytes).metadata();
    if (!proofMeta.width || !proofMeta.height) throw new StageError("stamp_source_proof_invalid", "Call 8 proof has no pixel geometry", false);
    const sealSize = Math.max(120, Math.min(360, Math.round(Math.min(proofMeta.width, proofMeta.height) * 0.24)));
    const sealOverlay = await sharp(png).resize(sealSize, sealSize).png().toBuffer();
    const stampedProof = await sharp(proofBytes).composite([{ input: sealOverlay, gravity: "southeast" }]).png().toBuffer();
    const stampedStored = await uploadProducedBytes(sb, run, stage, runtimeConfig, `designpro/${tenantKey(run.tenant_key)}/${run.id}/stamped-call8-proof.png`, stampedProof, "image/png");
    const seal = artifact("stamp", sealStored.storagePath, sealStored.hash, sealStored.bytes, "seal", { designId, orderNumber, verifiedBy, approvalRef, approvedAt: approvalDate.toISOString(), source: "server-svg-port-of-frozen-canvas-stamp" });
    const stamped = artifact("stamp", stampedStored.storagePath, stampedStored.hash, stampedStored.bytes, "stamped-proof", { designId, orderNumber, verifiedBy, approvalRef, approvedAt: approvalDate.toISOString(), sourceProofHash: proofRows[0].content_hash, sealHash: sealStored.hash, composition: "deterministic-southeast-overlay.v1" });
    const completed = await complete(sb, stage, run, { verified: true, receiptKind: "stamp", designId, orderNumber, verifiedBy, approvalRef, approvedAt: approvalDate.toISOString(), stampHash: stampedStored.hash, sealHash: sealStored.hash, sourceProofHash: proofRows[0].content_hash }, stampedStored.hash, [seal, stamped]);
    if (stampedStored.spool) await removeCommittedSpool(stampedStored.spool).catch((error) => console.error(`[DESIGNPRO-OS] committed stamped-proof spool cleanup failed: ${error.message}`));
    return completed;
  }
  if (stage.stage_key === "zip.build") {
    const stampReceipt = await receipt(sb, run.id, "stamp");
    const designId = requiredString(stampReceipt.receipt?.designId, "stamp DesignID");
    const orderNumber = requiredString(stampReceipt.receipt?.orderNumber, "stamp Order #");
    const rows = await artifacts(sb, run.id, ["flat-proof", "panel", "logo", "output", "stamp"]);
    const counts = Object.fromEntries(["flat-proof", "panel", "logo", "output", "stamp"].map((kind) => [kind, rows.filter((item) => item.artifact_kind === kind).length]));
    if (counts["flat-proof"] !== 1 || counts.panel !== 6 || counts.output !== 18 || counts.stamp !== 2) throw new StageError("zip_artifacts_incomplete", "ZIP requires Call 8 proof, six Call 9 masters, Call 10 logos, 18 outputs, seal, and stamped proof", false);
    const sourceViewsReceipt = await receipt(sb, sourceRunId, "views.seven-source");
    const sourceViews = sourceViewsReceipt.receipt?.viewReceipts;
    const viewEntries = sourceViewZipEntries(sb, sourceViews);
    const dimensionManifest = requiredObject(input.dimensionManifest, "production dimensionManifest");
    const dimensionManifestBytes = Buffer.from(JSON.stringify(canonical(dimensionManifest)));
    const dimensionManifestHash = hashBytes(dimensionManifestBytes);
    const dimensionArchivePath = "dimension-manifest/designpro-genie-dimension-manifest.json";
    const businessIdentityBytes = Buffer.from(JSON.stringify(canonical({ contract: "designpro.business-identity.v1", designId, orderNumber })));
    const businessIdentityHash = hashBytes(businessIdentityBytes);
    const businessIdentityArchivePath = "identity/design-order.json";
    const entries = [
      ...zipArtifactEntries(sb, rows),
      ...viewEntries,
      bufferZipEntry(dimensionArchivePath, dimensionManifestBytes),
      bufferZipEntry(businessIdentityArchivePath, businessIdentityBytes),
    ];
    const archivedSourceViews = [...sourceViews].sort((left, right) => String(left.viewKey).localeCompare(String(right.viewKey))).map((item, index) => ({
      viewKey: item.viewKey,
      storagePath: item.storagePath,
      contentHash: item.contentHash,
      byteSize: item.byteSize,
      contentType: item.contentType,
      archivePath: viewEntries[index].name,
    }));
    const materialHash = hashJson({
      artifacts: rows.map((row) => ({ kind: row.artifact_kind, surfaceKey: row.surface_key, storagePath: row.storage_path, contentHash: row.content_hash, byteSize: row.byte_size })).sort((left, right) => `${left.kind}/${left.surfaceKey}/${left.storagePath}`.localeCompare(`${right.kind}/${right.surfaceKey}/${right.storagePath}`)),
      sourceViews: archivedSourceViews,
      dimensionManifest: { archivePath: dimensionArchivePath, contentHash: dimensionManifestHash, byteSize: dimensionManifestBytes.length, workflowManifestHash: run.manifest_hash },
      businessIdentity: { archivePath: businessIdentityArchivePath, contentHash: businessIdentityHash, byteSize: businessIdentityBytes.length, designId, orderNumber },
    });
    const includedKinds = { ...counts, "source-view": 7, "dimension-manifest": 1, "design-order-identity": 1 };
    const signal = stageLeaseContext.getStore()?.controller?.signal;
    let spool;
    try {
      const stored = await withHeavyOutputLease(sb, stage, async () => {
        spool = await spoolDeterministicZip64({ spoolDir: runtimeConfig.spoolDir, runId: run.id, materialHash, createStream: () => createDeterministicZip64Stream(entries), signal });
        const storagePath = `designpro/${tenantKey(run.tenant_key)}/${run.id}/production-pack.zip`;
        return uploadSpoolWithTus({ supabase: sb, supabaseUrl: runtimeConfig.supabaseUrl, serviceRoleKey: runtimeConfig.serviceRoleKey, endpoint: runtimeConfig.tusEndpoint, spoolDir: runtimeConfig.spoolDir, spool, storagePath, signal });
      });
      const zip = artifact("zip", stored.storagePath, stored.contentHash, stored.byteSize, "", { entries: entries.length, compression: "store", zipFormat: "ZIP64", deterministicDate: "1980-01-01T00:00:00.000Z", mode: "100644", materialHash, includedKinds, designId, orderNumber });
      const result = await complete(sb, stage, run, {
        verified: true, receiptKind: "zip", zipHash: stored.contentHash, zipByteSize: stored.byteSize,
        materialHash, entryCount: entries.length, includedKinds,
        sourceViews: archivedSourceViews,
        dimensionManifest: { archivePath: dimensionArchivePath, contentHash: dimensionManifestHash, byteSize: dimensionManifestBytes.length, workflowManifestHash: run.manifest_hash },
        businessIdentity: { archivePath: businessIdentityArchivePath, contentHash: businessIdentityHash, byteSize: businessIdentityBytes.length, designId, orderNumber },
        designId, orderNumber,
      }, stored.contentHash, [zip]);
      await removeCommittedSpool(spool).catch((error) => console.error(`[DESIGNPRO-OS] committed ZIP spool cleanup failed: ${error.message}`));
      return result;
    } catch (error) {
      if (error instanceof StageError) throw error;
      throw new StageError(error.code || "zip_build_failed", error.message, error.retryable !== false);
    }
  }
  if (stage.stage_key === "wrapbox.deliver") {
    const zipReceipt = await receipt(sb, run.id, "zip");
    const finalQc = await receipt(sb, run.id, "final.human-qc");
    const approvedAt = requiredString(finalQc.receipt?.approvedAt, "final QC approvedAt");
    const zipRows = await artifacts(sb, run.id, ["zip"]);
    const zipRow = zipRows.find((row) => row.content_hash === zipReceipt.receipt_hash);
    if (!zipRow) throw new StageError("delivery_zip_missing", "Exact verified ZIP is missing", false);
    const tenant = tenantKey(run.tenant_key);
    const target = `wrapbox/${tenant}/${run.entice_pack_id}/${run.id}/production-pack.zip`;
    const deliveredZip = await copyVerifiedZip(sb, zipRow.storage_path, target, zipRow.content_hash, Number(zipRow.byte_size));
    const { data: revisionSource, error: revisionError } = await sb.from("designpro_revision_sources").select("generation_id,snapshot,snapshot_hash,owner_id,tenant_key").eq("revision_id", run.revision_id).maybeSingle();
    if (revisionError || !revisionSource || revisionSource.snapshot_hash !== run.revision_snapshot_hash || revisionSource.owner_id !== run.owner_id || revisionSource.tenant_key !== run.tenant_key) throw new StageError("delivery_revision_source_drift", "Immutable delivery recipient source is missing or changed", false);
    let delivery;
    try { delivery = assertDeliverySnapshot(revisionSource.snapshot); }
    catch (error) { throw new StageError(error.code || "delivery_recipient_snapshot_invalid", error.message, error.retryable !== false); }
    const businessIdentity = immutableBusinessIdentity(revisionSource, run);
    if (zipReceipt.receipt?.designId !== businessIdentity.designId || zipReceipt.receipt?.orderNumber !== businessIdentity.orderNumber
      || zipReceipt.receipt?.businessIdentity?.designId !== businessIdentity.designId || zipReceipt.receipt?.businessIdentity?.orderNumber !== businessIdentity.orderNumber) {
      throw new StageError("delivery_business_identity_drift", "ZIP DesignID or Order # no longer matches the immutable revision", false);
    }
    const logoRows = await artifacts(sb, run.id, ["logo"]);
    const logos = logoRows.map((row) => ({ placementKey: row.metadata?.placementKey, identityKey: row.metadata?.identityKey, displayName: row.metadata?.displayName, targetSurfaceKey: row.metadata?.targetSurfaceKey, storagePath: safePath(row.storage_path, "logo storagePath"), contentHash: row.content_hash, byteSize: row.byte_size, contentType: row.metadata?.contentType || null })).sort((left, right) => String(left.placementKey).localeCompare(String(right.placementKey)));
    const packRows = await artifacts(sb, run.id, ["flat-proof", "panel", "logo", "output", "stamp", "zip"]);
    const files = packRows.map((row) => ({ kind: row.artifact_kind, surfaceKey: row.surface_key, storagePath: safePath(row.storage_path, "pack storagePath"), contentHash: row.content_hash, byteSize: row.byte_size })).sort((left, right) => `${left.kind}/${left.surfaceKey}/${left.storagePath}`.localeCompare(`${right.kind}/${right.surfaceKey}/${right.storagePath}`));
    if (!Array.isArray(zipReceipt.receipt?.sourceViews) || zipReceipt.receipt.sourceViews.length !== 7 || !zipReceipt.receipt?.dimensionManifest || !zipReceipt.receipt?.businessIdentity) throw new StageError("delivery_source_package_evidence_missing", "WrapBox delivery requires seven archived source views, the GENIE dimension manifest, and business identity", false);
    const manifest = { contract: MANIFEST_CONTRACT, workflowRunId: run.id, operatorId: run.owner_id, customerId: delivery.customerId, recipientIdentityHash: delivery.recipientIdentityHash, tenantKey: run.tenant_key, enticePackId: run.entice_pack_id, revisionId: run.revision_id, sourceEnticeRunId, designId: zipReceipt.receipt.designId, orderNumber: zipReceipt.receipt.orderNumber, approvedAt, deliveredAt: approvedAt, zip: { storagePath: deliveredZip.storagePath, contentHash: deliveredZip.contentHash, byteSize: deliveredZip.byteSize }, sourceViews: zipReceipt.receipt.sourceViews, dimensionManifest: zipReceipt.receipt.dimensionManifest, businessIdentity: zipReceipt.receipt.businessIdentity, logos, files };
    const manifestBytes = Buffer.from(JSON.stringify(canonical(manifest)));
    const stored = await upload(sb, `wrapbox/${tenant}/${run.entice_pack_id}/${run.id}/manifest.json`, manifestBytes, "application/json");
    const manifestArtifact = artifact("wrapbox-manifest", stored.storagePath, stored.hash, stored.bytes, "", { zipHash: deliveredZip.contentHash, customerId: delivery.customerId, recipientIdentityHash: delivery.recipientIdentityHash, designId: businessIdentity.designId, orderNumber: businessIdentity.orderNumber });
    return complete(sb, stage, run, { verified: true, receiptKind: "wrapbox.delivery", contract: MANIFEST_CONTRACT, zipHash: zipReceipt.receipt_hash, manifestPath: stored.storagePath, manifestHash: stored.hash, deliveredZipPath: deliveredZip.storagePath, deliveredAt: approvedAt, designId: businessIdentity.designId, orderNumber: businessIdentity.orderNumber, publicationPending: true }, stored.hash, [manifestArtifact]);
  }
  throw new StageError("unsupported_production_stage", stage.stage_key, false);
}

const CALLS_1_7_HANDOFF_BLOCKER = "source_close_up_has_no_verified_hero3d_role_mapping";
const CALLS_1_7_VIEW_PLAN = Object.freeze([
  Object.freeze({ sourceViewType: "side", consumerRole: "driver" }),
  Object.freeze({ sourceViewType: "passenger-side", consumerRole: "passenger" }),
  Object.freeze({ sourceViewType: "hood_detail", consumerRole: "hood" }),
  Object.freeze({ sourceViewType: "front", consumerRole: "front" }),
  Object.freeze({ sourceViewType: "rear", consumerRole: "rear" }),
  Object.freeze({ sourceViewType: "close-up", consumerRole: "closeup" }),
  Object.freeze({ sourceViewType: "roof", consumerRole: "roof" }),
]);
// Calls 1-7 produce the seven immutable source renders and nothing else. The
// 2D production proof is Call 8 and this system authors it. 'generate-2d-proof'
// was sanctioned here from the period when the historical pipeline owned the
// proof; while it stayed in this contract a legacy runner carrying that
// function could present a valid claim and consume generation attempts. It is
// retired, and the version bump makes a stale runner fail with a legible
// mismatch rather than an opaque hash difference.
const CALLS_1_7_ENGINE_CONTRACT = Object.freeze({
  contractVersion: "designpro.calls-1-7-engine.v2",
  sourceCommit: "bdb26365904e91be446894e84b01b4a24f64aac0",
  sourceBlobs: Object.freeze({
    "design-panel-ai-generate": "4df3a9741c4f0721afb00b4db823fe7022147aa6",
    "generate-color-render": "0eda353a80eb3e60b293d9a99ba3e7d69ab9f065",
    "generate-pattern-render": "8114c56cbb1934569bf659a5f6957c680b9bf868",
    "design-on-vehicle-photo": "a962133b04c335754cf3df307505ed2da652bdda",
    "edit-vehicle-photo": "3843e2b66a8583e16e514a545b7827cf77fade17",
    "studio-os": "6870eaebab4d43ef8605d812416f86621727d3e9",
    "view-angles-os": "03d6282d71faeec37d0fd304f3bc234d9a3cf0a4",
  }),
  sourceViewOrder: Object.freeze(CALLS_1_7_VIEW_PLAN.map((item) => item.sourceViewType)),
  freezePolicy: "exact-source-blob-behavior",
  retiredBlobs: Object.freeze(["generate-2d-proof"]),
  proofAuthority: "designpro-os-call8",
});
const CALLS_1_7_SERVER_CONTROL_KEYS = new Set([
  "prompt", "systemprompt", "negativeprompt", "model", "imagemodel", "seed",
  "temperature", "topk", "topp", "viewangle", "viewangles", "cameraangle",
  "cameraangles", "enginecontract", "sourcecommit", "sourceblobs",
]);
const CALLS_1_7_CONTENT_EXTENSIONS = Object.freeze({
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
});
const CALLS_1_7_VEHICLE_CLASSES = new Set([
  "car", "truck", "suv", "van", "motorcycle", "boat", "bus", "rv",
  "trailer", "aircraft", "heavy_equipment",
]);
const MAX_CALLS_1_7_VIEW_BYTES = 512 * 1024 * 1024;

function generationInputHasServerControls(value, path = []) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((child) =>
    generationInputHasServerControls(child, [...path, "[]"]));
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const requiredVehicleModel = normalized === "model"
      && path.length === 1 && path[0] === "vehicle";
    return CALLS_1_7_SERVER_CONTROL_KEYS.has(normalized) && !requiredVehicleModel
      || generationInputHasServerControls(child, [...path, key]);
  });
}

function assertCalls1To7Claim(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StageError("generation_claim_invalid", "Calls 1-7 claim is missing", false);
  }
  const exactKeys = [
    "attempt", "claimToken", "engineContract", "engineContractHash", "generationId",
    "input", "inputHash", "leaseExpiresAt", "requestId", "tenantKey", "viewPlan",
  ].sort();
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(exactKeys)) {
    throw new StageError("generation_claim_invalid", "Calls 1-7 claim shape changed", false);
  }
  const requestId = String(value.requestId || "").toLowerCase();
  const generationIdValue = String(value.generationId || "").toLowerCase();
  const claimToken = String(value.claimToken || "").toLowerCase();
  if (!UUID_RE.test(requestId) || !UUID_RE.test(generationIdValue) || !UUID_RE.test(claimToken)
    || !HASH_RE.test(String(value.inputHash || ""))
    || !HASH_RE.test(String(value.engineContractHash || ""))
    || !Number.isInteger(Number(value.attempt)) || Number(value.attempt) < 1 || Number(value.attempt) > 12
    || !Number.isFinite(Date.parse(String(value.leaseExpiresAt || "")))) {
    throw new StageError("generation_claim_invalid", "Calls 1-7 claim identity is invalid", false);
  }
  const tenant = tenantKey(value.tenantKey);
  const input = value.input;
  const vehicle = input?.vehicle;
  const delivery = input?.delivery;
  const orderNumber = String(input?.orderNumber || "");
  const recipientIdentityHash = String(delivery?.recipientIdentityHash || "");
  if (!input || typeof input !== "object" || Array.isArray(input)
    || input.contractVersion !== "designpro.calls-1-7-input.v1"
    || orderNumber !== orderNumber.trim()
    || !/^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$/.test(orderNumber)
    || !delivery || typeof delivery !== "object" || Array.isArray(delivery)
    || Object.keys(delivery).sort().join(",") !== "contractVersion,orderNumber,recipientIdentityHash"
    || delivery.contractVersion !== "designpro.wrapbox-recipient.v1"
    || recipientIdentityHash !== recipientIdentityHash.toLowerCase()
    || !HASH_RE.test(recipientIdentityHash)
    || delivery.orderNumber !== orderNumber
    || !vehicle || typeof vehicle !== "object" || Array.isArray(vehicle)
    || [vehicle.year, vehicle.make, vehicle.model, vehicle.type].some((item) => !String(item || "").trim())
    || !CALLS_1_7_VEHICLE_CLASSES.has(String(vehicle.type || ""))
    || generationInputHasServerControls(input)
    || Buffer.byteLength(JSON.stringify(input), "utf8") > 262_144) {
    throw new StageError("generation_claim_invalid", "Calls 1-7 input contract is invalid", false);
  }
  if (JSON.stringify(canonical(value.engineContract)) !== JSON.stringify(canonical(CALLS_1_7_ENGINE_CONTRACT))
    || JSON.stringify(canonical(value.viewPlan)) !== JSON.stringify(canonical(CALLS_1_7_VIEW_PLAN))) {
    throw new StageError("generation_contract_drift", "Frozen Calls 1-7 source contract changed", false);
  }
  return Object.freeze({ ...value, requestId, generationId: generationIdValue, claimToken, tenantKey: tenant });
}

function normalizeCalls1To7Views(claim, rawViews) {
  if (!Array.isArray(rawViews) || rawViews.length !== CALLS_1_7_VIEW_PLAN.length) {
    throw new StageError("exact_seven_generation_views_required", "Exactly seven Calls 1-7 outputs are required", false);
  }
  const bySource = new Map();
  const paths = new Set();
  const hashes = new Set();
  for (const raw of rawViews) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)
      || Object.keys(raw).sort().join(",") !== "byteSize,consumerRole,contentHash,contentType,metadata,sourceViewType,storagePath") {
      throw new StageError("generation_view_identity_invalid", "Calls 1-7 view identity shape changed", false);
    }
    const plan = CALLS_1_7_VIEW_PLAN.find((item) => item.sourceViewType === raw.sourceViewType);
    const contentHash = String(raw.contentHash || "").toLowerCase();
    const contentType = String(raw.contentType || "").toLowerCase();
    const byteSize = Number(raw.byteSize);
    const extension = CALLS_1_7_CONTENT_EXTENSIONS[contentType];
    const expectedPath = `designpro/${claim.tenantKey}/${claim.generationId}/calls-1-7/`
      + `${raw.sourceViewType}/${contentHash}.${extension}`;
    let storagePath;
    try { storagePath = safeStoragePath(raw.storagePath); }
    catch (error) { throw new StageError("generation_view_identity_invalid", error.message, false); }
    if (!plan || raw.consumerRole !== plan.consumerRole || !HASH_RE.test(contentHash)
      || !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_CALLS_1_7_VIEW_BYTES
      || !extension || storagePath !== expectedPath
      || !raw.metadata || typeof raw.metadata !== "object" || Array.isArray(raw.metadata)
      || bySource.has(raw.sourceViewType) || paths.has(storagePath) || hashes.has(contentHash)) {
      throw new StageError("generation_view_identity_invalid", "Calls 1-7 view identity is invalid", false);
    }
    const normalized = Object.freeze({
      sourceViewType: raw.sourceViewType, consumerRole: raw.consumerRole, storagePath,
      contentHash, byteSize, contentType, metadata: raw.metadata,
    });
    bySource.set(raw.sourceViewType, normalized);
    paths.add(storagePath);
    hashes.add(contentHash);
  }
  return CALLS_1_7_VIEW_PLAN.map((item) => bySource.get(item.sourceViewType));
}

async function claimCalls1To7Generation(sb, workerId, leaseSeconds = CLAIM_SECONDS) {
  const id = requiredString(workerId, "Calls 1-7 workerId");
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 1800) {
    throw new StageError("generation_claim_invalid", "Calls 1-7 lease is invalid", false);
  }
  const { data, error } = await sb.rpc("claim_designpro_generation_request", {
    p_worker_id: id, p_lease_seconds: leaseSeconds,
  });
  if (error) throw new StageError("generation_claim_failed", error.message || "Generation claim failed", true);
  const claim = Array.isArray(data) ? data[0] : data;
  return claim ? assertCalls1To7Claim(claim) : null;
}

async function heartbeatCalls1To7Generation(sb, claim, leaseSeconds = CLAIM_SECONDS) {
  const normalized = assertCalls1To7Claim(claim);
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 1800) {
    throw new StageError("generation_heartbeat_invalid", "Calls 1-7 lease is invalid", false);
  }
  const { data, error } = await sb.rpc("heartbeat_designpro_generation_request", {
    p_request_id: normalized.requestId,
    p_claim_token: normalized.claimToken,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new StageError("generation_heartbeat_failed", error.message || "Generation heartbeat failed", true);
  return data === true;
}

async function completeCalls1To7Generation(sb, rawClaim, rawViews) {
  const claim = assertCalls1To7Claim(rawClaim);
  const views = normalizeCalls1To7Views(claim, rawViews);
  for (const view of views) {
    const { data, error } = await sb.storage.from(BUCKET).download(view.storagePath);
    if (error || !data) {
      throw new StageError("generation_view_download_failed", `${view.sourceViewType}: ${error?.message || "empty object"}`, true);
    }
    const observedType = String(data.type || "").toLowerCase().split(";", 1)[0].trim();
    if (observedType !== view.contentType) {
      throw new StageError("generation_view_content_type_mismatch", `${view.sourceViewType} content type changed`, false);
    }
    try { verifySourceBytes(view, Buffer.from(await data.arrayBuffer())); }
    catch (errorValue) {
      throw new StageError("generation_view_byte_identity_mismatch", `${view.sourceViewType}: ${errorValue.message}`, false);
    }
  }
  const receipt = {
    contractVersion: "designpro.calls-1-7-receipt.v1",
    sourceCommit: CALLS_1_7_ENGINE_CONTRACT.sourceCommit,
    frozenContractHash: claim.engineContractHash,
    inputHash: claim.inputHash,
    byteVerified: true,
    callsCompleted: 7,
  };
  const { data, error } = await sb.rpc("complete_designpro_generation_request", {
    p_request_id: claim.requestId,
    p_claim_token: claim.claimToken,
    p_views: views,
    p_engine_receipt: receipt,
  });
  if (error) throw new StageError("generation_completion_failed", error.message || "Generation completion failed", true);
  if (!data || data.state !== "outputs_ready" || data.handoffReady !== false
    || data.handoffBlocker !== CALLS_1_7_HANDOFF_BLOCKER) {
    throw new StageError("generation_completion_response_invalid", "Calls 1-7 completion response changed", false);
  }
  return data;
}

async function failCalls1To7Generation(sb, rawClaim, errorValue) {
  const claim = assertCalls1To7Claim(rawClaim);
  const code = String(errorValue?.code || "generation_failed").slice(0, 160);
  const message = String(errorValue?.message || errorValue || "Generation failed").slice(0, 1000);
  const retryable = errorValue?.retryable !== false;
  const { data, error } = await sb.rpc("fail_designpro_generation_request", {
    p_request_id: claim.requestId, p_claim_token: claim.claimToken,
    p_error_code: code, p_error_message: message, p_retryable: retryable,
  });
  if (error) throw new StageError("generation_failure_record_failed", error.message || "Generation failure was not recorded", true);
  return data === true;
}

function registerDesignProStandaloneClaimant({ app, supabase, supabaseUrl, serviceRoleKey, workerSecret, workerId, port, spoolDir, tusEndpoint }) {
  const id = requiredString(workerId, "workerId");
  const baseUrl = `http://127.0.0.1:${Number(port || 3001)}`;
  let busy = false;
  let timer = null;
  let lastReconcileAt = 0;
  let activeStageGuard = null;
  let stopped = false;

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    let stage = null;
    let heartbeat = null;
    let stageGuard = null;
    try {
      if (Date.now() - lastReconcileAt >= 15_000) {
        lastReconcileAt = Date.now();
        try { await reconcileAutomaticProduction(supabase); }
        catch (error) { console.error(`[DESIGNPRO-OS] automatic production reconciliation failed: ${error.message}`); }
      }
      const { data, error } = await supabase.rpc("claim_designpro_stage", { p_worker: id, p_lease_seconds: CLAIM_SECONDS });
      if (error) throw error;
      stage = Array.isArray(data) ? data[0] : data;
      if (!stage) return;
      const run = await getRun(supabase, stage.run_id);
      stageGuard = { lost: false, controller: new AbortController(), stageId: stage.id, leaseToken: stage.lease_token };
      activeStageGuard = stageGuard;
      heartbeat = setInterval(async () => {
        const { data: current, error: beatError } = await supabase.rpc("heartbeat_designpro_stage", { p_stage_id: stage.id, p_lease_token: stage.lease_token, p_lease_seconds: CLAIM_SECONDS });
        if (beatError || current !== true) {
          stageGuard.lost = true;
          stageGuard.controller.abort(new Error(beatError?.message || "stage lease expired"));
          console.error(`[DESIGNPRO-OS] heartbeat lost ${stage.id}; aborting current work: ${beatError?.message || "lease expired"}`);
        }
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      await stageLeaseContext.run(stageGuard, async () => {
        if (run.workflow_type === "designpro.entice_pack") await executeEntice(supabase, baseUrl, workerSecret, supabaseUrl, stage, run, { supabaseUrl, serviceRoleKey, spoolDir, tusEndpoint });
        else if (run.workflow_type === "designpro.production_pack") await executeProduction(supabase, stage, run, { supabaseUrl, serviceRoleKey, spoolDir, tusEndpoint });
        else throw new StageError("unsupported_workflow", run.workflow_type, false);
        assertStageLeaseActive();
      });
    } catch (error) {
      console.error(`[DESIGNPRO-OS] ${stage?.stage_key || "claim"} failed: ${error.message}`);
      if (stage?.id && stage?.lease_token && error.stageHandled !== true) {
        await supabase.rpc("fail_designpro_stage", { p_stage_id: stage.id, p_lease_token: stage.lease_token, p_error_code: error.code || "stage_execution_failed", p_error_message: String(error.message || error).slice(0, 2000), p_retryable: error.retryable !== false });
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (stageGuard && !stageGuard.controller.signal.aborted) stageGuard.controller.abort(new Error("stage work ended"));
      if (activeStageGuard === stageGuard) activeStageGuard = null;
      busy = false;
    }
  }

  app.get("/designpro-os/claimant", (_req, res) => res.json({ ready: true, contract: CLAIMANT_CONTRACT, workerId: id, stages: STAGES }));
  timer = setInterval(() => void tick(), 1_000);
  timer.unref?.();
  void tick();
  return {
    tick,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      if (activeStageGuard && !activeStageGuard.controller.signal.aborted) activeStageGuard.controller.abort(new Error("claimant stopped because runtime readiness was lost"));
    },
  };
}

module.exports = { registerDesignProStandaloneClaimant, CLAIMANT_CONTRACT, STAGES, RECEIPTS, ARTIFACT_KINDS, CALLS_1_7_ADAPTER: Object.freeze({ engineContract: CALLS_1_7_ENGINE_CONTRACT, viewPlan: CALLS_1_7_VIEW_PLAN, handoffBlocker: CALLS_1_7_HANDOFF_BLOCKER, claim: claimCalls1To7Generation, heartbeat: heartbeatCalls1To7Generation, complete: completeCalls1To7Generation, fail: failCalls1To7Generation }), _test: { tenantKey, exactSevenViews, call8ProofRequest, ensureAutomaticProduction, reconcileAutomaticProduction, sourceViewZipEntries, bufferZipEntry, copyPinnedSourceArtifact, canonicalDesignId, immutableBusinessIdentity, stampSvg, round2, generationInputHasServerControls, assertCalls1To7Claim, normalizeCalls1To7Views } };
