import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { tokenGate } from "../_shared/token-gate.ts";
import { buildGraphicsProMyVehiclePrompt } from "./prompt.ts";

/**
 * GRAPHICSPRO MyVehiclePro — Edge Function
 *
 * Applies AI-driven custom graphics/styling to a customer's real vehicle photo.
 * Owned exclusively by GraphicsPro. Tune freely without affecting other tools.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Same bounded fetch generate-graphics-pro uses for its references: a
// Supabase public-storage URL is routed through the image transform so it
// arrives pre-downscaled (Gemini's effective input ceiling is ~1568px), with
// a fallback to the raw object if the project has transforms disabled.
function boundStorageImage(url: string, maxWidth = 1600): string {
  try {
    if (!url.includes("/storage/v1/object/public/")) return url;
    if (url.includes("/render/image/")) return url;
    const transformed = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
    return `${transformed}${transformed.includes("?") ? "&" : "?"}width=${maxWidth}&resize=contain&quality=92`;
  } catch {
    return url;
  }
}

async function fetchImageAsBase64(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const bounded = boundStorageImage(url);
    let resp = await fetch(bounded, { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(15_000) });
    if (!resp.ok && bounded !== url) {
      resp = await fetch(url, { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(15_000) });
    }
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") || "image/png";
    const bytes = new Uint8Array(await resp.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + 8192, bytes.length))));
    }
    return { mimeType: contentType, data: btoa(binary) };
  } catch (err) {
    console.warn("design reference fetch failed:", err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Token gate — 1 token per GraphicsPro render.
  const gate = await tokenGate(req, { reason: "graphicspro_on_vehicle_photo_render" });
  if (!gate.ok) return gate.response!;

  try {
    const {
      userEmail: bodyUserEmail,
      uploadedPhotoBase64: rawPhotoBase64,
      uploadedPhotoMimeType: rawPhotoMimeType,
      uploadedPhotoUrl,
      colorData,
      vehicleInfo,
    } = await req.json();

    let userEmail = bodyUserEmail;
    if (!userEmail) {
      try {
        const supabaseForAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const authHeader = req.headers.get("Authorization");
        if (authHeader) {
          const token = authHeader.replace("Bearer ", "");
          const { data: { user: jwtUser } } = await supabaseForAuth.auth.getUser(token);
          if (jwtUser?.email) userEmail = jwtUser.email;
        }
      } catch (e) {
        console.error("JWT fallback exception:", e);
      }
    }

    if (!userEmail) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let uploadedPhotoBase64 = rawPhotoBase64;
    let uploadedPhotoMimeType = rawPhotoMimeType;
    if (!uploadedPhotoBase64 && uploadedPhotoUrl) {
      const photoResponse = await fetch(uploadedPhotoUrl);
      if (!photoResponse.ok) {
        return new Response(
          JSON.stringify({ error: `Failed to fetch vehicle photo from URL (${photoResponse.status})` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const photoBuffer = await photoResponse.arrayBuffer();
      uploadedPhotoBase64 = btoa(String.fromCharCode(...new Uint8Array(photoBuffer)));
      uploadedPhotoMimeType = photoResponse.headers.get("content-type") || "image/jpeg";
    }

    if (!uploadedPhotoBase64) {
      return new Response(
        JSON.stringify({ error: "No vehicle photo provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The GraphicsPro product path sends the approved mockup as the design
    // reference (colorData.designUrl, with panelUrl accepted as an alias).
    // With a reference the styling prompt is optional — the image IS the
    // design. Without one the legacy text-only contract still applies.
    const designReferenceUrl: string | null =
      (colorData && (colorData.designUrl || colorData.panelUrl)) || null;
    if (!colorData || (!colorData.customStylingPrompt && !designReferenceUrl)) {
      return new Response(
        JSON.stringify({ error: "Styling prompt or design reference (designUrl) required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!hasGeminiKey()) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }

    console.log("📸 graphicspro-on-vehicle-photo: starting", {
      userEmail,
      promptLength: (colorData.customStylingPrompt || "").length,
      finish: colorData.finish,
      hasVehicleInfo: !!vehicleInfo,
      hasDesignReference: !!designReferenceUrl,
    });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let authenticatedUserId: string | null = null;
    try {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const token = authHeader.replace("Bearer ", "");
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) authenticatedUserId = user.id;
      }
    } catch { /* non-fatal */ }

    const { data: blockedUser } = await supabase
      .from("blocked_users")
      .select("id")
      .eq("email", userEmail)
      .maybeSingle();

    if (blockedUser) {
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // IMAGE 2 — the approved mockup. Fetched server-side (bounded through the
    // storage image transform when it is one of ours, so a 4K mockup does not
    // blow the worker's memory) and attached AFTER the customer photo so the
    // prompt's IMAGE 1 / IMAGE 2 numbering holds. A reference that cannot be
    // fetched fails the request: rendering a "transfer" with nothing to
    // transfer would silently hand the customer a different design.
    let designReference: { mimeType: string; data: string } | null = null;
    if (designReferenceUrl) {
      designReference = await fetchImageAsBase64(designReferenceUrl);
      if (!designReference) {
        return new Response(
          JSON.stringify({ error: "Could not fetch the design reference image (designUrl)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const aiPrompt = buildGraphicsProMyVehiclePrompt({
      customStylingPrompt: colorData.customStylingPrompt,
      finish: colorData.finish || "Gloss",
      vehicleInfo: vehicleInfo || undefined,
      hasDesignReference: !!designReference,
      designName: colorData.designName || colorData.panelName || colorData.colorName,
    });
    console.log("📝 prompt built, length:", aiPrompt.length);

    const photoMime = uploadedPhotoMimeType || "image/jpeg";
    const parts: any[] = [
      { text: aiPrompt },
      { inlineData: { mimeType: photoMime, data: uploadedPhotoBase64 } },
    ];
    if (designReference) {
      parts.push({ inlineData: designReference });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getGeminiKey()}`;
    let geminiResponse: Response | null = null;
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              responseMimeType: "text/plain",
              imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
              // A design transfer is a reproduction task: the low temperature
              // edit-vehicle-photo uses for library panels keeps the model from
              // swapping in a "similar" graphic. Text-only styling keeps the
              // default so creative prompts still get natural variation.
              ...(designReference ? { temperature: 0.05 } : {}),
            },
          }),
        });
        if (geminiResponse.ok) break;
        const status = geminiResponse.status;
        const errorText = await geminiResponse.text();
        lastError = `Gemini API returned ${status}: ${errorText}`;
        if (status === 429) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt + 1) * 1000));
          continue;
        }
        if (status === 403) {
          return new Response(
            JSON.stringify({ error: "AI API access denied. Check API key configuration." }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (status >= 400 && status < 500) {
          return new Response(
            JSON.stringify({ error: `AI generation failed: ${errorText}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt + 1) * 1000));
      } catch (fetchErr: any) {
        lastError = fetchErr.message;
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt + 1) * 1000));
      }
    }

    if (!geminiResponse || !geminiResponse.ok) {
      console.error("🚨 All Gemini retries failed:", lastError);
      return new Response(
        JSON.stringify({ error: "AI generation failed after retries. Please try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiData = await geminiResponse.json();
    const candidates = geminiData.candidates;
    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ error: "AI returned no results." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let imageBase64 = "";
    let imageMimeType = "image/png";
    for (const part of (candidates[0]?.content?.parts || [])) {
      if (part.inlineData) {
        imageBase64 = part.inlineData.data;
        imageMimeType = part.inlineData.mimeType || "image/png";
        break;
      }
    }

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "AI did not return an image." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const timestamp = Date.now();
    const vehicleMake = vehicleInfo?.make || "vehicle";
    const vehicleModel = vehicleInfo?.model || "edit";
    const fileExt = imageMimeType.includes("png") ? "png" : "jpg";
    const userPrefix = authenticatedUserId ? `${authenticatedUserId}/` : "";
    const storagePath = `renders/${userPrefix}myvehicle/${timestamp}_${vehicleMake}_${vehicleModel}_graphicspro.${fileExt}`;

    const imageBytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    const { error: uploadError } = await supabase.storage
      .from("graphicspro-files")
      .upload(storagePath, imageBytes, { contentType: imageMimeType, upsert: false });

    if (uploadError) {
      throw new Error(`Failed to save edited image: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage
      .from("graphicspro-files")
      .getPublicUrl(storagePath);
    const editedImageUrl = publicUrlData.publicUrl;

    const { data: vizRecord } = await supabase
      .from("color_visualizations")
      .insert({
        customer_email: userEmail,
        vehicle_make: vehicleMake,
        vehicle_model: vehicleModel,
        // color_visualizations.vehicle_year is NOT NULL on this project; an
        // upload with no year is recorded as 0 rather than losing the record.
        vehicle_year: vehicleInfo?.year ? (parseInt(vehicleInfo.year) || 0) : 0,
        color_hex: "#000000",
        color_name: colorData.designName || "GraphicsPro Custom Styling",
        finish_type: colorData.finish || "Gloss",
        render_urls: { myvehicle_edit: editedImageUrl },
        generation_status: "completed",
        source_photo_url: `myvehicle_upload_${timestamp}`,
        mode_type: "myvehicle_graphicspro",
      })
      .select("id")
      .single();

    return new Response(
      JSON.stringify({
        renderUrl: editedImageUrl,
        renderId: vizRecord?.id || null,
        vehicleInfo: vehicleInfo || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("🚨 graphicspro-on-vehicle-photo error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
