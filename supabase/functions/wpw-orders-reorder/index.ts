// ──────────────────────────────────────────────────────────────────────
// wpw-orders-reorder
//
// Creates a new pending order in WooCommerce from a prior order's
// line items. Returns the new order id + pay_url so the dashboard can
// open the checkout-pay page directly.
//
// Body:
//   { orderId: number }   — the past Woo order id to clone
//
// Response:
//   { ok: true, order_id, pay_url, number, status }
//
// Part of Phase 1 — WPW PrintPro Gateway.
// See docs/OPERATION-EXPAND-THE-WRAP-INDUSTRY.md
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { WooOrder, wooFetch, wooOrderPayUrl } from "../_shared/woo-client.ts";

function createServiceClient() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

async function authedUserIdFromRequest(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await sb.auth.getUser();
  return data.user?.id || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await authedUserIdFromRequest(req);
    if (!userId) {
      return new Response(JSON.stringify({ ok: false, error: "not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({})) as { orderId?: number };
    const orderId = Number(body.orderId);
    if (!orderId || !Number.isFinite(orderId)) {
      return new Response(JSON.stringify({ ok: false, error: "orderId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createServiceClient();

    // Confirm the caller actually owns this order (RLS-equivalent check)
    const { data: ownedOrder, error: ownErr } = await sb
      .from("wpw_orders")
      .select("id, woo_customer_id, user_id, raw")
      .eq("id", orderId)
      .maybeSingle();

    if (ownErr) throw ownErr;
    if (!ownedOrder || ownedOrder.user_id !== userId) {
      return new Response(JSON.stringify({ ok: false, error: "order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const source = (ownedOrder.raw as WooOrder | null) || null;
    if (!source) {
      return new Response(JSON.stringify({ ok: false, error: "original order has no cached payload; refresh first" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build line-items: reorder only supports passing product_id, variation_id,
    // and quantity. Price / meta get recalculated by Woo.
    const line_items = (source.line_items || [])
      .filter((li) => !!li.product_id)
      .map((li) => ({
        product_id: li.product_id,
        variation_id: li.variation_id || undefined,
        quantity: Number(li.quantity) || 1,
      }));

    if (line_items.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "original order has no eligible line items" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newOrderPayload = {
      customer_id: source.customer_id,
      status: "pending",
      billing: source.billing,
      shipping: source.shipping,
      line_items,
      meta_data: [
        { key: "_restylepro_reorder_from", value: String(orderId) },
        { key: "_restylepro_user_id", value: userId },
      ],
    };

    const created = await wooFetch<WooOrder>("/orders", {
      method: "POST",
      body: JSON.stringify(newOrderPayload),
    });

    return new Response(
      JSON.stringify({
        ok: true,
        order_id: created.id,
        number: created.number,
        status: created.status,
        pay_url: wooOrderPayUrl(created),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[wpw-orders-reorder] error", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
