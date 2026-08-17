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
 * panelizer-step-flatten — Step 5: Resize + Bleed in one pass
 *
 * Input:  { inputPath, userId, jobId, panelKey, widthInches, heightInches }
 * Output: { storagePath } — panel resized to target DPI WITH 0.5" bleed
 *
 * COMBINED flatten + bleed in a single step to avoid memory overflow.
 * Input from GENIE/crop is small (~1-4 MP). We resize to panel dimensions,
 * then build the bleed-extended output using direct bitmap access.
 * Only ONE large image + one resized panel in memory at peak.
 *
 * No AI — pure math.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { downloadFromStorage, uploadToStorage } from "../_shared/panelizer-os/storage.ts";
import {
  tempPath,
  OUTPUT_SCALE,
  BLEED_INCHES,
  getSafeDpi,
} from "../_shared/panelizer-os/constants.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { inputPath, userId, jobId, panelKey, widthInches, heightInches } = await req.json();

    if (!inputPath || !userId || !jobId || !panelKey || !widthInches || !heightInches) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[FLATTEN] Job ${jobId} — resize+bleed ${panelKey}`);
    const startMs = Date.now();

    // Calculate panel + bleed dimensions
    const { dpi, capped } = getSafeDpi(widthInches, heightInches);
    const bleedPx = Math.round(BLEED_INCHES * OUTPUT_SCALE * dpi);
    const panelW = Math.round(widthInches * OUTPUT_SCALE * dpi);
    const panelH = Math.round(heightInches * OUTPUT_SCALE * dpi);
    const outW = panelW + bleedPx * 2;
    const outH = panelH + bleedPx * 2;

    if (capped) {
      console.log(`[FLATTEN] DPI capped to ${dpi} for memory safety`);
    }
    console.log(`[FLATTEN] Panel: ${panelW}x${panelH} + ${bleedPx}px bleed = ${outW}x${outH} (${dpi} DPI @ ${OUTPUT_SCALE * 100}% scale)`);

    // Download input (small from GENIE/crop, typically 1-4 MP)
    const inputBytes = await downloadFromStorage(inputPath);
    let img = await Image.decode(inputBytes);
    console.log(`[FLATTEN] Input: ${img.width}x${img.height}px (${(inputBytes.byteLength / 1024).toFixed(0)} KB)`);

    // ── Input size cap: safety valve for oversized ESRGAN outputs ──
    const INPUT_MAX_EDGE = 4096;
    if (img.width > INPUT_MAX_EDGE || img.height > INPUT_MAX_EDGE) {
      const scale = INPUT_MAX_EDGE / Math.max(img.width, img.height);
      const newW = Math.round(img.width * scale);
      const newH = Math.round(img.height * scale);
      console.log(`[FLATTEN] Input capped: ${img.width}x${img.height} → ${newW}x${newH} (max edge ${INPUT_MAX_EDGE}px)`);
      img = img.resize(newW, newH);
    }

    // ── Aspect-ratio correction ─────────────────────────────────
    const inputRatio = img.width / img.height;
    const panelRatio = panelW / panelH;
    const ratioDiff = Math.abs(inputRatio - panelRatio) / panelRatio;

    if (ratioDiff > 0.03) {
      let cropW: number, cropH: number, cropX: number, cropY: number;
      if (inputRatio > panelRatio) {
        cropH = img.height;
        cropW = Math.round(img.height * panelRatio);
        cropX = Math.round((img.width - cropW) / 2);
        cropY = 0;
      } else {
        cropW = img.width;
        cropH = Math.round(img.width / panelRatio);
        cropX = 0;
        cropY = Math.round((img.height - cropH) / 2);
      }
      cropW = Math.min(cropW, img.width - cropX);
      cropH = Math.min(cropH, img.height - cropY);
      console.log(`[FLATTEN] Aspect correction: ${inputRatio.toFixed(3)} → ${panelRatio.toFixed(3)} (${(ratioDiff * 100).toFixed(1)}% off)`);
      img = img.crop(Math.max(1, cropX), Math.max(1, cropY), cropW, cropH);
    }

    // ── Resize directly to full output (panel + bleed) ────────────
    // This avoids the memory spike of having two separate large images.
    // The design fills edge-to-edge including the bleed zone — the 0.29%
    // stretch in the bleed area is imperceptible and gets trimmed off.
    const output = img.resize(outW, outH);
    // Free input
    img = null as any;

    // Encode and upload
    const outputBytes = await output.encode();
    const storagePath = tempPath(userId, jobId, `step-3-flatten-${panelKey}`);
    await uploadToStorage(storagePath, outputBytes, "image/png");

    console.log(`[FLATTEN] ${panelKey}: → ${outW}x${outH} (+${bleedPx}px bleed) (${(outputBytes.byteLength / 1024).toFixed(0)} KB) in ${Date.now() - startMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        storagePath,
        panelKey,
        panelWidth: panelW,
        panelHeight: panelH,
        bleedPx,
        outputWidth: outW,
        outputHeight: outH,
        dpi,
        dpiCapped: capped,
        aspectCorrected: ratioDiff > 0.03,
        bleedIncluded: true,
        step: "flatten",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[FLATTEN] Error:", err);
    return new Response(
      JSON.stringify({ error: `Flatten step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
