"use strict";

const express = require("express");
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");
const { createHash } = require("node:crypto");
const { registerDesignProStandaloneClaimant } = require("./designpro-standalone-claimant.cjs");
const { canonicalTenantKey, canonicalUuid, immutableStorageUpload, normalizeSourceAsset, verifySourceBytes } = require("./runtime-contract.cjs");
const { probeRuntimeDependencies } = require("./runtime-readiness.cjs");
const { authorFlatSurfaceMasters, flatInputHash, normalizeTextLock, selectedImageModel, PROMPT_VERSION, SURFACE_KEYS, VIEW_KEYS } = require("./gemini-flat-surface.cjs");
const { ARTBOARD_CONTRACT, EXTRACTION_CONTRACT, assertLayoutMatches, assertSurfacesAreDistinct, extractAllPanels, layoutIdentity, PNG_OPTIONS } = require("./deterministic-artboard.cjs");
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

// Seven immutable renders -> six own-surface flat masters -> ONE deterministic
// Call 8 artboard -> the human 2D proof drawn on top of that same artboard.
//
// Each flat master is authored by the bounded Gemini flat-tile boundary ported
// from RP main 02ceea8/proof-sheet.ts blob 814363e and pasted into its own
// artboard rectangle at exact trim plus five-inch bleed. Call 9 then cuts the
// panels straight back out of the artboard, so no panel is ever regenerated
// and no surface can inherit another surface's artwork.
app.post("/compose-proof-sheet", authMiddleware, async (req, res) => {
  const requestAbort = new AbortController();
  req.once("aborted", () => requestAbort.abort(new Error("claimant request aborted")));
  res.once("close", () => { if (!res.writableEnded) requestAbort.abort(new Error("claimant connection closed")); });
  try {
    const { tenantKey: rawTenantKey, workflowRunId: rawWorkflowRunId, revisionId: rawRevisionId, artboard: claimedLayout, tiles = [], sourceAssets = [], textLock, flatMaterialHash, vehicle, overlaySvg } = req.body || {};
    const tenantKey = canonicalTenantKey(rawTenantKey);
    const workflowRunId = canonicalUuid(rawWorkflowRunId, "workflowRunId");
    const revisionId = canonicalUuid(rawRevisionId, "revisionId");
    const expectedSurfaceKeys = new Set(SURFACE_KEYS);
    if (!Array.isArray(tiles) || tiles.length !== expectedSurfaceKeys.size || !Array.isArray(sourceAssets) || sourceAssets.length !== VIEW_KEYS.length) return res.status(400).json({ success: false, error: "exactly seven immutable views and exactly six production surfaces are required" });
    const layout = assertLayoutMatches(claimedLayout, tiles.map((tile) => ({ surfaceKey: String(tile?.key || ""), widthInches: Number(tile?.trimWidthIn), heightInches: Number(tile?.trimHeightIn), bleedIn: Number(tile?.bleedIn) })));
    const W = layout.width; const H = layout.height;
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
    const surfaceMasters = []; const seen = new Set();
    for (const tile of tiles) {
      const key = String(tile.key || "").trim();
      const cell = layout.cells.find((item) => item.surfaceKey === key);
      const x = Math.round(Number(tile.x)); const y = Math.round(Number(tile.y));
      const w = Math.round(Number(tile.w)); const h = Math.round(Number(tile.h));
      const trimWidthIn = Number(tile.trimWidthIn); const trimHeightIn = Number(tile.trimHeightIn); const bleedIn = Number(tile.bleedIn);
      const masterPath = String(tile.masterPath || "").trim();
      const rawFlatPath = String(tile.rawFlatPath || "").trim();
      const expectedMasterPath = `designpro/${tenantKey}/${workflowRunId}/proof-masters/${key}-${computedMaterialHash.slice(0, 24)}.png`;
      const expectedRawFlatPath = `designpro/${tenantKey}/${workflowRunId}/proof-masters/raw/${key}-${computedMaterialHash.slice(0, 24)}.png`;
      const ownSource = sourceByKey.get(key);
      // Every tile must land exactly on its recomputed artboard rectangle. A
      // tile that drifts by one pixel would make the Call 9 cut disagree with
      // the artwork, so the stage fails closed instead.
      if (!expectedSurfaceKeys.has(key) || seen.has(key) || !cell || x !== cell.x || y !== cell.y || w !== cell.w || h !== cell.h
        || Number(tile.trimWidthPx) !== cell.trimWidthPx || Number(tile.trimHeightPx) !== cell.trimHeightPx || Number(tile.bleedPx) !== cell.bleedPx
        || !(trimWidthIn > 0 && trimHeightIn > 0) || bleedIn !== 5 || masterPath !== expectedMasterPath || rawFlatPath !== expectedRawFlatPath
        || !ownSource || String(tile.sourceAsset?.contentHash || "").toLowerCase() !== ownSource.contentHash) return res.status(400).json({ success: false, error: `invalid Call 8 surface ${key || "?"}` });
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
    const layers = [];
    for (const cell of layout.cells) {
      const key = cell.surfaceKey;
      const tile = tiles.find((item) => String(item.key || "").trim() === key);
      const generated = authoredByKey.get(key);
      if (!generated) throw new Error(`${key} flat-surface master is missing`);
      const master = generated.bytes;
      const meta = generated.metadata;
      // The master was authored at the cell's exact pixel geometry, so it is
      // pasted, never resampled. Anything else would break the Call 9 cut.
      if (meta.width !== cell.w || meta.height !== cell.h) throw new Error(`${key} master is ${meta.width}x${meta.height}, not the artboard cell ${cell.w}x${cell.h}`);
      layers.push({ input: master, left: cell.x, top: cell.y });
      surfaceMasters.push({
        key, masterPath: String(tile.masterPath), sha256: createHash("sha256").update(master).digest("hex"), bytes: master.length,
        pixelWidth: meta.width, pixelHeight: meta.height,
        trimWidthIn: cell.trimWidthIn, trimHeightIn: cell.trimHeightIn, bleedIn: cell.bleedIn,
        printWidthIn: cell.printWidthIn, printHeightIn: cell.printHeightIn, surfaceSqFt: cell.surfaceSqFt,
        artboardRect: { x: cell.x, y: cell.y, w: cell.w, h: cell.h },
        artboardTrimRect: cell.trim,
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

    // 1. The clean artboard: production artwork only, no labels, no rules.
    const artboardBytes = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite(layers).png(PNG_OPTIONS).toBuffer();
    const artboardPath = `designpro/${tenantKey}/${workflowRunId}/proof/artboard-${computedMaterialHash.slice(0, 24)}.png`;
    const storedArtboard = await uploadBuffer(artboardPath, artboardBytes, "image/png", tenantKey, workflowRunId, requestAbort.signal);

    // 2. The Call 9 cuts, taken from the encoded artboard the same way the
    //    claimant will take them, so the recorded hashes are reproducible.
    const panels = await extractAllPanels(artboardBytes, layout);
    const fingerprints = await assertSurfacesAreDistinct(panels);
    for (const master of surfaceMasters) {
      const panel = panels.find((item) => item.surfaceKey === master.key);
      master.regionSha256 = panel.contentHash;
      master.regionBytes = panel.byteSize;
      master.artworkFingerprint = fingerprints[master.key];
    }

    // 3. The human 2D proof: the same artboard with the GENIE dimension
    //    overlay drawn on top. Same canvas, same rectangles.
    const proof = overlaySvg && String(overlaySvg).trim()
      ? await sharp(artboardBytes, { limitInputPixels: false }).composite([{ input: Buffer.from(String(overlaySvg)), left: 0, top: 0 }]).png(PNG_OPTIONS).toBuffer()
      : artboardBytes;
    const proofPath = `designpro/${tenantKey}/${workflowRunId}/proof/call8-flat-2d-proof-${computedMaterialHash.slice(0, 24)}.png`;
    const storedProof = await uploadBuffer(proofPath, proof, "image/png", tenantKey, workflowRunId, requestAbort.signal);

    res.json({
      success: true, contract: "designpro.call8-flat-proof.v2", imageModel: GOOGLE_IMAGE_MODEL,
      flatMaterialHash: computedMaterialHash, textLock: frozenTextLock,
      width: W, height: H, surfaceMasters,
      artboard: {
        contract: ARTBOARD_CONTRACT, extractionContract: EXTRACTION_CONTRACT,
        storagePath: storedArtboard.storagePath, contentHash: storedArtboard.contentHash, byteSize: storedArtboard.byteSize, width: W, height: H,
        scalePxPerInch: layout.scalePxPerInch, layoutHash: layoutIdentity(layout), cells: layout.cells,
      },
      proof: {
        storagePath: storedProof.storagePath, contentHash: storedProof.contentHash, byteSize: storedProof.byteSize, width: W, height: H,
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

