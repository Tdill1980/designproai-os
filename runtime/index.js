"use strict";

const express = require("express");
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");
const { createHash } = require("node:crypto");
const { registerDesignProStandaloneClaimant } = require("./designpro-standalone-claimant.cjs");
// `normalizeSourceAsset` / `verifySourceBytes` went with `sourceObject`, the
// loader that pulled the seven 3D proofs into Call 8. Call 8 reads panels now.
const { canonicalTenantKey, canonicalUuid, immutableStorageUpload } = require("./runtime-contract.cjs");
const { probeRuntimeDependencies } = require("./runtime-readiness.cjs");
const {
  normalizeTextLock,
  selectedImageModel,
  SURFACE_KEYS,
} = require("./gemini-flat-surface.cjs");
// ⛔ `authorFlatSurfaceFields` IS DELETED, NOT MERELY UNWIRED. (Trish 2026-08-29.)
//
// It was the Gemini pass that flattened each 3D proof photograph into a
// "surface field", and those fields fed both the Call-8 proof sheet and, through
// `panels.build`'s fail-open arm, the print panels. Leaving a live producer of
// that class importable is how it comes back. Call 8 is deterministic assembly
// of the six Call-1 panels now, so this module keeps only the shared
// vocabulary -- surface keys, the text lock, the model name the PROJECTIONS
// still use.
const { call8ProofMaterialHash, normalizeCallOnePanelSet } = require("./call8-proof-material.cjs");
const { PROOF_SHEET_CONTRACT, renderProofSheet } = require("./proof-sheet.cjs");
const { enhancePanel, topazReadiness } = require("./topaz-upscale.cjs");
const { dispatchOneWrapboxNotification, reconcileCompletedWrapboxDeliveries } = require("./wrapbox-delivery.cjs");
const { createResendTransport, resendReadiness } = require("./resend-transport.cjs");
const { MAX_STANDARD_UPLOAD_BYTES, removeCommittedSpool, spoolImmutableBuffer, uploadSpoolWithTus } = require("./zip-spool.cjs");
const { createGenerationWorker } = require("./generation-worker.cjs");

const PORT = Number(process.env.PORT || 3001);
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const WORKER_SECRET = String(process.env.WORKER_SECRET || "").trim();
const GIT_SHA = String(process.env.GIT_SHA || "").trim();
const GOOGLE_AI_API_KEY = String(process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "").trim();
const GOOGLE_IMAGE_MODEL = selectedImageModel(process.env.GOOGLE_IMAGE_MODEL);
const WORKER_ID = String(process.env.DESIGNPRO_WORKER_ID || process.env.HOSTNAME || process.pid).trim();
const DESIGNPRO_SPOOL_DIR = String(process.env.DESIGNPRO_SPOOL_DIR || "").trim();
const SUPABASE_TUS_ENDPOINT = String(process.env.SUPABASE_TUS_ENDPOINT || "").trim();
const DESIGNPRO_APP_ORIGIN = String(process.env.DESIGNPRO_APP_ORIGIN || "").trim();
const REQUIRED_RUNTIME_ENV = Object.freeze([
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WORKER_SECRET", "GIT_SHA",
  "GOOGLE_AI_API_KEY (or GEMINI_API_KEY)", "DESIGNPRO_SPOOL_DIR", "DESIGNPRO_APP_ORIGIN",
  "DESIGNPRO_OUTBOUND_EMAIL_ENABLED=true|false", "DESIGNPRO_TOPAZ_ENABLED=true|false",
]);
const PUBLIC_GO_LIVE_ENV = Object.freeze([
  "DESIGNPRO_OUTBOUND_EMAIL_ENABLED=true", "RESEND_API_KEY", "RESEND_FROM", "RESEND_FROM_VERIFIED=true",
  "DESIGNPRO_TOPAZ_ENABLED=true", "TOPAZ_API_KEY",
]);
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !WORKER_SECRET || !GIT_SHA || !GOOGLE_AI_API_KEY || !DESIGNPRO_SPOOL_DIR || !DESIGNPRO_APP_ORIGIN) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_SECRET, GIT_SHA, GOOGLE_AI_API_KEY (or GEMINI_API_KEY), DESIGNPRO_SPOOL_DIR and DESIGNPRO_APP_ORIGIN are required");
}
const appOrigin = new URL(DESIGNPRO_APP_ORIGIN);
if (appOrigin.protocol !== "https:" || appOrigin.username || appOrigin.password || appOrigin.pathname !== "/" || appOrigin.search || appOrigin.hash || !/(^|\.)designproai\.com$/i.test(appOrigin.hostname)) throw new Error("DESIGNPRO_APP_ORIGIN must be the standalone HTTPS DesignProAI origin");
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const app = express();
app.use(express.json({ limit: "1mb" }));

function authMiddleware(req, res, next) {
  if (req.headers.authorization !== `Bearer ${WORKER_SECRET}`) return res.status(401).json({ error: "Unauthorized" });
  next();
}

async function uploadBuffer(storagePath, buffer, contentType, tenantKey, workflowRunId, signal) {
  const runPrefix = `designpro/${canonicalTenantKey(tenantKey)}/${canonicalUuid(workflowRunId, "workflowRunId")}/`;
  const allowed = [`${runPrefix}proof-masters/`, `${runPrefix}proof/`];
  if (!allowed.some((prefix) => storagePath.startsWith(prefix)) || !/^[A-Za-z0-9._/-]+$/.test(storagePath) || storagePath.includes("..")) throw new Error("unsafe Call 8 master path");
  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (body.length <= MAX_STANDARD_UPLOAD_BYTES) return immutableStorageUpload(supabase.storage, "wrap-files", storagePath, body, contentType);
  const contentHash = createHash("sha256").update(body).digest("hex");
  const materialHash = createHash("sha256").update(JSON.stringify({ storagePath, contentHash, byteSize: body.length, contentType })).digest("hex");
  const spool = await spoolImmutableBuffer({ spoolDir: DESIGNPRO_SPOOL_DIR, runId: workflowRunId, materialHash, bytes: body, signal });
  const stored = await uploadSpoolWithTus({ supabase, supabaseUrl: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY, endpoint: SUPABASE_TUS_ENDPOINT, spoolDir: DESIGNPRO_SPOOL_DIR, spool, storagePath, contentType, signal });
  await removeCommittedSpool(spool).catch((error) => console.error(`[DESIGNPRO-OS] committed Call 8 master spool cleanup failed: ${error.message}`));
  return stored;
}

// An enhanced panel lands on full print geometry -- a 227" side at 150 DPI is
// tens of thousands of pixels across -- so it is routinely past the standard
// upload threshold and has to go up the same resumable way Call 12 sends it.
// The prefix fence is the run's own `enhanced/` namespace and nothing else.
async function uploadEnhancedPanel(storagePath, buffer, contentType, tenantKey, workflowRunId, signal) {
  const runPrefix = `designpro/${canonicalTenantKey(tenantKey)}/${canonicalUuid(workflowRunId, "workflowRunId")}/enhanced/`;
  if (!storagePath.startsWith(runPrefix) || !/^[A-Za-z0-9._/-]+$/.test(storagePath) || storagePath.includes("..")) throw new Error("unsafe enhanced panel path");
  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (body.length <= MAX_STANDARD_UPLOAD_BYTES) return immutableStorageUpload(supabase.storage, "wrap-files", storagePath, body, contentType);
  const contentHash = createHash("sha256").update(body).digest("hex");
  const materialHash = createHash("sha256").update(JSON.stringify({ storagePath, contentHash, byteSize: body.length, contentType })).digest("hex");
  const spool = await spoolImmutableBuffer({ spoolDir: DESIGNPRO_SPOOL_DIR, runId: workflowRunId, materialHash, bytes: body, signal });
  const stored = await uploadSpoolWithTus({ supabase, supabaseUrl: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY, endpoint: SUPABASE_TUS_ENDPOINT, spoolDir: DESIGNPRO_SPOOL_DIR, spool, storagePath, contentType, signal });
  await removeCommittedSpool(spool).catch((error) => console.error(`[DESIGNPRO-OS] committed enhanced panel spool cleanup failed: ${error.message}`));
  return stored;
}

async function existingMaster(storagePath) {
  const { data, error } = await supabase.storage.from("wrap-files").download(storagePath);
  if (error) {
    const status = String(error.statusCode || error.status || "");
    if (status === "404" || /not found|does not exist/i.test(String(error.message || ""))) return null;
    throw new Error(`immutable master read failed: ${error.message}`);
  }
  if (!data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  if (!bytes.length) throw new Error(`immutable master ${storagePath} is empty`);
  return bytes;
}

let readiness = { ready: false, service: "designproai-os", commit: GIT_SHA, workerId: WORKER_ID, imageModel: GOOGLE_IMAGE_MODEL, error: "dependency_probe_pending" };
let claimant = null;
let generationWorker = null;
let deliveryTimer = null;
let deliveryBusy = false;
const notificationReadiness = resendReadiness(process.env);
const enhancementReadiness = topazReadiness(process.env);
const emailTransport = notificationReadiness.enabled && notificationReadiness.available ? createResendTransport() : null;
const publicGoLiveBlockers = Object.freeze(notificationReadiness.publicGoLiveReady
  ? []
  : [notificationReadiness.enabled === false ? "outbound_email_disabled" : "outbound_email_not_configured"]);
// Call 12 is a production-pack dependency, not a dark-acceptance one: a pack
// cannot be built without it, so an unconfigured enhancer blocks public go-live
// the same way outbound email does.
const enhancementGoLiveBlockers = Object.freeze(enhancementReadiness.enabled && enhancementReadiness.available
  ? []
  : [enhancementReadiness.enabled === false ? "topaz_enhancement_disabled" : "topaz_enhancement_not_configured"]);

function ensureDeliveryWorkers() {
  if (deliveryTimer) return;
  if (notificationReadiness.enabled && (!emailTransport || !notificationReadiness.available)) throw new Error("WrapBox notification transport is not ready");
  const tick = async () => {
    if (deliveryBusy) return;
    deliveryBusy = true;
    try {
      const reconciled = await reconcileCompletedWrapboxDeliveries({ supabase, limit: 25 });
      if (reconciled.blocked.length) console.error(`[DESIGNPRO-OS] WrapBox publication blocked for ${reconciled.blocked.length} completed run(s)`);
      if (emailTransport) await dispatchOneWrapboxNotification({ supabase, workerId: `${WORKER_ID}-wrapbox-mail`, appOrigin: appOrigin.origin, emailTransport });
    } catch (error) {
      console.error(`[DESIGNPRO-OS] WrapBox background worker failed: ${error.code || "delivery_background_failed"}: ${error.message}`);
    } finally { deliveryBusy = false; }
  };
  deliveryTimer = setInterval(() => void tick(), 5_000);
  deliveryTimer.unref?.();
  void tick();
}

function stopWorkerLoops() {
  if (claimant) claimant.stop();
  claimant = null;
  if (generationWorker) generationWorker.stop();
  generationWorker = null;
  if (deliveryTimer) clearInterval(deliveryTimer);
  deliveryTimer = null;
}

/**
 * Calls 1-7. Separate from the Calls 8-12 claimant on purpose: generation and
 * production sit on opposite sides of the seven-view contract, and a generation
 * outage must not stop production packs that already have their sources.
 */
function ensureGenerationWorker() {
  if (generationWorker) return;
  generationWorker = createGenerationWorker({
    supabase,
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    workerId: `${WORKER_ID}-calls-1-7`,
  });
  generationWorker.start();
}

async function refreshReadiness() {
  try {
    const dependencies = await probeRuntimeDependencies(supabase);
    if (!notificationReadiness.configurationValid) {
      stopWorkerLoops();
      readiness = {
        ready: false, service: "designproai-os", commit: GIT_SHA, workerId: WORKER_ID,
        imageModel: GOOGLE_IMAGE_MODEL, requiredEnvironment: REQUIRED_RUNTIME_ENV, publicGoLiveEnvironment: PUBLIC_GO_LIVE_ENV,
        publicGoLiveReady: false, publicGoLiveBlockers,
        workerLoopsStarted: false,
        dependencies: { ...dependencies, wrapboxPublisher: false, notifications: notificationReadiness },
        error: `WrapBox notification unavailable: ${notificationReadiness.detail}`,
        checkedAt: new Date().toISOString(),
      };
      return;
    }
    if (!claimant) claimant = registerDesignProStandaloneClaimant({ app, supabase, supabaseUrl: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY, workerSecret: WORKER_SECRET, workerId: WORKER_ID, port: PORT, spoolDir: DESIGNPRO_SPOOL_DIR, tusEndpoint: SUPABASE_TUS_ENDPOINT });
    ensureDeliveryWorkers();
    ensureGenerationWorker();
    readiness = {
      ready: true, service: "designproai-os", commit: GIT_SHA, workerId: WORKER_ID,
      imageModel: GOOGLE_IMAGE_MODEL, requiredEnvironment: REQUIRED_RUNTIME_ENV, publicGoLiveEnvironment: PUBLIC_GO_LIVE_ENV,
      publicGoLiveReady: notificationReadiness.publicGoLiveReady && enhancementGoLiveBlockers.length === 0,
      publicGoLiveBlockers: [...publicGoLiveBlockers, ...enhancementGoLiveBlockers],
      workerLoopsStarted: true,
      dependencies: {
        ...dependencies, wrapboxPublisher: true, notifications: notificationReadiness, enhancement: enhancementReadiness,
        generation: { started: Boolean(generationWorker), models: generationWorker?.provider?.models || [], keyCount: generationWorker?.provider?.keyCount || 0 },
      },
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    stopWorkerLoops();
    readiness = { ready: false, service: "designproai-os", commit: GIT_SHA, workerId: WORKER_ID, imageModel: GOOGLE_IMAGE_MODEL, requiredEnvironment: REQUIRED_RUNTIME_ENV, publicGoLiveEnvironment: PUBLIC_GO_LIVE_ENV, publicGoLiveReady: false, publicGoLiveBlockers, workerLoopsStarted: false, dependencies: { notifications: notificationReadiness }, error: String(error.message || error), checkedAt: new Date().toISOString() };
  }
}
app.get("/health", (_req, res) => res.status(readiness.ready ? 200 : 503).json(readiness));

/**
 * PURCHASE WRITES. Privileged, so they live here rather than in the gateway.
 *
 * The gateway is browser-facing and holds no service role; it talks to Stripe
 * and proves a webhook delivery was signed, then forwards the decision over the
 * WORKER_SECRET channel. These two endpoints are what may actually write an
 * entitlement -- which is the difference between a payment and a claim.
 *
 * There is one endpoint, and it records a verified payment. It does not run
 * Topaz, build files, or construct a workflow: the production run already
 * exists, parked at its purchase gate, and the worker's reconciler is what
 * advances it. Payment changes authorization; the worker changes workflow state.
 */
/**
 * THE DIMENSION PREVIEW THE INTAKE FORM ASKS FOR WHILE IT IS BEING FILLED.
 *
 * The customer should not press Generate and only then discover their vehicle
 * has no measured record. This answers "does GENIE know this vehicle?" from the
 * catalog ONLY -- it never grounds and never writes, so it is safe to call on a
 * debounced keystroke, unlike `resolveFlatAtlasPreviewDimensions`, which makes
 * a Gemini request and inserts a candidate row on a miss.
 *
 * It lives here rather than in the gateway because the matcher lives here. Two
 * implementations of "does this catalog row match this vehicle" would drift the
 * week they were written, and the gateway is browser-facing and holds no
 * service role in any case.
 */
/**
 * GENIE PREP — THE EARLY LIFECYCLE (owner ruling, Trish 2026-09-02).
 *
 * Year / Make / Model → ENTER → GenerationID → this endpoint. It acknowledges
 * the GenerationID, records an idempotent prep row keyed by
 * (generationId, vehicleIdentityHash, GENIE_PREP_CONTRACT) and starts the SAME
 * resolver the generation worker uses inline -- without waiting for it. The
 * customer keeps writing; Generate later consumes the READY geometry or falls
 * back to the inline resolver. The answer carries lifecycle and provenance
 * only: the prepared inches are private OS state and never reach the browser
 * or the model-facing request.
 */
app.post("/internal/genie/prep", authMiddleware, async (req, res) => {
  const service = generationWorker?.geniePrep;
  if (!service) return res.status(503).json({ status: "unavailable", reason: "generation_worker_not_started" });
  try {
    const body = req.body || {};
    const { receipt } = await service.requestPrep({
      ownerId: body.ownerId,
      generationId: body.generationId,
      vehicle: body.vehicle || {},
      clientEnteredAt: body.clientEnteredAt || null,
    });
    return res.status(202).json(receipt);
  } catch (error) {
    // Prep is an assist, never a gate: an unusable vehicle answers a receipt
    // that says so, and Generate stays live with the inline resolver.
    return res.status(200).json({
      status: "unavailable",
      reason: String(error?.code || error?.message || "genie_prep_unavailable"),
    });
  }
});

app.post("/internal/genie/dimensions/preview", authMiddleware, async (req, res) => {
  try {
    const { previewGenieDimensionsFromCatalog } = require("./genie-universal-resolver.cjs");
    const preview = await previewGenieDimensionsFromCatalog(supabase, req.body?.vehicle || req.body);
    return res.status(200).json(preview);
  } catch (error) {
    // A preview is an assist, never a gate: an unusable vehicle string or a
    // catalog hiccup answers "we do not know", and the customer proceeds.
    return res.status(200).json({
      resolution: { state: "unresolved", productionEligible: false, operatorValidated: false,
        reason: String(error?.code || error?.message || "preview_unavailable") },
      surfaces: [],
      candidates: [],
    });
  }
});

app.post("/internal/purchases/confirm", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    if (JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(["amountCents", "checkoutSessionId", "discountCents", "generationId", "paymentIntentId", "productType", "promotionCode", "userEmail"])) {
      return res.status(400).json({ error: "purchase_confirm_request_invalid" });
    }
    // The two products the system sells. Anything else is refused rather than
    // recorded, so a stray webhook cannot mint an entitlement for a product
    // nothing fulfills.
    if (!["print_pack_entitlement", "logo_pack"].includes(String(body.productType))) {
      return res.status(400).json({ error: "unknown_product_type" });
    }
    // A fully-discounted order is a real purchase at zero -- but only when the
    // code that made it free came with it. Zero with no code is refused here as
    // well as by the table constraint, so a webhook that lost its total cannot
    // mint a free entitlement.
    const promotionCode = body.promotionCode == null ? null : String(body.promotionCode).trim();
    if (!Number.isInteger(body.amountCents) || body.amountCents < 0) {
      return res.status(400).json({ error: "purchase_amount_invalid" });
    }
    if (body.amountCents === 0 && !promotionCode) {
      return res.status(400).json({ error: "purchase_amount_invalid" });
    }
    if (!Number.isInteger(body.discountCents) || body.discountCents < 0) {
      return res.status(400).json({ error: "purchase_discount_invalid" });
    }
    if ((body.discountCents > 0) !== Boolean(promotionCode)) {
      return res.status(400).json({ error: "purchase_discount_invalid" });
    }
    const { data, error } = await supabase.rpc("confirm_designpro_purchase", {
      p_checkout_session_id: String(body.checkoutSessionId || ""),
      p_payment_intent_id: body.paymentIntentId == null ? null : String(body.paymentIntentId),
      p_product_type: String(body.productType),
      p_generation_id: canonicalUuid(body.generationId, "generationId"),
      p_amount_cents: Number(body.amountCents),
      p_user_email: body.userEmail ? String(body.userEmail) : null,
      p_promotion_code: promotionCode || null,
      p_discount_cents: Number(body.discountCents),
    });
    if (error) return res.status(400).json({ error: error.message });
    // Recording the entitlement is the whole of it. The worker's reconciler
    // releases the waiting production run; Stripe never runs the pipeline.
    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json({ error: String(error.message || error) });
  }
});

/**
 * RUN UPSCALE, ON ONE SURFACE, ON PURPOSE.
 *
 * Call 12 enhances all six surfaces automatically once the purchase gate and
 * the PanelPro preflight gate have both released. That is the production path
 * and it is unchanged. This is the same enhancement, on one surface, triggered
 * explicitly from the PanelPro Studio board so the design team can exercise and
 * inspect the real upscale before trusting it to run unattended.
 *
 * It is the production implementation, not a stand-in: the same
 * `enhancePanel` from topaz-upscale.cjs, the same readiness check, the same
 * three-attempt ladder, the same exact-geometry landing, and the same
 * `upscaled-panel` artifact kind carrying the same provenance fields Call 12
 * writes. A derivative made here is therefore a derivative Call 12 would
 * recognise and reuse.
 *
 * THE SOURCE IS NEVER OVERWRITTEN. The active artifact for the surface is read,
 * hash-verified against what the database says it is, and enhanced into a NEW
 * object at a material-addressed path. Both stay downloadable, and the
 * derivative records which one it came from, at what size, by what factor.
 *
 * The target geometry is the panel's own stamped trim inches plus the 5" bleed
 * at 150 DPI -- the identical formula Call 12 uses -- so an admin-triggered
 * derivative lands on exactly the print geometry the automatic one would.
 */
app.post("/internal/panels/upscale", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    if (JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(["generationId", "ownerId", "surfaceKey"])) {
      return res.status(400).json({ error: "panel_upscale_request_invalid" });
    }
    const generationId = canonicalUuid(body.generationId, "generationId");
    const ownerId = canonicalUuid(body.ownerId, "ownerId");
    const surfaceKey = String(body.surfaceKey || "");
    if (!SURFACE_KEYS.includes(surfaceKey)) return res.status(400).json({ error: "panel_upscale_surface_invalid" });

    const readiness = topazReadiness(process.env);
    if (!readiness.configurationValid) return res.status(503).json({ error: "topaz_configuration_invalid", detail: readiness.detail });
    if (!readiness.enabled || !readiness.available) return res.status(503).json({ error: "topaz_unavailable", detail: readiness.detail });

    // The run this design belongs to, newest first: a revision mints a new run
    // against the same generation and the board works the current one.
    const { data: runs, error: runError } = await supabase
      .from("designpro_workflow_runs")
      .select("id,tenant_key,owner_id,results,created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if (runError) return res.status(400).json({ error: runError.message });
    const run = (runs || []).find((row) => String(row.results?.generationId || "") === generationId);
    if (!run) return res.status(404).json({ error: "panel_upscale_run_not_found" });

    const { data: artifacts, error: artifactError } = await supabase
      .from("designpro_artifacts")
      .select("id,stage_id,artifact_kind,surface_key,storage_path,content_hash,byte_size,metadata,created_at")
      .eq("run_id", run.id)
      .in("artifact_kind", ["panel", "corrected-panel"])
      .eq("surface_key", surfaceKey)
      .order("created_at", { ascending: false });
    if (artifactError) return res.status(400).json({ error: artifactError.message });
    const branded = (artifacts || []).find((row) => row.artifact_kind === "panel");
    if (!branded) return res.status(409).json({ error: "panel_upscale_source_missing" });
    // The ACTIVE artifact, by the same rule Call 12 enhances by: the newest
    // human correction when one exists, the branded Call 9 panel otherwise.
    const source = (artifacts || []).find((row) => row.artifact_kind === "corrected-panel") || branded;

    // The GENIE trim inches this surface was cut to, read off the branded Call 9
    // panel. A correction replaces the artwork, never the geometry it has to fit,
    // so the target is the same whichever artifact is active.
    // Read BOTH shapes, the same way enhance.upscale's own gate does. Call 9
    // writes two: a gridslice panel carries trimWidthInches with a four-edge
    // `bleed` object, an A.T.L.A.S. Call-1 promotion carries trimWidthIn with a
    // scalar `bleedInches`. Naming only the gridslice shape would have refused
    // every atlas panel here with panel_upscale_dimensions_missing -- which is
    // exactly the set this button exists to enhance.
    const metadata = branded.metadata || {};
    const trimWidthIn = Number(metadata.trimWidthIn ?? metadata.trimWidthInches);
    const trimHeightIn = Number(metadata.trimHeightIn ?? metadata.trimHeightInches);
    if (!(trimWidthIn > 0) || !(trimHeightIn > 0)) {
      return res.status(409).json({ error: "panel_upscale_dimensions_missing" });
    }
    const bleed = metadata.bleed && typeof metadata.bleed === "object" ? metadata.bleed : null;
    const fiveOnEveryEdge = bleed
      ? ["top", "right", "bottom", "left"].every((edge) => Number(bleed[edge]) === 5)
      : Number(metadata.bleedInches) === 5;
    if (!fiveOnEveryEdge) {
      return res.status(409).json({ error: "panel_upscale_bleed_invalid" });
    }
    const targetWidthPx = Math.round((trimWidthIn + 10) * 150);
    const targetHeightPx = Math.round((trimHeightIn + 10) * 150);

    const download = await supabase.storage.from("wrap-files").download(source.storage_path);
    if (download.error || !download.data) return res.status(409).json({ error: "panel_upscale_source_unreadable" });
    const sourceBytes = Buffer.from(await download.data.arrayBuffer());
    const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
    // The bytes have to be the ones the database says they are. Enhancing an
    // object that changed under its own hash would produce a derivative bound to
    // a panel that no longer exists.
    if (sourceHash !== source.content_hash) return res.status(409).json({ error: "panel_upscale_source_changed" });
    const sourceMeta = await sharp(sourceBytes, { limitInputPixels: false }).metadata();

    const enhanced = await enhancePanel({
      readiness,
      surfaceKey,
      bytes: sourceBytes,
      mimeType: "image/png",
      targetWidthPx,
      targetHeightPx,
    });

    const storagePath = `designpro/${canonicalTenantKey(run.tenant_key)}/${run.id}/enhanced/${surfaceKey}-${String(source.content_hash).slice(0, 24)}.png`;
    const stored = await uploadEnhancedPanel(storagePath, enhanced.bytes, "image/png", run.tenant_key, run.id, null);
    if (stored.contentHash !== enhanced.contentHash) return res.status(409).json({ error: "panel_upscale_storage_hash_drift" });

    const { error: insertError } = await supabase.from("designpro_artifacts").insert({
      run_id: run.id,
      stage_id: source.stage_id,
      artifact_kind: "upscaled-panel",
      surface_key: surfaceKey,
      storage_path: storagePath,
      content_hash: enhanced.contentHash,
      byte_size: enhanced.byteSize,
      metadata: {
        call: 12,
        contract: enhanced.contract,
        engine: enhanced.engine,
        model: enhanced.model,
        // Explicitly an operator-run enhancement, so a receipt reader can tell
        // it apart from the automatic Call 12 pass without inferring anything.
        adminTriggered: true,
        sourcePanelPath: source.storage_path,
        sourcePanelHash: source.content_hash,
        sourceArtifactKind: source.artifact_kind,
        humanCorrected: source.artifact_kind === "corrected-panel",
        brandedPanelHash: branded.content_hash,
        enhancedSha256: enhanced.enhancedSha256,
        enhancement: "topaz",
        plan: enhanced.plan,
        clampedByEngineCeiling: enhanced.plan?.clampedByEngineCeiling === true,
        sourcePixels: { widthPx: Number(sourceMeta.width) || null, heightPx: Number(sourceMeta.height) || null },
        widthPx: targetWidthPx,
        heightPx: targetHeightPx,
        trimWidthInches: trimWidthIn,
        trimHeightInches: trimHeightIn,
        bleed: { top: 5, right: 5, bottom: 5, left: 5 },
        surfaceSqFt: metadata.surfaceSqFt ?? null,
        dpi: 1500,
        outputScale: 0.1,
      },
    });
    // Re-running on unchanged bytes lands on the same material-addressed path
    // and the same hash, which the artifact table's own uniqueness rejects.
    // That is the idempotent answer, not a failure.
    if (insertError && !/duplicate|conflict|unique/i.test(insertError.message)) {
      return res.status(400).json({ error: insertError.message });
    }

    return res.status(200).json({
      surfaceKey,
      contentHash: enhanced.contentHash,
      byteSize: enhanced.byteSize,
      sourceArtifactKind: source.artifact_kind,
      sourcePanelHash: source.content_hash,
      sourcePixels: { widthPx: Number(sourceMeta.width) || null, heightPx: Number(sourceMeta.height) || null },
      outputPixels: { widthPx: targetWidthPx, heightPx: targetHeightPx },
      upscaleFactor: enhanced.plan?.scale ?? null,
      clampedByEngineCeiling: enhanced.plan?.clampedByEngineCeiling === true,
      engineModel: enhanced.model,
      idempotent: Boolean(insertError),
    });
  } catch (error) {
    return res.status(400).json({ error: String(error.code || error.message || error) });
  }
});

app.post("/internal/wrapbox/recipient", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const keys = Object.keys(body).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["customerEmail", "customerReference", "generationId", "operatorId", "orderNumber", "verificationRefHash"])) return res.status(400).json({ error: "recipient_registration_request_invalid" });
    const operatorId = canonicalUuid(body.operatorId, "operatorId");
    const generationId = canonicalUuid(body.generationId, "generationId");
    const customerEmail = String(body.customerEmail || "").trim().toLowerCase();
    const customerReference = String(body.customerReference || "").trim();
    const orderNumber = String(body.orderNumber || "");
    const verificationRefHash = String(body.verificationRefHash || "").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) || customerEmail.length > 320 ||
      !/^[^\u0000-\u001f\u007f]{1,160}$/.test(customerReference) ||
      !/^[0-9a-f]{64}$/.test(verificationRefHash) || orderNumber !== orderNumber.trim() ||
      !/^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$/.test(orderNumber)) return res.status(400).json({ error: "recipient_registration_request_invalid" });
    // Defense in depth: the gateway checks the caller-visible entitlement
    // before forwarding any recipient details, and the trusted runtime proves
    // it again using the service role. An internal caller cannot turn WrapBox
    // into a pre-purchase customer registry.
    const { data: entitlement, error: entitlementError } = await supabase
      .from("designpro_purchase_entitlements")
      .select("id")
      .eq("owner_id", operatorId)
      .eq("generation_id", generationId)
      .eq("product_type", "print_pack_entitlement")
      .limit(1)
      .maybeSingle();
    if (entitlementError || !entitlement?.id) {
      console.error(`[DESIGNPRO-OS] recipient registration blocked: production entitlement missing for ${generationId}`);
      return res.status(409).json({ error: "production_pack_entitlement_required" });
    }
    const { data, error } = await supabase.rpc("register_designpro_operator_wrapbox_recipient", {
      p_operator_id: operatorId,
      p_customer_email: customerEmail,
      p_customer_reference: customerReference,
      p_verification_ref_hash: verificationRefHash,
      p_order_number: orderNumber,
    });
    if (error || !data) {
      console.error(`[DESIGNPRO-OS] recipient registration rejected: ${error?.message || "empty response"}`);
      return res.status(403).json({ error: "recipient_registration_rejected" });
    }
    const response = {
      customerId: canonicalUuid(data.customerId, "customerId"),
      customerEmail: String(data.customerEmail || "").trim().toLowerCase(),
      recipientIdentityHash: String(data.recipientIdentityHash || "").toLowerCase(),
      emailVerifiedAt: String(data.emailVerifiedAt || ""),
      orderNumber: String(data.orderNumber || ""),
      idempotent: data.idempotent === true,
    };
    if (response.customerEmail !== customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(response.customerEmail) || !/^[0-9a-f]{64}$/.test(response.recipientIdentityHash) || Number.isNaN(Date.parse(response.emailVerifiedAt)) || response.orderNumber !== orderNumber) throw new Error("recipient registration response invalid");
    res.json(response);
  } catch (error) {
    console.error(`[DESIGNPRO-OS] recipient registration failed: ${error.message}`);
    res.status(400).json({ error: "recipient_registration_response_invalid" });
  }
});

// Seven immutable DesignPanel renders -> six own-surface flat fields -> the
// dimensioned Call 8 proof -> deterministic gridslice identities for Call 9.
// Each surface author receives only its own approved render. The hero/driver
// view is never used as an anchor for another surface. Call 9 repeats only the
// geometric gridslice and never runs a model.
app.post("/compose-proof-sheet", authMiddleware, async (req, res) => {
  // CALL 8: DETERMINISTIC ASSEMBLY OF THE SIX CALL-1 PANELS. NO MODEL.
  //
  // What this endpoint used to do, in its own three numbered steps:
  //   1. `authorFlatSurfaceFields` -- one Gemini image call per surface, each
  //      handed that surface's 3D PROOF PHOTOGRAPH and asked to flatten it back
  //      into a rectangle;
  //   2. `gridSliceAll` over those flattened photographs, producing the
  //      "deterministic gridslice identities" `panels.build` then reproduced
  //      and shipped as print files;
  //   3. `renderProofSheet` over the seven proof photographs.
  //
  // Every one of those three is a 3D proof becoming production artwork, and the
  // owner's invariant (2026-08-29) is that none of them may: "No pixel
  // originating from a 3D proof may ever become a Call-8 surface, production
  // panel, print file, or ZIP asset."
  //
  // So there is one step now. The six Call-1 panels -- geometric crops of the
  // accepted A.T.L.A.S. master, already at GENIE trim with the five-inch bleed
  // -- are loaded, hash-verified, and composed onto the dimensioned sheet by
  // `runtime/proof-sheet.cjs`. Every mark on that sheet that is not a panel is
  // DRAWN, so no label, callout or square footage can be hallucinated. There is
  // no `GOOGLE_IMAGE_MODEL` in this handler and there must not be one again.
  const requestAbort = new AbortController();
  req.once("aborted", () => requestAbort.abort(new Error("claimant request aborted")));
  res.once("close", () => { if (!res.writableEnded) requestAbort.abort(new Error("claimant connection closed")); });
  try {
    const { tenantKey: rawTenantKey, workflowRunId: rawWorkflowRunId, revisionId: rawRevisionId, surfaces = [], panelAssets = [], textLock, flatMaterialHash, vehicle, proofMeta } = req.body || {};
    const tenantKey = canonicalTenantKey(rawTenantKey);
    const workflowRunId = canonicalUuid(rawWorkflowRunId, "workflowRunId");
    const revisionId = canonicalUuid(rawRevisionId, "revisionId");
    if (!Array.isArray(surfaces) || surfaces.length !== SURFACE_KEYS.length) {
      return res.status(400).json({ success: false, error: "exactly six validated GENIE surfaces are required" });
    }
    let panels;
    try { panels = normalizeCallOnePanelSet(panelAssets, tenantKey); }
    catch (error) { return res.status(400).json({ success: false, error: error.message }); }

    const frozenTextLock = normalizeTextLock(textLock);
    const computedMaterialHash = call8ProofMaterialHash({ panels, surfaces, revisionId, textLock: frozenTextLock, tenantKey });
    if (String(flatMaterialHash || "").toLowerCase() !== computedMaterialHash) return res.status(409).json({ success: false, error: "Call 8 panel material identity changed" });

    // Load the six panels and prove the bytes are the artifacts the caller
    // named. A panel whose storage object no longer hashes to its identity is a
    // refusal, never a silent substitution.
    const panelBytes = {};
    const masterHashes = new Set();
    for (const panel of panels) {
      const { data, error } = await supabase.storage.from(panel.bucket).download(panel.storagePath);
      if (error || !data) return res.status(502).json({ success: false, error: `Call 1 panel download failed for ${panel.surfaceKey}: ${error?.message || "empty object"}` });
      const bytes = Buffer.from(await data.arrayBuffer());
      const observed = createHash("sha256").update(bytes).digest("hex");
      if (observed !== panel.contentHash || bytes.length !== panel.byteSize) {
        return res.status(409).json({ success: false, error: `Call 1 panel ${panel.surfaceKey} changed before the proof was drawn` });
      }
      panelBytes[panel.surfaceKey] = bytes;
      if (panel.sourceMasterHash) masterHashes.add(String(panel.sourceMasterHash).toLowerCase());
    }

    const sheet = await renderProofSheet({
      panels: panelBytes,
      surfaces,
      vehicle,
      designName: proofMeta?.designName, finish: proofMeta?.finish,
      designId: proofMeta?.designId, orderNumber: proofMeta?.orderNumber,
      proofBinding: computedMaterialHash,
      // One master, or nothing claimed. Six panels naming two different masters
      // is a lineage defect, and the sheet says "unbound" rather than picking one.
      masterHash: masterHashes.size === 1 ? [...masterHashes][0] : "",
    });
    const proofPath = `designpro/${tenantKey}/${workflowRunId}/proof/call8-2d-production-proof-${computedMaterialHash.slice(0, 24)}.png`;
    const storedProof = await uploadBuffer(proofPath, sheet.bytes, "image/png", tenantKey, workflowRunId, requestAbort.signal);

    res.json({
      success: true, contract: "designpro.call8-panel-proof.v4",
      // STATED, NOT INFERRED. A reader must not have to prove a negative from
      // the absence of a field, and a v3 caller must not be able to read this
      // response as its own.
      deterministic: true,
      imageRequestCount: 0,
      assembledFrom: "atlas-call1-panels",
      flatMaterialHash: computedMaterialHash, textLock: frozenTextLock,
      surfaceTiles: sheet.tiles.map((tile) => {
        const panel = panels.find((item) => item.surfaceKey === tile.surfaceKey);
        return {
          surfaceKey: tile.surfaceKey,
          sourcePanelPath: panel.storagePath,
          sourcePanelHash: panel.contentHash,
          trimWidthIn: tile.trimWidthIn, trimHeightIn: tile.trimHeightIn,
          printWidthIn: tile.printWidthIn, printHeightIn: tile.printHeightIn,
          placement: tile.placement,
        };
      }),
      proof: {
        contract: PROOF_SHEET_CONTRACT,
        storagePath: storedProof.storagePath, contentHash: storedProof.contentHash, byteSize: storedProof.byteSize,
        width: sheet.width, height: sheet.height, totalSqFt: sheet.totalSqFt,
      },
    });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[DESIGNPRO-OS] ${WORKER_ID} listening on ${PORT}`);
  void refreshReadiness();
  const readinessTimer = setInterval(() => void refreshReadiness(), 30_000);
  readinessTimer.unref?.();
});
