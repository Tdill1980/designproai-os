// backfill-2d-proofs — ONE-TIME admin backfill.
//
// The PR #3587 "composer-first" regression overwrote stored flat_proof_url values
// with a 3D-render montage (the compose-2d-proof stacker, fed the 3D studio views).
// The code fix stops future corruption, but already-overwritten jobs keep their
// baked 3D pixels until the proof is regenerated. This re-runs generate-2d-proof
// (the flat orthographic painter) for affected jobs so their stored flat proof is
// restored. generate-2d-proof self-persists flat_proof_url to BOTH
// designiq_generations and color_visualizations.admin_notes.
//
// SAFETY:
//   • dryRun defaults to TRUE — returns the candidate list, spends nothing.
//   • A real run (dryRun:false) requires adminKey === SUPABASE_SERVICE_ROLE_KEY.
//   • Processed sequentially with a small default limit (each call costs a Gemini
//     image gen). Re-run with an advancing `sinceIso` / higher `limit` to continue.
//
// POST body:
//   { dryRun?: boolean=true, limit?: number=25,
//     sinceIso?: string="2026-07-23T00:00:00Z",   // PR #3587 regression window start
//     modeTypes?: string[]=["designpanelpro"],     // scope to DesignPro by default
//     adminKey?: string }                           // required when dryRun:false

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const body = await req.json().catch(() => ({}));

    const dryRun = body.dryRun !== false; // default TRUE
    const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 200);
    const sinceIso = typeof body.sinceIso === "string" ? body.sinceIso : "2026-07-23T00:00:00Z";
    const modeTypes: string[] = Array.isArray(body.modeTypes) && body.modeTypes.length
      ? body.modeTypes
      : ["designpanelpro"];

    if (!dryRun && body.adminKey !== SERVICE_ROLE) {
      return json({ error: "adminKey (service role) required for a real (non-dry) run" }, 401);
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Candidate render rows: touched in the regression window, in scope, with views
    // and a canonical designiq back-link. Newest first.
    const { data: rows, error } = await db
      .from("color_visualizations")
      .select("id, vehicle_year, vehicle_make, vehicle_model, finish_type, render_urls, admin_notes, updated_at, mode_type")
      .in("mode_type", modeTypes)
      .gte("updated_at", sinceIso)
      .not("render_urls", "is", null)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) return json({ error: `query failed: ${error.message}` }, 500);

    const candidates: any[] = [];
    for (const r of rows || []) {
      let designiqId: string | null = null;
      try { designiqId = JSON.parse(r.admin_notes || "{}")?.designiq_generation_id || null; } catch { /* not JSON */ }
      const views = (r.render_urls && typeof r.render_urls === "object") ? r.render_urls as Record<string, string> : {};
      const viewCount = Object.values(views).filter(Boolean).length;
      // Need a canonical id to persist to, and at least 2 views to compose a proof.
      if (!designiqId || viewCount < 2) continue;
      candidates.push({ vizId: r.id, designiqId, viewCount, views, row: r });
    }

    if (dryRun) {
      return json({
        dryRun: true,
        sinceIso, modeTypes, limit,
        candidateCount: candidates.length,
        candidates: candidates.map((c) => ({ vizId: c.vizId, designiqId: c.designiqId, views: c.viewCount })),
        note: "No proofs regenerated. Re-send with { dryRun:false, adminKey:<service role> } to restore.",
      });
    }

    // Real run — regenerate the flat proof sequentially (each is a Gemini call).
    const results: any[] = [];
    for (const c of candidates) {
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/generate-2d-proof`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE}` },
          body: JSON.stringify({
            allViewUrls: c.views,
            vehicleYear: String(c.row.vehicle_year || ""),
            vehicleMake: c.row.vehicle_make || "",
            vehicleModel: c.row.vehicle_model || "",
            designName: "Design",
            finish: c.row.finish_type || "Gloss",
            designiqGenerationId: c.designiqId,
          }),
        });
        const j = await resp.json().catch(() => ({}));
        const proofUrl = j?.proofUrl || j?.url || null;
        results.push({ designiqId: c.designiqId, ok: resp.ok && !!proofUrl, status: resp.status, proofUrl });
      } catch (e) {
        results.push({ designiqId: c.designiqId, ok: false, error: String((e as Error)?.message || e) });
      }
    }

    return json({
      dryRun: false,
      processed: results.length,
      restored: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
      note: "Re-run with the same params to continue past the limit (advance sinceIso as needed).",
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
