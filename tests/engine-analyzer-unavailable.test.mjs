import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runSlot } = require("../runtime/generation-engine.cjs");
const { createAtlasProofValidator } = require("../runtime/atlas-proof-qc.cjs");

/**
 * A VERDICT THAT NEVER HAPPENED IS NEITHER ACCEPTANCE NOR REJECTION.
 *
 * Generation 9dd6d43c, close-up, attempt 2 (2026-08-26): the proof inspector's
 * own provider returned 503 on every key. The validator reported that outage as
 * `accepted: false`, the engine counted it as the second of two allowed
 * rejections, and the slot died `semantic_review_required` -- a state that
 * asks a human to review a verdict no judge ever issued.
 *
 * The contract now: an analyzer failure consumes a bounded ATTEMPT (the loop
 * still ends) but never the rejection budget, never pushes a correction, and
 * never accepts the unjudged proof. A real verdict still convicts exactly as
 * before -- these tests pin both directions.
 */

function memoryStore(log) {
  return {
    async findAcceptedSlot() { return null; },
    async acquireSlotLease() { return { token: "t" }; },
    async releaseSlotLease() {},
    async recordAttemptStarted() {},
    async recordAttemptFinished(record) { log.push(record); },
    async putImmutableBytes() {},
    async persistAcceptedSlot(row) { return row; },
    async markSlotFailed(row) { log.push({ failed: row }); },
  };
}
const baseOptions = (over) => ({
  requestId: "r1", tenantKey: "user_u1", generationId: "g1",
  sourceViewType: "close-up", consumerRole: "closeup",
  promptParts: [{ text: "prompt" }], aspectRatio: "16:9", imageSize: "4K",
  allowOrphanReconciliation: false,
  provider: { async generateImage() { return { bytes: Buffer.from("png"), contentType: "image/png", model: "m", keyFingerprint: "k" }; } },
  ...over,
});

test("an analyzer outage never spends the rejection budget", async () => {
  const log = [];
  const result = await runSlot(baseOptions({
    store: memoryStore(log),
    validate: async () => ({ accepted: false, analyzerUnavailable: true, code: "atlas_qc_analyzer_failed", reason: "503 on every key" }),
  }));
  assert.equal(result.state, "failed");
  // All four bounded attempts ran -- the outage did not shortcut the loop at
  // two the way a rejection pair does...
  assert.equal(result.providerCalls, 4);
  // ...and the slot fails as an infrastructure exhaustion, not as a verdict
  // waiting for human review.
  assert.equal(result.reason, "provider_attempts_exhausted");
  const failedRow = log.find((entry) => entry.failed);
  assert.equal(failedRow.failed.rejections, 0);
  assert.ok(log.filter((entry) => entry.errorCode === "atlas_qc_analyzer_failed").length === 4);
});

test("a real verdict still convicts in two rejections", async () => {
  const log = [];
  const result = await runSlot(baseOptions({
    store: memoryStore(log),
    validate: async () => ({ accepted: false, code: "atlas_qc_design_drift", reason: "invented artwork" }),
  }));
  assert.equal(result.state, "failed");
  assert.equal(result.reason, "semantic_review_required");
  assert.equal(log.find((entry) => entry.failed).failed.rejections, 2);
});

test("an unjudged proof is never accepted", async () => {
  const log = [];
  let calls = 0;
  const result = await runSlot(baseOptions({
    store: memoryStore(log),
    validate: async () => {
      calls += 1;
      return calls < 3
        ? { accepted: false, analyzerUnavailable: true, code: "atlas_qc_analyzer_failed", reason: "unavailable" }
        : { accepted: true };
    },
  }));
  // Two outages, then a real verdict on attempt three: accepted -- judged,
  // never waved through.
  assert.equal(result.state, "accepted");
  assert.equal(result.providerCalls, 3);
});

test("the atlas validator reports its own failure as analyzer-unavailable", async () => {
  // Every failure of the inspector's own plumbing exits through one catch --
  // a provider 503, a malformed response, an image it could not ship. This
  // drives that catch and asserts the flag; whichever internal step throws
  // first, the contract is the same: no verdict, not a rejection.
  const validator = createAtlasProofValidator({
    provider: { async generateRaw() { throw new Error("503 UNAVAILABLE on every key"); } },
    atlas: { master: { contentHash: "a".repeat(64) }, projection: {}, viewAuthorities: {} },
    input: {},
  });
  const verdict = await validator({
    bytes: Buffer.from("x"), contentType: "image/png",
    sourceViewType: "close-up", consumerRole: "closeup",
  });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.analyzerUnavailable, true);
  assert.equal(typeof verdict.reason, "string");
});
