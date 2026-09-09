"use strict";

const PROOF_RECOVERY_CONTRACT = "designpro.atlas-proof-recovery.v1";
const MAX_OPERATION_MS = 180_000;

function proofError(code) {
  return Object.assign(new Error(code), { code, retryable: false });
}

// Abort the wait as well as the HTTP request. A response body or storage SDK
// promise must not hold a slot forever after the operation deadline expires.
async function withinProofDeadline(operation, signal) {
  signal.throwIfAborted();
  let onAbort;
  try {
    return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }), new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    })]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/** The capability read is essential: an old Edge ignores cacheOnly and would
 * generate again. Recovery is never sent until the new contract is proven.
 */
async function invokeAtlasProof({ url, headers, body, fetchImpl = fetch, signal,
  timeoutMs = MAX_OPERATION_MS, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw proofError("atlas_proof_timeout_invalid");
  const deadline = AbortSignal.timeout(Math.min(timeoutMs, MAX_OPERATION_MS));
  const operationSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const limited = ms => AbortSignal.any([operationSignal, AbortSignal.timeout(ms)]);
  const read = async (method, endpoint, requestBody, requestSignal) => withinProofDeadline(async () => {
    const response = await fetchImpl(endpoint, { method, headers,
      ...(requestBody ? { body: JSON.stringify(requestBody) } : {}), signal: requestSignal });
    const payload = await response.json();
    return { status: response.status, ok: response.ok, payload };
  }, requestSignal);

  const capability = await read("GET", `${url}?action=atlas-proof-capabilities`, null, limited(10_000));
  if (!capability.ok || capability.payload?.proofRecoveryContract !== PROOF_RECOVERY_CONTRACT
    || capability.payload.cacheOnly !== true) throw proofError("atlas_proof_recovery_unavailable");

  let result;
  try { result = await read("POST", url, body, limited(135_000)); }
  catch (error) {
    if (signal?.aborted) throw error;
    result = { ok: false, status: 0, payload: null };
  }
  const recoverable = value => value.status === 0 || value.status >= 500 || value.status === 408
    || value.payload?.error === "provider_outcome_unknown"
    || value.payload?.error === "provider_cache_miss"
    || value.payload?.retryable === true;
  // These are lookup attempts for the SAME model call. They cannot reserve an
  // operation, call Gemini, consume another token or create another generation.
  for (let index = 0; result.payload?.success !== true && recoverable(result) && index < 3; index += 1) {
    if (operationSignal.aborted) break;
    try {
      if (index) await withinProofDeadline(() => wait(index * 2000), operationSignal);
      result = await read("POST", url, { ...body,
        providerRequest: { ...body.providerRequest, cacheOnly: true } }, limited(10_000));
    } catch (error) {
      if (signal?.aborted) throw error;
      result = { ok: false, status: 0, payload: null };
    }
  }
  if (!result.ok || result.payload?.success !== true) {
    const code = String(result.payload?.error || "provider_outcome_unknown");
    throw proofError(/^[a-z][a-z0-9_]{0,100}$/.test(code) ? code : "designpanel_atlas_proof_failed");
  }
  const payload = result.payload;
  if (payload.proofRecoveryContract !== PROOF_RECOVERY_CONTRACT) throw proofError("atlas_proof_recovery_unavailable");
  for (const field of ["generationId", "atlasRevisionId", "shotKey", "surfaceKey", "sourcePanelStoragePath", "sourcePanelHash", "sourceMasterHash"]) {
    if (payload[field] !== body[field]) throw proofError("atlas_proof_response_identity_mismatch");
  }
  return { payload, signal: operationSignal };
}

module.exports = { PROOF_RECOVERY_CONTRACT, MAX_OPERATION_MS, withinProofDeadline, invokeAtlasProof };
