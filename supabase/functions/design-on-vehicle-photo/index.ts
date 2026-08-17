import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { tokenGate } from "../_shared/token-gate.ts";

/**
 * DESIGN ON VEHICLE PHOTO — Edge Function
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Single-step MyVehiclePro path: takes a real customer vehicle photo +
 * a creative design prompt and asks Gemini to DESIGN AND APPLY a custom
 * vinyl wrap directly onto the customer's photo in one shot.
 *
 * Why this exists (vs. edit-vehicle-photo):
 *   - edit-vehicle-photo TRANSFERS an existing studio render's design
 *     onto the customer's photo (two-step: studio render first, then
 *     transfer). The customer waits ~2x as long, the hero displays a
 *     generic studio render before the transfer lands, and design
 *     fidelity can drift in the second pass.
 *   - design-on-vehicle-photo SKIPS the studio render entirely. Gemini
 *     designs the wrap creatively against the customer's actual vehicle
 *     in one call — no transfer step, no generic intermediate.
 *
 * SCOPE: only used by /designpro (DesignPanelProPremium) when MVP mode
 * is active. Does not touch the studio render pipeline or any locked
 * render files.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface VisionBoardImageInput {
  storageUrl?: string;
  base64?: string;
  mimeType?: string;
  slotLabel?: string;
}

import { buildDesignOnPhotoPrompt } from "./prompt.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Token gate — 1 token per DesignPro on-photo render.
  const gate = await tokenGate(req, { reason: "design_on_vehicle_photo_render" });
  if (!gate.ok) return gate.response!;

  try {
    // ─── 1. PARSE REQUEST ───────────────────────────────────────────────
    const body = await req.json() as {
      userEmail?: string;
      uploadedPhotoBase64?: string;
      uploadedPhotoMimeType?: string;
      prompt?: string;
      finish?: string;
      vehicleInfo?: { year?: string; make?: string; model?: string };
      visionBoardImages?: VisionBoardImageInput[];
      visionboardIntent?: string;
      companyName?: string;
      phone?: string;
      mascot?: string;
      industryType?: string;
      bulletPoints?: string[];
      // The shared useMyVehicleGenerate hook (multi-angle path) nests the
      // design brief inside colorData; direct callers pass it top-level.
      colorData?: Record<string, any>;
    };

    const {
      userEmail: bodyUserEmail,
      uploadedPhotoBase64,
      uploadedPhotoMimeType,
      vehicleInfo,
    } = body;
    const cd = body.colorData || {};
    const prompt: string | undefined = body.prompt ?? cd.prompt;
    const finish: string | undefined = body.finish ?? cd.finish;
    const visionBoardImages: VisionBoardImageInput[] | undefined =
      body.visionBoardImages ?? cd.visionBoardImages;
    const visionboardIntent: string | undefined =
      body.visionboardIntent ?? cd.visionboardIntent;
    const companyName: string | undefined = body.companyName ?? cd.companyName;
    const phone: string | undefined = body.phone ?? cd.phone;
    const mascot: string | undefined = body.mascot ?? cd.mascot;
    const industryType: string | undefined = body.industryType ?? cd.industryType;
    const bulletPoints: string[] | undefined = body.bulletPoints ?? cd.bulletPoints;

    // JWT fallback for missing userEmail (mobile private browser)
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

    if (!uploadedPhotoBase64) {
      return new Response(
        JSON.stringify({ error: "Vehicle photo required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!prompt || !prompt.trim()) {
      return new Response(
        JSON.stringify({ error: "Design prompt required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!hasGeminiKey()) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }

    console.log("📸 design-on-vehicle-photo: starting", {
      userEmail,
      promptLength: prompt.length,
      finish,
      hasVehicleInfo: !!vehicleInfo,
      visionBoardCount: visionBoardImages?.length || 0,
    });

    // ─── 2. INITIALIZE SUPABASE ─────────────────────────────────────────
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

    // ─── 3. CHECK BLOCKED USERS ─────────────────────────────────────────
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

    // ─── 4. FETCH VISIONBOARD IMAGE BYTES (if any) ──────────────────────
    const visionBoardBytes: Array<{ base64: string; mimeType: string }> = [];
    if (Array.isArray(visionBoardImages) && visionBoardImages.length > 0) {
      for (const ref of visionBoardImages.slice(0, 4)) {
        try {
          if (ref.base64) {
            visionBoardBytes.push({
              base64: ref.base64,
              mimeType: ref.mimeType || "image/png",
            });
          } else if (ref.storageUrl) {
            const resp = await fetch(ref.storageUrl, { signal: AbortSignal.timeout(5000) });
            if (resp.ok) {
              const ct = resp.headers.get("content-type") || "";
              if (ct.startsWith("image/")) {
                const buf = await resp.arrayBuffer();
                if (buf.byteLength < 4 * 1024 * 1024) {
                  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
                  visionBoardBytes.push({ base64: b64, mimeType: ct });
                }
              }
            }
          }
        } catch (err) {
          console.warn("VisionBoard ref fetch failed (non-fatal):", err);
        }
      }
      console.log(`📚 Loaded ${visionBoardBytes.length} VisionBoard reference image(s)`);
    }

    // ─── 5. BUILD PROMPT ────────────────────────────────────────────────
    const aiPrompt = buildDesignOnPhotoPrompt({
      prompt,
      finish: finish || "Gloss",
      vehicleInfo,
      hasVisionBoard: visionBoardBytes.length > 0,
      visionBoardIntent: visionboardIntent,
      companyName,
      phone,
      mascot,
      industryType,
      bulletPoints,
    });
    console.log("📝 prompt built, length:", aiPrompt.length);

    // ─── 6. BUILD GEMINI REQUEST ────────────────────────────────────────
    const parts: any[] = [{ text: aiPrompt }];

    // IMAGE 1: customer's vehicle photo
    parts.push({
      inlineData: {
        mimeType: uploadedPhotoMimeType || "image/jpeg",
        data: uploadedPhotoBase64,
      },
    });

    // IMAGE 2+: VisionBoard references
    for (const ref of visionBoardBytes) {
      parts.push({
        inlineData: {
          mimeType: ref.mimeType,
          data: ref.base64,
        },
      });
    }

    // ─── 7. CALL GEMINI ─────────────────────────────────────────────────
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getGeminiKey()}`;

    let geminiResponse: Response | null = null;
    let lastError = "";
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`🤖 Gemini attempt ${attempt + 1}/${maxRetries}`);
        geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              responseMimeType: "text/plain",
              // 2K (not 4K) — a 4K base64 image held in memory across retries
              // trips Supabase's 546 worker memory/time limit. The base photo is
              // already ≤1600px, so 2K output is sharp and far more reliable.
              imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
            },
          }),
        });

        if (geminiResponse.ok) break;

        const status = geminiResponse.status;
        const errorText = await geminiResponse.text();
        lastError = `Gemini API returned ${status}: ${errorText}`;
        console.error(`❌ Attempt ${attempt + 1} failed:`, lastError);

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
        console.error(`❌ Fetch error attempt ${attempt + 1}:`, lastError);
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

    // ─── 8. EXTRACT IMAGE + DESIGN NAME ─────────────────────────────────
    const geminiData = await geminiResponse.json();
    const candidates = geminiData.candidates;
    if (!candidates || candidates.length === 0) {
      console.error("🚨 No candidates in Gemini response");
      return new Response(
        JSON.stringify({ error: "AI returned no results. The image may have been flagged." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let imageBase64 = "";
    let imageMimeType = "image/png";
    let designName: string | null = null;
    const responseParts = candidates[0]?.content?.parts || [];

    for (const part of responseParts) {
      if (part.inlineData && !imageBase64) {
        imageBase64 = part.inlineData.data;
        imageMimeType = part.inlineData.mimeType || "image/png";
      } else if (part.text && !designName) {
        const trimmed = part.text.trim().replace(/^["']|["']$/g, "");
        if (trimmed.length > 0 && trimmed.length < 80) designName = trimmed;
      }
    }

    if (!imageBase64) {
      console.error("🚨 No image in Gemini response. Parts:", JSON.stringify(responseParts.map((p: any) => Object.keys(p))));
      return new Response(
        JSON.stringify({ error: "AI did not return an image. Please try again with a different photo or prompt." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ Got image from Gemini, base64 size:", imageBase64.length, "designName:", designName);

    // ─── 9. UPLOAD TO STORAGE ───────────────────────────────────────────
    const timestamp = Date.now();
    const vehicleMake = vehicleInfo?.make || "vehicle";
    const vehicleModel = vehicleInfo?.model || "design";
    const fileExt = imageMimeType.includes("png") ? "png" : "jpg";
    const userPrefix = authenticatedUserId ? `${authenticatedUserId}/` : "";
    const storagePath = `renders/${userPrefix}myvehicle/${timestamp}_${vehicleMake}_${vehicleModel}_design.${fileExt}`;

    const imageBytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));

    const { error: uploadError } = await supabase.storage
      .from("wrap-files")
      .upload(storagePath, imageBytes, {
        contentType: imageMimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("🚨 Storage upload failed:", uploadError);
      throw new Error(`Failed to save designed image: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage
      .from("wrap-files")
      .getPublicUrl(storagePath);

    const renderUrl = publicUrlData.publicUrl;
    console.log("✅ Uploaded:", renderUrl);

    // ─── 10. SAVE TO DATABASE ───────────────────────────────────────────
    const { data: vizRecord, error: vizError } = await supabase
      .from("color_visualizations")
      .insert({
        customer_email: userEmail,
        vehicle_make: vehicleMake,
        vehicle_model: vehicleModel,
        vehicle_year: vehicleInfo?.year ? parseInt(vehicleInfo.year) : null,
        color_hex: "#000000",
        color_name: designName || "Custom Wrap Design",
        finish_type: finish || "Gloss",
        render_urls: { myvehicle_edit: renderUrl },
        generation_status: "completed",
        source_photo_url: `myvehicle_upload_${timestamp}`,
        mode_type: "myvehicle_designpro_direct",
      })
      .select("id")
      .single();

    if (vizError) {
      console.warn("⚠️ Failed to save visualization record:", vizError);
    }

    // ─── 11. RETURN RESULT ──────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        renderUrl,
        renderId: vizRecord?.id || null,
        designName,
        vehicleInfo: vehicleInfo || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("🚨 design-on-vehicle-photo error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
