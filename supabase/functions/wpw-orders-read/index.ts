// ──────────────────────────────────────────────────────────────────────
// wpw-orders-read
//
// Returns the current authenticated user's WePrintWraps order history.
//
// How it works:
//   1. Resolve the caller's auth.users row from the bearer token.
//   2. Look up their woo_customer_id on user_subscriptions (must exist;
//      it gets set when the user links or signs in with WPW).
//   3. If the cached row in wpw_orders is newer than CACHE_TTL_SECONDS,
//      return the cache.
//   4. Otherwise fetch fresh from Woo REST, upsert into wpw_orders +
//      wpw_order_items, return the hydrated rows.
//
// Part of Phase 1 — WPW PrintPro Gateway.
// See docs/OPERATION-EXPAND-THE-WRAP-INDUSTRY.md
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  extractTracking,
  WooLineItem,
  WooOrder,
  wooFetch,
  wooOrderPayUrl,
} from "../_shared/woo-client.ts";

const CACHE_TTL_SECONDS = 60;

// Columns returned to the client. Deliberately EXCLUDES `raw` — the full Woo
// order JSON, duplicated in the normalized columns and unused by the frontend.
// Selecting `*` pulled `raw` for up to 200 orders at once, which blew the edge
// worker's memory and crashed with a 546 (the "ApprovePro edge fail" the team
// saw). Keeping the payload lean fixes the crash.
const ORDER_SELECT =
  "id,woo_customer_id,user_id,order_number,status,currency,total,subtotal," +
  "shipping_total,tax_total,payment_method,date_created,date_modified," +
  "date_completed,customer_email,customer_name,billing,shipping,tracking_number," +
  "tracking_carrier,tracking_url,order_key,pay_url,fetched_at,created_at," +
  "updated_at,customer_note, wpw_order_items(*)";

// Lean projection for the STAFF LIST (every WPW order, up to 200 rows).
// Deliberately EXCLUDES the line-item `meta` blob — TM Extra Product
// Options stores its entire builder config there, totalling ~30 MB across
// 200 orders. Serializing that into the edge response blew the worker's
// memory and returned 546 (the empty /orders rail). The list only needs
// summary fields; full meta/billing/shipping is fetched per-order on
// demand via the `orderId` branch below when a row is opened.
const STAFF_LIST_SELECT =
  "id,woo_customer_id,user_id,order_number,status,currency,total,subtotal," +
  "shipping_total,tax_total,payment_method,date_created,date_modified," +
  "date_completed,customer_email,customer_name,tracking_number," +
  "tracking_carrier,tracking_url,order_key,pay_url,fetched_at," +
  "wpw_order_items(id,order_id,product_id,variation_id,name,sku,quantity,subtotal,total,image_url)";

// WPW internal staff — they ARE the shop. They get every WPW design
// order in their queue, regardless of which customer placed it. Mirrors
// approvepro-sync-wpw's WPW_INTERNAL_STAFF set and the frontend
// WPW_INTERNAL_STAFF_ALLOWLIST in src/lib/admin-allowlist.ts.
const WPW_INTERNAL_STAFF = new Set([
  "tdill@restyleproai.com",
  "trish@restyleproai.com",
  "trish@weprintwraps.com",
  "lance@weprintwraps.com",
  "brice@weprintwraps.com",
  "jackson@weprintwraps.com",
  "troy@weprintwraps.com",
  "wyatt-cto@weprintwraps.com",
  "amanda@restyleproai.com",
  "amandakinz1111@gmail.com",
  "carley@restyleproai.com",
]);

function createServiceClient() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

async function authedUserFromRequest(
  req: Request,
): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await sb.auth.getUser();
  if (!data.user?.id) return null;
  return { id: data.user.id, email: data.user.email || null };
}

function normalizeOrder(
  o: WooOrder,
  userId: string | null,
): Record<string, unknown> {
  const tracking = extractTracking(o);
  return {
    id: o.id,
    woo_customer_id: o.customer_id,
    user_id: userId,
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
    raw: o,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authed = await authedUserFromRequest(req);
    if (!authed) {
      return new Response(JSON.stringify({ ok: false, error: "not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = authed.id;
    const isInternalStaff = WPW_INTERNAL_STAFF.has(
      (authed.email || "").toLowerCase(),
    );

    const sb = createServiceClient();

    // Parse query + body once. Supports ?orderId / ?refresh (GET) and
    // { orderId, refresh } (POST via supabase.functions.invoke).
    const reqUrl = new URL(req.url);
    const reqBody = req.method === "POST"
      ? await req.clone().json().catch(() => ({})) as {
        orderId?: number | string;
        refresh?: boolean;
        search?: string;
      }
      : {};
    const detailIdRaw = reqUrl.searchParams.get("orderId") ?? reqBody.orderId;
    const detailId = detailIdRaw != null && `${detailIdRaw}`.trim() !== ""
      ? Number(detailIdRaw)
      : null;
    const forceRefresh = reqUrl.searchParams.get("refresh") === "1" ||
      reqBody.refresh === true;
    // Staff search term (email / order number / customer name). Runs
    // server-side so it spans EVERY order, not just the loaded page.
    const searchRaw = reqUrl.searchParams.get("search") ?? reqBody.search;
    const search = typeof searchRaw === "string" ? searchRaw.trim() : "";

    // Find the linked Woo customer for this user. Internal staff (Lance,
    // Troy, Carley, etc.) ARE the shop — they don't have a personal
    // woo_customer_id, they need every WPW design order in their queue.
    const { data: subRow, error: subErr } = await sb
      .from("user_subscriptions")
      .select("woo_customer_id")
      .eq("user_id", userId)
      .not("woo_customer_id", "is", null)
      .maybeSingle();

    if (subErr) throw subErr;

    if (!subRow?.woo_customer_id && !isInternalStaff) {
      return new Response(
        JSON.stringify({
          ok: true,
          linked: false,
          orders: [],
          message:
            "No WePrintWraps account linked to this user. Use 'Sign in with WePrintWraps' to link.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const wooCustomerId: number | null = subRow?.woo_customer_id
      ? (subRow.woo_customer_id as number)
      : null;

    // ── Single-order detail fetch (modal) ──────────────────────────────
    // Returns ONE full order incl. meta / billing / shipping. A single
    // order is tiny, so it's safe from the 200-order memory blowup that
    // forced the lean staff list. Internal staff can read any order;
    // everyone else is scoped to their own linked Woo customer. Goes
    // through the service role, so non-admin shop staff (Lance, Troy,
    // Brice) work too — the wpw_orders RLS only lets DB admins read rows
    // a direct client query would return zero.
    if (detailId != null && Number.isFinite(detailId)) {
      let q = sb.from("wpw_orders").select(ORDER_SELECT).eq("id", detailId);
      if (!isInternalStaff) q = q.eq("woo_customer_id", wooCustomerId);
      const { data: one, error: oneErr } = await q.maybeSingle();
      if (oneErr) throw oneErr;
      return new Response(
        JSON.stringify({ ok: true, linked: true, order: one || null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Internal staff path — they ARE the shop, so they see EVERY WPW
    // order with a single click, no linking or filtering required. We
    // skip the live Woo refresh here because approvepro-sync-wpw already
    // kicks wpw-sync-orders on every load, so the cache is fresh enough.
    //
    // The lean projection keeps the full list small (~620 kB for the
    // current ~800 orders), so we can ship the whole history at once
    // (cap 5000 as a runaway guard). When a search term is present we
    // filter server-side across ALL orders by email / order number /
    // customer name, so older orders past any page are still findable.
    if (isInternalStaff) {
      let q = sb
        .from("wpw_orders")
        .select(STAFF_LIST_SELECT)
        .order("date_created", { ascending: false });

      if (search) {
        // Neutralize PostgREST `.or()` delimiters so the term can't break
        // out of the filter expression.
        const safe = search.replace(/[,()*]/g, " ").trim();
        if (safe) {
          q = q.or(
            `customer_email.ilike.%${safe}%,` +
              `order_number.ilike.%${safe}%,` +
              `customer_name.ilike.%${safe}%`,
          );
        }
        q = q.limit(500);
      } else {
        q = q.limit(5000);
      }

      const { data: cached } = await q;

      return new Response(
        JSON.stringify({
          ok: true,
          linked: true,
          internalStaff: true,
          fromCache: true,
          orders: cached || [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check cache freshness
    const { data: newest } = await sb
      .from("wpw_orders")
      .select("fetched_at")
      .eq("woo_customer_id", wooCustomerId)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const cacheAgeSec = newest?.fetched_at
      ? (Date.now() - new Date(newest.fetched_at).getTime()) / 1000
      : Infinity;

    // forceRefresh (?refresh=1 / { refresh: true }) was parsed once at the
    // top alongside the request body.
    if (!forceRefresh && cacheAgeSec < CACHE_TTL_SECONDS) {
      const { data: cached } = await sb
        .from("wpw_orders")
        .select(ORDER_SELECT)
        .eq("woo_customer_id", wooCustomerId)
        .order("date_created", { ascending: false });

      return new Response(
        JSON.stringify({
          ok: true,
          linked: true,
          fromCache: true,
          orders: cached || [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch fresh from Woo — paginate so we capture the customer's full
    // history (orders going back to 2017+). Customer-scoped via
    // ?customer=ID so the response is bounded to this one customer's
    // orders, not system-wide. Cap at 20 pages × 100 = 2000 orders to
    // avoid runaway memory; way more than any single customer needs.
    const wooOrders: WooOrder[] = [];
    {
      const PER_PAGE = 100;
      const MAX_PAGES = 20;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const batch = await wooFetch<WooOrder[]>(
          `/orders?customer=${wooCustomerId}&per_page=${PER_PAGE}&page=${page}&orderby=date&order=desc`,
        );
        if (!Array.isArray(batch) || batch.length === 0) break;
        wooOrders.push(...batch);
        if (batch.length < PER_PAGE) break;
      }
    }

    if (wooOrders.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, linked: true, fromCache: false, orders: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const orderRows = wooOrders.map((o) => normalizeOrder(o, userId));
    const itemRows = wooOrders.flatMap((o) =>
      normalizeLineItems(o.id, o.line_items || []),
    );

    const { error: upOrdersErr } = await sb
      .from("wpw_orders")
      .upsert(orderRows, { onConflict: "id" });
    if (upOrdersErr) console.error("[wpw-orders-read] order upsert error", upOrdersErr);

    if (itemRows.length > 0) {
      const { error: upItemsErr } = await sb
        .from("wpw_order_items")
        .upsert(itemRows, { onConflict: "id" });
      if (upItemsErr) console.error("[wpw-orders-read] item upsert error", upItemsErr);
    }

    const { data: hydrated } = await sb
      .from("wpw_orders")
      .select(ORDER_SELECT)
      .eq("woo_customer_id", wooCustomerId)
      .order("date_created", { ascending: false });

    return new Response(
      JSON.stringify({
        ok: true,
        linked: true,
        fromCache: false,
        orders: hydrated || [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[wpw-orders-read] error", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
