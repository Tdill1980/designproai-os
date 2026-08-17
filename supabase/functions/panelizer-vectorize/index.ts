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
 * panelizer-vectorize — Collapsed vectorization pipeline (VTracer WASM)
 *
 * For each flat panel PNG:
 *   1. Download PNG from storage
 *   2. VTracer → SVG (local WASM, no external API)
 *   3. svgToEps → PostScript Level 2 EPS
 *   4. Inject equity DSC headers + WPW print dimensions (10% scale)
 *   5. Save EPS to storage
 *
 * Deploy: npx supabase functions deploy panelizer-vectorize --project-ref kfapjdyythzyvnpdeghu
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  downloadFromStorage,
  uploadToStorage,
  getSignedUrl,
} from "../_shared/panelizer-os/storage.ts";
import { PIPELINE_NAME } from "../_shared/panelizer-os/constants.ts";
import { bytesToSvg, PRESET_DETAILED } from "../_shared/vtracer/engine.ts";
import { svgToEps } from "../_shared/svg-to-eps.ts";

interface PanelInput {
  pngPath: string;
  widthIn: number;
  heightIn: number;
}

interface EpsResult {
  epsPath: string;
  epsUrl: string;
  sizeKB: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { jobId, panels, userId } = body;

    if (!jobId || !panels || !userId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: jobId, panels, userId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const startMs = Date.now();
    console.log(`[VECTORIZE] ═══ ${PIPELINE_NAME} ═══ Job ${jobId}`);
    console.log(`[VECTORIZE] Engine: VTracer WASM`);
    console.log(`[VECTORIZE] Panels: ${Object.keys(panels).join(", ")}`);

    const epsFiles: Record<string, EpsResult> = {};
    const errors: Record<string, string> = {};

    for (const [panelName, panelInput] of Object.entries(panels) as [string, PanelInput][]) {
      const panelStart = Date.now();

      try {
        console.log(`[VECTORIZE] → ${panelName}: downloading PNG...`);
        const pngBytes = await downloadFromStorage(panelInput.pngPath);
        console.log(`[VECTORIZE] ${panelName}: ${(pngBytes.byteLength / 1024).toFixed(0)} KB PNG`);

        // VTracer → SVG
        console.log(`[VECTORIZE] ${panelName}: tracing via VTracer...`);
        const { svg } = await bytesToSvg(pngBytes, PRESET_DETAILED);
        console.log(`[VECTORIZE] ${panelName}: ${(svg.length / 1024).toFixed(0)} KB SVG`);

        // 10%-scale BoundingBox for WPW print dimensions
        const widthPts = Math.round(panelInput.widthIn * 0.10 * 72);
        const heightPts = Math.round(panelInput.heightIn * 0.10 * 72);

        const dscHeaders = [
          `%%Creator: RestylePro GENIE Production Panelizer OS (VTracer)`,
          `%%Title: ${panelName}`,
          `%%PrintDimensions: ${panelInput.widthIn}" x ${panelInput.heightIn}"`,
          `%%ScalePreview: 10%`,
          `%%Copyright: RestyleProAI DesignEquity System`,
          `%%CreationDate: ${new Date().toISOString()}`,
        ];

        const epsBytes = svgToEps(svg, {
          widthPts, heightPts, dscHeaders,
          creator: "RestylePro GENIE Production Panelizer OS (VTracer)",
          title: panelName,
        });

        const epsPath = `renders/panelizer-jobs/${jobId}/eps/${panelName}.eps`;
        await uploadToStorage(epsPath, epsBytes, "application/postscript");
        const epsUrl = await getSignedUrl(epsPath);

        const sizeKB = Math.round(epsBytes.byteLength / 1024);
        epsFiles[panelName] = { epsPath, epsUrl, sizeKB };

        console.log(`[VECTORIZE] ✓ ${panelName}: ${sizeKB} KB EPS → ${widthPts}×${heightPts} pts (${Date.now() - panelStart}ms)`);
      } catch (panelErr: any) {
        errors[panelName] = panelErr.message;
        console.warn(`[VECTORIZE] ✗ ${panelName}: ${panelErr.message}`);
      }
    }

    const elapsed = Date.now() - startMs;
    const successCount = Object.keys(epsFiles).length;
    const totalCount = Object.keys(panels).length;
    console.log(`[VECTORIZE] ═══ DONE: ${successCount}/${totalCount} EPS files in ${elapsed}ms ═══`);

    return new Response(
      JSON.stringify({
        success: successCount > 0,
        epsFiles,
        errors: Object.keys(errors).length > 0 ? errors : undefined,
        epsCount: successCount,
        totalRequested: totalCount,
        processingTimeMs: elapsed,
        step: "vectorize",
        engine: "vtracer-wasm",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[VECTORIZE] Error:", err);
    return new Response(
      JSON.stringify({ error: `Vectorize failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
