// ============================================================================
// designpro-ensure-qc-job
//
// Bridges a produced DesignProAI design into the QC ProductionFlow page
// (/designer-qc). The studio persists a design's assets into
// design_generation_assets (clean background, overlay PNGs, layer_layout, 2D/3D
// proofs) — but /designer-qc lists panelizer_jobs of job_type='production_pack'
// and joins them to assets by generation_id. Until a production-pack JOB exists
// for the generation, the design's assets are invisible there (the "empty
// containers" bug: 24 of 25 asset-bearing designs had no QC job).
//
// This idempotently ensures that linking job exists, so every produced design
// flows into QC with ALL its containers populated. It ALSO reconciles the 2D
// proof: the studio stores flat_proof_url on designiq_generations, but the QC
// page reads design_generation_assets.proof_2d_url — so we copy it across when
// the asset row is missing it. (3D proof = the approved hero when unset.)
//
// Print-ready files are produced by the canonical G.E.N.I.E. deterministic
// slicer (api/process-production-pack on Vercel — the SAME engine the customer
// Order-Pack CTA and the /designer-qc admin button call) — kicked here only when
// trigger_pipeline is true, else the designer runs it from the QC page on demand.
// (NOT run-production-flow: that "v3" artboard path OOM-crashes — generate-master-
//  artboard 546 WORKER_LIMIT — and is the wiring gap, per docs/DESIGNPROAI-FLOW.md.)
//
// Input:  { generation_id (required), user_id?, trigger_pipeline?: boolean }
// Output: { ok, job_id, order_number, created, proof_reconciled }
//
// verify_jwt = false (service-role internal orchestration).
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Canonical deterministic slicer (Vercel sidecar, served on the production domain
// restyleproai.com — NOT restylepro-os.vercel.app, which is DEPLOYMENT_NOT_FOUND
// and was the root of the recurring "sidecar 404" pack failures). Overridable via
// the VERCEL_SIDECAR_URL secret.
// Verified live 2026-06-05 via pg_net: direct probes to www.restyleproai.com
// (and apex) REACH the slicer (its own 401 JSON), but every kick through the
// VERCEL_SIDECAR_URL env override returned Vercel's 404 DEPLOYMENT_NOT_FOUND —
// i.e. the stored env points at a dead host (a stale deploy hash / the
// restylepro-os.vercel.app preview). Ignore the stale override and pin the
// known-good www host so production packs actually build.
const SIDECAR_URL = "https://www.restyleproai.com/api/process-production-pack";
// Sanitize: the stored secret picked up a non-Latin1 character (paste artifact),
// which makes `Authorization: Bearer <secret>` an invalid ByteString and throws
// at fetch() construction — the silent root of the server-to-server pack failures.
// Strip to printable ASCII (secrets are base64url/hex, all printable) + trim.
const SIDECAR_SECRET = (Deno.env.get("SIDECAR_SECRET") || "").replace(/[^\x20-\x7E]/g, "").trim();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { generation_id?: string; user_id?: string; trigger_pipeline?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const generationId = (body.generation_id || "").trim();
  if (!generationId) return json({ error: "generation_id required" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // Pull the current asset row (source of vehicle scoping + the assets the QC
    // page will display) and the generation (vehicle info + flat_proof_url).
    const [{ data: asset }, { data: gen }] = await Promise.all([
      sb.from("design_generation_assets").select("*").eq("generation_id", generationId)
        .eq("is_current", true).order("iteration_index", { ascending: false }).limit(1).maybeSingle(),
      sb.from("designiq_generations").select("*").eq("id", generationId).maybeSingle(),
    ]);

    // user_id is NOT NULL on panelizer_jobs — resolve from caller, asset, or gen.
    const userId = body.user_id || (asset as any)?.user_id || (gen as any)?.user_id || null;

    // ── Reconcile the 2D proof onto the asset row (QC reads proof_2d_url) ──
    let proofReconciled = false;
    const flatProof = (gen as any)?.flat_proof_url || null;
    if (asset && !(asset as any).proof_2d_url && flatProof) {
      const { error: upErr } = await sb.from("design_generation_assets")
        .update({ proof_2d_url: flatProof }).eq("id", (asset as any).id);
      if (!upErr) proofReconciled = true;
    }
    // 3D proof falls back to the approved hero render when unset, so the QC
    // 3D-proof container isn't empty.
    const heroUrl =
      (gen as any)?.hero_image_url || (gen as any)?.image_url ||
      ((asset as any)?.view_urls?.side) || ((asset as any)?.view_urls?.["driver-side"]) || null;
    if (asset && !(asset as any).proof_3d_url && heroUrl) {
      await sb.from("design_generation_assets").update({ proof_3d_url: heroUrl }).eq("id", (asset as any).id);
    }

    // ── Idempotent: reuse an existing production_pack job for this generation ──
    const { data: existing } = await sb.from("panelizer_jobs")
      .select("id, order_number, status")
      .eq("generation_id", generationId).eq("job_type", "production_pack")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (existing) {
      const slicer = body.trigger_pipeline ? await kickPipeline(sb, (existing as any).id) : undefined;
      return json({
        ok: true, job_id: (existing as any).id, order_number: (existing as any).order_number,
        created: false, proof_reconciled: proofReconciled, slicer,
      });
    }

    if (!userId) return json({ error: "no user_id resolvable for generation" }, 422);

    // Create the linking job. order_number is assigned by the DB trigger.
    const { data: job, error: jobErr } = await sb.from("panelizer_jobs").insert({
      user_id: userId,
      generation_id: generationId,
      approved_render_url: heroUrl,
      all_view_urls: (gen as any)?.all_view_urls || [],
      concept_json: (gen as any)?.concept_json || (gen as any)?.design_config || {},
      vehicle_year: (gen as any)?.vehicle_year ?? null,
      vehicle_make: (gen as any)?.vehicle_make ?? null,
      vehicle_model: (gen as any)?.vehicle_model ?? null,
      vehicle_trim: (gen as any)?.vehicle_trim ?? null,
      job_type: "production_pack",
      status: "queued",
      started_at: new Date().toISOString(),
    }).select("id, order_number").single();

    if (jobErr || !job) return json({ error: `job insert: ${jobErr?.message || "unknown"}` }, 500);

    const slicer = body.trigger_pipeline ? await kickPipeline(sb, (job as any).id) : undefined;

    return json({
      ok: true, job_id: (job as any).id, order_number: (job as any).order_number,
      created: true, proof_reconciled: proofReconciled, slicer,
    });
  } catch (err) {
    console.error("[designpro-ensure-qc-job] error:", err);
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});

// Fire the canonical G.E.N.I.E. deterministic slicer (print-ready panels + 2"
// bleed + QC cert + ZIP → WrapBox). Same engine the customer Order-Pack CTA and
// the /designer-qc admin button use.
//
// IMPORTANT: trigger via pg_net (the kick_production_slicer SQL wrapper), NOT a
// direct edge fetch(). Supabase Edge Functions cannot reach the Vercel custom
// domain — every edge→restyleproai.com request returns DEPLOYMENT_NOT_FOUND from
// the edge egress network (the real "sidecar 404" root cause). pg_net reaches the
// slicer from the database network, so the pack actually builds. Auth = the shared
// SIDECAR_SECRET Bearer (the slicer also accepts a user JWT for browser callers).
async function kickPipeline(
  sb: ReturnType<typeof createClient>,
  jobId: string,
): Promise<{ via: string; request_id?: number; has_secret: boolean; error?: string }> {
  // Auth with the SERVICE-ROLE key, not SIDECAR_SECRET. The slicer accepts the
  // service-role key (it's the SAME value on Vercel + Supabase), whereas
  // SIDECAR_SECRET drifted out of sync between the two platforms and 401'd every
  // server-to-server kick. Fall back to SIDECAR_SECRET only if the service key is
  // somehow absent.
  const bearer = SERVICE_KEY || SIDECAR_SECRET;
  try {
    const { data, error } = await sb.rpc("kick_production_slicer", {
      p_job_id: jobId,
      p_url: SIDECAR_URL,
      p_secret: bearer,
    });
    if (error) return { via: "pg_net", has_secret: !!bearer, error: error.message };
    return { via: "pg_net", request_id: Number(data), has_secret: !!bearer };
  } catch (e) {
    return { via: "pg_net", has_secret: !!bearer, error: String((e as Error)?.message || e) };
  }
}
