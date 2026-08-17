/**
 * ═══════════════════════════════════════════════════════════════
 *  TRADE SECRET — CONFIDENTIAL & PROPRIETARY
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *
 *  Contains the proprietary GENIE™ Universal Panelizer pipeline
 *  (Gemini few-shot fill + GENIE composite) — a TRADE SECRET of
 *  RestylePro / LoopMighty Software Development LLC, part of the LiftIQ Engine™
 *  architecture (patent-pending system & methods).
 *
 *  Do NOT copy, publish, distribute, disclose, or reproduce — in
 *  whole or in part — without express written permission. The prompt
 *  text itself must NOT appear in any published patent filing.
 *  See /NOTICE and docs/TRADEMARKS.md. Not legal advice.
 * ═══════════════════════════════════════════════════════════════
 */
/**
 * panelizer-step-fill — GENIE Universal Panelizer (Panel Extraction from 2D Proof)
 *
 * TWO-STAGE PIPELINE (new architecture):
 *   Stage 1 (proof step): 3D renders → flat 2D design proof (done upstream)
 *   Stage 2 (THIS step):  2D proof + GENIE panel sizes → individual flat panel files
 *
 * Per panel:
 *   1. Load the 2D design proof from the proof step
 *   2. Send proof + panel dimensions to Gemini
 *   3. Gemini extracts exact-sized flat rectangle for each panel
 *
 * The 2D proof is already flat, so Gemini's job is much simpler:
 * just crop/extract the correct panel region at the exact print dimensions.
 *
 * FALLBACK: If no proof is available (legacy path), falls back to the
 * original 3D render + GENIE composite approach with few-shot examples.
 *
 * Required: 5 example images in Supabase Storage at wrap-files/genie-examples/
 *   01-panel-diagram.png        — Representative Paneling (vehicle broken into zones)
 *   02-real-installer.png        — Real installer applying vinyl
 *   03-genie-overlay-input.png   — GENIE overlay with cyan boundaries + dimensions
 *   04-production-flow-before-after.png — 3D render → flat panel (before/after)
 *   05-golden-flat-panel-output.png     — Correct flat panel output (golden example)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getGeminiKey,
  hasGeminiKey,
} from "../_shared/gemini-key-pool.ts";
import {
  downloadFromStorage,
  uploadToStorage,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "../_shared/panelizer-os/storage.ts";
import {
  BUCKET,
  tempPath,
  toSupportedRatio,
  PIPELINE_NAME,
  PPI,
  BLEED_INCHES,
} from "../_shared/panelizer-os/constants.ts";

interface PanelZone {
  panelKey: string;
  panelType: string;
  label: string;
  widthInches: number;
  heightInches: number;
  mirrored: boolean;
  cropZone?: string;
}

// ── Panel-to-view mapping (used in legacy 3D fallback only) ──
const PANEL_VIEW_MAP: Record<string, string[]> = {
  'driver-side':     ['side', 'driver-side'],
  'driver-upper':    ['side', 'driver-side'],
  'driver-lower':    ['side', 'driver-side'],
  'passenger-side':  ['passenger-side'],
  'passenger-upper': ['passenger-side'],
  'passenger-lower': ['passenger-side'],
  'hood':            ['hood_detail', 'hood', 'front'],
  'hood-front':      ['front', 'hood_detail', 'hood'],
  'roof':            ['roof'],
  'rear':            ['rear'],
  'rear-trunk':      ['rear'],
  'front-bumper':    ['front'],
  'rear-bumper':     ['rear'],
};

// ── GENIE Coordinate System (legacy fallback) ──
let _genieCoordinates: Record<string, { topPct: number; leftPct: number; widthPct: number; heightPct: number }> | null = null;

function setGenieCoordinates(coords: any) {
  if (coords && typeof coords === 'object') {
    _genieCoordinates = coords;
  }
}

const PANEL_POSITIONS_FALLBACK: Record<string, { topPct: number; leftPct: number; widthPct: number; heightPct: number }> = {
  'driver-side':       { topPct: 18, leftPct: 4,  widthPct: 92, heightPct: 56 },
  'passenger-side':    { topPct: 18, leftPct: 4,  widthPct: 92, heightPct: 56 },
  'driver-upper':      { topPct: 16, leftPct: 4,  widthPct: 92, heightPct: 26 },
  'driver-lower':      { topPct: 46, leftPct: 4,  widthPct: 92, heightPct: 28 },
  'passenger-upper':   { topPct: 16, leftPct: 4,  widthPct: 92, heightPct: 26 },
  'passenger-lower':   { topPct: 46, leftPct: 4,  widthPct: 92, heightPct: 28 },
  'hood':              { topPct: 8,  leftPct: 8,  widthPct: 84, heightPct: 84 },
  'hood-front':        { topPct: 6,  leftPct: 15, widthPct: 70, heightPct: 42 },
  'roof':              { topPct: 0,  leftPct: 20, widthPct: 60, heightPct: 30 },
  'rear':              { topPct: 6,  leftPct: 12, widthPct: 76, heightPct: 48 },
  'rear-trunk':        { topPct: 6,  leftPct: 12, widthPct: 76, heightPct: 48 },
  'front-bumper':      { topPct: 52, leftPct: 10, widthPct: 80, heightPct: 40 },
  'rear-bumper':       { topPct: 58, leftPct: 10, widthPct: 80, heightPct: 34 },
};

function resolveViewUrl(panelKey: string, allViewUrls: Record<string, string> | null): string | null {
  if (!allViewUrls || typeof allViewUrls !== 'object') return null;
  const candidates = PANEL_VIEW_MAP[panelKey] || ['side', 'driver-side'];
  for (const viewKey of candidates) {
    if (allViewUrls[viewKey]) return allViewUrls[viewKey];
  }
  return null;
}

// ── Upscale panel to exact WPW print dimensions via imagescript ──
async function upscaleToTarget(
  imageBytes: Uint8Array,
  targetW: number,
  targetH: number,
  panelKey: string,
): Promise<Uint8Array> {
  try {
    const img = await Image.decode(imageBytes);
    if (img.width >= targetW && img.height >= targetH) {
      console.log(`[FILL] ${panelKey}: already ${img.width}×${img.height} (target ${targetW}×${targetH}) — no upscale needed`);
      return imageBytes;
    }
    const resized = img.resize(targetW, targetH);
    const encoded = await resized.encode();
    console.log(`[FILL] ${panelKey}: upscaled ${img.width}×${img.height} → ${targetW}×${targetH}`);
    return new Uint8Array(encoded);
  } catch (err) {
    console.warn(`[FILL] ${panelKey}: upscale failed (${err}) — using original`);
    return imageBytes;
  }
}

// ── Flip image horizontally for passenger side ──
async function flipHorizontal(imageBytes: Uint8Array): Promise<Uint8Array> {
  const img = await Image.decode(imageBytes);
  // Manual horizontal flip: swap pixels left↔right per row
  const w = img.width;
  const h = img.height;
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= Math.floor(w / 2); x++) {
      const left = img.getPixelAt(x, y);
      const right = img.getPixelAt(w - x + 1, y);
      img.setPixelAt(x, y, right);
      img.setPixelAt(w - x + 1, y, left);
    }
  }
  return new Uint8Array(await img.encode());
}

// ── Calculate target print dimensions (inches + bleed → pixels) ──
function getTargetPrintPx(widthInches: number, heightInches: number): { w: number; h: number } {
  return {
    w: Math.round((widthInches + BLEED_INCHES * 2) * PPI),
    h: Math.round((heightInches + BLEED_INCHES * 2) * PPI),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      renderPath, proofPath, userId, jobId, vehicle, finish,
      panels, all_view_urls, concept_json,
      vehicleMake, vehicleModel,
      completedPanelPaths,
      twoPanel, bodyHeightInches, sideSize,
      aspectRatio,
      panelCoordinates,
      generateMasksOnly,
    } = body;

    const designDescription = concept_json?.designDescription || concept_json?.prompt || concept_json?.design_description || "";
    const designFinish = finish || concept_json?.finish || "gloss";
    const vehicleName = vehicle || `${concept_json?.vehicleYear || ""} ${vehicleMake || ""} ${vehicleModel || ""}`.trim();

    if (!renderPath || !userId || !jobId) {
      return new Response(
        JSON.stringify({ error: "Missing renderPath, userId, or jobId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!generateMasksOnly && !hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "No GOOGLE_AI_API_KEY configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    setGenieCoordinates(panelCoordinates);

    const startMs = Date.now();
    const hasProof = !!proofPath;
    console.log(`[FILL] ═══ ${PIPELINE_NAME} ═══ Job ${jobId}${hasProof ? ' (2D PROOF MODE)' : ' (LEGACY 3D MODE)'}${generateMasksOnly ? ' (masks only)' : ''}`);

    // ═══════════════════════════════════════════════════════════════
    // LOAD PRIMARY INPUT: 2D proof (preferred) or 3D render (fallback)
    // ═══════════════════════════════════════════════════════════════

    let proofBase64: string | null = null;
    let renderBase64: string | null = null;
    let renderImage: any = null;

    if (hasProof) {
      // ── NEW PATH: Load the flat 2D design proof ──
      try {
        const proofBytes = await downloadFromStorage(proofPath);
        proofBase64 = uint8ArrayToBase64(proofBytes);
        console.log(`[FILL] ✓ 2D proof loaded: ${(proofBytes.byteLength / 1024).toFixed(0)} KB`);
      } catch (err) {
        console.warn(`[FILL] Failed to load 2D proof: ${err} — falling back to 3D render`);
      }
    }

    if (!proofBase64) {
      // ── LEGACY PATH: Load 3D render (same as before) ──
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://kfapjdyythzyvnpdeghu.supabase.co";
      const renderTransformUrl = `${SUPABASE_URL}/storage/v1/render/image/public/${BUCKET}/${renderPath}?width=768&resize=contain&quality=80`;
      try {
        const resp = await fetch(renderTransformUrl);
        if (resp.ok) {
          const smallBytes = new Uint8Array(await resp.arrayBuffer());
          renderBase64 = uint8ArrayToBase64(smallBytes);
          console.log(`[FILL] Primary render (768px): ${(smallBytes.byteLength / 1024).toFixed(0)} KB`);
          try {
            renderImage = await Image.decode(smallBytes);
          } catch (decErr) {
            console.warn(`[FILL] Render decode failed: ${decErr}`);
          }
        } else {
          const raw = await downloadFromStorage(renderPath);
          renderBase64 = uint8ArrayToBase64(raw);
        }
      } catch (fetchErr) {
        const raw = await downloadFromStorage(renderPath);
        renderBase64 = uint8ArrayToBase64(raw);
      }
    }

    // Parse per-view render URLs (for legacy fallback)
    const allViewUrls: Record<string, string> | null =
      (all_view_urls && typeof all_view_urls === 'object' && !Array.isArray(all_view_urls) && Object.keys(all_view_urls).length > 0)
        ? all_view_urls as Record<string, string>
        : (concept_json?.render_urls && typeof concept_json.render_urls === 'object')
          ? concept_json.render_urls as Record<string, string>
          : null;

    const panelZones: PanelZone[] = panels || [];
    const hasPassengerRender = !!(allViewUrls && allViewUrls['passenger-side']);
    const uniquePanels = panelZones.filter((p: PanelZone) => {
      if (!p.mirrored) return true;
      if (hasPassengerRender && p.panelKey.includes('passenger')) return true;
      return false;
    });

    // ═══════════════════════════════════════════════════════════════
    // MASKS ONLY MODE (unchanged)
    // ═══════════════════════════════════════════════════════════════

    if (generateMasksOnly) {
      const genieMaskPaths: Record<string, string> = {};
      if (renderImage) {
        for (const panel of panelZones.filter((p: PanelZone) => !p.mirrored)) {
          try {
            const maskBase64 = await buildBlueMaskComposite(renderImage, panel);
            const maskBytes = base64ToUint8Array(maskBase64);
            const compositePath = tempPath(userId, jobId, `genie-panel-composite-${panel.panelKey}`);
            await uploadToStorage(compositePath, maskBytes, "image/png");
            genieMaskPaths[panel.panelKey] = compositePath;
          } catch (maskErr) {
            console.warn(`[FILL] Mask failed for ${panel.panelKey}: ${maskErr}`);
          }
        }
      }
      console.log(`[FILL] ═══ Masks Only Complete: ${Object.keys(genieMaskPaths).length} in ${Date.now() - startMs}ms ═══`);
      return new Response(
        JSON.stringify({ success: true, masksOnly: true, genieMaskPaths, maskCount: Object.keys(genieMaskPaths).length, step: "fill" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // PER-PANEL EXTRACTION
    // ═══════════════════════════════════════════════════════════════

    if (uniquePanels.length > 0) {
      const priorPaths: Record<string, string> = completedPanelPaths || {};
      const panelPaths: Record<string, string | null> = { ...priorPaths };
      let totalAttempts = 0;

      console.log(`[FILL] Per-panel extraction: ${uniquePanels.length} panels (mode: ${proofBase64 ? '2D PROOF' : 'LEGACY 3D'}, resumed: ${Object.keys(priorPaths).length})`);

      // Load few-shot examples (needed for both modes)
      const exampleImages = await loadExampleImages();
      const examplesLoaded = exampleImages.filter(e => e.length > 0).length;

      // Build GENIE composites for legacy mode only
      const genieMaskPaths: Record<string, string> = {};
      if (!proofBase64 && renderImage) {
        const preStampedPaths: Record<string, string> = concept_json?.genie_overlay_paths || {};
        const hasPreStamped = Object.keys(preStampedPaths).length > 0;

        if (hasPreStamped) {
          console.log(`[FILL] Legacy: ${Object.keys(preStampedPaths).length} pre-stamped GENIE overlays`);
          for (const panel of panelZones.filter((p: PanelZone) => !p.mirrored)) {
            const viewCandidates = PANEL_VIEW_MAP[panel.panelKey] || ['side', 'driver-side'];
            let foundPath: string | null = null;
            for (const viewKey of viewCandidates) {
              if (preStampedPaths[viewKey]) { foundPath = preStampedPaths[viewKey]; break; }
            }
            if (foundPath) {
              genieMaskPaths[panel.panelKey] = foundPath;
            } else if (renderImage) {
              try {
                const maskBase64Str = await buildBlueMaskComposite(renderImage, panel);
                const maskBytes = base64ToUint8Array(maskBase64Str);
                const compositePath = tempPath(userId, jobId, `genie-panel-composite-${panel.panelKey}`);
                await uploadToStorage(compositePath, maskBytes, "image/png");
                genieMaskPaths[panel.panelKey] = compositePath;
              } catch (maskErr) {
                console.warn(`[FILL] Composite failed for ${panel.panelKey}: ${maskErr}`);
              }
            }
          }
        } else {
          console.log(`[FILL] Legacy: generating blue mask composites`);
          for (const panel of panelZones.filter((p: PanelZone) => !p.mirrored)) {
            try {
              const maskBase64Str = await buildBlueMaskComposite(renderImage, panel);
              const maskBytes = base64ToUint8Array(maskBase64Str);
              const compositePath = tempPath(userId, jobId, `genie-panel-composite-${panel.panelKey}`);
              await uploadToStorage(compositePath, maskBytes, "image/png");
              genieMaskPaths[panel.panelKey] = compositePath;
            } catch (maskErr) {
              console.warn(`[FILL] Mask composite failed for ${panel.panelKey}: ${maskErr}`);
            }
          }
        }
      }

      // Free render image after composites
      renderImage = null;

      for (const panel of uniquePanels) {
        if (priorPaths[panel.panelKey]) {
          console.log(`[FILL] ${panel.panelKey}: already done (resume)`);
          continue;
        }

        // Wall time guard
        if (Date.now() - startMs > 40_000) {
          console.warn(`[FILL] Wall time guard (40s) — ${uniquePanels.length - Object.keys(panelPaths).length} panels remaining`);
          break;
        }

        const panelStart = Date.now();
        const geminiRatio = getGeminiAspectRatio(panel.widthInches, panel.heightInches);
        const widthPx = Math.round(panel.widthInches * PPI);
        const heightPx = Math.round(panel.heightInches * PPI);

        let extractedBase64: string | null = null;

        if (proofBase64) {
          // ═══ NEW 2D PROOF PATH ═══
          // The proof is already flat — just tell Gemini to extract this panel
          // at the exact dimensions from the flat proof layout.
          console.log(`[FILL] ${panel.panelKey}: extracting from 2D proof (${widthPx}×${heightPx}px)`);

          const proofContents = buildProofExtractionContents(
            panel, proofBase64, widthPx, heightPx, designDescription, designFinish, vehicleName
          );
          extractedBase64 = await callGeminiMultiTurn(proofContents, geminiRatio);

          // Retry with simplified prompt
          if (!extractedBase64) {
            console.warn(`[FILL] ${panel.panelKey}: full proof extraction failed — trying simplified`);
            const simpleContents = buildSimplifiedProofContents(panel, proofBase64, widthPx, heightPx);
            extractedBase64 = await callGeminiMultiTurn(simpleContents, geminiRatio);
          }
        } else {
          // ═══ LEGACY 3D PATH (fallback) ═══
          let geminiImageBase64 = renderBase64!;
          const panelViewUrl = resolveViewUrl(panel.panelKey, allViewUrls);
          if (panelViewUrl && panel.panelKey !== 'driver-side') {
            try {
              const viewResp = await fetch(panelViewUrl, {
                headers: { "User-Agent": "Deno/1.0" },
                signal: AbortSignal.timeout(8000),
              });
              if (viewResp.ok) {
                const viewBytes = new Uint8Array(await viewResp.arrayBuffer());
                geminiImageBase64 = uint8ArrayToBase64(viewBytes);
              }
            } catch (viewErr) {
              console.warn(`[FILL] ${panel.panelKey}: per-view fetch error: ${viewErr}`);
            }
          }

          // Override with GENIE composite if available
          if (genieMaskPaths[panel.panelKey]) {
            try {
              const compositeBytes = await downloadFromStorage(genieMaskPaths[panel.panelKey]);
              geminiImageBase64 = uint8ArrayToBase64(compositeBytes);
            } catch (dlErr) {
              console.warn(`[FILL] ${panel.panelKey}: GENIE composite load failed`);
            }
          }

          console.log(`[FILL] ${panel.panelKey}: legacy 3D extraction (${examplesLoaded}/5 examples)`);
          const contents = buildFewShotContents(exampleImages, panel, geminiImageBase64, widthPx, heightPx, designDescription, designFinish, vehicleName);
          extractedBase64 = await callGeminiMultiTurn(contents, geminiRatio);

          if (!extractedBase64) {
            console.warn(`[FILL] ${panel.panelKey}: full prompt failed — trying simplified`);
            const simpleContents = buildSimplifiedContents(panel, geminiImageBase64, widthPx, heightPx, designDescription);
            extractedBase64 = await callGeminiMultiTurn(simpleContents, geminiRatio);
          }
        }

        totalAttempts++;

        if (extractedBase64) {
          let extractedBytes = base64ToUint8Array(extractedBase64);
          const dims = getPngDimensions(extractedBytes);
          if (dims) {
            console.log(`[FILL] ${panel.panelKey} extracted: ${dims.width}x${dims.height}px`);
          }

          if (extractedBytes.byteLength < 50_000) {
            console.error(`[FILL] HARD FAIL: ${panel.panelKey} extraction too small (${extractedBytes.byteLength}B)`);
            panelPaths[panel.panelKey] = null;
          } else {
            // Upscale to exact WPW print dimensions
            const target = getTargetPrintPx(panel.widthInches, panel.heightInches);
            extractedBytes = await upscaleToTarget(extractedBytes, target.w, target.h, panel.panelKey);

            // File naming: panels/{panel_name}_{width}x{height}.png
            const panelFileName = panel.panelKey.replace(/\s+/g, '-');
            const panelPath = tempPath(userId, jobId, `panels/${panelFileName}_${target.w}x${target.h}`);
            await uploadToStorage(panelPath, extractedBytes, "image/png");
            panelPaths[panel.panelKey] = panelPath;
            console.log(`[FILL] ✓ ${panel.panelKey}: ${(extractedBytes.byteLength / 1024).toFixed(0)} KB @ ${target.w}×${target.h}px (${Date.now() - panelStart}ms)`);
          }
        } else {
          console.error(`[FILL] HARD FAIL: ${panel.panelKey} Gemini extraction returned null`);
          panelPaths[panel.panelKey] = null;
        }
      }

      const completedCount = Object.keys(panelPaths).length;
      const resumedCount = Object.keys(priorPaths).length;

      // ── HARD FAIL CHECK ──
      const failedPanels = Object.entries(panelPaths).filter(([_, v]) => v === null);
      if (failedPanels.length > 0) {
        const failedKeys = failedPanels.map(([k]) => k).join(', ');
        console.error(`[FILL] ═══ PIPELINE HARD FAIL: ${failedPanels.length} panel(s) failed: ${failedKeys} ═══`);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Gemini extraction failed for panel(s) [${failedKeys}]`,
            failedPanels: failedKeys,
            step: "fill",
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // All unique panels done → mirror passenger from driver (actual pixel flip)
      if (completedCount === uniquePanels.length) {
        for (const panel of panelZones) {
          if (panel.mirrored && !panelPaths[panel.panelKey]) {
            const sourceKey = panel.panelKey.replace("passenger", "driver");
            if (panelPaths[sourceKey]) {
              try {
                const sourceBytes = await downloadFromStorage(panelPaths[sourceKey]);
                const flippedBytes = await flipHorizontal(sourceBytes);
                const target = getTargetPrintPx(panel.widthInches, panel.heightInches);
                const panelFileName = panel.panelKey.replace(/\s+/g, '-');
                const mirrorPath = tempPath(userId, jobId, `panels/${panelFileName}_${target.w}x${target.h}`);
                await uploadToStorage(mirrorPath, flippedBytes, "image/png");
                panelPaths[panel.panelKey] = mirrorPath;
                console.log(`[FILL] ✓ ${panel.panelKey}: mirrored from ${sourceKey} (${(flippedBytes.byteLength / 1024).toFixed(0)} KB)`);
              } catch (flipErr) {
                console.warn(`[FILL] ${panel.panelKey}: flip failed (${flipErr}) — using driver path`);
                panelPaths[panel.panelKey] = panelPaths[sourceKey];
              }
            }
          }
        }

        // Save master texture reference
        const masterPath = tempPath(userId, jobId, "step-4-master-texture");
        const firstKey = Object.keys(panelPaths).find(k => k.includes("driver-side") && !k.includes("passenger"))
          || Object.keys(panelPaths)[0];
        if (firstKey) {
          const firstBytes = await downloadFromStorage(panelPaths[firstKey]);
          await uploadToStorage(masterPath, firstBytes, "image/png");
        }

        console.log(`[FILL] ═══ Complete: ${completedCount} panels in ${Date.now() - startMs}ms (mode: ${proofBase64 ? '2D PROOF' : 'LEGACY 3D'}) ═══`);

        return new Response(
          JSON.stringify({
            success: true,
            perPanel: true,
            panelPaths,
            genieMaskPaths,
            storagePath: masterPath,
            sizeBytes: 0,
            geminiAttempts: totalAttempts,
            twoPanel: !!twoPanel,
            bodyHeightInches: bodyHeightInches || null,
            proofMode: !!proofBase64,
            step: "fill",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Partial result for re-invoke
      if (completedCount > resumedCount) {
        console.log(`[FILL] ═══ Partial: ${completedCount}/${uniquePanels.length} panels in ${Date.now() - startMs}ms ═══`);
        return new Response(
          JSON.stringify({
            success: true,
            partial: true,
            perPanel: true,
            panelPaths,
            genieMaskPaths,
            panelsCompleted: completedCount,
            panelsTotal: uniquePanels.length,
            geminiAttempts: totalAttempts,
            twoPanel: !!twoPanel,
            bodyHeightInches: bodyHeightInches || null,
            step: "fill",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      console.error(`[FILL] Per-panel incomplete (0 new panels) — HARD FAIL`);
    }

    console.error(`[FILL] ═══ HARD FAIL: No flat panels generated. ═══`);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Gemini failed to generate flat panel artwork.",
        perPanel: false,
        geminiAttempts: 0,
        step: "fill",
      }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[FILL] Error:", err);
    return new Response(
      JSON.stringify({ error: `Fill step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ═══════════════════════════════════════════════════════════════════
// GEMINI CALL — gemini-3-pro-image-preview, 3 retries
// ═══════════════════════════════════════════════════════════════════

const FILL_MODEL = "gemini-3-pro-image-preview";

async function callGeminiMultiTurn(
  contents: any[],
  geminiRatio: string | null,
): Promise<string | null> {
  const imageConfig: any = { imageSize: "4K" };
  if (geminiRatio) imageConfig.aspectRatio = geminiRatio;

  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const currentKey = getGeminiKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);

    try {
      console.log(`[FILL] ${FILL_MODEL} attempt ${attempt}/${MAX_ATTEMPTS} (${contents.length} turns)`);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${FILL_MODEL}:generateContent?key=${currentKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: "You are a production file generator at WePrintWraps.com. You create flat rectangular panel artwork for vehicle wrap printing. Your output is ALWAYS a flat rectangle filled edge-to-edge with artwork — like vinyl laid flat on a table before installation. NEVER output a photo of a vehicle, NEVER output a 3D render or mockup, NEVER include wheels/windows/background. Output ONLY flat rectangular artwork panels ready for print." }],
            },
            contents,
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig,
            },
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timer);

      if (response.status === 429) {
        console.warn(`[FILL] 429 rate-limited (attempt ${attempt})`);
        if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1))); continue; }
        return null;
      }

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[FILL] ${FILL_MODEL} ${response.status}: ${errText.slice(0, 200)}`);
        if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1))); continue; }
        return null;
      }

      const result = await response.json();
      const imageData = extractImage(result);
      if (imageData) {
        console.log(`[FILL] Image received (attempt ${attempt})`);
        return imageData;
      }

      console.warn(`[FILL] No image in response (attempt ${attempt})`);
      if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 2000)); }
    } catch (err: any) {
      clearTimeout(timer);
      console.warn(`[FILL] ${err?.name === "AbortError" ? "Timeout" : "Error"} (attempt ${attempt}):`, err);
      if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1))); }
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// 2D PROOF EXTRACTION PROMPTS (NEW — primary path)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build prompt for extracting a single panel from the 2D design proof.
 * The proof is already flat — Gemini just needs to find the panel zone
 * and output it at exact print dimensions.
 */
function buildProofExtractionContents(
  panel: PanelZone,
  proofBase64: string,
  widthPx: number,
  heightPx: number,
  designDescription: string,
  finish: string,
  vehicle: string,
): any[] {
  const parts: any[] = [];

  parts.push({ text: `You have a flat 2D design proof of a vehicle wrap for a ${vehicle}. The proof shows all panels laid flat — like vinyl sheets on a table.\n\nDESIGN: ${designDescription}\nFINISH: ${finish}\n\nHere is the 2D design proof:` });
  parts.push({ inlineData: { mimeType: "image/png", data: proofBase64 } });
  const ratio = (panel.widthInches / panel.heightInches).toFixed(1);
  parts.push({ text: `Extract the ${panel.label} panel from this proof.\n\nOutput a single flat rectangle exactly ${widthPx}px wide × ${heightPx}px tall (${panel.widthInches}" × ${panel.heightInches}" at ${PPI} PPI). Aspect ratio is ${ratio}:1.\n\nOutput the LARGEST possible image. Minimum 1500 pixels on the shortest edge.\n\nThe rectangle must be filled completely edge-to-edge with the design artwork for the ${panel.label} zone. Match every color, pattern, gradient, and graphic element exactly as shown in the proof. Extend the design 0.5" past all edges for print bleed.\n\nOutput ONLY the flat rectangular panel — no labels, no borders, no background, no vehicle body.` });

  return [{ role: "user", parts }];
}

/**
 * Simplified fallback — shorter prompt for when full extraction fails.
 */
function buildSimplifiedProofContents(
  panel: PanelZone,
  proofBase64: string,
  widthPx: number,
  heightPx: number,
): any[] {
  const parts: any[] = [];
  parts.push({ inlineData: { mimeType: "image/png", data: proofBase64 } });
  parts.push({ text: `Extract the ${panel.label} panel from this flat design proof. Output a ${widthPx}×${heightPx}px rectangle filled edge-to-edge with the panel artwork. No labels, no borders, no vehicle body.` });
  return [{ role: "user", parts }];
}

// ═══════════════════════════════════════════════════════════════════
// LEGACY 3D RENDER PROMPTS (fallback when no proof available)
// ═══════════════════════════════════════════════════════════════════

// Fill step examples: before/after pairs showing 3D wrap → flat panel extraction
// These teach Gemini exactly what correct flat panel output looks like
const GENIE_EXAMPLE_PATHS = [
  "genie-examples/01-panel-diagram.png",              // Vehicle broken into panel zones
  "genie-examples/07-3d-to-flat-dragon-livery.jpg",    // 3D dragon wrap → flat panel
  "genie-examples/08-3d-to-flat-shark-mouth.jpg",      // 3D shark wrap → flat panel
  "genie-examples/10-3d-to-flat-orange-van.jpg",       // 3D orange van → flat panel
  "genie-examples/11-3d-to-flat-captain-america.jpg",  // 3D captain america → flat panel
  "genie-examples/13-golden-flat-panel-sipco.jpg",     // Pure flat artwork (golden output)
  "genie-examples/14-3d-to-flat-cybertruck-sunset.jpg", // 3D Cybertruck sunset-stripe → flat side panel
  "genie-examples/summit-flat-panels-example.png",     // Customer gold-standard flat panels (driver + mirrored passenger)
];

let _exampleImagesCache: string[] | null = null;

async function loadExampleImages(): Promise<string[]> {
  if (_exampleImagesCache) return _exampleImagesCache;

  console.log(`[FILL] Loading ${GENIE_EXAMPLE_PATHS.length} few-shot examples...`);
  const images: string[] = [];
  for (const path of GENIE_EXAMPLE_PATHS) {
    try {
      const bytes = await downloadFromStorage(path);
      images.push(uint8ArrayToBase64(bytes));
      console.log(`[FILL] ✓ Example: ${path} (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.warn(`[FILL] ⚠ Missing example: ${path}`);
      images.push("");
    }
  }
  _exampleImagesCache = images;
  return images;
}

function buildFewShotContents(
  examples: string[],
  panel: PanelZone,
  geminiImageBase64: string,
  widthPx: number,
  heightPx: number,
  designDescription: string,
  finish: string,
  vehicle: string,
): any[] {
  const parts: any[] = [];

  parts.push({ text: "TRAINING CONTEXT — Study these before/after examples carefully.\n\nImage 1: REPRESENTATIVE PANELING — Shows how a vehicle is broken into production panels (Side, Hood, Roof, Rear, Bumpers). Each zone becomes one separate FLAT print file." });
  if (examples[0]) parts.push({ inlineData: { mimeType: "image/png", data: examples[0] } });

  parts.push({ text: "Image 2: BEFORE/AFTER — 3D dragon livery wrap (top) and the flat panel artwork extracted from it (bottom). The flat panel fills a rectangle edge-to-edge with no vehicle body visible. THIS is the transformation you must perform." });
  if (examples[1]) parts.push({ inlineData: { mimeType: "image/png", data: examples[1] } });

  parts.push({ text: "Image 3: BEFORE/AFTER — 3D shark mouth wrap (top) and flat panel (bottom). Notice the design is unwrapped and laid completely flat, maintaining all colors and graphic elements." });
  if (examples[2]) parts.push({ inlineData: { mimeType: "image/png", data: examples[2] } });

  parts.push({ text: "Image 4: BEFORE/AFTER — 3D orange commercial van wrap (top) and flat panel (bottom). The flat panel shows the design as printed vinyl on a table before installation." });
  if (examples[3]) parts.push({ inlineData: { mimeType: "image/png", data: examples[3] } });

  parts.push({ text: "Image 5: BEFORE/AFTER — 3D Captain America wrap (top) and flat panel (bottom). Every color, pattern, and graphic element is preserved in the flat extraction." });
  if (examples[4]) parts.push({ inlineData: { mimeType: "image/png", data: examples[4] } });

  parts.push({ text: "Image 6: GOLDEN OUTPUT — THIS is a perfect flat panel. Edge-to-edge artwork filling the entire rectangle. No vehicle body, no 3D perspective, no wheels, no background. Just the design artwork ready for print." });
  if (examples[5]) parts.push({ inlineData: { mimeType: "image/png", data: examples[5] } });

  parts.push({ text: "Image 7: BEFORE/AFTER — 3D Tesla Cybertruck with a retro sunset-stripe wrap (top) and the flat side panel extracted from it (bottom). The angular body and wheel arches are flattened away; every stripe color and the step in the beltline are preserved, filling the rectangle edge-to-edge." });
  if (examples[6]) parts.push({ inlineData: { mimeType: "image/jpeg", data: examples[6] } });

  parts.push({ text: "Image 8: GOLDEN OUTPUT (customer reference standard) — finished driver-side and passenger-side flat panels. Each is a clean, edge-to-edge flat rectangle with no vehicle body, no 3D, no wheels, no background; the passenger side is a mirror of the driver. Match THIS flatness, fill, and finish quality." });
  if (examples[7]) parts.push({ inlineData: { mimeType: "image/png", data: examples[7] } });

  const designCtx = designDescription ? `\nDESIGN: ${designDescription}` : '';
  const finishCtx = finish ? `\nFINISH: ${finish}` : '';
  const vehicleCtx = vehicle ? `\nVEHICLE: ${vehicle}` : '';

  const ratio = (panel.widthInches / panel.heightInches).toFixed(1);
  parts.push({ text: `\n═══ NOW PROCESS THIS JOB ═══\n\nYou are a File Output Specialist for WePrintWraps.com. Your production files are printed on cast vinyl and installed on real vehicles by professional wrap installers.${designCtx}${finishCtx}${vehicleCtx}\n\nStep 1: Review this GENIE Universal Panelizer render. The glassmorphism panel overlay shows the exact dimensions, scale, and boundary for the ${panel.label} panel — ${panel.widthInches}" wide × ${panel.heightInches}" tall at ${PPI} PPI. Aspect ratio: ${ratio}:1.` });
  parts.push({ inlineData: { mimeType: "image/png", data: geminiImageBase64 } });
  parts.push({ text: `Step 2: Generate a flat rectangular production file (${widthPx}px wide × ${heightPx}px tall). The artwork from the vehicle must be laid completely flat — like printed vinyl on a table before installation. No vehicle body, no 3D perspective, no wheels, no windows, no studio background. Fill the rectangle completely edge to edge with the design. Match every color, pattern, gradient, and graphic element exactly as shown on the vehicle.\n\nStep 3: Output the LARGEST possible image. Minimum 1500 pixels on the shortest edge. Extend the design seamlessly past all four edges by 0.5 inches for print bleed. This is a production print file — edge to edge, no gaps, no borders, no empty space.` });

  return [{ role: "user", parts }];
}

function buildSimplifiedContents(
  panel: PanelZone,
  geminiImageBase64: string,
  widthPx: number,
  heightPx: number,
  designDescription: string,
): any[] {
  const parts: any[] = [];
  parts.push({ inlineData: { mimeType: "image/png", data: geminiImageBase64 } });
  parts.push({ text: `Generate a flat ${widthPx}×${heightPx}px rectangular production panel for the ${panel.label} zone of this vehicle wrap. Take the design artwork from the vehicle and lay it completely flat — like vinyl on a table before installation. Edge to edge, no vehicle body, no 3D perspective, no background.${designDescription ? ' Design: ' + designDescription : ''}` });
  return [{ role: "user", parts }];
}

// ═══════════════════════════════════════════════════════════════════
// Blue Mask Composite Generator (legacy fallback)
// ═══════════════════════════════════════════════════════════════════

async function buildBlueMaskComposite(renderImage: any, panel: PanelZone): Promise<string> {
  const composite = renderImage.clone();
  const w = composite.width;
  const h = composite.height;

  const pos = _genieCoordinates?.[panel.panelKey]
    || PANEL_POSITIONS_FALLBACK[panel.panelKey]
    || PANEL_POSITIONS_FALLBACK['driver-side'];

  const x = Math.round(w * pos.leftPct / 100);
  const y = Math.round(h * pos.topPct / 100);
  const rw = Math.round(w * pos.widthPct / 100);
  const rh = Math.round(h * pos.heightPct / 100);

  const CYAN = 0x00E5FFFF;
  const THICKNESS = 3;
  for (let t = 0; t < THICKNESS; t++) {
    for (let px = Math.max(0, x - t); px < Math.min(w, x + rw + t); px++) {
      const py = Math.max(0, y - t);
      if (py < h) composite.setPixelAt(px + 1, py + 1, CYAN);
    }
    for (let px = Math.max(0, x - t); px < Math.min(w, x + rw + t); px++) {
      const py = Math.min(h - 1, y + rh + t);
      if (py >= 0) composite.setPixelAt(px + 1, py + 1, CYAN);
    }
    for (let py = Math.max(0, y - t); py < Math.min(h, y + rh + t); py++) {
      const px = Math.max(0, x - t);
      if (px < w) composite.setPixelAt(px + 1, py + 1, CYAN);
    }
    for (let py = Math.max(0, y - t); py < Math.min(h, y + rh + t); py++) {
      const px = Math.min(w - 1, x + rw + t);
      if (px >= 0) composite.setPixelAt(px + 1, py + 1, CYAN);
    }
  }

  const encoded = await composite.encode();
  return uint8ArrayToBase64(new Uint8Array(encoded));
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function extractImage(result: any): string | null {
  try {
    const candidates = result?.candidates;
    if (!candidates?.length) return null;
    const parts = candidates[0]?.content?.parts;
    if (!parts?.length) return null;
    for (const part of parts) {
      if (part?.inlineData?.data) return part.inlineData.data;
    }
  } catch { /* ignore */ }
  return null;
}

function getGeminiAspectRatio(widthInches: number, heightInches: number): string | null {
  const rawW = Math.round(widthInches * 2);
  const rawH = Math.round(heightInches * 2);
  const realRatio = rawW / rawH;
  const best = toSupportedRatio(`${rawW}:${rawH}`);
  const [bw, bh] = best.split(":").map(Number);
  const bestRatio = bw / bh;
  const diff = Math.abs(realRatio - bestRatio) / realRatio;
  if (diff > 0.15) {
    console.warn(`[FILL] Aspect ratio ${rawW}:${rawH} → ${best} differs by ${(diff * 100).toFixed(1)}% — skipping constraint`);
    return null;
  }
  return best;
}

function getPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  try {
    if (bytes.length < 24) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = dv.getUint32(16, false);
    const height = dv.getUint32(20, false);
    if (width > 0 && width < 100000 && height > 0 && height < 100000) {
      return { width, height };
    }
  } catch { /* ignore */ }
  return null;
}
