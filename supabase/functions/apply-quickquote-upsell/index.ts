/**
 * apply-quickquote-upsell — isolated Gemini image-edit pipeline driven
 * from the QuickQuote estimator's "Pitch an upsell" button strip.
 *
 * Mirrors apply-precision-modification 1:1 but lives at its own URL so
 * the QuickQuote-driven upsell flow can evolve without touching the
 * working tool-side PrecisionModButtons path used by DesignPro and
 * ColorPro. Reads the same `precision_modifications` catalog so a single
 * source of truth still drives both UIs.
 *
 * Input:  { renderUrl: string, modificationKey: string }
 * Output: {
 *   newRenderUrl: string,
 *   lineItem: {
 *     label: string,
 *     description?: string,
 *     unitPrice: number,
 *     unit: "each",
 *     source: "upsell"
 *   }
 * }
 *
 * verify_jwt = false in config.toml — the QuickQuote drawer is only
 * surfaced inside auth-gated tool pages.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

interface ApplyRequest {
  renderUrl: string;
  modificationKey: string;
}

interface PrecisionModification {
  id: string;
  key: string;
  label: string;
  description: string | null;
  base_price: number;
  applies_to: string[];
  gemini_prompt_template: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: ApplyRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { renderUrl, modificationKey } = body;
  if (!renderUrl || !modificationKey) {
    return json({ error: "renderUrl and modificationKey are required" }, 400);
  }

  if (!hasGeminiKey()) {
    return json({ error: "Gemini API key not configured" }, 503);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Supabase env not configured" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: modRow, error: modErr } = await supabase
    .from("precision_modifications")
    .select(
      "id, key, label, description, base_price, applies_to, gemini_prompt_template",
    )
    .eq("key", modificationKey)
    .eq("is_active", true)
    .maybeSingle();

  if (modErr) {
    console.error("[apply-quickquote-upsell] lookup failed:", modErr);
    return json({ error: `Catalog lookup failed: ${modErr.message}` }, 500);
  }
  if (!modRow) {
    // No matching mod — return a soft "no-op" so the caller can fall back
    // to a plain line-item add without the visual edit.
    return json(
      {
        newRenderUrl: null,
        lineItem: null,
        unsupported: true,
        reason: `No precision modification mapped for key "${modificationKey}"`,
      },
      200,
    );
  }
  const mod = modRow as PrecisionModification;

  let sourceMime = "image/png";
  let sourceB64: string;
  try {
    const imgResp = await fetch(renderUrl);
    if (!imgResp.ok) {
      return json(
        { error: `Source render fetch failed: ${imgResp.status}` },
        400,
      );
    }
    sourceMime = imgResp.headers.get("content-type") || "image/png";
    const buf = new Uint8Array(await imgResp.arrayBuffer());
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    sourceB64 = btoa(bin);
  } catch (e) {
    console.error("[apply-quickquote-upsell] source fetch error:", e);
    return json({ error: "Could not load source render" }, 502);
  }

  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getGeminiKey()}`;

  const geminiBody = {
    contents: [{
      parts: [
        { text: mod.gemini_prompt_template },
        { inlineData: { mimeType: sourceMime, data: sourceB64 } },
      ],
    }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      responseMimeType: "text/plain",
      imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
      temperature: 0.05,
    },
  };

  let geminiResp: Response | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      geminiResp = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
      });
      if (geminiResp.ok) break;

      const status = geminiResp.status;
      const errText = await geminiResp.text();
      lastErr = `Gemini ${status}: ${errText}`;
      console.error(`[apply-quickquote-upsell] attempt ${attempt + 1} failed:`, lastErr);

      if (status === 403) return json({ error: "Gemini API access denied" }, 403);
      if (status >= 400 && status < 500 && status !== 429) {
        return json({ error: `Gemini rejected request: ${errText}` }, 400);
      }
      const wait = 2 ** (attempt + 1) * 1000;
      await new Promise((r) => setTimeout(r, wait));
    } catch (fetchErr) {
      lastErr = String(fetchErr);
      console.error(`[apply-quickquote-upsell] fetch err attempt ${attempt + 1}:`, lastErr);
      const wait = 2 ** (attempt + 1) * 1000;
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  if (!geminiResp || !geminiResp.ok) {
    return json({ error: `Gemini failed after retries: ${lastErr}` }, 502);
  }

  const data = await geminiResp.json();
  const candidates = data.candidates ?? [];
  let outB64 = "";
  let outMime = "image/png";
  for (const cand of candidates) {
    const parts = cand.content?.parts ?? [];
    for (const part of parts) {
      const inline = part.inlineData ?? part.inline_data;
      if (inline?.data) {
        outB64 = inline.data;
        outMime = inline.mimeType || inline.mime_type || "image/png";
        break;
      }
    }
    if (outB64) break;
  }

  if (!outB64) {
    console.error(
      "[apply-quickquote-upsell] No image in Gemini response:",
      JSON.stringify(data).slice(0, 500),
    );
    return json({ error: "Gemini returned no image — try again" }, 502);
  }

  const ext = outMime.includes("jpeg") || outMime.includes("jpg") ? "jpg" : "png";
  const path = `renders/quickquote-upsells/${mod.key}_${Date.now()}.${ext}`;
  const bytes = Uint8Array.from(atob(outB64), (c) => c.charCodeAt(0));

  const { error: uploadErr } = await supabase.storage
    .from("wrap-files")
    .upload(path, bytes, { contentType: outMime, upsert: false });

  if (uploadErr) {
    console.error("[apply-quickquote-upsell] upload failed:", uploadErr);
    return json({ error: `Upload failed: ${uploadErr.message}` }, 500);
  }

  const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);

  return json({
    newRenderUrl: urlData.publicUrl,
    lineItem: {
      label: mod.label,
      description: mod.description ?? undefined,
      unitPrice: Number(mod.base_price),
      unit: "each",
      source: "upsell",
    },
  });
});
