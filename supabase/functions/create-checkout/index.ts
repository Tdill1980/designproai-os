import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createExternalAnonClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PRICE_IDS = {
  // Legacy prices (kept for existing subscribers)
  starter_legacy: "price_1SWJgDH1V6OhfCAPSCR5VbT2",
  advanced_legacy: "price_1SWNNuH1V6OhfCAPDChwyuAX",
  complete_legacy: "price_1SWO9QH1V6OhfCAPjqYLT7Ko",
  // New presale tiers
  starter: "price_1TEFVwH1V6OhfCAPeKAF34NH",       // $349/mo
  professional: "price_1TEFVxH1V6OhfCAPPATuqoGZ",   // $699/mo (DesignPro Studio)
  proshop: "price_1TEFVxH1V6OhfCAPDdkZaoCP",        // $1,499/mo
  enterprise: "price_1TEFVyH1V6OhfCAPiptL1RKW",     // $2,999/mo
  // Live /pricing page tiers (4 standalone plans)
  pricing_starter: "price_1TTTzSH1V6OhfCAPGVZDZlZd",        // Starter $350
  pricing_starter_wpw: "price_1TTTzhH1V6OhfCAP8VEk52tv",
  pricing_designpro_lite: "price_1TTUyoH1V6OhfCAPaIf5OMDW", // DesignPro Lite $499
  pricing_designpro_lite_wpw: "price_1TTUyvH1V6OhfCAPddCu27xk",
  pricing_designpro_studio_wpw: "price_1TTTzoH1V6OhfCAPqcDURY6T",
  pricing_designpro_plus: "price_1TTTzbH1V6OhfCAPkTef8yrl",  // DesignPro Plus $995
  pricing_designpro_plus_wpw: "price_1TTTzuH1V6OhfCAP9zEqAlBh",
  extraRender: "price_1SWNl3H1V6OhfCAPas1HJF05"     // $5 metered
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { priceId, couponCode, embedded } = await req.json();

    if (!Object.values(PRICE_IDS).includes(priceId)) {
      throw new Error('Invalid price ID');
    }

    const supabaseClient = createExternalAnonClient();

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    
    if (!user?.email) {
      throw new Error('User not authenticated');
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      throw new Error('Stripe is not configured. Please contact support.');
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-06-20',
    });

    // Check for existing customer
    const customers = await stripe.customers.list({
      email: user.email,
      limit: 1
    });

    let customerId;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    }

    // Create checkout session with subscription + metered usage
    const lineItems: Array<{ price: string; quantity?: number }> = [
      {
        price: priceId,
        quantity: 1
      }
    ];

    // Add metered usage price to all subscriptions (no quantity for metered prices)
    if (priceId !== PRICE_IDS.extraRender) {
      lineItems.push({
        price: PRICE_IDS.extraRender
      });
    }

    // Look up affiliate coupon and resolve Stripe discount
    let discounts: Array<{ coupon: string }> = [];
    let affiliateMeta: Record<string, string> = {};

    if (couponCode) {
      const { data: couponRow } = await supabaseClient
        .from('affiliate_coupons')
        .select('id, code, discount_percent, commission_percent, affiliate_name, stripe_coupon_id, active, max_uses, current_uses, expires_at')
        .eq('code', couponCode.toUpperCase())
        .eq('active', true)
        .maybeSingle();

      if (couponRow) {
        const row = couponRow as any;
        const isExpired = row.expires_at && new Date(row.expires_at) < new Date();
        const isMaxedOut = row.max_uses && row.current_uses >= row.max_uses;

        if (!isExpired && !isMaxedOut) {
          let stripeCouponId = row.stripe_coupon_id;

          // Create Stripe coupon on first use if not already created
          if (!stripeCouponId) {
            const pct = row.discount_percent || 25;
            const stripeCoupon = await stripe.coupons.create({
              percent_off: pct,
              duration: pct >= 100 ? 'once' : 'forever',
              name: `Affiliate: ${row.affiliate_name} (${row.code})`,
              metadata: { affiliate_coupon_id: row.id, affiliate_code: row.code },
            });
            stripeCouponId = stripeCoupon.id;

            // Save the Stripe coupon ID back to the DB for reuse
            await supabaseClient
              .from('affiliate_coupons')
              .update({ stripe_coupon_id: stripeCouponId } as any)
              .eq('id', row.id);
          }

          discounts = [{ coupon: stripeCouponId }];
          affiliateMeta = {
            affiliate_coupon_id: row.id,
            affiliate_code: row.code,
            affiliate_name: row.affiliate_name,
            commission_percent: String(row.commission_percent || 25),
          };

          // Increment usage count
          await supabaseClient
            .from('affiliate_coupons')
            .update({ current_uses: (row.current_uses || 0) + 1 } as any)
            .eq('id', row.id);
        }
      }
    }

    const origin = req.headers.get('origin') || '';

    // Build session params — embedded mode uses ui_mode + return_url.
    // allow_promotion_codes lets customers type a Stripe promotion code
    // (e.g. SAVE50) directly in checkout when no coupon was pre-applied.
    // No trial: customers are charged immediately on signup.
    const sessionParams: any = {
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: lineItems,
      mode: 'subscription',
      ...(discounts.length > 0
        ? { discounts }
        : { allow_promotion_codes: true }),
      subscription_data: {
        // Stripe does NOT copy the Checkout Session metadata onto the
        // subscription object, and the stripe-webhook reads
        // subscription.metadata.user_id to link the buyer. Stamp it here so
        // customer.subscription.created can resolve the account directly.
        metadata: {
          user_id: user.id,
          user_email: user.email,
          ...affiliateMeta,
        },
      },
      payment_method_collection: 'always',
      metadata: {
        user_id: user.id,
        user_email: user.email,
        ...affiliateMeta,
      },
    };

    if (embedded) {
      sessionParams.ui_mode = 'embedded';
      sessionParams.return_url = `${origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`;
    } else {
      sessionParams.success_url = `${origin}/pricing?success=true`;
      sessionParams.cancel_url = `${origin}/pricing?canceled=true`;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    console.log('Checkout session created:', session.id);

    return new Response(
      JSON.stringify({
        url: session.url || null,
        clientSecret: session.client_secret || null,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error creating checkout session:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
