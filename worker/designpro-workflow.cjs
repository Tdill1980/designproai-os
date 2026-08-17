var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// pr2/designpro-file-output-api.index.ts
var designpro_file_output_api_index_exports = {};
__export(designpro_file_output_api_index_exports, {
  registerDesignProWorkflow: () => registerDesignProWorkflow
});
module.exports = __toCommonJS(designpro_file_output_api_index_exports);
var import_node_async_hooks = require("node:async_hooks");
var import_node_crypto = require("node:crypto");
var SUPABASE_URL = "";
var SERVICE_KEY = "";
var SITE_URL = "https://www.restyleproai.com";
var CLAIM_CONTEXT = new import_node_async_hooks.AsyncLocalStorage();
var MASTER_SHEET_VERSION = 6;
var STANDARD_SIDES = [
  "DRIVER SIDE",
  "PASSENGER SIDE",
  "HOOD",
  "ROOF",
  "FRONT",
  "REAR"
];
var TRAILER_SIDES = [
  "DRIVER SIDE",
  "PASSENGER SIDE",
  "FRONT",
  "REAR"
];
var VIEW_KEYS = {
  "DRIVER SIDE": ["side", "driver-side", "driver_side", "driver"],
  "PASSENGER SIDE": [
    "passenger",
    "passenger-side",
    "passenger_side",
    "opposite_side"
  ],
  HOOD: ["hood_detail", "hood"],
  ROOF: ["roof", "top"],
  FRONT: ["front"],
  REAR: ["rear", "back"]
};
var StageFailure = class extends Error {
  code;
  retryable;
  retryDelaySeconds;
  details;
  constructor(code, message, retryable = true, retryDelaySeconds = 15, details = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.retryDelaySeconds = retryDelaySeconds;
    this.details = details;
  }
};
var StageDeferred = class extends Error {
  delaySeconds;
  details;
  constructor(message, delaySeconds = 20, details = {}) {
    super(message);
    this.delaySeconds = delaySeconds;
    this.details = details;
  }
};
function parseNotes(raw) {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw || {};
  } catch {
    return {};
  }
}
function objectOfStrings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.trim()) result[key] = item.trim();
  }
  return result;
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== void 0).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}
async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}
function approvedProductionAssetUrl(raw) {
  try {
    const parsed = new URL(String(raw || ""));
    const configuredHosts = String(
      process.env.DESIGNPRO_PRODUCTION_ASSET_HOSTS || ""
    ).split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
    const runtimeHosts = [SUPABASE_URL, SITE_URL].flatMap((value) => {
      try {
        return [new URL(value).hostname.toLowerCase()];
      } catch {
        return [];
      }
    });
    const allowedHosts = /* @__PURE__ */ new Set([...runtimeHosts, ...configuredHosts]);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && allowedHosts.has(parsed.hostname.toLowerCase()) ? parsed.toString() : null;
  } catch {
    return null;
  }
}
async function fingerprintAsset(rawUrl) {
  const url = approvedProductionAssetUrl(rawUrl);
  if (!url) {
    throw new StageFailure(
      "source_fingerprint_origin_rejected",
      "A production source is outside the approved asset origins",
      false
    );
  }
  const request = combinedSignal(12e4);
  try {
    const response = await fetch(url, {
      signal: request.signal,
      redirect: "manual"
    });
    if (!response.ok || !response.body) {
      throw new StageFailure(
        "source_fingerprint_failed",
        `Unable to fingerprint a production source (HTTP ${response.status})`,
        response.status >= 500 || response.status === 408 || response.status === 429,
        20
      );
    }
    const hash = (0, import_node_crypto.createHash)("sha256");
    let bytes = 0;
    const maxBytes = Math.min(
      Math.max(
        Number(process.env.DESIGNPRO_FINGERPRINT_MAX_BYTES) || 512 * 1024 * 1024,
        1024 * 1024
      ),
      1024 * 1024 * 1024
    );
    const declaredBytes = Number(response.headers.get("content-length") || 0);
    if (declaredBytes > maxBytes) {
      throw new StageFailure(
        "source_fingerprint_too_large",
        "A production source exceeds the fingerprint byte limit",
        false
      );
    }
    const reader = response.body.getReader();
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      if (!chunk?.byteLength) continue;
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        await reader.cancel("fingerprint byte limit exceeded");
        throw new StageFailure(
          "source_fingerprint_too_large",
          "A production source exceeds the fingerprint byte limit",
          false
        );
      }
      hash.update(buffer);
    }
    if (bytes <= 0) {
      throw new StageFailure(
        "source_fingerprint_empty",
        "A production source resolved to an empty object",
        false
      );
    }
    return {
      sha256: hash.digest("hex"),
      bytes,
      contentType: String(response.headers.get("content-type") || "")
    };
  } catch (error) {
    if (error instanceof StageFailure) throw error;
    throw new StageFailure(
      "source_fingerprint_transport",
      String(error?.message || error),
      true,
      20
    );
  } finally {
    request.cancel();
  }
}
async function fingerprintMaterialAssets(assets) {
  const grouped = /* @__PURE__ */ new Map();
  const result = {};
  for (const [name, rawUrl] of Object.entries(assets).sort(
    ([a], [b]) => a.localeCompare(b)
  )) {
    const url = String(rawUrl || "").trim();
    if (!url) continue;
    const names = grouped.get(url) || [];
    names.push(name);
    grouped.set(url, names);
  }
  const queue = Array.from(grouped.entries());
  let cursor = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(3, queue.length) },
      async () => {
        while (cursor < queue.length) {
          const index = cursor++;
          const [url, names] = queue[index];
          const fingerprint = await fingerprintAsset(url);
          for (const name of names) result[name] = fingerprint;
        }
      }
    )
  );
  return result;
}
function combinedSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const claimSignal = CLAIM_CONTEXT.getStore()?.signal;
  return {
    signal: claimSignal ? AbortSignal.any([claimSignal, controller.signal]) : controller.signal,
    cancel: () => clearTimeout(timer)
  };
}
async function callFn(name, body, timeoutMs = 15e4) {
  const request = combinedSignal(timeoutMs);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        // Service authentication the fenced functions verify in-handler. The
        // droplet env's SERVICE_KEY is the LEGACY JWT service_role key, which
        // run-production-flow's own SUPABASE_SERVICE_ROLE_KEY no longer
        // matches — live, the first two stage-60 attempts ever (run 6366dddd,
        // 2026-08-11) died 401 "Authentication required" on advance_domain.
        // The entice runner's callFn has always sent this header; this one
        // predates it and was never brought in line.
        ...(process.env.WORKER_SECRET
          ? { "x-worker-secret": String(process.env.WORKER_SECRET).trim() }
          : {})
      },
      body: JSON.stringify(body),
      signal: request.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500 || data?.retryable === true;
      throw new StageFailure(
        `${name}_failed`,
        String(data?.error || `${name} returned HTTP ${response.status}`),
        retryable,
        response.status === 429 ? 30 : 15,
        { httpStatus: response.status, response: data }
      );
    }
    return data;
  } catch (error) {
    if (error instanceof StageFailure) throw error;
    const timedOut = error?.name === "AbortError";
    throw new StageFailure(
      timedOut ? `${name}_timeout` : `${name}_transport`,
      timedOut ? `${name} timed out after ${Math.round(timeoutMs / 1e3)} seconds` : `${name}: ${String(error?.message || error)}`,
      true,
      timedOut ? 30 : 15
    );
  } finally {
    request.cancel();
  }
}
async function assertClaimOwned() {
  const claim = CLAIM_CONTEXT.getStore();
  if (!claim) {
    throw new StageFailure(
      "claim_context_missing",
      "A side-effecting stage ran without a lease context",
      false
    );
  }
  const { data, error } = await claim.db.rpc("heartbeat_workflow_stage", {
    p_stage_id: claim.stageId,
    p_lease_token: claim.leaseToken,
    p_lease_seconds: 900
  });
  if (error || data !== true) {
    claim.controller.abort();
    throw new StageFailure(
      "workflow_lease_lost",
      error?.message || "Workflow lease ownership was lost",
      true,
      5
    );
  }
}
async function stageOutput(db, runId, stageKey, scopeKey = "") {
  const { data, error } = await db.from("workflow_stage_runs").select("status,output").eq("run_id", runId).eq("stage_key", stageKey).eq("scope_key", scopeKey).maybeSingle();
  if (error || data?.status !== "completed") {
    throw new StageFailure(
      "dependency_not_ready",
      `Required stage ${stageKey}${scopeKey ? `:${scopeKey}` : ""} is not complete`,
      true,
      10,
      { databaseError: error?.message || null }
    );
  }
  return data.output || {};
}
function dimensionsFromStamped(stamped) {
  if (!stamped) return {};
  const dims = {};
  const put = (side, w, h) => {
    const width = Number(w);
    const height = Number(h);
    if (width > 0 && height > 0) dims[side] = { w: width, h: height };
  };
  put("DRIVER SIDE", stamped.sideW, stamped.sideH);
  put("PASSENGER SIDE", stamped.sideW, stamped.sideH);
  put("HOOD", stamped.hoodW, stamped.hoodL);
  put("ROOF", stamped.roofW, stamped.roofL);
  put("FRONT", stamped.frontW, stamped.frontH);
  put("REAR", stamped.backW, stamped.backH);
  if (!dims.FRONT && dims.REAR) dims.FRONT = { ...dims.REAR };
  if (!dims.REAR && dims.FRONT) dims.REAR = { ...dims.FRONT };
  return dims;
}
async function dimensionsFromGenie(make, model, year, vehicleType, bodyText, surfaceOptions, expectedSides) {
  const isTrailer = vehicleType === "trailer";
  const data = await callFn("panelizer-step-validate", {
    vehicleMake: make,
    vehicleModel: model,
    vehicleYear: year,
    vehicleType,
    bodyText: [bodyText, model, vehicleType].filter(Boolean).join(" "),
    sideSize: surfaceOptions.sideSize || "medium",
    roofSize: surfaceOptions.roofSize || "none",
    addHood: expectedSides.includes("HOOD"),
    addRear: expectedSides.includes("REAR"),
    addFrontBumper: expectedSides.includes("FRONT"),
    addRearBumper: expectedSides.includes("REAR"),
    addRoof: expectedSides.includes("ROOF")
  });
  const dims = {};
  if (isTrailer) {
    const vehicle = data?.vehicle || data?.estimatedDimensions || {};
    const sideW = Number(vehicle.bodyLengthInches || vehicle.sideWidthInches);
    const sideH = Number(vehicle.bodyHeightInches || vehicle.sideHeightInches);
    const wallW = Number(vehicle.backWidthInches);
    const wallH = Number(vehicle.backHeightInches || vehicle.bodyHeightInches);
    if (sideW > 0 && sideH > 0) {
      dims["DRIVER SIDE"] = { w: sideW, h: sideH };
      dims["PASSENGER SIDE"] = { w: sideW, h: sideH };
    }
    if (wallW > 0 && wallH > 0) {
      dims.FRONT = { w: wallW, h: wallH };
      dims.REAR = { w: wallW, h: wallH };
    }
    return dims;
  }
  const panels = Array.isArray(data?.panels) ? data.panels : [];
  const find = (pattern) => panels.find(
    (panel) => pattern.test(
      `${panel?.panelKey || ""} ${panel?.label || ""}`.toLowerCase()
    )
  );
  const side = find(/driver|(^|[^a-z])side/);
  const hood = find(/hood/);
  const roof = find(/roof|top/);
  const rear = find(/rear|back/);
  const front = find(/front/);
  const put = (name, panel) => {
    const w = Number(panel?.widthInches);
    const h = Number(panel?.heightInches);
    if (w > 0 && h > 0) dims[name] = { w, h };
  };
  put("DRIVER SIDE", side);
  put("PASSENGER SIDE", side);
  put("HOOD", hood);
  put("ROOF", roof);
  put("FRONT", front);
  put("REAR", rear);
  if (!dims.FRONT && dims.REAR) dims.FRONT = { ...dims.REAR };
  if (!dims.REAR && dims.FRONT) dims.REAR = { ...dims.FRONT };
  return dims;
}
function normalizeExpectedSides(value, isTrailer, concept) {
  const supported = new Set(
    isTrailer ? TRAILER_SIDES : STANDARD_SIDES
  );
  if (Array.isArray(value)) {
    const normalized = value.map(
      (side) => String(side || "").trim().toUpperCase()
    );
    if (normalized.length >= 2 && new Set(normalized).size === normalized.length && normalized.every((side) => supported.has(side)) && normalized.includes("DRIVER SIDE") && normalized.includes("PASSENGER SIDE")) {
      return normalized;
    }
    throw new StageFailure(
      "surface_manifest_invalid",
      "The saved production surface manifest is invalid for this vehicle type",
      false,
      0,
      { expectedSides: value, vehicleType: isTrailer ? "trailer" : "standard" }
    );
  }
  if (isTrailer) return [...TRAILER_SIDES];
  const hasSavedOptions = [
    "addHood",
    "addFrontBumper",
    "addRearBumper",
    "roofSize"
  ].some((key) => Object.prototype.hasOwnProperty.call(concept, key));
  if (!hasSavedOptions) return [...STANDARD_SIDES];
  return [
    "DRIVER SIDE",
    "PASSENGER SIDE",
    ...concept.addHood === true ? ["HOOD"] : [],
    ...String(concept.roofSize || "none") !== "none" ? ["ROOF"] : [],
    ...concept.addFrontBumper === true ? ["FRONT"] : [],
    ...concept.addRearBumper === true ? ["REAR"] : []
  ];
}
var SHA256_PATTERN = /^[a-f0-9]{64}$/;
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function normalizedSides(value) {
  return Array.isArray(value) ? value.map((side) => String(side || "").trim().toUpperCase()).filter(Boolean) : [];
}
function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
function sameDimension(left, right) {
  return positiveNumber(left) > 0 && positiveNumber(right) > 0 && Math.abs(Number(left) - Number(right)) <= 0.01;
}
function pinnedValue(record, snakeKey, camelKey = snakeKey) {
  const value = record?.[snakeKey] ?? record?.[camelKey];
  return value == null ? "" : String(value);
}
function assertExactPins(record, expected, label) {
  const actual = {
    revisionId: pinnedValue(record, "revision_id", "revisionId"),
    enticePackId: pinnedValue(record, "entice_pack_id", "enticePackId"),
    dimensionManifestId: pinnedValue(
      record,
      "dimension_manifest_id",
      "dimensionManifestId"
    ),
    sourceContractHash: pinnedValue(
      record,
      "source_contract_hash",
      "sourceContractHash"
    ).toLowerCase()
  };
  if (actual.revisionId !== expected.revisionId || actual.enticePackId !== expected.enticePackId || actual.dimensionManifestId !== expected.dimensionManifestId || actual.sourceContractHash !== expected.sourceContractHash) {
    throw new StageFailure(
      "paid_pack_pin_mismatch",
      `${label} does not carry the exact paid revision pack identity`,
      false,
      0,
      { expected, actual }
    );
  }
}
async function resolveManifest(db, input, runId) {
  const productionJobId = String(input.productionJobId || "");
  if (!productionJobId) {
    throw new StageFailure(
      "missing_production_job",
      "productionJobId is required",
      false
    );
  }
  const { data: productionJob, error: productionError } = await db.from("designpro_production_jobs").select("*").eq("id", productionJobId).maybeSingle();
  if (productionError || !productionJob) {
    throw new StageFailure(
      "production_job_not_found",
      "DesignPro production job not found",
      false,
      0,
      { databaseError: productionError?.message || null }
    );
  }
  const pins = {
    revisionId: String(productionJob.revision_id || ""),
    enticePackId: String(productionJob.entice_pack_id || ""),
    dimensionManifestId: String(productionJob.dimension_manifest_id || ""),
    sourceContractHash: String(productionJob.source_contract_hash || "").toLowerCase()
  };
  if (!UUID_PATTERN.test(pins.revisionId) || !UUID_PATTERN.test(pins.enticePackId) || !UUID_PATTERN.test(pins.dimensionManifestId) || !SHA256_PATTERN.test(pins.sourceContractHash)) {
    throw new StageFailure(
      "paid_pack_pins_missing",
      "The paid production job is not pinned to one immutable Entice Pack",
      false,
      0,
      { productionJobId, pins }
    );
  }
  const { data: workflowRun, error: runError } = await db.from("workforce_runs").select(
    "id,workflow_type,domain_job_type,domain_job_id,tenant_key,requested_by,results,created_at"
  ).eq("id", runId).maybeSingle();
  if (runError || !workflowRun || workflowRun.workflow_type !== "designpro.production_pack" || workflowRun.domain_job_type !== "designpro_production_jobs" || String(workflowRun.domain_job_id || "") !== productionJobId || String(workflowRun.requested_by || "") !== String(productionJob.user_id || "")) {
    throw new StageFailure(
      "workflow_domain_binding_invalid",
      "Workflow envelope is not bound to the authoritative production job",
      false,
      0,
      { databaseError: runError?.message || null }
    );
  }
  assertExactPins(jsonObject(workflowRun.results), pins, "Workflow envelope");
  assertExactPins(jsonObject(productionJob.result), pins, "Production job result");
  const { data: panelizerJob, error: panelizerError } = await db.from("panelizer_jobs").select("*").eq("id", productionJob.panelizer_job_id).maybeSingle();
  if (panelizerError || !panelizerJob) {
    throw new StageFailure(
      "panelizer_job_not_found",
      "Authoritative panelizer job not found",
      false,
      0,
      { databaseError: panelizerError?.message || null }
    );
  }
  if (String(panelizerJob.user_id) !== String(productionJob.user_id)) {
    throw new StageFailure(
      "tenant_mismatch",
      "Production and panelizer job owners do not match",
      false
    );
  }
  const { data: pack, error: packError } = await db.from("designpro_entice_packs").select("*").eq("id", pins.enticePackId).maybeSingle();
  if (packError || !pack) {
    throw new StageFailure(
      "pinned_entice_pack_not_found",
      packError?.message || "The paid job's exact Entice Pack was not found",
      Boolean(packError),
      20
    );
  }
  const packVerifiedAt = Date.parse(String(pack.verified_at || ""));
  const packActivatedAt = Date.parse(String(pack.activated_at || ""));
  const packSupersededAt = Date.parse(String(pack.superseded_at || ""));
  // enqueue_designpro_production_pack_v2 only mints these pins while the pack
  // is active. A later Revision Studio save may supersede it, but an order must
  // continue using the exact revision it purchased.
  const hasValidActiveLifecycle = Number.isFinite(packVerifiedAt) && Number.isFinite(packActivatedAt) && packVerifiedAt <= packActivatedAt && (String(pack.status || "") === "active" || String(pack.status || "") === "superseded" && Number.isFinite(packSupersededAt) && packActivatedAt <= packSupersededAt);
  if (!hasValidActiveLifecycle || !pack.verified_at || !pack.activated_at || String(pack.user_id || "") !== String(productionJob.user_id || "") || String(pack.revision_id || "") !== pins.revisionId || String(pack.dimension_manifest_id || "") !== pins.dimensionManifestId || String(pack.source_contract_hash || "").toLowerCase() !== pins.sourceContractHash) {
    throw new StageFailure(
      "pinned_entice_pack_not_active_verified",
      "The paid job is not bound to the exact Entice Pack that was active and verified when it was ordered",
      false,
      0,
      {
        packId: pins.enticePackId,
        packStatus: pack.status || null,
        verifiedAt: pack.verified_at || null,
        activatedAt: pack.activated_at || null,
        supersededAt: pack.superseded_at || null
      }
    );
  }
  const canonicalId = String(pack.designiq_generation_id || "");
  const generationId = String(productionJob.generation_id || "");
  if (!UUID_PATTERN.test(canonicalId) || String(pack.design_id || "") !== canonicalId || generationId !== canonicalId || String(panelizerJob.generation_id || "") !== canonicalId) {
    throw new StageFailure(
      "paid_pack_design_identity_mismatch",
      "The production job, panelizer job, and Entice Pack do not reference the same canonical design",
      false,
      0,
      {
        canonicalId,
        productionGenerationId: generationId,
        panelizerGenerationId: panelizerJob.generation_id || null
      }
    );
  }
  const [
    { data: revision, error: revisionError },
    { data: generation, error: generationError },
    { data: visualization, error: visualizationError },
    { data: enticeRun, error: enticeRunError },
    { data: enticeStages, error: enticeStagesError }
  ] = await Promise.all([
    db.from("design_version_commits").select(
      "id,user_id,shop_id,designiq_generation_id,source_visualization_id,revision_snapshot,revision_snapshot_hash,frozen_at,workflow_run_id,entice_pack_id,entice_status"
    ).eq("id", pins.revisionId).maybeSingle(),
    db.from("designiq_generations").select("id,user_id").eq("id", canonicalId).maybeSingle(),
    db.from("color_visualizations").select("id,shop_id").eq(
      "id",
      String(pack.source_visualization_id || "")
    ).maybeSingle(),
    db.from("workforce_runs").select(
      "id,workflow_status,workflow_type,domain_job_type,domain_job_id,tenant_key,requested_by"
    ).eq("id", String(pack.workflow_run_id || "")).maybeSingle(),
    db.from("workflow_stage_runs").select(
      "stage_key,status,output,verification,output_hash"
    ).eq("run_id", String(pack.workflow_run_id || "")).in(
      "stage_key",
      ["revision.freeze", "pack.verify", "pack.activate"]
    )
  ]);
  if (revisionError || !revision || generationError || !generation || visualizationError || !visualization || enticeRunError || !enticeRun || enticeStagesError) {
    throw new StageFailure(
      "pinned_pack_binding_unavailable",
      revisionError?.message || generationError?.message || visualizationError?.message || enticeRunError?.message || enticeStagesError?.message || "An immutable Entice Pack binding is missing",
      Boolean(revisionError || generationError || visualizationError || enticeRunError || enticeStagesError),
      20
    );
  }
  if (String(generation.user_id || "") !== String(productionJob.user_id || "") || String(revision.user_id || "") !== String(productionJob.user_id || "") || String(revision.designiq_generation_id || "") !== canonicalId || String(revision.source_visualization_id || "") !== String(pack.source_visualization_id || "") || String(revision.workflow_run_id || "") !== String(pack.workflow_run_id || "") || String(revision.entice_pack_id || "") !== pins.enticePackId || !["active", "superseded"].includes(String(revision.entice_status || "")) || !revision.frozen_at) {
    throw new StageFailure(
      "pinned_revision_owner_binding_invalid",
      "The frozen revision does not match the paid job owner and Entice Pack",
      false
    );
  }
  let enticeRequesterAuthorized = String(enticeRun.requested_by || "") === String(productionJob.user_id || "");
  if (!enticeRequesterAuthorized && enticeRun.requested_by) {
    const { data: delegatedRole, error: delegatedRoleError } = await db.from(
      "user_roles"
    ).select("user_id,role").eq("user_id", enticeRun.requested_by).in(
      "role",
      ["admin", "tester"]
    ).limit(1).maybeSingle();
    if (delegatedRoleError) {
      throw new StageFailure(
        "entice_requester_authorization_unavailable",
        delegatedRoleError.message || "Unable to verify the Entice Pack requester",
        true,
        20
      );
    }
    enticeRequesterAuthorized = Boolean(delegatedRole?.user_id);
  }
  if (String(pack.tenant_key || "") !== `user:${productionJob.user_id}` || String(enticeRun.tenant_key || "") !== String(pack.tenant_key || "") || String(enticeRun.workflow_type || "") !== "designpro.entice_pack" || String(enticeRun.domain_job_type || "") !== "designpro_entice_packs" || String(enticeRun.domain_job_id || "") !== pins.enticePackId || !enticeRequesterAuthorized || String(enticeRun.workflow_status || "") !== "completed") {
    throw new StageFailure(
      "entice_workflow_binding_invalid",
      "The Entice Pack lacks its completed tenant-bound workflow record",
      false
    );
  }
  const verifyStage = (enticeStages || []).find(
    (stage) => stage.stage_key === "pack.verify"
  );
  const activateStage = (enticeStages || []).find(
    (stage) => stage.stage_key === "pack.activate"
  );
  const freezeStage = (enticeStages || []).find(
    (stage) => stage.stage_key === "revision.freeze"
  );
  const freezeOutputHash = String(freezeStage?.output_hash || "").toLowerCase();
  if (freezeStage?.status !== "completed" || freezeStage?.verification?.verified !== true || !SHA256_PATTERN.test(freezeOutputHash)) {
    throw new StageFailure(
      "entice_freeze_checkpoint_invalid",
      "The exact Entice Pack is missing its verified frozen-revision checkpoint",
      false
    );
  }
  const verifyOutput = jsonObject(verifyStage?.output);
  const activateOutput = jsonObject(activateStage?.output);
  if (verifyStage?.status !== "completed" || verifyStage?.verification?.verified !== true || String(verifyStage.output_hash || "").toLowerCase() !== String(pack.pack_identity_hash || "").toLowerCase() || String(verifyOutput.packId || "") !== pins.enticePackId || String(verifyOutput.sourceContractHash || "").toLowerCase() !== pins.sourceContractHash || activateStage?.status !== "completed" || activateStage?.verification?.verified !== true || String(activateStage.output_hash || "").toLowerCase() !== String(pack.pack_identity_hash || "").toLowerCase() || String(activateOutput.packId || "") !== pins.enticePackId || activateOutput.active !== true) {
    throw new StageFailure(
      "entice_pack_verification_checkpoint_invalid",
      "The exact Entice Pack is missing its verified and activated checkpoints",
      false
    );
  }
  const { data: teamRows, error: teamError } = await db.rpc(
    "proof_team_shop_ids",
    { _user: productionJob.user_id }
  );
  if (teamError) {
    throw new StageFailure(
      "tenant_membership_unavailable",
      "Unable to verify the production tenant",
      true,
      20,
      { databaseError: teamError.message }
    );
  }
  const permittedShopIds = /* @__PURE__ */ new Set([
    String(productionJob.user_id),
    ...Array.isArray(teamRows) ? teamRows.map(
      (row) => String(
        typeof row === "string" ? row : row?.proof_team_shop_ids || row?.shop_id || ""
      )
    ).filter(Boolean) : []
  ]);
  if (panelizerJob.shop_id && !permittedShopIds.has(String(panelizerJob.shop_id))) {
    throw new StageFailure(
      "panelizer_tenant_unverified",
      "The panelizer job is outside the requester's verified tenant boundary",
      false
    );
  }
  if (panelizerJob.shop_id && visualization.shop_id && String(panelizerJob.shop_id) !== String(visualization.shop_id)) {
    throw new StageFailure(
      "visualization_tenant_mismatch",
      "Visualization and production job belong to different shops",
      false
    );
  }
  const expectedTenant = panelizerJob.shop_id ? `shop-profile:${panelizerJob.shop_id}` : `user:${productionJob.user_id}`;
  if (String(workflowRun.tenant_key || "") !== expectedTenant) {
    throw new StageFailure(
      "workflow_tenant_mismatch",
      "Workflow tenant key does not match the authoritative job",
      false
    );
  }
  if (productionJob.order_request_id) {
    const { data: orderRequest, error: orderError } = await db.from(
      "print_production_requests"
    ).select(
      "id,user_id,design_id,panelizer_job_id,revision_id,entice_pack_id,production_job_id,workflow_run_id,payment_status"
    ).eq("id", productionJob.order_request_id).maybeSingle();
    if (orderError || !orderRequest || String(orderRequest.user_id || "") !== String(productionJob.user_id || "") || String(orderRequest.production_job_id || "") !== productionJobId || String(orderRequest.workflow_run_id || "") !== runId || orderRequest.design_id && String(orderRequest.design_id) !== canonicalId || orderRequest.panelizer_job_id && String(orderRequest.panelizer_job_id) !== String(panelizerJob.id) || String(orderRequest.payment_status || "") !== "paid") {
      throw new StageFailure(
        "paid_order_binding_invalid",
        orderError?.message || "The paid order does not carry the exact production workflow binding",
        false
      );
    }
    assertExactPins(orderRequest, pins, "Paid order");
  }
  const surfaceManifest = jsonObject(pack.surface_manifest);
  const surfaces = Array.isArray(surfaceManifest.surfaces) ? surfaceManifest.surfaces : [];
  const expectedSides = normalizedSides(surfaceManifest.expectedSides);
  const surfaceSides = normalizedSides(
    surfaces.map((surface) => surface?.key)
  );
  const vehicle = jsonObject(surfaceManifest.vehicle);
  const vehicleType = String(vehicle.type || "standard").trim().toLowerCase();
  const supportedSides = new Set(
    vehicleType === "trailer" ? TRAILER_SIDES : STANDARD_SIDES
  );
  if (!expectedSides.length || expectedSides.length !== new Set(expectedSides).size || !sameStringSet(expectedSides, surfaceSides) || !expectedSides.every((side) => supportedSides.has(side)) || !expectedSides.includes("DRIVER SIDE") || !expectedSides.includes("PASSENGER SIDE")) {
    throw new StageFailure(
      "pinned_surface_manifest_invalid",
      "The exact Entice Pack has an invalid or incomplete frozen surface manifest",
      false,
      0,
      { expectedSides, surfaceSides, vehicleType }
    );
  }
  const dimensionSource = jsonObject(surfaceManifest.dimensions);
  const dims = {};
  for (const surface of surfaces) {
    const side = String(surface?.key || "").trim().toUpperCase();
    const width = positiveNumber(surface?.trimWidthIn);
    const height = positiveNumber(surface?.trimHeightIn);
    const dimension = jsonObject(dimensionSource[side]);
    if (!side || !sameDimension(width, dimension.w) || !sameDimension(height, dimension.h) || Number(surface?.bleedIn) !== 5) {
      throw new StageFailure(
        "pinned_surface_dimensions_invalid",
        `Frozen dimensions or 5-inch bleed are invalid for ${side || "an unknown surface"}`,
        false
      );
    }
    dims[side] = { w: width, h: height };
  }
  const manifestHash = String(pack.manifest_hash || "").toLowerCase();
  const dimensionBasisHash = String(pack.dimension_basis_hash || "").toLowerCase();
  const canonicalInputHash = String(pack.canonical_input_hash || "").toLowerCase();
  const packIdentityHash = String(pack.pack_identity_hash || "").toLowerCase();
  const declaredManifestHash = String(surfaceManifest.manifestHash || "").toLowerCase();
  const manifestBase = { ...surfaceManifest };
  delete manifestBase.manifestHash;
  const computedManifestHash = await sha256(manifestBase);
  const computedPackIdentityHash = await sha256({
    revisionId: pins.revisionId,
    dimensionManifestId: pins.dimensionManifestId,
    sourceContractHash: pins.sourceContractHash
  });
  // canonical_input_hash is the ENRICHED frozen-input identity the entice
  // run's revision.freeze stage computed (definition version, tool contracts,
  // snapshot, source fingerprints) — its ground truth is that stage's own
  // output_hash. The bare snapshot identity is bound separately:
  // pack.submission_hash must equal the revision's snapshot hash. The old
  // triple-equality (canonical == submission == snapshot) described a
  // producer that no longer exists and refused every pack ever activated.
  if (!SHA256_PATTERN.test(manifestHash) || !SHA256_PATTERN.test(dimensionBasisHash) || !SHA256_PATTERN.test(canonicalInputHash) || !SHA256_PATTERN.test(packIdentityHash) || manifestHash !== declaredManifestHash || manifestHash !== computedManifestHash || dimensionBasisHash !== String(surfaceManifest.dimensionBasisHash || "").toLowerCase() || String(pack.submission_hash || "").toLowerCase() !== String(revision.revision_snapshot_hash || "").toLowerCase() || canonicalInputHash !== freezeOutputHash || packIdentityHash !== computedPackIdentityHash) {
    throw new StageFailure(
      "pinned_pack_hash_contract_invalid",
      "The frozen revision, surface manifest, and pack identity hashes do not agree",
      false,
      0,
      {
        manifestHash,
        declaredManifestHash,
        computedManifestHash,
        packIdentityHash,
        computedPackIdentityHash,
        canonicalInputHash,
        freezeOutputHash,
        submissionHash: String(pack.submission_hash || "").toLowerCase(),
        revisionSnapshotHash: String(revision.revision_snapshot_hash || "").toLowerCase()
      }
    );
  }
  const proofArtifact = jsonObject(pack.proof_artifact);
  const proofUrl = String(proofArtifact.url || "").trim();
  const expectedProofHash = String(proofArtifact.sha256 || "").toLowerCase();
  const expectedProofBytes = Number(proofArtifact.bytes || 0);
  if (!proofUrl || !SHA256_PATTERN.test(expectedProofHash) || !Number.isSafeInteger(expectedProofBytes) || expectedProofBytes <= 0) {
    throw new StageFailure(
      "pinned_proof_identity_invalid",
      "The exact Entice Pack has no valid frozen proof identity",
      false
    );
  }
  const proofFingerprint = await fingerprintAsset(proofUrl);
  if (proofFingerprint.sha256 !== expectedProofHash || proofFingerprint.bytes !== expectedProofBytes) {
    throw new StageFailure(
      "pinned_proof_content_changed",
      "The frozen Entice Pack proof bytes no longer match their verified hash",
      false,
      0,
      {
        expected: { sha256: expectedProofHash, bytes: expectedProofBytes },
        observed: proofFingerprint
      }
    );
  }
  const revisionSnapshot = jsonObject(revision.revision_snapshot);
  const viewUrls = objectOfStrings(revisionSnapshot.renderUrls);
  const selectedOptions = jsonObject(surfaceManifest.selectedOptions);
  const packVersion = String(pack.pack_version || "").toLowerCase();
  if (packVersion !== `v2:${pins.sourceContractHash.slice(0, 24)}`) {
    throw new StageFailure(
      "pinned_pack_version_invalid",
      "The Entice Pack version does not match its source contract hash",
      false
    );
  }
  const output = {
    builderVersion: MASTER_SHEET_VERSION,
    productionJobId,
    panelizerJobId: String(panelizerJob.id),
    generationId: canonicalId,
    canonicalId,
    visualizationId: String(pack.source_visualization_id),
    userId: String(productionJob.user_id),
    proofUrl,
    make: String(vehicle.make || ""),
    model: String(vehicle.model || ""),
    year: String(vehicle.year || ""),
    finish: String(revisionSnapshot.finish || "gloss"),
    vehicleType,
    isTrailer: vehicleType === "trailer",
    expectedSides,
    dims,
    viewUrls,
    fallbackArtboardUrl: null,
    bodyText: String(revisionSnapshot.bodyText || ""),
    surfaceOptions: selectedOptions,
    sourceFingerprints: { proof: proofFingerprint },
    inputHash: packIdentityHash,
    revisionId: pins.revisionId,
    enticePackId: pins.enticePackId,
    dimensionManifestId: pins.dimensionManifestId,
    manifestHash,
    sourceContractHash: pins.sourceContractHash,
    packIdentityHash,
    packVersion,
    proofFingerprint
  };
  return {
    output,
    verification: {
      verified: true,
      proofBound: true,
      dimensionsComplete: true,
      expectedSides,
      inputHash: packIdentityHash,
      exactRevisionPinned: true,
      activeWhenOrdered: true,
      verifiedEnticePack: true,
      fiveInchBleed: true
    }
  };
}
async function loadPinnedAtomicState(manifest, db) {
  const [
    { data: pack, error: packError },
    { data: rows, error: rowsError }
  ] = await Promise.all([
    db.from("designpro_entice_packs").select(
      "id,design_id,designiq_generation_id,source_visualization_id,revision_id,dimension_manifest_id,user_id,tenant_key,status,manifest_hash,pack_identity_hash,source_contract_hash,surface_manifest,proof_artifact,panel_artifacts,logo_artifacts,pack_version,verified_at,activated_at,superseded_at"
    ).eq("id", manifest.enticePackId).maybeSingle(),
    db.from("production_flow_assets").select(
      "id,job_id,side,version,background_url,branding_url,dimensions_inches,meta_metrics,revision_id,entice_pack_id,designiq_generation_id,dimension_manifest_id,manifest_hash,source_contract_hash,artifact_hash"
    ).eq("entice_pack_id", manifest.enticePackId)
  ]);
  if (packError || rowsError || !pack) {
    throw new StageFailure(
      "pinned_atomic_pack_lookup_failed",
      packError?.message || rowsError?.message || "Unable to read the exact revision-bound panel pack",
      Boolean(packError || rowsError),
      20
    );
  }
  if (!["active", "superseded"].includes(String(pack.status || "")) || !pack.verified_at || !pack.activated_at || String(pack.id || "") !== manifest.enticePackId || String(pack.design_id || "") !== manifest.canonicalId || String(pack.designiq_generation_id || "") !== manifest.canonicalId || String(pack.source_visualization_id || "") !== manifest.visualizationId || String(pack.revision_id || "") !== manifest.revisionId || String(pack.dimension_manifest_id || "") !== manifest.dimensionManifestId || String(pack.user_id || "") !== manifest.userId || String(pack.tenant_key || "") !== `user:${manifest.userId}` || String(pack.manifest_hash || "").toLowerCase() !== manifest.manifestHash || String(pack.source_contract_hash || "").toLowerCase() !== manifest.sourceContractHash || String(pack.pack_identity_hash || "").toLowerCase() !== manifest.packIdentityHash || String(pack.pack_version || "").toLowerCase() !== manifest.packVersion || String(jsonObject(pack.proof_artifact).url || "") !== manifest.proofUrl) {
    throw new StageFailure(
      "pinned_atomic_pack_identity_changed",
      "The exact Entice Pack no longer matches the paid workflow pins",
      false
    );
  }
  const rowIdentityHash = await sha256(
    (rows || []).map((row) => ({
      jobId: row.job_id,
      side: String(row.side || "").trim().toUpperCase(),
      version: row.version,
      backgroundUrl: row.background_url,
      brandingUrl: row.branding_url,
      dimensions: row.dimensions_inches,
      meta: row.meta_metrics,
      revisionId: row.revision_id,
      enticePackId: row.entice_pack_id,
      designiqGenerationId: row.designiq_generation_id,
      dimensionManifestId: row.dimension_manifest_id,
      manifestHash: row.manifest_hash,
      sourceContractHash: row.source_contract_hash,
      artifactHash: row.artifact_hash
    })).sort((left, right) => left.side.localeCompare(right.side))
  );
  const packRecordHash = await sha256({
    id: pack.id,
    designId: pack.design_id,
    revisionId: pack.revision_id,
    dimensionManifestId: pack.dimension_manifest_id,
    manifestHash: pack.manifest_hash,
    sourceContractHash: pack.source_contract_hash,
    packIdentityHash: pack.pack_identity_hash,
    packVersion: pack.pack_version,
    surfaceManifest: pack.surface_manifest,
    proofArtifact: pack.proof_artifact,
    panelArtifacts: pack.panel_artifacts,
    logoArtifacts: pack.logo_artifacts,
    verifiedAt: pack.verified_at,
    activatedAt: pack.activated_at
  });
  return { pack, rows: rows || [], rowIdentityHash, packRecordHash };
}
function requireFingerprintEvidence(expected, label) {
  const evidence = jsonObject(expected);
  const hash = String(evidence.sha256 || "").toLowerCase();
  const bytes = Number(evidence.bytes || 0);
  if (!SHA256_PATTERN.test(hash) || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new StageFailure(
      "artifact_fingerprint_evidence_invalid",
      `Verified fingerprint evidence is missing for ${label}`,
      false
    );
  }
  return { sha256: hash, bytes };
}
async function resolveVerifiedAtomicPack(_runId, manifest, db) {
  const { pack, rows, rowIdentityHash, packRecordHash } = await loadPinnedAtomicState(
    manifest,
    db
  );
  const surfaceManifest = jsonObject(pack.surface_manifest);
  const surfaces = Array.isArray(surfaceManifest.surfaces) ? surfaceManifest.surfaces : [];
  const panelArtifacts = Array.isArray(pack.panel_artifacts) ? pack.panel_artifacts : [];
  const logoArtifacts = Array.isArray(pack.logo_artifacts) ? pack.logo_artifacts : [];
  const logoArtifactsHash = await sha256(logoArtifacts);
  const rowsBySide = new Map();
  const panelsBySide = new Map();
  const surfacesBySide = new Map();
  for (const row of rows) {
    const side = String(row.side || "").trim().toUpperCase();
    if (!side || rowsBySide.has(side)) {
      throw new StageFailure(
        "pinned_atomic_pack_duplicate_side",
        "The exact panel vault contains a duplicate or empty surface",
        false,
        0,
        { side }
      );
    }
    rowsBySide.set(side, row);
  }
  for (const panel of panelArtifacts) {
    const side = String(panel?.side || "").trim().toUpperCase();
    if (!side || panelsBySide.has(side)) {
      throw new StageFailure(
        "pinned_panel_manifest_duplicate_side",
        "The verified Entice Pack panel manifest contains a duplicate or empty surface",
        false,
        0,
        { side }
      );
    }
    panelsBySide.set(side, panel);
  }
  for (const surface of surfaces) {
    const side = String(surface?.key || "").trim().toUpperCase();
    if (!side || surfacesBySide.has(side)) {
      throw new StageFailure(
        "pinned_surface_manifest_duplicate_side",
        "The verified Entice Pack surface manifest contains a duplicate or empty surface",
        false,
        0,
        { side }
      );
    }
    surfacesBySide.set(side, surface);
  }
  if (rows.length !== manifest.expectedSides.length || panelArtifacts.length !== manifest.expectedSides.length || surfaces.length !== manifest.expectedSides.length || !sameStringSet(Array.from(rowsBySide.keys()), manifest.expectedSides) || !sameStringSet(Array.from(panelsBySide.keys()), manifest.expectedSides) || !sameStringSet(Array.from(surfacesBySide.keys()), manifest.expectedSides)) {
    throw new StageFailure(
      "pinned_atomic_pack_incomplete",
      "The exact Entice Pack does not contain every frozen production surface exactly once",
      false,
      0,
      {
        expectedSides: manifest.expectedSides,
        vaultSides: Array.from(rowsBySide.keys()),
        panelSides: Array.from(panelsBySide.keys()),
        surfaceSides: Array.from(surfacesBySide.keys())
      }
    );
  }
  // resolve_manifest already streamed and verified the proof bytes. Reuse that
  // persisted evidence here instead of downloading the same large proof twice.
  const proofFingerprint = requireFingerprintEvidence(
    manifest.proofFingerprint,
    "the frozen proof"
  );
  const materialUrls = {};
  const expectedFingerprints = {};
  for (const side of manifest.expectedSides) {
    const row = rowsBySide.get(side);
    const panel = jsonObject(panelsBySide.get(side));
    const surface = jsonObject(surfacesBySide.get(side));
    const meta = jsonObject(row.meta_metrics);
    const dimensions = jsonObject(row.dimensions_inches);
    const expectedDimension = jsonObject(manifest.dims[side]);
    const expectedSidesFromRow = normalizedSides(meta.expected_sides);
    const cleanUrl = String(row.background_url || "").trim();
    const brandedUrl = String(row.branding_url || "").trim();
    const artifactHash = String(panel.artifactHash || "").toLowerCase();
    const panelFingerprints = jsonObject(panel.fingerprints);
    // REASONED SEPARATION GAP — the decided Call 7 contract
    // (docs/CANONICAL_DESIGN_CALL_CONTRACT.md: "A refused separation may leave
    // the clean panel honestly absent, but must never remove the branded
    // panel."). The entice chain was taught this across four August fences;
    // this verifier predates them and still demanded a passing separation, a
    // clean asset, and production_eligible on every side — so the first order
    // ever to clear resolve_manifest (pack 2982283c, run 6366dddd, 2026-08-11)
    // failed HERE on its honest REAR gap, and since every active pack carries
    // at least one gap side, stage 60 stayed unreachable for all of them.
    // A gap side is admitted ONLY in its exact honest shape: known refused
    // separation with a reason on BOTH the panel artifact and the vault row,
    // no clean asset or evidence anywhere, no overlays, and the row honestly
    // production-INELIGIBLE. Branded stays mandatory and byte-bound.
    const separationGap =
      panel.separationQc?.known === true &&
      panel.separationQc?.pass === false &&
      String(panel.separationQc?.reason || "").trim().length > 0 &&
      meta.separation_qc?.known === true &&
      meta.separation_qc?.pass === false &&
      cleanUrl === "" &&
      String(panel.cleanUrl || "").trim() === "" &&
      (!Array.isArray(panel.overlayManifest) || panel.overlayManifest.length === 0) &&
      panelFingerprints.clean === undefined;
    if (String(row.job_id || "") !== manifest.canonicalId || String(row.revision_id || "") !== manifest.revisionId || String(row.entice_pack_id || "") !== manifest.enticePackId || String(row.designiq_generation_id || "") !== manifest.canonicalId || String(row.dimension_manifest_id || "") !== manifest.dimensionManifestId || String(row.manifest_hash || "").toLowerCase() !== manifest.manifestHash || String(row.source_contract_hash || "").toLowerCase() !== manifest.sourceContractHash || String(row.artifact_hash || "").toLowerCase() !== artifactHash || !SHA256_PATTERN.test(artifactHash) || String(row.version || "").toLowerCase() !== manifest.packVersion || cleanUrl !== String(panel.cleanUrl || "").trim() || brandedUrl !== String(panel.brandedUrl || "").trim() || !sameDimension(dimensions.w, expectedDimension.w) || !sameDimension(dimensions.h, expectedDimension.h) || !sameDimension(panel.widthIn, expectedDimension.w) || !sameDimension(panel.heightIn, expectedDimension.h) || !sameDimension(surface.trimWidthIn, expectedDimension.w) || !sameDimension(surface.trimHeightIn, expectedDimension.h) || Number(panel.bleedIn) !== 5 || Number(surface.bleedIn) !== 5 || Number(meta.bleed_in) !== 5 || panel.productionEligible !== true || meta.production_eligible !== !separationGap || panel.qc?.known !== true || panel.qc?.pass !== true || meta.qc?.known !== true || meta.qc?.pass !== true || panel.separationQc?.known !== true || panel.separationQc?.pass !== !separationGap || meta.separation_qc?.known !== true || meta.separation_qc?.pass !== !separationGap || String(meta.source_hash || "").toLowerCase() !== manifest.sourceContractHash || String(meta.source_contract_hash || "").toLowerCase() !== manifest.sourceContractHash || String(meta.revision_id || "") !== manifest.revisionId || String(meta.entice_pack_id || "") !== manifest.enticePackId || String(meta.designiq_generation_id || "") !== manifest.canonicalId || String(meta.dimension_manifest_id || "") !== manifest.dimensionManifestId || String(meta.manifest_hash || "").toLowerCase() !== manifest.manifestHash || String(meta.source_proof_url || "") !== manifest.proofUrl || String(meta.pack_version || "").toLowerCase() !== manifest.packVersion || !sameStringSet(expectedSidesFromRow, manifest.expectedSides)) {
      throw new StageFailure(
        "pinned_atomic_surface_contract_invalid",
        `The exact revision-bound panel contract failed for ${side}`,
        false,
        0,
        { side, rowId: row.id || null, separationGap }
      );
    }
    materialUrls[`panel:${side}:branded`] = brandedUrl;
    expectedFingerprints[`panel:${side}:branded`] = requireFingerprintEvidence(
      panelFingerprints.branded,
      `${side} branded panel`
    );
    // A gap side has no clean asset by contract — demanding its evidence is
    // exactly what refused the honest REAR gap. Non-gap sides stay strict.
    if (!separationGap) {
      materialUrls[`panel:${side}:clean`] = cleanUrl;
      expectedFingerprints[`panel:${side}:clean`] = requireFingerprintEvidence(
        panelFingerprints.clean,
        `${side} clean panel`
      );
    }
    // OVERLAY EVIDENCE SHAPE — the entice chain records TWO artifacts per
    // lifted element (fingerprints["overlay:{i}:rebuild"] soft matte +
    // ["overlay:{i}:cut"] plotter cut; live shape on pack 2982283c). This
    // verifier asked for a single un-suffixed "overlay:{i}" that no pack has
    // ever written — unreachable until resolve_manifest first cleared on
    // 2026-08-11, then the first thing every real pack failed on. Verify BOTH
    // real artifacts; the un-suffixed key is accepted only as a legacy
    // fallback for the rebuild when no suffixed evidence exists.
    const overlays = Array.isArray(panel.overlayManifest) ? panel.overlayManifest : [];
    for (const [position, overlay] of overlays.entries()) {
      const index = Number.isSafeInteger(Number(overlay?.index))
        ? Number(overlay.index)
        : position;
      const rebuildUrl = String(overlay?.rebuild_url || overlay?.url || "").trim();
      const cutUrl = String(overlay?.cut_url || "").trim();
      if (!rebuildUrl) {
        throw new StageFailure(
          "pinned_overlay_url_missing",
          `A verified ${side} overlay is missing its immutable URL`,
          false
        );
      }
      const rebuildEvidence =
        panelFingerprints[`overlay:${index}:rebuild`] ||
        panelFingerprints[`overlay:${index}`];
      const rebuildKey = `panel:${side}:overlay:${index}:rebuild`;
      materialUrls[rebuildKey] = rebuildUrl;
      expectedFingerprints[rebuildKey] = requireFingerprintEvidence(
        rebuildEvidence,
        `${side} overlay ${index} rebuild`
      );
      const cutEvidence = panelFingerprints[`overlay:${index}:cut`];
      if (cutEvidence !== undefined || cutUrl) {
        if (!cutUrl) {
          throw new StageFailure(
            "pinned_overlay_url_missing",
            `A verified ${side} overlay is missing its immutable cut URL`,
            false
          );
        }
        const cutKey = `panel:${side}:overlay:${index}:cut`;
        materialUrls[cutKey] = cutUrl;
        expectedFingerprints[cutKey] = requireFingerprintEvidence(
          cutEvidence,
          `${side} overlay ${index} cut`
        );
      }
    }
    const metaLogoPack = Array.isArray(meta.logo_pack) ? meta.logo_pack : [];
    if (await sha256(metaLogoPack) !== logoArtifactsHash) {
      throw new StageFailure(
        "pinned_logo_pack_binding_invalid",
        `The ${side} vault row is not bound to the verified logo pack`,
        false
      );
    }
  }
  for (const [index, logo] of logoArtifacts.entries()) {
    const logoUrl = String(logo?.url || "").trim();
    if (!logoUrl) {
      throw new StageFailure(
        "pinned_logo_url_missing",
        "A verified logo artifact is missing its immutable URL",
        false
      );
    }
    const key = `logo:${index}`;
    materialUrls[key] = logoUrl;
    expectedFingerprints[key] = requireFingerprintEvidence(
      logo,
      `logo artifact ${index}`
    );
  }
  const fingerprints = {
    proof: {
      ...jsonObject(manifest.proofFingerprint),
      ...proofFingerprint
    },
    ...await fingerprintMaterialAssets(materialUrls)
  };
  for (const [key, expected] of Object.entries(expectedFingerprints)) {
    const observed = fingerprints[key];
    if (!observed || observed.sha256 !== expected.sha256 || observed.bytes !== expected.bytes) {
      throw new StageFailure(
        "pinned_artifact_content_changed",
        `Verified artifact bytes changed for ${key}`,
        false,
        0,
        { key, expected, observed: observed || null }
      );
    }
  }
  const artifactSetHash = await sha256({
    revisionId: manifest.revisionId,
    enticePackId: manifest.enticePackId,
    dimensionManifestId: manifest.dimensionManifestId,
    manifestHash: manifest.manifestHash,
    sourceContractHash: manifest.sourceContractHash,
    packIdentityHash: manifest.packIdentityHash,
    packVersion: manifest.packVersion,
    expectedSides: manifest.expectedSides,
    rows: manifest.expectedSides.map((side) => ({
      side,
      artifactHash: String(rowsBySide.get(side)?.artifact_hash || "").toLowerCase()
    })),
    fingerprints
  });
  return {
    output: {
      sourceHash: manifest.sourceContractHash,
      sourceContractHash: manifest.sourceContractHash,
      packVersion: manifest.packVersion,
      sourceProofUrl: manifest.proofUrl,
      expectedSides: manifest.expectedSides,
      vaultJobId: manifest.canonicalId,
      revisionId: manifest.revisionId,
      enticePackId: manifest.enticePackId,
      dimensionManifestId: manifest.dimensionManifestId,
      manifestHash: manifest.manifestHash,
      fingerprints,
      packIdentityHash: manifest.packIdentityHash,
      artifactSetHash,
      rowIdentityHash,
      packRecordHash
    },
    verification: {
      verified: true,
      existingSanctionedProducer: true,
      readOnly: true,
      atomic: true,
      proofBound: true,
      exactRevisionPinned: true,
      fiveInchBleed: true,
      panelQcKnownPass: true,
      separationQcKnownPass: true,
      contentHashesVerified: true,
      sourceHash: manifest.sourceContractHash,
      packVersion: manifest.packVersion,
      expectedSides: manifest.expectedSides,
      rowCount: rows.length
    }
  };
}
async function verifyAtomicPack(runId, db) {
  const manifest = await stageOutput(
    db,
    runId,
    "resolve_manifest"
  );
  return await resolveVerifiedAtomicPack(runId, manifest, db);
}
async function assertAtomicPackCurrent(runId, manifest, frozenPack, db) {
  const current = await loadPinnedAtomicState(manifest, db);
  if (String(manifest.packIdentityHash || "") !== String(frozenPack.packIdentityHash || "") || String(manifest.sourceContractHash || "") !== String(frozenPack.sourceHash || "") || String(manifest.packVersion || "") !== String(frozenPack.packVersion || "") || String(current.rowIdentityHash || "") !== String(frozenPack.rowIdentityHash || "") || String(current.packRecordHash || "") !== String(frozenPack.packRecordHash || "")) {
    throw new StageFailure(
      "atomic_pack_revision_changed",
      "The exact revision-bound atomic pack changed after verification",
      false,
      0,
      {
        runId,
        frozenPackIdentity: frozenPack.packIdentityHash || null,
        currentPackIdentity: manifest.packIdentityHash || null,
        frozenRowIdentity: frozenPack.rowIdentityHash || null,
        currentRowIdentity: current.rowIdentityHash || null,
        frozenPackRecord: frozenPack.packRecordHash || null,
        currentPackRecord: current.packRecordHash || null
      }
    );
  }
}
function viewUrlForSide(side, viewUrls) {
  for (const key of VIEW_KEYS[side] || []) {
    if (viewUrls[key]) return viewUrls[key];
  }
  return null;
}
async function executeStage(db, body) {
  const runId = String(body.runId || body.run_id || "");
  const stageKey = String(body.stageKey || body.stage_key || "");
  const scopeKey = String(body.scopeKey || body.scope_key || "").toUpperCase();
  const attempt = Math.max(1, Number(body.attempt || 1));
  const input = body.input && typeof body.input === "object" ? body.input : {};
  if (!runId || !stageKey) {
    throw new StageFailure(
      "invalid_stage_claim",
      "runId and stageKey required",
      false
    );
  }
  let result;
  switch (stageKey) {
    case "resolve_manifest":
      result = await resolveManifest(db, input, runId);
      break;
    case "verify_atomic_pack":
      result = await verifyAtomicPack(runId, db);
      break;
    case "activate_print_worker":
      result = await activatePrintWorker(runId, db);
      break;
    case "verify_print_outputs":
      result = await verifyPrintOutputs(runId, db);
      break;
    default:
      throw new StageFailure(
        "unsupported_stage",
        `Unsupported stage ${stageKey}`,
        false
      );
  }
  return {
    output: result.output,
    verification: result.verification,
    outputHash: await sha256(result.output)
  };
}
async function activatePrintWorker(runId, db) {
  const manifest = await stageOutput(
    db,
    runId,
    "resolve_manifest"
  );
  await assertClaimOwned();
  const pack = await stageOutput(db, runId, "verify_atomic_pack");
  await assertAtomicPackCurrent(runId, manifest, pack, db);
  const activation = await callFn(
    "run-production-flow",
    {
      mode: "designpro_job",
      action: "advance_domain",
      productionJobId: manifest.productionJobId,
      workflowRunId: runId,
      userId: manifest.userId,
      sourceHash: pack.sourceHash,
      packVersion: pack.packVersion,
      sourceProofUrl: pack.sourceProofUrl,
      expectedSides: pack.expectedSides,
      vaultJobId: pack.vaultJobId,
      packIdentityHash: pack.packIdentityHash,
      revisionId: pack.revisionId,
      enticePackId: pack.enticePackId,
      dimensionManifestId: pack.dimensionManifestId,
      manifestHash: pack.manifestHash,
      sourceContractHash: pack.sourceContractHash,
      artifactSetHash: pack.artifactSetHash,
      fingerprints: pack.fingerprints
    },
    7e4
  );
  const productionJob = activation?.productionJob;
  const worker = activation?.activation || {};
  if (!productionJob || !["worker_queued", "awaiting_admin_qc"].includes(
    String(productionJob.state || "")
  )) {
    throw new StageFailure(
      "print_worker_dispatch_unverified",
      String(
        worker?.error || activation?.error || "Print worker did not durably accept the current source-bound pack"
      ),
      true,
      30,
      { activation }
    );
  }
  assertExactPins(productionJob, manifest, "Activated production job");
  assertExactPins(
    jsonObject(productionJob.result),
    manifest,
    "Activated production result"
  );
  if (String(productionJob?.result?.sourceHash || "").toLowerCase() !== String(pack.sourceHash || "").toLowerCase() || String(productionJob?.result?.packVersion || "").toLowerCase() !== String(pack.packVersion || "").toLowerCase() || String(productionJob?.result?.packIdentityHash || "").toLowerCase() !== String(pack.packIdentityHash || "").toLowerCase()) {
    throw new StageFailure(
      "print_worker_source_mismatch",
      "Print worker accepted a different source identity",
      false,
      0,
      { expected: pack, productionJob }
    );
  }
  const expectedPanels = Array.isArray(worker.expectedPanels) ? worker.expectedPanels.map(String) : [];
  const skipped = Array.isArray(worker.skipped) ? worker.skipped : [];
  const accountedPanels = [
    ...Array.isArray(worker.activatedSides) ? worker.activatedSides.map(String) : [],
    ...Array.isArray(worker.alreadyComplete) ? worker.alreadyComplete.map(String) : [],
    ...Array.isArray(worker.alreadyDispatched) ? worker.alreadyDispatched.map(String) : []
  ];
  if (expectedPanels.length === 0 || skipped.length > 0 || !sameStringSet(accountedPanels, expectedPanels)) {
    throw new StageFailure(
      "print_worker_manifest_incomplete",
      "Print-worker activation did not account for every frozen output panel",
      true,
      30,
      { expectedPanels, accountedPanels, skipped }
    );
  }
  return {
    output: {
      productionJobId: manifest.productionJobId,
      panelizerJobId: manifest.panelizerJobId,
      state: productionJob.state,
      sourceHash: productionJob.result.sourceHash,
      packVersion: productionJob.result.packVersion,
      runKey: productionJob.result.runKey,
      revisionId: pack.revisionId,
      enticePackId: pack.enticePackId,
      dimensionManifestId: pack.dimensionManifestId,
      manifestHash: pack.manifestHash,
      sourceContractHash: pack.sourceContractHash,
      packIdentityHash: pack.packIdentityHash,
      artifactSetHash: pack.artifactSetHash,
      expectedPanels,
      activated: worker.activatedSides || [],
      alreadyComplete: worker.alreadyComplete || [],
      alreadyDispatched: worker.alreadyDispatched || []
    },
    verification: {
      verified: true,
      durableDispatch: true,
      sourceBound: true,
      exactRevisionPinned: true,
      noSkippedPanels: true,
      allExpectedPanelsAccountedFor: true
    }
  };
}
function sameStringSet(left, right) {
  return left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length && left.every((item) => new Set(right).has(item));
}
function matchesWorkerIdentity(value, sourceHash, packVersion, runKey) {
  return !!value && String(value.source_hash || "").toLowerCase() === sourceHash.toLowerCase() && String(value.pack_version || "").toLowerCase() === packVersion.toLowerCase() && String(value.run_key || "").toLowerCase() === runKey.toLowerCase();
}
function matchesDispatchOutput(row, sourceHash, packVersion, runKey, panelKey) {
  const output = row?.output && typeof row.output === "object" ? row.output : {};
  return String(row?.status || "") === "completed" && !!String(row?.output_hash || "") && String(output.sourceHash || output.source_hash || "").toLowerCase() === sourceHash.toLowerCase() && String(output.packVersion || output.pack_version || "").toLowerCase() === packVersion.toLowerCase() && String(output.runKey || output.run_key || "").toLowerCase() === runKey.toLowerCase() && String(output.panelKey || output.panel_key || "") === panelKey;
}
async function requestCurrentPackage(manifest, sourceHash, packVersion, runKey) {
  await assertClaimOwned();
  const workerSecret = String(process.env.WORKER_SECRET || "").trim();
  if (!workerSecret) {
    throw new StageFailure(
      "worker_secret_missing",
      "WORKER_SECRET is required for source-bound package retries",
      false
    );
  }
  const request = combinedSignal(6e5);
  try {
    const response = await fetch(
      `http://127.0.0.1:${process.env.PORT || "3001"}/package-pack`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${workerSecret}`
        },
        body: JSON.stringify({
          jobId: manifest.panelizerJobId,
          sourceHash,
          packVersion,
          runKey,
          revisionId: manifest.revisionId,
          enticePackId: manifest.enticePackId,
          dimensionManifestId: manifest.dimensionManifestId,
          manifestHash: manifest.manifestHash,
          sourceContractHash: manifest.sourceContractHash,
          packIdentityHash: manifest.packIdentityHash,
          force: false
        }),
        signal: request.signal
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new StageFailure(
        "package_request_failed",
        String(
          payload?.error || `Worker package request failed with HTTP ${response.status}`
        ),
        true,
        20,
        { status: response.status, payload }
      );
    }
    return payload && typeof payload === "object" ? payload : {};
  } catch (error) {
    if (error instanceof StageFailure) throw error;
    throw new StageFailure(
      "package_request_transport",
      String(error?.message || error),
      true,
      20
    );
  } finally {
    request.cancel();
  }
}
async function verifyPrintOutputs(runId, db) {
  const manifest = await stageOutput(
    db,
    runId,
    "resolve_manifest"
  );
  const pack = await stageOutput(db, runId, "verify_atomic_pack");
  await assertAtomicPackCurrent(runId, manifest, pack, db);
  const activation = await stageOutput(db, runId, "activate_print_worker");
  const sourceHash = String(activation.sourceHash || "");
  const packVersion = String(activation.packVersion || "");
  const runKey = String(activation.runKey || "");
  if (!sourceHash || !packVersion || !runKey) {
    throw new StageFailure(
      "worker_identity_missing",
      "Source-bound worker identity is incomplete",
      false
    );
  }
  const { data: panelizerJob, error } = await db.from("panelizer_jobs").select("concept_json,status,zip_storage_path,zip_signed_url").eq("id", manifest.panelizerJobId).maybeSingle();
  if (error || !panelizerJob) {
    throw new StageFailure(
      "worker_status_unavailable",
      error?.message || "Panelizer job disappeared while verifying output",
      true,
      20
    );
  }
  const concept = panelizerJob.concept_json && typeof panelizerJob.concept_json === "object" ? panelizerJob.concept_json : {};
  const worker = concept.print_worker || {};
  if (!matchesWorkerIdentity(worker, sourceHash, packVersion, runKey)) {
    throw new StageFailure(
      "worker_run_became_stale",
      "The active print-worker run no longer matches the frozen source",
      false,
      0,
      { sourceHash, packVersion, runKey }
    );
  }
  const expectedPanels = Array.isArray(activation.expectedPanels) ? activation.expectedPanels.map(String) : [];
  const currentManifest = Array.isArray(worker.activated) ? worker.activated.map(String) : [];
  const skipped = Array.isArray(worker.skipped) ? worker.skipped : [];
  if (expectedPanels.length === 0 || skipped.length > 0 || !sameStringSet(currentManifest, expectedPanels)) {
    throw new StageFailure(
      "worker_manifest_changed",
      "The current print-worker manifest is incomplete or no longer matches the frozen activation",
      false,
      0,
      { expectedPanels, currentManifest, skipped }
    );
  }
  const { data: dispatchRows, error: dispatchError } = await db.from("production_panel_dispatches").select(
    "panel_key,status,attempt,max_attempts,available_at,lease_expires_at,error,output,output_hash,completed_at"
  ).eq("production_job_id", manifest.productionJobId).eq("source_hash", sourceHash.toLowerCase()).eq("pack_version", packVersion.toLowerCase()).eq("run_key", runKey.toLowerCase()).in("panel_key", [...expectedPanels, "__package__"]);
  if (dispatchError) {
    throw new StageFailure(
      "dispatch_ledger_unavailable",
      dispatchError.message || "Durable print-dispatch ledger is unavailable",
      true,
      20
    );
  }
  const rowsByKey = new Map(
    (dispatchRows || []).map((row) => [String(row.panel_key), row])
  );
  const waitingPanels = expectedPanels.filter(
    (key) => !matchesDispatchOutput(
      rowsByKey.get(key),
      sourceHash,
      packVersion,
      runKey,
      key
    )
  );
  const packageRow = rowsByKey.get("__package__");
  const packageOutput = packageRow?.output && typeof packageRow.output === "object" ? packageRow.output : {};
  const zip = packageOutput.zip && typeof packageOutput.zip === "object" ? packageOutput.zip : packageOutput;
  const zipVerified = matchesDispatchOutput(
    packageRow,
    sourceHash,
    packVersion,
    runKey,
    "__package__"
  ) && !!String(zip?.path || "") && !!String(zip?.url || "") && /^[a-f0-9]{64}$/.test(String(zip?.sha256 || "").toLowerCase()) && String(zip.sha256 || "").toLowerCase() === String(packageRow?.output_hash || "").toLowerCase();
  if (waitingPanels.length || !zipVerified) {
    const now = Date.now();
    const activeLease = (row) => ["pending", "dispatched", "processing"].includes(
      String(row?.status || "")
    ) && Date.parse(String(row?.lease_expires_at || "")) > now;
    const exhaustedPanels = waitingPanels.filter((key) => {
      const row = rowsByKey.get(key);
      return !!row && !activeLease(row) && Number(row.attempt || 0) >= Number(row.max_attempts || 0);
    });
    if (exhaustedPanels.length) {
      throw new StageFailure(
        "print_dispatch_attempts_exhausted",
        `Print dispatch attempts exhausted for: ${exhaustedPanels.join(", ")}`,
        false,
        0,
        {
          exhaustedPanels,
          dispatches: exhaustedPanels.map((key) => {
            const row = rowsByKey.get(key);
            return {
              panelKey: key,
              status: row?.status || null,
              attempt: row?.attempt || 0,
              maxAttempts: row?.max_attempts || 0,
              error: row?.error || null
            };
          })
        }
      );
    }
    const retryEligiblePanels = waitingPanels.filter((key) => {
      const row = rowsByKey.get(key);
      if (!row) return true;
      if (activeLease(row)) return false;
      if (String(row.status || "") === "failed" && Date.parse(String(row.available_at || "")) > now) {
        return false;
      }
      return Number(row.attempt || 0) < Number(row.max_attempts || 0);
    });
    let reactivation = null;
    if (retryEligiblePanels.length) {
      await assertClaimOwned();
      reactivation = await callFn(
        "run-production-flow",
        {
          mode: "designpro_job",
          action: "advance_domain",
          productionJobId: manifest.productionJobId,
          workflowRunId: runId,
          userId: manifest.userId,
          sourceHash,
          packVersion,
          sourceProofUrl: pack.sourceProofUrl,
          expectedSides: pack.expectedSides,
          vaultJobId: pack.vaultJobId,
          packIdentityHash: pack.packIdentityHash,
          revisionId: pack.revisionId,
          enticePackId: pack.enticePackId,
          dimensionManifestId: pack.dimensionManifestId,
          manifestHash: pack.manifestHash,
          sourceContractHash: pack.sourceContractHash,
          artifactSetHash: pack.artifactSetHash,
          fingerprints: pack.fingerprints
        },
        7e4
      );
    }
    let packageRequest = null;
    if (waitingPanels.length === 0 && !zipVerified) {
      packageRequest = await requestCurrentPackage(
        manifest,
        sourceHash,
        packVersion,
        runKey
      );
    }
    throw new StageDeferred("Print outputs are still processing", 20, {
      waitingPanels,
      waitingForZip: waitingPanels.length === 0 && !zipVerified,
      completedPanels: expectedPanels.length - waitingPanels.length,
      expectedPanels: expectedPanels.length,
      retryEligiblePanels,
      reactivation,
      packageRequest
    });
  }
  return {
    output: {
      panelizerJobId: manifest.panelizerJobId,
      sourceHash,
      packVersion,
      runKey,
      revisionId: manifest.revisionId,
      enticePackId: manifest.enticePackId,
      dimensionManifestId: manifest.dimensionManifestId,
      manifestHash: manifest.manifestHash,
      sourceContractHash: manifest.sourceContractHash,
      packIdentityHash: manifest.packIdentityHash,
      expectedPanels,
      completedPanels: expectedPanels,
      zip,
      panelizerStatus: panelizerJob.status
    },
    verification: {
      verified: true,
      sourceBound: true,
      exactRevisionPinned: true,
      allExpectedPanelsComplete: true,
      zipCurrent: true,
      zipPath: zip.path,
      durableDispatchLedger: true
    }
  };
}
function manifestStageRows(runId, manifest) {
  return [
    {
      stage_key: "verify_atomic_pack",
      scope_key: "",
      sequence: 50,
      max_attempts: 1
    },
    {
      stage_key: "activate_print_worker",
      scope_key: "",
      sequence: 60,
      max_attempts: 3
    },
    {
      stage_key: "verify_print_outputs",
      scope_key: "",
      sequence: 70,
      max_attempts: 3
    },
    {
      stage_key: "await_admin_qc",
      scope_key: "",
      sequence: 80,
      max_attempts: 1
    }
  ].map((row) => ({
    ...row,
    run_id: runId,
    status: "pending",
    idempotency_key: `${manifest.inputHash}:${row.stage_key}:${row.scope_key}`,
    input_hash: manifest.inputHash,
    input: {
      productionJobId: manifest.productionJobId,
      panelizerJobId: manifest.panelizerJobId,
      generationId: manifest.generationId,
      expectedSides: manifest.expectedSides,
      sourceProofUrl: manifest.proofUrl,
      revisionId: manifest.revisionId,
      enticePackId: manifest.enticePackId,
      dimensionManifestId: manifest.dimensionManifestId,
      manifestHash: manifest.manifestHash,
      sourceContractHash: manifest.sourceContractHash,
      packIdentityHash: manifest.packIdentityHash,
      packVersion: manifest.packVersion
    }
  }));
}
function claimedRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data && data.id ? data : null;
}
async function processClaim(db, stage) {
  const label = `${stage.stage_key}:${stage.scope_key || "-"}`;
  const leaseController = new AbortController();
  const heartbeat = setInterval(async () => {
    try {
      const { data, error } = await db.rpc("heartbeat_workflow_stage", {
        p_stage_id: stage.id,
        p_lease_token: stage.lease_token,
        p_lease_seconds: 900
      });
      if (error || data !== true) {
        leaseController.abort();
        console.error(
          `[DESIGNPRO-WORKFLOW] lease heartbeat lost for ${label}`,
          error?.message || data
        );
      }
    } catch (error) {
      leaseController.abort();
      console.error(
        `[DESIGNPRO-WORKFLOW] heartbeat failed for ${label}`,
        error
      );
    }
  }, 3e4);
  heartbeat.unref?.();
  try {
    const result = await CLAIM_CONTEXT.run(
      {
        signal: leaseController.signal,
        controller: leaseController,
        db,
        stageId: stage.id,
        leaseToken: stage.lease_token
      },
      async () => await executeStage(db, {
        runId: stage.run_id,
        stageKey: stage.stage_key,
        scopeKey: stage.scope_key,
        attempt: stage.attempt,
        input: stage.input || {}
      })
    );
    if (stage.stage_key === "resolve_manifest") {
      const manifest = result.output;
      const { data: completed2, error: completeError2 } = await db.rpc(
        "complete_workflow_manifest_stage",
        {
          p_stage_id: stage.id,
          p_lease_token: stage.lease_token,
          p_output: result.output,
          p_verification: result.verification,
          p_output_hash: result.outputHash,
          p_children: manifestStageRows(stage.run_id, manifest),
          p_run_results: {
            productionJobId: manifest.productionJobId,
            panelizerJobId: manifest.panelizerJobId,
            generationId: manifest.generationId,
            sourceProofUrl: manifest.proofUrl,
            expectedSides: manifest.expectedSides,
            manifestVersion: manifest.builderVersion,
            sourceFingerprints: manifest.sourceFingerprints,
            revision_id: manifest.revisionId,
            entice_pack_id: manifest.enticePackId,
            dimension_manifest_id: manifest.dimensionManifestId,
            source_contract_hash: manifest.sourceContractHash,
            manifest_hash: manifest.manifestHash,
            pack_identity_hash: manifest.packIdentityHash,
            pack_version: manifest.packVersion
          }
        }
      );
      if (completeError2 || completed2 !== true) {
        throw new StageFailure(
          "manifest_completion_fenced",
          completeError2?.message || "Lease fencing rejected manifest graph installation",
          true,
          5
        );
      }
      console.log(`[DESIGNPRO-WORKFLOW] completed ${label}`);
      return;
    }
    const approvalStage = stage.stage_key === "verify_print_outputs";
    const rpcName = approvalStage ? "complete_workflow_stage_for_approval" : "complete_workflow_stage";
    const rpcArgs = {
      p_stage_id: stage.id,
      p_lease_token: stage.lease_token,
      p_output: result.output,
      p_verification: result.verification,
      p_output_hash: result.outputHash
    };
    if (approvalStage) {
      Object.assign(rpcArgs, {
        p_gate_stage_key: "await_admin_qc",
        p_approval_details: {
          workflowType: "designpro.production_pack",
          panelizerJobId: result.output.panelizerJobId,
          sourceHash: result.output.sourceHash,
          packVersion: result.output.packVersion,
          runKey: result.output.runKey,
          revisionId: result.output.revisionId,
          enticePackId: result.output.enticePackId,
          dimensionManifestId: result.output.dimensionManifestId,
          manifestHash: result.output.manifestHash,
          sourceContractHash: result.output.sourceContractHash,
          packIdentityHash: result.output.packIdentityHash
        }
      });
    }
    const { data: completed, error: completeError } = await db.rpc(
      rpcName,
      rpcArgs
    );
    if (completeError || completed !== true) {
      throw new StageFailure(
        "stage_completion_fenced",
        completeError?.message || `Lease fencing rejected completion for ${label}`,
        true,
        5
      );
    }
    console.log(`[DESIGNPRO-WORKFLOW] completed ${label}`);
  } catch (error) {
    if (error instanceof StageDeferred) {
      const { data: data2, error: deferError } = await db.rpc("defer_workflow_stage", {
        p_stage_id: stage.id,
        p_lease_token: stage.lease_token,
        p_delay_seconds: error.delaySeconds,
        p_reason: error.message,
        p_details: error.details
      });
      if (deferError || data2 !== true) {
        console.error(
          `[DESIGNPRO-WORKFLOW] unable to defer ${label}:`,
          deferError?.message || data2
        );
      }
      return;
    }
    const failure = error instanceof StageFailure ? error : new StageFailure(
      "stage_exception",
      String(error?.message || error),
      true,
      20
    );
    const { data, error: failError } = await db.rpc("fail_workflow_stage", {
      p_stage_id: stage.id,
      p_lease_token: stage.lease_token,
      p_error_code: failure.code,
      p_error_message: failure.message,
      p_error_details: failure.details,
      p_retryable: failure.retryable,
      p_retry_delay_seconds: failure.retryDelaySeconds
    });
    if (failError || data !== true) {
      console.error(
        `[DESIGNPRO-WORKFLOW] unable to fail ${label}:`,
        failError?.message || data
      );
    } else {
      console.error(`[DESIGNPRO-WORKFLOW] failed ${label}:`, failure.message);
    }
  } finally {
    clearInterval(heartbeat);
  }
}
var pollTimer = null;
var pollBusy = false;
var activeClaims = 0;
var maxActiveClaims = (() => {
  const configured = Number(
    process.env.DESIGNPRO_PRODUCTION_CONCURRENCY || 3
  );
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 3
    ? configured
    : 3;
})();
// A claimant that cannot authenticate to run-production-flow must not claim
// paid stages at all — it can only burn the run's attempt budget. Live case:
// the legacy worker deployment (stale env — no WORKER_SECRET, legacy JWT
// service key) raced the healthy droplet replicas and failed run 4122e09f's
// activate_print_worker attempt 2 with 401 "Authentication required"
// (2026-08-11 23:18 UTC). The probe verdict is cached and re-checked, so a
// repaired environment recovers on its own within five minutes.
const AUTH_PROBE_TTL_MS = 5 * 60_000;
let authProbe = { ok: null, checkedAt: 0 };
async function runnerCanAuthenticate() {
  const now = Date.now();
  if (authProbe.ok !== null && now - authProbe.checkedAt < AUTH_PROBE_TTL_MS) {
    return authProbe.ok;
  }
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/run-production-flow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        ...(process.env.WORKER_SECRET
          ? { "x-worker-secret": String(process.env.WORKER_SECRET).trim() }
          : {})
      },
      body: JSON.stringify({ mode: "designpro_job", action: "auth_probe" })
    });
    // ANY non-401/403 response proves the credential was accepted — the probe
    // action itself is unknown to the function and that is fine.
    const ok = response.status !== 401 && response.status !== 403;
    authProbe = { ok, checkedAt: now };
    if (!ok) {
      console.error(
        `[DESIGNPRO-WORKFLOW] refusing to claim: run-production-flow rejected this runner's credentials (HTTP ${response.status}). Set WORKER_SECRET (and a current service key) in this environment, or retire this claimant.`
      );
    }
    return ok;
  } catch (error) {
    // Transport failure is not an auth verdict: do not block a previously
    // healthy runner on it, and do not cache success from it either.
    console.error(
      `[DESIGNPRO-WORKFLOW] auth probe transport error: ${String(error?.message || error)}`
    );
    return authProbe.ok !== false;
  }
}
async function drainClaims(db, workerId) {
  if (pollBusy) return activeClaims;
  pollBusy = true;
  try {
    if (!(await runnerCanAuthenticate())) return activeClaims;
    while (activeClaims < maxActiveClaims) {
      const { data, error } = await db.rpc("claim_workflow_stage", {
        p_worker: workerId,
        p_lease_seconds: 900,
        p_workflow_type: "designpro.production_pack"
      });
      if (error) {
        console.error("[DESIGNPRO-WORKFLOW] claim failed:", error.message);
        break;
      }
      const stage = claimedRow(data);
      if (!stage) break;
      activeClaims += 1;
      void processClaim(db, stage).finally(() => {
        activeClaims -= 1;
        setTimeout(() => void drainClaims(db, workerId), 0);
      });
    }
    return activeClaims;
  } finally {
    pollBusy = false;
  }
}
function registerDesignProWorkflow(options) {
  if (pollTimer) return;
  SUPABASE_URL = options.supabaseUrl;
  SERVICE_KEY = options.serviceKey;
  SITE_URL = options.siteUrl || SITE_URL;
  const workerId = `designpro-production-pack:${
    process.env.DESIGNPRO_WORKER_ID ||
    process.env.HOSTNAME ||
    process.pid
  }`;
  options.app.post("/workflow/drain", (req, res) => {
    if (req.headers.authorization !== `Bearer ${options.workerSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    void drainClaims(options.supabase, workerId);
    return res.status(202).json({
      success: true,
      workflowType: "designpro.production_pack",
      activeClaims
    });
  });
  pollTimer = setInterval(
    () => void drainClaims(options.supabase, workerId),
    5e3
  );
  pollTimer.unref?.();
  void drainClaims(options.supabase, workerId);
  console.log(
    `[DESIGNPRO-WORKFLOW] durable stage claimant started as ${workerId}`
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  registerDesignProWorkflow
});
