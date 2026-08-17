import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE_URL = Deno.env.get("PUBLIC_SITE_URL") || "https://restylepro.ai";
const PRICE_PER_YARD_CENTS = 9550; // $95.50 retail
const DESIGN_FILE_PRICE_CENTS = 4900; // $49.00 retail (RestylePro keeps 100%)
// White-label dropship: WPW gets 98% wholesale, RestylePro keeps 2% margin
const DEFAULT_WHOLESALE_PER_YARD_CENTS = 9359; // $93.59 — overridable per pattern via wbty_products.wholesale_price_per_yard
// Shipping: WPW uses their own carriers. Free over $750, otherwise $25 flat
const FREE_SHIPPING_THRESHOLD_CENTS = 75000; // $750
const FLAT_SHIPPING_CENTS = 2500; // $25

interface CheckoutPayload {
  orderType: "printed_wrap" | "design_file";
  pattern: { id?: string; name: string; category?: string; media_url?: string };
  vehicle: { year: string; make: string; model: string };
  vehicleSize?: string;
  finish: string;
  yards?: number;
  customer: { name: string; email: string; phone?: string };
  shippingAddress?: string;
  notes?: string;
  renderUrl?: string | null;
  additionalViews?: Record<string, string | undefined>;
}

function createSb() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const payload: CheckoutPayload = await req.json();

    if (!payload.pattern?.name || !payload.customer?.email) {
      return new Response(JSON.stringify({ error: "Missing pattern or customer email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isPrint = payload.orderType === "printed_wrap";
    const sb = createSb();

    // 1. Compute pricing (cents)
    let retailCents: number;
    let wholesaleCents = 0;
    let unitAmount: number;
    let quantity: number;
    let lineDescription: string;

    if (isPrint) {
      const yards = payload.yards || 0;
      if (yards <= 0) {
        return new Response(JSON.stringify({ error: "yards required for printed_wrap" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Note: shipping address is collected by Stripe Checkout (shipping_address_collection)
      // and persisted to the order row by the wbty-stripe-webhook on session.completed

      // Look up wholesale rate from the pattern row (defaults to $40/yd)
      let wholesalePerYardCents = DEFAULT_WHOLESALE_PER_YARD_CENTS;
      if (payload.pattern.id) {
        const { data: prod } = await sb
          .from("wbty_products")
          .select("wholesale_price_per_yard")
          .eq("id", payload.pattern.id)
          .maybeSingle();
        if (prod?.wholesale_price_per_yard) {
          wholesalePerYardCents = Math.round(prod.wholesale_price_per_yard * 100);
        }
      }

      retailCents = yards * PRICE_PER_YARD_CENTS;
      wholesaleCents = yards * wholesalePerYardCents;
      unitAmount = PRICE_PER_YARD_CENTS;
      quantity = yards;
      lineDescription = `${payload.pattern.name} — ${yards} yds — ${payload.vehicle.year} ${payload.vehicle.make} ${payload.vehicle.model} (${payload.finish})`;
    } else {
      retailCents = DESIGN_FILE_PRICE_CENTS;
      wholesaleCents = 0;
      unitAmount = DESIGN_FILE_PRICE_CENTS;
      quantity = 1;
      lineDescription = `${payload.pattern.name} — Print-Ready Design File (high-res tileable)`;
    }

    // 2. Insert pending order row
    const { data: order, error: insErr } = await sb
      .from("wbty_orders")
      .insert({
        customer_name: payload.customer.name,
        customer_email: payload.customer.email,
        customer_phone: payload.customer.phone || null,
        shipping_address: isPrint ? payload.shippingAddress : null,
        order_type: payload.orderType,
        pattern_id: payload.pattern.id || null,
        pattern_name: payload.pattern.name,
        pattern_category: payload.pattern.category || null,
        pattern_media_url: payload.pattern.media_url || null,
        vehicle_year: payload.vehicle.year || null,
        vehicle_make: payload.vehicle.make || null,
        vehicle_model: payload.vehicle.model || null,
        vehicle_size: payload.vehicleSize || null,
        finish: payload.finish,
        yards: isPrint ? payload.yards : null,
        retail_price_cents: retailCents,
        wholesale_cost_cents: wholesaleCents || null,
        render_url: payload.renderUrl || null,
        additional_views: payload.additionalViews || null,
        notes: payload.notes || null,
        status: "pending",
      })
      .select()
      .single();

    if (insErr || !order) {
      console.error("Order insert failed:", insErr);
      throw new Error(`Order insert failed: ${insErr?.message || "unknown"}`);
    }

    // 3. Build shipping options (printed wrap only — design files are emailed)
    let shippingOptions: any[] | undefined = undefined;
    if (isPrint) {
      // WPW uses their own carriers. Free shipping over $750, otherwise $25 flat.
      const freeShipping = retailCents >= FREE_SHIPPING_THRESHOLD_CENTS;
      shippingOptions = [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: {
              amount: freeShipping ? 0 : FLAT_SHIPPING_CENTS,
              currency: "usd",
            },
            display_name: freeShipping
              ? "Free Standard Shipping (orders $750+)"
              : "Standard Shipping (Ships from WePrintWraps via their carrier)",
            delivery_estimate: {
              minimum: { unit: "business_day", value: 2 },
              maximum: { unit: "business_day", value: 5 },
            },
          },
        },
      ];
    }

    // 4. Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: unitAmount,
          product_data: {
            name: isPrint ? `${payload.pattern.name} Vinyl Wrap (per yard)` : payload.pattern.name,
            description: lineDescription,
            images: payload.pattern.media_url ? [payload.pattern.media_url] : undefined,
          },
        },
        quantity,
      }],
      customer_email: payload.customer.email,
      success_url: `${SITE_URL}/wbty/order-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/wbty?cancelled=1`,
      ...(isPrint ? {
        shipping_address_collection: { allowed_countries: ["US", "CA"] },
        phone_number_collection: { enabled: true },
        shipping_options: shippingOptions,
      } : {}),
      metadata: {
        order_id: order.id,
        order_type: payload.orderType,
        pattern_name: payload.pattern.name,
        pattern_id: payload.pattern.id || "",
        vehicle: `${payload.vehicle.year} ${payload.vehicle.make} ${payload.vehicle.model}`,
        yards: String(payload.yards || ""),
        finish: payload.finish,
        free_shipping: isPrint && retailCents >= FREE_SHIPPING_THRESHOLD_CENTS ? "yes" : "no",
      },
    });

    // 4. Save session id on order
    await sb
      .from("wbty_orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id);

    return new Response(
      JSON.stringify({
        url: session.url,
        sessionId: session.id,
        orderId: order.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Checkout error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
