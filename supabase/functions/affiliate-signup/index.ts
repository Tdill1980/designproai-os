import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient, createExternalAnonClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { full_name, email, company_name, phone, website, instagram_handle } = await req.json();

    if (!full_name || !email) {
      throw new Error('Full name and email are required');
    }

    const supabaseAdmin = createExternalClient();
    const supabaseAnon = createExternalAnonClient();

    // Get current user from auth header
    const authHeader = req.headers.get('Authorization');
    let userId: string;

    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: userData, error: userError } = await supabaseAnon.auth.getUser(token);
      if (userError || !userData.user) {
        throw new Error('User not authenticated');
      }
      userId = userData.user.id;
    } else {
      throw new Error('Authorization header required');
    }

    // Check if user already has an affiliate record
    const { data: existing } = await supabaseAdmin
      .from('affiliate_partners')
      .select('id, status')
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ error: 'You already have an affiliate application', status: existing.status }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate unique referral code
    let referralCode = generateReferralCode();
    let codeExists = true;
    let attempts = 0;

    while (codeExists && attempts < 10) {
      const { data: codeCheck } = await supabaseAdmin
        .from('affiliate_partners')
        .select('id')
        .eq('referral_code', referralCode)
        .maybeSingle();

      if (!codeCheck) {
        codeExists = false;
      } else {
        referralCode = generateReferralCode();
        attempts++;
      }
    }

    const referralLink = `https://restyleproai.com/?ref=${referralCode}`;

    // Check if user has admin or tester role — auto-approve them
    const { data: roleData } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['admin', 'tester'])
      .maybeSingle();

    const autoApprove = !!roleData;

    // Create affiliate record
    // Auto-approved users get 'approved' (not 'active') so they still go through onboarding wizard
    const { data: affiliate, error: insertError } = await supabaseAdmin
      .from('affiliate_partners')
      .insert({
        user_id: userId,
        full_name,
        email,
        company_name: company_name || null,
        phone: phone || null,
        website: website || null,
        instagram_handle: instagram_handle || null,
        referral_code: referralCode,
        referral_link: referralLink,
        status: autoApprove ? 'approved' : 'pending',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      throw new Error('Failed to create affiliate application');
    }

    console.log(`New affiliate ${autoApprove ? '(auto-approved)' : 'application'}: ${full_name} (${email}) - Code: ${referralCode}`);

    return new Response(
      JSON.stringify({ success: true, affiliate }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Affiliate signup error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
