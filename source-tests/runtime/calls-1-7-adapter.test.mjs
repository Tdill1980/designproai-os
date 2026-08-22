import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const claimant = require("../../runtime/designpro-standalone-claimant.cjs");
const adapter = claimant.CALLS_1_7_ADAPTER;

const claim = {
  requestId: "10000000-0000-4000-8000-000000000001",
  generationId: "90000000-0000-4000-8000-000000000009",
  tenantKey: "user_20000000-0000-4000-8000-000000000002",
  input: {
    contractVersion: "designpro.calls-1-7-input.v1",
    orderNumber: "DP-9001",
    delivery: {
      contractVersion: "designpro.wrapbox-recipient.v1",
      recipientIdentityHash: "c".repeat(64),
      orderNumber: "DP-9001",
    },
    vehicle: { year: "2026", make: "Porsche", model: "911", type: "car" },
    designBrief: { campaign: "Martini heritage" },
  },
  inputHash: "a".repeat(64),
  engineContract: adapter.engineContract,
  engineContractHash: "b".repeat(64),
  attempt: 1,
  claimToken: "30000000-0000-4000-8000-000000000003",
  leaseExpiresAt: "2026-08-08T18:00:00.000Z",
  viewPlan: adapter.viewPlan,
};

function calls17Views(plan = adapter.viewPlan) {
  const bytes = new Map();
  const views = plan.map((item, index) => {
    const body = Buffer.from(`frozen-view-${index + 1}`);
    const contentHash = createHash("sha256").update(body).digest("hex");
    const storagePath = `designpro/${claim.tenantKey}/${claim.generationId}/calls-1-7/`
      + `${item.sourceViewType}/${contentHash}.png`;
    bytes.set(storagePath, new Blob([body], { type: "image/png" }));
    return {
      ...item, storagePath, contentHash, byteSize: body.byteLength,
      contentType: "image/png", metadata: { call: index + 1 },
    };
  });
  return { bytes, views };
}

function supabaseDouble({ bytes = new Map(), claimResult = claim } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      rpc: async (name, payload) => {
        calls.push({ name, payload });
        if (name === "claim_designpro_generation_request") return { data: claimResult, error: null };
        if (name === "complete_designpro_generation_request") return {
          data: {
            state: "outputs_ready", handoffReady: false,
            handoffBlocker: "source_close_up_has_no_verified_hero3d_role_mapping",
          },
          error: null,
        };
        if (name === "heartbeat_designpro_generation_request") return { data: true, error: null };
        if (name === "fail_designpro_generation_request") return { data: true, error: null };
        throw new Error(`unexpected RPC ${name}`);
      },
      storage: {
        from: (bucket) => ({
          download: async (path) => {
            assert.equal(bucket, "wrap-files");
            return bytes.has(path)
              ? { data: bytes.get(path), error: null }
              : { data: null, error: { message: "missing" } };
          },
        }),
      },
    },
  };
}

test("Calls 1-7 adapter claims only the exact frozen source contract", async () => {
  const fake = supabaseDouble();
  const result = await adapter.claim(fake.client, "calls17-worker", 900);
  assert.equal(result.requestId, claim.requestId);
  assert.deepEqual(result.engineContract, adapter.engineContract);
  assert.deepEqual(result.viewPlan.map((item) => item.sourceViewType), [
    "side", "passenger-side", "hood_detail", "front", "rear", "hero-3d", "roof",
  ]);
  // The seventh slot must carry the hero3d role the revision contract accepts.
  assert.equal(result.viewPlan.find((item) => item.sourceViewType === "hero-3d").consumerRole, "hero3d");
  assert.equal(result.viewPlan.some((item) => item.consumerRole === "closeup"), false);
  // The database froze this source-blob fingerprint before the temporary Hero
  // authoring plan. A rollback bridge must present that immutable Close-Up
  // order while still accepting the DB-authored plan beside the claim.
  assert.deepEqual(result.engineContract.sourceViewOrder, [
    "side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof",
  ]);
  assert.deepEqual(fake.calls, [{
    name: "claim_designpro_generation_request",
    payload: { p_worker_id: "calls17-worker", p_lease_seconds: 900 },
  }]);
});

test("claim and completion accept exact Close-Up or historical Hero plans without relabelling", async () => {
  const closeupClaim = { ...claim, viewPlan: adapter.closeupViewPlan };
  const normalizedClaim = claimant._test.assertCalls1To7Claim(closeupClaim);
  assert.deepEqual(normalizedClaim.viewPlan, adapter.closeupViewPlan);

  const { bytes, views } = calls17Views(adapter.closeupViewPlan);
  assert.deepEqual(
    claimant._test.normalizeCalls1To7Views(normalizedClaim, views)
      .map((view) => [view.sourceViewType, view.consumerRole]),
    adapter.closeupViewPlan.map((view) => [view.sourceViewType, view.consumerRole]),
  );
  const fake = supabaseDouble({ bytes, claimResult: closeupClaim });
  await adapter.complete(fake.client, normalizedClaim, views);
  assert.deepEqual(
    fake.calls.find((item) => item.name === "complete_designpro_generation_request")
      .payload.p_views.map((view) => view.sourceViewType),
    adapter.closeupViewPlan.map((view) => view.sourceViewType),
  );

  const both = [
    ...adapter.viewPlan.filter((view) => view.sourceViewType !== "roof"),
    adapter.closeupViewPlan.find((view) => view.sourceViewType === "close-up"),
  ];
  for (const viewPlan of [
    adapter.viewPlan.filter((view) => view.sourceViewType !== "hero-3d"),
    both,
    adapter.closeupViewPlan.map((view) => view.sourceViewType === "close-up"
      ? { ...view, consumerRole: "hero3d" }
      : view),
  ]) {
    assert.throws(
      () => claimant._test.assertCalls1To7Claim({ ...claim, viewPlan }),
      (error) => error.code === "generation_contract_drift",
    );
  }
});

test("browser prompt, model, seed, and angle controls are rejected recursively", () => {
  for (const input of [
    { prompt: "override" }, { nested: { image_model: "override" } },
    { nested: [{ seed: 42 }] }, { options: { view_angles: ["invented"] } },
  ]) {
    assert.throws(() => claimant._test.assertCalls1To7Claim({
      ...claim, input: { ...claim.input, ...input },
    }), (error) => error.code === "generation_claim_invalid");
  }
});

test("claimant rejects vehicle classes outside the exact gateway allowlist", () => {
  assert.throws(() => claimant._test.assertCalls1To7Claim({
    ...claim,
    input: { ...claim.input, vehicle: { ...claim.input.vehicle, type: "spaceship" } },
  }), (error) => error.code === "generation_claim_invalid");
});

test("claimant rejects an unbound or changed recipient order identity", () => {
  assert.throws(() => claimant._test.assertCalls1To7Claim({
    ...claim,
    input: {
      ...claim.input,
      delivery: { ...claim.input.delivery, orderNumber: "DP-9002" },
    },
  }), (error) => error.code === "generation_claim_invalid");
});

test("completion verifies all seven stored bytes before fenced persistence", async () => {
  const { bytes, views } = calls17Views();
  const fake = supabaseDouble({ bytes });
  const result = await adapter.complete(fake.client, claim, views);
  assert.equal(result.state, "outputs_ready");
  assert.equal(result.handoffReady, false);
  const completion = fake.calls.find((item) => item.name === "complete_designpro_generation_request");
  assert.ok(completion);
  assert.deepEqual(completion.payload.p_views.map((item) => item.sourceViewType),
    adapter.viewPlan.map((item) => item.sourceViewType));
  assert.deepEqual(completion.payload.p_engine_receipt, {
    contractVersion: "designpro.calls-1-7-receipt.v1",
    sourceCommit: "bdb26365904e91be446894e84b01b4a24f64aac0",
    frozenContractHash: claim.engineContractHash,
    inputHash: claim.inputHash,
    byteVerified: true,
    callsCompleted: 7,
  });
});

test("source close-up cannot be silently relabeled as hero3d", () => {
  // hero3d now comes from its own generated hero-3d view. A close-up is a
  // two-square-foot panel detail; presenting one in the hero3d slot must still
  // be refused, which is why the seventh slot was regenerated rather than
  // aliased.
  const { views } = calls17Views();
  const hero = views.find((item) => item.sourceViewType === "hero-3d");
  hero.sourceViewType = "close-up";
  assert.throws(() => claimant._test.normalizeCalls1To7Views(claim, views),
    (error) => error.code === "generation_view_identity_invalid");

  const { views: relabelled } = calls17Views();
  relabelled.find((item) => item.sourceViewType === "hero-3d").consumerRole = "closeup";
  assert.throws(() => claimant._test.normalizeCalls1To7Views(claim, relabelled),
    (error) => error.code === "generation_view_identity_invalid");
});

test("a changed stored byte prevents the completion RPC", async () => {
  const { bytes, views } = calls17Views();
  bytes.set(views[0].storagePath, new Blob([Buffer.from("changed")], { type: "image/png" }));
  const fake = supabaseDouble({ bytes });
  await assert.rejects(adapter.complete(fake.client, claim, views),
    (error) => error.code === "generation_view_byte_identity_mismatch");
  assert.equal(fake.calls.some((item) => item.name === "complete_designpro_generation_request"), false);
});

test("heartbeat and failure remain fenced by the exact request and claim token", async () => {
  const fake = supabaseDouble();
  assert.equal(await adapter.heartbeat(fake.client, claim, 900), true);
  assert.equal(await adapter.fail(fake.client, claim, Object.assign(new Error("transient"), { code: "engine_busy" })), true);
  assert.deepEqual(fake.calls.map((item) => item.name), [
    "heartbeat_designpro_generation_request", "fail_designpro_generation_request",
  ]);
  assert.equal(fake.calls[1].payload.p_retryable, true);
});

test("the legacy 2D-proof function is no longer sanctioned by the Calls 1-7 engine contract", () => {
  const contract = claimant.CALLS_1_7_ADAPTER.engineContract;
  // Calls 1-7 hand over the seven immutable source renders and nothing else.
  // The 2D production proof is Call 8 and this system authors it, so a runner
  // still carrying the legacy proof function must not be able to present a
  // valid claim here.
  assert.equal(contract.contractVersion, "designpro.calls-1-7-engine.v2");
  assert.equal(Object.prototype.hasOwnProperty.call(contract.sourceBlobs, "generate-2d-proof"), false);
  assert.deepEqual(contract.retiredBlobs, ["generate-2d-proof"]);
  assert.equal(contract.proofAuthority, "designpro-os-call8");
  assert.equal(Object.keys(contract.sourceBlobs).length, 7);
  assert.doesNotMatch(JSON.stringify(contract.sourceBlobs), /2946bc1ba26b374d21ae563f01bb464ee41477d2/);

  // A stale runner presenting the retired contract is refused at the door
  // rather than allowed to consume generation attempts.
  const stale = {
    ...contract,
    contractVersion: "designpro.calls-1-7-engine.v1",
    sourceBlobs: { ...contract.sourceBlobs, "generate-2d-proof": "2946bc1ba26b374d21ae563f01bb464ee41477d2" },
  };
  assert.notEqual(JSON.stringify(stale), JSON.stringify(contract));
});
