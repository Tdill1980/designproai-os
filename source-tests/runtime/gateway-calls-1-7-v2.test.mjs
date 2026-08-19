/**
 * CALLS 1-7 ARE DESIGN-FIRST.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * A customer could not start a design without already having an order. The
 * gateway demanded input.orderNumber and a three-key delivery object carrying
 * a recipientIdentityHash, and the database additionally demanded an
 * already-confirmed operator/customer/order binding. Design generation was
 * gated on fulfillment identity that does not exist yet when someone is still
 * deciding what their wrap should look like.
 *
 * The contract is the other way round: Calls 1-7 need an authenticated user, a
 * generationId, a vehicle, a brief and optionally a verified logo. Order and
 * WrapBox recipient bind later, at paid fulfillment.
 *
 * ── WHAT THESE TESTS HOLD ──────────────────────────────────────────────────
 * · a v2 request with no order and no recipient reaches the database;
 * · fulfillment identity in a v2 request is REFUSED, not ignored -- otherwise
 *   the two contracts blur and the design path quietly reacquires the
 *   dependency this removed;
 * · v1 still works exactly as before, order and all;
 * · the client does not have to send an idempotency key, because it cannot
 *   canonicalize jsonb the way Postgres does and a guess is only a way to be
 *   wrong;
 * · a generationId already carrying a different brief answers 409, not 400. A
 *   400 reads as "you typed something wrong" and invites the same call again;
 *   409 says the id is taken and a new one must be minted. Every Call 8 proof
 *   region and Call 9 panel points back at that id, so two designs sharing one
 *   is not a retry -- it is lost provenance.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createGateway } from "../../gateway/src/server.mjs";

const APP_ORIGIN = "https://os.designproai.com";
const GENERATION_ID = "3f1b0c7e-1c2d-4a5b-8e9f-0a1b2c3d4e5f";

const ENV = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://wozyamlnygaddievzuwn.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  DESIGNPRO_APP_ORIGIN: APP_ORIGIN,
  DESIGNPRO_RUNTIME_INTERNAL_URL: "http://runtime-1:3001",
  WORKER_SECRET: "w".repeat(64),
};

const V2_INPUT = {
  contractVersion: "designpro.calls-1-7-input.v2",
  vehicle: { year: "2023", make: "Ford", model: "Transit", type: "van" },
  brief: "Premium commercial wrap for Flamingo Pools, infinity-edge pool at sunset.",
  designName: "Flamingo Pools",
  mode: "commercial",
  companyName: "Flamingo Pools",
};

const SESSION_USER = { id: "9c8b7a65-4321-4321-8765-0a1b2c3d4e5f", email: "owner@example.com" };
const RPC_OK = {
  requestId: "11111111-2222-4333-8444-555555555555",
  generationId: GENERATION_ID,
  state: "queued",
  inputHash: "a".repeat(64),
  engineContractHash: "b".repeat(64),
  createdAt: "2026-08-19T18:00:00Z",
  idempotent: false,
};

/**
 * Stands in for Supabase: authenticates the session, then answers the one RPC
 * under test with whatever the case needs. Every call is recorded so a test can
 * assert on what the gateway actually forwarded rather than on its response.
 */
function upstreamFor(rpcResponse) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    if (href.includes("/auth/v1/user")) {
      return new Response(JSON.stringify(SESSION_USER), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href.includes("/rpc/create_designpro_generation_request")) {
      calls.push(JSON.parse(String(init.body || "{}")));
      return rpcResponse();
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

const ok = () => new Response(JSON.stringify(RPC_OK), { status: 200, headers: { "content-type": "application/json" } });
const conflict = () => new Response(
  JSON.stringify({ message: "generation_input_conflict" }),
  { status: 400, headers: { "content-type": "application/json" } },
);

async function post(body, rpcResponse = ok) {
  const { fetchImpl, calls } = upstreamFor(rpcResponse);
  const server = createGateway({ env: ENV, fetchImpl });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/generation/requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: APP_ORIGIN,
        cookie: "dp_session=test-session-token",
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})), calls };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("a design-first request with no order and no recipient reaches the database", async () => {
  const result = await post({ generationId: GENERATION_ID, input: V2_INPUT });
  assert.equal(result.status, 202);
  assert.equal(result.calls.length, 1, "the request never reached the RPC");
  assert.equal(result.calls[0].p_generation_id, GENERATION_ID);
  assert.equal(result.calls[0].p_input.contractVersion, "designpro.calls-1-7-input.v2");
});

test("the client does not have to send an idempotency key", async () => {
  // Node cannot reproduce Postgres's jsonb key ordering, so a client-computed
  // key is a guess. Null means "derive it", and the database does.
  const result = await post({ generationId: GENERATION_ID, input: V2_INPUT });
  assert.equal(result.status, 202);
  assert.equal(result.calls[0].p_idempotency_key, null);
});

test("fulfillment identity in a v2 request is refused, not ignored", async () => {
  for (const contaminated of [
    { ...V2_INPUT, orderNumber: "FP-1001" },
    { ...V2_INPUT, delivery: { contractVersion: "designpro.wrapbox-recipient.v1", orderNumber: "FP-1001", recipientIdentityHash: "c".repeat(64) } },
  ]) {
    const result = await post({ generationId: GENERATION_ID, input: contaminated });
    assert.equal(result.status, 400, "a v2 request carrying fulfillment identity was accepted");
    assert.equal(result.calls.length, 0, "it reached the database anyway");
  }
});

test("an unknown key is refused rather than passed through", async () => {
  const result = await post({
    generationId: GENERATION_ID,
    input: { ...V2_INPUT, seed: 42 },
  });
  assert.equal(result.status, 400);
  assert.equal(result.calls.length, 0);
});

test("a reused generationId carrying a different brief answers 409, not 400", async () => {
  const result = await post({ generationId: GENERATION_ID, input: V2_INPUT }, conflict);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "generation_input_conflict");
});

test("v1 still works exactly as before, order and all", async () => {
  const orderNumber = "FP-1001";
  const recipientIdentityHash = "c".repeat(64);
  const v1Input = {
    contractVersion: "designpro.calls-1-7-input.v1",
    orderNumber,
    delivery: { contractVersion: "designpro.wrapbox-recipient.v1", orderNumber, recipientIdentityHash },
    vehicle: V2_INPUT.vehicle,
    brief: V2_INPUT.brief,
    designName: V2_INPUT.designName,
  };
  const { createHash } = await import("node:crypto");
  const idempotencyKey = `calls17:${GENERATION_ID}:${recipientIdentityHash}:`
    + createHash("sha256").update(orderNumber, "utf8").digest("hex");
  const result = await post({ generationId: GENERATION_ID, idempotencyKey, input: v1Input });
  assert.equal(result.status, 202);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].p_idempotency_key, idempotencyKey);
});
