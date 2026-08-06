"use strict";

/**
 * Standalone DesignProAI OS claimant.
 *
 * This is the only queue conductor.  Browser code may enqueue work and approve
 * the two explicit human gates, but it cannot execute or complete a stage.
 * Every durable completion is fenced by the database lease and contains
 * byte-hashed evidence persisted in designpro_artifacts.
 */
const { createHash, randomUUID } = require("node:crypto");
const { Readable } = require("node:stream");
const archiver = require("archiver");
const sharp = require("sharp");

const CLAIM_SECONDS = 900;
const HEARTBEAT_MS = 30_000;
const BUCKET = "wrap-files";
const HASH_RE = /^[0-9a-f]{64}$/;
const STAGES = Object.freeze([
  "revision.freeze", "manifest.resolve", "proof.build", "panels.build",
  "logos.extract", "pack.verify", "pack.activate", "source.verify",
  "await_panelpro_preflight_qc", "output.build", "output.verify",
  "await_final_human_qc", "stamp.build", "zip.build", "wrapbox.deliver",
]);
const RECEIPTS = Object.freeze([
  "views.seven-source", "call8.flat-proof", "call9.surface-panels", "call10.logo-inventory",
  "output.verified", "stamp", "zip", "wrapbox.delivery",
]);
const ARTIFACT_KINDS = Object.freeze([
  "flat-proof", "panel", "logo", "output", "stamp", "zip", "wrapbox-manifest",
]);

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

const REQUIRED_REVISION_VIEWS = Object.freeze({
  driver: ["driver", "driver_side", "driver-side", "side"],
  passenger: ["passenger", "passenger_side", "passenger-side", "opposite_side"],
  hood: ["hood", "hood_detail"],
  roof: ["roof", "top"],
  front: ["front"],
  rear: ["rear", "back"],
  hero3d: ["hero3d", "hero_3d", "hero", "angle", "three_quarter"],
});

function exactSevenViews(snapshot) {
  const urls = requiredObject(snapshot?.renderUrls, "revision snapshot renderUrls");
  const normalized = Object.fromEntries(Object.entries(urls).map(([key, value]) => [String(key).toLowerCase(), value]));
  const resolved = {};
  for (const [role, aliases] of Object.entries(REQUIRED_REVISION_VIEWS)) {
    const key = aliases.find((candidate) => typeof normalized[candidate] === "string" && normalized[candidate].trim());
    if (!key) throw new StageError("seven_views_incomplete", `Required ${role} view is missing`, false);
    resolved[role] = normalized[key].trim();
  }
  if (new Set(Object.values(resolved)).size !== 7) throw new StageError("seven_views_not_distinct", "All seven required views must be distinct source assets", false);
  return resolved;
}

function uuidFromHash(hash) {
  const text = hash.slice(0, 32).split("");
  text[12] = "5"; text[16] = ["8", "9", "a", "b"][parseInt(text[16], 16) % 4];
  const value = text.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function round2(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }

async function fingerprintSevenViews(views, supabaseUrl) {
  const allowedHost = new URL(supabaseUrl).hostname;
  const identities = [];
  for (const [viewKey, rawUrl] of Object.entries(views)) {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.hostname !== allowedHost || url.username || url.password) throw new StageError("view_origin_rejected", `${viewKey} is outside standalone storage`, false);
    const response = await fetch(url, { redirect: "error" });
    if (!response.ok) throw new StageError("view_fingerprint_failed", `${viewKey}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 512 * 1024 * 1024) throw new StageError("view_bytes_invalid", viewKey, false);
    identities.push({ viewKey, contentHash: hashBytes(bytes) });
  }
  if (identities.length !== 7 || new Set(identities.map((item) => item.contentHash)).size !== 7) throw new StageError("seven_view_identity_reuse", "Seven unique view byte identities are required", false);
  return identities;
}

function call8ProofRequest(run, manifest) {
  const surfaces = manifest.expectedSurfaces || [];
  if (surfaces.length !== 6) throw new StageError("call8_surface_set_invalid", "Exactly six production surfaces are required", false);
  const cellW = 760; const cellH = 360; const margin = 60; const labelH = 70;
  const tiles = surfaces.map((surface, index) => {
    const printW = Number(surface.widthInches) + 10; const printH = Number(surface.heightInches) + 10;
    const scale = Math.min(cellW / printW, (cellH - labelH) / printH);
    const w = Math.max(1, Math.round(printW * scale)); const h = Math.max(1, Math.round(printH * scale));
    const column = index % 2; const row = Math.floor(index / 2);
    return { key: surface.surfaceKey, url: surface.sourceView, x: margin + column * cellW + Math.floor((cellW - w) / 2), y: margin + row * cellH + labelH, w, h, trimWidthIn: surface.widthInches, trimHeightIn: surface.heightInches, bleedIn: 5, masterPath: `proof-tiles/${run.tenant_key}/${run.id}/masters/${surface.surfaceKey}.png` };
  });
  const totalSqFt = round2(surfaces.reduce((total, item) => total + Number(item.widthInches) * Number(item.heightInches) / 144, 0));
  if (Number(manifest.totalSqFt) !== totalSqFt) throw new StageError("genie_total_square_feet_mismatch", "GENIE total square footage does not match raw per-surface dimensions", false);
  const labels = surfaces.map((surface, index) => { const column = index % 2; const row = Math.floor(index / 2); const x = margin + column * cellW + cellW / 2; const y = margin + row * cellH + 34; return `<text x="${x}" y="${y}" text-anchor="middle" font-family="Arial" font-size="24" fill="#111827">${surface.surfaceKey.toUpperCase()} · ${surface.widthInches}×${surface.heightInches} trim · 5in bleed · ${surface.surfaceSqFt} sq ft</text>`; }).join("");
  const canvas = { w: margin * 2 + cellW * 2, h: margin * 2 + cellH * 3 + 80 };
  const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.w}" height="${canvas.h}">${labels}<text x="${canvas.w / 2}" y="${canvas.h - 28}" text-anchor="middle" font-family="Arial" font-size="30" font-weight="700" fill="#059669">GENIE TOTAL: ${totalSqFt.toFixed(2)} SQ FT · 5 IN BLEED EACH EDGE</text></svg>`;
  return { request: { canvas, tiles, overlaySvg }, totalSqFt };
}

async function resolveGenieManifest(sb, run) {
  const { data: source, error: sourceError } = await sb.from("designpro_revision_sources").select("snapshot,snapshot_hash").eq("revision_id", run.revision_id).maybeSingle();
  if (sourceError || !source || source.snapshot_hash !== run.revision_snapshot_hash) throw new StageError("revision_source_drift", "Immutable revision source is missing or changed", false);
  const views = exactSevenViews(source.snapshot);
  const vehicle = requiredObject(source.snapshot.vehicle, "revision vehicle");
  const make = requiredString(vehicle.make, "vehicle make"); const model = requiredString(vehicle.model, "vehicle model"); const year = Number(vehicle.year);
  let query = sb.from("designpro_vehicle_dimensions").select("*").ilike("make", make).ilike("model", model);
  if (Number.isInteger(year)) query = query.or(`year_start.is.null,year_start.lte.${year}`).or(`year_end.is.null,year_end.gte.${year}`);
  const { data: rows, error } = await query.order("year_start", { ascending: false, nullsFirst: false }).limit(2);
  if (error) throw new StageError("genie_dimension_lookup_failed", error.message);
  if (!rows || rows.length !== 1) throw new StageError("genie_dimensions_not_exact", `GENIE requires one exact grounded dimension record for ${year || "?"} ${make} ${model}`, false);
  const row = rows[0];
  const dim = (width, height, surfaceKey, sourceView) => {
    const widthInches = Number(width); const heightInches = Number(height);
    if (!(widthInches > 0 && heightInches > 0)) throw new StageError("genie_surface_dimensions_missing", `GENIE dimensions missing for ${surfaceKey}`, false);
    return { surfaceKey, sourceView, widthInches, heightInches, surfaceSqFt: round2(widthInches * heightInches / 144), bleed: { top: 5, right: 5, bottom: 5, left: 5 } };
  };
  const expectedSurfaces = [
    dim(row.side_width, row.side_height, "driver", views.driver),
    dim(row.side_width, row.side_height, "passenger", views.passenger),
    dim(row.hood_width, row.hood_length, "hood", views.hood),
    dim(row.roof_width, row.roof_length, "roof", views.roof),
    dim(row.back_width, row.back_height, "front", views.front),
    dim(row.back_width, row.back_height, "rear", views.rear),
  ];
  const dimensionBasis = { recordId: row.id, make: row.make, model: row.model, year, expectedSurfaces: expectedSurfaces.map(({ sourceView, ...item }) => item) };
  const dimensionBasisHash = hashJson(dimensionBasis);
  const totalSqFt = round2(expectedSurfaces.reduce((total, item) => total + (item.widthInches * item.heightInches / 144), 0));
  const manifest = { contract: "designpro.genie-dimension-manifest.v1", genieVerified: true, sevenViewsVerified: true, requiredViewCount: 7, dimensionsAuthority: "genie-universal-panelizer", bleedInches: 5, totalSqFt, squareFootRounding: "nearest-0.01-after-raw-sum", dimensionBasisHash, expectedSurfaces };
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
  const text = requiredString(value, label).replace(/^\/+/, "");
  if (text.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(text)) {
    throw new StageError("unsafe_storage_path", `${label} is not a safe storage path`, false);
  }
  return text;
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
  const path = safePath(storagePath, "storagePath");
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const { error } = await sb.storage.from(BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) throw new StageError("artifact_upload_failed", `Unable to upload ${path}: ${error.message}`);
  return { storagePath: path, bytes: body.length, hash: hashBytes(body) };
}

async function exactStoredArtifact(sb, candidate, expectedKind) {
  const item = requiredObject(candidate, `${expectedKind} artifact`);
  const bytes = await storageBytes(sb, item.storagePath);
  const observed = hashBytes(bytes);
  const expected = String(item.contentHash || observed).toLowerCase();
  if (!HASH_RE.test(expected) || observed !== expected) {
    throw new StageError("artifact_hash_mismatch", `${item.storagePath} changed`, false);
  }
  return artifact(expectedKind, item.storagePath, observed, bytes.length, String(item.surfaceKey || ""), item.metadata || {});
}

async function callTool(baseUrl, secret, route, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14 * 60_000);
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
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

async function executeEntice(sb, baseUrl, secret, supabaseUrl, stage, run) {
  const input = requiredObject(run.input, "workflow input");
  if (stage.stage_key === "revision.freeze") {
    const { data, error } = await sb.from("designpro_revision_sources").select("snapshot,snapshot_hash").eq("revision_id", run.revision_id).maybeSingle();
    if (error || !data || data.snapshot_hash !== run.revision_snapshot_hash) throw new StageError("revision_source_drift", "Immutable revision source does not match workflow", false);
    const views = exactSevenViews(data.snapshot);
    const viewIdentities = await fingerprintSevenViews(views, supabaseUrl);
    return complete(sb, stage, run, { verified: true, receiptKind: "views.seven-source", revisionSnapshotHash: data.snapshot_hash, requiredViewCount: 7, viewReceipts: viewIdentities, distinctViewsVerified: true });
  }
  if (stage.stage_key === "manifest.resolve") {
    const resolved = await resolveGenieManifest(sb, run);
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
    const spec = call8ProofRequest(rebound, manifest);
    const result = await callTool(baseUrl, secret, "/compose-proof-sheet", spec.request);
    const bytes = Buffer.from(requiredString(result.pngBase64, "Call 7 bytes"), "base64");
    if (!bytes.length || !Array.isArray(result.surfaceMasters) || result.surfaceMasters.length < 2) throw new StageError("call7_result_invalid", "Call 7 returned no frozen surface masters", false);
    const storagePath = `designpro/${run.tenant_key}/${run.id}/call8-flat-2d-proof.png`;
    const stored = await upload(sb, storagePath, bytes, "image/png");
    const proofArtifact = artifact("flat-proof", stored.storagePath, stored.hash, stored.bytes, "", { surfaceMasters: result.surfaceMasters, width: result.width, height: result.height });
    return complete(sb, stage, await getRun(sb, run.id), {
      verified: true, receiptKind: "call8.flat-proof", call: 8, proofKind: "flattened-2d-proof",
      dimensionsAuthority: "genie-universal-panelizer", bleedInches: 5,
      sourceProofHash: stored.hash, storagePath: stored.storagePath, totalSqFt: manifest.totalSqFt,
      dimensionManifestId: rebound.dimension_manifest_id, manifestHash: rebound.manifest_hash,
      perSurfaceDimensions: manifest.expectedSurfaces.map(({ sourceView, ...surface }) => surface),
      viewLineage: (await stageOutput(sb, run.id, "revision.freeze")).viewReceipts, surfaceMasters: result.surfaceMasters,
    }, null, [proofArtifact]);
  }
  if (stage.stage_key === "panels.build") {
    const proof = await stageOutput(sb, run.id, "proof.build");
    const manifest = requiredObject(run.results?.dimensionManifest, "bound GENIE dimension manifest");
    const expected = new Map((manifest.expectedSurfaces || []).map((item) => [String(item.surfaceKey), item]));
    const masters = Array.isArray(proof.surfaceMasters) ? proof.surfaceMasters : [];
    if (masters.length < 2) throw new StageError("call8_sources_missing", "Call 7 surface masters are missing", false);
    const seen = new Set();
    const produced = [];
    for (const master of masters) {
      const key = requiredString(master.key, "surface key");
      if (seen.has(key)) throw new StageError("call8_duplicate_surface", key, false);
      seen.add(key);
      const dims = expected.get(key);
      if (!dims || !Object.values(dims.bleed || {}).every((value) => Number(value) === 5)) throw new StageError("call8_genie_identity_missing", key, false);
      const expectedWidth = Math.round((Number(dims.widthInches) + 10) * 10);
      const expectedHeight = Math.round((Number(dims.heightInches) + 10) * 10);
      if (Number(master.pixelWidth) !== expectedWidth || Number(master.pixelHeight) !== expectedHeight) throw new StageError("call8_geometry_drift", `${key} is not exact GENIE trim plus 5-inch bleed`, false);
      const exact = await exactStoredArtifact(sb, { storagePath: master.masterPath, contentHash: master.sha256, surfaceKey: key, metadata: { sourceRegionHash: master.regionSha256, call: 9, sourceRule: "own-call8-proof-region", trimWidthInches: dims.widthInches, trimHeightInches: dims.heightInches, bleed: { top: 5, right: 5, bottom: 5, left: 5 }, surfaceSqFt: dims.surfaceSqFt } }, "panel");
      produced.push(exact);
    }
    const panelHashes = Object.fromEntries(produced.map((item) => [item.surfaceKey, item.contentHash]));
    const sourceRegionHashes = Object.fromEntries(masters.map((item) => [item.key, item.regionSha256]));
    if (new Set(Object.values(sourceRegionHashes)).size !== masters.length) throw new StageError("call9_region_reuse", "Every panel must originate from a distinct proof region", false);
    if (sourceRegionHashes.driver === sourceRegionHashes.passenger) throw new StageError("call9_driver_passenger_reuse", "Driver artwork cannot be reused for passenger", false);
    const trimDimensions = Object.fromEntries(manifest.expectedSurfaces.map((item) => [item.surfaceKey, { widthInches: item.widthInches, heightInches: item.heightInches, surfaceSqFt: item.surfaceSqFt }]));
    return complete(sb, stage, run, { verified: true, receiptKind: "call9.surface-panels", call: 9, sourceRule: "one-own-surface-region-per-output-side", sides: [...seen], panelHashes, sourceRegionHashes, dimensionsAuthority: "genie-universal-panelizer", bleedInches: 5, dimensionManifestId: run.dimension_manifest_id, manifestHash: run.manifest_hash, totalSqFt: manifest.totalSqFt, trimDimensions }, null, produced);
  }
  if (stage.stage_key === "logos.extract") {
    const { data: revisionSource, error: revisionError } = await sb.from("designpro_revision_sources").select("snapshot,snapshot_hash").eq("revision_id", run.revision_id).maybeSingle();
    if (revisionError || !revisionSource || revisionSource.snapshot_hash !== run.revision_snapshot_hash) throw new StageError("call10_revision_source_drift", "Immutable logo inventory source changed", false);
    if (!Array.isArray(revisionSource.snapshot?.expectedLogoInventory)) throw new StageError("call10_inventory_not_frozen", "Revision snapshot must freeze expectedLogoInventory (an explicit empty array is valid)", false);
    const expected = revisionSource.snapshot.expectedLogoInventory;
    const call9 = await stageOutput(sb, run.id, "panels.build");
    const regionHashes = call9.sourceRegionHashes || {};
    const produced = [];
    for (let index = 0; index < expected.length; index++) {
      const identityKey = requiredString(expected[index]?.identityKey, `expectedInventory[${index}].identityKey`);
      const sourceSurfaceKey = requiredString(expected[index]?.surfaceKey, `${identityKey}.surfaceKey`);
      const sourceRegionHash = requiredString(regionHashes[sourceSurfaceKey], `${identityKey} verified source region`).toLowerCase();
      produced.push(await exactStoredArtifact(sb, { storagePath: expected[index].storagePath, contentHash: expected[index].contentHash, surfaceKey: identityKey, metadata: { identityKey, sourceRegionHash, separationContract: "designpro.deterministic-stored-overlay.v1" } }, "logo"));
    }
    const inventory = expected.map((item, index) => ({ identityKey: item.identityKey, contentHash: produced[index]?.contentHash || null }));
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
    return complete(sb, stage, run, { verified: true, active: true, activatedAt: new Date().toISOString() });
  }
  throw new StageError("unsupported_entice_stage", stage.stage_key, false);
}

function epsWithRaster(rgb, width, height) {
  const hex = rgb.toString("hex");
  const header = `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${width} ${height}\n%%LanguageLevel: 2\n%%DesignProAI-Raster-SHA256: ${hashBytes(rgb)}\ngsave\n${width} ${height} scale\n/picstr ${width * 3} string def\n${width} ${height} 8\n[${width} 0 0 -${height} 0 ${height}]\n{currentfile picstr readhexstring pop}\nfalse 3 colorimage\n`;
  return Buffer.from(`${header}${hex}\ngrestore\nshowpage\n%%EOF\n`);
}

async function buildPrintOutputs(sb, run, input) {
  const sourceRunId = requiredString(run.results?.sourceEnticeRunId || input.sourceEnticeRunId, "sourceEnticeRunId");
  const panels = await artifacts(sb, sourceRunId, ["panel"]);
  if (panels.length < 2) throw new StageError("source_panels_missing", "No verified source panel set", false);
  const dimensionManifest = requiredObject(input.dimensionManifest, "production dimensionManifest");
  const dimensions = new Map((dimensionManifest.expectedSurfaces || []).map((item) => [String(item.surfaceKey), item]));
  const produced = [];
  for (const panel of panels) {
    const dims = dimensions.get(String(panel.surface_key));
    if (!dims || !Object.values(dims.bleed || {}).every((value) => Number(value) === 5)) throw new StageError("output_dimensions_missing", `GENIE dimensions missing for ${panel.surface_key}`, false);
    const source = await storageBytes(sb, panel.storage_path);
    if (hashBytes(source) !== panel.content_hash) throw new StageError("source_panel_changed", panel.surface_key, false);
    const width = Math.round((Number(dims.widthInches) + 10) * 150);
    const height = Math.round((Number(dims.heightInches) + 10) * 150);
    if (!(width > 0 && height > 0 && width * height <= 400_000_000)) throw new StageError("output_geometry_invalid", panel.surface_key, false);
    let contained = await sharp(source, { limitInputPixels: false }).resize(width, height, { fit: "inside", kernel: "lanczos3" }).flatten().png().toBuffer();
    const containedMeta = await sharp(contained).metadata();
    const left = Math.floor((width - containedMeta.width) / 2); const right = width - containedMeta.width - left;
    const top = Math.floor((height - containedMeta.height) / 2); const bottom = height - containedMeta.height - top;
    if (left || right || top || bottom) contained = await sharp(contained).extend({ left, right, top, bottom, extendWith: "mirror" }).png().toBuffer();
    const raster = await sharp(contained).png({ compressionLevel: 6 }).withMetadata({ density: 1500 }).toBuffer();
    const slug = String(panel.surface_key).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const base = `designpro/${run.tenant_key}/${run.id}/outputs/${slug}`;
    const png = await upload(sb, `${base}.png`, raster, "image/png");
    produced.push(artifact("output", png.storagePath, png.hash, png.bytes, panel.surface_key, { format: "png", dpi: 1500, outputScale: 0.1, bleedInches: 5, width, height }));
    const tiffBytes = await sharp(contained).tiff({ compression: "lzw", predictor: "horizontal", bitdepth: 8 }).withMetadata({ density: 1500 }).toBuffer();
    const tiff = await upload(sb, `${base}.tiff`, tiffBytes, "image/tiff");
    produced.push(artifact("output", tiff.storagePath, tiff.hash, tiff.bytes, panel.surface_key, { format: "tiff", dpi: 1500, outputScale: 0.1, bleedInches: 5, width, height }));
    const { data: rgb, info } = await sharp(contained).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== width || info.height !== height || info.channels !== 3) throw new StageError("eps_raster_geometry_invalid", panel.surface_key, false);
    const epsBytes = epsWithRaster(rgb, width, height);
    const eps = await upload(sb, `${base}.eps`, epsBytes, "application/postscript");
    produced.push(artifact("output", eps.storagePath, eps.hash, eps.bytes, panel.surface_key, { format: "eps", rasterSha256: png.hash, dpi: 1500, outputScale: 0.1, bleedInches: 5, width, height }));
  }
  return produced;
}

function stampSvg(verifiedBy, approvalRef, date) {
  const escape = (text) => String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720"><circle cx="360" cy="360" r="340" fill="white" stroke="#059669" stroke-width="24"/><circle cx="360" cy="360" r="305" fill="none" stroke="#10b981" stroke-width="8"/><text x="360" y="185" text-anchor="middle" font-family="Arial" font-size="42" font-weight="700" fill="#059669">DESIGNPROAI · QUALITY CONTROL</text><text x="360" y="305" text-anchor="middle" font-family="Arial" font-size="58" font-weight="700" fill="#065f46">QUALITY</text><text x="360" y="390" text-anchor="middle" font-family="Arial" font-size="76" font-weight="700" fill="#059669">APPROVED</text><text x="360" y="470" text-anchor="middle" font-family="Arial" font-size="34" font-weight="700" fill="#065f46">Quality Checked by ${escape(verifiedBy).slice(0, 120)}</text><text x="360" y="525" text-anchor="middle" font-family="Arial" font-size="25" fill="#065f46">${escape(approvalRef).slice(0, 150)}</text><text x="360" y="575" text-anchor="middle" font-family="Arial" font-size="28" fill="#6b7280">${escape(date)}</text></svg>`);
}

async function zipArtifacts(sb, rows) {
  const archive = archiver("zip", { store: true });
  const chunks = [];
  archive.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const done = new Promise((resolve, reject) => { archive.once("end", resolve); archive.once("error", reject); });
  const names = new Set();
  for (const row of rows) {
    const bytes = await storageBytes(sb, row.storage_path);
    if (hashBytes(bytes) !== row.content_hash) throw new StageError("zip_source_changed", row.storage_path, false);
    let name = String(row.storage_path).split("/").pop();
    if (!name || names.has(name)) name = `${String(row.surface_key || row.artifact_kind).replace(/[^A-Za-z0-9_-]/g, "-")}-${row.content_hash.slice(0, 10)}-${name || "file"}`;
    names.add(name);
    archive.append(Readable.from(bytes), { name, store: true });
  }
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

async function executeProduction(sb, stage, run) {
  const input = requiredObject(run.input, "workflow input");
  const sourceRunId = requiredString(run.results?.sourceEnticeRunId || input.sourceEnticeRunId, "sourceEnticeRunId");
  if (stage.stage_key === "source.verify") {
    const call9 = await receipt(sb, sourceRunId, "call9.surface-panels");
    const call10 = await receipt(sb, sourceRunId, "call10.logo-inventory");
    return complete(sb, stage, run, { verified: true, call9: { receiptKind: "call9.surface-panels", receiptHash: call9.receipt_hash }, call10: { receiptKind: "call10.logo-inventory", receiptHash: call10.receipt_hash } });
  }
  if (stage.stage_key === "await_panelpro_preflight_qc" || stage.stage_key === "await_final_human_qc") {
    const { error } = await sb.rpc("request_designpro_human_gate", { p_run_id: run.id, p_stage_key: stage.stage_key, p_details: { requestedBy: "designpro-standalone-claimant", requestedAt: new Date().toISOString() } });
    if (error) throw new StageError("human_gate_request_failed", error.message, false);
    return;
  }
  if (stage.stage_key === "output.build") {
    const produced = await buildPrintOutputs(sb, run, input);
    return complete(sb, stage, run, { verified: true, outputCount: produced.length, outputSetHash: hashJson(produced.map((item) => ({ path: item.storagePath, hash: item.contentHash }))) }, null, produced);
  }
  if (stage.stage_key === "output.verify") {
    const rows = await artifacts(sb, run.id, ["output"]);
    if (!rows.length) throw new StageError("outputs_missing", "No output artifacts exist", false);
    const verified = [];
    for (const row of rows) verified.push(await exactStoredArtifact(sb, { storagePath: row.storage_path, contentHash: row.content_hash, surfaceKey: row.surface_key, metadata: row.metadata }, "output"));
    return complete(sb, stage, run, { verified: true, receiptKind: "output.verified", outputHashes: verified.map((item) => item.contentHash), outputSetHash: hashJson(verified.map((item) => ({ path: item.storagePath, hash: item.contentHash }))) }, null, verified);
  }
  if (stage.stage_key === "stamp.build") {
    const finalQc = await receipt(sb, run.id, "final.human-qc");
    const verifiedBy = requiredString(finalQc.receipt?.verifiedBy, "final QC verifiedBy");
    const approvalRef = requiredString(finalQc.receipt?.approvalRef, "final QC approvalRef");
    const svg = stampSvg(verifiedBy, approvalRef, new Date().toISOString().slice(0, 10));
    const png = await sharp(svg).png().toBuffer();
    const stored = await upload(sb, `designpro/${run.tenant_key}/${run.id}/qc-approval-stamp.png`, png, "image/png");
    const stamp = artifact("stamp", stored.storagePath, stored.hash, stored.bytes, "", { verifiedBy, approvalRef, source: "server-svg-port-of-frozen-canvas-stamp" });
    return complete(sb, stage, run, { verified: true, receiptKind: "stamp", verifiedBy, approvalRef, stampedAt: new Date().toISOString() }, stored.hash, [stamp]);
  }
  if (stage.stage_key === "zip.build") {
    await receipt(sb, run.id, "stamp");
    const rows = await artifacts(sb, run.id, ["output", "stamp"]);
    if (!rows.some((item) => item.artifact_kind === "output") || !rows.some((item) => item.artifact_kind === "stamp")) throw new StageError("zip_artifacts_incomplete", "Verified output and stamp are required", false);
    const bytes = await zipArtifacts(sb, rows);
    const stored = await upload(sb, `designpro/${run.tenant_key}/${run.id}/production-pack.zip`, bytes, "application/zip");
    const zip = artifact("zip", stored.storagePath, stored.hash, stored.bytes, "", { entries: rows.length, compression: "store" });
    return complete(sb, stage, run, { verified: true, receiptKind: "zip", zipHash: stored.hash, entryCount: rows.length }, stored.hash, [zip]);
  }
  if (stage.stage_key === "wrapbox.deliver") {
    const zipReceipt = await receipt(sb, run.id, "zip");
    const zipRows = await artifacts(sb, run.id, ["zip"]);
    const zipRow = zipRows.find((row) => row.content_hash === zipReceipt.receipt_hash);
    if (!zipRow) throw new StageError("delivery_zip_missing", "Exact verified ZIP is missing", false);
    const zipBytes = await storageBytes(sb, zipRow.storage_path);
    if (hashBytes(zipBytes) !== zipReceipt.receipt_hash) throw new StageError("delivery_zip_changed", "Verified ZIP changed before delivery", false);
    const target = `wrapbox/${run.tenant_key}/${run.entice_pack_id}/${run.id}/production-pack.zip`;
    const deliveredZip = await upload(sb, target, zipBytes, "application/zip");
    const manifest = { contract: "designpro.wrapbox-manifest.v1", workflowRunId: run.id, ownerId: run.owner_id, tenantKey: run.tenant_key, enticePackId: run.entice_pack_id, revisionId: run.revision_id, zip: { storagePath: deliveredZip.storagePath, contentHash: deliveredZip.hash, byteSize: deliveredZip.bytes }, deliveredAt: new Date().toISOString() };
    const manifestBytes = Buffer.from(JSON.stringify(canonical(manifest)));
    const stored = await upload(sb, `wrapbox/${run.tenant_key}/${run.entice_pack_id}/${run.id}/manifest.json`, manifestBytes, "application/json");
    const manifestArtifact = artifact("wrapbox-manifest", stored.storagePath, stored.hash, stored.bytes, "", { zipHash: deliveredZip.hash });
    return complete(sb, stage, run, { verified: true, receiptKind: "wrapbox.delivery", zipHash: zipReceipt.receipt_hash, manifestPath: stored.storagePath, deliveredZipPath: deliveredZip.storagePath, deliveredAt: manifest.deliveredAt }, stored.hash, [manifestArtifact]);
  }
  throw new StageError("unsupported_production_stage", stage.stage_key, false);
}

function registerDesignProStandaloneClaimant({ app, supabase, supabaseUrl, workerSecret, workerId, port }) {
  const id = requiredString(workerId, "workerId");
  const baseUrl = `http://127.0.0.1:${Number(port || 3001)}`;
  let busy = false;
  let timer = null;

  async function tick() {
    if (busy) return;
    busy = true;
    let stage = null;
    let heartbeat = null;
    try {
      const { data, error } = await supabase.rpc("claim_designpro_stage", { p_worker: id, p_lease_seconds: CLAIM_SECONDS });
      if (error) throw error;
      stage = Array.isArray(data) ? data[0] : data;
      if (!stage) return;
      const run = await getRun(supabase, stage.run_id);
      heartbeat = setInterval(async () => {
        const { data: current, error: beatError } = await supabase.rpc("heartbeat_designpro_stage", { p_stage_id: stage.id, p_lease_token: stage.lease_token, p_lease_seconds: CLAIM_SECONDS });
        if (beatError || current !== true) console.error(`[DESIGNPRO-OS] heartbeat lost ${stage.id}: ${beatError?.message || "lease expired"}`);
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      if (run.workflow_type === "designpro.entice_pack") await executeEntice(supabase, baseUrl, workerSecret, supabaseUrl, stage, run);
      else if (run.workflow_type === "designpro.production_pack") await executeProduction(supabase, stage, run);
      else throw new StageError("unsupported_workflow", run.workflow_type, false);
    } catch (error) {
      console.error(`[DESIGNPRO-OS] ${stage?.stage_key || "claim"} failed: ${error.message}`);
      if (stage?.id && stage?.lease_token) {
        await supabase.rpc("fail_designpro_stage", { p_stage_id: stage.id, p_lease_token: stage.lease_token, p_error_code: error.code || "stage_execution_failed", p_error_message: String(error.message || error).slice(0, 2000), p_retryable: error.retryable !== false });
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      busy = false;
    }
  }

  app.get("/designpro-os/claimant", (_req, res) => res.json({ ready: true, workerId: id, stages: STAGES }));
  timer = setInterval(() => void tick(), 1_000);
  timer.unref?.();
  void tick();
  return { tick, stop: () => clearInterval(timer) };
}

module.exports = { registerDesignProStandaloneClaimant, STAGES, RECEIPTS, ARTIFACT_KINDS, _test: { exactSevenViews, call8ProofRequest, round2 } };
