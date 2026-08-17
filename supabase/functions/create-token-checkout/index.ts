/**
 * create-token-checkout — Stripe one-time-payment checkout session
 * for buying RestylePro design tokens.
 *
 * Unit price depends on the buyer's CURRENT subscription tier — that's
 * the whole point of the tier-priced overage ladder. Subscribing tier
 * climbs the discount:
 *
 *   Free / Starter         $30 / token   (entry rate, blocks resellers)
 *   DesignPro Lite/Studio  $20 / token   (paying-tier perk)
 *   DesignPro Plus         $15 / token   (top-tier reward, ~40% off retail)
 *
 * Tokens are credited to user_tokens.balance by stripe-webhook on
 * checkout.session.completed when metadata.purchase_type =
 * "token_pack". The webhook reads metadata.tokens to determine the
 * grant amount, so the unit price below and the per-tier multiplier
 * never need to round-trip through Stripe — only the dollar total
 * and the granted token count matter for reconciliation.
 *
 * Body (all optional):
 *   { quantity?: number, return_path?: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Per-tier unit amount in CENTS. Single source of truth — change here
// and stripe-webhook / paywall popup will pick it up via metadata.
const UNIT_AMOUNT_BY_TIER: Record<string, number> = {
  free: 3000,
  starter: 3000,
  advanced: 2000,
  professional: 2000,
  complete: 2000,
  proshop: 2000,
  enterprise: 1500,
  agency: 1500,
};

// Retail value per token (display only — not what the buyer pays).
const RETAIL_PER_TOKEN_CENTS = 2500;

function resolveUnitAmount(tier: string, planLabel?: string | null): number {
  // Plus customers ride the `complete` slug with a distinct Stripe
  // price ID. Detect via the plan_label sitting on the subscription
  // row (if the billing webhook stamps it).
  if (tier === "complete" && planLabel && /plus/i.test(planLabel)) {
    return UNIT_AMOUNT_BY_TIER.enterprise; // 1500 = Plus rate
  }
  return UNIT_AMOUNT_BY_TIER[tier] ?? UNIT_AMOUNT_BY_TIER.free;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const requestedQty = Number(body?.quantity ?? 10);
    const quantity = Math.min(100, Math.max(1, Math.floor(requestedQty || 10)));
    const returnPath = typeof body?.return_path === "string" ? body.return_path : "/dashboard";

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) throw new Error("Not authenticated");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userResp, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userResp.user?.email) throw new Error("Not authenticated");
    const user = userResp.user;

    // Resolve tier + plan label so we can price the tokens correctly.
    const { data: sub } = await admin
      .from("user_subscriptions")
      .select("tier, status")
      .eq("user_id", user.id)
      .maybeSingle();
    const tier = sub?.tier ?? "free";
    const planLabel = (sub as unknown as { plan_label?: string | null })?.plan_label ?? null;
    const unitAmount = resolveUnitAmount(tier, planLabel);

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("Stripe is not configured");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    // Reuse existing Stripe customer if their email is already known.
    const existing = await stripe.customers.list({ email: user.email!, limit: 1 });
    const customerId = existing.data[0]?.id;

    const origin = req.headers.get("origin") || "";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      customer_email: customerId ? undefined : user.email!,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            product_data: {
              name: quantity === 1
                ? "RestyleProAI — 1 design token"
                : `RestyleProAI — ${quantity} design tokens`,
              description:
                "1 token = 1 render OR 1 revision in any RestylePro tool. " +
                "Never expires. Stacks with your monthly tier allowance.",
            },
          },
          quantity,
        },
      ],
      success_url: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}tokens=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}tokens=canceled`,
      metadata: {
        purchase_type: "token_pack",
        user_id: user.id,
        user_email: user.email ?? "",
        tier,
        tokens: String(quantity),
        unit_amount: String(unitAmount),
        retail_per_token: String(RETAIL_PER_TOKEN_CENTS),
      },
    });

    return new Response(
      JSON.stringify({
        url: session.url,
        quantity,
        unit_amount: unitAmount,
        tier,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[create-token-checkout]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
