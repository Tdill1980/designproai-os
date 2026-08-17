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
 * panelizer-step-vectorize — EXTRACT → VECTORIZE → SIZE pipeline
 *
 * For each panel, this function:
 *   0. COMPOSITE — Downloads the 3D render from storage and draws a cyan
 *      rectangle at the panel region coordinates using ImageScript.
 *      This composite image is what Gemini sees.
 *   1. EXTRACT — Sends the composite to Gemini to extract flat panel art.
 *      3-tier fallback for reliability.
 *   2. VECTORIZE — Sends extracted PNG to Vectorizer.AI → production EPS.
 *   3. SIZE — Rewrites EPS BoundingBox to exact production dimensions
 *      at 10% scale (widthIn × 0.1 × 72 pts).
 *
 * Input:  { jobId, userId, panelName, panelLabel, renderPath, panelRegion, vehicleDims }
 * Output: { success, panelName, storagePath, epsSizeBytes, processingTimeMs }
 *
 * Deploy: npx supabase functions deploy panelizer-step-vectorize --project-ref kfapjdyythzyvnpdeghu
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  downloadFromStorage,
  uploadToStorage,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "../_shared/panelizer-os/storage.ts";
import {
  tempPath,
} from "../_shared/panelizer-os/constants.ts";
import {
  getGeminiKey,
  hasGeminiKey,
} from "../_shared/gemini-key-pool.ts";
import { bytesToSvg, PRESET_DETAILED } from "../_shared/vtracer/engine.ts";
import { svgToEps } from "../_shared/svg-to-eps.ts";

// ── Constants ────────────────────────────────────────────────────
const GEMINI_MODEL = "gemini-3-pro-image-preview";
const CYAN_COLOR = 0x00E5FFFF; // Cyan rectangle outline color
const RECT_THICKNESS = 3;      // Cyan rectangle stroke width in pixels

// ── Types ────────────────────────────────────────────────────────

interface VectorizeRequest {
  jobId: string;
  userId: string;
  panelName: string;       // "driver_side", "hood", etc.
  panelLabel: string;      // "DRIVER SIDE (MEDIUM)"
  renderPath: string;      // Supabase Storage path to 3D render (used when panelPath absent)
  panelRegion?: {
    x: number;             // Left edge as % of render width (0-100)
    y: number;             // Top edge as % of render height (0-100)
    width: number;         // Width as % of render width
    height: number;        // Height as % of render height
  };
  panelPath?: string;      // Pre-processed panel PNG — skips COMPOSITE+EXTRACT
  vehicleDims: {
    widthIn: number;       // Full-size inches including bleed
    heightIn: number;
  };
  designId?: string;             // Design Equity: DID-XXXXXXXX
  promptFingerprint?: string;    // Design Equity: PT-XXXXXXXXXXXX
}

// ── Main Handler ─────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: VectorizeRequest = await req.json();
    const {
      jobId, userId, panelName, panelLabel,
      renderPath, panelRegion, panelPath, vehicleDims,
      designId, promptFingerprint,
    } = body;

    if (!jobId || !userId || !panelName || !vehicleDims) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: jobId, userId, panelName, vehicleDims" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!panelPath && !renderPath) {
      return new Response(
        JSON.stringify({ error: "Either panelPath or renderPath is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Gemini key only needed when extracting from raw render (no panelPath)
    if (!panelPath && !hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "No GOOGLE_AI_API_KEY configured (key pool empty)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const startMs = Date.now();
    console.log(`[VECTORIZE] ═══ ${panelName.toUpperCase()} ═══ Job ${jobId}`);

    // ════════════════════════════════════════════════════════════════
    //  Get panel image bytes — either from pre-processed panelPath
    //  (skip COMPOSITE+EXTRACT) or via the full extraction pipeline
    // ════════════════════════════════════════════════════════════════

    let extractedBytes: Uint8Array;

    if (panelPath) {
      // ── FAST PATH: Panel already processed — download directly ──
      console.log(`[VECTORIZE] FAST PATH: using pre-processed panel from ${panelPath}`);
      extractedBytes = await downloadFromStorage(panelPath);
      console.log(`[VECTORIZE] Panel image: ${(extractedBytes.byteLength / 1024).toFixed(0)} KB`);
    } else {
      // ── LEGACY PATH: COMPOSITE + EXTRACT from raw render ──

      // STEP 0: COMPOSITE — Build overlay screenshot server-side
      console.log(`[VECTORIZE] Step 0: COMPOSITE — downloading render from ${renderPath}`);
      const renderBytes = await downloadFromStorage(renderPath);
      console.log(`[VECTORIZE] Render downloaded: ${(renderBytes.byteLength / 1024).toFixed(0)} KB`);

      const renderImage = await Image.decode(renderBytes);
      const imgW = renderImage.width;
      const imgH = renderImage.height;

      const rectX = Math.round((panelRegion!.x / 100) * imgW);
      const rectY = Math.round((panelRegion!.y / 100) * imgH);
      const rectW = Math.round((panelRegion!.width / 100) * imgW);
      const rectH = Math.round((panelRegion!.height / 100) * imgH);

      console.log(`[VECTORIZE] Render: ${imgW}×${imgH}px — Cyan rect: (${rectX},${rectY}) ${rectW}×${rectH}px`);
      drawRectOutline(renderImage, rectX, rectY, rectW, rectH, CYAN_COLOR, RECT_THICKNESS);

      const compositeBytes = await renderImage.encode();
      const compositeBase64 = uint8ArrayToBase64(new Uint8Array(compositeBytes));
      console.log(`[VECTORIZE] Composite: ${(compositeBytes.byteLength / 1024).toFixed(0)} KB`);

      // STEP 1: EXTRACT — Send composite to Gemini (3-tier fallback)
      console.log(`[VECTORIZE] Step 1: EXTRACT — sending to Gemini...`);
      const extractedBase64 = await extractWithFallback(
        compositeBase64, panelName, panelLabel,
      );

      extractedBytes = base64ToUint8Array(extractedBase64);
      console.log(`[VECTORIZE] Extracted flat panel: ${(extractedBytes.byteLength / 1024).toFixed(0)} KB`);
    }

    // ════════════════════════════════════════════════════════════════
    //  STEP 2: VECTORIZE — VTracer WASM (local, no external API)
    // ════════════════════════════════════════════════════════════════

    console.log(`[VECTORIZE] Step 2: VECTORIZE — VTracer WASM tracing...`);
    const { svg: traceSvg } = await bytesToSvg(extractedBytes, PRESET_DETAILED);
    const imageToken: string | undefined = undefined;
    console.log(`[VECTORIZE] SVG: ${(traceSvg.length / 1024).toFixed(0)} KB`);

    // ════════════════════════════════════════════════════════════════
    //  STEP 3: SIZE — Set EPS to production dimensions
    // ════════════════════════════════════════════════════════════════

    console.log(`[VECTORIZE] Step 3: SIZE — ${vehicleDims.widthIn}"×${vehicleDims.heightIn}" + 0.5" bleed at 10%`);
    const sizedEps = svgToSizedEps(traceSvg, vehicleDims.widthIn, vehicleDims.heightIn, panelName, panelLabel || panelName.replace(/-/g, ' ').toUpperCase(), designId, promptFingerprint);

    // ════════════════════════════════════════════════════════════════
    //  UPLOAD — Save to Supabase Storage
    // ════════════════════════════════════════════════════════════════

    // File naming: production-{PANEL_LABEL}-{WIDTH}x{HEIGHT}.eps
    const labelForFile = (panelLabel || panelName.replace(/-/g, ' ').toUpperCase())
      .replace(/\s*\([^)]*\)\s*/g, '')  // Remove parenthetical suffixes like "(MEDIUM)"
      .trim()
      .replace(/\s+/g, '-');            // Spaces → hyphens
    const widthRounded = Math.round(vehicleDims.widthIn);
    const heightRounded = Math.round(vehicleDims.heightIn);
    const epsFilename = `production-${labelForFile}-${widthRounded}x${heightRounded}.eps`;
    const storagePath = `panelizer/${userId}/${jobId}/${epsFilename}`;
    await uploadToStorage(storagePath, sizedEps, "application/postscript");

    const elapsed = Date.now() - startMs;
    console.log(`[VECTORIZE] ═══ DONE: ${panelName} — ${(sizedEps.byteLength / 1024).toFixed(0)} KB EPS in ${elapsed}ms ═══`);

    return new Response(
      JSON.stringify({
        success: true,
        panelName,
        storagePath,
        epsSizeBytes: sizedEps.byteLength,
        processingTimeMs: elapsed,
        imageToken: imageToken || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[VECTORIZE] Error:", err);
    return new Response(
      JSON.stringify({ error: `Vectorize step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ═══════════════════════════════════════════════════════════════════
// STEP 0 HELPER: Draw rectangle outline on ImageScript Image
// ═══════════════════════════════════════════════════════════════════

function drawRectOutline(
  img: InstanceType<typeof Image>,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  thickness: number,
): void {
  const imgW = img.width;
  const imgH = img.height;

  // Clamp coordinates to image bounds
  const x1 = Math.max(0, x);
  const y1 = Math.max(0, y);
  const x2 = Math.min(imgW - 1, x + w - 1);
  const y2 = Math.min(imgH - 1, y + h - 1);

  for (let t = 0; t < thickness; t++) {
    // Top edge
    for (let px = x1; px <= x2; px++) {
      if (y1 + t < imgH) img.setPixelAt(px + 1, y1 + t + 1, color);
    }
    // Bottom edge
    for (let px = x1; px <= x2; px++) {
      if (y2 - t >= 0) img.setPixelAt(px + 1, y2 - t + 1, color);
    }
    // Left edge
    for (let py = y1; py <= y2; py++) {
      if (x1 + t < imgW) img.setPixelAt(x1 + t + 1, py + 1, color);
    }
    // Right edge
    for (let py = y1; py <= y2; py++) {
      if (x2 - t >= 0) img.setPixelAt(x2 - t + 1, py + 1, color);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// STEP 1: EXTRACT — 3-tier Gemini fallback
// ═══════════════════════════════════════════════════════════════════

function buildExtractionPrompt(panelName: string, panelLabel: string): string {
  return `You are a File Output Specialist for WePrintWraps.com. Your production files are printed on cast vinyl and installed on real vehicles by professional wrap installers.

Step 1: Review this GENIE Universal Panelizer render. The glassmorphism panel overlay shows the exact dimensions, scale, and boundary for the "${panelLabel}" panel. Study the design artwork visible within that panel region.

Step 2: Extract, flatten, and fill. Produce a flat rectangular file at the exact size, scale, and dimensions shown on the panel overlay. The artwork must be peeled off the 3D vehicle and laid completely flat — no vehicle body, no 3D perspective, no wheels, no windows, no studio background. Fill the rectangle completely edge to edge with the design. Match every color, pattern, gradient, and graphic element exactly as shown on the vehicle.

Step 3: Output at the highest resolution possible. Extend the design seamlessly past all four edges by 0.5 inches for print bleed. This is a production print file — edge to edge, no gaps, no borders, no empty space.`;
}

async function extractWithFallback(
  compositeBase64: string,
  panelName: string,
  panelLabel: string,
): Promise<string> {
  const attempts = [
    {
      label: "Attempt 1: Full extraction prompt",
      prompt: buildExtractionPrompt(panelName, panelLabel),
      modalities: ["IMAGE", "TEXT"],
    },
    {
      label: "Attempt 2: [GENERATE IMAGE] prefix",
      prompt: "[GENERATE IMAGE]\n\n" + buildExtractionPrompt(panelName, panelLabel),
      modalities: ["IMAGE", "TEXT"],
    },
    {
      label: "Attempt 3: Short prompt, IMAGE only",
      prompt: "[GENERATE IMAGE] Extract the artwork inside the cyan rectangle as a flat image. Edge to edge. No vehicle body.",
      modalities: ["IMAGE"],
    },
  ];

  for (const attempt of attempts) {
    console.log(`[VECTORIZE] EXTRACT ${attempt.label}`);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);

      const currentKey = getGeminiKey();
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${currentKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: attempt.prompt },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: compositeBase64,
                  },
                },
              ],
            }],
            generationConfig: {
              responseModalities: attempt.modalities,
              temperature: 0.1,
            },
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timer);

      if (response.status === 429) {
        console.warn(`[VECTORIZE] EXTRACT: 429 rate-limited on ${attempt.label}`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[VECTORIZE] EXTRACT: ${response.status} on ${attempt.label}: ${errText.slice(0, 200)}`);
        continue;
      }

      const data = await response.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find((p: any) => p.inlineData);

      if (imagePart?.inlineData?.data) {
        console.log(`[VECTORIZE] EXTRACT: Success on ${attempt.label}`);
        return imagePart.inlineData.data;
      }

      const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text);
      console.warn(`[VECTORIZE] EXTRACT: No image in response for ${attempt.label}. Text: ${textParts.join(" ").slice(0, 200)}`);
    } catch (err: any) {
      const errType = err?.name === "AbortError" ? "Timeout" : "Error";
      console.warn(`[VECTORIZE] EXTRACT: ${errType} on ${attempt.label}: ${err.message}`);
    }
  }

  throw new Error(`EXTRACT: All 3 attempts failed for ${panelName} — Gemini returned no image`);
}

// ═══════════════════════════════════════════════════════════════════
// STEP 2+3: SVG → sized EPS with Design Equity DSC headers
// ═══════════════════════════════════════════════════════════════════

function svgToSizedEps(
  svg: string,
  widthIn: number,
  heightIn: number,
  panelName: string,
  panelLabel: string,
  designId?: string,
  promptFingerprint?: string,
): Uint8Array {
  // 10% of actual print size with 0.5" bleed added to all 4 sides
  const widthPts = Math.round((widthIn + 1.0) * 0.1 * 72);
  const heightPts = Math.round((heightIn + 1.0) * 0.1 * 72);

  const dscHeaders = [
    `%%Creator: RestylePro GENIE Production Panelizer OS (VTracer)`,
    `%%Title: ${panelName}`,
    `%%PanelLabel: ${panelLabel}`,
    `%%PrintDimensions: ${widthIn}" x ${heightIn}"`,
    `%%BleedSize: 0.5" all sides`,
    `%%ScalePreview: 10%`,
    designId ? `%%DesignID: ${designId}` : "",
    promptFingerprint ? `%%PromptFingerprint: ${promptFingerprint}` : "",
    `%%Copyright: RestyleProAI DesignEquity System`,
    `%%CreationDate: ${new Date().toISOString()}`,
  ].filter(Boolean);

  if (designId || promptFingerprint) {
    console.log(`[VECTORIZE] EQUITY STAMP: ${panelName} → ${designId || 'no-DID'} | ${promptFingerprint || 'no-PT'}`);
  }
  console.log(`[VECTORIZE] SIZE: ${panelName} → ${widthPts}×${heightPts} pts (${widthIn}"×${heightIn}" + 0.5" bleed at 10%)`);

  return svgToEps(svg, {
    widthPts, heightPts, dscHeaders,
    creator: "RestylePro GENIE Production Panelizer OS (VTracer)",
    title: panelName,
  });
}
