/**
 * production-slice-proxy
 *
 * WHY THIS EXISTS: the deterministic slicer lives on Vercel
 * (api/process-production-pack.js) and reads panelizer_jobs with
 * process.env.SUPABASE_SERVICE_ROLE_KEY. That Vercel env value has repeatedly
 * drifted / been wrong (not actually authenticating as service_role), so the
 * slicer 401s (auth) or 404s ("Job not found", RLS returns 0 rows) and NOTHING
 * gets sliced — the recurring "it's not slicing files" root cause.
 *
 * This edge function is a thin server-to-server PROXY: browser/admin callers
 * invoke it (instead of fetching the Vercel route directly), and it forwards the
 * body to the slicer presenting the SUPABASE-side service_role key (correct by
 * construction inside an edge function). The slicer's existing auth "probe" path
 * then verifies that key works and uses it for all DB reads — so the job is found
 * and sliced regardless of the Vercel env drift. This kills the whole env-drift
 * class of failure without needing a Vercel dashboard change.
 *
 * Input:  { job_id, artwork_url?, panels?, allow_raw_render?, dpi?, ... } — passed
 *         straight through to the slicer.
 * Output: the slicer's exact JSON response + status.
 *
 * verify_jwt = false (service-role internal orchestration).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLICER_URL = Deno.env.get("PRODUCTION_SLICER_URL") ||
  "https://www.restyleproai.com/api/process-production-pack";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.job_id && !body.jobId) {
    return new Response(JSON.stringify({ error: "job_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    return new Response(JSON.stringify({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const r = await fetch(SLICER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify(body),
      // The slicer caps itself at 60s; allow headroom for the round trip.
      signal: AbortSignal.timeout(170000),
    });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "slicer call failed: " + String((e as Error)?.message || e) }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
