/**
 * package-production-files — Final Production Pack Assembly
 *
 * Called by run-production-flow orchestrator in Phase D (runFinalPkg).
 * Assembles panels + extracted elements + cut contour files into
 * a production-ready ZIP with signed download URL.
 *
 * Input:  { job_id, panels, elements, user_id, order_number, vehicle }
 * Output: { success, zip_path, signed_url, file_count, zip_size_bytes }
 *
 * This runs AFTER panelizer-step-package (which may already have created a ZIP).
 * If step-package already ran, the orchestrator skips this function.
 * This handles the case where we need to re-package with extracted elements.
 *
 * All output files are RIP-compatible:
 *   VersaWorks, Onyx, Caldera, Flexi, SAi, EFI Fiery
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { corsHeaders } from "../_shared/cors.ts";
import {
  downloadFromStorage,
  uploadToStorage,
  getSignedUrl,
  fetchImageBytes,
} from "../_shared/panelizer-os/storage.ts";
import {
  finalPath,
  BLEED_INCHES,
  PRINT_DPI,
} from "../_shared/panelizer-os/constants.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      job_id,
      panels,
      elements,
      user_id,
      order_number,
      vehicle,
    } = await req.json();

    if (!user_id || !order_number) {
      return new Response(
        JSON.stringify({ error: "user_id and order_number required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[PACK-FINAL] Job ${job_id} — assembling production pack`);
    console.log(`[PACK-FINAL] Panels: ${(panels || []).length}, Elements: ${(elements || []).length}`);
    const startMs = Date.now();

    const zip = new JSZip();
    let fileCount = 0;

    // ── PANELS ─────────────────────────────────────────────────
    // Add each panel's production files (PNG preview + CMYK TIFF)
    if (panels?.length > 0) {
      for (const panel of panels) {
        const key = panel.panelKey || panel.name || `panel-${fileCount}`;
        const mirror = panel.mirrored ? "_mirrored" : "";
        const dims = panel.width_inches && panel.height_inches
          ? `${panel.width_inches}x${panel.height_inches}`
          : "";

        // Try to download panel from storage paths
        const paths = [
          panel.pngPath,
          panel.storage_path,
          panel.signed_url,
          panel.preview_url,
        ].filter(Boolean);

        for (const path of paths) {
          try {
            let bytes: Uint8Array;
            if (path.startsWith("http")) {
              bytes = await fetchImageBytes(path);
            } else {
              bytes = await downloadFromStorage(path);
            }

            const ext = path.includes(".tiff") || path.includes(".tif") ? "tiff" : "png";
            const folder = ext === "tiff" ? "panels-cmyk-tiff" : "panels-png";
            const filename = `${folder}/${key}${dims ? `_${dims}` : ""}${mirror}.${ext}`;
            zip.file(filename, bytes);
            fileCount++;
            console.log(`[PACK-FINAL] + ${filename} (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
            break; // Only add the first successful download
          } catch (e) {
            console.warn(`[PACK-FINAL] Skip path ${path}: ${e.message}`);
          }
        }

        // Also try TIFF path if separate
        if (panel.tiffPath) {
          try {
            const tiffBytes = await downloadFromStorage(panel.tiffPath);
            const tiffName = `panels-cmyk-tiff/${key}${dims ? `_${dims}` : ""}_${PRINT_DPI}dpi_CMYK${mirror}.tiff`;
            zip.file(tiffName, tiffBytes);
            fileCount++;
            console.log(`[PACK-FINAL] + ${tiffName}`);
          } catch (e) {
            console.warn(`[PACK-FINAL] TIFF skip: ${e.message}`);
          }
        }
      }
    }

    // ── EXTRACTED ELEMENTS ──────────────────────────────────────
    // Logos, text, graphics extracted from the design during Phase C
    if (elements?.length > 0) {
      const elemFolder = zip.folder("extracted-elements");
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        const elUrl = el.url || el.image_url || el.file_url;
        if (!elUrl) continue;

        try {
          const bytes = await fetchImageBytes(elUrl);
          const elType = el.type || "element";
          const elName = el.name || `${elType}-${i + 1}`;
          const filename = `${elName}.png`;
          elemFolder!.file(filename, bytes);
          fileCount++;
          console.log(`[PACK-FINAL] + extracted-elements/${filename}`);
        } catch (e) {
          console.warn(`[PACK-FINAL] Element skip: ${e.message}`);
        }
      }
    }

    // ── METADATA ────────────────────────────────────────────────
    const vehicleStr = vehicle
      ? `${vehicle.year || ""} ${vehicle.make || ""} ${vehicle.model || ""}`.trim()
      : "See metadata";

    const metadata = {
      pipeline: "ProductionFlow™ — RestyleProAI",
      architecture: "Step-Chain Orchestrator (Panelizer OS)",
      generated_at: new Date().toISOString(),
      order_number: order_number,
      vehicle: vehicleStr,
      bleed_inches: BLEED_INCHES,
      print_dpi: PRINT_DPI,
      color_space: "CMYK (UCR conversion)",
      rip_compatible: ["VersaWorks", "Onyx", "Caldera", "Flexi", "SAi", "EFI Fiery"],
      panels_count: (panels || []).length,
      elements_count: (elements || []).length,
      total_files: fileCount,
    };
    zip.file("production-pack-metadata.json", JSON.stringify(metadata, null, 2));

    // ── PRINT INSTRUCTIONS ──────────────────────────────────────
    const instructions = [
      "================================================================",
      "  PRODUCTION PACK — Generated by ProductionFlow™",
      "  RestyleProAI Universal Panelizer™ File Output System",
      "================================================================",
      "",
      `Order:       ${order_number}`,
      `Vehicle:     ${vehicleStr}`,
      `Date:        ${new Date().toISOString().split("T")[0]}`,
      `Color Space: CMYK (UCR conversion)`,
      `DPI:         ${PRINT_DPI} DPI (print-ready)`,
      `Bleed:       ${BLEED_INCHES}" all edges`,
      "",
      "CONTENTS:",
      "----------------------------------------------------------------",
      "  panels-png/              RGB PNG previews (proofing)",
      "  panels-cmyk-tiff/        CMYK TIFF files (direct to RIP)",
      ...(elements?.length > 0 ? ["  extracted-elements/      Logos, text, graphics (PNG)"] : []),
      "",
      "RIP SOFTWARE COMPATIBILITY:",
      "----------------------------------------------------------------",
      "  Roland VersaWorks    — Import TIFF, set to CMYK passthrough",
      "  Onyx RIP             — Import TIFF, color managed",
      "  Caldera RIP          — Import TIFF, use ICC profile",
      "  Flexi                — Import PNG/TIFF, set media size",
      "  SAi FlexiSIGN        — Import TIFF for large format",
      "  EFI Fiery            — Import TIFF, CMYK passthrough",
      "",
      "MATERIAL RECOMMENDATIONS:",
      "----------------------------------------------------------------",
      "  Cast Vinyl: Avery MPI 1105, 3M IJ180Cv3, Hexis HX190WG2",
      "  Laminate:   Match finish (gloss/matte/satin)",
      "  Outgas:     24 hours before lamination",
      "  Install:    65-75F (18-24C)",
      "",
      "MIRRORED PANELS:",
      "  Passenger-side panels are pre-mirrored. Do NOT flip in RIP.",
      "",
      "================================================================",
      "  All outputs are production-ready, RIP-compatible files.",
      "  Powered by Universal Panelizer™ — RestyleProAI",
      "  https://restylepro.com",
      "================================================================",
    ].join("\n");
    zip.file("PRINT-INSTRUCTIONS.txt", instructions);

    // ── GENERATE ZIP ────────────────────────────────────────────
    if (fileCount === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No files could be assembled. Check panel storage paths.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const zipBuffer = await zip.generateAsync({
      type: "uint8array",
      compression: "STORE", // Files already compressed
    });

    // Upload to final storage
    const vehicleSlug = vehicleStr.replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/g, "");
    const zipFilename = `ProductionPack-${order_number}-${vehicleSlug}.zip`;
    const zipPath = finalPath(user_id, order_number, zipFilename);
    await uploadToStorage(zipPath, zipBuffer, "application/zip");

    // Signed URL (30 day expiry)
    const signedUrl = await getSignedUrl(zipPath);

    const elapsedMs = Date.now() - startMs;
    console.log(`[PACK-FINAL] Done: ${fileCount} files, ${(zipBuffer.byteLength / 1024 / 1024).toFixed(1)} MB in ${elapsedMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        zip_path: zipPath,
        signed_url: signedUrl,
        file_count: fileCount,
        zip_size_bytes: zipBuffer.byteLength,
        panels_included: (panels || []).length,
        elements_included: (elements || []).length,
        processing_ms: elapsedMs,
        rip_compatible: ["VersaWorks", "Onyx", "Caldera", "Flexi", "SAi", "EFI Fiery"],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[PACK-FINAL] Error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: `Production pack assembly failed: ${err.message}`,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
