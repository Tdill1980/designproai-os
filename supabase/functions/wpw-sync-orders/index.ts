/**
 * wpw-sync-orders — Pull WooCommerce orders directly, bypass Cloudflare
 *
 * Calls WooCommerce REST API directly (no webhook needed), upserts orders
 * into wpw_orders, and runs 3-tier quote matching to find conversions.
 *
 * Call from admin dashboard "Sync WPW Orders" button or on a cron.
 * No Cloudflare, no WordPress plugin, no Cristian required.
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
    raw: null, // Don't store raw JSON — causes OOM on bulk sync
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

async function matchQuoteToOrder(
  sb: ReturnType<typeof createServiceClient>,
  order: Record<string, unknown>,
  wooOrder: WooOrder,
): Promise<{ quoteId: string; matchType: string } | null> {
  // Tier 1: Metadata match — _wpw_quote_number
  const quoteNumberMeta = (wooOrder.meta_data || []).find(
    (m: any) => m.key === "_wpw_quote_number"
  );
  if (quoteNumberMeta?.value) {
    const { data } = await sb
      .from("customer_quotes")
      .select("id")
      .eq("quote_number", quoteNumberMeta.value)
      .maybeSingle();
    if (data) return { quoteId: data.id, matchType: "metadata" };
  }

  // Tier 2: Email match
  const email = order.customer_email as string;
  if (email) {
    const { data } = await sb
      .from("customer_quotes")
      .select("id")
      .eq("customer_email", email)
      .neq("status", "converted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return { quoteId: data.id, matchType: "email" };
  }

  // Tier 3: Name match
  const name = order.customer_name as string;
  if (name) {
    const { data } = await sb
      .from("customer_quotes")
      .select("id")
      .ilike("customer_name", `%${name}%`)
      .neq("status", "converted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return { quoteId: data.id, matchType: "name" };
  }

  return null;
}

// Hard cap: pages × per_page must fit inside the edge worker time budget.
// Interactive 5×100 = 500 orders covers ~6 weeks at WPW's current pace
// (~9/day). Background 10×100 = 1000 covers ~3.5 months. Chunked
// upserts (50/chunk) keep this well under the 30s wall clock.
const MAX_PAGES_INTERACTIVE = 5;
const MAX_PAGES_BACKGROUND = 10;
const ORDER_UPSERT_CHUNK = 50;
const MATCH_CONCURRENCY = 5;

async function runQuoteMatching(
  sb: ReturnType<typeof createServiceClient>,
  pairs: { wooOrder: WooOrder; orderRow: Record<string, unknown> }[],
) {
  let matched = 0;
  for (let i = 0; i < pairs.length; i += MATCH_CONCURRENCY) {
    const slice = pairs.slice(i, i + MATCH_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async ({ wooOrder, orderRow }) => {
        try {
          const match = await matchQuoteToOrder(sb, orderRow, wooOrder);
          if (!match) return null;
          await sb
            .from("customer_quotes")
            .update({
              status: "converted",
              notes: `WPW Order #${orderRow.order_number} — $${orderRow.total} (match: ${match.matchType})`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", match.quoteId);
          await sb.from("quote_events").insert({
            event_type: "quote_converted_to_order",
            quote_id: match.quoteId,
            product_type: "WPW",
            source: "wpw-sync-orders",
            metadata: {
              woo_order_id: wooOrder.id,
              woo_order_number: orderRow.order_number,
              woo_order_total: orderRow.total,
              woo_billing_email: orderRow.customer_email,
              woo_billing_name: orderRow.customer_name,
              match_type: match.matchType,
              sync_mode: "direct_api",
            },
          });
          console.log(`[wpw-sync:bg] CONVERTED Quote ${match.quoteId} ← Order #${orderRow.order_number} (${match.matchType})`);
          return match;
        } catch (e) {
          console.warn(`[wpw-sync:bg] match failed for order ${wooOrder.id}:`, e instanceof Error ? e.message : e);
          return null;
        }
      }),
    );
    matched += results.filter(Boolean).length;
  }
  return matched;
}

async function runItemUpserts(
  sb: ReturnType<typeof createServiceClient>,
  orders: WooOrder[],
) {
  const allItems = orders.flatMap((o) => normalizeLineItems(o.id, o.line_items || []));
  if (allItems.length === 0) return;
  // Single bulk upsert keyed by item id — much cheaper than per-order
  // delete+upsert and avoids the wall-clock blowup on big syncs.
  for (let i = 0; i < allItems.length; i += 200) {
    const chunk = allItems.slice(i, i + 200);
    const { error } = await sb
      .from("wpw_order_items")
      .upsert(chunk, { onConflict: "id" });
    if (error) {
      console.warn(`[wpw-sync:bg] item upsert chunk failed:`, error.message);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    // Interactive callers (dashboard refresh) should keep daysBack small so
    // the response returns inside the edge worker budget. Cron / bulk
    // imports can pass `background: true` to widen the window.
    const isBackground = body.background === true || body.skip_matching === true;
    const daysBack = Math.min(body.days_back || (isBackground ? 30 : 14), 90);
    const perPage = Math.min(body.per_page || 100, 100);
    const skipMatching = body.skip_matching === true; // bulk import mode
    const maxPages = isBackground ? MAX_PAGES_BACKGROUND : MAX_PAGES_INTERACTIVE;

    const sb = createServiceClient();

    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    const afterDate = since.toISOString().split("T")[0];

    console.log(
      `[wpw-sync] mode=${isBackground ? "background" : "interactive"} ` +
      `daysBack=${daysBack} perPage=${perPage} maxPages=${maxPages} (after ${afterDate})`,
    );

    // Pull every status — WPW uses 20+ custom statuses (`pending`,
    // `add-on`, `waiting-on-email-response`, `shipped`, etc.) that the
    // old filter list left out, so the latest 1–2 orders frequently
    // never made it into the mirror until they advanced into one of
    // the 7 listed statuses. The dashboard already filters by status
    // client-side; carrying every status here means new orders are
    // visible the moment they're placed and full historical lookups
    // are not status-gated.
    const allOrders: WooOrder[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const batch = await wooFetch<WooOrder[]>(
        `/orders?per_page=${perPage}&page=${page}&after=${afterDate}T00:00:00&orderby=date&order=desc`,
      );
      allOrders.push(...batch);
      console.log(`[wpw-sync] Page ${page}: ${batch.length} orders`);
      if (batch.length < perPage) break;
    }

    // WPW order numbers start with "3" — filter out test/other orders
    const orders = allOrders.filter((o) => String(o.number || "").startsWith("3"));

    console.log(`[wpw-sync] Fetched ${allOrders.length}, ${orders.length} are WPW orders`);

    // Upsert orders in chunks — single round trip per chunk instead of
    // one per order. This is what makes the dashboard refresh fast.
    const orderRows = orders.map(normalizeOrder);
    let upserted = 0;
    for (let i = 0; i < orderRows.length; i += ORDER_UPSERT_CHUNK) {
      const chunk = orderRows.slice(i, i + ORDER_UPSERT_CHUNK);
      const { error } = await sb
        .from("wpw_orders")
        .upsert(chunk, { onConflict: "id" });
      if (error) {
        console.warn(`[wpw-sync] order chunk upsert failed:`, error.message);
        continue;
      }
      upserted += chunk.length;
    }

    // Items + quote matching are deferred to the background so the HTTP
    // response returns immediately. This is what stops the worker from
    // hitting the 546 wall-clock limit on big syncs.
    const pairs = orders.map((wooOrder, idx) => ({ wooOrder, orderRow: orderRows[idx] }));
    const runtime = (globalThis as unknown as {
      EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void };
    }).EdgeRuntime;

    const backgroundWork = (async () => {
      await runItemUpserts(sb, orders);
      if (!skipMatching) {
        const matched = await runQuoteMatching(sb, pairs);
        console.log(`[wpw-sync:bg] matched ${matched} quotes`);
      }
    })().catch((e) => {
      console.error(`[wpw-sync:bg] failed:`, e instanceof Error ? e.message : e);
    });

    if (runtime?.waitUntil) {
      runtime.waitUntil(backgroundWork);
    } else {
      // No background runtime — fall back to awaiting inline (local dev).
      await backgroundWork;
    }

    console.log(`[wpw-sync] Done (sync phase): ${upserted} orders upserted`);

    return new Response(
      JSON.stringify({
        ok: true,
        orders_fetched: orders.length,
        orders_upserted: upserted,
        quotes_converted: 0, // matching runs in background — not known here
        background: !!runtime?.waitUntil,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[wpw-sync] Error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
