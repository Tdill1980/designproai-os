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
 * panelizer-qc-upscale — QC actions: approve, upscale, revise
 *
 * Upscale uses Clarity Upscaler (ControlNet Tile) on Replicate
 * (philz1337x/clarity-upscaler). Same model that runs via Fal — preserves
 * faces and fine details — but the Replicate wrapper handles tiling
 * INTERNALLY, so jumbo artboards no longer need edge-side imagescript
 * crop/stitch (which was OOM-ing the 256MB Edge Function limit at status 546).
 *
 * ESRGAN remains banned — destroys faces, over-smooths skin, creates clay artifacts.
 * Clarity max scale = 4x.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveVehicleSpecsWithGrounding } from "../_shared/vehicle-specs-lookup.ts";
import { getGeminiKey } from "../_shared/gemini-key-pool.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_ACTIONS = [
  "approve_and_upscale",
  "approve_only",
  "fix_rectangles",
  "fix_mirroring",
  "fill_panels",
  "regenerate_all",
  "submit_fix",
  "generate_deterministic",
  "flatten_warp",
] as const;

type Action = (typeof VALID_ACTIONS)[number];

const VALID_PANELS = [
  "driver_side", "passenger_side", "hood", "rear",
  "front_bumper", "rear_bumper", "all",
];

function log(msg: string, data?: unknown) {
  if (data !== undefined) {
    console.log(`[QC-UPSCALE] ${msg}`, JSON.stringify(data));
  } else {
    console.log(`[QC-UPSCALE] ${msg}`);
  }
}

function errorLog(msg: string, err?: unknown) {
  console.error(`[QC-UPSCALE] ${msg}`, err);
}

function jsonResponse(body: Record<string, unknown>, _status = 200) {
  return new Response(JSON.stringify({ success: !body.error, ...body }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Upscale via Clarity Upscaler on Replicate ──
// philz1337x/clarity-upscaler is the same Clarity (ControlNet Tile) model the
// team uses via Fal — same face-preserving quality. The Replicate wrapper
// handles tiling INTERNALLY, so jumbo artboards no longer need the
// imagescript-based crop/stitch that was OOM-ing the Edge Function.
//
// Uses REPLICATE_API_TOKEN (already in Supabase secrets, also used by
// segment-click, revise-render-masked, and esrgan-upscale shared module).
// Model string is env-overridable via CLARITY_REPLICATE_MODEL.

const CLARITY_REPLICATE_MODEL =
  Deno.env.get("CLARITY_REPLICATE_MODEL") || "philz1337x/clarity-upscaler";

async function clarityUpscaleViaReplicate(
  imageUrl: string,
  scale: number,
): Promise<{ url: string; width: number; height: number; engine: string } | { error: string }> {
  const replicateKey = Deno.env.get("REPLICATE_API_TOKEN");
  if (!replicateKey) return { error: "REPLICATE_API_TOKEN not configured" };

  const clarityScale = Math.min(4, Math.max(2, Math.round(scale)));
  log(`Clarity Upscaler (Replicate), target scale=${clarityScale}`);

  const predResp = await fetch(
    `https://api.replicate.com/v1/models/${CLARITY_REPLICATE_MODEL}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicateKey}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({
        input: {
          image: imageUrl,
          scale_factor: clarityScale,
          // Same prompt the Fal version used — face/detail preservation.
          prompt:
            "high resolution, sharp details, professional print quality, " +
            "preserve all faces and fine details exactly as original",
          negative_prompt:
            "(worst quality, low quality, blurry, noise, artifacts, " +
            "distorted face, warped eyes, melted skin:2)",
          creativity: 0.05,
          resemblance: 0.95,
          dynamic: 6,
          handfix: "disabled",
          sharpen: 0,
          downscaling: false,
          num_inference_steps: 18,
          output_format: "png",
        },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );

  if (!predResp.ok) {
    const errText = await predResp.text().catch(() => "");
    return { error: `Replicate Clarity create HTTP ${predResp.status}: ${errText.slice(0, 200)}` };
  }

  let prediction = await predResp.json();
  const startMs = Date.now();
  // Clarity at 4x on a 4 MP+ artboard can take 2-4 minutes; poll up to ~5 min.
  if (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (Date.now() - startMs > 290_000) break;
      const s = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { Authorization: `Bearer ${replicateKey}` },
      });
      if (!s.ok) continue;
      prediction = await s.json();
      if (["succeeded", "failed", "canceled"].includes(prediction.status)) break;
    }
  }

  if (prediction.status !== "succeeded") {
    return {
      error: `Replicate Clarity ${prediction.status}: ${prediction.error || "timeout"}`,
    };
  }

  const outputUrl: string | undefined =
    typeof prediction.output === "string" ? prediction.output :
    Array.isArray(prediction.output) ? prediction.output[0] :
    undefined;
  if (!outputUrl) return { error: "Replicate Clarity returned no output URL" };

  // We don't get dimensions back from Replicate prediction metadata reliably;
  // the downstream code uses width/height only for logging. Probe via HEAD if
  // we need it later — for now, derive from input scale.
  return {
    url: outputUrl,
    width: 0,
    height: 0,
    engine: "replicate/clarity-upscaler",
  };
}

// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await req.json();
    const {
      job_id, action, upscale_factor,
      revision_note, panel_to_fix,
      reference_image_base64, reference_image_mime,
    } = body;

    if (!job_id) return jsonResponse({ error: "job_id is required" }, 400);
    if (!action || !VALID_ACTIONS.includes(action as Action)) {
      return jsonResponse({ error: `action must be one of: ${VALID_ACTIONS.join(", ")}` }, 400);
    }
    if (panel_to_fix && !VALID_PANELS.includes(panel_to_fix)) {
      return jsonResponse({ error: `panel_to_fix must be one of: ${VALID_PANELS.join(", ")}` }, 400);
    }

    log(`Action: ${action}, Job: ${job_id}, upscale_factor: ${upscale_factor || "default(4)"}`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: job, error: jobErr } = await supabase
      .from("panelizer_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) {
      errorLog("Job not found", jobErr);
      return jsonResponse({ error: "Job not found" }, 404);
    }

    log("Job loaded", { status: job.status, id: job.id });

    if (action === "approve_only") {
      return await handleApproveOnly(supabase, job);
    } else if (action === "approve_and_upscale") {
      return await handleApproveAndUpscale(supabase, job, upscale_factor || 4);
    } else if (action === "fill_panels") {
      return await handleFillPanels(supabase, job);
    } else if (action === "generate_deterministic") {
      return await handleDeterministicArtboard(supabase, job);
    } else if (action === "flatten_warp") {
      return await handleFlattenWarp(supabase, job);
    } else {
      return await handleRevision(supabase, job, action as Action, revision_note, panel_to_fix, reference_image_base64, reference_image_mime);
    }
  } catch (err) {
    errorLog("Unhandled error", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});

// ─────────────────────────────────────────────────────────────
// ACTION: generate_deterministic — Zero-AI flat artboard from 3D render views
//
// One clear path, no AI, no fallbacks:
//   1. Make sure panel dimensions are real (vehicle DB / Google grounding).
//   2. Send those panels + the 3D render URLs to generate-artboard-flat.
//   3. generate-artboard-flat math-scales each render into the correct
//      panel rectangle and lays them out with dimension labels.
//
// No Gemini, no 2D-proof detour — using AI-generated proofs as the source
// image here contradicts the "deterministic" guarantee and was also the
// path that was OOM-crashing the worker (502 Bad Gateway to the caller).
// ─────────────────────────────────────────────────────────────

async function handleDeterministicArtboard(
  supabase: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
) {
  const jobId = job.id as string;
  const conceptJson = (job.concept_json as Record<string, unknown>) || {};
  const year = conceptJson.year || job.vehicle_year || "";
  const make = conceptJson.make || job.vehicle_make || "";
  const model = conceptJson.model || job.vehicle_model || "";

  // ── Re-resolve panel dimensions if generic fallback was used ──
  const existingPanels = (job as Record<string, unknown>).panels as any[] || [];
  const hasGenericDims = existingPanels.some((p: any) => p.widthInches === 218 || p.widthInches === 172);

  if (hasGenericDims || existingPanels.length === 0) {
    log("Panels have generic dimensions — re-resolving from vehicle DB + Google grounding");
    const specs = await resolveVehicleSpecsWithGrounding(
      String(year), String(make), String(model), getGeminiKey(), supabase
    );

    if (specs.source !== "none" && specs.sideW) {
      const MAX_TILE = 59;
      const OVERLAP = 1.0;
      const sideH = specs.sideH || 60;
      const needsSplit = sideH > MAX_TILE;
      const newPanels: any[] = [];

      if (needsSplit) {
        newPanels.push({ id: "driver-side-panel1", label: "Driver Side - Panel 1", mirrored: false, widthInches: specs.sideW, heightInches: MAX_TILE });
        newPanels.push({ id: "driver-side-panel2", label: "Driver Side - Panel 2", mirrored: false, widthInches: specs.sideW, heightInches: Math.round((sideH - MAX_TILE + OVERLAP) * 10) / 10 });
        newPanels.push({ id: "passenger-side-panel1", label: "Passenger Side - Panel 1", mirrored: true, widthInches: specs.sideW, heightInches: MAX_TILE });
        newPanels.push({ id: "passenger-side-panel2", label: "Passenger Side - Panel 2", mirrored: true, widthInches: specs.sideW, heightInches: Math.round((sideH - MAX_TILE + OVERLAP) * 10) / 10 });
      } else {
        newPanels.push({ id: "driver-side", label: "Driver Side", mirrored: false, widthInches: specs.sideW, heightInches: sideH });
        newPanels.push({ id: "passenger-side", label: "Passenger Side", mirrored: true, widthInches: specs.sideW, heightInches: sideH });
      }
      if (specs.hoodW) newPanels.push({ id: "hood", label: "Hood", mirrored: false, widthInches: specs.hoodW, heightInches: specs.hoodL || 36 });
      if (specs.backW) {
        newPanels.push({ id: "front-bumper", label: "Front Bumper", mirrored: false, widthInches: specs.backW, heightInches: specs.backH || 38 });
        newPanels.push({ id: "rear-bumper", label: "Rear Bumper", mirrored: false, widthInches: specs.backW, heightInches: specs.backH || 38 });
      }

      // Update job panels
      await supabase.from("panelizer_jobs").update({ panels: newPanels }).eq("id", jobId);
      log(`Panels re-resolved: ${specs.sideW}"×${sideH}" sides (source: ${specs.source})`, { panelCount: newPanels.length });

      // Update the job object for downstream use
      (job as any).panels = newPanels;
    } else {
      log("WARNING: Could not resolve vehicle dimensions — panels remain as-is");
    }
  }

  // ── Look up pre-generated 2D proof (flat_proof_url) ──
  // If DesignIQ already generated a flat proof, use it as the source image
  // for deterministic panel cropping. This is the canonical flat artwork.
  // IMPORTANT: We only USE stored proofs — we do NOT generate on demand
  // (on-demand generation via generate-2d-proof caused OOM 546 crashes).
  let flatProofUrl: string | null = null;
  const designiqId = (conceptJson.designiq_generation_id as string) || (conceptJson.generation_id as string) || null;

  if (designiqId) {
    const { data: genRow } = await supabase
      .from("designiq_generations")
      .select("flat_proof_url")
      .eq("id", designiqId)
      .maybeSingle();
    if (genRow?.flat_proof_url) {
      flatProofUrl = genRow.flat_proof_url;
      log("Using stored 2D proof as source", { flatProofUrl });
    }
  }

  // Also check concept_json for a cached flat_proof_url
  if (!flatProofUrl && conceptJson.flat_proof_url) {
    flatProofUrl = conceptJson.flat_proof_url as string;
    log("Using cached flat_proof_url from concept_json", { flatProofUrl });
  }

  const viewUrls =
    (job as Record<string, unknown>).all_view_urls ||
    conceptJson.all_view_urls ||
    {};
  const approvedRenderUrl =
    flatProofUrl ||
    (conceptJson.approved_render_url as string) ||
    (job.approved_render_url as string) ||
    "";

  log(`Generating deterministic artboard (source: ${flatProofUrl ? "2D proof" : "3D renders"})`, { jobId, hasProof: !!flatProofUrl });

  const payload: Record<string, unknown> = {
    job_id: jobId,
    vehicle_name: `${year} ${make} ${model}`.trim(),
    design_prompt: (conceptJson.designDescription as string) || (conceptJson.design_name as string) || "",
    approved_render_url: approvedRenderUrl,
    allRenderUrls: flatProofUrl
      ? [flatProofUrl]  // Use 2D proof as the ONLY source — deterministic crop from flat artwork
      : viewUrls,
    panels: (job as Record<string, unknown>).panels || conceptJson.panels || [],
    use_flat_proof: !!flatProofUrl,
  };

  const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-artboard-flat`;
  const resp = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    errorLog("generate-artboard-flat failed", { status: resp.status, body: errText });
    return jsonResponse({ error: `Deterministic artboard failed (${resp.status}): ${errText}` }, 502);
  }

  const result = await resp.json();
  log("Deterministic artboard complete", { url: result.artboard_url || result.url });

  const qcData = (conceptJson.qc_data as Record<string, unknown>) || {};
  const notes = Array.isArray(qcData.revision_notes) ? (qcData.revision_notes as string[]) : [];
  await supabase.from("panelizer_jobs").update({
    status: "pending_qc",
    concept_json: {
      ...conceptJson,
      artboard_generator: "flat-deterministic",
      flat_proof_url: flatProofUrl || null,
      qc_data: {
        ...qcData,
        state: "deterministic_generated",
        source: flatProofUrl ? "2d_proof" : "3d_renders",
        revision_notes: [...notes, `[${new Date().toISOString()}] generate_deterministic: ${flatProofUrl ? "From stored 2D proof" : "From 3D renders (no 2D proof available)"}`],
      },
    },
  }).eq("id", jobId);

  return jsonResponse({
    success: true,
    artboard_url: result.artboard_url || result.url,
    generator: "flat-deterministic",
    source: flatProofUrl ? "2d_proof" : "3d_renders",
  });
}

// ─────────────────────────────────────────────────────────────
// ACTION: flatten_warp — Perspective correction via homography
// Calls panelizer-flatten: Gemini detects panel corners (text JSON only),
// then pure math perspective warp + bilinear interpolation. Deterministic
// output from the warp step — only corner detection uses AI.
// ─────────────────────────────────────────────────────────────

async function handleFlattenWarp(
  supabase: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
) {
  const jobId = job.id as string;
  const conceptJson = (job.concept_json as Record<string, unknown>) || {};

  log("Running perspective flatten/warp", { jobId });

  const payload: Record<string, unknown> = {
    job_id: jobId,
    panels: (job as Record<string, unknown>).panels || conceptJson.panels || [],
    allRenderUrls: (job as Record<string, unknown>).all_view_urls || conceptJson.all_view_urls || [],
    approved_render_url: conceptJson.approved_render_url || job.approved_render_url || "",
  };

  const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/panelizer-flatten`;
  const resp = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    errorLog("panelizer-flatten failed", { status: resp.status, body: errText });
    return jsonResponse({ error: `Flatten/warp failed (${resp.status}): ${errText}` }, 502);
  }

  const result = await resp.json();
  log("Flatten/warp complete", { url: result.artboard_url });

  const qcData = (conceptJson.qc_data as Record<string, unknown>) || {};
  const notes = Array.isArray(qcData.revision_notes) ? (qcData.revision_notes as string[]) : [];
  await supabase.from("panelizer_jobs").update({
    status: "pending_qc",
    concept_json: {
      ...conceptJson,
      qc_data: { ...qcData, state: "flatten_warped", revision_notes: [...notes, `[${new Date().toISOString()}] flatten_warp: Perspective correction applied`] },
    },
  }).eq("id", jobId);

  return jsonResponse({ success: true, artboard_url: result.artboard_url || result.url, step: "flatten_warp" });
}

// ─────────────────────────────────────────────────────────────
// ACTION: approve_only
// ─────────────────────────────────────────────────────────────

async function handleApproveOnly(
  supabase: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
) {
  const jobId = job.id as string;
  const conceptJson = (job.concept_json as Record<string, unknown>) || {};

  const { error: updateErr } = await supabase
    .from("panelizer_jobs")
    .update({
      status: "ready_for_print",
      concept_json: {
        ...conceptJson,
        qc_data: {
          ...((conceptJson.qc_data as Record<string, unknown>) || {}),
          state: "approved_no_upscale",
          reviewed_at: new Date().toISOString(),
        },
      },
    })
    .eq("id", jobId);

  if (updateErr) {
    errorLog("Failed to update job status", updateErr);
    return jsonResponse({ error: "Failed to update job status" }, 500);
  }

  log("Job approved (no upscale)");
  return jsonResponse({ success: true, message: "Approved without upscale" });
}

// ─────────────────────────────────────────────────────────────
// ACTION: approve_and_upscale (Fal.ai Clarity Upscaler, up to 4x)
// ─────────────────────────────────────────────────────────────

async function handleApproveAndUpscale(
  supabase: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
  requestedScale: number,
) {
  const jobId = job.id as string;
  const storagePath = `artboards/${jobId}/artboard.png`;
  let scale = Math.min(4, Math.max(2, Math.round(requestedScale)));

  // Replicate handles tiling internally so jumbo artboards no longer require
  // Fal at all. REPLICATE_API_TOKEN is the only secret needed for upscale.
  if (!Deno.env.get("REPLICATE_API_TOKEN")) {
    return jsonResponse({ error: "REPLICATE_API_TOKEN not configured" }, 500);
  }

  let upscaledUrl = "";
  let finalDims = { w: 0, h: 0 };
  let engine = "";
  let failReason = "";

  const { data: { publicUrl: artboardPublicUrl } } = supabase.storage
    .from("wrap-files")
    .getPublicUrl(storagePath);

  log("Artboard URL", { storagePath, artboardPublicUrl });

  if (!artboardPublicUrl) {
    failReason = `No public URL for ${storagePath}`;
  } else {
    try {
      const headRes = await fetch(artboardPublicUrl, { method: "HEAD" });
      if (!headRes.ok) {
        failReason = `Artboard not found at ${storagePath} (HEAD returned ${headRes.status})`;
        errorLog(failReason);
      } else {
        // Probe image dimensions to calculate safe scale (Clarity max = 32 megapixels output)
        const contentLength = parseInt(headRes.headers.get("content-length") || "0", 10);
        log(`Artboard found, content-length: ${(contentLength / 1024).toFixed(0)} KB`);

        // Read ONLY the first 1 KB to get image dimensions (avoid full download crash)
        let imgWidth = 0, imgHeight = 0;
        try {
          const imgResp = await fetch(artboardPublicUrl, { headers: { Range: "bytes=0-1023" } });
          const imgBuf = new Uint8Array(await imgResp.arrayBuffer());
          // PNG: width at bytes 16-19, height at bytes 20-23 (big-endian)
          if (imgBuf[0] === 0x89 && imgBuf[1] === 0x50) {
            imgWidth = (imgBuf[16] << 24) | (imgBuf[17] << 16) | (imgBuf[18] << 8) | imgBuf[19];
            imgHeight = (imgBuf[20] << 24) | (imgBuf[21] << 16) | (imgBuf[22] << 8) | imgBuf[23];
          }
          // JPEG: scan for SOF0 (0xFFC0) or SOF2 (0xFFC2) marker
          else if (imgBuf[0] === 0xFF && imgBuf[1] === 0xD8) {
            for (let i = 2; i < imgBuf.length - 10; i++) {
              if (imgBuf[i] === 0xFF && (imgBuf[i + 1] === 0xC0 || imgBuf[i + 1] === 0xC2)) {
                imgHeight = (imgBuf[i + 5] << 8) | imgBuf[i + 6];
                imgWidth = (imgBuf[i + 7] << 8) | imgBuf[i + 8];
                break;
              }
            }
          }
        } catch (e: any) {
          log(`Could not probe image dimensions: ${e.message}`);
        }

        const inputMP = (imgWidth * imgHeight) / 1_000_000;
        log(`Artboard dimensions: ${imgWidth}x${imgHeight} (${inputMP.toFixed(1)} MP)`);

        // Clarity actual limit: 32MP output. Always attempt at least 2x for print quality.
        // For production wraps at 150 DPI, we NEED upscaling — never auto-approve without trying.
        const MAX_MP = 32;
        scale = Math.min(4, Math.max(2, Math.round(requestedScale)));
        if (imgWidth > 0 && imgHeight > 0) {
          if (inputMP >= MAX_MP) {
            // Input itself exceeds 32MP — truly can't upscale, approve as-is
            log(`Input ${inputMP.toFixed(1)}MP already exceeds ${MAX_MP}MP — approving at current resolution`);
            scale = 1; // Will skip upscale below but still approve
          } else {
            // Calculate max safe scale, but always try at least 2x
            const maxScale = Math.floor(Math.sqrt(MAX_MP / inputMP));
            if (maxScale < scale) {
              log(`Reducing scale from ${scale} to ${Math.max(2, maxScale)} (input ${inputMP.toFixed(1)}MP, max output ${MAX_MP}MP)`);
              scale = Math.max(2, maxScale); // Force minimum 2x — let Clarity try
            }
            log(`Will attempt ${scale}x upscale (${inputMP.toFixed(1)}MP input → ~${(inputMP * scale * scale).toFixed(1)}MP output)`);
          }
        } else {
          // If we can't read dimensions, try scale=2 as safest bet
          scale = Math.min(2, scale);
          log(`Unknown dimensions, using conservative scale=${scale}`);
        }

        if (!failReason && scale >= 2) {
          log(`Calling Clarity Upscaler (Replicate), scale=${scale}, image=${artboardPublicUrl.slice(0, 80)}...`);
          const result = await clarityUpscaleViaReplicate(artboardPublicUrl, scale);
          if (!("error" in result)) {
            upscaledUrl = result.url;
            finalDims = { w: result.width, h: result.height };
            engine = result.engine;
            log("Clarity upscale complete (Replicate)", { width: finalDims.w, height: finalDims.h });
          } else {
            failReason = result.error;
            errorLog("Clarity Upscaler (Replicate) failed", failReason);
          }
        }
      }
    } catch (e: any) {
      failReason = `Clarity exception: ${e.message}`;
      errorLog("Clarity Upscaler error", e.message);
    }
  }

  // If scale was 1 (input already > 32MP), use original as the "upscaled" URL
  if (!upscaledUrl && scale <= 1 && artboardPublicUrl) {
    upscaledUrl = artboardPublicUrl;
    engine = "already-max-resolution";
    log(`Input already exceeds 32MP — approved at original resolution`);
  }

  if (!upscaledUrl) {
    return jsonResponse({ error: failReason || "Upscale failed — unknown reason" }, 502);
  }

  // ── Update job status ──
  const conceptJson = (job.concept_json as Record<string, unknown>) || {};
  const qcData = (conceptJson.qc_data as Record<string, unknown>) || {};

  const { error: updateErr } = await supabase
    .from("panelizer_jobs")
    .update({
      status: "ready_for_print",
      concept_json: {
        ...conceptJson,
        qc_data: {
          ...qcData,
          state: "approved",
          reviewed_at: new Date().toISOString(),
          upscale_factor: scale,
          engine,
          upscaled_url: upscaledUrl,
        },
      },
    })
    .eq("id", jobId);

  if (updateErr) {
    errorLog("Failed to update job status", updateErr);
    return jsonResponse({ error: "Failed to update job status" }, 500);
  }

  log(`Done: upscale complete via ${engine}`);

  return jsonResponse({
    success: true,
    upscale_factor: scale,
    upscaled_url: upscaledUrl,
    engine,
    message: `Upscale complete via ${engine}. Image ready for download.`,
  });
}

// ─────────────────────────────────────────────────────────────
// ACTION: fix_rectangles / fix_mirroring / regenerate_all / submit_fix
// ─────────────────────────────────────────────────────────────

async function handleRevision(
  supabase: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
  action: Action,
  revisionNote?: string,
  panelToFix?: string,
  referenceImageBase64?: string,
  referenceImageMime?: string,
) {
  const jobId = job.id as string;
  const conceptJson = (job.concept_json as Record<string, unknown>) || {};
  const originalPrompt = (conceptJson.designDescription as string) || (conceptJson.design_name as string) || (conceptJson.design_prompt as string) || "";

  // Get the current artboard URL for edit-in-place operations
  const currentArtboardPath = (job as Record<string, unknown>).artboard_storage_path as string || conceptJson.artboard_storage_path as string || "";
  let currentArtboardUrl = "";
  if (currentArtboardPath) {
    const { data: signedData } = await supabase.storage.from("wrap-files").createSignedUrl(currentArtboardPath, 600);
    currentArtboardUrl = signedData?.signedUrl || "";
  }
  if (!currentArtboardUrl) {
    // Try public URL from artboard_url field
    currentArtboardUrl = (job as Record<string, unknown>).artboard_url as string || "";
  }

  let revisedPrompt: string;
  let useExistingArtboard = false; // If true, send current artboard as reference image
  switch (action) {
    case "fix_rectangles":
      revisedPrompt = `EDIT THIS ARTBOARD — do NOT create a new design. The attached image is the CURRENT artboard. Keep ALL existing artwork, colors, text, logos, and design elements EXACTLY as they are. ONLY fix the panel shapes to be perfect rectangles with 90-degree corners. Remove any vehicle body outlines, wheel arches, or curved edges. Every panel must be a flat rectangle. Do NOT change the design content.`;
      useExistingArtboard = true;
      break;
    case "fix_mirroring":
      revisedPrompt = `EDIT THIS ARTBOARD — do NOT create a new design. The attached image is the CURRENT artboard. Keep ALL existing artwork EXACTLY as-is. ONLY fix the passenger side panels — they must be a horizontally mirrored (flipped) version of the driver side panels. All text must read correctly on the mirrored side. Do NOT change the design content or any other panels.`;
      useExistingArtboard = true;
      break;
    case "regenerate_all":
      revisedPrompt = originalPrompt;
      break;
    case "submit_fix":
      revisedPrompt = `EDIT THIS ARTBOARD — do NOT create a new design. The attached image is the CURRENT artboard. Keep ALL existing artwork EXACTLY as-is. ONLY apply this fix: ${revisionNote || "General fix requested"}. Panel to fix: ${panelToFix || "all panels"}. Do NOT change anything else.`;
      useExistingArtboard = true;
      break;
    default:
      return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  }

  log("Revision prompt built", { action, promptLength: revisedPrompt.length });

  const year = conceptJson.year || job.vehicle_year || "";
  const make = conceptJson.make || job.vehicle_make || "";
  const model = conceptJson.model || job.vehicle_model || "";
  const vehicleName = `${year} ${make} ${model}`.trim();

  const payload: Record<string, unknown> = {
    job_id: jobId,
    vehicle_name: vehicleName,
    design_prompt: revisedPrompt,
    approved_render_url: conceptJson.approved_render_url || job.approved_render_url || "",
    allRenderUrls: (job as Record<string, unknown>).all_view_urls || conceptJson.all_view_urls || [],
    panels: (job as Record<string, unknown>).panels || conceptJson.panels || [],
  };

  // For edit-in-place actions, pass the EXISTING artboard as the primary reference
  // so Gemini edits instead of regenerating from scratch
  if (useExistingArtboard && currentArtboardUrl) {
    payload.existing_artboard_url = currentArtboardUrl;
    log(`Passing existing artboard as reference for ${action}`);
  }

  if (referenceImageBase64) {
    payload.reference_image = referenceImageBase64;
    if (referenceImageMime) payload.reference_image_mime = referenceImageMime;
  }

  log("Calling generate-artboard-simple", { vehicleName });

  const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-artboard-simple`;
  const resp = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    errorLog("generate-artboard-simple failed", { status: resp.status, body: errText });
    return jsonResponse({ error: `Artboard generation failed (${resp.status}): ${errText}` }, 502);
  }

  const artboardResult = await resp.json();
  log("Artboard generation complete", {
    success: artboardResult.success,
    url: artboardResult.artboard_url || artboardResult.url || null,
  });

  const qcData = (conceptJson.qc_data as Record<string, unknown>) || {};
  const existingNotes = Array.isArray(qcData.revision_notes) ? (qcData.revision_notes as string[]) : [];
  const newNote = `[${new Date().toISOString()}] ${action}: ${revisionNote || "(no note)"}`;

  const { error: updateErr } = await supabase
    .from("panelizer_jobs")
    .update({
      status: "pending_qc",
      concept_json: {
        ...conceptJson,
        qc_data: {
          ...qcData,
          state: "revision",
          revision_notes: [...existingNotes, newNote],
        },
      },
    })
    .eq("id", jobId);

  if (updateErr) {
    errorLog("Failed to update job status", updateErr);
    return jsonResponse({ error: "Failed to update job status" }, 500);
  }

  log(`Job set to pending_qc after ${action}`);

  return jsonResponse({
    success: true,
    artboard_url: artboardResult.artboard_url || artboardResult.url || null,
    message: `Revision (${action}) submitted. Artboard regeneration ${artboardResult.artboard_url ? "complete" : "in progress"}.`,
  });
}

// ─────────────────────────────────────────────────────────────
// ACTION: fill_panels  (ClipDrop Cleanup — deterministic, no generative AI)
// ─────────────────────────────────────────────────────────────
//
// Takes the current artboard PNG and uses ClipDrop's Cleanup API to extend
// the existing artwork into every near-white ("empty") region inside the
// artboard. This fills cropped hood/bumper/roof panels so they become flat
// rectangles edge-to-edge with the SAME design — ClipDrop does not generate
// new content, it synthesizes a fill from the surrounding pixels (content-
// aware inpainting, same engine as Photoshop's Content-Aware Fill).
//
// Requires CLIPDROP_API_KEY env var. The mask is built server-side with
// imagescript: white pixels in the input become white in the mask (= "fill
// me"), everything else becomes black (= "keep me").
//
// Writes the filled result back to `artboards/{jobId}/artboard.png` so the
// existing QC Artboard preview query picks it up on the next refresh.

async function handleFillPanels(
  supabase: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
) {
  const jobId = job.id as string;

  const conceptJson = (job.concept_json as Record<string, unknown>) || {};
  const artboardPath =
    ((job as Record<string, unknown>).artboard_storage_path as string) ||
    (conceptJson.artboard_storage_path as string) ||
    `artboards/${jobId}/artboard.png`;

  log("fill_panels: downloading current artboard", { artboardPath });

  const { data: artboardBlob, error: dlErr } = await supabase.storage
    .from("wrap-files")
    .download(artboardPath);
  if (dlErr || !artboardBlob) {
    errorLog("fill_panels: artboard download failed", dlErr);
    return jsonResponse({ error: `Artboard not found at ${artboardPath}` }, 404);
  }
  const artboardBytes = new Uint8Array(await artboardBlob.arrayBuffer());
  log("fill_panels: artboard loaded", { kb: (artboardBytes.length / 1024).toFixed(0) });

  // ── Build a white-gap mask with imagescript ──
  // White in the mask = pixels ClipDrop should fill in.
  // A pixel is "empty" when it's near-white (R/G/B all ≥ WHITE_THRESHOLD) OR
  // near-transparent (alpha < ALPHA_THRESHOLD). Cropped panels from Gemini
  // often come back with transparent gaps rather than white, so we must treat
  // alpha=0 regions as fill targets — otherwise panels never reach edge-to-edge.
  //
  // We also build `flat` — the source composited onto an opaque white
  // background. ClipDrop Cleanup requires an opaque input; handing it a PNG
  // with alpha=0 regions produces no-op results (which is what was leaving
  // hood/fairings cropped in the QC artboard).
  const WHITE_THRESHOLD = 240;
  const ALPHA_THRESHOLD = 250;
  const { Image } = await import("https://deno.land/x/imagescript@1.2.15/mod.ts");
  const src = await Image.decode(artboardBytes);
  const mask = new Image(src.width, src.height);
  const flat = new Image(src.width, src.height);

  let emptyCount = 0;
  // imagescript is 1-indexed for getPixelAt/setPixelAt
  for (let y = 1; y <= src.height; y++) {
    for (let x = 1; x <= src.width; x++) {
      const rgba = src.getPixelAt(x, y);
      const r = (rgba >>> 24) & 0xff;
      const g = (rgba >>> 16) & 0xff;
      const b = (rgba >>> 8) & 0xff;
      const a = rgba & 0xff;

      const isTransparent = a < ALPHA_THRESHOLD;
      const isNearWhite = r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD;
      const isEmpty = isTransparent || isNearWhite;

      if (isEmpty) {
        mask.setPixelAt(x, y, 0xffffffff); // white = fill
        flat.setPixelAt(x, y, 0xffffffff); // force to white in the flattened source
        emptyCount++;
      } else {
        mask.setPixelAt(x, y, 0x000000ff); // black = keep
        // Composite partially-transparent pixels onto white so ClipDrop sees
        // an opaque image. Fully opaque pixels pass through unchanged.
        if (a === 0xff) {
          flat.setPixelAt(x, y, rgba);
        } else {
          const alpha = a / 255;
          const fr = Math.round(r * alpha + 255 * (1 - alpha));
          const fg = Math.round(g * alpha + 255 * (1 - alpha));
          const fb = Math.round(b * alpha + 255 * (1 - alpha));
          flat.setPixelAt(x, y, ((fr & 0xff) << 24) | ((fg & 0xff) << 16) | ((fb & 0xff) << 8) | 0xff);
        }
      }
    }
  }

  const emptyPct = (emptyCount / (src.width * src.height)) * 100;
  log("fill_panels: mask built", {
    w: src.width,
    h: src.height,
    emptyPixels: emptyCount,
    emptyPct: emptyPct.toFixed(1) + "%",
  });

  if (emptyCount === 0) {
    return jsonResponse({
      success: true,
      message: "Artboard already fills edge-to-edge — no empty regions detected.",
      artboard_url: ((job as Record<string, unknown>).artboard_url as string) || null,
      empty_pct: 0,
    });
  }

  const [maskBytes, flatBytes] = await Promise.all([mask.encode(), flat.encode()]);
  log("fill_panels: mask encoded", { kb: (maskBytes.length / 1024).toFixed(0) });

  // ── Upload image + mask to temp storage so Replicate can fetch them ──
  // Flux Fill Pro takes URLs (not multipart uploads), so we stage the flat
  // artboard and the mask at short-lived temp paths and feed signed URLs.
  const replicateKey = Deno.env.get("REPLICATE_API_TOKEN");
  if (!replicateKey) {
    return jsonResponse({ error: "REPLICATE_API_TOKEN not configured" }, 500);
  }

  const tempBase = `temp/fill-panels/${jobId}/${Date.now()}`;
  const flatPath = `${tempBase}-flat.png`;
  const maskPath = `${tempBase}-mask.png`;

  const [flatUp, maskUp] = await Promise.all([
    supabase.storage.from("wrap-files").upload(flatPath, flatBytes, {
      contentType: "image/png", upsert: true,
    }),
    supabase.storage.from("wrap-files").upload(maskPath, maskBytes, {
      contentType: "image/png", upsert: true,
    }),
  ]);
  if (flatUp.error || maskUp.error) {
    errorLog("fill_panels: temp upload failed", { flat: flatUp.error, mask: maskUp.error });
    return jsonResponse({ error: "Could not stage image/mask for Replicate" }, 500);
  }

  const [flatSigned, maskSigned] = await Promise.all([
    supabase.storage.from("wrap-files").createSignedUrl(flatPath, 600),
    supabase.storage.from("wrap-files").createSignedUrl(maskPath, 600),
  ]);
  const flatUrl = flatSigned.data?.signedUrl;
  const maskUrl = maskSigned.data?.signedUrl;
  if (!flatUrl || !maskUrl) {
    return jsonResponse({ error: "Could not sign temp URLs for Replicate" }, 500);
  }

  // ── Call Flux.1 Fill Pro via Replicate ──
  // Flux Fill Pro is a state-of-the-art inpainting model (same engine class
  // as Adobe Firefly). Unlike ClipDrop Cleanup — which is built to REMOVE
  // objects and produces blobs on large uniform regions — Flux Fill truly
  // extends adjacent artwork into the masked area, edge-to-edge.
  const FLUX_FILL_MODEL =
    Deno.env.get("FLUX_FILL_REPLICATE_MODEL") || "black-forest-labs/flux-fill-pro";

  const fluxPrompt =
    "Extend the existing vehicle wrap artwork to fill the masked area edge-to-edge. " +
    "Match the surrounding colors, patterns, textures, gradients, and visual flow exactly. " +
    "No text, no logos, no branding, no vehicle body parts — just flat artwork extension.";

  log("fill_panels: calling Flux Fill Pro via Replicate...");
  const predResp = await fetch(
    `https://api.replicate.com/v1/models/${FLUX_FILL_MODEL}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicateKey}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({
        input: {
          image: flatUrl,
          mask: maskUrl,
          prompt: fluxPrompt,
          steps: 50,
          guidance: 60,
          output_format: "png",
          output_quality: 95,
          safety_tolerance: 2,
          prompt_upsampling: false,
        },
      }),
      signal: AbortSignal.timeout(90_000),
    },
  );

  if (!predResp.ok) {
    const errText = await predResp.text().catch(() => "");
    errorLog("fill_panels: Flux Fill create failed", { status: predResp.status, body: errText.slice(0, 300) });
    return jsonResponse(
      { error: `Flux Fill returned ${predResp.status}: ${errText.slice(0, 200)}` },
      502,
    );
  }

  let prediction = await predResp.json();
  const startMs = Date.now();
  if (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (Date.now() - startMs > 110_000) break;
      const s = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { Authorization: `Bearer ${replicateKey}` },
      });
      if (!s.ok) continue;
      prediction = await s.json();
      if (["succeeded", "failed", "canceled"].includes(prediction.status)) break;
    }
  }

  if (prediction.status !== "succeeded") {
    errorLog("fill_panels: Flux Fill did not succeed", { status: prediction.status, error: prediction.error });
    return jsonResponse(
      { error: `Flux Fill ${prediction.status}: ${prediction.error || "timeout"}` },
      502,
    );
  }

  const fluxOutUrl: string | undefined =
    typeof prediction.output === "string" ? prediction.output :
    Array.isArray(prediction.output) ? prediction.output[0] :
    undefined;
  if (!fluxOutUrl) {
    return jsonResponse({ error: "Flux Fill returned no output URL" }, 502);
  }

  const dl = await fetch(fluxOutUrl, { signal: AbortSignal.timeout(30_000) });
  if (!dl.ok) {
    return jsonResponse({ error: `Flux Fill output download failed: ${dl.status}` }, 502);
  }
  const filledBytes = new Uint8Array(await dl.arrayBuffer());
  log("fill_panels: Flux Fill returned", { kb: (filledBytes.length / 1024).toFixed(0) });

  // Best-effort cleanup of temp staging files (non-fatal)
  supabase.storage.from("wrap-files").remove([flatPath, maskPath]).catch(() => {});

  // ── Overwrite the artboard in place so the existing preview query picks it up ──
  const { error: upErr } = await supabase.storage
    .from("wrap-files")
    .upload(artboardPath, filledBytes, {
      contentType: "image/png",
      cacheControl: "3600",
      upsert: true,
    });
  if (upErr) {
    errorLog("fill_panels: upload failed", upErr);
    return jsonResponse({ error: `Upload failed: ${upErr.message}` }, 500);
  }

  const { data: signed } = await supabase.storage
    .from("wrap-files")
    .createSignedUrl(artboardPath, 3600);

  // ── Record the action in qc_data so the audit trail is complete ──
  const qcData = (conceptJson.qc_data as Record<string, unknown>) || {};
  const existingNotes = Array.isArray(qcData.revision_notes)
    ? (qcData.revision_notes as string[])
    : [];
  const note = `[${new Date().toISOString()}] fill_panels: Flux Fill Pro extended artwork over ${emptyPct.toFixed(1)}% empty pixels`;

  const { error: updateErr } = await supabase
    .from("panelizer_jobs")
    .update({
      status: "pending_qc",
      artboard_url: signed?.signedUrl || null,
      concept_json: {
        ...conceptJson,
        qc_data: {
          ...qcData,
          state: "revision",
          revision_notes: [...existingNotes, note],
        },
      },
    })
    .eq("id", jobId);

  if (updateErr) {
    errorLog("fill_panels: job update failed", updateErr);
    // Non-fatal — the new artboard is already in storage
  }

  log("fill_panels: done");
  return jsonResponse({
    success: true,
    artboard_url: signed?.signedUrl || null,
    storage_path: artboardPath,
    empty_pct: +emptyPct.toFixed(1),
    message: `Flux Fill Pro extended artwork over ${emptyPct.toFixed(1)}% of empty pixels in the artboard.`,
  });
}
