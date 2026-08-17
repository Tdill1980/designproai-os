// fadewraps-render — single deterministic entry point for every FadeWraps render.
//
// Why this exists:
//   The FadeWraps UI used to expose 4 fade-style options (front_back,
//   top_bottom, diagonal, crossfade) and the hook fanned each render out to
//   one of 6 physical renderers based on vehicle type (generate-color-render,
//   render-motorcycle, render-boat, render-bus, render-rv, render-trailer).
//   24 combinations meant the same customer rarely got the same fade twice,
//   and revisions drifted as the AI re-interpreted the style/spec each time.
//
// What this does:
//   • Hardcodes fadeStyle = "front_back" — the single axis Gemini renders
//     most consistently (no opposing-corner spatial reasoning required).
//   • Hardcodes a deterministic FadeSpec so the physical renderer gets the
//     exact same constraints on every call.
//   • Forwards to the correct physical renderer for the vehicle type with
//     the user's original JWT — the locked render pipeline is untouched and
//     its token gate still fires once per render. No double charge.
//
// The locked render pipeline (generate-color-render, render-*) is NOT
// modified. This wrapper just normalizes the inputs.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NORMALIZED_FADE_STYLE = "front_back";

const DETERMINISTIC_FADE_SPEC = {
  fadeAxis: "front-to-back",
  fadeStart: "front",
  fadeEnd: "rear",
  fadeProfile: "smooth",
  prompt: [
    "🔒 FRONT-TO-BACK FADE — DETERMINISTIC CONSTRAINT",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "• Color saturates at the FRONT of the vehicle (100% saturation).",
    "• Color fades seamlessly to PURE BLACK at the REAR (0% color).",
    "• Single horizontal axis along the vehicle length.",
    "• Transition zone occupies the middle 50% of the vehicle.",
    "• NO diagonal, NO crossfade, NO vertical fade, NO opposing corners.",
    "• NO visible boundary line — airbrush-style imperceptible blend.",
    "• Fade direction is anchored to vehicle space, not camera space.",
  ].join("\n"),
};

function routePhysicalRenderer(vehicleType: string | undefined): string {
  switch ((vehicleType || "").toLowerCase()) {
    case "motorcycle":
      return "render-motorcycle";
    case "boat":
      return "render-boat";
    case "bus":
      return "render-bus";
    case "rv":
      return "render-rv";
    case "trailer":
      return "render-trailer";
    default:
      return "generate-color-render";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  const vehicleType = (body.vehicleType as string | undefined) ?? "car";
  const target = routePhysicalRenderer(vehicleType);

  const incomingColorData = (body.colorData as Record<string, unknown> | undefined) ?? {};

  const normalizedBody = {
    ...body,
    tool: "fadewraps",
    modeType: "fadewraps",
    colorData: {
      ...incomingColorData,
      fadeStyle: NORMALIZED_FADE_STYLE,
      fadeSpec: DETERMINISTIC_FADE_SPEC,
    },
  };

  console.log(
    `🌅 fadewraps-render → ${target} (vehicleType=${vehicleType}, style=${NORMALIZED_FADE_STYLE})`,
  );

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!supabaseUrl) {
    return new Response(
      JSON.stringify({ error: "SUPABASE_URL not configured" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  const auth = req.headers.get("Authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";

  let upstream: Response;
  try {
    upstream = await fetch(`${supabaseUrl}/functions/v1/${target}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: auth } : {}),
        ...(apikey ? { apikey } : {}),
      },
      body: JSON.stringify(normalizedBody),
    });
  } catch (e) {
    console.error("❌ fadewraps-render upstream fetch failed:", e);
    return new Response(
      JSON.stringify({ error: `Upstream renderer unreachable: ${(e as Error).message}` }),
      { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});
