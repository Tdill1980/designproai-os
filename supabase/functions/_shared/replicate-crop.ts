/**
 * replicate-crop.ts — Offload image cropping to Replicate
 *
 * Mirrors the esrgan-upscale.ts pattern:
 *   1. Get a signed URL for the source image in storage
 *   2. POST a Replicate prediction with crop coordinates
 *   3. Poll until complete
 *   4. Download the cropped result
 *   5. Upload to temp storage
 *
 * This avoids loading the full RGBA bitmap into edge-function memory
 * (the 238 MB Deno limit that killed ImageScript-based crop).
 *
 * Uses the same REPLICATE_API_TOKEN already in Supabase secrets.
 */

import {
  REPLICATE_CROP_MODEL_VERSION,
  REPLICATE_POLL_MAX,
  REPLICATE_POLL_INTERVAL_MS,
} from "./panelizer-os/constants.ts";

export interface CropParams {
  /** Crop region X offset as fraction of image width (0–1) */
  x: number;
  /** Crop region Y offset as fraction of image height (0–1) */
  y: number;
  /** Crop region width as fraction of image width (0–1) */
  w: number;
  /** Crop region height as fraction of image height (0–1) */
  h: number;
}

export interface CropResult {
  imageBytes: Uint8Array;
  cropped: boolean;
  elapsedMs: number;
  error?: string;
}

/**
 * Crop an image via Replicate.
 *
 * @param signedUrl  Public URL Replicate can fetch (signed Supabase URL)
 * @param crop       Crop region as fractions (0–1)
 * @param timeoutMs  Max wall-clock time (default 60 s)
 */
export async function replicateCrop(
  signedUrl: string,
  crop: CropParams,
  timeoutMs = 60_000,
): Promise<CropResult> {
  const startMs = Date.now();
  const replicateKey = Deno.env.get("REPLICATE_API_TOKEN");

  if (!replicateKey) {
    return { imageBytes: new Uint8Array(), cropped: false, elapsedMs: 0, error: "No REPLICATE_API_TOKEN" };
  }

  try {
    // 1. Create prediction
    const predResp = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicateKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: REPLICATE_CROP_MODEL_VERSION,
        input: {
          image: signedUrl,
          crop_x: crop.x,
          crop_y: crop.y,
          crop_w: crop.w,
          crop_h: crop.h,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!predResp.ok) {
      const errText = await predResp.text().catch(() => "");
      return {
        imageBytes: new Uint8Array(),
        cropped: false,
        elapsedMs: Date.now() - startMs,
        error: `Replicate create failed HTTP ${predResp.status}: ${errText}`,
      };
    }

    const prediction = await predResp.json();
    const predictionId = prediction.id;
    console.log(`[CROP-REPLICATE] Prediction ${predictionId} created`);

    // 2. Poll for completion
    let outputUrl: string | null = null;
    for (let poll = 0; poll < REPLICATE_POLL_MAX; poll++) {
      await new Promise((r) => setTimeout(r, REPLICATE_POLL_INTERVAL_MS));

      if (Date.now() - startMs > timeoutMs) {
        return {
          imageBytes: new Uint8Array(),
          cropped: false,
          elapsedMs: Date.now() - startMs,
          error: `Timeout after ${timeoutMs}ms`,
        };
      }

      const statusResp = await fetch(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: { Authorization: `Bearer ${replicateKey}` },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!statusResp.ok) continue;
      const status = await statusResp.json();

      if (status.status === "succeeded" && status.output) {
        outputUrl = typeof status.output === "string"
          ? status.output
          : status.output[0] || status.output;
        break;
      }
      if (status.status === "failed" || status.status === "canceled") {
        return {
          imageBytes: new Uint8Array(),
          cropped: false,
          elapsedMs: Date.now() - startMs,
          error: `Prediction ${status.status}: ${status.error || "unknown"}`,
        };
      }
    }

    if (!outputUrl) {
      return {
        imageBytes: new Uint8Array(),
        cropped: false,
        elapsedMs: Date.now() - startMs,
        error: "Poll exhausted — no output URL",
      };
    }

    // 3. Download cropped result
    const dlResp = await fetch(outputUrl, { signal: AbortSignal.timeout(30_000) });
    if (!dlResp.ok) {
      return {
        imageBytes: new Uint8Array(),
        cropped: false,
        elapsedMs: Date.now() - startMs,
        error: `Download failed HTTP ${dlResp.status}`,
      };
    }

    const buf = await dlResp.arrayBuffer();
    const imageBytes = new Uint8Array(buf);

    console.log(`[CROP-REPLICATE] Done — ${(imageBytes.length / 1024).toFixed(0)} KB in ${Date.now() - startMs}ms`);
    return { imageBytes, cropped: true, elapsedMs: Date.now() - startMs };
  } catch (err: any) {
    return {
      imageBytes: new Uint8Array(),
      cropped: false,
      elapsedMs: Date.now() - startMs,
      error: `Crop error: ${err?.message}`,
    };
  }
}
