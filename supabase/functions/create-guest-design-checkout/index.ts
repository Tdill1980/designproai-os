/**
 * create-guest-design-checkout — Guest single-design purchase.
 *
 * PUBLIC function (verify_jwt = false). No account required.
 *
 * Flow:
 *   1. Visitor lands on /try-design (possibly with ?ref=troy and/or
 *      ?promo=TROY10 attribution).
 *   2. Enters email, clicks "Continue to checkout".
 *   3. Client POSTs { email, ref?, promo? } to this function.
 *   4. We resolve the optional promo against `affiliate_coupons` and
 *      create a Stripe Checkout session in payment mode with
 *      metadata.purchase_type = 'guest_single_design' + ref + coupon.
 *   5. stripe-webhook handles checkout.session.completed:
 *        - createUser if no auth row exists for that email
 *        - grant 1 design token via add_user_tokens RPC
 *        - generateLink({ type: 'magiclink' }) and email it via Resend
 *
 * Pairs with /try-design and /wpw/:rep. Designed for WPW reps to drop
 * a link into a customer email: "Here's a custom design, code
 * TROY10 takes 10% off — results in your inbox, no signup."
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UNIT_AMOUNT_CENTS = 25000; // $250.00 — priced to throttle demand to design-team capacity.

const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const safeRef = (s: string | undefined) =>
  typeof s === "string" ? s.trim().toLowerCase().slice(0, 40).replace(/[^a-z0-9_-]/g, "") : "";
const safePromo = (s: string | undefined) =>
  typeof s === "string" ? s.trim().toUpperCase().slice(0, 40).replace(/[^A-Z0-9_-]/g, "") : "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    const name = String(body?.name || "").trim().slice(0, 80);
    const phone = String(body?.phone || "").trim().slice(0, 40);
    const marketingOptIn = body?.marketing_opt_in === true || body?.marketing_opt_in === "true";
    const ref = safeRef(body?.ref);
    const promo = safePromo(body?.promo);

    if (!email || !isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: "A valid email is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("Stripe is not configured");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    const origin = req.headers.get("origin") || "https://restyleproai.com";

    // Resolve optional promo against affiliate_coupons. Mirrors the
    // logic in create-checkout: looks up the active coupon row, lazily
    // creates the Stripe coupon on first use, and stamps attribution
    // metadata so stripe-webhook can credit the affiliate.
    let discounts: Array<{ coupon: string }> = [];
    let affiliateMeta: Record<string, string> = {};

    if (promo) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        const supa = createClient(supabaseUrl, serviceKey);
        const { data: couponRow } = await supa
          .from("affiliate_coupons")
          .select(
            "id, code, discount_percent, commission_percent, affiliate_name, stripe_coupon_id, active, max_uses, current_uses, expires_at",
          )
          .eq("code", promo)
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
                duration: pct >= 100 ? "once" : "once",
                name: `Affiliate: ${row.affiliate_name} (${row.code})`,
                metadata: { affiliate_coupon_id: row.id, affiliate_code: row.code },
              });
              stripeCouponId = stripeCoupon.id;
              await supa
                .from("affiliate_coupons")
                .update({ stripe_coupon_id: stripeCouponId } as any)
                .eq("id", row.id);
            }
            discounts = [{ coupon: stripeCouponId }];
            affiliateMeta = {
              affiliate_coupon_id: row.id,
              affiliate_code: row.code,
              affiliate_name: row.affiliate_name,
              commission_percent: String(row.commission_percent || 20),
            };
            await supa
              .from("affiliate_coupons")
              .update({ current_uses: (row.current_uses || 0) + 1 } as any)
              .eq("id", row.id);
          } else {
            console.log("[guest_single_design] promo not applied — expired or maxed:", promo);
          }
        } else {
          console.log("[guest_single_design] unknown or inactive promo:", promo);
        }
      }
    }

    // Reuse existing Stripe customer if one exists for this email.
    const existing = await stripe.customers.list({ email, limit: 1 });
    const customerId = existing.data[0]?.id;

    const cancelQs = [
      "canceled=1",
      ref ? `ref=${ref}` : "",
      promo ? `promo=${promo}` : "",
    ].filter(Boolean).join("&");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      customer_email: customerId ? undefined : email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: UNIT_AMOUNT_CENTS,
            product_data: {
              name: "RestyleProAI — Custom Wrap Design",
              description:
                "One custom full vehicle wrap design with 3 revisions, 7 view angles, and a 3D proof. Magic-link delivery to your inbox. No subscription, no recurring charges.",
            },
          },
          quantity: 1,
        },
      ],
      // If we resolved an affiliate coupon, apply it directly. Otherwise
      // let the customer paste a Stripe promotion code in checkout.
      ...(discounts.length > 0
        ? { discounts }
        : { allow_promotion_codes: true }),
      success_url: `${origin}/try-design/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/try-design?${cancelQs}`,
      metadata: {
        purchase_type: "guest_single_design",
        guest_email: email,
        guest_name: name,
        guest_phone: phone,
        marketing_opt_in: String(marketingOptIn),
        ref: ref || "",
        unit_amount: String(UNIT_AMOUNT_CENTS),
        ...affiliateMeta,
      },
    });

    // Log the pending sale so the admin dashboard + notification have the
    // buyer's name/phone (those live only on the Stripe session, not in our
    // DB). The token-grant trigger flips paid=true on payment and emails the
    // shop owner. Non-fatal: a logging failure never blocks checkout.
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        const supa = createClient(supabaseUrl, serviceKey);
        await supa.from("guest_design_sales").upsert(
          {
            stripe_session_id: session.id,
            email,
            name: name || null,
            phone: phone || null,
            marketing_opt_in: marketingOptIn,
            ref: ref || null,
            amount_cents: UNIT_AMOUNT_CENTS,
          },
          { onConflict: "stripe_session_id", ignoreDuplicates: true },
        );
      }
    } catch (logErr) {
      console.error("[create-guest-design-checkout] sales log failed (non-fatal):", logErr);
    }

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[create-guest-design-checkout]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
