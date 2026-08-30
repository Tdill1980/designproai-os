#!/usr/bin/env node
/**
 * Production canary: current A.T.L.A.S. graph -> Calls 8-12 -> files.
 *
 * This wrapper deliberately uses the real standalone contracts:
 * - a confirmed authenticated operator owns the revision
 * - a distinct confirmed customer is registered through WrapBox
 * - vehicle geometry must resolve from the current GENIE catalog
 * - Entice must complete before Production can be created
 * - the intentional owner-promotion entitlement exercises production without
 *   a Stripe dependency and never fabricates a paid state
 * - both human QC gates are approved only through the real QC RPC
 * - artifacts are collected from both Entice and Production runs
 */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { createClient } = (() => {
  try { return require("@supabase/supabase-js"); }
  catch { return require("../runtime/node_modules/@supabase/supabase-js"); }
})();
const { previewGenieDimensionsFromCatalog } = (() => {
  try { return require("./genie-universal-resolver.cjs"); }
  catch { return require("../runtime/genie-universal-resolver.cjs"); }
})();

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const EXTENSION = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
});
// The six canonical A.T.L.A.S. surfaces, in the order the frozen seam names
// them. Deliberately the same list the gateway validates Call 1's panel records
// against, because this file is doing the gateway's job for a direct-RPC caller.
const CALL_ONE_SURFACES = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const BUCKET = "wrap-files";
const POLL_INTERVAL_MS = 5_000;
const MAX_ENTICE_POLLS = 240;
const MAX_PRODUCTION_POLLS = 720;
const ATLAS_SLO_SECONDS = 60;
const DRIVER_SLO_SECONDS = 90;
const OPERATOR_EMAIL = "canary-operator@designproai.com";
const CUSTOMER_REFERENCE = "DESIGNPROAI-ATLAS-GRAPH-CANARY";

const RUNTIME_URL = String(
  process.env.DESIGNPRO_RUNTIME_INTERNAL_URL || "http://127.0.0.1:3001"
).trim();
const WORKER_SECRET = String(process.env.WORKER_SECRET || "").trim();
// This identity belongs only to the current-architecture canary. Never reuse a
// real customer here: recipient bindings are append-only business records and
// are created only after the protected owner entitlement below is persisted.
const CUSTOMER_EMAIL = String(
  process.env.DESIGNPRO_CANARY_EMAIL || "atlas-canary-customer@designproai.com"
).trim().toLowerCase();
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const OUT = arg("out", "./canary-output");
const ORDER_NUMBER = arg("order", `CANARY-${Date.now().toString(36).toUpperCase()}`);
const VEHICLE = Object.freeze({
  type: arg("type", "truck"),
  year: arg("year", "2020"),
  make: arg("make", "Ford"),
  model: arg("model", "F250 Crew Cab 6.5ft Box"),
});
const DESIGN_NAME = arg("design", "Precision Climate Solutions — A.T.L.A.S. graph canary");
// A.T.L.A.S. authors from a brief, so the canary has to carry a real one. v3
// requires both `brief` and `designName` and caps the brief at 8000 characters.
const DESIGN_BRIEF = arg("brief",
  "Bold commercial HVAC wrap for Precision Climate Solutions: deep blue base with "
  + "sunrise-orange airflow ribbons sweeping front to rear, clean modern sans-serif "
  + "company name, high contrast and legible at highway distance.");

if (!SUPABASE_URL || !SERVICE_KEY || !WORKER_SECRET || !CUSTOMER_EMAIL) {
  console.error(
    "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_SECRET and DESIGNPRO_CANARY_EMAIL are required"
  );
  process.exit(2);
}

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const step = (message) => process.stdout.write(`  ${message}\n`);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const elapsedSeconds = (start, end, label) => {
  const milliseconds = Date.parse(String(end || "")) - Date.parse(String(start || ""));
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new Error(`${label} timestamps are invalid: ${String(start)} -> ${String(end)}`);
  }
  return Math.round(milliseconds / 10) / 100;
};

const evidence = {
  contract: "designpro.production-canary-evidence.v3",
  ranAt: new Date().toISOString(),
  graphContract: "designpro.atlas-one-artifact-graph.v1",
  vehicle: VEHICLE,
  orderNumber: ORDER_NUMBER,
  operator: null,
  customer: CUSTOMER_EMAIL,
  revisionId: null,
  generationId: null,
  visualizationId: null,
  enticeRunId: null,
  productionRunId: null,
  renderAssets: {},
  // The persisted A.T.L.A.S. revision this run authored. Null means Calls 1-7
  // never produced a master, which is a failed canary however green the rest is.
  flatAtlas: null,
  latency: null,
  stageTransitions: [],
  autoApprovals: [],
  outputs: [],
  expectedOutputChecks: {},
  finalState: null,
  error: null,
};

function writeEvidence() {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/canary-evidence.json`, JSON.stringify(evidence, null, 2));
}

async function listAuthUsers() {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth admin listUsers failed: ${error.message}`);
    users.push(...(data?.users || []));
    if ((data?.users || []).length < 1000) break;
  }
  return users;
}

async function ensureConfirmedUser(email, { resetPassword = false } = {}) {
  const normalized = email.trim().toLowerCase();
  let user = (await listAuthUsers()).find(
    (candidate) => String(candidate.email || "").trim().toLowerCase() === normalized
  );
  const password = randomBytes(32).toString("base64url");

  if (!user) {
    const { data, error } = await service.auth.admin.createUser({
      email: normalized,
      password,
      email_confirm: true,
      app_metadata: { designproCanary: true },
      user_metadata: {
        display_name: normalized === OPERATOR_EMAIL ? "DesignProAI Canary Operator" : "Canary Customer",
      },
    });
    if (error || !data?.user) {
      throw new Error(`create auth user ${normalized} failed: ${error?.message || "empty response"}`);
    }
    user = data.user;
  } else if (resetPassword) {
    const { data, error } = await service.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      app_metadata: { ...(user.app_metadata || {}), designproCanary: true },
    });
    if (error || !data?.user) {
      throw new Error(`reset auth user ${normalized} failed: ${error?.message || "empty response"}`);
    }
    user = data.user;
  }

  if (!user.email_confirmed_at && !user.confirmed_at) {
    const { data, error } = await service.auth.admin.updateUserById(user.id, { email_confirm: true });
    if (error || !data?.user) {
      throw new Error(`confirm auth user ${normalized} failed: ${error?.message || "empty response"}`);
    }
    user = data.user;
  }
  return { user, password: resetPassword ? password : null };
}

async function authenticatedOperatorClient(email, password) {
  const loginClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await loginClient.auth.signInWithPassword({ email, password });
  if (error || !data?.session?.access_token || !data?.user) {
    throw new Error(`operator sign-in failed: ${error?.message || "no session"}`);
  }
  return {
    client: createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    }),
    user: data.user,
  };
}

async function ensureOperatorAndCustomer() {
  step("bootstrapping isolated Auth operator + customer");
  const operatorAuth = await ensureConfirmedUser(OPERATOR_EMAIL, { resetPassword: true });
  const customerAuth = await ensureConfirmedUser(CUSTOMER_EMAIL);
  if (operatorAuth.user.id === customerAuth.user.id) {
    throw new Error("operator and customer must be distinct auth users");
  }

  const { error: qcError } = await service.from("designpro_qc_members").upsert({
    user_id: operatorAuth.user.id,
    can_operate: true,
    can_preflight: true,
    can_final_qc: true,
    granted_at: new Date().toISOString(),
    grant_source: "production-canary",
  }, { onConflict: "user_id" });
  if (qcError) throw new Error(`grant canary operator QC failed: ${qcError.message}`);

  const signed = await authenticatedOperatorClient(OPERATOR_EMAIL, operatorAuth.password);
  if (signed.user.id !== operatorAuth.user.id) throw new Error("operator session identity drift");
  evidence.operator = { id: signed.user.id, email: OPERATOR_EMAIL };
  step(`operator ${signed.user.id}`);
  step(`customer ${customerAuth.user.id}`);
  return { operator: signed.client, operatorId: signed.user.id, customerId: customerAuth.user.id };
}

async function assertCurrentGeniePrep() {
  const prepared = await previewGenieDimensionsFromCatalog(service, VEHICLE);
  if (!["measured", "derived"].includes(String(prepared?.resolution?.state))) {
    throw new Error(`current GENIE catalog has no authoritative match for ${VEHICLE.year} ${VEHICLE.make} ${VEHICLE.model}`);
  }
  if (!/^[0-9a-f]{64}$/.test(String(prepared?.resolution?.genieManifestHash || ""))) {
    throw new Error("current GENIE preparation returned no immutable manifest hash");
  }
  if (!Array.isArray(prepared?.surfaces) || prepared.surfaces.length !== CALL_ONE_SURFACES.length) {
    throw new Error(`current GENIE preparation returned ${prepared?.surfaces?.length || 0} of 6 surfaces`);
  }
  evidence.geniePrep = {
    state: prepared.resolution.state,
    manifestHash: prepared.resolution.genieManifestHash,
    sourceRowId: prepared.resolution.geometrySourceRowId,
    catalogModel: prepared.resolution.catalogModel,
    catalogYearRange: prepared.resolution.catalogYearRange,
    surfaces: prepared.surfaces,
  };
  step(`prepared current GENIE manifest ${prepared.resolution.genieManifestHash.slice(0, 12)} · six surfaces`);
  return prepared;
}

async function registerRecipient(operatorId, generationId) {
  step("registering WrapBox recipient through the runtime");
  const verificationRefHash = sha256(Buffer.from(`canary-verification:${ORDER_NUMBER}`));
  const response = await fetch(`${RUNTIME_URL}/internal/wrapbox/recipient`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${WORKER_SECRET}`,
    },
    body: JSON.stringify({
      operatorId,
      generationId,
      customerEmail: CUSTOMER_EMAIL,
      customerReference: CUSTOMER_REFERENCE,
      verificationRefHash,
      orderNumber: ORDER_NUMBER,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.recipientIdentityHash) {
    throw new Error(`recipient registration failed (HTTP ${response.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  return {
    contractVersion: "designpro.wrapbox-recipient.v1",
    customerId: String(data.customerId).toLowerCase(),
    customerEmail: String(data.customerEmail).trim().toLowerCase(),
    recipientIdentityHash: String(data.recipientIdentityHash).toLowerCase(),
    orderNumber: ORDER_NUMBER,
    designName: DESIGN_NAME,
  };
}

async function rpc(client, name, params) {
  const { data, error } = await client.rpc(name, params);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
}

async function fetchRun(runId) {
  const { data, error } = await service
    .from("designpro_workflow_runs")
    .select("id,workflow_type,status,results,error,updated_at")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(`run ${runId} read failed: ${error.message}`);
  return data;
}

async function fetchStages(runId) {
  const { data, error } = await service
    .from("designpro_workflow_stages")
    .select("stage_key,status,attempt,max_attempts,wait_reason,wait_details,error_code,error_message,error_details,output,verification,updated_at")
    .eq("run_id", runId)
    .order("sequence");
  if (error) throw new Error(`stages ${runId} read failed: ${error.message}`);
  return data || [];
}

function recordTransitions(runId, stages, seen) {
  for (const row of stages) {
    const key = `${row.stage_key}:${row.status}:${row.attempt}:${row.updated_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.stageTransitions.push({
      runId,
      stageKey: row.stage_key,
      status: row.status,
      attempt: row.attempt,
      waitReason: row.wait_reason,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      errorDetails: row.error_details,
      updatedAt: row.updated_at,
    });
    step(`${row.stage_key.padEnd(28)} ${row.status}${row.error_code ? ` (${row.error_code})` : ""}`);
  }
}

async function waitForEntice(runId) {
  const seen = new Set();
  for (let poll = 0; poll < MAX_ENTICE_POLLS; poll += 1) {
    const stages = await fetchStages(runId);
    recordTransitions(runId, stages, seen);
    const run = await fetchRun(runId);
    if (run?.status === "completed") return run;
    if (run?.status === "failed" || stages.some((stage) => stage.status === "failed")) {
      throw new Error(`entice workflow failed: ${JSON.stringify(run?.error || stages.find((stage) => stage.status === "failed")).slice(0, 800)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("entice workflow did not complete within 20 minutes");
}

function preflightQc() {
  return {
    known: true,
    pass: true,
    dimensionsVerified: true,
    sourceRegionsVerified: true,
    fiveInchBleed: true,
    panelHashesVerified: true,
    logoInventoryVerified: true,
    textLockVerified: true,
  };
}
function finalQc(designId) {
  return {
    known: true,
    pass: true,
    outputHashesVerified: true,
    printDimensionsVerified: true,
    colorModeVerified: true,
    designId,
    orderNumber: ORDER_NUMBER,
  };
}

const OWNER_PROMOTION_CODE = "DESIGNPROAI_OWNER_CANARY_100";
const OWNER_PROMOTION_DISCOUNT_CENTS = 29_900;

async function automaticProductionRun(enticeRunId) {
  const { data, error } = await service
    .from("designpro_workflow_runs")
    .select("id,workflow_type,status,entice_pack_id")
    .eq("workflow_type", "designpro.production_pack")
    .eq("entice_pack_id", enticeRunId)
    .order("created_at");
  if (error) throw new Error(`automatic production lookup failed: ${error.message}`);
  if ((data || []).length !== 1) {
    throw new Error(`expected exactly one automatic Production workflow for Entice ${enticeRunId}, found ${(data || []).length}`);
  }
  return data[0];
}

async function confirmOwnerPromotionEntitlement(generationId, enticeRunId) {
  const checkoutSessionId = `cs_owner_canary_${generationId.replaceAll("-", "")}`;
  const result = await rpc(service, "confirm_designpro_purchase", {
    p_checkout_session_id: checkoutSessionId,
    p_payment_intent_id: null,
    p_product_type: "print_pack_entitlement",
    p_generation_id: generationId,
    p_amount_cents: 0,
    p_user_email: OPERATOR_EMAIL,
    p_promotion_code: OWNER_PROMOTION_CODE,
    p_discount_cents: OWNER_PROMOTION_DISCOUNT_CENTS,
  });
  const { data: row, error } = await service
    .from("designpro_purchase_entitlements")
    .select("id,entice_run_id,generation_id,product_type,amount_cents,checkout_session_id,promotion_code,discount_cents")
    .eq("checkout_session_id", checkoutSessionId)
    .maybeSingle();
  if (error || !row) throw new Error(`owner promotion entitlement was not persisted: ${error?.message || "no row"}`);
  if (row.entice_run_id !== enticeRunId || row.generation_id !== generationId
    || row.product_type !== "print_pack_entitlement" || row.amount_cents !== 0
    || row.promotion_code !== OWNER_PROMOTION_CODE
    || row.discount_cents !== OWNER_PROMOTION_DISCOUNT_CENTS) {
    throw new Error("owner promotion entitlement does not match the exact prepared pack and Generation ID");
  }
  evidence.ownerPromotionEntitlement = {
    entitlementId: row.id,
    enticeRunId: row.entice_run_id,
    generationId: row.generation_id,
    productType: row.product_type,
    amountCents: row.amount_cents,
    promotionCode: row.promotion_code,
    discountCents: row.discount_cents,
    checkoutSessionId: row.checkout_session_id,
    idempotent: result?.idempotent === true,
  };
  step(`real owner promotion entitlement ${row.id} recorded through confirm_designpro_purchase`);
}

async function approveGate(operator, operatorId, runId, stageKey, qc) {
  const approvalRef = `CANARY-${stageKey === "await_panelpro_preflight_qc" ? "PREFLIGHT" : "FINAL"}-${runId}`;
  const result = await rpc(operator, "approve_designpro_human_gate", {
    p_run_id: runId,
    p_stage_key: stageKey,
    p_actor: operatorId,
    p_approval_ref: approvalRef,
    p_qc: qc,
  });
  evidence.autoApprovals.push({ runId, stageKey, approvalRef, qc, result, approvedAt: new Date().toISOString() });
  step(`${stageKey} approved through real QC RPC`);
}

async function waitForProduction(operator, operatorId, runId, designId) {
  const seen = new Set();
  const approved = new Set();
  for (let poll = 0; poll < MAX_PRODUCTION_POLLS; poll += 1) {
    const stages = await fetchStages(runId);
    recordTransitions(runId, stages, seen);
    const run = await fetchRun(runId);
    if (run?.status === "completed") return run;
    if (run?.status === "failed" || stages.some((stage) => stage.status === "failed")) {
      throw new Error(`production workflow failed: ${JSON.stringify(run?.error || stages.find((stage) => stage.status === "failed")).slice(0, 1000)}`);
    }

    for (const stage of stages) {
      if (stage.status !== "waiting" || approved.has(stage.stage_key)) continue;
      if (stage.stage_key === "await_panelpro_preflight_qc") {
        await approveGate(operator, operatorId, runId, stage.stage_key, preflightQc());
        approved.add(stage.stage_key);
      } else if (stage.stage_key === "await_final_human_qc") {
        await approveGate(operator, operatorId, runId, stage.stage_key, finalQc(designId));
        approved.add(stage.stage_key);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("production workflow did not complete within 60 minutes");
}

async function collectArtifacts(runId, label) {
  const { data, error } = await service
    .from("designpro_artifacts")
    .select("artifact_kind,surface_key,storage_path,content_hash,byte_size,metadata")
    .eq("run_id", runId)
    .order("created_at");
  if (error) throw new Error(`artifact read for ${label} failed: ${error.message}`);

  const rows = data || [];
  for (let index = 0; index < rows.length; index += 1) {
    const artifact = rows[index];
    const { data: blob, error: downloadError } = await service.storage.from(BUCKET).download(artifact.storage_path);
    if (downloadError || !blob) {
      evidence.outputs.push({ run: label, ...artifact, downloadError: downloadError?.message || "empty body" });
      continue;
    }
    const bytes = Buffer.from(await blob.arrayBuffer());
    const observedHash = sha256(bytes);
    const base = artifact.storage_path.split("/").pop() || `${artifact.artifact_kind}-${index}`;
    const safeSurface = artifact.surface_key ? `-${artifact.surface_key}` : "";
    const file = `${label}-${artifact.artifact_kind}${safeSurface}-${index}-${base}`;
    writeFileSync(`${OUT}/${file}`, bytes);
    evidence.outputs.push({
      run: label,
      artifactKind: artifact.artifact_kind,
      surfaceKey: artifact.surface_key,
      file,
      storagePath: artifact.storage_path,
      byteSize: bytes.length,
      contentHash: artifact.content_hash,
      observedHash,
      hashVerified: observedHash === artifact.content_hash,
      metadata: artifact.metadata,
    });
    step(`wrote ${file} (${(bytes.length / 1024).toFixed(0)} KB)`);
  }
}

function assertOutputSet() {
  const count = (run, kind) => evidence.outputs.filter(
    (item) => item.run === run && item.artifactKind === kind && item.hashVerified
  ).length;
  const checks = {
    enticeFlatProofs: count("entice", "flat-proof"),
    enticePanels: count("entice", "panel"),
    productionUpscaledPanels: count("production", "upscaled-panel"),
    productionOutputs: count("production", "output"),
    productionZip: count("production", "zip"),
    productionWrapboxManifest: count("production", "wrapbox-manifest"),
  };
  const pass =
    checks.enticeFlatProofs >= 2 &&
    checks.enticePanels === 6 &&
    checks.productionUpscaledPanels === 6 &&
    checks.productionOutputs === 18 &&
    checks.productionZip === 1 &&
    checks.productionWrapboxManifest === 1;
  evidence.expectedOutputChecks = { ...checks, pass };
  if (!pass) throw new Error(`production artifact set incomplete: ${JSON.stringify(checks)}`);
}


/**
 * Run Calls 1-7 for real and return what they authored.
 *
 * The request is created by the authenticated operator, the running runtime
 * workers claim it, and the worker's engine receipt carries the canonical
 * design master. The receipt is read with the service client because
 * get_designpro_generation_request deliberately does not return it -- that is a
 * read; the revision itself is still saved by the operator's own JWT.
 */
async function runCallsOneToSeven({ operator, operatorId, generationId }) {
  // THE CANARY RUNS A.T.L.A.S., BECAUSE THAT IS WHAT PRODUCTION RUNS.
  //
  // It used to submit `designpro.calls-1-7-input.v1` -- an obsolete replay
  // contract that hands the runtime seven pre-existing render URLs -- and
  // then assert `receipt.designMaster`. Nothing about that exercised A.T.L.A.S.:
  // no flattened master was authored, no zone was cut, no proof was projected.
  // Worse, it could never pass, because the v1 path records no design master at
  // all. Live run 32886592846 (2026-08-25) died on exactly that -- "Calls 1-7
  // recorded no design master: null" -- while reporting green through every
  // stage before it. A canary that cannot pass is not a canary; a canary that
  // tests a contract production does not use is worse, because it reports
  // confidence about a path nobody runs.
  //
  // v3 is the contract the gateway now normalizes every real vehicle-wrap
  // generation onto, so the canary submits it directly. Its validator
  // (calls_1_7_input_v3_valid) forbids `orderNumber` and `delivery` on the
  // input. Calls 1-7 and the Entice pack are fulfillment-unbound by design;
  // recipient registration happens only after the purchase entitlement.
  const input = {
    contractVersion: "designpro.calls-1-7-input.v3",
    pipelineMode: "flat-first-atlas-v1",
    vehicle: VEHICLE,
    brief: DESIGN_BRIEF,
    designName: DESIGN_NAME,
    mode: "commercial",
    industry: "HVAC and climate control",
    colors: ["deep blue", "sunrise orange"],
    style: "modern commercial",
  };

  step("creating a new A.T.L.A.S. Calls 1-7 generation request");
  const created = await rpc(operator, "create_designpro_flat_first_generation_request", {
    p_generation_id: generationId,
    p_input: input,
    // The v3 RPC recomputes its own key from the Postgres rendering of the
    // input jsonb, which a client cannot reproduce byte for byte. It accepts
    // NULL and derives the canonical key itself.
    p_idempotency_key: null,
  });
  const requestId = String(created?.requestId || created?.id || "");
  if (!requestId) throw new Error(`generation request was not created: ${JSON.stringify(created).slice(0, 300)}`);
  evidence.generationRequestId = requestId;
  evidence.visualizationId = requestId;
  step(`request ${requestId}`);

  let state = "";
  let seen = "";
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const status = await rpc(operator, "get_designpro_generation_request", { p_request_id: requestId });
    state = String(status?.state || "");
    if (state !== seen) { step(`  calls 1-7 ${state}`); seen = state; }
    if (state === "outputs_ready") break;
    if (state === "failed" || state === "retryable") {
      throw new Error(`Calls 1-7 failed (${state}): ${String(status?.failureCode || "unknown")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  if (state !== "outputs_ready") throw new Error(`Calls 1-7 did not finish; last state ${state || "none"}`);

  const { data: row, error } = await service
    .from("designpro_generation_requests")
    .select("engine_receipt,created_at,completed_at")
    .eq("id", requestId)
    .maybeSingle();
  if (error || !row) throw new Error(`engine receipt read failed: ${error?.message || "no row"}`);
  const receipt = row.engine_receipt || {};
  const revisionId = String(receipt.handoffRevisionId || "");
  if (!revisionId) throw new Error("the engine receipt carries no handoff revision id");

  // AN A.T.L.A.S. RUN IS PROVEN BY ITS PERSISTED REVISION, NOT BY ITS RECEIPT.
  //
  // The receipt is written by the same worker whose work is under test, so
  // trusting it alone would let a run assert its own success. The revision row
  // is the durable artifact every downstream consumer reads -- RevisionStudio,
  // PanelPro, the handoff gate -- and it exists only after the master passed
  // deterministic and semantic acceptance, because nothing is stored before
  // then. The receipt is still checked, and then checked AGAINST the row.
  const flatAtlas = receipt.flatAtlas;
  if (!flatAtlas?.master?.contentHash) {
    throw new Error(`Calls 1-7 recorded no A.T.L.A.S. master: ${JSON.stringify(flatAtlas || null).slice(0, 300)}`);
  }
  const { data: atlasRow, error: atlasError } = await service
    .from("designpro_flat_atlas_revisions")
    .select("id,revision_sequence,master_content_hash,master_storage_path,master_byte_size,"
      + "projection_content_hash,manifest_content_hash,guide_content_hash,prompt_version,model,"
      + "width_px,height_px,effective_ppi,metadata,created_at")
    .eq("generation_id", generationId)
    .order("revision_sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (atlasError || !atlasRow) {
    throw new Error(`no A.T.L.A.S. revision was persisted for ${generationId}: ${atlasError?.message || "no row"}`);
  }
  if (atlasRow.master_content_hash !== flatAtlas.master.contentHash) {
    throw new Error("the engine receipt's master hash does not match the persisted A.T.L.A.S. revision");
  }
  if (atlasRow.prompt_version !== flatAtlas.promptVersion) {
    throw new Error("the engine receipt's prompt version does not match the persisted A.T.L.A.S. revision");
  }
  // The master QC gate is the reason a defective sheet never reaches a panel.
  // A canary that accepted a revision without it would report green on exactly
  // the failure this whole path exists to prevent.
  if (atlasRow.metadata?.masterQcPassed !== true) {
    throw new Error(`the A.T.L.A.S. master did not pass QC: ${JSON.stringify(atlasRow.metadata || null).slice(0, 300)}`);
  }
  if (Number(atlasRow.metadata?.geminiImageRequestCount) !== 1) {
    throw new Error(`A.T.L.A.S. spent ${String(atlasRow.metadata?.geminiImageRequestCount || "unknown")} creative image requests; expected exactly one`);
  }
  if (atlasRow.metadata?.geometryAuthority?.source !== "genie-panelizer-catalog") {
    throw new Error(`A.T.L.A.S. used non-current geometry authority: ${String(atlasRow.metadata?.geometryAuthority?.source || "missing")}`);
  }
  const atlasPanelManifestHashes = new Set((atlasRow.metadata?.callOnePanels || [])
    .map((panel) => panel?.genieManifestHash).filter(Boolean));
  if (atlasPanelManifestHashes.size !== 1 || !atlasPanelManifestHashes.has(evidence.geniePrep?.manifestHash)) {
    throw new Error("A.T.L.A.S. did not use the GENIE manifest prepared before Call 1");
  }
  for (const [field, value] of Object.entries({
    master_storage_path: atlasRow.master_storage_path,
    projection_content_hash: atlasRow.projection_content_hash,
    manifest_content_hash: atlasRow.manifest_content_hash,
    guide_content_hash: atlasRow.guide_content_hash,
  })) {
    if (!value) throw new Error(`the A.T.L.A.S. revision carries no ${field}`);
  }
  evidence.flatAtlas = {
    revisionId: atlasRow.id,
    revisionSequence: atlasRow.revision_sequence,
    masterContentHash: atlasRow.master_content_hash,
    masterStoragePath: atlasRow.master_storage_path,
    masterByteSize: atlasRow.master_byte_size,
    projectionContentHash: atlasRow.projection_content_hash,
    manifestContentHash: atlasRow.manifest_content_hash,
    guideContentHash: atlasRow.guide_content_hash,
    promptVersion: atlasRow.prompt_version,
    model: atlasRow.model,
    widthPx: atlasRow.width_px,
    heightPx: atlasRow.height_px,
    effectivePpi: atlasRow.effective_ppi,
    masterQcPassed: atlasRow.metadata?.masterQcPassed === true,
    masterCutoutSurfaces: atlasRow.metadata?.masterCutoutSurfaces || [],
    createdAt: atlasRow.created_at,
    geminiImageRequestCount: Number(atlasRow.metadata?.geminiImageRequestCount),
    callOneTimings: atlasRow.metadata?.callOneTimings || null,
    atlasEdgeProvenance: atlasRow.metadata?.atlasEdgeProvenance || [],
  };
  step(`A.T.L.A.S. master ${atlasRow.master_content_hash.slice(0, 12)} `
    + `(${atlasRow.prompt_version}, ${atlasRow.width_px}x${atlasRow.height_px}, QC passed)`);

  // THE SIX PANELS CALL 1 CUT HAVE TO CROSS THE SEAM ON THE SNAPSHOT.
  //
  // Manufacturing may not read designpro_flat_atlas_revisions -- the frozen seam
  // makes the immutable revision snapshot its only interface -- so the panel
  // records have to be carried over. In the product the gateway does that, in
  // `atlasCallOnePanels`. The canary talks to the RPCs directly, so it never got
  // the enrichment and froze a snapshot with no `callOnePanels` at all. Both
  // downstream failures on run 33231986815 came from that one omission:
  // `proof.build` raised `call8_dimensions_unavailable` (RULE 0.19 leaves the
  // free half with no GENIE manifest, so Call 8 sizes the proof from these
  // records), and `panels.build` then fell to the legacy arm that consumes
  // proof.build's surfaces and raised `prior_stage_unverified`.
  //
  // Same acceptance as the gateway's, and it throws rather than returning none:
  // a canary that quietly freezes an empty set reports green on the path it
  // exists to exercise. A snapshot cannot be repaired once frozen.
  const callOnePanels = Array.isArray(atlasRow.metadata?.callOnePanels)
    ? atlasRow.metadata.callOnePanels : [];
  const usablePanels = callOnePanels.filter((panel) => CALL_ONE_SURFACES.includes(String(panel?.surfaceKey || ""))
    && /^[0-9a-f]{64}$/.test(String(panel?.contentHash || "").toLowerCase())
    && String(panel?.storagePath || "").trim()
    && Number(panel?.byteSize) > 0
    && Number(panel?.printWidthIn) > 0 && Number(panel?.printHeightIn) > 0);
  if (usablePanels.length !== CALL_ONE_SURFACES.length
    || new Set(usablePanels.map((panel) => panel.surfaceKey)).size !== CALL_ONE_SURFACES.length) {
    throw new Error(`Call 1 did not record six usable panels: ${usablePanels.length} of `
      + `${callOnePanels.length} recorded are usable across `
      + `${new Set(usablePanels.map((panel) => panel.surfaceKey)).size} surfaces`);
  }
  evidence.callOnePanels = usablePanels.map((panel) => ({
    surfaceKey: panel.surfaceKey,
    contentHash: panel.contentHash,
    printWidthIn: panel.printWidthIn,
    printHeightIn: panel.printHeightIn,
    bleedInches: panel.bleedInches,
  }));
  step(`Call 1 cut six panels (${usablePanels.map((panel) => panel.surfaceKey).sort().join(", ")})`);

  // The worker copied the accepted views to the revision input paths; rebuild
  // the same addresses it wrote, since the status RPC withholds storage paths.
  const { data: viewRows, error: viewError } = await service
    .from("designpro_generation_views")
    .select("source_view_type,consumer_role,content_hash,byte_size,content_type,created_at")
    .eq("request_id", requestId)
    .is("superseded_at", null);
  if (viewError) throw new Error(`generation view read failed: ${viewError.message}`);
  evidence.callsOneToSeven = {
    acceptedViews: (viewRows || []).map((view) => ({
      sourceViewType: view.source_view_type,
      consumerRole: view.consumer_role,
      createdAt: view.created_at,
    })),
    refusedViews: Array.isArray(receipt.refusedViews) ? receipt.refusedViews : [],
  };
  const driverRow = (viewRows || []).find((view) => view.source_view_type === "side");
  if (!driverRow?.created_at) throw new Error("Driver proof has no durable availability timestamp");
  const atlasSeconds = elapsedSeconds(row.created_at, atlasRow.created_at, "A.T.L.A.S. latency");
  const driverSeconds = elapsedSeconds(row.created_at, driverRow.created_at, "Driver latency");
  evidence.latency = {
    basis: "request-created-to-durable-artifact",
    requestCreatedAt: row.created_at,
    atlasCreatedAt: atlasRow.created_at,
    driverCreatedAt: driverRow.created_at,
    atlasSeconds,
    driverSeconds,
    atlasSloSeconds: ATLAS_SLO_SECONDS,
    driverSloSeconds: DRIVER_SLO_SECONDS,
    pass: atlasSeconds <= ATLAS_SLO_SECONDS && driverSeconds <= DRIVER_SLO_SECONDS,
  };
  step(`latency A.T.L.A.S. ${atlasSeconds.toFixed(2)}s / ${ATLAS_SLO_SECONDS}s; `
    + `Driver ${driverSeconds.toFixed(2)}s / ${DRIVER_SLO_SECONDS}s`);
  if (!evidence.latency.pass) {
    throw new Error(`latency SLO failed: A.T.L.A.S. ${atlasSeconds.toFixed(2)}s (max ${ATLAS_SLO_SECONDS}s), `
      + `Driver ${driverSeconds.toFixed(2)}s (max ${DRIVER_SLO_SECONDS}s)`);
  }
  const renderAssets = {};
  for (const view of viewRows || []) {
    const extension = EXTENSION[view.content_type];
    if (!extension) throw new Error(`view ${view.consumer_role}: ${view.content_type} is unsupported`);
    renderAssets[view.consumer_role] = {
      storagePath: `users/${operatorId}/revisions/${revisionId}/inputs/${view.consumer_role}/${view.content_hash}.${extension}`,
      contentHash: view.content_hash,
      byteSize: Number(view.byte_size),
      contentType: view.content_type,
    };
  }
  if (Object.keys(renderAssets).length !== 7) {
    const accepted = evidence.callsOneToSeven.acceptedViews.map((view) => view.sourceViewType).join(", ") || "none";
    const refused = evidence.callsOneToSeven.refusedViews
      .map((view) => `${view.sourceViewType}:${view.reason}`).join(", ") || "none recorded";
    throw new Error(`expected seven placed views, found ${Object.keys(renderAssets).length}; accepted ${accepted}; refused ${refused}`);
  }
  step(`revision ${revisionId} carries seven placed views`);
  return {
    requestId,
    revisionId,
    renderAssets,
    callOnePanels: usablePanels,
    flatAtlas: evidence.flatAtlas,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  writeEvidence();

  const { operator, operatorId } = await ensureOperatorAndCustomer();
  await assertCurrentGeniePrep();

  const generationId = randomUUID();
  const designId = `DID-${generationId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  evidence.generationId = generationId;

  process.stdout.write(`\nProduction canary — order ${ORDER_NUMBER}\ndesign ${designId}\n\n`);

  // A NEW CURRENT-SYSTEM DESIGN. No historical render, geometry row or source
  // job enters this request. Calls 1-7 run through the current one-artifact
  // A.T.L.A.S. graph and record its canonical design as they author it.
  const { requestId, revisionId, renderAssets } = await runCallsOneToSeven({
    operator, operatorId, generationId,
  });
  evidence.revisionId = revisionId;
  evidence.renderAssets = renderAssets;
  step("handing the unbound A.T.L.A.S. design to Entice");
  const handoff = await rpc(operator, "handoff_designpro_generation_to_production", {
    p_request_id: requestId,
  });
  if (String(handoff?.revisionId || "").toLowerCase() !== revisionId.toLowerCase()) {
    throw new Error("A.T.L.A.S. handoff returned a different revision");
  }
  evidence.enticeRunId = String(handoff?.workflowRunId || "");
  if (!evidence.enticeRunId) throw new Error("A.T.L.A.S. handoff returned no Entice workflow");
  await waitForEntice(evidence.enticeRunId);
  step("Entice complete; resolving its one server-created Production workflow");
  const production = await automaticProductionRun(evidence.enticeRunId);
  evidence.productionRunId = production.id;

  // The canary bypasses Stripe, never the purchase gate. This service-role RPC
  // persists the same Generation-bound entitlement the Stripe webhook writes,
  // with an explicit protected 100% owner promotion instead of a fake paid bit.
  await confirmOwnerPromotionEntitlement(generationId, evidence.enticeRunId);

  // WrapBox is fulfillment data. Do not register or bind a recipient while the
  // customer is designing or viewing Entice output. The entitlement above must
  // exist first; the database then requires this exact late binding before it
  // will release Production from await_purchase.
  const delivery = await registerRecipient(operatorId, generationId);
  step(`recipient registered after entitlement ${delivery.customerId}`);
  const fulfillment = await rpc(operator, "bind_designpro_revision_fulfillment", {
    p_revision_id: revisionId,
    p_recipient_identity_hash: delivery.recipientIdentityHash,
    p_order_number: ORDER_NUMBER,
    p_design_name: DESIGN_NAME,
  });
  if (String(fulfillment?.revisionId || "").toLowerCase() !== revisionId.toLowerCase()
    || fulfillment?.delivery?.recipientIdentityHash !== delivery.recipientIdentityHash) {
    throw new Error("post-purchase WrapBox fulfillment binding is invalid");
  }
  evidence.delivery = {
    registeredAfterEntitlement: true,
    bindingHash: fulfillment.bindingHash,
    customerId: delivery.customerId,
    recipientIdentityHash: delivery.recipientIdentityHash,
  };
  step(`post-purchase fulfillment bound ${String(fulfillment.bindingHash || "").slice(0, 12)}`);
  await waitForProduction(operator, operatorId, evidence.productionRunId, designId);

  evidence.finalState = {
    entice: await fetchRun(evidence.enticeRunId),
    production: await fetchRun(evidence.productionRunId),
  };

  await collectArtifacts(evidence.enticeRunId, "entice");
  await collectArtifacts(evidence.productionRunId, "production");
  assertOutputSet();
  writeEvidence();

  process.stdout.write(`\nPASS — ${evidence.outputs.length} verified artifact file(s) written to ${OUT}\n`);
}

main().catch((error) => {
  evidence.error = { message: error.message, stack: error.stack, at: new Date().toISOString() };
  evidence.finalState = evidence.finalState || {};
  writeEvidence();
  console.error(`\ncanary failed: ${error.message}`);
  process.exit(1);
});
