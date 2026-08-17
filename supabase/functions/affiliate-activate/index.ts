import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient, createExternalAnonClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createExternalClient();
    const supabaseAnon = createExternalAnonClient();

    // Verify the caller is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Authorization header required');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabaseAnon.auth.getUser(token);
    if (userError || !userData.user) {
      throw new Error('User not authenticated');
    }

    const { affiliate_id } = await req.json();
    if (!affiliate_id) {
      throw new Error('affiliate_id is required');
    }

    // Verify the affiliate belongs to this user
    const { data: affiliate, error: fetchError } = await supabaseAdmin
      .from('affiliate_partners')
      .select('id, user_id, status')
      .eq('id', affiliate_id)
      .single();

    if (fetchError || !affiliate) {
      throw new Error('Affiliate record not found');
    }

    if (affiliate.user_id !== userData.user.id) {
      throw new Error('Not authorized to activate this affiliate');
    }

    if (affiliate.status === 'active') {
      return new Response(
        JSON.stringify({ success: true, message: 'Already active' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (affiliate.status !== 'approved') {
      throw new Error('Only approved affiliates can be activated through onboarding');
    }

    // Activate the affiliate
    const { error: updateError } = await supabaseAdmin
      .from('affiliate_partners')
      .update({ status: 'active' })
      .eq('id', affiliate_id);

    if (updateError) {
      console.error('Update error:', updateError);
      throw new Error('Failed to activate affiliate');
    }

    console.log(`Affiliate ${affiliate_id} activated via onboarding wizard`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Affiliate activate error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
