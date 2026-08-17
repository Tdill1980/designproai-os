/**
 * wpw-orders-freshness-alarm — never let the order dashboard go stale again
 *
 * The WPW order dashboard went months without fresh data because
 * wpw-sync-orders only ran when someone pressed the Sync button. This
 * check emails trish@weprintwraps.com when the newest row in wpw_orders
 * is older than the threshold (default 24h) — i.e. either the store has
 * genuinely had no orders, or (far more likely at ~10 orders/day) the
 * sync has stopped running.
 *
 * Read-only apart from the alert email. Intended for a DAILY cron (which
 * also caps alerts at one per day — no cooldown state needed):
 *
 *   select cron.schedule('wpw-orders-freshness', '0 13 * * *', $$
 *     select net.http_post(
 *       url    := 'https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/wpw-orders-freshness-alarm',
 *       headers:= '{"Content-Type":"application/json"}'::jsonb,
 *       body   := '{}'::jsonb
 *     );
 *   $$);
 *
 * Request (POST, optional): { thresholdHours?: 24 }
 * Response: { ok, stale, lastOrderAt, hoursSinceLastOrder, alerted }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { corsHeaders } from "../_shared/cors.ts";

const NOTIFY_TO = "trish@weprintwraps.com";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* defaults */ }
    const thresholdHours = Math.min(Math.max(Number(body?.thresholdHours) || 24, 1), 168);

    const sb = createClient(
      Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: newest, error } = await sb
      .from("wpw_orders")
      .select("date_created, order_number")
      .order("date_created", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return json(500, { ok: false, error: error.message });

    const lastOrderAt = newest?.date_created || null;
    const hoursSince = lastOrderAt
      ? (Date.now() - new Date(lastOrderAt).getTime()) / 36e5
      : Infinity;
    const stale = hoursSince > thresholdHours;

    let alerted = false;
    if (stale) {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        const hrs = isFinite(hoursSince) ? hoursSince.toFixed(1) : "unknown";
        const resend = new Resend(resendKey);
        const r = await resend.emails.send({
          from: "WPW Order Alerts <noreply@restyleproai.com>",
          to: [NOTIFY_TO],
          subject: `⚠️ No new WPW orders in ${hrs} hours — check the order sync`,
          html: `<div style="font-family:-apple-system,sans-serif;color:#111827;max-width:560px;">
            <h2 style="margin:0 0 8px;">Order feed looks stalled</h2>
            <p>The newest order in the dashboard is <b>#${newest?.order_number || "—"}</b>, dated
            <b>${lastOrderAt ? new Date(lastOrderAt).toLocaleString("en-US") : "never"}</b>
            (${hrs} hours ago). At the store's normal pace (~10 orders/day) that almost
            always means the sync stopped, not the sales.</p>
            <p><b>Check, in order:</b></p>
            <ol>
              <li>WooCommerce admin → Orders — are new orders arriving on the store?</li>
              <li>If yes → run the dashboard's <b>Sync WPW Orders</b> button (or POST to
                  <code>wpw-sync-orders</code>) and confirm the cron job is still scheduled
                  (Supabase → Database → Cron).</li>
              <li>If the sync errors → the WOOCOMMERCE_CONSUMER_KEY/SECRET secrets may have
                  been revoked; regenerate a read-only key in Woo admin.</li>
            </ol>
            <p style="color:#6b7280;font-size:12px;">Sent by wpw-orders-freshness-alarm (daily check, ${thresholdHours}h threshold).</p>
          </div>`,
        });
        alerted = !r.error;
        if (r.error) console.error("[freshness-alarm] email failed:", r.error);
      } else {
        console.warn("[freshness-alarm] RESEND_API_KEY not set — cannot alert");
      }
    }

    return json(200, {
      ok: true,
      stale,
      lastOrderAt,
      hoursSinceLastOrder: isFinite(hoursSince) ? +hoursSince.toFixed(1) : null,
      thresholdHours,
      alerted,
    });
  } catch (error) {
    return json(500, { ok: false, error: (error as Error).message });
  }
});
