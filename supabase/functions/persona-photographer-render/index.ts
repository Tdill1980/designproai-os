/**
 * persona-photographer-render — Persona 3: Automotive Photographer
 *
 * Gemini image generation x 6 angles. Runs AUTOMATICALLY after Persona 2.
 * Uses Design Anchor text for cross-view consistency.
 *
 * Fixed 6-shot sequence: driver, passenger, front, hood, close-up, rear
 *
 * Input:  designAnchorText + heroRenderUrl + vehicle info + finish
 * Output: { renderUrls: { driverSide, passengerSide, front, hoodDetail, closeUp, rear } }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import {
  buildPhotographerPrompt,
  PHOTOGRAPHER_SHOT_SEQUENCE,
} from "../_shared/persona-photographer-prompt.ts";
import { geminiImageUrl, PRIMARY_IMAGE_MODEL, FALLBACK_IMAGE_MODEL } from "../_shared/model-config.ts";
import { upscaleImageBytes } from "../_shared/topaz-upscale.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Fetch an image URL and return base64 inline data for Gemini */
async function fetchImageAsInlineData(
  url: string
): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Deno/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") || "image/png";
    const buf = await resp.arrayBuffer();
    const uint8 = new Uint8Array(buf);
    let bin = "";
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
      bin += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return { inlineData: { mimeType: contentType, data: btoa(bin) } };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      designAnchorText,
      heroRenderUrl,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      finish = "Gloss",
      generationId,
      // Optional: render a SINGLE shot instead of all 6
      // When provided, returns { renderUrl, shotKey } for just that one shot
      shotKey: requestedShotKey,
      upscaleForPrint = false,
    } = body;

    if (!designAnchorText) {
      return new Response(
        JSON.stringify({ error: "Missing required field: designAnchorText" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Authenticate — extract JWT token and pass explicitly to getUser()
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    let userId: string | null = null;

    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const authClient = createClient(supabaseUrl, supabaseAnonKey);
      const { data: { user } } = await authClient.auth.getUser(token);
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
        JSON.stringify({ code: "SYSTEM_ERROR", message: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch hero render as visual reference for consistency
    let heroImagePart: { inlineData: { mimeType: string; data: string } } | null = null;
    if (heroRenderUrl) {
      heroImagePart = await fetchImageAsInlineData(heroRenderUrl);
      if (heroImagePart) {
        console.log("Hero render loaded as visual reference for photographer");
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── SINGLE-SHOT MODE ─────────────────────────────────────
    // When shotKey is provided, render ONE shot and return immediately.
    // Frontend calls this 6 times, showing each shot as it arrives.
    const shotsToRender = requestedShotKey
      ? PHOTOGRAPHER_SHOT_SEQUENCE.filter(s => s.key === requestedShotKey)
      : PHOTOGRAPHER_SHOT_SEQUENCE;

    if (requestedShotKey && shotsToRender.length === 0) {
      return new Response(
        JSON.stringify({ error: `Unknown shot key: ${requestedShotKey}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const renderUrls: Record<string, string> = {};
    const productionRenderUrls: Record<string, string> = {};
    const failedShots: string[] = [];
    const timestamp = Date.now();

    for (const shot of shotsToRender) {
      console.log(`Persona 3: Shooting ${shot.label} (${shot.key})...`);

      const prompt = buildPhotographerPrompt({
        designAnchorText,
        vehicleYear,
        vehicleMake,
        vehicleModel,
        finish,
        shotKey: shot.key,
      });

      console.log(`  Prompt: ${prompt.length} chars`);

      // Build parts: hero image first, then text prompt last (Gemini gives
      // strongest weight to the last part — camera angle instructions must win).
      // Skip hero image for passenger-side and close-up — the driver-side hero
      // biases Gemini toward the wrong angle for these shots.
      const skipHeroShots = ['passenger-side', 'close-up'];
      const useHero = heroImagePart && !skipHeroShots.includes(shot.key);
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      if (useHero) {
        parts.push(heroImagePart);
      }
      parts.push({ text: prompt });

      let imageBase64: string | null = null;
      let imageMimeType = "image/png";
      const MAX_RETRIES = 2;

      for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        try {
          // Pro first (attempts 1-2), fallback to Flash on final attempt
          const currentModel = attempt < MAX_RETRIES + 1 ? PRIMARY_IMAGE_MODEL : FALLBACK_IMAGE_MODEL;
          if (currentModel === FALLBACK_IMAGE_MODEL) {
            console.log(`\u26A1 Model fallback for ${shot.key}: switching to ${FALLBACK_IMAGE_MODEL}`);
          }
          const response = await fetch(
            geminiImageUrl(getGeminiKey(), currentModel),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: attempt === 1 ? parts : [{ text: prompt }] }],
                generationConfig: {
                  responseModalities: ["TEXT", "IMAGE"],
                  imageConfig: { imageSize: "4K", aspectRatio: "4:3" },
                },
              }),
              signal: AbortSignal.timeout(60_000),
            }
          );

          if (!response.ok) {
            console.error(`  ${shot.key} HTTP ${response.status} (attempt ${attempt})`);
            if (response.status === 429 && attempt <= MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, 3000));
              continue;
            }
            if (attempt <= MAX_RETRIES) continue;
            break;
          }

          const result = await response.json();
          const responseParts = result.candidates?.[0]?.content?.parts || [];

          for (const part of responseParts) {
            if (part.inlineData) {
              imageBase64 = part.inlineData.data;
              imageMimeType = part.inlineData.mimeType || "image/png";
            }
          }

          if (imageBase64) {
            console.log(`  ${shot.key} OK on attempt ${attempt}`);
            break;
          }
        } catch (err: any) {
          console.error(`  ${shot.key} error (attempt ${attempt}):`, err?.message);
        }

        if (attempt <= MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }

      if (!imageBase64) {
        console.error(`  ${shot.key} FAILED after all attempts`);
        failedShots.push(shot.key);
        continue;
      }

      // Upload
      const mimeExtMap: Record<string, string> = {
        "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
      };
      const ext = mimeExtMap[imageMimeType] || "png";
      const filePath = `renders/${userId}/PersonaPipeline/photographer/${timestamp}_${shot.key}.${ext}`;

      const bin = atob(imageBase64);
      const imageData = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        imageData[i] = bin.charCodeAt(i);
      }

      const { error: uploadErr } = await supabase.storage
        .from("wrap-files")
        .upload(filePath, imageData, { contentType: imageMimeType, upsert: true });

      if (uploadErr) {
        console.error(`  Upload error for ${shot.key}:`, uploadErr);
        failedShots.push(shot.key);
        continue;
      }

      const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(filePath);
      renderUrls[shot.key] = publicUrl;
      console.log(`  ${shot.key} uploaded: ${publicUrl}`);

      // ── Optional ESRGAN upscale for print production ──
      if (upscaleForPrint && userId) {
        try {
          console.log(`[UPSCALE] photographer-${shot.key}: running 2-pass ESRGAN...`);
          const upResult = await upscaleImageBytes(imageData, imageMimeType, supabase, {
            scale: 2, passes: 2, userId, label: `photographer-${shot.key}`, timeoutMs: 120_000,
          });
          if (upResult.upscaled) {
            const prodPath = `renders/${userId}/PersonaPipeline/photographer/production/${timestamp}_${shot.key}.${ext}`;
            const { error: pErr } = await supabase.storage
              .from("wrap-files")
              .upload(prodPath, upResult.imageBytes, { contentType: imageMimeType, upsert: true });
            if (!pErr) {
              productionRenderUrls[shot.key] = supabase.storage.from("wrap-files").getPublicUrl(prodPath).data.publicUrl;
              console.log(`[UPSCALE] Production ${shot.key}: ${productionRenderUrls[shot.key]}`);
            }
          }
        } catch (e: any) {
          console.warn(`[UPSCALE] Non-fatal photographer-${shot.key} upscale error:`, e?.message);
        }
      }

      // Brief pause between shots to avoid rate limits
      if (shot.key !== PHOTOGRAPHER_SHOT_SEQUENCE[PHOTOGRAPHER_SHOT_SEQUENCE.length - 1].key) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // Update designiq_generations with all render URLs (best-effort)
    if (generationId && Object.keys(renderUrls).length > 0) {
      try {
        await supabase
          .from("designiq_generations")
          .update({
            render_urls: renderUrls,
            generation_status: failedShots.length === 0 ? "all_views" : "partial_views",
            updated_at: new Date().toISOString(),
          })
          .eq("id", generationId);
      } catch (err) {
        console.warn("Failed to update designiq_generations:", err);
      }
    }

    const totalShots = PHOTOGRAPHER_SHOT_SEQUENCE.length;
    const successCount = Object.keys(renderUrls).length;
    console.log(`Persona 3 (Photographer) complete: ${successCount}/${totalShots} shots${failedShots.length > 0 ? ` (failed: ${failedShots.join(", ")})` : ""}`);

    // Single-shot mode: return just the one URL for immediate display
    if (requestedShotKey) {
      const url = renderUrls[requestedShotKey] || null;
      return new Response(
        JSON.stringify({
          shotKey: requestedShotKey,
          renderUrl: url,
          productionRenderUrl: productionRenderUrls[requestedShotKey] || undefined,
          success: !!url,
          generationId: generationId || null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        renderUrls,
        productionRenderUrls: Object.keys(productionRenderUrls).length > 0 ? productionRenderUrls : undefined,
        failedShots,
        totalShots,
        successCount,
        generationId: generationId || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("persona-photographer-render error:", err);
    return new Response(
      JSON.stringify({ code: "SYSTEM_ERROR", message: "Unexpected failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
