/**
 * proof-message-approve-reply — team approves an AI-drafted reply (or sends an
 * edited / freehand one) and it goes to the customer "as us".
 *
 * Two entry points, both authorized by an HMAC reply-token bound to the draft
 * message id (so the one-click email link is safe and login-free):
 *   • GET  ?mid=<draftId>&t=<token>            — one-click "send as us" (email)
 *   • POST { mid, t, body? }                   — workbench send, optional edited body
 *
 * Effect: marks the ai_draft 'dismissed', inserts a 'team' message (status
 * 'sent'), and emails the reply to the customer (branded, reply-to the team).
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
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
function htmlPage(title: string, msg: string, ok = true): Response {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title></head>
     <body style="font-family:-apple-system,Inter,Arial,sans-serif;background:#f5f5f7;margin:0;padding:40px 20px;">
       <div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;text-align:center;">
         <div style="width:52px;height:52px;border-radius:50%;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;background:${ok ? "#dcfce7" : "#fee2e2"};font-size:26px;">${ok ? "✓" : "⚠️"}</div>
         <h1 style="margin:0 0 6px;font-size:20px;color:#111;">${title}</h1>
         <p style="margin:0;font-size:14px;color:#555;line-height:1.5;">${msg}</p>
       </div>
     </body></html>`,
    { status: ok ? 200 : 400, headers: { ...corsHeaders, "Content-Type": "text/html" } },
  );
}

function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + 8192, bytes.length))));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
async function verifyReplyToken(secret: string, messageId: string, token: string): Promise<boolean> {
  try {
    const expected = b64urlEncode(await hmac(secret, `replyapprove:${messageId}`));
    // constant-ish compare
    if (expected.length !== token.length) return false;
    let d = 0;
    for (let i = 0; i < expected.length; i++) d |= expected.charCodeAt(i) ^ token.charCodeAt(i);
    return d === 0;
  } catch { return false; }
}

async function sendResend(payload: Record<string, unknown>): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch { return false; }
}

async function process(mid: string, token: string, overrideBody: string | null, wantHtml: boolean): Promise<Response> {
  const secret = Deno.env.get("PROOF_TOKEN_SECRET");
  if (!secret) return wantHtml ? htmlPage("Server error", "Configuration missing.", false) : json({ error: "Server misconfiguration" }, 500);
  if (!mid || !token || !(await verifyReplyToken(secret, mid, token))) {
    return wantHtml ? htmlPage("Link invalid", "This approval link is invalid or has expired.", false) : json({ error: "Invalid token" }, 403);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: draft } = await db.from("proof_messages").select("*").eq("id", mid).maybeSingle();
  if (!draft) return wantHtml ? htmlPage("Not found", "That message no longer exists.", false) : json({ error: "Not found" }, 404);
  if (draft.status === "dismissed") {
    return wantHtml ? htmlPage("Already sent", "This reply was already sent to the customer.") : json({ success: true, already_sent: true });
  }

  const { data: proof } = await db.from("proof_approvals").select("*").eq("id", draft.proof_id).single();
  if (!proof) return wantHtml ? htmlPage("Not found", "Order not found.", false) : json({ error: "Proof not found" }, 404);

  let shopName = "WePrintWraps";
  try {
    const { data: sp } = await db.from("shop_profiles").select("shop_name").eq("user_id", proof.shop_id).maybeSingle();
    if (sp?.shop_name) shopName = sp.shop_name;
  } catch { /* non-fatal */ }

  const replyBody = (overrideBody && overrideBody.trim().length > 1 ? overrideBody.trim() : draft.body).slice(0, 4000);

  // Mark the draft handled and record the sent team reply.
  await db.from("proof_messages").update({ status: "dismissed" }).eq("id", mid);
  const sentAt = new Date().toISOString();
  await db.from("proof_messages").insert({
    proof_id: proof.id,
    sender_role: "team",
    sender_name: `${shopName} Design Team`,
    body: replyBody,
    status: "sent",
    reply_to_message_id: draft.reply_to_message_id,
    sent_at: sentAt,
    channels: { email: true },
  });

  // Email the customer the reply.
  let delivered = false;
  if (proof.customer_email) {
    const portalUrl = `${Deno.env.get("PROOF_PUBLIC_BASE_URL") || "https://restyleproai.com"}/approve/${proof.view_token}`;
    delivered = await sendResend({
      from: `${shopName} Design Team <Design@weprintwraps.com>`,
      to: [proof.customer_email],
      reply_to: "Design@weprintwraps.com",
      subject: `Re: your ${proof.design_name || "wrap design"} — a note from our team`,
      html: `<div style="max-width:560px;margin:0 auto;font-family:Inter,Arial,sans-serif;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="height:6px;background:#3b82f6;background:linear-gradient(90deg,#3b82f6,#ec4899);"></div>
        <div style="padding:22px 26px;color:#374151;font-size:15px;line-height:1.6;">
          <p style="margin:0;white-space:pre-wrap;color:#111;">${esc(replyBody)}</p>
          <p style="margin:18px 0 0;font-size:13px;"><a href="${portalUrl}" style="color:#2563eb;font-weight:600;text-decoration:none;">Open your design portal →</a></p>
        </div>
        <div style="padding:14px 24px;border-top:1px solid #e5e7eb;text-align:center;font-size:11px;color:#9ca3af;">ApprovePro™ × ${esc(shopName)} · Vehicle Wrap Design &amp; Approval System</div>
      </div>`,
    });
  }

  await db.from("proof_events").insert({
    proof_id: proof.id,
    event_type: "team_reply_sent",
    actor_role: "team",
    payload: { message: replyBody, delivered, edited: !!(overrideBody && overrideBody.trim().length > 1) },
  });

  if (wantHtml) {
    return htmlPage("Reply sent ✓", `Your reply was sent to ${esc(proof.customer_name || "the customer")}${delivered ? "" : " (email delivery may have failed — check logs)"}.`);
  }
  return json({ success: true, delivered });
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      return await process(url.searchParams.get("mid") || "", url.searchParams.get("t") || "", null, true);
    }
    if (req.method === "POST") {
      const { mid, t, body } = await req.json().catch(() => ({}));
      return await process(mid || "", t || "", body || null, false);
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (e: any) {
    console.error("proof-message-approve-reply: error", e);
    return json({ error: "Unexpected server error", detail: e?.message }, 500);
  }
});
