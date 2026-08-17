// ============================================================================
// universal-panelizer — deterministic pixel-for-pixel panel → QC queue
//
// Mathematical gateway. Locks the print bounding box (panel W"×H" + all-side
// bleed), records the deterministic transform matrix, and enqueues a
// production_panels row (status 'queued') that the GENIE worker processes into
// a solid, correctly-sized, pixel-accurate rectangular print sheet — NO AI
// regeneration — then flips to 'qc_pending' for ProductionFlow.
//
// Audit trail: every row links to its parent project_id + source render_id.
// Idempotent: re-enqueueing the same (render_id, panel_name) upserts the row.
//
// verify_jwt = false (service-role internal orchestration).
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PanelRequestPayload {
  projectId: string;
  renderId: string;             // = designiq_generations.id (the source render)
  sourceImageUrl?: string;      // optional explicit flat-design URL (skips lookup)
  panelName?: string;           // e.g. "DRIVER SIDE"
  targetWidthInches: number;    // trim/visible width  (e.g. 227)
  targetHeightInches: number;   // trim/visible height (e.g. 76.4)
  bleedInches?: number;         // all-side bleed (default 2)
  fit?: "exact" | "cover" | "fill"; // how the design maps onto the rectangle
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", // service role overrides RLS for pipeline
    );

    const body: PanelRequestPayload = await req.json();
    const {
      projectId, renderId, sourceImageUrl,
      panelName = "FULL WRAP",
      targetWidthInches, targetHeightInches,
      bleedInches = 2,
      fit = "cover",
    } = body;

    if (!projectId || !renderId) throw new Error("Missing parameters: projectId and renderId are required.");
    if (!(targetWidthInches > 0) || !(targetHeightInches > 0)) {
      throw new Error("targetWidthInches and targetHeightInches must be > 0");
    }

    const W_BASE = targetWidthInches;
    const H_BASE = targetHeightInches;
    const BLEED = bleedInches;

    const finalWidth = W_BASE + BLEED * 2;   // e.g. 231"
    const finalHeight = H_BASE + BLEED * 2;  // e.g. 80.4"

    // ── Resolve the FLAT design source ──────────────────────────────
    // The deterministic transform needs the flat design artwork (NOT the
    // on-vehicle render). Prefer an explicit URL; otherwise read the real
    // generation row (flat proof first, then hero/image).
    let source = sourceImageUrl || null;
    if (!source) {
      const { data: gen, error: fetchErr } = await supabaseClient
        .from("designiq_generations")
        .select("flat_proof_url, hero_image_url, image_url, all_view_urls")
        .eq("id", renderId)
        .maybeSingle();
      if (fetchErr) throw new Error(`Source lookup failed: ${fetchErr.message}`);
      source =
        (gen as any)?.flat_proof_url ||
        (gen as any)?.hero_image_url ||
        (gen as any)?.image_url ||
        ((gen as any)?.all_view_urls?.[0]) ||
        null;
    }
    if (!source) {
      throw new Error(`No flat design source found for render ${renderId}. Pass sourceImageUrl explicitly.`);
    }

    const matrix = {
      source_canvas: source,
      engine_mode: "DETERMINISTIC_MATRIX",
      panel_name: panelName,
      fit,                                    // cover = proportionate (no squash); fill = exact stretch
      dimensions: {
        base_width_inches: W_BASE,
        base_height_inches: H_BASE,
        applied_bleed_inches: BLEED,
        final_print_width_inches: finalWidth,
        final_print_height_inches: finalHeight,
      },
      transform_constraints: {
        bypass_geometry_masks: true,          // solid rectangle, zero tire/window cutouts
        preserve_proportions: fit !== "fill", // pixel-accurate, no condensing
        mirror_bleed_edges: true,             // extend design into the bleed to the edge
      },
    };

    // ── Idempotent enqueue (upsert on render_id + panel_name) ───────
    const { data: panelRecord, error: insertErr } = await supabaseClient
      .from("production_panels")
      .upsert(
        {
          project_id: projectId,
          render_id: renderId,
          panel_name: panelName,
          dimensions_summary: `${finalWidth}x${finalHeight}_solid_bleed`,
          mapping_payload: matrix,
          status: "queued",
        },
        { onConflict: "render_id,panel_name" },
      )
      .select()
      .single();

    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({ success: true, panelId: (panelRecord as any).id, payload: matrix }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
