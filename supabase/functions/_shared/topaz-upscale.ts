/**
 * topaz-upscale.ts — Shared upscaler via Topaz Labs Image Enhance API
 *
 * Replaces the previous Real-ESRGAN/Replicate flow. Topaz Standard V2 (and
 * the other Gigapixel-derived models) is served from the single endpoint
 *   POST https://api.topazlabs.com/image/v1/enhance
 *
 * Auth:    X-API-Key header (TOPAZ_API_KEY env)
 * Default: model="Standard V2", output_format mirrors input mime
 *
 * Topaz supports up to 6× upscale in a single request, so we collapse the
 * legacy multi-pass loop into one round-trip whose total scale = scale^passes
 * (capped at 6×). Public signature is unchanged so existing callers keep
 * working without edits beyond the import path.
 *
 * Graceful fallback: returns original bytes on any failure (non-fatal).
 */

const TOPAZ_ENDPOINT = "https://api.topazlabs.com/image/v1/enhance";
// High Fidelity V2 is the sharp, photographic model (best on flag/fabric) and
// carries a much higher megapixel ceiling than Standard V2 — the default so flat
// panels come back CRISP, not soft. Standard V2 (96 MP) was the reason panels
// looked mushy: it 413'd and the caller fell back to a soft interpolated resize.
const TOPAZ_DEFAULT_MODEL = "High Fidelity V2";
const TOPAZ_MAX_SCALE = 6;
const TOPAZ_MAX_OUTPUT_PX = 32_000;
// Optimistic initial output-MP ceiling (High Fidelity V2 allows well beyond
// Standard V2's 96 MP). If Topaz still 413s, we parse the real cap from the
// response and retry clamped to it — so we never silently fall back to soft.
const TOPAZ_MAX_OUTPUT_MP = 250_000_000;

export interface UpscaleResult {
  imageBytes: Uint8Array;
  upscaled: boolean;
  method: string;
  passesCompleted: number;
  elapsedMs: number;
  /** Failure reason surfaced to the caller for diagnostics. */
  error?: string;
}

export interface UpscaleOptions {
  /** Per-pass scale factor (default 2). Combined with `passes` to derive total. */
  scale?: number;
  /** Number of passes (default 2). Total scale = scale^passes, capped at 6×. */
  passes?: number;
  /** Caller user ID — kept for API compatibility (unused with Topaz). */
  userId: string;
  /** Label for logging. */
  label?: string;
  /** Total timeout in ms (default 120s). */
  timeoutMs?: number;
  /** Override Topaz model (default "Standard V2"). */
  model?: string;
  /** Output format: "png" | "jpeg" | "tiff" (default mirrors input mime). */
  outputFormat?: "png" | "jpeg" | "tiff";
}

/** Parse PNG/JPEG header to read intrinsic pixel dimensions. */
function readImageDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A → IHDR width/height at offsets 16/20.
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4E && bytes[3] === 0x47
  ) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
  }
  // JPEG: scan for an SOFn marker (0xFFC0–0xFFCF except C4/C8/CC).
  if (bytes.length >= 4 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
    let i = 2;
    while (i < bytes.length - 8) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const marker = bytes[i + 1];
      i += 2;
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) continue;
      if (i + 1 >= bytes.length) break;
      const segLen = (bytes[i] << 8) | bytes[i + 1];
      const isSOF =
        marker >= 0xC0 && marker <= 0xCF &&
        marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
      if (isSOF && i + 6 < bytes.length) {
        const height = (bytes[i + 3] << 8) | bytes[i + 4];
        const width = (bytes[i + 5] << 8) | bytes[i + 6];
        return { width, height };
      }
      if (segLen < 2) break;
      i += segLen;
    }
  }
  return null;
}

export async function upscaleImageBytes(
  originalBytes: Uint8Array,
  mimeType: string,
  _supabase: any,
  options: UpscaleOptions,
): Promise<UpscaleResult> {
  const {
    scale = 2,
    passes = 2,
    label = "render",
    timeoutMs = 120_000,
    model = TOPAZ_DEFAULT_MODEL,
    outputFormat,
  } = options;

  const startMs = Date.now();
  const apiKey = Deno.env.get("TOPAZ_API_KEY");

  if (!apiKey) {
    console.warn("[TOPAZ] No TOPAZ_API_KEY — skipping upscale");
    return {
      imageBytes: originalBytes,
      upscaled: false,
      method: "none",
      passesCompleted: 0,
      elapsedMs: 0,
    };
  }

  const desiredTotal = Math.max(1, Math.pow(scale, Math.max(1, passes)));
  let totalScale = Math.min(desiredTotal, TOPAZ_MAX_SCALE);

  const isJpegIn = mimeType.includes("jpeg") || mimeType.includes("jpg");
  const fmt = outputFormat ?? (isJpegIn ? "jpeg" : "png");
  const fmtMime =
    fmt === "jpeg" ? "image/jpeg" :
    fmt === "tiff" ? "image/tiff" : "image/png";

  const dims = readImageDimensions(originalBytes);
  let outWidth: number | null = null;
  let outHeight: number | null = null;
  if (dims) {
    // Cap output to Topaz's max dimension so wide panel renders don't 400.
    const maxScaleByWidth = TOPAZ_MAX_OUTPUT_PX / dims.width;
    const maxScaleByHeight = TOPAZ_MAX_OUTPUT_PX / dims.height;
    // Cap by total megapixels too (the 96 MP Topaz ceiling) — this is the one
    // that was missing and made every real panel upscale 413 → blurry fallback.
    const maxScaleByMP = Math.sqrt(TOPAZ_MAX_OUTPUT_MP / (dims.width * dims.height));
    const cap = Math.min(maxScaleByWidth, maxScaleByHeight, maxScaleByMP, TOPAZ_MAX_SCALE);
    if (cap < totalScale) {
      console.warn(
        `[TOPAZ] ${label}: capping scale ${totalScale}× → ${cap.toFixed(2)}× ` +
        `(input ${dims.width}×${dims.height}, max output ${TOPAZ_MAX_OUTPUT_PX}px)`,
      );
      totalScale = Math.max(1, cap);
    }
    outWidth = Math.round(dims.width * totalScale);
    outHeight = Math.round(dims.height * totalScale);
  }

  console.log(
    `[TOPAZ] ${label} — model="${model}", scale=${totalScale.toFixed(2)}× ` +
    `(requested ${desiredTotal}×), in=${(originalBytes.length / 1024 / 1024).toFixed(1)}MB` +
    (dims ? `, ${dims.width}×${dims.height} → ${outWidth}×${outHeight}` : "")
  );

  try {
    const inExt = isJpegIn ? "jpg" : "png";
    // Retry loop: if Topaz still 413s on the megapixel ceiling, parse the real
    // cap ("maximum allowed of X MP") and retry clamped to it — NEVER silently
    // fall back to a soft resize (the root cause of the mushy panels).
    let resp: Response | null = null;
    let errText = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const form = new FormData();
      form.append("image", new Blob([originalBytes], { type: mimeType }), `input.${inExt}`);
      form.append("model", model);
      form.append("output_format", fmt);
      if (outWidth && outHeight) {
        form.append("output_width", String(outWidth));
        form.append("output_height", String(outHeight));
      } else {
        form.append("autopilot", "true");
      }
      resp = await fetch(TOPAZ_ENDPOINT, {
        method: "POST",
        headers: { "X-API-Key": apiKey, Accept: fmtMime },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (resp.ok) break;
      errText = await resp.text().catch(() => "");
      const m = resp.status === 413 && errText.match(/maximum allowed of ([\d.]+)\s*MP/i);
      if (m && attempt < 2 && outWidth && outHeight) {
        const capMP = parseFloat(m[1]) * 1e6;
        const k = Math.sqrt((capMP * 0.98) / (outWidth * outHeight));
        outWidth = Math.max(1, Math.round(outWidth * k));
        outHeight = Math.max(1, Math.round(outHeight * k));
        console.warn(`[TOPAZ] ${label}: ${model} MP cap ${m[1]}MP → retry at ${outWidth}×${outHeight}`);
        continue;
      }
      break;
    }

    if (!resp || !resp.ok) {
      console.error(`[TOPAZ] ${label}: HTTP ${resp?.status} — ${errText.slice(0, 300)}`);
      return {
        imageBytes: originalBytes,
        upscaled: false,
        method: "none",
        passesCompleted: 0,
        elapsedMs: Date.now() - startMs,
        error: `HTTP ${resp?.status}: ${errText.slice(0, 300)}`,
      };
    }

    const buf = await resp.arrayBuffer();
    const outBytes = new Uint8Array(buf);
    const elapsedMs = Date.now() - startMs;
    console.log(
      `[TOPAZ] ${label} OK — ${(outBytes.length / 1024 / 1024).toFixed(1)}MB, ${elapsedMs}ms`,
    );

    return {
      imageBytes: outBytes,
      upscaled: true,
      method: `topaz-${model.replace(/\s+/g, "-").toLowerCase()}-${totalScale.toFixed(2)}x`,
      passesCompleted: 1,
      elapsedMs,
    };
  } catch (err: any) {
    console.error(`[TOPAZ] ${label} error:`, err?.message);
    return {
      imageBytes: originalBytes,
      upscaled: false,
      method: "none",
      passesCompleted: 0,
      elapsedMs: Date.now() - startMs,
      error: `exception: ${err?.message || err}`,
    };
  }
}
