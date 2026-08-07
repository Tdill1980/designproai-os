"use strict";

const { createHash } = require("node:crypto");

const BUCKET = "wrap-files";
const DELIVERY_CONTRACT = "designpro.wrapbox-recipient.v1";
const MANIFEST_CONTRACT = "designpro.wrapbox-manifest.v2";
const NOTIFICATION_CONTRACT = "designpro.wrapbox-notification.v1";
const HASH_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_PATH_RE = /^[A-Za-z0-9._/-]+$/;
const TARGET_SURFACES = new Set(["driver", "passenger", "hood", "roof", "front", "rear"]);
const DELIVERY_FIELDS = Object.freeze([
  "contractVersion", "customerEmail", "customerId", "designName", "orderNumber", "recipientIdentityHash",
]);

class WrapboxDeliveryError extends Error {
  constructor(code, message, { retryable = false, missingInput = [] } = {}) {
    super(message);
    this.name = "WrapboxDeliveryError";
    this.code = code;
    this.retryable = retryable;
    this.missingInput = missingInput;
  }
}

function fail(code, message, options) {
  throw new WrapboxDeliveryError(code, message, options);
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function safePath(value, label) {
  const path = String(value || "");
  if (!path || path.startsWith("/") || path.includes("..") || !SAFE_PATH_RE.test(path)) {
    fail("delivery_storage_path_invalid", `${label} is not a safe private Storage path`);
  }
  return path;
}

function exactObjectKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

function assertDeliverySnapshot(snapshot) {
  const required = DELIVERY_FIELDS.map((field) => `revisionSnapshot.delivery.${field}`);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || !snapshot.delivery || typeof snapshot.delivery !== "object" || Array.isArray(snapshot.delivery)) {
    fail(
      "delivery_recipient_snapshot_required",
      "The immutable revision snapshot is missing its verified delivery recipient",
      { missingInput: required },
    );
  }
  const delivery = snapshot.delivery;
  const missing = DELIVERY_FIELDS
    .filter((field) => delivery[field] == null || String(delivery[field]).trim() === "")
    .map((field) => `revisionSnapshot.delivery.${field}`);
  if (missing.length) {
    fail("delivery_recipient_snapshot_required", "The immutable delivery recipient is incomplete", { missingInput: missing });
  }
  if (!exactObjectKeys(delivery, DELIVERY_FIELDS)) {
    fail("delivery_recipient_snapshot_invalid", "The delivery recipient contract contains unknown or missing fields");
  }
  if (delivery.contractVersion !== DELIVERY_CONTRACT) {
    fail("delivery_recipient_snapshot_invalid", `delivery.contractVersion must be ${DELIVERY_CONTRACT}`);
  }
  const customerId = String(delivery.customerId).toLowerCase();
  const customerEmail = normalizeEmail(delivery.customerEmail);
  const recipientIdentityHash = String(delivery.recipientIdentityHash).toLowerCase();
  const designName = String(delivery.designName);
  const orderNumber = String(delivery.orderNumber);
  if (!UUID_RE.test(customerId)) fail("delivery_customer_id_invalid", "delivery.customerId must be a stable business UUID");
  if (!EMAIL_RE.test(customerEmail) || customerEmail.length > 320 || delivery.customerEmail !== customerEmail) {
    fail("delivery_customer_email_invalid", "delivery.customerEmail must be the normalized verified recipient email");
  }
  if (!HASH_RE.test(recipientIdentityHash) || delivery.recipientIdentityHash !== recipientIdentityHash) {
    fail("delivery_recipient_identity_hash_invalid", "delivery.recipientIdentityHash must identify a verified recipient binding");
  }
  if (!designName.trim() || designName !== designName.trim() || designName.length > 240) {
    fail("delivery_design_name_invalid", "delivery.designName must be a trimmed customer-visible name");
  }
  if (orderNumber !== orderNumber.trim() || orderNumber.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._/# -]*$/.test(orderNumber)) {
    fail("delivery_order_number_invalid", "delivery.orderNumber must be the immutable registered business Order #");
  }
  return Object.freeze({
    contractVersion: DELIVERY_CONTRACT,
    customerId,
    customerEmail,
    recipientIdentityHash,
    designName,
    orderNumber,
  });
}

function immutableBusinessIdentity(source) {
  const snapshot = source?.snapshot;
  const generationId = String(snapshot?.generationId || "").trim().toLowerCase();
  const designId = `DID-${generationId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const orderNumber = String(snapshot?.orderNumber || "");
  if (!UUID_RE.test(generationId) || String(source?.generation_id || "").toLowerCase() !== generationId
    || snapshot?.designId !== designId || snapshot?.delivery?.orderNumber !== orderNumber || !orderNumber || orderNumber !== orderNumber.trim()
    || orderNumber.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._/# -]*$/.test(orderNumber)) {
    fail("delivery_business_identity_invalid", "Immutable DesignID or Order # is missing or noncanonical");
  }
  return Object.freeze({ designId, orderNumber });
}

function normalizeLogoPlacement(value, label = "logo placement") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("manifest_logo_inventory_invalid", `${label} must be an object`);
  }
  const placementKey = String(value.placementKey || "").trim();
  const identityKey = String(value.identityKey || "").trim();
  const displayName = String(value.displayName || "").trim();
  const targetSurfaceKey = String(value.targetSurfaceKey || "").trim();
  const storagePath = safePath(value.storagePath, `${label}.storagePath`);
  const contentHash = String(value.contentHash || "").toLowerCase();
  const byteSize = Number(value.byteSize);
  const contentType = String(value.contentType || "").toLowerCase();
  if (!placementKey || !identityKey || !displayName || !TARGET_SURFACES.has(targetSurfaceKey)
    || !HASH_RE.test(contentHash) || !Number.isSafeInteger(byteSize) || byteSize < 1
    || !contentType || contentType.length > 200) {
    fail("manifest_logo_inventory_invalid", `${label} has incomplete byte or target-surface identity`);
  }
  return { placementKey, identityKey, displayName, targetSurfaceKey, storagePath, contentHash, byteSize, contentType };
}

function normalizeLogoInventory(values, label = "logo inventory") {
  if (!Array.isArray(values)) fail("manifest_logo_inventory_invalid", `${label} must be an array`);
  const placements = values.map((value, index) => normalizeLogoPlacement(value, `${label}[${index}]`));
  if (new Set(placements.map((item) => item.placementKey)).size !== placements.length) {
    fail("manifest_logo_placement_duplicate", "Every logo placement must have a unique placementKey");
  }
  // identityKey is intentionally not unique: the same logo can be required on
  // more than one target surface.  placementKey + targetSurfaceKey preserves
  // every occurrence instead of collapsing repeated logos.
  return placements.sort((a, b) => a.placementKey.localeCompare(b.placementKey));
}

function logoInventoryFromArtifacts(rows) {
  if (!Array.isArray(rows)) fail("logo_ledger_invalid", "Logo artifact rows are missing");
  return normalizeLogoInventory(rows.map((row) => ({
    placementKey: row?.metadata?.placementKey,
    identityKey: row?.metadata?.identityKey,
    displayName: row?.metadata?.displayName,
    targetSurfaceKey: row?.metadata?.targetSurfaceKey,
    storagePath: row?.storage_path,
    contentHash: row?.content_hash,
    byteSize: row?.byte_size,
    contentType: row?.metadata?.contentType,
  })), "logo artifact ledger").map((item, index) => {
    const matching = rows.find((row) => row?.metadata?.placementKey === item.placementKey);
    if (!matching || String(matching.surface_key || "") !== item.placementKey) {
      fail("logo_ledger_placement_mismatch", `Logo placement ${index} is not bound to artifact.surface_key`);
    }
    return item;
  });
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateManifest(manifest, { run, delivery, businessIdentity, zipPath, zipHash, zipBytes, logoInventory }) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("wrapbox_manifest_invalid", "WrapBox manifest must be an object");
  }
  if (manifest.contract !== MANIFEST_CONTRACT
    || manifest.workflowRunId !== run.id
    || manifest.operatorId !== run.owner_id
    || manifest.customerId !== delivery.customerId
    || manifest.recipientIdentityHash !== delivery.recipientIdentityHash
    || manifest.tenantKey !== run.tenant_key
    || manifest.enticePackId !== run.entice_pack_id
    || manifest.revisionId !== run.revision_id
    || manifest.designId !== businessIdentity?.designId
    || manifest.orderNumber !== businessIdentity?.orderNumber
    || manifest.businessIdentity?.designId !== businessIdentity?.designId
    || manifest.businessIdentity?.orderNumber !== businessIdentity?.orderNumber) {
    fail("wrapbox_manifest_identity_mismatch", "WrapBox manifest identity does not match the immutable workflow and recipient");
  }
  if (!manifest.zip || typeof manifest.zip !== "object" || Array.isArray(manifest.zip)
    || manifest.zip.storagePath !== zipPath
    || String(manifest.zip.contentHash || "").toLowerCase() !== zipHash
    || Number(manifest.zip.byteSize) !== zipBytes) {
    fail("wrapbox_manifest_zip_mismatch", "WrapBox manifest does not bind the exact delivered ZIP bytes");
  }
  const observedLogos = normalizeLogoInventory(manifest.logos, "manifest.logos");
  if (!sameJson(observedLogos, logoInventory)) {
    fail("wrapbox_manifest_logo_mismatch", "WrapBox manifest logo placements do not match the immutable artifact ledger");
  }
  if (!manifest.deliveredAt || Number.isNaN(Date.parse(manifest.deliveredAt))) {
    fail("wrapbox_manifest_timestamp_invalid", "WrapBox manifest deliveredAt is invalid");
  }
  return observedLogos;
}

async function maybeSingle(sb, table, fields, filters) {
  let query = sb.from(table).select(fields);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { data, error } = await query.maybeSingle();
  if (error) fail("delivery_ledger_read_failed", `${table}: ${error.message}`, { retryable: true });
  return data || null;
}

async function rows(sb, table, fields, filters) {
  let query = sb.from(table).select(fields);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { data, error } = await query;
  if (error) fail("delivery_ledger_read_failed", `${table}: ${error.message}`, { retryable: true });
  return data || [];
}

async function storageBytes(sb, storagePath) {
  const path = safePath(storagePath, "storagePath");
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || data == null) fail("delivery_storage_read_failed", `${path}: ${error?.message || "missing"}`, { retryable: true });
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data.arrayBuffer === "function") return Buffer.from(await data.arrayBuffer());
  fail("delivery_storage_read_failed", `${path}: unsupported Storage response`, { retryable: true });
}

function requireRow(row, code, message) {
  if (!row) fail(code, message);
  return row;
}

async function publishCompletedWrapboxDelivery({ supabase, runId }) {
  if (!supabase || !UUID_RE.test(String(runId || "").toLowerCase())) {
    fail("wrapbox_publish_request_invalid", "A Supabase service client and production run UUID are required");
  }
  const run = requireRow(await maybeSingle(
    supabase,
    "designpro_workflow_runs",
    "id,workflow_type,status,owner_id,tenant_key,revision_id,revision_snapshot_hash,entice_pack_id",
    { id: String(runId).toLowerCase() },
  ), "production_workflow_not_found", "Production workflow not found");
  if (run.workflow_type !== "designpro.production_pack" || run.status !== "completed") {
    fail("completed_production_workflow_required", "WrapBox publication runs only after completed production");
  }
  const source = requireRow(await maybeSingle(
    supabase,
    "designpro_revision_sources",
    "revision_id,owner_id,tenant_key,generation_id,snapshot,snapshot_hash",
    { revision_id: run.revision_id },
  ), "immutable_revision_source_required", "Immutable revision source not found");
  if (source.owner_id !== run.owner_id || source.tenant_key !== run.tenant_key
    || source.snapshot_hash !== run.revision_snapshot_hash) {
    fail("immutable_revision_identity_mismatch", "Revision, operator, tenant, or snapshot identity drifted");
  }
  const delivery = assertDeliverySnapshot(source.snapshot);
  const businessIdentity = immutableBusinessIdentity(source);

  const zipReceipt = requireRow(await maybeSingle(
    supabase, "designpro_stage_receipts", "stage_id,receipt,receipt_hash",
    { run_id: run.id, receipt_kind: "zip" },
  ), "verified_zip_receipt_required", "Verified ZIP receipt is missing");
  const deliveryReceipt = requireRow(await maybeSingle(
    supabase, "designpro_stage_receipts", "stage_id,receipt,receipt_hash",
    { run_id: run.id, receipt_kind: "wrapbox.delivery" },
  ), "verified_wrapbox_delivery_receipt_required", "Verified WrapBox receipt is missing");
  const zipHash = String(zipReceipt.receipt_hash || "").toLowerCase();
  const manifestHash = String(deliveryReceipt.receipt_hash || "").toLowerCase();
  if (!HASH_RE.test(zipHash) || zipReceipt.receipt?.receiptKind !== "zip"
    || zipReceipt.receipt?.zipHash !== zipHash
    || !HASH_RE.test(manifestHash) || deliveryReceipt.receipt?.receiptKind !== "wrapbox.delivery"
    || deliveryReceipt.receipt?.zipHash !== zipHash) {
    fail("delivery_receipt_identity_mismatch", "ZIP and WrapBox receipts do not share exact byte identity");
  }

  const zipArtifact = requireRow(await maybeSingle(
    supabase, "designpro_artifacts",
    "stage_id,storage_path,content_hash,byte_size,surface_key,metadata",
    { run_id: run.id, artifact_kind: "zip", content_hash: zipHash },
  ), "exact_zip_artifact_required", "Exact ZIP artifact is missing");
  const manifestArtifact = requireRow(await maybeSingle(
    supabase, "designpro_artifacts",
    "stage_id,storage_path,content_hash,byte_size,surface_key,metadata",
    { run_id: run.id, artifact_kind: "wrapbox-manifest", content_hash: manifestHash },
  ), "exact_wrapbox_manifest_artifact_required", "Exact WrapBox manifest artifact is missing");

  const expectedPrefix = `wrapbox/${run.tenant_key}/${run.entice_pack_id}/${run.id}`;
  const deliveredZipPath = `${expectedPrefix}/production-pack.zip`;
  const manifestPath = `${expectedPrefix}/manifest.json`;
  if (deliveryReceipt.receipt?.deliveredZipPath !== deliveredZipPath
    || deliveryReceipt.receipt?.manifestPath !== manifestPath
    || manifestArtifact.storage_path !== manifestPath
    || manifestArtifact.metadata?.zipHash !== zipHash
    || manifestArtifact.metadata?.designId !== businessIdentity.designId
    || manifestArtifact.metadata?.orderNumber !== businessIdentity.orderNumber
    || deliveryReceipt.receipt?.designId !== businessIdentity.designId
    || deliveryReceipt.receipt?.orderNumber !== businessIdentity.orderNumber
    || zipArtifact.stage_id !== zipReceipt.stage_id
    || manifestArtifact.stage_id !== deliveryReceipt.stage_id) {
    fail("delivery_artifact_identity_mismatch", "Delivery paths or stage-bound artifacts do not match their receipts");
  }

  const sourceZipBytes = await storageBytes(supabase, zipArtifact.storage_path);
  const deliveredZipBytes = await storageBytes(supabase, deliveredZipPath);
  if (hashBytes(sourceZipBytes) !== zipHash || Number(zipArtifact.byte_size) !== sourceZipBytes.length
    || hashBytes(deliveredZipBytes) !== zipHash || deliveredZipBytes.length !== sourceZipBytes.length) {
    fail("delivery_zip_bytes_changed", "Source or delivered ZIP bytes do not match the approved SHA-256 identity");
  }
  const manifestBytes = await storageBytes(supabase, manifestPath);
  if (hashBytes(manifestBytes) !== manifestHash || Number(manifestArtifact.byte_size) !== manifestBytes.length) {
    fail("delivery_manifest_bytes_changed", "Manifest bytes do not match the completed delivery receipt");
  }
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")); }
  catch { fail("wrapbox_manifest_invalid", "WrapBox manifest is not valid JSON"); }

  const logoRows = await rows(
    supabase,
    "designpro_artifacts",
    "surface_key,storage_path,content_hash,byte_size,metadata",
    { run_id: run.id, artifact_kind: "logo" },
  );
  const logoInventory = logoInventoryFromArtifacts(logoRows);
  const observedLogoInventory = validateManifest(manifest, {
    run,
    delivery,
    businessIdentity,
    zipPath: deliveredZipPath,
    zipHash,
    zipBytes: deliveredZipBytes.length,
    logoInventory,
  });

  const { data, error } = await supabase.rpc("commit_designpro_wrapbox_pack", {
    p_run_id: run.id,
    p_observed_zip_hash: zipHash,
    p_observed_zip_bytes: deliveredZipBytes.length,
    p_observed_manifest_hash: manifestHash,
    p_observed_manifest_bytes: manifestBytes.length,
    p_observed_logo_inventory: observedLogoInventory,
  });
  if (error) fail("wrapbox_pack_commit_rejected", error.message, { retryable: false });
  return data;
}

async function reconcileCompletedWrapboxDeliveries({ supabase, limit = 25 } = {}) {
  const bounded = Math.max(1, Math.min(100, Number(limit) || 25));
  let query = supabase.from("designpro_workflow_runs")
    .select("id")
    .eq("workflow_type", "designpro.production_pack")
    .eq("status", "completed")
    .order("finished_at", { ascending: true })
    .limit(bounded);
  const { data: runs, error } = await query;
  if (error) fail("delivery_reconciliation_read_failed", error.message, { retryable: true });
  const published = [];
  const blocked = [];
  for (const run of runs || []) {
    const existing = await maybeSingle(supabase, "designpro_wrapbox_packs", "id", { run_id: run.id });
    if (existing) continue;
    try { published.push(await publishCompletedWrapboxDelivery({ supabase, runId: run.id })); }
    catch (errorValue) {
      const errorObject = errorValue instanceof WrapboxDeliveryError
        ? errorValue : new WrapboxDeliveryError("wrapbox_publish_failed", String(errorValue?.message || errorValue), { retryable: true });
      blocked.push({ runId: run.id, code: errorObject.code, retryable: errorObject.retryable, missingInput: errorObject.missingInput });
    }
  }
  return { published, blocked };
}

function appOrigin(value) {
  let url;
  try { url = new URL(String(value || "")); }
  catch { fail("notification_app_origin_invalid", "A standalone HTTPS app origin is required"); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/"
    || url.search || url.hash || !/(^|\.)designproai\.com$/i.test(url.hostname)) {
    fail("notification_app_origin_invalid", "A standalone HTTPS DesignPro app origin is required");
  }
  return url.origin;
}

function sanitizedError(value) {
  return String(value?.message || value || "notification_transport_failed")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/\b(?:api[_-]?key|token|secret)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 500);
}

async function dispatchOneWrapboxNotification({
  supabase,
  workerId,
  appOrigin: configuredOrigin,
  emailTransport,
  leaseSeconds = 120,
}) {
  if (!emailTransport || emailTransport.supportsIdempotency !== true || typeof emailTransport.send !== "function") {
    fail("idempotent_email_transport_required", "Email transport must honor the supplied idempotencyKey");
  }
  const worker = String(workerId || "").trim();
  if (!worker || worker.length > 240) fail("notification_worker_invalid", "A bounded notification worker ID is required");
  const origin = appOrigin(configuredOrigin);
  const { data, error } = await supabase.rpc("claim_designpro_wrapbox_notification", {
    p_worker: worker,
    p_lease_seconds: Math.max(15, Math.min(900, Number(leaseSeconds) || 120)),
  });
  if (error) fail("notification_claim_failed", error.message, { retryable: true });
  const claim = Array.isArray(data) ? data[0] : data;
  if (!claim) return null;
  const payload = claim.template_payload;
  const to = normalizeEmail(claim.recipient_email);
  if (!UUID_RE.test(String(claim.notification_id || "")) || !UUID_RE.test(String(claim.lease_token || ""))
    || !EMAIL_RE.test(to) || !payload || payload.contractVersion !== NOTIFICATION_CONTRACT
    || payload.packId !== claim.pack_id
    || !/^DID-[0-9A-F]{8}$/.test(String(payload.designId || ""))
    || !/^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$/.test(String(payload.orderNumber || ""))
    || !HASH_RE.test(String(payload.zipContentHash || ""))
    || payload.portalPath !== `/app/wrapbox/${claim.pack_id}`
    || !String(claim.idempotency_key || "").trim()
    || String(claim.idempotency_key).length > 256) {
    fail("notification_claim_identity_invalid", "Claimed notification identity is incomplete");
  }
  const portalUrl = `${origin}${payload.portalPath}`;
  try {
    const result = await emailTransport.send({
      to,
      subject: `${payload.designName} is ready in WrapBox`,
      text: `Your DesignProAI production pack “${payload.designName}” is ready.\nDesignID: ${payload.designId}\nOrder #: ${payload.orderNumber}\nOpen WrapBox: ${portalUrl}\nSHA-256: ${payload.zipContentHash}`,
      portalUrl,
      zipContentHash: payload.zipContentHash,
      idempotencyKey: claim.idempotency_key,
    });
    const providerMessageId = String(result?.providerMessageId || "").trim();
    if (!providerMessageId) fail("provider_message_id_required", "The email provider did not return a durable message ID", { retryable: true });
    const completed = await supabase.rpc("complete_designpro_wrapbox_notification", {
      p_notification_id: claim.notification_id,
      p_lease_token: claim.lease_token,
      p_provider_message_id: providerMessageId,
    });
    if (completed.error || completed.data !== true) {
      fail("notification_completion_failed", completed.error?.message || "Notification lease completion was rejected", { retryable: true });
    }
    return { notificationId: claim.notification_id, packId: claim.pack_id, sent: true };
  } catch (errorValue) {
    const retryable = errorValue?.retryable !== false;
    const failure = await supabase.rpc("fail_designpro_wrapbox_notification", {
      p_notification_id: claim.notification_id,
      p_lease_token: claim.lease_token,
      p_error: sanitizedError(errorValue),
      p_retryable: retryable,
    });
    if (failure.error || failure.data !== true) {
      fail("notification_failure_persistence_failed", failure.error?.message || "Notification failure lease was rejected", { retryable: true });
    }
    throw errorValue;
  }
}

module.exports = {
  BUCKET,
  DELIVERY_CONTRACT,
  MANIFEST_CONTRACT,
  NOTIFICATION_CONTRACT,
  WrapboxDeliveryError,
  assertDeliverySnapshot,
  dispatchOneWrapboxNotification,
  hashBytes,
  immutableBusinessIdentity,
  logoInventoryFromArtifacts,
  normalizeLogoInventory,
  publishCompletedWrapboxDelivery,
  reconcileCompletedWrapboxDeliveries,
  sanitizedError,
  validateManifest,
};
