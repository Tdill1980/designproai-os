/**
 * segment-click — Click-to-mask for Precise Edit mode in RevisionStudioIQ
 *
 * Takes an image URL + a normalized click point (x,y in 0-1) and returns a
 * pixel-perfect mask PNG of the clicked region (panel, decal, text block, etc.).
 *
 * Uses Meta's SAM2 on Replicate. Two modes:
 *  1. clickX/clickY provided → SAM2 point-prompt (fast, returns clicked region)
 *  2. manualMaskBase64 provided → bypass SAM2, upload user-drawn mask
 *
 * Mode 2 is the rectangle/brush fallback — guarantees the tool always works
 * even if SAM2 quality isn't good enough for a specific image.
 *
 * Output: URL of a PNG mask in wrap-files/masks/ where:
 *   - White (255) = edit this pixel
 *   - Black (0)   = preserve this pixel exactly
 * This is the convention Flux.1 Fill Pro expects.
 */

export const maxDuration = 60;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Replicate model for click-prompt SAM2. Overridable via env so ops can swap
// to a newer or alternate version without a code deploy.
const SAM2_MODEL = Deno.env.get("SAM2_REPLICATE_MODEL") || "meta/sam-2";

const REPLICATE_API = "https://api.replicate.com/v1";
const POLL_MAX = 60;         // 60 polls × 1s = 60s ceiling
const POLL_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function uploadMask(
  supabase: any,
  pngBytes: Uint8Array,
  userId: string,
): Promise<string> {
  const fileName = `masks/${userId}/${Date.now()}_${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage
    .from("wrap-files")
    .upload(fileName, pngBytes, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`Mask upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage
    .from("wrap-files")
    .getPublicUrl(fileName);
  return publicUrl;
}

async function downloadBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// SAM2 via Replicate (click-prompt mode)
// ---------------------------------------------------------------------------

async function runSam2ClickPrompt(
  imageUrl: string,
  clickX: number,
  clickY: number,
  imageWidth: number,
  imageHeight: number,
): Promise<{ maskUrl: string } | { error: string }> {
  const key = Deno.env.get("REPLICATE_API_TOKEN");
  if (!key) return { error: "REPLICATE_API_TOKEN not configured" };

  // SAM2 expects absolute pixel coords. If image dims weren't provided,
  // we fall back to a reasonable default — client should always pass them.
  const pxX = Math.round(clickX * (imageWidth || 1024));
  const pxY = Math.round(clickY * (imageHeight || 576));

  const predResp = await fetch(
    `${REPLICATE_API}/models/${SAM2_MODEL}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({
        input: {
          image: imageUrl,
          // Meta sam-2 on Replicate supports both auto-mask and point-prompt
          // inputs. We pass point coords as a JSON string — the model parses
          // it into a tensor. Label 1 = foreground (the clicked object).
          click_coordinates: `[[${pxX},${pxY}]]`,
          click_labels: "[1]",
          use_m2m: true,
          multimask_output: false,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!predResp.ok) {
    return { error: `SAM2 create HTTP ${predResp.status}: ${await predResp.text()}` };
  }

  let prediction = await predResp.json();

  // If Prefer:wait already resolved it, skip polling.
  if (prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled") {
    for (let i = 0; i < POLL_MAX; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const s = await fetch(`${REPLICATE_API}/predictions/${prediction.id}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!s.ok) continue;
      prediction = await s.json();
      if (["succeeded", "failed", "canceled"].includes(prediction.status)) break;
    }
  }

  if (prediction.status !== "succeeded") {
    return { error: `SAM2 ${prediction.status}: ${prediction.error || "unknown"}` };
  }

  // Output is either a single mask URL or an array — normalize.
  const out = prediction.output;
  const maskUrl: string | undefined =
    typeof out === "string" ? out :
    Array.isArray(out) ? out[0] :
    out?.combined_mask || out?.mask || out?.individual_masks?.[0];

  if (!maskUrl) return { error: "SAM2 returned no mask URL" };
  return { maskUrl };
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
      clickX,
      clickY,
      imageWidth,
      imageHeight,
      manualMaskBase64,
    } = body;

    if (!imageUrl && !manualMaskBase64) {
      return new Response(
        JSON.stringify({ code: "MISSING_PARAM", message: "imageUrl or manualMaskBase64 required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // ---- Path 1: client-drawn mask (rectangle/brush fallback) ----
    if (manualMaskBase64) {
      const bytes = base64ToBytes(manualMaskBase64);
      const maskUrl = await uploadMask(serviceClient, bytes, user.id);
      return new Response(
        JSON.stringify({ maskUrl, source: "manual" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- Path 2: SAM2 click-prompt ----
    if (typeof clickX !== "number" || typeof clickY !== "number") {
      return new Response(
        JSON.stringify({ code: "MISSING_PARAM", message: "clickX/clickY required (0-1) when no manualMaskBase64" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sam = await runSam2ClickPrompt(imageUrl, clickX, clickY, imageWidth, imageHeight);
    if ("error" in sam) {
      return new Response(
        JSON.stringify({ code: "SEGMENT_FAILED", message: sam.error }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Re-host SAM2's mask on our Storage so revise-render-masked can fetch it
    // with a stable URL (Replicate URLs expire).
    const maskBytes = await downloadBytes(sam.maskUrl);
    const maskUrl = await uploadMask(serviceClient, maskBytes, user.id);

    return new Response(
      JSON.stringify({ maskUrl, source: "sam2" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[segment-click] ${message}`);
    return new Response(
      JSON.stringify({ code: "INTERNAL_ERROR", message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
