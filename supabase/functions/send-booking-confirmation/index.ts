// ──────────────────────────────────────────────────────────────────────
// send-booking-confirmation
//
// Sends a branded HTML confirmation email to the customer after a
// booking is approved (status → confirmed). Pulls shop branding from
// the `shops` table. Delivery via Resend.
//
// Body: { bookingId: string }
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { corsHeaders } from "../_shared/cors.ts";

function svc() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── HTML email template ────────────────────────────────────────────────

function buildConfirmationHtml(opts: {
  customerName: string;
  serviceName: string;
  scheduledAt: string;
  durationMinutes: number | null;
  shopName: string;
  shopPhone: string | null;
  shopEmail: string | null;
  notes: string | null;
}): string {
  const date = new Date(opts.scheduledAt);
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const duration = opts.durationMinutes ? `${opts.durationMinutes} min` : "";

  const contactBlock = [
    opts.shopPhone ? `<p style="margin:4px 0;font-size:14px;">Phone: <a href="tel:${opts.shopPhone}" style="color:#00C7FF;">${opts.shopPhone}</a></p>` : "",
    opts.shopEmail ? `<p style="margin:4px 0;font-size:14px;">Email: <a href="mailto:${opts.shopEmail}" style="color:#00C7FF;">${opts.shopEmail}</a></p>` : "",
  ].filter(Boolean).join("\n");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#111111;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#e0e0e0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#111111;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0e7490,#06b6d4);padding:28px 32px;text-align:center;">
          <h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:700;">Booking Confirmed</h1>
          <p style="margin:8px 0 0;font-size:14px;color:#e0f2fe;">${opts.shopName}</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;color:#f0f0f0;">
            Hi ${opts.customerName || "there"},
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#d0d0d0;line-height:1.6;">
            Your appointment has been confirmed. Here are the details:
          </p>
          <!-- Details card -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#252525;border-radius:8px;border:1px solid #333;">
            <tr><td style="padding:20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#999;width:120px;">Service</td>
                  <td style="padding:6px 0;font-size:14px;color:#f0f0f0;font-weight:600;">${opts.serviceName}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#999;">Date</td>
                  <td style="padding:6px 0;font-size:14px;color:#f0f0f0;font-weight:600;">${dateStr}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#999;">Time</td>
                  <td style="padding:6px 0;font-size:14px;color:#f0f0f0;font-weight:600;">${timeStr}</td>
                </tr>
                ${duration ? `<tr>
                  <td style="padding:6px 0;font-size:13px;color:#999;">Duration</td>
                  <td style="padding:6px 0;font-size:14px;color:#f0f0f0;">${duration}</td>
                </tr>` : ""}
                ${opts.notes ? `<tr>
                  <td style="padding:6px 0;font-size:13px;color:#999;">Notes</td>
                  <td style="padding:6px 0;font-size:14px;color:#d0d0d0;">${opts.notes}</td>
                </tr>` : ""}
              </table>
            </td></tr>
          </table>
          ${contactBlock ? `
          <p style="margin:24px 0 8px;font-size:14px;color:#d0d0d0;">
            Questions? Contact us:
          </p>
          ${contactBlock}` : ""}
          <p style="margin:28px 0 0;font-size:13px;color:#777;line-height:1.5;">
            If you need to reschedule or cancel, please contact the shop directly.
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 32px;text-align:center;border-top:1px solid #333;">
          <p style="margin:0;font-size:11px;color:#666;">
            Powered by RestyleProAI &mdash; Vehicle Wrap Design System
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildPlainText(opts: {
  customerName: string;
  serviceName: string;
  scheduledAt: string;
  durationMinutes: number | null;
  shopName: string;
  shopPhone: string | null;
  shopEmail: string | null;
  notes: string | null;
}): string {
  const date = new Date(opts.scheduledAt);
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  const lines = [
    `BOOKING CONFIRMED — ${opts.shopName}`,
    "",
    `Hi ${opts.customerName || "there"},`,
    "",
    "Your appointment has been confirmed:",
    "",
    `  Service:  ${opts.serviceName}`,
    `  Date:     ${dateStr}`,
    `  Time:     ${timeStr}`,
    opts.durationMinutes ? `  Duration: ${opts.durationMinutes} min` : "",
    opts.notes ? `  Notes:    ${opts.notes}` : "",
    "",
    "Questions? Contact us:",
    opts.shopPhone ? `  Phone: ${opts.shopPhone}` : "",
    opts.shopEmail ? `  Email: ${opts.shopEmail}` : "",
    "",
    "If you need to reschedule or cancel, please contact the shop directly.",
  ].filter((l) => l !== undefined);

  return lines.join("\n");
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("[send-booking-confirmation] RESEND_API_KEY not set");
    return json(500, { ok: false, error: "email service not configured" });
  }

  let body: { bookingId?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid json" });
  }

  if (!body.bookingId) return json(400, { ok: false, error: "bookingId required" });

  const sb = svc();

  // Load booking
  const { data: booking, error: bErr } = await sb
    .from("customer_bookings")
    .select("id, customer_name, customer_email, service_name, scheduled_at, duration_minutes, notes, shop_id, status")
    .eq("id", body.bookingId)
    .single();

  if (bErr || !booking) {
    console.error("[send-booking-confirmation] booking not found:", bErr?.message);
    return json(404, { ok: false, error: "booking not found" });
  }

  if (!booking.customer_email) {
    console.warn("[send-booking-confirmation] no customer email on booking", booking.id);
    return json(422, { ok: false, error: "booking has no customer email" });
  }

  // Load shop info
  const { data: shop } = await sb
    .from("shops")
    .select("name, contact_email, contact_phone")
    .eq("id", booking.shop_id)
    .single();

  const shopName = shop?.name || "Your Wrap Shop";
  const shopEmail = shop?.contact_email || null;
  const shopPhone = shop?.contact_phone || null;

  const fromEmail = Deno.env.get("BOOKINGPRO_FROM_EMAIL") || "bookings@resend.dev";

  const emailOpts = {
    customerName: booking.customer_name || "",
    serviceName: booking.service_name || "Appointment",
    scheduledAt: booking.scheduled_at,
    durationMinutes: booking.duration_minutes,
    shopName,
    shopPhone,
    shopEmail,
    notes: booking.notes,
  };

  const resend = new Resend(apiKey);

  try {
    const { error: sendErr } = await resend.emails.send({
      from: `${shopName} <${fromEmail}>`,
      to: [booking.customer_email],
      reply_to: shopEmail || undefined,
      subject: `Booking Confirmed — ${booking.service_name} on ${new Date(booking.scheduled_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      html: buildConfirmationHtml(emailOpts),
      text: buildPlainText(emailOpts),
    });

    if (sendErr) {
      console.error("[send-booking-confirmation] Resend error:", sendErr);
      return json(500, { ok: false, error: "email send failed" });
    }

    console.log(`[send-booking-confirmation] Sent to ${booking.customer_email} for booking ${booking.id}`);
    return json(200, { ok: true, sentTo: booking.customer_email });
  } catch (err: any) {
    console.error("[send-booking-confirmation] send error:", err?.message);
    return json(500, { ok: false, error: err?.message || "email send failed" });
  }
});
