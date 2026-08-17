/**
 * create-wpw-sub-checkout
 *
 * Pay-first subscription checkout for WePrintWraps partner traffic.
 *
 * Unlike create-checkout (which requires an authenticated RestyleProAI user
 * BEFORE payment — the signup wall that bounces WPW buyers), this endpoint
 * needs NO auth. Stripe collects the email at checkout; the stripe-webhook
 * then provisions the account from the paid email and emails a magic link
 * (mirrors the existing $25 guest-design flow). This is purely additive and
 * does NOT touch the shared /checkout flow that other customers use.
 *
 * Coupon stacking: the WPW partner rate is a separate, cheaper Stripe price
 * (e.g. $300 vs $350), NOT a coupon — so an affiliate percentage coupon can
 * be applied on top. If a coupon code is supplied (or resolved from ?ref=),
 * it's applied as a Stripe discount; otherwise allow_promotion_codes shows a
 * code box on the Stripe page.
 *
 * Usage:
 *   GET  /create-wpw-sub-checkout?priceId=<wpw>&ref=wpw&coupon=CODE  -> 302 to Stripe
 *   POST { priceId, ref?, coupon? }                                  -> { url }
 *
 * Env: STRIPE_SECRET_KEY, plus external-db vars for affiliate_coupons lookup.
 */

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createExternalAnonClient } from "../_shared/external-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// $5 metered overage price added to every subscription (matches create-checkout).
const METERED_PRICE = "price_1SWNl3H1V6OhfCAPas1HJF05";

// Allowlisted WPW partner prices ($50/mo off the public /pricing tiers).
// Any priceId not in this map is rejected — this endpoint only sells the
// WPW partner subscriptions.
const WPW_PRICES: Record<string, string> = {
  "price_1TTTzhH1V6OhfCAP8VEk52tv": "Starter",
  "price_1TTUyvH1V6OhfCAPddCu27xk": "DesignPro Lite",
  "price_1TTTzoH1V6OhfCAPqcDURY6T": "DesignPro Studio",
  "price_1TTTzuH1V6OhfCAP9zEqAlBh": "DesignPro Plus",
};

function sanitizeCode(raw: string): string {
  return (raw || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const isGet = req.method === "GET";

  try {
    let priceId = "";
    let ref = "";
    let couponCode = "";

    if (isGet) {
      priceId = url.searchParams.get("priceId") || "";
      ref = (url.searchParams.get("ref") || "").trim().toLowerCase().slice(0, 40);
      couponCode = sanitizeCode(url.searchParams.get("coupon") || url.searchParams.get("promo") || "");
    } else {
      const body = await req.json().catch(() => ({}));
      priceId = body.priceId || "";
      ref = String(body.ref || "").trim().toLowerCase().slice(0, 40);
      couponCode = sanitizeCode(body.coupon || body.couponCode || body.promo || "");
    }

    const tierLabel = WPW_PRICES[priceId];
    if (!tierLabel) {
      throw new Error("Invalid or unsupported plan.");
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Billing is not configured. Please contact support.");
    }
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    const lineItems: Array<{ price: string; quantity?: number }> = [
      { price: priceId, quantity: 1 },
      { price: METERED_PRICE }, // metered overage — no quantity
    ];

    // Resolve an affiliate coupon if a code was supplied (stacks on top of
    // the already-discounted WPW price). Mirrors create-checkout's logic.
    let discounts: Array<{ coupon: string }> = [];
    let affiliateMeta: Record<string, string> = {};

    if (couponCode) {
      const supabase = createExternalAnonClient();
      const { data: couponRow } = await supabase
        .from("affiliate_coupons")
        .select("id, code, discount_percent, commission_percent, affiliate_name, stripe_coupon_id, active, max_uses, current_uses, expires_at")
        .eq("code", couponCode)
        .eq("active", true)
        .maybeSingle();

      if (couponRow) {
        const row = couponRow as any;
        const isExpired = row.expires_at && new Date(row.expires_at) < new Date();
        const isMaxedOut = row.max_uses && row.current_uses >= row.max_uses;
        if (!isExpired && !isMaxedOut) {
          let stripeCouponId = row.stripe_coupon_id;
          if (!stripeCouponId) {
            const pct = row.discount_percent || 10;
            const stripeCoupon = await stripe.coupons.create({
              percent_off: pct,
              duration: pct >= 100 ? "once" : "forever",
              name: `Affiliate: ${row.affiliate_name} (${row.code})`,
              metadata: { affiliate_coupon_id: row.id, affiliate_code: row.code },
            });
            stripeCouponId = stripeCoupon.id;
            await supabase
              .from("affiliate_coupons")
              .update({ stripe_coupon_id: stripeCouponId } as any)
              .eq("id", row.id);
          }
          discounts = [{ coupon: stripeCouponId }];
          affiliateMeta = {
            affiliate_coupon_id: row.id,
            affiliate_code: row.code,
            affiliate_name: row.affiliate_name,
            commission_percent: String(row.commission_percent || 10),
          };
          await supabase
            .from("affiliate_coupons")
            .update({ current_uses: (row.current_uses || 0) + 1 } as any)
            .eq("id", row.id);
        }
      }
    }

    const origin = "https://www.restyleproai.com";
    const metadata: Record<string, string> = {
      purchase_type: "wpw_subscription",
      wpw_tier: tierLabel,
      wpw_price_id: priceId,
      ref: ref || "wpw",
      ...affiliateMeta,
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: lineItems,
      // No customer/customer_email — in subscription mode Stripe always
      // collects the email and creates the customer itself (customer_creation
      // is payment-mode only). Account is provisioned post-payment by the
      // stripe-webhook from this email.
      ...(discounts.length > 0 ? { discounts } : { allow_promotion_codes: true }),
      payment_method_collection: "always",
      subscription_data: { metadata },
      metadata,
      success_url: `${origin}/welcome?from=wpw&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing?ref=wpw&canceled=true`,
    });

    if (isGet) {
      // Send the buyer straight to Stripe — one hop from the WPW button.
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: session.url || `${origin}/pricing?ref=wpw` },
      });
    }

    return new Response(JSON.stringify({ url: session.url || null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[create-wpw-sub-checkout]", message);
    if (isGet) {
      // Fail soft: bounce back to pricing rather than showing a raw error.
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: "https://www.restyleproai.com/pricing?ref=wpw&error=checkout" },
      });
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
