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

// The ONE provider error code that is a semantic verdict rather than a
// transport fault. Matched on the exact code, never on message text: a
// substring match would eventually catch a real transport error whose message
// happens to quote an inspector, and laundering a genuine fault into a
// rejection spends the regeneration budget on something re-prompting cannot fix.
const SEMANTIC_QUALITY_REJECTION_CODE = "designpanel_quality_rejected";

function isSemanticQualityRejection(error) {
  return error?.code === SEMANTIC_QUALITY_REJECTION_CODE;
}

/**
 * Turns a thrown inspector rejection into the correction the next attempt reads.
 *
 * Same shape the proof QC validator returns on the verdict path, so both
 * rejection routes hand the renderer the same kind of instruction: name the
 * inspector, list its findings, and forbid redesigning around them.
 */
function semanticRejectionCorrection(error, sourceViewType) {
  const message = String(error?.message || "").trim();
  // "Standard proof rejected: a; b; c" -> ["a", "b", "c"]
  const findings = message.replace(/^[^:]*:\s*/, "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!findings.length) return "";
  return [
    `PREVIOUS ATTEMPT REJECTED BY THE ${String(sourceViewType || "proof").toUpperCase()} PROOF INSPECTOR (${error.code}).`,
    "Correct exactly these findings on this attempt while keeping the artwork authority unchanged:",
    ...findings.map((entry) => `- ${entry}`),
    "Satisfy the locked contract above literally. Do not redesign, restyle, recolor or move any artwork to compensate.",
  ].join("\n").slice(0, 1200);
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
 * Appends the validator's own rejection findings to the slot prompt.
 *
 * The base prompt parts are never rewritten -- the camera, studio and artwork
 * authority contracts stay exactly as the worker assembled them, and the image
 * parts keep their order and position, which is what the Atlas conditioning
 * identity check reads. The correction is one extra trailing text part, and it
 * exists only on attempts that follow a rejection.
 */
function correctedParts(promptParts, corrections) {
  if (!Array.isArray(promptParts) || !corrections.length) return promptParts;
  return [...promptParts, { text: corrections.join("\n\n") }];
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
    allowOrphanReconciliation = true,
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
  // The inspector's findings from rejected attempts, carried forward so the
  // next call is a correction rather than a byte-identical re-roll. Attempt 1
  // is always the untouched contract prompt.
  const corrections = [];

  try {
    // 3. Storage-first reconciliation. A crash between upload and row commit
    //    leaves real bytes behind; finish that work instead of buying it twice.
    const orphan = allowOrphanReconciliation === false
      ? null
      : await store.findReconcilableBytes?.({ requestId, tenantKey, generationId, sourceViewType });
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
          parts: correctedParts(promptParts, corrections),
          aspectRatio, imageSize, signal, timeoutMs,
          // The direct transport ignores these identities. The Standard
          // DesignPanel server adapter uses the view identity and bounded
          // attempt number to select its designer/reproduction contract.
          requestId, generationId, sourceViewType, consumerRole, attempt,
          // Providers that rebuild their own parts (the anchored Standard
          // reproduction path) read the findings from here instead of the
          // trailing prompt part.
          corrections: [...corrections],
          label: `${sourceViewType} attempt ${attempt}`,
        });
      } catch (error) {
        failure = error;
      }

      const durationMs = now() - startedAt;

      // A SEMANTIC REJECTION THAT ARRIVES AS A THROW IS STILL A REJECTION.
      //
      // The Standard server provider runs its own proof inspector and signals a
      // failed inspection by throwing designpanel_quality_rejected. That lands
      // here, in the transport-failure branch, and everything downstream then
      // treats a QC verdict as a network fault:
      //
      //   - classifyFailure() matches none of its patterns, so the attempt is
      //     recorded as http_error with a null model;
      //   - `rejections` never increments, so the slot cannot reach
      //     maxRegenerations and terminates as provider_attempts_exhausted
      //     instead of semantic_review_required -- the state a human acts on;
      //   - and no correction is pushed, so the next attempt re-sends a
      //     byte-identical prompt.
      //
      // That last one is the expensive part: the run burns its whole budget
      // re-asking an unchanged question. Live proof, generation 2c0fc9f4
      // (2026-08-24), side: four attempts, four inspector rejections naming the
      // same invented phone number, recorded as four http_errors, then
      // provider_attempts_exhausted.
      //
      // Only this one code is re-routed. Every genuine transport, timeout,
      // abort, empty-response and unsupported-type failure keeps the branch
      // below unchanged -- a real provider fault must never be laundered into a
      // semantic rejection, because that would spend the regeneration budget on
      // something no amount of re-prompting can fix.
      if (failure && isSemanticQualityRejection(failure)) {
        rejections += 1;
        const correction = semanticRejectionCorrection(failure, sourceViewType);
        if (correction && !corrections.includes(correction)) corrections.push(correction);
        const record = {
          requestId, sourceViewType, attempt, model: failure.model || null, keyFingerprint: null,
          outcome: "rejected", durationMs, errorCode: failure.code,
          detail: String(failure.message || failure).slice(0, 500), winnerHash: null,
        };
        await store.recordAttemptFinished(record);
        attempts.push(record);
        continue;
      }

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
        verdict = await validate({
          bytes: result.bytes,
          contentType: result.contentType,
          sourceViewType,
          consumerRole,
          signal,
        });
      }
      // A verdict that never happened is neither acceptance nor rejection.
      // The inspector reports its own failures (every key 503, malformed
      // response, undeliverable image) as analyzerUnavailable; convicting on
      // one spends the two-slot regeneration budget on infrastructure noise,
      // which is exactly how 9dd6d43c close-up died. The attempt is recorded
      // and consumed -- the bounded loop still ends -- but the rejection
      // budget stays for verdicts a judge actually issued, and an unjudged
      // proof is still never persisted.
      if (!verdict?.accepted && verdict?.analyzerUnavailable === true) {
        const record = {
          requestId, sourceViewType, attempt, model: result.model, keyFingerprint: result.keyFingerprint,
          outcome: OUTCOME.HTTP_ERROR, durationMs,
          errorCode: verdict?.code || "qc_analyzer_unavailable",
          detail: String(verdict?.reason || "proof inspector unavailable").slice(0, 500), winnerHash: null,
        };
        await store.recordAttemptFinished(record);
        attempts.push(record);
        continue;
      }

      if (!verdict?.accepted) {
        rejections += 1;
        const correction = typeof verdict?.correction === "string" ? verdict.correction.trim() : "";
        if (correction && !corrections.includes(correction)) corrections.push(correction);
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
          ...(result.contract ? { providerContract: String(result.contract) } : {}),
          ...(result.metadata && typeof result.metadata === "object"
            ? { provider: result.metadata }
            : {}),
          ...(verdict?.metadata && typeof verdict.metadata === "object"
            ? { validation: verdict.metadata }
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
 * slot enforces its own. Any failed slot makes the request failed. A slot held
 * by another worker is deliberately pending: this runner cannot claim the
 * output is ready, and it must not convert another worker's active lease into a
 * terminal failure. Only an all-accepted result may become outputs_ready.
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
  const allAccepted = results.every((item) => item.state === "accepted");
  return {
    contract: ENGINE_CONTRACT,
    state: failed.length ? "failed" : allAccepted ? "outputs_ready" : "pending",
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
  _test: { classifyFailure, extensionFor, isSemanticQualityRejection, semanticRejectionCorrection, sha256 },
};
