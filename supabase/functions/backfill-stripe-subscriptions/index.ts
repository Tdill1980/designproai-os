import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[BACKFILL-STRIPE] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    logStep("Stripe key verified");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Fetch all subscriptions from Stripe
    logStep("Fetching subscriptions from Stripe");
    const subscriptions = await stripe.subscriptions.list({
      limit: 100,
      status: "all",
      expand: ["data.customer"],
    });

    logStep("Fetched subscriptions", { count: subscriptions.data.length });

    const results = {
      processed: 0,
      created: 0,
      updated: 0,
      errors: [] as string[],
    };

    for (const sub of subscriptions.data) {
      try {
        const customer = sub.customer as Stripe.Customer;
        if (!customer || !customer.email) {
          logStep("Skipping subscription - no customer email", { subId: sub.id });
          continue;
        }

        const email = customer.email.toLowerCase();
        const tier = determineTier(sub);
        
        // Check if subscription already exists
        const { data: existing } = await supabase
          .from("user_subscriptions")
          .select("id")
          .eq("stripe_subscription_id", sub.id)
          .single();

        const subscriptionData = {
          email,
          tier,
          status: sub.status === "active" ? "active" : "inactive",
          stripe_customer_id: customer.id,
          stripe_subscription_id: sub.id,
          stripe_price_id: sub.items.data[0]?.price.id || null,
          billing_cycle_start: new Date(sub.current_period_start * 1000).toISOString(),
          billing_cycle_end: new Date(sub.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        };

        if (existing) {
          // Update existing
          const { error } = await supabase
            .from("user_subscriptions")
            .update(subscriptionData)
            .eq("id", existing.id);

          if (error) throw error;
          results.updated++;
          logStep("Updated subscription", { email, tier });
        } else {
          // Need to find or create a user_id - use email to look up
          // First check if there's an auth user with this email
          const { data: authUsers } = await supabase.auth.admin.listUsers();
          const authUser = authUsers?.users?.find(u => u.email?.toLowerCase() === email);
          
          const userId = authUser?.id || crypto.randomUUID();

          const { error } = await supabase
            .from("user_subscriptions")
            .insert({
              ...subscriptionData,
              user_id: userId,
            });

          if (error) throw error;
          results.created++;
          logStep("Created subscription", { email, tier, hasAuthUser: !!authUser });
        }

        results.processed++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`${sub.id}: ${errorMsg}`);
        logStep("Error processing subscription", { subId: sub.id, error: errorMsg });
      }
    }

    logStep("Backfill complete", results);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

function determineTier(sub: Stripe.Subscription): string {
  // Determine tier based on price amount or product metadata
  const priceAmount = sub.items.data[0]?.price.unit_amount || 0;
  
  // Adjust these thresholds based on your actual pricing
  if (priceAmount >= 19900) return "agency";
  if (priceAmount >= 9900) return "professional";
  if (priceAmount >= 4900) return "starter";
  
  return "starter";
}
