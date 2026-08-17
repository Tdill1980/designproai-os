/**
 * seo-meta-oauth — canonical per-shop Meta OAuth for Facebook, Instagram and Ads Manager.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopAdmin } from "../_shared/seo/auth.ts";
import { svcClient } from "../_shared/seo/google-oauth.ts";
import {
  signMetaState,
  verifyMetaState,
  exchangeMetaCode,
  listPages,
  listAdAccounts,
} from "../_shared/seo/meta-oauth.ts";

const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "business_management",
  "ads_read",
  "ads_management",
  "public_profile",
  "email",
].join(",");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function appUrl(): string {
  return (Deno.env.get("APP_URL") ?? "https://restyleproai.com").replace(/\/+$/, "");
}

function safeReturnTo(value: unknown): string {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return "/admin/seo/connections";
  }
  return path;
}

function redirectBack(returnTo: unknown, key: string, value: string) {
  const target = new URL(`${appUrl()}${safeReturnTo(returnTo)}`);
  target.searchParams.set(key, value);
  return Response.redirect(target.toString(), 302);
}

// Which Meta secrets are configured. Booleans + the redirect URI ONLY — the
// redirect URI is not a secret (it is registered publicly in the Meta app and
// must be compared against it), while every token/secret VALUE stays server
// side. This exists because "Meta env vars not set" told nobody WHICH var was
// missing, so a dormant connect looked identical to a broken one for months.
function metaEnvReport() {
  const redirect = Deno.env.get("META_OAUTH_REDIRECT_URI") ?? null;
  const present = {
    META_APP_ID: !!Deno.env.get("META_APP_ID"),
    META_APP_SECRET: !!Deno.env.get("META_APP_SECRET"),
    META_OAUTH_REDIRECT_URI: !!redirect,
    SEO_OAUTH_STATE_SECRET: !!Deno.env.get("SEO_OAUTH_STATE_SECRET"),
  };
  const missing = Object.entries(present)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  const configId = Deno.env.get("META_LOGIN_CONFIG_ID") ?? null;
  return {
    present,
    missing,
    redirect_uri: redirect,
    scopes: META_SCOPES.split(","),
    // Which dialog flavour we will send. Not a secret — a config id is a
    // public identifier of a login configuration inside the Meta app.
    login_mode: configId ? "business_config_id" : "classic_scope",
    login_config_id: configId,
  };
}

// Names the missing secrets instead of a blanket "env vars not set", so the
// toast tells the operator exactly what to set.
function assertMetaEnv() {
  const { missing } = metaEnvReport();
  if (missing.length) {
    throw new Error(
      `Meta OAuth is not configured — missing ${missing.join(", ")}. ` +
        `Set these via the 'Set Function Secret' GitHub workflow (never paste tokens in chat), ` +
        `then click Connect again.`,
    );
  }
}

// Meta now has TWO login dialogs and they are not interchangeable.
//
//   classic Facebook Login  → app exposes "Products"; the dialog takes a
//                             `scope` list.
//   Facebook Login for Business → app exposes "Use cases" (Meta's newer app
//                             model); the dialog takes a `config_id` naming a
//                             login configuration created inside the app, and
//                             REJECTS a scope list.
//
// Sending `scope` to a use-case app fails with Facebook's generic "Sorry,
// something went wrong" — identical for every scope combination, including a
// bare public_profile, which is what made it look like a broken app rather
// than the wrong dialog. Live-confirmed 2026-08-12 on app 2235783510224310
// (WrapCommand Publisher): four escalating scope sets, same error each time,
// while Facebook accepted the client_id and redirect_uri fine.
//
// So: if META_LOGIN_CONFIG_ID is set we speak the business dialect, otherwise
// the classic one. Both are supported because other shops may be on either.
function buildMetaAuthUrlWithAdsManager(state: string): string {
  assertMetaEnv();
  const appId = Deno.env.get("META_APP_ID");
  const redirect = Deno.env.get("META_OAUTH_REDIRECT_URI");
  if (!appId || !redirect) throw new Error("Meta env vars not set");
  const configId = Deno.env.get("META_LOGIN_CONFIG_ID");
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirect,
    state,
    response_type: "code",
  });
  if (configId) {
    params.set("config_id", configId);
    // With a config the permissions come from the configuration itself; the
    // override is what keeps response_type=code honoured for a business login.
    params.set("override_default_response_type", "true");
  } else {
    params.set("scope", META_SCOPES);
  }
  return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
}

async function listGrantedPermissions(userToken: string): Promise<string[]> {
  const res = await fetch("https://graph.facebook.com/v21.0/me/permissions", {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (!res.ok) throw new Error(`Meta /me/permissions ${res.status}`);
  const data = await res.json();
  return (data.data ?? [])
    .filter((p: { status?: string }) => p.status === "granted")
    .map((p: { permission?: string }) => String(p.permission || ""))
    .filter(Boolean);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);

  if (url.searchParams.get("action") === "callback" || req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err = url.searchParams.get("error");
    if (err) return redirectBack("/admin/seo/connections", "meta_error", err);
    if (!code || !state) return new Response("Missing code or state", { status: 400 });

    let payload;
    try {
      payload = await verifyMetaState(state);
    } catch (e) {
      return new Response(`Invalid state: ${e instanceof Error ? e.message : String(e)}`, { status: 400 });
    }

    try {
      const { access_token, expires_at } = await exchangeMetaCode(code);
      const svc = svcClient();
      const connectedAt = new Date().toISOString();

      const [pages, grantedPermissions] = await Promise.all([
        listPages(access_token),
        listGrantedPermissions(access_token).catch((e) => {
          console.warn("[seo-meta-oauth] permissions lookup failed:", e instanceof Error ? e.message : e);
          return [] as string[];
        }),
      ]);
      const permissionSet = new Set(grantedPermissions);

      let adAccounts: Awaited<ReturnType<typeof listAdAccounts>> = [];
      try {
        adAccounts = await listAdAccounts(access_token);
      } catch (e) {
        console.warn("[seo-meta-oauth] adaccounts fetch failed:", e instanceof Error ? e.message : e);
      }

      const { data: existing } = await svc
        .from("tenant_site_connections")
        .select("config, metadata, display_name")
        .eq("shop_id", payload.shop_id)
        .eq("platform", "meta_facebook")
        .maybeSingle();
      const existingConfig = (existing?.config ?? {}) as Record<string, unknown>;
      const existingMetadata = (existing?.metadata ?? {}) as Record<string, unknown>;

      await svc.from("tenant_site_connections").upsert(
        {
          shop_id: payload.shop_id,
          platform: "meta_facebook",
          display_name: existing?.display_name ?? pages[0]?.name ?? "Meta account",
          config: {
            ...existingConfig,
            user_access_token: access_token,
            expires_at,
          },
          metadata: {
            ...existingMetadata,
            connected_at: connectedAt,
            connected_by: payload.user_id,
            granted_permissions: grantedPermissions,
            ads_read_enabled: permissionSet.has("ads_read") || permissionSet.has("ads_management"),
            ads_management_enabled: permissionSet.has("ads_management"),
            pages: pages.map((p) => ({
              id: p.id,
              name: p.name,
              ig_business_id: p.instagram_business_account?.id ?? null,
              ig_username: p.instagram_business_account?.username ?? null,
            })),
            ad_accounts: adAccounts.map((a) => ({
              id: a.id,
              account_id: a.account_id,
              name: a.name,
              account_status: a.account_status ?? null,
              currency: a.currency ?? null,
              business_name: a.business_name ?? null,
            })),
          },
          is_active: true,
          last_synced_at: connectedAt,
          last_error: null,
        },
        { onConflict: "shop_id,platform" },
      );

      return redirectBack(payload.return_to, "meta_connected", "1");
    } catch (e) {
      return redirectBack(
        "/admin/seo/connections",
        "meta_error",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  try {
    const ctx = await authenticate(req);
    const body = await req.json();
    const action = body?.action as string;
    const shop_id = body?.shop_id as string;
    if (!action || !shop_id) return json({ error: "action + shop_id required" }, 400);

    // Preflight: what is actually configured server-side. Shop-admin gated,
    // and it returns presence booleans only — never a secret value.
    if (action === "diagnose") {
      await assertShopAdmin(ctx, shop_id);
      const env = metaEnvReport();
      const { data: conn } = await ctx.service
        .from("tenant_site_connections")
        .select("is_active, last_error, last_synced_at, config, metadata")
        .eq("shop_id", shop_id)
        .eq("platform", "meta_facebook")
        .maybeSingle();
      const cfg = (conn?.config ?? {}) as Record<string, unknown>;
      const meta = (conn?.metadata ?? {}) as Record<string, unknown>;
      return json({
        ok: env.missing.length === 0,
        env_present: env.present,
        env_missing: env.missing,
        // Must match a Valid OAuth Redirect URI in the Meta app, exactly.
        redirect_uri: env.redirect_uri,
        scopes_requested: env.scopes,
        connection: conn
          ? {
              is_active: conn.is_active,
              last_error: conn.last_error,
              last_synced_at: conn.last_synced_at,
              has_user_token: !!cfg.user_access_token,
              ad_account_id: (cfg.ad_account_id as string) ?? null,
              ad_accounts_found: Array.isArray(meta.ad_accounts) ? meta.ad_accounts.length : 0,
              granted_permissions: (meta.granted_permissions as string[]) ?? [],
            }
          : null,
      });
    }

    if (action === "init") {
      await assertShopAdmin(ctx, shop_id);
      const state = await signMetaState({
        shop_id,
        user_id: ctx.user.id,
        return_to: safeReturnTo(body?.return_to),
        ts: Date.now(),
      });
      return json({ ok: true, auth_url: buildMetaAuthUrlWithAdsManager(state) });
    }

    if (action === "pages") {
      const { data, error } = await ctx.db
        .from("tenant_site_connections")
        .select("metadata")
        .eq("shop_id", shop_id)
        .eq("platform", "meta_facebook")
        .eq("is_active", true)
        .maybeSingle();
      if (error || !data) return json({ error: "Meta not connected" }, 404);
      return json({ ok: true, pages: (data.metadata as { pages?: unknown })?.pages ?? [] });
    }

    if (action === "choose_page") {
      await assertShopAdmin(ctx, shop_id);
      const pageId = body?.page_id as string;
      if (!pageId) return json({ error: "page_id required" }, 400);
      const { data, error } = await ctx.service
        .from("tenant_site_connections")
        .select("config, metadata")
        .eq("shop_id", shop_id)
        .eq("platform", "meta_facebook")
        .maybeSingle();
      if (error || !data) return json({ error: "Meta not connected" }, 404);

      const userToken = (data.config as { user_access_token: string }).user_access_token;
      const pages = await listPages(userToken);
      const page = pages.find((p) => p.id === pageId);
      if (!page) return json({ error: "Page not found in this account" }, 404);

      const newConfig = {
        ...(data.config as object),
        page_id: page.id,
        page_access_token: page.access_token,
        page_name: page.name,
        ig_business_id: page.instagram_business_account?.id ?? null,
        ig_username: page.instagram_business_account?.username ?? null,
      };

      await ctx.service
        .from("tenant_site_connections")
        .update({
          config: newConfig,
          display_name: page.name,
          last_synced_at: new Date().toISOString(),
        })
        .eq("shop_id", shop_id)
        .eq("platform", "meta_facebook");

      if (page.instagram_business_account?.id) {
        await ctx.service.from("tenant_site_connections").upsert(
          {
            shop_id,
            platform: "meta_instagram",
            display_name: `@${page.instagram_business_account.username ?? page.instagram_business_account.id}`,
            config: {
              page_id: page.id,
              page_access_token: page.access_token,
              ig_business_id: page.instagram_business_account.id,
              ig_username: page.instagram_business_account.username,
            },
            metadata: { synced_from_facebook: true },
            is_active: true,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "shop_id,platform" },
        );
      }

      return json({
        ok: true,
        page_id: page.id,
        ig_linked: !!page.instagram_business_account?.id,
      });
    }

    if (action === "adaccounts") {
      const { data, error } = await ctx.db
        .from("tenant_site_connections")
        .select("metadata")
        .eq("shop_id", shop_id)
        .eq("platform", "meta_facebook")
        .eq("is_active", true)
        .maybeSingle();
      if (error || !data) return json({ error: "Meta not connected" }, 404);
      return json({
        ok: true,
        ad_accounts: (data.metadata as { ad_accounts?: unknown })?.ad_accounts ?? [],
        ads_management_enabled: (data.metadata as { ads_management_enabled?: boolean })?.ads_management_enabled === true,
      });
    }

    if (action === "choose_adaccount") {
      await assertShopAdmin(ctx, shop_id);
      const adAccountId = body?.ad_account_id as string;
      if (!adAccountId) return json({ error: "ad_account_id required" }, 400);
      const { data, error } = await ctx.service
        .from("tenant_site_connections")
        .select("config, metadata")
        .eq("shop_id", shop_id)
        .eq("platform", "meta_facebook")
        .maybeSingle();
      if (error || !data) return json({ error: "Meta not connected" }, 404);

      const userToken = (data.config as { user_access_token: string }).user_access_token;
      const accounts = await listAdAccounts(userToken);
      const account = accounts.find((a) => a.id === adAccountId || a.account_id === adAccountId);
      if (!account) return json({ error: "Ad account not found in this Meta account" }, 404);

      const grantedPermissions = await listGrantedPermissions(userToken).catch(() => [] as string[]);
      const adsManagementEnabled = grantedPermissions.includes("ads_management");

      await ctx.service
        .from("tenant_site_connections")
        .update({
          config: {
            ...(data.config as object),
            ad_account_id: account.account_id,
            ad_account_name: account.name,
          },
          metadata: {
            ...(data.metadata as object),
            granted_permissions: grantedPermissions,
            ads_management_enabled: adsManagementEnabled,
            ad_accounts: accounts.map((a) => ({
              id: a.id,
              account_id: a.account_id,
              name: a.name,
              account_status: a.account_status ?? null,
              currency: a.currency ?? null,
              business_name: a.business_name ?? null,
            })),
          },
          last_synced_at: new Date().toISOString(),
        })
        .eq("shop_id", shop_id)
        .eq("platform", "meta_facebook");

      return json({
        ok: true,
        ad_account_id: account.account_id,
        name: account.name,
        ads_management_enabled: adsManagementEnabled,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-meta-oauth] error", msg);
    return json({ error: msg }, 500);
  }
});
