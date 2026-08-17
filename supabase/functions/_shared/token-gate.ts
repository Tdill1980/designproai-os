// Shared render-token gate for every generative edge function.
//
// Each render or revision call in RestylePro spends ONE token. Tokens
// live in two backing systems that the gate falls through in order:
//
//   1) user_roles role = 'admin' | 'tester'   → bypass, no deduction
//   2) user_subscriptions monthly render cap  → increment render_count
//   3) user_tokens.balance                    → deduct via RPC
//
// If none of the three paths grant entry, the gate returns a 402 with
// enough detail for the client to show a paywall popup (buy tokens,
// $299 Production Pack, or upgrade tier).
//
// USAGE inside a render edge fn:
//
//   import { tokenGate } from "../_shared/token-gate.ts";
//   const gate = await tokenGate(req, { reason: "colorpro_render" });
//   if (!gate.ok) return gate.response;        // 401 / 402, fully formed
//
//   …run the render…
//
// The gate is deliberately tolerant on the deduct path — if the RPC
// throws (race, missing row), it falls back to a direct UPDATE so a
// momentary DB blip can't break a render that the user paid for.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "./cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export interface TokenGateResult {
  ok: boolean;
  userId?: string;
  /** "privileged" | "subscription" | "tokens" — which path granted entry */
  source?: "privileged" | "subscription" | "tokens";
  /** Tokens remaining AFTER this deduction (for client UI) */
  remaining?: number;
  /** Fully formed 401 / 402 response when ok=false. Edge fn just returns it. */
  response?: Response;
}

export interface TokenGateOptions {
  /** Cost in tokens (default 1). ProductionFlow Quick Prep packages are 5–10. */
  cost?: number;
  /** Free-text reason logged in token_transactions (e.g. "colorpro_render"). */
  reason?: string;
  /** Bypass the gate entirely — used by internal cron jobs that already paid. */
  skip?: boolean;
}

function deny(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/**
 * Run the three-step gate. Returns `{ ok: true, ... }` if the render
 * may proceed; returns `{ ok: false, response }` with a 401 (no user)
 * or 402 (no quota left) that the edge fn should return as-is.
 */
export async function tokenGate(
  req: Request,
  opts: TokenGateOptions = {},
): Promise<TokenGateResult> {
  const cost = Math.max(1, Math.floor(opts.cost ?? 1));
  const reason = opts.reason ?? "render";

  if (opts.skip) {
    return { ok: true, source: "privileged" };
  }

  // ── 1. Authenticate the caller from the JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return {
      ok: false,
      response: deny(401, {
        error: "Missing Authorization bearer token",
        code: "no_auth",
      }),
    };
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let userId: string;
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) {
      return {
        ok: false,
        response: deny(401, {
          error: "Invalid or expired session",
          code: "bad_auth",
        }),
      };
    }
    userId = data.user.id;
  } catch (e) {
    return {
      ok: false,
      response: deny(401, {
        error: `Auth lookup failed: ${(e as Error).message}`,
        code: "auth_failed",
      }),
    };
  }

  // ── 2. Privileged bypass (admin / tester role)
  // NOTE: do NOT use .maybeSingle() here — a user with more than one role
  // row (e.g. both `admin` AND `tester`, or duplicate rows) makes
  // maybeSingle() return an error + null data, which silently dropped
  // privileged users through to the paywall (the 402 storm). Fetch the
  // rows and treat ANY admin/tester row as a bypass. On a transient query
  // error, retry once before giving up so a DB hiccup can't 402 an admin.
  let privileged = false;
  for (let attempt = 0; attempt < 2 && !privileged; attempt++) {
    const { data: roleRows, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "tester"]);
    if (roleErr) {
      console.warn(
        `[token-gate] role lookup attempt ${attempt + 1} failed for ${userId}: ${roleErr.message}`,
      );
      continue;
    }
    if (Array.isArray(roleRows) && roleRows.length > 0) privileged = true;
    break;
  }
  if (privileged) {
    return { ok: true, userId, source: "privileged" };
  }

  // ── 3. Subscription cap path (paid tier with remaining renders this cycle)
  const { data: sub } = await admin
    .from("user_subscriptions")
    .select("tier, render_count, status")
    .eq("user_id", userId)
    .maybeSingle();

  const tier = sub?.tier ?? "free";
  const status = sub?.status ?? "inactive";
  const renderCount = Number(sub?.render_count ?? 0);

  const TIER_CAPS: Record<string, number> = {
    free: 0,
    starter: 50,
    advanced: 75,
    professional: 100,
    complete: 200,
    proshop: 200,
    enterprise: 999999,
    agency: 999999,
  };
  const cap = TIER_CAPS[tier] ?? 0;
  const subscriptionActive = status === "active" && cap > 0;
  const subscriptionRemaining = Math.max(0, cap - renderCount);

  if (subscriptionActive && subscriptionRemaining >= cost) {
    // Increment render_count; failure here is non-fatal — caller still
    // gets to render, but log it so we can reconcile.
    const { error: incErr } = await admin
      .from("user_subscriptions")
      .update({ render_count: renderCount + cost })
      .eq("user_id", userId);
    if (incErr) {
      console.warn(
        `[token-gate] subscription increment failed for ${userId}: ${incErr.message}`,
      );
    }
    return {
      ok: true,
      userId,
      source: "subscription",
      remaining: subscriptionRemaining - cost,
    };
  }

  // ── 4. Token pool path (user_tokens.balance ≥ cost → deduct)
  const { data: tokRow } = await admin
    .from("user_tokens")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  const balance = Number(tokRow?.balance ?? 0);

  if (balance >= cost) {
    let newBalance = balance - cost;
    try {
      const { data: rpcData, error: rpcErr } = await admin.rpc(
        "deduct_user_tokens",
        { p_user_id: userId, p_amount: cost, p_reason: reason },
      );
      if (rpcErr) throw rpcErr;
      if (rpcData && typeof rpcData === "object" && "balance" in (rpcData as Record<string, unknown>)) {
        const b = Number((rpcData as Record<string, unknown>).balance);
        if (!Number.isNaN(b)) newBalance = b;
      }
    } catch {
      // Fallback: direct update so a temporary RPC failure doesn't
      // break a render the user has tokens for.
      const { error: updErr } = await admin
        .from("user_tokens")
        .update({ balance: newBalance })
        .eq("user_id", userId);
      if (updErr) {
        return {
          ok: false,
          response: deny(500, {
            error: "Could not deduct token",
            code: "deduct_failed",
            detail: updErr.message,
          }),
        };
      }
    }
    return {
      ok: true,
      userId,
      source: "tokens",
      remaining: newBalance,
    };
  }

  // ── 5. Out of paths → paywall 402
  return {
    ok: false,
    response: deny(402, {
      error: "Out of tokens",
      code: "no_tokens",
      tier,
      subscription_active: subscriptionActive,
      subscription_remaining: subscriptionRemaining,
      token_balance: balance,
      cost,
      paywall: {
        buy_tokens: { cost_per_token: tier === "free" || tier === "starter" ? 30 : tier === "complete" || tier === "enterprise" ? 15 : 20 },
        production_pack: { price: 299 },
        upgrade_tier: { current: tier },
      },
    }),
  };
}

/**
 * Refund a token previously spent via tokenGate. Use when a render
 * fails AFTER the gate granted entry (e.g. Gemini 500) so the user
 * doesn't lose their token to an outage.
 */
export async function refundToken(
  userId: string,
  cost = 1,
  reason = "render_failed_refund",
): Promise<void> {
  if (!userId) return;
  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    await admin.rpc("add_user_tokens", {
      p_user_id: userId,
      p_amount: cost,
      p_reason: reason,
    });
  } catch (e) {
    console.warn(`[token-gate] refund failed for ${userId}: ${(e as Error).message}`);
  }
}
