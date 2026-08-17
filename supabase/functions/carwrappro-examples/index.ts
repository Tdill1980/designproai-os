/**
 * carwrappro-examples — public, read-only example feed for the CarWrapPro™
 * landing page (/carwrappro).
 *
 * Returns recent REAL production output from the design assets data
 * (designiq_generations): the 3D hero render + the 2D master artboard per
 * generation, with vehicle info only (no customer PII). Service role is used
 * because the rows are RLS-protected and the landing page is public.
 *
 * config.toml:  [functions.carwrappro-examples]  verify_jwt = false
 *
 * GET/POST → { success, examples: [{ vehicle, heroUrl, artboardUrl, designName }] }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await sb
      .from("designiq_generations")
      .select("id, vehicle_year, vehicle_make, vehicle_model, design_name, hero_render_url, master_artboard_url, created_at")
      .not("hero_render_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw error;

    // Prefer generations that have BOTH the 3D hero and the 2D artboard, and
    // de-dupe by vehicle so the strip shows variety.
    const seen = new Set<string>();
    const examples: { vehicle: string; heroUrl: string; artboardUrl: string | null; designName: string | null }[] = [];
    const rows = (data || []).sort((a: any, b: any) => Number(!!b.master_artboard_url) - Number(!!a.master_artboard_url));
    for (const r of rows) {
      const vehicle = `${r.vehicle_year || ""} ${r.vehicle_make || ""} ${r.vehicle_model || ""}`.replace(/\s+/g, " ").trim();
      const key = vehicle.toLowerCase() || r.id;
      if (seen.has(key)) continue;
      seen.add(key);
      examples.push({ vehicle, heroUrl: r.hero_render_url, artboardUrl: r.master_artboard_url || null, designName: r.design_name || null });
      if (examples.length >= 8) break;
    }

    return new Response(JSON.stringify({ success: true, examples }), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || "examples failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
