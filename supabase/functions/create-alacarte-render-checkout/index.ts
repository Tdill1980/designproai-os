/**
 * create-alacarte-render-checkout — Phase 8.
 *
 * Creates a Stripe one-time-payment checkout session for a single
 * $25 render. Used by non-subscribers (and subscribers who exhaust
 * their monthly allowance) to keep generating without committing
 * to a tier.
 *
 * Pattern matches create-design-checkout — inline price_data with
 * unit_amount, mode = 'payment'. The render is granted by
 * stripe-webhook on checkout.session.completed when
 * metadata.purchase_type = 'alacarte_render' (it increments
 * user_subscriptions.alacarte_renders_remaining).
 *
 * Defaults to $25 (2500 cents) but accepts an optional `quantity`
 * (clamped 1..50) so a user can buy a small pack in one checkout
 * (5 × $25 = $125) without re-prompting at every gate.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createExternalAnonClient } from "../_shared/external-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UNIT_AMOUNT_CENTS = 2500; // $25.00 per render — locked v1 price.

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const requestedQty = Number(body?.quantity ?? 1);
    const quantity = Math.min(50, Math.max(1, Math.floor(requestedQty || 1)));

    const supabaseClient = createExternalAnonClient();
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("Not authenticated");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("Stripe is not configured");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    // Reuse existing customer if Stripe knows the email.
    const existing = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = existing.data[0]?.id;

    const origin = req.headers.get("origin") || "";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: UNIT_AMOUNT_CENTS,
            product_data: {
              name: quantity === 1
                ? "RestyleProAI — 1 render à la carte"
                : `RestyleProAI — ${quantity} renders à la carte`,
              description:
                "Single-use renders. Never expire. Stack with your monthly allowance.",
            },
          },
          quantity,
        },
      ],
      success_url:
        `${origin}/pricing?alacarte=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing?alacarte=canceled`,
      metadata: {
        purchase_type: "alacarte_render",
        user_id: user.id,
        user_email: user.email,
        quantity: String(quantity),
        unit_amount: String(UNIT_AMOUNT_CENTS),
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[create-alacarte-render-checkout]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
