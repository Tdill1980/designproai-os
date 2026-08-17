/**
 * create-print-pack-checkout — Stripe one-time checkout for a PRINT PRODUCTION
 * PACK, scoped to ONE design generation.
 *
 * This is the CLEAN entitlement path for the PROVEN pipeline (Build Assets /
 * PanelPro). It is deliberately separate from the legacy `/printpro`
 * (`print_production_pack`) purchase, which kicks the OLD panelizer re-slice
 * pipeline. On payment, stripe-webhook (product_type='print_pack_entitlement')
 * upserts a PAID production_packs row for this generation and stops — no
 * pipeline kick. The pack-gate on upscale-panel-to-print then unlocks the
 * print-ready file export for every side of that generation.
 *
 * Metered ONCE PER VEHICLE: one pack per generation → all sides export free.
 *
 * Body: { generation_id: string, return_path?: string }
 * Returns: { url }  (Stripe Checkout Session URL)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Pack price in CENTS. Single source of truth — the paywall shows $299 and the
// webhook records this on the production_packs row.
const PACK_AMOUNT_CENTS = 29900;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const generationId = String(body?.generation_id ?? "").trim();
    const returnPath = typeof body?.return_path === "string" ? body.return_path : "/dashboard";
    if (!generationId) throw new Error("generation_id is required");

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

    // Reuse the buyer's existing Stripe customer if we know their email.
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
            unit_amount: PACK_AMOUNT_CENTS,
            product_data: {
              name: "RestyleProAI — Production Pack (print-ready files)",
              description:
                "Unlocks the print-ready file export for every panel of this design — " +
                "150-DPI PNG + print TIFF. One pack per vehicle; all sides included.",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}pack=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}pack=canceled`,
      metadata: {
        product_type: "print_pack_entitlement",
        user_id: user.id,
        user_email: user.email ?? "",
        generation_id: generationId,
        amount_cents: String(PACK_AMOUNT_CENTS),
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[create-print-pack-checkout]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
