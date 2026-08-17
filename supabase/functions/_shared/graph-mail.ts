/**
 * graph-mail.ts — send email from a real We Print Wraps mailbox via Microsoft
 * Graph, using the tenant's existing Entra app (client-credentials flow).
 *
 * WHY THIS EXISTS: the Resend account is suspended, so every Resend-backed send
 * silently fails. This is the replacement channel for LOW-VOLUME, ONE-TO-ONE
 * mail — a design-team alert, a customer's own quote — sent from an address
 * that already has real domain history, so inbox placement is good with no new
 * vendor and no reputation to build.
 *
 * WHAT THIS IS NOT FOR — do not wire it to anything list-shaped. Sending as a
 * mailbox means abuse gets the whole MICROSOFT 365 TENANT restricted, which
 * takes down every employee's email, not just an API key. Marketing and any
 * bulk send belong in Klaviyo. Microsoft also throttles (~30 messages/minute)
 * and gives no bounce webhooks or suppression list, so this channel is blind by
 * design: callers must treat a `true` return as "accepted for delivery", not
 * "delivered".
 *
 * Secrets (Supabase → Edge Functions → Secrets). MS_GRAPH_* is preferred (it
 * matches docs/APPROVEPRO_EMAIL_INTAKE.md); MICROSOFT_* is accepted as a
 * fallback because that is what WrapCommand's functions already use:
 *   MS_GRAPH_TENANT_ID     | MICROSOFT_TENANT_ID
 *   MS_GRAPH_CLIENT_ID     | MICROSOFT_CLIENT_ID
 *   MS_GRAPH_CLIENT_SECRET | MICROSOFT_CLIENT_SECRET
 *   MS_GRAPH_SEND_AS       (optional, defaults to hello@weprintwraps.com)
 *
 * Prefer a SCOPED app (Mail.Send limited to one mailbox via an Exchange
 * Application Access Policy — Option A2 in docs/APPROVEPRO_EMAIL_INTAKE.md)
 * over reusing the tenant-wide app: if this secret leaks, a tenant-wide
 * Mail.Send credential can send as anyone in the company.
 *
 * Never throws — returns false and logs, so a mail failure cannot break the
 * caller's happy path.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const DEFAULT_SEND_AS = "hello@weprintwraps.com";
const TOKEN_TIMEOUT_MS = 8_000;
const SEND_TIMEOUT_MS = 15_000;

function creds() {
  const tenantId = Deno.env.get("MS_GRAPH_TENANT_ID") || Deno.env.get("MICROSOFT_TENANT_ID");
  const clientId = Deno.env.get("MS_GRAPH_CLIENT_ID") || Deno.env.get("MICROSOFT_CLIENT_ID");
  const clientSecret = Deno.env.get("MS_GRAPH_CLIENT_SECRET") || Deno.env.get("MICROSOFT_CLIENT_SECRET");
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

/** True when the Graph channel is configured — lets callers skip it cleanly. */
export function graphMailConfigured(): boolean {
  return creds() !== null;
}

// Tokens last ~60 min; cache per isolate so a burst of sends costs one token call.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  const c = creds();
  if (!c) return null;
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  try {
    const res = await fetch(`https://login.microsoftonline.com/${c.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.access_token) {
      console.error("[graph-mail] token error:", res.status, JSON.stringify(data).slice(0, 200));
      return null;
    }
    // Refresh a minute early rather than racing the expiry.
    const ttl = Math.max(60, Number(data.expires_in) || 3600) - 60;
    cachedToken = { token: data.access_token, expiresAt: Date.now() + ttl * 1000 };
    return cachedToken.token;
  } catch (e) {
    console.error("[graph-mail] token fetch failed:", String(e).slice(0, 160));
    return null;
  }
}

export interface GraphMailOpts {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  /** Mailbox to send AS. Must be one the Entra app is allowed to send from. */
  sendAs?: string;
  fromName?: string;
}

/**
 * Send one message. Returns true only when Graph ACCEPTED it (HTTP 202) —
 * acceptance is not delivery, and this channel has no bounce feedback, so a
 * caller must not report "delivered" to a customer on the strength of it.
 */
export async function sendGraphMail(opts: GraphMailOpts): Promise<boolean> {
  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .map((a) => String(a || "").trim())
    .filter((a) => a.includes("@"));
  if (!recipients.length) return false;

  const token = await getAccessToken();
  if (!token) return false;

  const sendAs = opts.sendAs || Deno.env.get("MS_GRAPH_SEND_AS") || DEFAULT_SEND_AS;
  try {
    const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(sendAs)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: opts.subject,
          body: { contentType: "HTML", content: opts.html },
          toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
          from: { emailAddress: { address: sendAs, name: opts.fromName || "We Print Wraps" } },
          ...(opts.replyTo?.includes("@")
            ? { replyTo: [{ emailAddress: { address: opts.replyTo } }] }
            : {}),
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[graph-mail] send failed:", res.status, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[graph-mail] send error:", String(e).slice(0, 160));
    return false;
  }
}
