import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const engine = require("../../runtime/generation-engine.cjs");
const engineSource = readFileSync(new URL("../../runtime/generation-engine.cjs", import.meta.url), "utf8");

const REQUEST = "22222222-2222-4222-8222-222222222222";
const TENANT = "user_11111111-1111-4111-8111-111111111111";
// Slot paths are keyed on the generation id, not the request id:
// complete_designpro_generation_request recomputes the exact string and rejects
// the request if a single view disagrees.
const GENERATION = "33333333-3333-4333-8333-333333333333";

function makeStore(seed = {}) {
  const state = {
    accepted: new Map(seed.accepted || []),
    orphan: seed.orphan || null,
    leases: new Set(),
    leaseAcquires: 0, leaseReleases: 0,
    started: [], finished: [], failures: [], puts: [],
    leaseBusy: seed.leaseBusy === true,
  };
  return {
    state,
    async findAcceptedSlot({ sourceViewType }) { return state.accepted.get(sourceViewType) || null; },
    async findReconcilableBytes() { return state.orphan; },
    async acquireSlotLease({ sourceViewType }) {
      state.leaseAcquires += 1;
      if (state.leaseBusy) return null;
      state.leases.add(sourceViewType);
      return { token: `lease-${sourceViewType}` };
    },
    async releaseSlotLease({ sourceViewType }) { state.leaseReleases += 1; state.leases.delete(sourceViewType); },
    async recordAttemptStarted(row) { state.started.push(row); },
    async recordAttemptFinished(row) { state.finished.push(row); },
    async putImmutableBytes(row) { state.puts.push(row); },
    async persistAcceptedSlot(row) { state.accepted.set(row.sourceViewType, row); return row; },
    async markSlotFailed(row) { state.failures.push(row); },
  };
}

const okProvider = (bytes = Buffer.from("render")) => ({
  calls: 0,
  async generateImage() { this.calls += 1; return { bytes, contentType: "image/png", model: "gemini-3-pro-image-preview", keyFingerprint: "0123456789ab", attempts: [] }; },
});

const deadProvider = (status = 500) => ({
  calls: 0,
  async generateImage() {
    this.calls += 1;
    const error = new Error(`provider exhausted: HTTP ${status}`);
    error.code = "provider_exhausted";
    throw error;
  },
});

const base = { requestId: REQUEST, tenantKey: TENANT, generationId: GENERATION, sourceViewType: "side", consumerRole: "driver", promptParts: [{ text: "x" }], aspectRatio: "16:9", imageSize: "4K" };

test("THE MONEY-FURNACE TEST: a provider that fails forever costs exactly four calls", async () => {
  const provider = deadProvider(500);
  const store = makeStore();
  const result = await engine.runSlot({ ...base, provider, store });

  assert.equal(provider.calls, 4, "the provider must be called exactly the ceiling, no more");
  assert.equal(engine.MAX_PROVIDER_ATTEMPTS_PER_SLOT, 4);
  assert.equal(result.state, "failed");
  assert.equal(result.reason, "provider_attempts_exhausted");
  assert.equal(result.providerCalls, 4);
  // The lease is released, so a dead worker does not strand the slot.
  assert.equal(store.state.leaseReleases, 1);
  assert.equal(store.state.leases.size, 0);
  assert.equal(store.state.failures.length, 1, "the slot is marked failed, not left pending");
  // Every attempt left durable evidence before and after the call.
  assert.equal(store.state.started.length, 4);
  assert.equal(store.state.finished.length, 4);
  assert.ok(store.state.finished.every((row) => row.outcome === "http_error"));

  // A second reconciliation cycle must not call the provider again on its own.
  const second = await engine.runSlot({ ...base, provider, store });
  assert.equal(provider.calls, 8, "a fresh explicit run is bounded the same way");
  assert.equal(second.state, "failed");
  assert.ok(second.providerCalls <= 4, "no run may exceed the ceiling");
});

test("an accepted winner is never regenerated", async () => {
  const provider = okProvider();
  const store = makeStore({ accepted: [["side", { contentHash: "a".repeat(64), storagePath: "designpro/x/side/a.png" }]] });
  const result = await engine.runSlot({ ...base, provider, store });
  assert.equal(provider.calls, 0, "an accepted slot must cost nothing");
  assert.equal(result.state, "accepted");
  assert.equal(result.reused, true);
  assert.equal(store.state.leaseAcquires, 0, "no lease is even taken for settled work");
});

test("a crash between upload and commit reconciles from storage, not from the provider", async () => {
  const bytes = Buffer.from("already-uploaded");
  const contentHash = engine._test.sha256(bytes);
  const provider = okProvider();
  const store = makeStore({ orphan: { bytes, contentHash, storagePath: `designpro/x/side/${contentHash}.png`, contentType: "image/png" } });
  const result = await engine.runSlot({ ...base, provider, store });
  assert.equal(provider.calls, 0, "real bytes must never be paid for twice");
  assert.equal(result.state, "accepted");
  assert.equal(result.reconciled, true);
  assert.equal(store.state.accepted.get("side").contentHash, contentHash);
});

test("orphaned bytes whose hash does not verify are not adopted", async () => {
  const provider = okProvider();
  const store = makeStore({ orphan: { bytes: Buffer.from("tampered"), contentHash: "f".repeat(64), storagePath: "designpro/x/side/f.png", contentType: "image/png" } });
  const result = await engine.runSlot({ ...base, provider, store });
  assert.equal(result.state, "accepted");
  assert.equal(result.reconciled, undefined, "a hash mismatch must fall through to a real generation");
  assert.equal(provider.calls, 1);
});

test("semantic rejection is bounded at two regenerations, not retried forever", async () => {
  const provider = okProvider();
  const store = makeStore();
  const result = await engine.runSlot({
    ...base, sourceViewType: "passenger-side", consumerRole: "passenger", provider, store,
    // Stands in for the passenger text-direction check: the render is
    // structurally fine but reads backwards, which no hash could reveal.
    validate: async () => ({ accepted: false, code: "text_mirrored", reason: "lettering reads right-to-left" }),
  });
  assert.equal(provider.calls, engine.MAX_SLOT_REGENERATIONS, "regeneration stops at the ceiling, well inside the provider ceiling");
  assert.equal(result.state, "failed");
  assert.equal(result.reason, "semantic_review_required");
  assert.ok(store.state.finished.every((row) => row.outcome === "rejected"));
  assert.ok(store.state.finished.every((row) => row.errorCode === "text_mirrored"));
});

test("a slot already leased by another worker is left alone", async () => {
  const provider = okProvider();
  const store = makeStore({ leaseBusy: true });
  const result = await engine.runSlot({ ...base, provider, store });
  assert.equal(result.state, "leased_elsewhere");
  assert.equal(provider.calls, 0, "two workers must not generate the same driver at once");
});

test("the lease is released even when the store throws mid-slot", async () => {
  const provider = okProvider();
  const store = makeStore();
  store.persistAcceptedSlot = async () => { throw new Error("db died"); };
  await assert.rejects(() => engine.runSlot({ ...base, provider, store }), /db died/);
  assert.equal(store.state.leaseReleases, 1, "a throw must not strand the lease");
});

test("every attempt records the full metric set", async () => {
  const provider = okProvider();
  const store = makeStore();
  await engine.runSlot({ ...base, provider, store });
  const row = store.state.finished[0];
  for (const field of ["requestId", "sourceViewType", "attempt", "model", "keyFingerprint", "durationMs", "outcome", "winnerHash"]) {
    assert.ok(field in row, `attempt record is missing ${field}`);
  }
  assert.equal(row.outcome, "accepted");
  assert.match(row.winnerHash, /^[0-9a-f]{64}$/);
  assert.equal(typeof row.durationMs, "number");
  assert.equal(store.state.started.length, 1, "the started row is written before the call");
});

test("a whole request is budget-capped and never left pending", async () => {
  const provider = deadProvider();
  const store = makeStore();
  const result = await engine.runRequest({
    ...base, provider, store,
    slots: [
      { sourceViewType: "side", consumerRole: "driver" },
      { sourceViewType: "passenger-side", consumerRole: "passenger" },
    ],
  });
  assert.equal(result.providerCalls, 8, "two slots x four attempts, and not one more");
  assert.equal(result.budget, 8);
  assert.equal(result.state, "failed", "a request whose slots failed is failed, not pending");
  assert.equal(result.requiresExplicitResume, true, "nothing auto-restarts it");
  assert.equal(store.state.failures.length, 2);
});

test("the engine contains no unbounded loop and no recursion", () => {
  const body = engineSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  assert.doesNotMatch(body, /while\s*\(\s*true\s*\)/, "no while(true)");
  assert.doesNotMatch(body, /for\s*\(\s*;\s*;\s*\)/, "no for(;;)");
  assert.doesNotMatch(body, /setInterval|setTimeout\([^)]*runSlot/, "no self-scheduling retry");
  // runSlot must not call itself. Slice past its own signature so the
  // declaration is not mistaken for a call.
  const declaration = body.indexOf("async function runSlot");
  const runSlotBody = body.slice(body.indexOf("{", declaration), body.indexOf("async function runRequest"));
  assert.doesNotMatch(runSlotBody, /\brunSlot\s*\(/, "runSlot must not recurse");
  // The ceiling is a literal, not a computed or configurable value.
  assert.match(engineSource, /const MAX_PROVIDER_ATTEMPTS_PER_SLOT = 4;/);
  assert.match(engineSource, /const MAX_SLOT_REGENERATIONS = 2;/);
  assert.match(engineSource, /attempt <= maxProviderAttempts/);
});

test("the attempt ceiling cannot be raised past the constant by a caller", async () => {
  const provider = deadProvider();
  const store = makeStore();
  await assert.rejects(() => engine.runSlot({ ...base, provider, store, maxProviderAttempts: 50 }), /Provider attempts must be 1\.\.4/);
  assert.equal(provider.calls, 0);
});

test("every provider call carries a hard timeout", async () => {
  let seen = null;
  const provider = { async generateImage(options) { seen = options; return { bytes: Buffer.from("r"), contentType: "image/png", model: "m", keyFingerprint: "0123456789ab" }; } };
  await engine.runSlot({ ...base, provider, store: makeStore() });
  assert.equal(seen.timeoutMs, engine.PROVIDER_TIMEOUT_MS);
  assert.ok(seen.timeoutMs > 0 && seen.timeoutMs <= 300_000, "no hanging HTTP request");
});

test("slot storage is content-addressed so reconciliation can find it", () => {
  const path = engine.slotStoragePath({ tenantKey: TENANT, generationId: GENERATION, sourceViewType: "side", contentHash: "b".repeat(64), contentType: "image/png" });
  // Exactly the prefix complete_designpro_generation_request recomputes:
  // designpro/<tenant>/<generationId>/calls-1-7/<view>/<hash><ext>
  assert.equal(path, `designpro/${TENANT}/${GENERATION}/calls-1-7/side/${"b".repeat(64)}.png`);
  assert.equal(path, `${engine.slotStoragePrefix({ tenantKey: TENANT, generationId: GENERATION, sourceViewType: "side" })}/${"b".repeat(64)}.png`);
  assert.throws(() => engine.slotStoragePath({ tenantKey: TENANT, generationId: GENERATION, sourceViewType: "side", contentHash: "b".repeat(64), contentType: "image/gif" }), /not a supported render type/);
  // A slot cannot be addressed without both identity parts.
  assert.throws(() => engine.slotStoragePath({ tenantKey: TENANT, sourceViewType: "side", contentHash: "b".repeat(64), contentType: "image/png" }), /required to address a slot/);
});
