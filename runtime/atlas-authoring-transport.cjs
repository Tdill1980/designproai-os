"use strict";

const { withinProofDeadline } = require("./atlas-proof-transport.cjs");

const MAX_OPERATION_MS = 180_000;
const EXCEPTION_CLASSES = new Set(["Error", "TypeError", "SyntaxError", "RangeError", "AbortError", "TimeoutError"]);

function transportError(code, retryable = false) {
  return Object.assign(new Error(code), { code, retryable });
}

function providerDiagnostic(value) {
  if (!value || value.contractVersion !== "designpro.gemini-http-diagnostic.v1"
    || !["request", "response_body"].includes(value.phase) || !EXCEPTION_CLASSES.has(value.exceptionClass)
    || !Number.isSafeInteger(value.elapsedMs) || value.elapsedMs < 0 || value.elapsedMs > 3_600_000
    || !(value.httpStatus === null || (Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599))) return null;
  return { contractVersion: value.contractVersion, phase: value.phase, exceptionClass: value.exceptionClass,
    httpStatus: value.httpStatus, elapsedMs: value.elapsedMs };
}

function providerFailureDetails(payload) {
  return { providerRetryDisposition: payload?.providerRetryDisposition || null,
    providerOutcome: payload?.providerOutcome || null, retryAfterSeconds: payload?.retryAfterSeconds ?? null,
    providerDiagnostic: providerDiagnostic(payload?.providerDiagnostic),
    providerFailureRecorded: payload?.providerFailureRecorded === true };
}

// The existing generation failure RPC stores a message, not arbitrary metadata.
// Include only this explicitly projected evidence so a saved job retains the
// diagnosis without persisting provider text, request content or signatures.
function providerFailureSummary(payload) {
  const value = providerDiagnostic(payload?.providerDiagnostic);
  return value ? ` [provider phase=${value.phase}; exception=${value.exceptionClass}; status=${value.httpStatus ?? "unavailable"}; elapsedMs=${value.elapsedMs}]` : "";
}

/** One possible image-producing POST, then bounded reads of THAT operation.
 * Call 1 and finishing keep their separate creative/identity validation in the
 * caller. This helper cannot increment an attempt or choose another model.
 */
async function invokeAtlasAuthoring({ url, headers, body, probe, fetchImpl = fetch, signal,
  timeoutMs = MAX_OPERATION_MS, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw transportError("flat_atlas_transport_timeout_invalid");
  }
  const operationDeadline = AbortSignal.timeout(Math.min(timeoutMs, MAX_OPERATION_MS));
  const operationSignal = signal ? AbortSignal.any([signal, operationDeadline]) : operationDeadline;
  const limited = ms => AbortSignal.any([operationSignal, AbortSignal.timeout(ms)]);
  const durable = Boolean(body.providerRequest);
  if (durable) {
    if (typeof probe !== "function") throw transportError("flat_atlas_provider_cache_not_deployed", true);
    const probeSignal = limited(10_000);
    try { await withinProofDeadline(() => probe(probeSignal), probeSignal); }
    catch (cause) {
      if (String(cause?.code || "").startsWith("flat_atlas_")) throw cause;
      throw transportError("flat_atlas_provider_cache_probe_failed", true);
    }
  }
  // Snapshot once. Recovery changes only the nonspending cacheOnly bit; an
  // asynchronous caller cannot change the artwork, lease or attempt mid-wait.
  let requestText;
  try { requestText = JSON.stringify(body); }
  catch { throw transportError("flat_atlas_transport_payload_invalid"); }
  const recoveryBody = durable ? JSON.parse(requestText) : null;
  if (recoveryBody) recoveryBody.providerRequest.cacheOnly = true;
  const recoveryText = recoveryBody ? JSON.stringify(recoveryBody) : null;
  const unknown = () => ({ response: { ok: false, status: 0 }, payload: {
    error: "provider_outcome_unknown", providerOutcome: "unknown",
    providerRetryDisposition: "operator_required", retryable: false,
  } });
  const read = async (text, requestSignal) => withinProofDeadline(async () => {
    const response = await fetchImpl(url, { method: "POST", headers, body: text, signal: requestSignal });
    let payload = null;
    try { payload = await response.json(); } catch { /* transport recovery below */ }
    return { response, payload };
  }, requestSignal);
  let result;
  try { result = await read(requestText, limited(135_000)); }
  catch (cause) {
    if (signal?.aborted) throw transportError("flat_atlas_transport_cancelled", true);
    if (!durable) throw cause;
    result = unknown();
  }
  const canRecover = ({ response, payload }) => {
    if (response.ok && payload?.success === true) return false;
    // Do not turn permission/identity failures into repeated requests. A
    // persisted HTTP rejection or interrupted provider operation also cannot
    // become a success through another lookup.
    if ([401, 403].includes(response.status) || payload?.providerFailureRecorded === true
      || /^provider_http_\d{3}$/.test(String(payload?.code || payload?.error || ""))) return false;
    if (!payload) return response.status === 0 || response.ok || response.status >= 500 || response.status === 408;
    return ["provider_outcome_unknown", "provider_cache_miss"].includes(payload.code || payload.error)
      || payload.retryable === true;
  };
  for (let index = 0; durable && canRecover(result) && index < 3; index += 1) {
    if (operationSignal.aborted) break;
    try {
      if (index) await withinProofDeadline(() => wait(index * 2000), operationSignal);
      const next = await read(recoveryText, limited(10_000));
      // Keep earlier structured failure evidence if a later lookup itself
      // loses its response. A successful/explicit response always replaces it.
      if (next.payload || [401, 403].includes(next.response.status)) result = next;
    } catch (cause) {
      if (signal?.aborted) throw transportError("flat_atlas_transport_cancelled", true);
    }
  }
  if (durable && !result.payload && [401, 403].includes(result.response.status)) {
    result = { ...result, payload: { error: "provider_authorization_failed", retryable: false } };
  } else if (durable && (!result.payload || result.payload.error === "provider_outcome_unknown")) {
    result = { ...result, payload: { ...unknown().payload, ...result.payload, retryable: false,
      providerRetryDisposition: "operator_required" } };
  }
  return result;
}

module.exports = { MAX_OPERATION_MS, invokeAtlasAuthoring, providerFailureDetails, providerFailureSummary };
