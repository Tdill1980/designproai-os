/**
 * extract-panel-from-render — Pixel-Perfect Panel Extraction (v2 Memory-Safe)
 *
 * Extracts flat panels from 3D vehicle wrap renders using pure math.
 * NO AI, NO vehicle-specs.json (caller passes dimensions or uses defaults).
 *
 * Memory-safe: reads pixels directly from ImageScript Image object,
 * no redundant Uint32Array copy. Fits within 150MB edge function limit.
 *
 * POST /extract-panel-from-render
 * {
 *   renderUrl: string,
 *   viewType: "side" | "passenger-side" | "hood_detail" | "rear" | "roof",
 *   sideW?: number, sideH?: number,
 *   hoodW?: number, hoodL?: number,
 *   backW?: number, backH?: number,
 *   roofW?: number, roofL?: number,
 *   userId: string,
 *   jobId?: string,
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { solveHomography, applyHomography, type Point2D } from "../_shared/homography.ts";
import { getPanelQuads } from "../_shared/panel-projection.ts";

const BUCKET = "wrap-files";
const MAX_OUTPUT_MP = 2; // Cap output to stay within memory
const MAX_FETCH_WIDTH = 2000; // Fetch render at this max width via Supabase transforms

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/**
 * Bilinear sample directly from ImageScript Image (1-indexed getPixelAt).
 * Avoids copying the entire image into a separate Uint32Array.
 */
function samplePixel(img: any, w: number, h: number, sx: number, sy: number): number {
  // Clamp
  sx = Math.max(0, Math.min(w - 1.001, sx));
  sy = Math.max(0, Math.min(h - 1.001, sy));

  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = sx - x0;
  const fy = sy - y0;

  // ImageScript is 1-indexed
  const p00 = img.getPixelAt(x0 + 1, y0 + 1);
  const p10 = img.getPixelAt(x1 + 1, y0 + 1);
  const p01 = img.getPixelAt(x0 + 1, y1 + 1);
  const p11 = img.getPixelAt(x1 + 1, y1 + 1);

  // Bilinear interpolate each channel
  const r = bilerp((p00 >>> 24) & 0xFF, (p10 >>> 24) & 0xFF, (p01 >>> 24) & 0xFF, (p11 >>> 24) & 0xFF, fx, fy);
  const g = bilerp((p00 >>> 16) & 0xFF, (p10 >>> 16) & 0xFF, (p01 >>> 16) & 0xFF, (p11 >>> 16) & 0xFF, fx, fy);
  const b = bilerp((p00 >>> 8) & 0xFF, (p10 >>> 8) & 0xFF, (p01 >>> 8) & 0xFF, (p11 >>> 8) & 0xFF, fx, fy);
  const a = bilerp(p00 & 0xFF, p10 & 0xFF, p01 & 0xFF, p11 & 0xFF, fx, fy);

  return ((r & 0xFF) << 24) | ((g & 0xFF) << 16) | ((b & 0xFF) << 8) | (a & 0xFF);
}

function bilerp(p00: number, p10: number, p01: number, p11: number, fx: number, fy: number): number {
  const top = p00 + (p10 - p00) * fx;
  const bot = p01 + (p11 - p01) * fx;
  return Math.round(top + (bot - top) * fy);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const renderUrl = body.renderUrl || "";
    const viewType = body.viewType || "side";
    const userId = body.userId || "";
    const jobId = body.jobId || `extract-${Date.now()}`;

    if (!renderUrl) return jsonResponse({ error: "renderUrl required" }, 400);

    const specs = {
      sideW: body.sideW || 188,
      sideH: body.sideH || 56,
      hoodW: body.hoodW || 60,
      hoodL: body.hoodL || 40,
      backW: body.backW || 72,
      backH: body.backH || 48,
      roofW: body.roofW || 52,
      roofL: body.roofL || 90,
      source: "input" as const,
    };

    const sb = getSupabase();
    const start = Date.now();

    console.log(`[EXTRACT] v3 | View: ${viewType} | Side: ${specs.sideW}"×${specs.sideH}"`);

    // Convert Supabase /object/ URL → /render/image/ URL with resize transform
    // This fetches a pre-resized version, keeping memory under 150MB
    let fetchUrl = renderUrl;
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    if (renderUrl.includes("/storage/v1/object/")) {
      fetchUrl = renderUrl.replace(
        "/storage/v1/object/",
        "/storage/v1/render/image/"
      ) + `?width=${MAX_FETCH_WIDTH}&resize=contain`;
      console.log(`[EXTRACT] Using Supabase image transform: ${MAX_FETCH_WIDTH}px wide`);
    }

    let imgResp = await fetch(fetchUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imgResp.ok && fetchUrl !== renderUrl) {
      console.warn(`[EXTRACT] Transform fetch failed (${imgResp.status}), trying original`);
      imgResp = await fetch(renderUrl, { signal: AbortSignal.timeout(15_000) });
    }
    if (!imgResp.ok) return jsonResponse({ error: `Fetch failed: HTTP ${imgResp.status}` }, 400);
    let renderBytes: Uint8Array | null = new Uint8Array(await imgResp.arrayBuffer());
    console.log(`[EXTRACT] Fetched: ${Math.round(renderBytes.length / 1024)} KB`);

    // Decode with ImageScript
    const { Image } = await import("https://deno.land/x/imagescript@1.2.15/mod.ts");
    const renderImg = await Image.decode(renderBytes);
    renderBytes = null; // Free compressed bytes — we have the decoded image now

    const renderW = renderImg.width;
    const renderH = renderImg.height;
    console.log(`[EXTRACT] Decoded: ${renderW}×${renderH}`);

    // Get panel quad for this view
    const quads = getPanelQuads(viewType, specs, renderW, renderH);
    if (quads.length === 0) {
      return jsonResponse({ error: `No extractable panels for view: ${viewType}` }, 400);
    }

    // NO srcPixels copy — read directly from renderImg via samplePixel()

    const results: any[] = [];

    for (const quad of quads) {
      const panelWidthInRender = Math.abs(quad.corners[1].x - quad.corners[0].x);
      const panelHeightInRender = Math.abs(quad.corners[3].y - quad.corners[0].y);
      let outW = Math.round(panelWidthInRender);
      let outH = Math.round(panelHeightInRender);

      if (outW <= 0 || outH <= 0) continue;

      // Scale down if output exceeds memory cap
      const mp = (outW * outH) / 1_000_000;
      if (mp > MAX_OUTPUT_MP) {
        const scale = Math.sqrt(MAX_OUTPUT_MP / mp);
        outW = Math.round(outW * scale);
        outH = Math.round(outH * scale);
        console.log(`[EXTRACT] ${quad.label}: scaled ${mp.toFixed(1)}MP → ${((outW * outH) / 1e6).toFixed(1)}MP`);
      }

      console.log(`[EXTRACT] Extracting: ${quad.label} ${outW}×${outH}`);

      // Destination corners (flat rectangle)
      const dstCorners: [Point2D, Point2D, Point2D, Point2D] = [
        { x: 0, y: 0 },
        { x: outW - 1, y: 0 },
        { x: outW - 1, y: outH - 1 },
        { x: 0, y: outH - 1 },
      ];

      // Homography: for each output pixel → find source pixel
      const H = solveHomography(dstCorners, quad.corners);

      const outImg = new Image(outW, outH);
      for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
          const srcPt = applyHomography(H, { x, y });
          if (srcPt.x >= 0 && srcPt.x < renderW - 1 &&
              srcPt.y >= 0 && srcPt.y < renderH - 1) {
            outImg.setPixelAt(x + 1, y + 1,
              samplePixel(renderImg, renderW, renderH, srcPt.x, srcPt.y));
          }
        }
      }

      const pngBytes = await outImg.encode();
      const sizeKB = Math.round(pngBytes.length / 1024);

      const storagePath = `production-packs/${userId}/temp/${jobId}/${quad.panelKey}-extracted.png`;
      await sb.storage.from(BUCKET).upload(storagePath, pngBytes, {
        contentType: "image/png",
        upsert: true,
      });

      const { data: signedData } = await sb.storage.from(BUCKET)
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

      results.push({
        panelKey: quad.panelKey,
        label: quad.label,
        widthInches: quad.widthInches,
        heightInches: quad.heightInches,
        outputPx: `${outW}×${outH}`,
        confidence: quad.confidence,
        sizeKB,
        signedUrl: signedData?.signedUrl || "",
        storagePath,
      });

      console.log(`[EXTRACT] ✓ ${quad.label}: ${outW}×${outH} (${sizeKB} KB)`);
    }

    const ms = Date.now() - start;
    console.log(`[EXTRACT] Done: ${results.length} panels in ${(ms / 1000).toFixed(1)}s`);

    return jsonResponse({
      success: true,
      pipeline: "pixel-extract-v2",
      panels: results,
      ms,
    });

  } catch (err: any) {
    console.error("[EXTRACT] Error:", err);
    return jsonResponse({ error: err.message || "Extraction failed" }, 500);
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
