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

function createProvider(options = {}) {
  const env = options.env || process.env;
  const keys = options.keys || readKeyPool(env);
  const models = options.models || imageModels(env);
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
          const response = await fetchImpl(`${ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
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

  function state() {
    return keys.map((key) => ({ key: keyFingerprint(key), ...health.get(key) }));
  }

  return { generateImage, state, models: [...models], keyCount: keys.length, contract: PROVIDER_CONTRACT };
}

module.exports = {
  COOLDOWN_MS,
  DEFAULT_IMAGE_MODELS,
  PROVIDER_CONTRACT,
  ProviderError,
  createProvider,
  imageModels,
  keyFingerprint,
  readKeyPool,
};
