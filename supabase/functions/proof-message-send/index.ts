/**
 * proof-message-send — customer ⇄ team messaging (customer side).
 *
 * The customer asks the design team a question / adds info from their portal.
 * We:
 *   1. Store the message (proof_messages, sender_role='customer').
 *   2. Draft an AI reply ("as us") and store it as an ai_draft awaiting
 *      approval — so the team can one-click "send as us".
 *   3. Email the team (Trish + Jackson + shop notification_emails) with the
 *      question, the AI draft, and a secure one-click "Approve & send as us"
 *      link, plus an "open in ApprovePro" link.
 *   4. Text the team a short alert (best-effort).
 *
 * Token-based (HMAC view token) — no login. Per JWT.md §1: verify_jwt=false.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function baseUrl(): string {
  return Deno.env.get("PROOF_PUBLIC_BASE_URL") || "https://restyleproai.com";
}

function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── HMAC verify (view token) — same scheme as _shared/proof-tokens.ts ──
function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + 8192, bytes.length))));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
// Reply-approve action token: signs the draft message id.
async function signReplyToken(secret: string, messageId: string): Promise<string> {
  return b64urlEncode(await hmac(secret, `replyapprove:${messageId}`));
}

function teamEmails(shopNotify: string[]): string[] {
  const env = (Deno.env.get("TEAM_NOTIFY_EMAILS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const base = env.length > 0 ? env : ["trish@weprintwraps.com", "jackson@weprintwraps.com"];
  const all = [...base, ...(shopNotify || [])].map((e) => e.toLowerCase().trim());
  return Array.from(new Set(all)).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
}
function teamPhones(): string[] {
  return (Deno.env.get("TEAM_NOTIFY_SMS") || "").split(",").map((s) => s.trim()).filter(Boolean);
}

async function draftAiReply(opts: {
  customerName: string; designName: string; vehicle: string; question: string; shopName: string;
}): Promise<string | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return null;
  const prompt = `You are a friendly, professional member of the ${opts.shopName} vehicle-wrap design team replying to a customer about their wrap design order. Write a SHORT reply (2-4 sentences) in first-person plural ("we"), warm and helpful, as if sending it directly to the customer. Do NOT invent prices, dates, or design specifics you weren't told. If they ask something only the designer can answer, reassure them their designer is on it and will follow up. No greeting line is needed beyond "Hi ${opts.customerName || "there"},". Sign off as "— The ${opts.shopName} Design Team".

Design: ${opts.designName}
Vehicle: ${opts.vehicle || "(not specified)"}
Customer's message: "${opts.question}"`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 400 },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) { console.warn("draftAiReply: gemini http", res.status); return null; }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("").trim();
    return text || null;
  } catch (e) {
    console.warn("draftAiReply failed:", (e as any)?.message || e);
    return null;
  }
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

async function sendSms(to: string, bodyText: string): Promise<boolean> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const auth = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!sid || !auth || !from) return false;
  try {
    const form = new URLSearchParams();
    form.append("To", to); form.append("From", from); form.append("Body", bodyText);
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${sid}:${auth}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch { return false; }
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { token, body: messageBody } = await req.json().catch(() => ({}));
    if (!token) return json({ error: "token required" }, 400);
    if (!messageBody || String(messageBody).trim().length < 2) return json({ error: "Message is required" }, 400);
    const text = String(messageBody).trim().slice(0, 4000);

    const secret = Deno.env.get("PROOF_TOKEN_SECRET");
    if (!secret) return json({ error: "Server misconfiguration" }, 500);
    const uuid = await verifyViewToken(token, secret);
    if (!uuid) return json({ error: "Invalid token" }, 404);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: proof } = await db.from("proof_approvals").select("*").eq("view_token", token).single();
    if (!proof) return json({ error: "Proof not found" }, 404);

    // 1. Store the customer message.
    const { data: custMsg, error: insErr } = await db.from("proof_messages").insert({
      proof_id: proof.id,
      sender_role: "customer",
      sender_name: proof.customer_name || null,
      body: text,
      status: "sent",
      sent_at: new Date().toISOString(),
    }).select("id").single();
    if (insErr) { console.error("proof-message-send: insert failed", insErr); return json({ error: "Could not save message" }, 500); }

    // Shop context for branding + team recipients.
    let shopName = "WePrintWraps";
    let shopNotify: string[] = [];
    try {
      const { data: sp } = await db.from("shop_profiles").select("shop_name, notification_emails").eq("user_id", proof.shop_id).maybeSingle();
      if (sp?.shop_name) shopName = sp.shop_name;
      if (Array.isArray(sp?.notification_emails)) shopNotify = sp.notification_emails;
    } catch { /* non-fatal */ }

    const vehicle = [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model].filter(Boolean).join(" ");
    const designName = proof.design_name || "their wrap design";
    const orderNo = (proof.metadata as any)?.wpw_order_number || (proof.metadata as any)?.wpw_woo_order_id || null;
    const orderTag = orderNo ? `Order #${orderNo}` : "";

    // 2. Draft an AI reply and store it.
    const draft = await draftAiReply({
      customerName: proof.customer_name || "", designName, vehicle, question: text, shopName,
    });
    let draftId: string | null = null;
    if (draft) {
      const { data: d } = await db.from("proof_messages").insert({
        proof_id: proof.id,
        sender_role: "ai_draft",
        sender_name: `${shopName} Design Team`,
        body: draft,
        status: "draft",
        reply_to_message_id: custMsg.id,
      }).select("id").single();
      draftId = d?.id || null;
    }

    // 3. Email the team with the question + AI draft + one-click approve link.
    const workbenchUrl = `${baseUrl()}/approvepro?id=${proof.id}`;
    let approveUrl: string | null = null;
    if (draftId) {
      const t = await signReplyToken(secret, draftId);
      approveUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/proof-message-approve-reply?mid=${draftId}&t=${t}`;
    }
    const recipients = teamEmails(shopNotify);
    if (recipients.length > 0) {
      const draftBlock = draft
        ? `<div style="margin:14px 0;padding:14px 16px;background:#eff6ff;border-left:3px solid #3b82f6;border-radius:6px;">
             <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#1d4ed8;">AI-drafted reply (review before sending)</p>
             <p style="margin:0;font-size:14px;color:#111;line-height:1.55;white-space:pre-wrap;">${esc(draft)}</p>
           </div>
           ${approveUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 2px;"><tr><td bgcolor="#16a34a" style="border-radius:8px;"><a href="${approveUrl}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:8px;">✓ Approve &amp; send as us</a></td></tr></table>` : ""}`
        : `<p style="margin:14px 0;font-size:13px;color:#92400e;">(AI draft unavailable — reply from ApprovePro.)</p>`;
      await sendResend({
        from: `ApprovePro × ${shopName} <Design@weprintwraps.com>`,
        to: recipients,
        reply_to: "Design@weprintwraps.com",
        subject: `💬 ${proof.customer_name || "A customer"} messaged you${orderNo ? ` — Order #${orderNo}` : ` — ${designName}`}`,
        html: `<div style="max-width:560px;margin:0 auto;font-family:Inter,Arial,sans-serif;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <div style="padding:16px 20px;background:#3b82f6;background:linear-gradient(90deg,#3b82f6,#ec4899);color:#fff;">
            <div style="font-size:16px;font-weight:800;">New customer message</div>
            <div style="font-size:12px;opacity:.95;">ApprovePro™ × WePrintWraps · Vehicle Wrap Design &amp; Approval System</div>
          </div>
          <div style="padding:20px 24px;color:#374151;font-size:14px;line-height:1.6;">
            ${orderTag ? `<div style="display:inline-block;margin:0 0 8px;padding:4px 10px;background:#111827;color:#fff;border-radius:999px;font-size:13px;font-weight:800;letter-spacing:.3px;">${esc(orderTag)}</div>` : ""}
            <p style="margin:0 0 4px;"><strong>${esc(proof.customer_name || "Customer")}</strong> &lt;${esc(proof.customer_email || "")}&gt;</p>
            <p style="margin:0 0 12px;font-size:12px;color:#6b7280;">${esc(designName)}${vehicle ? " · " + esc(vehicle) : ""}</p>
            <div style="margin:0 0 4px;padding:14px 16px;background:#f9fafb;border-left:3px solid #9ca3af;border-radius:6px;">
              <p style="margin:0;font-size:14px;color:#111;line-height:1.55;white-space:pre-wrap;">${esc(text)}</p>
            </div>
            ${draftBlock}
            <p style="margin:16px 0 0;font-size:13px;"><a href="${workbenchUrl}" style="color:#2563eb;font-weight:600;text-decoration:none;">Reply your own way in ApprovePro →</a></p>
          </div>
        </div>`,
      });
    }

    // 4. Text the team a short alert (best-effort).
    const phones = teamPhones();
    const smsBody = `ApprovePro: ${proof.customer_name || "A customer"} messaged about ${designName}. Open ApprovePro to approve the AI reply or respond.`;
    for (const p of phones) { await sendSms(p, smsBody); }

    // Audit.
    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: "customer_message",
      actor_role: "customer",
      payload: { message: text, ai_drafted: !!draft, notified: recipients },
    });

    return json({ success: true });
  } catch (e: any) {
    console.error("proof-message-send: error", e);
    return json({ error: "Unexpected server error", detail: e?.message }, 500);
  }
});
