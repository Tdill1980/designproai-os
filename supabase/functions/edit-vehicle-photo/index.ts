import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { buildMyVehiclePrompt, buildMyVehicleDesignPrompt } from "../_shared/myvehicle-prompt-builder.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

/**
 * EDIT VEHICLE PHOTO — Edge Function
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Takes a real customer vehicle photo + wrap color selection and uses
 * Gemini 3 Pro to recolor the vehicle body panels with the selected wrap.
 *
 * This is SEPARATE from generate-color-render (studio generation flow).
 * It does NOT modify or depend on that function's code.
 *
 * Flow:
 * 1. Validate auth + input
 * 2. Fetch uploaded photo from storage
 * 3. Optionally detect vehicle info
 * 4. Build photo-edit prompt
 * 5. Call Gemini 3 Pro with photo + swatch + prompt
 * 6. Upload result to storage
 * 7. Save record to color_visualizations
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ─── 1. PARSE REQUEST ───────────────────────────────────────────────
    const {
      userEmail: bodyUserEmail,
      uploadedPhotoBase64: rawPhotoBase64,
      uploadedPhotoMimeType: rawPhotoMimeType,
      uploadedPhotoUrl,
      colorData,
      vehicleInfo,
      // When false, return the rendered image WITHOUT inserting a
      // color_visualizations row. RevisionStudio passes this on revisions
      // because it already owns the versioned record (the clone) and a
      // second insert here would create an orphan, un-versioned duplicate.
      persistRender = true,
    } = await req.json();

    // FALLBACK: If userEmail is missing from request body (mobile private browser),
    // extract it from the JWT Authorization header.
    let userEmail = bodyUserEmail;
    if (!userEmail) {
      console.log('⚠️ No userEmail in request body — attempting JWT fallback');
      try {
        const supabaseForAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const authHeader = req.headers.get('Authorization');
        if (authHeader) {
          const token = authHeader.replace('Bearer ', '');
          const { data: { user: jwtUser } } = await supabaseForAuth.auth.getUser(token);
          if (jwtUser?.email) {
            userEmail = jwtUser.email;
            console.log('✅ JWT fallback resolved userEmail:', userEmail);
          }
        }
      } catch (e) {
        console.error('❌ JWT fallback exception:', e);
      }
    }

    if (!userEmail) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve photo: accept base64 directly OR fetch from URL server-side
    let uploadedPhotoBase64 = rawPhotoBase64;
    let uploadedPhotoMimeType = rawPhotoMimeType;

    if (!uploadedPhotoBase64 && uploadedPhotoUrl) {
      console.log("📥 Fetching vehicle photo from URL:", uploadedPhotoUrl);
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
      console.log("✅ Photo fetched from URL, base64 size:", uploadedPhotoBase64.length);
    }

    if (!uploadedPhotoBase64) {
      return new Response(
        JSON.stringify({ error: "No vehicle photo provided (base64 or URL required)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!colorData) {
      return new Response(
        JSON.stringify({ error: "Color or design selection required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine tool source — different tools send different data
    const toolSource: string = colorData.toolSource || "ColorPro";
    const isDesignMode = !!(colorData.panelUrl || colorData.designUrl || colorData.customStylingPrompt || colorData.fadeStyle);

    // For color-based tools (ColorPro), colorName is required
    // For design-based tools, the design data (panelUrl, designUrl, etc.) is the key input
    if (!isDesignMode && !colorData.colorName) {
      return new Response(
        JSON.stringify({ error: "Color selection required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── 1.5. FILM-GROUNDING LOOKUP (color mode only) ──────────────────
    let groundingResult: any = null;
    let groundingReferenceImages: Array<{ base64: string; mimeType: string }> = [];

    if (!isDesignMode && colorData.colorName) {
      try {
        console.log("🔍 Calling myvehicle-color-grounding for:", colorData.colorName);
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
          console.log("✅ Grounding result:", groundingResult.source, "refs:", groundingResult.vehicleExampleUrls?.length || 0);

          // Fetch reference image bytes (vehicle examples from grounding)
          const refUrls = (groundingResult.vehicleExampleUrls || []).slice(0, 3);
          for (const url of refUrls) {
            try {
              const imgResp = await fetch(url, { signal: AbortSignal.timeout(5000) });
              if (imgResp.ok) {
                const contentType = imgResp.headers.get("content-type") || "";
                if (contentType.startsWith("image/")) {
                  const imgBuf = await imgResp.arrayBuffer();
                  if (imgBuf.byteLength < 4 * 1024 * 1024) { // skip if > 4MB
                    const imgB64 = btoa(String.fromCharCode(...new Uint8Array(imgBuf)));
                    groundingReferenceImages.push({ base64: imgB64, mimeType: contentType });
                  }
                }
              }
            } catch { /* skip failed fetches */ }
          }
          console.log("📸 Fetched", groundingReferenceImages.length, "reference images from grounding");
        } else {
          console.warn("⚠️ Grounding call failed:", groundingResponse.status);
        }
      } catch (groundErr) {
        console.warn("⚠️ Grounding lookup error (non-fatal):", groundErr);
      }
    }

    if (!hasGeminiKey()) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }

    console.log("📸 edit-vehicle-photo: Starting photo edit", {
      userEmail,
      toolSource,
      isDesignMode,
      color: colorData.colorName || colorData.panelName || colorData.designName || "design",
      finish: colorData.finish,
      manufacturer: colorData.manufacturer,
      hasVehicleInfo: !!vehicleInfo,
      hasPanelUrl: !!colorData.panelUrl,
      hasDesignUrl: !!colorData.designUrl,
      hasFadeStyle: !!colorData.fadeStyle,
      photoMimeType: uploadedPhotoMimeType || "image/jpeg",
    });

    // ─── 2. INITIALIZE SUPABASE CLIENT ──────────────────────────────────
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ─── 2.5. RESOLVE USER ID FROM AUTH TOKEN ───────────────────────────
    let authenticatedUserId: string | null = null;
    try {
      const authHeader = req.headers.get('Authorization');
      if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) authenticatedUserId = user.id;
      }
    } catch { /* non-fatal — fallback to email-based path */ }

    // ─── 3. CHECK BLOCKED USERS ────────────────────────────────────────
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

    // ─── 4. LOOKUP MATERIAL PROFILE (if swatchId provided) ─────────────
    let materialProfile: any = colorData.materialProfile || null;
    let lab: { L: number; a: number; b: number } | undefined;

    if (colorData.swatchId && !materialProfile) {
      console.log("🔍 Looking up material profile for swatch:", colorData.swatchId);
      const { data: mfgColor } = await supabase
        .from("manufacturer_colors")
        .select("lab_l, lab_a, lab_b, official_hex, finish")
        .eq("id", colorData.swatchId)
        .maybeSingle();

      if (mfgColor && mfgColor.lab_l !== null) {
        lab = { L: mfgColor.lab_l, a: mfgColor.lab_a, b: mfgColor.lab_b };
        console.log("✅ Found LAB values:", lab);
      }
    } else if (materialProfile?.lab_l !== undefined) {
      lab = {
        L: materialProfile.lab_l,
        a: materialProfile.lab_a,
        b: materialProfile.lab_b,
      };
    }

    // ─── 5. BUILD PROMPT ────────────────────────────────────────────────
    let aiPrompt: string;
    let designImageUrl: string | null = null;

    if (isDesignMode) {
      // ── DESIGN MODE: Build prompt for panel/design/fade/graphics tools ──
      aiPrompt = buildMyVehicleDesignPrompt({
        toolSource,
        panelUrl: colorData.panelUrl,
        panelName: colorData.panelName,
        designUrl: colorData.designUrl,
        designName: colorData.designName,
        fadeStyle: colorData.fadeStyle,
        fadeSpec: colorData.fadeSpec,
        colorName: colorData.colorName || colorData.colorHex,
        colorHex: colorData.colorHex,
        customStylingPrompt: colorData.customStylingPrompt,
        finish: colorData.finish || "Gloss",
        vehicleInfo: vehicleInfo || undefined,
      });

      // Determine if we need to fetch a design image as reference
      designImageUrl = colorData.panelUrl || colorData.designUrl || null;
      console.log("📝 Design mode prompt built, length:", aiPrompt.length, "designImageUrl:", designImageUrl);
    } else {
      // ── COLOR MODE: Film-identity-grounded prompt (hex stripped) ──
      aiPrompt = buildMyVehiclePrompt({
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
      console.log("📝 Color mode prompt built (film-grounded), length:", aiPrompt.length);
    }

    // ─── 6. BUILD GEMINI API REQUEST ────────────────────────────────────
    // Parts: text prompt + uploaded photo + optional reference images
    const parts: any[] = [{ text: aiPrompt }];

    // Add the customer's uploaded photo (Image 1)
    const photoMime = uploadedPhotoMimeType || "image/jpeg";
    parts.push({
      inlineData: {
        mimeType: photoMime,
        data: uploadedPhotoBase64,
      },
    });

    // Add design reference image (Image 2) if panelUrl/designUrl provided
    if (designImageUrl) {
      try {
        console.log("🎨 Fetching design reference image:", designImageUrl);
        const designResponse = await fetch(designImageUrl);
        if (designResponse.ok) {
          const designBuffer = await designResponse.arrayBuffer();
          const designBase64 = btoa(String.fromCharCode(...new Uint8Array(designBuffer)));
          const designMime = designResponse.headers.get("content-type") || "image/png";
          parts.push({
            inlineData: {
              mimeType: designMime,
              data: designBase64,
            },
          });
          console.log("✅ Design reference image included, size:", designBase64.length);
        } else {
          console.warn("⚠️ Could not fetch design reference image:", designResponse.status);
        }
      } catch (fetchErr) {
        console.warn("⚠️ Design reference image fetch failed:", fetchErr);
      }
    }

    // Add swatch reference image if available (for color mode)
    if (colorData.swatchImageBase64) {
      parts.push({
        inlineData: {
          mimeType: colorData.swatchImageMimeType || "image/png",
          data: colorData.swatchImageBase64,
        },
      });
      console.log("🎨 Swatch reference image included");
    }

    // Add grounding reference images (IMAGE 3+) — real-world film examples
    for (const refImg of groundingReferenceImages) {
      parts.push({
        inlineData: {
          mimeType: refImg.mimeType,
          data: refImg.base64,
        },
      });
    }
    if (groundingReferenceImages.length > 0) {
      console.log(`🔗 Added ${groundingReferenceImages.length} grounding reference images`);
    }

    // ─── 7. CALL GEMINI ──────────────────────────────────────────
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getGeminiKey()}`;

    let geminiResponse: Response | null = null;
    let lastError = "";
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`🤖 Gemini API call attempt ${attempt + 1}/${maxRetries}`);

        geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              responseMimeType: "text/plain",
              imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
              // Design-mode requires deterministic pattern reproduction
              // (PatternPro / DesignPanelPro library panels). Higher temps
              // let Gemini swap in a similar-looking pattern. Color mode
              // keeps default temperature so film colors still have natural
              // variation under real-world lighting.
              ...(isDesignMode ? { temperature: 0.05 } : {}),
            },
          }),
        });

        if (geminiResponse.ok) break;

        const status = geminiResponse.status;
        const errorText = await geminiResponse.text();
        lastError = `Gemini API returned ${status}: ${errorText}`;
        console.error(`❌ Attempt ${attempt + 1} failed:`, lastError);

        // Don't retry on client errors (except rate limit)
        if (status === 429) {
          // Rate limited — wait and retry
          const waitMs = Math.pow(2, attempt + 1) * 1000;
          console.log(`⏳ Rate limited, waiting ${waitMs}ms...`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (status === 403) {
          return new Response(
            JSON.stringify({ error: "AI API access denied. Check API key configuration." }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (status >= 400 && status < 500) {
          // Client error — don't retry
          return new Response(
            JSON.stringify({ error: `AI generation failed: ${errorText}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Server error — retry with backoff
        const waitMs = Math.pow(2, attempt + 1) * 1000;
        console.log(`⏳ Server error, retrying in ${waitMs}ms...`);
        await new Promise((r) => setTimeout(r, waitMs));
      } catch (fetchErr: any) {
        lastError = fetchErr.message;
        console.error(`❌ Fetch error attempt ${attempt + 1}:`, lastError);
        const waitMs = Math.pow(2, attempt + 1) * 1000;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    if (!geminiResponse || !geminiResponse.ok) {
      console.error("🚨 All Gemini retries failed:", lastError);
      return new Response(
        JSON.stringify({ error: "AI generation failed after retries. Please try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── 8. EXTRACT IMAGE FROM RESPONSE ─────────────────────────────────
    const geminiData = await geminiResponse.json();
    const candidates = geminiData.candidates;

    if (!candidates || candidates.length === 0) {
      console.error("🚨 No candidates in Gemini response");
      return new Response(
        JSON.stringify({ error: "AI returned no results. The image may have been flagged." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find the image part in the response
    let imageBase64 = "";
    let imageMimeType = "image/png";
    const responseParts = candidates[0]?.content?.parts || [];

    for (const part of responseParts) {
      if (part.inlineData) {
        imageBase64 = part.inlineData.data;
        imageMimeType = part.inlineData.mimeType || "image/png";
        break;
      }
    }

    if (!imageBase64) {
      console.error("🚨 No image in Gemini response. Parts:", JSON.stringify(responseParts.map((p: any) => Object.keys(p))));
      return new Response(
        JSON.stringify({ error: "AI did not return an image. Please try again with a different photo." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ Got edited image from Gemini, size:", imageBase64.length, "bytes (base64)");

    // ─── 9. UPLOAD RESULT TO STORAGE ────────────────────────────────────
    const timestamp = Date.now();
    const vehicleMake = vehicleInfo?.make || "vehicle";
    const vehicleModel = vehicleInfo?.model || "edit";
    const fileExt = imageMimeType.includes("png") ? "png" : "jpg";
    // User-scoped storage path: renders/{userId}/myvehicle/...
    const userPrefix = authenticatedUserId ? `${authenticatedUserId}/` : '';
    const storagePath = `renders/${userPrefix}myvehicle/${timestamp}_${vehicleMake}_${vehicleModel}_edited.${fileExt}`;

    // Decode base64 to binary
    const imageBytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));

    const { error: uploadError } = await supabase.storage
      .from("wrap-files")
      .upload(storagePath, imageBytes, {
        contentType: imageMimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("🚨 Storage upload failed:", uploadError);
      throw new Error(`Failed to save edited image: ${uploadError.message}`);
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from("wrap-files")
      .getPublicUrl(storagePath);

    const editedImageUrl = publicUrlData.publicUrl;
    console.log("✅ Edited image uploaded:", editedImageUrl);

    // ─── 10. SAVE TO DATABASE ───────────────────────────────────────────
    // Skipped on revisions (persistRender === false) — RevisionStudio already
    // created the versioned clone row and updates it with this URL, so a
    // second insert here would orphan an un-versioned duplicate.
    let vizRecord: { id: string } | null = null;
    if (persistRender) {
      const displayName = colorData.colorName || colorData.panelName || colorData.designName || "design";
      const { data: inserted, error: vizError } = await supabase
        .from("color_visualizations")
        .insert({
          customer_email: userEmail,
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          vehicle_year: vehicleInfo?.year ? parseInt(vehicleInfo.year) : null,
          color_hex: colorData.hex || colorData.colorHex || "#000000",
          color_name: displayName,
          finish_type: colorData.finish || "Gloss",
          render_urls: { myvehicle_edit: editedImageUrl },
          generation_status: "completed",
          source_photo_url: `myvehicle_upload_${timestamp}`,
          mode_type: `myvehicle_${toolSource.toLowerCase()}`,
        })
        .select("id")
        .single();

      if (vizError) {
        console.warn("⚠️ Failed to save visualization record:", vizError);
        // Non-fatal — still return the image
      }
      vizRecord = inserted;
    }

    // ─── 11. RETURN RESULT ──────────────────────────────────────────────
    console.log("✅ edit-vehicle-photo complete!", {
      renderId: vizRecord?.id,
      editedImageUrl,
    });

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
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("🚨 edit-vehicle-photo error:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "An unexpected error occurred",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
