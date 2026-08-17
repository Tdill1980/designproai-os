/**
 * send-team-email — internal one-off notifier for the WePrintWraps team.
 * Clean WePrintWraps shell (Outlook-safe: solid colors, no clipped-gradient
 * text, no remote hero image that clients block). Locked to WePrintWraps /
 * RestylePro staff domains so it can't be an open relay.
 *
 * Body: { to[], cc[], subject, html (inner body), replyTo?, eyebrow?, fromName? }
 *   - eyebrow:  small label under the wordmark (default "Engine Room").
 *   - fromName: sender display name (default "Claude · WePrintWraps").
 *
 * Identity: these read as automated notes from Claude, the AI Engine Room
 * assistant — a Claude byline up top and a "— Claude" system footer.
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_DOMAINS = ["weprintwraps.com", "restyleproai.com"];
// Exact-address exceptions for staff whose personal address is on record
// (see src/lib/admin-allowlist.ts) — NOT a domain-wide opening.
const ALLOWED_EXACT = ["amandakinz1111@gmail.com"];
function internalOnly(list: string[]): string[] {
  return (list || [])
    .map((e) => String(e || "").trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) &&
      (ALLOWED_EXACT.includes(e) || ALLOWED_DOMAINS.some((d) => e.endsWith("@" + d) || e.endsWith("." + d))));
}

function esc(s: string): string {
  return String(s || "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
}

// Outlook-safe: solid colors only (no background-clip:text), no remote images.
// Identity: these are automated notes from Claude, the Engine Room assistant.
function brandShell(inner: string, eyebrow: string): string {
  return `
  <div style="max-width:600px;margin:0 auto;font-family:'Segoe UI',Inter,Arial,sans-serif;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
    <div style="padding:24px 28px 0;">
      <div style="font-size:24px;font-weight:900;letter-spacing:-0.4px;color:#0f172a;">WePrint<span style="color:#ec4899;">Wraps</span></div>
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#94a3b8;margin-top:5px;">${esc(eyebrow)}</div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;">
      <tr><td style="padding:0 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle" style="padding-right:9px;">
            <div bgcolor="#6366f1" style="width:26px;height:26px;border-radius:50%;background:#6366f1;background:linear-gradient(135deg,#3b82f6,#ec4899);color:#ffffff;font-size:14px;font-weight:800;text-align:center;line-height:26px;">C</div>
          </td>
          <td valign="middle">
            <span style="font-size:13px;font-weight:800;color:#0f172a;">Claude</span>
            <span style="font-size:12px;color:#94a3b8;">&nbsp;·&nbsp; automated note from your Engine Room assistant</span>
          </td>
        </tr></table>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;">
      <tr><td style="padding:0 28px;">
        <div bgcolor="#3b82f6" style="height:4px;border-radius:4px;background:#3b82f6;background:linear-gradient(90deg,#3b82f6,#ec4899);font-size:0;line-height:0;">&nbsp;</div>
      </td></tr>
    </table>
    <div style="padding:22px 28px;color:#374151;font-size:15px;line-height:1.6;">${inner}</div>
    <div style="padding:16px 28px;border-top:1px solid #eef2f7;">
      <div style="font-size:12px;color:#94a3b8;">— Claude, WePrintWraps' AI operations assistant · <a href="https://restyleproai.com/wpw/engine-room" style="color:#3b82f6;text-decoration:none;">open the board</a></div>
      <div style="font-size:11px;color:#cbd5e1;margin-top:4px;">Automated message. Reply to reach the team.</div>
    </div>
  </div>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json();
    const to = internalOnly(body.to);
    const cc = internalOnly(body.cc);
    if (to.length === 0) return new Response(JSON.stringify({ error: "No valid internal recipients" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!body.subject || !body.html) return new Response(JSON.stringify({ error: "subject and html required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const eyebrow = (typeof body.eyebrow === "string" && body.eyebrow.trim()) ? body.eyebrow.trim().slice(0, 40) : "Engine Room";
    const fromName = (typeof body.fromName === "string" && body.fromName.trim()) ? body.fromName.trim().slice(0, 40) : "Claude · WePrintWraps";
    // Strip characters that can't appear in a From display name.
    const safeFrom = fromName.replace(/[<>"\r\n]/g, "").trim() || "WePrintWraps";

    const payload: any = {
      from: `${safeFrom} <Design@weprintwraps.com>`,
      to,
      subject: String(body.subject).slice(0, 200),
      html: brandShell(String(body.html), eyebrow),
    };
    if (cc.length > 0) payload.cc = cc;
    if (body.replyTo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.replyTo)) payload.reply_to = body.replyTo;

    const res = await resend.emails.send(payload);
    if (res.error) {
      console.error("send-team-email: resend error:", res.error);
      return new Response(JSON.stringify({ error: res.error.message || "send failed" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, id: res.data?.id ?? null, to, cc }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
