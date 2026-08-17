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
 * panelizer-step-upscale — Step 6: AI upscale via shared Topaz Labs upscaler
 *
 * Uses the shared topaz-upscale.ts module (Topaz Image Enhance API,
 * Standard V2) to take artboards up to 4× total in a single round-trip.
 *
 * Non-blocking: if the upscaler fails or times out, returns the
 * original resolution path so the pipeline continues.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  downloadFromStorage,
  uploadToStorage,
  getSignedUrl,
} from "../_shared/panelizer-os/storage.ts";
import { tempPath } from "../_shared/panelizer-os/constants.ts";
import { upscaleImageBytes } from "../_shared/topaz-upscale.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Build a lightweight Supabase client for the shared upscaler
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ════════════════════════════════════════════════════════════
    // ARTBOARD MODE — Single-file upscale for simplified pipeline
    // ════════════════════════════════════════════════════════════
    if (body.artboardMode) {
      const { artboardPath, userId: uid, jobId: jid, orderNumber } = body;
      if (!artboardPath || !uid || !jid) {
        return new Response(
          JSON.stringify({ error: "artboardMode requires artboardPath, userId, jobId" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const startMs = Date.now();
      console.log(`[UPSCALE-ARTBOARD] Job ${jid} — multi-pass upscaling master artboard`);

      // Download the artboard bytes
      const originalBytes = await downloadFromStorage(artboardPath);
      console.log(`[UPSCALE-ARTBOARD] Downloaded: ${(originalBytes.byteLength / 1024).toFixed(0)} KB`);

      // Multi-pass upscale: 2x × 2 passes = 4x total
      const result = await upscaleImageBytes(originalBytes, "image/png", sb, {
        scale: 2,
        passes: 2,
        userId: uid,
        label: "artboard",
        timeoutMs: 120_000,
      });

      // Save as production file
      const outputPath = `production-packs/${uid}/${orderNumber || jid}/master-artboard-production.png`;
      await uploadToStorage(outputPath, result.imageBytes, "image/png");

      const { data: signedData } = await sb.storage.from("wrap-files")
        .createSignedUrl(outputPath, 60 * 60 * 24 * 30); // 30 days

      const elapsedMs = Date.now() - startMs;
      console.log(`[UPSCALE-ARTBOARD] Done: ${(result.imageBytes.byteLength / 1024).toFixed(0)} KB, ${result.method}, ${elapsedMs}ms`);

      return new Response(
        JSON.stringify({
          success: true,
          storagePath: outputPath,
          signedUrl: signedData?.signedUrl || "",
          upscaled: result.upscaled,
          method: result.method,
          passesCompleted: result.passesCompleted,
          sizeBytes: result.imageBytes.byteLength,
          ms: elapsedMs,
          step: "upscale-artboard",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ════════════════════════════════════════════════════════════
    // LEGACY PER-PANEL MODE — Original upscale behavior
    // ════════════════════════════════════════════════════════════
    const { inputPath, userId, jobId, panelKey } = body;

    if (!inputPath || !userId || !jobId || !panelKey) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const replicateKey = Deno.env.get("REPLICATE_API_TOKEN");
    if (!replicateKey) {
      console.warn("[UPSCALE] REPLICATE_API_TOKEN not configured — returning original");
      return new Response(
        JSON.stringify({
          success: true,
          storagePath: inputPath,
          panelKey,
          upscaled: false,
          fallback: "original_resolution",
          step: "upscale",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const startMs = Date.now();
    console.log(`[UPSCALE] Job ${jobId} — multi-pass upscaling ${panelKey}`);

    // Download panel bytes
    const originalBytes = await downloadFromStorage(inputPath);
    console.log(`[UPSCALE] ${panelKey} downloaded: ${(originalBytes.byteLength / 1024).toFixed(0)} KB`);

    // Multi-pass upscale: 2x × 2 passes = 4x total
    const result = await upscaleImageBytes(originalBytes, "image/png", sb, {
      scale: 2,
      passes: 2,
      userId,
      label: panelKey,
      timeoutMs: 120_000,
    });

    // Upload upscaled panel to storage
    const storagePath = tempPath(userId, jobId, `step-6-upscale-${panelKey}`);
    await uploadToStorage(storagePath, result.imageBytes, "image/png");

    console.log(`[UPSCALE] ${panelKey}: ${(result.imageBytes.byteLength / 1024).toFixed(0)} KB (${result.method}) in ${Date.now() - startMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        storagePath,
        panelKey,
        upscaled: result.upscaled,
        method: result.method,
        passesCompleted: result.passesCompleted,
        sizeBytes: result.imageBytes.byteLength,
        step: "upscale",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[UPSCALE] Error:", err);
    try {
      const { inputPath: ip, panelKey: pk } = await req.clone().json();
      return new Response(
        JSON.stringify({
          success: true,
          storagePath: ip || "",
          panelKey: pk || "unknown",
          upscaled: false,
          fallback: "exception",
          error: err.message,
          step: "upscale",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch {
      return new Response(
        JSON.stringify({
          success: true,
          storagePath: "",
          panelKey: "unknown",
          upscaled: false,
          fallback: "exception",
          error: err.message,
          step: "upscale",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }
});
