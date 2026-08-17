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
    const { action, return_url } = await req.json();
    const supabaseAdmin = createExternalClient();
    const supabaseAnon = createExternalAnonClient();

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Authorization required");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabaseAnon.auth.getUser(token);
    if (!userData.user) throw new Error("User not authenticated");

    // Get creator profile
    const { data: creator, error: creatorError } = await supabaseAdmin
      .from("neuralnetwork_creator_profiles")
      .select("*")
      .eq("user_id", userData.user.id)
      .single();

    if (creatorError || !creator) {
      throw new Error("Creator profile not found");
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2024-06-20",
    });

    const baseReturnUrl = return_url || "https://restyleproai.com/creatormarket";

    if (action === "create_account") {
      let accountId = creator.stripe_connect_account_id;

      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "express",
          email: userData.user.email,
          metadata: {
            creator_id: creator.id,
            display_name: creator.display_name || "",
          },
          capabilities: {
            transfers: { requested: true },
          },
        });
        accountId = account.id;

        await supabaseAdmin
          .from("neuralnetwork_creator_profiles")
          .update({ stripe_connect_account_id: accountId })
          .eq("id", creator.id);
      }

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${baseReturnUrl}?stripe=refresh`,
        return_url: `${baseReturnUrl}?stripe=complete`,
        type: "account_onboarding",
      });

      return new Response(
        JSON.stringify({ url: accountLink.url }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "check_status") {
      if (!creator.stripe_connect_account_id) {
        return new Response(
          JSON.stringify({ onboarded: false, has_account: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const account = await stripe.accounts.retrieve(creator.stripe_connect_account_id);
      const onboarded = account.charges_enabled && account.payouts_enabled;

      if (onboarded) {
        await supabaseAdmin
          .from("neuralnetwork_creator_profiles")
          .update({
            stripe_connect_onboarded: true,
            stripe_connect_charges_enabled: true,
            stripe_connect_payouts_enabled: true,
          })
          .eq("id", creator.id);
      }

      return new Response(
        JSON.stringify({
          onboarded,
          has_account: true,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "create_login_link") {
      if (!creator.stripe_connect_account_id) {
        throw new Error("No Stripe account connected");
      }

      const loginLink = await stripe.accounts.createLoginLink(creator.stripe_connect_account_id);

      return new Response(
        JSON.stringify({ url: loginLink.url }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error("Invalid action");
  } catch (error: any) {
    console.error("Creator Stripe Connect error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
