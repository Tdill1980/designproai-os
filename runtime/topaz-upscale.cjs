"use strict";

/**
 * Call 12 — Topaz Labs Image Enhance, ported into the fenced runtime.
 *
 * This is a native port of the Topaz API contract, not a call into any
 * restylepro edge function. It touches no legacy table, no Railway runner and
 * no shared schema: bytes in, bytes out, over HTTPS.
 *
 * Two deliberate differences from the historical shared module:
 *
 * 1. It FAILS CLOSED. The historical `upscaleImageBytes` returns the original
 *    bytes on any failure and marks the result non-fatal, which is how a soft
 *    interpolated panel ships while the receipt claims it was enhanced. Here a
 *    failed enhance fails the stage. A production pack never silently contains
 *    un-upscaled artwork.
 *
 * 2. It is an AUTHORED WINNER, not a reproducible step. Topaz output is not
 *    deterministic, so the result is written once to a material-addressed path
 *    and every downstream stage binds to that hash. You cannot reproduce the
 *    enhance; you can prove the ZIP contains exactly the bytes a human
 *    approved. This is the same pattern Call 8 uses for the authored design.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");

const TOPAZ_ENDPOINT = "https://api.topazlabs.com/image/v1/enhance";
// High Fidelity V2 is the sharp photographic model and carries a far higher
// megapixel ceiling than Standard V2, whose 96 MP cap is what made large flat
// panels 413 and fall back to a soft resize.
const TOPAZ_DEFAULT_MODEL = "High Fidelity V2";
const TOPAZ_MAX_SCALE = 6;
const TOPAZ_MAX_OUTPUT_EDGE_PX = 32_000;
const TOPAZ_CONTRACT = "designpro.call12-topaz-enhance.v1";
const ALLOWED_OUTPUT_TYPES = new Set(["image/png", "image/tiff", "image/jpeg"]);

class UpscaleError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function topazReadiness(env = process.env) {
  const apiKey = String(env.TOPAZ_API_KEY || "").trim();
  const model = String(env.TOPAZ_MODEL || TOPAZ_DEFAULT_MODEL).trim();
  const enabledRaw = String(env.DESIGNPRO_TOPAZ_ENABLED || "").trim().toLowerCase();
  if (enabledRaw !== "true" && enabledRaw !== "false") {
    return { configurationValid: false, enabled: null, available: false, model, detail: "DESIGNPRO_TOPAZ_ENABLED must be exactly true or false" };
  }
  const enabled = enabledRaw === "true";
  if (!enabled) return { configurationValid: true, enabled: false, available: false, model, detail: "Call 12 Topaz enhancement is explicitly disabled" };
  if (!apiKey) return { configurationValid: false, enabled: true, available: false, model, detail: "TOPAZ_API_KEY is required when Call 12 is enabled" };
  return { configurationValid: true, enabled: true, available: true, model, detail: "Call 12 Topaz enhancement is configured" };
}

/**
 * Pure geometry. Decides the exact output pixels Topaz is asked for, clamped to
 * the documented 6x scale ceiling and 32,000 px edge. Deterministic, so the
 * plan can be recorded in the receipt and re-checked independently.
 */
function upscalePlan({ sourceWidthPx, sourceHeightPx, targetWidthPx, targetHeightPx }) {
  const source = [sourceWidthPx, sourceHeightPx].map(Number);
  const target = [targetWidthPx, targetHeightPx].map(Number);
  if (![...source, ...target].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new UpscaleError("upscale_geometry_invalid", "Call 12 requires whole positive source and target pixel geometry");
  }
  const requestedScale = Math.max(target[0] / source[0], target[1] / source[1]);
  if (requestedScale <= 1) {
    throw new UpscaleError("upscale_not_required", "Target geometry is not larger than the source panel");
  }
  const scaleCeiling = Math.min(TOPAZ_MAX_SCALE, TOPAZ_MAX_OUTPUT_EDGE_PX / Math.max(source[0], source[1]));
  const scale = Math.min(requestedScale, scaleCeiling);
  const outputWidth = Math.min(TOPAZ_MAX_OUTPUT_EDGE_PX, Math.max(1, Math.round(source[0] * scale)));
  const outputHeight = Math.min(TOPAZ_MAX_OUTPUT_EDGE_PX, Math.max(1, Math.round(source[1] * scale)));
  return {
    contract: TOPAZ_CONTRACT,
    sourceWidthPx: source[0], sourceHeightPx: source[1],
    targetWidthPx: target[0], targetHeightPx: target[1],
    requestedScale: Math.round(requestedScale * 10000) / 10000,
    appliedScale: Math.round(scale * 10000) / 10000,
    outputWidth, outputHeight,
    // True when Topaz cannot reach the full print target in one request. The
    // remainder is a plain resample and the receipt says so rather than
    // implying the whole distance was enhanced.
    clampedByEngineCeiling: scale < requestedScale,
  };
}

async function enhanceOnce({ apiKey, bytes, mimeType, model, plan, fetchImpl = fetch, signal, timeoutMs = 300_000 }) {
  const form = new FormData();
  const extension = mimeType === "image/tiff" ? "tiff" : mimeType === "image/jpeg" ? "jpg" : "png";
  form.append("image", new Blob([bytes], { type: mimeType }), `input.${extension}`);
  form.append("model", model);
  form.append("output_format", extension === "jpg" ? "jpeg" : extension);
  form.append("output_width", String(plan.outputWidth));
  form.append("output_height", String(plan.outputHeight));
  const response = await fetchImpl(TOPAZ_ENDPOINT, {
    method: "POST",
    headers: { "X-API-Key": apiKey, Accept: mimeType },
    body: form,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const retryable = response.status === 429 || response.status >= 500;
    throw new UpscaleError("topaz_http_error", `Topaz HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`, retryable);
  }
  const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (contentType && !ALLOWED_OUTPUT_TYPES.has(contentType)) {
    throw new UpscaleError("topaz_response_type_invalid", `Topaz returned unsupported ${contentType}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new UpscaleError("topaz_response_empty", "Topaz returned an empty image");
  return buffer;
}

/**
 * Enhances one panel and normalises it to the exact print geometry. Fails
 * closed: there is no path that returns the original bytes while reporting
 * success.
 */
async function enhancePanel(options) {
  const readiness = options.readiness || topazReadiness();
  if (!readiness.enabled || !readiness.available) {
    throw new UpscaleError("topaz_unavailable", `Call 12 cannot run: ${readiness.detail}`);
  }
  const source = Buffer.isBuffer(options.bytes) ? options.bytes : Buffer.from(options.bytes);
  const metadata = await sharp(source, { limitInputPixels: false }).metadata();
  if (!metadata.width || !metadata.height) throw new UpscaleError("upscale_source_unreadable", `${options.surfaceKey} source panel is unreadable`);
  const plan = upscalePlan({
    sourceWidthPx: metadata.width, sourceHeightPx: metadata.height,
    targetWidthPx: options.targetWidthPx, targetHeightPx: options.targetHeightPx,
  });

  let enhanced = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      enhanced = await enhanceOnce({
        apiKey: String(options.apiKey || process.env.TOPAZ_API_KEY || "").trim(),
        bytes: source, mimeType: options.mimeType || "image/png",
        model: readiness.model, plan, fetchImpl: options.fetchImpl, signal: options.signal,
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3 && error.retryable !== false) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      else break;
    }
  }
  if (!enhanced) {
    throw new UpscaleError(lastError?.code || "topaz_enhance_failed", `${options.surfaceKey} Topaz enhancement failed closed: ${lastError?.message || lastError}`, lastError?.retryable === true);
  }

  const enhancedMeta = await sharp(enhanced, { limitInputPixels: false }).metadata();
  if (!enhancedMeta.width || !enhancedMeta.height || enhancedMeta.width < plan.outputWidth * 0.98 || enhancedMeta.height < plan.outputHeight * 0.98) {
    throw new UpscaleError("topaz_output_geometry_invalid", `${options.surfaceKey} Topaz returned ${enhancedMeta.width}x${enhancedMeta.height}, short of the planned ${plan.outputWidth}x${plan.outputHeight}`);
  }
  // Land exactly on the GENIE print geometry. When Topaz reached the target this
  // is a no-op or a sub-pixel correction; when the engine ceiling clamped the
  // request the remainder is a resample and the receipt records that.
  const bytes = await sharp(enhanced, { limitInputPixels: false })
    .resize(Number(options.targetWidthPx), Number(options.targetHeightPx), { fit: "fill", kernel: "lanczos3" })
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .png({ compressionLevel: 6, adaptiveFiltering: false, force: true })
    .toBuffer();
  return {
    surfaceKey: options.surfaceKey,
    bytes, contentHash: sha256(bytes), byteSize: bytes.length,
    enhancedSha256: sha256(enhanced),
    enhancedWidthPx: enhancedMeta.width, enhancedHeightPx: enhancedMeta.height,
    plan, model: readiness.model, engine: "topaz-image-enhance",
    contract: TOPAZ_CONTRACT,
  };
}

module.exports = {
  ALLOWED_OUTPUT_TYPES,
  TOPAZ_CONTRACT,
  TOPAZ_DEFAULT_MODEL,
  TOPAZ_ENDPOINT,
  TOPAZ_MAX_OUTPUT_EDGE_PX,
  TOPAZ_MAX_SCALE,
  UpscaleError,
  enhancePanel,
  topazReadiness,
  upscalePlan,
  _test: { enhanceOnce, sha256 },
};
