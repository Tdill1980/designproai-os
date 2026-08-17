/**
 * ─────────────────────────────────────────────────────────────
 *  GENIE™ Universal Panelizer
 *  Part of the LiftIQ Engine™ / Prompt-to-Production™ architecture.
 *
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *  Proprietary & confidential. Contains trade-secret methods
 *  (layer-separated generative render & panel synthesis).
 *  Trademarks: GENIE™, DesignIQ™, LiftIQ™ — see /NOTICE and
 *  docs/TRADEMARKS.md. Not legal advice.
 * ─────────────────────────────────────────────────────────────
 */
/**
 * panelizer-os-orchestrator — GENIE Production Panelizer OS Coordinator
 * Graphic Export Native Intelligence Engine
 *
 * COLLAPSED PIPELINE (2 steps instead of 12):
 *
 *   1.  EXTRACT  → panelizer-extract: Fetch renders → Gemini flat panels → PNGs
 *   2.  VECTORIZE → panelizer-vectorize: Flat PNGs → Vectorizer.AI → production EPS
 *
 * The old 12-step chain (validate, fetch, unwrap, template, fill, crop, flatten,
 * flip, cropmarks, colorconvert, qa, vectorize, package) is preserved in the repo
 * but no longer called. Two robust functions replace the fragile step chain.
 *
 * Output: { panels, epsFiles, metadata }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { PIPELINE_VERSION, PIPELINE_NAME } from "../_shared/panelizer-os/constants.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startMs = Date.now();

  try {
    // ── Auth ───────────────────────────────────────────────────────
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    // ── Parse input ────────────────────────────────────────────────
    const body = await req.json();
    const {
      renderUrl,
      generationId,
      vehicleMake = "",
      vehicleModel = "",
      vehicleYear = "",
      sideSize = "medium",
      addHood = false,
      addRoof = false,
      roofSize = "medium",
      addFrontBumper = false,
      addRearBumper = false,
      addRear = false,
      finish = "gloss",
      designName = "Untitled",
      aspectRatio,
      // Template support — vehicle template with panel cut zones
      templateUrl,
      templatePath,
      // Resume support — pass panelizerJobId to resume a failed/timed-out job
      panelizerJobId,
    } = body;

    if (!renderUrl) {
      return new Response(
        JSON.stringify({ error: "renderUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Generate unique job ID and order number
    const jobId = crypto.randomUUID().split("-")[0];
    const orderNumber = `POS-${Date.now()}`;
    const vehicle = `${vehicleYear} ${vehicleMake} ${vehicleModel}`.trim();
    const functionsUrl = `${supabaseUrl}/functions/v1`;

    // ── Resume support ──────────────────────────────────────────────
    // If panelizerJobId is provided, check for prior step outputs
    // and skip already-completed steps.
    let priorOutputs: Record<string, any> = {};
    let dbJobId: string | null = panelizerJobId || null;

    if (panelizerJobId) {
      try {
        const { data: resumeData } = await serviceClient.rpc("resume_panelizer_job", {
          p_job_id: panelizerJobId,
        });
        if (resumeData && resumeData.length > 0) {
          priorOutputs = resumeData[0].outputs || {};
          console.log(`[ORCHESTRATOR] RESUMING job ${panelizerJobId} from step "${resumeData[0].last_step}" (attempt ${resumeData[0].attempts})`);
        }
      } catch (resumeErr) {
        console.warn(`[ORCHESTRATOR] Resume lookup failed: ${resumeErr.message} — starting fresh`);
      }
    } else {
      // Create a new job record
      try {
        const { data: newJob } = await serviceClient.from("panelizer_jobs").insert({
          user_id: userId,
          generation_id: generationId || crypto.randomUUID(),
          vehicle_make: vehicleMake || null,
          vehicle_model: vehicleModel || null,
          vehicle_year: vehicleYear ? parseInt(vehicleYear) : null,
          approved_render_url: renderUrl,
          status: "panelizing",
          pipeline_version: PIPELINE_VERSION,
          attempt_count: 1,
          started_at: new Date().toISOString(),
        }).select("id").single();
        if (newJob) {
          dbJobId = newJob.id;
          console.log(`[ORCHESTRATOR] Created job record: ${dbJobId}`);
        }
      } catch (dbErr) {
        console.warn(`[ORCHESTRATOR] Job record creation failed (non-fatal): ${dbErr.message}`);
      }
    }

    // Helper to record step completion in the database
    async function recordStep(stepName: string, output: any) {
      if (!dbJobId) return;
      try {
        await serviceClient.rpc("record_panelizer_step", {
          p_job_id: dbJobId,
          p_step_name: stepName,
          p_step_output: output,
        });
      } catch (e) {
        console.warn(`[ORCHESTRATOR] Failed to record step ${stepName}: ${e.message}`);
      }
    }

    console.log(`[ORCHESTRATOR] ═══ ${PIPELINE_NAME} ═══`);
    console.log(`[ORCHESTRATOR] Job ${jobId} — ${vehicle} — ${designName}`);
    console.log(`[ORCHESTRATOR] Pipeline: ${PIPELINE_VERSION}`);

    // ════════════════════════════════════════════════════════════════
    //  STAGE 0: VALIDATE — Get REAL vehicle dimensions BEFORE extract
    //  Must run first so extract uses correct aspect ratios per vehicle.
    // ════════════════════════════════════════════════════════════════

    let vehicleDims: any = null;
    try {
      const validateResp = await fetch(`${functionsUrl}/panelizer-step-validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          vehicleMake,
          vehicleModel,
          vehicleYear,
          sideSize,
          addHood,
          addRoof,
          roofSize,
          addFrontBumper,
          addRearBumper,
          addRear,
        }),
      });
      if (validateResp.ok) {
        vehicleDims = await validateResp.json();
        console.log(`[ORCHESTRATOR] Vehicle dims from validate: ${vehicleDims.vehicle?.category} (${vehicleDims.vehicle?.source}) — ${vehicleDims.totalSqFt} sq ft`);
      }
    } catch (e: any) {
      console.warn(`[ORCHESTRATOR] Validate step failed, using fallback dims: ${e.message}`);
    }

    // Build panel dims map from validate results (real vehicle measurements)
    // This is used by BOTH extract (for aspect ratios) and vectorize (for sizing)
    const validatePanels = vehicleDims?.panels || [];
    const panelDimsFromValidate: Record<string, { widthIn: number; heightIn: number; mirrored: boolean }> = {};
    for (const vp of validatePanels) {
      // Normalize panel key: "driver-side" → "driver_side"
      const normalizedKey = (vp.panelKey || "").replace(/-/g, "_").replace(/_panel\d+$/, "");
      panelDimsFromValidate[normalizedKey] = {
        widthIn: vp.widthInches,
        heightIn: vp.heightInches,
        mirrored: vp.mirrored || false,
      };
      // Also store with original key for exact matching
      panelDimsFromValidate[vp.panelKey] = {
        widthIn: vp.widthInches,
        heightIn: vp.heightInches,
        mirrored: vp.mirrored || false,
      };
    }
    console.log(`[ORCHESTRATOR] Validated panel dims: ${Object.keys(panelDimsFromValidate).join(', ')}`);

    // ════════════════════════════════════════════════════════════════
    //  STAGE 1: EXTRACT — Fetch renders → Gemini flat panels → PNGs
    //  Now receives real vehicle dimensions for correct aspect ratios.
    // ════════════════════════════════════════════════════════════════

    // Update job progress
    if (dbJobId) {
      await serviceClient.from("panelizer_jobs").update({
        stage_progress: { panelizer_step_index: 0, panelizer_step_data: {}, panelizer_complete: false },
      }).eq("id", dbJobId).catch(() => {});
    }

    // ── Look up per-view render URLs from the panelizer_jobs record ──
    // all_view_urls has renders from each camera angle: { side, rear, hood_detail, roof, front, ... }
    let allViewUrls: Record<string, string> = {};
    if (dbJobId) {
      try {
        const { data: jobRecord } = await serviceClient
          .from("panelizer_jobs")
          .select("all_view_urls, concept_json")
          .eq("id", dbJobId)
          .single();
        if (jobRecord?.all_view_urls && typeof jobRecord.all_view_urls === 'object') {
          allViewUrls = jobRecord.all_view_urls as Record<string, string>;
        } else if (jobRecord?.concept_json?.render_urls && typeof jobRecord.concept_json.render_urls === 'object') {
          allViewUrls = jobRecord.concept_json.render_urls as Record<string, string>;
        }
      } catch (_) { /* proceed with single renderUrl */ }
    }
    if (Object.keys(allViewUrls).length > 0) {
      console.log(`[ORCHESTRATOR] Per-view renders: ${Object.keys(allViewUrls).join(', ')}`);
    }

    // Build renderUrls map — use per-view renders when available
    const VIEW_MAP: Record<string, string[]> = {
      driver_side:    ['side', 'driver-side'],
      passenger_side: ['passenger-side'],
      hood:           ['hood_detail', 'hood', 'front'],
      roof:           ['roof'],
      rear:           ['rear'],
      front:          ['front'],
    };

    const panelNames: string[] = ["driver_side"];
    if (addHood) panelNames.push("hood");
    if (addRoof) panelNames.push("roof");
    if (addRear) panelNames.push("rear");
    if (addFrontBumper) panelNames.push("front");
    panelNames.push("passenger_side");

    const renderUrlsMap: Record<string, string> = {};
    for (const name of panelNames) {
      // Find the best matching view URL for this panel
      const candidates = VIEW_MAP[name] || ['side', 'driver-side'];
      let bestUrl = renderUrl; // fallback to primary render
      for (const viewKey of candidates) {
        if (allViewUrls[viewKey]) {
          bestUrl = allViewUrls[viewKey];
          console.log(`[ORCHESTRATOR] ${name} → using ${viewKey} view render`);
          break;
        }
      }
      renderUrlsMap[name] = bestUrl;
    }

    console.log(`[ORCHESTRATOR] STAGE 1: EXTRACT — ${panelNames.length} panels`);

    let extractResult: any;
    if (priorOutputs.extract?.panels) {
      extractResult = priorOutputs.extract;
      console.log(`[ORCHESTRATOR] EXTRACT: resumed from prior output`);
    } else {
      const extractResp = await fetch(`${functionsUrl}/panelizer-extract`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          jobId,
          userId,
          renderUrls: renderUrlsMap,
          vehicleDims: panelDimsFromValidate,
        }),
      });

      if (!extractResp.ok) {
        const errText = await extractResp.text();
        throw new Error(`Extract failed (${extractResp.status}): ${errText}`);
      }

      extractResult = await extractResp.json();
      if (extractResult.error) {
        throw new Error(`Extract: ${extractResult.error}`);
      }
      await recordStep("extract", extractResult);
    }

    const extractedPanels = extractResult.panels || {};
    console.log(`[ORCHESTRATOR] EXTRACT done: ${Object.keys(extractedPanels).length} panels extracted`);

    // Update progress to stage 2
    if (dbJobId) {
      await serviceClient.from("panelizer_jobs").update({
        stage_progress: { panelizer_step_index: 1, panelizer_step_data: { extract: extractResult }, panelizer_complete: false },
      }).eq("id", dbJobId).catch(() => {});
    }

    // ════════════════════════════════════════════════════════════════
    //  STAGE 2: VECTORIZE — Flat PNGs → Vectorizer.AI → EPS
    //  Replaces: vectorize, colorconvert, cropmarks, qa, package
    // ════════════════════════════════════════════════════════════════

    // Build panel dims from validate results (real vehicle measurements)
    // panelDimsFromValidate was built in STAGE 0 above
    const panelDimsMap: Record<string, { pngPath: string; widthIn: number; heightIn: number }> = {};

    for (const [panelName, panelData] of Object.entries(extractedPanels) as [string, any][]) {
      // Find matching panel from validate step (already built in panelDimsFromValidate)
      const panelKeyMap: Record<string, string[]> = {
        driver_side: ["driver_side", "driver-side", "driver-side-panel1"],
        passenger_side: ["passenger_side", "passenger-side", "passenger-side-panel1"],
        hood: ["hood"],
        roof: ["roof"],
        rear: ["rear"],
        front: ["front", "front_bumper", "front-bumper"],
      };
      const candidates = panelKeyMap[panelName] || [panelName];
      let validatedDims: { widthIn: number; heightIn: number } | null = null;
      for (const key of candidates) {
        if (panelDimsFromValidate[key]) {
          validatedDims = panelDimsFromValidate[key];
          break;
        }
      }

      let widthIn = validatedDims?.widthIn || 172;
      let heightIn = validatedDims?.heightIn || 55.5;

      // Fallback defaults if validate didn't return this panel
      if (!validatedDims) {
        if (panelName === "hood") { widthIn = 56; heightIn = 36; }
        else if (panelName === "roof") { widthIn = 66; heightIn = 44; }
        else if (panelName === "rear") { widthIn = 66; heightIn = 42; }
        else if (panelName === "front") { widthIn = 111; heightIn = 30; }
        console.warn(`[ORCHESTRATOR] No validated dims for ${panelName}, using fallback ${widthIn}x${heightIn}`);
      } else {
        console.log(`[ORCHESTRATOR] ${panelName}: ${widthIn}" × ${heightIn}" (from validate)`);
      }

      panelDimsMap[panelName] = {
        pngPath: panelData.pngPath,
        widthIn,
        heightIn,
      };
    }

    console.log(`[ORCHESTRATOR] STAGE 2: VECTORIZE — ${Object.keys(panelDimsMap).length} panels`);

    let vectorizeResult: any;
    if (priorOutputs.vectorize?.epsFiles) {
      vectorizeResult = priorOutputs.vectorize;
      console.log(`[ORCHESTRATOR] VECTORIZE: resumed from prior output`);
    } else {
      const vecResp = await fetch(`${functionsUrl}/panelizer-vectorize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          jobId,
          userId,
          panels: panelDimsMap,
        }),
      });

      if (!vecResp.ok) {
        const errText = await vecResp.text();
        throw new Error(`Vectorize failed (${vecResp.status}): ${errText}`);
      }

      vectorizeResult = await vecResp.json();
      if (vectorizeResult.error) {
        throw new Error(`Vectorize: ${vectorizeResult.error}`);
      }
      await recordStep("vectorize", vectorizeResult);
    }

    const epsFiles = vectorizeResult.epsFiles || {};
    console.log(`[ORCHESTRATOR] VECTORIZE done: ${Object.keys(epsFiles).length} EPS files`);

    // ════════════════════════════════════════════════════════════════
    //  Store record in database
    // ════════════════════════════════════════════════════════════════

    const processedPanels = Object.entries(extractedPanels).map(([panelName, panelData]: [string, any]) => {
      const dims = panelDimsMap[panelName];
      const isMirrored = panelName === "passenger_side" || panelName === "passenger-side";
      return {
        panelKey: panelName,
        label: panelName.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
        pngPath: panelData.pngPath,
        pngUrl: panelData.pngUrl,
        epsPath: epsFiles[panelName]?.epsPath || null,
        epsUrl: epsFiles[panelName]?.epsUrl || null,
        widthInches: dims?.widthIn || null,
        heightInches: dims?.heightIn || null,
        mirrored: isMirrored,
        sizeKB: panelData.sizeKB || 0,
        epsSizeKB: epsFiles[panelName]?.sizeKB || 0,
      };
    });

    try {
      await serviceClient.from("production_packs").insert({
        user_id: userId,
        generation_id: generationId || null,
        panels_selected: {
          sideSize,
          addHood,
          addRoof,
          roofSize,
          addFrontBumper,
          addRearBumper,
          addRear,
        },
        pack_url: null,
        file_count: processedPanels.length,
        thumbnail_url: null,
        pipeline_version: PIPELINE_VERSION,
        vehicle_info: { make: vehicleMake, model: vehicleModel, year: vehicleYear },
        design_name: designName,
        finish_type: finish,
        upscale_status: "vectorized",
        upscale_progress: `${Object.keys(epsFiles).length}/${processedPanels.length}`,
      });
      console.log(`[ORCHESTRATOR] Production pack record saved`);
    } catch (dbErr) {
      console.warn(`[ORCHESTRATOR] DB insert warning: ${dbErr.message}`);
    }

    // ════════════════════════════════════════════════════════════════
    //  Final response
    // ════════════════════════════════════════════════════════════════

    const totalMs = Date.now() - startMs;

    // Mark job as complete in database + queue for QC admin review
    if (dbJobId) {
      try {
        // Initialize QC data so AdminGraphicDesignerQC picks up this job
        const qcData = {
          state: "incoming",
          steps: {},
          reviewer_notes: "",
          reviewed_at: null,
          deployed_at: null,
          ai_chat_history: [],
          submitted_at: new Date().toISOString(),
        };

        // Fetch existing concept_json to merge (don't overwrite)
        let existingConcept: Record<string, any> = {};
        try {
          const { data: existingJob } = await serviceClient
            .from("panelizer_jobs")
            .select("concept_json")
            .eq("id", dbJobId)
            .single();
          if (existingJob?.concept_json) {
            existingConcept = existingJob.concept_json;
          }
        } catch (_) { /* proceed with empty concept */ }

        await serviceClient.from("panelizer_jobs").update({
          status: "ready",
          processing_time_ms: totalMs,
          completed_at: new Date().toISOString(),
          stage_progress: { panelizer_step_index: 2, panelizer_step_data: { extract: extractResult, vectorize: vectorizeResult }, panelizer_complete: true },
          panels: processedPanels.map((p: any) => ({
            panelKey: p.panelKey,
            label: p.label,
            pngPath: p.pngPath,
            epsPath: p.epsPath,
            widthInches: p.widthInches,
            heightInches: p.heightInches,
            mirrored: p.mirrored || false,
          })),
          concept_json: {
            ...existingConcept,
            qc_data: qcData,
            vehicle,
            design_name: designName,
            finish,
            render_url: renderUrl,
            vehicleDims: vehicleDims ? {
              totalSqFt: vehicleDims.totalSqFt,
              source: vehicleDims.vehicle?.source,
              category: vehicleDims.vehicle?.category,
              dims_verified: vehicleDims.dims_verified === true,
            } : null,
          },
        }).eq("id", dbJobId);
        console.log(`[ORCHESTRATOR] Job ${dbJobId} marked as ready — queued for QC admin review`);
      } catch (e) {
        console.warn(`[ORCHESTRATOR] Failed to update job status: ${e.message}`);
      }
    }

    console.log(`[ORCHESTRATOR] ═══ PIPELINE COMPLETE ═══ ${totalMs}ms (${(totalMs / 1000).toFixed(1)}s)`);

    return new Response(
      JSON.stringify({
        success: true,
        pipelineVersion: PIPELINE_VERSION,
        jobId,
        orderNumber,
        vehicle,
        finish,
        designName,
        panels: processedPanels,
        epsFiles,
        extractResult: {
          panelCount: extractResult.panelCount,
          processingTimeMs: extractResult.processingTimeMs,
        },
        vectorizeResult: {
          epsCount: vectorizeResult.epsCount,
          processingTimeMs: vectorizeResult.processingTimeMs,
        },
        timing: {
          totalMs,
          totalSeconds: (totalMs / 1000).toFixed(1),
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(`[ORCHESTRATOR] PIPELINE ERROR (${Date.now() - startMs}ms):`, err);

    // Record failure in database for resume capability
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const body = await req.clone().json().catch(() => ({}));
      if (body.panelizerJobId) {
        const sc = createClient(supabaseUrl, supabaseServiceKey);
        await sc.from("panelizer_jobs").update({
          status: "failed",
          error_message: err.message,
          processing_time_ms: Date.now() - startMs,
        }).eq("id", body.panelizerJobId);
      }
    } catch (_) { /* non-fatal */ }

    return new Response(
      JSON.stringify({
        error: `Pipeline failed: ${err.message}`,
        pipelineVersion: PIPELINE_VERSION,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
