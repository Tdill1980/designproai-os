// deploy: designpro-flat-first-flow — flat-first orchestrator (clean background + editable overlay layers)
/**
 * designpro-flat-first-flow — the flat-first flow for NEW designs, layered.
 *
 * Orchestrates (does NOT modify any locked render file — it only CALLS them):
 *   1. designpro-flat-panels → clean, full-bleed FLAT panels with NO branding
 *      baked in (the BACKGROUND layer / single source of truth).
 *   2. Keeps the logo + any text as SEPARATE transparent OVERLAY layers
 *      (LayerLiftIQ-editable) — never baked into the flats. This is the committed
 *      Artboard-First / Option B model: clean wrap + ONE integrated, movable logo,
 *      so branding stays consistent across proofs/panels and slices cleanly.
 *   3. Persists background_url + overlay_pngs[] to design_generation_assets so the
 *      UI consumes the editable layers (and the per-side flats into qc_side_panels).
 *
 * The 3D customer proof is rendered FROM these layers downstream by the EXISTING
 * (locked) render pipeline — this function does not reimplement it.
 *
 * POST /designpro-flat-first-flow
 * {
 *   prompt: string,                              [required]
 *   vehicleMake?, vehicleModel?, vehicleYear?,
 *   sides?: string[], sideSize?, roofSize?,
 *   referenceImageUrl?: string,                  // customer style reference (honored)
 *   logoUrl?: string,                            // kept as an overlay, NOT baked
 *   overlayUrls?: Array<{url:string;kind?:string;role?:string;box?:number[]}>,
 *   generationId?: string,                       // design_generation_assets key
 *   jobId?: string, userId?: string,
 *   persist?: boolean,
 * }
 * → { success, flats:[...], layers:{ background_url, overlay_pngs:[...] } }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const prompt: string = (body.prompt || "").trim();
    if (!prompt) return json({ error: "prompt (design brief) is required" }, 400);

    const SUPA = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userId: string = body.userId || "designpro";
    const jobId: string = body.jobId || `flatflow-${Date.now()}`;

    // ── 1. Generate the clean FLAT panels = the BACKGROUND layer ──────────────
    // Critically: do NOT pass the logo here — the flats must stay branding-free so
    // the logo can live as a separate editable overlay (Option B). The reference
    // IS passed so the design honors the customer's example.
    const flatResp = await fetch(`${SUPA}/functions/v1/designpro-flat-panels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        prompt,
        vehicleMake: body.vehicleMake, vehicleModel: body.vehicleModel, vehicleYear: body.vehicleYear,
        sides: body.sides, sideSize: body.sideSize, roofSize: body.roofSize,
        referenceImageUrl: body.referenceImageUrl,
        // logo intentionally omitted — kept as an overlay layer, never baked in.
        userId, jobId,
        persist: body.persist === true && !!body.jobId, // also writes flats into qc_side_panels
      }),
      signal: AbortSignal.timeout(280_000),
    });
    const flatJson = await flatResp.json().catch(() => ({}));
    if (!flatResp.ok || !flatJson?.success || !Array.isArray(flatJson.panels) || !flatJson.panels.length) {
      return json({ success: false, error: `flat-panel generation failed: ${flatJson?.error || flatResp.status}` }, 502);
    }
    const flats = flatJson.panels as Array<{ side: string; label: string; url: string; widthInches: number; heightInches: number; source?: string; derivedFrom?: string }>;

    // BACKGROUND layer = the driver flat (primary/hero); all per-side flats returned too.
    const driver = flats.find((p) => p.side === "driver_side") || flats[0];
    const background_url = driver.url;

    // ── 2. Assemble the editable OVERLAY layers (logo + any text) ─────────────
    // These are kept SEPARATE (transparent, movable) — never composited into the
    // flats. The UI (LayerLiftIQ) consumes overlay_pngs[] so the customer can
    // fine-tune placement before it flows to the proof/panels.
    const overlay_pngs: Array<{ url: string; kind: string; role: string; editable: boolean; box?: number[] }> = [];
    if (body.logoUrl) overlay_pngs.push({ url: body.logoUrl, kind: "logo", role: "logo", editable: true });
    if (Array.isArray(body.overlayUrls)) {
      for (const o of body.overlayUrls) {
        if (o?.url) overlay_pngs.push({ url: o.url, kind: o.kind || "text", role: o.role || "text", editable: true, box: o.box });
      }
    }

    // ── 3. Persist background + overlays to the asset vault (editable layers) ──
    if (body.persist === true && body.generationId) {
      try {
        const sb = createClient(SUPA, serviceKey);
        // Per-side flats also live in layer_layout (valid jsonb col) for retrieval;
        // background_url + overlay_pngs are the canonical editable-layer fields the
        // UI consumes. (Per-side flats additionally persist to qc_side_panels via
        // the generator's persist flag above.)
        const row: any = {
          generation_id: body.generationId,
          background_url,
          overlay_pngs,
          layer_layout: { flat_panels: flats.map((p) => ({ side: p.side, url: p.url, widthInches: p.widthInches, heightInches: p.heightInches })) },
          source: "flat-first",
          updated_at: new Date().toISOString(),
        };
        const { data: existing } = await sb.from("design_generation_assets").select("generation_id").eq("generation_id", body.generationId).maybeSingle();
        if (existing) await sb.from("design_generation_assets").update(row).eq("generation_id", body.generationId);
        else await sb.from("design_generation_assets").insert(row);
      } catch (e: any) {
        console.warn(`[FLAT-FIRST-FLOW] persist skipped: ${e?.message || e}`);
      }
    }

    return json({
      success: true,
      flats,
      layers: { background_url, overlay_pngs },
      sizeSource: flatJson.sizeSource,
      note: "Background is branding-free; logo/text are separate editable overlays. Render the 3D proof FROM these via the existing pipeline.",
    });
  } catch (e: any) {
    console.error("[FLAT-FIRST-FLOW] error:", e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
