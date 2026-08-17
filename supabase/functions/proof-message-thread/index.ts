/**
 * proof-message-thread — the FULL conversation for a proof.
 *
 * Customer messages arrive through several paths and land in TWO tables:
 *   • proof_messages  — the portal "message the team" box + approved team
 *     replies (and Sprocket's shop replies). sender_role customer|team|shop.
 *   • proof_events    — the portal "add details / revise" box (customer_comment),
 *     "request a revision" (revision_requested) and the customer's AI-revise
 *     box (ai_revise_started). These carry the customer's actual words in the
 *     event payload and were previously INVISIBLE here — the #1 "I can't see
 *     all the customer's messages" bug.
 *
 * This returns BOTH, merged + time-sorted, so the shop (ApprovePro) and the
 * customer both see every message. The event types we pull are the ones NOT
 * mirrored into proof_messages, so nothing is double-counted.
 *
 * Token-based (HMAC view token). Per JWT.md §1: verify_jwt = false.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
function ctEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function verifyViewToken(token: string, secret: string): Promise<string | null> {
  const idx = token.indexOf(".");
  if (idx < 0) return null;
  const uuid = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (uuid.length !== 36 || !/^[0-9a-f-]{36}$/i.test(uuid) || !sig) return null;
  try {
    const expected = await hmac(secret, `view:${uuid}`);
    if (!ctEq(expected, b64urlDecode(sig))) return null;
    return uuid;
  } catch { return null; }
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { token } = await req.json().catch(() => ({}));
    if (!token) return json({ error: "token required" }, 400);
    const secret = Deno.env.get("PROOF_TOKEN_SECRET");
    if (!secret) return json({ error: "Server misconfiguration" }, 500);
    const uuid = await verifyViewToken(token, secret);
    if (!uuid) return json({ error: "Invalid token" }, 404);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: proof } = await db.from("proof_approvals").select("id").eq("view_token", token).single();
    if (!proof) return json({ error: "Proof not found" }, 404);

    // 1) Real messages (portal "message the team" + team/shop replies).
    const { data: msgRows } = await db
      .from("proof_messages")
      .select("id, sender_role, sender_name, body, created_at, sent_at")
      .eq("proof_id", proof.id)
      .eq("status", "sent")
      .in("sender_role", ["customer", "team", "shop"]);

    // 2) Message-bearing EVENTS that are NOT mirrored into proof_messages —
    //    the portal "add details" comment, a requested revision, and the
    //    customer's AI-revise prompts. These carry the customer's words and
    //    were the ones going missing from ApprovePro.
    const { data: evRows } = await db
      .from("proof_events")
      .select("id, event_type, actor_role, payload, created_at")
      .eq("proof_id", proof.id)
      .in("event_type", ["customer_comment", "revision_requested", "ai_revise_started"]);

    const fromMsgs = (msgRows || []).map((r: any) => ({
      id: `m_${r.id}`,
      role: r.sender_role === "shop" ? "team" : r.sender_role, // 'customer' | 'team'
      name: r.sender_name,
      body: r.body,
      at: r.sent_at || r.created_at,
    }));

    const fromEvents = (evRows || []).map((e: any) => {
      const p = e.payload || {};
      const text = p.message || p.notes || p.prompt || "";
      if (!text || String(text).trim().length === 0) return null;
      return {
        id: `e_${e.id}`,
        role: e.actor_role === "shop" || e.actor_role === "system" ? "team" : "customer",
        name: null,
        body: String(text),
        at: e.created_at,
      };
    }).filter(Boolean) as Array<{ id: string; role: string; name: string | null; body: string; at: string }>;

    const messages = [...fromMsgs, ...fromEvents]
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    return json({ success: true, messages });
  } catch (e: any) {
    console.error("proof-message-thread: error", e);
    return json({ error: "Unexpected server error", detail: e?.message }, 500);
  }
});
