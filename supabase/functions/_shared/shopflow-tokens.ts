/**
 * SHOPFLOW ACCESS TOKENS — the thing that makes a customer order page safe.
 *
 * WHY THIS EXISTS, stated plainly so it is not "simplified" later. The tracker
 * this replaces looked an order up by ORDER NUMBER ALONE, on a public page, with
 * no RLS behind it. Walk the numbers and you read other customers' names,
 * totals, addresses and uploaded files. That is the single thing the new page
 * must not do, and every design decision here follows from it.
 *
 * So the page NEVER takes an order number as authority. A visitor proves they
 * own an email — either by being signed in, or by naming one order number that
 * genuinely belongs to that email — and what they get back is a token bound to
 * THE EMAIL, never to an order. The order number is a shared secret used once
 * to prove ownership; it grants nothing on its own and is not carried onward.
 *
 * FORMAT:  base64url(payload_json) "." base64url(hmac_sha256(secret, material))
 *   payload = { e: <lowercased email>, x: <expiry, ms since epoch> }
 *   material = "shopflow.v1|" + base64url(payload_json)
 *
 * The literal domain tag in the material is deliberate. The secret may be
 * shared with the proof-approval system (below), and without a domain tag a
 * proof token and a ShopFlow token signed by the same key would be
 * interchangeable — one system's token would open the other. The tag makes the
 * two signature spaces disjoint even on an identical key.
 *
 * SECRET: `SHOPFLOW_TOKEN_SECRET`, falling back to `PROOF_TOKEN_SECRET` so this
 * ships without provisioning a new Supabase secret first. There is no default
 * and no dev fallback — a missing secret THROWS rather than signing with a
 * guessable key, because the failure mode of a weak key here is silent and
 * total. Rotate either secret to invalidate every outstanding token at once.
 *
 * Verification is constant-time and happens BEFORE any database read, so a
 * forged token costs an attacker a signature comparison and nothing else.
 */

const DELIM = ".";
const DOMAIN = "shopflow.v1";

/** 30 days. Long enough to be useful from an old chat transcript, short enough
 *  that a token found in a shared screenshot does not live forever. */
export const SHOPFLOW_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function secret(): string {
  const s = Deno.env.get("SHOPFLOW_TOKEN_SECRET") || Deno.env.get("PROOF_TOKEN_SECRET");
  if (!s || s.length < 32) {
    throw new Error(
      "SHOPFLOW_TOKEN_SECRET (or PROOF_TOKEN_SECRET) is missing or under 32 chars. " +
        "Set it with: supabase secrets set SHOPFLOW_TOKEN_SECRET=<random 64-byte hex>",
    );
  }
  return s;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + 8192, bytes.length))));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sign(material: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(material))));
}

/** Length-independent comparison — never `===` on a signature. */
function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  // Compare a fixed number of bytes either way so length alone leaks nothing
  // beyond what the format already makes public.
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Normalised once, here, so a token minted for "A@B.com" verifies for "a@b.com"
 *  and a lookup can never match on a different casing than it granted. */
export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Mint a token bound to an email. The caller MUST have already proven the
 *  visitor owns it — this function asserts nothing about that. */
export async function mintShopflowToken(email: string, ttlMs = SHOPFLOW_TOKEN_TTL_MS): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ e: normalizeEmail(email), x: Date.now() + ttlMs })));
  return `${payload}${DELIM}${await sign(`${DOMAIN}|${payload}`)}`;
}

export type ShopflowTokenResult =
  | { ok: true; email: string; expiresAt: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

/** Verify and unpack. Returns the email the token is bound to, nothing else —
 *  callers scope every query by it and never by anything the client sent. */
export async function verifyShopflowToken(token: unknown): Promise<ShopflowTokenResult> {
  const raw = String(token ?? "");
  const cut = raw.indexOf(DELIM);
  if (cut <= 0 || cut === raw.length - 1) return { ok: false, reason: "malformed" };
  const payload = raw.slice(0, cut);
  const signature = raw.slice(cut + 1);
  // Signature FIRST: a forged payload never reaches JSON.parse, let alone a query.
  if (!constantTimeEqual(signature, await sign(`${DOMAIN}|${payload}`))) return { ok: false, reason: "bad_signature" };
  let decoded: { e?: unknown; x?: unknown };
  try {
    decoded = JSON.parse(new TextDecoder().decode(unb64url(payload)));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const email = normalizeEmail(decoded.e);
  const expiresAt = Number(decoded.x);
  if (!email || !Number.isFinite(expiresAt)) return { ok: false, reason: "malformed" };
  if (expiresAt <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, email, expiresAt };
}
