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
 * panelizer-test-compare — A/B diagnostic
 *
 * Option A: Feed 3D render + original v4.0 "flat panel extraction" prompt
 * Option B: No render — generate flat panel from scratch using design description only
 *
 * POST /panelizer-test-compare
 * {
 *   "renderUrl": "https://...3d-render.png",   // required for A, ignored for B
 *   "test": "A" or "B",
 *   "designDescription": "SIPCO Juice Bar bright green and pink bold graphics",
 *   "companyName": "SIPCO Juice Bar",           // optional
 *   "panelLabel": "Driver Side",
 *   "widthInches": 172,
 *   "heightInches": 59.5,
 *   "finish": "Gloss"
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey } from "../_shared/gemini-key-pool.ts";

const BUCKET = "wrap-files";
const MODEL = "gemini-3-pro-image-preview";

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function uploadAndSign(path: string, bytes: Uint8Array): Promise<string> {
  const sb = getSupabase();
  await sb.storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 7200);
  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  return data.signedUrl;
}

function extractImage(result: any): string | null {
  try {
    const parts = result?.candidates?.[0]?.content?.parts;
    if (!parts) return null;
    for (const part of parts) {
      if (part?.inlineData?.data) return part.inlineData.data;
    }
  } catch { /* ignore */ }
  return null;
}

function extractText(result: any): string | null {
  try {
    const parts = result?.candidates?.[0]?.content?.parts;
    if (!parts) return null;
    for (const part of parts) {
      if (part?.text) return part.text;
    }
  } catch { /* ignore */ }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const testMode = (body.test || "A").toUpperCase();
    const renderUrl = body.renderUrl || "";
    const designDescription = body.designDescription || "Bold colorful vehicle wrap design";
    const companyName = body.companyName || "";
    const panelLabel = body.panelLabel || "Driver Side";
    const widthInches = body.widthInches || 172;
    const heightInches = body.heightInches || 59.5;
    const finish = body.finish || "Gloss";

    if (!["A", "B"].includes(testMode)) {
      return new Response(
        JSON.stringify({ error: 'test must be "A" or "B"' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (testMode === "A" && !renderUrl) {
      return new Response(
        JSON.stringify({ error: "renderUrl is required for test A" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ratio = widthInches / heightInches;
    const geminiRatio = ratio > 2.5 ? "21:9" : ratio > 1.5 ? "16:9" : ratio > 1.2 ? "4:3" : "1:1";

    console.log(`[TEST-${testMode}] ═══ ${panelLabel} (${widthInches}" × ${heightInches}") ═══`);
    console.log(`[TEST-${testMode}] Design: ${designDescription.slice(0, 80)}`);

    let systemInstruction: string;
    let contents: any[];

    if (testMode === "A") {
      // ═══════════════════════════════════════════════════════════
      // OPTION A: Feed 3D render + v4.0 extraction prompt
      // "Here's the wrap on the car. Extract the flat panel from it."
      // ═══════════════════════════════════════════════════════════

      const renderResp = await fetch(renderUrl, { headers: { "User-Agent": "Deno/Test" } });
      if (!renderResp.ok) throw new Error(`Failed to fetch render: ${renderResp.status}`);
      const renderBytes = new Uint8Array(await renderResp.arrayBuffer());
      const renderBase64 = uint8ArrayToBase64(renderBytes);
      console.log(`[TEST-A] Render: ${(renderBytes.byteLength / 1024).toFixed(0)} KB`);

      systemInstruction = `You are a production file output specialist at WePrintWraps.com. Your job is to take 3D vehicle wrap renders and extract the wrap design as a flat, print-ready panel file. The output must be a flat 2D rectangle — like vinyl laid flat on a table before installation. No vehicle, no 3D perspective, no wheels, no windows, no background.`;

      const prompt = `Here is a 3D rendered vehicle wrap. The design on this vehicle needs to be extracted as a flat rectangular production panel.

DESIGN: ${designDescription}
${companyName ? `COMPANY: ${companyName}` : ''}
FINISH: ${finish}
PANEL: ${panelLabel} — ${widthInches}" wide × ${heightInches}" tall

Study the wrap design on this vehicle carefully. Now generate a single flat 2D rectangular panel image that contains EXACTLY the same design, colors, graphics, and layout as shown on the vehicle — but laid completely flat like printed vinyl on a table before installation.

The panel must be production-ready wrap art. The image must be a flat 2D rectangle with zero 3D perspective, zero depth cues, and no shadows that imply a curved surface. No vehicle shapes, silhouettes, or outlines anywhere. No borders, frames, or margins — the design bleeds edge to edge across the full panel.

The design fills the entire rectangle. Generate only the panel image, nothing else.`;

      contents = [{
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: renderBase64 } },
          { text: prompt },
        ],
      }];

    } else {
      // ═══════════════════════════════════════════════════════════
      // OPTION B: No render — generate flat panel from scratch
      // This is the v4.0 approach that worked for early packs
      // ═══════════════════════════════════════════════════════════

      systemInstruction = `You are DesignIQ — a proprietary vehicle wrap design engine built by and for the vinyl wrap industry. You generate flat, print-ready panel artwork for professional vehicle wraps.`;

      const prompt = `Generate a single flat 2D rectangular panel image for a professional vehicle wrap.

CREATIVE DIRECTION: "${designDescription}"
${companyName ? `COMPANY NAME: ${companyName}` : ''}
FINISH: ${finish}
PANEL: ${panelLabel} — ${widthInches}" wide × ${heightInches}" tall

Generate production-ready wrap art as a flat 2D rectangular panel. This is NOT a vehicle render — it is the raw panel artwork that will be printed on cast vinyl and physically applied to a real vehicle by professional wrap installers.

The image must be a flat 2D rectangle with zero 3D perspective, zero depth cues, and no shadows that imply a curved surface. No vehicle shapes, silhouettes, or outlines anywhere. No borders, frames, or margins — the design bleeds edge to edge across the full panel.

Concentrate the design energy on flat body panel zones where cast vinyl lays smooth against sheet metal. The visual flow must read naturally from front to rear — left to right — mirroring how the eye tracks a vehicle in motion. Bold graphic transitions are always favored over fine gradients because fine gradients break down at production print scale and show banding on laminated vinyl.

Design with color density and contrast that delivers viewing impact at 10 feet and beyond. A wrap that only reads up close fails on the street.

The design fills the entire rectangle. Solid or seamlessly integrated background — never transparent. Generate only the panel image, nothing else.`;

      contents = [{
        role: "user",
        parts: [{ text: prompt }],
      }];
    }

    // ── Call Gemini ──
    console.log(`[TEST-${testMode}] Calling ${MODEL}...`);
    const start = Date.now();
    const key = getGeminiKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: geminiRatio, imageSize: "4K" },
          },
        }),
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
    const ms = Date.now() - start;

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[TEST-${testMode}] Gemini ${response.status}: ${errText.slice(0, 300)}`);
      return new Response(
        JSON.stringify({ test: testMode, success: false, error: `Gemini ${response.status}`, detail: errText.slice(0, 500), ms }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await response.json();
    const imageBase64 = extractImage(result);
    const text = extractText(result);
    const finishReason = result?.candidates?.[0]?.finishReason || "unknown";

    if (!imageBase64) {
      console.error(`[TEST-${testMode}] No image (finishReason: ${finishReason})`);
      return new Response(
        JSON.stringify({ test: testMode, success: false, error: `No image (${finishReason})`, text, ms }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const bytes = base64ToUint8Array(imageBase64);
    const testId = `test-${Date.now()}`;
    const path = `production-packs/test-compare/${testId}/test-${testMode}.png`;
    const signedUrl = await uploadAndSign(path, bytes);

    console.log(`[TEST-${testMode}] ✓ Image: ${(bytes.byteLength / 1024).toFixed(0)} KB in ${ms}ms`);

    // Also save to a predictable path for easy download
    const latestPath = `production-packs/test-compare/latest-${testMode}.png`;
    const sb = getSupabase();
    await sb.storage.from(BUCKET).upload(latestPath, bytes, { contentType: "image/png", upsert: true });

    return new Response(
      JSON.stringify({
        test: testMode,
        success: true,
        url: signedUrl,
        sizeKB: Math.round(bytes.byteLength / 1024),
        text,
        ms,
        panel: { label: panelLabel, widthInches, heightInches },
        description: testMode === "A"
          ? "3D render fed to Gemini + extraction prompt (like original SIP approach)"
          : "No render — flat panel generated from scratch using design prompt only (v4.0 approach)",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[TEST] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Test failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
