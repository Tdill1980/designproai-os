/**
 * proof-revoke — Phase 2 of the Proof Approval System.
 *
 * Shop owner action. Accepts:
 *   - proof_id
 *   - reason (optional — free-form)
 *
 * Flips status → revoked (terminal). View URL stops working immediately
 * because get_proof_by_view_token() excludes revoked rows.
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RevokeRequest {
  proof_id: string;
  reason?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "Authentication required" }, 401);

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Invalid auth token" }, 401);
    const shopId = user.id;

    let body: RevokeRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    if (!body.proof_id) return jsonResponse({ error: "proof_id required" }, 400);

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: proof, error: fetchErr } = await db
      .from("proof_approvals")
      .select("id, status, shop_id")
      .eq("id", body.proof_id)
      .eq("shop_id", shopId)
      .single();
    if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);

    if (["approved", "declined", "revoked", "expired"].includes(proof.status)) {
      return jsonResponse(
        { error: `Cannot revoke a proof in terminal state '${proof.status}'` },
        409,
      );
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("x-real-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;

    const { error: updateErr } = await db
      .from("proof_approvals")
      .update({ status: "revoked" })
      .eq("id", proof.id);
    if (updateErr) {
      console.error("proof-revoke: update failed:", updateErr);
      return jsonResponse(
        { error: "Failed to revoke proof", detail: updateErr.message },
        500,
      );
    }

    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: "revoked",
      actor_role: "shop",
      actor_user_id: shopId,
      ip,
      user_agent: userAgent,
      payload: {
        reason: body.reason?.trim() || null,
        previous_status: proof.status,
      },
    });

    return jsonResponse({
      success: true,
      status: "revoked",
      revoked_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("proof-revoke: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error" }, 500);
  }
});
