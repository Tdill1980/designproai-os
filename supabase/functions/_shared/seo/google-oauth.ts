/**
 * Google OAuth helper.
 *
 * Single OAuth client (RestylePro's), per-shop tokens stored in
 * tenant_site_connections.config:
 *   {
 *     access_token, refresh_token, expires_at (ISO),
 *     scope (string), google_account_email, google_account_id
 *   }
 *
 * Each Google service gets its own tenant_site_connections row but shares the
 * same OAuth client. The metadata holds service-specific selected resources.
 * YouTube is intentionally a FIRST-CLASS service here rather than a global
 * secret: a SaaS tenant must publish to the channel that tenant connected.
 *
 * Env required (set via supabase secrets):
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_REDIRECT_URI   — e.g.
 *     https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/seo-google-oauth?action=callback
 *   SEO_OAUTH_STATE_SECRET      — random string, used to sign state tokens
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type GoogleService =
  | "google_search_console"
  | "google_analytics"
  | "google_business_profile"
  | "google_merchant_center"
  | "google_youtube";

export const GOOGLE_SCOPES: Record<GoogleService, string> = {
  google_search_console: "https://www.googleapis.com/auth/webmasters",
  google_analytics: "https://www.googleapis.com/auth/analytics.readonly",
  google_business_profile: "https://www.googleapis.com/auth/business.manage",
  google_merchant_center: "https://www.googleapis.com/auth/content",
  // One grant powers the YouTube OS: upload + edit/delete/manage comments /
  // captions and read channel analytics. Do not split this into another token
  // store; incremental grants on the same Google client are supported.
  google_youtube: [
    "https://www.googleapis.com/auth/youtube.force-ssl",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ].join(" "),
};

const BASE_SCOPES = ["openid", "email", "profile"].join(" ");

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: string; // ISO
  scope?: string;
  google_account_email?: string;
  google_account_id?: string;
}

// ─── State signing (HMAC-SHA256) ─────────────────────────────────────────
async function hmac(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function signState(payload: {
  shop_id: string;
  service: GoogleService;
  user_id: string;
  return_to?: string;
  ts: number;
}): Promise<string> {
  const secret = Deno.env.get("SEO_OAUTH_STATE_SECRET");
  if (!secret) throw new Error("SEO_OAUTH_STATE_SECRET not set");
  const json = JSON.stringify(payload);
  const b64 = btoa(json).replace(/=+$/g, "");
  const sig = await hmac(b64, secret);
  return `${b64}.${sig}`;
}

export async function verifyState(state: string): Promise<{
  shop_id: string;
  service: GoogleService;
  user_id: string;
  return_to?: string;
  ts: number;
}> {
  const secret = Deno.env.get("SEO_OAUTH_STATE_SECRET");
  if (!secret) throw new Error("SEO_OAUTH_STATE_SECRET not set");
  const [b64, sig] = state.split(".");
  if (!b64 || !sig) throw new Error("Malformed state");
  const expected = await hmac(b64, secret);
  if (expected !== sig) throw new Error("State signature mismatch");
  const json = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const payload = JSON.parse(json);
  if (Date.now() - payload.ts > 10 * 60 * 1000) throw new Error("State expired");
  return payload;
}

// ─── Auth URL builder ────────────────────────────────────────────────────
export function buildAuthUrl(scope: string, state: string): string {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const redirectUri = Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI");
  if (!clientId) throw new Error("GOOGLE_OAUTH_CLIENT_ID not set");
  if (!redirectUri) throw new Error("GOOGLE_OAUTH_REDIRECT_URI not set");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent", // force refresh_token issuance
    include_granted_scopes: "true",
    scope: `${BASE_SCOPES} ${scope}`,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ─── Token exchange + refresh ────────────────────────────────────────────
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const redirectUri = Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth env vars not set");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`token exchange failed: ${res.status} ${txt.slice(0, 400)}`);
  }
  const data = await res.json();
  const expires_at = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();

  // Identify the user (email + sub) via the userinfo endpoint
  let google_account_email: string | undefined;
  let google_account_id: string | undefined;
  try {
    const uiRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (uiRes.ok) {
      const ui = await uiRes.json();
      google_account_email = ui.email;
      google_account_id = ui.sub;
    }
  } catch {
    // non-fatal — we don't need the email to function
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at,
    scope: data.scope,
    google_account_email,
    google_account_id,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_at: string;
  scope?: string;
}> {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Google OAuth env vars not set");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`refresh failed: ${res.status} ${txt.slice(0, 400)}`);
  }
  const data = await res.json();
  return {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    scope: data.scope,
  };
}

// ─── Loaders that auto-refresh ───────────────────────────────────────────
export async function getValidGoogleAccessToken(
  service: SupabaseClient,
  shopId: string,
  serviceName: GoogleService,
): Promise<{ access_token: string; metadata: Record<string, unknown> }> {
  const { data, error } = await service
    .from("tenant_site_connections")
    .select("config, metadata")
    .eq("shop_id", shopId)
    .eq("platform", serviceName)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) throw new Error(`${serviceName} not connected for this shop`);

  const cfg = data.config as GoogleTokens;
  const expiresAt = cfg.expires_at ? new Date(cfg.expires_at).getTime() : 0;
  const isExpired = expiresAt - Date.now() < 60_000; // refresh within 60s

  if (!isExpired) {
    return { access_token: cfg.access_token, metadata: data.metadata as Record<string, unknown> };
  }
  if (!cfg.refresh_token) {
    throw new Error(`${serviceName} access token expired and no refresh_token saved — reconnect required`);
  }
  const refreshed = await refreshAccessToken(cfg.refresh_token);
  const newConfig = {
    ...cfg,
    access_token: refreshed.access_token,
    expires_at: refreshed.expires_at,
    scope: refreshed.scope ?? cfg.scope,
  };
  await service
    .from("tenant_site_connections")
    .update({ config: newConfig, last_synced_at: new Date().toISOString() })
    .eq("shop_id", shopId)
    .eq("platform", serviceName);
  return { access_token: refreshed.access_token, metadata: data.metadata as Record<string, unknown> };
}

export function svcClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase env vars not set");
  return createClient(url, key, { auth: { persistSession: false } });
}
