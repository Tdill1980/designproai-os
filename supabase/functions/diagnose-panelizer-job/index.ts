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
// diagnose-panelizer-job — Surgical diagnostic for panelizer pipeline
// Deploy: npx supabase functions deploy diagnose-panelizer-job --project-ref kfapjdyythzyvnpdeghu
// Call:   curl -X POST https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/diagnose-panelizer-job \
//           -H "Authorization: Bearer <service_role_key>" \
//           -H "Content-Type: application/json" \
//           -d '{"job_id":"e27a34cf-6435-4f9c-a2ed-22b319151f77"}'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PANELIZER_STEPS = [
  { idx: 0,  key: 'validate',      perPanel: false },
  { idx: 1,  key: 'fetch',         perPanel: false },
  { idx: 2,  key: 'unwrap',        perPanel: false },
  { idx: 3,  key: 'fill',          perPanel: false },
  { idx: 4,  key: 'crop',          perPanel: true  },
  { idx: 5,  key: 'upscale',       perPanel: true  },
  { idx: 6,  key: 'flatten',       perPanel: true  },
  { idx: 7,  key: 'flip',          perPanel: true  },
  { idx: 8,  key: 'cropmarks',     perPanel: true  },
  { idx: 9,  key: 'colorconvert',  perPanel: true  },
  { idx: 10, key: 'vectorize-eps', perPanel: false },
  { idx: 11, key: 'qa',            perPanel: true  },
  { idx: 12, key: 'package',       perPanel: false },
];

Deno.serve(async (req: Request) => {
  try {
    const { job_id } = await req.json();
    if (!job_id) return Response.json({ error: "job_id required" }, { status: 400 });

    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, key);

    // ── 1. Fetch the job ──
    const { data: job, error: jobErr } = await db
      .from("panelizer_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) {
      return Response.json({ error: "Job not found", detail: jobErr?.message }, { status: 404 });
    }

    const sp = job.stage_progress || {};
    const stepData = sp.panelizer_step_data || {};

    // ── 2. Analyze each step ──
    const stepAnalysis = PANELIZER_STEPS.map((step) => {
      const data = stepData[step.key];
      if (!data) {
        return {
          idx: step.idx,
          key: step.key,
          perPanel: step.perPanel,
          status: "NOT_STARTED",
          completed_at: null,
          storagePaths: [],
          resultKeys: [],
          resultSummary: null,
        };
      }

      const storagePaths: string[] = [];

      // Extract storagePaths from job-level results
      if (data.result) {
        if (data.result.storagePath) storagePaths.push(data.result.storagePath);
        if (data.result.unwrappedPaths) {
          Object.values(data.result.unwrappedPaths).forEach((p: any) => storagePaths.push(p));
        }
        if (data.result.panelPaths) {
          Object.values(data.result.panelPaths).forEach((p: any) => storagePaths.push(p));
        }
      }

      // Extract storagePaths from per-panel results
      if (data.panel_results) {
        Object.entries(data.panel_results).forEach(([panelKey, pr]: [string, any]) => {
          if (pr?.storagePath) storagePaths.push(pr.storagePath);
        });
      }

      return {
        idx: step.idx,
        key: step.key,
        perPanel: step.perPanel,
        status: data.completed_at ? "COMPLETED" : "IN_PROGRESS",
        completed_at: data.completed_at || null,
        storagePaths,
        resultKeys: data.result ? Object.keys(data.result) : (data.panel_results ? Object.keys(data.panel_results) : []),
        resultSummary: data.result
          ? JSON.stringify(data.result).slice(0, 500)
          : data.panel_results
            ? JSON.stringify(Object.fromEntries(
                Object.entries(data.panel_results).map(([k, v]: [string, any]) => [
                  k,
                  { storagePath: v?.storagePath, step: v?.step, keys: Object.keys(v || {}) }
                ])
              )).slice(0, 1000)
            : null,
      };
    });

    // ── 3. List ALL storage files for this job ──
    const userId = job.user_id;
    const storagePath = `${userId}/temp/${job_id}`;
    const finalPath = `${userId}/${job.order_number}`;

    // List temp files
    const { data: tempFiles, error: tempErr } = await db.storage
      .from("panelizer")
      .list(storagePath, { limit: 200, sortBy: { column: "created_at", order: "asc" } });

    // List final/production files
    const { data: finalFiles, error: finalErr } = await db.storage
      .from("panelizer")
      .list(finalPath, { limit: 200, sortBy: { column: "created_at", order: "asc" } });

    // Also try listing at the user/jobId level (some steps may write directly here)
    const directPath = `${userId}/${job_id}`;
    const { data: directFiles, error: directErr } = await db.storage
      .from("panelizer")
      .list(directPath, { limit: 200, sortBy: { column: "created_at", order: "asc" } });

    // Also check the path the user mentioned
    const userSpecifiedPath = `61cc6c1c-554c-440c-8e07-a64469f1f4eb/temp/e27a34cf-6435-4f9c-a2ed-22b319151f77`;
    const { data: specifiedFiles, error: specErr } = await db.storage
      .from("panelizer")
      .list(userSpecifiedPath, { limit: 200, sortBy: { column: "created_at", order: "asc" } });

    // Also try production-packs bucket (user mentioned this path)
    const ppPath = `61cc6c1c-554c-440c-8e07-a64469f1f4eb/temp/e27a34cf-6435-4f9c-a2ed-22b319151f77`;
    const { data: ppFiles, error: ppErr } = await db.storage
      .from("production-packs")
      .list(ppPath, { limit: 200, sortBy: { column: "created_at", order: "asc" } });

    // ── 4. Find the LAST file written ──
    const allFiles = [
      ...(tempFiles || []).map((f: any) => ({ ...f, bucket: "panelizer", dir: storagePath })),
      ...(finalFiles || []).map((f: any) => ({ ...f, bucket: "panelizer", dir: finalPath })),
      ...(directFiles || []).map((f: any) => ({ ...f, bucket: "panelizer", dir: directPath })),
      ...(specifiedFiles || []).map((f: any) => ({ ...f, bucket: "panelizer", dir: `panelizer/${userSpecifiedPath}` })),
      ...(ppFiles || []).map((f: any) => ({ ...f, bucket: "production-packs", dir: ppPath })),
    ];

    // Sort by created_at descending to find last written
    allFiles.sort((a: any, b: any) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });

    const lastFile = allFiles[0] || null;

    // ── 5. Collect all storagePaths referenced in step results ──
    const allReferencedPaths: string[] = [];
    stepAnalysis.forEach((s) => {
      s.storagePaths.forEach((p) => allReferencedPaths.push(p));
    });

    // ── 6. Check which referenced paths actually exist in storage ──
    const pathChecks: Record<string, any> = {};
    for (const p of allReferencedPaths.slice(0, 30)) {
      // Parse bucket/path
      const parts = p.split("/");
      const dir = parts.slice(0, -1).join("/");
      const fileName = parts[parts.length - 1];
      // Try listing the directory to check if file exists
      const { data: check } = await db.storage.from("panelizer").list(dir, { limit: 100 });
      const found = (check || []).find((f: any) => f.name === fileName);
      pathChecks[p] = found
        ? { exists: true, size: found.metadata?.size || found.size, created_at: found.created_at, mimetype: found.metadata?.mimetype }
        : { exists: false };
    }

    // ── BUILD REPORT ──
    const report = {
      _diagnostic: "panelizer-pipeline-surgical-report",
      _generated_at: new Date().toISOString(),

      job: {
        id: job.id,
        user_id: job.user_id,
        order_number: job.order_number,
        status: job.status,
        current_stage: job.current_stage,
        error_stage: job.error_stage,
        error_message: job.error_message,
        retry_count: job.retry_count,
        last_completed_step: job.last_completed_step,
        attempt_count: job.attempt_count,
        pipeline_version: job.pipeline_version,
        deterministic: job.deterministic,
        created_at: job.created_at,
        started_at: job.started_at,
        updated_at: job.updated_at,
        completed_at: job.completed_at,
        processing_time_ms: job.processing_time_ms,
        zip_storage_path: job.zip_storage_path,
        zip_signed_url: job.zip_signed_url ? "(present)" : null,
        vehicle: `${job.vehicle_year} ${job.vehicle_make} ${job.vehicle_model}`,
      },

      stage_progress_raw: sp,

      step_analysis: stepAnalysis,

      storage_files: {
        temp_dir: storagePath,
        temp_files: (tempFiles || []).map((f: any) => ({
          name: f.name,
          size: f.metadata?.size || f.size,
          created_at: f.created_at,
          mimetype: f.metadata?.mimetype,
          fullPath: `${storagePath}/${f.name}`,
        })),
        temp_error: tempErr?.message || null,

        final_dir: finalPath,
        final_files: (finalFiles || []).map((f: any) => ({
          name: f.name,
          size: f.metadata?.size || f.size,
          created_at: f.created_at,
          mimetype: f.metadata?.mimetype,
          fullPath: `${finalPath}/${f.name}`,
        })),
        final_error: finalErr?.message || null,

        direct_dir: directPath,
        direct_files: (directFiles || []).map((f: any) => ({
          name: f.name,
          size: f.metadata?.size || f.size,
          created_at: f.created_at,
          mimetype: f.metadata?.mimetype,
          fullPath: `${directPath}/${f.name}`,
        })),
        direct_error: directErr?.message || null,

        user_specified_path: userSpecifiedPath,
        user_specified_files: (specifiedFiles || []).map((f: any) => ({
          name: f.name,
          size: f.metadata?.size || f.size,
          created_at: f.created_at,
          mimetype: f.metadata?.mimetype,
        })),
        user_specified_error: specErr?.message || null,

        production_packs_files: (ppFiles || []).map((f: any) => ({
          name: f.name,
          size: f.metadata?.size || f.size,
          created_at: f.created_at,
          mimetype: f.metadata?.mimetype,
        })),
        production_packs_error: ppErr?.message || null,
      },

      last_file_written: lastFile
        ? {
            name: lastFile.name,
            bucket: lastFile.bucket,
            dir: lastFile.dir,
            size: lastFile.metadata?.size || lastFile.size,
            created_at: lastFile.created_at,
            mimetype: lastFile.metadata?.mimetype,
          }
        : null,

      total_files_found: allFiles.length,

      path_verification: pathChecks,

      summary: {
        current_step_index: sp.panelizer_step_index ?? "not set",
        steps_completed: stepAnalysis.filter((s) => s.status === "COMPLETED").map((s) => `[${s.idx}] ${s.key}`),
        steps_not_started: stepAnalysis.filter((s) => s.status === "NOT_STARTED").map((s) => `[${s.idx}] ${s.key}`),
        steps_in_progress: stepAnalysis.filter((s) => s.status === "IN_PROGRESS").map((s) => `[${s.idx}] ${s.key}`),
        total_storage_paths_referenced: allReferencedPaths.length,
        total_files_in_storage: allFiles.length,
        panelizer_complete: sp.panelizer_complete || false,
        pf_qa_complete: sp.pf_qa_complete || false,
        extract_complete: sp.extract_complete || false,
        package_complete: sp.package_complete || false,
      },
    };

    return Response.json(report, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return Response.json(
      { error: "Diagnostic failed", detail: err.message, stack: err.stack },
      { status: 500 }
    );
  }
});
