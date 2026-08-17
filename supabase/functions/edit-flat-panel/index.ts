/**
 * edit-flat-panel
 *
 * Re-runs an existing flat panel through gemini-3-pro-image-preview to apply
 * a natural-language EDIT (e.g., "make this fully flat 2D, no 3D, with edge-
 * to-edge artwork and a 2 inch bleed all around"). The original panel image
 * is sent as the base, and the user's instruction is applied surgically.
 *
 * Used by AdminDesignPanelBatch's "Edit & Redo" dialog so an operator can
 * fix individual library panels without re-rolling the whole prompt.
 *
 * Pattern mirrors panelizer-qc-edit-panel: image-first, instruction-last,
 * minimal system instruction, deterministic temperature.
 *
 * Updates designpanelpro_patterns row in place — media_url, production_file_url,
 * and clean_display_url are all rewritten to the new image so RestyleLibrary,
 * the visualizer, and print fulfillment all pick up the corrected version.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Inlined gemini-key-pool (MCP deploy can't resolve _shared imports) ──
const _pool: string[] = [];
let _loaded = false;
let _idx = 0;
function _loadKeys(): void {
  if (_loaded) return;
  const primary = Deno.env.get("GOOGLE_AI_API_KEY");
  if (primary) _pool.push(primary);
  for (let i = 2; i <= 5; i++) {
    const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`);
    if (k) _pool.push(k);
  }
  _loaded = true;
}
function getGeminiKey(): string {
  _loadKeys();
  if (_pool.length === 0) throw new Error("No GOOGLE_AI_API_KEY configured");
  const key = _pool[_idx % _pool.length];
  _idx++;
  return key;
}
function hasGeminiKey(): boolean {
  _loadKeys();
  return _pool.length > 0;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-3-pro-image-preview";
const BUCKET = "wrap-files";

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function fetchImage(
  url: string,
  maxBytes = 5_242_880,
): Promise<{ base64: string; mime: string } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`[EditFlatPanel] fetchImage HTTP ${resp.status}`);
      return null;
    }
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      console.warn(`[EditFlatPanel] Source image too large: ${buf.byteLength}b`);
      return null;
    }
    return {
      base64: uint8ToBase64(new Uint8Array(buf)),
      mime: resp.headers.get("content-type") || "image/png",
    };
  } catch (e: any) {
    console.warn(`[EditFlatPanel] fetchImage error: ${e?.message}`);
    return null;
  }
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      imageUrl,
      editInstruction,
      patternId,
      finish = "Gloss",
    } = body;

    if (!imageUrl || !editInstruction) {
      return new Response(
        JSON.stringify({ error: "Missing imageUrl or editInstruction" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ── Fetch the source panel ─────────────────────────────────────
    const source = await fetchImage(imageUrl);
    if (!source) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch source panel image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build edit prompt ──────────────────────────────────────────
    // Image-first, instruction-last so Gemini's attention lands on the
    // source image. Keep the prompt surgical — long prompts cause
    // Gemini-3-Pro-Image to regenerate instead of edit.
    const parts: GeminiPart[] = [
      {
        text:
          "SOURCE PANEL — this is the existing flat panel artwork to edit. Your output must keep every color, shape, layout element, and stylistic decision EXCEPT for the specific change requested below.",
      },
      {
        inlineData: { mimeType: source.mime, data: source.base64 },
      },
      {
        text: [
          `EDIT this flat vehicle wrap panel.`,
          ``,
          `Change to apply: ${editInstruction.trim()}`,
          ``,
          `Rules:`,
          `- Output a flat 2D rectangular panel — NO vehicle, NO car body, NO 3D perspective, NO wheels, NO windows.`,
          `- Front-on orthographic view, zero camera angle.`,
          `- The artwork MUST touch all four edges of the canvas. Every pixel is design — zero white border, zero margin, zero empty space.`,
          `- The design extends 2 inches past the visible panel edge on all four sides (print bleed) — the bleed area is filled with the same artwork, never with white.`,
          `- ${finish} finish appearance.`,
          `- No text labels, no dimension captions, no size strips, no watermarks.`,
          `- Preserve the design's identity — do not redesign or reinterpret. Apply the change above and nothing else.`,
        ].join("\n"),
      },
    ];

    const systemInstruction =
      "You perform precision edits on flat 2D vehicle wrap panel artwork. Given a source panel and a change request, output the source panel with EXACTLY that change applied — nothing else. Output is always a flat rectangular panel that fills the canvas edge-to-edge with a 2 inch bleed on all sides. Never output a 3D render, vehicle photo, or panel with empty borders.";

    // ── Gemini call ────────────────────────────────────────────────
    const MAX_ATTEMPTS = 2;
    let imageBase64: string | null = null;
    let imageMimeType = "image/png";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const key = getGeminiKey();
      console.log(`[EditFlatPanel] Attempt ${attempt}/${MAX_ATTEMPTS}, key ${key.slice(0, 8)}...`);

      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemInstruction }] },
              contents: [{ role: "user", parts }],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
                temperature: 0.2,
                topP: 0.9,
              },
            }),
            signal: AbortSignal.timeout(90_000),
          },
        );

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "");
          console.warn(`[EditFlatPanel] HTTP ${resp.status}: ${errText.slice(0, 200)}`);
          if (attempt < MAX_ATTEMPTS) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          return new Response(
            JSON.stringify({ error: `Gemini edit failed (HTTP ${resp.status})` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const result = await resp.json();
        for (const candidate of result.candidates || []) {
          for (const part of candidate.content?.parts || []) {
            if (part.inlineData?.data) {
              imageBase64 = part.inlineData.data;
              imageMimeType = part.inlineData.mimeType || "image/png";
            }
          }
        }

        if (imageBase64) {
          console.log(`[EditFlatPanel] Image returned on attempt ${attempt}`);
          break;
        }

        const finishReason = result.candidates?.[0]?.finishReason;
        console.warn(`[EditFlatPanel] No image (finishReason=${finishReason})`);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (err: any) {
        console.error(`[EditFlatPanel] Error attempt ${attempt}:`, err?.message);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "No image generated after retries" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Upload corrected panel ─────────────────────────────────────
    const timestamp = Date.now();
    const ext = imageMimeType.includes("jpeg") ? "jpg" : "png";
    const fileName = `panels/edits/${timestamp}_flat-panel-edit.${ext}`;

    const binaryString = atob(imageBase64);
    const imageData = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      imageData[i] = binaryString.charCodeAt(i);
    }

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, imageData, { contentType: imageMimeType, upsert: true });

    if (uploadError) {
      console.error("[EditFlatPanel] Upload error:", uploadError);
      return new Response(
        JSON.stringify({ error: "Failed to upload edited panel" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(fileName);

    // ── Update existing pattern row in place ───────────────────────
    if (patternId) {
      const { error: updateError } = await supabase
        .from("designpanelpro_patterns")
        .update({
          media_url: publicUrl,
          production_file_url: publicUrl,
          clean_display_url: publicUrl,
        })
        .eq("id", patternId);

      if (updateError) {
        console.warn("[EditFlatPanel] DB update error (non-fatal):", updateError.message);
      }
    }

    console.log(`[EditFlatPanel] Edit complete → ${publicUrl}`);

    return new Response(
      JSON.stringify({
        panelUrl: publicUrl,
        patternId: patternId || null,
        success: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[EditFlatPanel] Error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Unexpected failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
