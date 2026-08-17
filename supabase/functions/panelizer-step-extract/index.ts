/**
 * ─────────────────────────────────────────────────────────────
 *  GENIE™ Universal Panelizer — part of the LiftIQ Engine™ /
 *  Prompt-to-Production™ architecture.
 *
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *  PROPRIETARY & CONFIDENTIAL. Contains trade-secret methods.
 *  Trademarks: GENIE™, DesignIQ™, LiftIQ™ — see /NOTICE and
 *  docs/TRADEMARKS.md. Not legal advice.
 * ─────────────────────────────────────────────────────────────
 */
// ============================================================
// GENIE 2.1 — panelizer-step-extract
// 3D Render → Flat Panel Extractor
//
// Takes a completed photorealistic 3D vehicle wrap render and
// uses Gemini vision + image generation to extract production-ready
// flat print panels from it.
//
// Pipeline position:
//   [3D render approved] → THIS → [ESRGAN 8K upscale] → [WrapBox]
//
// Deploy: supabase functions deploy panelizer-step-extract
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey } from "../_shared/gemini-key-pool.ts";
import {
  getServiceClient,
  uploadToStorage,
  fetchImageBytes,
  uint8ArrayToBase64,
  base64ToUint8Array,
  getSignedUrl,
} from "../_shared/panelizer-os/storage.ts";
import {
  toSupportedRatio,
  tempPath,
  lookupVehicle,
  type VehicleDimensions,
} from "../_shared/panelizer-os/constants.ts";

// Use the same proven model as panelizer-step-fill
const GEMINI_MODEL = "gemini-3-pro-image-preview";

// ── Panel Specs ─────────────────────────────────────────────────
// Standard WPW panel specs mapped to Gemini-supported aspect ratios.
// Based on Nate's 1/10 scale method + 3" bleed on all sides.

interface PanelSpec {
  w: number;
  h: number;
  aspectRatio: string;
  renderView: string;
}

const PANEL_SPECS: Record<string, PanelSpec> = {
  "driver-side":    { w: 165, h: 54,  aspectRatio: "4:1",  renderView: "driver" },
  "passenger-side": { w: 165, h: 54,  aspectRatio: "4:1",  renderView: "passenger" },
  "hood":           { w: 70,  h: 59,  aspectRatio: "5:4",  renderView: "hood" },
  "roof":           { w: 54,  h: 65,  aspectRatio: "4:5",  renderView: "hood" },
  "trunk":          { w: 58,  h: 36,  aspectRatio: "3:2",  renderView: "rear" },
  "front-bumper":   { w: 126, h: 35,  aspectRatio: "4:1",  renderView: "front" },
  "rear-bumper":    { w: 134, h: 29,  aspectRatio: "4:1",  renderView: "rear" },
};

// ── Vehicle-Aware Panel Dimensions ───────────────────────────────
// Derives real panel dimensions from the 260-row vehicle database
// instead of using hardcoded PANEL_SPECS for all vehicles.

function parseVehicleName(vehicle: string): { make: string; model: string } {
  // vehicle comes as "2024 Tesla Model X" — strip year prefix
  const parts = (vehicle || "").trim().split(/\s+/);
  // Remove leading year if present (4-digit number)
  if (parts.length > 0 && /^\d{4}$/.test(parts[0])) parts.shift();
  const make = parts[0] || "";
  const model = parts.slice(1).join(" ") || "";
  return { make, model };
}

function getVehiclePanelDimensions(
  panelKey: string,
  dims: VehicleDimensions,
): { widthInches: number; heightInches: number; aspectRatio: string } | null {
  let w: number, h: number;
  switch (panelKey) {
    case "driver-side":
    case "passenger-side":
      w = dims.bodyLengthInches;
      h = dims.bodyHeightInches;
      break;
    case "hood":
      w = dims.hoodWidthInches;
      h = dims.hoodLengthInches;
      break;
    case "roof":
      w = dims.roofWidthInches;
      h = dims.roofLengthInches;
      break;
    case "trunk":
      w = dims.backWidthInches;
      h = dims.backHeightInches;
      break;
    case "front-bumper":
      // Bumper width ≈ vehicle body width, height ≈ 35" standard
      w = Math.round(dims.bodyLengthInches * 0.6);
      h = 35;
      break;
    case "rear-bumper":
      w = Math.round(dims.bodyLengthInches * 0.6);
      h = 29;
      break;
    default:
      return null;
  }
  if (!w || !h) return null;
  const g = gcd(Math.round(w), Math.round(h));
  const aspectRatio = `${Math.round(w) / g}:${Math.round(h) / g}`;
  return { widthInches: Math.round(w), heightInches: Math.round(h), aspectRatio };
}

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

// ── Types ───────────────────────────────────────────────────────

interface ExtractRequest {
  jobId: string;
  vehicle: string;
  renderUrl: string;
  renderView: string;
  panelKey: string;
  panelDimensions: {
    widthInches: number;
    heightInches: number;
    aspectRatio: string;
  };
  designDescription: string;
  userId?: string;
}

// ── Extraction Prompt Builder ───────────────────────────────────
// Uses the WePrintWraps.com File Output Specialist persona with 3-step structure

const SYSTEM_INSTRUCTION = "You are a production file generator at WePrintWraps.com. You create flat rectangular panel artwork for vehicle wrap printing. Your output is ALWAYS a flat rectangle filled edge-to-edge with artwork — like vinyl laid flat on a table before installation. NEVER output a photo of a vehicle, NEVER output a 3D render or mockup, NEVER include wheels/windows/background. Output ONLY flat rectangular artwork panels ready for print.";

function buildExtractionPrompt(req: ExtractRequest): string {
  const panelLabel = req.panelKey.replace(/-/g, " ").toUpperCase();

  return `You are a File Output Specialist for WePrintWraps.com. Your production files are printed on cast vinyl and installed on real vehicles by professional wrap installers.

Step 1: Review the 3D render of a wrapped ${req.vehicle}. Identify the ${panelLabel} panel — ${req.panelDimensions.widthInches}" wide × ${req.panelDimensions.heightInches}" tall.

Step 2: Extract, flatten, and fill. Produce a flat rectangular file at exact size — ${req.panelDimensions.widthInches}" × ${req.panelDimensions.heightInches}". The artwork must be "peeled off" the 3D vehicle and laid completely flat. Fill edge to edge. No vehicle body, no 3D perspective, no wheels, no windows, no studio. Match every color, pattern, gradient, graphic exactly.

Step 3: Output at highest resolution possible with 0.5" bleed extended seamlessly past all four edges. Production print file — edge to edge, no gaps, no borders, no empty space.`;
}

// ── Main Handler ────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const body: ExtractRequest = await req.json();
  const startTime = Date.now();

  console.log(`[GENIE 2.1] EXTRACT START: ${body.panelKey} for ${body.vehicle}`);

  // Validate required fields
  if (!body.jobId || !body.renderUrl || !body.panelKey) {
    return new Response(JSON.stringify({
      success: false,
      error: "Missing required fields: jobId, renderUrl, panelKey",
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Default panel dimensions: try vehicle database first, then PANEL_SPECS fallback
  if (!body.panelDimensions) {
    // Try to get real dimensions from the 260-row vehicle database
    const { make, model } = parseVehicleName(body.vehicle || "");
    let usedVehicleDB = false;

    if (make) {
      const dims = lookupVehicle(make, model);
      const vehiclePanelDims = getVehiclePanelDimensions(body.panelKey, dims);
      if (vehiclePanelDims) {
        body.panelDimensions = vehiclePanelDims;
        usedVehicleDB = true;
        console.log(`[GENIE 2.1] Vehicle DB dimensions for ${body.panelKey}: ${vehiclePanelDims.widthInches}" × ${vehiclePanelDims.heightInches}" (${dims.source}: ${make} ${model})`);
      }
    }

    // Fallback to hardcoded PANEL_SPECS if vehicle DB didn't match
    if (!usedVehicleDB) {
      const spec = PANEL_SPECS[body.panelKey];
      if (!spec) {
        return new Response(JSON.stringify({
          success: false,
          error: `Unknown panelKey: ${body.panelKey}. Valid keys: ${Object.keys(PANEL_SPECS).join(", ")}`,
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      body.panelDimensions = {
        widthInches: spec.w,
        heightInches: spec.h,
        aspectRatio: spec.aspectRatio,
      };
      console.log(`[GENIE 2.1] Fallback PANEL_SPECS for ${body.panelKey}: ${spec.w}" × ${spec.h}"`);
    }
  }

  if (!body.designDescription) {
    body.designDescription = "vehicle wrap design";
  }

  const supabase = getServiceClient();

  try {
    // Step 1: Fetch the 3D render image as base64
    console.log(`[GENIE 2.1] Fetching render: ${body.renderUrl.slice(0, 80)}...`);
    const renderBytes = await fetchImageBytes(body.renderUrl);
    const renderBase64 = uint8ArrayToBase64(renderBytes);
    console.log(`[GENIE 2.1] Render fetched: ${renderBytes.length} bytes`);

    // Step 2: Build the extraction prompt
    const prompt = buildExtractionPrompt(body);
    console.log(`[GENIE 2.1] Prompt length: ${prompt.length} chars`);

    // Step 3: Map aspect ratio to Gemini-supported ratio
    const geminiAspectRatio = toSupportedRatio(body.panelDimensions.aspectRatio);
    console.log(`[GENIE 2.1] Aspect ratio: ${body.panelDimensions.aspectRatio} → Gemini: ${geminiAspectRatio}`);

    // Step 4: Call Gemini with retry logic (3 attempts with backoff)
    const MAX_ATTEMPTS = 3;
    let imageBase64 = "";
    let imageMimeType = "image/png";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const currentKey = getGeminiKey();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);

      try {
        console.log(`[GENIE 2.1] ${GEMINI_MODEL} attempt ${attempt}/${MAX_ATTEMPTS}`);

        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${currentKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: SYSTEM_INSTRUCTION }],
              },
              contents: [{
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: renderBase64,
                    },
                  },
                  {
                    text: prompt,
                  },
                ],
              }],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: {
                  aspectRatio: geminiAspectRatio,
                  imageSize: "4K",
                },
              },
            }),
            signal: controller.signal,
          },
        );
        clearTimeout(timer);

        if (geminiResponse.status === 429) {
          console.warn(`[GENIE 2.1] 429 rate-limited (attempt ${attempt})`);
          if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1))); continue; }
          throw new Error("Gemini rate-limited after all retries");
        }

        if (!geminiResponse.ok) {
          const errorText = await geminiResponse.text();
          console.warn(`[GENIE 2.1] ${geminiResponse.status}: ${errorText.slice(0, 200)}`);
          if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1))); continue; }
          throw new Error(`Gemini API error (${geminiResponse.status}): ${errorText.slice(0, 500)}`);
        }

        const geminiData = await geminiResponse.json();
        const responseParts = geminiData.candidates?.[0]?.content?.parts;

        if (responseParts && Array.isArray(responseParts)) {
          for (const part of responseParts) {
            if (part.inlineData) {
              imageBase64 = part.inlineData.data;
              imageMimeType = part.inlineData.mimeType || "image/png";
            }
          }
        }

        if (imageBase64) {
          console.log(`[GENIE 2.1] Image received (attempt ${attempt})`);
          break;
        }

        console.warn(`[GENIE 2.1] No image in response (attempt ${attempt})`);
        if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 2000)); }
      } catch (err: any) {
        clearTimeout(timer);
        if (err?.name === "AbortError") {
          console.warn(`[GENIE 2.1] Timeout (attempt ${attempt})`);
        } else if (imageBase64) {
          break; // Already got image before error
        } else {
          if (attempt >= MAX_ATTEMPTS) throw err;
          console.warn(`[GENIE 2.1] Error (attempt ${attempt}): ${err.message}`);
        }
        if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1))); }
      }
    }

    if (!imageBase64) {
      throw new Error(`GEMINI RETURNED TEXT — no image after ${MAX_ATTEMPTS} attempts`);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[GENIE 2.1] EXTRACT SUCCESS: ${body.panelKey} in ${elapsed}ms`);

    // Step 6: Upload flat panel to Supabase storage
    const imageBytes = base64ToUint8Array(imageBase64);
    const storagePath = body.userId
      ? tempPath(body.userId, body.jobId, `genie21-extract-${body.panelKey}`)
      : `production-packs/genie21/${body.jobId}/flat-panels/${body.panelKey}_10TH_SCALE.png`;

    await uploadToStorage(storagePath, imageBytes);
    const signedUrl = await getSignedUrl(storagePath);

    console.log(`[GENIE 2.1] Uploaded: ${storagePath} (${imageBytes.length} bytes)`);

    // Step 7: Log to genie_extraction_log table
    await supabase.from("genie_extraction_log").insert({
      job_id: body.jobId,
      vehicle: body.vehicle,
      panel_key: body.panelKey,
      render_url: body.renderUrl,
      flat_panel_url: signedUrl,
      prompt_used: prompt,
      model_used: GEMINI_MODEL,
      aspect_ratio: geminiAspectRatio,
      dimensions_inches: `${body.panelDimensions.widthInches}" x ${body.panelDimensions.heightInches}"`,
      generation_time_ms: elapsed,
      status: "success",
    }).then(({ error }) => {
      if (error) console.warn(`[GENIE 2.1] Log insert warning: ${error.message}`);
    });

    return new Response(JSON.stringify({
      success: true,
      panelKey: body.panelKey,
      flatPanelUrl: signedUrl,
      storagePath,
      dimensionsInches: `${body.panelDimensions.widthInches}" x ${body.panelDimensions.heightInches}"`,
      aspectRatio: geminiAspectRatio,
      generationTimeMs: elapsed,
      modelUsed: GEMINI_MODEL,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[GENIE 2.1] EXTRACT ERROR: ${body.panelKey}`, error);

    // Log error
    await supabase.from("genie_extraction_log").insert({
      job_id: body.jobId,
      vehicle: body.vehicle || "",
      panel_key: body.panelKey,
      render_url: body.renderUrl,
      status: "error",
      error_message: error.message,
      model_used: GEMINI_MODEL,
      generation_time_ms: elapsed,
    }).then(({ error: logErr }) => {
      if (logErr) console.warn(`[GENIE 2.1] Error log insert warning: ${logErr.message}`);
    });

    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      panelKey: body.panelKey,
      generationTimeMs: elapsed,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
