/**
 * grant-welcome-tokens — DISABLED (free tier retired).
 *
 * The automatic 3-token welcome grant has been turned off. RestylePro no
 * longer ships a standing "free tier": new signups receive 0 free tokens
 * and go straight to the token/paywall flow. The free-trial experience
 * now lives in the anonymous, pre-login DesignProAI trial instead.
 *
 * This endpoint is intentionally kept (not deleted) so existing Signup.tsx
 * callers still get a clean 200. It now grants nothing and returns
 * { granted: false, reason: "welcome_grant_disabled" }. To re-enable,
 * remove the early return marked "DISABLED" in the handler below.
 *
 * --- Original behaviour (retired) ------------------------------------
 * Idempotent 3-token welcome grant for every new signup.
 *
 * Called from Signup.tsx immediately after auth.signUp succeeds. Guarantees
 * that every new RestylePro account gets exactly ONE 3-token welcome grant
 * regardless of how many times the client retries.
 *
 * Distinct from grant-wpw-tokens (which is reserved for WPW-linked accounts
 * and keys idempotency off reason='wpw_signup_grant'). This function uses
 * reason='welcome_signup_grant' so a non-WPW user can later link a WPW
 * account and still receive the separate WPW grant.
 *
 * Idempotency strategy:
 *   1. Check token_transactions for any prior row whose `reason` starts
 *      with `welcome_signup_grant` for this user.
 *   2. If found → 200 { granted: false, reason: "already_granted" }
 *   3. Else → call add_user_tokens(user, 3, 'welcome_signup_grant')
 *      and return { granted: true, new_balance }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Free tier retired — flip to true to restore the automatic welcome grant.
const WELCOME_GRANT_ENABLED = false;
const WELCOME_GRANT_AMOUNT = 3;
const WELCOME_GRANT_REASON = "welcome_signup_grant";

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

  // DISABLED: free tier retired — grant nothing on signup. Kept as a clean
  // no-op so the Signup.tsx caller still receives a 200. Flip
  // WELCOME_GRANT_ENABLED to restore the 3-token welcome grant.
  if (!WELCOME_GRANT_ENABLED) {
    return json({ granted: false, reason: "welcome_grant_disabled", new_balance: 0 }, 200);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "no_auth", granted: false }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let userId: string;
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) return json({ error: "bad_auth", granted: false }, 401);
    userId = data.user.id;
  } catch (e) {
    return json({ error: `auth_failed:${(e as Error).message}`, granted: false }, 401);
  }

  const { data: priorGrant } = await admin
    .from("token_transactions")
    .select("id")
    .eq("user_id", userId)
    .like("reason", `${WELCOME_GRANT_REASON}%`)
    .maybeSingle();
  if (priorGrant) {
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

  try {
    const { error: rpcErr } = await admin.rpc("add_user_tokens", {
      p_user_id: userId,
      p_amount: WELCOME_GRANT_AMOUNT,
      p_reason: WELCOME_GRANT_REASON,
    });
    if (rpcErr) throw rpcErr;
  } catch (e) {
    console.warn(`[grant-welcome-tokens] RPC failed, falling back: ${(e as Error).message}`);
    const { data: tok } = await admin
      .from("user_tokens")
      .select("balance, total_purchased")
      .eq("user_id", userId)
      .maybeSingle();
    const prevBal = Number(tok?.balance ?? 0);
    const prevPurchased = Number(tok?.total_purchased ?? 0);
    const next = prevBal + WELCOME_GRANT_AMOUNT;
    const { error: upsertErr } = await admin
      .from("user_tokens")
      .upsert({
        user_id: userId,
        balance: next,
        total_purchased: prevPurchased + WELCOME_GRANT_AMOUNT,
        updated_at: new Date().toISOString(),
      });
    if (upsertErr) {
      return json({
        granted: false,
        reason: "grant_failed",
        error: upsertErr.message,
      }, 500);
    }
    await admin.from("token_transactions").insert({
      user_id: userId,
      amount: WELCOME_GRANT_AMOUNT,
      reason: WELCOME_GRANT_REASON,
      balance_after: next,
    });
  }

  const { data: tokAfter } = await admin
    .from("user_tokens")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();

  return json({
    granted: true,
    amount: WELCOME_GRANT_AMOUNT,
    reason: WELCOME_GRANT_REASON,
    new_balance: Number(tokAfter?.balance ?? WELCOME_GRANT_AMOUNT),
  }, 200);
});
