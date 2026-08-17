/**
 * proof-lifted-assets — read-only, token-gated fetch of a proof's saved LayerLift
 * assets for the CUSTOMER proof page (Stage 1: display only).
 *
 * The customer proof (Proof.tsx) is public + HMAC-auth. design_generation_assets
 * is RLS-protected, so the customer can't read it client-side. This endpoint
 * verifies the SAME HMAC view token as proof-view (inlined here so there is no
 * _shared bundle dependency and the security-critical proof-view function is left
 * completely untouched), then returns — via service role — the clean background +
 * lifted transparent overlay PNGs for the proof's design.
 *
 * Link: proof_approvals.metadata.autogen_visualization_id (the ApprovePro autogen
 * design id) → design_generation_assets.generation_id.
 *
 * POST { token }  →  { success, backgroundUrl, overlays: [{ url, role, kind }] }
 *
 * verify_jwt = false (custom HMAC auth). Read-only: SELECT only.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── HMAC view-token verification (inlined copy of _shared/proof-tokens.ts so the
//    MCP deploy bundle stays flat). Format: <uuid>.<base64url(hmac_sha256)>. ──
const TOKEN_DELIMITER = ".";

function getSecret(): string {
  const secret = Deno.env.get("PROOF_TOKEN_SECRET");
  if (!secret || secret.length < 32) {
    throw new Error("PROOF_TOKEN_SECRET is missing or too short (need >=32 chars).");
  }
  return secret;
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
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return new Uint8Array(sig);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyViewToken(token: string): Promise<string | null> {
  const idx = token.indexOf(TOKEN_DELIMITER);
  if (idx < 0) return null;
  const uuid = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  if (uuid.length !== 36 || !/^[0-9a-f-]{36}$/i.test(uuid) || signature.length === 0) return null;
  let expected: Uint8Array, actual: Uint8Array;
  try {
    expected = await hmacSha256(getSecret(), `view:${uuid}`);
    actual = base64UrlDecode(signature);
  } catch {
    return null;
  }
  if (!constantTimeEqual(expected, actual)) return null;
  return uuid;
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    let token: string | null = null;
    try {
      const body = await req.json();
      token = body?.token || null;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    if (!token || typeof token !== "string") return json({ error: "Missing token" }, 400);

    const proofId = await verifyViewToken(token);
    if (!proofId) return json({ error: "Invalid token" }, 404);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Resolve the design id from the proof's metadata.
    const { data: row } = await db
      .from("proof_approvals")
      .select("metadata")
      .eq("id", proofId)
      .maybeSingle();
    const meta = (row?.metadata as any) || {};
    const generationId: string | null =
      meta.autogen_visualization_id || meta.source_visualization_id || meta.visualization_id || null;

    if (!generationId) {
      return json({ success: true, backgroundUrl: null, overlays: [] });
    }

    const { data: assets } = await db
      .from("design_generation_assets")
      .select("background_url, overlay_pngs")
      .eq("generation_id", generationId)
      .order("created_at", { ascending: false })
      .limit(1);

    const dga = assets?.[0] as { background_url: string | null; overlay_pngs: any[] | null } | undefined;
    const overlays = Array.isArray(dga?.overlay_pngs)
      ? dga!.overlay_pngs
          .map((o: any) => ({ url: o?.url || o?.transparent_png_url || "", role: o?.role || o?.kind || null, kind: o?.kind || null }))
          .filter((o: any) => !!o.url)
      : [];

    return json({
      success: true,
      backgroundUrl: dga?.background_url || null,
      overlays,
    });
  } catch (err) {
    console.error("proof-lifted-assets: error", err);
    return json({ error: "Unexpected server error" }, 500);
  }
});
