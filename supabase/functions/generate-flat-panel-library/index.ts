/**
 * generate-flat-panel-library — Flat Panel Library Generator (RestyleLibrary™)
 *
 * Generates a SINGLE flat 2D rectangular vinyl panel image for the
 * Flat Panel Library Generator admin tool. Returns the raw base64 image so
 * the client can crop it to 186" × 56" (3.32:1) before uploading to the
 * `designpanelpro_patterns` table.
 *
 * IMPORTANT:
 *   - Standalone function. Does NOT import from or modify any locked
 *     render pipeline files (design-panel-ai-generate, generate-color-render,
 *     panelizer-step-fill, studio-os, etc.).
 *   - Model is LOCKED to gemini-3-pro-image-preview per CLAUDE.md.
 *   - Prompts are kept under 6000 chars.
 *   - NO_IMAGE retry fallback before failing.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview";

// ---------------------------------------------------------------------------
// Gemini key pool (self-contained — no shared import)
// ---------------------------------------------------------------------------
function getGeminiKey(): string {
  const primary = Deno.env.get("GOOGLE_AI_API_KEY");
  if (primary) return primary;
  for (let i = 2; i <= 5; i++) {
    const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`);
    if (k) return k;
  }
  throw new Error("No GOOGLE_AI_API_KEY configured");
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------
interface RestyleArgs {
  theme?: string;
}

interface CommercialArgs {
  industry?: string;
  businessName?: string;
  theme?: string;
}

const FLAT_PANEL_RULES = `FLAT PRINT-READY VINYL PANEL — viewed head-on, dead center, no perspective, no vehicle, no 3D, no shadow, no ground, no sky, no environment.
Photorealistic vinyl artwork laid flat on a print table, rectangular composition, full-bleed edge-to-edge design, zero borders, zero margins, zero white space.
No text, no letters, no words, no numbers, no watermark, no logo, no signature, no caption, no QR codes.
Cohesive, high-impact composition that reads as a single $5,000 premium wrap panel when installed on a vehicle side.`;

function buildRestylePrompt({ theme }: RestyleArgs): string {
  const themeLine = theme && theme.trim().length > 0
    ? `Theme direction: ${theme.trim()}`
    : `Theme direction: the senior designer picks a bold, original artistic direction — abstract flow, organic texture, geometric fracture, liquid chrome, aurora light, layered camo, tropical energy, cosmic drift, or similar high-end aesthetic. Avoid generic patterns.`;

  return `You are the senior creative director at a premium $5,000–$8,000/vehicle wrap studio, designing flat print-ready artwork for RestyleLibrary™ — the curated library every shop uses as their source of inspiration.

Create one single-panel flat vinyl artwork for a 186 inch wide × 56 inch tall rectangular vehicle side panel. Compose it as flat, rectangular print artwork — NOT a render on a vehicle.

${themeLine}

${FLAT_PANEL_RULES}

Use rich color harmonies, depth, motion, and layered composition. Every square inch must feel intentional and custom-designed. The result must look like a hero panel from a world-class wrap portfolio.`;
}

function buildCommercialPrompt({ industry, businessName, theme }: CommercialArgs): string {
  const industryLine = industry && industry.trim().length > 0
    ? `Industry: ${industry.trim()}.`
    : `Industry: generic commercial service vehicle.`;

  const businessLine = businessName && businessName.trim().length > 0
    ? `Subtle brand identity cues appropriate for a business called "${businessName.trim()}" — convey the feel with color, shape language, and abstract iconography. Do NOT render any literal company name, readable text, or logo.`
    : `Subtle brand identity cues appropriate for the industry — convey the feel with color, shape language, and abstract iconography. No literal text or logos.`;

  const themeLine = theme && theme.trim().length > 0
    ? `Creative direction: ${theme.trim()}`
    : `Creative direction: clean, confident commercial wrap graphic with strong color block, dynamic shape flow, and a professional trade-ready look.`;

  return `You are the senior creative director at a premium $5,000–$8,000/vehicle wrap studio, designing flat print-ready artwork for RestyleLibrary™ — the commercial fleet section.

Create one single-panel flat vinyl artwork for a 186 inch wide × 56 inch tall rectangular commercial vehicle side panel. Compose it as flat, rectangular print artwork — NOT a render on a vehicle.

${industryLine}
${businessLine}

${themeLine}

${FLAT_PANEL_RULES}

The design must look professional, trustworthy, and trade-appropriate. Use confident color blocks, strong directional flow, and abstract iconography that hints at the industry without any readable text or literal logos. This panel is the hero creative for a working business vehicle.`;
}

// Shorter fallback used on NO_IMAGE retry.
function buildShortPrompt(category: "restyle" | "commercial", theme: string | undefined): string {
  if (category === "commercial") {
    return `Flat print-ready vinyl panel artwork, 186x56 rectangle, head-on flat view, full-bleed commercial fleet wrap design. Clean color blocks, dynamic shape flow, no text, no logos, no vehicle, no 3D. ${theme ? `Theme: ${theme}.` : ""}`.trim();
  }
  return `Flat print-ready vinyl panel artwork, 186x56 rectangle, head-on flat view, full-bleed premium artistic wrap design. Rich color harmony, depth, motion, layered composition, no text, no logos, no vehicle, no 3D. ${theme ? `Theme: ${theme}.` : ""}`.trim();
}

// ---------------------------------------------------------------------------
// Design name generator (local, no external call)
// ---------------------------------------------------------------------------
const RESTYLE_ADJECTIVES = [
  "Liquid", "Aurora", "Phantom", "Obsidian", "Tidal", "Solar", "Cosmic",
  "Inferno", "Arctic", "Chromatic", "Kinetic", "Velvet", "Crimson", "Nebula",
  "Mythic", "Neon", "Ember", "Glacier", "Voltage", "Prism", "Fracture", "Drift",
];
const RESTYLE_NOUNS = [
  "Mirage", "Pulse", "Veil", "Storm", "Tide", "Current", "Spectrum", "Flare",
  "Horizon", "Echo", "Reign", "Vortex", "Cascade", "Eclipse", "Bloom", "Forge",
];

const COMMERCIAL_ADJECTIVES = [
  "Apex", "Iron", "Steel", "Core", "Prime", "Bold", "Elite", "True",
  "Summit", "Bravo", "Anchor", "Pioneer", "Vanguard",
];
const COMMERCIAL_NOUNS = [
  "Fleet", "Signal", "Motive", "Works", "Trade", "Route", "Crew", "Mark",
  "Standard", "Line", "Frame",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateDesignName(category: "restyle" | "commercial"): string {
  if (category === "commercial") {
    return `${pick(COMMERCIAL_ADJECTIVES)} ${pick(COMMERCIAL_NOUNS)}`;
  }
  return `${pick(RESTYLE_ADJECTIVES)} ${pick(RESTYLE_NOUNS)}`;
}

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------
async function callGemini(prompt: string, apiKey: string): Promise<{
  imageBase64: string | null;
  mimeType: string;
  finishReason: string;
  text: string | null;
}> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
        temperature: 0.9,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini ${response.status}: ${errText.slice(0, 300)}`);
  }

  const result = await response.json();
  const candidate = result?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const finishReason = candidate?.finishReason || "unknown";

  let imageBase64: string | null = null;
  let mimeType = "image/png";
  let text: string | null = null;

  for (const part of parts) {
    if (part?.inlineData?.data) {
      imageBase64 = part.inlineData.data;
      mimeType = part.inlineData.mimeType || "image/png";
    } else if (part?.inline_data?.data) {
      imageBase64 = part.inline_data.data;
      mimeType = part.inline_data.mimeType || "image/png";
    } else if (part?.text) {
      text = part.text;
    }
  }

  return { imageBase64, mimeType, finishReason, text };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const category: "restyle" | "commercial" =
      body?.category === "commercial" ? "commercial" : "restyle";
    const theme: string | undefined = typeof body?.prompt === "string" ? body.prompt : undefined;
    const industry: string | undefined = typeof body?.industry === "string" ? body.industry : undefined;
    const businessName: string | undefined = typeof body?.businessName === "string" ? body.businessName : undefined;

    const apiKey = getGeminiKey();

    // Build the full prompt for the chosen category.
    let prompt = category === "commercial"
      ? buildCommercialPrompt({ industry, businessName, theme })
      : buildRestylePrompt({ theme });

    // Guardrail: keep prompts under 6000 chars (CLAUDE.md rule).
    if (prompt.length > 6000) {
      prompt = prompt.slice(0, 6000);
    }

    console.log(`[FLAT-PANEL-LIB] category=${category} promptLen=${prompt.length}`);

    // First attempt.
    let gem = await callGemini(prompt, apiKey);

    // NO_IMAGE retry with a shorter prompt before failing.
    if (!gem.imageBase64) {
      console.log(`[FLAT-PANEL-LIB] NO_IMAGE (${gem.finishReason}) — retrying with short prompt`);
      const shortPrompt = buildShortPrompt(category, theme);
      gem = await callGemini(shortPrompt, apiKey);
    }

    if (!gem.imageBase64) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `No image returned (finishReason: ${gem.finishReason})`,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const designName = generateDesignName(category);

    return new Response(
      JSON.stringify({
        success: true,
        imageBase64: gem.imageBase64,
        mimeType: gem.mimeType,
        designName,
        promptUsed: prompt,
        category,
        model: GEMINI_IMAGE_MODEL,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("[FLAT-PANEL-LIB] Error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
