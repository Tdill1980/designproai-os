/**
 * Meta (Facebook + Instagram) OAuth helper.
 *
 * One Meta connection per shop covers both `meta_facebook` and
 * `meta_instagram` platforms because the Page access token can address
 * the Instagram Business Account that's connected to the Page.
 *
 * On connect we save:
 *   - user_access_token (long-lived, ~60 days)
 *   - selected page id + page_access_token (does not expire when issued
 *     against a long-lived user token)
 *   - ig_business_id (if the page has an IG Business linked)
 *
 * Env required:
 *   META_APP_ID
 *   META_APP_SECRET
 *   META_OAUTH_REDIRECT_URI  — e.g.
 *     https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/seo-meta-oauth?action=callback
 *   SEO_OAUTH_STATE_SECRET   — shared with google-oauth.ts
 */

const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "business_management",
  "ads_read",
  "public_profile",
  "email",
].join(",");

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

export async function signMetaState(payload: {
  shop_id: string;
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

export async function verifyMetaState(state: string) {
  const secret = Deno.env.get("SEO_OAUTH_STATE_SECRET");
  if (!secret) throw new Error("SEO_OAUTH_STATE_SECRET not set");
  const [b64, sig] = state.split(".");
  if (!b64 || !sig) throw new Error("Malformed state");
  const expected = await hmac(b64, secret);
  if (expected !== sig) throw new Error("State signature mismatch");
  const json = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const p = JSON.parse(json);
  if (Date.now() - p.ts > 10 * 60 * 1000) throw new Error("State expired");
  return p as { shop_id: string; user_id: string; return_to?: string; ts: number };
}

export function buildMetaAuthUrl(state: string): string {
  const appId = Deno.env.get("META_APP_ID");
  const redirect = Deno.env.get("META_OAUTH_REDIRECT_URI");
  if (!appId || !redirect) throw new Error("Meta env vars not set");
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirect,
    state,
    response_type: "code",
    scope: SCOPES,
  });
  return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
}

export async function exchangeMetaCode(code: string): Promise<{
  access_token: string;
  expires_at: string;
}> {
  const appId = Deno.env.get("META_APP_ID");
  const appSecret = Deno.env.get("META_APP_SECRET");
  const redirect = Deno.env.get("META_OAUTH_REDIRECT_URI");
  if (!appId || !appSecret || !redirect) throw new Error("Meta env vars not set");
  const tokenRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirect,
        code,
      }).toString(),
  );
  if (!tokenRes.ok) {
    throw new Error(`Meta token exchange failed: ${tokenRes.status}`);
  }
  const shortLived = await tokenRes.json();

  // Convert to long-lived token (~60 days)
  const llRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLived.access_token,
      }).toString(),
  );
  if (!llRes.ok) {
    // fall back to short-lived
    return {
      access_token: shortLived.access_token,
      expires_at: new Date(Date.now() + (shortLived.expires_in ?? 3600) * 1000).toISOString(),
    };
  }
  const ll = await llRes.json();
  return {
    access_token: ll.access_token,
    expires_at: new Date(Date.now() + (ll.expires_in ?? 5_184_000) * 1000).toISOString(),
  };
}

export async function listAdAccounts(userToken: string) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,account_id,name,account_status,currency,business_name&limit=100`,
    { headers: { Authorization: `Bearer ${userToken}` } },
  );
  if (!res.ok) throw new Error(`Meta /me/adaccounts ${res.status}`);
  const data = await res.json();
  return (data.data ?? []) as Array<{
    id: string; // "act_<digits>"
    account_id: string; // digits only
    name: string;
    account_status?: number; // 1 = active
    currency?: string;
    business_name?: string;
  }>;
}

export async function listPages(userToken: string) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}&limit=100`,
    { headers: { Authorization: `Bearer ${userToken}` } },
  );
  if (!res.ok) throw new Error(`Meta /me/accounts ${res.status}`);
  const data = await res.json();
  return (data.data ?? []) as Array<{
    id: string;
    name: string;
    access_token: string;
    instagram_business_account?: { id: string; username?: string; name?: string };
  }>;
}
