import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createExternalClient, createExternalAnonClient } from "../_shared/external-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      listing_id,
      vehicle_year,
      vehicle_make,
      vehicle_model,
      universal_size,
      email,
      wants_name_change,
      wants_logo_pack,
      // New customer-side fields captured by the 5-step BuyerPopup.
      // We don't reject the order if they're empty (creative designs
      // can skip step 3 entirely), but if they're present they ride
      // through to the Stripe metadata so the design team has them.
      business_name,
      business_phone,
      business_website,
      business_colors,
      logo_url,
      // $75 vehicle-render add-on. When true we add a Stripe line item
      // and stamp the transaction so the render team knows to deliver
      // a preview render before kicking off production files.
      wants_vehicle_render,
      return_url,
      // Two purchase paths surfaced by the buttons on the CM card:
      //   'design_only'      → files emailed (existing flow)
      //   'design_plus_wrap' → design files + printed wrap shipped.
      //                        Bundle: -$100 on design + Stripe
      //                        collects a shipping address. The wrap
      //                        print itself is a follow-up quote the
      //                        design team sends manually after they
      //                        spec the vehicle.
      purchase_mode: rawPurchaseMode,
    } = await req.json();

    if (!listing_id) throw new Error("listing_id is required");

    const purchaseMode = rawPurchaseMode === "design_plus_wrap"
      ? "design_plus_wrap"
      : "design_only";
    const BUNDLE_DISCOUNT_USD = 100;
    const FREE_SHIPPING_THRESHOLD_USD = 750;

    const supabaseAdmin = createExternalClient();
    const supabaseAnon = createExternalAnonClient();

    // Authenticate buyer
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Authorization required");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabaseAnon.auth.getUser(token);
    if (!userData.user) throw new Error("User not authenticated");

    // Fetch listing + (optional) creator profile. Admin-curated rows
    // have creator_id = NULL, so we must use a LEFT join — !inner
    // would silently drop those rows and the buyer would see
    // "Listing not found".
    const { data: listing, error: listingError } = await supabaseAdmin
      .from("marketplace_listings")
      .select("*, neuralnetwork_creator_profiles(user_id, display_name, stripe_connect_account_id)")
      .eq("id", listing_id)
      .single();

    if (listingError || !listing) throw new Error("Listing not found");
    if (listing.status !== "listed" && listing.status !== "approved") {
      throw new Error("Listing is not available for purchase");
    }

    const creatorProfile = (listing as any).neuralnetwork_creator_profiles;
    const creatorStripeAccountId = creatorProfile?.stripe_connect_account_id;

    // Calculate pricing.
    //
    // Bundle math (design_plus_wrap): the customer commits to the
    // discounted design fee at checkout. The printed-wrap line is
    // quoted + invoiced separately by the design team once they spec
    // the vehicle. So at checkout the only Stripe charge is the
    // design fee (with the $100 off if bundled).
    const listedBasePrice = listing.price || 350;
    const bundleDiscount =
      purchaseMode === "design_plus_wrap"
        ? Math.min(BUNDLE_DISCOUNT_USD, listedBasePrice)
        : 0;
    const basePrice = Math.max(0, listedBasePrice - bundleDiscount);
    // Branded designs include the name swap free; the explicit
    // wants_name_change flag is preserved for non-branded creative
    // designs and still surfaces a $25 line item.
    const nameChangeFee = wants_name_change && listing.design_style !== "branded" ? 25 : 0;
    const logoPackFee = wants_logo_pack ? 25 : 0;
    const vehicleRenderFee = wants_vehicle_render ? 75 : 0;
    const totalAmount = basePrice + nameChangeFee + logoPackFee + vehicleRenderFee;
    // 60 / 40 split applies to the base design fee only — upsells
    // (name change, logo pack, vehicle render) all flow to platform.
    // Admin-curated listings have no creator, so the whole base fee
    // is platform revenue.
    const creatorPayout = creatorProfile
      ? Math.round(basePrice * 0.6)
      : 0;
    const platformFee = totalAmount - creatorPayout;

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2024-06-20",
    });

    // Check for existing Stripe customer
    const buyerEmail = email || userData.user.email;
    const customers = await stripe.customers.list({ email: buyerEmail, limit: 1 });
    const customerId = customers.data.length > 0 ? customers.data[0].id : undefined;

    const baseReturnUrl = return_url || "https://restyleproai.com/creatormarket";

    // Build line items
    const designLineName =
      purchaseMode === "design_plus_wrap"
        ? `${listing.title || "CreatorMarket Design"} — Design (bundled with wrap, $${BUNDLE_DISCOUNT_USD} off)`
        : listing.title || "CreatorMarket Design";
    const designLineDescription =
      purchaseMode === "design_plus_wrap"
        ? `Design files only — printed wrap quoted separately. Free shipping on bundles over $${FREE_SHIPPING_THRESHOLD_USD}.`
        : `Production Pack — ${vehicle_year || ""} ${vehicle_make || ""} ${vehicle_model || ""}`.trim();
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: designLineName,
            description: designLineDescription,
          },
          unit_amount: basePrice * 100,
        },
        quantity: 1,
      },
    ];

    if (wants_name_change) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: { name: "Name Change Customization" },
          unit_amount: 2500,
        },
        quantity: 1,
      });
    }

    if (wants_logo_pack) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: { name: "Logo Pack (Cut-Contour Ready)" },
          unit_amount: 2500,
        },
        quantity: 1,
      });
    }

    // $75 Custom Vehicle Render add-on. Surfaced by the secondary
    // card CTA and step 4 of the BuyerPopup. The render team uses
    // the metadata.wants_vehicle_render flag to pull this work to
    // the front of the queue and email the preview render before
    // kicking off production files.
    if (wants_vehicle_render) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: "Custom Vehicle Render — Preview Before Production",
            description: "See this design on your actual vehicle before we produce print files (delivered in 48 hours).",
          },
          unit_amount: 7500,
        },
        quantity: 1,
      });
    }

    // Create checkout session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      customer_email: customerId ? undefined : buyerEmail,
      line_items: lineItems,
      mode: "payment",
      success_url: `${baseReturnUrl}?purchase=success&listing=${listing_id}`,
      cancel_url: `${baseReturnUrl}?purchase=canceled`,
      metadata: {
        listing_id,
        buyer_user_id: userData.user.id,
        buyer_email: buyerEmail || "",
        vehicle_year: vehicle_year || "",
        vehicle_make: vehicle_make || "",
        vehicle_model: vehicle_model || "",
        universal_size: universal_size || "",
        // Customer branding fields collected in BuyerPopup step 3 —
        // the design team uses these to swap business details into
        // the artwork before files are produced.
        business_name: business_name || "",
        business_phone: business_phone || "",
        business_website: business_website || "",
        business_colors: business_colors || "",
        logo_url: logo_url || "",
        wants_name_change: wants_name_change ? "true" : "false",
        wants_logo_pack: wants_logo_pack ? "true" : "false",
        wants_vehicle_render: wants_vehicle_render ? "true" : "false",
        creator_payout: String(creatorPayout),
        platform_fee: String(platformFee),
        purchase_mode: purchaseMode,
        bundle_discount: String(bundleDiscount),
      },
    };

    // Capture a shipping address when bundling the printed wrap. The
    // design team uses this to ship the printed roll once the wrap
    // print is fulfilled (paid via a separate invoice).
    if (purchaseMode === "design_plus_wrap") {
      sessionParams.shipping_address_collection = {
        allowed_countries: ["US"],
      };
      sessionParams.phone_number_collection = { enabled: true };
      // Plain note on the Stripe-hosted checkout so the buyer
      // understands what's being charged now vs. invoiced later.
      sessionParams.custom_text = {
        submit: {
          message:
            `Wrap printing is quoted separately after we spec your vehicle. ` +
            `Free shipping on bundles over $${FREE_SHIPPING_THRESHOLD_USD}.`,
        },
      };
    }

    // If creator has Stripe Connect, set up the transfer. Admin-
    // curated rows (no creator) skip this — the full charge stays
    // on the platform account.
    if (creatorStripeAccountId && creatorPayout > 0) {
      sessionParams.payment_intent_data = {
        transfer_data: {
          destination: creatorStripeAccountId,
          amount: creatorPayout * 100,
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Insert transaction record — creator_id is now nullable for
    // admin-curated rows.
    await supabaseAdmin.from("marketplace_transactions").insert({
      listing_id,
      buyer_user_id: userData.user.id,
      creator_id: listing.creator_id || null,
      stripe_payment_intent_id: session.payment_intent || session.id,
      total_amount: totalAmount,
      platform_fee: platformFee,
      creator_payout: creatorPayout,
      payout_status: "pending",
      status: "pending",
    });

    console.log(`Marketplace checkout created: session=${session.id} listing=${listing_id} total=$${totalAmount}`);

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Marketplace checkout error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
