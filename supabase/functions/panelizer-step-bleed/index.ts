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
 * panelizer-step-bleed — Step 5: Add production bleed to panel edges
 *
 * Input:  { inputPath, userId, jobId, panelKey, widthInches, heightInches }
 * Output: { storagePath } — panel with bleed extension, saved to temp storage
 *
 * Extends the panel edges by BLEED_INCHES on all four sides.
 * Uses edge-pixel mirroring: the outermost row/column of pixels
 * is reflected outward to fill the bleed zone. This prevents
 * white edges when the print is trimmed.
 * No AI — pure pixel operations.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { downloadFromStorage, uploadToStorage } from "../_shared/panelizer-os/storage.ts";
import {
  tempPath,
  BLEED_INCHES,
  OUTPUT_DPI,
  OUTPUT_SCALE,
  getSafeDpi,
} from "../_shared/panelizer-os/constants.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { inputPath, userId, jobId, panelKey, widthInches, heightInches } = await req.json();

    if (!inputPath || !userId || !jobId || !panelKey) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[BLEED] Job ${jobId} — adding ${BLEED_INCHES}" bleed to ${panelKey}`);
    const startMs = Date.now();

    // Calculate bleed in pixels
    const { dpi } = getSafeDpi(widthInches || 172, heightInches || 59.5);
    const bleedPx = Math.round(BLEED_INCHES * OUTPUT_SCALE * dpi);
    console.log(`[BLEED] Bleed: ${BLEED_INCHES}" = ${bleedPx}px at ${dpi} DPI`);

    // Download the flattened panel
    const inputBytes = await downloadFromStorage(inputPath);
    const img = await Image.decode(inputBytes);
    const srcW = img.width;
    const srcH = img.height;

    // Create a larger canvas with bleed zone
    const outW = srcW + bleedPx * 2;
    const outH = srcH + bleedPx * 2;
    const output = new Image(outW, outH);

    // Place original image centered in the bleed canvas
    output.composite(img, bleedPx, bleedPx);

    // Fill bleed zones using crop + flip + composite (fast, no per-pixel loops)
    // This avoids O(perimeter * bleedPx) getPixelAt/setPixelAt calls that
    // cause timeouts and memory spikes on large production panels.

    const edgeH = Math.min(bleedPx, srcH);
    const edgeW = Math.min(bleedPx, srcW);

    // Top bleed: crop top strip, flip vertically, composite above
    if (edgeH > 0) {
      const topStrip = img.clone().crop(1, 1, srcW, edgeH);
      topStrip.resize(srcW, bleedPx);
      const topFlipped = topStrip.clone().flipV();
      output.composite(topFlipped, bleedPx, 0);
    }

    // Bottom bleed: crop bottom strip, flip vertically, composite below
    if (edgeH > 0) {
      const bottomStrip = img.clone().crop(1, Math.max(1, srcH - edgeH + 1), srcW, edgeH);
      bottomStrip.resize(srcW, bleedPx);
      const bottomFlipped = bottomStrip.clone().flipV();
      output.composite(bottomFlipped, bleedPx, srcH + bleedPx);
    }

    // Left bleed: crop left strip, flip horizontally, composite left
    if (edgeW > 0) {
      const leftStrip = img.clone().crop(1, 1, edgeW, srcH);
      leftStrip.resize(bleedPx, srcH);
      const leftFlipped = leftStrip.clone().flipH();
      output.composite(leftFlipped, 0, bleedPx);
    }

    // Right bleed: crop right strip, flip horizontally, composite right
    if (edgeW > 0) {
      const rightStrip = img.clone().crop(Math.max(1, srcW - edgeW + 1), 1, edgeW, srcH);
      rightStrip.resize(bleedPx, srcH);
      const rightFlipped = rightStrip.clone().flipH();
      output.composite(rightFlipped, srcW + bleedPx, bleedPx);
    }

    // Corners: crop corner pixels, flip both axes, fill corner bleed zones
    if (edgeH > 0 && edgeW > 0) {
      // Top-left
      const tl = img.clone().crop(1, 1, edgeW, edgeH);
      tl.resize(bleedPx, bleedPx);
      output.composite(tl.clone().flipH().flipV(), 0, 0);
      // Top-right
      const tr = img.clone().crop(Math.max(1, srcW - edgeW + 1), 1, edgeW, edgeH);
      tr.resize(bleedPx, bleedPx);
      output.composite(tr.clone().flipH().flipV(), srcW + bleedPx, 0);
      // Bottom-left
      const bl = img.clone().crop(1, Math.max(1, srcH - edgeH + 1), edgeW, edgeH);
      bl.resize(bleedPx, bleedPx);
      output.composite(bl.clone().flipH().flipV(), 0, srcH + bleedPx);
      // Bottom-right
      const br = img.clone().crop(Math.max(1, srcW - edgeW + 1), Math.max(1, srcH - edgeH + 1), edgeW, edgeH);
      br.resize(bleedPx, bleedPx);
      output.composite(br.clone().flipH().flipV(), srcW + bleedPx, srcH + bleedPx);
    }

    // Encode and upload
    const outputBytes = await output.encode();
    const storagePath = tempPath(userId, jobId, `step-5-bleed-${panelKey}`);
    await uploadToStorage(storagePath, outputBytes, "image/png");

    console.log(`[BLEED] ${panelKey}: ${srcW}x${srcH} → ${outW}x${outH} (+${bleedPx}px bleed) in ${Date.now() - startMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        storagePath,
        panelKey,
        bleedPx,
        originalSize: { w: srcW, h: srcH },
        outputSize: { w: outW, h: outH },
        step: "bleed",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[BLEED] Error:", err);
    return new Response(
      JSON.stringify({ error: `Bleed step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
