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
 * panelizer-extract — Single-call artboard extraction (drift-resistant)
 *
 * One Gemini call generates a single artboard PNG containing every requested
 * flat panel rectangle laid out in a labeled grid with 2" bleed on each panel.
 * The artboard is then deterministically cropped (ImageScript) into individual
 * panel PNGs at the known grid zones.
 *
 * Why one call instead of N: per-panel calls produced drift between
 * driver/passenger/hood/etc because each Gemini invocation re-interpreted the
 * design in isolation. Generating all panels in a single image keeps colors,
 * graphics, and text consistent across panels and lets Gemini mirror passenger
 * text correctly without a silent pixel-flip fallback.
 *
 * Pipeline:
 *   1. Build a GenieGrid from vehicle dimensions (deterministic zone layout)
 *   2. Fetch all unique source 3D renders as labeled reference images
 *   3. Send ONE Gemini call: renders + grid-constrained prompt → artboard PNG
 *   4. Crop each panel zone (with 2" bleed baked in) from the artboard
 *   5. Save the master artboard + each panel PNG
 *
 * Deploy: npx supabase functions deploy panelizer-extract --project-ref kfapjdyythzyvnpdeghu
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getGeminiKey,
  hasGeminiKey,
  geminiKeyCount,
} from "../_shared/gemini-key-pool.ts";
import {
  uploadToStorage,
  fetchImageBytes,
  uint8ArrayToBase64,
  base64ToUint8Array,
  getSignedUrl,
} from "../_shared/panelizer-os/storage.ts";
import { PIPELINE_NAME } from "../_shared/panelizer-os/constants.ts";
import { buildAspectLockedGrid } from "../_shared/panelizer-os/artboard-grid.ts";

// ── Gemini model ──
const GEMINI_MODEL = "gemini-3-pro-image-preview";

// ── Grid types (inlined from genie-grid-template.ts to avoid pulling in
//    vehicle-specs.json — 280KB of transitive deps for an erased type import) ──
interface GridZone {
  key: string;
  label: string;
  widthInches: number;
  heightInches: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

interface GenieGrid {
  zones: GridZone[];
  canvasAspect: string;
  vehicleDesc: string;
  specsSource: string;
  totalWidthInches: number;
  totalHeightInches: number;
}

// Gemini-supported aspect ratios, ordered by preference for artboards
const GEMINI_ASPECT_RATIOS: { label: string; ratio: number }[] = [
  { label: "21:9", ratio: 21 / 9 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "3:2",  ratio: 3 / 2 },
  { label: "4:3",  ratio: 4 / 3 },
  { label: "5:4",  ratio: 5 / 4 },
  { label: "1:1",  ratio: 1 },
  { label: "4:5",  ratio: 4 / 5 },
  { label: "3:4",  ratio: 3 / 4 },
  { label: "2:3",  ratio: 2 / 3 },
  { label: "9:16", ratio: 9 / 16 },
];

function calculateArtboardAspectRatio(grid: GenieGrid): string {
  const actual = grid.totalWidthInches / grid.totalHeightInches;
  let best = GEMINI_ASPECT_RATIOS[0];
  let bestDiff = Math.abs(actual - best.ratio);
  for (const ar of GEMINI_ASPECT_RATIOS) {
    const diff = Math.abs(actual - ar.ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ar;
    }
  }
  return best.label;
}

// ── Artboard bleed (per the user spec — 2" on every side of every panel) ──
const ARTBOARD_BLEED_INCHES = 2;

// ── Default panel dimensions (inches) when vehicle dims unavailable ──
const DEFAULT_PANEL_DIMS: Record<string, { widthIn: number; heightIn: number }> = {
  driver_side:    { widthIn: 172, heightIn: 55.5 },
  passenger_side: { widthIn: 172, heightIn: 55.5 },
  hood:           { widthIn: 56,  heightIn: 36 },
  roof:           { widthIn: 66,  heightIn: 44 },
  rear:           { widthIn: 66,  heightIn: 42 },
  front:          { widthIn: 111, heightIn: 30 },
  trunk:          { widthIn: 56,  heightIn: 36 },
};

// Internal panel name → grid zone key
const PANEL_TO_ZONE: Record<string, string> = {
  driver_side: "driver-side",
  passenger_side: "passenger-side",
  hood: "hood",
  rear: "rear",
  roof: "roof",
  front: "front",
  trunk: "trunk",
};

const PANEL_ORDER_BOTTOM = ["hood", "front", "rear", "trunk", "roof"] as const;

const ZONE_LABEL: Record<string, string> = {
  "driver-side": "DRIVER SIDE",
  "passenger-side": "PASSENGER SIDE",
  hood: "HOOD",
  front: "FRONT BUMPER",
  rear: "REAR",
  trunk: "TRUNK",
  roof: "ROOF",
};

// View label for source render images sent into the Gemini call
const PANEL_LABEL: Record<string, string> = {
  driver_side: "DRIVER SIDE",
  passenger_side: "PASSENGER SIDE",
  hood: "HOOD",
  rear: "REAR",
  roof: "ROOF",
  front: "FRONT",
  trunk: "TRUNK",
};

interface PanelResult {
  pngPath: string;
  pngUrl: string;
  sizeKB: number;
}

interface VehicleDimsEntry {
  widthIn?: number;
  heightIn?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { jobId, renderUrls, vehicleDims, userId } = body;

    if (!jobId || !renderUrls || !userId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: jobId, renderUrls, userId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "No GOOGLE_AI_API_KEY configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const startMs = Date.now();
    const requestedPanels = Object.keys(renderUrls);
    console.log(`[EXTRACT] ═══ ${PIPELINE_NAME} ═══ Job ${jobId}`);
    console.log(`[EXTRACT] Panels requested: ${requestedPanels.join(", ")}`);

    // ── 1. Build the artboard grid (with 2" bleed baked into every zone) ──
    // ASPECT-LOCKED layout — every zone is drawn at its panel's TRUE aspect
    // ratio so bumpers/hood are not squashed (see _shared/panelizer-os/artboard-grid.ts).
    const grid = buildAspectLockedGrid(requestedPanels, vehicleDims, ARTBOARD_BLEED_INCHES);
    const aspectRatio = grid.canvasAspect; // the ratio the zone math assumes Gemini renders at
    console.log(`[EXTRACT] Grid: ${grid.zones.length} zones, ${grid.totalWidthInches}"x${grid.totalHeightInches}" canvas → aspect ${aspectRatio}`);
    for (const z of grid.zones) {
      console.log(`[EXTRACT]   ${z.label}: ${z.widthInches}"x${z.heightInches}" at (${z.xPct}%,${z.yPct}%) ${z.wPct}%x${z.hPct}%`);
    }

    // ── 2. Fetch all unique source renders as labeled reference images ──
    const fetchedRenders = await fetchUniqueRenders(renderUrls);
    console.log(`[EXTRACT] Fetched ${fetchedRenders.length} unique source render(s)`);

    if (fetchedRenders.length === 0) {
      return new Response(
        JSON.stringify({ error: "No source renders could be fetched" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 3. Single Gemini call: renders + grid prompt → artboard PNG ──
    const prompt = buildArtboardPrompt(grid, ARTBOARD_BLEED_INCHES);
    console.log(`[EXTRACT] Calling Gemini (${prompt.length} char prompt, ${fetchedRenders.length} reference image${fetchedRenders.length === 1 ? "" : "s"})...`);

    const artboardBase64 = await callGeminiArtboard(fetchedRenders, prompt, aspectRatio);
    if (!artboardBase64) {
      return new Response(
        JSON.stringify({ error: "Gemini returned no image after all retries" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Free the source-render base64 buffers — Gemini has consumed them and the
    // decode/crop below is the memory-heavy phase. (Keeps peak worker memory down,
    // alongside the no-clone crop, to avoid HTTP 546 WORKER_RESOURCE_LIMIT.)
    fetchedRenders.length = 0;

    const artboardBytes = base64ToUint8Array(artboardBase64);
    if (artboardBytes.byteLength < 20_000) {
      return new Response(
        JSON.stringify({ error: `Gemini artboard too small (${artboardBytes.byteLength} bytes)` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    console.log(`[EXTRACT] Artboard ${(artboardBytes.byteLength / 1024).toFixed(0)} KB received`);

    // ── 4. Save the master artboard ──
    const artboardPath = `renders/panelizer-jobs/${jobId}/artboard.png`;
    await uploadToStorage(artboardPath, artboardBytes, "image/png");
    const artboardUrl = await getSignedUrl(artboardPath);

    // ── 5. Deterministic crop per zone → individual panel PNGs ──
    const artboardImg = await Image.decode(artboardBytes);
    console.log(`[EXTRACT] Artboard image ${artboardImg.width}x${artboardImg.height} px`);

    const panels: Record<string, PanelResult> = {};
    const errors: Record<string, string> = {};

    for (const panelName of requestedPanels) {
      try {
        const zone = grid.zones.find(z => z.key === PANEL_TO_ZONE[panelName]);
        if (!zone) {
          errors[panelName] = `No grid zone for panel ${panelName}`;
          continue;
        }
        const cropped = cropZoneFromArtboard(artboardImg, zone);
        const pngBytes = new Uint8Array(await cropped.encode());
        const pngPath = `renders/panelizer-jobs/${jobId}/panels/${panelName}.png`;
        await uploadToStorage(pngPath, pngBytes, "image/png");
        const pngUrl = await getSignedUrl(pngPath);
        const sizeKB = Math.round(pngBytes.byteLength / 1024);
        panels[panelName] = { pngPath, pngUrl, sizeKB };
        console.log(`[EXTRACT] ✓ ${panelName}: ${cropped.width}x${cropped.height} px, ${sizeKB} KB`);
      } catch (cropErr: any) {
        errors[panelName] = `Crop failed: ${cropErr.message}`;
        console.warn(`[EXTRACT] ✗ ${panelName}: ${cropErr.message}`);
      }
    }

    const elapsed = Date.now() - startMs;
    const successCount = Object.keys(panels).length;
    const totalCount = requestedPanels.length;
    console.log(`[EXTRACT] ═══ DONE: ${successCount}/${totalCount} panels in ${elapsed}ms ═══`);

    return new Response(
      JSON.stringify({
        success: successCount > 0,
        panels,
        artboardPath,
        artboardUrl,
        errors: Object.keys(errors).length > 0 ? errors : undefined,
        panelCount: successCount,
        totalRequested: totalCount,
        processingTimeMs: elapsed,
        bleedInches: ARTBOARD_BLEED_INCHES,
        step: "extract",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[EXTRACT] Error:", err);
    return new Response(
      JSON.stringify({ error: `Extract failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ═══════════════════════════════════════════════════════════════════
// Grid construction — derive a GenieGrid from the requested panel set
// ═══════════════════════════════════════════════════════════════════

// Grid construction now lives in _shared/panelizer-os/artboard-grid.ts
// (buildAspectLockedGrid) — every zone is allocated at its panel's TRUE aspect
// ratio, so the master artboard is drawn un-squashed. Imported at the top.

// ═══════════════════════════════════════════════════════════════════
// Source render fetch — dedup by URL, label by panel
// ═══════════════════════════════════════════════════════════════════

interface FetchedRender {
  label: string;
  base64: string;
  mimeType: string;
}

async function fetchUniqueRenders(
  renderUrls: Record<string, string>,
): Promise<FetchedRender[]> {
  const seen = new Map<string, FetchedRender>();
  for (const [panelName, url] of Object.entries(renderUrls)) {
    if (!url) continue;
    if (seen.has(url)) {
      // Same URL already fetched — append this panel's label so the prompt
      // tells Gemini both panels are visible in this single render.
      const existing = seen.get(url)!;
      const newLabel = PANEL_LABEL[panelName] || panelName.toUpperCase();
      if (!existing.label.includes(newLabel)) {
        existing.label = `${existing.label} + ${newLabel}`;
      }
      continue;
    }
    try {
      const bytes = await fetchImageBytes(url);
      seen.set(url, {
        label: PANEL_LABEL[panelName] || panelName.toUpperCase(),
        base64: uint8ArrayToBase64(bytes),
        mimeType: "image/png",
      });
    } catch (err: any) {
      console.warn(`[EXTRACT] fetch ${panelName} render failed: ${err.message}`);
    }
  }
  return [...seen.values()];
}

// ═══════════════════════════════════════════════════════════════════
// Prompt — single-call artboard with grid-constrained zones + 2" bleed
// ═══════════════════════════════════════════════════════════════════

function buildArtboardPrompt(grid: GenieGrid, bleedInches: number): string {
  const zoneLines = grid.zones
    .map(z =>
      `  ${z.label}: ${z.widthInches}" × ${z.heightInches}" — at (${z.xPct}%, ${z.yPct}%), size (${z.wPct}% × ${z.hPct}%)`,
    )
    .join("\n");

  return `Generate ONE flat artboard image containing every panel of this vehicle wrap as labeled rectangles, exactly as a print production artboard would arrange them.

CRITICAL — ALL PANELS COME FROM THE SAME 3D PROOF: The reference image(s) above are the approved 3D render of the wrapped vehicle. Every rectangle on this artboard must show the SAME continuous design shown in that proof — same colors, same graphics, same logos, same text, same patterns, same composition. Do NOT invent different designs for different panels. Do NOT change the design between rectangles. Each rectangle is a different SIDE of the same wrap, not a different wrap.

LAYOUT (each rectangle is the actual panel size INCLUDING ${bleedInches}" bleed on every side):
${zoneLines}

PER-PANEL CONTENT (all extracted from the SAME 3D proof):
- DRIVER SIDE: the design exactly as it appears on the driver side of the proof, laid flat — no body curves, no perspective.
- PASSENGER SIDE: the design exactly as it appears on the passenger side of the proof, laid flat. Text and logos read correctly left-to-right (NOT a backwards mirror of the driver side).
- HOOD / ROOF / REAR / FRONT / TRUNK: the design exactly as it appears on that surface of the proof, laid flat.

Each panel is a flat 2D production panel: edge-to-edge fill, NO 3D body curvature, NO studio floor, NO perspective, NO vehicle silhouette around it.

Each rectangle includes ${bleedInches}" of design bleed on every edge — extend graphics, colors, and patterns ${bleedInches}" past the visual trim line so the cropped panel can be trimmed safely. Do NOT draw the bleed line itself; just extend the design.

The artboard background between rectangles is solid black. Do not add registration marks, dimension labels, or panel name text on the artboard — the design only fills the panel rectangles.

Output one flat artboard image at the requested aspect ratio.`;
}

// ═══════════════════════════════════════════════════════════════════
// Gemini call — multi-image input, single artboard image output
// ═══════════════════════════════════════════════════════════════════

async function callGeminiArtboard(
  renders: FetchedRender[],
  prompt: string,
  aspectRatio: string,
): Promise<string | null> {
  const totalKeys = geminiKeyCount();
  const maxAttempts = Math.min(totalKeys, 3);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const key = getGeminiKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);

    try {
      console.log(`[EXTRACT] Gemini attempt ${attempt}/${maxAttempts}`);

      const parts: any[] = [];
      for (const r of renders) {
        parts.push({ text: `${r.label} REFERENCE RENDER:` });
        parts.push({ inlineData: { mimeType: r.mimeType, data: r.base64 } });
      }
      parts.push({ text: prompt });

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              // 2K (not 4K): a 4K wide-aspect artboard decodes to a bitmap large
            // enough to OOM the 256MB edge worker (HTTP 546). The flat panels are
            // upscaled to true print size by the sharp slicer downstream, so 2K
            // here is ample detail at a quarter of the decode memory.
            imageConfig: { aspectRatio, imageSize: "2K" },
            },
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timer);

      if (response.status === 429) {
        console.warn(`[EXTRACT] 429 rate-limited`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[EXTRACT] ${response.status}: ${errText.slice(0, 300)}`);
        continue;
      }

      const result = await response.json();
      const responseParts = result?.candidates?.[0]?.content?.parts;
      const finishReason = result?.candidates?.[0]?.finishReason || "unknown";

      if (responseParts) {
        for (const part of responseParts) {
          if (part.inlineData?.data) {
            console.log(`[EXTRACT] ✓ Artboard image received (finish: ${finishReason})`);
            return part.inlineData.data;
          }
        }
      }
      console.warn(`[EXTRACT] No image in response (finish: ${finishReason})`);
    } catch (err: any) {
      clearTimeout(timer);
      console.warn(`[EXTRACT] ${err?.name === "AbortError" ? "Timeout" : "Error"}: ${err.message}`);
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Crop — pull a zone (with bleed) out of the artboard at known %
// ═══════════════════════════════════════════════════════════════════

function cropZoneFromArtboard(artboard: Image, zone: GridZone): Image {
  const W = artboard.width;
  const H = artboard.height;

  // Convert percent to pixels, clamped to the canvas
  const xPx = Math.max(0, Math.min(W - 1, Math.round((zone.xPct / 100) * W)));
  const yPx = Math.max(0, Math.min(H - 1, Math.round((zone.yPct / 100) * H)));
  const wPx = Math.max(1, Math.min(W - xPx, Math.round((zone.wPct / 100) * W)));
  const hPx = Math.max(1, Math.min(H - yPx, Math.round((zone.hPct / 100) * H)));

  // MEMORY-SAFE crop: allocate ONLY the w×h zone and copy its pixels straight
  // from the artboard. The previous `artboard.clone().crop(...)` duplicated the
  // ENTIRE multi-megapixel artboard bitmap for EVERY panel — the root cause of
  // HTTP 546 WORKER_RESOURCE_LIMIT (OOM) that left ProductionFlow stuck at 0/N
  // panels processed. ImageScript getPixelAt/setPixelAt are 1-based.
  const out = new Image(wPx, hPx);
  for (let y = 0; y < hPx; y++) {
    for (let x = 0; x < wPx; x++) {
      out.setPixelAt(x + 1, y + 1, artboard.getPixelAt(xPx + x + 1, yPx + y + 1));
    }
  }
  return out;
}
