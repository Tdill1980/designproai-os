import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createExternalAnonClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      designId, purchaseType, priceId, priceAmount, productDescription, metadata,
      // Production Pack V2 fields
      selectedSize, recommendedSize, sizeWasOverridden,
      includeHood, includeFrontBumper, includeRearPlusBumper,
      roofSize, customerOrderNumber,
      vehicleYear, vehicleMake, vehicleModel
    } = await req.json();

    if (!designId || !purchaseType) {
      throw new Error('Missing required fields: designId or purchaseType');
    }

    if (!priceId && !priceAmount) {
      throw new Error('Either priceId or priceAmount must be provided');
    }

    const supabaseClient = createExternalAnonClient();

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    
    if (!user?.email) {
      throw new Error('User not authenticated');
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
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

    // Create one-time payment checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [
        priceId 
          ? {
              price: priceId,
              quantity: 1
            }
          : {
              price_data: {
                currency: 'usd',
                unit_amount: priceAmount,
                product_data: {
                  name: productDescription || `Design Pack - ${purchaseType === 'printed_panels' ? 'Printed Panels' : 'Production Files'}`,
                },
              },
              quantity: 1,
            }
      ],
      mode: 'payment',
      success_url: `${req.headers.get('origin')}/download-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get('origin')}/printpro/design-packs`,
      metadata: {
        design_id: designId,
        purchase_type: purchaseType,
        user_email: user.email,
        user_id: user.id,
        // Production Pack V2 size/addon metadata
        ...(selectedSize ? { selected_size: selectedSize } : {}),
        ...(recommendedSize ? { recommended_size: recommendedSize } : {}),
        ...(sizeWasOverridden !== undefined ? { size_was_overridden: String(sizeWasOverridden) } : {}),
        ...(includeHood !== undefined ? { include_hood: String(includeHood) } : {}),
        ...(includeFrontBumper !== undefined ? { include_front_bumper: String(includeFrontBumper) } : {}),
        ...(includeRearPlusBumper !== undefined ? { include_rear_plus_bumper: String(includeRearPlusBumper) } : {}),
        ...(roofSize ? { roof_size: roofSize } : {}),
        ...(customerOrderNumber ? { customer_order_number: customerOrderNumber } : {}),
        ...(vehicleYear ? { vehicle_year: vehicleYear } : {}),
        ...(vehicleMake ? { vehicle_make: vehicleMake } : {}),
        ...(vehicleModel ? { vehicle_model: vehicleModel } : {}),
        ...(metadata || {})
      }
    });

    console.log('Design pack checkout session created:', session.id);

    return new Response(
      JSON.stringify({ url: session.url }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error creating design checkout session:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
