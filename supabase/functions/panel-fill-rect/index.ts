/**
 * panel-fill-rect — Fills flattened panel edges to perfect rectangles
 *
 * Takes a Gemini-flattened panel and uses Fal.ai img2img to extend
 * the design to fill a perfect edge-to-edge rectangle.
 *
 * Uses SYNCHRONOUS Fal.ai API (fal.run, not queue.fal.run) for reliability.
 * NO local image processing — passes URL directly to Fal.ai.
 *
 * POST /panel-fill-rect
 * {
 *   panelUrl: string,         // URL to the flattened panel image
 *   panelType: "side" | "hood" | "rear" | "roof" | "bumper",
 *   prompt?: string,          // design description for context
 *   userId?: string,
 *   jobId?: string,
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = "wrap-files";

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const falKey = Deno.env.get("FAL_KEY");
    if (!falKey) return jsonResponse({ error: "FAL_KEY not configured" }, 500);

    const body = await req.json();
    const {
      panelUrl,
      panelType = "side",
      prompt,
      userId,
      jobId,
    } = body;

    if (!panelUrl) return jsonResponse({ error: "panelUrl is required" }, 400);

    console.log(`[FILL-RECT] Starting: ${panelType} panel`);

    const fillPrompt = prompt || `A flat 2D vehicle wrap panel design that fills the entire canvas edge-to-edge. Seamless colors, patterns, textures, and graphics. No vehicle features, no wheels, no windows, no body lines. Flat print artwork, no 3D, no perspective.`;

    // Use synchronous Fal.ai API — blocks until result ready
    // fal-ai/fast-sdxl img2img: takes source image + prompt, outputs new image
    // Low strength (0.3) = stays very close to original design, just fills edges
    console.log(`[FILL-RECT] Calling Fal.ai img2img (sync)...`);

    const falRes = await fetch("https://fal.run/fal-ai/fast-sdxl/image-to-image", {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: panelUrl,
        prompt: fillPrompt,
        negative_prompt: "vehicle, car, truck, wheels, tires, windows, headlights, body lines, 3D, perspective, photograph, mockup, text, watermark, border, frame, white edges, blank space",
        num_inference_steps: 25,
        strength: 0.35,
        guidance_scale: 7.0,
        image_size: "landscape_16_9",
        enable_safety_checker: false,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!falRes.ok) {
      const errText = await falRes.text().catch(() => "");
      console.error(`[FILL-RECT] Fal.ai error ${falRes.status}: ${errText.slice(0, 300)}`);
      return jsonResponse({ success: false, error: `Fal.ai error (${falRes.status}): ${errText.slice(0, 200)}` }, 422);
    }

    const falData = await falRes.json();
    const outputImageUrl = falData?.images?.[0]?.url;

    if (!outputImageUrl) {
      console.error(`[FILL-RECT] No image in response:`, JSON.stringify(falData).slice(0, 300));
      return jsonResponse({ success: false, error: "No image returned from Fal.ai" }, 422);
    }

    console.log(`[FILL-RECT] Fal.ai returned filled image`);

    // Download and upload to permanent storage
    const filledResp = await fetch(outputImageUrl);
    if (!filledResp.ok) return jsonResponse({ success: false, error: "Failed to download filled image" }, 500);

    const filledBytes = new Uint8Array(await filledResp.arrayBuffer());

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const uid = userId || "anonymous";
    const jid = jobId || Date.now().toString();
    const outputPath = `artboards/${uid}/${jid}/filled-${panelType}-${Date.now()}.png`;

    await sb.storage.from(BUCKET).upload(outputPath, filledBytes, { contentType: "image/png", upsert: true });
    const { data: { publicUrl: outputUrl } } = sb.storage.from(BUCKET).getPublicUrl(outputPath);

    console.log(`[FILL-RECT] Done: ${outputPath} (${(filledBytes.byteLength / 1024).toFixed(0)} KB)`);

    return jsonResponse({
      success: true,
      filledUrl: outputUrl,
      storagePath: outputPath,
      panelType,
    });

  } catch (err: any) {
    console.error("[FILL-RECT] Error:", err);
    return jsonResponse({ error: err.message || "Fill failed" }, 500);
  }
});
