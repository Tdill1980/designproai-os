import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * UPDATE-PROOF-STATUS
 * 
 * Public endpoint for customers to approve or request revisions on proofs.
 * Validates token and updates proof status accordingly.
 * 
 * POST body:
 * - token: string (required) - The proof access token
 * - action: 'approve' | 'request_revision' (required)
 * - customerNotes: string (optional) - Feedback for revisions
 */

interface UpdatePayload {
  token: string;
  action: 'approve' | 'request_revision';
  customerNotes?: string;
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: UpdatePayload = await req.json();
    
    const { token, action, customerNotes } = payload;

    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    if (!action || !['approve', 'request_revision'].includes(action)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid action' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`📝 Updating proof status: action=${action}, token=${token.substring(0, 8)}...`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Validate token exists and is not expired/revoked
    const { data: tokenRecord, error: tokenError } = await supabase
      .from('proof_access_tokens')
      .select('*, proofs(*)')
      .eq('token', token)
      .eq('revoked', false)
      .single();

    if (tokenError || !tokenRecord) {
      console.error('Token lookup error:', tokenError);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    // Check token expiry
    if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token has expired' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 410 }
      );
    }

    const proofId = tokenRecord.proof_id;

    // 2. Check if proof is already actioned
    const currentProof = tokenRecord.proofs;
    if (currentProof?.status === 'approved' || currentProof?.status === 'revision_requested') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'This proof has already been actioned',
          currentStatus: currentProof.status
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
      );
    }

    // 3. Build update payload
    const updateData: Record<string, unknown> = {
      status: action === 'approve' ? 'approved' : 'revision_requested',
      updated_at: new Date().toISOString(),
    };

    if (action === 'approve') {
      updateData.approved_at = new Date().toISOString();
    }

    if (action === 'request_revision' && customerNotes) {
      updateData.customer_notes = customerNotes;
    }

    // 4. Update proof record
    const { error: updateError } = await supabase
      .from('proofs')
      .update(updateData)
      .eq('id', proofId);

    if (updateError) {
      console.error('Proof update error:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update proof status' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    console.log(`✅ Proof ${proofId} updated to status: ${updateData.status}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        proofId,
        status: updateData.status,
        message: action === 'approve' 
          ? 'Design approved successfully' 
          : 'Revision request submitted'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Update proof status error:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
