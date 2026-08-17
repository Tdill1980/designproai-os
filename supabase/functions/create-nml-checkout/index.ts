/**
 * create-nml-checkout — Stripe checkout for "Never Miss a Lead" (add-on)
 *
 * NML is an add-on that requires an active RestylePro subscription. Free
 * users are blocked with a clear "subscribe first" error.
 *
 * Two tiers (matches /never-miss-a-lead and /quicktext page pricing):
 *   - basic ($49/mo):  voicemail-to-text + auto-text quote link
 *   - pro   ($99/mo):  everything in basic + AI receptionist (voice_agent_enabled)
 *
 * Required env vars:
 *   - NML_BASIC_STRIPE_PRICE_ID — Stripe price ID for the $49/mo tier
 *   - NML_PRO_STRIPE_PRICE_ID   — Stripe price ID for the $99/mo tier
 *   (Legacy NML_STRIPE_PRICE_ID is used as fallback for `basic` only.)
 *
 * Creates a Stripe subscription session. On success, stripe-webhook sees
 * metadata.purchase_type === 'never_miss_a_lead' and calls
 * twilio-subaccount-provision to buy a number + wire webhooks. The `tier`
 * is forwarded so Pro purchases flip voice_agent_enabled = true.
 */

import Stripe from "https://esm.sh/stripe@14.21.0";
import { createExternalClient } from "../_shared/external-db.ts";
import { corsHeaders } from "../_shared/cors.ts";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  try {
    const { areaCode, forwardingPhone, tier: tierIn } = await req.json();
    const tier: "basic" | "pro" = tierIn === "pro" ? "pro" : "basic";

    // Auth — get user
    const supabase = createExternalClient();
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user?.email) return json(401, { ok: false, error: "Not authenticated" });

    // Get shop
    const { data: shop } = await supabase
      .from("shop_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!shop) return json(400, { ok: false, error: "No shop profile found. Complete onboarding first." });

    // Gate: NML is an add-on. Caller must have an active RestylePro
    // subscription, or be an admin/tester (mirrors useUserTier logic).
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "tester"])
      .maybeSingle();

    if (!roleRow) {
      const { data: sub } = await supabase
        .from("user_subscriptions")
        .select("tier, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();

      const tierVal = (sub as any)?.tier as string | undefined;
      const hasActivePaidPlan = sub && tierVal && tierVal !== "free";

      if (!hasActivePaidPlan) {
        return json(403, {
          ok: false,
          error: "subscription_required",
          message:
            "Never Miss a Lead is an add-on for active RestylePro subscribers. Pick a plan first, then come back to add NML.",
        });
      }
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json(500, { ok: false, error: "Stripe not configured" });

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    // Find or create Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customer = customers.data.length > 0
      ? customers.data[0]
      : await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } });

    const basicPriceId =
      Deno.env.get("NML_BASIC_STRIPE_PRICE_ID") || Deno.env.get("NML_STRIPE_PRICE_ID");
    const proPriceId = Deno.env.get("NML_PRO_STRIPE_PRICE_ID");
    const priceId = tier === "pro" ? proPriceId : basicPriceId;

    if (!priceId) {
      const missingVar = tier === "pro" ? "NML_PRO_STRIPE_PRICE_ID" : "NML_BASIC_STRIPE_PRICE_ID";
      return json(500, {
        ok: false,
        error: `${missingVar} is not configured. Set it in Supabase function secrets.`,
      });
    }

    const siteUrl = Deno.env.get("SITE_URL") || "https://restylepro.ai";

    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/dashboard?nml=success&tier=${tier}`,
      cancel_url: `${siteUrl}/never-miss-a-lead?canceled=1`,
      metadata: {
        purchase_type: "never_miss_a_lead",
        tier,
        user_id: user.id,
        user_email: user.email,
        shop_id: (shop as any).id,
        area_code: areaCode || "",
        forwarding_phone: forwardingPhone || "",
      },
    });

    return json(200, { ok: true, url: session.url, tier });
  } catch (err: any) {
    console.error("[create-nml-checkout]", err);
    return json(500, { ok: false, error: err.message });
  }
});
