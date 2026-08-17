/**
 * studio-board-edit
 *
 * Minor, surgical AI edits for the Studio Board. Takes an existing image (a
 * Gemini Studio flat artwork the operator uploaded) plus a natural-language
 * instruction (e.g. "boost the blue saturation, add depth, fix the stars") and
 * returns a NEW edited image with that change applied — everything else kept.
 *
 * Image-first, instruction-last, minimal system prompt, low temperature — the
 * pattern that makes gemini-3-pro-image-preview EDIT rather than regenerate.
 *
 * Unlike edit-flat-panel this is GENERIC: it does NOT force flat-panel/bleed
 * rules and does NOT write to any product table. It only uploads the result to
 * the wrap-files bucket and returns its public URL, which the caller attaches
 * to the job's qc_side_panels[sideKey].gemini_url.
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
  maxBytes = 8_388_608,
): Promise<{ base64: string; mime: string } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`[StudioBoardEdit] fetchImage HTTP ${resp.status}`);
      return null;
    }
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      console.warn(`[StudioBoardEdit] Source image too large: ${buf.byteLength}b`);
      return null;
    }
    return {
      base64: uint8ToBase64(new Uint8Array(buf)),
      mime: resp.headers.get("content-type") || "image/png",
    };
  } catch (e: any) {
    console.warn(`[StudioBoardEdit] fetchImage error: ${e?.message}`);
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
    const { imageUrl, editInstruction, jobId, sideKey, referenceUrl } = body || {};

    if (!imageUrl || !editInstruction || !String(editInstruction).trim()) {
      return new Response(
        JSON.stringify({ error: "Missing imageUrl or editInstruction" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ── Fetch the source image ─────────────────────────────────────
    const source = await fetchImage(imageUrl);
    if (!source) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch source image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Optional reference image (e.g. the 3D panel render) to match colors,
    // gradients, depth and lighting against — without copying its framing.
    const reference = referenceUrl ? await fetchImage(referenceUrl) : null;

    // ── Build surgical edit prompt (image first, instruction last) ──
    const parts: GeminiPart[] = [
      {
        text:
          "SOURCE IMAGE — this is the existing artwork to edit. Keep every shape, layout element, composition and framing EXACTLY the same EXCEPT for the change requested below.",
      },
      { inlineData: { mimeType: source.mime, data: source.base64 } },
    ];
    if (reference) {
      parts.push({
        text:
          "REFERENCE IMAGE — make the SOURCE's colors, gradients, depth, shading, contrast and finish match this reference EXACTLY. Sample the exact hues and the way tones transition (e.g. the blue's gradient and shadow). Do NOT copy the reference's layout, cropping, perspective or subject — only reproduce its exact color and depth treatment on the source.",
      });
      parts.push({ inlineData: { mimeType: reference.mime, data: reference.base64 } });
    }
    parts.push({
      text: [
        `Apply this minor edit and nothing else: ${String(editInstruction).trim()}`,
        reference ? `Match the REFERENCE image EXACTLY for color, gradient, depth and finish.` : ``,
        ``,
        `Rules:`,
        `- Keep the SAME framing, aspect ratio, crop and subject as the SOURCE image.`,
        `- Change ONLY color/gradient/depth to match (and whatever the instruction says); leave the layout and shapes identical.`,
        `- Do not add text, captions, labels, watermarks or borders.`,
        `- Photorealistic, high detail, preserve the design's identity.`,
      ].filter(Boolean).join("\n"),
    });

    const systemInstruction =
      "You perform precise minor edits on an existing image. Given a source image and a change request, output the source image with EXACTLY that change applied and nothing else. Preserve the original framing, aspect ratio, colors and composition apart from the requested change. Never redesign, reinterpret, re-crop, or add text/watermarks.";

    // ── Gemini call (2 attempts) ───────────────────────────────────
    const MAX_ATTEMPTS = 2;
    let imageBase64: string | null = null;
    let imageMimeType = "image/png";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const key = getGeminiKey();
      console.log(`[StudioBoardEdit] Attempt ${attempt}/${MAX_ATTEMPTS}, key ${key.slice(0, 8)}...`);
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
                imageConfig: { imageSize: "2K" },
                temperature: 0.2,
                topP: 0.9,
              },
            }),
            signal: AbortSignal.timeout(90_000),
          },
        );

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "");
          console.warn(`[StudioBoardEdit] HTTP ${resp.status}: ${errText.slice(0, 200)}`);
          if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 2000)); continue; }
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
        if (imageBase64) { console.log(`[StudioBoardEdit] Image returned on attempt ${attempt}`); break; }

        const finishReason = result.candidates?.[0]?.finishReason;
        console.warn(`[StudioBoardEdit] No image (finishReason=${finishReason})`);
        if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 2000)); }
      } catch (err: any) {
        console.error(`[StudioBoardEdit] Error attempt ${attempt}:`, err?.message);
        if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 2000)); }
      }
    }

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "No image generated — try a shorter, more specific instruction." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Upload the edited image ────────────────────────────────────
    const timestamp = Date.now();
    const ext = imageMimeType.includes("jpeg") ? "jpg" : "png";
    const folder = jobId ? `gemini-compare/${jobId}` : "studio-board/edits";
    const safeSide = (sideKey || "edit").toString().replace(/[^a-z0-9_-]/gi, "");
    const fileName = `${folder}/${safeSide}_aiedit_${timestamp}.${ext}`;

    const binaryString = atob(imageBase64);
    const imageData = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) imageData[i] = binaryString.charCodeAt(i);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, imageData, { contentType: imageMimeType, upsert: true });

    if (uploadError) {
      console.error("[StudioBoardEdit] Upload error:", uploadError);
      return new Response(
        JSON.stringify({ error: "Failed to upload edited image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
    console.log(`[StudioBoardEdit] Edit complete → ${publicUrl}`);

    return new Response(
      JSON.stringify({ url: `${publicUrl}?t=${timestamp}`, success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[StudioBoardEdit] Error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Unexpected failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
