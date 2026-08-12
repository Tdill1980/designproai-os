"use strict";

const express = require("express");
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");
const { createHash } = require("node:crypto");
const { registerDesignProStandaloneClaimant } = require("./designpro-standalone-claimant.cjs");
const { canonicalTenantKey, canonicalUuid, immutableStorageUpload, normalizeSourceAsset, verifySourceBytes } = require("./runtime-contract.cjs");
const { probeRuntimeDependencies } = require("./runtime-readiness.cjs");
const { normalizeTextLock, selectedImageModel, SURFACE_KEYS, VIEW_KEYS } = require("./gemini-flat-surface.cjs");
const { authorFlatWrapLayout, flatWrapInputHash } = require("./gemini-flat-wrap.cjs");
const { EXTRACTION_CONTRACT, LAYOUT_CONTRACT, assertLayoutMatches, assertSurfacesAreDistinct, cutAllPanels, layoutIdentity } = require("./flat-wrap-layout.cjs");
const { PROOF_SHEET_CONTRACT, renderProofSheet } = require("./proof-sheet.cjs");
const { dispatchOneWrapboxNotification, reconcileCompletedWrapboxDeliveries } = require("./wrapbox-delivery.cjs");
const { createResendTransport, resendReadiness } = require("./resend-transport.cjs");
const { MAX_STANDARD_UPLOAD_BYTES, removeCommittedSpool, spoolImmutableBuffer, uploadSpoolWithTus } = require("./zip-spool.cjs");

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
  "DESIGNPRO_OUTBOUND_EMAIL_ENABLED=true|false",
]);
const PUBLIC_GO_LIVE_ENV = Object.freeze([
  "DESIGNPRO_OUTBOUND_EMAIL_ENABLED=true", "RESEND_API_KEY", "RESEND_FROM", "RESEND_FROM_VERIFIED=true",
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

async function sourceObject(rawAsset, tenantValue, revisionValue) {
  const tenant = canonicalTenantKey(tenantValue);
  const revisionId = canonicalUuid(revisionValue, "revisionId");
  const asset = normalizeSourceAsset(rawAsset, tenant, revisionId);
  const { data, error } = await supabase.storage.from(asset.bucket).download(asset.storagePath);
  if (error || !data) throw new Error(`private seven-view source download failed: ${error?.message || "empty object"}`);
  const bytes = verifySourceBytes(asset, Buffer.from(await data.arrayBuffer()));
  return { ...asset, bytes };
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
let deliveryTimer = null;
let deliveryBusy = false;
const notificationReadiness = resendReadiness(process.env);
const emailTransport = notificationReadiness.enabled && notificationReadiness.available ? createResendTransport() : null;
const publicGoLiveBlockers = Object.freeze(notificationReadiness.publicGoLiveReady
  ? []
  : [notificationReadiness.enabled === false ? "outbound_email_disabled" : "outbound_email_not_configured"]);

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
  if (deliveryTimer) clearInterval(deliveryTimer);
  deliveryTimer = null;
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
    readiness = {
      ready: true, service: "designproai-os", commit: GIT_SHA, workerId: WORKER_ID,
      imageModel: GOOGLE_IMAGE_MODEL, requiredEnvironment: REQUIRED_RUNTIME_ENV, publicGoLiveEnvironment: PUBLIC_GO_LIVE_ENV,
      publicGoLiveReady: notificationReadiness.publicGoLiveReady, publicGoLiveBlockers,
      workerLoopsStarted: true,
      dependencies: { ...dependencies, wrapboxPublisher: true, notifications: notificationReadiness },
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    stopWorkerLoops();
    readiness = { ready: false, service: "designproai-os", commit: GIT_SHA, workerId: WORKER_ID, imageModel: GOOGLE_IMAGE_MODEL, requiredEnvironment: REQUIRED_RUNTIME_ENV, publicGoLiveEnvironment: PUBLIC_GO_LIVE_ENV, publicGoLiveReady: false, publicGoLiveBlockers, workerLoopsStarted: false, dependencies: { notifications: notificationReadiness }, error: String(error.message || error), checkedAt: new Date().toISOString() };
  }
}
app.get("/health", (_req, res) => res.status(readiness.ready ? 200 : 503).json(readiness));

app.post("/internal/wrapbox/recipient", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const keys = Object.keys(body).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["customerEmail", "customerReference", "operatorId", "orderNumber", "verificationRefHash"])) return res.status(400).json({ error: "recipient_registration_request_invalid" });
    const operatorId = canonicalUuid(body.operatorId, "operatorId");
    const customerEmail = String(body.customerEmail || "").trim().toLowerCase();
    const customerReference = String(body.customerReference || "").trim();
    const orderNumber = String(body.orderNumber || "");
    const verificationRefHash = String(body.verificationRefHash || "").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) || customerEmail.length > 320 ||
      !/^[^\u0000-\u001f\u007f]{1,160}$/.test(customerReference) ||
      !/^[0-9a-f]{64}$/.test(verificationRefHash) || orderNumber !== orderNumber.trim() ||
      !/^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$/.test(orderNumber)) return res.status(400).json({ error: "recipient_registration_request_invalid" });
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

// Seven immutable renders -> ONE continuous flat wrap design -> six exact cuts
// -> the customer 2D Production Proof.
//
// The design is authored once. Call 9 cuts the six production panels straight
// out of it at fixed rectangles, so no panel is ever regenerated and no
// surface can inherit another surface's artwork. The proof sheet is the
// customer document: every approved view with its GENIE trim callout, the
// print size at five-inch bleed, per-surface and total square footage, and the
// approval block.
app.post("/compose-proof-sheet", authMiddleware, async (req, res) => {
  const requestAbort = new AbortController();
  req.once("aborted", () => requestAbort.abort(new Error("claimant request aborted")));
  res.once("close", () => { if (!res.writableEnded) requestAbort.abort(new Error("claimant connection closed")); });
  try {
    const { tenantKey: rawTenantKey, workflowRunId: rawWorkflowRunId, revisionId: rawRevisionId, layout: claimedLayout, surfaces = [], sourceAssets = [], textLock, flatMaterialHash, vehicle, proofMeta } = req.body || {};
    const tenantKey = canonicalTenantKey(rawTenantKey);
    const workflowRunId = canonicalUuid(rawWorkflowRunId, "workflowRunId");
    const revisionId = canonicalUuid(rawRevisionId, "revisionId");
    if (!Array.isArray(surfaces) || surfaces.length !== SURFACE_KEYS.length || !Array.isArray(sourceAssets) || sourceAssets.length !== VIEW_KEYS.length) {
      return res.status(400).json({ success: false, error: "exactly seven immutable views and exactly six validated GENIE surfaces are required" });
    }
    // Geometry is recomputed here and compared. A claimant-supplied cut map is
    // never taken on trust.
    const layout = assertLayoutMatches(claimedLayout, surfaces);
    const loadedSources = [];
    const sourceKeys = new Set();
    for (const raw of sourceAssets) {
      const viewKey = String(raw?.viewKey || "").trim().toLowerCase();
      if (!VIEW_KEYS.includes(viewKey) || sourceKeys.has(viewKey)) return res.status(400).json({ success: false, error: `invalid seven-view role ${viewKey || "?"}` });
      sourceKeys.add(viewKey);
      loadedSources.push({ viewKey, ...(await sourceObject(raw, tenantKey, revisionId)) });
    }
    if (VIEW_KEYS.some((key) => !sourceKeys.has(key))) return res.status(400).json({ success: false, error: "seven-view source set is incomplete" });
    const frozenTextLock = normalizeTextLock(textLock);
    const computedMaterialHash = flatWrapInputHash({ sourceViews: loadedSources, layout, revisionId, textLock: frozenTextLock, model: GOOGLE_IMAGE_MODEL });
    if (String(flatMaterialHash || "").toLowerCase() !== computedMaterialHash) return res.status(409).json({ success: false, error: "Call 8 flat wrap material identity changed" });

    // 1. The one continuous flat wrap design. Material-addressed, so a retry
    //    reuses the immutable winner instead of authoring a second design.
    const layoutPath = `designpro/${tenantKey}/${workflowRunId}/proof/flat-wrap-layout-${computedMaterialHash.slice(0, 24)}.png`;
    const authored = await authorFlatWrapLayout({
      apiKey: GOOGLE_AI_API_KEY, model: GOOGLE_IMAGE_MODEL, layout, revisionId,
      inputHash: computedMaterialHash, sourceViews: loadedSources, textLock: frozenTextLock,
      vehicleName: [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "vehicle",
      signal: requestAbort.signal,
      loadExisting: () => existingMaster(layoutPath),
      persist: (bytes) => uploadBuffer(layoutPath, bytes, "image/png", tenantKey, workflowRunId, requestAbort.signal),
    });
    const storedLayout = authored.reused
      ? { storagePath: layoutPath, contentHash: authored.contentHash, byteSize: authored.bytes.length }
      : await uploadBuffer(layoutPath, authored.bytes, "image/png", tenantKey, workflowRunId, requestAbort.signal);

    // 2. The Call 9 cuts, taken here exactly as the claimant will take them, so
    //    the recorded hashes are reproducible rather than merely asserted.
    const panels = await cutAllPanels(authored.bytes, layout);
    const fingerprints = await assertSurfacesAreDistinct(panels);
    const surfacePanels = panels.map((panel) => ({
      key: panel.surfaceKey,
      cutRect: { x: panel.cell.x, y: panel.cell.y, w: panel.cell.w, h: panel.cell.h },
      trimRect: panel.cell.trim,
      contentHash: panel.contentHash, byteSize: panel.byteSize,
      pixelWidth: panel.cell.w, pixelHeight: panel.cell.h,
      trimWidthIn: panel.cell.trimWidthIn, trimHeightIn: panel.cell.trimHeightIn, bleedIn: panel.cell.bleedIn,
      printWidthIn: panel.cell.printWidthIn, printHeightIn: panel.cell.printHeightIn,
      surfaceSqFt: panel.cell.surfaceSqFt,
      artworkFingerprint: fingerprints[panel.surfaceKey],
      provenance: {
        contract: EXTRACTION_CONTRACT, sourceLayoutSha256: storedLayout.contentHash,
        sourceLayoutPath: storedLayout.storagePath, scalePxPerInch: layout.scalePxPerInch,
        model: authored.model, promptVersion: authored.promptVersion, regenerated: false,
      },
    }));

    // 3. The customer document.
    const sheet = await renderProofSheet({
      views: Object.fromEntries(loadedSources.map((item) => [item.viewKey, item.bytes])),
      surfaces: layout.cells.map((cell) => ({ surfaceKey: cell.surfaceKey, widthInches: cell.trimWidthIn, heightInches: cell.trimHeightIn })),
      vehicle,
      designName: proofMeta?.designName, finish: proofMeta?.finish,
      designId: proofMeta?.designId, orderNumber: proofMeta?.orderNumber,
      proofBinding: computedMaterialHash,
    });
    const proofPath = `designpro/${tenantKey}/${workflowRunId}/proof/call8-2d-production-proof-${computedMaterialHash.slice(0, 24)}.png`;
    const storedProof = await uploadBuffer(proofPath, sheet.bytes, "image/png", tenantKey, workflowRunId, requestAbort.signal);

    res.json({
      success: true, contract: "designpro.call8-flat-proof.v2", imageModel: GOOGLE_IMAGE_MODEL,
      flatMaterialHash: computedMaterialHash, textLock: frozenTextLock,
      flatLayout: {
        contract: LAYOUT_CONTRACT, extractionContract: EXTRACTION_CONTRACT,
        storagePath: storedLayout.storagePath, contentHash: storedLayout.contentHash, byteSize: storedLayout.byteSize,
        width: layout.width, height: layout.height, scalePxPerInch: layout.scalePxPerInch,
        layoutHash: layoutIdentity(layout), reusedImmutableWinner: authored.reused === true,
      },
      proof: {
        contract: PROOF_SHEET_CONTRACT,
        storagePath: storedProof.storagePath, contentHash: storedProof.contentHash, byteSize: storedProof.byteSize,
        width: sheet.width, height: sheet.height, totalSqFt: sheet.totalSqFt,
      },
      surfacePanels,
    });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[DESIGNPRO-OS] ${WORKER_ID} listening on ${PORT}`);
  void refreshReadiness();
  const readinessTimer = setInterval(() => void refreshReadiness(), 30_000);
  readinessTimer.unref?.();
});

