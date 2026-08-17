// ──────────────────────────────────────────────────────────────────────
// wpw-analytics-proxy
//
// Server-side proxy to WPW's analytics-dashboard edge function on the
// external Supabase project (lqxnwskrrshythrydzcs). Holds the
// WPW_ANALYTICS_KEY shared secret in RestylePro's edge function env so
// it never touches the browser.
//
// Why a proxy:
//   - The shared secret can't ship in client JS — anyone with DevTools
//     could read the WPW data via that key.
//   - JWT-required (verify_jwt = true): only authenticated RestylePro
//     users can hit this. The dashboard hook calls it with the user's
//     session. We don't gate by tenant here; the hook is responsible
//     for only firing this for WPW tenants.
//   - Returns the upstream JSON unchanged so the hook can map directly
//     into existing dashboard card shapes.
//
// Request:
//   GET /wpw-analytics-proxy?range=30&shopSlug=wpw
// Response:
//   200 — upstream body verbatim
//   401 — missing/bad RestylePro session
//   500 — upstream call failed (with truncated upstream message)
//   502 — upstream returned non-2xx
// ──────────────────────────────────────────────────────────────────────

import { corsHeaders } from "../_shared/cors.ts";

const WPW_BASE = "https://lqxnwskrrshythrydzcs.supabase.co/functions/v1/analytics-dashboard";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return json(405, { ok: false, error: "method not allowed" });

  const key = Deno.env.get("WPW_ANALYTICS_KEY");
  if (!key) {
    console.error("[wpw-analytics-proxy] WPW_ANALYTICS_KEY not configured");
    return json(500, { ok: false, error: "proxy not configured" });
  }

  const url = new URL(req.url);
  const range = url.searchParams.get("range") || "30";
  const shopSlug = url.searchParams.get("shopSlug") || "wpw";
  const upstream = `${WPW_BASE}?range=${encodeURIComponent(range)}&shopSlug=${encodeURIComponent(shopSlug)}`;

  try {
    const res = await fetch(upstream, {
      method: "GET",
      headers: { "x-rp-key": key, "Accept": "application/json" },
    });

    const body = await res.text();
    if (!res.ok) {
      console.warn(`[wpw-analytics-proxy] upstream ${res.status}: ${body.slice(0, 200)}`);
      return new Response(body || JSON.stringify({ ok: false, error: `upstream ${res.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
      },
    });
  } catch (err) {
    console.error("[wpw-analytics-proxy] fetch failed:", (err as Error)?.message);
    return json(500, { ok: false, error: "upstream fetch failed" });
  }
});
