"use strict";

/**
 * Calls 1-7 slot execution engine.
 *
 * The rule this module exists to enforce: it stops. Every path out of here is
 * bounded by a literal constant. There is no "keep trying until success", no
 * recursion, no open-ended loop, and no regeneration of work that already
 * succeeded. A provider that fails forever costs exactly
 * MAX_PROVIDER_ATTEMPTS_PER_SLOT calls and then the slot is failed, the lease
 * is released, and nothing retries it until a human asks.
 *
 * Ordering inside a slot, and why:
 *
 *   1. Accepted winner?      return it. Never regenerate what Calls 8+ may
 *                            already have hashed.
 *   2. Bytes in storage?     reconcile. A crash between the upload and the row
 *                            leaves real bytes at a content-addressed path;
 *                            verify the hash and finish the persistence rather
 *                            than paying a provider to make them again.
 *   3. Bounded attempt loop. A durable attempt row is written BEFORE the call,
 *                            so a worker that dies mid-request leaves evidence
 *                            instead of an invisible retry.
 *
 * Every attempt records request_id, slot, attempt number, model, key
 * fingerprint, started_at, duration_ms, result, error code and winner hash.
 */

const { createHash } = require("node:crypto");

// Literal ceilings. Changing these is a deliberate act, not a tuning knob.
const MAX_PROVIDER_ATTEMPTS_PER_SLOT = 4;
const MAX_SLOT_REGENERATIONS = 2;
const PROVIDER_TIMEOUT_MS = 180_000;
const SLOT_LEASE_SECONDS = 600;
const ENGINE_CONTRACT = "designpro.calls-1-7-engine-runner.v1";

const OUTCOME = Object.freeze({
  ACCEPTED: "accepted",
  HTTP_ERROR: "http_error",
  EMPTY: "empty_response",
  UNSUPPORTED: "unsupported_type",
  MULTI: "multi_image",
  ABORTED: "aborted",
  TIMEOUT: "timeout",
});

class EngineError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function extensionFor(contentType) {
  return { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[contentType] || null;
}

/**
 * Content-addressed path. The same bytes always land in the same place, which
 * is what makes crash reconciliation possible at all.
 *
 * The shape is not free. complete_designpro_generation_request recomputes this
 * exact string and rejects the whole request with generation_view_identity_invalid
 * if a single view disagrees, so the prefix is keyed on the GENERATION id — not
 * the request id — and carries the calls-1-7 segment the database expects.
 */
function slotStoragePath({ tenantKey, generationId, sourceViewType, contentHash, contentType }) {
  const extension = extensionFor(contentType);
  if (!extension) throw new EngineError("slot_content_type_invalid", `${contentType} is not a supported render type`);
  if (!tenantKey || !generationId) throw new EngineError("slot_path_identity_missing", "Tenant key and generation id are required to address a slot");
  return `designpro/${tenantKey}/${generationId}/calls-1-7/${sourceViewType}/${contentHash}.${extension}`;
}

/** The directory every attempt at one slot writes into. */
function slotStoragePrefix({ tenantKey, generationId, sourceViewType }) {
  return `designpro/${tenantKey}/${generationId}/calls-1-7/${sourceViewType}`;
}

function classifyFailure(error) {
  const message = String(error?.message || error);
  if (/timed? ?out|TimeoutError/i.test(message)) return OUTCOME.TIMEOUT;
  if (/abort/i.test(message)) return OUTCOME.ABORTED;
  if (/unsupported/i.test(message)) return OUTCOME.UNSUPPORTED;
  if (/expected one image|received \d+/i.test(message)) return OUTCOME.MULTI;
  if (/empty image/i.test(message)) return OUTCOME.EMPTY;
  return OUTCOME.HTTP_ERROR;
}

/**
 * Runs one slot to a decision. Returns an accepted winner or a failed slot.
 * It never returns "still trying".
 */
async function runSlot(options) {
  const {
    requestId, tenantKey, generationId, sourceViewType, consumerRole,
    provider, store, promptParts, aspectRatio, imageSize,
    validate, signal, authorityMetadata = null, now = () => Date.now(),
    maxProviderAttempts = MAX_PROVIDER_ATTEMPTS_PER_SLOT,
    maxRegenerations = MAX_SLOT_REGENERATIONS,
    timeoutMs = PROVIDER_TIMEOUT_MS,
  } = options;

  if (!Number.isSafeInteger(maxProviderAttempts) || maxProviderAttempts < 1 || maxProviderAttempts > MAX_PROVIDER_ATTEMPTS_PER_SLOT) {
    throw new EngineError("attempt_ceiling_invalid", `Provider attempts must be 1..${MAX_PROVIDER_ATTEMPTS_PER_SLOT}`);
  }

  // 1. An accepted winner is final. Calls 8+ may already have hashed it.
  const existing = await store.findAcceptedSlot({ requestId, sourceViewType });
  if (existing) {
    return { requestId, sourceViewType, consumerRole, state: "accepted", reused: true, winner: existing, providerCalls: 0, attempts: [] };
  }

  // 2. One lease per request+slot, so two workers cannot generate the same
  //    driver at once. Recovery resumes this slot rather than starting another.
  const lease = await store.acquireSlotLease({ requestId, sourceViewType, leaseSeconds: SLOT_LEASE_SECONDS });
  if (!lease) {
    return { requestId, sourceViewType, consumerRole, state: "leased_elsewhere", reused: false, providerCalls: 0, attempts: [] };
  }

  const attempts = [];
  let providerCalls = 0;
  let rejections = 0;

  try {
    // 3. Storage-first reconciliation. A crash between upload and row commit
    //    leaves real bytes behind; finish that work instead of buying it twice.
    const orphan = await store.findReconcilableBytes?.({ requestId, tenantKey, generationId, sourceViewType });
    if (orphan && sha256(orphan.bytes) === orphan.contentHash) {
      const winner = await store.persistAcceptedSlot({
        requestId, sourceViewType, consumerRole,
        storagePath: orphan.storagePath, contentHash: orphan.contentHash,
        byteSize: orphan.bytes.length, contentType: orphan.contentType,
        metadata: {
          contract: ENGINE_CONTRACT,
          reconciledFromStorage: true,
          ...(authorityMetadata && typeof authorityMetadata === "object"
            ? { authority: authorityMetadata }
            : {}),
        },
      });
      return { requestId, sourceViewType, consumerRole, state: "accepted", reused: true, reconciled: true, winner, providerCalls: 0, attempts };
    }

    // Bounded loop. Not recursion, not while(true). The ceiling is the constant
    // above and both provider failures and semantic rejections spend from it,
    // so no combination of outcomes can exceed it.
    for (let attempt = 1; attempt <= maxProviderAttempts; attempt += 1) {
      if (signal?.aborted) break;
      if (rejections >= maxRegenerations) break;

      const startedAt = now();
      // Durable evidence before the call, so a worker that dies mid-flight
      // leaves a record rather than an invisible retry.
      await store.recordAttemptStarted({ requestId, sourceViewType, attempt, startedAt });
      providerCalls += 1;

      let result = null;
      let failure = null;
      try {
        result = await provider.generateImage({
          parts: promptParts, aspectRatio, imageSize, signal, timeoutMs,
          // The direct Gemini transport ignores these identities. The restored
          // DesignPanel transport needs them to choose the sanctioned Edge
          // function and never infers a camera angle from prompt prose.
          requestId, generationId, sourceViewType, consumerRole,
          label: `${sourceViewType} attempt ${attempt}`,
        });
      } catch (error) {
        failure = error;
      }

      const durationMs = now() - startedAt;

      if (failure) {
        const record = {
          requestId, sourceViewType, attempt, model: null, keyFingerprint: null,
          outcome: classifyFailure(failure), durationMs,
          errorCode: failure.code || "provider_failed",
          detail: String(failure.message || failure).slice(0, 500), winnerHash: null,
        };
        await store.recordAttemptFinished(record);
        attempts.push(record);
        continue;
      }

      // A render that is structurally or semantically wrong is a rejection, not
      // a success. Passenger side is where this matters most: its text must
      // read forwards, and no hash comparison can tell you that.
      let verdict = { accepted: true };
      if (typeof validate === "function") {
        verdict = await validate({ bytes: result.bytes, contentType: result.contentType, sourceViewType, consumerRole });
      }
      if (!verdict?.accepted) {
        rejections += 1;
        const record = {
          requestId, sourceViewType, attempt, model: result.model, keyFingerprint: result.keyFingerprint,
          outcome: "rejected", durationMs, errorCode: verdict?.code || "semantic_rejected",
          detail: String(verdict?.reason || "failed semantic validation").slice(0, 500), winnerHash: null,
        };
        await store.recordAttemptFinished(record);
        attempts.push(record);
        continue;
      }

      const contentHash = sha256(result.bytes);
      const storagePath = slotStoragePath({ tenantKey, generationId, sourceViewType, contentHash, contentType: result.contentType });
      await store.putImmutableBytes({ storagePath, bytes: result.bytes, contentType: result.contentType });
      const winner = await store.persistAcceptedSlot({
        requestId, sourceViewType, consumerRole, storagePath, contentHash,
        byteSize: result.bytes.length, contentType: result.contentType,
        metadata: {
          contract: ENGINE_CONTRACT, model: result.model, keyFingerprint: result.keyFingerprint,
          attempt, durationMs, providerAttempts: result.attempts?.length || 1,
          ...(result.metadata && typeof result.metadata === "object"
            ? { provider: result.metadata }
            : {}),
          ...(authorityMetadata && typeof authorityMetadata === "object"
            ? { authority: authorityMetadata }
            : {}),
        },
      });
      const record = {
        requestId, sourceViewType, attempt, model: result.model, keyFingerprint: result.keyFingerprint,
        outcome: OUTCOME.ACCEPTED, durationMs, errorCode: null, detail: null, winnerHash: contentHash,
      };
      await store.recordAttemptFinished(record);
      attempts.push(record);
      return { requestId, sourceViewType, consumerRole, state: "accepted", reused: false, winner, providerCalls, attempts };
    }

    // Exhausted. The slot is failed, not pending, and nothing here schedules
    // another try. A human asks for it explicitly or it stays failed.
    await store.markSlotFailed({
      requestId, sourceViewType,
      reason: rejections >= maxRegenerations ? "semantic_review_required" : "provider_attempts_exhausted",
      providerCalls, rejections,
    });
    return {
      requestId, sourceViewType, consumerRole, state: "failed", reused: false,
      reason: rejections >= maxRegenerations ? "semantic_review_required" : "provider_attempts_exhausted",
      providerCalls, attempts,
    };
  } finally {
    // The lease is released on every path, including a throw, so a crashed slot
    // becomes recoverable rather than stuck.
    await store.releaseSlotLease({ requestId, sourceViewType, lease }).catch(() => {});
  }
}

/**
 * Runs the requested slots once. The whole-request budget is the per-slot
 * ceiling times the number of slots, and it cannot be exceeded because each
 * slot enforces its own. A request whose slots all fail becomes failed; it is
 * never left pending, and it does not restart itself.
 */
async function runRequest(options) {
  const { slots, parallel = false, ...slotOptions } = options;
  if (!Array.isArray(slots) || !slots.length) throw new EngineError("slot_set_empty", "At least one slot is required");
  let results;
  if (parallel === true) {
    // Flat-first v3 freezes one atlas before this function is called, so all
    // seven camera projections may run together without becoming seven
    // independent design decisions. Promise.all preserves slot order in the
    // returned receipt even though provider work overlaps.
    results = await Promise.all(slots.map((slot) => runSlot({ ...slotOptions, ...slot })));
  } else {
    // Legacy v1/v2 keeps its exact sequential pressure and timing profile.
    results = [];
    for (const slot of slots) results.push(await runSlot({ ...slotOptions, ...slot }));
  }
  const providerCalls = results.reduce((total, result) => total + result.providerCalls, 0);
  const budget = slots.length * MAX_PROVIDER_ATTEMPTS_PER_SLOT;
  if (providerCalls > budget) throw new EngineError("request_budget_exceeded", `${providerCalls} provider calls exceeded the ${budget} budget`);
  const failed = results.filter((item) => item.state === "failed");
  return {
    contract: ENGINE_CONTRACT,
    state: failed.length ? "failed" : "outputs_ready",
    providerCalls, budget, results,
    // Nothing auto-restarts a failed request. Resuming is an explicit act.
    requiresExplicitResume: failed.length > 0,
  };
}

module.exports = {
  ENGINE_CONTRACT,
  MAX_PROVIDER_ATTEMPTS_PER_SLOT,
  MAX_SLOT_REGENERATIONS,
  OUTCOME,
  PROVIDER_TIMEOUT_MS,
  SLOT_LEASE_SECONDS,
  EngineError,
  runRequest,
  runSlot,
  slotStoragePath,
  slotStoragePrefix,
  _test: { classifyFailure, extensionFor, sha256 },
};
