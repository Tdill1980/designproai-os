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
 * panelizer-step-flip — Step 7: Mirror panel for passenger side
 *
 * Input:  { inputPath, userId, jobId, panelKey }
 * Output: { storagePath } — horizontally flipped panel saved to temp storage
 *
 * Flips the driver-side panel horizontally to create the passenger side.
 * Only called for panels that need mirroring (passenger-side).
 * No AI — pure pixel flip.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { downloadFromStorage, uploadToStorage } from "../_shared/panelizer-os/storage.ts";
import { tempPath } from "../_shared/panelizer-os/constants.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { inputPath, userId, jobId, panelKey } = await req.json();

    if (!inputPath || !userId || !jobId || !panelKey) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[FLIP] Job ${jobId} — mirroring ${panelKey}`);
    const startMs = Date.now();

    // Download the panel
    const inputBytes = await downloadFromStorage(inputPath);
    const img = await Image.decode(inputBytes);

    // Horizontal flip (mirror) — IN-PLACE to avoid 2x memory overhead.
    // Swap left/right pixel pairs on each row. Zero extra allocation.
    const halfW = Math.floor(img.width / 2);
    for (let y = 1; y <= img.height; y++) {
      for (let x = 1; x <= halfW; x++) {
        const mirrorX = img.width - x + 1;
        const left = img.getPixelAt(x, y);
        const right = img.getPixelAt(mirrorX, y);
        img.setPixelAt(x, y, right);
        img.setPixelAt(mirrorX, y, left);
      }
    }

    // Encode and upload
    const outputBytes = await img.encode();
    const storagePath = tempPath(userId, jobId, `step-7-flip-${panelKey}`);
    await uploadToStorage(storagePath, outputBytes, "image/png");

    console.log(`[FLIP] ${panelKey}: ${img.width}x${img.height} mirrored in ${Date.now() - startMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        storagePath,
        panelKey,
        width: img.width,
        height: img.height,
        step: "flip",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[FLIP] Error:", err);
    return new Response(
      JSON.stringify({ error: `Flip step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
