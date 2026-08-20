import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const BUCKET = "wrap-files";
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const VIEW_KEYS = ["driver", "passenger", "hood", "roof", "front", "rear", "hero3d"];
const PREFLIGHT_CHECKS = [
  "dimensionsVerified",
  "sourceRegionsVerified",
  "fiveInchBleed",
  "panelHashesVerified",
  "logoInventoryVerified",
  "textLockVerified",
];
const FINAL_CHECKS = ["outputHashesVerified", "printDimensionsVerified", "colorModeVerified"];
const PRODUCTION_SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];
const VEHICLE_CLASSES = ["car", "truck", "suv", "van", "motorcycle", "boat", "bus", "rv", "trailer", "aircraft", "heavy_equipment"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ORDER_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CUSTOMER_REFERENCE_PATTERN = /^[^\u0000-\u001f\u007f]{1,160}$/;
const VERIFICATION_REFERENCE_PATTERN = /^[^\u0000-\u001f\u007f]{3,256}$/;
const MIME_EXTENSION = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
  ["application/pdf", "pdf"],
]);

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 1_000_000) throw Object.assign(new Error("request_too_large"), { status: 413 });
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
};

/** The exact bytes Stripe signed. JSON.parse first would change them. */
const readRawBody = async (req) => {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 1_000_000) throw Object.assign(new Error("request_too_large"), { status: 413 });
  }
  return text;
};

function cookies(req) {
  const result = {};
  for (const item of String(req.headers.cookie || "").split(";")) {
    const index = item.indexOf("=");
    if (index <= 0) continue;
    try {
      result[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
    } catch {
      // A malformed cookie is ignored and cannot become an authorization token.
    }
  }
  return result;
}

function config(env) {
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "");
  const appOrigin = String(env.DESIGNPRO_APP_ORIGIN || "").replace(/\/$/, "");
  // The canonical origin owns emailed links. Additional origins are browser
  // entry points that may also write -- the apex and www now serve the same SPA
  // against this same gateway, and a write from them was being rejected 403.
  const additionalOrigins = String(env.DESIGNPRO_ADDITIONAL_ORIGINS || "")
    .split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);
  const allowedOrigins = [...new Set([appOrigin, ...additionalOrigins].filter(Boolean))];
  const internalRuntimeUrl = String(env.DESIGNPRO_RUNTIME_INTERNAL_URL || "").replace(/\/$/, "");
  const workerSecret = String(env.WORKER_SECRET || "");
  // Checkout. Absent, the two purchase routes answer 503 and the buttons stay
  // dark -- the honest state for a deployment with no payment configured, and
  // far better than a button that opens a session nobody can pay.
  //
  // This process holds NO service role and must not: recording an entitlement
  // is privileged work, so it is forwarded to the runtime over the same
  // WORKER_SECRET channel the recipient binding already uses. The gateway's
  // whole job here is to talk to Stripe and to prove a delivery was signed.
  const stripeSecretKey = String(env.STRIPE_SECRET_KEY || "");
  const stripeWebhookSecret = String(env.STRIPE_WEBHOOK_SECRET || "");
  const production = env.NODE_ENV === "production";
  if (!supabaseUrl || !publishableKey || (production && (!appOrigin || !internalRuntimeUrl || workerSecret.length < 32))) throw new Error("gateway_config_missing");
  if (internalRuntimeUrl) {
    const target = new URL(internalRuntimeUrl);
    if (target.protocol !== "http:" || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
      throw new Error("gateway_internal_runtime_url_invalid");
    }
  }
  return { supabaseUrl, publishableKey, appOrigin, allowedOrigins, internalRuntimeUrl, workerSecret, production, stripeSecretKey, stripeWebhookSecret };
}

function encodeStoragePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function authHeaders(token, cfg, extra = {}) {
  return {
    apikey: cfg.publishableKey,
    authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function upstream(fetchImpl, url, init, token, cfg) {
  return fetchImpl(url, {
    ...init,
    headers: authHeaders(token, cfg, {
      "content-type": "application/json",
      ...(init?.headers || {}),
    }),
  });
}

function sessionCookies(payload, cfg) {
  const common = `HttpOnly; Path=/; SameSite=Strict${cfg.production ? "; Secure" : ""}`;
  return [
    `dp_session=${encodeURIComponent(payload.access_token)}; ${common}; Max-Age=${Number(payload.expires_in || 3600)}`,
    `dp_refresh=${encodeURIComponent(payload.refresh_token)}; ${common}; Max-Age=31536000`,
  ];
}

function clearSessionCookies(cfg) {
  const common = `HttpOnly; Path=/; SameSite=Strict${cfg.production ? "; Secure" : ""}; Max-Age=0`;
  return [`dp_session=; ${common}`, `dp_refresh=; ${common}`];
}

async function userFor(fetchImpl, token, cfg) {
  if (!token) return null;
  const response = await upstream(fetchImpl, `${cfg.supabaseUrl}/auth/v1/user`, { method: "GET" }, token, cfg);
  if (!response.ok) return null;
  return response.json();
}

async function authenticate(req, res, fetchImpl, cfg) {
  const jar = cookies(req);
  // The cookie session is primary. A Supabase access token presented as a
  // bearer header is also accepted so a client that already holds a supabase-js
  // session -- the migrated DesignProAI shell -- can call this API without a
  // second login. It is validated against Supabase by userFor() exactly like the
  // cookie value, so it grants nothing the cookie would not, and unlike a cookie
  // a bearer header is never attached automatically by a cross-site request.
  const header = String(req.headers.authorization || "");
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() || "";
  let token = jar.dp_session || bearer || "";
  let user = await userFor(fetchImpl, token, cfg);
  if (!user?.id && jar.dp_refresh) {
    const refreshed = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: cfg.publishableKey, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: jar.dp_refresh }),
    });
    const payload = await refreshed.json().catch(() => ({}));
    if (refreshed.ok && payload.access_token && payload.refresh_token) {
      token = payload.access_token;
      user = payload.user || await userFor(fetchImpl, token, cfg);
      res.setHeader("set-cookie", sessionCookies(payload, cfg));
    }
  }
  return user?.id && user.is_anonymous !== true && user.is_anonymous !== "true"
    ? { token, user } : null;
}

function assertSameOrigin(req, cfg) {
  if (!cfg.production || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method || "")) return;
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  const allowed = cfg.allowedOrigins?.length ? cfg.allowedOrigins : [cfg.appOrigin];
  if (!allowed.includes(origin)) throw Object.assign(new Error("origin_rejected"), { status: 403 });
}

function generationId(run) {
  return String(run?.results?.generationId || run?.results?.generation_id || run?.input?.generationId || run?.input?.generation_id || run.id);
}

function canonicalDesignId(value) {
  const generation = String(value || "").toLowerCase();
  if (!UUID_PATTERN.test(generation)) throw Object.assign(new Error("generation_id_invalid"), { status: 400 });
  return `DID-${generation.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function firstArtifactPath(output) {
  for (const key of ["deliveredZipPath", "manifestPath", "storagePath", "artifactPath"]) {
    const value = output?.[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function publicState(raw) {
  const run = raw.run || {};
  const stages = raw.stages || [];
  const waitingPreflight = stages.some((s) => s.stage_key === "await_panelpro_preflight_qc" && s.status === "waiting");
  const waitingFinal = stages.some((s) => s.stage_key === "await_final_human_qc" && s.status === "waiting");
  const failed = stages.find((s) => s.status === "failed");
  const active = stages.find((s) => ["running", "waiting", "retryable"].includes(s.status)) || [...stages].reverse().find((s) => s.status === "completed");
  return {
    generationId: generationId(run),
    revision: Number(run.results?.revision || run.input?.revision || 1),
    state: failed ? "failed" : waitingPreflight ? "waiting_for_preflight" : waitingFinal ? "waiting_for_final_qc" : run.status === "completed" ? "complete" : run.status === "queued" ? "queued" : "running",
    currentStage: String(active?.stage_key || run.status || "queued"),
    stages: stages.map((s) => ({
      key: s.stage_key,
      label: s.stage_key,
      state: s.status === "completed" ? "complete" : s.status === "failed" ? "failed" : ["running", "waiting"].includes(s.status) ? "running" : "pending",
      artifactPath: firstArtifactPath(s.output),
    })),
    failure: failed ? { stage: failed.stage_key, message: String(failed.error_message || "Stage failed"), retryable: failed.error_details?.retryable !== false } : undefined,
  };
}

async function listRuns(fetchImpl, token, cfg) {
  const fields = encodeURIComponent("id,workflow_type,status,results,input,revision_id,revision_snapshot_hash,artifact_set_hash,created_at");
  const types = encodeURIComponent("(designpro.entice_pack,designpro.production_pack)");
  const response = await upstream(fetchImpl, `${cfg.supabaseUrl}/rest/v1/designpro_workflow_runs?select=${fields}&workflow_type=in.${types}&order=created_at.desc&limit=100`, { method: "GET" }, token, cfg);
  if (!response.ok) throw Object.assign(new Error(`runs_query_${response.status}`), { status: response.status });
  return response.json();
}

async function businessIdentityForRun(fetchImpl, token, cfg, run) {
  const revisionId = String(run?.revision_id || "").toLowerCase();
  const snapshotHash = String(run?.revision_snapshot_hash || "").toLowerCase();
  if (!UUID_PATTERN.test(revisionId) || !SHA256_PATTERN.test(snapshotHash)) {
    throw Object.assign(new Error("run_revision_identity_missing"), { status: 409 });
  }
  const fields = encodeURIComponent("generation_id,snapshot");
  const response = await upstream(fetchImpl,
    `${cfg.supabaseUrl}/rest/v1/designpro_revision_sources?select=${fields}&revision_id=eq.${encodeURIComponent(revisionId)}&snapshot_hash=eq.${snapshotHash}&limit=1`,
    { method: "GET" }, token, cfg);
  if (!response.ok) throw Object.assign(new Error(`revision_identity_query_${response.status}`), { status: response.status });
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw Object.assign(new Error("immutable_revision_identity_missing"), { status: 409 });
  const generation = String(rows[0].generation_id || "").toLowerCase();
  const snapshot = rows[0].snapshot;
  const designId = canonicalDesignId(generation);
  const orderNumber = String(snapshot?.orderNumber || "");
  if (snapshot?.generationId !== generation || snapshot?.designId !== designId || !ORDER_NUMBER_PATTERN.test(orderNumber) || orderNumber.trim() !== orderNumber) {
    throw Object.assign(new Error("immutable_design_id_and_order_number_invalid"), { status: 409 });
  }
  return { designId, orderNumber };
}

function requestedRun(runs, requestedGenerationId) {
  return runs.find((run) => generationId(run) === requestedGenerationId || run.id === requestedGenerationId) || null;
}

function verifiedSourceEnticeRun(run, runs) {
  if (run.workflow_type !== "designpro.production_pack") return null;
  const sourceRunId = String(run.results?.sourceEnticeRunId || run.input?.sourceEnticeRunId || "");
  const source = runs.find((candidate) => candidate.id === sourceRunId && candidate.workflow_type === "designpro.entice_pack");
  if (!source) throw Object.assign(new Error("source_entice_run_not_found"), { status: 409 });
  for (const field of ["revision_id", "revision_snapshot_hash", "artifact_set_hash"]) {
    if (!run[field] || run[field] !== source[field]) {
      throw Object.assign(new Error("source_entice_identity_mismatch"), { status: 409 });
    }
  }
  return source;
}

async function runState(fetchImpl, token, cfg, run) {
  const runId = encodeURIComponent(run.id);
  const response = await upstream(fetchImpl, `${cfg.supabaseUrl}/rest/v1/designpro_workflow_stages?select=stage_key,status,output,error_message,error_details&run_id=eq.${runId}&order=sequence.asc`, { method: "GET" }, token, cfg);
  if (!response.ok) throw Object.assign(new Error(`stages_query_${response.status}`), { status: response.status });
  return { run, stages: await response.json() };
}

async function artifactsForRun(fetchImpl, token, cfg, runId) {
  const fields = encodeURIComponent("id,artifact_kind,surface_key,storage_path,content_hash,byte_size,metadata,created_at");
  const response = await upstream(fetchImpl, `${cfg.supabaseUrl}/rest/v1/designpro_artifacts?select=${fields}&run_id=eq.${encodeURIComponent(runId)}&order=created_at.asc`, { method: "GET" }, token, cfg);
  if (!response.ok) throw Object.assign(new Error(`artifacts_query_${response.status}`), { status: response.status });
  return response.json();
}

async function signedArtifactUrl(fetchImpl, token, cfg, storagePath) {
  const response = await upstream(fetchImpl, `${cfg.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${encodeStoragePath(storagePath)}`, { method: "POST", body: JSON.stringify({ expiresIn: 300 }) }, token, cfg);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.signedURL) throw Object.assign(new Error(payload.message || `artifact_sign_${response.status}`), { status: response.status });
  return payload.signedURL.startsWith("http") ? payload.signedURL : `${cfg.supabaseUrl}/storage/v1${payload.signedURL.startsWith("/") ? "" : "/"}${payload.signedURL}`;
}

function authorizedArtifactPath(storagePath, userId, runId) {
  if (!storagePath || storagePath.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(storagePath)) return false;
  const derivedPrefix = `designpro/user_${userId}/${runId}/`;
  const deliveryPrefix = `wrapbox/user_${userId}/`;
  return storagePath.startsWith(derivedPrefix) || storagePath.startsWith(deliveryPrefix) && storagePath.includes(`/${runId}/`);
}

// The approved Calls 1-7 renders are read in place from
// designpro_generation_views. They are never copied into designpro_artifacts:
// that table is the manufacturing record, and an approved customer render is
// not a manufacturing artifact. consumer_role is the locked Calls 1-7 side
// identity and already matches surface_key for the six production surfaces;
// "closeup" is not one, so it never reaches a panel row.
function authorizedGenerationViewPath(storagePath, userId, generationId) {
  if (!storagePath || storagePath.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(storagePath)) return false;
  return storagePath.startsWith(`designpro/user_${userId}/${generationId}/calls-1-7/`);
}

function authorizedFlatAtlasPath(storagePath, userId, generationId) {
  if (!storagePath || storagePath.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(storagePath)) return false;
  return storagePath.startsWith(
    `designpro/user_${userId}/${generationId}/flat-first/v1/`,
  );
}

function validatedFlatAtlasPanelMap(value, widthPx, heightPx, atlasEffectivePpi) {
  if (!Array.isArray(value) || value.length !== PRODUCTION_SURFACES.length) {
    throw Object.assign(new Error("flat_atlas_panel_map_invalid"), { status: 502 });
  }
  const seen = new Set();
  const bySurface = new Map();
  for (const panel of value) {
    const surfaceKey = String(panel?.surfaceKey || "");
    const trimWidthIn = panel?.trimWidthIn;
    const trimHeightIn = panel?.trimHeightIn;
    const printWidthIn = panel?.printWidthIn;
    const printHeightIn = panel?.printHeightIn;
    const surfaceSqFt = panel?.surfaceSqFt;
    const effectivePpi = panel?.effectivePpi;
    const rotationDegrees = panel?.rotationDegrees;
    const bleedIn = panel?.bleedIn;
    const pixelValues = [panel?.x, panel?.y, panel?.w, panel?.h];
    const hasAnyPixels = pixelValues.some((item) => item !== undefined);
    const hasAllPixels = pixelValues.every((item) => item !== undefined);
    const exactBleedKeys = bleedIn && typeof bleedIn === "object" && !Array.isArray(bleedIn)
      && JSON.stringify(Object.keys(bleedIn).sort())
        === JSON.stringify(["bottom", "left", "right", "top"]);
    const finitePhysicalValues = [
      trimWidthIn, trimHeightIn, printWidthIn, printHeightIn, surfaceSqFt,
      effectivePpi, rotationDegrees,
    ].every((item) => typeof item === "number" && Number.isFinite(item));
    if (!PRODUCTION_SURFACES.includes(surfaceKey) || seen.has(surfaceKey)
      || !finitePhysicalValues
      || !(trimWidthIn > 0 && trimWidthIn <= 1000)
      || !(trimHeightIn > 0 && trimHeightIn <= 1000)
      || !(printWidthIn > 0 && printWidthIn <= 1010)
      || !(printHeightIn > 0 && printHeightIn <= 1010)
      || Math.abs(printWidthIn - (trimWidthIn + 10)) > 0.001
      || Math.abs(printHeightIn - (trimHeightIn + 10)) > 0.001
      || !(surfaceSqFt > 0 && surfaceSqFt <= 7000)
      || Math.abs(surfaceSqFt - trimWidthIn * trimHeightIn / 144) > 0.011
      || !(effectivePpi > 0 && effectivePpi <= 32768)
      || ![-90, 0, 90].includes(rotationDegrees)
      || !exactBleedKeys
      || [bleedIn.top, bleedIn.right, bleedIn.bottom, bleedIn.left]
        .some((item) => typeof item !== "number" || item !== 5)
      || hasAnyPixels !== hasAllPixels
      || hasAllPixels && (
        !pixelValues.every(Number.isInteger)
        || panel.x < 0 || panel.y < 0 || panel.w < 1 || panel.h < 1
        || panel.x + panel.w > widthPx || panel.y + panel.h > heightPx
      )) {
      throw Object.assign(new Error("flat_atlas_panel_map_invalid"), { status: 502 });
    }
    seen.add(surfaceKey);
    bySurface.set(surfaceKey, {
      surfaceKey,
      trimWidthIn,
      trimHeightIn,
      printWidthIn,
      printHeightIn,
      bleedIn: { top: 5, right: 5, bottom: 5, left: 5 },
      surfaceSqFt,
      effectivePpi,
      rotationDegrees,
      ...(hasAllPixels ? { x: panel.x, y: panel.y, w: panel.w, h: panel.h } : {}),
    });
  }
  if (seen.size !== PRODUCTION_SURFACES.length
    || PRODUCTION_SURFACES.some((surface) => !seen.has(surface))) {
    throw Object.assign(new Error("flat_atlas_panel_map_invalid"), { status: 502 });
  }
  const panels = PRODUCTION_SURFACES.map((surface) => bySurface.get(surface));
  const minimumPpi = Math.min(...panels.map((panel) => panel.effectivePpi));
  if (Math.abs(minimumPpi - atlasEffectivePpi) > 0.011) {
    throw Object.assign(new Error("flat_atlas_panel_map_invalid"), { status: 502 });
  }
  return panels;
}

function validatedFlatFirstGate(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.flatFirst !== "boolean"
    || typeof value.productionEligible !== "boolean"
    || value.revisionId !== null
      && !UUID_PATTERN.test(String(value.revisionId || ""))) {
    throw Object.assign(new Error("flat_first_gate_invalid"), { status: 502 });
  }
  return {
    flatFirst: value.flatFirst,
    productionEligible: value.productionEligible,
    revisionId: value.revisionId === null ? null : String(value.revisionId),
  };
}

function validatedFlatAtlasRevisions(value, requestId, userId) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 100) {
    throw Object.assign(new Error("flat_atlas_response_invalid"), { status: 502 });
  }
  const surfaceAllowlist = new Set(["driver", "passenger", "hood", "roof", "front", "rear"]);
  let previousSequence = 0;
  return value.map((row) => {
    const id = String(row?.id || "");
    const rowRequestId = String(row?.requestId || "");
    const generationId = String(row?.generationId || "");
    const parentRevisionId = row?.parentRevisionId == null ? null : String(row.parentRevisionId);
    const revisionSequence = Number(row?.revisionSequence);
    const widthPx = Number(row?.widthPx);
    const heightPx = Number(row?.heightPx);
    const effectivePpi = Number(row?.effectivePpi);
    const guideStoragePath = String(row?.guideStoragePath || "");
    const masterStoragePath = String(row?.masterStoragePath || "");
    const projectionStoragePath = String(row?.projectionStoragePath || "");
    const projectionContentHash = String(row?.projectionContentHash || "");
    const guideContentHash = String(row?.guideContentHash || "");
    const masterContentHash = String(row?.masterContentHash || "");
    const masterExtension = new Map([
      ["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"],
    ]).get(row?.masterContentType);
    const atlasPrefix = `designpro/user_${userId}/${generationId}/flat-first/v1`;
    const affectedSurfaces = row?.affectedSurfaces;
    const exampleGuideHash = row?.exampleGuideHash == null ? null : String(row.exampleGuideHash);
    const exampleMasterHash = row?.exampleMasterHash == null ? null : String(row.exampleMasterHash);
    if (!UUID_PATTERN.test(id) || rowRequestId !== requestId
      || !UUID_PATTERN.test(generationId)
      || parentRevisionId !== null && !UUID_PATTERN.test(parentRevisionId)
      || !Number.isInteger(revisionSequence) || revisionSequence !== previousSequence + 1
      || revisionSequence === 1 && parentRevisionId !== null
      || revisionSequence > 1 && parentRevisionId === null
      || !Number.isInteger(widthPx) || widthPx < 256 || widthPx > 32768
      || !Number.isInteger(heightPx) || heightPx < 256 || heightPx > 32768
      || !Number.isFinite(effectivePpi) || effectivePpi <= 0
      || !SHA256_PATTERN.test(guideContentHash)
      || !SHA256_PATTERN.test(String(row?.manifestContentHash || ""))
      || !SHA256_PATTERN.test(masterContentHash)
      || !SHA256_PATTERN.test(projectionContentHash)
      || row?.guideContentType !== "image/png"
      || row?.manifestContentType !== "application/json"
      || !["image/png", "image/jpeg", "image/webp"].includes(row?.masterContentType)
      || row?.projectionContentType !== "image/jpeg"
      || !Number.isSafeInteger(Number(row?.guideByteSize)) || Number(row.guideByteSize) < 1
      || !Number.isSafeInteger(Number(row?.manifestByteSize)) || Number(row.manifestByteSize) < 1
      || !Number.isSafeInteger(Number(row?.masterByteSize)) || Number(row.masterByteSize) < 1
      || !Number.isSafeInteger(Number(row?.projectionByteSize))
      || Number(row.projectionByteSize) < 1 || Number(row.projectionByteSize) > 12 * 1024 * 1024
      || !authorizedFlatAtlasPath(guideStoragePath, userId, generationId)
      || !authorizedFlatAtlasPath(masterStoragePath, userId, generationId)
      || !authorizedFlatAtlasPath(projectionStoragePath, userId, generationId)
      || guideStoragePath !== `${atlasPrefix}/guide/${guideContentHash}.png`
      || masterStoragePath !== `${atlasPrefix}/revisions/${revisionSequence}`
        + `/master/${masterContentHash}.${masterExtension || "invalid"}`
      || projectionStoragePath !== `designpro/user_${userId}/${generationId}`
        + `/flat-first/v1/revisions/${revisionSequence}/projection/${projectionContentHash}.jpg`
      || !Array.isArray(affectedSurfaces) || affectedSurfaces.length < 1
      || affectedSurfaces.length > 6
      || affectedSurfaces.some((surface) => !surfaceAllowlist.has(String(surface)))
      || !String(row?.model || "").trim()
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(String(row?.promptVersion || ""))
      || typeof row?.productionEligible !== "boolean"
      || typeof row?.exampleUsed !== "boolean"
      || row.exampleUsed !== (exampleGuideHash !== null && exampleMasterHash !== null)
      || exampleGuideHash !== null && !SHA256_PATTERN.test(exampleGuideHash)
      || exampleMasterHash !== null && !SHA256_PATTERN.test(exampleMasterHash)) {
      throw Object.assign(new Error("flat_atlas_response_invalid"), { status: 502 });
    }
    const panelMap = validatedFlatAtlasPanelMap(
      row.panelMap, widthPx, heightPx, effectivePpi,
    );
    previousSequence = revisionSequence;
    return {
      id,
      revisionSequence,
      parentRevisionId,
      generationId,
      guideStoragePath,
      masterStoragePath,
      projectionStoragePath,
      guide: {
        contentHash: guideContentHash,
        contentType: String(row.guideContentType),
        byteSize: Number(row.guideByteSize),
        widthPx,
        heightPx,
      },
      manifest: {
        contentHash: String(row.manifestContentHash),
        contentType: String(row.manifestContentType),
        byteSize: Number(row.manifestByteSize),
      },
      master: {
        contentHash: masterContentHash,
        contentType: String(row.masterContentType),
        byteSize: Number(row.masterByteSize),
        widthPx,
        heightPx,
        effectivePpi,
      },
      projection: {
        contentHash: projectionContentHash,
        contentType: "image/jpeg",
        byteSize: Number(row.projectionByteSize),
      },
      model: String(row.model),
      promptVersion: String(row.promptVersion),
      affectedSurfaces: affectedSurfaces.map(String),
      panelMap,
      instruction: row.instruction == null ? null : String(row.instruction).slice(0, 4000),
      productionEligible: row.productionEligible,
      exampleUsed: row.exampleUsed,
      exampleGuideHash,
      exampleMasterHash,
      createdAt: row.createdAt,
    };
  });
}

// Ownership is enforced three times over, because a render from another
// DesignID beside this panel is the failure this endpoint exists to prevent:
// the generation id comes from THIS run's own immutable revision snapshot, the
// request row must be owned by the caller, and the storage path must sit
// inside that same owner/generation prefix.
async function approvedViewsForRun(fetchImpl, token, cfg, run, userId) {
  const revisionId = String(run?.revision_id || "").toLowerCase();
  const snapshotHash = String(run?.revision_snapshot_hash || "").toLowerCase();
  if (!UUID_PATTERN.test(revisionId) || !SHA256_PATTERN.test(snapshotHash)) {
    throw Object.assign(new Error("run_revision_identity_missing"), { status: 409 });
  }
  const revisionResponse = await upstream(fetchImpl,
    `${cfg.supabaseUrl}/rest/v1/designpro_revision_sources?select=${encodeURIComponent("generation_id")}&revision_id=eq.${encodeURIComponent(revisionId)}&snapshot_hash=eq.${snapshotHash}&limit=1`,
    { method: "GET" }, token, cfg);
  if (!revisionResponse.ok) throw Object.assign(new Error(`revision_identity_query_${revisionResponse.status}`), { status: revisionResponse.status });
  const revisionRows = await revisionResponse.json();
  if (!Array.isArray(revisionRows) || revisionRows.length !== 1) {
    throw Object.assign(new Error("immutable_revision_identity_missing"), { status: 409 });
  }
  const generation = String(revisionRows[0].generation_id || "").toLowerCase();
  if (!UUID_PATTERN.test(generation)) throw Object.assign(new Error("immutable_revision_identity_missing"), { status: 409 });

  const requestResponse = await upstream(fetchImpl,
    `${cfg.supabaseUrl}/rest/v1/designpro_generation_requests?select=${encodeURIComponent("id")}&generation_id=eq.${encodeURIComponent(generation)}&owner_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: "GET" }, token, cfg);
  if (!requestResponse.ok) throw Object.assign(new Error(`generation_request_query_${requestResponse.status}`), { status: requestResponse.status });
  const requestRows = await requestResponse.json();
  if (!Array.isArray(requestRows) || requestRows.length !== 1) return [];

  const fields = encodeURIComponent("id,consumer_role,source_view_type,storage_path,content_hash,byte_size,content_type");
  const viewResponse = await upstream(fetchImpl,
    `${cfg.supabaseUrl}/rest/v1/designpro_generation_views?select=${fields}&request_id=eq.${encodeURIComponent(String(requestRows[0].id))}&order=consumer_role.asc`,
    { method: "GET" }, token, cfg);
  if (!viewResponse.ok) throw Object.assign(new Error(`generation_views_query_${viewResponse.status}`), { status: viewResponse.status });
  const rows = await viewResponse.json();
  if (!Array.isArray(rows)) return [];

  const views = [];
  for (const row of rows) {
    const surfaceKey = String(row.consumer_role || "");
    if (!PRODUCTION_SURFACES.includes(surfaceKey)) continue;
    const storagePath = String(row.storage_path || "");
    if (!authorizedGenerationViewPath(storagePath, userId, generation)) continue;
    views.push({
      id: String(row.id),
      generationId: generation,
      surfaceKey,
      sourceViewType: String(row.source_view_type || ""),
      storagePath,
      contentHash: String(row.content_hash),
      byteSize: row.byte_size == null ? null : Number(row.byte_size),
      contentType: String(row.content_type || ""),
      signedUrl: await signedArtifactUrl(fetchImpl, token, cfg, storagePath),
      expiresIn: 300,
    });
  }
  return views;
}

async function resolveRun(fetchImpl, token, cfg, requestedGenerationId) {
  const runs = await listRuns(fetchImpl, token, cfg);
  return requestedRun(runs, requestedGenerationId);
}

async function rpc(fetchImpl, token, cfg, name, body) {
  const response = await upstream(fetchImpl, `${cfg.supabaseUrl}/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) }, token, cfg);
  const payload = await response.json().catch(() => ({ error: `invalid_${name}_response` }));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || `${name}_${response.status}`), { status: response.status });
  return payload;
}


/**
 * THE TWO PRODUCTS, PRICED AS THE WORKING SYSTEM PRICED THEM.
 *
 * The identifiers, prices and metadata are the proven ones:
 * `create-print-pack-checkout`'s clean `print_pack_entitlement` at $299, and
 * `create-single-use-checkout`'s `logo_pack` at $29. The obsolete
 * `print_production_pack` is deliberately absent -- its own source describes it
 * as the path that kicks the old re-slice pipeline.
 *
 * Listed here rather than accepted from the caller, because a price that
 * arrives from a browser is a price the customer chose.
 * They are listed here rather than passed in because a price that arrives from
 * a browser is a price the customer chose.
 */
const PURCHASE_PRODUCTS = Object.freeze({
  print_pack_entitlement: Object.freeze({
    productType: "print_pack_entitlement",
    name: "Print-Ready Production Pack",
    description: "Six print-ready production panels, upscaled, QC'd by the design team, and delivered as a production ZIP.",
    amountCents: 29900,
  }),
  logo_pack: Object.freeze({
    productType: "logo_pack",
    name: "Logo Pack — separated logo & lettering assets",
    description: "Every logo and lettering element lifted clean off your approved design, upscaled and QC'd.",
    amountCents: 2900,
  }),
});

/** Stripe wants form encoding, and this is the whole of what we send it. */
function stripeForm(fields) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") params.append(key, String(value));
  }
  return params;
}

async function stripeCall(fetchImpl, cfg, path, form) {
  const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.stripeSecretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload?.error?.message || `stripe_${response.status}`), { status: 502 });
  }
  return payload;
}

/**
 * A webhook is only trusted when it is signed. Stripe's scheme is an HMAC over
 * "timestamp.rawBody" with the endpoint secret, compared in constant time, and
 * with the timestamp checked so a captured delivery cannot be replayed later.
 * An unsigned or stale delivery confirms nothing -- it would otherwise be a way
 * to grant a paid entitlement for free.
 */
function verifiedStripeEvent(rawBody, signatureHeader, secret, nowSeconds) {
  const parts = String(signatureHeader || "").split(",").map((piece) => piece.trim());
  const timestamp = parts.find((piece) => piece.startsWith("t="))?.slice(2) || "";
  const signatures = parts.filter((piece) => piece.startsWith("v1=")).map((piece) => piece.slice(3));
  if (!/^\d{1,12}$/.test(timestamp) || !signatures.length) return null;
  if (Math.abs(nowSeconds - Number(timestamp)) > 300) return null;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBytes = Buffer.from(expected, "utf8");
  const matched = signatures.some((candidate) => {
    const candidateBytes = Buffer.from(candidate, "utf8");
    return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
  });
  if (!matched) return null;
  try { return JSON.parse(rawBody); } catch { return null; }
}

function validatedRecipientRequest(body) {
  const exactKeys = ["customerEmail", "customerReference", "designName", "orderNumber", "verificationReference"];
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(exactKeys)) {
    throw Object.assign(new Error("delivery_recipient_request_invalid"), { status: 400 });
  }
  const customerEmail = String(body.customerEmail || "").trim().toLowerCase();
  const customerReference = String(body.customerReference || "").trim();
  const verificationReference = String(body.verificationReference || "").trim();
  const orderNumber = String(body?.orderNumber || "").trim();
  const designName = String(body?.designName || "").trim();
  if (!EMAIL_PATTERN.test(customerEmail) || customerEmail.length > 320 ||
    !CUSTOMER_REFERENCE_PATTERN.test(customerReference) ||
    !VERIFICATION_REFERENCE_PATTERN.test(verificationReference) ||
    !ORDER_NUMBER_PATTERN.test(orderNumber) ||
    designName.length < 1 || designName.length > 240) {
    throw Object.assign(new Error("delivery_recipient_request_invalid"), { status: 400 });
  }
  // The browser provides an ordinary order/payment reference. It is converted
  // to a one-way identity at the HTTPS gateway and is never logged, returned,
  // forwarded in raw form, or persisted by any DesignPro service.
  const verificationRefHash = createHash("sha256").update(verificationReference, "utf8").digest("hex");
  return { customerEmail, customerReference, verificationRefHash, orderNumber, designName };
}

/**
 * Privileged purchase writes go to the runtime, never from here.
 *
 * Same channel and same reasoning as the recipient binding below: this process
 * is browser-facing, so it holds no service role. It proves the Stripe delivery
 * was signed and forwards the decision; the runtime is what may write it.
 */
async function purchaseThroughRuntime(fetchImpl, cfg, action, payload) {
  if (!cfg.internalRuntimeUrl || cfg.workerSecret.length < 32) {
    throw Object.assign(new Error("purchase_service_unavailable"), { status: 503 });
  }
  const response = await fetchImpl(`${cfg.internalRuntimeUrl}/internal/purchases/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.workerSecret}` },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.error || "purchase_write_failed"),
      { status: response.status >= 400 && response.status < 500 ? 400 : 503 });
  }
  return body;
}

async function registerRecipientThroughRuntime(fetchImpl, cfg, operatorId, body) {
  if (!cfg.internalRuntimeUrl || cfg.workerSecret.length < 32) {
    throw Object.assign(new Error("recipient_service_unavailable"), { status: 503 });
  }
  const request = validatedRecipientRequest(body);
  const response = await fetchImpl(`${cfg.internalRuntimeUrl}/internal/wrapbox/recipient`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.workerSecret}`,
    },
    body: JSON.stringify({
      operatorId,
      customerEmail: request.customerEmail,
      customerReference: request.customerReference,
      verificationRefHash: request.verificationRefHash,
      orderNumber: request.orderNumber,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error("recipient_binding_failed"), { status: response.status >= 400 && response.status < 500 ? 400 : 503 });
  const customerEmail = String(payload.customerEmail || "");
  const customerId = String(payload.customerId || "").toLowerCase();
  const recipientIdentityHash = String(payload.recipientIdentityHash || "").toLowerCase();
  const emailVerifiedAt = String(payload.emailVerifiedAt || "");
  if (!UUID_PATTERN.test(customerId) || String(payload.orderNumber || "") !== request.orderNumber ||
    customerEmail !== request.customerEmail ||
    !SHA256_PATTERN.test(recipientIdentityHash) || !Number.isFinite(Date.parse(emailVerifiedAt))) {
    throw Object.assign(new Error("recipient_binding_response_invalid"), { status: 502 });
  }
  return {
    delivery: {
      contractVersion: "designpro.wrapbox-recipient.v1",
      customerId,
      customerEmail,
      recipientIdentityHash,
      orderNumber: request.orderNumber,
      designName: request.designName,
    },
    emailVerifiedAt,
    idempotent: payload.idempotent === true,
  };
}

function validFrozenDelivery(delivery) {
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery) ||
    Object.keys(delivery).sort().join(",") !== "contractVersion,customerEmail,customerId,designName,orderNumber,recipientIdentityHash") return false;
  const customerEmail = String(delivery.customerEmail || "");
  return delivery.contractVersion === "designpro.wrapbox-recipient.v1" &&
    UUID_PATTERN.test(String(delivery.customerId || "")) &&
    customerEmail === customerEmail.toLowerCase().trim() && /^\S+@\S+\.\S+$/.test(customerEmail) &&
    SHA256_PATTERN.test(String(delivery.recipientIdentityHash || "")) &&
    ORDER_NUMBER_PATTERN.test(String(delivery.orderNumber || "")) && String(delivery.orderNumber || "").trim() === delivery.orderNumber &&
    String(delivery.designName || "").trim() === delivery.designName && delivery.designName.length >= 1 && delivery.designName.length <= 240;
}

const WRAPBOX_FIELDS = "id,run_id,operator_id,customer_id,customer_auth_user_id,revision_id,entice_pack_id,tenant_key,design_id,order_number,design_name,zip_storage_path,zip_content_hash,zip_byte_size,manifest_storage_path,manifest_content_hash,manifest_byte_size,logo_inventory,delivery_receipt_hash,ready_at,created_at";

async function wrapboxRows(fetchImpl, token, cfg, packId = null) {
  const filter = packId ? `&id=eq.${encodeURIComponent(packId)}&limit=1` : "&order=ready_at.desc&limit=100";
  const response = await upstream(fetchImpl, `${cfg.supabaseUrl}/rest/v1/designpro_wrapbox_packs?select=${encodeURIComponent(WRAPBOX_FIELDS)}${filter}`, { method: "GET" }, token, cfg);
  if (!response.ok) throw Object.assign(new Error(`wrapbox_query_${response.status}`), { status: response.status });
  return response.json();
}

function publicWrapboxPack(row) {
  if (!/^DID-[0-9A-F]{8}$/.test(String(row.design_id || "")) ||
    !ORDER_NUMBER_PATTERN.test(String(row.order_number || "")) ||
    String(row.order_number || "").trim() !== String(row.order_number || "")) {
    throw Object.assign(new Error("wrapbox_business_identity_invalid"), { status: 502 });
  }
  return {
    id: String(row.id),
    runId: String(row.run_id),
    revisionId: String(row.revision_id),
    enticePackId: String(row.entice_pack_id),
    designId: String(row.design_id),
    orderNumber: String(row.order_number),
    designName: String(row.design_name),
    zip: { contentHash: String(row.zip_content_hash), byteSize: Number(row.zip_byte_size) },
    manifest: { contentHash: String(row.manifest_content_hash), byteSize: Number(row.manifest_byte_size) },
    logoInventory: Array.isArray(row.logo_inventory) ? row.logo_inventory : [],
    readyAt: String(row.ready_at),
  };
}

async function publicWrapboxDetail(fetchImpl, token, cfg, row) {
  const result = publicWrapboxPack(row);
  return {
    ...result,
    zip: { ...result.zip, signedUrl: await signedArtifactUrl(fetchImpl, token, cfg, String(row.zip_storage_path)), expiresIn: 300 },
    manifest: { ...result.manifest, signedUrl: await signedArtifactUrl(fetchImpl, token, cfg, String(row.manifest_storage_path)), expiresIn: 300 },
  };
}

function exactQc(body, gate) {
  const required = gate === "preflight" ? PREFLIGHT_CHECKS : FINAL_CHECKS;
  const qc = body?.qc;
  if (!qc || typeof qc !== "object" || Array.isArray(qc)) return null;
  if (required.some((key) => qc[key] !== true)) return null;
  return Object.fromEntries([
    ["known", true],
    ["pass", true],
    ...required.map((key) => [key, true]),
    ["notes", String(body.notes || "").trim().slice(0, 2000)],
  ]);
}

function approvalRef(runId, stageKey, actor, qc) {
  const hash = createHash("sha256").update(JSON.stringify({ runId, stageKey, actor, qc })).digest("hex");
  return `designpro-qc:${stageKey}:${hash}`;
}

function validateAssetIdentity(value, userId, revisionId, expectedKind) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const contentHash = String(value.contentHash || "");
  const contentType = String(value.contentType || "").toLowerCase();
  const extension = MIME_EXTENSION.get(contentType);
  if (!/^[0-9a-f]{64}$/.test(contentHash) || !extension) return false;
  const expectedPath = `users/${userId}/revisions/${revisionId}/inputs/${expectedKind}/${contentHash}.${extension}`;
  if (String(value.storagePath || "") !== expectedPath) return false;
  if (!Number.isInteger(value.byteSize) || value.byteSize < 1 || value.byteSize > MAX_ASSET_BYTES) return false;
  return true;
}

function validateUploadIntent(body) {
  const revisionId = String(body.revisionId || "");
  const kind = String(body.kind || "");
  const contentHash = String(body.contentHash || "").toLowerCase();
  const contentType = String(body.contentType || "").toLowerCase();
  const byteSize = Number(body.byteSize);
  const kindAllowed = VIEW_KEYS.includes(kind) || kind === "logo" || kind === "attachment";
  const typeAllowed = MIME_EXTENSION.has(contentType) && (!VIEW_KEYS.includes(kind) || contentType.startsWith("image/") && contentType !== "image/svg+xml");
  if (!/^[0-9a-f-]{36}$/.test(revisionId) || !kindAllowed || !typeAllowed || !/^[0-9a-f]{64}$/.test(contentHash) || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_ASSET_BYTES) {
    throw Object.assign(new Error("asset_intent_invalid"), { status: 400 });
  }
  return { revisionId, kind, contentHash, contentType, byteSize, extension: MIME_EXTENSION.get(contentType) };
}

function validatedGenieSurfaces(body) {
  const surfaces = body?.surfaces;
  if (!surfaces || typeof surfaces !== "object" || Array.isArray(surfaces) || Object.keys(surfaces).length !== PRODUCTION_SURFACES.length) return null;
  const normalized = {};
  for (const surface of PRODUCTION_SURFACES) {
    const widthInches = Number(surfaces[surface]?.widthInches);
    const heightInches = Number(surfaces[surface]?.heightInches);
    if (!Number.isFinite(widthInches) || !Number.isFinite(heightInches) || widthInches <= 0 || heightInches <= 0 || widthInches > 1000 || heightInches > 1000) return null;
    normalized[surface] = { widthInches, heightInches };
  }
  return { contractVersion: "designpro.genie-validated-surfaces.v1", surfaces: normalized };
}

function genieEvidence(body) {
  const evidence = body?.evidence;
  if (!evidence || evidence.sourceReviewed !== true || evidence.sourceUrlsReviewed !== true || evidence.operatorAttestation !== true) return null;
  return {
    contractVersion: "designpro.genie-validation-evidence.v1",
    sourceReviewed: true,
    sourceUrlsReviewed: true,
    operatorAttestation: true,
    notes: String(body.notes || "").trim().slice(0, 2000),
  };
}

function publicGenieCandidate(row) {
  const urls = row?.sourceUrls || row?.source_urls;
  const runs = row?.requestedRuns || row?.requested_runs;
  const confidenceValue = row?.confidence;
  const confidence = typeof confidenceValue === "string"
    ? ({ high: 0.95, medium: 0.7, low: 0.4 }[confidenceValue.toLowerCase()] ?? null)
    : confidenceValue == null || !Number.isFinite(Number(confidenceValue)) ? null : Number(confidenceValue);
  return {
    id: String(row?.candidateId || row?.candidate_id || row?.id || ""),
    vehicleClass: row?.vehicleClass ?? row?.vehicle_class ?? null,
    make: String(row?.make || ""),
    model: String(row?.model || ""),
    year: row?.year == null ? null : Number(row.year),
    subType: row?.subType ?? row?.sub_type ?? null,
    source: String(row?.source || "unknown"),
    sourceUrls: Array.isArray(urls) ? urls.map(String).filter((value) => value.startsWith("https://")) : [],
    confidence,
    requestedRuns: Array.isArray(runs)
      ? runs.map((item) => ({ runId: String(item.runId || item.run_id || ""), generationId: item.generationId || item.generation_id || undefined })).filter((item) => item.runId)
      : row?.runId || row?.run_id ? [{ runId: String(row.runId || row.run_id), generationId: row.generationId || row.generation_id || undefined }] : [],
  };
}

async function createUploadIntent(fetchImpl, token, cfg, userId, body) {
  const intent = validateUploadIntent(body);
  const storagePath = `users/${userId}/revisions/${intent.revisionId}/inputs/${intent.kind}/${intent.contentHash}.${intent.extension}`;
  const response = await upstream(fetchImpl, `${cfg.supabaseUrl}/storage/v1/object/upload/sign/${BUCKET}/${encodeStoragePath(storagePath)}`, { method: "POST", body: "{}" }, token, cfg);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url) throw Object.assign(new Error(payload.message || `storage_sign_${response.status}`), { status: response.status });
  const signedUrl = payload.url.startsWith("http") ? payload.url : `${cfg.supabaseUrl}/storage/v1${payload.url.startsWith("/") ? "" : "/"}${payload.url}`;
  return {
    signedUrl,
    asset: { storagePath, contentHash: intent.contentHash, byteSize: intent.byteSize, contentType: intent.contentType },
  };
}

async function verifyStoredAsset(fetchImpl, token, cfg, userId, asset) {
  const path = String(asset.storagePath || "");
  if (!path.startsWith(`users/${userId}/revisions/`) || path.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(path)) {
    throw Object.assign(new Error("asset_path_rejected"), { status: 403 });
  }
  const expectedHash = String(asset.contentHash || "").toLowerCase();
  const expectedBytes = Number(asset.byteSize);
  const expectedContentType = String(asset.contentType || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedHash) || !Number.isInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > MAX_ASSET_BYTES || !MIME_EXTENSION.has(expectedContentType)) {
    throw Object.assign(new Error("asset_identity_invalid"), { status: 400 });
  }
  const response = await fetchImpl(`${cfg.supabaseUrl}/storage/v1/object/${BUCKET}/${encodeStoragePath(path)}`, {
    method: "GET",
    headers: authHeaders(token, cfg, { "cache-control": "no-store" }),
  });
  if (!response.ok || !response.body) throw Object.assign(new Error(`asset_download_${response.status}`), { status: response.status });
  const observedContentType = String(response.headers.get("content-type") || "").toLowerCase().split(";", 1)[0].trim();
  if (observedContentType !== expectedContentType) throw Object.assign(new Error("asset_content_type_mismatch"), { status: 409 });
  const hash = createHash("sha256");
  let observedBytes = 0;
  for await (const chunk of response.body) {
    observedBytes += chunk.byteLength;
    if (observedBytes > MAX_ASSET_BYTES) throw Object.assign(new Error("asset_too_large"), { status: 413 });
    hash.update(chunk);
  }
  const observedHash = hash.digest("hex");
  if (observedBytes !== expectedBytes || observedHash !== expectedHash) throw Object.assign(new Error("asset_identity_mismatch"), { status: 409 });
  return { ...asset, verified: true };
}

async function validateRevisionAssets(fetchImpl, token, cfg, userId, body) {
  const assets = body.renderAssets;
  if (!assets || typeof assets !== "object" || Array.isArray(assets) || Object.keys(assets).length !== VIEW_KEYS.length) {
    throw Object.assign(new Error("seven_render_assets_required"), { status: 400 });
  }
  const hashes = new Set();
  for (const key of VIEW_KEYS) {
    if (!validateAssetIdentity(assets[key], userId, body.revisionId, key)) throw Object.assign(new Error(`render_asset_invalid:${key}`), { status: 400 });
    await verifyStoredAsset(fetchImpl, token, cfg, userId, assets[key]);
    hashes.add(assets[key].contentHash);
  }
  if (hashes.size !== VIEW_KEYS.length) throw Object.assign(new Error("seven_render_assets_must_be_distinct"), { status: 409 });
  const logos = body.revisionSnapshot?.expectedLogoInventory;
  const attestation = body.revisionSnapshot?.logoInventoryAttestation;
  if (!Array.isArray(logos) || !attestation || attestation.attested !== true || !["none", "listed"].includes(attestation.mode)) {
    throw Object.assign(new Error("logo_inventory_attestation_required"), { status: 400 });
  }
  if ((logos.length === 0 && attestation.mode !== "none") || (logos.length > 0 && attestation.mode !== "listed")) {
    throw Object.assign(new Error("logo_inventory_attestation_mismatch"), { status: 400 });
  }
  const placements = new Set();
  for (const logo of logos) {
    const identityKey = String(logo?.identityKey || "");
    const targetSurface = String(logo?.surfaceKey || "");
    const placementKey = String(logo?.placementKey || "");
    if (!logo || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(identityKey) || !String(logo.displayName || "").trim() ||
      !PRODUCTION_SURFACES.includes(targetSurface) || placementKey !== `${identityKey}@${targetSurface}` || placements.has(placementKey) ||
      !validateAssetIdentity(logo, userId, body.revisionId, "logo")) {
      throw Object.assign(new Error("expected_logo_placement_invalid"), { status: 400 });
    }
    placements.add(placementKey);
    await verifyStoredAsset(fetchImpl, token, cfg, userId, logo);
  }
}

const GENERATION_SERVER_CONTROL_KEYS = new Set([
  "prompt", "systemprompt", "negativeprompt", "model", "imagemodel", "seed",
  "temperature", "topk", "topp", "viewangle", "viewangles", "cameraangle",
  "cameraangles", "enginecontract", "sourcecommit", "sourceblobs",
]);
const GENERATION_VIEW_ROLE = new Map([
  ["side", "driver"], ["passenger-side", "passenger"],
  ["hood_detail", "hood"], ["front", "front"], ["rear", "rear"],
  // The seventh slot is a whole-vehicle hero view. close-up is retained so
  // historical rows still validate, but it is no longer part of the plan and
  // never maps to hero3d.
  ["hero-3d", "hero3d"], ["close-up", "closeup"], ["roof", "roof"],
]);

// Every blocker calls_1_7_handoff_state can report. An unrecognised value means
// the database and the gateway disagree, which is a 502, not a pass-through.
const GENERATION_HANDOFF_BLOCKERS = new Set([
  "seven_generation_views_required",
  "generation_views_must_be_byte_distinct",
  "generation_view_roles_do_not_match_plan",
  "source_close_up_has_no_verified_hero3d_role_mapping",
]);

function generationInputHasServerControls(value, path = []) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((child) =>
    generationInputHasServerControls(child, [...path, "[]"]));
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const requiredVehicleModel = normalized === "model"
      && path.length === 1 && path[0] === "vehicle";
    return GENERATION_SERVER_CONTROL_KEYS.has(normalized) && !requiredVehicleModel
      || generationInputHasServerControls(child, [...path, key]);
  });
}

// The design-first Calls 1-7 input. It is the SAME allow-list the database
// enforces, kept deliberately duplicated rather than inferred: a caller that
// still sends an order or a recipient is speaking v1, and letting v2 silently
// ignore those keys is how the design path would quietly reacquire the
// fulfillment dependency that stopped customers designing anything.
const CALLS_1_7_V2_KEYS = [
  "brief", "businessName", "colors", "companyName", "contractVersion",
  "designName", "industry", "logoAsset", "mode", "phone", "style", "vehicle",
  "website",
];

const CALLS_1_7_V3_KEYS = [...CALLS_1_7_V2_KEYS, "pipelineMode"];

function validatedGenerationRequestV2(body, generationIdValue) {
  const input = body.input;
  const extraKeys = Object.keys(input).filter((key) => !CALLS_1_7_V2_KEYS.includes(key));
  const vehicle = input.vehicle;
  if (extraKeys.length
    // Refused, not ignored. This is the whole point of the version bump.
    || input.orderNumber !== undefined || input.delivery !== undefined
    || !String(input.brief || "").trim() || String(input.brief).length > 8000
    || !String(input.designName || "").trim() || String(input.designName).length > 240
    || (input.mode !== undefined && !["restyle", "commercial"].includes(input.mode))
    || !vehicle || typeof vehicle !== "object" || Array.isArray(vehicle)
    || [vehicle.year, vehicle.make, vehicle.model].some((item) => !String(item || "").trim())
    || !VEHICLE_CLASSES.includes(String(vehicle.type || ""))
    || generationInputHasServerControls(input)
    || Buffer.byteLength(JSON.stringify(input), "utf8") > 262_144) {
    throw Object.assign(new Error("generation_request_invalid"), { status: 400 });
  }
  // No idempotency key is computed here. The database derives it from the
  // canonical hash of the stored jsonb, which this process cannot reproduce
  // byte-for-byte -- Node's key order is insertion order, Postgres's is sorted.
  // Sending a guess would only create a way to be wrong.
  return { generationId: generationIdValue, idempotencyKey: null, input };
}

function validatedGenerationRequestV3(body, generationIdValue) {
  const input = body.input;
  const extraKeys = Object.keys(input).filter((key) => !CALLS_1_7_V3_KEYS.includes(key));
  const vehicle = input.vehicle;
  if (extraKeys.length
    || input.contractVersion !== "designpro.calls-1-7-input.v3"
    || input.pipelineMode !== "flat-first-atlas-v1"
    || input.orderNumber !== undefined || input.delivery !== undefined
    || !String(input.brief || "").trim() || String(input.brief).length > 8000
    || !String(input.designName || "").trim() || String(input.designName).length > 240
    || (input.mode !== undefined && !["restyle", "commercial"].includes(input.mode))
    || !vehicle || typeof vehicle !== "object" || Array.isArray(vehicle)
    || [vehicle.year, vehicle.make, vehicle.model].some((item) => !String(item || "").trim())
    || !VEHICLE_CLASSES.includes(String(vehicle.type || ""))
    || generationInputHasServerControls(input)
    || Buffer.byteLength(JSON.stringify(input), "utf8") > 262_144) {
    throw Object.assign(new Error("generation_request_invalid"), { status: 400 });
  }
  return { generationId: generationIdValue, idempotencyKey: null, input };
}

function validatedGenerationRequest(body) {
  const withKey = ["generationId", "idempotencyKey", "input"];
  const withoutKey = ["generationId", "input"];
  const bodyKeys = body && typeof body === "object" && !Array.isArray(body)
    ? JSON.stringify(Object.keys(body).sort()) : "";
  if (bodyKeys !== JSON.stringify(withKey) && bodyKeys !== JSON.stringify(withoutKey)) {
    throw Object.assign(new Error("generation_request_invalid"), { status: 400 });
  }
  const generationIdValue = String(body.generationId || "").trim().toLowerCase();
  const idempotencyKey = String(body.idempotencyKey || "");
  const input = body.input;
  if (!UUID_PATTERN.test(generationIdValue)
    || !input || typeof input !== "object" || Array.isArray(input)) {
    throw Object.assign(new Error("generation_request_invalid"), { status: 400 });
  }
  if (input.contractVersion === "designpro.calls-1-7-input.v2") {
    return validatedGenerationRequestV2(body, generationIdValue);
  }
  if (input.contractVersion === "designpro.calls-1-7-input.v3") {
    return validatedGenerationRequestV3(body, generationIdValue);
  }
  const vehicle = input?.vehicle;
  const delivery = input?.delivery;
  const orderNumber = String(input?.orderNumber || "");
  const recipientIdentityHash = String(delivery?.recipientIdentityHash || "");
  const deliveryKeys = ["contractVersion", "orderNumber", "recipientIdentityHash"];
  const expectedIdempotencyKey = `calls17:${generationIdValue}:${recipientIdentityHash}:`
    + createHash("sha256").update(orderNumber, "utf8").digest("hex");
  if (!UUID_PATTERN.test(generationIdValue)
    || idempotencyKey !== expectedIdempotencyKey || idempotencyKey.length > 200
    || !input || typeof input !== "object" || Array.isArray(input)
    || input.contractVersion !== "designpro.calls-1-7-input.v1"
    || orderNumber !== orderNumber.trim() || !ORDER_NUMBER_PATTERN.test(orderNumber)
    || !delivery || typeof delivery !== "object" || Array.isArray(delivery)
    || JSON.stringify(Object.keys(delivery).sort()) !== JSON.stringify(deliveryKeys)
    || delivery.contractVersion !== "designpro.wrapbox-recipient.v1"
    || recipientIdentityHash !== recipientIdentityHash.toLowerCase()
    || !SHA256_PATTERN.test(recipientIdentityHash)
    || delivery.orderNumber !== orderNumber
    || !vehicle || typeof vehicle !== "object" || Array.isArray(vehicle)
    || [vehicle.year, vehicle.make, vehicle.model, vehicle.type].some((item) => !String(item || "").trim())
    || !VEHICLE_CLASSES.includes(String(vehicle.type || ""))
    || generationInputHasServerControls(input)
    || Buffer.byteLength(JSON.stringify(input), "utf8") > 262_144) {
    throw Object.assign(new Error("generation_request_invalid"), { status: 400 });
  }
  return { generationId: generationIdValue, idempotencyKey, input };
}

async function generationRequestFor(fetchImpl, token, cfg, requestId) {
  return rpc(fetchImpl, token, cfg, "get_designpro_generation_request", {
    p_request_id: requestId,
  });
}

function validatedGenerationStatus(value) {
  if (value === null) return null;
  const state = String(value?.state || "");
  const views = value?.views;
  const attempt = Number(value?.attempt);
  const outputSetHash = value?.outputSetHash;
  const failureCode = value?.failureCode;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !UUID_PATTERN.test(String(value.requestId || ""))
    || !UUID_PATTERN.test(String(value.generationId || ""))
    || !["queued", "leased", "retryable", "outputs_ready", "failed", "cancelled"].includes(state)
    || !SHA256_PATTERN.test(String(value.inputHash || ""))
    || !SHA256_PATTERN.test(String(value.engineContractHash || ""))
    || !Number.isInteger(attempt) || attempt < 0 || attempt > 12
    || outputSetHash !== null && !SHA256_PATTERN.test(String(outputSetHash || ""))
    || failureCode !== null && !/^[a-z0-9][a-z0-9_:-]{0,79}$/.test(String(failureCode || ""))
    // handoffReady was pinned false while the plan's seventh slot was a close-up,
    // a role the revision contract does not accept. The seventh slot is now a
    // real hero-3d view carrying the hero3d role, so the database decides this
    // from the persisted views and the gateway carries the verdict. It is still
    // a strict boolean, and a true verdict must not arrive with a blocker.
    || typeof value.handoffReady !== "boolean"
    || value.handoffBlocker !== null && !GENERATION_HANDOFF_BLOCKERS.has(String(value.handoffBlocker))
    || value.handoffReady === true && value.handoffBlocker !== null
    || !Array.isArray(views) || views.length > 7) {
    throw Object.assign(new Error("generation_status_response_invalid"), { status: 502 });
  }
  const publicViews = views.map((view) => {
    const exactKeys = ["byteSize", "consumerRole", "contentHash", "contentType", "createdAt", "sourceViewType"];
    if (!view || typeof view !== "object" || Array.isArray(view)
      || JSON.stringify(Object.keys(view).sort()) !== JSON.stringify(exactKeys)
      || GENERATION_VIEW_ROLE.get(view.sourceViewType) !== view.consumerRole
      || !SHA256_PATTERN.test(String(view.contentHash || ""))
      || !Number.isSafeInteger(Number(view.byteSize)) || Number(view.byteSize) < 1
      || !["image/png", "image/jpeg", "image/webp"].includes(view.contentType)) {
      throw Object.assign(new Error("generation_status_response_invalid"), { status: 502 });
    }
    return { ...view, byteSize: Number(view.byteSize) };
  });
  return {
    requestId: String(value.requestId), generationId: String(value.generationId),
    state, inputHash: String(value.inputHash),
    engineContractHash: String(value.engineContractHash), attempt,
    outputSetHash: outputSetHash ? String(outputSetHash) : null,
    failureCode: failureCode ? String(failureCode) : null,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
    completedAt: value.completedAt || null,
    handoffReady: value.handoffReady === true,
    handoffBlocker: value.handoffBlocker || null, views: publicViews,
    // Staging and per-shot state. These carry the DesignPro capabilities that
    // used to be driven from the browser -- designer/photographer staging,
    // per-shot progress, failed-shot retry and per-view regeneration -- now
    // derived from real slot state on the server.
    phase: ["designer", "photographer", "complete", "failed"].includes(String(value.phase)) ? String(value.phase) : "designer",
    shotsComplete: Number.isSafeInteger(Number(value.shotsComplete)) ? Number(value.shotsComplete) : publicViews.length,
    shotsTotal: Number.isSafeInteger(Number(value.shotsTotal)) && Number(value.shotsTotal) > 0 ? Number(value.shotsTotal) : 7,
    failedShots: Array.isArray(value.failedShots)
      ? value.failedShots
        .filter((shot) => GENERATION_VIEW_ROLE.has(String(shot?.sourceViewType)))
        .map((shot) => ({ sourceViewType: String(shot.sourceViewType), consumerRole: GENERATION_VIEW_ROLE.get(String(shot.sourceViewType)), reason: shot?.reason ? String(shot.reason).slice(0, 160) : null }))
      : [],
    regeneratingShots: Array.isArray(value.regeneratingShots)
      ? value.regeneratingShots.filter((view) => GENERATION_VIEW_ROLE.has(String(view))).map(String)
      : [],
    designAnchor: value.designAnchor ? String(value.designAnchor).slice(0, 2000) : null,
    designName: value.designName ? String(value.designName).slice(0, 240) : null,
  };
}

export function createGateway({ env = process.env, fetchImpl = fetch } = {}) {
  const cfg = config(env);
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://gateway");
      if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { status: "ok", service: "designpro-api-gateway" });
      // The Stripe webhook is exempt, and only the Stripe webhook. The
      // same-origin rule is CSRF defence: it stops a page the customer did not
      // open from spending their cookie. Stripe carries no cookie and is not a
      // browser, so it sends no Origin header at all -- which the rule reads as
      // a mismatch and refuses with 403 before the handler runs. Live-verified
      // on os.designproai.com: an Origin-less POST got origin_rejected while
      // the identical POST with an Origin reached stripe_signature_invalid.
      // Left in place it takes the customer's money and grants nothing: Stripe
      // marks the session paid, the delivery 403s, no entitlement row is
      // written, and await_purchase never releases.
      //
      // Exempting it removes no protection. This route's authentication is the
      // HMAC signature checked immediately below, which an attacker cannot
      // forge; an Origin header is self-declared and any non-browser client can
      // set it to anything. The signature is strictly the stronger check, so
      // the origin rule was never what was guarding this path.
      if (!(req.method === "POST" && url.pathname === "/api/webhooks/stripe")) assertSameOrigin(req, cfg);

      if (req.method === "POST" && url.pathname === "/api/auth/signup") {
        const body = await readBody(req);
        const email = String(body.email || "").trim();
        const password = String(body.password || "");
        if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
          return json(res, 400, { error: "signup_credentials_too_weak" });
        }
        const redirect = cfg.appOrigin ? `?redirect_to=${encodeURIComponent(`${cfg.appOrigin}/login`)}` : "";
        const signup = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/signup${redirect}`, {
          method: "POST",
          headers: { apikey: cfg.publishableKey, "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const payload = await signup.json().catch(() => ({}));
        // GoTrue returns the created user in one of TWO shapes, and this read
        // only ever handled one of them. When it also mints a session -- which
        // it does only where email confirmation is off -- the user is nested
        // under `user` alongside the tokens. When confirmation IS required
        // there is no session to return, so it answers 200 with the user
        // object BARE at the top level: {id, aud, email, confirmation_sent_at}.
        //
        // Reading `payload.user?.id` alone therefore failed every real signup
        // on this project, which has confirmation on. The failure was silent
        // and inverted: the account WAS created and the confirmation email WAS
        // sent, and the customer was told signup_failed -- so they never went
        // looking for the email, and a retry hit "user already registered".
        // Live-verified: trish+dpcanary@weprintwraps.com exists in auth.users,
        // created by the very request that answered signup_failed.
        const created = payload.user?.id ? payload.user : (payload.id && payload.aud ? payload : null);
        // A failure that reports 200 is worse than the failure. The old code
        // passed the UPSTREAM status through, so this case answered HTTP 200
        // with an error body -- which no client can treat as a failure. An
        // upstream refusal keeps its own status; an upstream success we could
        // not read is ours, and is a 502.
        if (!signup.ok || !created) {
          return json(res, signup.ok ? 502 : Number(signup.status || 400), { error: payload.msg || payload.message || "signup_failed" });
        }
        if (payload.access_token && payload.refresh_token) {
          return json(res, 201, { ok: true, confirmationRequired: false }, { "set-cookie": sessionCookies(payload, cfg) });
        }
        return json(res, 201, { ok: true, confirmationRequired: true });
      }

      if (req.method === "POST" && url.pathname === "/api/auth/login") {
        const body = await readBody(req);
        const auth = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
          method: "POST",
          headers: { apikey: cfg.publishableKey, "content-type": "application/json" },
          body: JSON.stringify({ email: String(body.email || "").trim(), password: String(body.password || "") }),
        });
        const payload = await auth.json().catch(() => ({}));
        if (!auth.ok || !payload.access_token || !payload.refresh_token) return json(res, 401, { error: "invalid_credentials" });
        return json(res, 200, { ok: true, user: { id: payload.user?.id, email: payload.user?.email } }, { "set-cookie": sessionCookies(payload, cfg) });
      }

      // STRIPE WEBHOOK — before the session gate, because Stripe carries no
      // session. Its authentication is the signature, checked below; an
      // unsigned delivery is refused and confirms nothing.
      if (req.method === "POST" && url.pathname === "/api/webhooks/stripe") {
        if (!cfg.stripeWebhookSecret) return json(res, 503, { error: "checkout_not_configured" });
        const raw = await readRawBody(req);
        const event = verifiedStripeEvent(raw, req.headers["stripe-signature"], cfg.stripeWebhookSecret, Math.floor(Date.now() / 1000));
        if (!event) return json(res, 400, { error: "stripe_signature_invalid" });
        // Only a completed, actually-paid session authorizes anything. An
        // expired or unpaid session is acknowledged so Stripe stops retrying,
        // and grants nothing.
        if (event.type !== "checkout.session.completed") return json(res, 200, { received: true, ignored: event.type });
        const object = event.data?.object || {};
        if (String(object.payment_status || "") !== "paid") return json(res, 200, { received: true, unpaid: true });
        // The metadata is what the checkout put there; the amount is what
        // Stripe says was actually charged, not what the session asked for.
        const metadata = object.metadata || {};
        if (!PURCHASE_PRODUCTS[String(metadata.product_type || "")]) {
          return json(res, 200, { received: true, skipped: "not_a_designpro_product" });
        }
        const confirmed = await purchaseThroughRuntime(fetchImpl, cfg, "confirm", {
          checkoutSessionId: String(object.id || ""),
          paymentIntentId: object.payment_intent ? String(object.payment_intent) : null,
          productType: String(metadata.product_type),
          generationId: String(metadata.generation_id || ""),
          amountCents: Number(object.amount_total || metadata.amount_cents || 0),
          userEmail: String(metadata.user_email || object.customer_email || ""),
        });
        return json(res, 200, { received: true, ...confirmed });
      }

      const session = await authenticate(req, res, fetchImpl, cfg);
      if (!session) {
        res.setHeader("set-cookie", clearSessionCookies(cfg));
        return json(res, 401, { error: "authentication_required" });
      }
      const { token, user } = session;

      if (req.method === "GET" && url.pathname === "/api/auth/session") return json(res, 200, { user: { id: user.id, email: user.email || null } });
      if (req.method === "POST" && url.pathname === "/api/auth/logout") {
        await upstream(fetchImpl, `${cfg.supabaseUrl}/auth/v1/logout`, { method: "POST", body: "{}" }, token, cfg).catch(() => null);
        return json(res, 200, { ok: true }, { "set-cookie": clearSessionCookies(cfg) });
      }

      if (req.method === "POST" && url.pathname === "/api/assets/upload-intents") {
        return json(res, 201, await createUploadIntent(fetchImpl, token, cfg, user.id, await readBody(req)));
      }
      if (req.method === "POST" && url.pathname === "/api/assets/verify") {
        return json(res, 200, { asset: await verifyStoredAsset(fetchImpl, token, cfg, user.id, (await readBody(req)).asset || {}) });
      }

      if (req.method === "POST" && url.pathname === "/api/generation/requests") {
        const request = validatedGenerationRequest(await readBody(req));
        // A generationId already carrying a different brief is not a bad
        // request, it is a COLLISION: two designs competing for one name that
        // every downstream Call 8 proof region and Call 9 panel points back at.
        // PostgREST reports a raised exception as 400, which reads as "you
        // typed something wrong" and invites a retry of the same call. 409 says
        // the truth -- the id is taken, mint a new one.
        const intakeRpc = request.input.contractVersion === "designpro.calls-1-7-input.v3"
          ? "create_designpro_flat_first_generation_request"
          : "create_designpro_generation_request";
        const result = await rpc(fetchImpl, token, cfg, intakeRpc, {
          p_generation_id: request.generationId,
          p_input: request.input,
          p_idempotency_key: request.idempotencyKey,
        }).catch((error) => {
          if (/generation_input_conflict/.test(String(error?.message || ""))) {
            throw Object.assign(new Error("generation_input_conflict"), { status: 409 });
          }
          throw error;
        });
        if (!UUID_PATTERN.test(String(result?.requestId || ""))
          || result?.generationId !== request.generationId
          || !["queued", "leased", "retryable", "outputs_ready", "failed", "cancelled"].includes(result?.state)
          || !SHA256_PATTERN.test(String(result?.inputHash || ""))
          || !SHA256_PATTERN.test(String(result?.engineContractHash || ""))) {
          throw Object.assign(new Error("generation_request_response_invalid"), { status: 502 });
        }
        return json(res, 202, {
          requestId: result.requestId,
          generationId: result.generationId,
          state: result.state,
          inputHash: result.inputHash,
          engineContractHash: result.engineContractHash,
          idempotent: result.idempotent === true,
        });
      }
      const generationRequestMatch = url.pathname.match(/^\/api\/generation\/requests\/([0-9a-f-]{36})$/);
      if (req.method === "GET" && generationRequestMatch) {
        const requestId = generationRequestMatch[1].toLowerCase();
        if (!UUID_PATTERN.test(requestId)) return json(res, 400, { error: "generation_request_id_invalid" });
        const request = validatedGenerationStatus(
          await generationRequestFor(fetchImpl, token, cfg, requestId)
        );
        if (!request) return json(res, 404, { error: "generation_request_not_found" });
        // Identity only. This route deliberately never returns a storage path or
        // a signed URL; viewing the images is a separate, explicit surface
        // (/views below), the same way artifacts are separate from job status.
        return json(res, 200, request);
      }

      // The canonical flat-first lineage. The database returns private paths
      // only after proving request ownership; this route validates that both
      // objects remain under that owner's generation namespace, signs a
      // five-minute preview, and strips the paths from the public response.
      const generationAtlasMatch = url.pathname.match(/^\/api\/generation\/requests\/([0-9a-f-]{36})\/atlas$/);
      if (req.method === "GET" && generationAtlasMatch) {
        const requestId = generationAtlasMatch[1].toLowerCase();
        if (!UUID_PATTERN.test(requestId)) return json(res, 400, { error: "generation_request_id_invalid" });
        const located = await rpc(fetchImpl, token, cfg, "designpro_flat_atlas_revision_paths", {
          p_request_id: requestId,
        });
        const revisions = validatedFlatAtlasRevisions(located, requestId, user.id);
        if (revisions === null) return json(res, 404, { error: "generation_request_not_found" });
        const publicRevisions = await Promise.all(revisions.map(async (revision) => {
          const {
            guideStoragePath, masterStoragePath, projectionStoragePath, ...base
          } = revision;
          const [guideUrl, masterUrl] = await Promise.all([
            signedArtifactUrl(fetchImpl, token, cfg, guideStoragePath).catch(() => null),
            signedArtifactUrl(fetchImpl, token, cfg, masterStoragePath).catch(() => null),
          ]);
          return {
            ...base,
            ...(guideUrl ? { guideUrl } : {}),
            ...(masterUrl ? { masterUrl } : {}),
            ...((guideUrl || masterUrl) ? { expiresIn: 300 } : {}),
          };
        }));
        return json(res, 200, publicRevisions);
      }

      // "Generate this angle again" — the per-view regenerate and failed-shot
      // retry the DesignPro UI has always had, now executed by a fenced worker
      // instead of the browser. The instruction is stored on the slot and the
      // prompt is still assembled server-side; the old view is superseded, never
      // mutated, so Calls 8+ can still trust anything it already hashed.
      const regenerateMatch = url.pathname.match(/^\/api\/generation\/requests\/([0-9a-f-]{36})\/views\/([a-z0-9_-]{1,24})\/regenerate$/);
      if (req.method === "POST" && regenerateMatch) {
        const requestId = regenerateMatch[1].toLowerCase();
        const sourceViewType = regenerateMatch[2];
        if (!UUID_PATTERN.test(requestId)) return json(res, 400, { error: "generation_request_id_invalid" });
        if (!GENERATION_VIEW_ROLE.has(sourceViewType)) return json(res, 400, { error: "generation_view_not_in_plan" });
        const body = await readBody(req).catch(() => ({}));
        const instruction = body?.instruction == null ? null : String(body.instruction).slice(0, 2000);
        const flatFirstGate = validatedFlatFirstGate(await rpc(
          fetchImpl, token, cfg, "designpro_flat_first_handoff_gate", {
            p_request_id: requestId,
          },
        ));
        if (flatFirstGate === null) {
          return json(res, 404, { error: "generation_request_not_found" });
        }
        // A flat-first visual edit belongs on a new immutable atlas revision.
        // Sending it to one camera slot would make that 3D proof disagree with
        // the production authority. An instructionless retry is safe: it reuses
        // the same atlas and only retries the failed projection.
        if (flatFirstGate.flatFirst && String(instruction || "").trim()) {
          return json(res, 409, { error: "flat_first_atlas_revision_required" });
        }
        const result = await rpc(fetchImpl, token, cfg, "regenerate_designpro_generation_slot", {
          p_request_id: requestId,
          p_source_view_type: sourceViewType,
          p_instruction: instruction,
        });
        if (!UUID_PATTERN.test(String(result?.requestId || ""))) {
          throw Object.assign(new Error("generation_regenerate_response_invalid"), { status: 502 });
        }
        return json(res, 202, {
          requestId: result.requestId,
          sourceViewType: String(result.sourceViewType || sourceViewType),
          consumerRole: String(result.consumerRole || GENERATION_VIEW_ROLE.get(sourceViewType)),
          supersededViews: Number(result.supersededViews || 0),
          state: String(result.state || "queued"),
        });
      }

      // Viewing the generated photoreal views. Separate from the status route on
      // purpose: that route is an identity contract and must never sign an
      // object, so signing lives here, behind the owner's own token, minting the
      // same five-minute URLs /api/wrapbox uses. Paths are resolved server-side
      // and never returned.
      const generationViewsMatch = url.pathname.match(/^\/api\/generation\/requests\/([0-9a-f-]{36})\/views$/);
      if (req.method === "GET" && generationViewsMatch) {
        const requestId = generationViewsMatch[1].toLowerCase();
        if (!UUID_PATTERN.test(requestId)) return json(res, 400, { error: "generation_request_id_invalid" });
        const located = await rpc(fetchImpl, token, cfg, "designpro_generation_view_paths", { p_request_id: requestId });
        if (!Array.isArray(located)) return json(res, 404, { error: "generation_request_not_found" });
        const views = await Promise.all(located.map(async (view) => {
          const base = {
            sourceViewType: String(view.sourceViewType || ""),
            consumerRole: String(view.consumerRole || ""),
            contentHash: String(view.contentHash || ""),
            contentType: String(view.contentType || ""),
            byteSize: Number(view.byteSize || 0),
          };
          if (!SHA256_PATTERN.test(base.contentHash) || GENERATION_VIEW_ROLE.get(base.sourceViewType) !== base.consumerRole) {
            throw Object.assign(new Error("generation_view_identity_invalid"), { status: 502 });
          }
          try {
            return { ...base, signedUrl: await signedArtifactUrl(fetchImpl, token, cfg, String(view.storagePath)), expiresIn: 300 };
          } catch {
            // One unsignable view must not fail the whole read; the caller
            // renders it as pending.
            return base;
          }
        }));
        return json(res, 200, views);
      }

      // Calls 1-7 -> Calls 8-12. The runtime worker has already copied the seven
      // accepted views into this revision's input paths; this freezes them as a
      // revision and starts the existing production workflow, as the
      // authenticated owner because save_designpro_revision_source refuses a
      // service role. Idempotent: a second call reports the same revision.
      const handoffMatch = url.pathname.match(/^\/api\/generation\/requests\/([0-9a-f-]{36})\/handoff$/);
      if (req.method === "POST" && handoffMatch) {
        const requestId = handoffMatch[1].toLowerCase();
        if (!UUID_PATTERN.test(requestId)) return json(res, 400, { error: "generation_request_id_invalid" });
        const flatFirstGate = validatedFlatFirstGate(await rpc(
          fetchImpl, token, cfg, "designpro_flat_first_handoff_gate", {
            p_request_id: requestId,
          },
        ));
        if (flatFirstGate === null) {
          return json(res, 404, { error: "generation_request_not_found" });
        }
        if (flatFirstGate.flatFirst && !flatFirstGate.productionEligible) {
          return json(res, 409, { error: "flat_first_production_gate_required" });
        }
        const result = await rpc(fetchImpl, token, cfg, "handoff_designpro_generation_to_production", {
          p_request_id: requestId,
        });
        if (!UUID_PATTERN.test(String(result?.revisionId || ""))) {
          throw Object.assign(new Error("generation_handoff_response_invalid"), { status: 502 });
        }
        return json(res, 202, {
          revisionId: result.revisionId,
          generationId: result.generationId,
          runId: result.workflowRunId || null,
          alreadyHandedOff: result.alreadyHandedOff === true,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/genie/candidates") {
        const candidates = await rpc(fetchImpl, token, cfg, "list_pending_designpro_vehicle_specs_universal", {});
        const rows = Array.isArray(candidates) ? candidates : candidates?.candidates || [];
        return json(res, 200, rows.map(publicGenieCandidate));
      }
      const genieMatch = url.pathname.match(/^\/api\/genie\/candidates\/([0-9a-f-]{36})\/validate$/);
      if (req.method === "POST" && genieMatch) {
        const body = await readBody(req);
        const surfaces = validatedGenieSurfaces(body);
        const evidence = genieEvidence(body);
        if (!surfaces || !evidence) return json(res, 400, { error: "genie_validation_evidence_incomplete", requiredSurfaces: PRODUCTION_SURFACES });
        return json(res, 200, await rpc(fetchImpl, token, cfg, "validate_designpro_vehicle_spec_universal", {
          p_candidate_id: genieMatch[1],
          p_validated_surfaces: surfaces,
          p_notes: evidence.notes,
          p_evidence: {
            contractVersion: evidence.contractVersion,
            sourceReviewed: true,
            sourceUrlsReviewed: true,
            operatorAttestation: true,
          },
        }));
      }

      if (req.method === "POST" && url.pathname === "/api/wrapbox/recipients/register") {
        return json(res, 201, await registerRecipientThroughRuntime(fetchImpl, cfg, user.id, await readBody(req)));
      }
      if (req.method === "GET" && url.pathname === "/api/wrapbox") {
        const rows = await wrapboxRows(fetchImpl, token, cfg);
        return json(res, 200, rows.map(publicWrapboxPack));
      }
      const wrapboxMatch = url.pathname.match(/^\/api\/wrapbox\/([0-9a-f-]{36})$/);
      if (req.method === "GET" && wrapboxMatch) {
        const packId = wrapboxMatch[1].toLowerCase();
        if (!UUID_PATTERN.test(packId)) return json(res, 400, { error: "wrapbox_pack_id_invalid" });
        const rows = await wrapboxRows(fetchImpl, token, cfg, packId);
        if (rows.length !== 1) return json(res, 404, { error: "wrapbox_pack_not_found" });
        return json(res, 200, await publicWrapboxDetail(fetchImpl, token, cfg, rows[0]));
      }

      if (req.method === "GET" && url.pathname === "/api/jobs") {
        const runs = await listRuns(fetchImpl, token, cfg);
        const states = await Promise.all(runs.map(async (run) => ({
          ...publicState(await runState(fetchImpl, token, cfg, run)),
          ...await businessIdentityForRun(fetchImpl, token, cfg, run),
        })));
        return json(res, 200, states);
      }
      if (req.method === "POST" && url.pathname === "/api/revisions") {
        const body = await readBody(req);
        const required = ["revisionId", "generationId", "visualizationId", "expectedUpdatedAt", "renderAssets", "idempotencyKey", "revisionSnapshot"];
        const missing = required.filter((key) => body[key] == null || body[key] === "");
        const snapshot = body.revisionSnapshot;
        const snapshotMissing = ["vehicle", "surfaceOptions", "finish", "bodyText", "orderNumber", "expectedLogoInventory", "logoInventoryAttestation", "delivery"].filter((key) => snapshot?.[key] == null);
        const invalidSnapshot = !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
          !UUID_PATTERN.test(String(body.revisionId || "")) || !UUID_PATTERN.test(String(body.generationId || "")) || !UUID_PATTERN.test(String(body.visualizationId || "")) ||
          snapshot.contractVersion !== "designpro.revision-snapshot.v1" || typeof snapshot.vehicle !== "object" || Array.isArray(snapshot.vehicle) ||
          !VEHICLE_CLASSES.includes(String(snapshot.vehicle?.type || "")) ||
          !ORDER_NUMBER_PATTERN.test(String(snapshot.orderNumber || "")) || String(snapshot.orderNumber || "").trim() !== snapshot.orderNumber ||
          snapshot.orderNumber !== snapshot.delivery?.orderNumber ||
          typeof snapshot.surfaceOptions !== "object" || Array.isArray(snapshot.surfaceOptions) || !Array.isArray(snapshot.expectedLogoInventory) ||
          typeof snapshot.logoInventoryAttestation !== "object" || snapshot.logoInventoryAttestation?.attested !== true ||
          !validFrozenDelivery(snapshot.delivery);
        if (missing.length || snapshotMissing.length || invalidSnapshot) return json(res, 400, { error: "revision_contract_incomplete", missing, snapshotMissing });

        // The canonical authoring input, when Calls 1-7 recorded one. It is not
        // required here -- Call 8 is the stage that refuses a run without a
        // master, and it already says so precisely -- but a MALFORMED one must
        // never be frozen: the snapshot is immutable, so an unusable master
        // becomes an unusable revision that has to be regenerated rather than
        // repaired. Shape only; design-master.cjs owns the real validation.
        const designMaster = snapshot.designMaster;
        if (designMaster !== undefined) {
          const assets = Array.isArray(designMaster?.creativeAssets) ? designMaster.creativeAssets : null;
          const layers = Array.isArray(designMaster?.composition?.layers) ? designMaster.composition.layers : null;
          const assetIds = new Set((assets || []).map((asset) => String(asset?.assetId || "")));
          const badAsset = (assets || []).find((asset) => !String(asset?.assetId || "").trim()
            || !/^[0-9a-f]{64}$/.test(String(asset?.contentHash || ""))
            || !String(asset?.storagePath || "").trim()
            || String(asset?.assetId || "").startsWith("logo-"));
          const unplaced = (layers || []).find((layer) => !assetIds.has(String(layer?.assetId || "")));
          if (!designMaster || typeof designMaster !== "object" || Array.isArray(designMaster)
            || !assets?.length || !layers?.length || badAsset || unplaced) {
            return json(res, 400, {
              error: "revision_design_master_invalid",
              detail: !assets?.length ? "creativeAssets is empty"
                : !layers?.length ? "composition.layers is empty"
                : badAsset ? `creative asset ${badAsset.assetId || "(unnamed)"} is not a hashed, stored, non-logo asset`
                : `composition places ${unplaced.assetId}, which is not a declared creative asset`,
            });
          }
        }
        await validateRevisionAssets(fetchImpl, token, cfg, user.id, body);
        const frozenSnapshot = {
          ...snapshot,
          revisionId: body.revisionId,
          generationId: body.generationId,
          designId: canonicalDesignId(body.generationId),
          orderNumber: snapshot.delivery.orderNumber,
          visualizationId: body.visualizationId,
          renderAssets: body.renderAssets,
          change: { ...(snapshot.change || {}), view: body.view, instruction: body.instruction, attachmentIds: body.attachmentIds || [] },
        };
        const saved = await rpc(fetchImpl, token, cfg, "save_designpro_revision_source", {
          p_revision_id: body.revisionId,
          p_generation_id: body.generationId,
          p_visualization_id: body.visualizationId,
          p_expected_updated_at: body.expectedUpdatedAt,
          p_snapshot: frozenSnapshot,
          p_snapshot_hash: null,
          p_idempotency_key: body.idempotencyKey,
        });
        if (!/^[0-9a-f]{64}$/.test(String(saved.snapshotHash || ""))) throw new Error("revision_snapshot_hash_missing");
        const result = await rpc(fetchImpl, token, cfg, "create_designpro_entice_workflow", {
          p_revision_id: body.revisionId,
          p_idempotency_key: body.idempotencyKey,
          p_input: { trigger: "revision.saved", revisionSnapshotHash: saved.snapshotHash },
        });
        return json(res, 202, { runId: result.workflowRunId, accepted: true });
      }
      if (req.method === "POST" && url.pathname === "/api/production") {
        const body = await readBody(req);
        const required = ["enticeWorkflowRunId", "idempotencyKey"];
        const missing = required.filter((key) => body[key] == null || body[key] === "");
        if (missing.length) return json(res, 400, { error: "production_contract_incomplete", missing });
        const result = await rpc(fetchImpl, token, cfg, "create_designpro_production_workflow", {
          p_entice_run_id: body.enticeWorkflowRunId,
          p_idempotency_key: body.idempotencyKey,
          p_input: { orderRequestId: body.orderRequestId || null },
        });
        return json(res, 202, { runId: result.workflowRunId, accepted: true });
      }

      // OPEN A PURCHASE. The proven `create-single-use-checkout` behaviour,
      // moved inside this boundary: the customer UI calls dpApi, dpApi calls
      // here, and only this process talks to Stripe.
      if (req.method === "POST" && url.pathname === "/api/checkout/sessions") {
        if (!cfg.stripeSecretKey) return json(res, 503, { error: "checkout_not_configured" });
        const body = await readBody(req);
        const spec = PURCHASE_PRODUCTS[String(body.product || "")];
        // The price is ours, never the caller's. A product the server does not
        // sell is refused rather than defaulted to the cheaper one.
        if (!spec) return json(res, 400, { error: "unknown_product" });
        const runs = await listRuns(fetchImpl, token, cfg);
        const run = requestedRun(runs, String(body.generationId || ""));
        if (!run) return json(res, 404, { error: "job_not_found" });
        const returnPath = typeof body.returnPath === "string" && body.returnPath.startsWith("/")
          ? body.returnPath : "/designpro/jobs";
        const stripeSession = await stripeCall(fetchImpl, cfg, "checkout/sessions", stripeForm({
          mode: "payment",
          "line_items[0][quantity]": 1,
          "line_items[0][price_data][currency]": "usd",
          "line_items[0][price_data][unit_amount]": spec.amountCents,
          "line_items[0][price_data][product_data][name]": spec.name,
          "line_items[0][price_data][product_data][description]": spec.description,
          customer_email: user.email || undefined,
          success_url: `${cfg.appOrigin}${returnPath}?purchase=${spec.product}`,
          cancel_url: `${cfg.appOrigin}${returnPath}?purchase=cancelled`,
          // The proven metadata, unchanged. This is what reconnects a payment
          // to the design it was made for.
          "metadata[product_type]": spec.productType,
          "metadata[generation_id]": String(run.generation_id || ""),
          "metadata[user_id]": user.id,
          "metadata[user_email]": user.email || "",
          "metadata[amount_cents]": String(spec.amountCents),
        }));
        // Nothing is recorded here. The proven flow records on the verified
        // webhook and the session id is the transaction identity, so a pending
        // row would only be a second place for the truth to live.
        return json(res, 200, { url: String(stripeSession.url), productType: spec.productType, amountCents: spec.amountCents });
      }

      const approvedViewMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/approved-views$/);
      if (req.method === "GET" && approvedViewMatch) {
        const runs = await listRuns(fetchImpl, token, cfg);
        const run = requestedRun(runs, decodeURIComponent(approvedViewMatch[1]));
        if (!run) return json(res, 404, { error: "job_not_found" });
        return json(res, 200, await approvedViewsForRun(fetchImpl, token, cfg, run, user.id));
      }

      const artifactMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/artifacts$/);
      if (req.method === "GET" && artifactMatch) {
        const runs = await listRuns(fetchImpl, token, cfg);
        const run = requestedRun(runs, decodeURIComponent(artifactMatch[1]));
        if (!run) return json(res, 404, { error: "job_not_found" });
        const source = verifiedSourceEnticeRun(run, runs);
        const artifactRuns = source ? [source, run] : [run];
        const result = [];
        for (const artifactRun of artifactRuns) {
          const rows = await artifactsForRun(fetchImpl, token, cfg, artifactRun.id);
          for (const row of rows) {
            const storagePath = String(row.storage_path || "");
            if (!authorizedArtifactPath(storagePath, user.id, artifactRun.id)) continue;
            result.push({
              id: String(row.id),
              runId: artifactRun.id,
              source: artifactRun.id === run.id ? "production" : "entice",
              kind: String(row.artifact_kind),
              surfaceKey: String(row.surface_key || ""),
              storagePath,
              contentHash: String(row.content_hash),
              byteSize: row.byte_size == null ? null : Number(row.byte_size),
              metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
              signedUrl: await signedArtifactUrl(fetchImpl, token, cfg, storagePath),
              expiresIn: 300,
            });
          }
        }
        return json(res, 200, result);
      }

      const match = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(resume|approvals\/(preflight|final)))?$/);
      if (match) {
        const requestedId = decodeURIComponent(match[1]);
        const run = await resolveRun(fetchImpl, token, cfg, requestedId);
        if (!run) return json(res, 404, { error: "job_not_found" });
        const production = run.workflow_type === "designpro.production_pack";
        if (req.method === "GET" && !match[2]) return json(res, 200, {
          ...publicState(await runState(fetchImpl, token, cfg, run)),
          ...await businessIdentityForRun(fetchImpl, token, cfg, run),
        });
        if (req.method === "POST" && match[2] === "resume") return json(res, 202, await rpc(fetchImpl, token, cfg, "resume_designpro_workflow", { p_run_id: run.id, p_actor: user.id, p_retry_failed: true }));
        if (req.method === "POST" && match[2]?.startsWith("approvals/")) {
          if (!production) return json(res, 409, { error: "production_job_required" });
          const gate = match[3] === "preflight" ? "preflight" : "final";
          const stageKey = gate === "preflight" ? "await_panelpro_preflight_qc" : "await_final_human_qc";
          const qc = exactQc(await readBody(req), gate);
          if (!qc) return json(res, 400, { error: `${gate}_qc_evidence_incomplete`, required: gate === "preflight" ? PREFLIGHT_CHECKS : FINAL_CHECKS });
          if (gate === "final") Object.assign(qc, await businessIdentityForRun(fetchImpl, token, cfg, run));
          return json(res, 202, await rpc(fetchImpl, token, cfg, "approve_designpro_human_gate", {
            p_run_id: run.id,
            p_stage_key: stageKey,
            p_actor: user.id,
            p_approval_ref: approvalRef(run.id, stageKey, user.id, qc),
            p_qc: qc,
          }));
        }
      }
      return json(res, 404, { error: "not_found" });
    } catch (error) {
      return json(res, Number(error.status || 500), { error: error.message || "gateway_error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8787);
  createGateway().listen(port, "0.0.0.0", () => console.log(`designpro-api-gateway listening on ${port}`));
}
