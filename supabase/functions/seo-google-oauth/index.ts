/**
 * seo-google-oauth — authenticated Google OAuth plus a one-time YouTube door.
 *
 * Normal init is shop-admin only. The only public start route is
 * `GET ?action=youtube_ticket&ticket=<uuid>` and it works only with an
 * unexpired, unused row created by the service role. Both paths use the same
 * Google client, signed state and callback; there is no second YouTube secret
 * set and no public, unticketed consent endpoint.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopAdmin } from "../_shared/seo/auth.ts";
import {
  GOOGLE_SCOPES,
  GoogleService,
  buildAuthUrl,
  exchangeCodeForTokens,
  signState,
  verifyState,
  svcClient,
} from "../_shared/seo/google-oauth.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKET_ACTOR = "youtube-connect-ticket";
type GoogleOAuthService = GoogleService | "youtube";

interface ExtendedOAuthState {
  shop_id: string;
  service: GoogleOAuthService;
  user_id: string;
  return_to?: string;
  ticket_id?: string;
  ts: number;
}

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
] as const;

const MANAGEABLE_CONNECTION_SERVICES = new Set([
  "google_search_console",
  "google_analytics",
  "google_business_profile",
  "google_merchant_center",
  "meta_facebook",
  "youtube",
]);

const META_CONNECTION_STATE_KEYS = [
  "page_id",
  "page_name",
  "ad_account_id",
  "ad_account_name",
] as const;

const signExtendedState = signState as unknown as (
  payload: ExtendedOAuthState,
) => Promise<string>;
const verifyExtendedState = verifyState as unknown as (
  state: string,
) => Promise<ExtendedOAuthState>;

function oauthScope(service: GoogleOAuthService): string | null {
  return service === "youtube" ? YOUTUBE_SCOPES.join(" ") : GOOGLE_SCOPES[service] || null;
}

interface YouTubeChannel {
  id: string;
  title: string;
  handle?: string;
  thumbnail_url?: string;
}

async function getYouTubeChannel(accessToken: string): Promise<YouTubeChannel> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=1",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YouTube channel validation failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => ({}));
  const channel = Array.isArray(data?.items) ? data.items[0] : null;
  const id = String(channel?.id || "").trim();
  const title = String(channel?.snippet?.title || "").trim();
  if (!id || !title) {
    throw new Error(
      "No YouTube channel was found for the selected Google account. Choose the intended channel and try again.",
    );
  }
  return {
    id,
    title,
    handle: channel?.snippet?.customUrl || undefined,
    thumbnail_url:
      channel?.snippet?.thumbnails?.high?.url
      || channel?.snippet?.thumbnails?.default?.url
      || undefined,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function appUrl(): string {
  return (Deno.env.get("APP_URL") ?? "https://restyleproai.com").replace(/\/+$/, "");
}

export function safeReturnTo(value: unknown, fallback: string): string {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return fallback;
  return path;
}

function appRedirect(returnTo: unknown, key: string, value: string): Response {
  const target = new URL(`${appUrl()}${safeReturnTo(returnTo, "/admin/seo/connections")}`);
  target.searchParams.set(key, value);
  return Response.redirect(target.toString(), 302);
}

async function startYouTubeTicket(url: URL): Promise<Response> {
  const ticketId = String(url.searchParams.get("ticket") || "").trim();
  if (!UUID_RE.test(ticketId)) return new Response("Invalid YouTube connect ticket", { status: 400 });

  const svc = svcClient();
  const now = new Date().toISOString();
  const { data: ticket, error } = await svc
    .from("youtube_connect_tickets")
    .update({ started_at: now })
    .eq("id", ticketId)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("id, shop_id, return_to")
    .maybeSingle();

  if (error) {
    console.error("[seo-google-oauth] ticket lookup failed", error.message);
    return new Response("Could not validate YouTube connect ticket", { status: 500 });
  }
  if (!ticket) return new Response("YouTube connect ticket is expired or already used", { status: 410 });

  const state = await signExtendedState({
    shop_id: String(ticket.shop_id),
    service: "youtube",
    user_id: TICKET_ACTOR,
    return_to: safeReturnTo(ticket.return_to, "/admin/brand-board"),
    ticket_id: String(ticket.id),
    ts: Date.now(),
  });
  return Response.redirect(buildAuthUrl(oauthScope("youtube")!, state), 302);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (req.method === "GET" && action === "youtube_ticket") {
    return startYouTubeTicket(url);
  }

  const isOAuthCallback = req.method === "GET"
    && !!url.searchParams.get("state")
    && (!!url.searchParams.get("code") || !!url.searchParams.get("error"));

  if (isOAuthCallback) {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    if (!state) return new Response("Missing OAuth state", { status: 400 });

    let payload: ExtendedOAuthState;
    try {
      payload = await verifyExtendedState(state);
      if (!oauthScope(payload.service)) throw new Error("Unknown Google service in state");
      if (payload.ticket_id && payload.service !== "youtube") throw new Error("Ticket is not a YouTube state");
    } catch (e) {
      return new Response(
        `Invalid state: ${e instanceof Error ? e.message : String(e)}`,
        { status: 400 },
      );
    }

    if (oauthError) return appRedirect(payload.return_to, "google_error", oauthError);
    if (!code) return new Response("Missing OAuth code", { status: 400 });

    try {
      const tokens = await exchangeCodeForTokens(code);
      const svc = svcClient();
      const connectedAt = new Date().toISOString();
      let displayName = tokens.google_account_email ?? "Google account";
      let siteUrl: string | null = null;
      const metadata: Record<string, unknown> = {
        connected_at: connectedAt,
        connected_by: payload.user_id,
      };

      if (payload.service === "youtube") {
        if (!tokens.refresh_token) {
          throw new Error("Google did not issue offline YouTube access. Reconnect and approve the consent screen.");
        }
        const granted = new Set(String(tokens.scope || "").split(/\s+/).filter(Boolean));
        const missing = YOUTUBE_SCOPES.filter((scope) => !granted.has(scope));
        if (missing.length) {
          throw new Error(`Google did not grant the required YouTube permission: ${missing.join(", ")}`);
        }
        const channel = await getYouTubeChannel(tokens.access_token);
        displayName = channel.title;
        siteUrl = `https://www.youtube.com/channel/${channel.id}`;
        Object.assign(metadata, {
          youtube_channel_id: channel.id,
          youtube_channel_title: channel.title,
          youtube_channel_handle: channel.handle ?? null,
          youtube_channel_thumbnail_url: channel.thumbnail_url ?? null,
          youtube_channel_validated_at: connectedAt,
          youtube_management_enabled: true,
          youtube_analytics_enabled: true,
        });
      }

      const config = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        scope: tokens.scope,
        google_account_email: tokens.google_account_email,
        google_account_id: tokens.google_account_id,
      };

      if (payload.ticket_id) {
        const { data: completed, error } = await svc.rpc("complete_youtube_connect_ticket", {
          p_ticket_id: payload.ticket_id,
          p_shop_id: payload.shop_id,
          p_display_name: displayName,
          p_site_url: siteUrl,
          p_config: config,
          p_metadata: metadata,
        });
        if (error) throw new Error(`Could not store YouTube connection: ${error.message}`);
        if (completed !== true) throw new Error("YouTube connect ticket is expired or already used");
      } else {
        const { error } = await svc.from("tenant_site_connections").upsert(
          {
            shop_id: payload.shop_id,
            platform: payload.service,
            display_name: displayName,
            site_url: siteUrl,
            config,
            metadata,
            is_active: true,
            last_synced_at: connectedAt,
            last_error: null,
          },
          { onConflict: "shop_id,platform" },
        );
        if (error) throw new Error(`Could not store Google connection: ${error.message}`);
      }

      return appRedirect(
        safeReturnTo(payload.return_to, payload.service === "youtube" ? "/admin/brand-board" : "/admin/seo/connections"),
        "google_connected",
        payload.service,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[seo-google-oauth] callback failed", message);
      return appRedirect(
        safeReturnTo(payload.return_to, payload.service === "youtube" ? "/admin/brand-board" : "/admin/seo/connections"),
        "google_error",
        message,
      );
    }
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const ctx = await authenticate(req);
    const body = await req.json();
    const action = String(body?.action || "").trim();
    const shop_id = String(body?.shop_id || "").trim();
    const requestedService = String(body?.service || "").trim();

    if (!shop_id || !requestedService) return json({ error: "shop_id + service required" }, 400);
    await assertShopAdmin(ctx, shop_id);

    if (action === "disconnect") {
      if (!MANAGEABLE_CONNECTION_SERVICES.has(requestedService)) {
        return json({ error: `Unknown service: ${requestedService}` }, 400);
      }
      const { error } = await svcClient()
        .from("tenant_site_connections")
        .update({ is_active: false })
        .eq("shop_id", shop_id)
        .eq("platform", requestedService);
      if (error) throw new Error(`Could not disconnect service: ${error.message}`);
      return json({ ok: true });
    }

    if (action === "connection_state") {
      if (requestedService !== "meta_facebook") {
        return json({ error: "Connection state is available only for Meta" }, 400);
      }
      const { data, error } = await svcClient()
        .from("tenant_site_connections")
        .select("config")
        .eq("shop_id", shop_id)
        .eq("platform", requestedService)
        .maybeSingle();
      if (error) throw new Error(`Could not read connection state: ${error.message}`);
      const config = (data?.config && typeof data.config === "object")
        ? data.config as Record<string, unknown>
        : {};
      const state = Object.fromEntries(
        META_CONNECTION_STATE_KEYS.map((key) => [
          key,
          typeof config[key] === "string" ? config[key] : null,
        ]),
      );
      return json(state);
    }

    if (action !== "init") return json({ error: `Unknown action: ${action}` }, 400);
    const service = requestedService as GoogleOAuthService;
    const return_to = safeReturnTo(
      body?.return_to,
      service === "youtube" ? "/admin/brand-board" : "/admin/seo/connections",
    );

    const scope = oauthScope(service);
    if (!scope) return json({ error: `Unknown service: ${service}` }, 400);

    const state = await signExtendedState({
      shop_id,
      service,
      user_id: ctx.user.id,
      return_to,
      ts: Date.now(),
    });
    return json({ ok: true, auth_url: buildAuthUrl(scope, state) });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-google-oauth] init error", msg);
    return json({ error: msg }, 500);
  }
});
