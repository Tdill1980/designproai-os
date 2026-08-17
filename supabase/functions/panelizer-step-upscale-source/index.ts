/**
 * ─────────────────────────────────────────────────────────────
 *  GENIE™ Universal Panelizer
 *  Part of the LiftIQ Engine™ / Prompt-to-Production™ architecture.
 *
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *  Proprietary & confidential. Contains trade-secret methods
 *  (layer-separated generative render & panel synthesis).
 *  Trademarks: GENIE™, DesignIQ™, LiftIQ™ — see /NOTICE and
 *  docs/TRADEMARKS.md. Not legal advice.
 * ─────────────────────────────────────────────────────────────
 */
/**
 * panelizer-step-upscale-source — Step 3: Upscale source render via Real-ESRGAN
 *
 * Input:  { inputPath, userId, jobId }
 * Output: { storagePath, upscaled: true/false }
 *
 * Upscales the 4K Gemini source render to 8K (2x) BEFORE the Fill step,
 * so the AI has maximum detail for panel extraction.
 *
 * Non-blocking: if the upscaler fails or times out, returns the
 * original resolution path so the pipeline continues.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  uploadToStorage,
  getSignedUrl,
} from "../_shared/panelizer-os/storage.ts";
import {
  tempPath,
  REPLICATE_MODEL_VERSION,
  REPLICATE_POLL_MAX,
  REPLICATE_POLL_INTERVAL_MS,
} from "../_shared/panelizer-os/constants.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { inputPath, userId, jobId } = await req.json();

    if (!inputPath || !userId || !jobId) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
    if (!REPLICATE_API_TOKEN) {
      console.warn("[UPSCALE-SOURCE] REPLICATE_API_TOKEN not configured — returning original");
      return new Response(
        JSON.stringify({
          success: true,
          storagePath: inputPath,
          upscaled: false,
          fallback: "no_api_token",
          step: "upscale_source",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[UPSCALE-SOURCE] Job ${jobId} — upscaling source render via Replicate`);
    const startMs = Date.now();

    // 45-second hard timeout — must finish before edge function wall time (~60s)
    const STEP_TIMEOUT_MS = 45_000;
    const controller = new AbortController();
    const stepTimeout = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS);

    try {
      // Get a signed URL so Replicate can fetch the image
      const signedUrl = await getSignedUrl(inputPath);
      console.log(`[UPSCALE-SOURCE] Signed URL generated: ${signedUrl.substring(0, 80)}...`);

      // Submit to Replicate (with abort signal)
      const createResponse = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          version: REPLICATE_MODEL_VERSION,
          input: {
            image: signedUrl,
            scale: 4,
            face_enhance: false,
          },
        }),
        signal: controller.signal,
      });

      let result = await createResponse.json();
      let pollAttempts = 0;

      // Poll for completion if not synchronous
      while (
        result.status !== "succeeded" &&
        result.status !== "failed" &&
        result.status !== "canceled" &&
        pollAttempts < REPLICATE_POLL_MAX
      ) {
        await new Promise((r) => setTimeout(r, REPLICATE_POLL_INTERVAL_MS));
        pollAttempts++;

        if (!result.urls?.get) break;

        const pollResponse = await fetch(result.urls.get, {
          headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
          signal: controller.signal,
        });
        result = await pollResponse.json();
      }

      clearTimeout(stepTimeout);

      if (result.status !== "succeeded" || !result.output) {
        console.warn(`[UPSCALE-SOURCE] Replicate failed (status: ${result.status}) — falling back to original`);
        return new Response(
          JSON.stringify({
            success: true,
            storagePath: inputPath,
            upscaled: false,
            fallback: "replicate_failed",
            replicateStatus: result.status,
            step: "upscale_source",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Download the upscaled image from Replicate
      const upscaledUrl = typeof result.output === "string" ? result.output : result.output[0];
      const upscaledResp = await fetch(upscaledUrl, { signal: controller.signal });
      if (!upscaledResp.ok) {
        console.warn("[UPSCALE-SOURCE] Failed to download upscaled image — falling back");
        return new Response(
          JSON.stringify({
            success: true,
            storagePath: inputPath,
            upscaled: false,
            fallback: "download_failed",
            step: "upscale_source",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const upscaledBytes = new Uint8Array(await upscaledResp.arrayBuffer());

      // Upload upscaled source to storage
      const storagePath = tempPath(userId, jobId, "step-1.5-upscaled-source");
      await uploadToStorage(storagePath, upscaledBytes, "image/png");

      console.log(`[UPSCALE-SOURCE] ${(upscaledBytes.byteLength / 1024).toFixed(0)} KB (4x) in ${Date.now() - startMs}ms`);

      return new Response(
        JSON.stringify({
          success: true,
          storagePath,
          upscaled: true,
          sizeBytes: upscaledBytes.byteLength,
          pollAttempts,
          step: "upscale_source",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (timeoutOrFetchErr) {
      clearTimeout(stepTimeout);
      const isTimeout = timeoutOrFetchErr.name === "AbortError";
      console.warn(`[UPSCALE-SOURCE] ${isTimeout ? "45s TIMEOUT" : "Fetch error"} — using original image (pipeline continues)`);
      return new Response(
        JSON.stringify({
          success: true,
          storagePath: inputPath,
          upscaled: false,
          fallback: isTimeout ? "timeout_45s" : "fetch_error",
          error: timeoutOrFetchErr.message,
          step: "upscale_source",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (err) {
    console.error("[UPSCALE-SOURCE] Error:", err);
    // Non-blocking: return original on error
    try {
      const { inputPath: ip } = await req.clone().json();
      return new Response(
        JSON.stringify({
          success: true,
          storagePath: ip || "",
          upscaled: false,
          fallback: "exception",
          error: err.message,
          step: "upscale_source",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch {
      return new Response(
        JSON.stringify({
          success: true,
          storagePath: "",
          upscaled: false,
          fallback: "exception",
          error: err.message,
          step: "upscale_source",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }
});
