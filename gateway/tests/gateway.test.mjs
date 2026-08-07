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
