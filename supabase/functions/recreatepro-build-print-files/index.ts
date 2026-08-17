/**
 * recreatepro-build-print-files — auto print files for every RecreatePro run.
 *
 * Fired (fire-and-forget) by ProductionFlow the moment a recreation lands in
 * color_visualizations. Runs the same pixel-exact print-file chain as the
 * Production Files "Build Print Files" button, fully server-side:
 *
 *   1. Resolve the design source for the visualization:
 *      admin_notes.layer_background_url (clean background layer, preferred)
 *      else custom_design_url (the customer's uploaded reference).
 *   2. For each side, call panel-artboard-generator (step:"panel",
 *      pixelExact:true) — true vehicle dims + 2" bleed. Trailer-aware:
 *      trailers get van box dims and no HOOD/ROOF panels.
 *   3. Register a panel_artboard_jobs row + per-side assets so the files
 *      appear on /admin/production-files automatically.
 *
 * Idempotent: the job id IS the visualization id, so a duplicate fire skips
 * (pass force:true to rebuild — existing assets are replaced).
 *
 * Responds 202 immediately; the chain runs via EdgeRuntime.waitUntil so the
 * customer's recreation flow is never blocked by panel generation.
 *
 * config.toml:  [functions.recreatepro-build-print-files]  verify_jwt = false
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { visualization_id, force, userId, designSourceUrl } = await req.json().catch(() => ({}));
  if (!visualization_id) return json({ error: "visualization_id required" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: viz } = await db
    .from("color_visualizations")
    .select("id, color_name, custom_design_url, admin_notes, vehicle_year, vehicle_make, vehicle_model, finish_type")
    .eq("id", visualization_id)
    .maybeSingle();
  if (!viz) return json({ error: "Visualization not found" }, 404);

  let layers: any = {};
  try { layers = typeof viz.admin_notes === "string" ? JSON.parse(viz.admin_notes) : (viz.admin_notes || {}); } catch { layers = {}; }
  // Source priority for the flat panel cut, HIGHEST fidelity first:
  //   1. designSourceUrl (explicit override — the hi-res text-free artboardClean
  //      the 2D proof emits; a true flat sheet, not a low-res phone upload).
  //   2. admin_notes.artboard_clean_url / layer_background_url (persisted clean bg).
  //   3. custom_design_url (the customer's original upload — last resort).
  // The old default (custom_design_url) meant panels were cut from whatever the
  // customer uploaded — often a low-res 3D wrap photo — so they were never the
  // hi-res flat file the shop needs. Prefer the clean artboard when we have one.
  const explicitSource = (typeof designSourceUrl === "string" && designSourceUrl.trim()) ? designSourceUrl.trim() : null;
  const rawDesignUrl: string | null =
    explicitSource || layers.artboard_clean_url || layers.layer_background_url || viz.custom_design_url || null;
  if (!rawDesignUrl) return json({ ok: true, skipped: true, reason: "no_design_source" });
  // 546 rule: a full-res customer upload OOMs the pixel-exact cutter when it
  // decodes the source per side. Feed a 3000px storage-transform copy
  // (original format) instead — same trick the production chain uses.
  const designUrl = rawDesignUrl.includes("/storage/v1/object/")
    ? rawDesignUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") + (rawDesignUrl.includes("?") ? "&" : "?") + "width=3000&height=3000&resize=contain&format=origin"
    : rawDesignUrl;

  // Job id = visualization id → idempotency claim. A duplicate fire sees the
  // existing job and skips; force=true replaces the assets and rebuilds.
  const jobId = String(viz.id);
  const { data: prior } = await db.from("panel_artboard_jobs").select("id, status").eq("id", jobId).maybeSingle();
  if (prior && !force) return json({ ok: true, skipped: true, reason: "already_built", job_id: jobId });

  const vehicleYear = String(viz.vehicle_year || "");
  const vehicleMake = viz.vehicle_make || "";
  const vehicleModel = viz.vehicle_model || "";
  const finish = viz.finish_type || "gloss";
  const designName = viz.color_name || "RecreatePro design";

  // Trailers: no hood/roof panels, and "van" box dims (220×80 sides) are the
  // closest default to an enclosed cargo trailer — "truck" assumes a hood.
  const isTrailer = /trailer/i.test(`${vehicleMake} ${vehicleModel} ${layers.vehicle_type || ""}`);
  const bodyType = isTrailer ? "van" : "truck";
  const sides = isTrailer
    ? ["DRIVER SIDE", "PASSENGER SIDE", "FRONT", "REAR"]
    : ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR"];

  // Claim the slot BEFORE the long run so a duplicate fire can't start a
  // second build while this one is in flight. The page only shows jobs that
  // have assets, so a processing claim stays hidden until panels exist.
  await db.from("panel_artboard_jobs").upsert({
    id: jobId, user_id: userId || null, status: "processing", mode: "recreate",
    prompt: `${designName} — RecreatePro → print files (auto, pixel-exact)`,
    vehicle_year: vehicleYear, vehicle_make: vehicleMake, vehicle_model: vehicleModel,
    body_type: bodyType, finish, bleed_inches: 2,
  }, { onConflict: "id" });
  if (force) await db.from("panel_artboard_assets").delete().eq("job_id", jobId);

  const run = async () => {
    // 546s are transient worker OOMs in panel-artboard-generator — retry each
    // side up to 3 times (fresh worker usually lands it) and register every
    // panel the moment it succeeds, so a mid-chain failure never throws away
    // the sides that already cut.
    const cutSide = async (side: string): Promise<any | null> => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/panel-artboard-generator`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
              apikey: serviceKey,
            },
            body: JSON.stringify({
              step: "panel", pixelExact: true, designUrl, side,
              vehicleMake, vehicleModel, vehicleYear,
              bodyType, finish, bleedInches: 2, jobId,
            }),
            signal: AbortSignal.timeout(120_000),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data?.success) return data;
          console.warn(`[recreate-print-files] ${side} attempt ${attempt}: ${data?.error || `HTTP ${res.status}`}`);
        } catch (e: any) {
          console.warn(`[recreate-print-files] ${side} attempt ${attempt} threw: ${e?.message || e}`);
        }
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 3000));
      }
      return null;
    };

    const outputs: any[] = [];
    const failed: string[] = [];
    for (let i = 0; i < sides.length; i++) {
      const o = await cutSide(sides[i]);
      if (!o) { failed.push(sides[i]); continue; }
      outputs.push(o);
      await db.from("panel_artboard_assets").insert({
        job_id: jobId, kind: "panel", label: `${o.side} — PIXEL-EXACT`, panel_label: o.side,
        width_inches: o.printWidthInches, height_inches: o.printHeightInches,
        storage_path: o.path, url: o.url, sort_order: i + 1,
      });
    }

    await db.from("panel_artboard_jobs").update({
      status: failed.length === 0 ? "complete" : (outputs.length ? "complete" : "failed"),
      error: failed.length ? `sides failed after retries: ${failed.join(", ")}` : null,
      dims_source: outputs[0]?.dimsSource || "",
      panels: outputs[0]?.panels || [], completed_at: new Date().toISOString(),
    }).eq("id", jobId);
    console.log(`[recreate-print-files] viz ${viz.id} → job ${jobId}: ${outputs.length}/${sides.length} panels${failed.length ? ` (failed: ${failed.join(", ")})` : ""}`);
  };

  (globalThis as any).EdgeRuntime?.waitUntil ? (globalThis as any).EdgeRuntime.waitUntil(run()) : await run();
  return json({ ok: true, status: "running", job_id: jobId }, 202);
});
