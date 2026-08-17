/**
 * parse-kick — start the footage parser NOW, instead of waiting for cron.
 *
 * Owner, 2026-08-05: "My entire Marketing Suite in RestyleProAI only works
 * from Claude Code! I need an operating system."
 *
 * That was literally true, and this is why. Seven surfaces queue
 * `video_parse_jobs` — Asset Library, BrandCast, Video Studio, Script Studio,
 * Creator, the drive-sync function — and every one of them inserts a row and
 * then waits for the `parse-media` GitHub Actions cron. Nothing in the product
 * ever STARTED the work.
 *
 * GitHub throttles scheduled workflows. `parse-media` asks for every 10
 * minutes; measured across its last 29 scheduled runs it fired every 58
 * minutes at the median and went 196 minutes at worst. So footage a human
 * uploaded sat for an hour or three, and the only thing that reliably made it
 * move was a person or an agent manually dispatching the workflow.
 *
 * The renderer already had this: `video-render` fires a `render-video`
 * repository_dispatch the moment it enqueues. The parser had NO caller at all.
 * This is that missing half.
 *
 * ── IT IS HONEST ABOUT BEING UNCONFIGURED ──────────────────────────────────
 * The instant trigger needs GH_DISPATCH_TOKEN. If it is missing this returns
 * `{ ok: true, kicked: false, reason: "no_dispatch_token" }` — NOT a silent
 * success. A kick that quietly does nothing would leave the product exactly as
 * it is now while looking wired, which is the failure mode this whole day was
 * about.
 *
 * Secrets (Supabase): GH_DISPATCH_TOKEN?, GH_DISPATCH_REPO?
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = Deno.env.get("GH_DISPATCH_TOKEN");
  const repo = Deno.env.get("GH_DISPATCH_REPO") || "Tdill1980/restylepro-os";

  // Say so plainly. The scheduled workflow still drains the queue eventually,
  // so this is not an error — but the caller needs to be able to TELL the
  // difference between "started now" and "queued for whenever cron shows up".
  if (!token) {
    return json({
      ok: true,
      kicked: false,
      reason: "no_dispatch_token",
      detail:
        "GH_DISPATCH_TOKEN is not set, so nothing can start the parser on demand. " +
        "The parse-media schedule will still drain the queue, but GitHub throttles it " +
        "to roughly an hour and sometimes three.",
    });
  }

  let jobId: string | null = null;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    jobId = body?.job_id ? String(body.job_id) : null;
  } catch { /* a kick with no body is fine — it drains the whole queue */ }

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "parse-kick",
      },
      body: JSON.stringify({
        event_type: "parse-media",
        client_payload: jobId ? { job_id: jobId } : {},
      }),
    });

    // 204 is the documented success for repository_dispatch.
    if (res.status === 204) return json({ ok: true, kicked: true, jobId });

    const detail = await res.text().catch(() => "");
    return json({
      ok: true,
      kicked: false,
      reason: `github_${res.status}`,
      detail: detail.slice(0, 300),
    });
  } catch (e) {
    // Never fail the caller's upload over a kick — the row is already queued
    // and the schedule remains the fallback.
    return json({
      ok: true,
      kicked: false,
      reason: "dispatch_failed",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});
