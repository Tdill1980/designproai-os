import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
 * The generic engine still supports strict validators whose analyzer outage
 * consumes a bounded attempt without spending the rejection budget. A.T.L.A.S.
 * presentation proofs now use a narrower policy: after deterministic identity
 * preflight, the visual reviewer is advisory and an outage is persisted in the
 * accepted receipt rather than causing another expensive image render.
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

test("the atlas validator publishes an unavailable advisory after valid preflight", async () => {
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const contentHash = createHash("sha256").update(image).digest("hex");
  const validator = createAtlasProofValidator({
    provider: { async generateRaw() { throw new Error("503 UNAVAILABLE on every key"); } },
    atlas: {
      master: { contentHash },
      projection: { bytes: image, contentType: "image/png", contentHash },
      viewAuthorities: {
        "close-up": {
          contract: "designpro.flat-first-atlas-view-authority.v1",
          sourceViewType: "close-up",
          surfaceKey: "driver",
          bytes: image,
          contentType: "image/png",
          contentHash,
          sourceMasterHash: contentHash,
        },
      },
    },
    input: {},
  });
  const verdict = await validator({
    bytes: image, contentType: "image/png",
    sourceViewType: "close-up", consumerRole: "closeup",
  });
  assert.equal(verdict.accepted, true);
  assert.equal(verdict.advisory, true);
  assert.equal(verdict.metadata.policyContract, "designpro.atlas-proof-semantic-advisory.v1");
  assert.equal(verdict.metadata.semanticDisposition, "unavailable");
  assert.equal(verdict.metadata.semanticCode, "atlas_qc_analyzer_failed");
  assert.match(verdict.metadata.semanticReason, /503 UNAVAILABLE/);
});
