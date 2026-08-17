/**
 * grant-wpw-tokens — Idempotent 3-token grant for WPW customers.
 *
 * Called from useAutoLinkWpw immediately after wpw-oauth-link confirms
 * a woo_customer_id is on the user. Guarantees that every WPW shop
 * gets exactly ONE 3-token try-and-buy grant, no matter how many times
 * the auto-link hook fires.
 *
 * Idempotency strategy:
 *   1. Confirm the calling user has a non-null woo_customer_id
 *      (only WPW-linked users qualify for the grant).
 *   2. Check token_transactions for any prior row whose `reason`
 *      starts with `wpw_signup_grant` for this user.
 *   3. If found → 200 { granted: false, reason: "already_granted" }
 *   4. Else → call add_user_tokens(user, 3, 'wpw_signup_grant')
 *      and return { granted: true, new_balance }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const WPW_GRANT_AMOUNT = 3;
const WPW_GRANT_REASON = "wpw_signup_grant";

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
  if (!jwt) return json({ error: "no_auth", granted: false }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Identify caller
  let userId: string;
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) return json({ error: "bad_auth", granted: false }, 401);
    userId = data.user.id;
  } catch (e) {
    return json({ error: `auth_failed:${(e as Error).message}`, granted: false }, 401);
  }

  // 2. Must be a WPW customer (woo_customer_id present)
  const { data: sub } = await admin
    .from("user_subscriptions")
    .select("woo_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  const wooId = sub?.woo_customer_id ?? null;
  if (!wooId) {
    return json({
      granted: false,
      reason: "not_wpw_customer",
      message: "Token grant is reserved for WPW-linked accounts.",
    }, 200);
  }

  // 3. Idempotency check — any prior grant transaction?
  const { data: priorGrant } = await admin
    .from("token_transactions")
    .select("id")
    .eq("user_id", userId)
    .like("reason", `${WPW_GRANT_REASON}%`)
    .maybeSingle();
  if (priorGrant) {
    // Return current balance for the client.
    const { data: tok } = await admin
      .from("user_tokens")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();
    return json({
      granted: false,
      reason: "already_granted",
      new_balance: Number(tok?.balance ?? 0),
    }, 200);
  }

  // 4. Grant 3 tokens via RPC. Falls back to direct upsert if the RPC
  //    misbehaves so a temporary DB hiccup never blocks a WPW shop's
  //    first-time grant.
  try {
    const { error: rpcErr } = await admin.rpc("add_user_tokens", {
      p_user_id: userId,
      p_amount: WPW_GRANT_AMOUNT,
      p_reason: WPW_GRANT_REASON,
    });
    if (rpcErr) throw rpcErr;
  } catch (e) {
    console.warn(`[grant-wpw-tokens] RPC failed, falling back: ${(e as Error).message}`);
    const { data: tok } = await admin
      .from("user_tokens")
      .select("balance, total_purchased")
      .eq("user_id", userId)
      .maybeSingle();
    const prevBal = Number(tok?.balance ?? 0);
    const prevPurchased = Number(tok?.total_purchased ?? 0);
    const next = prevBal + WPW_GRANT_AMOUNT;
    const { error: upsertErr } = await admin
      .from("user_tokens")
      .upsert({
        user_id: userId,
        balance: next,
        total_purchased: prevPurchased + WPW_GRANT_AMOUNT,
        updated_at: new Date().toISOString(),
      });
    if (upsertErr) {
      return json({
        granted: false,
        reason: "grant_failed",
        error: upsertErr.message,
      }, 500);
    }
    // Log the transaction manually for audit + idempotency lookup.
    await admin.from("token_transactions").insert({
      user_id: userId,
      amount: WPW_GRANT_AMOUNT,
      reason: WPW_GRANT_REASON,
      balance_after: next,
    });
  }

  // 5. Read the fresh balance for the client.
  const { data: tokAfter } = await admin
    .from("user_tokens")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();

  return json({
    granted: true,
    amount: WPW_GRANT_AMOUNT,
    reason: WPW_GRANT_REASON,
    new_balance: Number(tokAfter?.balance ?? WPW_GRANT_AMOUNT),
  }, 200);
});
