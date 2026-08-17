/**
 * auto-generate-artboard — Fire-and-forget artboard pipeline
 *
 * Called in parallel after "All Views" completes. Runs in its own memory
 * budget so it can't OOM the render pipeline.
 *
 * Steps:
 *   1. Generate 2D proof (flat artwork) from the 7 render views
 *   2. Create/find panelizer_job for this design
 *   3. Call generate-artboard-flat with the 2D proof as source
 *   4. Store artboard PNG — awaits production pack, not shown to customer
 *
 * Fire-and-forget: caller does NOT await. If this fails, the render
 * still succeeds and the user can manually generate from QC Artboard.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function log(msg: string, meta?: Record<string, unknown>) {
  console.log(`[auto-artboard] ${msg}`, meta ? JSON.stringify(meta) : "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const {
      visualizationId,
      designiqGenerationId,
      allViewUrls,       // Record<string, string> e.g. { "driver-side": "https://...", ... }
      vehicleYear,
      vehicleMake,
      vehicleModel,
      designName,
      finish,
      skipProofGeneration, // caller already generated the proof — don't duplicate the Gemini call
      flatProofUrl: callerProofUrl, // pre-generated 2D proof URL from caller (sequential pipeline)
    } = await req.json();

    if (!allViewUrls || Object.keys(allViewUrls).length === 0) {
      return new Response(
        JSON.stringify({ error: "No view URLs provided" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const vehicleName = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ").trim() || "Vehicle";
    log("Starting auto-artboard pipeline", { vehicleName, viewCount: Object.keys(allViewUrls).length });

    // ── Step 1: Generate 2D proof from all views ──
    // Caller can pass skipProofGeneration when it has already fired the proof
    // in parallel — prevents duplicate Gemini calls. Artboard falls through
    // to 3D-renders path in Step 3 when proof is skipped.
    let flatProofUrl: string | null = callerProofUrl || null;
    if (flatProofUrl) {
      log("Using caller-provided 2D proof as source (sequential pipeline)", { flatProofUrl: flatProofUrl.slice(0, 80) });
    } else if (skipProofGeneration) {
      log("Skipping 2D proof generation (caller handles it) — WARNING: no proof URL provided, artboard will use raw renders");
    } else {
      try {
      log("Generating 2D proof...");
      const proofResp = await fetch(`${supabaseUrl}/functions/v1/generate-2d-proof`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          allViewUrls,
          vehicleYear: vehicleYear || "",
          vehicleMake: vehicleMake || "",
          vehicleModel: vehicleModel || "",
          designName: designName || "Design",
          finish: finish || "Gloss",
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (proofResp.ok) {
        const proofData = await proofResp.json();
        flatProofUrl = proofData?.proofUrl || proofData?.url || null;
        if (flatProofUrl) {
          log("2D proof generated", { flatProofUrl: flatProofUrl.slice(0, 80) });

          // Store proof URL on the designiq_generations record
          if (designiqGenerationId) {
            await supabase
              .from("designiq_generations")
              .update({ flat_proof_url: flatProofUrl })
              .eq("id", designiqGenerationId);
          }
        }
      } else {
        log("2D proof generation failed (non-fatal) — will use 3D renders", { status: proofResp.status });
      }
    } catch (proofErr) {
      log("2D proof error (non-fatal) — will use 3D renders", { error: (proofErr as Error).message });
    }
    }

    // ── Step 2: Find or create panelizer_job ──
    let jobId: string | null = null;

    // Check if a panelizer_job already exists for this design. panelizer_jobs
    // is keyed by generation_id (the DesignIQ generation id) — there is NO
    // visualization_id column, so look up by generation_id. (Using a missing
    // column here previously 500'd the entire artboard pipeline.)
    if (designiqGenerationId) {
      const { data: existingJob } = await supabase
        .from("panelizer_jobs")
        .select("id")
        .eq("generation_id", designiqGenerationId)
        .maybeSingle();
      if (existingJob) {
        jobId = existingJob.id;
        log("Found existing panelizer_job", { jobId });
      }
    }

    // Secondary lookup by designiq_generation_id stashed in concept_json (older
    // rows created before generation_id was populated).
    if (!jobId && designiqGenerationId) {
      const { data: genJob } = await supabase
        .from("panelizer_jobs")
        .select("id")
        .contains("concept_json", { designiq_generation_id: designiqGenerationId })
        .maybeSingle();
      if (genJob) {
        jobId = genJob.id;
        log("Found panelizer_job by concept_json generation_id", { jobId });
      }
    }

    if (!jobId) {
      // Create a new panelizer_job
      const approvedUrl = allViewUrls["driver-side"] || allViewUrls["side"] || Object.values(allViewUrls)[0] || "";
      const { data: newJob, error: createErr } = await supabase
        .from("panelizer_jobs")
        .insert({
          generation_id: designiqGenerationId || null,
          vehicle_year: parseInt(String(vehicleYear), 10) || null,
          vehicle_make: vehicleMake || null,
          vehicle_model: vehicleModel || null,
          status: "queued",
          approved_render_url: approvedUrl,
          all_view_urls: allViewUrls,
          concept_json: {
            designiq_generation_id: designiqGenerationId || null,
            visualization_id: visualizationId || null,
            designDescription: designName || "",
            finish: finish || "Gloss",
            approved_render_url: approvedUrl,
            all_view_urls: allViewUrls,
            flat_proof_url: flatProofUrl,
            auto_generated: true,
          },
        })
        .select("id")
        .single();

      if (createErr || !newJob) {
        log("Failed to create panelizer_job", { error: createErr?.message });
        return new Response(
          JSON.stringify({ error: "Failed to create panelizer_job", detail: createErr?.message }),
          { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
      jobId = newJob.id;
      log("Created new panelizer_job", { jobId });
    } else {
      // Update existing job with latest view URLs and proof
      await supabase
        .from("panelizer_jobs")
        .update({
          all_view_urls: allViewUrls,
          concept_json: {
            designiq_generation_id: designiqGenerationId || null,
            designDescription: designName || "",
            finish: finish || "Gloss",
            approved_render_url: allViewUrls["driver-side"] || Object.values(allViewUrls)[0] || "",
            all_view_urls: allViewUrls,
            flat_proof_url: flatProofUrl,
            auto_generated: true,
          },
        })
        .eq("id", jobId);
    }

    // ── Step 3: request the ONE sanctioned Build Assets producer ────────────
    // This function is registration/orchestration only. It must never call a
    // second producer or fall back to a generative artboard. The server-side
    // production job will build the immutable per-side assets and write them to
    // production_flow_assets; run-production-flow then pulls that vault.
    const requestedAt = new Date().toISOString();
    const heroUrl = allViewUrls["side"] || allViewUrls["driver-side"] || Object.values(allViewUrls)[0] || "";
    await supabase
      .from("panelizer_jobs")
      .update({
        status: "awaiting_build_assets",
        approved_render_url: heroUrl,
        all_view_urls: allViewUrls,
        concept_json: {
          designiq_generation_id: designiqGenerationId || null,
          designDescription: designName || "",
          finish: finish || "Gloss",
          approved_render_url: heroUrl,
          all_view_urls: allViewUrls,
          flat_proof_url: flatProofUrl,
          auto_generated: true,
          production_build: {
            state: "awaiting_build_assets",
            proof_url: flatProofUrl,
            requested_at: requestedAt,
          },
        },
      })
      .eq("id", jobId);

    log("Canonical Build Assets requested", {
      jobId,
      proofUrl: (flatProofUrl || "").slice(0, 80),
      requestedAt,
    });

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        artboard_url: null,
        flat_proof_url: flatProofUrl,
        source: "canonical_build_assets",
        status: "awaiting_build_assets",
        needsBuild: true,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    log("Pipeline error", { error: (err as Error).message });
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
