import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MINIMUM_PAYOUT = 10; // $10 minimum

function getNextPayoutDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  if (day < 15) {
    return new Date(year, month, 15).toISOString().split('T')[0];
  } else {
    // Next month 1st
    return new Date(year, month + 1, 1).toISOString().split('T')[0];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createExternalClient();
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2024-06-20',
    });

    // Find all affiliates eligible for payout
    const { data: affiliates, error: affError } = await supabaseAdmin
      .from('affiliate_partners')
      .select('*')
      .eq('stripe_onboarded', true)
      .gte('pending_balance', MINIMUM_PAYOUT)
      .in('status', ['active', 'approved']);

    if (affError) throw affError;

    if (!affiliates || affiliates.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No eligible affiliates for payout', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];
    const today = new Date().toISOString().split('T')[0];

    for (const affiliate of affiliates) {
      try {
        if (!affiliate.stripe_account_id) {
          console.log(`Skipping ${affiliate.id} - no Stripe account`);
          continue;
        }

        const payoutAmount = Math.floor(affiliate.pending_balance * 100); // Convert to cents

        if (payoutAmount < MINIMUM_PAYOUT * 100) {
          continue;
        }

        // Get pending commissions for this affiliate
        const { data: pendingCommissions } = await supabaseAdmin
          .from('affiliate_commissions')
          .select('id')
          .eq('affiliate_id', affiliate.id)
          .eq('status', 'pending');

        const commissionIds = pendingCommissions?.map(c => c.id) || [];

        // Create Stripe transfer
        const transfer = await stripe.transfers.create({
          amount: payoutAmount,
          currency: 'usd',
          destination: affiliate.stripe_account_id,
          metadata: {
            affiliate_id: affiliate.id,
            referral_code: affiliate.referral_code,
          },
        });

        // Create payout record
        const { data: payout, error: payoutError } = await supabaseAdmin
          .from('affiliate_payouts')
          .insert({
            affiliate_id: affiliate.id,
            amount: affiliate.pending_balance,
            commission_ids: commissionIds,
            status: 'paid',
            scheduled_date: today,
            paid_at: new Date().toISOString(),
            stripe_transfer_id: transfer.id,
          })
          .select()
          .single();

        if (payoutError) throw payoutError;

        // Update commissions to paid
        if (commissionIds.length > 0) {
          await supabaseAdmin
            .from('affiliate_commissions')
            .update({
              status: 'paid',
              paid_at: new Date().toISOString(),
              stripe_transfer_id: transfer.id,
            })
            .in('id', commissionIds);
        }

        // Update affiliate balance
        const nextPayoutDate = getNextPayoutDate();
        await supabaseAdmin
          .from('affiliate_partners')
          .update({
            pending_balance: 0,
            total_paid: (affiliate.total_paid || 0) + affiliate.pending_balance,
            next_payout_date: nextPayoutDate,
          })
          .eq('id', affiliate.id);

        results.push({
          affiliate_id: affiliate.id,
          amount: affiliate.pending_balance,
          status: 'paid',
          transfer_id: transfer.id,
        });

        console.log(`Payout processed: $${affiliate.pending_balance.toFixed(2)} to ${affiliate.referral_code} (${transfer.id})`);

      } catch (error) {
        console.error(`Payout failed for affiliate ${affiliate.id}:`, error);

        // Record failed payout
        await supabaseAdmin
          .from('affiliate_payouts')
          .insert({
            affiliate_id: affiliate.id,
            amount: affiliate.pending_balance,
            status: 'failed',
            scheduled_date: today,
            failure_reason: error.message,
          });

        results.push({
          affiliate_id: affiliate.id,
          amount: affiliate.pending_balance,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Process payouts error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
