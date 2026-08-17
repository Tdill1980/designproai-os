/**
 * video-render — enqueue + dispatch for RestylePro's self-hosted ffmpeg
 * video renderer. Ported from the proven WrapCommandAI render-reel-ffmpeg
 * (2026-07) as part of the RestylePro-native video pipeline
 * (docs/VIDEO-AUTOCREATE-PILOT-KICKOFF.md). No Creatomate, no AI video-gen.
 *
 * Request:  { blueprint, music_url?, captions?, brand?, source_ref? }
 * Response: { ok: true, final_url, thumbnail_url } (finished within the wait)
 *         | { ok: true, final_url: null, status: 'processing', render_job_id }
 *         | { ok: false, error }
 *
 * How it works:
 *   1. Enqueue a video_render_jobs row (status 'queued').
 *   2. Best-effort instant kick: repository_dispatch to the render-videos
 *      GitHub Actions workflow (GH_DISPATCH_TOKEN/GH_DISPATCH_REPO secrets);
 *      the workflow's 5-minute schedule is the reliable fallback. A hosted
 *      worker (RENDER_WORKER_URL/RENDER_WORKER_KEY) is also supported.
 *   3. Bounded wait (~100s) polling the job row; longer renders return
 *      status 'processing' and the caller polls video_render_jobs.
 *
 * Secrets (Supabase): GH_DISPATCH_TOKEN?, GH_DISPATCH_REPO?
 *                     RENDER_WORKER_URL?, RENDER_WORKER_KEY?, RENDER_BUCKET?
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WAIT_MS = 100_000;   // bounded synchronous wait
const POLL_MS = 3_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const { blueprint, music_url, captions, brand, source_ref } = body ?? {};
    if (!blueprint?.scenes?.length) return json({ ok: false, error: "Blueprint has no scenes" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const bucket = Deno.env.get("RENDER_BUCKET") || "wrap-files";

    // 1. enqueue
    const { data: jobRow, error: insErr } = await supabase
      .from("video_render_jobs")
      .insert({
        blueprint,
        music_url: music_url ?? null,
        captions: captions ?? [],
        brand: brand ?? "weprintwraps",
        source_ref: source_ref ?? null,
        bucket,
        status: "queued",
      })
      .select("id")
      .single();
    if (insErr) return json({ ok: false, error: `enqueue failed: ${insErr.message}` }, 500);
    const renderJobId = jobRow.id;

    // 2. best-effort instant kick — GitHub Actions repository_dispatch.
    const ghToken = Deno.env.get("GH_DISPATCH_TOKEN");
    const ghRepo = Deno.env.get("GH_DISPATCH_REPO") || "Tdill1980/restylepro-os";
    if (ghToken && ghRepo) {
      try {
        await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${ghToken}`,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "video-render",
          },
          body: JSON.stringify({ event_type: "render-video", client_payload: { job_id: renderJobId } }),
        });
      } catch (_) {
        // the scheduled workflow will still pick it up
      }
    }

    const workerUrl = Deno.env.get("RENDER_WORKER_URL");
    if (workerUrl) {
      try {
        await fetch(`${workerUrl.replace(/\/$/, "")}/kick`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-worker-key": Deno.env.get("RENDER_WORKER_KEY") || "",
          },
          body: JSON.stringify({ job_id: renderJobId }),
        });
      } catch (_) {
        // worker polls anyway
      }
    }

    // 3. bounded wait
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const { data: j } = await supabase
        .from("video_render_jobs")
        .select("status, final_url, thumbnail_url, error")
        .eq("id", renderJobId)
        .maybeSingle();
      if (!j) continue;
      if (j.status === "complete") {
        return json({ ok: true, final_url: j.final_url, thumbnail_url: j.thumbnail_url, render_job_id: renderJobId });
      }
      if (j.status === "failed") {
        return json({ ok: false, error: j.error || "Render failed", render_job_id: renderJobId }, 500);
      }
    }

    // still rendering — the worker finishes async; callers poll video_render_jobs
    return json({
      ok: true,
      final_url: null,
      status: "processing",
      render_job_id: renderJobId,
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
