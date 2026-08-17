import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { tokenGate } from "../_shared/token-gate.ts";
import { buildColorProMyVehiclePrompt } from "./prompt.ts";

/**
 * COLORPRO MyVehiclePro — Edge Function
 *
 * Recolors a customer's real vehicle photo with a vinyl film color.
 * Owned exclusively by ColorPro. Tune freely without affecting other tools.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Token gate — 1 token per ColorPro render. Admin/tester bypass,
  // active tier cap, then user_tokens.balance fallback. Returns 402
  // with paywall details if user has nothing left.
  const gate = await tokenGate(req, { reason: "colorpro_on_vehicle_photo_render" });
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

    if (!colorData || !colorData.colorName) {
      return new Response(
        JSON.stringify({ error: "Color selection required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!hasGeminiKey()) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }

    console.log("📸 colorpro-on-vehicle-photo: starting", {
      userEmail,
      color: colorData.colorName,
      manufacturer: colorData.manufacturer,
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

    // ─── Film grounding lookup ───────────────────────────────────────
    let groundingResult: any = null;
    const groundingReferenceImages: Array<{ base64: string; mimeType: string }> = [];
    try {
      const groundingUrl = `${SUPABASE_URL}/functions/v1/myvehicle-color-grounding`;
      const groundingResponse = await fetch(groundingUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          action: "ground",
          manufacturer: colorData.manufacturer || "",
          filmName: colorData.colorName,
          sku: colorData.productCode || colorData.sku || null,
          swatchId: colorData.swatchId || null,
        }),
      });

      if (groundingResponse.ok) {
        groundingResult = await groundingResponse.json();
        const refUrls = (groundingResult.vehicleExampleUrls || []).slice(0, 3);
        for (const url of refUrls) {
          try {
            const imgResp = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (imgResp.ok) {
              const contentType = imgResp.headers.get("content-type") || "";
              if (contentType.startsWith("image/")) {
                const imgBuf = await imgResp.arrayBuffer();
                if (imgBuf.byteLength < 4 * 1024 * 1024) {
                  const imgB64 = btoa(String.fromCharCode(...new Uint8Array(imgBuf)));
                  groundingReferenceImages.push({ base64: imgB64, mimeType: contentType });
                }
              }
            }
          } catch { /* skip failed fetches */ }
        }
      }
    } catch (groundErr) {
      console.warn("⚠️ Grounding lookup error (non-fatal):", groundErr);
    }

    // ─── Material profile lookup (LAB values) ────────────────────────
    let materialProfile: any = colorData.materialProfile || null;
    if (colorData.swatchId && !materialProfile) {
      const { data: mfgColor } = await supabase
        .from("manufacturer_colors")
        .select("lab_l, lab_a, lab_b, official_hex, finish, reflectivity, metallic_flake, finish_profile")
        .eq("id", colorData.swatchId)
        .maybeSingle();
      if (mfgColor) materialProfile = mfgColor;
    }

    // ─── Build prompt ────────────────────────────────────────────────
    const aiPrompt = buildColorProMyVehiclePrompt({
      colorName: colorData.colorName,
      manufacturer: colorData.manufacturer || "",
      sku: colorData.productCode || colorData.sku || undefined,
      finish: colorData.finish || "Gloss",
      vehicleInfo: vehicleInfo || undefined,
      groundingContext: groundingResult?.promptContext || undefined,
      hasReferenceImages: groundingReferenceImages.length > 0 || !!colorData.swatchImageBase64,
      reflectivity: materialProfile?.reflectivity,
      metallic_flake: materialProfile?.metallic_flake,
      finish_profile: materialProfile?.finish_profile,
      metallic: colorData.metallic,
      pearl: colorData.pearl,
      chrome: colorData.finish?.toLowerCase().includes("chrome"),
    });
    console.log("📝 prompt built, length:", aiPrompt.length);

    // ─── Build Gemini parts ──────────────────────────────────────────
    const photoMime = uploadedPhotoMimeType || "image/jpeg";
    const parts: any[] = [
      { text: aiPrompt },
      { inlineData: { mimeType: photoMime, data: uploadedPhotoBase64 } },
    ];

    if (colorData.swatchImageBase64) {
      parts.push({
        inlineData: {
          mimeType: colorData.swatchImageMimeType || "image/png",
          data: colorData.swatchImageBase64,
        },
      });
    }

    for (const refImg of groundingReferenceImages) {
      parts.push({
        inlineData: {
          mimeType: refImg.mimeType,
          data: refImg.base64,
        },
      });
    }

    // ─── Call Gemini with retries ────────────────────────────────────
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

    // ─── Upload + DB record ──────────────────────────────────────────
    const timestamp = Date.now();
    const vehicleMake = vehicleInfo?.make || "vehicle";
    const vehicleModel = vehicleInfo?.model || "edit";
    const fileExt = imageMimeType.includes("png") ? "png" : "jpg";
    const userPrefix = authenticatedUserId ? `${authenticatedUserId}/` : "";
    const storagePath = `renders/${userPrefix}myvehicle/${timestamp}_${vehicleMake}_${vehicleModel}_colorpro.${fileExt}`;

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
        color_hex: colorData.hex || colorData.colorHex || "#000000",
        color_name: colorData.colorName,
        finish_type: colorData.finish || "Gloss",
        render_urls: { myvehicle_edit: editedImageUrl },
        generation_status: "completed",
        source_photo_url: `myvehicle_upload_${timestamp}`,
        mode_type: "myvehicle_colorpro",
      })
      .select("id")
      .single();

    return new Response(
      JSON.stringify({
        renderUrl: editedImageUrl,
        renderId: vizRecord?.id || null,
        vehicleInfo: vehicleInfo || null,
        grounding: groundingResult ? {
          source: groundingResult.source,
          referenceId: groundingResult.referenceId || null,
          filmName: groundingResult.filmName,
          manufacturer: groundingResult.manufacturer,
          sku: groundingResult.sku,
        } : null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("🚨 colorpro-on-vehicle-photo error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
