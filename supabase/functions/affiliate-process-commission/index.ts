import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const { user_id, subscription_amount, subscription_plan, referral_code, period_start, period_end } = await req.json();

    if (!user_id || !subscription_amount) {
      throw new Error('user_id and subscription_amount are required');
    }

    const supabaseAdmin = createExternalClient();

    // Find the referral for this user
    let referral;

    if (referral_code) {
      // Look up by referral code
      const { data: affiliate } = await supabaseAdmin
        .from('affiliate_partners')
        .select('id')
        .eq('referral_code', referral_code.toUpperCase())
        .single();

      if (affiliate) {
        const { data } = await supabaseAdmin
          .from('affiliate_referrals')
          .select('*, affiliate_partners!inner(id, commission_rate, pending_balance, total_earned)')
          .eq('affiliate_id', affiliate.id)
          .eq('referred_user_id', user_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        referral = data;
      }
    }

    // Fallback: look up referral by user_id across all affiliates
    if (!referral) {
      const { data } = await supabaseAdmin
        .from('affiliate_referrals')
        .select('*, affiliate_partners!inner(id, commission_rate, pending_balance, total_earned)')
        .eq('referred_user_id', user_id)
        .in('status', ['signed_up', 'subscribed', 'active'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      referral = data;
    }

    if (!referral) {
      return new Response(
        JSON.stringify({ success: false, message: 'No affiliate referral found for this user' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const affiliateData = referral.affiliate_partners;
    const commissionRate = affiliateData.commission_rate || 0.20;
    const commissionAmount = subscription_amount * commissionRate;

    // Create commission record
    const { data: commission, error: commError } = await supabaseAdmin
      .from('affiliate_commissions')
      .insert({
        affiliate_id: affiliateData.id,
        referral_id: referral.id,
        amount: commissionAmount,
        type: 'recurring',
        status: 'pending',
        period_start: period_start || null,
        period_end: period_end || null,
      })
      .select()
      .single();

    if (commError) throw commError;

    // Update affiliate pending balance and total earned
    const newPendingBalance = (affiliateData.pending_balance || 0) + commissionAmount;
    const newTotalEarned = (affiliateData.total_earned || 0) + commissionAmount;

    await supabaseAdmin
      .from('affiliate_partners')
      .update({
        pending_balance: newPendingBalance,
        total_earned: newTotalEarned,
      })
      .eq('id', affiliateData.id);

    // Update referral status to active and commission amount
    await supabaseAdmin
      .from('affiliate_referrals')
      .update({
        status: 'active',
        subscription_plan: subscription_plan || referral.subscription_plan,
        monthly_value: subscription_amount,
        commission_amount: commissionAmount,
      })
      .eq('id', referral.id);

    console.log(`Commission created: $${commissionAmount.toFixed(2)} for affiliate ${affiliateData.id}`);

    return new Response(
      JSON.stringify({ success: true, commission }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Process commission error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
