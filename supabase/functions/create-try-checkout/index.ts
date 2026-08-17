/**
 * create-try-checkout — first-touch shareable hook.
 * $25 → 3 design tokens (1 token = 1 render OR 1 revision in any tool).
 *
 * Auth-required (login-first per product decision). The buyer is
 * already a user by the time they hit checkout, so the existing
 * stripe-webhook 'token_pack' handler credits their balance via the
 * add_user_tokens RPC — no new fulfillment code needed.
 *
 * Body:
 *   { return_path?: string }
 *
 * Returns:
 *   { url: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const PRICE_CENTS = 2500;
const TOKENS = 3;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const returnPath =
      typeof body?.return_path === "string" && body.return_path.startsWith("/")
        ? body.return_path
        : "/dashboard";

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) throw new Error("Not authenticated");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userResp, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userResp.user?.email) throw new Error("Not authenticated");
    const user = userResp.user;

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("Stripe is not configured");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    const existing = await stripe.customers.list({ email: user.email!, limit: 1 });
    const customerId = existing.data[0]?.id;

    const origin = req.headers.get("origin") || "";
    const successPath = `${returnPath}${returnPath.includes("?") ? "&" : "?"}try=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelPath = `/try?canceled=1`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      customer_email: customerId ? undefined : user.email!,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: PRICE_CENTS,
            product_data: {
              name: `RestylePro Try Pack — ${TOKENS} design tokens`,
              description:
                `${TOKENS} tokens = ${TOKENS} renders OR revisions in any RestylePro tool. ` +
                "Never expires. Stacks with any monthly plan.",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}${successPath}`,
      cancel_url: `${origin}${cancelPath}`,
      // Re-use the existing token_pack metadata shape so the existing
      // stripe-webhook 'token_pack' handler credits the user's balance
      // via add_user_tokens — no new fulfillment branch needed.
      metadata: {
        purchase_type: "token_pack",
        offer: "try_pack",
        user_id: user.id,
        user_email: user.email ?? "",
        tokens: String(TOKENS),
        unit_amount: String(PRICE_CENTS),
      },
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[create-try-checkout]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
