/**
 * apply-precision-modification — Gemini image-edit pipeline for the
 * precision-add buttons on each design tool.
 *
 * Input:  { renderUrl: string, modificationKey: string }
 *
 * Output: {
 *   newRenderUrl: string,           // hosted URL of the edited image
 *   lineItem: {
 *     label: string,
 *     description?: string,
 *     unitPrice: number,
 *     unit: "each",
 *     source: "upsell"
 *   }
 * }
 *
 * Flow:
 *   1. Look up the modification by key in `precision_modifications`
 *   2. Fetch the source image (the current displayed render — may
 *      itself be a previously-modified render so mods stack visually)
 *   3. Call Gemini gemini-3-pro-image-preview with the prompt template
 *      and the source image as inlineData
 *   4. Upload the edited image to wrap-files/renders/precision-mods/
 *   5. Return the new public URL plus the line-item shape the
 *      frontend hook hands to the estimator
 *
 * The tool page sets the returned newRenderUrl as its "displayed"
 * image so the next click STACKS on top of the modified render
 * (chrome delete + then racing stripe + then carbon fiber roof =
 * all three visible at once).
 *
 * verify_jwt = false in config.toml — this is a tool-side action;
 * gating happens at the page level (the floating drawer + the
 * tool surface are already auth-protected).
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

  // ─── 1. Look up the modification ──────────────────────────────────
  const { data: modRow, error: modErr } = await supabase
    .from("precision_modifications")
    .select(
      "id, key, label, description, base_price, applies_to, gemini_prompt_template",
    )
    .eq("key", modificationKey)
    .eq("is_active", true)
    .maybeSingle();

  if (modErr) {
    console.error("[apply-precision-modification] lookup failed:", modErr);
    return json({ error: `Catalog lookup failed: ${modErr.message}` }, 500);
  }
  if (!modRow) {
    return json({ error: `Modification not found: ${modificationKey}` }, 404);
  }
  const mod = modRow as PrecisionModification;

  // ─── 2. Fetch the source image ────────────────────────────────────
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
    // Chunked btoa keeps us under the call-stack limit on huge images.
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    sourceB64 = btoa(bin);
  } catch (e) {
    console.error("[apply-precision-modification] source fetch error:", e);
    return json({ error: "Could not load source render" }, 502);
  }

  // ─── 3. Call Gemini ──────────────────────────────────────────────
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
      // No responseMimeType — gemini-3-pro-image-preview rejects an
      // IMAGE-modality request constrained to text/plain (400). Matches
      // the golden image call in design-panel-ai-generate.
      imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
      // Precision mods compound visually — keep the model deterministic
      // so colors / wheels / vehicle pose don't drift between stacks.
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
      console.error(`[apply-precision-modification] attempt ${attempt + 1} failed:`, lastErr);

      if (status === 403) return json({ error: "Gemini API access denied" }, 403);
      if (status >= 400 && status < 500 && status !== 429) {
        return json({ error: `Gemini rejected request: ${errText}` }, 400);
      }
      const wait = 2 ** (attempt + 1) * 1000;
      await new Promise((r) => setTimeout(r, wait));
    } catch (fetchErr) {
      lastErr = String(fetchErr);
      console.error(`[apply-precision-modification] fetch err attempt ${attempt + 1}:`, lastErr);
      const wait = 2 ** (attempt + 1) * 1000;
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  if (!geminiResp || !geminiResp.ok) {
    return json({ error: `Gemini failed after retries: ${lastErr}` }, 502);
  }

  // ─── 4. Extract image from Gemini response ────────────────────────
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
      "[apply-precision-modification] No image in Gemini response:",
      JSON.stringify(data).slice(0, 500),
    );
    return json({ error: "Gemini returned no image — try again" }, 502);
  }

  // ─── 5. Upload to wrap-files (existing render bucket) ─────────────
  const ext = outMime.includes("jpeg") || outMime.includes("jpg") ? "jpg" : "png";
  const path = `renders/precision-mods/${mod.key}_${Date.now()}.${ext}`;
  const bytes = Uint8Array.from(atob(outB64), (c) => c.charCodeAt(0));

  const { error: uploadErr } = await supabase.storage
    .from("wrap-files")
    .upload(path, bytes, { contentType: outMime, upsert: false });

  if (uploadErr) {
    console.error("[apply-precision-modification] upload failed:", uploadErr);
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
