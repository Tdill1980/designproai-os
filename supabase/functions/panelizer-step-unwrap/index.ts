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
 * panelizer-step-unwrap — Deterministic Panel Extraction from 3D Render
 *
 * THE CORE DETERMINISTIC STEP — replaces Gemini as primary extraction method.
 *
 * Uses vehicle-category-specific crop guides to extract body panel regions
 * from the side-view 3D render. Pure math — no AI, no Gemini, no timeouts.
 *
 * How it works:
 *   1. Load the 3D render (side view of wrapped vehicle)
 *   2. Look up crop guide for the vehicle category (sedan, SUV, van, etc.)
 *   3. Crop the body region (where the vinyl design is visible)
 *   4. Correct aspect ratio to match the target panel dimensions
 *   5. For tiled panels (tall vans), extract upper/lower portions
 *   6. Save the deterministic crop to storage
 *
 * The cropped image contains the actual design as shown on the vehicle body.
 * It includes some vehicle elements (door lines, wheels), but:
 *   - ESRGAN upscale enhances quality (4x)
 *   - Flatten sizes to exact production dimensions
 *   - For production panels, Gemini can optionally REFINE the crop
 *     (removing vehicle body, flattening perspective — a much simpler task
 *     than full extraction from scratch)
 *
 * This step is:
 *   - 100% DETERMINISTIC (same input → same output, always)
 *   - FAST (~200ms, no network calls except storage)
 *   - RELIABLE (no AI failures, no timeouts, no rate limits)
 *   - FALLBACK-SAFE (always produces output for downstream steps)
 *
 * No AI — pure math.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  downloadFromStorage,
  uploadToStorage,
} from "../_shared/panelizer-os/storage.ts";
import { tempPath } from "../_shared/panelizer-os/constants.ts";

// ── Crop Guides ─────────────────────────────────────────────────
// These define where the vehicle body sits in a standard side-view render.
// Values are percentages of the render image dimensions.
//
// Tuned for RestylePro's AI-generated 3D renders (slightly elevated side view).
// The body region captures the full vinyl surface from front bumper to tailgate.

interface CropGuide {
  left: number;    // % from left edge to front bumper
  right: number;   // % from left edge to rear bumper
  top: number;     // % from top to roofline
  bottom: number;  // % from top to rocker panel/ground
}

const CROP_GUIDES: Record<string, CropGuide> = {
  compact:  { left: 0.10, right: 0.90, top: 0.25, bottom: 0.72 },
  midsize:  { left: 0.08, right: 0.92, top: 0.22, bottom: 0.72 },
  fullsize: { left: 0.07, right: 0.93, top: 0.20, bottom: 0.73 },
  suv:      { left: 0.08, right: 0.92, top: 0.18, bottom: 0.76 },
  truck:    { left: 0.06, right: 0.94, top: 0.20, bottom: 0.73 },
  van:      { left: 0.08, right: 0.92, top: 0.10, bottom: 0.82 },
};

interface UnwrapPanel {
  panelKey: string;
  panelType: string;
  widthInches: number;
  heightInches: number;
  cropZone?: "upper" | "lower";
  mirrored: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      renderPath,
      userId,
      jobId,
      panels,
      vehicleCategory,
    } = await req.json();

    if (!renderPath || !userId || !jobId || !panels) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const startMs = Date.now();
    const category = vehicleCategory || "midsize";
    const guide = CROP_GUIDES[category] || CROP_GUIDES.midsize;

    console.log(`[UNWRAP] Job ${jobId} — deterministic extraction (${category})`);

    // Load the 3D render
    const renderBytes = await downloadFromStorage(renderPath);
    const render = await Image.decode(renderBytes);
    console.log(`[UNWRAP] Render: ${render.width}x${render.height}px (${(renderBytes.byteLength / 1024).toFixed(0)} KB)`);

    // Crop the body region from the render
    const cropX = Math.round(render.width * guide.left);
    const cropY = Math.round(render.height * guide.top);
    const cropW = Math.round(render.width * (guide.right - guide.left));
    const cropH = Math.round(render.height * (guide.bottom - guide.top));

    console.log(`[UNWRAP] Body region: x=${cropX} y=${cropY} ${cropW}x${cropH}px (guide: ${category})`);

    // Extract the body region
    const bodyRegion = render.clone().crop(
      Math.max(1, cropX),
      Math.max(1, cropY),
      Math.min(cropW, render.width - cropX),
      Math.min(cropH, render.height - cropY),
    );

    // Process each unique (non-mirrored) side panel
    const panelList: UnwrapPanel[] = panels;
    const sidePanels = panelList.filter(
      (p) => p.panelType === "side" && !p.mirrored,
    );

    const unwrappedPaths: Record<string, string> = {};

    for (const panel of sidePanels) {
      const panelStart = Date.now();
      let panelImage: Image;

      if (panel.cropZone === "upper") {
        // Upper tile — top portion of body region
        // For a van at 90" body height, upper is 53.5" = ~59% of total height
        const upperFraction = panel.heightInches /
          (panel.heightInches + estimateLowerHeight(panel.heightInches));
        const upperH = Math.max(
          10,
          Math.round(bodyRegion.height * upperFraction),
        );
        panelImage = bodyRegion.clone().crop(1, 1, bodyRegion.width, upperH);
        console.log(`[UNWRAP] ${panel.panelKey}: upper tile (${upperFraction.toFixed(2)} = ${upperH}px)`);
      } else if (panel.cropZone === "lower") {
        // Lower tile — bottom portion of body region (with overlap)
        const totalBodyHeight = estimateTotalBodyHeight(panel.heightInches);
        const overlapFraction = 1.0 / totalBodyHeight; // 1" overlap
        const lowerFraction = panel.heightInches / totalBodyHeight;
        const lowerStart = Math.max(
          0,
          Math.round(bodyRegion.height * (1 - lowerFraction - overlapFraction)),
        );
        const lowerH = bodyRegion.height - lowerStart;
        panelImage = bodyRegion.clone().crop(
          1,
          Math.max(1, lowerStart),
          bodyRegion.width,
          Math.max(10, lowerH),
        );
        console.log(`[UNWRAP] ${panel.panelKey}: lower tile (start ${lowerStart}px, h=${lowerH}px)`);
      } else {
        // Full body — single side panel
        panelImage = bodyRegion.clone();
        console.log(`[UNWRAP] ${panel.panelKey}: full body crop`);
      }

      // Correct aspect ratio to match panel dimensions
      panelImage = correctAspectRatio(
        panelImage,
        panel.widthInches,
        panel.heightInches,
      );

      // Encode and upload
      const panelBytes = await panelImage.encode();
      const storagePath = tempPath(
        userId,
        jobId,
        `step-unwrap-${panel.panelKey}`,
      );
      await uploadToStorage(storagePath, panelBytes, "image/png");
      unwrappedPaths[panel.panelKey] = storagePath;

      console.log(
        `[UNWRAP] ✓ ${panel.panelKey}: ${panelImage.width}x${panelImage.height}px ` +
          `(${(panelBytes.byteLength / 1024).toFixed(0)} KB, ${Date.now() - panelStart}ms)`,
      );
    }

    // Map mirrored side panels to their driver-side source
    for (const panel of panelList) {
      if (panel.panelType === "side" && panel.mirrored && !unwrappedPaths[panel.panelKey]) {
        const sourceKey = panel.panelKey.replace("passenger", "driver");
        if (unwrappedPaths[sourceKey]) {
          unwrappedPaths[panel.panelKey] = unwrappedPaths[sourceKey];
        }
      }
    }

    const totalMs = Date.now() - startMs;
    console.log(
      `[UNWRAP] Done: ${Object.keys(unwrappedPaths).length} panels in ${totalMs}ms (deterministic, no AI)`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        unwrappedPaths,
        panelCount: Object.keys(unwrappedPaths).length,
        category,
        deterministic: true,
        timingMs: totalMs,
        step: "unwrap",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[UNWRAP] Error:", err);
    return new Response(
      JSON.stringify({ error: `Unwrap step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ── Aspect ratio correction ─────────────────────────────────────
// Crops the image to match the target panel proportions.
// If the crop is too wide, trim the sides. If too tall, trim top/bottom.

function correctAspectRatio(
  img: Image,
  targetWidthInches: number,
  targetHeightInches: number,
): Image {
  const targetRatio = targetWidthInches / targetHeightInches;
  const currentRatio = img.width / img.height;
  const diff = Math.abs(currentRatio - targetRatio) / targetRatio;

  if (diff < 0.03) {
    return img; // Close enough — no correction needed
  }

  if (currentRatio > targetRatio) {
    // Too wide — crop sides (center-weighted)
    const newW = Math.round(img.height * targetRatio);
    const offset = Math.round((img.width - newW) / 2);
    return img.crop(Math.max(1, offset), 1, Math.min(newW, img.width), img.height);
  } else {
    // Too tall — crop top/bottom (slightly top-weighted for vehicles — more sky than ground)
    const newH = Math.round(img.width / targetRatio);
    const offset = Math.round((img.height - newH) * 0.4); // 40% from top (more sky cropped)
    return img.crop(1, Math.max(1, offset), img.width, Math.min(newH, img.height));
  }
}

// ── Height estimation for tiled panels ──────────────────────────
// Given the upper tile height, estimate the lower tile height
// (body height - upper + overlap).

function estimateLowerHeight(upperHeight: number): number {
  // Upper is MAX_TILE_INCHES (53.5"), lower is remainder + 1" overlap
  // For a 90" van: lower = 90 - 53.5 + 1.0 = 37.5"
  // This gives us the fraction for the upper crop
  return Math.max(10, 90 - upperHeight + 1.0); // Assume ~90" for tall vehicles
}

function estimateTotalBodyHeight(lowerTileHeight: number): number {
  // Reverse: total = upper + lower - overlap
  // upper = 59", overlap = 1.0"
  return 59 + lowerTileHeight - 1.0;
}
