/**
 * revise-render-masked — Precise masked edit for RevisionStudioIQ
 *
 * Runs Flux.1 Fill Pro (Black Forest Labs) via Replicate. Unlike Gemini, Flux
 * Fill takes a MASK input — it regenerates ONLY pixels inside the white mask
 * region and leaves everything outside pixel-identical to the source.
 *
 * This is what fixes:
 *   - "remove the phone number" repainting a whole bumper (no more smear)
 *   - color swaps bleeding onto adjacent panels
 *   - small fixes requiring Photoshop-grade precision
 *
 * It DOES NOT replace revise-render (Gemini). RevisionStudioIQ routes:
 *   - Quick edit / whole-image edit → revise-render (Gemini)
 *   - Precise edit (user clicked/drew a mask) → revise-render-masked (this fn)
 *
 * Inputs:
 *   imageUrl   (required) — source image to edit
 *   maskUrl    (required) — PNG mask (white=edit, black=preserve)
 *   prompt     (required) — text describing what should appear in the masked area
 *   toolType   (optional) — for storage organization (colorpro/designpro/fadewraps)
 *   steps      (optional) — Flux steps, default 50 (quality)
 *   guidance   (optional) — Flux guidance, default 60 (Flux Fill uses high guidance)
 *
 * Output: { renderUrl } — public URL of the edited image in Storage.
 */

export const maxDuration = 120;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Overridable via env so ops can pin a specific version or swap to a cheaper
// variant (flux-fill-dev) without a code deploy.
const FLUX_FILL_MODEL =
  Deno.env.get("FLUX_FILL_REPLICATE_MODEL") || "black-forest-labs/flux-fill-pro";

const REPLICATE_API = "https://api.replicate.com/v1";
const POLL_MAX = 90;          // 90 × 1s = 90s ceiling (Flux Fill pro takes ~20-40s)
const POLL_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// Wrap-aware prompt builder
// ---------------------------------------------------------------------------

/**
 * Flux Fill Pro inpaints the masked region using ONLY the prompt — so a bare
 * "remove the stripes" gives the model nothing to paint and we get smeared
 * paint, stripes back, or random garbage. We wrap the user's instruction with:
 *   - intent detection (remove / change color / generic edit)
 *   - the source render's finish + base color + vehicle so Flux knows what
 *     material to continue
 *   - explicit negatives ("no stripes, no logos, no graphics") so it won't
 *     re-add the very thing the user is trying to delete
 */
function buildMaskedEditPrompt(opts: {
  userPrompt: string;
  finish?: string;
  colorName?: string;
  vehicleMake?: string;
  vehicleModel?: string;
}): string {
  const u = (opts.userPrompt || "").trim();
  const lower = u.toLowerCase();
  const finishRaw = (opts.finish || "Gloss").toString();
  const finish = finishRaw.toLowerCase(); // "gloss" | "satin" | "matte"
  const color = (opts.colorName || "").toString().toLowerCase().trim();
  const veh = [opts.vehicleMake, opts.vehicleModel].filter(Boolean).join(" ").trim() || "vehicle";

  const isRemoval = /\b(remove|delete|erase|strip|clean off|take off|get rid of|no more|hide)\b/.test(lower)
    || /\bno (stripes?|logos?|graphics?|text|decals?|patterns?)\b/.test(lower);

  // Glassmorphism / frosted-glass design panel. The generic branch below forces
  // "smooth vinyl wrap / automotive paint" language that fights a translucent
  // glass look, so glass intent gets its own positive, glass-specific prompt.
  const isGlass = /\b(glass\s?morph\w*|glassmorph\w*|frosted\s?glass|frosted|translucent|see-?through|acrylic|glass\s?panel|glassy|smoked\s?glass)\b/.test(lower);

  // "change to red" / "make it blue" / "wrap it matte black" — capture the new color phrase
  const colorChangeMatch =
    lower.match(/(?:change|make|turn|switch|paint|wrap)(?:\s+(?:it|this|the))?(?:\s+\w+)?\s+(?:to|into)\s+([a-z][a-z\s]{1,30}?)(?:[.,!?]|$)/) ||
    lower.match(/(?:change|make|turn|switch|paint|wrap)\s+(?:it|this)\s+([a-z][a-z\s]{1,30}?)(?:[.,!?]|$)/);

  if (isRemoval) {
    const baseColor = color || `matching ${veh} wrap`;
    return [
      `Continue the vehicle wrap surface across the masked area as if nothing was ever there.`,
      `Smooth ${finish} vinyl wrap finish — ${baseColor}.`,
      `Match the color, lighting, reflections, highlights, and panel curvature of the surrounding ${veh} body exactly.`,
      `No stripes, no graphics, no text, no logos, no decals, no patterns, no seams — only the clean uniform wrap material.`,
      u ? `User context: "${u}".` : ``,
    ].filter(Boolean).join(" ");
  }

  if (isGlass) {
    return [
      `Add a translucent frosted glass design panel filling the masked area, applied as an overlay on top of the ${veh} wrap.`,
      `Glassmorphism aesthetic: semi-transparent frosted glass with a soft blurred view of the ${color ? `${color} ` : ""}wrap surface visible through it, a thin bright white edge highlight outlining the panel, subtle glossy specular reflections, a soft inner glow, and a gentle drop shadow where the glass sits on the body.`,
      `Curve the glass panel to follow the ${veh} body contour; keep the surrounding ${finish} vinyl wrap visible around and faintly beneath the glass.`,
      `Photorealistic, crisp glass refraction and realistic lighting.`,
      u ? `User request: "${u}".` : ``,
    ].filter(Boolean).join(" ");
  }

  if (colorChangeMatch) {
    const newColor = colorChangeMatch[1].trim();
    return [
      `Repaint this region as a ${newColor} ${finish} vinyl wrap.`,
      `Smooth professional automotive wrap finish on the ${veh}.`,
      `Match the surrounding panel curvature, lighting direction, highlights, and reflections.`,
      `No stripes, no graphics, no text, no logos, no patterns — just clean ${newColor} wrap surface.`,
    ].join(" ");
  }

  // Generic / unrecognized — preserve the user's intent but anchor it in
  // wrap-photo realism so Flux doesn't invent unrelated content.
  return [
    `${u}.`,
    `${finish} vinyl wrap finish on a ${veh}${color ? ` (base color: ${color})` : ""}.`,
    `Photorealistic, automotive paint reflections, smooth professional installation.`,
    `Match the surrounding panel lighting, curvature, and material exactly.`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function downloadBytes(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  const mimeType = res.headers.get("content-type") || "image/png";
  return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType };
}

async function uploadRender(
  supabase: any,
  bytes: Uint8Array,
  mimeType: string,
  userId: string,
  toolType: string,
): Promise<string> {
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const fileName = `renders/${userId}/revisions/masked_${toolType}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("wrap-files")
    .upload(fileName, bytes, { contentType: mimeType, upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage
    .from("wrap-files")
    .getPublicUrl(fileName);
  return publicUrl;
}

// ---------------------------------------------------------------------------
// Flux Fill Pro via Replicate
// ---------------------------------------------------------------------------

async function runFluxFill(input: {
  imageUrl: string;
  maskUrl: string;
  prompt: string;
  steps: number;
  guidance: number;
}): Promise<{ outputUrl: string } | { error: string }> {
  const key = Deno.env.get("REPLICATE_API_TOKEN");
  if (!key) return { error: "REPLICATE_API_TOKEN not configured" };

  const predResp = await fetch(
    `${REPLICATE_API}/models/${FLUX_FILL_MODEL}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({
        input: {
          image: input.imageUrl,
          mask: input.maskUrl,
          prompt: input.prompt,
          steps: input.steps,
          guidance: input.guidance,
          // Flux Fill Pro-specific knobs. Defaults chosen for edit fidelity
          // on photorealistic vehicle wraps:
          output_format: "png",
          output_quality: 95,
          safety_tolerance: 2,
          prompt_upsampling: false,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!predResp.ok) {
    return { error: `Flux Fill create HTTP ${predResp.status}: ${await predResp.text()}` };
  }

  let prediction = await predResp.json();
  const startMs = Date.now();

  if (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
    for (let i = 0; i < POLL_MAX; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (Date.now() - startMs > 110_000) break;
      const s = await fetch(`${REPLICATE_API}/predictions/${prediction.id}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!s.ok) continue;
      prediction = await s.json();
      if (["succeeded", "failed", "canceled"].includes(prediction.status)) break;
    }
  }

  if (prediction.status !== "succeeded") {
    return { error: `Flux Fill ${prediction.status}: ${prediction.error || "timeout"}` };
  }

  const out = prediction.output;
  const outputUrl: string | undefined =
    typeof out === "string" ? out :
    Array.isArray(out) ? out[0] :
    undefined;
  if (!outputUrl) return { error: "Flux Fill returned no output URL" };
  return { outputUrl };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!authHeader || authHeader === "Bearer") {
      return new Response(
        JSON.stringify({ code: "AUTH_ERROR", message: "No authorization token" }),
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
      imageUrl,
      maskUrl,
      prompt,
      toolType = "revision",
      steps = 50,
      guidance = 60,
      // NEW: source render context so the prompt builder can tell Flux what
      // material to paint instead of leaving it to guess from the surroundings.
      finish,
      colorName,
      vehicleMake,
      vehicleModel,
    } = body;

    if (!imageUrl) {
      return new Response(
        JSON.stringify({ code: "MISSING_PARAM", message: "imageUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!maskUrl) {
      return new Response(
        JSON.stringify({ code: "MISSING_PARAM", message: "maskUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return new Response(
        JSON.stringify({ code: "MISSING_PARAM", message: "prompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const enrichedPrompt = buildMaskedEditPrompt({
      userPrompt: prompt,
      finish,
      colorName,
      vehicleMake,
      vehicleModel,
    });

    console.log(`[revise-render-masked] user=${user.id.substring(0, 8)} tool=${toolType} user_prompt="${prompt.substring(0, 60)}" enriched_len=${enrichedPrompt.length}`);

    const result = await runFluxFill({
      imageUrl,
      maskUrl,
      prompt: enrichedPrompt,
      steps: Math.max(20, Math.min(50, Number(steps) || 50)),
      guidance: Math.max(1.5, Math.min(100, Number(guidance) || 60)),
    });

    if ("error" in result) {
      console.error(`[revise-render-masked] ${result.error}`);
      return new Response(
        JSON.stringify({ code: "RENDER_FAILED", message: result.error }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { bytes, mimeType } = await downloadBytes(result.outputUrl);
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const renderUrl = await uploadRender(serviceClient, bytes, mimeType, user.id, toolType);

    console.log(`[revise-render-masked] ✅ ${renderUrl.substring(0, 80)}...`);

    return new Response(
      JSON.stringify({ renderUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[revise-render-masked] ${message}`);
    return new Response(
      JSON.stringify({ code: "INTERNAL_ERROR", message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
