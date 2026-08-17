import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createExternalClient, createExternalAnonClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let step = 'init';
  try {
    step = 'parse-body';
    const { action, return_url, affiliate_id } = await req.json();
    step = 'init-clients';
    const supabaseAdmin = createExternalClient();
    const supabaseAnon = createExternalAnonClient();

    // Authenticate user
    step = 'auth-header';
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Authorization required');

    step = 'verify-user';
    const token = authHeader.replace('Bearer ', '');
    const { data: userData } = await supabaseAnon.auth.getUser(token);
    if (!userData.user) throw new Error('User not authenticated');

    // Get affiliate record.
    // Default: the caller's own affiliate record (rep self-service).
    // Admin path: if affiliate_id is provided, the caller must hold the
    // 'admin'/'tester' role; then we operate on THAT rep's record so the
    // admin can generate onboarding links and check status on their behalf.
    step = 'load-affiliate';
    let affiliateQuery;
    if (affiliate_id) {
      step = 'verify-admin';
      const { data: roleRow } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', userData.user.id)
        .in('role', ['admin', 'tester'])
        .maybeSingle();
      if (!roleRow) {
        throw new Error('Admin role required to manage another affiliate');
      }
      affiliateQuery = supabaseAdmin
        .from('affiliate_partners')
        .select('*')
        .eq('id', affiliate_id)
        .single();
    } else {
      affiliateQuery = supabaseAdmin
        .from('affiliate_partners')
        .select('*')
        .eq('user_id', userData.user.id)
        .single();
    }

    const { data: affiliate, error: affError } = await affiliateQuery;

    if (affError || !affiliate) {
      throw new Error('Affiliate record not found');
    }

    step = 'check-stripe-key';
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
    if (!stripeKey) {
      throw new Error(
        'STRIPE_SECRET_KEY is not set on this Supabase project. Add it via the dashboard or `supabase secrets set STRIPE_SECRET_KEY=sk_...` and redeploy.'
      );
    }
    console.log('affiliate-stripe-connect: stripe key prefix=' + stripeKey.slice(0, 7) + ' action=' + action + ' affiliate=' + affiliate.id);

    step = 'init-stripe';
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-06-20',
    });

    const baseReturnUrl = return_url || 'https://restyleproai.com/affiliate/onboarding';

    if (action === 'create_account') {
      // Create Stripe Connect Express account
      let accountId = affiliate.stripe_account_id;

      if (!accountId) {
        step = 'stripe.accounts.create';
        const account = await stripe.accounts.create({
          type: 'express',
          email: affiliate.email,
          metadata: {
            affiliate_id: affiliate.id,
            referral_code: affiliate.referral_code,
          },
          capabilities: {
            transfers: { requested: true },
          },
        });
        accountId = account.id;

        // Save account ID
        step = 'save-account-id';
        await supabaseAdmin
          .from('affiliate_partners')
          .update({ stripe_account_id: accountId })
          .eq('id', affiliate.id);
      }

      // Create account link for onboarding
      step = 'stripe.accountLinks.create';
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${baseReturnUrl}?stripe=refresh`,
        return_url: `${baseReturnUrl}?stripe=complete`,
        type: 'account_onboarding',
      });

      return new Response(
        JSON.stringify({ url: accountLink.url }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'check_status') {
      if (!affiliate.stripe_account_id) {
        return new Response(
          JSON.stringify({ onboarded: false, has_account: false }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const account = await stripe.accounts.retrieve(affiliate.stripe_account_id);
      const onboarded = account.charges_enabled && account.payouts_enabled;

      if (onboarded && !affiliate.stripe_onboarded) {
        await supabaseAdmin
          .from('affiliate_partners')
          .update({ stripe_onboarded: true })
          .eq('id', affiliate.id);
      }

      return new Response(
        JSON.stringify({
          onboarded,
          has_account: true,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'create_login_link') {
      if (!affiliate.stripe_account_id) {
        throw new Error('No Stripe account connected');
      }

      const loginLink = await stripe.accounts.createLoginLink(affiliate.stripe_account_id);

      return new Response(
        JSON.stringify({ url: loginLink.url }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error('Invalid action');
  } catch (error: any) {
    const stripeMeta = {
      type: error?.type,
      code: error?.code,
      decline_code: error?.decline_code,
      doc_url: error?.doc_url,
      param: error?.param,
      statusCode: error?.statusCode,
      requestId: error?.requestId,
    };
    console.error('affiliate-stripe-connect failed:', {
      step,
      message: error?.message,
      stripe: stripeMeta,
      stack: error?.stack,
    });

    // Map common Stripe platform-setup errors to actionable instructions.
    // These fire BEFORE any affiliate even sees Stripe, so the message has to
    // tell Trish exactly what to click — not just echo Stripe's raw text.
    const raw = String(error?.message || '');
    let friendly = error?.message || 'Unknown error';
    const lower = raw.toLowerCase();

    if (
      lower.includes('signed up for connect') ||
      lower.includes('platform-profile') ||
      lower.includes('connect platform profile') ||
      lower.includes('you cannot create an account') ||
      lower.includes("haven't completed your platform profile") ||
      lower.includes('responsibilities controller')
    ) {
      friendly =
        'Stripe Connect is not enabled on this account yet. ' +
        'Go to https://dashboard.stripe.com/connect/accounts/overview, ' +
        'click "Get started", complete the platform profile, and enable ' +
        'Express accounts. Then try Connect Bank again.';
    } else if (lower.includes('no such api key') || lower.includes('invalid api key')) {
      friendly =
        'STRIPE_SECRET_KEY on this Supabase project is invalid or revoked. ' +
        'Set a fresh live secret key via the Supabase dashboard → Edge Functions → Secrets.';
    } else if (lower.includes('testmode') && lower.includes('live')) {
      friendly =
        'Key/mode mismatch: STRIPE_SECRET_KEY is a test key but the platform ' +
        'is live (or vice versa). Use the matching live secret key.';
    }

    return new Response(
      JSON.stringify({
        error: friendly,
        original_error: error?.message,
        step,
        stripe: stripeMeta,
      }),
      {
        status: error?.statusCode && error.statusCode >= 400 && error.statusCode < 600
          ? error.statusCode
          : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
