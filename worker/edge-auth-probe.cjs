"use strict";
/**
 * WHAT A run-production-flow AUTH-PROBE STATUS MEANS FOR A CLAIMANT.
 *
 * Both legacy claimants (designpro-workflow.cjs, designpro-entice-workflow.cjs)
 * probe run-production-flow before claiming a paid stage. They used to treat
 * "anything but 401/403" as healthy, so a 404 (the function is NOT DEPLOYED)
 * read as success: measured 2026-09-25, 576 POST run-production-flow -> 404 in
 * 24 h from the droplet (2 claimants x 288 five-minute probes), while every
 * stage they could claim would call a function that does not exist.
 *
 *   2xx / other 4xx  credential accepted, function exists     -> ok, 5 min
 *   401 / 403        credential rejected                      -> refuse, 5 min
 *   404              function not deployed                    -> refuse, 60 min
 *   5xx              function exists but cannot serve        -> refuse, 5 min
 *
 * A 404 is re-checked hourly (not every five minutes) so an undeployed
 * function costs 24 probes a day per claimant instead of 288, and a later
 * deploy is still picked up on its own.
 */
const AUTH_PROBE_TTL_MS = 5 * 60_000;
const NOT_DEPLOYED_TTL_MS = 60 * 60_000;

function authProbeVerdict(status) {
  const code = Number(status);
  if (code === 401 || code === 403) {
    return { ok: false, reason: "credentials_rejected", ttlMs: AUTH_PROBE_TTL_MS };
  }
  if (code === 404) {
    return { ok: false, reason: "function_not_deployed", ttlMs: NOT_DEPLOYED_TTL_MS };
  }
  if (!Number.isInteger(code) || code < 200 || code >= 500) {
    return { ok: false, reason: "function_unavailable", ttlMs: AUTH_PROBE_TTL_MS };
  }
  return { ok: true, reason: "accepted", ttlMs: AUTH_PROBE_TTL_MS };
}

function authProbeRefusalMessage(tag, verdict, status) {
  if (verdict.reason === "function_not_deployed") {
    return `[${tag}] refusing to claim: run-production-flow is not deployed (HTTP 404). Rechecking hourly; stop this claimant (docs/runbooks/stop-legacy-worker.md) or deploy the function.`;
  }
  if (verdict.reason === "function_unavailable") {
    return `[${tag}] refusing to claim: run-production-flow cannot serve (HTTP ${status}).`;
  }
  return `[${tag}] refusing to claim: run-production-flow rejected this runner's credentials (HTTP ${status}). Set WORKER_SECRET (and a current service key) in this environment, or retire this claimant.`;
}

module.exports = { AUTH_PROBE_TTL_MS, NOT_DEPLOYED_TTL_MS, authProbeVerdict, authProbeRefusalMessage };
