/**
 * canva-oauth-init — Starts the Canva Connect OAuth flow.
 *
 * Generates a PKCE code_verifier/code_challenge pair, stores the verifier
 * keyed by a random state, and returns the Canva authorize URL the client
 * should redirect the user to.
 *
 * Client call (from the browser with the user's JWT):
 *   POST /functions/v1/canva-oauth-init  { redirect_to: "/admin/content-review" }
 *   -> { authorize_url: "https://www.canva.com/api/oauth/authorize?..." }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveRequestedScopes } from "../_shared/canva-scopes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CANVA_AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";

function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

function randomString(bytes = 48): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return b64url(arr);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const clientId = Deno.env.get("CANVA_CLIENT_ID");
    const redirectUri = Deno.env.get("CANVA_REDIRECT_URI");

    // ── Config diagnostic ────────────────────────────────────────────────
    // GET ?diagnose=1 reports EXACTLY what this function would send to Canva.
    // The connect failed twice on 2026-07-28 and left no trace of why: the
    // browser leaves for canva.com, Canva rejects, and the user never comes
    // back — so nothing on our side ever learns the reason. Both plausible
    // causes (a redirect_uri that doesn't match the one registered in the
    // Canva Developer Portal, or a scope not ticked on for the app) are
    // settled instantly by comparing these values against that portal.
    //
    // Unauthenticated on purpose: it must be readable when the connect is
    // broken, and it discloses nothing secret. redirect_uri and the scope list
    // both travel as plain query parameters in the authorize URL the browser
    // is about to visit. Secret VALUES are never returned — only whether each
    // one is set.
    if (new URL(req.url).searchParams.get("diagnose")) {
      const scopes = resolveRequestedScopes(Deno.env.get("CANVA_SCOPES"));
      return new Response(
        JSON.stringify({
          diagnostic: true,
          authorize_endpoint: CANVA_AUTHORIZE_URL,
          redirect_uri: redirectUri || null,
          scopes_requested: scopes,
          scope_string: scopes.join(" "),
          scopes_overridden_by_env: !!Deno.env.get("CANVA_SCOPES"),
          app_origin: Deno.env.get("APP_ORIGIN") || "https://restyleproai.com (default)",
          secrets: {
            CANVA_CLIENT_ID: !!clientId,
            CANVA_CLIENT_SECRET: !!Deno.env.get("CANVA_CLIENT_SECRET"),
            CANVA_REDIRECT_URI: !!redirectUri,
          },
        }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!clientId || !redirectUri) {
      return new Response(
        JSON.stringify({ error: "CANVA_CLIENT_ID and CANVA_REDIRECT_URI must be set as Supabase secrets" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── SCOPE PROBE ──────────────────────────────────────────────────────
    // GET ?probe=1 asks CANVA which scopes it will accept for this app, one
    // at a time, and reports the answer.
    //
    // The owner has pressed Connect repeatedly and got `invalid_scope` every
    // time. `?diagnose=1` already proved our side is configured — client id,
    // secret and redirect_uri all set, six scopes requested — so the rejection
    // is a checkbox in the Canva Developer Portal. But `invalid_scope` names
    // NO scope: it rejects the whole request, so six candidates collapse into
    // one useless error and the only way forward was ticking boxes at random
    // and pressing the button again.
    //
    // This asks per scope. `redirect_uri`, `client_id` and `scope` are all
    // validated by an OAuth authorize endpoint BEFORE any consent screen, so
    // an unauthenticated request is enough to learn whether a given scope is
    // enabled — no browser, no login, no consent granted, nothing connected.
    //
    // IT CANNOT AUTHORIZE ANYTHING. There is no PKCE verifier, no state row
    // and no user; a `code` could not be exchanged even if Canva issued one.
    // Redirects are NOT followed, so the flow stops at the first response.
    //
    // Unauthenticated for the same reason as `?diagnose=1`: it has to work
    // when the connect is broken, and it returns no secret — only which of six
    // public scope strings this app is allowed to ask for.
    if (new URL(req.url).searchParams.get("probe")) {
      const all = resolveRequestedScopes(Deno.env.get("CANVA_SCOPES"));
      const probe = async (scopes: string[]) => {
        const u = new URL(CANVA_AUTHORIZE_URL);
        u.searchParams.set("client_id", clientId);
        u.searchParams.set("redirect_uri", redirectUri);
        u.searchParams.set("response_type", "code");
        u.searchParams.set("scope", scopes.join(" "));
        u.searchParams.set("code_challenge", "probe0000000000000000000000000000000000000000");
        u.searchParams.set("code_challenge_method", "S256");
        u.searchParams.set("state", "probe");
        try {
          const r = await fetch(u.toString(), { redirect: "manual" });
          const loc = r.headers.get("location") || "";
          // Canva reports a rejection either as a redirect carrying `error=`
          // or as an error page. Both are read; neither is guessed at.
          const inLoc = loc.includes("error=") ? new URL(loc, "https://www.canva.com").searchParams.get("error") : null;
          const body = inLoc ? "" : (await r.text()).slice(0, 400);
          const inBody = /invalid_scope/i.test(body) ? "invalid_scope" : null;
          const err = inLoc || inBody;
          return { scopes, status: r.status, error: err, accepted: !err };
        } catch (e) {
          // A network failure is NOT a rejection. Saying so is the difference
          // between "Canva refuses this scope" and "we could not ask".
          return { scopes, status: 0, error: `probe_failed: ${String((e as Error).message)}`, accepted: null };
        }
      };

      // ── THE CONTROL. Without it this probe lies. ──────────────────────
      //
      // First live run: all six scopes AND the whole set came back HTTP 403
      // with no `error=` anywhere, so "no error found" was read as "accepted"
      // and the verdict announced that Canva approves everything. It does not
      // approve anything — a uniform 403 is Canva's edge REFUSING THE REQUEST,
      // and the probe never got near scope validation.
      //
      // So it now asks about a scope that CANNOT be valid. If Canva "accepts"
      // that too, the probe is blind and says so instead of clearing six real
      // scopes it never actually tested. A diagnostic that reports a confident
      // wrong answer is worse than no diagnostic: it sends the owner to look
      // at the redirect URI when the scopes were never checked.
      const control = await probe(["definitely:not:a:real:scope"]);
      const blind = control.accepted === true;

      const perScope = [];
      for (const s of all) perScope.push(await probe([s]));
      const whole = await probe(all);
      const rejected = blind ? [] : perScope.filter((r) => r.accepted === false).map((r) => r.scopes[0]);
      const unknown = blind ? all.slice() : perScope.filter((r) => r.accepted === null).map((r) => r.scopes[0]);

      return new Response(
        JSON.stringify({
          probe: true,
          verdict: blind
            ? `PROBE IS BLIND — a deliberately invalid scope came back the same as every real one (HTTP ${control.status}), so Canva is refusing these requests before it ever looks at the scope. This says NOTHING about which scopes are enabled. Check the six scopes and the redirect_uri by hand in the Canva Developer Portal: ${redirectUri}`
            : unknown.length
            ? `could not reach Canva for ${unknown.length} scope(s) — this is not a verdict about them`
            : rejected.length
              ? `Canva REJECTS ${rejected.length} of ${all.length}: tick these on for the app in the Canva Developer Portal — ${rejected.join(", ")}`
              : whole.accepted === false
                ? "every scope is accepted on its own but the full set is rejected — the app is likely missing the combination, or redirect_uri does not match the portal exactly"
                : "Canva accepts every requested scope — if Connect still fails, the redirect_uri registered in the portal does not match ours exactly",
          conclusive: !blind,
          control,
          redirect_uri: redirectUri,
          rejected,
          unreachable: unknown,
          whole_set: whole,
          per_scope: perScope,
        }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "invalid user" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const redirectTo = typeof body?.redirect_to === "string" ? body.redirect_to : "/admin/content-review";

    // `minimal: true` retries the connect WITHOUT the autofill scopes. It is the
    // fallback the UI offers when the full set is rejected — a working export
    // connection beats no connection — never the default, because a token
    // without the autofill scopes can never drive the design engine.
    const scopeList = resolveRequestedScopes(Deno.env.get("CANVA_SCOPES"), body?.minimal === true);

    const verifier = randomString(48);
    const challenge = b64url(await sha256(verifier));
    const state = randomString(24);

    const admin = createClient(supabaseUrl, serviceKey);
    const { error: stateErr } = await admin.from("canva_oauth_states").insert({
      state,
      user_id: userData.user.id,
      code_verifier: verifier,
      redirect_to: redirectTo,
    });
    if (stateErr) throw stateErr;

    const url = new URL(CANVA_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scopeList.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");

    // Return the scopes alongside the URL so the caller can show what it is
    // about to ask for, and so a failed consent can be reported against a
    // known request rather than a guess.
    return new Response(
      JSON.stringify({
        authorize_url: url.toString(),
        scopes_requested: scopeList,
        redirect_uri: redirectUri,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
