/**
 * recreatepro-analyze — RecreatePro™ INTAKE. Photo in, design brief out.
 *
 * Ported from restylepro-os 2026-09-16, unchanged in behaviour.
 *
 * ── WHY THIS ONE WAS PORTED AND ITS THREE SIBLINGS WERE NOT ──
 *
 * RecreatePro is four Edge Functions in restylepro-os. Only this one belongs
 * here, because only this one PRODUCES NOTHING. It reads a customer's photo of
 * an existing wrap and returns TEXT — a design specification. No pixels, no
 * views, no panels, no print files. It cannot collide with a producer because
 * it is not one.
 *
 * The other three are all second producers under this project's rules and must
 * NOT be ported:
 *
 *   designpro-recreate-3d        — authors Driver from an artboard by
 *                                  `artboard_projection`, then clones the other
 *                                  cameras. That is exactly `runAtlasProofStages`
 *                                  in runtime/generation-worker.cjs, and RULE 0.16
 *                                  puts Calls 1-7 in the runtime, not in Edge.
 *                                  `designpro-orchestrate` already records this
 *                                  decision: "obsolete, not missing".
 *   recreatepro-flat-panels      — a per-side AI flatten. Here the panel cut is
 *                                  PURE GEOMETRY (Call 9 / `panels.build` is a
 *                                  byte registrar with no creative call). Adding
 *                                  an AI flatten at panel time is the regression
 *                                  restylepro-os already booked: it "shipped
 *                                  vehicle pictures as hood/front panels (Elite
 *                                  Volt) — removed from Call 9, never reintroduce."
 *   recreatepro-build-print-files — retired 2026-07-24 in its own repo as a second
 *                                  producer into the panel_artboard_jobs hub.
 *
 * ── HOW RECREATEPRO IS MEANT TO WORK HERE ──
 *
 * As an INTAKE MODE on the one sanctioned chain, never a parallel pipeline:
 *
 *   customer photo → THIS FUNCTION → design brief text
 *                  → A.T.L.A.S. Call 1 (brief + the photo as a reference)
 *                  → proofs, panels, logo lift, QC, Topaz, ZIP, WrapBox
 *                    — all of which already exist and already run.
 *
 * So "recreate an existing wrap" becomes a different way to WRITE THE BRIEF,
 * not a different way to build the files. Nothing downstream needs to know a
 * job came from a photo.
 *
 * Input:  { imageBase64: string, imageMimeType: string }
 * Output: { analysis: string, success: true }
 *
 * NOTE for a later pass: the analysis call uses `gemini-2.5-flash-image`, an
 * image-OUTPUT model, for a text-only response. It was ported verbatim so that
 * any behaviour change here is attributable to the port and nothing else. Moving
 * it to a text model is a separate, measurable change — do it on its own.
 *
 * config.toml: [functions.recreatepro-analyze]  verify_jwt = false
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64, imageMimeType } = await req.json();

    if (!imageBase64 || !imageMimeType) {
      return new Response(
        JSON.stringify({ error: "imageBase64 and imageMimeType are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Authenticate ---
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let userId: string | null = null;
    if (authHeader) {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id || null;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Subscription check ---
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check bypass roles (admin/tester)
    const { data: roleRow } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "tester"])
      .maybeSingle();

    if (!roleRow) {
      // Check subscription — RecreatePro requires at least Starter tier (uses render credits)
      const { data: subRow } = await adminClient
        .from("user_subscriptions")
        .select("tier, status, render_count, render_limit")
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();

      const tier = subRow?.tier || "free";
      if (tier === "free") {
        return new Response(
          JSON.stringify({
            error: "RecreatePro™ requires an active subscription. Upgrade to get started.",
            upgrade_required: true,
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // --- Gemini key ---
    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "AI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Analyze design with Gemini Vision ---
    const analysisPrompt = `You are a professional vehicle wrap design analyst for RecreatePro™.

Analyze this image of a wrapped vehicle and produce a detailed design specification that another AI can use to EXACTLY recreate this wrap design on a different vehicle.

Describe in precise detail:

1. COLORS: Every color with hex values and exact placement on the vehicle
2. DESIGN ELEMENTS: All stripes, curves, gradients, shapes, geometric patterns — exact position, size, direction of flow, and relationship to vehicle body lines
3. GRAPHICS & LOGOS: Any logos, text, graphics — their size, placement, colors, and fonts
4. TYPOGRAPHY: All text content, font styles, sizes, and exact placement
5. COMPOSITION: Overall flow direction, symmetry, focal points, design rhythm
6. COVERAGE: Which panels are wrapped vs exposed (hood, roof, doors, fenders, bumpers, mirrors, pillars)
7. FINISH: Matte, gloss, satin, chrome, color-shift — identify the vinyl finish type
8. TRANSITIONS: How colors/elements transition between panels — hard cuts, fades, overlaps

Output a single comprehensive paragraph optimized for AI image generation. Be extremely specific about spatial relationships, proportions, and color placement. Include hex color values where identifiable.`;

    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${getGeminiKey()}`;

    const response = await fetch(geminiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: analysisPrompt },
            { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
          ],
        }],
        generationConfig: {
          responseMimeType: "text/plain",
          maxOutputTokens: 2048,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini error:", errText);
      throw new Error(`AI analysis failed (${response.status})`);
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    let analysis = "";

    if (parts) {
      for (const part of parts) {
        if (part.text) {
          analysis = part.text.trim();
          break;
        }
      }
    }

    if (!analysis) {
      throw new Error("AI returned empty analysis");
    }

    console.log(`✅ RecreatePro analysis complete (${analysis.length} chars) for user ${userId}`);

    return new Response(
      JSON.stringify({ analysis, success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err: any) {
    console.error("RecreatePro analyze error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Analysis failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
