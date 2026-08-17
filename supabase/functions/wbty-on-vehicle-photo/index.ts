import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { buildWBTYMyVehiclePrompt } from "./prompt.ts";

/**
 * WBTY (Wrap By The Yard / PatternPro) MyVehiclePro — Edge Function
 *
 * Applies a curated pattern panel to a customer's real vehicle photo
 * with byte-accurate pattern fidelity (Gemini was drifting to lookalikes
 * at default temp, so design mode runs at temperature 0.05).
 *
 * Owned exclusively by WBTY. Tune freely without affecting other tools.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    if (!colorData || !colorData.panelUrl) {
      return new Response(
        JSON.stringify({ error: "Pattern panel required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!hasGeminiKey()) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }

    console.log("📸 wbty-on-vehicle-photo: starting", {
      userEmail,
      pattern: colorData.panelName,
      finish: colorData.finish,
      hasVehicleInfo: !!vehicleInfo,
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

    const aiPrompt = buildWBTYMyVehiclePrompt({
      panelName: colorData.panelName,
      finish: colorData.finish || "Gloss",
      vehicleInfo: vehicleInfo || undefined,
    });
    console.log("📝 prompt built, length:", aiPrompt.length);

    // Fetch the pattern panel as IMAGE 2
    const photoMime = uploadedPhotoMimeType || "image/jpeg";
    const parts: any[] = [
      { text: aiPrompt },
      { inlineData: { mimeType: photoMime, data: uploadedPhotoBase64 } },
    ];

    try {
      const designResponse = await fetch(colorData.panelUrl);
      if (designResponse.ok) {
        const designBuffer = await designResponse.arrayBuffer();
        const designBase64 = btoa(String.fromCharCode(...new Uint8Array(designBuffer)));
        const designMime = designResponse.headers.get("content-type") || "image/png";
        parts.push({
          inlineData: { mimeType: designMime, data: designBase64 },
        });
      } else {
        return new Response(
          JSON.stringify({ error: `Failed to fetch pattern panel (${designResponse.status})` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch (fetchErr) {
      console.warn("⚠️ Pattern panel fetch failed:", fetchErr);
      return new Response(
        JSON.stringify({ error: "Failed to load pattern panel" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
              // Low temp = byte-accurate pattern reproduction
              temperature: 0.05,
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
    const storagePath = `renders/${userPrefix}myvehicle/${timestamp}_${vehicleMake}_${vehicleModel}_wbty.${fileExt}`;

    const imageBytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    const { error: uploadError } = await supabase.storage
      .from("wrap-files")
      .upload(storagePath, imageBytes, { contentType: imageMimeType, upsert: false });

    if (uploadError) {
      throw new Error(`Failed to save edited image: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage
      .from("wrap-files")
      .getPublicUrl(storagePath);
    const editedImageUrl = publicUrlData.publicUrl;

    const { data: vizRecord } = await supabase
      .from("color_visualizations")
      .insert({
        customer_email: userEmail,
        vehicle_make: vehicleMake,
        vehicle_model: vehicleModel,
        vehicle_year: vehicleInfo?.year ? parseInt(vehicleInfo.year) : null,
        color_hex: "#000000",
        color_name: colorData.panelName || "WBTY Pattern",
        finish_type: colorData.finish || "Gloss",
        render_urls: { myvehicle_edit: editedImageUrl },
        generation_status: "completed",
        source_photo_url: `myvehicle_upload_${timestamp}`,
        mode_type: "myvehicle_wbty",
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
    console.error("🚨 wbty-on-vehicle-photo error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
