/**
 * backfill-design-proofs — ONE-TIME use
 *
 * Creates draft proof_approvals rows for existing WPW orders in
 * design-complete / print-production status that don't already have proofs.
 *
 * Safe: INSERT-only into proof_approvals. Never touches WPW/WooCommerce.
 * Idempotent: skips orders that already have a proof (checks metadata).
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { mintProofToken } from "../_shared/proof-tokens.ts";

function createServiceClient() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

Deno.serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createServiceClient();

    // Get all design-complete + print-production orders
    const { data: orders, error: ordersErr } = await sb
      .from("wpw_orders")
      .select("id, order_number, status, customer_name, customer_email, total, date_created")
      .in("status", ["design-complete", "print-production"])
      .order("date_created", { ascending: false });

    if (ordersErr) throw ordersErr;
    if (!orders || orders.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No design orders found", created: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check which orders already have proofs (by woo_order_id in metadata)
    const { data: existingProofs } = await sb
      .from("proof_approvals")
      .select("metadata")
      .limit(1000);

    const existingOrderIds = new Set(
      (existingProofs || [])
        .map((p: any) => p.metadata?.woo_order_id)
        .filter(Boolean)
    );

    // Get a shop_id to assign proofs to — use the first user with admin/tester role
    const { data: adminUser } = await sb
      .from("user_subscriptions")
      .select("user_id")
      .in("role", ["admin", "tester"])
      .limit(1)
      .maybeSingle();

    // Fallback: get any user
    let shopId = adminUser?.user_id;
    if (!shopId) {
      const { data: anyUser } = await sb
        .from("user_subscriptions")
        .select("user_id")
        .limit(1)
        .maybeSingle();
      shopId = anyUser?.user_id;
    }

    if (!shopId) {
      return new Response(JSON.stringify({ ok: false, error: "No user found to assign proofs to" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let created = 0;
    let skipped = 0;
    const results: any[] = [];

    for (const order of orders) {
      if (existingOrderIds.has(order.id)) {
        skipped++;
        results.push({ order_number: order.order_number, action: "skipped (already exists)" });
        continue;
      }

      try {
        const viewToken = await mintProofToken("view");
        const manageToken = await mintProofToken("manage");

        const expires = new Date();
        expires.setDate(expires.getDate() + 30); // 30 days for backfill

        const { error: insertErr } = await sb
          .from("proof_approvals")
          .insert({
            shop_id: shopId,
            view_token: viewToken,
            manage_token: manageToken,
            customer_email: order.customer_email,
            customer_name: order.customer_name,
            design_name: `WPW Order #${order.order_number}`,
            mode: "sign_only",
            status: "draft",
            expires_at: expires.toISOString(),
            internal_notes: `Backfill from WPW Order #${order.order_number} ($${order.total}) — ${order.status}`,
            metadata: {
              woo_order_id: order.id,
              woo_order_number: order.order_number,
              woo_order_total: order.total,
              woo_order_status: order.status,
              source: "backfill-design-proofs",
            },
          });

        if (insertErr) {
          results.push({ order_number: order.order_number, action: "error", error: insertErr.message });
        } else {
          created++;
          results.push({ order_number: order.order_number, action: "created" });
        }
      } catch (tokenErr) {
        results.push({ order_number: order.order_number, action: "error", error: String(tokenErr) });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      total_orders: orders.length,
      created,
      skipped,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backfill-design-proofs] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
