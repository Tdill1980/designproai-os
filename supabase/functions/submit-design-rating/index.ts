/**
 * submit-design-rating
 *
 * Handles admin/user star-rating submissions for the QA & Curation page.
 * Uses service_role to bypass RLS on neuralnetwork_design_dna and
 * neuralnetwork_feedback, then triggers neuralnetwork-learn.
 *
 * Does NOT modify the neural network pipeline — only provides a reliable
 * server-side entry point for rating submission.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RatingRequest {
  visualization_id: string;
  rating: number;
  feedback_text?: string;
  render_urls: Record<string, string> | null;
  vehicle_info: { year?: string; make?: string; model?: string };
  mode_type?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify the caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: RatingRequest = await req.json();
    const { visualization_id, rating, feedback_text, render_urls, vehicle_info, mode_type } = body;

    if (!visualization_id || !rating || rating < 1 || rating > 5) {
      return new Response(JSON.stringify({ error: "Invalid rating (1-5) or missing visualization_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve the best available render URL for DNA matching
    const heroUrl = resolveHeroUrl(render_urls);

    // Step 1: Find or create the design_dna record (service_role bypasses RLS)
    let dnaId: string | null = null;

    if (heroUrl) {
      const { data: existingDna, error: lookupErr } = await supabase
        .from("neuralnetwork_design_dna")
        .select("id")
        .eq("vehicle_render_url", heroUrl)
        .maybeSingle();

      if (!lookupErr && existingDna?.id) {
        dnaId = existingDna.id;
      }
    }

    if (!dnaId) {
      // Create a new DNA record
      const allUrls = render_urls
        ? Object.entries(render_urls).map(([type, url]) => ({ type, url }))
        : [];

      const { data: newDna, error: insertErr } = await supabase
        .from("neuralnetwork_design_dna")
        .insert({
          creator_id: user.id,
          vehicle_year: vehicle_info.year || null,
          vehicle_make: vehicle_info.make || null,
          vehicle_model: vehicle_info.model || null,
          vehicle_render_url: heroUrl || null,
          all_render_urls: allUrls,
          mode: mode_type || "unknown",
          source: "live",
        })
        .select("id")
        .single();

      if (insertErr) {
        console.error("[submit-design-rating] DNA insert failed:", insertErr.message);
        return new Response(JSON.stringify({ error: `DNA insert failed: ${insertErr.message}` }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      dnaId = newDna?.id || null;
    }

    if (!dnaId) {
      return new Response(JSON.stringify({ error: "Failed to resolve design DNA record" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 2: Upsert feedback (one rating per user per design)
    const { data: existingFb } = await supabase
      .from("neuralnetwork_feedback")
      .select("id")
      .eq("design_dna_id", dnaId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingFb?.id) {
      const { error: updateErr } = await supabase
        .from("neuralnetwork_feedback")
        .update({
          rating,
          feedback_text: feedback_text || null,
          feedback_type: "admin",
        })
        .eq("id", existingFb.id);

      if (updateErr) {
        console.error("[submit-design-rating] Feedback update failed:", updateErr.message);
      }
    } else {
      const { error: fbInsertErr } = await supabase
        .from("neuralnetwork_feedback")
        .insert({
          design_dna_id: dnaId,
          user_id: user.id,
          rating,
          feedback_text: feedback_text || null,
          feedback_type: "admin",
        });

      if (fbInsertErr) {
        console.error("[submit-design-rating] Feedback insert failed:", fbInsertErr.message);
        return new Response(JSON.stringify({ error: `Feedback insert failed: ${fbInsertErr.message}` }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Step 3: Trigger NeuralNetwork learning (non-blocking, fire-and-forget)
    fetch(`${supabaseUrl}/functions/v1/neuralnetwork-learn`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        design_dna_id: dnaId,
        user_id: user.id,
        rating,
        feedback_text: feedback_text || undefined,
      }),
    }).catch((err) => {
      console.warn("[submit-design-rating] neuralnetwork-learn trigger failed (non-blocking):", err);
    });

    console.log(`[submit-design-rating] Rating ${rating}/5 saved for DNA ${dnaId} by ${user.id}`);

    return new Response(JSON.stringify({ success: true, dna_id: dnaId, rating }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[submit-design-rating] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Resolve the best available render URL from a render_urls map.
 * Tries hero → side → driver-side → first available URL.
 */
function resolveHeroUrl(renderUrls: Record<string, string> | null): string {
  if (!renderUrls) return "";

  // Priority order for DNA matching
  const priorityKeys = ["side", "driver-side", "front", "passenger-side", "rear", "hero"];
  for (const key of priorityKeys) {
    if (renderUrls[key] && typeof renderUrls[key] === "string") {
      return renderUrls[key];
    }
  }

  // Fallback: first available URL
  const values = Object.values(renderUrls).filter((v) => typeof v === "string" && v.startsWith("http"));
  return values[0] || "";
}
