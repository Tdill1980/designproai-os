"use strict";

/**
 * Durable DesignPro revision -> Entice Pack worker.
 *
 * The worker is orchestration only. Generative work ends when Call 7 freezes
 * the flat proof and its production assets. Every later stage may only verify,
 * crop, register, persist, and deliver those exact frozen bytes.
 */

const { createHash } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const {
  createDesignProProofExtractV3,
} = require("./designpro-proof-extract-v3.cjs");

let SUPABASE_URL = "";
let SERVICE_KEY = "";
let WORKER_SECRET = "";
let SITE_URL = "https://www.restyleproai.com";
let pollTimer = null;
let pollBusy = false;
let activeClaims = 0;

const WORKFLOW_TYPE = "designpro.entice_pack";
const DEFINITION_VERSION = "designpro.entice_pack.v2";
// The database envelope remains v2 until the separately reviewed freeze/schema
// cutover. Every new proof/panel checkpoint is nevertheless bound to this exact
// adapter version, so a partially completed surface-master run cannot resume
// through the restored proof-extraction path.
const PANEL_ADAPTER_VERSION = "designpro.proof-extract.v4";
const CALL7_SURFACE_CONTRACT = "call7-proof-region-v1";
const CALL7_TRANSFORM_CONTRACT = "call7-proof-region-transform.v1";
// GENIE gridslice itself is unchanged; retain its existing contract version.
const MASTER_SHEET_VERSION = 7;
const CLAIM_CONTEXT = new AsyncLocalStorage();
const FINGERPRINT_POOL = 3;
const PANEL_BUILD_POOL = 3;
const SEPARATION_POOL = (() => {
  const configured = Number(
    process.env.DESIGNPRO_LOGO_SEPARATION_POOL || 2,
  );
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 3
    ? configured
    : 2;
})();
const HEARTBEAT_CACHE_MS = 15_000;
const TOOL_CONTRACTS = Object.freeze({
  genie: "panelizer-step-validate.contract-2026-07-28",
  proof:
    "generate-2d-proof.call7-frozen-surface-assets-v1-2026-08-05",
  proofIdempotency:
    "generate-2d-proof.normal-revision-idempotency.v2",
  proofSourceEvidence:
    "generate-2d-proof.normal-source-evidence.v1",
  proofCrop: "panelize-artboard.call7-proof-region-code-only-v1-2026-08-05",
  gridSlice: `panel-artboard-generator.gridslice.v${MASTER_SHEET_VERSION}`,
  proofExtract: CALL7_SURFACE_CONTRACT,
  passengerMirror: "disabled-after-call7-v1",
  logoSeparation: CALL7_SURFACE_CONTRACT,
  vault: "save-production-panels.call7-paired-assets-v2",
});
const STANDARD_SIDES = [
  "DRIVER SIDE",
  "PASSENGER SIDE",
  "HOOD",
  "ROOF",
  "FRONT",
  "REAR",
];
const TRAILER_SIDES = [
  "DRIVER SIDE",
  "PASSENGER SIDE",
  "FRONT",
  "REAR",
];
const VIEW_KEYS = {
  "DRIVER SIDE": ["side", "driver-side", "driver_side", "driver"],
  "PASSENGER SIDE": [
    "passenger",
    "passenger-side",
    "passenger_side",
    "opposite_side",
  ],
  HOOD: ["hood_detail", "hood"],
  ROOF: ["roof", "top"],
  FRONT: ["front"],
  REAR: ["rear", "back"],
};
const DERIVED_RENDER_KEY =
  /(^|[_\s-])(proof|panel|artboard|logo|overlay|master|pack|zip|tiff|eps|production|clean|background)($|[_\s-])/i;
const DERIVED_RENDER_PATH =
  /\/(?:2d-proofs|panels|graphics-pack|production-packs|artboards)\//i;

class StageFailure extends Error {
  constructor(
    code,
    message,
    retryable = true,
    retryDelaySeconds = 20,
    details = {},
  ) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.retryDelaySeconds = retryDelaySeconds;
    this.details = details;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256")
    .update(
      typeof value === "string"
        ? value
        : JSON.stringify(canonicalize(value)),
    )
    .digest("hex");
}

async function mapBounded(items, limit, mapper) {
  const input = Array.from(items || []);
  if (!input.length) return [];
  const output = new Array(input.length);
  let cursor = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, limit), input.length) },
      async () => {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= input.length) return;
          output[index] = await mapper(input[index], index);
        }
      },
    ),
  );
  return output;
}

function parseObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function objectOfStrings(value) {
  const input = parseObject(value);
  const result = {};
  for (const [key, item] of Object.entries(input)) {
    if (typeof item === "string" && item.trim()) result[key] = item.trim();
  }
  return result;
}

function sourceRenderUrls(value) {
  return Object.fromEntries(
    Object.entries(objectOfStrings(value)).filter(([key, url]) => {
      const normalizedKey = String(key)
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase();
      return (
        normalizedKey &&
        !DERIVED_RENDER_KEY.test(normalizedKey) &&
        !/(proof2?_?d|2d_?proof|master_?artboard|logo_?pack)/.test(
          normalizedKey,
        ) &&
        !/(^|[_\s-])(close|macro|zoom)($|[_\s-])/.test(normalizedKey) &&
        !DERIVED_RENDER_PATH.test(url)
      );
    }),
  );
}

function fingerprintEvidence(value) {
  const input = parseObject(value);
  const result = {};
  for (const [key, item] of Object.entries(input)) {
    const evidence = parseObject(item);
    const hash = String(evidence.sha256 || "").toLowerCase();
    const bytes = Number(evidence.bytes || 0);
    if (/^[0-9a-f]{64}$/.test(hash) && Number.isSafeInteger(bytes) && bytes > 0) {
      result[key] = { sha256: hash, bytes };
    }
  }
  return result;
}

function assertFrozenFingerprints(
  expectedValue,
  observedValue,
  code = "revision_material_changed",
  message = "A frozen revision source changed after the revision was recorded",
) {
  const expected = fingerprintEvidence(expectedValue);
  const observed = fingerprintEvidence(observedValue);
  const expectedKeys = Object.keys(expected).sort();
  const observedKeys = Object.keys(observed).sort();
  const missing = expectedKeys.filter((key) => !observedKeys.includes(key));
  const added = observedKeys.filter((key) => !expectedKeys.includes(key));
  // Name the artifact that actually moved. Previously this reported only the
  // two key LISTS, which are identical whenever the difference is byte-level —
  // so a real mismatch surfaced as "A verified pack artifact changed" with no
  // way to tell which of 19 artifacts it was. Diagnosing it meant guessing.
  const changed = expectedKeys
    .filter((key) => observedKeys.includes(key))
    .filter(
      (key) =>
        expected[key].sha256 !== observed[key].sha256 ||
        expected[key].bytes !== observed[key].bytes,
    )
    .map((key) => ({
      key,
      expectedSha256: expected[key].sha256 || null,
      observedSha256: observed[key].sha256 || null,
      expectedBytes: expected[key].bytes ?? null,
      observedBytes: observed[key].bytes ?? null,
      url: expectedValue?.[key]?.url || observedValue?.[key]?.url || null,
    }));
  if (missing.length || added.length || changed.length) {
    throw new StageFailure(
      code,
      changed.length
        ? `${message} — ${changed.map((c) => c.key).join(", ")}`
        : message,
      false,
      0,
      { expectedKeys, observedKeys, missing, added, changed },
    );
  }
}

function isLeaseFailure(error) {
  return (
    error instanceof StageFailure &&
    (error.code === "workflow_lease_lost" ||
      error.code === "claim_context_missing")
  );
}

function rethrowFatal(error) {
  if (!(error instanceof StageFailure)) throw error;
  if (isLeaseFailure(error)) throw error;
  if (!error.retryable) throw error;
}

function responseRetryDelaySeconds(response, data, fallbackSeconds) {
  const candidates = [];
  const bodyDelay = Number(data?.retryAfterSeconds);
  if (Number.isFinite(bodyDelay) && bodyDelay >= 0) {
    candidates.push(bodyDelay);
  }
  const retryAfter = String(response?.headers?.get("retry-after") || "")
    .trim();
  if (retryAfter) {
    const numericDelay = Number(retryAfter);
    if (Number.isFinite(numericDelay) && numericDelay >= 0) {
      candidates.push(numericDelay);
    } else {
      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt)) {
        candidates.push(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
      }
    }
  }
  const fallback = Number(fallbackSeconds);
  if (!candidates.length) {
    candidates.push(Number.isFinite(fallback) ? fallback : 15);
  }
  return Math.min(900, Math.max(1, ...candidates));
}

function combinedSignal(timeoutMs) {
  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(),
    timeoutMs,
  );
  timer.unref?.();
  const claimSignal = CLAIM_CONTEXT.getStore()?.controller.signal;
  return {
    signal: claimSignal
      ? AbortSignal.any([claimSignal, timeoutController.signal])
      : timeoutController.signal,
    cancel: () => clearTimeout(timer),
  };
}

async function assertClaimOwned(forceHeartbeat = false) {
  const claim = CLAIM_CONTEXT.getStore();
  if (!claim) {
    throw new StageFailure(
      "claim_context_missing",
      "A side-effecting stage ran without a workflow lease context",
      false,
    );
  }
  if (claim.controller.signal.aborted) {
    throw new StageFailure(
      "workflow_lease_lost",
      "Workflow lease ownership was lost",
      true,
      5,
    );
  }
  if (typeof claim.renewHeartbeat === "function") {
    const current = await claim.renewHeartbeat(forceHeartbeat);
    if (current === true) return;
    throw new StageFailure(
      "workflow_lease_lost",
      "Workflow lease ownership was lost",
      true,
      5,
    );
  }
  const { data, error } = await claim.db.rpc("heartbeat_workflow_stage", {
    p_stage_id: claim.stageId,
    p_lease_token: claim.leaseToken,
    p_lease_seconds: 900,
  });
  if (error || data !== true) {
    claim.controller.abort();
    throw new StageFailure(
      "workflow_lease_lost",
      error?.message || "Workflow lease ownership was lost",
      true,
      5,
    );
  }
}

function safeAssetUrl(raw) {
  try {
    const parsed = new URL(String(raw || ""));
    const configured = String(
      process.env.DESIGNPRO_PRODUCTION_ASSET_HOSTS || "",
    )
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    const runtimeHosts = [SUPABASE_URL, SITE_URL]
      .flatMap((value, index) => {
        try {
          const host = new URL(value).hostname.toLowerCase();
          if (index === 0) return [host];
          if (host.startsWith("www.")) return [host, host.slice(4)];
          return [host, `www.${host}`];
        } catch {
          return [];
        }
      });
    const hostname = parsed.hostname.toLowerCase();
    const allowed = new Set([...runtimeHosts, ...configured]);
    const blocked =
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    return parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !blocked &&
      allowed.has(hostname)
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

async function fingerprintAsset(rawUrl) {
  const url = safeAssetUrl(rawUrl);
  if (!url) {
    throw new StageFailure(
      "invalid_material_url",
      "Revision material URL is missing or outside the production allowlist",
      false,
    );
  }
  const request = combinedSignal(120_000);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      cache: "no-store",
      headers: {
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      signal: request.signal,
    });
    if (!response.ok || !response.body) {
      throw new StageFailure(
        "source_fingerprint_unavailable",
        `Unable to read revision material (HTTP ${response.status})`,
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
        30,
        { url: `${new URL(url).origin}${new URL(url).pathname}` },
      );
    }
    const declared = Number(response.headers.get("content-length") || 0);
    const configuredMaxBytes = Number(
      process.env.DESIGNPRO_FINGERPRINT_MAX_BYTES || 64 * 1024 * 1024,
    );
    const maxBytes = Number.isFinite(configuredMaxBytes)
      ? Math.min(
          Math.max(configuredMaxBytes, 1024 * 1024),
          256 * 1024 * 1024,
        )
      : 64 * 1024 * 1024;
    if (declared > maxBytes) {
      throw new StageFailure(
        "source_too_large",
        "Revision material exceeds the fingerprint limit",
        false,
      );
    }
    const hash = createHash("sha256");
    const reader = response.body.getReader();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("fingerprint limit exceeded");
        throw new StageFailure(
          "source_too_large",
          "Revision material exceeds the fingerprint limit",
          false,
        );
      }
      hash.update(Buffer.from(value));
    }
    if (!bytes) {
      throw new StageFailure(
        "source_empty",
        "Revision material is empty",
        false,
      );
    }
    const strongValidator = strongestHeadValidator(response.headers);
    let reusableValidatorEvidence =
      strongValidator &&
      Number.isSafeInteger(declared) &&
      declared > 0 &&
      declared === bytes
        ? {
            validatorKind: strongValidator.validatorKind,
            validator: strongValidator.validator,
            contentLength: declared,
          }
        : {};
    if (!Object.keys(reusableValidatorEvidence).length) {
      reusableValidatorEvidence =
        (await strongEvidenceAfterHashedGet(url, bytes)) || {};
    }
    return {
      url,
      sha256: hash.digest("hex"),
      bytes,
      contentType: response.headers.get("content-type") || null,
      verificationMode: "sha256_get",
      ...reusableValidatorEvidence,
    };
  } catch (error) {
    if (error instanceof StageFailure) throw error;
    if (CLAIM_CONTEXT.getStore()?.controller.signal.aborted) {
      throw new StageFailure(
        "workflow_lease_lost",
        "Workflow lease ownership was lost while reading an artifact",
        true,
        5,
      );
    }
    const timedOut =
      error?.name === "AbortError" || error?.name === "TimeoutError";
    throw new StageFailure(
      timedOut
        ? "source_fingerprint_timeout"
        : "source_fingerprint_transport",
      timedOut
        ? "Timed out while reading revision material"
        : String(error?.message || error),
      true,
      timedOut ? 30 : 15,
    );
  } finally {
    request.cancel();
  }
}

function reusableFrozenEvidence(value) {
  const evidence = parseObject(value);
  const sha = String(evidence.sha256 || "").toLowerCase();
  const bytes = Number(evidence.bytes || 0);
  const contentLength = Number(evidence.contentLength || 0);
  const validatorKind = String(evidence.validatorKind || "")
    .trim()
    .toLowerCase();
  const validator = String(evidence.validator || "").trim();
  const supportedKinds = new Set([
    "object-version",
    "x-goog-generation",
    "x-amz-version-id",
    "x-ms-version-id",
    "etag",
  ]);
  if (
    !/^[0-9a-f]{64}$/.test(sha) ||
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    !Number.isSafeInteger(contentLength) ||
    contentLength <= 0 ||
    bytes !== contentLength ||
    !supportedKinds.has(validatorKind) ||
    !validator ||
    (validatorKind === "etag" && /^W\//i.test(validator))
  ) {
    return null;
  }
  return {
    sha256: sha,
    bytes,
    contentLength,
    validatorKind,
    validator,
    contentType:
      typeof evidence.contentType === "string"
        ? evidence.contentType
        : null,
  };
}

function strongestHeadValidator(headers) {
  for (const kind of [
    "x-goog-generation",
    "x-amz-version-id",
    "x-ms-version-id",
  ]) {
    const validator = String(headers.get(kind) || "").trim();
    if (validator && validator.toLowerCase() !== "null") {
      return { validatorKind: kind, validator };
    }
  }
  const etag = String(headers.get("etag") || "").trim();
  if (etag && !/^W\//i.test(etag)) {
    return { validatorKind: "etag", validator: etag };
  }
  return null;
}

async function strongEvidenceAfterHashedGet(url, bytes) {
  const request = combinedSignal(20_000);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      headers: {
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      signal: request.signal,
    });
    if (!response.ok) return null;
    const observed = strongestHeadValidator(response.headers);
    const contentLength = Number(
      response.headers.get("content-length") || 0,
    );
    if (
      !observed ||
      !Number.isSafeInteger(contentLength) ||
      contentLength <= 0 ||
      contentLength !== bytes
    ) {
      return null;
    }
    return {
      validatorKind: observed.validatorKind,
      validator: observed.validator,
      contentLength,
    };
  } catch (error) {
    if (CLAIM_CONTEXT.getStore()?.controller.signal.aborted) {
      throw new StageFailure(
        "workflow_lease_lost",
        "Workflow lease ownership was lost while attesting hashed source material",
        true,
        5,
      );
    }
    return null;
  } finally {
    request.cancel();
  }
}

async function reuseFrozenFingerprint(rawUrl, submittedValue) {
  const submitted = reusableFrozenEvidence(submittedValue);
  const url = safeAssetUrl(rawUrl);
  if (!submitted || !url) return null;
  const request = combinedSignal(20_000);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      headers: {
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      signal: request.signal,
    });
    if (!response.ok) return null;
    const observed = strongestHeadValidator(response.headers);
    const contentLength = Number(
      response.headers.get("content-length") || 0,
    );
    const validatorKindMatches =
      submitted.validatorKind === "object-version"
        ? observed?.validatorKind !== "etag"
        : observed?.validatorKind === submitted.validatorKind;
    if (
      !observed ||
      !validatorKindMatches ||
      observed.validator !== submitted.validator ||
      !Number.isSafeInteger(contentLength) ||
      contentLength <= 0 ||
      contentLength !== submitted.contentLength
    ) {
      return null;
    }
    return {
      url,
      sha256: submitted.sha256,
      bytes: submitted.bytes,
      contentType:
        response.headers.get("content-type") ||
        submitted.contentType ||
        null,
      validatorKind: submitted.validatorKind,
      validator: submitted.validator,
      contentLength,
      verificationMode: "validator_reuse",
    };
  } catch (error) {
    if (CLAIM_CONTEXT.getStore()?.controller.signal.aborted) {
      throw new StageFailure(
        "workflow_lease_lost",
        "Workflow lease ownership was lost while validating source material",
        true,
        5,
      );
    }
    // HEAD support and validator quality vary by object store. Any ambiguity
    // deliberately falls through to the byte-for-byte GET below.
    return null;
  } finally {
    request.cancel();
  }
}

async function fingerprintMap(urls) {
  const entries = Object.entries(urls).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const byUrl = new Map();
  const evidence = await mapBounded(
    entries,
    FINGERPRINT_POOL,
    async ([key, url]) => {
      let pending = byUrl.get(url);
      if (!pending) {
        pending = fingerprintAsset(url);
        byUrl.set(url, pending);
      }
      return [key, await pending];
    },
  );
  return Object.fromEntries(evidence);
}

async function fingerprintFrozenSources(urls, submittedFingerprints) {
  const entries = Object.entries(urls).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const submitted = parseObject(submittedFingerprints);
  const byIdentity = new Map();
  const evidence = await mapBounded(
    entries,
    FINGERPRINT_POOL,
    async ([key, url]) => {
      const expected = parseObject(submitted[key]);
      const identity = JSON.stringify([
        url,
        expected.sha256 || null,
        expected.bytes || null,
        expected.validatorKind || null,
        expected.validator || null,
        expected.contentLength || null,
      ]);
      let pending = byIdentity.get(identity);
      if (!pending) {
        pending = (async () => {
          const reused = await reuseFrozenFingerprint(url, expected);
          return reused || (await fingerprintAsset(url));
        })();
        byIdentity.set(identity, pending);
      }
      return [key, await pending];
    },
  );
  return Object.fromEntries(evidence);
}

async function callFn(name, body, timeoutMs = 180_000) {
  await assertClaimOwned();
  const request = combinedSignal(timeoutMs);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "x-worker-secret": WORKER_SECRET,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      const requestedRetryDelay = responseRetryDelaySeconds(
        response,
        data,
        response.status === 429 ? 30 : 15,
      );
      const upstreamError = String(
        data?.error || `${name} returned HTTP ${response.status}`,
      );
      // A transient cause reported inside a 2xx `success:false` envelope is
      // still transient. Match the cause as well as the HTTP status so the
      // durable retry contract remains accurate.
      const transientCause =
        /\b(timed?\s*out|timeout|aborted|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|temporarily unavailable|rate limit|too many requests|overloaded|502|503|504)\b/i
          .test(upstreamError);
      throw new StageFailure(
        `${name.replace(/[^a-z0-9]+/gi, "_")}_failed`,
        upstreamError,
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500 ||
          data?.retryable === true ||
          transientCause,
        requestedRetryDelay,
        // A `success:false` envelope carries the whole diagnosis — which gate
        // refused, and the measurement it refused on (`qc.ringDiff`,
        // `qc.roundTripDiff`). Dropping it left `workflow_stage_runs.
        // error_details` reading `{"httpStatus":200,"functionName":...}` for a
        // ring-gate reject, so the reason had to be reconstructed by hand from
        // the message. Carry the envelope's own fields through.
        {
          functionName: name,
          httpStatus: response.status,
          upstreamCode: data?.code || null,
          upstreamStage: data?.stage ?? null,
          upstreamQc: data?.qc ?? null,
          upstreamReason: data?.reason ?? null,
          upstreamSide: data?.side ?? null,
          upstreamRetryable: data?.retryable ?? null,
        },
      );
    }
    await assertClaimOwned();
    return data;
  } catch (error) {
    if (error instanceof StageFailure) throw error;
    if (CLAIM_CONTEXT.getStore()?.controller.signal.aborted) {
      throw new StageFailure(
        "workflow_lease_lost",
        "Workflow lease ownership was lost during an adapter call",
        true,
        5,
      );
    }
    const timedOut =
      error?.name === "AbortError" || error?.name === "TimeoutError";
    throw new StageFailure(
      timedOut
        ? `${name.replace(/[^a-z0-9]+/gi, "_")}_timeout`
        : `${name.replace(/[^a-z0-9]+/gi, "_")}_transport`,
      timedOut
        ? `${name} timed out after ${Math.round(timeoutMs / 1000)} seconds`
        : `${name}: ${String(error?.message || error)}`,
      true,
      timedOut ? 30 : 15,
      { functionName: name },
    );
  } finally {
    request.cancel();
  }
}

async function callSiteApi(pathname, body, timeoutMs = 120_000) {
  await assertClaimOwned();
  const request = combinedSignal(timeoutMs);
  try {
    const response = await fetch(
      `${SITE_URL.replace(/\/$/, "")}${pathname}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.url) {
      throw new StageFailure(
        "deterministic_proof_composition_failed",
        String(data?.error || `proof composer returned HTTP ${response.status}`),
        response.status === 408 || response.status === 429 || response.status >= 500,
        response.status === 429 ? 30 : 15,
      );
    }
    await assertClaimOwned();
    return data;
  } finally {
    request.cancel();
  }
}

/**
 * The single field in each stage's output that its persisted `output_hash` is
 * the hash OF. Adding a hash to a stage's output must never silently re-point
 * this binding, so the field is named per stage rather than discovered by
 * precedence. A stage with no entry publishes no output identity to bind.
 */
const STAGE_OUTPUT_HASH_FIELD = {
  "revision.freeze": "canonicalInputHash", // freezeRevision  -> outputHash: canonicalInputHash
  "manifest.resolve": "manifestHash", //      resolveManifest -> outputHash: manifestHash
  "proof.build": "proofHash", //              buildProof      -> outputHash: output.proofHash
  "artboards.build": "surfaceAssetsHash", //  buildArtboards  -> outputHash: registry.surfaceAssetsHash
  "panels.build": "panelHash", //             buildPanels     -> outputHash: panelHash
  "logos.extract": "separationHash", //       extractLogos    -> outputHash: separationHash
  "pack.verify": "packIdentityHash", //       verify_designpro_entice_pack RPC
};

/**
 * Does a completed stage's persisted `output_hash` still equal the identity
 * hash that stage produced? A stage with no published output identity, or a
 * row with no persisted hash, has nothing to contradict and holds trivially.
 */
function checkpointHashBindingHolds(stageKey, output, outputHash) {
  const field = STAGE_OUTPUT_HASH_FIELD[stageKey];
  const internalHash = field ? (output || {})[field] || null : null;
  if (!outputHash || !internalHash) return true;
  return String(outputHash) === String(internalHash);
}

async function stageOutput(db, runId, stageKey) {
  const { data, error } = await db
    .from("workflow_stage_runs")
    .select("output,output_hash,verification,status")
    .eq("run_id", runId)
    .eq("stage_key", stageKey)
    .eq("scope_key", "")
    .maybeSingle();
  if (
    error ||
    !data ||
    data.status !== "completed" ||
    data.verification?.verified !== true
  ) {
    throw new StageFailure(
      "checkpoint_missing",
      `Required checkpoint ${stageKey} is unavailable`,
      true,
      15,
      { databaseError: error?.message || null },
    );
  }
  const output = data.output || {};
  // Bind each stage to the hash IT PRODUCED, by name.
  //
  // This was a first-match-wins chain over every hash any stage might emit:
  // canonicalInputHash || manifestHash || proofHash || panelHash || ...
  // That only held while each stage's output carried exactly one of them. It
  // stopped holding the moment `proof.build` began reporting the idempotency
  // and manifest hashes it CONSUMED alongside the proof hash it PRODUCED:
  // the chain then read `canonicalInputHash` — an input identity — and
  // compared it to `output_hash`, which is by definition the output's.
  //
  // Live: 2026-08-10 16:56 UTC. proof.build completed with output_hash
  // 6adb6695 == output.proofHash 6adb6695, and artboards.build still rejected
  // it as `checkpoint_hash_mismatch` because the chain picked b3962ba1. The
  // same packs on 2026-08-03 and 2026-08-05, whose proof.build output carried
  // proofHash alone, passed the identical check and ran through pack.activate.
  //
  // A stage absent from this map publishes no output identity of its own
  // (artboards.build persists no output_hash; pack.activate persists no inner
  // hash), so it has nothing to bind and is left unchecked, as before.
  if (!checkpointHashBindingHolds(stageKey, output, data.output_hash)) {
    throw new StageFailure(
      "checkpoint_hash_mismatch",
      `Required checkpoint ${stageKey} failed its persisted hash binding`,
      false,
    );
  }
  return output;
}

async function loadContext(db, runId) {
  const { data: run, error: runError } = await db
    .from("workforce_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (
    runError ||
    !run ||
    run.workflow_type !== WORKFLOW_TYPE ||
    run.domain_job_type !== "designpro_entice_packs"
  ) {
    throw new StageFailure(
      "workflow_domain_binding_invalid",
      "Entice workflow envelope is not bound to its domain pack",
      false,
      0,
      { databaseError: runError?.message || null },
    );
  }
  const { data: pack, error: packError } = await db
    .from("designpro_entice_packs")
    .select("*")
    .eq("id", run.domain_job_id)
    .eq("workflow_run_id", run.id)
    .maybeSingle();
  if (packError || !pack) {
    throw new StageFailure(
      "entice_pack_not_found",
      "Revision-bound Entice Pack record is unavailable",
      false,
      0,
      { databaseError: packError?.message || null },
    );
  }
  if (String(pack.definition_version || "") !== DEFINITION_VERSION) {
    throw new StageFailure(
      "entice_definition_unsupported",
      `This worker cannot execute ${String(pack.definition_version || "an unversioned definition")}`,
      false,
    );
  }
  const { data: revision, error: revisionError } = await db
    .from("design_version_commits")
    .select("*")
    .eq("id", pack.revision_id)
    .eq("workflow_run_id", run.id)
    .eq("entice_pack_id", pack.id)
    .maybeSingle();
  if (revisionError || !revision) {
    throw new StageFailure(
      "revision_not_found",
      "Frozen design revision is unavailable",
      false,
      0,
      { databaseError: revisionError?.message || null },
    );
  }
  if (
    String(run.tenant_key || "") !== String(pack.tenant_key || "") ||
    String(pack.tenant_key || "") !== `user:${String(pack.user_id || "")}` ||
    String(pack.design_id || "") !==
      String(pack.designiq_generation_id || "") ||
    String(revision.designiq_generation_id || "") !==
      String(pack.designiq_generation_id || "") ||
    String(revision.source_visualization_id || "") !==
      String(pack.source_visualization_id || "") ||
    String(revision.user_id || "") !== String(pack.user_id || "")
  ) {
    throw new StageFailure(
      "entice_tenant_binding_invalid",
      "Revision, pack, and workflow tenant bindings do not match",
      false,
    );
  }
  if (String(run.requested_by || "") !== String(pack.user_id || "")) {
    const { data: role, error: roleError } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", run.requested_by)
      .in("role", ["admin", "tester"])
      .limit(1)
      .maybeSingle();
    if (roleError) {
      throw new StageFailure(
        "entice_actor_role_unavailable",
        "Unable to verify the workflow actor",
        true,
        15,
        { databaseError: roleError.message },
      );
    }
    if (!role) {
      throw new StageFailure(
        "entice_actor_not_authorized",
        "The workflow actor is not the design owner or an operator",
        false,
      );
    }
  }
  return { run, pack, revision };
}

function viewUrlForSide(side, viewUrls) {
  for (const key of VIEW_KEYS[side] || []) {
    if (viewUrls[key]) return viewUrls[key];
  }
  return null;
}

function normalizeExpectedSides(options, isTrailer) {
  const supported = new Set(isTrailer ? TRAILER_SIDES : STANDARD_SIDES);
  const supplied =
    options.expectedPanelSides ||
    options.expected_panel_sides ||
    options.expectedSides;
  if (Array.isArray(supplied) && supplied.length) {
    const normalized = Array.from(
      new Set(
        supplied
          .map((side) => String(side || "").trim().toUpperCase())
          .filter((side) => supported.has(side)),
      ),
    );
    if (normalized.length === supplied.length && normalized.length) {
      return normalized;
    }
    throw new StageFailure(
      "surface_manifest_invalid",
      "Saved surface options contain unsupported or duplicate surfaces",
      false,
    );
  }
  if (isTrailer) return [...TRAILER_SIDES];
  const hasExplicitOptions = [
    "addHood",
    "addRoof",
    "addFrontBumper",
    "addRearBumper",
    "roofSize",
  ].some((key) => Object.prototype.hasOwnProperty.call(options, key));
  if (!hasExplicitOptions) return [...STANDARD_SIDES];
  return [
    "DRIVER SIDE",
    "PASSENGER SIDE",
    ...(options.addHood === true ? ["HOOD"] : []),
    ...(options.addRoof === true ||
    String(options.roofSize || "none").toLowerCase() !== "none"
      ? ["ROOF"]
      : []),
    ...(options.addFrontBumper === true ? ["FRONT"] : []),
    ...(options.addRearBumper === true ? ["REAR"] : []),
  ];
}

function dimensionsFromGeniePayload(data, isTrailer = false) {
  const dims = {};
  const vehicle = data?.vehicle || data?.estimatedDimensions || {};
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  if (isTrailer) {
    const sideW = number(vehicle.bodyLengthInches);
    const sideH = number(vehicle.bodyHeightInches);
    const wallW = number(vehicle.backWidthInches);
    const wallH = number(
      vehicle.backHeightInches || vehicle.bodyHeightInches,
    );
    if (sideW && sideH) {
      dims["DRIVER SIDE"] = { w: sideW, h: sideH };
      dims["PASSENGER SIDE"] = { w: sideW, h: sideH };
    }
    if (wallW && wallH) {
      dims.FRONT = { w: wallW, h: wallH };
      dims.REAR = { w: wallW, h: wallH };
    }
    return dims;
  }

  const panels = Array.isArray(data?.panels) ? data.panels : [];
  const find = (pattern) =>
    panels.find((panel) =>
      pattern.test(
        `${panel?.panelKey || ""} ${panel?.label || ""}`.toLowerCase(),
      ),
    );
  const side = find(/driver|(^|[^a-z])side/);
  const assignments = [
    ["DRIVER SIDE", side],
    ["PASSENGER SIDE", side],
    ["HOOD", find(/hood/i)],
    ["ROOF", find(/roof|top/i)],
    ["FRONT", find(/front/i)],
    ["REAR", find(/rear|back/i)],
  ];
  for (const [side, panel] of assignments) {
    const w = number(panel?.widthInches || panel?.width);
    const h = number(panel?.heightInches || panel?.height);
    if (w && h) dims[side] = { w, h };
  }
  return dims;
}

function stampedDimensions(dims) {
  return {
    sideW: dims["DRIVER SIDE"]?.w,
    sideH: dims["DRIVER SIDE"]?.h,
    hoodW: dims.HOOD?.w,
    hoodL: dims.HOOD?.h,
    roofW: dims.ROOF?.w,
    roofL: dims.ROOF?.h,
    frontW: dims.FRONT?.w,
    frontH: dims.FRONT?.h,
    backW: dims.REAR?.w,
    backH: dims.REAR?.h,
  };
}

async function freezeRevision(db, runId) {
  const { run, pack, revision } = await loadContext(db, runId);
  const snapshot = parseObject(revision.revision_snapshot);
  const renderUrls = sourceRenderUrls(snapshot.renderUrls);
  if (
    !revision.frozen_at ||
    snapshot.contractVersion !== "designpro.revision-snapshot.v1" ||
    String(snapshot.designId || "") !== String(pack.designiq_generation_id) ||
    String(snapshot.visualizationId || "") !==
      String(pack.source_visualization_id) ||
    revision.revision_snapshot_hash !== run.input_hash ||
    pack.submission_hash !== run.input_hash
  ) {
    throw new StageFailure(
      "revision_snapshot_binding_invalid",
      "Frozen revision identity does not match the workflow envelope",
      false,
    );
  }
  if (!Object.keys(renderUrls).length) {
    throw new StageFailure(
      "revision_render_set_missing",
      "Frozen revision has no render URLs",
      false,
    );
  }
  await assertClaimOwned();
  const submittedFingerprints = Object.fromEntries(
    Object.entries(parseObject(snapshot.materialFingerprints)).filter(
      ([key]) => Object.prototype.hasOwnProperty.call(renderUrls, key),
    ),
  );
  const sourceFingerprints = await fingerprintFrozenSources(
    renderUrls,
    submittedFingerprints,
  );
  const submittedFingerprintKeys = Object.keys(
    fingerprintEvidence(submittedFingerprints),
  );
  if (submittedFingerprintKeys.length) {
    assertFrozenFingerprints(
      submittedFingerprints,
      sourceFingerprints,
    );
  }
  const canonicalInputHash = sha256({
    definitionVersion: DEFINITION_VERSION,
    surfaceRulesVersion: "designpro.surface-manifest.v1",
    masterSheetVersion: MASTER_SHEET_VERSION,
    toolContracts: TOOL_CONTRACTS,
    snapshot: {
      ...snapshot,
      materialFingerprints: undefined,
      renderUrls,
    },
    sourceFingerprints: fingerprintEvidence(sourceFingerprints),
  });
  if (!/^[0-9a-f]{64}$/.test(canonicalInputHash)) {
    throw new StageFailure(
      "canonical_input_hash_invalid",
      "The workflow envelope has no valid canonical input hash",
      false,
    );
  }
  await assertClaimOwned();
  return {
    output: {
      packId: pack.id,
      revisionId: revision.id,
      designId: pack.design_id,
      visualizationId: pack.source_visualization_id,
      snapshot,
      renderUrls,
      sourceFingerprints,
      canonicalInputHash,
      requestHash: String(run.input_hash || "").toLowerCase(),
    },
    verification: {
      verified: true,
      kind: "frozen_revision",
      renderCount: Object.keys(renderUrls).length,
      sourceBytesVerified: true,
      submittedFingerprintsMatchObservedBytes:
        submittedFingerprintKeys.length > 0,
      validatorReuseCount: Object.values(sourceFingerprints).filter(
        (item) => item?.verificationMode === "validator_reuse",
      ).length,
      sha256GetCount: Object.values(sourceFingerprints).filter(
        (item) => item?.verificationMode === "sha256_get",
      ).length,
    },
    outputHash: canonicalInputHash,
  };
}

async function resolveManifest(db, runId) {
  const frozen = await stageOutput(db, runId, "revision.freeze");
  const snapshot = parseObject(frozen.snapshot);
  const vehicle = parseObject(snapshot.vehicle);
  const options = parseObject(snapshot.surfaceOptions);
  const declaredVehicleType = String(vehicle.type || "")
    .trim()
    .toLowerCase();
  const isTrailer =
    declaredVehicleType === "trailer" ||
    (!declaredVehicleType &&
      /\btrailer\b/i.test(`${vehicle.make || ""} ${vehicle.model || ""}`));
  const vehicleType = isTrailer
    ? "trailer"
    : declaredVehicleType || "standard";
  const expectedSides = normalizeExpectedSides(options, isTrailer);
  if (!expectedSides.length) {
    throw new StageFailure(
      "surface_manifest_empty",
      "The saved product options resolve to no printable surfaces",
      false,
    );
  }
  const dimensionBasisHash = sha256({
    vehicle: {
      year: vehicle.year || "",
      make: vehicle.make || "",
      model: vehicle.model || "",
      type: vehicleType,
    },
    productType: options.productType || "vehicle_wrap",
    coverage: options.coverage || "saved_design",
    options,
    rulesVersion: "designpro.surface-manifest.v1",
    genieContract: TOOL_CONTRACTS.genie,
  });
  const genie = await callFn("panelizer-step-validate", {
    vehicleYear: String(vehicle.year || ""),
    vehicleMake: String(vehicle.make || ""),
    vehicleModel: String(vehicle.model || ""),
    vehicleType,
    bodyText: String(snapshot.bodyText || ""),
    sideSize: options.sideSize || "medium",
    roofSize: options.roofSize || "none",
    addHood: expectedSides.includes("HOOD"),
    addRear: expectedSides.includes("REAR"),
    addRoof: expectedSides.includes("ROOF"),
    addFrontBumper: expectedSides.includes("FRONT"),
    addRearBumper: expectedSides.includes("REAR"),
  });
  if (genie?.dims_verified !== true) {
    throw new StageFailure(
      "genie_dimensions_unverified",
      "GENIE returned fallback dimensions that are not verified for production",
      false,
      0,
      {
        source: genie?.vehicle?.source || genie?.source || null,
        vehicle,
      },
    );
  }
  const dims = dimensionsFromGeniePayload(genie, isTrailer);
  const missing = expectedSides.filter(
    (side) => !dims[side]?.w || !dims[side]?.h,
  );
  if (missing.length) {
    throw new StageFailure(
      "genie_dimensions_incomplete",
      `GENIE did not resolve required dimensions: ${missing.join(", ")}`,
      false,
      0,
      { missingSides: missing, vehicle },
    );
  }
  const surfaces = expectedSides.map((side) => ({
    key: side,
    sourceViewKey:
      (VIEW_KEYS[side] || []).find((key) => frozen.renderUrls?.[key]) || null,
    trimWidthIn: dims[side].w,
    trimHeightIn: dims[side].h,
    bleedIn: 5,
    mirrored: false,
  }));
  const manifestBase = {
    version: "designpro.surface-manifest.v1",
    productType: options.productType || "vehicle_wrap",
    vehicle: {
      type: vehicleType,
      body: options.body || null,
      year: String(vehicle.year || ""),
      make: String(vehicle.make || ""),
      model: String(vehicle.model || ""),
    },
    coverage: options.coverage || "saved_design",
    selectedOptions: options,
    surfaces,
    expectedSides,
    dimensions: dims,
    dimensionBasisHash,
    toolVersions: {
      ...TOOL_CONTRACTS,
      panelBuilder: `flat-master-sheet.v${MASTER_SHEET_VERSION}`,
    },
  };
  const manifestHash = sha256(manifestBase);
  return {
    output: { ...manifestBase, manifestHash },
    verification: {
      verified: true,
      kind: "surface_manifest",
      dynamic: true,
      surfaceCount: expectedSides.length,
      dimensionsKnown: true,
    },
    outputHash: manifestHash,
  };
}

function assertProofDimensions(manifest, resolved) {
  const actual = {
    "DRIVER SIDE": { w: Number(resolved?.sideW), h: Number(resolved?.sideH) },
    "PASSENGER SIDE": {
      w: Number(resolved?.sideW),
      h: Number(resolved?.sideH),
    },
    HOOD: { w: Number(resolved?.hoodW), h: Number(resolved?.hoodL) },
    ROOF: { w: Number(resolved?.roofW), h: Number(resolved?.roofL) },
    FRONT: { w: Number(resolved?.frontW), h: Number(resolved?.frontH) },
    REAR: { w: Number(resolved?.backW), h: Number(resolved?.backH) },
  };
  for (const side of manifest.expectedSides || []) {
    const expected = manifest.dimensions?.[side];
    const got = actual[side];
    if (
      !expected ||
      !got ||
      !Number.isFinite(Number(got.w)) ||
      !Number.isFinite(Number(got.h)) ||
      Number(got.w) <= 0 ||
      Number(got.h) <= 0 ||
      Math.abs(Number(expected.w) - Number(got.w)) > 0.01 ||
      Math.abs(Number(expected.h) - Number(got.h)) > 0.01
    ) {
      throw new StageFailure(
        "proof_dimension_drift",
        `Call 7 dimensions changed after manifest freeze (${side})`,
        false,
      );
    }
  }
}

async function deterministicFinish(
  side,
  sourceUrl,
  dimensions,
  packId,
  variant,
) {
  for (const maxCanvas of [4000, 3000, 2400]) {
    try {
      const result = await callFn(
        "panel-artboard-generator",
        {
          step: "gridslice",
          artboardUrl: sourceUrl,
          side,
          jobId: packId,
          variant,
          panelWidthIn: dimensions.w,
          panelHeightIn: dimensions.h,
          bleedInches: 5,
          maxCanvas,
        },
        150_000,
      );
      if (result?.url) {
        return {
          url: String(result.url),
          dpi: Number(result.effectiveDpi || 0) || null,
          pixelWidth: Number(result.pixelWidth || 0) || null,
          pixelHeight: Number(result.pixelHeight || 0) || null,
        };
      }
    } catch (error) {
      rethrowFatal(error);
      // Retry with the next lower memory cap.
    }
  }
  return null;
}

function sameNumber(left, right, tolerance = 0.01) {
  return (
    Number.isFinite(Number(left)) &&
    Number.isFinite(Number(right)) &&
    Math.abs(Number(left) - Number(right)) <= tolerance
  );
}

function exactNumericTuple(value, length) {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => Number.isFinite(Number(item)))
  );
}

function normalizedRegionBox(value, label) {
  if (!exactNumericTuple(value, 4)) {
    throw new StageFailure(
      "call7_surface_region_invalid",
      `${label} has no frozen four-coordinate source region`,
      false,
    );
  }
  const box = value.map(Number);
  if (
    box.some((item) => item < 0 || item > 1000) ||
    box[2] <= box[0] ||
    box[3] <= box[1]
  ) {
    throw new StageFailure(
      "call7_surface_region_invalid",
      `${label} has an invalid frozen source region`,
      false,
      0,
      { box },
    );
  }
  return box;
}

function normalizedOverlayBox(value, label) {
  if (!exactNumericTuple(value, 4)) {
    throw new StageFailure(
      "call7_overlay_box_invalid",
      `${label} has no frozen [x,y,width,height] box`,
      false,
    );
  }
  const box = value.map(Number);
  const [x, y, width, height] = box;
  if (
    x < 0 || y < 0 || width <= 0 || height <= 0 ||
    x > 1 || y > 1 || x + width > 1.001 || y + height > 1.001
  ) {
    throw new StageFailure(
      "call7_overlay_box_invalid",
      `${label} has an invalid normalized overlay box`,
      false,
      0,
      { box },
    );
  }
  return box;
}

function frozenCall7Artifact(value, label) {
  const artifact = parseObject(value);
  const url = safeAssetUrl(artifact.url);
  const hash = String(artifact.sha256 || "").toLowerCase();
  const bytes = Number(artifact.bytes || 0);
  if (
    !url ||
    !/^[0-9a-f]{64}$/.test(hash) ||
    !Number.isSafeInteger(bytes) ||
    bytes <= 0
  ) {
    throw new StageFailure(
      "call7_surface_artifact_invalid",
      `${label} is not a frozen Call 7 artifact`,
      false,
    );
  }
  return { url, sha256: hash, bytes };
}

function call7SurfaceAssets(proofValue, manifestValue) {
  const proof = parseObject(proofValue);
  const manifest = parseObject(manifestValue);
  const expectedSides = [...new Set(
    (Array.isArray(manifest.expectedSides) ? manifest.expectedSides : [])
      .map((side) => String(side || "").trim().toUpperCase())
      .filter(Boolean),
  )].sort();
  if (!expectedSides.length) {
    throw new StageFailure(
      "call7_surface_manifest_empty",
      "The frozen manifest contains no required Call 7 surfaces",
      false,
    );
  }
  if (String(proof.surfaceAssetsContract || "") !== CALL7_SURFACE_CONTRACT) {
    throw new StageFailure(
      "call7_surface_contract_invalid",
      `The proof does not declare ${CALL7_SURFACE_CONTRACT}`,
      false,
    );
  }
  if (Number(proof.call7InvocationCount) !== 1) {
    throw new StageFailure(
      "call7_invocation_contract_invalid",
      "The frozen proof must attest to exactly one canonical Call 7 invocation",
      false,
      0,
      { observed: proof.call7InvocationCount ?? null },
    );
  }
  const submitted = Array.isArray(proof.surfaceAssets)
    ? proof.surfaceAssets
    : [];
  const surfaces = submitted.map((rawValue, surfaceIndex) => {
    const raw = parseObject(rawValue);
    const side = String(raw.side || "").trim().toUpperCase();
    if (
      String(raw.contract || "") !== CALL7_SURFACE_CONTRACT ||
      !expectedSides.includes(side)
    ) {
      throw new StageFailure(
        "call7_surface_contract_invalid",
        `Call 7 surface ${surfaceIndex + 1} is outside the frozen contract`,
        false,
        0,
        { side: side || null, contract: raw.contract || null },
      );
    }
    const dimensions = parseObject(manifest.dimensions)[side];
    const trim = parseObject(raw.trim);
    const print = parseObject(raw.print);
    if (
      Number(raw.bleedIn) !== 5 ||
      !sameNumber(trim.widthIn, dimensions?.w) ||
      !sameNumber(trim.heightIn, dimensions?.h) ||
      !sameNumber(print.widthIn, Number(dimensions?.w) + 10) ||
      !sameNumber(print.heightIn, Number(dimensions?.h) + 10)
    ) {
      throw new StageFailure(
        "call7_surface_geometry_invalid",
        `${side} is not the frozen GENIE trim with exactly 5-inch bleed`,
        false,
        0,
        { trim, print, bleedIn: raw.bleedIn, expected: dimensions || null },
      );
    }

    const branded = frozenCall7Artifact(raw.branded, `${side} branded`);
    // Call 7 may record an explicit, reasoned separation gap: the branded
    // master — the deliverable — still ships, while the clean/blank panel and
    // this side's Logo Pack entries are honestly ABSENT. `known` is still
    // required, so an unverified separation is rejected as before; only a
    // deliberate, explained gap is admitted, and it never carries a clean
    // asset (which is how a branded-master substitution would sneak in).
    const rawQc = parseObject(raw.separationQc);
    const separationPass = rawQc.pass === true;
    const separationReason = String(rawQc.reason || "").trim();
    if (rawQc.known !== true || (!separationPass && !separationReason)) {
      throw new StageFailure(
        "call7_separation_unverified",
        `${side} has no known Call 7 separation receipt`,
        false,
        0,
        { side, separationQc: rawQc },
      );
    }
    const clean = separationPass
      ? frozenCall7Artifact(raw.clean, `${side} clean`)
      : null;
    if (!separationPass && raw.clean) {
      throw new StageFailure(
        "call7_clean_asset_substituted",
        `${side} recorded a separation gap but still carried a clean asset`,
        false,
        0,
        { side },
      );
    }
    const rawRegion = parseObject(raw.proofRegion);
    const proofRegion = {
      box: normalizedRegionBox(rawRegion.box, `${side} proof region`),
      sha256: String(rawRegion.sha256 || "").toLowerCase(),
      sourceMasterSha256: String(
        rawRegion.sourceMasterSha256 || "",
      ).toLowerCase(),
    };
    if (
      !/^[0-9a-f]{64}$/.test(proofRegion.sha256) ||
      proofRegion.sourceMasterSha256 !== branded.sha256
    ) {
      throw new StageFailure(
        "call7_surface_lineage_invalid",
        `${side} is not bound to its own frozen proof region and branded master`,
        false,
        0,
        { side },
      );
    }

    const rawReceipt = parseObject(raw.transformReceipt);
    const transformReceipt = {
      contract: String(rawReceipt.contract || ""),
      sourceSha256: String(rawReceipt.sourceSha256 || "").toLowerCase(),
      outputSha256: String(rawReceipt.outputSha256 || "").toLowerCase(),
      scaleMode: String(rawReceipt.scaleMode || ""),
      cropBox: exactNumericTuple(rawReceipt.cropBox, 4)
        ? rawReceipt.cropBox.map(Number)
        : null,
      stretched: rawReceipt.stretched,
      rotationDeg: Number(rawReceipt.rotationDeg),
      truncated: rawReceipt.truncated,
    };
    if (
      transformReceipt.contract !== CALL7_TRANSFORM_CONTRACT ||
      !/^[0-9a-f]{64}$/.test(transformReceipt.sourceSha256) ||
      transformReceipt.outputSha256 !== branded.sha256 ||
      transformReceipt.scaleMode !== "contain-mirror-fill-at-call7" ||
      JSON.stringify(transformReceipt.cropBox) !==
        JSON.stringify([0, 0, 1000, 1000]) ||
      transformReceipt.stretched !== false ||
      transformReceipt.rotationDeg !== 0 ||
      transformReceipt.truncated !== false
    ) {
      throw new StageFailure(
        "call7_surface_transform_invalid",
        `${side} lacks the deterministic Call 7 transform receipt`,
        false,
        0,
        { side, transformReceipt },
      );
    }

    const overlays = (Array.isArray(raw.overlays) ? raw.overlays : [])
      .map((overlayValue, fallbackIndex) => {
        const overlay = parseObject(overlayValue);
        const index = Number(overlay.index);
        if (!Number.isSafeInteger(index) || index < 0) {
          throw new StageFailure(
            "call7_overlay_invalid",
            `${side} overlay ${fallbackIndex + 1} has no stable index`,
            false,
          );
        }
        const sourceRegionSha256 = String(
          overlay.sourceRegionSha256 || "",
        ).toLowerCase();
        const sourceMasterSha256 = String(
          overlay.sourceMasterSha256 || "",
        ).toLowerCase();
        if (
          sourceRegionSha256 !== proofRegion.sha256 ||
          sourceMasterSha256 !== branded.sha256
        ) {
          throw new StageFailure(
            "call7_overlay_lineage_invalid",
            `${side} overlay ${index} is not bound to its own proof region`,
            false,
          );
        }
        return {
          index,
          label: String(overlay.label || ""),
          box: normalizedOverlayBox(
            overlay.box,
            `${side} overlay ${index}`,
          ),
          sourceRegionSha256,
          sourceMasterSha256,
          rebuild: frozenCall7Artifact(
            overlay.rebuild,
            `${side} overlay ${index} rebuild`,
          ),
          cut: frozenCall7Artifact(
            overlay.cut,
            `${side} overlay ${index} cut`,
          ),
        };
      })
      .sort((left, right) => left.index - right.index);
    if (new Set(overlays.map((overlay) => overlay.index)).size !== overlays.length) {
      throw new StageFailure(
        "call7_overlay_index_duplicate",
        `${side} contains duplicate frozen overlay indexes`,
        false,
      );
    }
    if (!separationPass && overlays.length > 0) {
      throw new StageFailure(
        "call7_separation_unverified",
        `${side} recorded a separation gap but still carried lifted overlays`,
        false,
        0,
        { side, overlayCount: overlays.length },
      );
    }
    if (
      overlays.length > 0 &&
      (branded.url === clean.url || branded.sha256 === clean.sha256)
    ) {
      throw new StageFailure(
        "call7_clean_asset_substituted",
        `${side} contains branding overlays but its clean pixels equal the branded pixels`,
        false,
        0,
        { side },
      );
    }
    return {
      contract: CALL7_SURFACE_CONTRACT,
      side,
      branded,
      clean,
      proofRegion,
      trim: {
        widthIn: Number(trim.widthIn),
        heightIn: Number(trim.heightIn),
      },
      print: {
        widthIn: Number(print.widthIn),
        heightIn: Number(print.heightIn),
      },
      bleedIn: 5,
      transformReceipt,
      overlays,
      separationQc: {
        known: true,
        pass: separationPass,
        reason: separationReason,
      },
    };
  }).sort((left, right) => left.side.localeCompare(right.side));

  const observedSides = surfaces.map((surface) => surface.side);
  if (
    surfaces.length !== expectedSides.length ||
    new Set(observedSides).size !== surfaces.length ||
    expectedSides.some((side, index) => side !== observedSides[index])
  ) {
    throw new StageFailure(
      "call7_surface_set_incomplete",
      "Call 7 did not freeze the exact required surface set",
      false,
      0,
      { expectedSides, observedSides },
    );
  }
  const surfaceAssetsHash = sha256({
    contract: CALL7_SURFACE_CONTRACT,
    surfaces,
  });
  if (
    !/^[0-9a-f]{64}$/.test(String(proof.surfaceAssetsHash || "")) ||
    String(proof.surfaceAssetsHash).toLowerCase() !== surfaceAssetsHash
  ) {
    throw new StageFailure(
      "call7_surface_hash_invalid",
      "The Call 7 surface registry is not bound to its frozen hash",
      false,
      0,
      {
        expected: surfaceAssetsHash,
        observed: proof.surfaceAssetsHash || null,
      },
    );
  }
  return { expectedSides, surfaces, surfaceAssetsHash };
}

async function extractLogos(db, _stage, runId) {
  const manifest = await stageOutput(db, runId, "manifest.resolve");
  const proof = await stageOutput(db, runId, "proof.build");
  const built = await stageOutput(db, runId, "panels.build");
  const registry = call7SurfaceAssets(proof, manifest);
  const sourcePanels = Array.isArray(built.panels) ? built.panels : [];
  const gapSides = Array.isArray(built.gapSides) ? built.gapSides : [];
  const panelBySide = new Map();

  for (const panel of sourcePanels) {
    const side = String(panel?.side || "").trim().toUpperCase();
    if (!side || panelBySide.has(side)) {
      throw new StageFailure(
        "call7_panel_set_invalid",
        "The deterministic panel checkpoint contains a missing or duplicate side",
        false,
        0,
        { side: side || null },
      );
    }
    panelBySide.set(side, panel);
  }
  const panelSides = [...panelBySide.keys()].sort();
  if (
    gapSides.length ||
    sourcePanels.length !== registry.expectedSides.length ||
    registry.expectedSides.some(
      (side, index) => side !== panelSides[index],
    )
  ) {
    throw new StageFailure(
      "call7_panel_set_incomplete",
      "Call 9 requires the exact Call 7 side set with no gaps or substitutions",
      false,
      0,
      {
        expectedSides: registry.expectedSides,
        observedSides: panelSides,
        gapSides,
      },
    );
  }

  const registered = await mapBounded(
    registry.surfaces,
    SEPARATION_POOL,
    async (surface) => {
      const panel = panelBySide.get(surface.side);
      const ownRegion =
        panel?.sourceRegionSha256 === surface.proofRegion.sha256 &&
        panel?.sourceMasterSha256 === surface.branded.sha256 &&
        JSON.stringify(panel?.sourceRegionBox || null) ===
          JSON.stringify(surface.proofRegion.box);
      const geometryMatches =
        sameNumber(panel?.widthIn, surface.trim.widthIn) &&
        sameNumber(panel?.heightIn, surface.trim.heightIn) &&
        sameNumber(panel?.printWidthIn, surface.print.widthIn) &&
        sameNumber(panel?.printHeightIn, surface.print.heightIn) &&
        Number(panel?.bleedIn) === 5;
      const brandedMatches =
        String(panel?.brandedUrl || "") === surface.branded.url &&
        String(panel?.brandedSha256 || "").toLowerCase() ===
          surface.branded.sha256 &&
        Number(panel?.brandedBytes || 0) === surface.branded.bytes;
      if (
        panel?.method !== CALL7_SURFACE_CONTRACT ||
        panel?.deterministic !== true ||
        panel?.baseDeterministic !== true ||
        panel?.derivationDeterministic !== true ||
        panel?.finishDeterministic !== true ||
        panel?.productionEligible !== true ||
        panel?.sourceProofHash !== proof.proofHash ||
        !ownRegion ||
        !geometryMatches ||
        !brandedMatches ||
        panel?.qc?.known !== true ||
        panel?.qc?.pass !== true
      ) {
        throw new StageFailure(
          "call7_panel_lineage_invalid",
          surface.side +
            " is not the deterministic panel from its own frozen Call 7 region",
          false,
          0,
          {
            side: surface.side,
            method: panel?.method || null,
            sourceRegionSha256: panel?.sourceRegionSha256 || null,
            sourceMasterSha256: panel?.sourceMasterSha256 || null,
          },
        );
      }

      // A side Call 7 recorded as a reasoned separation gap has no clean panel
      // and no overlays, so it contributes no clean/cut bytes to re-verify.
      // Its branded master is still registered and still byte-checked.
      const materialUrls = { branded: surface.branded.url };
      const frozenEvidence = { branded: surface.branded };
      if (surface.clean) {
        materialUrls.clean = surface.clean.url;
        frozenEvidence.clean = surface.clean;
      }
      for (const overlay of surface.overlays) {
        const rebuildKey = "overlay:" + overlay.index + ":rebuild";
        const cutKey = "overlay:" + overlay.index + ":cut";
        materialUrls[rebuildKey] = overlay.rebuild.url;
        materialUrls[cutKey] = overlay.cut.url;
        frozenEvidence[rebuildKey] = overlay.rebuild;
        frozenEvidence[cutKey] = overlay.cut;
      }
      const observed = await fingerprintMap(materialUrls);
      assertFrozenFingerprints(
        frozenEvidence,
        observed,
        "call7_surface_artifact_changed",
        surface.side + " Call 7 production bytes changed before Call 9",
      );

      const overlayManifest = surface.overlays.map((overlay) => {
        const rebuild =
          observed["overlay:" + overlay.index + ":rebuild"];
        const cut = observed["overlay:" + overlay.index + ":cut"];
        return {
          index: overlay.index,
          label: overlay.label,
          box: overlay.box,
          sourceRegionSha256: overlay.sourceRegionSha256,
          sourceMasterSha256: overlay.sourceMasterSha256,
          url: rebuild.url,
          rebuild_url: rebuild.url,
          cut_url: cut.url,
          is_cut: true,
          sha256: rebuild.sha256,
          bytes: rebuild.bytes,
          rebuild_sha256: rebuild.sha256,
          rebuild_bytes: rebuild.bytes,
          cut_sha256: cut.sha256,
          cut_bytes: cut.bytes,
        };
      });
      const logoArtifacts = surface.overlays.map((overlay) => {
        const rebuild =
          observed["overlay:" + overlay.index + ":rebuild"];
        const cut = observed["overlay:" + overlay.index + ":cut"];
        return {
          side: surface.side,
          index: overlay.index,
          label: overlay.label,
          box: overlay.box,
          sourceRegionSha256: overlay.sourceRegionSha256,
          sourceMasterSha256: overlay.sourceMasterSha256,
          url: cut.url,
          sha256: cut.sha256,
          bytes: cut.bytes,
          rebuild_url: rebuild.url,
          rebuild_sha256: rebuild.sha256,
          rebuild_bytes: rebuild.bytes,
          cut_sha256: cut.sha256,
          cut_bytes: cut.bytes,
          is_cut: true,
          contract: CALL7_SURFACE_CONTRACT,
        };
      });
      const fingerprints = { branded: observed.branded };
      if (observed.clean) fingerprints.clean = observed.clean;
      for (const overlay of surface.overlays) {
        fingerprints["overlay:" + overlay.index + ":rebuild"] =
          observed["overlay:" + overlay.index + ":rebuild"];
        fingerprints["overlay:" + overlay.index + ":cut"] =
          observed["overlay:" + overlay.index + ":cut"];
      }
      const artifactHash = sha256({
        contract: CALL7_SURFACE_CONTRACT,
        surfaceAssetsHash: registry.surfaceAssetsHash,
        side: surface.side,
        sourceRegion: surface.proofRegion,
        transformReceipt: surface.transformReceipt,
        branded: fingerprintEvidence({ branded: observed.branded }).branded,
        clean: observed.clean
          ? fingerprintEvidence({ clean: observed.clean }).clean
          : null,
        overlays: logoArtifacts.map((asset) => ({
          index: asset.index,
          sourceRegionSha256: asset.sourceRegionSha256,
          sourceMasterSha256: asset.sourceMasterSha256,
          cut: { sha256: asset.sha256, bytes: asset.bytes },
          rebuild: {
            sha256: asset.rebuild_sha256,
            bytes: asset.rebuild_bytes,
          },
        })),
      });
      return {
        panel: {
          ...panel,
          cleanUrl: observed.clean ? observed.clean.url : null,
          overlayManifest,
          separationQc: {
            ...surface.separationQc,
            contract: CALL7_SURFACE_CONTRACT,
          },
          sourceAssetContract: CALL7_SURFACE_CONTRACT,
          sourceAssetsHash: registry.surfaceAssetsHash,
          fingerprints,
          artifactHash,
        },
        logoArtifacts,
      };
    },
  );

  const panels = registered.map((entry) => entry.panel);
  const logoArtifacts = registered.flatMap(
    (entry) => entry.logoArtifacts,
  );
  const brandingExpected =
    proof.brandingExpected === true ||
    registry.surfaces.some((surface) => surface.overlays.length > 0);
  const separationGapSides = registry.surfaces
    .filter((surface) => surface.separationQc.pass !== true)
    .map((surface) => surface.side);
  if (brandingExpected && logoArtifacts.length === 0) {
    // Sides Call 7 recorded as a reasoned separation gap already explain their
    // own missing cut assets. An empty Logo Pack is only a contradiction when
    // every separation ran clean and still produced nothing.
    if (separationGapSides.length === 0) {
      throw new StageFailure(
        "call7_logo_pack_missing",
        "The frozen branded design contains no verified Call 7 cut assets",
        false,
        0,
        { expectedSides: registry.expectedSides },
      );
    }
  }

  const separationHash = sha256({
    contract: CALL7_SURFACE_CONTRACT,
    manifestHash: manifest.manifestHash,
    proofHash: proof.proofHash,
    surfaceAssetsHash: registry.surfaceAssetsHash,
    panels: panels.map((panel) => ({
      side: panel.side,
      artifactHash: panel.artifactHash,
      sourceRegionSha256: panel.sourceRegionSha256,
      sourceMasterSha256: panel.sourceMasterSha256,
    })),
    logos: logoArtifacts.map((asset) => ({
      side: asset.side,
      index: asset.index,
      sourceRegionSha256: asset.sourceRegionSha256,
      sourceMasterSha256: asset.sourceMasterSha256,
      cut: { sha256: asset.sha256, bytes: asset.bytes },
      rebuild: {
        sha256: asset.rebuild_sha256,
        bytes: asset.rebuild_bytes,
      },
    })),
  });
  return {
    output: {
      panels,
      logoArtifacts,
      separationHash,
      separationGaps: [],
      surfaceAssetsHash: registry.surfaceAssetsHash,
      contract: CALL7_SURFACE_CONTRACT,
    },
    verification: {
      verified: true,
      kind: "call7_frozen_logo_registry",
      contract: CALL7_SURFACE_CONTRACT,
      exactSurfaces: true,
      allSeparationKnownPassing: separationGapSides.length === 0,
      // Every side Call 7 recorded a gap on, carried through verbatim from its
      // own separationQc — Call 9 neither invents nor absorbs one.
      separationGapSides,
      noGaps: true,
      noSubstitutions: true,
      postCall7ModelCalls: 0,
      logoCount: logoArtifacts.length,
      brandingExpected,
    },
    outputHash: separationHash,
  };
}

/**
 * PUBLISH EARLY, GATE LATE.
 *
 * Panels finish here at `panels.build` (sequence 30) but used to reach
 * `production_flow_assets` only at `pack.verify` (sequence 50) — so a stumble
 * at `logos.extract` in between threw away six finished, QC-passed panels and
 * the customer saw nothing. Live: 14 failed packs against 1 completed.
 *
 * This publishes them the moment they exist, as a PREVIEW. Nothing about the
 * gate moves: `save-production-panels` computes
 * `production_eligible = productionEligible AND separation_qc.pass`, and
 * separation does not exist until `logos.extract`, so every row written here is
 * inherently production-INELIGIBLE. RevisionStudio shows it as a preview with
 * downloads blocked and no route to the paid path; `pack.verify` re-stages the
 * same pack authoritatively and that is what flips eligibility on.
 *
 * BEST-EFFORT BY CONSTRUCTION — it can never fail the stage. The whole purpose
 * is to stop losing finished panels, so the mechanism that surfaces them must
 * not become a new way to lose them. It also makes the deploy ordering a
 * non-issue: if the runner ships before the migration that lets `panels.build`
 * hold this lease, the call simply fails and is logged, and `pack.verify`
 * persists exactly as it does today.
 */
async function publishPanelPreview(db, stage, runId, result) {
  try {
    const panels = Array.isArray(result?.output?.panels)
      ? result.output.panels
      : [];
    if (!panels.length) return;
    const { pack } = await loadContext(db, runId);
    const manifest = await stageOutput(db, runId, "manifest.resolve");
    const proof = await stageOutput(db, runId, "proof.build");
    const expectedSides = Array.isArray(manifest.expectedSides)
      ? manifest.expectedSides
      : [];
    // Only ever publish a COMPLETE set. A partial pack would be rejected by the
    // staging function anyway, and a half-pack on screen is worse than none.
    const sides = new Set(panels.map((panel) => String(panel.side)));
    if (
      !expectedSides.length ||
      !expectedSides.every((side) => sides.has(side))
    ) return;

    // The preview is bound to the same immutable identity the verified pack
    // uses, minus the separation contract that does not exist yet. Deriving the
    // source hash from the panels' own artifact hashes keeps the row set
    // self-consistent under `getProductionPanelPackState`.
    const previewSourceHash = sha256({
      definitionVersion: DEFINITION_VERSION,
      adapterVersion: PANEL_ADAPTER_VERSION,
      stage: "panels.build.preview",
      revisionId: pack.revision_id || null,
      manifestHash: manifest.manifestHash,
      proofHash: proof.proofHash,
      panels: panels.map((panel) => ({
        side: panel.side,
        artifactHash: panel.artifactHash || panel.brandedSha256 || null,
      })),
    });
    const saved = await callFn(
      "save-production-panels",
      {
        jobId: pack.design_id,
        version: "v2",
        sourceHash: previewSourceHash,
        sourceContractHash: previewSourceHash,
        sourceProofUrl: proof.url,
        expectedSides: manifest.expectedSides,
        revisionId: pack.revision_id,
        enticePackId: pack.id,
        designiqGenerationId: pack.designiq_generation_id,
        dimensionManifestId: pack.dimension_manifest_id,
        manifestHash: manifest.manifestHash,
        stageId: stage.id,
        leaseToken: stage.lease_token,
        activate: false,
        // No logo pack and no separation verdict are sent, which is precisely
        // what keeps every row written here production-INELIGIBLE until
        // logos.extract and pack.verify have run.
        panels,
      },
      180_000,
    );
    console.log(
      `[entice] panels.build preview published run=${runId} sides=${
        Number(saved?.saved || 0)
      }`,
    );
  } catch (error) {
    // Deliberately swallowed. See the contract above.
    console.warn(
      `[entice] panels.build preview publish skipped run=${runId}: ${
        error?.message || error
      }`,
    );
  }
}

async function verifyPack(db, stage, runId) {
  const { pack, revision } = await loadContext(db, runId);
  const frozen = await stageOutput(db, runId, "revision.freeze");
  const manifest = await stageOutput(db, runId, "manifest.resolve");
  const proof = await stageOutput(db, runId, "proof.build");
  const built = await stageOutput(db, runId, "panels.build");
  const builtPanels = Array.isArray(built.panels) ? built.panels : [];
  if (
    proof.adapterVersion !== PANEL_ADAPTER_VERSION ||
    built.adapterVersion !== PANEL_ADAPTER_VERSION
  ) {
    throw new StageFailure(
      "pack_adapter_version_mismatch",
      "Pack verification rejected checkpoints from a different panel adapter",
      false,
      0,
      {
        expectedAdapterVersion: PANEL_ADAPTER_VERSION,
        proofAdapterVersion: proof.adapterVersion || null,
        panelAdapterVersion: built.adapterVersion || null,
      },
    );
  }
  const registry = call7SurfaceAssets(proof, manifest);
  const expectedSideSet = registry.expectedSides;
  const observedSideSet = [...new Set(
    builtPanels.map((panel) =>
      String(panel?.side || "").trim().toUpperCase(),
    ),
  )].sort();
  const gapSides = Array.isArray(built.gapSides) ? built.gapSides : [];
  const surfacesBySide = new Map(
    registry.surfaces.map((surface) => [surface.side, surface]),
  );
  const invalidLineage = builtPanels.filter((panel) => {
    const side = String(panel?.side || "").trim().toUpperCase();
    const surface = surfacesBySide.get(side);
    if (!surface) return true;
    return (
      panel.method !== CALL7_SURFACE_CONTRACT ||
      panel.deterministic !== true ||
      panel.baseDeterministic !== true ||
      panel.derivationDeterministic !== true ||
      panel.finishDeterministic !== true ||
      panel.productionEligible !== true ||
      panel.sourceProofHash !== proof.proofHash ||
      panel.sourceRegionSha256 !== surface.proofRegion.sha256 ||
      panel.sourceMasterSha256 !== surface.branded.sha256 ||
      JSON.stringify(panel.sourceRegionBox || null) !==
        JSON.stringify(surface.proofRegion.box) ||
      String(panel.brandedUrl || "") !== surface.branded.url ||
      String(panel.brandedSha256 || "").toLowerCase() !==
        surface.branded.sha256 ||
      Number(panel.brandedBytes || 0) !== surface.branded.bytes ||
      !sameNumber(panel.widthIn, surface.trim.widthIn) ||
      !sameNumber(panel.heightIn, surface.trim.heightIn) ||
      !sameNumber(panel.printWidthIn, surface.print.widthIn) ||
      !sameNumber(panel.printHeightIn, surface.print.heightIn) ||
      Number(panel.bleedIn) !== 5 ||
      panel.qc?.known !== true ||
      panel.qc?.pass !== true
    );
  });
  const exactSideSet =
    gapSides.length === 0 &&
    builtPanels.length === expectedSideSet.length &&
    observedSideSet.length === expectedSideSet.length &&
    expectedSideSet.every(
      (side, index) => side === observedSideSet[index],
    );
  if (!exactSideSet || invalidLineage.length) {
    throw new StageFailure(
      "panel_lineage_invalid",
      "Pack verification accepts only exact Call 7 proof-region panels with 5-inch bleed and no gaps",
      false,
      0,
      {
        contract: CALL7_SURFACE_CONTRACT,
        expectedSides: expectedSideSet,
        observedSides: observedSideSet,
        gapSides,
        rejected: invalidLineage.map((panel) => ({
          side: panel.side,
          method: panel.method,
          sourceRegionSha256: panel.sourceRegionSha256 || null,
          sourceMasterSha256: panel.sourceMasterSha256 || null,
        })),
      },
    );
  }
  const separated = await stageOutput(db, runId, "logos.extract");
  const separatedPanels = Array.isArray(separated.panels)
    ? separated.panels
    : [];
  const separatedSides = [...new Set(
    separatedPanels.map((panel) =>
      String(panel?.side || "").trim().toUpperCase(),
    ),
  )].sort();
  const separationInvalid = separatedPanels.filter((panel) => {
    const side = String(panel?.side || "").trim().toUpperCase();
    const surface = surfacesBySide.get(side);
    const overlayManifest = Array.isArray(panel?.overlayManifest)
      ? panel.overlayManifest
      : [];
    const overlayManifestValid =
      surface &&
      overlayManifest.length === surface.overlays.length &&
      surface.overlays.every((overlay) => {
        const registered = overlayManifest.find(
          (candidate) => Number(candidate?.index) === overlay.index,
        );
        return (
          registered?.url === overlay.rebuild.url &&
          registered?.rebuild_url === overlay.rebuild.url &&
          registered?.cut_url === overlay.cut.url &&
          registered?.rebuild_sha256 === overlay.rebuild.sha256 &&
          Number(registered?.rebuild_bytes) === overlay.rebuild.bytes &&
          registered?.cut_sha256 === overlay.cut.sha256 &&
          Number(registered?.cut_bytes) === overlay.cut.bytes &&
          registered?.sourceRegionSha256 ===
            surface.proofRegion.sha256 &&
          registered?.sourceMasterSha256 ===
            surface.branded.sha256 &&
          registered?.is_cut === true
        );
      });
    // A side Call 7 gapped must arrive gapped: separation refused with the
    // same reason, and NO clean panel. Anything else — a passing verdict on a
    // gapped side, or a clean URL conjured after the fact — is a substitution.
    const surfaceGapped = surface?.separationQc?.pass === false;
    const expectedCleanUrl = surface?.clean?.url || null;
    const observedCleanUrl = String(panel.cleanUrl || "") || null;
    return (
      !surface ||
      panel.sourceAssetContract !== CALL7_SURFACE_CONTRACT ||
      panel.sourceAssetsHash !== registry.surfaceAssetsHash ||
      panel.separationQc?.known !== true ||
      panel.separationQc?.pass !== (surfaceGapped ? false : true) ||
      (surfaceGapped &&
        String(panel.separationQc?.reason || "").trim() !==
          String(surface.separationQc.reason || "").trim()) ||
      panel.separationQc?.contract !== CALL7_SURFACE_CONTRACT ||
      observedCleanUrl !== expectedCleanUrl ||
      (surface?.overlays?.length > 0 &&
        String(panel.cleanUrl || "") === String(panel.brandedUrl || "")) ||
      panel.sourceRegionSha256 !== surface?.proofRegion?.sha256 ||
      panel.sourceMasterSha256 !== surface?.branded?.sha256 ||
      !overlayManifestValid
    );
  });
  const separatedLogos = Array.isArray(separated.logoArtifacts)
    ? separated.logoArtifacts
    : [];
  const expectedLogos = registry.surfaces.flatMap((surface) =>
    surface.overlays.map((overlay) => ({ surface, overlay })),
  );
  const observedLogoKeys = new Set();
  const invalidLogos = separatedLogos.filter((asset) => {
    const side = String(asset?.side || "").trim().toUpperCase();
    const index = Number(asset?.index);
    const key = side + ":" + index;
    if (observedLogoKeys.has(key)) return true;
    observedLogoKeys.add(key);
    const surface = surfacesBySide.get(side);
    const overlay = surface?.overlays.find(
      (candidate) => candidate.index === index,
    );
    return (
      !overlay ||
      asset.contract !== CALL7_SURFACE_CONTRACT ||
      asset.sourceRegionSha256 !== surface.proofRegion.sha256 ||
      asset.sourceMasterSha256 !== surface.branded.sha256 ||
      asset.url !== overlay.cut.url ||
      asset.sha256 !== overlay.cut.sha256 ||
      Number(asset.bytes) !== overlay.cut.bytes ||
      asset.rebuild_url !== overlay.rebuild.url ||
      asset.rebuild_sha256 !== overlay.rebuild.sha256 ||
      Number(asset.rebuild_bytes) !== overlay.rebuild.bytes ||
      asset.cut_sha256 !== overlay.cut.sha256 ||
      Number(asset.cut_bytes) !== overlay.cut.bytes ||
      asset.is_cut !== true
    );
  });
  const exactLogoSet =
    separatedLogos.length === expectedLogos.length &&
    invalidLogos.length === 0 &&
    expectedLogos.every(({ surface, overlay }) =>
      observedLogoKeys.has(surface.side + ":" + overlay.index),
    );
  if (
    separated.contract !== CALL7_SURFACE_CONTRACT ||
    separated.surfaceAssetsHash !== registry.surfaceAssetsHash ||
    (Array.isArray(separated.separationGaps) &&
      separated.separationGaps.length > 0) ||
    separatedPanels.length !== expectedSideSet.length ||
    separatedSides.length !== expectedSideSet.length ||
    expectedSideSet.some(
      (side, index) => side !== separatedSides[index],
    ) ||
    separationInvalid.length ||
    !exactLogoSet
  ) {
    throw new StageFailure(
      "call7_separation_lineage_invalid",
      "Pack verification rejected a gap, substituted clean panel, or non-Call 7 logo registry",
      false,
      0,
      {
        contract: separated.contract || null,
        expectedSides: expectedSideSet,
        observedSides: separatedSides,
        rejectedSides: separationInvalid.map((panel) => panel.side),
        expectedLogoCount: expectedLogos.length,
        observedLogoCount: separatedLogos.length,
        rejectedLogos: invalidLogos.map((asset) => ({
          side: asset.side,
          index: asset.index,
        })),
      },
    );
  }
  const finalUrls = {};
  const finalExpected = {};
  for (const [key, evidence] of Object.entries(
    parseObject(proof.fingerprints),
  )) {
    if (evidence?.url) {
      finalUrls[`proof:${key}`] = evidence.url;
      finalExpected[`proof:${key}`] = evidence;
    }
  }
  for (const panel of separated.panels || []) {
    for (const [key, evidence] of Object.entries(
      parseObject(panel.fingerprints),
    )) {
      if (evidence?.url) {
        finalUrls[`panel:${panel.side}:${key}`] = evidence.url;
        finalExpected[`panel:${panel.side}:${key}`] = evidence;
      }
    }
  }
  if (!Object.keys(finalUrls).length) {
    throw new StageFailure(
      "pack_artifact_evidence_missing",
      "The verified pack contains no byte-level artifact evidence",
      false,
    );
  }
  const finalObserved = await fingerprintMap(finalUrls);
  assertFrozenFingerprints(
    finalExpected,
    finalObserved,
    "pack_artifact_changed",
    "A verified pack artifact changed before atomic staging",
  );
  const sourceContractHash = sha256({
    definitionVersion: DEFINITION_VERSION,
    adapterVersion: PANEL_ADAPTER_VERSION,
    revisionId: revision.id,
    canonicalInputHash: frozen.canonicalInputHash,
    dimensionBasisHash: manifest.dimensionBasisHash,
    manifestHash: manifest.manifestHash,
    proofHash: proof.proofHash,
    postProofContract: CALL7_SURFACE_CONTRACT,
    surfaceAssetsHash: registry.surfaceAssetsHash,
    panels: separated.panels.map((panel) => ({
      side: panel.side,
      artifactHash: panel.artifactHash,
      sourceRegionSha256: panel.sourceRegionSha256,
      sourceMasterSha256: panel.sourceMasterSha256,
    })),
    logoArtifacts: separated.logoArtifacts.map((asset) => ({
      side: asset.side,
      index: asset.index,
      sha256: asset.sha256,
      bytes: asset.bytes,
      rebuildSha256: asset.rebuild_sha256,
      rebuildBytes: asset.rebuild_bytes,
      sourceRegionSha256: asset.sourceRegionSha256,
      sourceMasterSha256: asset.sourceMasterSha256,
    })),
    tools: TOOL_CONTRACTS,
  });
  const packIdentityHash = sha256({
    revisionId: revision.id,
    dimensionManifestId: pack.dimension_manifest_id,
    sourceContractHash,
  });
  const saved = await callFn(
    "save-production-panels",
    {
      jobId: pack.design_id,
      // The vault's public atomic format remains v2. The internal v4 adapter
      // is bound through sourceContractHash and panel lineage metadata.
      version: "v2",
      sourceHash: sourceContractHash,
      sourceContractHash,
      sourceProofUrl: proof.url,
      expectedSides: manifest.expectedSides,
      logoPack: separated.logoArtifacts,
      revisionId: revision.id,
      enticePackId: pack.id,
      designiqGenerationId: pack.designiq_generation_id,
      dimensionManifestId: pack.dimension_manifest_id,
      manifestHash: manifest.manifestHash,
      stageId: stage.id,
      leaseToken: stage.lease_token,
      activate: false,
      panels: separated.panels,
    },
    180_000,
  );
  const savedSides = Array.isArray(saved?.sides)
    ? saved.sides.map((side) => String(side).trim().toUpperCase()).sort()
    : [];
  const requiredSides = [...manifest.expectedSides].sort();
  if (
    saved?.success !== true ||
    Number(saved?.saved || 0) !== requiredSides.length ||
    savedSides.length !== requiredSides.length ||
    requiredSides.some((side, index) => side !== savedSides[index]) ||
    String(saved?.sourceHash || "").toLowerCase() !== sourceContractHash
  ) {
    throw new StageFailure(
      "atomic_vault_save_rejected",
      String(saved?.error || "Revision-bound panel vault rejected the pack"),
      true,
      30,
    );
  }
  const packVersion = String(
    saved.version || `v2:${sourceContractHash.slice(0, 24)}`,
  );
  if (packVersion !== `v2:${sourceContractHash.slice(0, 24)}`) {
    throw new StageFailure(
      "atomic_vault_version_mismatch",
      "Revision-bound panel vault returned the wrong source version",
      false,
      0,
      { packVersion },
    );
  }
  await assertClaimOwned(true);
  const { data, error } = await db.rpc("verify_designpro_entice_pack", {
    p_stage_id: stage.id,
    p_lease_token: stage.lease_token,
    p_pack_id: pack.id,
    p_canonical_input_hash: frozen.canonicalInputHash,
    p_dimension_basis_hash: manifest.dimensionBasisHash,
    p_manifest_hash: manifest.manifestHash,
    p_pack_identity_hash: packIdentityHash,
    p_source_contract_hash: sourceContractHash,
    p_surface_manifest: manifest,
    p_proof_artifact: {
      url: proof.url,
      sha256: proof.sha256,
      bytes: proof.bytes,
      adapterVersion: proof.adapterVersion,
      call7InvocationCount: proof.call7InvocationCount,
      fingerprints: proof.fingerprints,
      surfaceAssetsContract: CALL7_SURFACE_CONTRACT,
      surfaceAssetsHash: registry.surfaceAssetsHash,
      surfaceAssets: registry.surfaces,
    },
    p_panel_artifacts: separated.panels,
    p_logo_artifacts: separated.logoArtifacts,
    p_pack_version: packVersion,
  });
  if (error || data?.verified !== true) {
    throw new StageFailure(
      "pack_verification_fenced",
      error?.message || "Unable to record verified Entice Pack",
      Boolean(error),
      15,
      { databaseError: error?.message || null },
    );
  }
  return { atomicCompletion: true, output: data };
}

async function activatePack(db, stage, runId) {
  const { pack } = await loadContext(db, runId);
  const verified = await stageOutput(db, runId, "pack.verify");
  const packIdentityHash = String(verified.packIdentityHash || "");
  await assertClaimOwned(true);
  const { data, error } = await db.rpc("activate_designpro_entice_pack", {
    p_stage_id: stage.id,
    p_lease_token: stage.lease_token,
    p_pack_id: pack.id,
    p_pack_identity_hash: packIdentityHash,
  });
  if (error || data?.activated !== true) {
    throw new StageFailure(
      "pack_activation_fenced",
      error?.message || "Unable to atomically activate Entice Pack",
      Boolean(error),
      15,
      { databaseError: error?.message || null },
    );
  }

  // Continuous artboards are retired from the durable path. The compatibility
  // stage registers Call 7 surface assets and activation never copies legacy
  // artboard URLs onto the frozen source row.
  const sourceRowAnnotation = {
    skipped: "call7_surface_asset_registry",
  };

  // ── SURFACE THE ACTIVATED PACK TO THE TEAM (best-effort, post-fence) ──────
  //
  // Activation used to be terminal: the pack went active, and NOTHING put the
  // design in front of the production team. The Studio Board lists
  // panelizer_jobs, so an activated pack with no purchase had no row at all —
  // the team had to paste a UUID, which minted a placeholder by hand. The
  // purpose-built bridge for exactly this — designpro-ensure-qc-job, which
  // mints/finds the generation-keyed panelizer_jobs row and copies the 2D
  // proof across — was deployed with ZERO callers (verified repo-wide,
  // 2026-08-04 audit). This is the one call site.
  //
  // trigger_pipeline:false — the team runs extraction from the QC page on
  // demand; this only makes the design VISIBLE. Best-effort like the
  // annotation above it: activation has already succeeded, and a board
  // surfacing failure must never fail the pack that just activated.
  let qcJobBridge = null;
  try {
    const bridged = await callFn(
      "designpro-ensure-qc-job",
      {
        generation_id: pack.designiq_generation_id || pack.design_id,
        user_id: pack.user_id,
        trigger_pipeline: false,
      },
      30_000,
    );
    qcJobBridge = { jobId: String(bridged?.job_id || bridged?.jobId || "") || null };
  } catch (bridgeError) {
    qcJobBridge = {
      error: String(bridgeError?.message || bridgeError).slice(0, 200),
    };
  }

  return {
    atomicCompletion: true,
    output: { ...data, sourceRowAnnotation, qcJobBridge },
  };
}

let proofExtractV3Adapter = null;
function getProofExtractV3Adapter() {
  if (!proofExtractV3Adapter) {
    proofExtractV3Adapter = createDesignProProofExtractV3({
      StageFailure,
      adapterVersion: PANEL_ADAPTER_VERSION,
      toolContracts: TOOL_CONTRACTS,
      masterSheetVersion: MASTER_SHEET_VERSION,
      panelBuildPool: PANEL_BUILD_POOL,
      loadContext,
      stageOutput,
      parseObject,
      fingerprintFrozenSources,
      assertFrozenFingerprints,
      stampedDimensions,
      assertProofDimensions,
      callFn,
      isLeaseFailure,
      rethrowFatal,
      mapBounded,
      fingerprintMap,
      fingerprintEvidence,
      sha256,
      deterministicFinish,
    });
  }
  return proofExtractV3Adapter;
}

// ── artboards.build — compatibility registry for Call 7 assets ───────────────
//
// This stage name remains in the frozen workflow definition so existing runs do
// not need a second pipeline or a schema fork. It does not generate artboards.
// Call 7 already froze the exact branded, clean, cut, and rebuild bytes for
// every GENIE-sized surface. This stage only validates and republishes that
// immutable registry for older stage readers.
async function buildArtboards(db, _stage, runId) {
  const manifest = await stageOutput(db, runId, "manifest.resolve");
  const proof = await stageOutput(db, runId, "proof.build");
  const registry = call7SurfaceAssets(proof, manifest);
  return {
    output: {
      contract: CALL7_SURFACE_CONTRACT,
      surfaceAssets: registry.surfaces,
      surfaceAssetsHash: registry.surfaceAssetsHash,
      expectedSides: registry.expectedSides,
      // Legacy fields are deliberately empty. No continuous AI artboard is
      // produced or accepted after the Call 7 checkpoint.
      brandedArtboardUrl: null,
      cleanArtboardUrl: null,
    },
    verification: {
      verified: true,
      kind: "call7_surface_asset_registry",
      contract: CALL7_SURFACE_CONTRACT,
      deterministic: true,
      exactSurfaces: true,
      emitted: registry.surfaces.length,
      postCall7ModelCalls: 0,
    },
    outputHash: registry.surfaceAssetsHash,
  };
}

async function executeStage(db, stage) {
  switch (stage.stage_key) {
    case "revision.freeze":
      return await freezeRevision(db, stage.run_id);
    case "manifest.resolve":
      return await resolveManifest(db, stage.run_id);
    case "proof.build":
      return await getProofExtractV3Adapter().buildProof(
        db,
        stage,
        stage.run_id,
      );
    case "artboards.build":
      return await buildArtboards(db, stage, stage.run_id);
    case "panels.build": {
      const result = await getProofExtractV3Adapter().buildPanels(
        db,
        stage,
        stage.run_id,
      );
      await publishPanelPreview(db, stage, stage.run_id, result);
      return result;
    }
    case "logos.extract":
      return await extractLogos(db, stage, stage.run_id);
    case "pack.verify":
      return await verifyPack(db, stage, stage.run_id);
    case "pack.activate":
      return await activatePack(db, stage, stage.run_id);
    default:
      // RETRYABLE ON PURPOSE — this is the deploy-ordering seam.
      //
      // Migrations apply the moment a PR merges, but the worker takes a
      // couple of minutes to roll. Any migration that seeds a NEW stage_key
      // therefore opens a window where the database schedules a stage this
      // runner has not learned yet. As a hard failure that window was fatal and
      // silent: retryable=false meant the very first pack submitted inside it
      // died permanently, on a stage that would have been perfectly valid ninety
      // seconds later, and no retry could ever recover it. Adding artboards.build
      // on 2026-07-31 hit exactly this seam — it only escaped because no pack
      // happened to be submitted during the roll.
      //
      // Waiting is strictly better. A stage key that is genuinely unknown (a
      // typo, or one removed from the runner) still fails — it just exhausts
      // max_attempts first and reports the same error, costing a few minutes
      // instead of a customer's pack. A stage key that is merely NEWER than this
      // worker resolves itself the moment the deploy lands.
      //
      // The durable ordering rule still stands: ship the runner in an EARLIER
      // PR than the migration that schedules its stage. This is the safety net
      // for when that is forgotten, not a licence to skip it.
      throw new StageFailure(
        "unknown_entice_stage",
        `Unknown Entice Pack stage ${stage.stage_key} — this runner may predate the migration that scheduled it; retrying while the deploy rolls`,
        true,
        60,
        {
          stageKey: stage.stage_key,
          workerCommit: process.env.GIT_SHA || null,
        },
      );
  }
}

function claimedRow(value) {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;

  // claim_workflow_stage returns workflow_stage_runs directly. PostgREST may
  // represent its SQL NULL as one composite row whose columns are all null.
  // Never hand that shape to processClaim: null identities would heartbeat/fail
  // in a tight loop and starve stages waiting for their retry timestamp.
  if (
    !row.id ||
    !row.run_id ||
    !row.stage_key ||
    !row.lease_token
  ) {
    return null;
  }
  return row;
}

async function processClaim(db, stage) {
  const label = `${stage.run_id}/${stage.stage_key}`;
  const controller = new AbortController();
  let heartbeatInFlight = null;
  let heartbeatVerifiedAt = 0;
  const renewHeartbeat = async (force = false) => {
    if (controller.signal.aborted) return false;
    if (!force && Date.now() - heartbeatVerifiedAt < HEARTBEAT_CACHE_MS) {
      return true;
    }
    if (heartbeatInFlight) return heartbeatInFlight;
    heartbeatInFlight = (async () => {
      const { data, error } = await db.rpc("heartbeat_workflow_stage", {
        p_stage_id: stage.id,
        p_lease_token: stage.lease_token,
        p_lease_seconds: 900,
      });
      if (error || data !== true) {
        console.error(
          `[DESIGNPRO-ENTICE] heartbeat lost ${label}:`,
          error?.message || data,
        );
        controller.abort();
        return false;
      }
      heartbeatVerifiedAt = Date.now();
      return true;
    })().finally(() => {
      heartbeatInFlight = null;
    });
    return heartbeatInFlight;
  };
  const heartbeat = setInterval(() => {
    void renewHeartbeat(true);
  }, 60_000);
  heartbeat.unref?.();
  return CLAIM_CONTEXT.run(
    {
      db,
      stageId: stage.id,
      leaseToken: stage.lease_token,
      controller,
      renewHeartbeat,
    },
    async () => {
      try {
        const initialHeartbeat = await renewHeartbeat(true);
        if (!initialHeartbeat) {
          throw new StageFailure(
            "workflow_lease_lost",
            "Workflow lease ownership was lost before stage execution",
            true,
            5,
          );
        }
        const result = await executeStage(db, stage);
        if (result?.atomicCompletion) {
          console.log(`[DESIGNPRO-ENTICE] completed ${label} atomically`);
          return;
        }
        await assertClaimOwned(true);
        const { data, error } = await db.rpc("complete_workflow_stage", {
          p_stage_id: stage.id,
          p_lease_token: stage.lease_token,
          p_output: result?.output || {},
          p_verification: result?.verification || { verified: true },
          p_output_hash: result?.outputHash || null,
        });
        if (error || data !== true) {
          throw new StageFailure(
            "stage_completion_fenced",
            error?.message || `Unable to complete ${stage.stage_key}`,
            Boolean(error),
            10,
            { databaseError: error?.message || null },
          );
        }
        console.log(`[DESIGNPRO-ENTICE] completed ${label}`);
      } catch (error) {
        const failure =
          error instanceof StageFailure
            ? error
            : new StageFailure(
                "entice_stage_exception",
                String(error?.message || error),
                true,
                20,
              );
        const { data, error: failError } = await db.rpc(
          "fail_workflow_stage",
          {
            p_stage_id: stage.id,
            p_lease_token: stage.lease_token,
            p_error_code: failure.code,
            p_error_message: failure.message,
            p_error_details: failure.details,
            p_retryable: failure.retryable,
            p_retry_delay_seconds: failure.retryDelaySeconds,
          },
        );
        if (failError || data !== true) {
          console.error(
            `[DESIGNPRO-ENTICE] unable to fail ${label}:`,
            failError?.message || data,
          );
        } else {
          console.error(
            `[DESIGNPRO-ENTICE] failed ${label}:`,
            failure.message,
          );
        }
      } finally {
        clearInterval(heartbeat);
        if (heartbeatInFlight) {
          try {
            await heartbeatInFlight;
          } catch {
            // The fenced transition above is authoritative.
          }
        }
      }
    },
  );
}

// A claimant that cannot authenticate to the edge functions must not claim
// entice stages at all — it can only burn the run's attempt budget. The paid
// Production Pack claimant gained this gate on 2026-08-11 after the legacy
// legacy worker deployment (stale env: no WORKER_SECRET, legacy JWT service key)
// burned run 4122e09f's activate_print_worker attempt with 401 — but the
// entice claimant was left ungated, and the same stale runner kept claiming
// proof.build and failing it with 401 from generate-2d-proof (run ede1ab20,
// 2026-08-12 00:01 UTC), blocking every downstream file stage. Same probe,
// same contract: verdict cached five minutes, transport errors are not an
// auth verdict, a repaired environment recovers on its own.
const AUTH_PROBE_TTL_MS = 5 * 60_000;
let authProbe = { ok: null, checkedAt: 0 };
async function runnerCanAuthenticate() {
  const now = Date.now();
  if (authProbe.ok !== null && now - authProbe.checkedAt < AUTH_PROBE_TTL_MS) {
    return authProbe.ok;
  }
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/run-production-flow`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          ...(WORKER_SECRET
            ? { "x-worker-secret": String(WORKER_SECRET).trim() }
            : {}),
        },
        body: JSON.stringify({ mode: "designpro_job", action: "auth_probe" }),
      },
    );
    // ANY non-401/403 response proves the credential was accepted — the probe
    // action itself is unknown to the function and that is fine.
    const ok = response.status !== 401 && response.status !== 403;
    authProbe = { ok, checkedAt: now };
    if (!ok) {
      console.error(
        `[DESIGNPRO-ENTICE] refusing to claim: edge gateway rejected this runner's credentials (HTTP ${response.status}). Set WORKER_SECRET (and a current service key) in this environment, or retire this claimant.`,
      );
    }
    return ok;
  } catch (error) {
    // Transport failure is not an auth verdict: do not block a previously
    // healthy runner on it, and do not cache success from it either.
    console.error(
      `[DESIGNPRO-ENTICE] auth probe transport error: ${String(error?.message || error)}`,
    );
    return authProbe.ok !== false;
  }
}

async function drainClaims(db, workerId) {
  if (pollBusy) return activeClaims;
  pollBusy = true;
  try {
    if (!(await runnerCanAuthenticate())) return activeClaims;
    while (activeClaims < 1) {
      const { data, error } = await db.rpc("claim_workflow_stage", {
        p_worker: workerId,
        p_lease_seconds: 900,
        p_workflow_type: WORKFLOW_TYPE,
      });
      if (error) {
        console.error("[DESIGNPRO-ENTICE] claim failed:", error.message);
        break;
      }
      const stage = claimedRow(data);
      if (!stage) break;
      activeClaims += 1;
      void processClaim(db, stage).finally(() => {
        activeClaims -= 1;
        setTimeout(() => void drainClaims(db, workerId), 0);
      });
    }
    return activeClaims;
  } finally {
    pollBusy = false;
  }
}

function registerDesignProEnticeWorkflow(options) {
  if (pollTimer) return;
  if (
    !options?.app ||
    !options?.supabase ||
    !options?.supabaseUrl ||
    !options?.serviceKey ||
    !options?.workerSecret
  ) {
    throw new Error(
      "DesignPro Entice claimant requires app, Supabase, service key, and worker secret",
    );
  }
  SUPABASE_URL = options.supabaseUrl;
  SERVICE_KEY = options.serviceKey;
  WORKER_SECRET = options.workerSecret;
  SITE_URL = options.siteUrl || SITE_URL;
  const workerId = `designpro-entice-pack:${
    process.env.DESIGNPRO_WORKER_ID ||
    process.env.HOSTNAME ||
    process.pid
  }`;
  options.app.post("/workflow/entice/drain", (req, res) => {
    if (req.headers.authorization !== `Bearer ${options.workerSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    void drainClaims(options.supabase, workerId);
    return res.status(202).json({
      success: true,
      workflowType: WORKFLOW_TYPE,
      activeClaims,
    });
  });
  pollTimer = setInterval(
    () => void drainClaims(options.supabase, workerId),
    5_000,
  );
  pollTimer.unref?.();
  void drainClaims(options.supabase, workerId);
  console.log(
    `[DESIGNPRO-ENTICE] durable stage claimant started as ${workerId}`,
  );
}

module.exports = {
  registerDesignProEnticeWorkflow,
  // Exported so the checkpoint binding is locked by executing it, not by
  // matching source text: the defect it exists to prevent was a rule that read
  // the wrong field while every regex over it still passed.
  STAGE_OUTPUT_HASH_FIELD,
  checkpointHashBindingHolds,
};
