/**
 * run-master-artboard-flow — Production Pipeline v3 (Sidecar Delegate)
 *
 * Lightweight Deno orchestrator that:
 *   1. Validates the job and loads vehicle specs
 *   2. Builds Genie Grid zones (deterministic math)
 *   3. Delegates heavy processing to Vercel sidecar:
 *      - Sharp panel crop from artboard
 *      - CMYK TIFF generation (1500 DPI / 10% scale)
 *      - ZIP packaging
 *      - Upload back to Supabase Storage
 *
 * POST /run-master-artboard-flow
 * { job_id }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveVehicleSpecs } from "../_shared/vehicle-specs-lookup.ts";
import { buildGenieGrid } from "../_shared/genie-grid-template.ts";

const BUCKET = "wrap-files";

// Vercel sidecar endpoint — set via env var or fallback to production URL
const SIDECAR_URL = Deno.env.get("VERCEL_SIDECAR_URL") || "https://restylepro-os.vercel.app/api/process-production-pack";
// Strip any non-printable-ASCII (e.g. a trailing newline from how the secret was
// set) — otherwise `Bearer <secret>\n` throws "not a valid ByteString" and the
// entire per-panel build fails at the sidecar fetch.
const SIDECAR_SECRET = (Deno.env.get("SIDECAR_SECRET") || "").replace(/[^\x21-\x7E]/g, "");

// Panel definitions for metadata
const PANEL_DEFS = [
  { key: "driver-side", label: "Driver Side", wField: "sideW", hField: "sideH", zone: "side", generate: true },
  { key: "passenger-side", label: "Passenger Side", wField: "sideW", hField: "sideH", zone: "side", generate: false, mirrorOf: "driver-side" },
  { key: "hood", label: "Hood", wField: "hoodW", hField: "hoodL", zone: "addon", generate: true },
  { key: "rear", label: "Rear", wField: "backW", hField: "backH", zone: "addon", generate: true },
  { key: "roof", label: "Roof", wField: "roofW", hField: "roofL", zone: "roof", generate: true },
] as const;

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function updateStageProgress(
  sb: any, jobId: string, stepIndex: number, stepLabel: string,
  complete = false, stepData?: Record<string, any>,
) {
  const update: any = {
    stage_progress: {
      panelizer_step_index: stepIndex,
      panelizer_step_label: stepLabel,
      ...(complete ? { panelizer_complete: true } : {}),
      ...(stepData ? { panelizer_step_data: stepData } : {}),
    },
  };
  await sb.from("panelizer_jobs").update(update).eq("id", jobId);
  console.log(`[FLOW] Step ${stepIndex}: ${stepLabel}${complete ? " ✓ COMPLETE" : ""}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const sb = getSupabase();

  try {
    const body = await req.json();
    const { job_id } = body;

    if (!job_id) {
      return jsonResponse({ error: "job_id required" }, 400);
    }

    // ════════════════════════════════════════════════════════════
    // STEP 1: VALIDATE — Load job data
    // ════════════════════════════════════════════════════════════
    console.log(`[FLOW] ═══════════════════════════════════════════`);
    console.log(`[FLOW]  PRODUCTION PIPELINE v3 (Sidecar Delegate)`);
    console.log(`[FLOW]  Job: ${job_id}`);
    console.log(`[FLOW] ═══════════════════════════════════════════`);

    await updateStageProgress(sb, job_id, 0, "Validating inputs");

    const { data: job, error: jobErr } = await sb
      .from("panelizer_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) {
      return jsonResponse({ error: `Job not found: ${jobErr?.message}` }, 404);
    }

    const conceptJson = job.concept_json || {};
    const artboardPath = conceptJson.artboardPath || "";
    const userId = job.user_id;
    const orderNumber = job.order_number || "RP-000000";
    const vehicleMake = job.vehicle_make || "Unknown";
    const vehicleModel = job.vehicle_model || "Unknown";
    const vehicleYear = job.vehicle_year ? String(job.vehicle_year) : "2024";
    const designDescription = conceptJson.designDescription || "";
    const companyName = conceptJson.companyName || "";
    const designName = conceptJson.designName || companyName || "Custom Wrap";
    const finish = conceptJson.finish || "Gloss";

    // Resolve artboard storage path
    let renderStoragePath = "";
    const renderUrl = job.approved_render_url || "";

    if (artboardPath) {
      const match = artboardPath.match(/wrap-files\/(.+?)(\?|$)/);
      renderStoragePath = match ? match[1] : artboardPath;
    }
    if (!renderStoragePath && renderUrl) {
      const match = renderUrl.match(/wrap-files\/(.+?)(\?|$)/);
      renderStoragePath = match ? match[1] : renderUrl;
    }

    if (!renderStoragePath) {
      await sb.from("panelizer_jobs").update({
        status: "failed", error_message: "No artboard found",
      }).eq("id", job_id);
      return jsonResponse({ error: "No artboard found" }, 404);
    }

    console.log(`[FLOW] ✓ VALIDATE: Artboard path: ${renderStoragePath}`);
    console.log(`[FLOW]   Vehicle: ${vehicleYear} ${vehicleMake} ${vehicleModel}`);

    await sb.from("panelizer_jobs").update({
      status: "panelizing", error_message: null,
    }).eq("id", job_id);

    // ════════════════════════════════════════════════════════════
    // STEP 2: DATA AGENT — Deterministic Vehicle Specs + Genie Grid
    // ════════════════════════════════════════════════════════════
    await updateStageProgress(sb, job_id, 1, "Data Agent: Vehicle lookup + Genie Grid");

    const cleanModel = vehicleModel.replace(/\s+\d{4}$/, "");
    const vehicleSpecs = resolveVehicleSpecs(vehicleYear, vehicleMake, cleanModel);

    console.log(`[FLOW] ✓ DATA AGENT: ${vehicleSpecs.source}`);
    console.log(`[FLOW]   Side: ${vehicleSpecs.sideW}" × ${vehicleSpecs.sideH}"`);

    // Build Genie Grid zones (deterministic — no heavy processing)
    const grid = buildGenieGrid(vehicleSpecs, {
      addHood: true, addRear: true, addRoof: true,
      vehicleDesc: `${vehicleYear} ${vehicleMake} ${vehicleModel}`,
    });

    console.log(`[FLOW] ✓ GENIE GRID: ${grid.zones.length} zones — ${grid.zones.map(z => z.key).join(", ")}`);

    // ════════════════════════════════════════════════════════════
    // STEP 3: DELEGATE TO VERCEL SIDECAR
    // Heavy processing: Sharp crop, TIFF, ZIP → Vercel Node.js
    // ════════════════════════════════════════════════════════════
    await updateStageProgress(sb, job_id, 2, "Delegating to production sidecar (Sharp + TIFF + ZIP)");

    console.log(`[FLOW] → Calling Vercel sidecar: ${SIDECAR_URL}`);

    const sidecarPayload = {
      job_id,
      artboard_storage_path: renderStoragePath,
      zones: grid.zones,
      user_id: userId,
      order_number: orderNumber,
      vehicle_year: vehicleYear,
      vehicle_make: vehicleMake,
      vehicle_model: vehicleModel,
      finish,
      design_name: designName,
      design_description: designDescription,
      vehicle_specs: {
        source: vehicleSpecs.source,
        matchedYear: vehicleSpecs.matchedYear,
        sideW: vehicleSpecs.sideW, sideH: vehicleSpecs.sideH,
        hoodW: vehicleSpecs.hoodW, hoodL: vehicleSpecs.hoodL,
        backW: vehicleSpecs.backW, backH: vehicleSpecs.backH,
        roofW: vehicleSpecs.roofW, roofL: vehicleSpecs.roofL,
        totalSqFt: vehicleSpecs.totalSqFt,
      },
      panel_defs: PANEL_DEFS,
    };

    const sidecarHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (SIDECAR_SECRET) {
      sidecarHeaders["Authorization"] = `Bearer ${SIDECAR_SECRET}`;
    }

    const sidecarResp = await fetch(SIDECAR_URL, {
      method: "POST",
      headers: sidecarHeaders,
      body: JSON.stringify(sidecarPayload),
      signal: AbortSignal.timeout(55_000), // 55s timeout (Vercel has 60s max)
    });

    const sidecarResult = await sidecarResp.json();

    if (!sidecarResp.ok || !sidecarResult.success) {
      const errMsg = sidecarResult.error || `Sidecar returned ${sidecarResp.status}`;
      console.error(`[FLOW] ✗ Sidecar failed: ${errMsg}`);

      await sb.from("panelizer_jobs").update({
        status: "failed",
        error_message: `Sidecar error: ${errMsg}`,
      }).eq("id", job_id);

      return jsonResponse({ error: errMsg }, 500);
    }

    // Sidecar handles all remaining steps (crop, TIFF, ZIP, job update)
    // It sets status to "ready" and updates concept_json directly.

    console.log(`[FLOW] ═══════════════════════════════════════════`);
    console.log(`[FLOW]  ✓ PIPELINE COMPLETE (via sidecar)`);
    console.log(`[FLOW]  Order: ${orderNumber}`);
    console.log(`[FLOW]  Panels: ${sidecarResult.panelCount}`);
    console.log(`[FLOW]  TIFFs: ${sidecarResult.tiffCount}`);
    console.log(`[FLOW]  Engine: sidecar-sharp-crop`);
    console.log(`[FLOW]  Specs: ${vehicleSpecs.source}`);
    console.log(`[FLOW] ═══════════════════════════════════════════`);

    return jsonResponse({
      success: true,
      status: "ready",
      pipeline: "production-v3-sidecar",
      orderNumber,
      vehicle: `${vehicleYear} ${vehicleMake} ${vehicleModel}`,
      panelCount: sidecarResult.panelCount,
      tiffCount: sidecarResult.tiffCount,
      zipUrl: sidecarResult.zipUrl,
      pngDownloads: sidecarResult.pngDownloads,
      tiffDownloads: sidecarResult.tiffDownloads,
      vehicleSpecsSource: vehicleSpecs.source,
      engine: "sidecar-sharp-crop",
    });

  } catch (err: any) {
    console.error("[FLOW] Pipeline error:", err);

    try {
      const { job_id } = await req.clone().json();
      if (job_id) {
        await sb.from("panelizer_jobs").update({
          status: "failed",
          error_message: err.message || "Pipeline error",
          stage_progress: {
            panelizer_step_index: 0,
            panelizer_step_label: `Failed: ${err.message || "Pipeline error"}`,
            panelizer_complete: false,
          },
        }).eq("id", job_id);
      }
    } catch { /* ignore */ }

    return jsonResponse({ error: err.message || "Pipeline failed" }, 500);
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
