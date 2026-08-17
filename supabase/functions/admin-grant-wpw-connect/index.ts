/**
 * admin-grant-wpw-connect — Manual WPW Connect Portal enrollment.
 *
 * Some WPW customers sign up for RestylePro with a different email
 * than their WooCommerce order email. The auto-link in
 * useAutoLinkWpw can't catch those, so the team has to enroll them
 * by hand. This function is the single safe path for that.
 *
 * Caller must have user_roles.role = 'admin'. The function:
 *   1. Verifies the caller is an admin (service-role lookup).
 *   2. Looks up the RestylePro user by email.
 *   3. Upserts user_subscriptions with the provided woo_customer_id.
 *   4. Fires grant-wpw-tokens for that user via add_user_tokens RPC
 *      (idempotent — won't double-grant).
 *
 * Body:
 *   { user_email: string, woo_customer_id: number, note?: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const WPW_GRANT_AMOUNT = 3;
const WPW_GRANT_REASON_MANUAL = "wpw_signup_grant_manual";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "no_auth" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Identify caller and confirm admin role.
  let callerId: string;
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) return json({ error: "bad_auth" }, 401);
    callerId = data.user.id;
  } catch (e) {
    return json({ error: `auth_failed:${(e as Error).message}` }, 401);
  }

  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) {
    return json({ error: "admin_role_required" }, 403);
  }

  // 2. Parse + validate inputs.
  let body: { user_email?: string; woo_customer_id?: number | string; note?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const userEmail = String(body.user_email ?? "").trim().toLowerCase();
  const wooCustomerId = Number(body.woo_customer_id);
  const note = String(body.note ?? "").slice(0, 280);
  if (!userEmail) return json({ error: "user_email_required" }, 400);
  if (!Number.isFinite(wooCustomerId) || wooCustomerId <= 0) {
    return json({ error: "woo_customer_id_required_numeric" }, 400);
  }

  // 3. Find the RestylePro user by email.
  const { data: targetUsers, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) return json({ error: `user_lookup_failed:${listErr.message}` }, 500);
  const target = targetUsers.users.find(
    (u) => (u.email ?? "").toLowerCase() === userEmail,
  );
  if (!target) {
    return json(
      {
        error: "user_not_found",
        message: `No RestylePro account with email ${userEmail}`,
      },
      404,
    );
  }
  const targetUserId = target.id;

  // 4. Upsert the subscription row with the woo_customer_id.
  const { data: existingSub } = await admin
    .from("user_subscriptions")
    .select("id, tier, status, woo_customer_id")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (existingSub) {
    const { error: updErr } = await admin
      .from("user_subscriptions")
      .update({
        woo_customer_id: wooCustomerId,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq("id", (existingSub as { id: string }).id);
    if (updErr) {
      return json({ error: `subscription_update_failed:${updErr.message}` }, 500);
    }
  } else {
    const { error: insErr } = await admin
      .from("user_subscriptions")
      .insert({
        user_id: targetUserId,
        email: userEmail,
        tier: "free",
        status: "free",
        woo_customer_id: wooCustomerId,
      } as Record<string, unknown>);
    if (insErr) {
      return json({ error: `subscription_insert_failed:${insErr.message}` }, 500);
    }
  }

  // 5. Token grant — idempotent. Check prior wpw_signup_grant rows
  //    (manual or auto) before adding so a re-run never double-grants.
  let granted = false;
  let newBalance = 0;
  const { data: priorGrant } = await admin
    .from("token_transactions")
    .select("id")
    .eq("user_id", targetUserId)
    .like("reason", "wpw_signup_grant%")
    .maybeSingle();

  if (!priorGrant) {
    try {
      const { error: rpcErr } = await admin.rpc("add_user_tokens", {
        p_user_id: targetUserId,
        p_amount: WPW_GRANT_AMOUNT,
        p_reason: `${WPW_GRANT_REASON_MANUAL}:by=${callerId}${note ? `:note=${note}` : ""}`,
      });
      if (rpcErr) throw rpcErr;
      granted = true;
    } catch (e) {
      // Fall back to direct upsert + manual transaction insert so a
      // missing RPC environment doesn't block the grant.
      const { data: tok } = await admin
        .from("user_tokens")
        .select("balance, total_purchased")
        .eq("user_id", targetUserId)
        .maybeSingle();
      const prevBal = Number((tok as { balance?: number } | null)?.balance ?? 0);
      const prevPurchased = Number(
        (tok as { total_purchased?: number } | null)?.total_purchased ?? 0,
      );
      const next = prevBal + WPW_GRANT_AMOUNT;
      const { error: upsertErr } = await admin
        .from("user_tokens")
        .upsert({
          user_id: targetUserId,
          balance: next,
          total_purchased: prevPurchased + WPW_GRANT_AMOUNT,
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>);
      if (!upsertErr) {
        await admin.from("token_transactions").insert({
          user_id: targetUserId,
          amount: WPW_GRANT_AMOUNT,
          reason: `${WPW_GRANT_REASON_MANUAL}:by=${callerId}${note ? `:note=${note}` : ""}`,
          balance_after: next,
        } as Record<string, unknown>);
        granted = true;
        newBalance = next;
      } else {
        console.error("[admin-grant-wpw-connect] fallback grant failed", upsertErr.message);
      }
    }
  }

  // Read final balance for the UI.
  const { data: tokFinal } = await admin
    .from("user_tokens")
    .select("balance")
    .eq("user_id", targetUserId)
    .maybeSingle();
  newBalance = Number((tokFinal as { balance?: number } | null)?.balance ?? newBalance);

  return json({
    success: true,
    user_id: targetUserId,
    user_email: userEmail,
    woo_customer_id: wooCustomerId,
    token_grant: granted ? "applied" : "already_granted_prior",
    new_balance: newBalance,
  }, 200);
});
