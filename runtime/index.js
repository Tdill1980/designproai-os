"use strict";

const express = require("express");
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");
const { createHash } = require("node:crypto");
const { registerDesignProStandaloneClaimant } = require("./designpro-standalone-claimant.cjs");
const { canonicalTenantKey, canonicalUuid, immutableStorageUpload, normalizeSourceAsset, verifySourceBytes } = require("./runtime-contract.cjs");
const { probeRuntimeDependencies } = require("./runtime-readiness.cjs");
const { authorFlatSurfaceMasters, flatInputHash, normalizeTextLock, selectedImageModel, PROMPT_VERSION, SURFACE_KEYS, VIEW_KEYS } = require("./gemini-flat-surface.cjs");
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
  "RESEND_API_KEY", "RESEND_FROM", "RESEND_FROM_VERIFIED=true",
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
  const expectedPrefix = `designpro/${canonicalTenantKey(tenantKey)}/${canonicalUuid(workflowRunId, "workflowRunId")}/proof-masters/`;
  if (!storagePath.startsWith(expectedPrefix) || !/^[A-Za-z0-9._/-]+$/.test(storagePath) || storagePath.includes("..")) throw new Error("unsafe Call 8 master path");
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
const emailTransport = notificationReadiness.available ? createResendTransport() : null;

function ensureDeliveryWorkers() {
  if (deliveryTimer) return;
  if (!emailTransport || !notificationReadiness.available) throw new Error("WrapBox notification transport is not ready");
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
    if (!notificationReadiness.available) {
      stopWorkerLoops();
      readiness = {
        ready: false, service: "designproai-os", commit: GIT_SHA, workerId: WORKER_ID,
        imageModel: GOOGLE_IMAGE_MODEL, requiredEnvironment: REQUIRED_RUNTIME_ENV,
        workerLoopsStarted: false,
        dependencies: { ...dependencies, wrapboxPublisher: false, notifications: notificationReadiness },
        error: `WrapBox notification unavailable: ${notificationReadiness.missing.join(", ")}`,
        checkedAt: new Date().toISOString(),
      };
      return;
    }
    if (!claimant) claimant = registerDesignProStandaloneClaimant({ app, supabase, supabaseUrl: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY, workerSecret: WORKER_SECRET, workerId: WORKER_ID, port: PORT, spoolDir: DESIGNPRO_SPOOL_DIR, tusEndpoint: SUPABASE_TUS_ENDPOINT });
    ensureDeliveryWorkers();
    readiness = {
      ready: true, service: "designproai-os", commit: GIT_SHA, workerId: WORKER_ID,
      imageModel: GOOGLE_IMAGE_MODEL, requiredEnvironment: REQUIRED_RUNTIME_ENV,
      workerLoopsStarted: true,
      dependencies: { ...dependencies, wrapboxPublisher: true, notifications: notificationReadiness },
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    stopWorkerLoops();
    readiness = { ready: false, service: "designproai-os", commit: GIT_SHA, workerId: WORKER_ID, imageModel: GOOGLE_IMAGE_MODEL, requiredEnvironment: REQUIRED_RUNTIME_ENV, workerLoopsStarted: false, error: String(error.message || error), checkedAt: new Date().toISOString() };
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

// Seven immutable renders -> Call 8 flat 2D proof -> six own-surface masters.
// Each master is authored by the bounded Gemini flat-tile boundary ported from
// RP main 02ceea8/proof-sheet.ts blob 814363e, then composed deterministically.
// A full vehicle render is never resized directly into a printable master.
app.post("/compose-proof-sheet", authMiddleware, async (req, res) => {
  const requestAbort = new AbortController();
  req.once("aborted", () => requestAbort.abort(new Error("claimant request aborted")));
  res.once("close", () => { if (!res.writableEnded) requestAbort.abort(new Error("claimant connection closed")); });
  try {
    const { tenantKey: rawTenantKey, workflowRunId: rawWorkflowRunId, revisionId: rawRevisionId, canvas, tiles = [], sourceAssets = [], textLock, flatMaterialHash, vehicle, overlaySvg } = req.body || {};
    const tenantKey = canonicalTenantKey(rawTenantKey);
    const workflowRunId = canonicalUuid(rawWorkflowRunId, "workflowRunId");
    const revisionId = canonicalUuid(rawRevisionId, "revisionId");
    const W = Math.round(Number(canvas?.w)); const H = Math.round(Number(canvas?.h));
    const expectedSurfaceKeys = new Set(SURFACE_KEYS);
    if (!(W > 0 && H > 0 && W * H <= 100_000_000) || !Array.isArray(tiles) || tiles.length !== expectedSurfaceKeys.size || !Array.isArray(sourceAssets) || sourceAssets.length !== VIEW_KEYS.length) return res.status(400).json({ success: false, error: "valid canvas, exactly seven immutable views, and exactly six production surfaces are required" });
    const loadedSources = [];
    const sourceKeys = new Set();
    for (const raw of sourceAssets) {
      const viewKey = String(raw?.viewKey || "").trim().toLowerCase();
      if (!VIEW_KEYS.includes(viewKey) || sourceKeys.has(viewKey)) return res.status(400).json({ success: false, error: `invalid seven-view role ${viewKey || "?"}` });
      sourceKeys.add(viewKey);
      loadedSources.push({ viewKey, ...(await sourceObject(raw, tenantKey, revisionId)) });
    }
    if (VIEW_KEYS.some((key) => !sourceKeys.has(key))) return res.status(400).json({ success: false, error: "seven-view source set is incomplete" });
    const sourceByKey = new Map(loadedSources.map((item) => [item.viewKey, item]));
    const frozenTextLock = normalizeTextLock(textLock);
    const computedMaterialHash = flatInputHash({ sourceViews: loadedSources, tiles, revisionId, textLock: frozenTextLock, model: GOOGLE_IMAGE_MODEL });
    if (String(flatMaterialHash || "").toLowerCase() !== computedMaterialHash) return res.status(409).json({ success: false, error: "Call 8 flat-surface material identity changed" });
    const layers = []; const surfaceMasters = []; const seen = new Set();
    for (const tile of tiles) {
      const key = String(tile.key || "").trim();
      const x = Math.round(Number(tile.x)); const y = Math.round(Number(tile.y));
      const w = Math.round(Number(tile.w)); const h = Math.round(Number(tile.h));
      const trimWidthIn = Number(tile.trimWidthIn); const trimHeightIn = Number(tile.trimHeightIn); const bleedIn = Number(tile.bleedIn);
      const masterPath = String(tile.masterPath || "").trim();
      const rawFlatPath = String(tile.rawFlatPath || "").trim();
      const expectedMasterPath = `designpro/${tenantKey}/${workflowRunId}/proof-masters/${key}-${computedMaterialHash.slice(0, 24)}.png`;
      const expectedRawFlatPath = `designpro/${tenantKey}/${workflowRunId}/proof-masters/raw/${key}-${computedMaterialHash.slice(0, 24)}.png`;
      const ownSource = sourceByKey.get(key);
      if (!expectedSurfaceKeys.has(key) || seen.has(key) || !(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= W && y + h <= H) || !(trimWidthIn > 0 && trimHeightIn > 0) || bleedIn !== 5 || masterPath !== expectedMasterPath || rawFlatPath !== expectedRawFlatPath || !ownSource || String(tile.sourceAsset?.contentHash || "").toLowerCase() !== ownSource.contentHash) return res.status(400).json({ success: false, error: `invalid Call 8 surface ${key || "?"}` });
      seen.add(key);
    }
    if (seen.size !== expectedSurfaceKeys.size || [...expectedSurfaceKeys].some((key) => !seen.has(key))) return res.status(400).json({ success: false, error: "Call 8 surface set is incomplete" });

    const authored = await authorFlatSurfaceMasters({
      apiKey: GOOGLE_AI_API_KEY,
      model: GOOGLE_IMAGE_MODEL,
      revisionId,
      inputHash: computedMaterialHash,
      sourceViews: loadedSources,
      tiles,
      textLock: frozenTextLock,
      vehicleName: [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "vehicle",
      signal: requestAbort.signal,
      loadExisting: (surface) => existingMaster(String(surface.masterPath)),
      loadExistingFlat: (surface) => existingMaster(String(surface.rawFlatPath)),
      persist: (surface, master) => uploadBuffer(String(surface.masterPath), master, "image/png", tenantKey, workflowRunId, requestAbort.signal),
      persistFlat: (surface, flat) => uploadBuffer(String(surface.rawFlatPath), flat, "image/png", tenantKey, workflowRunId, requestAbort.signal),
    });
    const authoredByKey = new Map(authored.map((item) => [item.key, item]));
    for (const tile of tiles) {
      const key = String(tile.key || "").trim();
      const x = Math.round(Number(tile.x)); const y = Math.round(Number(tile.y));
      const w = Math.round(Number(tile.w)); const h = Math.round(Number(tile.h));
      const trimWidthIn = Number(tile.trimWidthIn); const trimHeightIn = Number(tile.trimHeightIn); const bleedIn = Number(tile.bleedIn);
      const masterPath = String(tile.masterPath || "").trim();
      const generated = authoredByKey.get(key);
      if (!generated) throw new Error(`${key} flat-surface master is missing`);
      const master = generated.bytes;
      const meta = generated.metadata;
      if (Math.abs(w / h - meta.width / meta.height) > 0.01) throw new Error(`${key} proof region would distort`);
      const preview = await sharp(master).resize(w, h, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
      layers.push({ input: preview, left: x, top: y });
      surfaceMasters.push({
        key, masterPath, sha256: createHash("sha256").update(master).digest("hex"), bytes: master.length,
        pixelWidth: meta.width, pixelHeight: meta.height, trimWidthIn, trimHeightIn, bleedIn,
        printWidthIn: trimWidthIn + bleedIn * 2, printHeightIn: trimHeightIn + bleedIn * 2,
        sourceCrop: {
          contract: "call8-gemini-flat-surface-transform.v1", sourceSha256: sourceByKey.get(key).contentHash,
          sevenViewSourceSetHash: computedMaterialHash, generatedFlatSha256: generated.flatHash,
          generatedFlatPixelWidth: generated.flatPixelWidth, generatedFlatPixelHeight: generated.flatPixelHeight,
          normalizationScaleX: generated.normalizationScaleX, normalizationScaleY: generated.normalizationScaleY,
          model: generated.model, promptVersion: PROMPT_VERSION,
          fit: "gemini-flat-then-contain-mirror-fill-at-call8", stretch: false,
          rotationDegrees: 0, truncated: false,
        },
      });
    }
    if (overlaySvg && String(overlaySvg).trim()) layers.push({ input: Buffer.from(String(overlaySvg)), left: 0, top: 0 });
    const proof = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).composite(layers).png().toBuffer();
    for (const master of surfaceMasters) {
      const tile = tiles.find((item) => String(item.key) === master.key);
      const region = await sharp(proof).extract({ left: Math.round(Number(tile.x)), top: Math.round(Number(tile.y)), width: Math.round(Number(tile.w)), height: Math.round(Number(tile.h)) }).png().toBuffer();
      master.regionSha256 = createHash("sha256").update(region).digest("hex"); master.regionBytes = region.length;
    }
    res.json({ success: true, contract: "designpro.call8-flat-proof.v1", imageModel: GOOGLE_IMAGE_MODEL, flatMaterialHash: computedMaterialHash, textLock: frozenTextLock, pngBase64: proof.toString("base64"), width: W, height: H, bytes: proof.length, surfaceMasters });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[DESIGNPRO-OS] ${WORKER_ID} listening on ${PORT}`);
  void refreshReadiness();
  const readinessTimer = setInterval(() => void refreshReadiness(), 30_000);
  readinessTimer.unref?.();
});
