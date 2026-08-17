/**
 * proof-tokens.ts
 *
 * HMAC-signed token format for the Proof Approval System.
 *
 * Format:  <uuid_v4>.<base64url(hmac_sha256(secret, uuid_v4))>
 *
 * Two distinct token kinds, each derived from its own UUID:
 *   - VIEW   — given to the customer to open the public proof page
 *   - MANAGE — given to the shop owner for revoke / resend / share
 *
 * Tokens are verified BEFORE any DB lookup to block enumeration and to
 * give attackers a constant-time signature failure path.
 *
 * Secret source:
 *   Deno.env.get("PROOF_TOKEN_SECRET")  — required Supabase Functions secret
 *
 * Why HMAC and not just UUID?
 *   - UUID v4 is unguessable but every leaked token in a log is replayable.
 *   - HMAC binds the token to our secret. Rotate the secret to invalidate
 *     every outstanding token at once (see rotate-secret runbook).
 *   - Constant-time verification stops timing-leak attacks.
 */

const TOKEN_DELIMITER = ".";

export type ProofTokenKind = "view" | "manage";

interface DecodedToken {
  uuid: string;
  signature: string;
}

function getSecret(): string {
  const secret = Deno.env.get("PROOF_TOKEN_SECRET");
  if (!secret || secret.length < 32) {
    throw new Error(
      "PROOF_TOKEN_SECRET is missing or too short (need >=32 chars). " +
        "Set it via: supabase secrets set PROOF_TOKEN_SECRET=<random-64-byte-hex>",
    );
  }
  return secret;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + 8192, bytes.length))),
    );
  }
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256(key: string, data: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return new Uint8Array(sig);
}

/**
 * Constant-time byte-array comparison. Prevents timing attacks where an
 * attacker measures response delay to learn how many bytes of the signature
 * matched.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Mint a new HMAC-signed token. Generates a fresh UUID v4 and signs it.
 *
 * @param kind — "view" or "manage". Mixed into the HMAC so a view token
 *               cannot be replayed as a manage token even with the same UUID.
 */
export async function mintProofToken(kind: ProofTokenKind): Promise<string> {
  const uuid = crypto.randomUUID();
  const secret = getSecret();
  const sig = await hmacSha256(secret, `${kind}:${uuid}`);
  return `${uuid}${TOKEN_DELIMITER}${base64UrlEncode(sig)}`;
}

function decode(token: string): DecodedToken | null {
  const idx = token.indexOf(TOKEN_DELIMITER);
  if (idx < 0) return null;
  const uuid = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  // UUID v4 sanity check — constant length, hex + dashes
  if (uuid.length !== 36) return null;
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return null;
  if (signature.length === 0) return null;
  return { uuid, signature };
}

/**
 * Verify a token's HMAC and return the embedded UUID, or null if invalid.
 * Constant-time signature comparison prevents timing leaks.
 */
export async function verifyProofToken(
  token: string,
  kind: ProofTokenKind,
): Promise<string | null> {
  const decoded = decode(token);
  if (!decoded) return null;

  let expectedSig: Uint8Array;
  let actualSig: Uint8Array;
  try {
    const secret = getSecret();
    expectedSig = await hmacSha256(secret, `${kind}:${decoded.uuid}`);
    actualSig = base64UrlDecode(decoded.signature);
  } catch {
    return null;
  }

  if (!constantTimeEqual(expectedSig, actualSig)) return null;
  return decoded.uuid;
}
