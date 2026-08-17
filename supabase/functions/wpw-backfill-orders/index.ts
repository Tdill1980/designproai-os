/**
 * wpw-backfill-orders — windowed historical import into wpw_orders
 *
 * wpw-sync-orders always syncs from *today* backwards and hits the edge
 * worker's resource limit past ~30 days, so months-old gaps (e.g. the
 * Feb–June 2026 stale-dashboard window) can't be healed with it. This
 * function takes an explicit after/before date window and processes ONE
 * PAGE AT A TIME (fetch → upsert orders → upsert items → next page), so
 * memory stays flat no matter how big the window is.
 *
 * Same normalization and tables as wpw-sync-orders (wpw_orders +
 * wpw_order_items, upsert on id). No quote matching, no emails, no
 * side effects beyond the upserts. Idempotent — safe to re-run.
 *
 * Request (POST):
 *   { after: "2026-02-01", before?: "2026-03-01", per_page?: 100, max_pages?: 10 }
 * Response:
 *   { ok, window, pages, orders_fetched, orders_upserted, items_upserted,
 *     more: boolean }   // more=true → call again with the same window and
 *                       // page offset via "start_page"
 *
 * Backfill a long gap month by month:
 *   {"after":"2026-02-01","before":"2026-03-01"} → then March, April, …
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  extractTracking,
  WooLineItem,
  WooOrder,
  wooFetch,
  wooOrderPayUrl,
} from "../_shared/woo-client.ts";

const ORDER_UPSERT_CHUNK = 50;

function createServiceClient() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

function normalizeOrder(o: WooOrder): Record<string, unknown> {
  const tracking = extractTracking(o);
  return {
    id: o.id,
    woo_customer_id: o.customer_id,
    order_number: o.number,
    status: o.status,
    currency: o.currency,
    total: parseFloat(o.total || "0") || 0,
    subtotal: o.subtotal ? parseFloat(o.subtotal) : null,
    shipping_total: parseFloat(o.shipping_total || "0") || 0,
    tax_total: parseFloat(o.total_tax || "0") || 0,
    payment_method: o.payment_method_title || o.payment_method || null,
    date_created: o.date_created_gmt ? `${o.date_created_gmt}Z` : o.date_created || null,
    date_modified: o.date_modified_gmt ? `${o.date_modified_gmt}Z` : o.date_modified || null,
    date_completed: o.date_completed || null,
    customer_email: o.billing?.email || null,
    customer_name:
      [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(" ") || null,
    billing: o.billing || null,
    shipping: o.shipping || null,
    tracking_number: tracking.number,
    tracking_carrier: tracking.carrier,
    tracking_url: tracking.url,
    order_key: o.order_key || null,
    pay_url: wooOrderPayUrl(o),
    customer_note: typeof (o as any).customer_note === "string" && (o as any).customer_note.trim().length > 0
      ? String((o as any).customer_note).slice(0, 4000)
      : null,
    raw: null,
    fetched_at: new Date().toISOString(),
  };
}

function normalizeLineItems(orderId: number, items: WooLineItem[]) {
  return items.map((it) => ({
    id: it.id,
    order_id: orderId,
    product_id: it.product_id || null,
    variation_id: it.variation_id || null,
    name: it.name || null,
    sku: it.sku || null,
    quantity: it.quantity,
    subtotal: parseFloat(it.subtotal || "0") || 0,
    total: parseFloat(it.total || "0") || 0,
    meta: it.meta_data || null,
    image_url: it.image?.src || null,
  }));
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const after = String(body.after || "");
    const before = String(body.before || "");
    if (!DATE_RE.test(after)) {
      return json(400, { ok: false, error: 'Pass "after" as YYYY-MM-DD (start of the window to backfill).' });
    }
    if (before && !DATE_RE.test(before)) {
      return json(400, { ok: false, error: '"before" must be YYYY-MM-DD.' });
    }
    const perPage = Math.min(Number(body.per_page) || 100, 100);
    const maxPages = Math.min(Number(body.max_pages) || 10, 20);
    const startPage = Math.max(Number(body.start_page) || 1, 1);

    const sb = createServiceClient();

    let ordersFetched = 0, ordersUpserted = 0, itemsUpserted = 0, pages = 0;
    let more = false;

    for (let page = startPage; page < startPage + maxPages; page++) {
      const beforeParam = before ? `&before=${before}T00:00:00` : "";
      const batch = await wooFetch<WooOrder[]>(
        `/orders?per_page=${perPage}&page=${page}&after=${after}T00:00:00${beforeParam}&orderby=date&order=asc`,
      );
      pages++;
      if (!Array.isArray(batch) || batch.length === 0) break;

      // WPW order numbers start with "3" — same filter as wpw-sync-orders.
      const orders = batch.filter((o) => String(o.number || "").startsWith("3"));
      ordersFetched += orders.length;

      // Orders — chunked upsert, page-local so memory stays flat.
      const rows = orders.map(normalizeOrder);
      for (let i = 0; i < rows.length; i += ORDER_UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + ORDER_UPSERT_CHUNK);
        const { error } = await sb.from("wpw_orders").upsert(chunk, { onConflict: "id" });
        if (error) console.warn(`[wpw-backfill] order chunk failed:`, error.message);
        else ordersUpserted += chunk.length;
      }

      // Items — same page-local pattern.
      const items = orders.flatMap((o) => normalizeLineItems(o.id, o.line_items || []));
      for (let i = 0; i < items.length; i += 200) {
        const chunk = items.slice(i, i + 200);
        const { error } = await sb.from("wpw_order_items").upsert(chunk, { onConflict: "id" });
        if (error) console.warn(`[wpw-backfill] item chunk failed:`, error.message);
        else itemsUpserted += chunk.length;
      }

      console.log(`[wpw-backfill] page ${page}: ${orders.length} WPW orders (${batch.length} raw)`);

      if (batch.length < perPage) { more = false; break; }
      more = true; // full page — there may be another
    }

    return json(200, {
      ok: true,
      window: { after, before: before || "(open)" },
      pages,
      orders_fetched: ordersFetched,
      orders_upserted: ordersUpserted,
      items_upserted: itemsUpserted,
      more,
      next: more
        ? `Call again with {"after":"${after}"${before ? `,"before":"${before}"` : ""},"start_page":${startPage + pages}} to continue.`
        : undefined,
    });
  } catch (error) {
    console.error("[wpw-backfill] error:", error);
    return json(500, { ok: false, error: (error as Error).message });
  }
});
