// ──────────────────────────────────────────────────────────────────────
// wpw-oauth-link
//
// Links a RestylePro user to their WePrintWraps customer record.
//
// Modes:
//   - "lookup"     (default): look up the WPW customer by email (the auth
//                  user's email on this RestylePro account). If found,
//                  write user_subscriptions.woo_customer_id.
//   - "byEmail":   { email: string } — user-provided alternate email
//                  (e.g. company billing alias). Restricted to emails on
//                  the same domain as the auth user's email so an admin
//                  at hercompany.com can link billing@hercompany.com but
//                  not ceo@somethingelse.com.
//   - "byId":      { wooCustomerId: number } — admin/dev link, still
//                  verifies the customer's email matches this account.
//   - "requestOtp": { email: string } — send a 6-digit verification code
//                  to ANY email (cross-domain ok). Used when the WPW
//                  account is on a different domain (e.g. shop signed up
//                  under their LLC's domain but their WPW orders are
//                  under a personal gmail). Email-ownership of the alt
//                  inbox is the proof of authorization, not domain match.
//   - "verifyOtp": { email: string, code: string } — verify the code
//                  and complete the link. Bypasses domain check on success.
//
// Body: { mode?, email?, code?, wooCustomerId? }
//
// Part of Phase 1 — WPW PrintPro Gateway.
// See docs/OPERATION-EXPAND-THE-WRAP-INDUSTRY.md
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { corsHeaders } from "../_shared/cors.ts";
import { WooCustomer, wooFetch } from "../_shared/woo-client.ts";

const OTP_TTL_SECONDS = 600; // 10 min
const OTP_MAX_ATTEMPTS = 5;
const OTP_RATE_LIMIT_PER_15MIN = 3;

function createServiceClient() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

async function authedUser(req: Request): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id, email: data.user.email || null };
}

async function findCustomerByEmail(email: string): Promise<WooCustomer | null> {
  const list = await wooFetch<WooCustomer[]>(
    `/customers?email=${encodeURIComponent(email)}&per_page=5`,
  );
  if (!Array.isArray(list) || list.length === 0) return null;
  const lower = email.toLowerCase();
  return list.find((c) => (c.email || "").toLowerCase() === lower) || list[0];
}

async function findCustomerById(id: number): Promise<WooCustomer | null> {
  try {
    return await wooFetch<WooCustomer>(`/customers/${id}`);
  } catch {
    return null;
  }
}

function generateOtpCode(): string {
  const n = Math.floor(Math.random() * 1_000_000);
  return n.toString().padStart(6, "0");
}

async function hashOtp(userId: string, code: string): Promise<string> {
  const buf = new TextEncoder().encode(`${userId}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sendOtpEmail(altEmail: string, code: string) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.warn("[wpw-oauth-link] RESEND_API_KEY not set — OTP email not sent");
    throw new Error("email service not configured");
  }
  const resend = new Resend(resendKey);
  const { error } = await resend.emails.send({
    from: "RestylePro <noreply@restyleproai.com>",
    to: [altEmail],
    subject: `Your WePrintWraps link code: ${code}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;color:#fff;border-radius:16px;">
        <h2 style="margin:0 0 8px;font-size:20px;color:#06b6d4;">Link your WePrintWraps account</h2>
        <p style="margin:0 0 16px;color:#cbd5e1;font-size:14px;line-height:1.5;">
          Use this 6-digit code to confirm you own this email address and link
          your WePrintWraps order history to your RestylePro dashboard.
        </p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;background:#111;border:1px solid #333;border-radius:12px;padding:18px;margin:16px 0;color:#06b6d4;">
          ${code}
        </div>
        <p style="margin:0;color:#64748b;font-size:12px;">
          This code expires in 10 minutes. If you didn't request it, you can ignore this email.
        </p>
      </div>
    `,
  });
  if (error) {
    console.error("[wpw-oauth-link] Resend send failed", error);
    throw new Error("failed to send code");
  }
}

async function linkCustomerToUser(
  sb: ReturnType<typeof createServiceClient>,
  userId: string,
  customer: WooCustomer,
) {
  const { data: existing } = await sb
    .from("user_subscriptions")
    .select("id, tier, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    const { error: updErr } = await sb
      .from("user_subscriptions")
      .update({ woo_customer_id: customer.id })
      .eq("id", existing.id);
    if (updErr) throw updErr;
  } else {
    const { error: insErr } = await sb.from("user_subscriptions").insert({
      user_id: userId,
      tier: "free",
      status: "active",
      woo_customer_id: customer.id,
    });
    if (insErr) throw insErr;
  }

  await sb
    .from("wpw_orders")
    .update({ user_id: userId })
    .eq("woo_customer_id", customer.id)
    .is("user_id", null);

  await grantWelcomeTokens(sb, userId);
}

// WPW Connect Portal welcome: 3 design tokens for any user who came
// through the campaign signup flow (?wpw=1). Granted whether or not
// their email matches a Woo customer record, so wrap shops whose
// signup email differs from the one WPW has on file still get the
// promised $75 of design value. Idempotent — same user never re-grants.
const WELCOME_REASON = "WPW Connect Portal welcome";
// Free tier retired — flip to true to restore the WPW welcome grant.
const WPW_WELCOME_GRANT_ENABLED = false;
async function grantWelcomeTokens(sb: any, userId: string) {
  // DISABLED: free tier retired — WPW Connect signups no longer receive an
  // automatic 3-token welcome grant. Flip WPW_WELCOME_GRANT_ENABLED to restore.
  if (!WPW_WELCOME_GRANT_ENABLED) return;
  const { data: already } = await sb
    .from("token_transactions")
    .select("id")
    .eq("user_id", userId)
    .eq("reason", WELCOME_REASON)
    .limit(1)
    .maybeSingle();
  if (already) return;
  const { error: grantErr } = await sb.rpc("add_user_tokens", {
    p_user_id: userId,
    p_amount: 3,
    p_reason: WELCOME_REASON,
  });
  if (grantErr) {
    console.error("[wpw-oauth-link] welcome token grant failed", grantErr);
  } else {
    console.log("[wpw-oauth-link] granted 3 welcome tokens to", userId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const user = await authedUser(req);
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!user.email) {
      return new Response(JSON.stringify({ ok: false, error: "account has no email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({})) as {
      mode?: "lookup" | "byEmail" | "byId" | "requestOtp" | "verifyOtp";
      email?: string;
      code?: string;
      wooCustomerId?: number;
    };
    const mode = body.mode || "lookup";

    // ── OTP request: send 6-digit code to alt email (cross-domain ok) ──
    if (mode === "requestOtp") {
      const altEmail = (body.email || "").trim().toLowerCase();
      if (!altEmail || !altEmail.includes("@")) {
        return new Response(
          JSON.stringify({ ok: false, error: "valid email required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const sb = createServiceClient();

      // Rate limit: count unused OTPs created in last 15 min for this user
      const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
      const { count } = await sb
        .from("wpw_link_otps")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", cutoff);
      if ((count ?? 0) >= OTP_RATE_LIMIT_PER_15MIN) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Too many code requests. Wait 15 minutes and try again.",
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const code = generateOtpCode();
      const codeHash = await hashOtp(user.id, code);
      const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

      // Invalidate any prior unused codes for this (user, alt_email) pair
      await sb
        .from("wpw_link_otps")
        .update({ used_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("alt_email", altEmail)
        .is("used_at", null);

      const { error: insErr } = await sb.from("wpw_link_otps").insert({
        user_id: user.id,
        alt_email: altEmail,
        code_hash: codeHash,
        expires_at: expiresAt,
      });
      if (insErr) throw insErr;

      try {
        await sendOtpEmail(altEmail, code);
      } catch (e) {
        // Roll back the OTP row so the user can retry without hitting rate limit unfairly
        await sb
          .from("wpw_link_otps")
          .update({ used_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .eq("alt_email", altEmail)
          .is("used_at", null);
        throw e;
      }

      console.log(`[wpw-oauth-link] OTP sent: user=${user.id} alt=${altEmail}`);
      return new Response(
        JSON.stringify({ ok: true, sent: true, expires_in_seconds: OTP_TTL_SECONDS }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── OTP verify: confirm code, then link (bypasses domain check) ──
    if (mode === "verifyOtp") {
      const altEmail = (body.email || "").trim().toLowerCase();
      const code = (body.code || "").trim();
      if (!altEmail || !code || code.length !== 6) {
        return new Response(
          JSON.stringify({ ok: false, error: "email and 6-digit code required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const sb = createServiceClient();
      const { data: otpRow } = await sb
        .from("wpw_link_otps")
        .select("id, code_hash, attempts, expires_at, used_at")
        .eq("user_id", user.id)
        .eq("alt_email", altEmail)
        .is("used_at", null)
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!otpRow) {
        return new Response(
          JSON.stringify({ ok: false, error: "Code expired or not found. Request a new code." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
        await sb.from("wpw_link_otps").update({ used_at: new Date().toISOString() }).eq("id", otpRow.id);
        return new Response(
          JSON.stringify({ ok: false, error: "Too many failed attempts. Request a new code." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const expectedHash = await hashOtp(user.id, code);
      if (expectedHash !== otpRow.code_hash) {
        await sb
          .from("wpw_link_otps")
          .update({ attempts: (otpRow.attempts || 0) + 1 })
          .eq("id", otpRow.id);
        return new Response(
          JSON.stringify({ ok: false, error: "Incorrect code" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Code verified — mark used
      await sb.from("wpw_link_otps").update({ used_at: new Date().toISOString() }).eq("id", otpRow.id);

      const customer = await findCustomerByEmail(altEmail);
      if (!customer) {
        await grantWelcomeTokens(sb, user.id);
        return new Response(
          JSON.stringify({
            ok: true,
            linked: false,
            verified: true,
            welcomeTokensGranted: false,
            message:
              "Email verified. No past WePrintWraps orders found under this email. Choose a plan to start designing — see restyleproai.com/pricing.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      await linkCustomerToUser(createServiceClient(), user.id, customer);
      console.log(`[wpw-oauth-link] OTP-verified link: user=${user.id} alt=${altEmail} woo=${customer.id}`);
      return new Response(
        JSON.stringify({
          ok: true,
          linked: true,
          verified: true,
          woo_customer_id: customer.id,
          first_name: customer.first_name,
          last_name: customer.last_name,
          email: customer.email,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let customer: WooCustomer | null = null;
    if (mode === "byId" && body.wooCustomerId) {
      customer = await findCustomerById(Number(body.wooCustomerId));
      // Still enforce email match so a user can't link a random customer
      if (customer && (customer.email || "").toLowerCase() !== user.email.toLowerCase()) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "email on file at WePrintWraps does not match this account",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else if (mode === "byEmail") {
      const altEmail = (body.email || "").trim().toLowerCase();
      if (!altEmail || !altEmail.includes("@")) {
        return new Response(
          JSON.stringify({ ok: false, error: "valid email required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // Domain guardrail: alt email must share the auth email's domain so
      // an admin can link billing@theircompany.com but not arbitrary
      // third-party WPW accounts.
      const authDomain = user.email.toLowerCase().split("@")[1] || "";
      const altDomain = altEmail.split("@")[1] || "";
      if (!authDomain || authDomain !== altDomain) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: `For security, the alternate email must be on @${authDomain}. Sign up with the matching company email or contact support if your billing email is on a different domain.`,
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      customer = await findCustomerByEmail(altEmail);
      console.log(
        `[wpw-oauth-link] byEmail: user=${user.id} auth=${user.email} alt=${altEmail} ` +
          `match=${customer ? customer.id : "none"}`,
      );
    } else {
      customer = await findCustomerByEmail(user.email);
    }

    if (!customer) {
      // No Woo customer match — they signed up with a different email than
      // WPW has on file. Free tier retired: no welcome tokens are granted.
      await grantWelcomeTokens(createServiceClient(), user.id);
      return new Response(
        JSON.stringify({
          ok: true,
          linked: false,
          welcomeTokensGranted: false,
          message:
            "Account created. We couldn't find a WePrintWraps order history under this email — if you've ordered before, sign in with the email you used at WePrintWraps to pull in your past orders. Choose a plan at restyleproai.com/pricing to start designing.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await linkCustomerToUser(createServiceClient(), user.id, customer);

    return new Response(
      JSON.stringify({
        ok: true,
        linked: true,
        woo_customer_id: customer.id,
        first_name: customer.first_name,
        last_name: customer.last_name,
        email: customer.email,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[wpw-oauth-link] error", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
