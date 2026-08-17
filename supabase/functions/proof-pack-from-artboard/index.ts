// ============================================================================
// proof-pack-from-artboard
//
// BRIDGE: panel-batch "Proof → Artboard" result → a real print-ready
// Production Pack (true-size CMYK TIFF panels + 2" bleed + QC certificate + ZIP
// → WrapBox), produced by the SAME canonical deterministic slicer the paid
// Order-Pack CTA uses (api/process-production-pack on Vercel).
//
// Why a dedicated bridge: the slicer is built around a DesignPro studio design
// (designiq_generations + a clean LayerLift Layer-1 master it crops into zones).
// The Proof → Artboard flow instead yields independent, already-flattened
// per-side panels at known REAL dimensions — there is no single master to crop.
// So we hand the slicer those per-side panels via `customer_inputs.side_panels`;
// the slicer's per-side branch renders each one straight to true print size.
//
// Input:  {
//   side_panels: [{ side, label, url, widthInches, heightInches }],  (required)
//   vehicleMake?, vehicleModel?, vehicleYear?, vehicleName?,
//   finish?, artboardUrl?, totalSqFt?, dimsVerified?, user_id?
// }
// Output: { ok, job_id, order_number, slicer }
//
// verify_jwt = false (service-role internal orchestration; user JWT forwarded).
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Canonical deterministic slicer (Vercel sidecar on the production domain). Pinned
// to the www host — the restylepro-os.vercel.app preview is DEPLOYMENT_NOT_FOUND.
// Overridable via VERCEL_SIDECAR_URL.
const SIDECAR_URL =
  (Deno.env.get("VERCEL_SIDECAR_URL") || "").trim() ||
  "https://www.restyleproai.com/api/process-production-pack";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // ── Normalize + validate the per-side panels ──────────────────────────────
  const sidePanels = Array.isArray(body.side_panels) ? body.side_panels : [];
  const cleanSides = sidePanels
    .map((sp: any) => ({
      side: sp?.side || sp?.label || null,
      label: sp?.label || sp?.side || "Panel",
      url: sp?.url || sp?.panelUrl || null,
      widthInches: Number(sp?.widthInches) || null,
      heightInches: Number(sp?.heightInches) || null,
    }))
    .filter((sp: any) => !!sp.url);

  if (cleanSides.length === 0) {
    return json({ error: "side_panels[] with at least one { url } is required" }, 400);
  }

  // ── Auth — require a signed-in user; resolve their id for the job row ──────
  const authHeader = req.headers.get("authorization");
  let userId: string | null = body.user_id || null;
  if (!userId && authHeader) {
    try {
      const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await authClient.auth.getUser();
      userId = user?.id || null;
    } catch {
      /* fall through to the 401 below */
    }
  }
  if (!userId) return json({ error: "Authentication required" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const vehicleName =
    (body.vehicleName || "").trim() ||
    [body.vehicleYear, body.vehicleMake, body.vehicleModel].filter(Boolean).join(" ").trim() ||
    "Vehicle Wrap";

  try {
    // Create the production-pack job. order_number is assigned by the DB trigger.
    // Everything the slicer needs for the per-side path lives in customer_inputs:
    //   side_panels      → the faithful flat panels + real inches
    //   proof_2d_url     → the dimensioned artboard (lands in the ZIP as the 2D proof)
    //   design_name/dims → manifest + QC certificate context
    const { data: job, error: jobErr } = await sb
      .from("panelizer_jobs")
      .insert({
        user_id: userId,
        approved_render_url: body.artboardUrl || cleanSides[0].url,
        vehicle_year: body.vehicleYear ?? null,
        vehicle_make: body.vehicleMake ?? null,
        vehicle_model: body.vehicleModel ?? null,
        job_type: "production_pack",
        status: "queued",
        started_at: new Date().toISOString(),
        customer_inputs: {
          source: "proof_artboard_bridge",
          side_panels: cleanSides,
          proof_2d_url: body.artboardUrl || null,
          design_name: vehicleName,
          finish: body.finish || "Gloss",
          total_sqft: body.totalSqFt ?? null,
          dims_verified: !!body.dimsVerified,
        },
      })
      .select("id, order_number")
      .single();

    if (jobErr || !job) {
      return json({ error: `job insert: ${jobErr?.message || "unknown"}` }, 500);
    }

    // Kick the slicer THROUGH pg_net (kick_production_slicer) — edge functions
    // cannot reach the Vercel custom domain directly (DEPLOYMENT_NOT_FOUND). The
    // slicer authenticates the service-role key and reads side_panels off the job.
    let slicer: Record<string, unknown> = { via: "pg_net", request_id: null };
    try {
      const { data, error } = await sb.rpc("kick_production_slicer", {
        p_job_id: (job as any).id,
        p_url: SIDECAR_URL,
        p_secret: SERVICE_KEY,
      });
      slicer = error
        ? { via: "pg_net", error: error.message }
        : { via: "pg_net", request_id: Number(data) };
    } catch (e) {
      slicer = { via: "pg_net", error: String((e as Error)?.message || e) };
    }

    return json({
      ok: true,
      job_id: (job as any).id,
      order_number: (job as any).order_number,
      panel_count: cleanSides.length,
      slicer,
    });
  } catch (err) {
    console.error("[proof-pack-from-artboard] error:", err);
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
