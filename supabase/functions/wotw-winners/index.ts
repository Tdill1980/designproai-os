/**
 * wotw-winners — public, read-only feed of Wrap of the Week winners.
 *
 * Powers the winners carousel in the WPW × RestyleProAI Wrap Calculator embed
 * that lives on weprintwraps.com. CORS-open GET so the WordPress page can fetch
 * it cross-origin. Reads with the service role and returns only active winners
 * with public-safe fields (no internal columns).
 *
 * GET  /wotw-winners            → { winners: [...] }
 * (POST is also accepted so it works with supabase.functions.invoke.)
 *
 * verify_jwt = false (registered in config.toml) — this is public data.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Inlined (kept dependency-free so it deploys as a single file). Mirrors
// ../_shared/cors.ts.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("wotw_winners")
      .select("id, handle, vehicle, blurb, image_url, link_url, week_label, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) throw error;

    return new Response(JSON.stringify({ winners: data ?? [] }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        // Small cache so the WP page stays snappy without going stale for long.
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    console.error("[wotw-winners] error:", err);
    return new Response(JSON.stringify({ winners: [], error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
