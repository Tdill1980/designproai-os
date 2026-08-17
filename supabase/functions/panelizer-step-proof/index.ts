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
 * panelizer-step-proof — 2D Design Proof Generator
 *
 * Takes ALL 3D vehicle renders (side, hood, rear, roof, front, passenger)
 * plus panel dimensions and design context, and asks Gemini to create
 * a flat 2D design proof — every panel unwrapped and laid flat like
 * vinyl on a table before installation.
 *
 * This intermediate proof makes downstream panel extraction (fill step)
 * dramatically more reliable because the AI has already done the hard
 * 3D→2D unwrap. The fill step then just crops panels from the flat proof.
 *
 * Inputs (from orchestrator):
 *   - renderPath (primary side render from fetch step)
 *   - all_view_urls { side, hood_detail, rear, roof, front, passenger-side }
 *   - panels[] from validate step (panelKey, label, widthInches, heightInches)
 *   - concept_json (designDescription, finish, vehicle info)
 *   - userId, jobId
 *
 * Output:
 *   - proofStoragePath: storage path to the flat 2D proof image
 *   - success: true
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
  fetchImageBytes,
} from "../_shared/panelizer-os/storage.ts";
import {
  BUCKET,
  tempPath,
  PIPELINE_NAME,
} from "../_shared/panelizer-os/constants.ts";

const PROOF_MODEL = "gemini-3-pro-image-preview";

// View angles to include in the proof — order matters for Gemini context
const VIEW_PRIORITY = ['side', 'driver-side', 'hood_detail', 'hood', 'rear', 'roof', 'front', 'passenger-side'];

// Few-shot example paths for the PROOF step
// These teach Gemini the target proof format and what flat panels look like
const PROOF_EXAMPLE_PATHS = [
  "genie-examples/01-panel-diagram.png",              // Vehicle broken into panel zones
  "genie-examples/06-proof-format-termio.png",         // WPW proof sheet: all views on one page (Termio)
  "genie-examples/07-3d-to-flat-dragon-livery.jpg",    // 3D dragon wrap → flat panel (before/after)
  "genie-examples/08-3d-to-flat-shark-mouth.jpg",      // 3D shark wrap → flat panel (before/after)
  "genie-examples/09-3d-to-flat-green-sprinter.jpg",   // 3D green van → flat panel (before/after)
];

let _exampleImagesCache: string[] | null = null;

async function loadExampleImages(): Promise<string[]> {
  if (_exampleImagesCache) return _exampleImagesCache;

  console.log(`[PROOF] Loading ${PROOF_EXAMPLE_PATHS.length} few-shot examples...`);
  const images: string[] = [];
  for (const path of PROOF_EXAMPLE_PATHS) {
    try {
      const bytes = await downloadFromStorage(path);
      images.push(uint8ArrayToBase64(bytes));
      console.log(`[PROOF] ✓ Example: ${path} (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.warn(`[PROOF] ⚠ Missing example: ${path}`);
      images.push("");
    }
  }
  _exampleImagesCache = images;
  return images;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      renderPath, userId, jobId, vehicle, finish,
      panels, all_view_urls, concept_json,
      vehicleMake, vehicleModel,
    } = body;

    if (!renderPath || !userId || !jobId) {
      return new Response(
        JSON.stringify({ error: "Missing renderPath, userId, or jobId" }),
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
    console.log(`[PROOF] ═══ ${PIPELINE_NAME} — 2D Design Proof ═══ Job ${jobId}`);

    // ── Extract design context ──
    const designDescription = concept_json?.designDescription || concept_json?.prompt || concept_json?.design_description || "";
    const designFinish = finish || concept_json?.finish || "gloss";
    const vehicleName = vehicle || `${concept_json?.vehicleYear || ""} ${vehicleMake || ""} ${vehicleModel || ""}`.trim();

    // ── Collect ALL available 3D renders (768px transforms for memory safety) ──
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://kfapjdyythzyvnpdeghu.supabase.co";
    const allViewUrls: Record<string, string> =
      (all_view_urls && typeof all_view_urls === 'object' && !Array.isArray(all_view_urls))
        ? all_view_urls as Record<string, string>
        : (concept_json?.render_urls && typeof concept_json.render_urls === 'object')
          ? concept_json.render_urls as Record<string, string>
          : {};

    // Download each view render as base64 (768px wide for memory safety)
    const viewImages: { viewKey: string; base64: string }[] = [];

    // Always include primary render (side view)
    try {
      const transformUrl = `${SUPABASE_URL}/storage/v1/render/image/public/${BUCKET}/${renderPath}?width=768&resize=contain&quality=80`;
      const resp = await fetch(transformUrl);
      if (resp.ok) {
        const bytes = new Uint8Array(await resp.arrayBuffer());
        viewImages.push({ viewKey: 'side', base64: uint8ArrayToBase64(bytes) });
        console.log(`[PROOF] ✓ Primary render (side): ${(bytes.byteLength / 1024).toFixed(0)} KB`);
      } else {
        // Fallback: raw download
        const raw = await downloadFromStorage(renderPath);
        viewImages.push({ viewKey: 'side', base64: uint8ArrayToBase64(raw) });
        console.log(`[PROOF] ✓ Primary render (side, raw): ${(raw.byteLength / 1024).toFixed(0)} KB`);
      }
    } catch (err) {
      console.error(`[PROOF] Failed to load primary render: ${err}`);
      return new Response(
        JSON.stringify({ error: `Failed to load primary render: ${err}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load additional view angles
    const loadedViews = new Set(['side', 'driver-side']); // side already loaded
    for (const viewKey of VIEW_PRIORITY) {
      if (loadedViews.has(viewKey)) continue;
      const url = allViewUrls[viewKey];
      if (!url) continue;

      try {
        const resp = await fetch(url, {
          headers: { "User-Agent": "Deno/1.0" },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          const bytes = new Uint8Array(await resp.arrayBuffer());
          // Skip if too large (>2MB) to avoid OOM — 150MB edge function limit
          if (bytes.byteLength > 2_000_000) {
            console.warn(`[PROOF] ${viewKey}: ${(bytes.byteLength / 1024).toFixed(0)} KB too large — skipping`);
            continue;
          }
          viewImages.push({ viewKey, base64: uint8ArrayToBase64(bytes) });
          loadedViews.add(viewKey);
          console.log(`[PROOF] ✓ View ${viewKey}: ${(bytes.byteLength / 1024).toFixed(0)} KB`);
        }
      } catch (err) {
        console.warn(`[PROOF] ${viewKey}: fetch failed — skipping: ${err}`);
      }

      // Memory guard: max 5 views (side + 4 more)
      if (viewImages.length >= 5) {
        console.log(`[PROOF] Memory guard: limiting to ${viewImages.length} views`);
        break;
      }
    }

    console.log(`[PROOF] Loaded ${viewImages.length} view renders: ${viewImages.map(v => v.viewKey).join(', ')}`);

    // ── Load few-shot examples ──
    const exampleImages = await loadExampleImages();
    const examplesLoaded = exampleImages.filter(e => e.length > 0).length;
    console.log(`[PROOF] ${examplesLoaded}/5 few-shot examples loaded`);

    // ── Build panel dimension table for the prompt ──
    const panelZones = panels || [];
    const panelTable = panelZones
      .filter((p: any) => !p.mirrored)
      .map((p: any) => `  • ${p.label || p.panelKey}: ${p.widthInches}" × ${p.heightInches}" (+0.5" bleed all sides)`)
      .join('\n');

    // ── Build Gemini prompt ──
    const contents = buildProofContents(
      exampleImages,
      viewImages,
      panelTable,
      designDescription,
      designFinish,
      vehicleName,
      panelZones,
    );

    // ── Call Gemini ──
    console.log(`[PROOF] Calling ${PROOF_MODEL} for 2D design proof...`);
    const proofBase64 = await callGemini(contents);

    if (!proofBase64) {
      console.error(`[PROOF] ═══ FAILED: Gemini returned no proof image ═══`);
      return new Response(
        JSON.stringify({ success: false, error: "Gemini failed to generate 2D design proof", step: "proof" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Store the proof ──
    const proofBytes = base64ToUint8Array(proofBase64);
    const proofPath = tempPath(userId, jobId, "step-proof-2d-layout");
    await uploadToStorage(proofPath, proofBytes, "image/png");

    console.log(`[PROOF] ═══ Complete: 2D proof generated (${(proofBytes.byteLength / 1024).toFixed(0)} KB) in ${Date.now() - startMs}ms ═══`);

    return new Response(
      JSON.stringify({
        success: true,
        proofStoragePath: proofPath,
        proofSizeBytes: proofBytes.byteLength,
        viewsUsed: viewImages.map(v => v.viewKey),
        examplesLoaded,
        step: "proof",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[PROOF] Error:", err);
    return new Response(
      JSON.stringify({ error: `Proof step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ═══════════════════════════════════════════════════════════════════
// PROMPT BUILDER — 2D Design Proof from 3D Renders
// ═══════════════════════════════════════════════════════════════════

function buildProofContents(
  examples: string[],
  viewImages: { viewKey: string; base64: string }[],
  panelTable: string,
  designDescription: string,
  finish: string,
  vehicle: string,
  panels: any[],
): any[] {
  const parts: any[] = [];

  // ── Few-shot training context ──
  parts.push({ text: "TRAINING CONTEXT — Study these reference images carefully.\n\nImage 1: REPRESENTATIVE PANELING — Shows how a vehicle is broken into production panels (Side, Hood, Roof, Rear, Bumpers)." });
  if (examples[0]) parts.push({ inlineData: { mimeType: "image/png", data: examples[0] } });

  parts.push({ text: "Image 2: WPW PROOF SHEET FORMAT — THIS is the exact format you must produce. A professional wrap shop proof with ALL vehicle views arranged on a single page: top-down view, driver side, passenger side, front, rear. Each panel zone labeled with dimensions. This is the gold standard." });
  if (examples[1]) parts.push({ inlineData: { mimeType: "image/png", data: examples[1] } });

  parts.push({ text: "Image 3: BEFORE/AFTER — 3D vehicle wrap (top) and the flat panel artwork extracted from it (bottom). This shows the transformation from 3D render to flat production panel." });
  if (examples[2]) parts.push({ inlineData: { mimeType: "image/png", data: examples[2] } });

  parts.push({ text: "Image 4: BEFORE/AFTER — Another 3D wrap (top) with flat panel extraction (bottom). Notice how the design is laid completely flat with no vehicle body visible." });
  if (examples[3]) parts.push({ inlineData: { mimeType: "image/png", data: examples[3] } });

  parts.push({ text: "Image 5: BEFORE/AFTER — Van wrap (top) with flat panel extraction (bottom). The flat panel fills the entire rectangle edge-to-edge." });
  if (examples[4]) parts.push({ inlineData: { mimeType: "image/png", data: examples[4] } });

  // ── Calculate total SQFT ──
  const uniquePanels = panels.filter((p: any) => !p.mirrored);
  const totalSqFt = panels.reduce((sum: number, p: any) => {
    return sum + ((p.widthInches || 0) * (p.heightInches || 0) / 144);
  }, 0);

  // ── The actual 3D renders from this job ──
  parts.push({ text: `\n═══ CREATE A WPW-STYLE 2D DESIGN PROOF FROM THESE 3D RENDERS ═══\n\nYou are creating an ARTWORK AND PROOF APPROVAL sheet for WePrintWraps.com — exactly like a professional wrap shop proof.\n\nVEHICLE: ${vehicle}\nDESIGN: ${designDescription}\nFINISH: ${finish}\nTOTAL PRINT: ${totalSqFt.toFixed(0)} SQFT\n\nPANEL DIMENSIONS:\n${panelTable}\n\nHere are the 3D renders from each angle:` });

  // Send each view render with its label
  for (const view of viewImages) {
    const viewLabel = VIEW_LABELS[view.viewKey] || view.viewKey;
    parts.push({ text: `${viewLabel} view:` });
    parts.push({ inlineData: { mimeType: "image/png", data: view.base64 } });
  }

  // ── The proof generation instruction ──
  const panelList = uniquePanels.map((p: any) => {
    const sqft = ((p.widthInches || 0) * (p.heightInches || 0) / 144).toFixed(1);
    return `${p.label || p.panelKey}: ${p.widthInches}" × ${p.heightInches}" | ${sqft} SQFT`;
  }).join('\n  ');

  parts.push({ text: `CREATE THE 2D DESIGN PROOF SHEET:\n\nLayout the proof exactly like a WePrintWraps.com proof sheet:\n\n1. TOP-DOWN VIEW (roof/hood) — show the vehicle from directly above with the wrap design, labeled with hood dimensions and SQFT\n2. DRIVER SIDE — full side profile showing the wrap design with panel dimension callouts (Door Panel SQFT, Quarter Panel SQFT)\n3. PASSENGER SIDE — full side profile (mirrored), same dimension callouts\n4. REAR VIEW — rear of vehicle showing wrap on rear panels\n5. FRONT VIEW — front showing hood/bumper wrap coverage\n\nFor each view, show the design artwork laid FLAT on the vehicle silhouette — like a technical illustration, NOT a 3D photorealistic render. Remove all studio lighting, reflections, and 3D depth. Make it look like a flat 2D technical proof drawing with the design pattern applied.\n\nLabel each panel zone with its dimensions and SQFT:\n  ${panelList}\n\nArrange all views on a single proof sheet. This proof will be used to extract individual flat panel rectangles for print production.\n\nOutput ONE image — the complete 2D design proof sheet.` });

  return [{ role: "user", parts }];
}

const VIEW_LABELS: Record<string, string> = {
  'side': 'Driver side',
  'driver-side': 'Driver side',
  'passenger-side': 'Passenger side',
  'hood_detail': 'Hood (top-down)',
  'hood': 'Hood',
  'rear': 'Rear',
  'roof': 'Roof (top-down)',
  'front': 'Front',
};

// ═══════════════════════════════════════════════════════════════════
// GEMINI API CALL — 3 retries with exponential backoff
// ═══════════════════════════════════════════════════════════════════

async function callGemini(contents: any[]): Promise<string | null> {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const apiKey = getGeminiKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);

    try {
      console.log(`[PROOF] ${PROOF_MODEL} attempt ${attempt}/${MAX_ATTEMPTS}`);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${PROOF_MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: "You are a Production Proof Specialist at WePrintWraps.com. You create professional 2D design proof sheets from 3D vehicle wrap renders. Your proof shows the vehicle from multiple angles (top-down, driver side, passenger side, rear, front) with the wrap design rendered as a flat 2D technical illustration — NOT a photorealistic 3D render. Each panel zone is labeled with its dimensions and square footage. The proof looks like a professional wrap shop artwork approval sheet used by print operators and installers." }],
            },
            contents,
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: {
                imageSize: "4K",
              },
            },
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timer);

      if (response.status === 429) {
        console.warn(`[PROOF] 429 rate-limited (attempt ${attempt})`);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
          continue;
        }
        return null;
      }

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[PROOF] ${PROOF_MODEL} ${response.status}: ${errText.slice(0, 300)}`);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
          continue;
        }
        return null;
      }

      const result = await response.json();
      const imageData = extractImage(result);
      if (imageData) {
        console.log(`[PROOF] ✓ 2D proof image received (attempt ${attempt})`);
        return imageData;
      }

      // Check for text-only response (NO_IMAGE)
      const textResponse = extractText(result);
      if (textResponse) {
        console.warn(`[PROOF] Got text but no image (attempt ${attempt}): ${textResponse.slice(0, 200)}`);
      } else {
        console.warn(`[PROOF] Empty response (attempt ${attempt})`);
      }

      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err: any) {
      clearTimeout(timer);
      console.warn(`[PROOF] ${err?.name === "AbortError" ? "Timeout" : "Error"} (attempt ${attempt}):`, err);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  return null;
}

function extractImage(result: any): string | null {
  try {
    const parts = result?.candidates?.[0]?.content?.parts;
    if (!parts?.length) return null;
    for (const part of parts) {
      if (part?.inlineData?.data) return part.inlineData.data;
    }
  } catch { /* ignore */ }
  return null;
}

function extractText(result: any): string | null {
  try {
    const parts = result?.candidates?.[0]?.content?.parts;
    if (!parts?.length) return null;
    for (const part of parts) {
      if (part?.text) return part.text;
    }
  } catch { /* ignore */ }
  return null;
}
