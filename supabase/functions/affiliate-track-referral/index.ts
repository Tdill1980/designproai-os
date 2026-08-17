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
    const { referral_code, action, user_id, email, subscription_plan, monthly_value } = await req.json();

    if (!referral_code) {
      throw new Error('Referral code is required');
    }

    const supabaseAdmin = createExternalClient();

    // Validate referral code exists and affiliate is active
    const { data: affiliate, error: affError } = await supabaseAdmin
      .from('affiliate_partners')
      .select('id, status, referral_code')
      .eq('referral_code', referral_code.toUpperCase())
      .single();

    if (affError || !affiliate) {
      throw new Error('Invalid referral code');
    }

    if (affiliate.status !== 'active' && affiliate.status !== 'approved') {
      throw new Error('Affiliate is not active');
    }

    // Handle different tracking actions
    switch (action) {
      case 'click': {
        // Record a click/visit
        const { data: referral, error: insertError } = await supabaseAdmin
          .from('affiliate_referrals')
          .insert({
            affiliate_id: affiliate.id,
            referral_code_used: referral_code.toUpperCase(),
            status: 'clicked',
            referred_email: email || null,
          })
          .select()
          .single();

        if (insertError) throw insertError;

        // Increment total referrals count
        await supabaseAdmin.rpc('increment_affiliate_referrals', {
          p_affiliate_id: affiliate.id,
        }).catch(() => {
          // If RPC doesn't exist, do manual update
          return supabaseAdmin
            .from('affiliate_partners')
            .update({ total_referrals: (affiliate as any).total_referrals + 1 })
            .eq('id', affiliate.id);
        });

        return new Response(
          JSON.stringify({ success: true, referral_id: referral.id }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'signup': {
        // Update existing referral to signed_up or create new one
        if (user_id) {
          const { data: existing } = await supabaseAdmin
            .from('affiliate_referrals')
            .select('id')
            .eq('affiliate_id', affiliate.id)
            .eq('referred_email', email)
            .eq('status', 'clicked')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existing) {
            await supabaseAdmin
              .from('affiliate_referrals')
              .update({
                status: 'signed_up',
                referred_user_id: user_id,
                converted_at: new Date().toISOString(),
              })
              .eq('id', existing.id);
          } else {
            await supabaseAdmin
              .from('affiliate_referrals')
              .insert({
                affiliate_id: affiliate.id,
                referred_user_id: user_id,
                referred_email: email,
                referral_code_used: referral_code.toUpperCase(),
                status: 'signed_up',
                converted_at: new Date().toISOString(),
              });
          }
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'subscribed': {
        // Update referral to subscribed status
        if (!user_id) throw new Error('user_id required for subscription tracking');

        const { data: referral } = await supabaseAdmin
          .from('affiliate_referrals')
          .select('id')
          .eq('affiliate_id', affiliate.id)
          .eq('referred_user_id', user_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (referral) {
          const commissionAmount = (monthly_value || 0) * 0.20;

          await supabaseAdmin
            .from('affiliate_referrals')
            .update({
              status: 'subscribed',
              subscription_plan: subscription_plan || null,
              monthly_value: monthly_value || null,
              commission_amount: commissionAmount,
              converted_at: new Date().toISOString(),
            })
            .eq('id', referral.id);
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        throw new Error('Invalid action. Use: click, signup, or subscribed');
    }
  } catch (error) {
    console.error('Track referral error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
