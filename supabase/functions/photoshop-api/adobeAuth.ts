// supabase/functions/photoshop-api/adobeAuth.ts
//
// Adobe Photoshop API — server-to-server OAuth (client credentials). Tokens last
// ~24h, so we cache the token at module scope and only re-fetch when it's within
// 60s of expiry. Credentials come from Supabase secrets:
//   ADOBE_CLIENT_ID, ADOBE_CLIENT_SECRET

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAdobeToken(): Promise<string> {
  // Reuse the cached token until it's about to expire.
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const clientId = Deno.env.get("ADOBE_CLIENT_ID");
  const clientSecret = Deno.env.get("ADOBE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Missing Adobe API credentials (ADOBE_CLIENT_ID / ADOBE_CLIENT_SECRET).");
  }

  const response = await fetch("https://ims-na1.adobelogin.com/ims/token/v3", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "openid,AdobeID,firefly_api,ff_apis",
    }),
  });

  if (!response.ok) {
    throw new Error(`Adobe auth failed (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  const ttlMs = data.expires_in ? Number(data.expires_in) * 1000 : 23 * 60 * 60 * 1000;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + ttlMs };
  return cachedToken.token;
}
