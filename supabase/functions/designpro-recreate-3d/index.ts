/**
 * designpro-recreate-3d — Artboard → 3D views (the RecreatePro recipe)
 *
 * SECOND step of the DesignPanelPro orchestration. Takes the flat artboard
 * produced by designpro-artboard and recreates the full canonical 3D view set
 * FROM it, exactly the way RecreatePro does (proven in ProductionFlow):
 *
 *   1. DRIVER SIDE  — design-panel-ai-generate with the artboard as
 *      visionBoardImages + visionboard_intent "artboard_projection", viewType "side".
 *   2. OTHER VIEWS  — design-panel-ai-generate with originalRenderUrl = driver
 *      render + viewType, cloning the driver hero to each camera angle.
 *
 * Persists render_urls + hero_render_url on the generation so /design-assets and
 * the proofs see every angle. Self-contained, callable directly via curl so the
 * back half can be proven WITHOUT the frontend.
 *
 * POST /designpro-recreate-3d
 * {
 *   "artboardUrl": "https://...",        // REQUIRED — output of designpro-artboard
 *   "designDescription": "Summit Realty Group ...",
 *   "vehicleYear": "2022", "vehicleMake": "Cadillac", "vehicleModel": "Escalade ESV",
 *   "finish": "Gloss",
 *   "nonStandard": false,                // true => skip hood_detail
 *   "generationId": "uuid"               // optional — persists render_urls/hero
 * }
 * → { success, generationId, driverUrl, renderUrls, failed }
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
const RENDER_FN = `${SUPABASE_URL}/functions/v1/design-panel-ai-generate`;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Invoke the locked render function (design-panel-ai-generate) internally.
 * It requires a REAL USER SESSION — so we FORWARD the caller's Authorization
 * JWT (the admin/customer browser session). Service role is NOT a user and is
 * rejected with "Invalid or expired session".
 */
async function callRender(payload: Record<string, unknown>, authHeader: string, timeoutMs = 120_000): Promise<{ renderUrl?: string; generationId?: string; error?: string }> {
  try {
    const resp = await fetch(RENDER_FN, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
        "apikey": ANON_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { error: data?.error || data?.message || `HTTP ${resp.status}` };
    return { renderUrl: data?.renderUrl, generationId: data?.generationId };
  } catch (e: any) {
    return { error: e?.message || "render call failed" };
  }
}

async function renderViewWithRetry(payload: Record<string, unknown>, label: string, authHeader: string): Promise<{ type: string; url: string | null }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await callRender(payload, authHeader);
    if (r.renderUrl) {
      console.log(`[RECREATE3D] ${label} OK (attempt ${attempt})`);
      return { type: label, url: r.renderUrl };
    }
    console.error(`[RECREATE3D] ${label} attempt ${attempt} failed: ${r.error}`);
    if (attempt < 3) await new Promise((res) => setTimeout(res, 3000));
  }
  return { type: label, url: null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Forward the caller's user session JWT to the locked render function.
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ success: false, error: "Authorization (user session) required" }, 401);

    const body = await req.json();
    const artboardUrl: string = body.artboardUrl || "";
    const designDescription: string = (body.designDescription || body.prompt || "").trim();
    const vehicleYear: string = String(body.vehicleYear || body.year || "2024");
    const vehicleMake: string = (body.vehicleMake || body.make || "").trim();
    const vehicleModel: string = (body.vehicleModel || body.model || "").trim();
    const finish: string = body.finish || "Gloss";
    const nonStandard: boolean = !!body.nonStandard;
    const generationId: string = body.generationId || "";

    if (!artboardUrl) return json({ success: false, error: "artboardUrl is required" }, 400);
    if (!vehicleMake || !vehicleModel) return json({ success: false, error: "vehicleMake and vehicleModel are required" }, 400);

    console.log(`[RECREATE3D] ${vehicleYear} ${vehicleMake} ${vehicleModel} — artboard → 3D (RecreatePro recipe)`);

    // ── STEP 1: DRIVER SIDE from the artboard (artboard_projection) ──
    const driver = await callRender({
      prompt: designDescription || "Recreate this wrap design on the vehicle.",
      mode: "restyle",
      finish,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      visionBoardImages: [{ slotLabel: "Master Artboard", storageUrl: artboardUrl }],
      visionboard_intent: "artboard_projection",
      viewType: "side",
    }, authHeader, 150_000);

    if (!driver.renderUrl) {
      console.error(`[RECREATE3D] driver render FAILED: ${driver.error}`);
      return json({ success: false, error: `Driver render failed: ${driver.error}` }, 502);
    }
    const driverUrl = driver.renderUrl;
    const genId = generationId || driver.generationId || "";
    console.log(`[RECREATE3D] driver OK (gen ${genId || "n/a"})`);

    // ── STEP 2: clone the driver hero to every other canonical angle ──
    const viewPrompt = "Clone the attached wrap design from a different camera angle. Match the driver-side design exactly.";
    const viewTypes = nonStandard
      ? ["passenger-side", "front", "rear", "close-up", "roof"]
      : ["passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];

    const results = await Promise.all(
      viewTypes.map((viewType) =>
        renderViewWithRetry({
          prompt: viewPrompt,
          originalRenderUrl: driverUrl,
          vehicleYear,
          vehicleMake,
          vehicleModel,
          finish,
          viewType,
          mode: "restyle",
        }, viewType, authHeader),
      ),
    );

    const renderUrls: Record<string, string> = { side: driverUrl };
    for (const r of results) if (r.url) renderUrls[r.type] = r.url;
    const failed = results.filter((r) => !r.url).map((r) => r.type);
    console.log(`[RECREATE3D] ${Object.keys(renderUrls).length} views ready, ${failed.length} failed${failed.length ? `: ${failed.join(",")}` : ""}`);

    // ── STEP 3: persist render_urls + hero on the generation ──
    if (genId) {
      const { error: persistErr } = await sb()
        .from("designiq_generations")
        .update({ render_urls: renderUrls, hero_render_url: driverUrl } as any)
        .eq("id", genId);
      if (persistErr) console.warn(`[RECREATE3D] persist render_urls failed (non-fatal): ${persistErr.message}`);
      else console.log(`[RECREATE3D] render_urls persisted on ${genId}`);
    }

    return json({
      success: true,
      generationId: genId || null,
      driverUrl,
      renderUrls,
      failed,
    });
  } catch (err: any) {
    console.error("[RECREATE3D] error:", err?.message || err);
    return json({ success: false, error: err?.message || "Recreate-3D error" }, 500);
  }
});
