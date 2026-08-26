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

test("Atlas can disable anonymous orphan reconciliation and regenerate from its authority", async () => {
  const bytes = Buffer.from("anonymous-old-render");
  const contentHash = engine._test.sha256(bytes);
  const provider = okProvider(Buffer.from("atlas-authorized-render"));
  const store = makeStore({
    orphan: { bytes, contentHash, storagePath: `designpro/x/side/${contentHash}.png`, contentType: "image/png" },
  });
  const result = await engine.runSlot({
    ...base,
    provider,
    store,
    allowOrphanReconciliation: false,
  });
  assert.equal(result.state, "accepted");
  assert.equal(result.reconciled, undefined);
  assert.equal(provider.calls, 1, "anonymous bytes must not bypass Atlas projection");
  assert.notEqual(store.state.accepted.get("side").contentHash, contentHash);
});

test("orphaned bytes whose hash does not verify are not adopted", async () => {
  const provider = okProvider();
  const store = makeStore({ orphan: { bytes: Buffer.from("tampered"), contentHash: "f".repeat(64), storagePath: "designpro/x/side/f.png", contentType: "image/png" } });
  const result = await engine.runSlot({ ...base, provider, store });
  assert.equal(result.state, "accepted");
  assert.equal(result.reconciled, undefined, "a hash mismatch must fall through to a real generation");
  assert.equal(provider.calls, 1);
});

test("an atlas-conditioned proof persists the exact immutable authority identity", async () => {
  const provider = okProvider(Buffer.from("atlas-conditioned-view"));
  const store = makeStore();
  const authorityMetadata = {
    contract: "designpro.flat-first-atlas.v1",
    revisionId: "44444444-4444-4444-8444-444444444444",
    revisionSequence: 1,
    masterContentHash: "a".repeat(64),
    projectionContentHash: "c".repeat(64),
    projectionSourceMasterHash: "a".repeat(64),
    manifestContentHash: "b".repeat(64),
    topology: "rectangular-preview-v1",
  };
  const result = await engine.runSlot({
    ...base, provider, store, authorityMetadata,
  });
  assert.equal(result.state, "accepted");
  assert.deepEqual(store.state.accepted.get("side").metadata.authority, authorityMetadata);
});

test("an accepted semantic review is persisted with the proof identity", async () => {
  const provider = okProvider(Buffer.from("semantically-reviewed-view"));
  provider.generateImage = async function generateImage() {
    this.calls += 1;
    return {
      bytes: Buffer.from("semantically-reviewed-view"),
      contentType: "image/png",
      model: "gemini-3-pro-image",
      keyFingerprint: "0123456789ab",
      attempts: [],
      contract: "designpro.atlas-designpanel-server-provider.v1",
    };
  };
  const store = makeStore();
  const validation = {
    contract: "designpro.atlas-proof-semantic-qc.v1",
    expectedView: "Driver",
    proofHash: engine._test.sha256(Buffer.from("semantically-reviewed-view")),
    confidence: 0.98,
  };
  await engine.runSlot({
    ...base,
    provider,
    store,
    validate: async () => ({ accepted: true, metadata: validation }),
  });
  const metadata = store.state.accepted.get("side").metadata;
  assert.equal(metadata.providerContract, "designpro.atlas-designpanel-server-provider.v1");
  assert.deepEqual(metadata.validation, validation);
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

// A retry that re-sends a byte-identical prompt is not a retry, it is the same
// dice roll. Live evidence 2026-08-23: Hood and Close-Up were each rejected
// twice by the A.T.L.A.S. proof inspector for the same correctable framing
// faults and the whole seven-view run failed. The inspector's findings must
// reach the next attempt.
test("a rejected attempt carries the inspector's findings into the next call", async () => {
  const seen = [];
  const provider = {
    calls: 0,
    async generateImage(call) {
      this.calls += 1;
      seen.push({ parts: call.parts, corrections: call.corrections });
      return { bytes: Buffer.from("render"), contentType: "image/png", model: "gemini-3-pro-image-preview", keyFingerprint: "0123456789ab", attempts: [] };
    },
  };
  const store = makeStore();
  await engine.runSlot({
    ...base,
    sourceViewType: "hood_detail",
    consumerRole: "hood",
    provider,
    store,
    validate: async () => ({
      accepted: false,
      code: "atlas_qc_camera_failed",
      reason: "framingContract=fail",
      correction: "PREVIOUS ATTEMPT REJECTED: the hood surface does not fill a minimum of 80%.",
    }),
  });

  assert.equal(provider.calls, engine.MAX_SLOT_REGENERATIONS);
  assert.deepEqual(seen[0].parts, base.promptParts, "attempt 1 is the untouched contract prompt");
  assert.deepEqual(seen[0].corrections, [], "attempt 1 has no findings to correct");
  assert.equal(seen[1].parts.length, base.promptParts.length + 1, "the finding is one extra trailing part");
  assert.match(seen[1].parts.at(-1).text, /does not fill a minimum of 80%/);
  assert.deepEqual(seen[1].parts.slice(0, base.promptParts.length), base.promptParts,
    "the camera, studio and artwork authority parts are never rewritten");
  assert.equal(seen[1].corrections.length, 1, "providers that rebuild parts read the findings from call.corrections");
});

test("an identical finding is carried once, not stacked on every attempt", async () => {
  const seen = [];
  const provider = {
    calls: 0,
    async generateImage(call) { this.calls += 1; seen.push(call.corrections); return { bytes: Buffer.from("r"), contentType: "image/png", model: "m", keyFingerprint: "0123456789ab", attempts: [] }; },
  };
  await engine.runSlot({
    ...base, provider, store: makeStore(),
    maxProviderAttempts: 4, maxRegenerations: 4,
    validate: async () => ({ accepted: false, code: "atlas_qc_camera_failed", reason: "x", correction: "same finding" }),
  });
  assert.deepEqual(seen.at(-1), ["same finding"]);
});

test("a slot already leased by another worker is left alone", async () => {
  const provider = okProvider();
  const store = makeStore({ leaseBusy: true });
  const result = await engine.runSlot({ ...base, provider, store });
  assert.equal(result.state, "leased_elsewhere");
  assert.equal(provider.calls, 0, "two workers must not generate the same driver at once");
});

test("runRequest is pending, never outputs_ready, until every slot is accepted", async () => {
  const provider = okProvider();
  const acceptedDriver = {
    contentHash: "a".repeat(64),
    storagePath: "designpro/x/side/a.png",
  };
  const store = makeStore({
    accepted: [["side", acceptedDriver]],
    leaseBusy: true,
  });
  const result = await engine.runRequest({
    ...base,
    provider,
    store,
    slots: [
      { sourceViewType: "side", consumerRole: "driver" },
      { sourceViewType: "passenger-side", consumerRole: "passenger" },
    ],
  });

  assert.equal(result.state, "pending");
  assert.equal(result.requiresExplicitResume, false);
  assert.deepEqual(result.results.map((slot) => slot.state), ["accepted", "leased_elsewhere"]);
  assert.equal(result.providerCalls, 0);
});

test("a failed slot keeps runRequest failed even when another slot is leased elsewhere", async () => {
  const provider = deadProvider();
  const store = makeStore();
  const acquire = store.acquireSlotLease;
  store.acquireSlotLease = async (options) => (
    options.sourceViewType === "passenger-side" ? null : acquire(options)
  );
  const result = await engine.runRequest({
    ...base,
    provider,
    store,
    slots: [
      { sourceViewType: "side", consumerRole: "driver" },
      { sourceViewType: "passenger-side", consumerRole: "passenger" },
    ],
  });

  assert.equal(result.state, "failed");
  assert.equal(result.requiresExplicitResume, true);
  assert.deepEqual(result.results.map((slot) => slot.state), ["failed", "leased_elsewhere"]);
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

test("flat-first may run proof slots concurrently while preserving receipt order", async () => {
  let active = 0;
  let maximumActive = 0;
  let releaseGate;
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  const provider = {
    calls: 0,
    async generateImage() {
      this.calls += 1;
      const call = this.calls;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (active === 2) releaseGate();
      await gate;
      active -= 1;
      return {
        bytes: Buffer.from(`parallel-render-${call}`),
        contentType: "image/png",
        model: "gemini-3-pro-image",
        keyFingerprint: "0123456789ab",
        attempts: [],
      };
    },
  };
  const store = makeStore();
  const result = await engine.runRequest({
    ...base,
    provider,
    store,
    parallel: true,
    slots: [
      { sourceViewType: "side", consumerRole: "driver" },
      { sourceViewType: "passenger-side", consumerRole: "passenger" },
    ],
  });
  assert.equal(maximumActive, 2, "the flat-first projections actually overlap");
  assert.deepEqual(result.results.map((item) => item.sourceViewType), ["side", "passenger-side"],
    "Promise completion timing cannot reorder the durable seven-view receipt");
  assert.equal(result.state, "outputs_ready");
});

test("legacy requests remain sequential when the parallel opt-in is absent", async () => {
  let active = 0;
  let maximumActive = 0;
  const provider = {
    calls: 0,
    async generateImage() {
      this.calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return {
        bytes: Buffer.from(`legacy-render-${this.calls}`),
        contentType: "image/png",
        model: "gemini-3-pro-image",
        keyFingerprint: "0123456789ab",
        attempts: [],
      };
    },
  };
  await engine.runRequest({
    ...base,
    provider,
    store: makeStore(),
    slots: [
      { sourceViewType: "side", consumerRole: "driver" },
      { sourceViewType: "passenger-side", consumerRole: "passenger" },
    ],
  });
  assert.equal(maximumActive, 1);
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
  assert.match(engineSource, /const MAX_SLOT_REGENERATIONS = 3;/);
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

// ── A QC REJECTION IS A VERDICT, NOT A TRANSPORT FAULT ────────────────────────
//
// The Standard server provider runs its own proof inspector and signals a failed
// inspection by THROWING designpanel_quality_rejected. That landed in the
// transport-failure branch, where a QC verdict was treated as a network fault:
// recorded as http_error, `rejections` never incremented, no correction pushed,
// and the slot terminated as provider_attempts_exhausted rather than
// semantic_review_required.
//
// The expensive consequence was the missing correction: every retry re-sent a
// byte-identical prompt, so the run spent its whole budget re-asking an
// unchanged question. Live proof, generation 2c0fc9f4 (2026-08-24), side: four
// attempts, four inspector rejections naming the same invented phone number,
// four http_errors, then provider_attempts_exhausted.

/** Throws exactly what the Standard server provider throws on a failed inspection. */
const qcRejectingProvider = () => ({
  calls: 0,
  seenParts: [],
  async generateImage({ parts }) {
    this.calls += 1;
    this.seenParts.push(JSON.stringify(parts));
    const error = new Error(
      "Standard proof rejected: customerTextPass; A phone number (602-555-0184) is present on the wrap, but the brief specified 'none supplied'.",
    );
    error.code = "designpanel_quality_rejected";
    error.retryable = true;
    throw error;
  },
});

test("A thrown QC rejection counts as a rejection, not a provider failure", async () => {
  const provider = qcRejectingProvider();
  const store = makeStore();
  const result = await engine.runSlot({ ...base, provider, store });

  // (1) it spends the REGENERATION budget, not the provider-attempt budget.
  assert.equal(provider.calls, engine.MAX_SLOT_REGENERATIONS, "a semantic rejection must spend the regeneration budget");
  assert.ok(
    engine.MAX_SLOT_REGENERATIONS < engine.MAX_PROVIDER_ATTEMPTS_PER_SLOT,
    "this test is only meaningful while the two ceilings differ",
  );

  // Every attempt is recorded as a rejection carrying the inspector's own code,
  // never as http_error.
  assert.ok(store.state.finished.length > 0);
  for (const row of store.state.finished) {
    assert.equal(row.outcome, "rejected", "a QC rejection must not be recorded as a transport outcome");
    assert.equal(row.errorCode, "designpanel_quality_rejected");
    assert.match(row.detail, /Standard proof rejected/);
  }

  // (4) and it terminates as the state a human acts on.
  assert.equal(result.state, "failed");
  assert.equal(result.reason, "semantic_review_required");
  assert.notEqual(result.reason, "provider_attempts_exhausted");
  assert.equal(store.state.failures.at(-1).reason, "semantic_review_required");
});

test("The inspector's findings reach the next attempt, so the retry prompt changes", async () => {
  const provider = qcRejectingProvider();
  const store = makeStore();
  await engine.runSlot({ ...base, provider, store });

  assert.ok(provider.seenParts.length >= 2, "there must be a retry to compare against");

  // (3) the retry is not a byte-identical re-ask.
  assert.notEqual(
    provider.seenParts[0],
    provider.seenParts[1],
    "the attempt after a semantic rejection must not re-send an identical prompt",
  );

  // (2) and the difference is the inspector's own reasons, carried forward.
  const retry = provider.seenParts[1];
  assert.match(retry, /PREVIOUS ATTEMPT REJECTED BY THE SIDE PROOF INSPECTOR \(designpanel_quality_rejected\)/);
  assert.match(retry, /602-555-0184/, "the retry must name the finding it has to correct");
  assert.match(retry, /customerTextPass/);
  // The correction instructs a fix, never a redesign around the finding.
  assert.match(retry, /Do not redesign, restyle, recolor or move any artwork to compensate/);
});

test("Genuine provider failures still take the transport path", async () => {
  // (5) Only the one semantic code is re-routed. A real fault must keep
  // spending the provider-attempt budget and keep its transport outcome --
  // laundering it into a rejection would burn the regeneration budget on
  // something no amount of re-prompting can fix.
  const provider = deadProvider(500);
  const store = makeStore();
  const result = await engine.runSlot({ ...base, provider, store });

  assert.equal(provider.calls, engine.MAX_PROVIDER_ATTEMPTS_PER_SLOT);
  assert.equal(result.reason, "provider_attempts_exhausted");
  for (const row of store.state.finished) {
    assert.notEqual(row.outcome, "rejected", "a transport failure must never be recorded as a semantic rejection");
    assert.equal(row.outcome, engine.OUTCOME.HTTP_ERROR);
  }

  // The predicate is keyed on the exact code, never on message text: a real
  // transport error whose message happens to quote an inspector stays a
  // transport error.
  const { isSemanticQualityRejection } = engine._test;
  assert.equal(isSemanticQualityRejection({ code: "designpanel_quality_rejected" }), true);
  assert.equal(isSemanticQualityRejection({ code: "provider_exhausted", message: "Standard proof rejected: x" }), false);
  assert.equal(isSemanticQualityRejection({ message: "designpanel_quality_rejected" }), false);
  assert.equal(isSemanticQualityRejection(new Error("boom")), false);
  assert.equal(isSemanticQualityRejection(null), false);
});

test("A QC judge outage never consumes the design-rejection budget (validator hot-fix 2026-08-26)", async () => {
  // Live defect this locks: generation 9dd6d43c, close-up — the semantic-QC
  // judge returned HTTP 503 and that infrastructure error was counted as the
  // view's second and final design rejection, failing the whole request.
  //
  // Contract: a validator that could not produce a verdict reports
  // `verdictUnavailable: true`; the engine retries the inspection over the
  // SAME candidate bytes, and only a completed verdict may spend a rejection.
  const provider = okProvider();
  let inspections = 0;
  const validate = async () => {
    inspections += 1;
    if (inspections < 3) {
      return { accepted: false, verdictUnavailable: true, code: "atlas_qc_analyzer_failed", reason: "judge 503" };
    }
    return { accepted: true };
  };
  const store = makeStore();
  const result = await engine.runSlot({ ...base, provider, store, validate, qcVerdictRetryDelayMs: 0 });

  assert.equal(result.state, "accepted", "the render must survive a transient judge outage");
  assert.equal(provider.calls, 1, "the good render is never regenerated because the judge was down");
  assert.equal(inspections, 3, "the inspection itself is what gets retried");
  assert.ok(
    store.state.finished.every((row) => row.outcome !== "rejected"),
    "no design rejection may be recorded for an incomplete inspection",
  );
});

test("A persistent QC judge outage fails as infrastructure, never as semantic review", async () => {
  const provider = okProvider();
  let inspections = 0;
  const validate = async () => {
    inspections += 1;
    return { accepted: false, verdictUnavailable: true, code: "atlas_qc_analyzer_failed", reason: "judge down" };
  };
  const store = makeStore();
  const result = await engine.runSlot({ ...base, provider, store, validate, qcVerdictRetryDelayMs: 0 });

  assert.equal(result.state, "failed");
  assert.equal(result.reason, "provider_attempts_exhausted",
    "an unreachable judge is an infrastructure state a retry can heal — never semantic_review_required");
  assert.equal(store.state.failures[0].rejections, 0, "the design-rejection budget is untouched");
  for (const row of store.state.finished) {
    assert.notEqual(row.outcome, "rejected");
  }
  // Bounded: each provider attempt re-asks the judge at most three times.
  assert.equal(inspections, engine.MAX_PROVIDER_ATTEMPTS_PER_SLOT * 3);
});

test("A completed rejection verdict still spends the budget exactly as before", async () => {
  const provider = okProvider();
  const validate = async () => ({ accepted: false, code: "atlas_qc_view_mismatch", reason: "wrong view" });
  const store = makeStore();
  const result = await engine.runSlot({ ...base, provider, store, validate, qcVerdictRetryDelayMs: 0 });

  assert.equal(result.state, "failed");
  assert.equal(result.reason, "semantic_review_required");
  assert.equal(store.state.failures[0].rejections, engine.MAX_SLOT_REGENERATIONS);
});
