"use strict";

/**
 * DesignPro-owned image provider.
 *
 * The source system carried a key pool and a model fallback chain inside its
 * generation function. That resilience is preserved here, but as one module
 * this repository owns rather than as legacy coupling: explicit primary and
 * fallback ordering, per-key health with cooldown, and no provider credential
 * that could reach a browser — every call is server-side behind the worker
 * secret, the same fence Calls 8-12 sit behind.
 *
 * Failure is explicit. When every key and every model is exhausted the call
 * throws with the reason per attempt. Nothing here returns a placeholder or a
 * degraded image while reporting success.
 */

const { createHash } = require("node:crypto");

const ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const PROVIDER_CONTRACT = "designpro.generation-provider.v1";
// Ported from the frozen source's model chain: pro image first, flash image as
// the fallback when pro is unavailable or over capacity.
const DEFAULT_IMAGE_MODELS = Object.freeze(["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"]);
const DEFAULT_SPEC_MODELS = Object.freeze(["gemini-2.5-flash"]);
// A thinking model charges its deliberation against the same budget as its
// answer. genie-universal-resolver lost whole responses at 2048 and settled on
// 8192; a composition is a longer answer than a dimension lookup, so it starts
// from that proven floor rather than below it.
const SPEC_MAX_OUTPUT_TOKENS = 8192;
const COOLDOWN_MS = 60_000;
const ALLOWED_RESPONSE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

class ProviderError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function keyFingerprint(key) {
  return createHash("sha256").update(String(key)).digest("hex").slice(0, 12);
}

/**
 * The ONE place a model endpoint and its credential are assembled.
 *
 * Every call in this runtime resolves its URL and auth header here. That is
 * deliberate: moving to Vertex AI changes the host, the path shape and the
 * credential (OAuth bearer instead of a query-string key) all at once, and a
 * provider switch that has to be repeated at five call sites is a provider
 * switch that will be done at four of them. Callers never build a URL.
 */
function endpointFor(model, credential) {
  return {
    url: `${ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(credential)}`,
    headers: { "content-type": "application/json" },
  };
}

/**
 * Reads the pool from the environment. Accepts either a single key or a
 * comma-separated set, so a single-key deployment keeps working unchanged while
 * a pooled one gains rotation.
 */
function readKeyPool(env = process.env) {
  const raw = String(env.GOOGLE_AI_API_KEY_POOL || env.GOOGLE_AI_API_KEY || env.GEMINI_API_KEY || "");
  const keys = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  if (!keys.length) throw new ProviderError("provider_key_missing", "No Google AI key is configured");
  return keys;
}

function imageModels(env = process.env) {
  const raw = String(env.DESIGNPRO_IMAGE_MODELS || "").trim();
  const models = raw ? raw.split(",").map((value) => value.trim()).filter(Boolean) : [...DEFAULT_IMAGE_MODELS];
  for (const model of models) {
    if (!/^gemini-[a-z0-9.-]*image[a-z0-9.-]*$/.test(model)) {
      throw new ProviderError("provider_model_invalid", `${model} is not an explicit Gemini image model`);
    }
  }
  return models;
}

/**
 * The models allowed to author a creative SPECIFICATION rather than a picture.
 *
 * Kept separate from the image chain on purpose: an image model answers with
 * pixels, and the authoring boundary needs structured JSON. gemini-2.5-flash is
 * the text model this runtime already trusts for a grounded JSON answer
 * (genie-universal-resolver), so the specification call uses the same one
 * rather than introducing an unproven id.
 */
function specificationModels(env = process.env) {
  const raw = String(env.DESIGNPRO_SPEC_MODELS || "").trim();
  const models = raw ? raw.split(",").map((value) => value.trim()).filter(Boolean) : [...DEFAULT_SPEC_MODELS];
  for (const model of models) {
    if (!/^gemini-[a-z0-9.-]+$/.test(model) || /image/.test(model)) {
      throw new ProviderError("provider_spec_model_invalid", `${model} is not an explicit Gemini text model`);
    }
  }
  return models;
}

function createProvider(options = {}) {
  const env = options.env || process.env;
  const keys = options.keys || readKeyPool(env);
  const models = options.models || imageModels(env);
  const specModels = options.specModels || specificationModels(env);
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || (() => Date.now());
  const cooldownMs = options.cooldownMs == null ? COOLDOWN_MS : Number(options.cooldownMs);
  // Health is per key: a key that 429s or 5xxs is rested rather than retried
  // into the ground, and the next key takes the call.
  const health = new Map(keys.map((key) => [key, { failures: 0, restUntil: 0 }]));

  function availableKeys() {
    const time = now();
    const ready = keys.filter((key) => health.get(key).restUntil <= time);
    return ready.length ? ready : keys;
  }

  function rest(key, ms) {
    const state = health.get(key);
    state.failures += 1;
    state.restUntil = now() + ms;
  }

  function recover(key) {
    const state = health.get(key);
    state.failures = 0;
    state.restUntil = 0;
  }

  async function generateImage({ parts, aspectRatio, imageSize, signal, timeoutMs = 180_000, label = "render" }) {
    const attempts = [];
    for (const model of models) {
      for (const key of availableKeys()) {
        const fingerprint = keyFingerprint(key);
        try {
          const request = endpointFor(model, key);
          const response = await fetchImpl(request.url, {
            method: "POST",
            headers: request.headers,
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio, imageSize } },
            }),
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
          });
          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            const overloaded = response.status === 429 || response.status >= 500;
            if (overloaded) rest(key, cooldownMs);
            attempts.push({ model, key: fingerprint, status: response.status, detail: detail.slice(0, 160) });
            continue;
          }
          const payload = await response.json();
          const images = (payload?.candidates?.[0]?.content?.parts || []).filter((part) => part?.inlineData?.data);
          if (images.length !== 1) {
            const reason = payload?.candidates?.[0]?.finishReason || payload?.promptFeedback?.blockReason || "unknown";
            attempts.push({ model, key: fingerprint, status: 200, detail: `expected one image, received ${images.length} (${reason})` });
            continue;
          }
          const mimeType = String(images[0].inlineData.mimeType || "").toLowerCase();
          if (!ALLOWED_RESPONSE_TYPES.has(mimeType)) {
            attempts.push({ model, key: fingerprint, status: 200, detail: `unsupported ${mimeType}` });
            continue;
          }
          const bytes = Buffer.from(String(images[0].inlineData.data), "base64");
          if (!bytes.length) {
            attempts.push({ model, key: fingerprint, status: 200, detail: "empty image" });
            continue;
          }
          recover(key);
          return { bytes, contentType: mimeType, model, keyFingerprint: fingerprint, attempts, contract: PROVIDER_CONTRACT };
        } catch (error) {
          rest(key, cooldownMs);
          attempts.push({ model, key: fingerprint, status: 0, detail: String(error?.message || error).slice(0, 160) });
        }
      }
    }
    throw new ProviderError(
      "provider_exhausted",
      `${label} failed on every model and key: ${attempts.map((a) => `${a.model}/${a.key}:${a.status} ${a.detail}`).join(" | ")}`,
      true,
    );
  }

  /**
   * One creative decision, returned as data instead of pixels.
   *
   * This is the same creative brain the image call uses — same key pool, same
   * health and cooldown — asked to state what it decided rather than to paint
   * it. Nothing here interprets the answer: the caller owns every guard about
   * what a specification is allowed to contain, because those guards are
   * production authority and this module is transport.
   */
  async function generateSpecification({ parts, signal, timeoutMs = 120_000, temperature = 0.4, label = "specification" }) {
    const attempts = [];
    for (const model of specModels) {
      for (const key of availableKeys()) {
        const fingerprint = keyFingerprint(key);
        try {
          const request = endpointFor(model, key);
          const response = await fetchImpl(request.url, {
            method: "POST",
            headers: request.headers,
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                temperature,
                maxOutputTokens: SPEC_MAX_OUTPUT_TOKENS,
                responseMimeType: "application/json",
              },
            }),
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
          });
          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            if (response.status === 429 || response.status >= 500) rest(key, cooldownMs);
            attempts.push({ model, key: fingerprint, status: response.status, detail: detail.slice(0, 160) });
            continue;
          }
          const payload = await response.json();
          const candidate = payload?.candidates?.[0];
          const text = (candidate?.content?.parts || []).map((part) => part.text || "").join("").trim();
          if (!text) {
            // Truncation, a safety block and an empty answer are indistinguishable
            // downstream unless the reason is carried here.
            const finish = String(candidate?.finishReason || payload?.promptFeedback?.blockReason || "none");
            attempts.push({ model, key: fingerprint, status: 200, detail: `empty specification (${finish})` });
            continue;
          }
          let specification;
          try {
            specification = JSON.parse(text);
          } catch {
            attempts.push({ model, key: fingerprint, status: 200, detail: `unparseable JSON: ${text.slice(0, 120).replace(/\s+/g, " ")}` });
            continue;
          }
          if (!specification || typeof specification !== "object" || Array.isArray(specification)) {
            attempts.push({ model, key: fingerprint, status: 200, detail: "specification is not a JSON object" });
            continue;
          }
          recover(key);
          return { specification, model, keyFingerprint: fingerprint, attempts, contract: PROVIDER_CONTRACT };
        } catch (error) {
          rest(key, cooldownMs);
          attempts.push({ model, key: fingerprint, status: 0, detail: String(error?.message || error).slice(0, 160) });
        }
      }
    }
    throw new ProviderError(
      "provider_specification_exhausted",
      `${label} failed on every model and key: ${attempts.map((a) => `${a.model}/${a.key}:${a.status} ${a.detail}`).join(" | ")}`,
      true,
    );
  }

  /**
   * One request to one named model, returned raw.
   *
   * This exists for the calls that are neither "paint me an image" nor "decide
   * one thing as JSON" -- GENIE's grounded dimension lookup, the flat-wrap
   * layout pass, the logo locator. Each of those had built its own fetch with
   * its own inline endpoint and its own bare `process.env` key read, which is
   * how three call sites ended up outside the key pool: no rotation, no
   * cooldown, and one more URL to forget when the provider changes.
   *
   * The body is the caller's, verbatim. Nothing here inspects or rewrites it,
   * because these callers own guards this module has no business knowing.
   */
  async function generateRaw({ model, body, signal, timeoutMs = 120_000, label = "model call" }) {
    const target = String(model || "").trim();
    if (!target) throw new ProviderError("provider_model_missing", "generateRaw requires an explicit model", false);
    if (!body || typeof body !== "object") throw new ProviderError("provider_body_missing", "generateRaw requires a request body", false);
    const attempts = [];
    for (const key of availableKeys()) {
      const fingerprint = keyFingerprint(key);
      try {
        const request = endpointFor(target, key);
        const response = await fetchImpl(request.url, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          if (response.status === 429 || response.status >= 500) rest(key, cooldownMs);
          attempts.push({ model: target, key: fingerprint, status: response.status, detail: detail.slice(0, 160) });
          continue;
        }
        const payload = await response.json();
        recover(key);
        return { payload, model: target, keyFingerprint: fingerprint, attempts, contract: PROVIDER_CONTRACT };
      } catch (error) {
        rest(key, cooldownMs);
        attempts.push({ model: target, key: fingerprint, status: 0, detail: String(error?.message || error).slice(0, 160) });
      }
    }
    throw new ProviderError(
      "provider_request_exhausted",
      `${label} failed on every key: ${attempts.map((a) => `${a.model}/${a.key}:${a.status} ${a.detail}`).join(" | ")}`,
      true,
    );
  }

  function state() {
    return keys.map((key) => ({ key: keyFingerprint(key), ...health.get(key) }));
  }

  return {
    generateImage,
    generateRaw,
    generateSpecification,
    state,
    models: [...models],
    specModels: [...specModels],
    keyCount: keys.length,
    contract: PROVIDER_CONTRACT,
  };
}

module.exports = {
  COOLDOWN_MS,
  DEFAULT_IMAGE_MODELS,
  DEFAULT_SPEC_MODELS,
  PROVIDER_CONTRACT,
  SPEC_MAX_OUTPUT_TOKENS,
  ProviderError,
  createProvider,
  endpointFor,
  imageModels,
  keyFingerprint,
  readKeyPool,
  specificationModels,
};
