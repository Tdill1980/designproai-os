/**
 * precise-erase — Deterministic targeted-region edit via Gemini.
 *
 * Why this exists: Flux Fill / Clipdrop / LaMa all proved unreliable for
 * vehicle-wrap inpainting (they hallucinate stripes back, smear panels, or
 * fail on metallic / gloss reflections). Gemini-3-pro-image-preview, given
 * a source image with a magenta marker overlay and a strict material-
 * extension system prompt, behaves like an intelligent clone-stamp: it
 * removes whatever sits inside the magenta region and continues the
 * surrounding wrap material across the cleared area — exact color, exact
 * finish, exact panel curvature, zero new graphics.
 *
 * Pipeline:
 *   1. Frontend (PreciseEditCanvas) lets the user box-select or SAM2-click
 *      the region. The bbox is painted as a magenta semi-transparent overlay
 *      on a composite PNG which is uploaded to Storage.
 *   2. This edge fn fetches the composite, builds a structured material-
 *      extension prompt from the source render's finish + base color +
 *      vehicle, and sends both to Gemini.
 *   3. Gemini returns an edited image with the magenta marker removed and
 *      the wrap continued seamlessly across that region.
 *
 * The edit is "deterministic" in the sense that the spatial target is
 * pinned by the magenta overlay (not by Gemini's interpretation) and the
 * material is pinned by the system prompt (not by Gemini's creativity).
 *
 * Inputs:
 *   compositeUrl  (required) — source render with magenta marker overlay
 *   originalUrl   (required) — pristine source render (for fallback context)
 *   intent        (optional) — "remove" | "replace" | "color-change", default "remove"
 *   targetColor   (optional) — required when intent === "color-change"
 *   userNote      (optional) — free-text from the user, woven into the prompt
 *   finish        (optional) — "Gloss" | "Satin" | "Matte", default "Gloss"
 *   colorName     (optional) — base color of the wrap surrounding the marker
 *   vehicleYear   (optional)
 *   vehicleMake   (optional)
 *   vehicleModel  (optional)
 *   toolType      (optional) — for storage path organization
 *
 * Output: { renderUrl, refunded? }
 *
 * Token gate: 1 token per call (reason: "precise_erase"). Refunded on
 * Gemini failure / missing API key / unhandled exception so users don't
 * lose tokens to outages.
 */

export const maxDuration = 60;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { tokenGate, refundToken } from "../_shared/token-gate.ts";

// ---------------------------------------------------------------------------
// Material-extension prompt builder
// ---------------------------------------------------------------------------

interface MagicErasePromptCtx {
  intent: "remove" | "replace" | "color-change";
  targetColor?: string;
  userNote?: string;
  finish: string;
  colorName: string;
  vehicleLabel: string;
}

function buildMagicErasePrompt(ctx: MagicErasePromptCtx): {
  systemInstruction: string;
  userPrompt: string;
} {
  const finish = ctx.finish.toLowerCase();
  const color = ctx.colorName.toLowerCase();
  const veh = ctx.vehicleLabel;

  const isRemoval = ctx.intent === "remove" || ctx.intent === "replace";
  const isColorChange = ctx.intent === "color-change";

  const insideRule = isRemoval
    ? [
        `Inside the magenta region: REMOVE whatever is currently there (stripes, logos, text, graphics, decals, patterns).`,
        `INFILL by seamlessly extending the surrounding wrap material across the entire magenta area.`,
        `The infill must match the surrounding ${finish} ${color} vinyl exactly — same color value, same finish character (${finish === "matte" ? "no shine, no highlights" : finish === "satin" ? "soft sheen, gentle highlights" : "mirror-like reflections, sharp highlights"}), same lighting direction, same panel curvature, same reflections.`,
        `Treat this like an intelligent clone-stamp tool, not a creative paintbrush.`,
      ].join(" ")
    : isColorChange
    ? [
        `Inside the magenta region: REPAINT as ${ctx.targetColor || "the requested color"} ${finish} vinyl wrap.`,
        `Match the surrounding panel curvature, lighting direction, and reflections.`,
        `Smooth professional automotive wrap installation — no stripes, no graphics, no patterns, just clean ${ctx.targetColor || "new color"} ${finish} wrap.`,
      ].join(" ")
    : `Inside the magenta region: apply the user's instruction below while preserving the wrap material character of the surrounding panel.`;

  const systemInstruction = [
    `You are an expert vehicle wrap print production engine performing surgical material-extension edits on a ${veh}.`,
    ``,
    `The attached image has a magenta semi-transparent overlay marking ONE region to MODIFY.`,
    ``,
    insideRule,
    ``,
    `Outside the magenta region: every pixel MUST remain bit-identical to the input image. Do not modify, harmonize, smooth, or "improve" anything outside the marker. Other panels, other graphics, other reflections, the background, the lighting — all stay untouched.`,
    ``,
    `ABSOLUTE NEGATIVES: no new graphics, no new text, no new logos, no new stripes, no new patterns, no new decals. The magenta overlay itself MUST be completely gone from the output — replaced by clean continuation of the wrap material as if nothing was ever there.`,
    ``,
    `ABSOLUTE CAMERA: preserve the EXACT camera angle, perspective, framing, and field of view of the input. Never rotate, tilt, zoom, or change viewpoint.`,
    ``,
    `Return the edited image with the magenta marker completely removed.`,
  ].join("\n");

  const intentLine = isRemoval
    ? `Remove whatever is inside the magenta region on this ${veh} and continue the ${finish} ${color} wrap material across that area seamlessly.`
    : isColorChange
    ? `Repaint the magenta region of this ${veh} as ${ctx.targetColor || "the requested color"} ${finish} vinyl wrap.`
    : `Apply the user's edit inside the magenta region on this ${veh}.`;

  const userPrompt = [
    intentLine,
    ctx.userNote && ctx.userNote.trim() ? `User context: "${ctx.userNote.trim()}".` : "",
    `The magenta marker must disappear in the output — replaced by clean wrap surface that matches the surrounding panel pixel-perfectly.`,
  ].filter(Boolean).join(" ");

  return { systemInstruction, userPrompt };
}

// ---------------------------------------------------------------------------
// Helpers (mirror revise-render's patterns so behaviour matches)
// ---------------------------------------------------------------------------

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Deno/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
  const contentType = res.headers.get("content-type") || "image/png";
  const buf = await res.arrayBuffer();
  const uint8 = new Uint8Array(buf);
  let bin = "";
  const chunkSize = 8192;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
    bin += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return { data: btoa(bin), mimeType: contentType };
}

async function uploadToStorage(
  supabase: any,
  base64: string,
  mimeType: string,
  userId: string,
  toolType: string,
): Promise<string> {
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const fileName = `renders/${userId}/precise-erase/${toolType}_${Date.now()}.${ext}`;
  const binaryStr = atob(base64);
  const imageData = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) imageData[i] = binaryStr.charCodeAt(i);
  const { error } = await supabase.storage
    .from("wrap-files")
    .upload(fileName, imageData, { contentType: mimeType, upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(fileName);
  return publicUrl;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 1 token per precise-erase call. Refunded below on any failure that occurs
  // after the gate granted entry, so users don't bleed tokens on outages.
  const gate = await tokenGate(req, { reason: "precise_erase" });
  if (!gate.ok) return gate.response!;
  const gateUserId = gate.userId || "";
  const gateSource = gate.source || "tokens";
  const refundIfPaid = async (reason: string) => {
    if (gateUserId && gateSource === "tokens") {
      await refundToken(gateUserId, 1, `precise_erase_${reason}`);
    }
  };

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!authHeader || authHeader === "Bearer") {
      return new Response(
        JSON.stringify({ code: "AUTH_ERROR", message: "No authorization token provided" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ code: "AUTH_ERROR", message: `Not authenticated: ${authError?.message || "no user"}` }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const {
      compositeUrl,
      originalUrl,
      intent = "remove",
      targetColor,
      userNote,
      finish = "Gloss",
      colorName = "matching base color",
      vehicleYear,
      vehicleMake,
      vehicleModel,
      toolType = "revision",
    } = body;

    if (!compositeUrl) {
      return new Response(
        JSON.stringify({ code: "MISSING_PARAM", message: "compositeUrl is required (source render with magenta marker overlay)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!hasGeminiKey()) {
      await refundIfPaid("no_api_key");
      return new Response(
        JSON.stringify({ code: "SYSTEM_ERROR", message: "API key not configured", refunded: gateSource === "tokens" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const vehicleLabel = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ").trim() || "vehicle";

    console.log(`[precise-erase] user=${user.id.substring(0, 8)} intent=${intent} veh="${vehicleLabel}" finish=${finish} color="${colorName}"`);

    const compositeImage = await fetchImageAsBase64(compositeUrl);
    console.log(`[precise-erase] Composite loaded: ${(compositeImage.data.length / 1024).toFixed(0)} KB`);

    const { systemInstruction, userPrompt } = buildMagicErasePrompt({
      intent: intent as any,
      targetColor,
      userNote,
      finish,
      colorName,
      vehicleLabel,
    });

    // Image-first user turn so Gemini's attention starts on the picture, then
    // the edit instruction. The pristine original is a secondary reference —
    // useful for Pro but the second base64 image roughly doubles the
    // in-memory payload, which has been pushing storefront / glass workers
    // past the 256MB ceiling (status 546 / WORKER_LIMIT). We send it on Pro
    // only; the Flash retry drops it so the lighter model has a clean shot.
    let originalImageCache: { mimeType: string; data: string } | null = null;
    if (originalUrl) {
      try {
        originalImageCache = await fetchImageAsBase64(originalUrl);
      } catch (e) {
        console.warn(`[precise-erase] Original reference fetch failed (non-fatal): ${(e as Error).message}`);
      }
    }

    const buildUserParts = (includeOriginal: boolean): Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> => {
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        { inlineData: { mimeType: compositeImage.mimeType, data: compositeImage.data } },
      ];
      if (includeOriginal && originalImageCache) {
        parts.push({ inlineData: { mimeType: originalImageCache.mimeType, data: originalImageCache.data } });
        parts.push({ text: "The second image is the pristine source (no magenta overlay) for reference of the surrounding wrap material." });
      }
      parts.push({ text: userPrompt });
      return parts;
    };

    const systemInstructionPayload = { parts: [{ text: systemInstruction }] };

    // Same 2-tier fallback as revise-render. Pro → Flash if Pro fails.
    // Per-tier timeout MUST leave room for the next tier under the 60s
    // function-level maxDuration ceiling. 35s + 25s = 60s worst case, so a
    // Flash retry always has a real chance to run. (Previously both tiers
    // used 50s, which guaranteed Flash would never finish before Supabase
    // killed the worker with status 546 / WORKER_LIMIT — exactly what
    // storefront / glass renders were hitting in production.)
    const tiers = [
      { model: "gemini-3-pro-image-preview", imageSize: "4K", label: "Pro", timeoutMs: 35_000 },
      { model: "gemini-3.1-flash-image-preview", imageSize: "2K", label: "Flash", timeoutMs: 25_000 },
    ];

    let imageBase64: string | null = null;
    let imageMimeType = "image/png";
    let lastError = "";

    for (let tierIdx = 0; tierIdx < tiers.length; tierIdx++) {
      const tier = tiers[tierIdx];
      const isProTier = tierIdx === 0;
      const userParts = buildUserParts(isProTier);
      const contents = [{ role: "user", parts: userParts }];

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${tier.model}:generateContent?key=${getGeminiKey()}`;
      console.log(`[precise-erase] Attempting ${tier.label} (${tier.model}), imageSize=${tier.imageSize}, parts=${userParts.length}`);
      try {
        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: systemInstructionPayload,
            contents,
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: { aspectRatio: "16:9", imageSize: tier.imageSize },
            },
          }),
          signal: AbortSignal.timeout(tier.timeoutMs),
        });

        if (!response.ok) {
          const errText = await response.text();
          lastError = `${tier.label} HTTP ${response.status}: ${errText.substring(0, 200)}`;
          console.error(`[precise-erase] ${lastError}`);
          continue;
        }

        const result = await response.json();
        const finishReason = result.candidates?.[0]?.finishReason;
        if (finishReason === "NO_IMAGE") {
          lastError = `${tier.label}: NO_IMAGE — Gemini chose text over image`;
          console.warn(`[precise-erase] ${lastError}`);
          continue;
        }
        if (finishReason && finishReason !== "STOP") {
          lastError = `${tier.label}: finishReason=${finishReason}`;
          console.warn(`[precise-erase] ${lastError}`);
          continue;
        }

        const responseParts = result.candidates?.[0]?.content?.parts || [];
        for (const part of responseParts) {
          if (part.inlineData) {
            imageBase64 = part.inlineData.data;
            imageMimeType = part.inlineData.mimeType || "image/png";
            break;
          }
        }
        if (imageBase64) {
          console.log(`[precise-erase] ✅ Success with ${tier.label}`);
          break;
        } else {
          lastError = `${tier.label}: No image in response parts`;
          console.warn(`[precise-erase] ${lastError}`);
        }
      } catch (err) {
        lastError = `${tier.label}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[precise-erase] ${lastError}`);
      }
    }

    if (!imageBase64) {
      await refundIfPaid("gemini_no_image");
      return new Response(
        JSON.stringify({
          code: "RENDER_FAILED",
          message: `The AI couldn't produce that erase (Gemini error). Your token was refunded — try a tighter selection or different prompt. Detail: ${lastError}`,
          refunded: gateSource === "tokens",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const renderUrl = await uploadToStorage(serviceClient, imageBase64, imageMimeType, user.id, toolType);
    console.log(`[precise-erase] ✅ Uploaded: ${renderUrl.substring(0, 80)}...`);

    return new Response(
      JSON.stringify({ renderUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[precise-erase] Unhandled: ${message}`);
    await refundIfPaid("unhandled_error");
    return new Response(
      JSON.stringify({ code: "INTERNAL_ERROR", message, refunded: gateSource === "tokens" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
