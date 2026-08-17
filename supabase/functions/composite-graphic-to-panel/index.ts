/**
 * composite-graphic-to-panel — Handler 1: Graphic Placement
 *
 * Takes a design graphic and composites it onto a correctly-sized panel
 * rectangle. Edge-to-edge, no borders, no margins. Pure ImageScript pixel ops.
 *
 * Input:  { graphicPath, panelKey, widthInches, heightInches, userId, jobId }
 * Output: { storagePath } — composited PNG at working DPI saved to temp storage
 *
 * WORKING_DPI = 38 (= 150 / 4). A 4x ESRGAN upscale reaches ~150 DPI.
 * No math beyond placement. No upscaling. No DPI conversion.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  downloadFromStorage,
  uploadToStorage,
} from "../_shared/panelizer-os/storage.ts";
import { tempPath, MAX_MEGAPIXELS } from "../_shared/panelizer-os/constants.ts";

const WORKING_DPI = 38; // 150 / 4 — designed so 4x ESRGAN upscale reaches ~150 DPI

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { graphicPath, panelKey, widthInches, heightInches, userId, jobId } =
      await req.json();

    if (!graphicPath || !panelKey || !widthInches || !heightInches || !userId || !jobId) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[COMPOSITE] Job ${jobId} — compositing ${panelKey} (${widthInches}"x${heightInches}")`);
    const startMs = Date.now();

    // Calculate panel pixel dimensions at working DPI
    let dpi = WORKING_DPI;
    let panelW = Math.round(widthInches * dpi);
    let panelH = Math.round(heightInches * dpi);

    // Cap at MAX_MEGAPIXELS for memory safety
    const megapixels = (panelW * panelH) / 1_000_000;
    if (megapixels > MAX_MEGAPIXELS) {
      const scale = Math.sqrt(MAX_MEGAPIXELS / megapixels);
      dpi = Math.floor(dpi * scale);
      panelW = Math.round(widthInches * dpi);
      panelH = Math.round(heightInches * dpi);
      console.log(`[COMPOSITE] ${panelKey}: ${megapixels.toFixed(1)} MP exceeds ${MAX_MEGAPIXELS} MP — capped DPI to ${dpi} (${panelW}x${panelH})`);
    }

    console.log(`[COMPOSITE] Panel target: ${panelW}x${panelH}px @ ${dpi} DPI`);

    // Download and decode the graphic
    const graphicBytes = await downloadFromStorage(graphicPath);
    const graphic = await Image.decode(graphicBytes);
    const gw = graphic.width;
    const gh = graphic.height;
    console.log(`[COMPOSITE] Graphic source: ${gw}x${gh}px`);

    // Aspect-ratio-aware cover fit (center-crop then resize)
    const panelAspect = panelW / panelH;
    const graphicAspect = gw / gh;

    let cropped: Image;
    if (Math.abs(graphicAspect - panelAspect) < 0.01) {
      // Aspects match — no crop needed
      cropped = graphic;
    } else if (graphicAspect > panelAspect) {
      // Graphic is wider — crop sides
      const cropW = Math.round(gh * panelAspect);
      const offsetX = Math.round((gw - cropW) / 2);
      cropped = graphic.crop(offsetX, 0, cropW, gh);
    } else {
      // Graphic is taller — crop top/bottom
      const cropH = Math.round(gw / panelAspect);
      const offsetY = Math.round((gh - cropH) / 2);
      cropped = graphic.crop(0, offsetY, gw, cropH);
    }

    // Resize to exact panel dimensions
    const panel = cropped.resize(panelW, panelH);

    // Encode and upload
    const pngBytes = await panel.encode();
    const storagePath = tempPath(userId, jobId, `composite-${panelKey}`);
    await uploadToStorage(storagePath, pngBytes, "image/png");

    const elapsedMs = Date.now() - startMs;
    console.log(`[COMPOSITE] ${panelKey}: ${panelW}x${panelH} (${(pngBytes.byteLength / 1024).toFixed(0)} KB) in ${elapsedMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        storagePath,
        panelKey,
        width: panelW,
        height: panelH,
        workingDpi: dpi,
        step: "composite",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[COMPOSITE] Error:", err);
    return new Response(
      JSON.stringify({ error: `Composite step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
