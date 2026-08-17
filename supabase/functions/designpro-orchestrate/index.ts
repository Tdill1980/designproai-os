/**
 * designpro-orchestrate — THE backend tool: artboard-first → 3D for the customer
 *
 * One call. The customer UI sends the prompt + vehicle; this function runs the
 * whole sequence SERVER-SIDE and returns the 3D for the customer to see:
 *
 *   1. designpro-artboard   → flat panel artboard FIRST (backend source of truth)
 *   2. designpro-recreate-3d → 3D views recreated FROM the artboard (RecreatePro)
 *   3. persist master_artboard_url + render_urls + hero on the generation
 *
 * The orchestration logic lives HERE in the backend, not in the frontend. The
 * customer UI calls this and renders `renderUrls`; the artboard is kept for the
 * admin/production side. Forwards the caller's user JWT (design-panel-ai-generate
 * requires a real user session).
 *
 * POST /designpro-orchestrate
 * {
 *   "designDescription": "Summit Realty Group ...", "companyName": "...",
 *   "vehicleYear": "2022", "vehicleMake": "Cadillac", "vehicleModel": "Escalade ESV",
 *   "bodyType": "suv", "finish": "Gloss",
 *   "panelDims": {...}, "styleReferenceUrl": "...", "logoUrl": "...",
 *   "nonStandard": false
 * }
 * → { success, artboardUrl, generationId, driverUrl, renderUrls, failed }
 *
 * NOTE: synchronous — artboard (~90s) + 7 renders (~100s). If this bumps the
 * edge wall-clock limit, the next step is an async job row + polling; the
 * sub-functions already persist, so a poller can read partial progress.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function callFn(slug: string, payload: Record<string, unknown>, authHeader: string, timeoutMs: number): Promise<any> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader || `Bearer ${ANON_KEY}`,
      "apikey": ANON_KEY,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const body = await req.json();

    const designDescription: string = (body.designDescription || body.prompt || "").trim();
    const companyName: string = body.companyName || "";
    const vehicleYear: string = String(body.vehicleYear || body.year || "2024");
    const vehicleMake: string = (body.vehicleMake || body.make || "").trim();
    const vehicleModel: string = (body.vehicleModel || body.model || "").trim();
    const bodyType: string = body.bodyType || "suv";
    const finish: string = body.finish || "Gloss";
    const nonStandard: boolean = !!body.nonStandard;

    if (!designDescription) return json({ success: false, error: "designDescription (or prompt) is required" }, 400);
    if (!vehicleMake || !vehicleModel) return json({ success: false, error: "vehicleMake and vehicleModel are required" }, 400);
    if (!authHeader) return json({ success: false, error: "Authorization (user session) required for the 3D step" }, 401);

    console.log(`[ORCHESTRATE] ${vehicleYear} ${vehicleMake} ${vehicleModel} — artboard-first → 3D`);

    // ── STEP 1: artboard FIRST ──
    const ab = await callFn("designpro-artboard", {
      designDescription, companyName, vehicleYear, vehicleMake, vehicleModel,
      bodyType, finish,
      ...(body.panelDims ? { panelDims: body.panelDims } : {}),
      ...(body.styleReferenceUrl ? { styleReferenceUrl: body.styleReferenceUrl } : {}),
      ...(body.logoUrl ? { logoUrl: body.logoUrl } : {}),
    }, authHeader, 170_000);

    if (!ab.ok || !ab.data?.artboardUrl) {
      return json({ success: false, stage: "artboard", error: ab.data?.error || `artboard failed (HTTP ${ab.status})` }, 502);
    }
    const artboardUrl: string = ab.data.artboardUrl;
    console.log(`[ORCHESTRATE] artboard ready`);

    // ── STEP 2: 3D from the artboard (RecreatePro recipe) ──
    const r3d = await callFn("designpro-recreate-3d", {
      artboardUrl, designDescription, vehicleYear, vehicleMake, vehicleModel, finish, nonStandard,
    }, authHeader, 280_000);

    if (!r3d.ok || !r3d.data?.success) {
      // Artboard succeeded; surface it even if 3D failed so it's not lost.
      return json({
        success: false, stage: "recreate-3d",
        error: r3d.data?.error || `3D recreate failed (HTTP ${r3d.status})`,
        artboardUrl,
      }, 502);
    }

    const generationId: string | null = r3d.data.generationId || null;
    const renderUrls: Record<string, string> = r3d.data.renderUrls || {};
    const driverUrl: string = r3d.data.driverUrl || renderUrls.side || "";
    const failed: string[] = r3d.data.failed || [];

    // ── STEP 3: persist the artboard as source-of-truth on the generation ──
    if (generationId) {
      const { error: persistErr } = await sb()
        .from("designiq_generations")
        .update({ master_artboard_url: artboardUrl } as any)
        .eq("id", generationId);
      if (persistErr) console.warn(`[ORCHESTRATE] persist master_artboard_url failed: ${persistErr.message}`);
    }

    console.log(`[ORCHESTRATE] done — ${Object.keys(renderUrls).length} views, gen ${generationId || "n/a"}`);
    return json({ success: true, artboardUrl, generationId, driverUrl, renderUrls, failed });
  } catch (err: any) {
    console.error("[ORCHESTRATE] error:", err?.message || err);
    return json({ success: false, error: err?.message || "orchestrate error" }, 500);
  }
});
