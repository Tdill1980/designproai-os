/**
 * proof-revert-version — Phase 4.
 *
 * Flips is_active on a prior proof_versions row. Both the customer (via
 * view token) and the shop (via proof_id + auth) can revert — the design
 * brief is explicit that "Revert button always available, never destructive."
 *
 * Two request shapes:
 *   Customer: { token, target_version_id }
 *   Shop:     { proof_id, target_version_id }  + Authorization header
 *
 * Both audit to proof_events as 'reverted' with actor_role set correctly.
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyProofToken } from "../_shared/proof-tokens.ts";
import { userTeamShopIds } from "../_shared/proof-team-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
};

interface RevertRequest {
  token?: string;
  proof_id?: string;
  target_version_id: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    let body: RevertRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    if (!body.target_version_id) {
      return jsonResponse({ error: "target_version_id required" }, 400);
    }
    if (!body.token && !body.proof_id) {
      return jsonResponse({ error: "token or proof_id required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Resolve the proof + actor role
    let proofId: string | null = null;
    let actorRole: "customer" | "shop" = "customer";
    let actorUserId: string | null = null;

    if (body.token) {
      let verifiedUuid: string | null;
      try {
        verifiedUuid = await verifyProofToken(body.token, "view");
      } catch (err) {
        console.error("proof-revert-version: token verify threw:", err);
        return jsonResponse({ error: "Server misconfiguration" }, 500);
      }
      if (!verifiedUuid) return jsonResponse({ error: "Invalid token" }, 404);

      const { data: proof, error: fetchErr } = await db
        .from("proof_approvals")
        .select("id, status, mode, expires_at")
        .eq("view_token", body.token)
        .single();
      if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);
      if (proof.mode !== "revision_loop") {
        return jsonResponse(
          { error: "Revert only available on revision-loop proofs" },
          409,
        );
      }
      if (["approved", "declined", "revoked", "expired"].includes(proof.status)) {
        return jsonResponse({ error: `Proof is ${proof.status}` }, 409);
      }
      if (proof.expires_at && new Date(proof.expires_at) < new Date()) {
        return jsonResponse({ error: "Proof has expired" }, 410);
      }
      proofId = proof.id;
      actorRole = "customer";
    } else {
      // Shop path — require auth + proof ownership
      const authHeader = req.headers.get("authorization");
      if (!authHeader) return jsonResponse({ error: "Authentication required" }, 401);
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await authClient.auth.getUser();
      if (authError || !user) return jsonResponse({ error: "Invalid auth token" }, 401);

      // Team-scoped access (mirrors proof_approvals RLS) so a teammate can
      // switch versions on a shared shop's proof. Fails safe to owner-only.
      const allowedShopIds = await userTeamShopIds(db, user.id);
      const { data: proof, error: fetchErr } = await db
        .from("proof_approvals")
        .select("id, status, mode")
        .eq("id", body.proof_id)
        .in("shop_id", allowedShopIds)
        .single();
      if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);
      if (["approved", "declined", "revoked", "expired"].includes(proof.status)) {
        return jsonResponse({ error: `Proof is ${proof.status}` }, 409);
      }
      proofId = proof.id;
      actorRole = "shop";
      actorUserId = user.id;
    }

    // Validate the target version belongs to this proof
    const { data: target, error: targetErr } = await db
      .from("proof_versions")
      .select("id, version_number, is_active")
      .eq("id", body.target_version_id)
      .eq("proof_id", proofId!)
      .single();
    if (targetErr || !target) {
      return jsonResponse({ error: "Target version not found on this proof" }, 404);
    }
    if (target.is_active) {
      return jsonResponse({
        success: true,
        already_active: true,
        version_id: target.id,
        version_number: target.version_number,
      });
    }

    // Capture previous-active for the audit payload
    const { data: prior } = await db
      .from("proof_versions")
      .select("id, version_number")
      .eq("proof_id", proofId!)
      .eq("is_active", true)
      .maybeSingle();

    // Flip flags atomically (deactivate then activate)
    const { error: deactivateErr } = await db
      .from("proof_versions")
      .update({ is_active: false })
      .eq("proof_id", proofId!)
      .eq("is_active", true);
    if (deactivateErr) {
      console.error("proof-revert-version: deactivate failed:", deactivateErr);
      return jsonResponse(
        { error: "Failed to deactivate current version", detail: deactivateErr.message },
        500,
      );
    }

    const { error: activateErr } = await db
      .from("proof_versions")
      .update({ is_active: true })
      .eq("id", target.id);
    if (activateErr) {
      // Best effort: re-activate the prior
      if (prior) {
        await db
          .from("proof_versions")
          .update({ is_active: true })
          .eq("id", prior.id);
      }
      console.error("proof-revert-version: activate failed:", activateErr);
      return jsonResponse(
        { error: "Failed to activate target version", detail: activateErr.message },
        500,
      );
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("x-real-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;

    await db.from("proof_events").insert({
      proof_id: proofId!,
      event_type: "reverted",
      actor_role: actorRole,
      actor_user_id: actorUserId,
      ip,
      user_agent: userAgent,
      payload: {
        from_version_id: prior?.id || null,
        from_version_number: prior?.version_number || null,
        to_version_id: target.id,
        to_version_number: target.version_number,
      },
    });

    return jsonResponse({
      success: true,
      active_version_id: target.id,
      active_version_number: target.version_number,
    });
  } catch (err: any) {
    console.error("proof-revert-version: unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected server error", detail: err?.message },
      500,
    );
  }
});
