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
 * panelizer-step-package — Final Step: Package panels into ZIP
 *
 * Input:  { panels: [{ pngPath, tiffPath, panelKey, label, widthInches, heightInches, mirrored }],
 *           masterPath, userId, jobId, vehicle, finish, designName, orderNumber }
 * Output: { packUrl, fileCount, metadata, tiffDownloads: [...] }
 *
 * Collects all processed panels (PNG + CMYK TIFF) from temp storage,
 * bundles them into a ZIP with metadata and print instructions.
 * Also provides individual TIFF download URLs.
 * Cleans up temp files after packaging.
 * No AI — pure file assembly.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { corsHeaders } from "../_shared/cors.ts";
import {
  downloadFromStorage,
  uploadToStorage,
  getPublicUrl,
  getPublicUrl as getPermUrl,
  cleanupTemp,
} from "../_shared/panelizer-os/storage.ts";
import {
  finalPath,
  PIPELINE_VERSION,
  PIPELINE_NAME,
  BLEED_INCHES,
  PRINT_DPI,
  OUTPUT_SCALE,
  PPI,
  OVERLAP_INCHES,
} from "../_shared/panelizer-os/constants.ts";

interface PanelEntry {
  pngPath: string;
  tiffPath?: string;
  epsPath?: string;
  panelKey: string;
  label: string;
  widthInches: number;
  heightInches: number;
  mirrored: boolean;
  qaResult?: any;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const reqBody = await req.json();
    const {
      panels,
      masterPath,
      userId,
      jobId,
      vehicle,
      finish,
      designName,
      orderNumber,
      designId,
      promptFingerprint,
    } = reqBody;

    if (!panels || !userId || !jobId || !orderNumber) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[PACKAGE] Job ${jobId} — packaging ${panels.length} panels`);
    const startMs = Date.now();

    const zip = new JSZip();
    const panelEntries: PanelEntry[] = panels;
    let thumbnailUrl = "";
    const tiffDownloads: { panelKey: string; label: string; url: string }[] = [];

    // Add each panel to the ZIP (both PNG and TIFF)
    // Filename format: {panelKey}_{WxH}_{DPI}dpi_CMYK[_mirrored].tiff
    for (const panel of panelEntries) {
      const mirrorSuffix = panel.mirrored ? "_mirrored" : "";
      const dimStr = `${panel.widthInches}x${panel.heightInches}`;

      // Add PNG (preview/proof) — try panel path first, then masterPath fallback
      const pngSource = panel.pngPath || masterPath;
      if (pngSource) {
        try {
          const pngBytes = await downloadFromStorage(pngSource);
          const pngFilename = `panels-png/${panel.panelKey}_${dimStr}${mirrorSuffix}.png`;
          zip.file(pngFilename, pngBytes);
          console.log(`[PACKAGE] Added PNG: ${pngFilename} (${(pngBytes.byteLength / 1024).toFixed(0)} KB)${!panel.pngPath ? ' (master fallback)' : ''}`);

          // Save to final storage for thumbnail + QC page
          const pngFinalPath = finalPath(userId, orderNumber, `${panel.panelKey}${mirrorSuffix}.png`);
          await uploadToStorage(pngFinalPath, pngBytes, "image/png");
          if (!thumbnailUrl) {
            thumbnailUrl = getPublicUrl(pngFinalPath);
          }
        } catch (e) {
          console.warn(`[PACKAGE] PNG not found for ${panel.panelKey}: ${e.message}`);
        }
      } else {
        console.warn(`[PACKAGE] No PNG path for ${panel.panelKey} — skipping`);
      }

      // Add CMYK TIFF (print-ready)
      if (panel.tiffPath) {
        try {
          const tiffBytes = await downloadFromStorage(panel.tiffPath);
          const tiffFilename = `panels-cmyk-tiff/${panel.panelKey}_${dimStr}_${PRINT_DPI}dpi_CMYK${mirrorSuffix}.tiff`;
          zip.file(tiffFilename, tiffBytes);
          console.log(`[PACKAGE] Added TIFF: ${tiffFilename} (${(tiffBytes.byteLength / 1024).toFixed(0)} KB)`);

          // Save TIFF to final storage for individual download
          const tiffFinalPath = finalPath(userId, orderNumber, `${panel.panelKey}_${dimStr}_${PRINT_DPI}dpi_CMYK${mirrorSuffix}.tiff`);
          await uploadToStorage(tiffFinalPath, tiffBytes, "image/tiff");

          // Get permanent public URL for direct download
          const tiffUrl = getPermUrl(tiffFinalPath);
          tiffDownloads.push({
            panelKey: panel.panelKey,
            label: `${panel.label}${panel.mirrored ? " (Mirrored)" : ""} — CMYK ${PRINT_DPI} DPI`,
            url: tiffUrl,
          });
        } catch (e) {
          console.warn(`[PACKAGE] TIFF not found for ${panel.panelKey}: ${e.message}`);
        }
      }

      // Add EPS (vector production file)
      if (panel.epsPath) {
        try {
          const epsBytes = await downloadFromStorage(panel.epsPath);
          const epsFilename = `panels-eps/${panel.panelKey}_${dimStr}${mirrorSuffix}.eps`;
          zip.file(epsFilename, epsBytes);
          console.log(`[PACKAGE] Added EPS: ${epsFilename} (${(epsBytes.byteLength / 1024).toFixed(0)} KB)`);
        } catch (e) {
          console.warn(`[PACKAGE] EPS not found for ${panel.panelKey}: ${e.message}`);
        }
      }
    }

    // Add master texture if available
    if (masterPath) {
      try {
        const masterBytes = await downloadFromStorage(masterPath);
        zip.file("masterTexture.png", masterBytes);
        console.log(`[PACKAGE] Added masterTexture.png`);
      } catch (e) {
        console.warn(`[PACKAGE] Could not add master texture: ${e.message}`);
      }
    }

    // Build metadata — includes Design Equity provenance (PF + DID)
    const metadata = {
      pipelineName: PIPELINE_NAME,
      pipelineVersion: PIPELINE_VERSION,
      architecture: "GENIE Production Panelizer OS Step-Chain (Graphic Export Native Intelligence Engine)",
      generatedAt: new Date().toISOString(),
      vehicle: vehicle || "Unknown",
      finish: finish || "Unknown",
      designName: designName || "Untitled",
      // ── Design Equity Provenance ──
      designId: designId || null,
      promptFingerprint: promptFingerprint || null,
      generationId: reqBody.generation_id || null,
      ownershipProof: "RestyleProAI DesignEquity System — YOUR DESIGNS. YOUR PROOF. YOUR EQUITY.",
      bleedInches: BLEED_INCHES,
      printDpi: PRINT_DPI,
      colorSpace: "CMYK (UCR conversion)",
      tiffCompression: "Adobe Deflate",
      panels: panelEntries.map((p) => ({
        key: p.panelKey,
        label: p.label,
        widthInches: p.widthInches,
        heightInches: p.heightInches,
        mirrored: p.mirrored,
        hasTiff: !!p.tiffPath,
        hasEps: !!p.epsPath,
        qaResult: p.qaResult || null,
      })),
    };
    zip.file("production-pack-metadata.json", JSON.stringify(metadata, null, 2));

    // Add print instructions
    const instructions = buildPrintInstructions(panelEntries, vehicle, finish, orderNumber);
    zip.file("PRINT-INSTRUCTIONS.txt", instructions);

    // Add Production Proof Sheet (HTML)
    const proofSheet = buildProductionProofSheet(panelEntries, vehicle, finish, designName, orderNumber);
    zip.file("PRODUCTION-PROOF.html", proofSheet);
    console.log(`[PACKAGE] Added PRODUCTION-PROOF.html`);

    // Generate ZIP (STORE compression — files are already compressed)
    // Wrap in try/catch — if ZIP generation OOMs, individual files are already in final storage
    let packUrl = "";
    let zipSizeBytes = 0;
    try {
      const zipBuffer = await zip.generateAsync({
        type: "uint8array",
        compression: "STORE",
      });
      zipSizeBytes = zipBuffer.byteLength;

      // Upload ZIP to final storage
      const vehicleSlug = (vehicle || "Vehicle").replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/, "");
      const zipFilename = `GENIE-Panelizer-${orderNumber}-${vehicleSlug}.zip`;
      const zipPath = finalPath(userId, orderNumber, zipFilename);
      await uploadToStorage(zipPath, zipBuffer, "application/zip");
      packUrl = getPublicUrl(zipPath);
      console.log(`[PACKAGE] ZIP: ${(zipSizeBytes / 1024 / 1024).toFixed(1)} MB → ${zipPath}`);
    } catch (zipErr) {
      console.warn(`[PACKAGE] ZIP generation failed (${zipErr.message}) — individual files already uploaded to final storage`);
    }

    // Cleanup temp files (fire-and-forget)
    cleanupTemp(userId, jobId).catch((e) =>
      console.warn(`[PACKAGE] Cleanup warning: ${e.message}`)
    );

    console.log(`[PACKAGE] Done in ${Date.now() - startMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        packUrl,
        thumbnailUrl,
        fileCount: panelEntries.length,
        zipSizeBytes,
        tiffDownloads,
        metadata,
        step: "package",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[PACKAGE] Error:", err);
    return new Response(
      JSON.stringify({ error: `Package step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function buildPrintInstructions(
  panels: PanelEntry[],
  vehicle?: string,
  finish?: string,
  orderNumber?: string,
): string {
  const date = new Date().toISOString().split("T")[0];
  const veh = vehicle || "Vehicle";
  const ord = orderNumber || "N/A";

  const lines = [
    "================================================================",
    "  INSTALLER PRODUCTION PROOF",
    `  ${PIPELINE_NAME} — G.E.N.I.E. (Graphic Export Native Intelligence Engine)`,
    `  Pipeline: ${PIPELINE_VERSION}`,
    "  Powered by RestyleProAI — https://restylepro.com",
    "================================================================",
    "",
    `Order:       ${ord}`,
    `Vehicle:     ${veh}`,
    `Finish:      ${finish || "See metadata"}`,
    `Date:        ${date}`,
    `Scale:       10% (RIP to 1000% for full-size output)`,
    `DPI:         ${PRINT_DPI} DPI embedded (${PPI} px/inch at 10% scale)`,
    `PPI:         ${PPI} px/inch (inches × ${PPI} = pixels)`,
    `Color Space: CMYK (UCR conversion)`,
    `Bleed:       ${BLEED_INCHES}" all edges`,
    "",
    "FILE FORMATS:",
    "----------------------------------------------------------------",
    "  panels-png/         RGB PNG previews (for proofing/approval)",
    "  panels-cmyk-tiff/   CMYK TIFF files (for RIP/printing)",
    "  panels-eps/         Vector EPS files (for cutting/RIP)",
    "  masterTexture.png   Source master texture",
    "",
    "PANEL LIST:",
    "----------------------------------------------------------------",
  ];

  let panelNum = 0;
  for (const p of panels) {
    panelNum++;
    const mirror = p.mirrored ? " [MIRRORED]" : "";
    const dimStr = `${p.widthInches}" x ${p.heightInches}"`;
    const pxW = Math.round(p.widthInches * PPI);
    const pxH = Math.round(p.heightInches * PPI);
    lines.push(`  ${panelNum}. ${p.label} (${p.panelKey}): ${dimStr} → ${pxW}×${pxH} px${mirror}`);
  }

  lines.push(
    "",
    "NAMING CONVENTION:",
    `  {panelKey}_{WxH}_${PRINT_DPI}dpi_CMYK[_mirrored].tiff`,
    `  Example: driver-side-panel1_218x53.5_${PRINT_DPI}dpi_CMYK.tiff`,
    "",
    "SCALE & DPI:",
    "----------------------------------------------------------------",
    `  Files are at 10% of actual print size.`,
    `  Embedded DPI: ${PRINT_DPI}`,
    `  RIP software should scale to 1000% (effective ${PPI} DPI at full size).`,
    `  Pixel formula: panel_inches × ${PPI} = pixel dimensions`,
    `  This is standard for large-format vehicle wraps.`,
    "",
    "INSTALLATION NOTES:",
    "----------------------------------------------------------------",
    `  - Bleed: ${BLEED_INCHES}" on all edges — trim to crop marks`,
    `  - Panel seam overlap: ${OVERLAP_INCHES}" (for tiled vehicles)`,
    "  - Crop marks are in the bleed zone (trim off after install)",
    "  - Mirrored panels are pre-flipped for passenger side — do NOT flip again",
    "  - Panel 1 = upper tile, Panel 2 = lower tile (overlap at body line)",
    "",
    "CMYK TIFF FILES:",
    "----------------------------------------------------------------",
    "  - Color space: CMYK (Separated via UCR)",
    `  - Resolution: ${PRINT_DPI} DPI (at 10% scale)`,
    "  - Compression: Adobe Deflate",
    "  - No ICC profile embedded — use your printer's profile",
    "  - Import directly into RIP (ONYX, Caldera, Wasatch, etc.)",
    "",
    "MATERIAL:",
    "----------------------------------------------------------------",
    "  - Cast vinyl (Avery MPI 1105, 3M IJ180Cv3, Hexis HX190WG2)",
    "  - Laminate with matching finish (gloss/matte/satin)",
    "  - Allow 24h outgas before lamination",
    "  - Recommended install temp: 65-75F (18-24C)",
    "",
    "================================================================",
    `  ${PIPELINE_NAME} — RestyleProAI`,
    "  https://restylepro.com",
    "================================================================",
  );

  return lines.join("\n");
}

function buildProductionProofSheet(
  panels: PanelEntry[],
  vehicle?: string,
  finish?: string,
  designName?: string,
  orderNumber?: string,
): string {
  const date = new Date().toISOString().split("T")[0];
  const veh = vehicle || "Vehicle";
  const design = designName || "Untitled";
  const ord = orderNumber || "N/A";

  const panelCards = panels.map((p) => {
    const mirrorSuffix = p.mirrored ? "_mirrored" : "";
    const dimStr = `${p.widthInches}x${p.heightInches}`;
    const pngFilename = `panels-png/${p.panelKey}_${dimStr}${mirrorSuffix}.png`;
    const tiffFilename = `panels-cmyk-tiff/${p.panelKey}_${dimStr}_${PRINT_DPI}dpi_CMYK${mirrorSuffix}.tiff`;
    const withBleedW = (p.widthInches + BLEED_INCHES * 2).toFixed(1);
    const withBleedH = (p.heightInches + BLEED_INCHES * 2).toFixed(1);
    const pxW = Math.round(p.widthInches * PPI);
    const pxH = Math.round(p.heightInches * PPI);
    const sqft = ((p.widthInches * p.heightInches) / 144).toFixed(1);

    return `
      <div class="panel-card">
        <div class="panel-header">
          <span class="panel-name">${p.label.toUpperCase()}${p.mirrored ? " (MIRRORED)" : ""}</span>
          <span class="panel-filename">${tiffFilename.split("/")[1]}</span>
        </div>
        <div class="panel-specs">
          <div class="spec-row">
            <span class="spec-label">Print Size:</span>
            <span class="spec-value">${p.widthInches}" x ${p.heightInches}"</span>
            <span class="spec-label">Pixel Dims:</span>
            <span class="spec-value">${pxW} x ${pxH}</span>
          </div>
          <div class="spec-row">
            <span class="spec-label">With Bleed:</span>
            <span class="spec-value">${withBleedW}" x ${withBleedH}"</span>
            <span class="spec-label">@ ${PRINT_DPI} DPI</span>
            <span class="spec-value">(10% scale)</span>
          </div>
          <div class="spec-row">
            <span class="spec-label">Coverage:</span>
            <span class="spec-value">${sqft} sq ft</span>
          </div>
        </div>
        <div class="panel-preview">
          <img src="${pngFilename}" alt="${p.label}" />
        </div>
      </div>`;
  }).join("\n");

  const totalSqFt = panels.reduce((sum, p) => sum + (p.widthInches * p.heightInches) / 144, 0).toFixed(1);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Production Proof — ${ord} — ${veh}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Inter, -apple-system, sans-serif; background: #111; color: #fff; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #222; }
  .header-left h1 { font-size: 28px; font-weight: 800; }
  .header-left h1 span { color: #00E5FF; }
  .header-left .subtitle { font-size: 12px; color: #888; margin-top: 4px; }
  .header-left .proof-badge { display: inline-block; margin-top: 8px; padding: 4px 12px; font-size: 13px; font-weight: 700; color: #00FF88; letter-spacing: 1px; border: 2px solid #00FF88; border-radius: 4px; }
  .header-right { text-align: right; }
  .header-right .design-name { font-size: 22px; font-weight: 700; }
  .header-right .vehicle { font-size: 14px; color: #aaa; margin-top: 4px; }
  .header-right .date { font-size: 12px; color: #666; margin-top: 2px; }
  .header-right .order { font-size: 11px; color: #00E5FF; margin-top: 4px; font-weight: 600; }
  .summary { display: flex; gap: 24px; margin-bottom: 24px; font-size: 12px; color: #888; }
  .summary span { color: #ccc; font-weight: 600; }
  .panels-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
  .panel-card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; overflow: hidden; border-left: 3px solid #00FF88; }
  .panel-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #222; border-bottom: 1px solid #333; }
  .panel-name { font-size: 12px; font-weight: 800; letter-spacing: 1px; color: #fff; }
  .panel-filename { font-size: 9px; color: #666; font-family: monospace; }
  .panel-specs { padding: 10px 14px; }
  .spec-row { display: flex; gap: 16px; align-items: center; margin-bottom: 4px; }
  .spec-label { font-size: 11px; color: #888; font-weight: 600; min-width: 80px; }
  .spec-value { font-size: 11px; color: #ddd; }
  .panel-preview { padding: 12px; display: flex; justify-content: center; align-items: center; min-height: 160px; background: #111; }
  .panel-preview img { max-width: 100%; max-height: 200px; object-fit: contain; border-radius: 4px; }
  .install-notes { margin-top: 24px; padding: 16px; background: #1a1a1a; border: 1px solid #333; border-left: 3px solid #00FF88; border-radius: 8px; font-size: 11px; color: #aaa; }
  .install-notes h3 { font-size: 12px; font-weight: 700; color: #00FF88; margin-bottom: 8px; letter-spacing: 1px; }
  .install-notes ul { list-style: none; padding: 0; }
  .install-notes li { margin-bottom: 4px; padding-left: 16px; position: relative; }
  .install-notes li::before { content: "\\2022"; position: absolute; left: 4px; color: #00FF88; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #222; text-align: center; font-size: 10px; color: #555; }
  .footer span { color: #00E5FF; }
  @media print { body { background: #fff; color: #000; } .panel-card { border-color: #ddd; } .panel-header { background: #eee; } .panel-name { color: #000; } .spec-value { color: #333; } }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>Restyle<span>ProAI</span>\u2122</h1>
      <div class="subtitle">AI-Powered Vehicle Graphics Studio</div>
      <div class="proof-badge">INSTALLER PRODUCTION PROOF &mdash; ${PRINT_DPI} DPI @ 10% SCALE</div>
    </div>
    <div class="header-right">
      <div class="design-name">${design}</div>
      <div class="vehicle">${veh}</div>
      <div class="date">Finish: ${finish || "Standard"} &bull; ${date}</div>
      <div class="order">${ord}</div>
    </div>
  </div>

  <div class="summary">
    <div>Panels: <span>${panels.length}</span></div>
    <div>Total Coverage: <span>${totalSqFt} sq ft</span></div>
    <div>Bleed: <span>${BLEED_INCHES}" all edges</span></div>
    <div>DPI: <span>${PRINT_DPI} (10% scale &rarr; RIP to 1000%)</span></div>
    <div>Color: <span>CMYK (UCR)</span></div>
  </div>

  <div class="panels-grid">
    ${panelCards}
  </div>

  <div class="install-notes">
    <h3>INSTALLATION NOTES</h3>
    <ul>
      <li>Bleed: ${BLEED_INCHES}" on all edges &mdash; trim to crop marks</li>
      <li>Panel seam overlap: ${OVERLAP_INCHES}" (for tiled vehicles)</li>
      <li>Mirrored panels are pre-flipped for passenger side &mdash; do NOT flip again</li>
      <li>Panel 1 = upper tile, Panel 2 = lower tile (overlap at body line)</li>
      <li>Material: Cast vinyl (Avery MPI 1105, 3M IJ180Cv3, Hexis HX190WG2)</li>
      <li>Laminate with matching finish (gloss/matte/satin) &mdash; allow 24h outgas</li>
      <li>RIP to 1000% for full-size output &mdash; files are at 10% scale</li>
    </ul>
  </div>

  <div class="footer">
    ${PIPELINE_NAME} v${PIPELINE_VERSION} &mdash; <span>G.E.N.I.E.</span> &mdash; Graphic Export Native Intelligence Engine &mdash; RestyleProAI &mdash; restylepro.com
  </div>
</body>
</html>`;
}
