import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ViewData {
  type: string;
  url: string;
  label?: string;
}

interface QuoteLineItem {
  label: string;
  detail?: string;
  amount: number;
}

interface QuoteData {
  quoteNumber: string;
  vehicle: string;
  colorName: string;
  manufacturer: string;
  finish: string;
  lineItems: QuoteLineItem[];
  total: string;
  region?: string;
}

interface EmailRequest {
  to: string;
  cc?: string;
  clientName: string;
  subject: string;
  body: string;
  emailType: "proof" | "studio" | "quote" | "all";
  vehicleInfo: { year?: string; make?: string; model?: string };
  views?: ViewData[];
  proofPdfUrl?: string;
  quoteData?: QuoteData;
  shopName?: string;
  shopLogoUrl?: string;
  /** verified sender override (deliverability). e.g. "Design@weprintwraps.com"
   *  so the email comes from the address the customer already knows instead of
   *  a cold noreply@ domain that lands in spam. */
  fromEmail?: string;
  /** customer-portal approval link — renders an "Approve / Review" button. */
  portalUrl?: string;
  /** when set, the send is RECORDED on the proof (source of truth): a 'sent'
   *  event with the message + the designs/thumbnails sent, and (if markSent)
   *  status→sent + sent_at + message_to_customer. Used by the resilient Send
   *  fallback when proof-send 401s. */
  proof_id?: string;
  markSent?: boolean;
}

function buildHtml(req: EmailRequest): string {
  const vehicle = [req.vehicleInfo.year, req.vehicleInfo.make, req.vehicleInfo.model].filter(Boolean).join(" ");
  const shopDisplay = req.shopName || "Your Wrap Shop";

  // Shop header
  const shopHeader = req.shopLogoUrl
    ? `<img src="${req.shopLogoUrl}" alt="${shopDisplay}" style="max-height:50px;max-width:200px;margin-bottom:8px;" />`
    : `<h2 style="margin:0;font-size:20px;color:#ffffff;font-weight:700;">${shopDisplay}</h2>`;

  // Vehicle badge
  const vehicleBadge = vehicle
    ? `<p style="margin:8px 0 0;font-size:12px;color:#e0e7ff;font-weight:600;">${vehicle}</p>`
    : "";

  // Body text — convert newlines to <br>
  const bodyHtml = req.body.replace(/\n/g, "<br />");

  // Proof images section
  let proofSection = "";
  if ((req.emailType === "proof" || req.emailType === "all") && req.views?.length) {
    const heroView = req.views[0];
    const thumbs = req.views.slice(1);
    proofSection = `
      <tr><td style="padding:24px 32px 0;">
        <p style="margin:0 0 12px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Approval Proof</p>
        <img src="${heroView.url}" alt="${heroView.label || "Hero View"}" style="width:100%;border-radius:8px;display:block;" />
        ${thumbs.length > 0 ? `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr>
            ${thumbs.slice(0, 4).map(v => `<td style="width:25%;padding:4px;"><img src="${v.url}" alt="${v.label || v.type}" style="width:100%;border-radius:4px;display:block;" /></td>`).join("")}
          </tr></table>
        ` : ""}
        ${req.proofPdfUrl ? `<p style="margin:12px 0 0;"><a href="${req.proofPdfUrl}" style="color:#00C7FF;font-size:13px;font-weight:600;text-decoration:none;">Download Proof PDF</a></p>` : ""}
      </td></tr>`;
  }

  // Studio proof section
  let studioSection = "";
  if ((req.emailType === "studio" || req.emailType === "all") && req.views?.length) {
    studioSection = `
      <tr><td style="padding:24px 32px 0;">
        <p style="margin:0 0 12px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Studio Views</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${req.views.reduce((rows: string[], v, i) => {
            if (i % 2 === 0) rows.push("<tr>");
            rows[rows.length - 1] += `<td style="width:50%;padding:4px;"><img src="${v.url}" alt="${v.label || v.type}" style="width:100%;border-radius:6px;display:block;" /><p style="margin:4px 0 8px;font-size:10px;color:#888;text-align:center;">${v.label || v.type}</p></td>`;
            if (i % 2 === 1 || i === req.views!.length - 1) rows[rows.length - 1] += "</tr>";
            return rows;
          }, []).join("")}
        </table>
      </td></tr>`;
  }

  // Quote section
  let quoteSection = "";
  if ((req.emailType === "quote" || req.emailType === "all") && req.quoteData) {
    const q = req.quoteData;
    const lineRows = q.lineItems.map(item => `
      <tr>
        <td style="padding:6px 0;font-size:13px;color:#e0e0e0;border-bottom:1px solid #222;">${item.label}${item.detail ? `<br/><span style="font-size:11px;color:#888;">${item.detail}</span>` : ""}</td>
        <td style="padding:6px 0;font-size:13px;color:#ffffff;text-align:right;font-weight:600;border-bottom:1px solid #222;">$${item.amount.toFixed(2)}</td>
      </tr>
    `).join("");

    quoteSection = `
      <tr><td style="padding:24px 32px 0;">
        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Quote</p>
        <p style="margin:0 0 12px;font-size:10px;color:#666;">Quote #${q.quoteNumber}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;">Item</td>
            <td style="padding:8px 0;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;text-align:right;border-bottom:1px solid #333;">Amount</td>
          </tr>
          ${lineRows}
          <tr>
            <td style="padding:12px 0 0;font-size:15px;color:#00C7FF;font-weight:700;">Total</td>
            <td style="padding:12px 0 0;font-size:15px;color:#00C7FF;font-weight:700;text-align:right;">$${q.total}</td>
          </tr>
        </table>
      </td></tr>`;
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#000000;">
    <tr><td align="center" style="padding:24px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#0d0d0d;border:1px solid #1a1a1a;border-radius:12px;overflow:hidden;">

        <!-- Shop Header -->
        <tr><td style="padding:24px 32px;background:linear-gradient(135deg,#2563eb,#a855f7);border-bottom:1px solid #1a1a1a;text-align:center;">
          ${shopHeader}
          ${vehicleBadge}
        </td></tr>

        <!-- Body Message -->
        <tr><td style="padding:24px 32px;">
          <p style="margin:0 0 4px;font-size:14px;color:#ffffff;font-weight:600;">Hi ${req.clientName},</p>
          <div style="margin:12px 0 0;font-size:14px;color:#cccccc;line-height:1.6;">${bodyHtml}</div>
        </td></tr>

        ${req.portalUrl ? `
        <!-- Approve / Review CTA -->
        <tr><td style="padding:8px 32px 0;text-align:center;">
          <a href="${req.portalUrl}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#a855f7);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:10px;">Review &amp; Approve Your Design →</a>
        </td></tr>` : ""}

        ${proofSection}
        ${studioSection}
        ${quoteSection}

        <!-- Footer -->
        <tr><td style="padding:32px;border-top:1px solid #1a1a1a;text-align:center;">
          <p style="margin:0 0 8px;font-size:10px;color:#444;">
            Powered by <span style="color:#00C7FF;font-weight:600;">RestyleProAI</span>
          </p>
          <p style="margin:0;font-size:9px;color:#333;">Professional Vehicle Wrap Visualization</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: EmailRequest = await req.json();
    const approveProSend = Boolean(
      (payload as EmailRequest & { proof_id?: string }).proof_id ||
      /\/approve\//i.test(String(payload.portalUrl || "")),
    );
    if (approveProSend && !isApproveProLive()) {
      return approveProDisabledResponse();
    }

    if (!payload.to || !payload.clientName || !payload.emailType) {
      return new Response(
        JSON.stringify({ error: "to, clientName, and emailType are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const html = buildHtml(payload);

    // Sender — uses verified restyleproai.com domain so we can send to any recipient.
    // The shop name appears as the friendly "from" name; the actual address is locked.
    const fromName = (payload.shopName || "RestylePro").replace(/[<>"]/g, "");
    // Deliverability: use the verified sender the customer already corresponds
    // with when provided (e.g. Design@weprintwraps.com) so the proof lands in the
    // inbox, not spam. Falls back to the restyleproai.com verified domain.
    const fromAddr = (payload.fromEmail || "").replace(/[<>"\s]/g, "") || "noreply@restyleproai.com";
    const emailPayload: any = {
      from: `${fromName} <${fromAddr}>`,
      to: Array.isArray(payload.to) ? payload.to : [payload.to],
      subject: payload.subject || `Your Vehicle Wrap Proof — ${payload.shopName || "RestylePro"}`,
      html,
    };

    // CC the shop owner so they stay in the loop
    if (payload.cc) {
      emailPayload.cc = [payload.cc];
    }

    // If the shop owner has their own real email, set reply_to so client replies go to them
    if (payload.cc) {
      emailPayload.reply_to = payload.cc;
    }

    const emailResponse = await resend.emails.send(emailPayload);

    console.log(`Client proof email response (${payload.emailType}):`, JSON.stringify(emailResponse));

    // Resend returns { data, error } — must check error explicitly, it does NOT throw
    if (emailResponse.error) {
      console.error("Resend error:", emailResponse.error);
      return new Response(
        JSON.stringify({
          error: emailResponse.error.message || "Resend rejected the email",
          details: emailResponse.error,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!emailResponse.data?.id) {
      return new Response(
        JSON.stringify({ error: "Email send returned no message ID — likely silently rejected" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // RECORD THE SEND ON THE PROOF (source of truth) — service role, so it works
    // even when the browser write / proof-send is RLS-blocked or 401s. Logs a
    // 'sent' event with the message + the designs (thumbnails) the customer got,
    // so the ADMIN activity shows exactly what was emailed + what was written.
    let recorded = false;
    if (payload.proof_id) {
      try {
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
        const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (SUPABASE_URL && SERVICE_KEY) {
          const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
          const sentAt = new Date().toISOString();
          const recipient = Array.isArray(payload.to) ? payload.to[0] : payload.to;
          const designsSent = (payload.views || []).map((v) => ({ type: v.type, label: v.label || v.type, url: v.url }));
          if (payload.markSent) {
            await db.from("proof_approvals").update({
              status: "sent",
              sent_at: sentAt,
              message_to_customer: payload.body || null,
            }).eq("id", payload.proof_id);
          }
          await db.from("proof_events").insert({
            proof_id: payload.proof_id,
            event_type: "sent",
            actor_role: "shop",
            payload: {
              channel: "email",
              to: recipient,
              resend_message_id: emailResponse.data.id,
              message: payload.body || null,
              designs_sent: designsSent,
              designs_count: designsSent.length,
              via: "send-client-proof-email",
            },
          });
          recorded = true;
        }
      } catch (recErr: any) {
        console.error("send-client-proof-email: record-on-proof failed (email still sent):", recErr?.message || recErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        messageId: emailResponse.data.id,
        emailType: payload.emailType,
        recorded,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in send-client-proof-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
