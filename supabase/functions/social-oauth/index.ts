/**
 * social-oauth — one tenant-scoped OAuth boundary for social providers that
 * are not already owned by Google/Meta/Canva.
 *
 * Canonical connection store: tenant_site_connections.
 * Transient PKCE/state rows: social_oauth_states only; this is NOT a token store.
 *
 * Providers implemented here:
 *   linkedin — 3-legged OAuth. Default scope is member publishing; company-page
 *              scopes may be supplied through LINKEDIN_SCOPES after LinkedIn
 *              approves the app for Community Management.
 *   x        — OAuth 2.0 Authorization Code + PKCE with offline refresh access.
 *
 * This function establishes identity/authorization only. Content Director
 * remains DRAFT/manual for a provider until content-deploy has a matching,
 * tested publisher adapter.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopAdmin } from "../_shared/seo/auth.ts";
import { svcClient } from "../_shared/seo/google-oauth.ts";

type Provider = "linkedin" | "x";

type StateRow = {
  state: string;
  shop_id: string;
  provider: Provider;
  user_id: string;
  code_verifier: string | null;
  return_to: string;
  expires_at: string;
};

const PROVIDERS = new Set<Provider>(["linkedin", "x"]);
const LINKEDIN_AUTHORIZE = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN = "https://www.linkedin.com/oauth/v2/accessToken";
const X_AUTHORIZE = "https://x.com/i/oauth2/authorize";
const X_TOKEN = "https://api.x.com/2/oauth2/token";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function appUrl() {
  return (Deno.env.get("APP_URL") || Deno.env.get("APP_ORIGIN") || "https://restyleproai.com").replace(/\/+$/, "");
}

function safeReturnTo(value: unknown): string {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return "/admin/seo/connections";
  }
  return path;
}

function provider(value: unknown): Provider | null {
  const p = String(value || "").trim().toLowerCase() as Provider;
  return PROVIDERS.has(p) ? p : null;
}

function randomB64Url(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256B64Url(value: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...hash))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function configFor(p: Provider) {
  if (p === "linkedin") {
    return {
      clientId: Deno.env.get("LINKEDIN_CLIENT_ID") || "",
      clientSecret: Deno.env.get("LINKEDIN_CLIENT_SECRET") || "",
      redirectUri: Deno.env.get("LINKEDIN_OAUTH_REDIRECT_URI") || "",
      scopes: String(Deno.env.get("LINKEDIN_SCOPES") || "openid profile w_member_social")
        .trim().split(/\s+/).filter(Boolean),
    };
  }
  return {
    clientId: Deno.env.get("X_CLIENT_ID") || "",
    clientSecret: Deno.env.get("X_CLIENT_SECRET") || "",
    redirectUri: Deno.env.get("X_OAUTH_REDIRECT_URI") || "",
    scopes: String(Deno.env.get("X_SCOPES") || "tweet.read tweet.write users.read offline.access media.write")
      .trim().split(/\s+/).filter(Boolean),
  };
}

function configured(p: Provider): boolean {
  const cfg = configFor(p);
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUri);
}

function callbackRedirect(returnTo: unknown, key: string, value: string) {
  const target = new URL(`${appUrl()}${safeReturnTo(returnTo)}`);
  target.searchParams.set(key, value);
  return Response.redirect(target.toString(), 302);
}

async function exchangeLinkedIn(code: string, cfg: ReturnType<typeof configFor>) {
  const res = await fetch(LINKEDIN_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.access_token) {
    throw new Error(`LinkedIn token exchange failed (${res.status}): ${out.error_description || out.error || "no access token"}`);
  }
  return out as { access_token: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number; scope?: string };
}

async function exchangeX(code: string, verifier: string, cfg: ReturnType<typeof configFor>) {
  const basic = btoa(`${cfg.clientId}:${cfg.clientSecret}`);
  const res = await fetch(X_TOKEN, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      code_verifier: verifier,
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.access_token) {
    throw new Error(`X token exchange failed (${res.status}): ${out.error_description || out.error || "no access token"}`);
  }
  return out as { access_token: string; expires_in?: number; refresh_token?: string; scope?: string };
}

async function linkedinIdentity(token: string) {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LinkedIn identity lookup failed (${res.status})`);
  return {
    id: String(out.sub || ""),
    name: String(out.name || [out.given_name, out.family_name].filter(Boolean).join(" ") || "LinkedIn member"),
    picture: typeof out.picture === "string" ? out.picture : null,
  };
}

async function xIdentity(token: string) {
  const res = await fetch("https://api.x.com/2/users/me?user.fields=id,name,username,profile_image_url", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.data?.id) throw new Error(`X identity lookup failed (${res.status})`);
  return {
    id: String(out.data.id),
    name: String(out.data.name || out.data.username || "X account"),
    username: String(out.data.username || ""),
    picture: typeof out.data.profile_image_url === "string" ? out.data.profile_image_url : null,
  };
}

async function begin(req: Request, body: Record<string, unknown>) {
  const ctx = await authenticate(req);
  const p = provider(body.provider);
  const shopId = String(body.shop_id || "").trim();
  if (!p || !shopId) return json({ ok: false, error: "provider + shop_id required" }, 400);
  await assertShopAdmin(ctx, shopId);

  const cfg = configFor(p);
  if (!configured(p)) {
    return json({
      ok: false,
      error: `${p === "linkedin" ? "LinkedIn" : "X"} developer app is not configured on the server yet`,
      needs_provider_app: true,
    }, 409);
  }

  const state = randomB64Url(24);
  const verifier = p === "x" ? randomB64Url(48) : null;
  const challenge = verifier ? await sha256B64Url(verifier) : null;
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const returnTo = safeReturnTo(body.return_to);
  const svc = svcClient();
  const { error } = await svc.from("social_oauth_states").insert({
    state,
    shop_id: shopId,
    provider: p,
    user_id: ctx.user.id,
    code_verifier: verifier,
    return_to: returnTo,
    expires_at: expiresAt,
  });
  if (error) throw new Error(`Could not start ${p} OAuth: ${error.message}`);

  const url = new URL(p === "linkedin" ? LINKEDIN_AUTHORIZE : X_AUTHORIZE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", cfg.scopes.join(" "));
  url.searchParams.set("state", state);
  if (p === "x" && challenge) {
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return json({ ok: true, provider: p, auth_url: url.toString(), scopes: cfg.scopes });
}

async function handleCallback(url: URL) {
  const state = String(url.searchParams.get("state") || "");
  const code = String(url.searchParams.get("code") || "");
  const oauthError = String(url.searchParams.get("error") || "");
  if (!state) return new Response("Missing OAuth state", { status: 400 });

  const svc = svcClient();
  const now = new Date().toISOString();
  const { data, error } = await svc.from("social_oauth_states")
    .select("state, shop_id, provider, user_id, code_verifier, return_to, expires_at")
    .eq("state", state)
    .gt("expires_at", now)
    .maybeSingle();
  if (error || !data) return new Response("Unknown or expired social OAuth state", { status: 410 });
  const row = data as StateRow;

  if (oauthError) {
    await svc.from("social_oauth_states").delete().eq("state", state);
    return callbackRedirect(row.return_to, "social_error", `${row.provider}:${oauthError}`);
  }
  if (!code) return new Response("Missing OAuth code", { status: 400 });

  try {
    const cfg = configFor(row.provider);
    if (!configured(row.provider)) throw new Error(`${row.provider} provider app is no longer configured`);
    const tokens = row.provider === "linkedin"
      ? await exchangeLinkedIn(code, cfg)
      : await exchangeX(code, String(row.code_verifier || ""), cfg);
    const identity = row.provider === "linkedin"
      ? await linkedinIdentity(tokens.access_token)
      : await xIdentity(tokens.access_token);
    const expiresAt = new Date(Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000).toISOString();
    const scopeText = String(tokens.scope || cfg.scopes.join(" "));
    const scopeSet = new Set(scopeText.split(/\s+/).filter(Boolean));
    const metadata: Record<string, unknown> = {
      connected_at: now,
      connected_by: row.user_id,
      provider_user_id: identity.id,
      provider_display_name: identity.name,
      provider_avatar_url: identity.picture,
      granted_scopes: [...scopeSet],
      publisher_adapter_wired: false,
    };
    if (row.provider === "x") {
      metadata.username = (identity as { username?: string }).username || null;
      metadata.member_publish_scope = scopeSet.has("tweet.write");
    } else {
      metadata.member_publish_scope = scopeSet.has("w_member_social");
      metadata.organization_publish_scope = scopeSet.has("w_organization_social");
      metadata.organization_read_scope = scopeSet.has("r_organization_social");
    }

    const { error: upsertError } = await svc.from("tenant_site_connections").upsert({
      shop_id: row.shop_id,
      platform: row.provider,
      display_name: row.provider === "x" && (identity as { username?: string }).username
        ? `@${(identity as { username?: string }).username}`
        : identity.name,
      site_url: row.provider === "x" && (identity as { username?: string }).username
        ? `https://x.com/${(identity as { username?: string }).username}`
        : null,
      config: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        expires_at: expiresAt,
        scope: scopeText,
      },
      metadata,
      is_active: true,
      last_synced_at: now,
      last_error: null,
      updated_at: now,
    }, { onConflict: "shop_id,platform" });
    if (upsertError) throw new Error(`Could not save ${row.provider} connection: ${upsertError.message}`);

    await svc.from("social_oauth_states").delete().eq("state", state);
    return callbackRedirect(row.return_to, "social_connected", row.provider);
  } catch (e) {
    await svc.from("social_oauth_states").delete().eq("state", state);
    return callbackRedirect(row.return_to, "social_error", `${row.provider}:${e instanceof Error ? e.message : String(e)}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("action") === "callback") {
    return handleCallback(url);
  }
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "status").trim().toLowerCase();
    const p = provider(body.provider);
    const shopId = String(body.shop_id || "").trim();
    if (!p || !shopId) return json({ ok: false, error: "provider + shop_id required" }, 400);

    if (action === "init") return begin(req, body);

    const ctx = await authenticate(req);
    await assertShopAdmin(ctx, shopId);

    if (action === "status") {
      const { data, error } = await ctx.service.from("tenant_site_connections")
        .select("platform, display_name, site_url, metadata, is_active, last_synced_at, last_error")
        .eq("shop_id", shopId)
        .eq("platform", p)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return json({
        ok: true,
        provider: p,
        configured: configured(p),
        connected: data?.is_active === true,
        connection: data || null,
      });
    }

    if (action === "disconnect") {
      const { error } = await ctx.service.from("tenant_site_connections")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("shop_id", shopId)
        .eq("platform", p);
      if (error) throw new Error(error.message);
      return json({ ok: true, provider: p, disconnected: true });
    }

    return json({ ok: false, error: `unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
