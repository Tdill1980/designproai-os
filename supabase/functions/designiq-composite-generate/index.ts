/**
 * designiq-composite-generate — orchestrator for the panel/layer wrap pipeline.
 *
 * Builds a wrap from layers instead of one painted pass:
 *   1. Ask the ArtGenerator (Gemini today, Vertex/DesignDNA later) for the
 *      artistic BASE art, telling it to leave the logo zone clean.
 *   2. Composite a crisp LogoPro lockup (and later: photo panel, QR) on top at
 *      exact coordinates — so the brand mark stays razor-sharp instead of being
 *      melted by the image model.
 *   3. Upload the composited result and return it.
 *
 * This function is NEW and additive. It does NOT modify any locked file — it
 * calls the locked render path through the ArtGenerator seam. It is not wired
 * into the live UI yet; callers opt in explicitly, so deploying it changes
 * nothing for existing renders.
 *
 * NOTE: image-compositing code that must be validated with a real render —
 * this ships behind explicit opt-in and needs a visual test pass.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getArtGenerator } from "../_shared/art-generator/factory.ts";
import type { ArtBrief, ReservedZone } from "../_shared/art-generator/types.ts";
import { compositeImageLayers, type ImageLayer } from "../_shared/compositor/composite-layers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Default placement for the company logo lockup, per view. Center + width as
// fractions of the frame. Tunable — these are first-pass guesses to verify
// against real renders.
const DEFAULT_LOGO_PLACEMENT: Record<string, { xPct: number; yPct: number; widthPct: number }> = {
  side: { xPct: 0.45, yPct: 0.44, widthPct: 0.30 },
  "passenger-side": { xPct: 0.55, yPct: 0.44, widthPct: 0.30 },
  hood_detail: { xPct: 0.50, yPct: 0.45, widthPct: 0.40 },
  front: { xPct: 0.50, yPct: 0.55, widthPct: 0.26 },
  rear: { xPct: 0.50, yPct: 0.50, widthPct: 0.28 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("authorization") || "";

    // Authenticate the end user (same gate as the render path).
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return json({ error: "Authentication required" }, 401);
    }

    const body = await req.json();
    const {
      mode = "commercial",
      prompt,
      finish = "Gloss",
      substrate,
      brandColors,
      industryType,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      viewType = "side",
      styleDescriptors,
      visionBoardImages,
      visionboard_intent,
      originalRenderUrl,
      // Compositing inputs:
      logoUrl,                 // crisp logo lockup PNG (preferred — e.g. from the existing injectedLogo flow)
      logoPlacement,           // optional { xPct, yPct, widthPct } override
      artModel,                // optional engine preference ("gemini" | "vertex")
      // Auto-logo (no-upload path):
      autoLogo,                // when true and no logoUrl, generate one via LogoPro
      companyName,             // brand inputs for LogoPro auto-gen
      phone,
      website,
      mascot,
      brandKeywords,
    } = body || {};

    if (!prompt) return json({ error: "Missing required field: prompt" }, 400);

    // 0. Resolve the logo source. Prefer an explicit logoUrl; otherwise, if
    //    autoLogo is requested, generate a lockup via LogoPro. Auto-gen never
    //    blocks the render — on any failure we fall back to no logo (base art).
    let resolvedLogoUrl: string | null = logoUrl || null;
    if (!resolvedLogoUrl && autoLogo && companyName) {
      try {
        const lpRes = await fetch(`${supabaseUrl}/functions/v1/logopro-generate-concepts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": authHeader, "apikey": anonKey },
          body: JSON.stringify({
            companyName,
            industry: industryType,
            mascotDescription: mascot,
            brandColors: Array.isArray(brandColors) ? brandColors : (brandColors ? [brandColors] : []),
            keywords: Array.isArray(brandKeywords) ? brandKeywords : [],
            phone,
            website,
          }),
        });
        const lpData = await lpRes.json().catch(() => ({}));
        const firstConcept = Array.isArray(lpData?.concepts) ? lpData.concepts[0] : null;
        if (lpRes.ok && firstConcept?.imageUrl) {
          resolvedLogoUrl = firstConcept.imageUrl;
        } else {
          console.warn("[composite] LogoPro auto-gen returned no concept; continuing without logo:", lpData?.error || lpRes.status);
        }
      } catch (e) {
        console.warn("[composite] LogoPro auto-gen failed; continuing without logo:", (e as Error).message);
      }
    }

    // 1. Reserve the logo zone so the base art stays clean where the lockup lands.
    const place = logoPlacement || DEFAULT_LOGO_PLACEMENT[viewType] || DEFAULT_LOGO_PLACEMENT.side;
    const reservedZones: ReservedZone[] = resolvedLogoUrl
      ? [{
          role: "logo",
          xPct: place.xPct - place.widthPct / 2,
          yPct: place.yPct - place.widthPct / 4,
          wPct: place.widthPct,
          hPct: place.widthPct / 2,
          note: "keep flat and free of text/graphics for a composited logo lockup",
        }]
      : [];

    const brief: ArtBrief = {
      mode, prompt, finish, substrate,
      vehicle: { year: vehicleYear, make: vehicleMake, model: vehicleModel },
      viewType, brandColors, industryType, reservedZones, styleDescriptors,
      visionBoardImages, visionboard_intent, originalRenderUrl,
    };

    // 2. Generate the base art via the swappable engine.
    const generator = getArtGenerator(artModel);
    const art = await generator.generateBaseArt(brief, { supabaseUrl, authHeader, anonKey });

    // 3. If no logo to composite, return the base art unchanged (pass-through).
    if (!resolvedLogoUrl) {
      return json({
        renderUrl: art.imageUrl,
        composited: false,
        baseUrl: art.imageUrl,
        designName: art.designName,
        designAnchorText: art.designAnchorText,
        modelId: art.modelId,
        engine: generator.id,
      }, 200);
    }

    // 4. Composite the crisp logo lockup onto the base art.
    const layers: ImageLayer[] = [{
      url: resolvedLogoUrl,
      xPct: place.xPct,
      yPct: place.yPct,
      widthPct: place.widthPct,
    }];
    const compositedPng = await compositeImageLayers(art.imageUrl, layers);

    // 5. Upload the composited result.
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const fileName = `composite/${user.id}/${Date.now()}-${viewType}.png`;
    const { error: upErr } = await service.storage
      .from("wrap-files")
      .upload(fileName, compositedPng, { contentType: "image/png", upsert: true });
    if (upErr) {
      // Fall back to the base art so the request still yields a usable render.
      console.error("[composite] upload failed:", upErr.message);
      return json({
        renderUrl: art.imageUrl,
        composited: false,
        baseUrl: art.imageUrl,
        warning: "composite upload failed; returned base art",
        modelId: art.modelId,
        engine: generator.id,
      }, 200);
    }
    const { data: { publicUrl } } = service.storage.from("wrap-files").getPublicUrl(fileName);

    return json({
      renderUrl: publicUrl,
      composited: true,
      baseUrl: art.imageUrl,
      designName: art.designName,
      designAnchorText: art.designAnchorText,
      modelId: art.modelId,
      engine: generator.id,
    }, 200);
  } catch (err) {
    console.error("[designiq-composite-generate] error:", err);
    return json({ error: (err as Error).message || "Composite generation failed" }, 500);
  }

  function json(payload: unknown, status: number) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
