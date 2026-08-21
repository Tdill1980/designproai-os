import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createGateway } from "../src/server.mjs";

const env = {
  NODE_ENV: "test",
  SUPABASE_URL: "https://dp-project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

const CALLS17_RECIPIENT_HASH = "c".repeat(64);
const CALLS17_ORDER_NUMBER = "DP-9001";

function calls17Input(extra = {}) {
  return {
    contractVersion: "designpro.calls-1-7-input.v1",
    orderNumber: CALLS17_ORDER_NUMBER,
    delivery: {
      contractVersion: "designpro.wrapbox-recipient.v1",
      recipientIdentityHash: CALLS17_RECIPIENT_HASH,
      orderNumber: CALLS17_ORDER_NUMBER,
    },
    vehicle: { year: "2026", make: "Porsche", model: "911", type: "car" },
    ...extra,
  };
}

function calls17Idempotency(generationId, input) {
  return `calls17:${generationId}:${input.delivery.recipientIdentityHash}:`
    + createHash("sha256").update(input.orderNumber, "utf8").digest("hex");
}

function flatFirstInput(extra = {}) {
  return {
    contractVersion: "designpro.calls-1-7-input.v3",
    pipelineMode: "flat-first-atlas-v1",
    vehicle: { year: "2025", make: "Ford", model: "F-250", type: "truck" },
    brief: "High-contrast commercial pool-service wrap",
    designName: "Flamingo Pools F-250",
    mode: "commercial",
    ...extra,
  };
}

function flatFirstPanelMap() {
  return [
    { surfaceKey: "driver", trimWidthIn: 153, trimHeightIn: 56, printWidthIn: 163, printHeightIn: 66, bleedIn: { top: 5, right: 5, bottom: 5, left: 5 }, surfaceSqFt: 59.5, effectivePpi: 26.77, rotationDegrees: -90, x: 3000, y: 200, w: 800, h: 3600, internal: "never exposed" },
    { surfaceKey: "passenger", trimWidthIn: 153, trimHeightIn: 56, printWidthIn: 163, printHeightIn: 66, bleedIn: { top: 5, right: 5, bottom: 5, left: 5 }, surfaceSqFt: 59.5, effectivePpi: 26.77, rotationDegrees: 90, x: 200, y: 200, w: 800, h: 3600 },
    { surfaceKey: "hood", trimWidthIn: 70, trimHeightIn: 60, printWidthIn: 80, printHeightIn: 70, bleedIn: { top: 5, right: 5, bottom: 5, left: 5 }, surfaceSqFt: 29.17, effectivePpi: 30, rotationDegrees: 0, x: 1500, y: 2700, w: 700, h: 600 },
    { surfaceKey: "roof", trimWidthIn: 90, trimHeightIn: 70, printWidthIn: 100, printHeightIn: 80, bleedIn: { top: 5, right: 5, bottom: 5, left: 5 }, surfaceSqFt: 43.75, effectivePpi: 30, rotationDegrees: 0, x: 1450, y: 1300, w: 800, h: 700 },
    { surfaceKey: "front", trimWidthIn: 80, trimHeightIn: 30, printWidthIn: 90, printHeightIn: 40, bleedIn: { top: 5, right: 5, bottom: 5, left: 5 }, surfaceSqFt: 16.67, effectivePpi: 30, rotationDegrees: 0, x: 1500, y: 3400, w: 700, h: 300 },
    { surfaceKey: "rear", trimWidthIn: 80, trimHeightIn: 30, printWidthIn: 90, printHeightIn: 40, bleedIn: { top: 5, right: 5, bottom: 5, left: 5 }, surfaceSqFt: 16.67, effectivePpi: 30, rotationDegrees: 0, x: 1500, y: 500, w: 700, h: 300 },
  ];
}

function flatFirstAtlasRpcRow({ userId, requestId, generationId, panelMap = flatFirstPanelMap() }) {
  const guideHash = "1".repeat(64);
  const manifestHash = "2".repeat(64);
  const masterHash = "3".repeat(64);
  const projectionHash = "4".repeat(64);
  return {
    id: "40000000-0000-4000-8000-000000000001",
    requestId,
    generationId,
    parentRevisionId: null,
    revisionSequence: 1,
    guideStoragePath: `designpro/user_${userId}/${generationId}/flat-first/v1/guide/${guideHash}.png`,
    guideContentHash: guideHash,
    guideByteSize: 900,
    guideContentType: "image/png",
    manifestContentHash: manifestHash,
    manifestByteSize: 500,
    manifestContentType: "application/json",
    masterStoragePath: `designpro/user_${userId}/${generationId}/flat-first/v1/revisions/1/master/${masterHash}.png`,
    masterContentHash: masterHash,
    masterByteSize: 1500,
    masterContentType: "image/png",
    projectionStoragePath: `designpro/user_${userId}/${generationId}/flat-first/v1/revisions/1/projection/${projectionHash}.jpg`,
    projectionContentHash: projectionHash,
    projectionByteSize: 1100,
    projectionContentType: "image/jpeg",
    affectedSurfaces: ["driver", "passenger", "hood", "roof", "front", "rear"],
    instruction: null,
    productionEligible: false,
    model: "gemini-3-pro-image-preview",
    promptVersion: "flat-atlas-v1",
    widthPx: 4096,
    heightPx: 4096,
    effectivePpi: 26.77,
    panelMap,
    exampleUsed: false,
    exampleGuideHash: null,
    exampleMasterHash: null,
    createdAt: "2026-08-20T16:00:00Z",
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function authenticatedFetch(calls) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "qc@designproai.com" });
    if (String(url).includes("/rest/v1/designpro_workflow_runs?")) return Response.json([{
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      workflow_type: "designpro.production_pack",
      status: "approval_required",
      results: { generationId: "job-1" },
      input: {},
      revision_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      revision_snapshot_hash: "a".repeat(64),
    }]);
    if (String(url).includes("/rest/v1/designpro_revision_sources?")) return Response.json([{
      generation_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      snapshot: {
        generationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        designId: "DID-EEEEEEEE",
        orderNumber: "ORDER-2026-0042",
      },
    }]);
    if (String(url).includes("/rest/v1/rpc/")) return Response.json({ accepted: true });
    throw new Error(`unexpected fetch ${url}`);
  };
}

const preflightQc = {
  dimensionsVerified: true,
  sourceRegionsVerified: true,
  fiveInchBleed: true,
  panelHashesVerified: true,
  logoInventoryVerified: true,
  textLockVerified: true,
};

const finalQc = {
  outputHashesVerified: true,
  printDimensionsVerified: true,
  colorModeVerified: true,
};

for (const [gate, expectedStage, qc] of [
  ["preflight", "await_panelpro_preflight_qc", preflightQc],
  ["final", "await_final_human_qc", finalQc],
]) {
  test(`${gate} approval calls the one standalone human-gate RPC with exact evidence`, async (t) => {
    const calls = [];
    const server = createGateway({ env, fetchImpl: authenticatedFetch(calls) });
    t.after(() => server.close());
    const base = await listen(server);
    const response = await fetch(`${base}/api/jobs/job-1/approvals/${gate}`, {
      method: "POST",
      headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
      body: JSON.stringify({ qc, notes: "Operator verified" }),
    });
    assert.equal(response.status, 202);
    const approval = calls.find((call) => call.url.endsWith("/rest/v1/rpc/approve_designpro_human_gate"));
    assert.ok(approval, "approve_designpro_human_gate was not called");
    const payload = JSON.parse(approval.init.body);
    assert.deepEqual(Object.keys(payload).sort(), ["p_actor", "p_approval_ref", "p_qc", "p_run_id", "p_stage_key"].sort());
    assert.equal(payload.p_stage_key, expectedStage);
    assert.equal(payload.p_qc.known, true);
    assert.equal(payload.p_qc.pass, true);
    assert.equal(payload.p_qc.notes, "Operator verified");
    for (const [key, value] of Object.entries(qc)) assert.equal(payload.p_qc[key], value);
    if (gate === "final") {
      assert.equal(payload.p_qc.designId, "DID-EEEEEEEE");
      assert.equal(payload.p_qc.orderNumber, "ORDER-2026-0042");
    }
    assert.match(payload.p_approval_ref, new RegExp(`^designpro-qc:${expectedStage}:[0-9a-f]{64}$`));
  });
}

test("approval refuses a visually clicked gate unless every required check is explicit", async (t) => {
  const calls = [];
  const server = createGateway({ env, fetchImpl: authenticatedFetch(calls) });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/jobs/job-1/approvals/preflight`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({ qc: { ...preflightQc, panelHashesVerified: false } }),
  });
  assert.equal(response.status, 400);
  assert.equal(calls.some((call) => call.url.includes("/rest/v1/rpc/approve_designpro_human_gate")), false);
});

test("password login keeps access and refresh tokens in separate HttpOnly cookies", async (t) => {
  const server = createGateway({
    env,
    fetchImpl: async (url) => {
      assert.match(String(url), /grant_type=password/);
      return Response.json({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "operator@designproai.com" },
      });
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "operator@designproai.com", password: "not-a-real-password" }),
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.getSetCookie();
  assert.equal(setCookie.length, 2);
  assert.ok(setCookie.some((value) => value.startsWith("dp_session=") && value.includes("HttpOnly") && value.includes("SameSite=Strict")));
  assert.ok(setCookie.some((value) => value.startsWith("dp_refresh=") && value.includes("HttpOnly") && value.includes("SameSite=Strict")));
});

test("fresh-project signup honors email confirmation and cannot grant QC authority", async (t) => {
  const server = createGateway({
    env,
    fetchImpl: async (url, init) => {
      assert.match(String(url), /\/auth\/v1\/signup$/);
      const body = JSON.parse(init.body);
      assert.equal(body.email, "new@designproai.com");
      assert.equal("app_metadata" in body, false);
      return Response.json({ user: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: body.email } });
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "new@designproai.com", password: "Strong!Pass123" }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, confirmationRequired: true });
  assert.equal(response.headers.get("set-cookie"), null);
});

test("operator recipient intake accepts normal business fields and forwards only a server hash", async (t) => {
  const operatorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const customerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const verificationReference = "PAYMENT-SETTLED-2026-0042";
  const expectedHash = createHash("sha256").update(verificationReference, "utf8").digest("hex");
  const calls = [];
  const server = createGateway({
    env: {
      ...env,
      DESIGNPRO_RUNTIME_INTERNAL_URL: "http://runtime-1:3001",
      WORKER_SECRET: "w".repeat(32),
    },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/auth/v1/user")) {
        return Response.json({ id: operatorId, email: "operator@designproai.com" });
      }
      if (String(url) === "http://runtime-1:3001/internal/wrapbox/recipient") {
        const body = JSON.parse(init.body);
        assert.deepEqual(body, {
          operatorId,
          customerEmail: "customer@designproai.test",
          customerReference: "Acme Fleet Customer",
          verificationRefHash: expectedHash,
          orderNumber: "ORDER-2026-0042",
        });
        assert.equal(init.body.includes(verificationReference), false);
        assert.equal("customerId" in body, false);
        assert.equal("customerAuthUserId" in body, false);
        return Response.json({
          customerId,
          customerEmail: body.customerEmail,
          recipientIdentityHash: "c".repeat(64),
          emailVerifiedAt: "2026-08-06T12:00:00.000Z",
          orderNumber: body.orderNumber,
          idempotent: false,
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/wrapbox/recipients/register`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({
      customerEmail: " Customer@DesignProAI.Test ",
      customerReference: "Acme Fleet Customer",
      verificationReference,
      orderNumber: "ORDER-2026-0042",
      designName: "Porsche 911 production wrap",
    }),
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.delivery.customerId, customerId);
  assert.equal(payload.delivery.customerEmail, "customer@designproai.test");
  assert.equal(JSON.stringify(payload).includes(verificationReference), false);
  assert.equal(JSON.stringify(payload).includes(expectedHash), false);
  assert.equal(calls.filter((call) => call.url.includes("/internal/wrapbox/recipient")).length, 1);
});

test("recipient intake rejects UUID/hash-era fields before calling the runtime", async (t) => {
  let internalCalled = false;
  const server = createGateway({
    env: {
      ...env,
      DESIGNPRO_RUNTIME_INTERNAL_URL: "http://runtime-1:3001",
      WORKER_SECRET: "w".repeat(32),
    },
    fetchImpl: async (url) => {
      if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      internalCalled = true;
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/wrapbox/recipients/register`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({
      customerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      customerAuthUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      verificationRefHash: "d".repeat(64),
      orderNumber: "ORDER-2026-0042",
      designName: "Porsche 911 production wrap",
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(internalCalled, false);
});

test("source has no legacy approval RPC, public render URL fallback, or Supabase service key", () => {
  const source = readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /approve_designpro_panelpro_preflight|approve_designpro_production_pack/);
  assert.doesNotMatch(source, /renderUrls/);
  assert.match(source, /renderAssets/);
  assert.match(source, /approve_designpro_human_gate/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY/);
  assert.match(source, /WORKER_SECRET/);
  assert.match(source, /\/internal\/wrapbox\/recipient/);
});

test("asset intents use the canonical immutable input prefix and never collide with derived runtime paths", () => {
  const source = readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
  assert.match(source, /users\/\$\{userId\}\/revisions\/\$\{intent\.revisionId\}\/inputs/);
  assert.doesNotMatch(source, /`designpro\/user_\$\{userId\}\/revisions/);
  assert.match(source, /intent\.contentHash/);
  assert.doesNotMatch(source, /x-upsert|upsert:\s*true/);
  assert.match(source, /asset_identity_mismatch/);
});

test("upload intent returns the exact canonical input path consumed by the runtime", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const revisionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const hash = "1".repeat(64);
  const expectedPath = `users/${userId}/revisions/${revisionId}/inputs/driver/${hash}.png`;
  const server = createGateway({
    env,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: userId, email: "owner@designproai.com" });
      assert.equal(String(url), `https://dp-project.supabase.co/storage/v1/object/upload/sign/wrap-files/${expectedPath}`);
      return Response.json({ url: `/object/upload/sign/wrap-files/${expectedPath}?token=signed` });
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/assets/upload-intents`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({ revisionId, kind: "driver", contentHash: hash, contentType: "image/png", byteSize: 1234 }),
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.asset.storagePath, expectedPath);
  assert.equal(payload.asset.contentHash, hash);
  assert.match(payload.signedUrl, /^https:\/\/dp-project\.supabase\.co\/storage\/v1\/object\/upload\/sign\//);
});

test("revision rejects silent zero-logo inventory but accepts an explicit no-logo attestation", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const revisionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const viewKeys = ["driver", "passenger", "hood", "roof", "front", "rear", "hero3d"];
  const bytesByPath = new Map();
  const renderAssets = {};
  for (const key of viewKeys) {
    const bytes = Buffer.from(`immutable-${key}`);
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const storagePath = `users/${userId}/revisions/${revisionId}/inputs/${key}/${contentHash}.png`;
    bytesByPath.set(storagePath, bytes);
    renderAssets[key] = { storagePath, contentHash, byteSize: bytes.byteLength, contentType: "image/png" };
  }
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: userId, email: "owner@designproai.com" });
      if (String(url).includes("/storage/v1/object/wrap-files/")) {
        const path = decodeURIComponent(String(url).split("/storage/v1/object/wrap-files/")[1]);
        const bytes = bytesByPath.get(path);
        return bytes ? new Response(bytes, { headers: { "content-type": "image/png" } }) : new Response("missing", { status: 404 });
      }
      if (String(url).endsWith("/rpc/save_designpro_revision_source")) return Response.json({ snapshotHash: "a".repeat(64) });
      if (String(url).endsWith("/rpc/create_designpro_entice_workflow")) return Response.json({ workflowRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const baseSubmission = {
    revisionId,
    generationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    visualizationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    expectedUpdatedAt: "2026-08-06T00:00:00.000Z",
    renderAssets,
    idempotencyKey: `revision:${revisionId}`,
    revisionSnapshot: {
      contractVersion: "designpro.revision-snapshot.v1",
      designId: "DID-FFFFFFFF",
      vehicle: { year: "2026", make: "Porsche", model: "911", type: "car" },
      surfaceOptions: {},
      finish: "standard",
      bodyText: "",
      orderNumber: "ORDER-2026-0042",
      expectedLogoInventory: [],
      delivery: {
        contractVersion: "designpro.wrapbox-recipient.v1",
        customerId: "99999999-9999-4999-8999-999999999999",
        customerEmail: "customer@designproai.com",
        recipientIdentityHash: "9".repeat(64),
        orderNumber: "ORDER-2026-0042",
        designName: "Porsche 911 production wrap",
      },
    },
  };
  const { orderNumber: _omittedOrderNumber, ...snapshotWithoutOrder } = baseSubmission.revisionSnapshot;
  const missingOrder = await fetch(`${base}/api/revisions`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({ ...baseSubmission, revisionSnapshot: snapshotWithoutOrder }),
  });
  assert.equal(missingOrder.status, 400);
  assert.ok((await missingOrder.json()).snapshotMissing.includes("orderNumber"));

  const mismatchedRegisteredOrder = await fetch(`${base}/api/revisions`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({
      ...baseSubmission,
      revisionSnapshot: {
        ...baseSubmission.revisionSnapshot,
        orderNumber: "ORDER-2026-0043",
        logoInventoryAttestation: { mode: "none", attested: true },
      },
    }),
  });
  assert.equal(mismatchedRegisteredOrder.status, 400);

  const rejected = await fetch(`${base}/api/revisions`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({ ...baseSubmission, revisionSnapshot: { ...baseSubmission.revisionSnapshot, logoInventoryAttestation: { mode: "listed", attested: true } } }),
  });
  assert.equal(rejected.status, 400);
  assert.deepEqual(await rejected.json(), { error: "logo_inventory_attestation_mismatch" });

  const accepted = await fetch(`${base}/api/revisions`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({ ...baseSubmission, revisionSnapshot: { ...baseSubmission.revisionSnapshot, logoInventoryAttestation: { mode: "none", attested: true } } }),
  });
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", accepted: true });
  const frozen = calls.find((call) => call.url.endsWith("/rpc/save_designpro_revision_source"));
  const frozenSnapshot = JSON.parse(frozen.init.body).p_snapshot;
  assert.equal(frozenSnapshot.logoInventoryAttestation.mode, "none");
  assert.equal(frozenSnapshot.designId, "DID-EEEEEEEE");
  assert.equal(frozenSnapshot.orderNumber, "ORDER-2026-0042");
});

test("artifact review signs only owner-scoped derived files and never persists a URL identity", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const acceptedPath = `designpro/user_${userId}/${runId}/panels/driver.png`;
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: userId, email: "owner@designproai.com" });
      if (String(url).includes("/rest/v1/designpro_workflow_runs?")) return Response.json([{ id: runId, workflow_type: "designpro.entice_pack", status: "running", results: { generationId: "job-1" }, input: {} }]);
      if (String(url).includes("/rest/v1/designpro_artifacts?")) return Response.json([
        { id: "11111111-1111-4111-8111-111111111111", artifact_kind: "panel", surface_key: "driver", storage_path: acceptedPath, content_hash: "a".repeat(64), byte_size: 992, metadata: { widthInches: 110, heightInches: 40 } },
        { id: "22222222-2222-4222-8222-222222222222", artifact_kind: "foreign", storage_path: "designpro/user_someone-else/run/private.png", content_hash: "b".repeat(64), byte_size: 10, metadata: {} },
      ]);
      if (String(url).includes("/storage/v1/object/sign/")) {
        assert.equal(String(url), `https://dp-project.supabase.co/storage/v1/object/sign/wrap-files/${acceptedPath}`);
        return Response.json({ signedURL: `/object/sign/wrap-files/${acceptedPath}?token=short-lived` });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/jobs/job-1/artifacts`, { headers: { cookie: "dp_session=test-token" } });
  assert.equal(response.status, 200);
  const artifacts = await response.json();
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].storagePath, acceptedPath);
  assert.equal(artifacts[0].contentHash, "a".repeat(64));
  assert.match(artifacts[0].signedUrl, /token=short-lived$/);
  assert.equal(calls.filter((call) => call.url.includes("/storage/v1/object/sign/")).length, 1);
});

test("production review includes its identity-pinned Entice proof, panels, and logos", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const sourceRunId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const productionRunId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const revisionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const revisionHash = "a".repeat(64);
  const artifactSetHash = "b".repeat(64);
  const sourcePath = `designpro/user_${userId}/${sourceRunId}/panels/driver.png`;
  const outputPath = `designpro/user_${userId}/${productionRunId}/outputs/driver.png`;
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: userId, email: "owner@designproai.com" });
      if (value.includes("/rest/v1/designpro_workflow_runs?")) return Response.json([
        { id: productionRunId, workflow_type: "designpro.production_pack", status: "approval_required", results: { generationId: "job-production", sourceEnticeRunId: sourceRunId }, input: {}, revision_id: revisionId, revision_snapshot_hash: revisionHash, artifact_set_hash: artifactSetHash },
        { id: sourceRunId, workflow_type: "designpro.entice_pack", status: "completed", results: { generationId: "job-source" }, input: {}, revision_id: revisionId, revision_snapshot_hash: revisionHash, artifact_set_hash: artifactSetHash },
      ]);
      if (value.includes(`/rest/v1/designpro_artifacts?`) && value.includes(`run_id=eq.${sourceRunId}`)) return Response.json([
        { id: "11111111-1111-4111-8111-111111111111", artifact_kind: "panel", surface_key: "driver", storage_path: sourcePath, content_hash: "c".repeat(64), byte_size: 1200, metadata: {} },
      ]);
      if (value.includes(`/rest/v1/designpro_artifacts?`) && value.includes(`run_id=eq.${productionRunId}`)) return Response.json([
        { id: "22222222-2222-4222-8222-222222222222", artifact_kind: "print-png", surface_key: "driver", storage_path: outputPath, content_hash: "d".repeat(64), byte_size: 2400, metadata: {} },
      ]);
      if (value.includes("/storage/v1/object/sign/")) return Response.json({ signedURL: `/object/sign/wrap-files/safe?token=five-minutes` });
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/jobs/job-production/artifacts`, { headers: { cookie: "dp_session=test-token" } });
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.deepEqual(rows.map(({ runId, source, storagePath }) => ({ runId, source, storagePath })), [
    { runId: sourceRunId, source: "entice", storagePath: sourcePath },
    { runId: productionRunId, source: "production", storagePath: outputPath },
  ]);
  assert.equal(calls.filter((call) => call.url.includes("/rest/v1/designpro_artifacts?")).length, 2);
  assert.equal(calls.filter((call) => call.url.includes("/storage/v1/object/sign/")).length, 2);
});

test("production review fails closed when its source Entice identity is absent or different", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const sourceRunId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const productionRunId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  let artifactQuery = false;
  const server = createGateway({
    env,
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: userId });
      if (value.includes("/rest/v1/designpro_workflow_runs?")) return Response.json([
        { id: productionRunId, workflow_type: "designpro.production_pack", status: "approval_required", results: { generationId: "job-production", sourceEnticeRunId: sourceRunId }, input: {}, revision_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", revision_snapshot_hash: "a".repeat(64), artifact_set_hash: "b".repeat(64) },
        { id: sourceRunId, workflow_type: "designpro.entice_pack", status: "completed", results: {}, input: {}, revision_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", revision_snapshot_hash: "a".repeat(64), artifact_set_hash: "e".repeat(64) },
      ]);
      if (value.includes("/rest/v1/designpro_artifacts?")) artifactQuery = true;
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/jobs/job-production/artifacts`, { headers: { cookie: "dp_session=test-token" } });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "source_entice_identity_mismatch" });
  assert.equal(artifactQuery, false);
});

test("GENIE candidate list strips raw discovery data and maps string confidence without NaN", async (t) => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    if (String(url).endsWith("/rpc/list_pending_designpro_vehicle_specs_universal")) return Response.json([{
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      vehicle_class: "truck",
      make: "Ford",
      model: "F-250",
      year: 2025,
      sub_type: "crew cab",
      source: "OEM body guide",
      source_urls: ["https://example.com/evidence", "javascript:bad"],
      confidence: "medium",
      requested_runs: [{ run_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", generation_id: "job-7" }],
      raw_response: { mustNeverReachBrowser: true },
    },
    { id: "11111111-1111-4111-8111-111111111111", make: "A", model: "High", confidence: "high" },
    { id: "22222222-2222-4222-8222-222222222222", make: "B", model: "Low", confidence: "low" },
    { id: "33333333-3333-4333-8333-333333333333", make: "C", model: "Unknown", confidence: "unrated" },
    ]);
    throw new Error(`unexpected ${url}`);
  };
  const server = createGateway({ env, fetchImpl });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/genie/candidates`, { headers: { cookie: "dp_session=test-token" } });
  assert.equal(response.status, 200);
  const [candidate, high, low, unknown] = await response.json();
  assert.equal(candidate.vehicleClass, "truck");
  assert.deepEqual(candidate.sourceUrls, ["https://example.com/evidence"]);
  assert.equal(candidate.confidence, 0.7);
  assert.equal(high.confidence, 0.95);
  assert.equal(low.confidence, 0.4);
  assert.equal(unknown.confidence, null);
  assert.equal(candidate.requestedRuns[0].generationId, "job-7");
  assert.equal("raw_response" in candidate, false);
});

test("GENIE validation records exact six surfaces and evidence before database auto-resume", async (t) => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    if (String(url).endsWith("/rpc/validate_designpro_vehicle_spec_universal")) return Response.json({ validated: true, resumedRuns: 1 });
    throw new Error(`unexpected ${url}`);
  };
  const server = createGateway({ env, fetchImpl });
  t.after(() => server.close());
  const base = await listen(server);
  const surfaces = Object.fromEntries(["driver", "passenger", "hood", "roof", "front", "rear"].map((key, index) => [key, { widthInches: 100 + index, heightInches: 50 + index }]));
  const response = await fetch(`${base}/api/genie/candidates/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/validate`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({ surfaces, evidence: { sourceReviewed: true, sourceUrlsReviewed: true, operatorAttestation: true }, notes: "Verified against OEM body guide." }),
  });
  assert.equal(response.status, 200);
  const validation = calls.find((call) => call.url.endsWith("/rpc/validate_designpro_vehicle_spec_universal"));
  const payload = JSON.parse(validation.init.body);
  assert.equal(payload.p_validated_surfaces.contractVersion, "designpro.genie-validated-surfaces.v1");
  assert.deepEqual(Object.keys(payload.p_validated_surfaces).sort(), ["contractVersion", "surfaces"].sort());
  assert.deepEqual(Object.keys(payload.p_validated_surfaces.surfaces).sort(), ["driver", "passenger", "hood", "roof", "front", "rear"].sort());
  assert.equal(payload.p_validated_surfaces.surfaces.driver.widthInches, 100);
  assert.equal(payload.p_evidence.operatorAttestation, true);
  assert.equal(payload.p_evidence.contractVersion, "designpro.genie-validation-evidence.v1");
  assert.equal(payload.p_notes, "Verified against OEM body guide.");
});

test("revision source cannot silently freeze a zero-logo expectation", () => {
  const source = readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
  assert.match(source, /logoInventoryAttestation/);
  assert.match(source, /logo_inventory_attestation_required/);
  assert.match(source, /logo_inventory_attestation_mismatch/);
  assert.match(source, /expected_logo_placement_invalid/);
  assert.match(source, /attestation\.mode !== "none"/);
  assert.match(source, /attestation\.mode !== "listed"/);
  assert.match(source, /VEHICLE_CLASSES\.includes/);
  assert.doesNotMatch(source, /"box-truck"/);
});

test("recipient registration is same-origin, operator-bound, and mediated only through the internal runtime", async (t) => {
  const operatorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const customerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const verificationReference = "WPW-PAID-2026-0042";
  const verificationRefHash = createHash("sha256").update(verificationReference, "utf8").digest("hex");
  const workerSecret = "s".repeat(48);
  const calls = [];
  const server = createGateway({
    env: {
      ...env,
      NODE_ENV: "production",
      DESIGNPRO_APP_ORIGIN: "https://os.designproai.com",
      DESIGNPRO_RUNTIME_INTERNAL_URL: "http://runtime-1:3001",
      WORKER_SECRET: workerSecret,
    },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: operatorId, email: "operator@designproai.com" });
      if (String(url) === "http://runtime-1:3001/internal/wrapbox/recipient") {
        assert.equal(init.headers.authorization, `Bearer ${workerSecret}`);
        assert.deepEqual(JSON.parse(init.body), {
          operatorId,
          customerEmail: "verified.customer@example.com",
          customerReference: "Verified Fleet Customer",
          verificationRefHash,
          orderNumber: "ORDER-2026-0042",
        });
        return Response.json({
          customerId,
          customerEmail: "verified.customer@example.com",
          recipientIdentityHash: "e".repeat(64),
          orderNumber: "ORDER-2026-0042",
          emailVerifiedAt: "2026-08-06T19:00:00.000Z",
          idempotent: true,
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/wrapbox/recipients/register`, {
    method: "POST",
    headers: {
      cookie: "dp_session=test-token",
      origin: "https://os.designproai.com",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      customerEmail: " Verified.Customer@Example.com ",
      customerReference: "Verified Fleet Customer",
      verificationReference,
      orderNumber: "ORDER-2026-0042",
      designName: "Verified Porsche wrap",
    }),
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.deepEqual(payload.delivery, {
    contractVersion: "designpro.wrapbox-recipient.v1",
    customerId,
    customerEmail: "verified.customer@example.com",
    recipientIdentityHash: "e".repeat(64),
    orderNumber: "ORDER-2026-0042",
    designName: "Verified Porsche wrap",
  });
  assert.equal(Object.keys(payload.delivery).length, 6);
  assert.equal(calls.some((call) => call.url.includes("/rest/v1/rpc/register_designpro")), false);
});

test("WrapBox list returns immutable metadata and detail signs only its exact ZIP and manifest for 300 seconds", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const packId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const row = {
    id: packId,
    run_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    revision_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    entice_pack_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    design_id: "DID-EEEEEEEE",
    order_number: "ORDER-2026-0042",
    design_name: "Porsche production wrap",
    zip_storage_path: `wrapbox/user_${userId}/${packId}/production.zip`,
    zip_content_hash: "1".repeat(64),
    zip_byte_size: 9_000_000_000,
    manifest_storage_path: `wrapbox/user_${userId}/${packId}/manifest.json`,
    manifest_content_hash: "2".repeat(64),
    manifest_byte_size: 8192,
    logo_inventory: [],
    ready_at: "2026-08-06T20:00:00.000Z",
  };
  const signed = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: userId, email: "customer@example.com" });
      if (value.includes("/rest/v1/designpro_wrapbox_packs?")) return Response.json([row]);
      if (value.includes("/storage/v1/object/sign/wrap-files/")) {
        const path = decodeURIComponent(value.split("/storage/v1/object/sign/wrap-files/")[1]);
        signed.push({ path, body: JSON.parse(init.body) });
        return Response.json({ signedURL: `/object/sign/wrap-files/${encodeURIComponent(path)}?token=short` });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const list = await fetch(`${base}/api/wrapbox`, { headers: { cookie: "dp_session=test-token" } });
  assert.equal(list.status, 200);
  const [listed] = await list.json();
  assert.equal(listed.designName, row.design_name);
  assert.equal(listed.designId, row.design_id);
  assert.equal(listed.orderNumber, row.order_number);
  assert.equal("signedUrl" in listed.zip, false);

  const detail = await fetch(`${base}/api/wrapbox/${packId}`, { headers: { cookie: "dp_session=test-token" } });
  assert.equal(detail.status, 200);
  const pack = await detail.json();
  assert.equal(pack.zip.expiresIn, 300);
  assert.equal(pack.manifest.expiresIn, 300);
  assert.deepEqual(signed, [
    { path: row.zip_storage_path, body: { expiresIn: 300 } },
    { path: row.manifest_storage_path, body: { expiresIn: 300 } },
  ]);
});

test("revision accepts one frozen logo identity on distinct target surfaces with composite placement keys", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const revisionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const bytesByPath = new Map();
  const renderAssets = {};
  for (const key of ["driver", "passenger", "hood", "roof", "front", "rear", "hero3d"]) {
    const bytes = Buffer.from(`view-${key}`);
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const storagePath = `users/${userId}/revisions/${revisionId}/inputs/${key}/${contentHash}.png`;
    bytesByPath.set(storagePath, bytes);
    renderAssets[key] = { storagePath, contentHash, byteSize: bytes.byteLength, contentType: "image/png" };
  }
  const logoBytes = Buffer.from("same-exact-logo-bytes");
  const logoHash = createHash("sha256").update(logoBytes).digest("hex");
  const logoPath = `users/${userId}/revisions/${revisionId}/inputs/logo/${logoHash}.png`;
  bytesByPath.set(logoPath, logoBytes);
  const identityKey = `logo-${logoHash.slice(0, 24)}`;
  const expectedLogoInventory = ["driver", "passenger"].map((surfaceKey) => ({
    placementKey: `${identityKey}@${surfaceKey}`,
    identityKey,
    displayName: "Frozen Sponsor",
    surfaceKey,
    storagePath: logoPath,
    contentHash: logoHash,
    byteSize: logoBytes.byteLength,
    contentType: "image/png",
  }));
  let frozenSnapshot;
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: userId });
      if (value.includes("/storage/v1/object/wrap-files/")) {
        const path = decodeURIComponent(value.split("/storage/v1/object/wrap-files/")[1]);
        const bytes = bytesByPath.get(path);
        return bytes ? new Response(bytes, { headers: { "content-type": "image/png" } }) : new Response("missing", { status: 404 });
      }
      if (value.endsWith("/rpc/save_designpro_revision_source")) {
        frozenSnapshot = JSON.parse(init.body).p_snapshot;
        return Response.json({ snapshotHash: "a".repeat(64) });
      }
      if (value.endsWith("/rpc/create_designpro_entice_workflow")) return Response.json({ workflowRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/revisions`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({
      revisionId,
      generationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      visualizationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      expectedUpdatedAt: "2026-08-06T00:00:00.000Z",
      renderAssets,
      idempotencyKey: `revision:${revisionId}`,
      revisionSnapshot: {
        contractVersion: "designpro.revision-snapshot.v1",
        vehicle: { year: "2026", make: "Porsche", model: "911", type: "car" },
        surfaceOptions: {}, finish: "standard", bodyText: "LOCKED TEXT",
        orderNumber: "ORDER-2026-0042",
        expectedLogoInventory,
        logoInventoryAttestation: { mode: "listed", attested: true },
        delivery: {
          contractVersion: "designpro.wrapbox-recipient.v1",
          customerId: "99999999-9999-4999-8999-999999999999",
          customerEmail: "customer@designproai.com",
          recipientIdentityHash: "9".repeat(64),
          orderNumber: "ORDER-2026-0042",
          designName: "Porsche 911 production wrap",
        },
      },
    }),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(frozenSnapshot.expectedLogoInventory.map((logo) => logo.placementKey), [
    `${identityKey}@driver`, `${identityKey}@passenger`,
  ]);
  assert.equal(new Set(frozenSnapshot.expectedLogoInventory.map((logo) => logo.contentHash)).size, 1);
});

test("authenticated browser can enqueue Calls 1-7 without selecting engine controls", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const generationId = "90000000-0000-4000-8000-000000000009";
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: userId });
      if (value.endsWith("/rest/v1/rpc/create_designpro_generation_request")) return Response.json({
        requestId: "10000000-0000-4000-8000-000000000001",
        generationId, state: "queued", inputHash: "a".repeat(64),
        engineContractHash: "b".repeat(64), idempotent: false,
      });
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const input = calls17Input({
    designBrief: { campaign: "Martini heritage" },
  });
  const idempotencyKey = calls17Idempotency(generationId, input);
  const response = await fetch(`${base}/api/generation/requests`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({ generationId, idempotencyKey, input }),
  });
  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.equal(payload.state, "queued");
  assert.equal(payload.pipelineMode, "legacy");
  const rpcCall = calls.find((item) => item.url.endsWith("/rpc/create_designpro_generation_request"));
  assert.ok(rpcCall);
  assert.deepEqual(JSON.parse(rpcCall.init.body), {
    p_generation_id: generationId,
    p_input: input,
    p_idempotency_key: idempotencyKey,
  });
});

test("flat-first v3 opts into the isolated intake RPC without changing v1", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const generationId = "90000000-0000-4000-8000-000000000010";
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: userId });
      if (value.endsWith("/rest/v1/rpc/create_designpro_flat_first_generation_request")) {
        return Response.json({
          requestId: "10000000-0000-4000-8000-000000000010",
          generationId,
          state: "queued",
          inputHash: "a".repeat(64),
          engineContractHash: "b".repeat(64),
          idempotent: false,
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const input = flatFirstInput();
  const response = await fetch(`${base}/api/generation/requests`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({
      generationId,
      input,
      requiredPipelineMode: "flat-first-atlas-v1",
    }),
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).pipelineMode, "flat-first-atlas-v1");
  const rpcCall = calls.find((item) => item.url.endsWith("/rpc/create_designpro_flat_first_generation_request"));
  assert.ok(rpcCall);
  assert.deepEqual(JSON.parse(rpcCall.init.body), {
    p_generation_id: generationId,
    p_input: input,
    p_idempotency_key: null,
  });
  assert.equal(calls.some((item) => item.url.endsWith("/rpc/create_designpro_generation_request")), false);
});

test("flat-first v3 admits the full DesignIQ contract and exact private reference identities", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const generationId = "90000000-0000-4000-8000-000000000010";
  const logoHash = "a".repeat(64);
  const referenceHash = "b".repeat(64);
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: userId });
      if (value.endsWith("/rest/v1/rpc/create_designpro_flat_first_generation_request")) {
        return Response.json({
          requestId: "10000000-0000-4000-8000-000000000010",
          generationId, state: "queued", inputHash: "a".repeat(64),
          engineContractHash: "b".repeat(64), idempotent: false,
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const input = flatFirstInput({
    companyName: "Flamingo Pools", businessName: "Flamingo Pools", phone: "(602) 555-0184",
    website: "https://flamingopools.example", industry: "pool construction",
    colors: ["turquoise", "coral"], style: "premium dimensional", finish: "satin",
    substrate: "color_change_film", mascot: "pink flamingo", bulletPoints: ["luxury pools"],
    brandColors: "turquoise, coral, white", fontStyle: "condensed sans",
    qrEnabled: true, qrUrl: "https://flamingopools.example/quote",
    visionboardIntent: "exact_reference", styleDescriptors: "editorial photography",
    textLayerPrompt: "Exact tagline: Desert Luxury",
    logoAsset: {
      storagePath: `users/${userId}/revisions/${generationId}/inputs/logo/${logoHash}.png`,
      contentHash: logoHash, byteSize: 100, contentType: "image/png",
    },
    visionBoardImages: [{
      storagePath: `users/${userId}/revisions/${generationId}/inputs/attachment/${referenceHash}.webp`,
      contentHash: referenceHash, byteSize: 200, contentType: "image/webp",
    }],
  });
  const response = await fetch(`${base}/api/generation/requests`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({ generationId, input, requiredPipelineMode: "flat-first-atlas-v1" }),
  });
  assert.equal(response.status, 202);
  const rpcCall = calls.find((item) => item.url.endsWith("/rpc/create_designpro_flat_first_generation_request"));
  assert.deepEqual(JSON.parse(rpcCall.init.body).p_input, input);
});

test("flat-first v3 refuses reference URLs, extra identity keys, wrong owners and TIFF", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherUser = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const generationId = "90000000-0000-4000-8000-000000000010";
  const otherRevision = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const hash = "a".repeat(64);
  const baseAsset = {
    storagePath: `users/${userId}/revisions/${generationId}/inputs/attachment/${hash}.png`,
    contentHash: hash, byteSize: 100, contentType: "image/png",
  };
  const invalidAssets = [
    { ...baseAsset, signedUrl: "https://example.invalid/temporary" },
    { ...baseAsset, storagePath: baseAsset.storagePath.replace(userId, otherUser) },
    { ...baseAsset, storagePath: baseAsset.storagePath.replace(generationId, otherRevision) },
    { ...baseAsset, contentType: "image/tiff", storagePath: baseAsset.storagePath.replace(/\.png$/, ".tiff") },
    { ...baseAsset, contentHash: hash.toUpperCase() },
  ];
  for (const asset of invalidAssets) {
    const calls = [];
    const server = createGateway({
      env,
      fetchImpl: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: userId });
        throw new Error(`unexpected ${url}`);
      },
    });
    t.after(() => server.close());
    const base = await listen(server);
    const response = await fetch(`${base}/api/generation/requests`, {
      method: "POST",
      headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
      body: JSON.stringify({
        generationId,
        input: flatFirstInput({ visionBoardImages: [asset], visionboardIntent: "exact_reference" }),
        requiredPipelineMode: "flat-first-atlas-v1",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(calls.some((item) => item.url.includes("/rest/v1/rpc/")), false);
  }
});

test("Calls 1-7 rejects PDF logos and values the database contract rejects", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const generationId = "90000000-0000-4000-8000-000000000010";
  const hash = "a".repeat(64);
  const invalidInputs = [
    flatFirstInput({ phone: "" }),
    flatFirstInput({ website: "bad\nvalue.example" }),
    flatFirstInput({ colors: [" "] }),
    flatFirstInput({
      logoAsset: {
        storagePath: `users/${userId}/revisions/${generationId}/inputs/logo/${hash}.pdf`,
        contentHash: hash, byteSize: 100, contentType: "application/pdf",
      },
    }),
  ];
  for (const input of invalidInputs) {
    const calls = [];
    const server = createGateway({
      env,
      fetchImpl: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: userId });
        throw new Error(`unexpected ${url}`);
      },
    });
    t.after(() => server.close());
    const base = await listen(server);
    const response = await fetch(`${base}/api/generation/requests`, {
      method: "POST",
      headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
      body: JSON.stringify({ generationId, input, requiredPipelineMode: "flat-first-atlas-v1" }),
    });
    assert.equal(response.status, 400);
    assert.equal(calls.some((item) => item.url.includes("/rest/v1/rpc/")), false);
  }
});

test("flat-first v3 refuses a misspelled mode, fulfillment identity, extras, and engine controls", async (t) => {
  const invalidInputs = [
    flatFirstInput({ pipelineMode: "flat_first_v1" }),
    flatFirstInput({ orderNumber: "DP-1" }),
    flatFirstInput({ experimental: true }),
    flatFirstInput({ nested: { seed: 7 } }),
  ];
  for (const input of invalidInputs) {
    const calls = [];
    const server = createGateway({
      env,
      fetchImpl: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/auth/v1/user")) {
          return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    t.after(() => server.close());
    const base = await listen(server);
    const response = await fetch(`${base}/api/generation/requests`, {
      method: "POST",
      headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
      body: JSON.stringify({
        generationId: "90000000-0000-4000-8000-000000000010",
        input,
        requiredPipelineMode: "flat-first-atlas-v1",
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "generation_request_invalid" });
    assert.equal(calls.some((item) => item.url.includes("/rest/v1/rpc/")), false);
  }
});

test("flat-first v3 fails before intake when its required envelope is missing or mismatched", async (t) => {
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) {
        return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  for (const body of [
    { generationId: crypto.randomUUID(), input: flatFirstInput() },
    {
      generationId: crypto.randomUUID(),
      input: flatFirstInput(),
      requiredPipelineMode: "legacy",
    },
  ]) {
    const response = await fetch(`${base}/api/generation/requests`, {
      method: "POST",
      headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(calls.some((item) => item.url.includes("/rest/v1/rpc/")), false);
});

test("Calls 1-7 enqueue rejects nested prompt, model, seed, and view controls before RPC", async (t) => {
  for (const forbidden of [
    { prompt: "override" }, { nested: { image_model: "override" } },
    { options: [{ seed: 12 }] }, { camera_angles: ["invented"] },
  ]) {
    const calls = [];
    const server = createGateway({
      env,
      fetchImpl: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
        throw new Error(`unexpected ${url}`);
      },
    });
    t.after(() => server.close());
    const base = await listen(server);
    const input = calls17Input(forbidden);
    const response = await fetch(`${base}/api/generation/requests`, {
      method: "POST",
      headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
      body: JSON.stringify({
        generationId: "90000000-0000-4000-8000-000000000009",
        idempotencyKey: calls17Idempotency(
          "90000000-0000-4000-8000-000000000009", input,
        ),
        input,
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "generation_request_invalid" });
    assert.equal(calls.some((item) => item.url.includes("/rest/v1/rpc/")), false);
  }
});

test("Calls 1-7 enqueue rejects missing or null registered order identity before RPC", async (t) => {
  const missingOrder = calls17Input();
  delete missingOrder.orderNumber;
  const nullRecipientHash = calls17Input();
  nullRecipientHash.delivery.recipientIdentityHash = null;
  const changedDeliveryOrder = calls17Input();
  changedDeliveryOrder.delivery.orderNumber = "DP-9002";
  for (const input of [missingOrder, nullRecipientHash, changedDeliveryOrder]) {
    const calls = [];
    const server = createGateway({
      env,
      fetchImpl: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/auth/v1/user")) return Response.json({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", is_anonymous: false,
        });
        throw new Error(`unexpected ${url}`);
      },
    });
    t.after(() => server.close());
    const base = await listen(server);
    const response = await fetch(`${base}/api/generation/requests`, {
      method: "POST",
      headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
      body: JSON.stringify({
        generationId: "90000000-0000-4000-8000-000000000009",
        idempotencyKey: "calls17:invalid",
        input,
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "generation_request_invalid" });
    assert.equal(calls.some((item) => item.url.includes("/rest/v1/rpc/")), false);
  }
});

test("Calls 1-7 routes are inaccessible without the HttpOnly session", async (t) => {
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/auth/v1/user")) return new Response("{}", { status: 401 });
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/10000000-0000-4000-8000-000000000001`);
  assert.equal(response.status, 401);
  assert.equal(calls.some((item) => item.url.includes("designpro_generation_")), false);
});

test("Supabase anonymous Auth users cannot enqueue Calls 1-7", async (t) => {
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/auth/v1/user")) return Response.json({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", is_anonymous: true,
      });
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests`, {
    method: "POST",
    headers: { cookie: "dp_session=anonymous-token", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
  assert.equal(calls.some((item) => item.url.includes("/rest/v1/rpc/")), false);
});

test("generation status returns private immutable identities without signing objects", async (t) => {
  const requestId = "10000000-0000-4000-8000-000000000001";
  const generationId = "90000000-0000-4000-8000-000000000009";
  const contentHash = "c".repeat(64);
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      if (value.endsWith("/rest/v1/rpc/get_designpro_generation_request")) return Response.json({
        requestId, generationId, state: "outputs_ready",
        inputHash: "a".repeat(64), engineContractHash: "b".repeat(64),
        attempt: 1, outputSetHash: "d".repeat(64), failureCode: null,
        createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:01:00Z",
        completedAt: "2026-08-08T00:01:00Z", handoffReady: false,
        handoffBlocker: "source_close_up_has_no_verified_hero3d_role_mapping",
        views: [{
          sourceViewType: "side", consumerRole: "driver", contentHash,
          byteSize: 100, contentType: "image/png", createdAt: "2026-08-08T00:01:00Z",
        }],
      });
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/${requestId}`, {
    headers: { cookie: "dp_session=test-token" },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.requestId, requestId);
  assert.equal(payload.handoffReady, false);
  assert.equal(payload.handoffBlocker, "source_close_up_has_no_verified_hero3d_role_mapping");
  assert.equal("storagePath" in payload.views[0], false);
  assert.equal("error" in payload, false);
  assert.equal(payload.failureCode, null);
  assert.equal("signedUrl" in payload.views[0], false);
  assert.equal("engineContract" in payload, false);
  assert.equal(calls.some((item) => item.url.includes("/rest/v1/designpro_generation_")), false);
  assert.equal(calls.some((item) => item.url.includes("/storage/v1/object/sign/")), false);
});

test("flat atlas lineage signs before and after previews without returning storage paths", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const requestId = "10000000-0000-4000-8000-000000000010";
  const generationId = "90000000-0000-4000-8000-000000000010";
  const guideHash = "1".repeat(64);
  const manifestHash = "2".repeat(64);
  const masterHash = "3".repeat(64);
  const projectionHash = "4".repeat(64);
  const guidePath = `designpro/user_${userId}/${generationId}/flat-first/v1/guide/${guideHash}.png`;
  const masterPath = `designpro/user_${userId}/${generationId}/flat-first/v1/revisions/1/master/${masterHash}.png`;
  const projectionPath = `designpro/user_${userId}/${generationId}/flat-first/v1/revisions/1/projection/${projectionHash}.jpg`;
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: userId });
      if (value.endsWith("/rest/v1/rpc/designpro_flat_atlas_revision_paths")) {
        return Response.json([{
          id: "40000000-0000-4000-8000-000000000001",
          requestId,
          generationId,
          parentRevisionId: null,
          revisionSequence: 1,
          guideStoragePath: guidePath,
          guideContentHash: guideHash,
          guideByteSize: 900,
          guideContentType: "image/png",
          manifestContentHash: manifestHash,
          manifestByteSize: 500,
          manifestContentType: "application/json",
          masterStoragePath: masterPath,
          masterContentHash: masterHash,
          masterByteSize: 1500,
          masterContentType: "image/png",
          projectionStoragePath: projectionPath,
          projectionContentHash: projectionHash,
          projectionByteSize: 1100,
          projectionContentType: "image/jpeg",
          affectedSurfaces: ["driver", "passenger", "hood", "roof", "front", "rear"],
          instruction: null,
          productionEligible: false,
          model: "gemini-3-pro-image-preview",
          promptVersion: "flat-atlas-v1",
          widthPx: 4096,
          heightPx: 4096,
          effectivePpi: 26.77,
          panelMap: flatFirstPanelMap(),
          exampleUsed: false,
          exampleGuideHash: null,
          exampleMasterHash: null,
          createdAt: "2026-08-20T16:00:00Z",
        }]);
      }
      if (value.includes("/storage/v1/object/sign/wrap-files/")) {
        return Response.json({ signedURL: `/object/sign/wrap-files/preview?token=${value.includes("guide") ? "guide" : "master"}` });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/${requestId}/atlas`, {
    headers: { cookie: "dp_session=test-token" },
  });
  assert.equal(response.status, 200);
  const [revision] = await response.json();
  assert.equal(revision.revisionSequence, 1);
  assert.equal(revision.guide.contentHash, guideHash);
  assert.equal(revision.master.contentHash, masterHash);
  assert.deepEqual(revision.projection, {
    contentHash: projectionHash,
    contentType: "image/jpeg",
    byteSize: 1100,
  });
  assert.deepEqual(revision.panelMap.map((panel) => panel.surfaceKey), [
    "driver", "passenger", "hood", "roof", "front", "rear",
  ]);
  assert.deepEqual(revision.panelMap[0].bleedIn, {
    top: 5, right: 5, bottom: 5, left: 5,
  });
  assert.equal(revision.panelMap[0].surfaceSqFt, 59.5);
  assert.equal(revision.panelMap[0].x, 3000);
  assert.equal("internal" in revision.panelMap[0], false);
  assert.match(revision.guideUrl, /token=guide$/);
  assert.match(revision.masterUrl, /token=master$/);
  assert.equal(revision.expiresIn, 300);
  assert.equal("guideStoragePath" in revision, false);
  assert.equal("masterStoragePath" in revision, false);
  assert.equal("projectionStoragePath" in revision, false);
  assert.equal(JSON.stringify(revision).includes(guidePath), false);
  assert.equal(JSON.stringify(revision).includes(masterPath), false);
  assert.equal(JSON.stringify(revision).includes(projectionPath), false);
});

test("flat atlas lineage rejects invalid or cross-revision immutable artifacts before signing", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const requestId = "10000000-0000-4000-8000-000000000010";
  const generationId = "90000000-0000-4000-8000-000000000010";
  const invalidRows = [
    { projectionContentType: "image/png" },
    {
      projectionStoragePath: `designpro/user_${userId}/${generationId}`
        + `/flat-first/v1/revisions/2/projection/${"4".repeat(64)}.jpg`,
    },
    {
      masterStoragePath: `designpro/user_${userId}/${generationId}`
        + `/flat-first/v1/revisions/2/master/${"3".repeat(64)}.png`,
    },
  ];
  for (const invalid of invalidRows) {
    const calls = [];
    const server = createGateway({
      env,
      fetchImpl: async (url, init = {}) => {
        const value = String(url);
        calls.push({ url: value, init });
        if (value.endsWith("/auth/v1/user")) return Response.json({ id: userId });
        if (value.endsWith("/rest/v1/rpc/designpro_flat_atlas_revision_paths")) {
          return Response.json([{
            ...flatFirstAtlasRpcRow({ userId, requestId, generationId }),
            ...invalid,
          }]);
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    t.after(() => server.close());
    const base = await listen(server);
    const response = await fetch(`${base}/api/generation/requests/${requestId}/atlas`, {
      headers: { cookie: "dp_session=test-token" },
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "flat_atlas_response_invalid" });
    assert.equal(calls.some((item) => item.url.includes("/storage/v1/object/sign/")), false);
  }
});

test("flat atlas panel schedule rejects incomplete, duplicate, non-five-inch, and invalid crop geometry", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const requestId = "10000000-0000-4000-8000-000000000010";
  const generationId = "90000000-0000-4000-8000-000000000010";
  const invalidMaps = [];
  invalidMaps.push(flatFirstPanelMap().slice(0, 5));
  {
    const panels = flatFirstPanelMap();
    panels[1].surfaceKey = "driver";
    invalidMaps.push(panels);
  }
  {
    const panels = flatFirstPanelMap();
    panels[0].bleedIn.right = 4;
    invalidMaps.push(panels);
  }
  {
    const panels = flatFirstPanelMap();
    panels[0].printWidthIn = 164;
    invalidMaps.push(panels);
  }
  {
    const panels = flatFirstPanelMap();
    delete panels[0].h;
    invalidMaps.push(panels);
  }
  {
    const panels = flatFirstPanelMap();
    panels[0].x = 4000;
    invalidMaps.push(panels);
  }

  for (const panelMap of invalidMaps) {
    const calls = [];
    const server = createGateway({
      env,
      fetchImpl: async (url, init = {}) => {
        const value = String(url);
        calls.push({ url: value, init });
        if (value.endsWith("/auth/v1/user")) return Response.json({ id: userId });
        if (value.endsWith("/rest/v1/rpc/designpro_flat_atlas_revision_paths")) {
          return Response.json([flatFirstAtlasRpcRow({
            userId, requestId, generationId, panelMap,
          })]);
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    t.after(() => server.close());
    const base = await listen(server);
    const response = await fetch(`${base}/api/generation/requests/${requestId}/atlas`, {
      headers: { cookie: "dp_session=test-token" },
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "flat_atlas_panel_map_invalid" });
    assert.equal(calls.some((item) => item.url.includes("/storage/v1/object/sign/")), false);
  }
});

test("flat atlas lineage returns the same 404 for an absent or other-owner request", async (t) => {
  const server = createGateway({
    env,
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/auth/v1/user")) {
        return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      }
      if (value.endsWith("/rest/v1/rpc/designpro_flat_atlas_revision_paths")) {
        return Response.json(null);
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/10000000-0000-4000-8000-000000000010/atlas`, {
    headers: { cookie: "dp_session=test-token" },
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "generation_request_not_found" });
});

test("flat-first handoff fails closed until an immutable atlas revision is production eligible", async (t) => {
  const requestId = "10000000-0000-4000-8000-000000000010";
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) {
        return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      }
      if (value.endsWith("/rest/v1/rpc/designpro_flat_first_handoff_gate")) {
        return Response.json({
          flatFirst: true,
          productionEligible: false,
          revisionId: "40000000-0000-4000-8000-000000000001",
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/${requestId}/handoff`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "flat_first_production_gate_required" });
  assert.equal(calls.some((item) => item.url.endsWith("/rpc/handoff_designpro_generation_to_production")), false);
});

test("the flat-first gate does not change legacy handoff behavior", async (t) => {
  const requestId = "10000000-0000-4000-8000-000000000001";
  const generationId = "90000000-0000-4000-8000-000000000009";
  const server = createGateway({
    env,
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/auth/v1/user")) {
        return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      }
      if (value.endsWith("/rest/v1/rpc/designpro_flat_first_handoff_gate")) {
        return Response.json({ flatFirst: false, productionEligible: true, revisionId: null });
      }
      if (value.endsWith("/rest/v1/rpc/handoff_designpro_generation_to_production")) {
        return Response.json({
          revisionId: "50000000-0000-4000-8000-000000000001",
          generationId,
          workflowRunId: "60000000-0000-4000-8000-000000000001",
          alreadyHandedOff: false,
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/${requestId}/handoff`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).generationId, generationId);
});

test("a flat-first view instruction is rejected because edits require a new atlas revision", async (t) => {
  const requestId = "10000000-0000-4000-8000-000000000010";
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) {
        return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      }
      if (value.endsWith("/rest/v1/rpc/designpro_flat_first_handoff_gate")) {
        return Response.json({
          flatFirst: true,
          productionEligible: false,
          revisionId: "40000000-0000-4000-8000-000000000001",
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/${requestId}/views/side/regenerate`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: JSON.stringify({ instruction: "Make the driver logo larger" }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "flat_first_atlas_revision_required" });
  assert.equal(calls.some((item) => item.url.endsWith("/rpc/regenerate_designpro_generation_slot")), false);
});

test("an instructionless flat-first view retry reuses the same atlas", async (t) => {
  const requestId = "10000000-0000-4000-8000-000000000010";
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) {
        return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      }
      if (value.endsWith("/rest/v1/rpc/designpro_flat_first_handoff_gate")) {
        return Response.json({
          flatFirst: true,
          productionEligible: false,
          revisionId: "40000000-0000-4000-8000-000000000001",
        });
      }
      if (value.endsWith("/rest/v1/rpc/regenerate_designpro_generation_slot")) {
        return Response.json({
          requestId,
          sourceViewType: "side",
          consumerRole: "driver",
          supersededViews: 1,
          state: "queued",
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/${requestId}/views/side/regenerate`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 202);
  const retry = calls.find((item) => item.url.endsWith("/rpc/regenerate_designpro_generation_slot"));
  assert.equal(JSON.parse(retry.init.body).p_instruction, null);
});

test("a view can be regenerated without mutating the accepted one", async (t) => {
  const requestId = "10000000-0000-4000-8000-000000000002";
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      if (value.endsWith("/rest/v1/rpc/designpro_flat_first_handoff_gate")) {
        return Response.json({ flatFirst: false, productionEligible: true, revisionId: null });
      }
      if (value.endsWith("/rest/v1/rpc/regenerate_designpro_generation_slot")) {
        return Response.json({
          requestId, sourceViewType: "hero-3d", consumerRole: "hero3d",
          supersededViews: 1, state: "queued",
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/${requestId}/views/hero-3d/regenerate`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json", origin: env.DESIGNPRO_APP_ORIGIN },
    body: JSON.stringify({ instruction: "bolder lettering" }),
  });
  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.equal(payload.sourceViewType, "hero-3d");
  assert.equal(payload.consumerRole, "hero3d");
  assert.equal(payload.supersededViews, 1);
  // The instruction is carried to the server, never turned into a browser prompt.
  const rpcCall = calls.find((item) => item.url.includes("regenerate_designpro_generation_slot"));
  assert.equal(JSON.parse(rpcCall.init.body).p_instruction, "bolder lettering");
});

test("a view outside the frozen plan cannot be regenerated", async (t) => {
  const server = createGateway({
    env,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/10000000-0000-4000-8000-000000000002/views/spoiler/regenerate`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json", origin: env.DESIGNPRO_APP_ORIGIN },
    body: "{}",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "generation_view_not_in_plan" });
});
