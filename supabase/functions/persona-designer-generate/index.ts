/**
 * persona-designer-generate — Persona 2: Pro Vehicle Wrap Graphic Designer
 *
 * Gemini image generation. Takes an enriched brief from Persona 1 and creates
 * a pro $5K-level wrap design rendered ON the vehicle (driver side hero shot).
 * Generates Design Anchor text for Persona 3 cross-view consistency.
 *
 * Input:  enriched brief + vehicle info + VisionBoardIQ images + finish + mode
 * Output: { renderUrl, designAnchorText, designName, generationId }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { buildDesignerPrompt } from "../_shared/persona-designer-prompt.ts";
import { geminiImageUrl, PRIMARY_IMAGE_MODEL, FALLBACK_IMAGE_MODEL } from "../_shared/model-config.ts";
import { upscaleImageBytes } from "../_shared/topaz-upscale.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PERSONA_VERSION = "1.0.0";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      enrichedBrief,
      mode = "restyle",
      vehicleYear,
      vehicleMake,
      vehicleModel,
      finish = "Gloss",
      companyName,
      phone,
      mascot,
      industryType,
      bulletPoints,
      visionBoardImages,
      visionboard_intent,
      upscaleForPrint = false,
    } = body;

    if (!enrichedBrief) {
      return new Response(
        JSON.stringify({ error: "Missing required field: enrichedBrief" }),
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

    // Build designer prompt
    const vbImages = Array.isArray(visionBoardImages) ? visionBoardImages : [];
    const aiPrompt = buildDesignerPrompt({
      enrichedBrief,
      mode,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      finish,
      companyName,
      phone,
      mascot,
      industryType,
      bulletPoints,
      hasVisionBoardImages: vbImages.length > 0,
      visionboard_intent: visionboard_intent || "style_inspiration",
    });

    console.log("=== PERSONA 2 (DESIGNER) PROMPT START ===");
    console.log(aiPrompt);
    console.log(`=== PERSONA 2 (DESIGNER) PROMPT END (${aiPrompt.length} chars) ===`);

    // Fetch VisionBoardIQ images for multimodal input (max 4 — matches UI slots)
    // Only include actual images for "exact_reference" intent.
    // For "style_inspiration", the prompt text guides Gemini without seeing raw images
    // (Gemini's visual understanding overrides text instructions when images are present).
    const visionBoardParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
    const shouldIncludeVBImages = visionboard_intent === 'exact_reference';
    const cappedImages = vbImages.slice(0, 4);

    for (const vbImg of (shouldIncludeVBImages ? vbImages : [])) {
      try {
        let fetchUrl = vbImg.storageUrl;
        const supabaseStorageHost = Deno.env.get("SUPABASE_URL") || "";
        if (fetchUrl.includes(supabaseStorageHost) && fetchUrl.includes("/storage/v1/object/public/")) {
          fetchUrl = fetchUrl.replace(
            "/storage/v1/object/public/",
            "/storage/v1/render/image/public/"
          ) + "?width=768&height=768&resize=contain&quality=80";
        }

        const imgResponse = await fetch(fetchUrl, {
          headers: { "User-Agent": "Deno/1.0" },
          signal: AbortSignal.timeout(15_000),
        });

        if (imgResponse.ok) {
          const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
          const imgBuffer = await imgResponse.arrayBuffer();
          const uint8Array = new Uint8Array(imgBuffer);
          let binaryString = "";
          const chunkSize = 8192;
          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
            binaryString += String.fromCharCode.apply(null, Array.from(chunk));
          }
          visionBoardParts.push({
            inlineData: { mimeType: contentType, data: btoa(binaryString) },
          });
          console.log(`VisionBoard image loaded: ${vbImg.slotLabel} (${(imgBuffer.byteLength / 1024).toFixed(0)}KB)`);
        }
      } catch (err) {
        console.warn(`VisionBoard image fetch failed (${vbImg.slotLabel}):`, err);
      }
    }

    // Call Gemini for image generation
    const MAX_ATTEMPTS = 3;
    let imageBase64: string | null = null;
    let imageMimeType = "image/png";
    let designName: string | null = null;
    let designAnchorText: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Keep visionboard images on attempts 1-2, only drop on final fallback attempt
      const includeImages = attempt < MAX_ATTEMPTS && visionBoardParts.length > 0;
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> =
        includeImages
          ? [{ text: aiPrompt }, ...visionBoardParts]
          : [{ text: aiPrompt }];

      console.log(`Persona 2 attempt ${attempt}/${MAX_ATTEMPTS} (${parts.length} parts, images: ${includeImages})`);

      let response: Response;
      // Pro first (attempts 1-2), fallback to Flash on final attempt
      const currentModel = attempt < MAX_ATTEMPTS ? PRIMARY_IMAGE_MODEL : FALLBACK_IMAGE_MODEL;
      if (currentModel === FALLBACK_IMAGE_MODEL) {
        console.log(`\u26A1 Model fallback: switching to ${FALLBACK_IMAGE_MODEL}`);
      }
      try {
        response = await fetch(
          geminiImageUrl(getGeminiKey(), currentModel),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: { imageSize: "4K", aspectRatio: "16:9", width: 3840, height: 2160 },
              },
            }),
            signal: AbortSignal.timeout(90_000), // 90s for 4K + multimodal input
          }
        );
      } catch (fetchErr: any) {
        console.error(`Gemini fetch error (attempt ${attempt}):`, fetchErr?.message);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
          continue;
        }
        return new Response(
          JSON.stringify({ code: "SYSTEM_ERROR", message: "AI generation timed out" }),
          { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Gemini HTTP ${response.status} (attempt ${attempt}):`, errText);
        if (response.status === 429 && attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (attempt >= MAX_ATTEMPTS) {
          return new Response(
            JSON.stringify({ code: "SYSTEM_ERROR", message: `Designer render failed (HTTP ${response.status})` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        continue;
      }

      const result = await response.json();

      // Content filtering
      const finishReason = result.candidates?.[0]?.finishReason;
      const hasContent = result.candidates?.[0]?.content?.parts?.length > 0;
      if (finishReason && finishReason !== "STOP" && !hasContent) {
        return new Response(
          JSON.stringify({
            code: "CONTENT_FILTERED",
            message: "Design was filtered. Try describing visual elements instead of character names.",
            finishReason,
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Extract image + text (design name + anchor)
      const responseParts = result.candidates?.[0]?.content?.parts || [];
      for (const part of responseParts) {
        if (part.inlineData) {
          imageBase64 = part.inlineData.data;
          imageMimeType = part.inlineData.mimeType || "image/png";
        }
        if (part.text) {
          const text = part.text.trim();
          // Parse design name and anchor from structured output
          const anchorMatch = text.match(/DESIGN ANCHOR:\s*(.*)/is);
          if (anchorMatch) {
            designAnchorText = anchorMatch[1].trim();
            // Design name is everything before the anchor
            const nameText = text.substring(0, anchorMatch.index).trim();
            if (nameText.length > 0 && nameText.length < 100) {
              designName = nameText.replace(/^["'\d.)\s]+|["']+$/g, "").trim();
            }
          } else if (!designName && text.length > 0 && text.length < 200) {
            designName = text.replace(/^["']+|["']+$/g, "").trim();
          }
        }
      }

      if (imageBase64) {
        console.log(`Persona 2 image generated on attempt ${attempt}`);
        break;
      }

      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }

    if (!designName) {
      if (mode === "commercial" && companyName) {
        designName = `${companyName} Wrap`;
      } else {
        designName = "Custom Wrap Design";
      }
    }

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ code: "SYSTEM_ERROR", message: "No image from designer — try again" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upload to storage
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const timestamp = Date.now();
    const mimeExtMap: Record<string, string> = {
      "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
    };
    const fileExt = mimeExtMap[imageMimeType] || "png";
    const fileName = `renders/${userId}/PersonaPipeline/designer/${timestamp}_${mode}.${fileExt}`;

    const binaryString = atob(imageBase64);
    const imageData = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      imageData[i] = binaryString.charCodeAt(i);
    }

    const { error: uploadError } = await supabase.storage
      .from("wrap-files")
      .upload(fileName, imageData, { contentType: imageMimeType, upsert: true });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(
        JSON.stringify({ code: "SYSTEM_ERROR", message: "Failed to save render" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(fileName);

    // ── Optional ESRGAN upscale for print production ──
    let productionRenderUrl: string | null = null;
    if (upscaleForPrint && userId) {
      try {
        console.log("[UPSCALE] persona-designer: running 2-pass ESRGAN...");
        const upResult = await upscaleImageBytes(imageData, imageMimeType, supabase, {
          scale: 2, passes: 2, userId, label: `designer-${mode}`, timeoutMs: 120_000,
        });
        if (upResult.upscaled) {
          const prodPath = `renders/${userId}/PersonaPipeline/designer/production/${timestamp}_${mode}.${fileExt}`;
          const { error: pErr } = await supabase.storage
            .from("wrap-files")
            .upload(prodPath, upResult.imageBytes, { contentType: imageMimeType, upsert: true });
          if (!pErr) {
            productionRenderUrl = supabase.storage.from("wrap-files").getPublicUrl(prodPath).data.publicUrl;
            console.log(`[UPSCALE] Production designer render: ${productionRenderUrl}`);
          }
        }
      } catch (e) {
        console.warn("[UPSCALE] Non-fatal designer upscale error:", e.message);
      }
    }

    // --- DesignID: Prompt Thumbprint (PT) ---
    const ptSource = `${enrichedBrief || ''}|${userId}|${Date.now()}`;
    const ptBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ptSource));
    const ptHex = Array.from(new Uint8Array(ptBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    const promptThumbprint = `PT-${ptHex.substring(0, 12).toUpperCase()}`;

    // Track in designiq_generations (best-effort)
    let generationId: string | null = null;
    try {
      const { data: genRecord, error: genError } = await supabase
        .from("designiq_generations")
        .insert({
          user_id: userId,
          mode,
          raw_prompt: enrichedBrief,
          enhanced_prompt: aiPrompt,
          finish,
          company_name: mode === "commercial" ? companyName || null : null,
          vehicle_year: vehicleYear || null,
          vehicle_make: vehicleMake || null,
          vehicle_model: vehicleModel || null,
          panel_url: publicUrl,
          engine_version: `persona-${PERSONA_VERSION}`,
          generation_status: "designer_complete",
          panel_mime_type: imageMimeType,
          visionboard_image_refs: vbImages.length > 0 ? vbImages : null,
          design_name: designName || null,
          pt: promptThumbprint,
        })
        .select("id")
        .single();

      if (!genError && genRecord) {
        generationId = genRecord.id;
      }
    } catch (err) {
      console.warn("designiq_generations insert skipped:", err);
    }

    console.log("Persona 2 (Designer) complete:", {
      designName,
      hasAnchor: !!designAnchorText,
      publicUrl,
      generationId,
    });

    return new Response(
      JSON.stringify({
        renderUrl: publicUrl,
        productionRenderUrl: productionRenderUrl || undefined,
        designAnchorText: designAnchorText || null,
        designName,
        generationId,
        did: generationId ? `DID-${generationId.substring(0, 8).toUpperCase()}` : null,
        pt: promptThumbprint,
        mode,
        vehicle: { year: vehicleYear, make: vehicleMake, model: vehicleModel },
        finish,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("persona-designer-generate error:", err);
    return new Response(
      JSON.stringify({ code: "SYSTEM_ERROR", message: "Unexpected failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
