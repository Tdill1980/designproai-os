import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WBTY_WEBHOOK_SECRET") || Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

function createSb() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

async function triggerFulfillment(orderId: string) {
  const sb = createSb();

  // Fetch the full order
  const { data: order, error } = await sb
    .from("wbty_orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (error || !order) {
    console.error(`[wbty-webhook] Could not load order ${orderId}:`, error);
    return;
  }

  // Build payload for the existing send-wbty-order-email function (now in fulfillment mode)
  const fulfillmentPayload = {
    mode: "fulfillment", // signals white-label dropship email
    orderId: order.id,
    orderType: order.order_type,
    pattern: {
      id: order.pattern_id,
      name: order.pattern_name,
      category: order.pattern_category,
      media_url: order.pattern_media_url,
    },
    vehicle: {
      year: order.vehicle_year || "",
      make: order.vehicle_make || "",
      model: order.vehicle_model || "",
      label: [order.vehicle_year, order.vehicle_make, order.vehicle_model].filter(Boolean).join(" "),
    },
    finish: order.finish,
    yards: order.yards,
    pricePerYard: order.yards ? +(order.retail_price_cents / order.yards / 100).toFixed(2) : null,
    totalPrice: order.retail_price_cents / 100,
    wholesaleCost: order.wholesale_cost_cents ? order.wholesale_cost_cents / 100 : null,
    margin: order.margin_cents ? order.margin_cents / 100 : null,
    vehicleSize: order.vehicle_size,
    renderUrl: order.render_url,
    additionalViews: order.additional_views,
    customer: {
      name: order.customer_name,
      email: order.customer_email,
      phone: order.customer_phone,
    },
    shippingAddress: order.shipping_address,
    notes: order.notes,
    submittedAt: order.created_at,
    paymentStatus: "paid",
    stripeSessionId: order.stripe_session_id,
  };

  // Invoke the email sender
  const emailUrl = `${Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")}/functions/v1/send-wbty-order-email`;
  const res = await fetch(emailUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(fulfillmentPayload),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[wbty-webhook] Fulfillment email failed for ${orderId}:`, res.status, errText);
    return;
  }

  // Mark order as fulfillment_emailed
  await sb
    .from("wbty_orders")
    .update({
      status: "fulfillment_emailed",
      fulfillment_emailed_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  console.log(`[wbty-webhook] Fulfillment email sent for order ${orderId}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing stripe-signature" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let event: Stripe.Event;
  try {
    const body = await req.text();
    event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error("[wbty-webhook] Signature verification failed:", err);
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[wbty-webhook] Event: ${event.type}`);

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      // Only process WBTY orders (have order_id in metadata)
      const orderId = session.metadata?.order_id;
      if (!orderId) {
        console.log("[wbty-webhook] Not a WBTY order (no order_id metadata), skipping");
        return new Response(JSON.stringify({ received: true, skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const sb = createSb();

      // Update order to paid + capture shipping address from Stripe (collected at checkout)
      const stripeShipping = session.shipping_details?.address;
      const formattedShipping = stripeShipping
        ? [
            session.shipping_details?.name,
            stripeShipping.line1,
            stripeShipping.line2,
            `${stripeShipping.city || ""}, ${stripeShipping.state || ""} ${stripeShipping.postal_code || ""}`.trim(),
            stripeShipping.country,
          ].filter(Boolean).join("\n")
        : null;

      await sb
        .from("wbty_orders")
        .update({
          status: "paid",
          stripe_payment_intent_id: session.payment_intent as string,
          stripe_payment_status: session.payment_status,
          shipping_address: formattedShipping || undefined,
          customer_phone: session.customer_details?.phone || undefined,
        })
        .eq("id", orderId);

      // Trigger fulfillment email to Lance
      await triggerFulfillment(orderId);
    } else if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.order_id;
      if (orderId) {
        const sb = createSb();
        await sb.from("wbty_orders").update({ status: "cancelled" }).eq("id", orderId);
      }
    } else if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const sb = createSb();
      await sb
        .from("wbty_orders")
        .update({ status: "refunded" })
        .eq("stripe_payment_intent_id", charge.payment_intent as string);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[wbty-webhook] Handler error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
