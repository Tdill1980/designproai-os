/**
 * designpro-separate — Branding layer separation (clean-first / LayerLift)
 *
 * Produces the SEPARATED PNGs for a design:
 *   • background = the CLEAN artboard/design (no logo/text) — passed in
 *   • overlays   = logo + text (company name, phone, tagline) as TRANSPARENT
 *     PNGs via designpro-text-layer-generate (never AI-cut from a flat image,
 *     never AI-redrawn — typed copy rendered clean)
 *
 * Persists background_url + overlay_pngs on design_generation_assets so the
 * DesignPanelPro Admin "Separated Files" tab shows the clean background + the
 * liftable branding layers (the two-board requirement).
 *
 * Forwards the caller's user JWT (designpro-text-layer-generate requires a
 * real user session).
 *
 * POST /designpro-separate
 * {
 *   "generationId": "uuid",            // design_generation_assets.generation_id
 *   "backgroundUrl": "https://...",    // the clean design (designpro-artboard.designUrl)
 *   "companyName": "Forged Fitness Co",
 *   "phone": "(512) 555-3620",
 *   "tagline": "Personal Training · Group Classes",
 *   "website": "forgedfitness.co",
 *   "stylePrompt": "bold athletic red/black"
 * }
 * → { success, background_url, overlay_pngs:[{url,kind,role}] }
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
const TEXT_FN = `${SUPABASE_URL}/functions/v1/designpro-text-layer-generate`;

function sb() { return createClient(SUPABASE_URL, SERVICE_KEY); }
function json(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ success: false, error: "Authorization (user session) required" }, 401);

    const body = await req.json();
    const generationId: string = body.generationId || body.generation_id || "";
    const backgroundUrl: string = body.backgroundUrl || body.background_url || "";
    const companyName: string = (body.companyName || "").trim();
    const phone: string = (body.phone || "").trim();
    const tagline: string = (body.tagline || "").trim();
    const website: string = (body.website || "").trim();
    const stylePrompt: string = (body.stylePrompt || "").slice(0, 500);

    // Build the branding pieces (1–6). Company name rendered as a logo-style
    // wordmark; the rest as clean text.
    const pieces: { kind: "logo" | "text"; text: string; role: string }[] = [];
    if (companyName) pieces.push({ kind: "logo", text: companyName, role: "company name" });
    if (phone) pieces.push({ kind: "text", text: phone, role: "phone" });
    if (website) pieces.push({ kind: "text", text: website, role: "website" });
    if (tagline) pieces.push({ kind: "text", text: tagline, role: "tagline" });
    if (!pieces.length) return json({ success: false, error: "Provide at least companyName/phone/tagline/website" }, 400);

    // Generate transparent branding PNGs (forward the user JWT).
    let overlays: { url: string; kind: string; role: string }[] = [];
    try {
      const resp = await fetch(TEXT_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader, "apikey": ANON_KEY },
        body: JSON.stringify({ companyName, pieces, stylePrompt }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return json({ success: false, stage: "text-layer", error: data?.error || data?.message || `HTTP ${resp.status}` }, 502);
      overlays = (data?.objects || [])
        .filter((o: any) => o?.imageUrl)
        .map((o: any) => ({ url: o.imageUrl, kind: o.kind || "text", role: o.role || o.kind || "branding" }));
    } catch (e: any) {
      return json({ success: false, stage: "text-layer", error: e?.message || "branding generation failed" }, 502);
    }

    if (!overlays.length) return json({ success: false, error: "No branding layers were produced" }, 502);

    // Persist background + overlays on design_generation_assets (what the admin
    // Separated Files tab reads). Upsert by generation_id; never clobber views.
    if (generationId) {
      const { data: existing } = await sb()
        .from("design_generation_assets")
        .select("id, overlay_pngs")
        .eq("generation_id", generationId)
        .order("created_at", { ascending: false })
        .limit(1);
      const row = existing?.[0];
      if (row?.id) {
        await sb().from("design_generation_assets")
          .update({ background_url: backgroundUrl || undefined, overlay_pngs: overlays, overlay_source: "designpro-separate" } as any)
          .eq("id", row.id);
      } else {
        await sb().from("design_generation_assets")
          .insert({ generation_id: generationId, background_url: backgroundUrl || null, overlay_pngs: overlays, iteration_index: 0, is_current: true, overlay_source: "designpro-separate" } as any);
      }
    }

    console.log(`[SEPARATE] ${overlays.length} branding layers for gen ${generationId || "n/a"}`);
    return json({ success: true, generationId: generationId || null, background_url: backgroundUrl || null, overlay_pngs: overlays });
  } catch (err: any) {
    console.error("[SEPARATE] error:", err?.message || err);
    return json({ success: false, error: err?.message || "separate error" }, 500);
  }
});
