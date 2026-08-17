/**
 * generate-flat-panel
 *
 * Generates FLAT panel artwork for the RestyleLibrary — not a 3D vehicle
 * render, but the raw rectangular design strip that wrap shops print and
 * apply to vehicles. Output is a wide 16:9 panel with bold graphic design.
 *
 * Uses few-shot FORMAT examples from storage to teach Gemini what a flat
 * panel looks like (rectangular, edge-to-edge, no 3D). The examples teach
 * FORMAT only — each design is unique to its prompt, never copies examples.
 *
 * Used by the AdminDesignPanelBatch tool to populate the curated library.
 * Each panel is uploaded to wrap-files storage and inserted into
 * designpanelpro_patterns so it appears in RestyleLibrary immediately.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Few-shot FORMAT examples ────────────────────────────────────────
// These teach Gemini the CORRECT OUTPUT FORMAT (flat rectangular panel,
// edge-to-edge fill, no 3D vehicle). They do NOT dictate design style —
// each panel's style comes from its unique prompt.
const EXAMPLE_PATHS = [
  "panels/batch/1776918001167_flat-panel.jpg",
  "panels/batch/1776917965148_flat-panel.jpg",
  "panels/batch/1776917925387_flat-panel.jpg",
  "panels/batch/1776917889826_flat-panel.jpg",
  "panels/batch/1776917853141_flat-panel.jpg",
];

let _cachedExamples: Array<{ base64: string; mime: string }> | null = null;

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function loadExampleImages(
  supabase: any,
): Promise<Array<{ base64: string; mime: string }>> {
  if (_cachedExamples) return _cachedExamples;

  const examples: Array<{ base64: string; mime: string }> = [];
  for (const path of EXAMPLE_PATHS) {
    try {
      const { data, error } = await supabase.storage
        .from("wrap-files")
        .download(path);
      if (error || !data) {
        console.warn(`[FlatPanel] Example missing: ${path}`);
        continue;
      }
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.length > 5_000_000) {
        console.warn(`[FlatPanel] Example too large (${bytes.length}b), skipping: ${path}`);
        continue;
      }
      const mime = path.endsWith(".png") ? "image/png" : "image/jpeg";
      examples.push({ base64: uint8ArrayToBase64(bytes), mime });
    } catch (err: any) {
      console.warn(`[FlatPanel] Failed to load example: ${path}`, err?.message);
    }
  }

  _cachedExamples = examples;
  console.log(`[FlatPanel] Loaded ${examples.length} few-shot format examples`);
  return examples;
}

/**
 * Build multimodal parts array with format examples + text prompt.
 * Examples teach FORMAT only — the prompt drives the unique design.
 */
function buildFewShotParts(
  examples: Array<{ base64: string; mime: string }>,
  promptText: string,
): any[] {
  if (examples.length === 0) {
    return [{ text: promptText }];
  }

  const parts: any[] = [];
  parts.push({
    text: [
      "FORMAT REFERENCE — these images show the CORRECT OUTPUT FORMAT for flat panel artwork.",
      "Study ONLY the format: flat rectangular shape, edge-to-edge design fill, no vehicle body, no 3D perspective.",
      "Do NOT copy the design style, colors, or subject matter from these examples.",
      "Your design must be completely original and unique to the prompt below.\n",
    ].join(" "),
  });

  for (let i = 0; i < examples.length; i++) {
    parts.push({
      text: `Format example ${i + 1}: correct flat panel output — rectangular, edge-to-edge, print-ready`,
    });
    parts.push({
      inlineData: {
        mimeType: examples[i].mime,
        data: examples[i].base64,
      },
    });
  }

  parts.push({
    text: "\nNow create a COMPLETELY NEW and ORIGINAL design — unique style, unique colors, unique composition. Match the flat panel FORMAT shown above, but the design itself must be entirely different:\n\n" + promptText,
  });

  return parts;
}

// ── Main handler ────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      prompt,
      category,
      finish = "Gloss",
    } = body;

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Missing prompt" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auth
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    let userId: string | null = null;

    if (authHeader) {
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await authClient.auth.getUser();
      userId = user?.id || null;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Service client (needed for storage + DB) ────────────────
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ── Load few-shot format examples ───────────────────────────
    const examples = await loadExampleImages(supabase);

    // ── Build the flat panel prompt ─────────────────────────────
    const isCommercial = category === "commercial";

    const flatPanelPrompt = isCommercial
      ? buildCommercialFlatPanelPrompt(prompt, finish)
      : buildRestyleFlatPanelPrompt(prompt, finish);

    // Build multimodal parts (examples + prompt)
    const contentParts = buildFewShotParts(examples, flatPanelPrompt);

    console.log(`[FlatPanel] Generating ${isCommercial ? "commercial" : "restyle"} flat panel (${flatPanelPrompt.length} chars, ${examples.length} examples)`);

    // ── Design Name (deterministic) ─────────────────────────────
    const fillerWords = new Set([
      "a", "an", "the", "with", "that", "has", "have", "and", "or", "of", "for",
      "on", "in", "is", "it", "its", "my", "this", "which", "also", "very",
      "wrap", "wraps", "style", "theme", "design", "vehicle", "car", "truck",
      "color", "colors", "panel", "body", "flat", "side",
    ]);
    const thematicWords = prompt.trim().split(/\s+/)
      .filter((w: string) => !fillerWords.has(w.toLowerCase()) && w.length > 2)
      .slice(0, 4);
    const designName = thematicWords.length > 0
      ? thematicWords.map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ")
      : "Custom Panel";

    // ── Gemini image generation ─────────────────────────────────
    const MAX_ATTEMPTS = 2;
    let imageBase64: string | null = null;
    let imageMimeType = "image/png";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[FlatPanel] Attempt ${attempt}/${MAX_ATTEMPTS}`);

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getGeminiKey()}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: contentParts }],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: {
                  aspectRatio: "16:9",
                  imageSize: "4K",
                },
              },
            }),
            signal: AbortSignal.timeout(60_000),
          }
        );

        if (!response.ok) {
          console.error(`[FlatPanel] HTTP ${response.status}`);
          if (attempt < MAX_ATTEMPTS) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          return new Response(
            JSON.stringify({ error: `Generation failed (HTTP ${response.status})` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const result = await response.json();
        const parts = result.candidates?.[0]?.content?.parts;

        if (parts) {
          for (const part of parts) {
            if (part.inlineData) {
              imageBase64 = part.inlineData.data;
              imageMimeType = part.inlineData.mimeType || "image/png";
            }
          }
        }

        if (imageBase64) {
          console.log(`[FlatPanel] Image generated on attempt ${attempt}`);
          break;
        }

        const finishReason = result.candidates?.[0]?.finishReason;
        console.warn(`[FlatPanel] No image (finishReason=${finishReason}), attempt ${attempt}`);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (err: any) {
        console.error(`[FlatPanel] Error attempt ${attempt}:`, err?.message);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "No image generated after retries" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Upload to storage ───────────────────────────────────────
    const timestamp = Date.now();
    const ext = imageMimeType.includes("jpeg") ? "jpg" : "png";
    const fileName = `panels/batch/${timestamp}_flat-panel.${ext}`;

    const binaryString = atob(imageBase64);
    const imageData = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      imageData[i] = binaryString.charCodeAt(i);
    }

    const { error: uploadError } = await supabase.storage
      .from("wrap-files")
      .upload(fileName, imageData, { contentType: imageMimeType, upsert: true });

    if (uploadError) {
      console.error("[FlatPanel] Upload error:", uploadError);
      return new Response(
        JSON.stringify({ error: "Failed to upload panel" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(fileName);

    // ── Insert into designpanelpro_patterns ──────────────────────
    // The 4K flat panel IS the production-ready print file.
    // Set all URL fields so the purchase/print pipeline has everything it needs:
    //   media_url          → library browsing thumbnail + visualizer input
    //   production_file_url → print-ready file for WePrintWraps fulfillment
    //   clean_display_url   → clean version for proofs/approvals (no watermarks)
    const { data: patternRecord, error: insertError } = await supabase
      .from("designpanelpro_patterns")
      .insert({
        name: designName,
        ai_generated_name: designName,
        media_url: publicUrl,
        production_file_url: publicUrl,
        clean_display_url: publicUrl,
        category: category || "restyle",
        prompt_text: prompt,
        finish: finish || "Gloss",
        is_active: true,
        is_curated: true,
        uploaded_by: userId,
      })
      .select("id")
      .single();

    if (insertError) {
      console.warn("[FlatPanel] Insert error (non-fatal):", insertError.message);
    }

    console.log(`[FlatPanel] Complete: "${designName}" → ${publicUrl}`);

    return new Response(
      JSON.stringify({
        panelUrl: publicUrl,
        designName,
        patternId: patternRecord?.id || null,
        success: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[FlatPanel] Error:", err);
    return new Response(
      JSON.stringify({ error: "Unexpected failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ---------------------------------------------------------------------------
// Flat Panel Prompt Builders (existing pipeline — preserved as-is with
// minimal anti-perspective hardening added)
// ---------------------------------------------------------------------------

function buildRestyleFlatPanelPrompt(prompt: string, finish: string): string {
  return `You are WePrintWraps.com Senior Panel Designer. You create flat vehicle wrap panel artwork — NOT 3D renders on vehicles. Your output is the raw FLAT RECTANGULAR design strip that wrap shops print on wide-format printers and physically apply to vehicles.

CREATE A FLAT PANEL DESIGN based on: "${prompt}"

OUTPUT FORMAT:
- A single wide FLAT RECTANGULAR panel artwork that fills the ENTIRE canvas edge-to-edge — NO white border, NO margin, NO padding, NO background color visible anywhere.
- Aspect ratio is approximately 4:1 wide (like a long banner/strip).
- The design artwork MUST touch all four edges of the image. Every pixel of the output is design — zero empty space. Design extends past the visible panel edge by 4 inches on all sides (print bleed).
- NO vehicle body, NO wheels, NO windows, NO 3D perspective — just the raw flat graphic artwork.
- The panel should look like a professional design file ready to print on vinyl.
- Front-on orthographic view — zero camera angle, zero perspective distortion.

DESIGN QUALITY:
- Bold, dynamic vehicle wrap artwork with sharp graphic elements.
- Flowing composition that moves left to right across the panel.
- Rich color depth, layered elements, and visual energy.
- Think racing livery panels, abstract flow graphics, angular slash designs, organic art wraps.
- Professional print-ready quality — clean edges, solid colors, precise linework.
- ${finish} finish appearance.

CRITICAL RULES:
- This is a FLAT 2D panel design — absolutely NO vehicle, NO car body, NO 3D perspective.
- The artwork is the entire image — a rectangular strip of bold wrap graphics.
- ABSOLUTELY NO white background, NO white border, NO empty margins. The artwork bleeds to every edge of the canvas. If the design has a light area it must be intentional design, not empty space.
- No text, no logos, no watermarks, no branding on the panel.
- No background scene — the panel artwork IS the image.
- Think of it as unrolling a sheet of printed vinyl and photographing it flat on a table — the vinyl covers the entire sheet.`;
}

function buildCommercialFlatPanelPrompt(prompt: string, finish: string): string {
  return `You are WePrintWraps.com Senior Panel Designer. You create flat vehicle wrap panel artwork — NOT 3D renders on vehicles. Your output is the raw FLAT RECTANGULAR design strip that wrap shops print on wide-format printers and physically apply to vehicles.

CREATE A FLAT COMMERCIAL PANEL DESIGN based on: "${prompt}"

OUTPUT FORMAT:
- A single wide FLAT RECTANGULAR panel artwork that fills the ENTIRE canvas edge-to-edge — NO white border, NO margin, NO padding, NO background color visible anywhere.
- Aspect ratio is approximately 4:1 wide (like a long banner/strip).
- The design artwork MUST touch all four edges of the image. Every pixel of the output is design — zero empty space. Design extends past the visible panel edge by 4 inches on all sides (print bleed).
- NO vehicle body, NO wheels, NO windows, NO 3D perspective — just the raw flat graphic artwork.
- The panel should look like a professional design file ready to print on vinyl.
- Front-on orthographic view — zero camera angle, zero perspective distortion.

DESIGN QUALITY:
- Professional commercial wrap panel with company branding, contact info, and industry-specific graphics.
- Bold typography for the company name — use custom display fonts, NOT generic sans-serif.
- Include phone numbers, website, and service descriptions laid out for vehicle application.
- Industry-specific imagery and design elements integrated into the panel composition.
- Clean, professional layout that flows left to right across the panel.
- ${finish} finish appearance.

CRITICAL RULES:
- This is a FLAT 2D panel design — absolutely NO vehicle, NO car body, NO 3D perspective.
- The artwork is the entire image — a rectangular strip of bold commercial wrap graphics.
- ABSOLUTELY NO white background, NO white border, NO empty margins. The artwork bleeds to every edge of the canvas. If the design has a light area it must be intentional design, not empty space.
- No background scene — the panel artwork IS the image.
- Think of it as unrolling a sheet of printed vinyl and photographing it flat on a table — the vinyl covers the entire sheet.`;
}
