/**
 * canva-client — shared helper for Canva Connect API calls from edge
 * functions. Loads the caller's tokens, refreshes them if expired, and
 * exposes a thin `canvaFetch` wrapper so each endpoint stays small.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CANVA_API_BASE = "https://api.canva.com/rest/v1";
const CANVA_TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";

export type CanvaTokens = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
};

export function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function getUserFromAuthHeader(
  authHeader: string,
): Promise<{ id: string } | null> {
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data } = await client.auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id };
}

export async function loadTokens(userId: string): Promise<CanvaTokens | null> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("canva_integrations")
    .select("user_id, access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .single();
  return (data as CanvaTokens) || null;
}

/**
 * The tokens a SERVER pass should use, when there is no signed-in user.
 *
 * The autonomous passes call `marketing-agent` with a service-role bearer.
 * `auth.getUser()` resolves no user for that, so `loadTokens` was never
 * reached and every server-side design call silently fell back to a stock
 * library image. Connecting Canva would not have changed a single output —
 * the pass had no way to hold a token at all.
 *
 * `ownerId` wins when given. Otherwise this resolves the SOLE connected
 * integration, and refuses when there is more than one:
 *
 *   A second operator's Canva account holds a different company's logo,
 *   fonts and brand templates. Picking one arbitrarily would publish one
 *   person's brand identity under another's name, and it would look correct
 *   while doing it. "Ambiguous" is a real answer; a coin flip is not.
 *
 * Returns the reason on the empty cases so the caller can say WHICH of
 * "nobody has connected Canva" and "more than one person has" it hit — the
 * two need opposite fixes and are indistinguishable from a null.
 */
export async function loadServerTokens(
  ownerId?: string | null,
): Promise<{ tokens: CanvaTokens | null; reason: string; candidates: number }> {
  if (ownerId) {
    const tokens = await loadTokens(ownerId);
    return {
      tokens,
      reason: tokens ? "" : `no Canva integration for user ${ownerId}`,
      candidates: tokens ? 1 : 0,
    };
  }
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("canva_integrations")
    .select("user_id, access_token, refresh_token, token_expires_at")
    .limit(2);
  if (error) return { tokens: null, reason: `canva_integrations unreadable: ${error.message}`, candidates: 0 };
  const rows = (data || []) as CanvaTokens[];
  if (rows.length === 0) {
    return { tokens: null, reason: "no Canva account is connected", candidates: 0 };
  }
  if (rows.length > 1) {
    return {
      tokens: null,
      reason: "more than one Canva account is connected — pass canva_owner_id to choose",
      candidates: rows.length,
    };
  }
  return { tokens: rows[0], reason: "", candidates: 1 };
}

async function refreshTokens(tokens: CanvaTokens): Promise<CanvaTokens> {
  const clientId = Deno.env.get("CANVA_CLIENT_ID")!;
  const clientSecret = Deno.env.get("CANVA_CLIENT_SECRET")!;
  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(CANVA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    // A REVOKED or expired token lineage is terminal — Canva will never honour
    // this refresh token again, no matter how many times we retry. Left in
    // place it becomes a dead end: `canva-status` reports connected because a
    // row exists, so the UI never offers "Connect Canva", while every call
    // fails with `invalid_grant / Token lineage has been revoked`.
    //
    // So drop the dead credentials. The account then correctly reads as
    // disconnected and the existing reconnect prompt appears — the one action
    // that actually fixes it.
    //
    // ONLY on invalid_grant. A 500 or a network blip is transient; nuking a
    // working connection over one bad night would be worse than the bug.
    if (res.status === 400 && /invalid_grant/i.test(detail)) {
      try {
        await getAdminClient()
          .from("canva_integrations")
          .delete()
          .eq("user_id", tokens.user_id);
      } catch { /* the throw below still routes the user to reconnect */ }
      throw new Error("canva_not_connected");
    }
    throw new Error(`Canva refresh failed (${res.status}): ${detail}`);
  }
  const body = await res.json();
  const newTokens: CanvaTokens = {
    user_id: tokens.user_id,
    access_token: body.access_token,
    refresh_token: body.refresh_token || tokens.refresh_token,
    token_expires_at: new Date(Date.now() + Number(body.expires_in || 3600) * 1000).toISOString(),
  };
  const admin = getAdminClient();
  await admin
    .from("canva_integrations")
    .update({
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      token_expires_at: newTokens.token_expires_at,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", tokens.user_id);
  return newTokens;
}

export async function ensureFreshTokens(tokens: CanvaTokens): Promise<CanvaTokens> {
  const expiresAt = new Date(tokens.token_expires_at).getTime();
  // Refresh if the token has less than 60 seconds of life left
  if (expiresAt - Date.now() < 60_000) {
    return await refreshTokens(tokens);
  }
  return tokens;
}

export async function canvaFetch(
  tokens: CanvaTokens,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const fresh = await ensureFreshTokens(tokens);
  const url = path.startsWith("http") ? path : `${CANVA_API_BASE}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "Authorization": `Bearer ${fresh.access_token}`,
      "Content-Type": "application/json",
    },
  });
}

/**
 * UPLOAD AN IMAGE INTO CANVA, so a template can be filled with REAL WORK.
 *
 * Owner, 2026-08-13: "I need creatives built… using our photos, screen stills,
 * videos stored in library and googledrive. That is the product."
 *
 * Until this existed there was no way to get a library image INTO Canva, so
 * `autofillText` filled only `type === "text"` and every template's
 * `hero_image` field kept its placeholder. A creative carrying Canva's stock
 * photo instead of a real install is not the product — it is a caption on
 * somebody else's picture.
 *
 * Canva's upload endpoint is not JSON: the metadata rides in a header as
 * base64 and the BODY IS THE RAW BYTES, so it cannot go through `canvaFetch`
 * (which forces `Content-Type: application/json`). Hence the direct fetch here
 * with a freshened token.
 */
export async function uploadCanvaAsset(
  tokens: CanvaTokens,
  imageUrl: string,
  name: string,
): Promise<string> {
  const fresh = await ensureFreshTokens(tokens);

  const src = await fetch(imageUrl);
  if (!src.ok) throw new Error(`canva_asset_source_unreachable: ${src.status}`);
  const bytes = new Uint8Array(await src.arrayBuffer());
  if (!bytes.length) throw new Error("canva_asset_source_empty");

  // Canva caps uploads; a 4K still from the library can exceed it, and the
  // honest failure is a named error rather than a truncated upload.
  const MAX_BYTES = 25 * 1024 * 1024;
  if (bytes.length > MAX_BYTES) throw new Error(`canva_asset_too_large: ${bytes.length}`);

  // The name is base64 of the UTF-8 bytes — btoa alone breaks on any
  // non-ASCII character in a filename, which the library has plenty of.
  const nameBytes = new TextEncoder().encode(name.slice(0, 120) || "creative");
  const nameB64 = btoa(String.fromCharCode(...nameBytes));

  const res = await fetch("https://api.canva.com/rest/v1/asset-uploads", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${fresh.access_token}`,
      "Content-Type": "application/octet-stream",
      "Asset-Upload-Metadata": JSON.stringify({ name_base64: nameB64 }),
    },
    body: bytes,
  });
  const started = await res.json().catch(() => ({})) as Record<string, any>;
  if (!res.ok) throw new Error(`canva_asset_upload_${res.status}: ${JSON.stringify(started).slice(0, 200)}`);

  // The upload is a JOB. Returning the id before it succeeds would hand the
  // autofill an asset that does not exist yet.
  let job = started.job ?? started;
  for (let i = 0; i < 30 && String(job?.status || "").toLowerCase() !== "success"; i++) {
    if (String(job?.status || "").toLowerCase() === "failed") {
      throw new Error(`canva_asset_upload_failed: ${JSON.stringify(job?.error ?? {}).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, 700));
    const poll = await canvaFetch(fresh, `/asset-uploads/${encodeURIComponent(String(job?.id || started.job?.id || ""))}`);
    const body = await poll.json().catch(() => ({})) as Record<string, any>;
    job = body.job ?? body;
  }

  const assetId = job?.asset?.id ?? job?.asset_id;
  if (!assetId) throw new Error("canva_asset_id_missing");
  return String(assetId);
}
