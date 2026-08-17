/**
 * canva-oauth-callback — Canva redirects here after the user consents.
 *
 * Exchanges the authorization code for access + refresh tokens, stores
 * them in canva_integrations, then redirects the browser back into the
 * app at the redirect_to originally set during init.
 *
 * This endpoint is the registered Redirect URI in the Canva developer
 * app. It must be publicly reachable without auth because Canva calls
 * it as an HTTP redirect (no Authorization header).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CANVA_TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const CANVA_USER_URL = "https://api.canva.com/rest/v1/users/me";

/**
 * BOUNCE BACK INTO THE APP. NEVER RENDER HTML HERE.
 *
 * This function used to return a styled HTML page on both success and
 * failure. The Supabase gateway will not serve function-generated HTML from
 * the `*.supabase.co` domain — it rewrites the response to
 * `content-type: text/plain` with `x-content-type-options: nosniff`, which is
 * a sensible XSS precaution and completely fatal to the page. Live check
 * 2026-08-10: the owner opened this endpoint and got a wall of raw markup,
 * dumped on a supabase.co URL with no way back.
 *
 * Setting the header harder does not fix it; the gateway wins. So the callback
 * stops trying to BE a page and does the one thing a callback should: a 302
 * back into the app, carrying the outcome as a query parameter. The admin UI
 * is real HTML on our own domain and already reads `?canva_connected` /
 * `?canva_error` to raise a toast.
 *
 * The failure target is the CONNECTIONS page specifically, not a generic
 * landing spot — somebody whose connect just failed wants the button they
 * pressed, not the dashboard.
 */
const CONNECTIONS_PATH = "/admin/seo/connections#canva";

function htmlRedirect(target: string, _msg: string): Response {
  // `target` already carries the app origin from the caller.
  const [rawPath, hash] = target.split("#");
  const sep = rawPath.includes("?") ? "&" : "?";
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: `${rawPath}${sep}canva_connected=1${hash ? `#${hash}` : ""}` },
  });
}

function htmlError(detail: string, target: string): Response {
  // Truncated: this rides in a URL, and a 4KB token-exchange dump would blow
  // past what browsers and servers will carry.
  const msg = String(detail || "Canva connection failed").slice(0, 300);
  const [rawPath, hash] = target.split("#");
  const sep = rawPath.includes("?") ? "&" : "?";
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: `${rawPath}${sep}canva_error=${encodeURIComponent(msg)}${hash ? `#${hash}` : ""}`,
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const appOrigin = Deno.env.get("APP_ORIGIN") || "https://restyleproai.com";
  const defaultBack = `${appOrigin}${CONNECTIONS_PATH}`;

  try {
    const clientId = Deno.env.get("CANVA_CLIENT_ID");
    const clientSecret = Deno.env.get("CANVA_CLIENT_SECRET");
    const redirectUri = Deno.env.get("CANVA_REDIRECT_URI");
    if (!clientId || !clientSecret || !redirectUri) {
      return htmlError("CANVA_CLIENT_ID / CANVA_CLIENT_SECRET / CANVA_REDIRECT_URI missing as Supabase secrets", defaultBack);
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const canvaErr = url.searchParams.get("error");
    if (canvaErr) return htmlError(`Canva returned: ${canvaErr}`, defaultBack);
    if (!code || !state) return htmlError("Missing code or state in callback URL", defaultBack);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: stateRow, error: stateErr } = await admin
      .from("canva_oauth_states")
      .select("*")
      .eq("state", state)
      .single();
    if (stateErr || !stateRow) {
      return htmlError("Unknown or expired state parameter. Please try connecting again.", defaultBack);
    }

    const backTarget = `${appOrigin}${stateRow.redirect_to || CONNECTIONS_PATH}`;

    // Exchange code for tokens
    const basic = btoa(`${clientId}:${clientSecret}`);
    const tokenRes = await fetch(CANVA_TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: stateRow.code_verifier,
      }),
    });

    if (!tokenRes.ok) {
      const detail = await tokenRes.text();
      return htmlError(`Token exchange failed (${tokenRes.status}): ${detail}`, backTarget);
    }
    const tokens = await tokenRes.json();
    const accessToken: string = tokens.access_token;
    const refreshToken: string = tokens.refresh_token;
    const expiresIn: number = Number(tokens.expires_in || 3600);
    const scopesReturned: string = tokens.scope || "";

    // Fetch Canva identity (best-effort — not required to succeed).
    //
    // Two different endpoints, and neither is the shape this code originally
    // read. `GET /v1/users/me` returns `{ team_user: { user_id, team_id } }` —
    // there is no `user.id` and no display name in it, which is why every
    // stored connection carried a NULL `canva_user_id` and NULL display name.
    // The display name lives at `GET /v1/users/me/profile`
    // (`{ profile: { display_name } }`), which needs the `profile:read` scope —
    // not requested by default (see _shared/canva-scopes.ts), so a 403 here is
    // normal and the name simply stays null; the UI already falls back to
    // "Canva account".
    let canvaUserId: string | null = null;
    let canvaDisplayName: string | null = null;
    try {
      const meRes = await fetch(CANVA_USER_URL, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        canvaUserId = me?.team_user?.user_id ?? me?.user?.id ?? me?.id ?? null;
      }
      const profileRes = await fetch(`${CANVA_USER_URL}/profile`, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      if (profileRes.ok) {
        const prof = await profileRes.json();
        canvaDisplayName = prof?.profile?.display_name ?? null;
      }
    } catch {
      // ignore
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const { error: upsertErr } = await admin
      .from("canva_integrations")
      .upsert(
        {
          user_id: stateRow.user_id,
          canva_user_id: canvaUserId,
          canva_display_name: canvaDisplayName,
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expires_at: expiresAt,
          scopes: scopesReturned,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (upsertErr) return htmlError(`Failed to save tokens: ${upsertErr.message}`, backTarget);

    // Clean up the state row so it can't be replayed
    await admin.from("canva_oauth_states").delete().eq("state", state);

    return htmlRedirect(backTarget, "Canva connected ✓");
  } catch (e) {
    return htmlError((e as Error).message, defaultBack);
  }
});
