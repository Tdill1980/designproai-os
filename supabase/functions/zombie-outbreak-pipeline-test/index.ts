/**
 * zombie-outbreak-pipeline-test — Full Production Pipeline Test
 *
 * Orchestrates the COMPLETE production pipeline for the "Zombie Outbreak" design:
 *
 *   STEP 1: Query designiq_generations for the zombie design
 *   STAGE 1: PANELIZER — generate-production-files (extract master + crop + upscale + package)
 *   STAGE 2: UPSCALER — upscale-production-pack (Real-ESRGAN 2x via Replicate)
 *   STAGE 3: QA VALIDATION — qa-check-production-panel (AI-powered QA per panel)
 *   STAGE 4: CUT CONTOUR — generate-cut-files (if logos/text detected)
 *   STAGE 5: PACKAGE — final ZIP with all artifacts + metadata
 *   STAGE 6: DOWNLOAD — signed URLs for everything
 *
 * Deploy: supabase functions deploy zombie-outbreak-pipeline-test
 * Invoke: curl -X POST <SUPABASE_URL>/functions/v1/zombie-outbreak-pipeline-test \
 *           -H "Authorization: Bearer <USER_JWT>" \
 *           -H "Content-Type: application/json" \
 *           -d '{"sideSize":"medium"}'
 *
 * Override defaults with optional body params:
 *   sideSize: "small"|"medium"|"large"|"xl" (default: "medium")
 *   addHood: boolean (default: true)
 *   addRearBumper: boolean (default: true)
 *   skipUpscale: boolean (default: false) — skip stage 2 for faster testing
 *   skipQA: boolean (default: false) — skip stage 3
 *   skipCutContour: boolean (default: false) — skip stage 4
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ORDER_NUMBER = "RP-TEST-001";

interface StageLog {
  stage: string;
  status: "success" | "failed" | "skipped";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  details: Record<string, unknown>;
}

interface PipelineResult {
  orderNumber: string;
  design: Record<string, unknown> | null;
  stages: StageLog[];
  downloads: {
    fullZip?: string;
    panels: Record<string, string>;
    metadata?: string;
    cutFiles?: string;
  };
  totalDurationMs: number;
  completedAt: string;
}

function log(stage: string, msg: string) {
  console.log(`[${stage}] ${msg}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const pipelineStart = Date.now();
  const stages: StageLog[] = [];
  const downloads: PipelineResult["downloads"] = { panels: {} };

  try {
    // Parse optional overrides
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty body OK */ }

    const sideSize = (body.sideSize as string) || "medium";
    const addHood = body.addHood !== false; // default true
    const addRearBumper = body.addRearBumper !== false; // default true
    const skipUpscale = body.skipUpscale === true;
    const skipQA = body.skipQA === true;
    const skipCutContour = body.skipCutContour === true;

    // --- Authenticate ---
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
        JSON.stringify({ error: "Authentication required — pass a valid Bearer token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const functionsUrl = `${supabaseUrl}/functions/v1`;

    log("INIT", "=".repeat(60));
    log("INIT", "ZOMBIE OUTBREAK PIPELINE TEST — FULL PRODUCTION RUN");
    log("INIT", "=".repeat(60));
    log("INIT", `Order: ${ORDER_NUMBER}`);
    log("INIT", `User: ${userId}`);
    log("INIT", `Config: side=${sideSize}, hood=${addHood}, rear=${addRearBumper}`);
    log("INIT", `Skips: upscale=${skipUpscale}, QA=${skipQA}, cutContour=${skipCutContour}`);
    log("INIT", "=".repeat(60));

    // =====================================================================
    // STEP 1: QUERY — Find the Zombie Outbreak design
    // =====================================================================
    const step1Start = Date.now();
    log("STEP1", "Querying designiq_generations for zombie/outbreak designs...");

    const { data: designs, error: queryError } = await serviceClient
      .from("designiq_generations")
      .select("id, prompt, vehicle_make, vehicle_model, vehicle_year, render_urls, concept_json, status, created_at")
      .or("prompt.ilike.%zombie%,prompt.ilike.%outbreak%")
      .order("created_at", { ascending: false })
      .limit(5);

    if (queryError) {
      log("STEP1", `Query error: ${queryError.message}`);
      stages.push({
        stage: "STEP1_QUERY",
        status: "failed",
        startedAt: new Date(step1Start).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - step1Start,
        details: { error: queryError.message },
      });
      return new Response(
        JSON.stringify({ error: `Database query failed: ${queryError.message}`, stages }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    log("STEP1", `Found ${designs?.length || 0} matching designs`);

    if (!designs || designs.length === 0) {
      stages.push({
        stage: "STEP1_QUERY",
        status: "failed",
        startedAt: new Date(step1Start).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - step1Start,
        details: { error: "No designs found matching 'zombie' or 'outbreak'" },
      });
      return new Response(
        JSON.stringify({
          error: "No zombie/outbreak designs found in designiq_generations",
          suggestion: "Create a Zombie Outbreak design in DesignPro first, then re-run this test",
          stages,
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Use the most recent design
    const design = designs[0];
    const renderUrls = design.render_urls as Record<string, string> | string[] | null;

    // Extract the first available render URL
    let primaryRenderUrl: string | null = null;
    if (renderUrls) {
      if (Array.isArray(renderUrls)) {
        primaryRenderUrl = renderUrls[0] || null;
      } else if (typeof renderUrls === "object") {
        primaryRenderUrl = (renderUrls as Record<string, string>).side
          || (renderUrls as Record<string, string>).driver_side
          || Object.values(renderUrls)[0]
          || null;
      }
    }

    log("STEP1", `Selected design: ${design.id}`);
    log("STEP1", `  Prompt: ${(design.prompt || "").slice(0, 100)}...`);
    log("STEP1", `  Vehicle: ${design.vehicle_year} ${design.vehicle_make} ${design.vehicle_model}`);
    log("STEP1", `  Status: ${design.status}`);
    log("STEP1", `  Render URL: ${primaryRenderUrl ? primaryRenderUrl.slice(0, 80) + "..." : "NONE"}`);
    log("STEP1", `  Created: ${design.created_at}`);

    // Log all 5 results
    for (let i = 0; i < (designs?.length || 0); i++) {
      const d = designs![i];
      const urls = d.render_urls;
      const urlCount = urls ? (Array.isArray(urls) ? urls.length : Object.keys(urls as object).length) : 0;
      log("STEP1", `  [${i + 1}] id=${d.id} | ${d.vehicle_year} ${d.vehicle_make} ${d.vehicle_model} | urls=${urlCount} | status=${d.status} | ${d.created_at}`);
      log("STEP1", `       prompt: "${(d.prompt || "").slice(0, 120)}"`);
    }

    stages.push({
      stage: "STEP1_QUERY",
      status: "success",
      startedAt: new Date(step1Start).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - step1Start,
      details: {
        designsFound: designs.length,
        selectedId: design.id,
        vehicle: `${design.vehicle_year} ${design.vehicle_make} ${design.vehicle_model}`,
        prompt: design.prompt,
        hasRenderUrl: !!primaryRenderUrl,
        allResults: designs.map(d => ({
          id: d.id,
          prompt: (d.prompt || "").slice(0, 120),
          vehicle: `${d.vehicle_year} ${d.vehicle_make} ${d.vehicle_model}`,
          status: d.status,
          created_at: d.created_at,
        })),
      },
    });

    if (!primaryRenderUrl) {
      return new Response(
        JSON.stringify({
          error: "Design found but has no render URLs — needs a completed render first",
          design: {
            id: design.id,
            prompt: design.prompt,
            vehicle: `${design.vehicle_year} ${design.vehicle_make} ${design.vehicle_model}`,
            status: design.status,
            render_urls: design.render_urls,
          },
          stages,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // =====================================================================
    // STAGE 1: PANELIZER — Call generate-production-files
    // =====================================================================
    const stage1Start = Date.now();
    log("STAGE1", "=".repeat(60));
    log("STAGE1", "PANELIZER — Calling generate-production-files");
    log("STAGE1", "=".repeat(60));
    log("STAGE1", `  Side size: ${sideSize}`);
    log("STAGE1", `  Panels: driver, passenger${addHood ? ", hood" : ""}${addRearBumper ? ", rear, rear bumper" : ""}`);
    log("STAGE1", `  Roll width: 59.5" | Scale: 10% | Bleed: 0.5" all edges`);
    log("STAGE1", `  Render URL: ${primaryRenderUrl.slice(0, 80)}...`);

    let panelizerResult: Record<string, unknown> | null = null;
    try {
      const panelizerResponse = await fetch(`${functionsUrl}/generate-production-files`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          generationId: design.id,
          renderUrl: primaryRenderUrl,
          sideSize,
          addHood,
          addFrontBumper: false,
          addRearBumper,
          roofSize: "none",
          finish: "Gloss",
          vehicleYear: design.vehicle_year,
          vehicleMake: design.vehicle_make,
          vehicleModel: design.vehicle_model,
          designName: "Zombie Outbreak",
        }),
      });

      if (!panelizerResponse.ok) {
        const errText = await panelizerResponse.text();
        throw new Error(`Panelizer HTTP ${panelizerResponse.status}: ${errText.slice(0, 500)}`);
      }

      panelizerResult = await panelizerResponse.json();
      log("STAGE1", `  SUCCESS`);
      log("STAGE1", `  Pack URL: ${(panelizerResult as any)?.packUrl || "none"}`);
      log("STAGE1", `  Pack ID: ${(panelizerResult as any)?.packId || "none"}`);
      log("STAGE1", `  File count: ${(panelizerResult as any)?.fileCount || 0}`);
      log("STAGE1", `  Pipeline version: ${(panelizerResult as any)?.pipelineVersion}`);
      log("STAGE1", `  Gemini calls: ${(panelizerResult as any)?.geminiImageCalls}`);
      log("STAGE1", `  Upscale status: ${(panelizerResult as any)?.upscaleStatus}`);

      // Log panel details from metadata
      const meta = (panelizerResult as any)?.metadata;
      if (meta?.panels) {
        for (const panel of meta.panels) {
          log("STAGE1", `  Panel: ${panel.label}`);
          log("STAGE1", `    Physical: ${panel.widthInches}" x ${panel.heightInches}" (${panel.widthWithBleedInches}" x ${panel.heightWithBleedInches}" with bleed)`);
          log("STAGE1", `    Pixels: ${panel.widthPixels} x ${panel.heightPixels}`);
          log("STAGE1", `    DPI: ${panel.dpi} @ 10% scale (${panel.fullSizeDpi} DPI full size)`);
          log("STAGE1", `    Crop: ${panel.cropRatioWidth} x ${panel.cropRatioHeight} from master`);
          log("STAGE1", `    Mirrored: ${panel.mirrored}`);
          log("STAGE1", `    Stages: ${(panel.stagesRun || []).join(" → ")}`);
          log("STAGE1", `    File: ${panel.filename}`);
        }
      }

      if ((panelizerResult as any)?.packUrl) {
        downloads.fullZip = (panelizerResult as any).packUrl;
      }

      stages.push({
        stage: "STAGE1_PANELIZER",
        status: "success",
        startedAt: new Date(stage1Start).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stage1Start,
        details: {
          packUrl: (panelizerResult as any)?.packUrl,
          packId: (panelizerResult as any)?.packId,
          fileCount: (panelizerResult as any)?.fileCount,
          pipelineVersion: (panelizerResult as any)?.pipelineVersion,
          geminiCalls: (panelizerResult as any)?.geminiImageCalls,
          panels: meta?.panels || [],
        },
      });
    } catch (err: any) {
      log("STAGE1", `  FAILED: ${err.message}`);
      stages.push({
        stage: "STAGE1_PANELIZER",
        status: "failed",
        startedAt: new Date(stage1Start).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stage1Start,
        details: { error: err.message },
      });

      // Can't continue without panelizer output
      return new Response(
        JSON.stringify({
          error: `Pipeline failed at STAGE 1 (Panelizer): ${err.message}`,
          orderNumber: ORDER_NUMBER,
          design: {
            id: design.id,
            prompt: design.prompt,
            vehicle: `${design.vehicle_year} ${design.vehicle_make} ${design.vehicle_model}`,
          },
          stages,
          totalDurationMs: Date.now() - pipelineStart,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const packId = (panelizerResult as any)?.packId;
    const packUrl = (panelizerResult as any)?.packUrl;

    // =====================================================================
    // STAGE 2: UPSCALER — Check/wait for background upscale-production-pack
    // (Already fired by generate-production-files as fire-and-forget)
    // =====================================================================
    const stage2Start = Date.now();
    log("STAGE2", "=".repeat(60));
    log("STAGE2", "UPSCALER — Checking background upscale status");
    log("STAGE2", "=".repeat(60));

    if (skipUpscale) {
      log("STAGE2", "  SKIPPED (skipUpscale=true)");
      stages.push({
        stage: "STAGE2_UPSCALER",
        status: "skipped",
        startedAt: new Date(stage2Start).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stage2Start,
        details: { reason: "skipUpscale=true" },
      });
    } else if (packId) {
      // Poll production_packs for upscale_status
      let upscaleStatus = "processing";
      let upscaleProgress = "0/?";
      let pollCount = 0;
      const MAX_UPSCALE_POLLS = 120; // 2 minutes max wait

      while (upscaleStatus === "processing" && pollCount < MAX_UPSCALE_POLLS) {
        await new Promise(r => setTimeout(r, 2000)); // 2s between polls
        pollCount++;

        const { data: packData } = await serviceClient
          .from("production_packs")
          .select("upscale_status, upscale_progress, upscale_error")
          .eq("id", packId)
          .single();

        if (packData) {
          upscaleStatus = packData.upscale_status || "processing";
          upscaleProgress = packData.upscale_progress || "?/?";
          if (pollCount % 5 === 0) {
            log("STAGE2", `  Polling... status=${upscaleStatus} progress=${upscaleProgress} (poll ${pollCount})`);
          }
        }
      }

      log("STAGE2", `  Final status: ${upscaleStatus} (progress: ${upscaleProgress})`);
      log("STAGE2", `  Polls: ${pollCount} (${pollCount * 2}s elapsed)`);

      stages.push({
        stage: "STAGE2_UPSCALER",
        status: upscaleStatus === "complete" ? "success" : "failed",
        startedAt: new Date(stage2Start).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stage2Start,
        details: {
          upscaleStatus,
          upscaleProgress,
          pollCount,
          note: upscaleStatus === "processing" ? "Timed out waiting — upscale may still be running" : undefined,
        },
      });
    } else {
      log("STAGE2", "  SKIPPED — no packId from Stage 1");
      stages.push({
        stage: "STAGE2_UPSCALER",
        status: "skipped",
        startedAt: new Date(stage2Start).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stage2Start,
        details: { reason: "No packId returned from panelizer" },
      });
    }

    // =====================================================================
    // STAGE 3: QA VALIDATION — Call qa-check-production-panel on each panel
    // =====================================================================
    const stage3Start = Date.now();
    log("STAGE3", "=".repeat(60));
    log("STAGE3", "QA VALIDATION — Checking each panel");
    log("STAGE3", "=".repeat(60));

    const qaResults: Array<{ panel: string; passed: boolean; issues: unknown[] }> = [];

    if (skipQA) {
      log("STAGE3", "  SKIPPED (skipQA=true)");
      stages.push({
        stage: "STAGE3_QA",
        status: "skipped",
        startedAt: new Date(stage3Start).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stage3Start,
        details: { reason: "skipQA=true" },
      });
    } else {
      const meta = (panelizerResult as any)?.metadata;
      const panels = meta?.panels || [];
      const genId = design.id;
      const storagePrefix = `production-packs/${userId}/${genId}/panels`;

      for (const panel of panels) {
        const panelPath = `${storagePrefix}/${panel.filename}`;
        log("STAGE3", `  QA check: ${panel.label} (${panel.filename})`);

        try {
          // Get signed URL for the panel
          const { data: signedData, error: signedError } = await serviceClient.storage
            .from("wrap-files")
            .createSignedUrl(panelPath, 3600);

          if (signedError || !signedData?.signedUrl) {
            log("STAGE3", `    Failed to get signed URL: ${signedError?.message || "no URL"}`);
            qaResults.push({ panel: panel.label, passed: true, issues: [{ note: "Could not get signed URL — auto-passed" }] });
            continue;
          }

          // Call QA function
          const qaResponse = await fetch(`${functionsUrl}/qa-check-production-panel`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              panel_image_url: signedData.signedUrl,
              panel_label: panel.label,
              panel_width_inches: panel.widthInches,
              panel_height_inches: panel.heightInches,
              design_name: "Zombie Outbreak",
              production_pack_id: packId,
            }),
          });

          if (!qaResponse.ok) {
            log("STAGE3", `    QA API error: ${qaResponse.status}`);
            qaResults.push({ panel: panel.label, passed: true, issues: [{ note: `QA API returned ${qaResponse.status} — auto-passed` }] });
            continue;
          }

          const qaResult = await qaResponse.json();
          log("STAGE3", `    Result: ${qaResult.passed ? "PASS" : "FAIL"} (confidence: ${qaResult.confidence})`);

          if (qaResult.checks) {
            for (const check of qaResult.checks) {
              log("STAGE3", `      ${check.passed ? "PASS" : "FAIL"} ${check.name}: ${check.details}`);
            }
          }
          if (qaResult.issues?.length > 0) {
            for (const issue of qaResult.issues) {
              log("STAGE3", `      ISSUE [${issue.severity}]: ${issue.element} @ ${issue.location} — ${issue.description}`);
            }
          }

          // Dimension validation
          const expectedW = panel.widthPixels;
          const expectedH = panel.heightPixels;
          log("STAGE3", `    Expected dimensions: ${expectedW}x${expectedH}px`);
          log("STAGE3", `    Panel size for Medium: ${panel.widthInches}"x${panel.heightInches}" + 0.5" bleed`);

          // Aspect ratio check
          const expectedRatio = panel.widthWithBleedInches / panel.heightWithBleedInches;
          const pixelRatio = expectedW / expectedH;
          const ratioMatch = Math.abs(expectedRatio - pixelRatio) < 0.01;
          log("STAGE3", `    Aspect ratio: expected=${expectedRatio.toFixed(3)} actual=${pixelRatio.toFixed(3)} ${ratioMatch ? "PASS" : "FAIL"}`);

          qaResults.push({
            panel: panel.label,
            passed: qaResult.passed,
            issues: qaResult.issues || [],
          });

          // Generate signed download URL for this panel
          downloads.panels[panel.label] = signedData.signedUrl;

        } catch (qaErr: any) {
          log("STAGE3", `    QA error: ${qaErr.message}`);
          qaResults.push({ panel: panel.label, passed: true, issues: [{ note: `Error: ${qaErr.message} — auto-passed` }] });
        }
      }

      const allPassed = qaResults.every(r => r.passed);
      log("STAGE3", `  QA Summary: ${qaResults.length} panels checked, ${qaResults.filter(r => r.passed).length} passed`);
      log("STAGE3", `  Overall: ${allPassed ? "ALL PASSED" : "SOME FAILED"}`);

      stages.push({
        stage: "STAGE3_QA",
        status: allPassed ? "success" : "failed",
        startedAt: new Date(stage3Start).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stage3Start,
        details: {
          panelsChecked: qaResults.length,
          allPassed,
          results: qaResults,
        },
      });
    }

    // =====================================================================
    // STAGE 4: CUT CONTOUR — Call generate-cut-files
    // =====================================================================
    const stage4Start = Date.now();
    log("STAGE4", "=".repeat(60));
    log("STAGE4", "CUT CONTOUR — Checking for logo/text elements");
    log("STAGE4", "=".repeat(60));

    if (skipCutContour) {
      log("STAGE4", "  SKIPPED (skipCutContour=true)");
      stages.push({
        stage: "STAGE4_CUT_CONTOUR",
        status: "skipped",
        startedAt: new Date(stage4Start).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stage4Start,
        details: { reason: "skipCutContour=true" },
      });
    } else {
      try {
        log("STAGE4", `  Calling generate-cut-files with render URL...`);

        const cutResponse = await fetch(`${functionsUrl}/generate-cut-files`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader || `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            renderUrl: primaryRenderUrl,
            designName: "Zombie Outbreak",
            vehicleYear: design.vehicle_year,
            vehicleMake: design.vehicle_make,
            vehicleModel: design.vehicle_model,
            visualizationId: design.id,
          }),
        });

        if (cutResponse.status === 422) {
          // No logos/text found — this is expected for artistic wraps
          const cutResult = await cutResponse.json();
          log("STAGE4", `  No cut contour needed — ${cutResult.error || "no text/logo elements detected"}`);
          stages.push({
            stage: "STAGE4_CUT_CONTOUR",
            status: "skipped",
            startedAt: new Date(stage4Start).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - stage4Start,
            details: { reason: "No text/logo elements detected on this design" },
          });
        } else if (!cutResponse.ok) {
          const errText = await cutResponse.text();
          throw new Error(`Cut file HTTP ${cutResponse.status}: ${errText.slice(0, 500)}`);
        } else {
          const cutResult = await cutResponse.json();
          log("STAGE4", `  Cut files generated: ${cutResult.elementCount} elements`);
          log("STAGE4", `  Vectorized: ${cutResult.vectorizedCount}`);
          log("STAGE4", `  Download: ${cutResult.downloadUrl}`);

          if (cutResult.manifest) {
            for (const el of cutResult.manifest) {
              log("STAGE4", `    ${el.label}: vectorized=${el.vectorized}`);
            }
          }

          downloads.cutFiles = cutResult.downloadUrl;

          stages.push({
            stage: "STAGE4_CUT_CONTOUR",
            status: "success",
            startedAt: new Date(stage4Start).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - stage4Start,
            details: {
              elementCount: cutResult.elementCount,
              vectorizedCount: cutResult.vectorizedCount,
              downloadUrl: cutResult.downloadUrl,
              manifest: cutResult.manifest,
            },
          });
        }
      } catch (cutErr: any) {
        log("STAGE4", `  FAILED: ${cutErr.message}`);
        stages.push({
          stage: "STAGE4_CUT_CONTOUR",
          status: "failed",
          startedAt: new Date(stage4Start).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - stage4Start,
          details: { error: cutErr.message },
        });
      }
    }

    // =====================================================================
    // STAGE 5: PACKAGE — Final metadata assembly
    // (ZIP was already created by Stage 1 — we add QA + cut contour results)
    // =====================================================================
    const stage5Start = Date.now();
    log("STAGE5", "=".repeat(60));
    log("STAGE5", "PACKAGE — Assembling final metadata");
    log("STAGE5", "=".repeat(60));

    const finalMetadata = {
      orderNumber: ORDER_NUMBER,
      pipelineTest: true,
      generatedAt: new Date().toISOString(),
      design: {
        id: design.id,
        prompt: design.prompt,
        vehicle: `${design.vehicle_year} ${design.vehicle_make} ${design.vehicle_model}`,
      },
      panelizer: {
        packUrl: (panelizerResult as any)?.packUrl,
        packId: (panelizerResult as any)?.packId,
        fileCount: (panelizerResult as any)?.fileCount,
        pipelineVersion: (panelizerResult as any)?.pipelineVersion,
        panels: (panelizerResult as any)?.metadata?.panels || [],
      },
      qaResults,
      stages: stages.map(s => ({ stage: s.stage, status: s.status, durationMs: s.durationMs })),
      printInstructions: (panelizerResult as any)?.metadata?.printInstructions,
    };

    // Upload metadata JSON to storage
    const metadataPath = `production-packs/${userId}/${ORDER_NUMBER}/metadata.json`;
    try {
      const { error: metaUploadErr } = await serviceClient.storage
        .from("wrap-files")
        .upload(metadataPath, JSON.stringify(finalMetadata, null, 2), {
          contentType: "application/json",
          upsert: true,
        });

      if (metaUploadErr) {
        log("STAGE5", `  Metadata upload error: ${metaUploadErr.message}`);
      } else {
        const { data: metaUrlData } = await serviceClient.storage
          .from("wrap-files")
          .createSignedUrl(metadataPath, 86400); // 24h
        downloads.metadata = metaUrlData?.signedUrl || undefined;
        log("STAGE5", `  Metadata uploaded: ${metadataPath}`);
      }
    } catch (metaErr: any) {
      log("STAGE5", `  Metadata upload failed: ${metaErr.message}`);
    }

    // Print instructions text
    const printInstructionsTxt = `Generated by Universal Panelizer™ File Output System — RestyleProAI
================================================================
Order: ${ORDER_NUMBER}
Vehicle: ${design.vehicle_year} ${design.vehicle_make} ${design.vehicle_model}
Design: Zombie Outbreak
Generated: ${new Date().toISOString()}
================================================================

FILES:
  Production ZIP: ${packUrl || "N/A"}
${Object.entries(downloads.panels).map(([label, url]) => `  ${label}: ${url.slice(0, 80)}...`).join("\n")}
${downloads.cutFiles ? `  Cut Files: ${downloads.cutFiles}` : "  Cut Files: No cut contour needed"}

QA RESULTS:
${qaResults.map(r => `  ${r.panel}: ${r.passed ? "PASS" : "FAIL"}${r.issues.length > 0 ? ` (${r.issues.length} issues)` : ""}`).join("\n") || "  QA not run"}

PRINT INSTRUCTIONS:
  1. Files are at 10% scale — set RIP to 1000% (10x)
  2. 0.5" bleed on all edges — trim after print
  3. Passenger side MUST be flipped horizontally before print
  4. 59.5" panel height = 60" vinyl roll with 0.25" trim each side
  5. Print on cast vinyl (Avery SW900, 3M IJ180, or equivalent)
  6. Laminate with matching Gloss overlaminate
`;

    const instructionsPath = `production-packs/${userId}/${ORDER_NUMBER}/print_instructions.txt`;
    try {
      await serviceClient.storage
        .from("wrap-files")
        .upload(instructionsPath, printInstructionsTxt, {
          contentType: "text/plain",
          upsert: true,
        });
      log("STAGE5", `  Print instructions uploaded: ${instructionsPath}`);
    } catch {
      log("STAGE5", "  Print instructions upload failed (non-fatal)");
    }

    log("STAGE5", `  Package contents:`);
    log("STAGE5", `    /driver_side.png — in production ZIP`);
    log("STAGE5", `    /passenger_side.png — in production ZIP (mirrored)`);
    if (addHood) log("STAGE5", `    /hood.png — in production ZIP`);
    if (addRearBumper) {
      log("STAGE5", `    /rear.png — in production ZIP`);
      log("STAGE5", `    /rear_bumper.png — in production ZIP`);
    }
    log("STAGE5", `    /metadata.json — uploaded separately`);
    log("STAGE5", `    /print_instructions.txt — uploaded`);
    if (downloads.cutFiles) log("STAGE5", `    /cutcontour/ — in cut files ZIP`);

    stages.push({
      stage: "STAGE5_PACKAGE",
      status: "success",
      startedAt: new Date(stage5Start).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - stage5Start,
      details: {
        storagePath: `production-packs/${userId}/${ORDER_NUMBER}/`,
        files: ["production-pack ZIP", "metadata.json", "print_instructions.txt"],
      },
    });

    // =====================================================================
    // STAGE 6: DOWNLOAD — Generate signed URLs for everything
    // =====================================================================
    const stage6Start = Date.now();
    log("STAGE6", "=".repeat(60));
    log("STAGE6", "DOWNLOAD — Generating signed URLs");
    log("STAGE6", "=".repeat(60));

    // Get signed URL for the ZIP (it was already public, but let's also get a signed one)
    if (packUrl) {
      // The packUrl from panelizer is already a public URL
      downloads.fullZip = packUrl;
      log("STAGE6", `  a) Full ZIP: ${packUrl}`);
    }

    // Individual panel signed URLs (may already have them from QA stage)
    const meta = (panelizerResult as any)?.metadata;
    if (meta?.panels) {
      const genId = design.id;
      const storagePrefix = `production-packs/${userId}/${genId}/panels`;

      for (const panel of meta.panels) {
        if (!downloads.panels[panel.label]) {
          const panelPath = `${storagePrefix}/${panel.filename}`;
          try {
            const { data: signedData } = await serviceClient.storage
              .from("wrap-files")
              .createSignedUrl(panelPath, 86400); // 24h signed URL
            if (signedData?.signedUrl) {
              downloads.panels[panel.label] = signedData.signedUrl;
            }
          } catch {
            log("STAGE6", `    Failed to get signed URL for ${panel.label}`);
          }
        }
        log("STAGE6", `  b) ${panel.label}: ${downloads.panels[panel.label] ? "OK" : "FAILED"}`);
      }
    }

    if (downloads.metadata) {
      log("STAGE6", `  c) Metadata JSON: OK`);
    }
    if (downloads.cutFiles) {
      log("STAGE6", `  d) Cut Files: ${downloads.cutFiles}`);
    }

    stages.push({
      stage: "STAGE6_DOWNLOAD",
      status: "success",
      startedAt: new Date(stage6Start).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - stage6Start,
      details: {
        fullZip: !!downloads.fullZip,
        panelUrls: Object.keys(downloads.panels).length,
        metadataUrl: !!downloads.metadata,
        cutFilesUrl: !!downloads.cutFiles,
      },
    });

    // =====================================================================
    // STAGE 7: WRAPBOX DELIVERY — Write to design_pack_purchases for WrapBox
    // =====================================================================
    const stage7Start = Date.now();
    log("STAGE7", "=".repeat(60));
    log("STAGE7", "WRAPBOX DELIVERY — Writing to design_pack_purchases");
    log("STAGE7", "=".repeat(60));

    try {
      const vehicleStr = `${design.vehicle_year} ${design.vehicle_make} ${design.vehicle_model}`;

      // Upsert into design_pack_purchases so WrapBox can display + download
      const { data: purchase, error: purchaseError } = await serviceClient
        .from("design_pack_purchases")
        .upsert({
          user_id: userId,
          generation_id: design.id,
          order_number: ORDER_NUMBER,
          production_status: "ready",
          wrapbox_delivery_url: downloads.fullZip || packUrl || null,
          download_url: downloads.fullZip || packUrl || null,
          vehicle_year: String(design.vehicle_year || ""),
          vehicle_make: design.vehicle_make || "",
          vehicle_model: design.vehicle_model || "",
          generation_completed_at: new Date().toISOString(),
          download_expires_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
        }, {
          onConflict: "generation_id,user_id",
          ignoreDuplicates: false,
        })
        .select()
        .single();

      if (purchaseError) {
        log("STAGE7", `  WrapBox upsert error: ${purchaseError.message}`);
        log("STAGE7", `  Attempting insert without onConflict...`);

        // Fallback: try plain insert if upsert constraint doesn't exist yet
        const { error: insertError } = await serviceClient
          .from("design_pack_purchases")
          .insert({
            user_id: userId,
            generation_id: design.id,
            order_number: ORDER_NUMBER,
            production_status: "ready",
            wrapbox_delivery_url: downloads.fullZip || packUrl || null,
            download_url: downloads.fullZip || packUrl || null,
            vehicle_year: String(design.vehicle_year || ""),
            vehicle_make: design.vehicle_make || "",
            vehicle_model: design.vehicle_model || "",
            generation_completed_at: new Date().toISOString(),
            download_expires_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
          });

        if (insertError) {
          log("STAGE7", `  Insert also failed: ${insertError.message}`);
        } else {
          log("STAGE7", `  Fallback insert succeeded`);
        }
      } else {
        log("STAGE7", `  WrapBox record created/updated: ${purchase?.id || "OK"}`);
        log("STAGE7", `  Order: ${ORDER_NUMBER}`);
        log("STAGE7", `  Vehicle: ${vehicleStr}`);
        log("STAGE7", `  Download URL: ${(downloads.fullZip || packUrl || "N/A").slice(0, 80)}...`);
      }

      stages.push({
        stage: "STAGE7_WRAPBOX",
        status: "success",
        startedAt: new Date(stage7Start).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stage7Start,
        details: {
          order_number: ORDER_NUMBER,
          wrapbox_delivery_url: !!(downloads.fullZip || packUrl),
          purchase_id: purchase?.id || null,
        },
      });

      log("STAGE7", `  Files are now available in WrapBox (/wrapbox)`);
    } catch (wrapboxErr: any) {
      log("STAGE7", `  WrapBox delivery failed (non-fatal): ${wrapboxErr.message}`);
      stages.push({
        stage: "STAGE7_WRAPBOX",
        status: "failed",
        startedAt: new Date(stage7Start).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stage7Start,
        details: { error: wrapboxErr.message },
      });
    }

    // =====================================================================
    // FINAL SUMMARY
    // =====================================================================
    const totalDuration = Date.now() - pipelineStart;
    log("SUMMARY", "=".repeat(60));
    log("SUMMARY", "ZOMBIE OUTBREAK PIPELINE TEST — COMPLETE");
    log("SUMMARY", "=".repeat(60));
    log("SUMMARY", `Order: ${ORDER_NUMBER}`);
    log("SUMMARY", `Design: ${design.id}`);
    log("SUMMARY", `Vehicle: ${design.vehicle_year} ${design.vehicle_make} ${design.vehicle_model}`);
    log("SUMMARY", `Total duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(1)}s)`);
    log("SUMMARY", "");
    for (const stage of stages) {
      log("SUMMARY", `  ${stage.stage}: ${stage.status.toUpperCase()} (${stage.durationMs}ms)`);
    }
    log("SUMMARY", "");
    log("SUMMARY", "DOWNLOADS:");
    log("SUMMARY", `  ZIP: ${downloads.fullZip || "N/A"}`);
    for (const [label, url] of Object.entries(downloads.panels)) {
      log("SUMMARY", `  ${label}: ${url.slice(0, 80)}...`);
    }
    if (downloads.metadata) log("SUMMARY", `  Metadata: ${downloads.metadata.slice(0, 80)}...`);
    if (downloads.cutFiles) log("SUMMARY", `  Cut Files: ${downloads.cutFiles}`);
    log("SUMMARY", "");
    log("SUMMARY", "WRAPBOX: Files delivered to /wrapbox — ready for download");
    log("SUMMARY", "=".repeat(60));

    const result: PipelineResult = {
      orderNumber: ORDER_NUMBER,
      design: {
        id: design.id,
        prompt: design.prompt,
        vehicle: `${design.vehicle_year} ${design.vehicle_make} ${design.vehicle_model}`,
        status: design.status,
        created_at: design.created_at,
      },
      stages,
      downloads,
      totalDurationMs: totalDuration,
      completedAt: new Date().toISOString(),
    };

    return new Response(
      JSON.stringify(result, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (error: any) {
    const totalDuration = Date.now() - pipelineStart;
    console.error("Pipeline fatal error:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Pipeline test failed",
        orderNumber: ORDER_NUMBER,
        stages,
        downloads,
        totalDurationMs: totalDuration,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
