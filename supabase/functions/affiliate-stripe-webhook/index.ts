import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
    const webhookSecret = Deno.env.get('AFFILIATE_STRIPE_WEBHOOK_SECRET') || '';
    if (!stripeKey) throw new Error('STRIPE_SECRET_KEY not set');
    if (!webhookSecret) throw new Error('AFFILIATE_STRIPE_WEBHOOK_SECRET not set');

    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });
    const signature = req.headers.get('stripe-signature');
    if (!signature) throw new Error('Missing stripe-signature header');

    const body = await req.text();
    // constructEventAsync is required in Deno — the sync version uses Node crypto.
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
    );

    const supabaseAdmin = createExternalClient();

    switch (event.type) {
      case 'account.updated':
      case 'capability.updated': {
        // capability.updated fires when the transfers capability activates —
        // re-fetch the parent account so we get the authoritative
        // charges_enabled / payouts_enabled flags.
        const accountId =
          event.type === 'account.updated'
            ? (event.data.object as Stripe.Account).id
            : (event.data.object as Stripe.Capability).account as string;
        const account = await stripe.accounts.retrieve(accountId);
        const onboarded = !!(account.charges_enabled && account.payouts_enabled);

        const { error } = await supabaseAdmin
          .from('affiliate_partners')
          .update({ stripe_onboarded: onboarded })
          .eq('stripe_account_id', account.id);

        if (error) console.error('Error updating stripe status:', error);
        console.log(`Account ${account.id} (${event.type}) — onboarded: ${onboarded}`);
        break;
      }

      case 'account.application.deauthorized': {
        const account = event.data.object as Stripe.Account;
        const { error } = await supabaseAdmin
          .from('affiliate_partners')
          .update({ stripe_onboarded: false })
          .eq('stripe_account_id', account.id);
        if (error) console.error('Error clearing onboarded flag:', error);
        console.log(`Account ${account.id} deauthorized`);
        break;
      }

      case 'transfer.created': {
        const transfer = event.data.object as Stripe.Transfer;
        console.log(`Transfer created: ${transfer.id} - $${(transfer.amount / 100).toFixed(2)}`);
        // Mark payout as paid if we recorded it
        await supabaseAdmin
          .from('affiliate_payouts')
          .update({ status: 'paid' })
          .eq('stripe_transfer_id', transfer.id);
        break;
      }

      case 'transfer.failed': {
        const transfer = event.data.object as Stripe.Transfer;
        console.error(`Transfer failed: ${transfer.id}`);
        const { error } = await supabaseAdmin
          .from('affiliate_payouts')
          .update({
            status: 'failed',
            failure_reason: 'Stripe transfer failed',
          })
          .eq('stripe_transfer_id', transfer.id);
        if (error) console.error('Error updating payout status:', error);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
