/**
 * generate-flat-panel-from-render
 *
 * Takes a 3D render (or a 2D production proof) and produces a flat
 * rectangular print panel of the wrap design.
 *
 * ── Two-step pipeline (no structural anchor) ────────────────────────────
 * Feeding a 3D render straight into an image-edit endpoint keeps the output
 * vaguely 3D-vehicle-shaped — the model treats the input as a STRUCTURAL
 * reference. To get a true flat panel we decouple description from
 * generation:
 *   Step A — Gemini vision describes the {side} artwork in the source proof
 *            (colors, shapes, logos, text, layout) as literal prose.
 *   Step B — Gemini image generation produces a brand-new flat 2D print
 *            panel from that description ONLY (no image input, no anchor).
 *   Step C — Real-ESRGAN 4x via upscale-production-panel → print-ready.
 *
 * Runs entirely on Gemini (gemini-2.5-flash for vision, the locked
 * gemini-3-pro-image-preview for generation) using the project's
 * GOOGLE_AI_API_KEY pool — same as the rest of the render stack. The old
 * implementation depended on OPENAI_API_KEY, which is not provisioned on
 * this project, so every call 500'd at the key check before reaching a
 * model.
 *
 * Same input/output contract as before so QC Artboard's caller is unchanged.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Native Deno.serve — avoids a deno.land bundle-time import that was timing out
// on Supabase's edge bundler and blocking deploys.
const serve = (handler: (req: Request) => Response | Promise<Response>) => Deno.serve(handler);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VISION_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-3-pro-image-preview";

// ── Gemini key pool (round-robin) ─────────────────────────────────────
const _gpool: string[] = [];
let _gloaded = false;
let _gidx = 0;
function _loadGemini(): void {
  if (_gloaded) return;
  const primary = Deno.env.get("GOOGLE_AI_API_KEY");
  if (primary) _gpool.push(primary);
  for (let i = 2; i <= 5; i++) {
    const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`);
    if (k) _gpool.push(k);
  }
  _gloaded = true;
}
function hasGeminiKey(): boolean {
  _loadGemini();
  return _gpool.length > 0;
}
function getGeminiKey(): string {
  _loadGemini();
  if (_gpool.length === 0) throw new Error("No GOOGLE_AI_API_KEY configured");
  const k = _gpool[_gidx % _gpool.length];
  _gidx++;
  return k;
}

// ── Per-side aspect ratio ─────────────────────────────────────────────
// Gemini imageConfig takes an aspectRatio (not pixel dims). Vehicle sides
// are wide; the roof is long/narrow. Real-ESRGAN 4x brings the output to
// print resolution downstream.
function aspectForSide(sideName: string): string {
  const s = sideName.toLowerCase();
  if (s.includes("roof")) return "4:3";
  if (s.includes("hood")) return "4:3";
  if (s.includes("rear") || s.includes("back")) return "16:9";
  // Driver/passenger sides are very wide (224x56 ≈ 4:1). 21:9 is Gemini's widest
  // native ratio — get as close to the true panel aspect as the model allows so
  // the downstream fill has the least amount of side to extend.
  return "21:9";
}

function bytesToB64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    bin += String.fromCharCode(...slice);
  }
  return btoa(bin);
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Deno/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch source image: ${res.status}`);
  const mimeType = res.headers.get("content-type") || "image/png";
  const buf = new Uint8Array(await res.arrayBuffer());
  return { data: bytesToB64(buf), mimeType };
}

// ── Step A: Gemini vision description ──────────────────────────────────
/**
 * Ask Gemini vision to exhaustively describe the wrap artwork on the
 * specified side of the vehicle. Literal description — colors, shapes,
 * text, logos, layout — not an artistic interpretation. Becomes the text
 * prompt for step B.
 */
async function describeArtwork(
  imageUrl: string,
  sideName: string,
): Promise<string | null> {
  const friendlySide = sideName.replace(/_/g, " ").toLowerCase();
  const systemPrompt = `You are a vinyl-wrap print production assistant. You describe wrap artwork EXACTLY as it appears — literal, exhaustive, no creative interpretation. Output goes into an image generator that will reproduce the design as a flat print panel.`;

  const userPrompt = `Describe the wrap artwork on the ${friendlySide} of the vehicle in this image.

If this is a multi-view printer's proof (multiple thumbnails / dimension callouts / signatures), focus ONLY on the ${friendlySide} thumbnail and ignore the rest of the sheet.

Cover, in this order:
1. Background — base color(s), gradient direction if any, texture/finish, any large overall shapes.
2. Foreground graphics — every shape, stripe, swoosh, photo, illustration. Position (front/middle/rear, top/middle/bottom), size relative to the panel, and color.
3. Logos — describe each logo's design, position, and approximate size. If you can read brand text, transcribe it exactly.
4. Text — transcribe every word and number exactly as it appears, character for character. This is critical: the image generator reproduces text from your transcription, so any misspelling or omission becomes a misprint on the customer's vehicle. Note font style (bold, italic, serif/sans, script), color, and position for each text element.
5. Layout — left-to-right composition of the side, how the elements relate spatially. State clearly which elements sit toward the FRONT of the vehicle versus the REAR, so orientation is unambiguous.

Be specific with colors (give hex if confident, otherwise descriptive: "deep navy blue", "fluorescent orange"). Be specific with positions ("the logo sits roughly 20% from the front of the panel, centered vertically").

Do NOT mention: the vehicle body, wheels, windows, doors, fenders, lights, the 3D perspective, any shadows or reflections from 3D lighting, dimension callouts, signatures, watermarks, white margins. Only the wrap ARTWORK itself.

Return plain prose, no headings, no bullet points — describe the design completely; do not stop early or summarize if the design is busy. An image generator must be able to reproduce the panel from your description alone.`;

  let img: { data: string; mimeType: string };
  try {
    img = await fetchImageAsBase64(imageUrl);
  } catch (err: any) {
    console.error("[FlatPanelFromRender] source fetch failed:", err?.message);
    return null;
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${getGeminiKey()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{
              role: "user",
              parts: [
                { inlineData: { mimeType: img.mimeType, data: img.data } },
                { text: userPrompt },
              ],
            }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 1500 },
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[FlatPanelFromRender] Gemini vision ${response.status} attempt ${attempt}: ${errText.slice(0, 500)}`);
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1500)); continue; }
        return null;
      }

      const result = await response.json();
      const parts = result?.candidates?.[0]?.content?.parts || [];
      const description = parts.map((p: any) => p.text).filter(Boolean).join(" ").trim();
      if (!description) {
        console.warn(`[FlatPanelFromRender] Gemini vision returned no description (attempt ${attempt})`);
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1500)); continue; }
        return null;
      }
      console.log(`[FlatPanelFromRender] Description (${description.length} chars): ${description.slice(0, 200)}…`);
      return description;
    } catch (err: any) {
      console.error(`[FlatPanelFromRender] Gemini vision error attempt ${attempt}:`, err?.message);
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
    }
  }
  return null;
}

// ── Step B: Gemini text-to-image ──────────────────────────────────────
/**
 * Build a SHORT prompt that combines the design description with flat-panel
 * formatting requirements. Short prompts → better images. Positive framing
 * only — no "NOT a 3D render" (image models over-index on forbidden words).
 */
function buildGenerationPrompt(description: string, finish: string, userIntent: string): string {
  const intent = userIntent?.trim() ? ` Design intent: "${userIntent.trim()}".` : "";
  return `A flat digital graphic artwork that fills the entire image edge to edge, viewed perfectly straight-on and flat (orthographic).${intent}

Design: ${description}

The artwork IS the whole image: it covers every pixel from edge to edge with no border, no margin, no frame, no background surface, no floor, no table, no wall, no shadow, no perspective, no camera angle, and no glossy reflection or glare. Flat, even, matte digital colors — clean vector-style edges, tack-sharp details, accurate ${finish.toLowerCase()} colors. Think of it as the raw print-ready design file itself, not a photograph of a printed panel.`;
}

async function generateFlatPanel(
  prompt: string,
  aspectRatio: string,
): Promise<string | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${getGeminiKey()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: { aspectRatio, imageSize: "4K" },
            },
          }),
          signal: AbortSignal.timeout(120_000),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[FlatPanelFromRender] ${IMAGE_MODEL} ${response.status} attempt ${attempt}: ${errText.slice(0, 500)}`);
        if (attempt < 2) { await new Promise(r => setTimeout(r, 2000)); continue; }
        return null;
      }

      const result = await response.json();
      const finishReason = result?.candidates?.[0]?.finishReason;
      const parts = result?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          console.log(`[FlatPanelFromRender] Generated on attempt ${attempt}`);
          return part.inlineData.data;
        }
      }
      console.warn(`[FlatPanelFromRender] No image bytes (finishReason=${finishReason}) on attempt ${attempt}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    } catch (err: any) {
      console.error(`[FlatPanelFromRender] ${IMAGE_MODEL} error attempt ${attempt}:`, err?.message);
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

// ── Main handler ──────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      prompt = "",
      finish = "Gloss",
      category = "restyle",
      renderUrl,
      sideName,
      renders,
      vehicleDims: _vehicleDims,
    } = body;

    const renderList: Array<{ url: string; sideName: string }> = [];
    if (renders && Array.isArray(renders) && renders.length > 0) {
      for (const r of renders) {
        if (r.url && r.sideName) renderList.push({ url: r.url, sideName: r.sideName });
      }
    } else if (renderUrl) {
      renderList.push({ url: renderUrl, sideName: sideName || "side_view" });
    }

    if (renderList.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing renderUrl or renders array" }),
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
        JSON.stringify({ error: "GOOGLE_AI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Design name from user prompt thematic words
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

    const results: Array<{
      sideName: string;
      panelUrl: string | null;
      success: boolean;
      error?: string;
      description?: string;
    }> = [];

    for (const render of renderList) {
      console.log(`[FlatPanelFromRender] Processing ${render.sideName}…`);

      // Step A — describe the design from the source image
      const description = await describeArtwork(render.url, render.sideName);
      if (!description) {
        results.push({
          sideName: render.sideName,
          panelUrl: null,
          success: false,
          error: "Gemini failed to describe the source artwork",
        });
        continue;
      }

      // Step B — generate flat panel from description (text-only, no anchor)
      const aspectRatio = aspectForSide(render.sideName);
      const genPrompt = buildGenerationPrompt(description, finish, prompt);
      const b64 = await generateFlatPanel(genPrompt, aspectRatio);
      if (!b64) {
        results.push({
          sideName: render.sideName,
          panelUrl: null,
          success: false,
          error: "Gemini failed to generate a panel",
          description,
        });
        continue;
      }

      // Decode base64 → bytes
      const binaryString = atob(b64);
      const rawBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) rawBytes[i] = binaryString.charCodeAt(i);

      // Upload native panel first (fallback if upscaler fails)
      const timestamp = Date.now();
      const nativeName = `panels/from-render/${timestamp}_${render.sideName}_native.png`;
      const { error: nativeUploadError } = await supabase.storage
        .from("wrap-files")
        .upload(nativeName, rawBytes, { contentType: "image/png", upsert: true });
      if (nativeUploadError) {
        console.error(`[FlatPanelFromRender] Native upload error for ${render.sideName}:`, nativeUploadError);
        results.push({
          sideName: render.sideName,
          panelUrl: null,
          success: false,
          error: "Upload failed",
          description,
        });
        continue;
      }
      const { data: { publicUrl: nativeUrl } } = supabase.storage.from("wrap-files").getPublicUrl(nativeName);

      // Step C — Real-ESRGAN 4x → print-ready
      let finalUrl = nativeUrl;
      try {
        console.log(`[FlatPanelFromRender] ${render.sideName} → invoking upscale-production-panel (4x)`);
        const { data: upData, error: upErr } = await supabase.functions.invoke(
          "upscale-production-panel",
          { body: { image_url: nativeUrl, scale: 4 } },
        );
        if (upErr) {
          console.warn(`[FlatPanelFromRender] Upscale invoke failed for ${render.sideName}:`, upErr.message);
        } else if (upData?.success && upData?.upscaled_url) {
          finalUrl = upData.upscaled_url;
          console.log(`[FlatPanelFromRender] ${render.sideName} upscaled in ${upData.elapsed_ms}ms`);
        } else {
          console.warn(`[FlatPanelFromRender] Upscale returned no URL — using native (${upData?.error || "unknown"})`);
        }
      } catch (err: any) {
        console.warn(`[FlatPanelFromRender] Upscale error — using native:`, err?.message);
      }

      results.push({
        sideName: render.sideName,
        panelUrl: finalUrl,
        success: true,
        description,
      });

      console.log(`[FlatPanelFromRender] ${render.sideName} complete: ${finalUrl}`);

      if (renderList.indexOf(render) < renderList.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // Insert one record per successful panel
    const successfulPanels = results.filter(r => r.success);
    for (const panel of successfulPanels) {
      const panelDesignName = `${designName} — ${panel.sideName.replace(/_/g, " ")}`;
      const { error: insertError } = await supabase
        .from("designpanelpro_patterns")
        .insert({
          name: panelDesignName,
          ai_generated_name: panelDesignName,
          media_url: panel.panelUrl,
          production_file_url: panel.panelUrl,
          clean_display_url: panel.panelUrl,
          category: category || "restyle",
          is_active: true,
          is_curated: true,
          uploaded_by: userId,
        });
      if (insertError) {
        console.warn(`[FlatPanelFromRender] Insert error for ${panel.sideName}:`, insertError.message);
      }
    }

    const totalSuccess = results.filter(r => r.success).length;
    const totalFailed = results.filter(r => !r.success).length;
    console.log(`[FlatPanelFromRender] Complete: ${totalSuccess} success, ${totalFailed} failed`);

    return new Response(
      JSON.stringify({
        designName,
        results,
        totalSuccess,
        totalFailed,
        success: totalSuccess > 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[FlatPanelFromRender] Error:", err);
    return new Response(
      JSON.stringify({ error: "Unexpected failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
