import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SPROCKET_IMG = "https://restyleproai.com/characters/sproket/sproket-clipboard.png";

function baseUrl(): string {
  return Deno.env.get("PROOF_PUBLIC_BASE_URL") || "https://restyleproai.com";
}

interface RequestBody {
  to: string;
  customerName?: string;
  orderNumber?: string;
  vehicle?: string;
  shopName?: string;
  isWpw?: boolean;
  replyTo?: string;
  kind?: "request" | "greeting";
  wooOrderId?: number | string;
  // Manual sends from the workbench pass force:true to bypass the once-per-order
  // idempotency guard (the automatic on-order-placement path leaves it unset).
  force?: boolean;
}

// ── Shared brand chrome (ApprovePro™ × WePrintWraps.com) ─────────────────────
function brandHeader(): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#3b82f6" style="background:#3b82f6;background:linear-gradient(90deg,#3b82f6,#ec4899);border-radius:12px 12px 0 0;">
    <tr>
      <td valign="middle" style="padding:16px 14px 16px 20px;width:60px;">
        <img src="${SPROCKET_IMG}" width="52" height="52" alt="Sprocket" style="display:block;width:52px;height:52px;object-fit:contain;" />
      </td>
      <td valign="middle" style="padding:16px 20px 16px 4px;">
        <div style="font-family:Inter,Arial,sans-serif;font-size:18px;font-weight:800;color:#ffffff;line-height:1.15;">
          ApprovePro&trade; <span style="font-weight:600;opacity:.9;">&times;</span> WePrintWraps.com
        </div>
        <div style="font-family:Inter,Arial,sans-serif;font-size:12px;color:#ffffff;opacity:.95;margin-top:2px;">
          Vehicle Wrap Design &amp; Approval System
        </div>
      </td>
    </tr>
  </table>`;
}

function ctaButton(url: string, label: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 6px;">
    <tr>
      <td bgcolor="#3b82f6" style="border-radius:10px;background:#3b82f6;background:linear-gradient(90deg,#3b82f6,#ec4899);">
        <a href="${url}" style="display:inline-block;padding:14px 28px;font-family:Inter,Arial,sans-serif;font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:10px;">${label} &rarr;</a>
      </td>
    </tr>
  </table>`;
}

function brandFooter(): string {
  return `
    <div style="padding:16px 24px;border-top:1px solid #e5e7eb;text-align:center;font-family:Inter,Arial,sans-serif;">
      <div style="font-size:13px;font-weight:800;color:#111827;">
        Approve<span style="color:#ec4899;">Pro</span>&trade;
        <span style="color:#9ca3af;font-weight:600;">&times;</span>
        <span style="color:#3b82f6;">WePrint</span><span style="color:#ec4899;">Wraps</span><span style="color:#111827;">.com</span>
      </div>
      <div style="font-size:11px;color:#9ca3af;margin-top:3px;">Vehicle Wrap Design &amp; Approval System</div>
    </div>`;
}

function shell(inner: string): string {
  return `
  <div style="max-width:560px;margin:0 auto;font-family:Inter,Arial,sans-serif;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
    ${brandHeader()}
    <div style="padding:24px 28px;">${inner}</div>
    ${brandFooter()}
  </div>`;
}

function buildRequestHtml(b: RequestBody, portalUrl: string | null): string {
  const name = (b.customerName || "there").replace(/[<>]/g, "");
  const orderLine = b.orderNumber ? `Order #${b.orderNumber}` : "your wrap design order";
  const vehicleLine = b.vehicle ? `<p style="margin:2px 0 0;font-size:13px;color:#6b7280;">${b.vehicle}</p>` : "";
  const cta = portalUrl
    ? `${ctaButton(portalUrl, "Start your design")}
       <p style="margin:6px 0 0;font-size:13px;color:#374151;line-height:1.5;">
         In your design portal you can <strong>type what you want</strong> and <strong>upload logos, photos, or inspiration</strong> — and once your proof is ready you'll review, revise with AI, and approve right there.
       </p>`
    : `<p style="margin:14px 0 0;font-size:14px;color:#374151;line-height:1.5;">
         Our design team will reach out shortly to collect your details.
       </p>`;

  return shell(`
    <h2 style="margin:0;font-size:20px;color:#111827;font-weight:800;">We need a few details to start your design</h2>
    <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${orderLine}</p>
    ${vehicleLine}
    <p style="margin:18px 0 8px;font-size:14px;color:#111827;">Hi ${name},</p>
    <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.5;">
      Thanks for your order! Before our design team can begin, tell us:
    </p>
    <ul style="margin:0 0 4px;padding-left:18px;font-size:14px;color:#374151;line-height:1.7;">
      <li>A short description of what you'd like on your wrap</li>
      <li>Your vehicle <strong>year, make, and model</strong></li>
      <li>Any <strong>logos, brand colors, or photos</strong> to include</li>
      <li>Any <strong>examples or inspiration</strong> you like</li>
    </ul>
    ${cta}
  `);
}

function buildGreetingHtml(b: RequestBody, portalUrl: string | null): string {
  const name = (b.customerName || "there").replace(/[<>]/g, "");
  const orderLine = b.orderNumber ? `Order #${b.orderNumber}` : "your wrap design order";
  const vehicleLine = b.vehicle ? `<p style="margin:2px 0 0;font-size:13px;color:#6b7280;">${b.vehicle}</p>` : "";
  const cta = portalUrl
    ? `${ctaButton(portalUrl, "Open your design portal")}
       <p style="margin:6px 0 0;font-size:13px;color:#374151;line-height:1.5;">
         You can add more details or photos any time, and once your proof is ready you'll <strong>review, revise with AI, and approve right from your phone</strong>.
       </p>`
    : `<p style="margin:14px 0 0;font-size:14px;color:#374151;line-height:1.5;">
         Your design team will keep you posted as your proof comes together.
       </p>`;

  return shell(`
    <h2 style="margin:0;font-size:20px;color:#111827;font-weight:800;">Thanks — your wrap design is underway! 🎨</h2>
    <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${orderLine}</p>
    ${vehicleLine}
    <p style="margin:18px 0 8px;font-size:14px;color:#111827;">Hi ${name},</p>
    <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.5;">
      We've got your order and the details you provided, and our design team is getting started on your wrap.
    </p>
    <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#111827;">Here's what to expect through WePrintWraps &times; ApprovePro:</p>
    <ol style="margin:0 0 4px;padding-left:18px;font-size:14px;color:#374151;line-height:1.7;">
      <li>Our design team + AI turn your details into a proof.</li>
      <li>We email &amp; text you a private link to your ApprovePro portal.</li>
      <li>You review, <strong>revise with AI</strong>, and approve — right from your phone.</li>
    </ol>
    ${cta}
  `);
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as RequestBody;
    if (!body.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.to)) {
      return new Response(JSON.stringify({ error: "A valid customer email is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const db = url && serviceKey ? createClient(url, serviceKey) : null;

    // Find this order's proof: skip if already emailed, grab the view_token for
    // the portal link, and log the email on the order's thread.
    let proofId: string | null = null;
    let portalUrl: string | null = null;
    if (db && body.wooOrderId != null) {
      const { data: proof } = await db
        .from("proof_approvals")
        .select("id, metadata, view_token")
        .eq("metadata->>wpw_woo_order_id", String(body.wooOrderId))
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (proof) {
        proofId = (proof as any).id;
        if ((proof as any).view_token) portalUrl = `${baseUrl()}/approve/${(proof as any).view_token}`;
        const md0 = (proof as any).metadata || {};
        if (!body.force && (md0.instructions_requested_at || md0.welcome_sent_at)) {
          return new Response(JSON.stringify({ ok: true, skipped: "already_sent" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const kind = body.kind === "greeting" ? "greeting" : "request";
    const fromName = (body.shopName || (body.isWpw ? "WePrintWraps Design" : "RestylePro")).replace(/[<>"]/g, "");
    const subject = kind === "greeting"
      ? (body.orderNumber ? `Your wrap design is underway — Order #${body.orderNumber}` : "Your wrap design is underway")
      : (body.orderNumber ? `Quick details needed for your wrap design — Order #${body.orderNumber}` : "Quick details needed for your wrap design");
    const payload: any = {
      from: body.isWpw ? `${fromName} <Design@weprintwraps.com>` : `${fromName} <noreply@restyleproai.com>`,
      to: [body.to],
      subject,
      html: kind === "greeting" ? buildGreetingHtml(body, portalUrl) : buildRequestHtml(body, portalUrl),
    };
    if (body.isWpw) payload.reply_to = "Design@weprintwraps.com";
    else if (body.replyTo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.replyTo)) payload.reply_to = body.replyTo;

    const res = await resend.emails.send(payload);
    if (res.error) {
      console.error("[request-order-instructions] resend error:", res.error);
      return new Response(JSON.stringify({ error: res.error.message || "Email failed to send" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (db && proofId) {
      const sentAt = new Date().toISOString();
      try {
        const { data: cur } = await db.from("proof_approvals").select("metadata").eq("id", proofId).maybeSingle();
        const stampKey = kind === "greeting" ? "welcome_sent_at" : "instructions_requested_at";
        const md = { ...((cur as any)?.metadata || {}), [stampKey]: sentAt, intake_email_to: body.to };
        await db.from("proof_approvals").update({ metadata: md, updated_at: sentAt }).eq("id", proofId);
        await db.from("proof_events").insert({
          proof_id: proofId,
          event_type: kind === "greeting" ? "welcome_sent" : "instructions_requested",
          actor_role: "system",
          payload: {
            to: body.to,
            order_number: body.orderNumber ?? null,
            message: kind === "greeting"
              ? "Sent the customer a greeting — design underway."
              : "Requested design instructions & artwork from the customer.",
            subject: payload.subject,
            html: payload.html,
          },
        });
      } catch (e) {
        console.warn("[request-order-instructions] logging failed (non-fatal):", e);
      }
    }

    return new Response(JSON.stringify({ ok: true, id: res.data?.id ?? null }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[request-order-instructions] error:", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
