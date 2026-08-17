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
 * panelizer-step-crop — Step 5: Deterministic crop via Replicate
 *
 * Input:  { masterPath, userId, jobId, panelKey, panelType, sideSize?, roofSize?,
 *           cropZone?, bodyHeightInches? }
 * Output: { storagePath } — cropped panel saved to temp storage
 *
 * Takes the master texture and crops it to the exact panel dimensions.
 * Uses center-crop strategy for standard vehicles.
 *
 * For two-panel (tall) vehicles, cropZone determines vertical position:
 *   "upper" → crops from the top portion of the taller master
 *   "lower" → crops from the bottom portion of the taller master
 * Both upper and lower panels overlap at the body line break.
 *
 * V2: Offloaded to Replicate to avoid the 238 MB Deno memory limit.
 * ImageScript decoded full RGBA bitmaps in-process — a 4K master +
 * .clone() easily exceeded the edge-function ceiling. Now the edge
 * function only handles URLs, JSON, and small byte downloads.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getSignedUrl,
  uploadToStorage,
} from "../_shared/panelizer-os/storage.ts";
import {
  tempPath,
  MASTER_WIDTH_INCHES,
  MASTER_HEIGHT_INCHES,
  SIDE_PANELS,
  ADDON_PANELS,
  ROOF_PANELS,
} from "../_shared/panelizer-os/constants.ts";
import { replicateCrop } from "../_shared/replicate-crop.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { masterPath, userId, jobId, panelKey, panelType, sideSize, roofSize, cropZone, bodyHeightInches } = await req.json();

    if (!masterPath || !userId || !jobId || !panelKey) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters (masterPath, userId, jobId, panelKey)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[CROP] Job ${jobId} — cropping panel: ${panelKey} (${panelType}${cropZone ? `, zone: ${cropZone}` : ""})`);
    const startMs = Date.now();

    // Resolve panel dimensions
    const dims = resolveDimensions(panelKey, panelType, sideSize, roofSize);
    if (!dims) {
      return new Response(
        JSON.stringify({ error: `Unknown panel: ${panelKey} / ${panelType}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Get a signed URL for the master — Replicate fetches the image, not us.
    const signedUrl = await getSignedUrl(masterPath);

    // Determine effective master dimensions in inches.
    const isTwoPanel = !!cropZone;
    const masterWidthInches = MASTER_WIDTH_INCHES;
    const masterHeightInches = isTwoPanel && bodyHeightInches
      ? bodyHeightInches
      : MASTER_HEIGHT_INCHES;

    // Calculate crop region as fractions (0–1) of the master image.
    const widthRatio = dims.widthInches / masterWidthInches;

    let cropX: number, cropY: number, cropW: number, cropH: number;

    if (isTwoPanel) {
      const panelHeightRatio = dims.heightInches / masterHeightInches;
      cropW = Math.min(widthRatio, 1);
      cropH = Math.min(panelHeightRatio, 1);
      cropX = Math.max(0, (1 - cropW) / 2); // center horizontally

      if (cropZone === "upper") {
        cropY = 0;
      } else {
        cropY = Math.max(0, 1 - cropH);
      }

      console.log(`[CROP] Two-panel ${cropZone}: master ${masterHeightInches}" → panel ${dims.heightInches}" (${(panelHeightRatio * 100).toFixed(0)}% of master)`);
    } else {
      // Standard center-crop
      const heightRatio = dims.heightInches / masterHeightInches;
      cropW = Math.min(widthRatio, 1);
      cropH = Math.min(heightRatio, 1);
      cropX = Math.max(0, (1 - cropW) / 2);
      cropY = Math.max(0, (1 - cropH) / 2);
    }

    console.log(`[CROP] ${dims.label}: fractional region (${cropX.toFixed(3)}, ${cropY.toFixed(3)}, ${cropW.toFixed(3)}, ${cropH.toFixed(3)})`);

    // Offload to Replicate — zero in-memory image decoding
    const result = await replicateCrop(
      signedUrl,
      { x: cropX, y: cropY, w: cropW, h: cropH },
      60_000,
    );

    if (!result.cropped || result.imageBytes.length === 0) {
      console.error(`[CROP] Replicate crop failed: ${result.error}`);
      return new Response(
        JSON.stringify({ error: `Crop step failed: ${result.error}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Upload cropped panel to temp storage
    const storagePath = tempPath(userId, jobId, `step-5-crop-${panelKey}`);
    await uploadToStorage(storagePath, result.imageBytes, "image/png");

    console.log(`[CROP] ${dims.label} saved (${(result.imageBytes.byteLength / 1024).toFixed(0)} KB) in ${Date.now() - startMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        storagePath,
        panelKey,
        label: dims.label,
        widthInches: dims.widthInches,
        heightInches: dims.heightInches,
        cropFractions: { x: cropX, y: cropY, w: cropW, h: cropH },
        cropZone: cropZone || null,
        step: "crop",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[CROP] Error:", err);
    return new Response(
      JSON.stringify({ error: `Crop step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function resolveDimensions(
  panelKey: string,
  panelType: string,
  sideSize?: string,
  roofSize?: string,
): { widthInches: number; heightInches: number; label: string } | null {
  if (panelType === "side") {
    return SIDE_PANELS[sideSize || "medium"] || null;
  }
  if (panelType === "addon") {
    return ADDON_PANELS[panelKey] || null;
  }
  if (panelType === "roof") {
    return ROOF_PANELS[roofSize || "medium"] || null;
  }
  return null;
}
