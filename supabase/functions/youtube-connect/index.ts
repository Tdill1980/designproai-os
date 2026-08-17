/**
 * youtube-connect — the one-time OAuth handshake that gives YouTube upload
 * a refresh token.
 *
 * Owner, 2026-08-05: "set up the Post to WrapTVWorld YouTube".
 *
 * `youtube-publish` can upload, but `videos.insert` writes to a channel, so it
 * needs a USER credential — an API key only reads public data. That credential
 * is a refresh token, and obtaining one requires a browser signed into the
 * WrapTVWorld channel clicking Allow. No server can do that step alone, which
 * is why this exists: it makes the human part two clicks instead of a
 * hand-built URL and a curl command.
 *
 * ── HOW TO USE IT ──────────────────────────────────────────────────────────
 *   1. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET (Actions ->
 *      "Set Function Secret").
 *   2. In Google Cloud, add this function's URL as an authorised redirect URI.
 *   3. Open this function in a browser SIGNED IN AS THE WRAPTVWORLD CHANNEL.
 *      It sends you to Google; approving returns here and prints the refresh
 *      token once.
 *   4. Store it as YOUTUBE_REFRESH_TOKEN with the same workflow.
 *
 * ── WHY access_type=offline AND prompt=consent ─────────────────────────────
 * Google returns a refresh token ONLY on the first consent for a client, and
 * silently omits it afterwards — the single most common way this setup fails,
 * leaving you with an access token that dies in an hour. `prompt=consent`
 * forces a fresh one every time, so a re-run always works.
 *
 * ── AFTER SETUP ────────────────────────────────────────────────────────────
 * This function has no other purpose. It cannot read your channel or post
 * anything — it only exchanges a code you authorised — but there is no reason
 * to leave a consent endpoint exposed, so delete it once the token is stored.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SCOPE = "https://www.googleapis.com/auth/youtube.upload";

function page(title: string, bodyHtml: string, status = 200) {
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
     <style>
       body{font:16px/1.55 system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#0f172a}
       code,pre{background:#f1f5f9;border-radius:8px}
       code{padding:2px 6px} pre{padding:14px;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
       a.btn{display:inline-block;background:linear-gradient(90deg,#3b82f6,#ec4899);color:#fff;
             padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700}
       .warn{background:#fef3c7;border:1px solid #fcd34d;padding:12px;border-radius:8px}
       .err{background:#fee2e2;border:1px solid #fca5a5;padding:12px;border-radius:8px}
     </style><h2>${title}</h2>${bodyHtml}`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

serve(async (req: Request) => {
  const url = new URL(req.url);
  const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
  const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  // THE REDIRECT URI MUST BE THE PUBLIC ONE, and it cannot be derived from
  // the request. Inside the edge runtime `url` is the INTERNAL request: it
  // arrives as http, and the gateway has already stripped the `/functions/v1`
  // prefix — so `url.origin + url.pathname` yields
  // `http://<ref>.supabase.co/youtube-connect`, which is neither HTTPS nor the
  // real path. Google demands HTTPS and a byte-exact match, so that would fail
  // every time with redirect_uri_mismatch. Verified against the deployed
  // function before this fix. Build it from SUPABASE_URL instead.
  const base = (Deno.env.get("SUPABASE_URL") || `https://${url.hostname}`).replace(/\/+$/, "");
  const redirectUri = `${base}/functions/v1/youtube-connect`;

  if (!clientId || !clientSecret) {
    return page("YouTube isn't configured yet", `
      <p class="err">Set <code>YOUTUBE_CLIENT_ID</code> and <code>YOUTUBE_CLIENT_SECRET</code> first —
      GitHub → Actions → <b>Set Function Secret (manual)</b>, once for each.</p>
      <p>Create them in Google Cloud → APIs &amp; Services → Credentials →
      <b>Create credentials → OAuth client ID → Web application</b>, and add this
      as an authorised redirect URI:</p>
      <pre>${redirectUri}</pre>`, 400);
  }

  const err = url.searchParams.get("error");
  if (err) {
    return page("Google returned an error", `
      <p class="err">${err}</p>
      <p>If it says <code>redirect_uri_mismatch</code>, the URI registered in Google
      Cloud must be exactly:</p><pre>${redirectUri}</pre>`, 400);
  }

  const code = url.searchParams.get("code");

  // Step 1 — send them to Google.
  if (!code) {
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", SCOPE);
    // Both are required for a refresh token — see the note at the top.
    auth.searchParams.set("access_type", "offline");
    auth.searchParams.set("prompt", "consent");
    return page("Connect YouTube", `
      <p>This authorises uploads to <b>one channel</b> — whichever account you approve with.</p>
      <p class="warn">Sign in as the <b>WrapTVWorld</b> channel before continuing.
      Approving with the wrong account connects the wrong channel.</p>
      <p><a class="btn" href="${auth.toString()}">Continue to Google →</a></p>
      <p style="color:#64748b;font-size:14px">Scope requested: <code>youtube.upload</code> — permission to
      upload videos. It cannot read your data or manage the channel.</p>`);
  }

  // Step 2 — exchange the code. This is the only chance to see the token.
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.refresh_token) {
    return page("No refresh token came back", `
      <p class="err">${data.error_description || data.error || `HTTP ${res.status}`}</p>
      <p>Google only returns a refresh token on a FRESH consent. If you have approved
      this client before, remove it at
      <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>
      and try again.</p>`, 400);
  }

  return page("Connected — store this now", `
    <p class="warn"><b>Shown once.</b> Copy it before closing this tab.</p>
    <pre>${data.refresh_token}</pre>
    <p>Store it as <code>YOUTUBE_REFRESH_TOKEN</code>:<br>
    GitHub → Actions → <b>Set Function Secret (manual)</b> → Run workflow.</p>
    <p>Then delete this function — it has no other use.</p>
    <p style="color:#64748b;font-size:14px">Uploads start working on the next
    content-deploy run (~5 minutes).</p>`);
});
