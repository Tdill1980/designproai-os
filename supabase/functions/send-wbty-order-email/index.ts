import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LANCE_EMAIL = Deno.env.get("WPW_FULFILLMENT_EMAIL") || "lance@weprintwraps.com";
const FROM_EMAIL = Deno.env.get("ORDER_FROM_EMAIL") || "orders@restylepro.ai";
const RESTYLEPRO_BRAND_NAME = "RestylePro";

interface OrderPayload {
  mode?: "quote" | "fulfillment"; // fulfillment = paid via Stripe, quote = pre-payment lead
  orderId?: string;
  orderType: "printed_wrap" | "design_file";
  pattern: { id?: string; name: string; category?: string; media_url?: string };
  vehicle: { year: string; make: string; model: string; label: string };
  finish: string;
  yards: number | null;
  pricePerYard: number | null;
  totalPrice: number;
  wholesaleCost?: number | null;
  margin?: number | null;
  vehicleSize?: string;
  renderUrl?: string | null;
  additionalViews?: Record<string, string | undefined>;
  customer: { name: string; email: string; phone?: string };
  shippingAddress: string | null;
  notes?: string;
  submittedAt: string;
  paymentStatus?: string;
  stripeSessionId?: string;
}

function buildLanceHtml(p: OrderPayload, orderId: string): string {
  const isPrint = p.orderType === "printed_wrap";
  const isFulfillment = p.mode === "fulfillment";
  const title = isFulfillment
    ? (isPrint ? "🚀 PAID ORDER — PRINT & SHIP (White Label)" : "🚀 PAID ORDER — Design File")
    : (isPrint ? "New Printed Wrap Quote" : "New Design File Quote");

  const fulfilled = isFulfillment
    ? "Customer has paid RestylePro. Print & ship blind under RestylePro branding."
    : "Quote/lead — customer has NOT paid yet";

  const headerColor = isFulfillment
    ? "linear-gradient(135deg,#10b981,#059669)" // green = paid
    : "linear-gradient(135deg,#ec4899,#a855f7)"; // pink = quote

  const viewsHtml = p.additionalViews
    ? Object.entries(p.additionalViews).filter(([, url]) => url).map(([type, url]) =>
        `<td style="padding:4px;"><a href="${url}" target="_blank"><img src="${url}" alt="${type}" style="width:120px;height:80px;object-fit:cover;border-radius:6px;border:1px solid #ddd;" /><div style="font-size:11px;color:#666;text-align:center;margin-top:2px;">${type}</div></a></td>`).join("")
    : "";

  const whiteLabelBanner = isFulfillment && isPrint ? `
    <div style="background:#fef3c7;border:2px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-size:16px;font-weight:bold;color:#92400e;">⚠️ WHITE LABEL — SHIP BLIND</p>
      <ul style="margin:0;padding-left:20px;font-size:14px;color:#78350f;">
        <li><strong>NO WPW branding</strong> on packaging, packing slip, or label</li>
        <li>Return label: <strong>${RESTYLEPRO_BRAND_NAME}</strong> (use plain box / unbranded packaging)</li>
        <li>Use your own carrier accounts</li>
        <li>${(p.totalPrice >= 750) ? "✅ FREE SHIPPING (order $750+)" : "Standard shipping ($25 charged to customer)"}</li>
        <li>Customer thinks RestylePro printed and shipped it</li>
      </ul>
    </div>` : "";

  const moneyRow = isFulfillment ? `
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0;" />
    <h2 style="margin:0 0 12px;font-size:16px;color:#111;">💰 Settlement (B2B — separate invoice)</h2>
    <table style="width:100%;font-size:14px;color:#333;">
      <tr><td style="padding:4px 0;width:180px;color:#666;">Customer paid (retail):</td><td>$${p.totalPrice.toFixed(2)}</td></tr>
      ${p.wholesaleCost != null ? `<tr><td style="padding:4px 0;color:#666;">WPW wholesale (98%):</td><td><strong style="color:#059669;">$${p.wholesaleCost.toFixed(2)}</strong></td></tr>` : ""}
      ${p.margin != null ? `<tr><td style="padding:4px 0;color:#666;">RestylePro margin (2%):</td><td>$${p.margin.toFixed(2)}</td></tr>` : ""}
    </table>
    <p style="font-size:11px;color:#999;margin-top:8px;">Settled monthly via separate B2B invoice. Customer never sees this.</p>
  ` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f5f5f5;margin:0;padding:24px;"><div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);"><div style="background:${headerColor};padding:24px;color:#fff;"><h1 style="margin:0;font-size:22px;">${title}</h1><p style="margin:6px 0 0;opacity:0.9;font-size:13px;">${fulfilled}</p><p style="margin:6px 0 0;opacity:0.8;font-size:11px;">Order ID: ${orderId}${p.stripeSessionId ? ` • Stripe: ${p.stripeSessionId}` : ""}</p></div><div style="padding:24px;">${whiteLabelBanner}<h2 style="margin:0 0 12px;font-size:16px;color:#111;">Customer (Ship To)</h2><table style="width:100%;font-size:14px;color:#333;border-collapse:collapse;"><tr><td style="padding:4px 0;width:120px;color:#666;">Name:</td><td><strong>${p.customer.name}</strong></td></tr><tr><td style="padding:4px 0;color:#666;">Email:</td><td><a href="mailto:${p.customer.email}">${p.customer.email}</a></td></tr>${p.customer.phone ? `<tr><td style="padding:4px 0;color:#666;">Phone:</td><td><a href="tel:${p.customer.phone}">${p.customer.phone}</a></td></tr>` : ""}</table>${isPrint && p.shippingAddress ? `<h3 style="margin:12px 0 8px;font-size:14px;color:#111;">Shipping Address</h3><div style="background:#f9fafb;padding:12px;border-radius:8px;font-size:14px;white-space:pre-wrap;border-left:3px solid #ec4899;">${p.shippingAddress}</div>` : ""}<hr style="border:none;border-top:1px solid #eee;margin:20px 0;" /><h2 style="margin:0 0 12px;font-size:16px;color:#111;">Pattern to Print</h2><table style="width:100%;font-size:14px;"><tr>${p.pattern.media_url ? `<td style="width:150px;padding-right:12px;"><a href="${p.pattern.media_url}" target="_blank"><img src="${p.pattern.media_url}" alt="${p.pattern.name}" style="width:150px;height:150px;object-fit:cover;border-radius:8px;border:1px solid #ddd;" /></a><p style="font-size:10px;text-align:center;margin:4px 0 0;color:#666;">Click to download</p></td>` : ""}<td style="vertical-align:top;"><p style="margin:0;font-weight:bold;font-size:18px;">${p.pattern.name}</p>${p.pattern.category ? `<p style="margin:4px 0;color:#666;font-size:13px;">Category: ${p.pattern.category}</p>` : ""}<p style="margin:4px 0;color:#666;font-size:13px;">Finish: <strong>${p.finish}</strong></p>${isPrint && p.yards ? `<p style="margin:4px 0;font-size:14px;">Quantity: <strong>${p.yards} yards</strong> @ 60" wide</p>` : ""}${p.pattern.id ? `<p style="margin:4px 0;color:#999;font-size:11px;">Pattern ID: ${p.pattern.id}</p>` : ""}</td></tr></table><hr style="border:none;border-top:1px solid #eee;margin:20px 0;" /><h2 style="margin:0 0 12px;font-size:16px;color:#111;">Vehicle</h2><table style="width:100%;font-size:14px;color:#333;"><tr><td style="padding:4px 0;width:120px;color:#666;">Vehicle:</td><td><strong>${p.vehicle.label}</strong></td></tr>${p.vehicleSize ? `<tr><td style="padding:4px 0;color:#666;">Size class:</td><td>${p.vehicleSize}</td></tr>` : ""}</table>${moneyRow}${p.renderUrl ? `<hr style="border:none;border-top:1px solid #eee;margin:20px 0;" /><h2 style="margin:0 0 12px;font-size:16px;color:#111;">3D Proof (customer-approved)</h2><a href="${p.renderUrl}" target="_blank"><img src="${p.renderUrl}" alt="3D proof" style="width:100%;max-width:600px;border-radius:8px;border:1px solid #ddd;" /></a>` : ""}${viewsHtml ? `<h3 style="margin:16px 0 8px;font-size:14px;color:#111;">Additional Views</h3><table><tr>${viewsHtml}</tr></table>` : ""}${p.notes ? `<hr style="border:none;border-top:1px solid #eee;margin:20px 0;" /><h2 style="margin:0 0 12px;font-size:16px;color:#111;">Customer Notes</h2><div style="background:#fef3c7;padding:12px;border-radius:8px;font-size:14px;white-space:pre-wrap;">${p.notes}</div>` : ""}<hr style="border:none;border-top:1px solid #eee;margin:20px 0;" /><p style="font-size:12px;color:#999;margin:0;">${isFulfillment ? "PAID" : "Quote"} ${new Date(p.submittedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT via PatternPro on RestylePro.ai</p></div></div></body></html>`;
}

function buildCustomerHtml(p: OrderPayload, orderId: string): string {
  const isPrint = p.orderType === "printed_wrap";
  const isFulfillment = p.mode === "fulfillment";

  return `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f5f5f5;margin:0;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 4px 12px rgba(0,0,0,0.08);"><h1 style="margin:0 0 12px;color:#ec4899;">${isFulfillment ? "Order confirmed" : "Thanks"}, ${p.customer.name}!</h1><p style="font-size:14px;color:#333;">${isFulfillment ? `Your payment was received and your ${isPrint ? "wrap is being prepared for production" : "design file order is in progress"}.` : `We received your ${isPrint ? "printed wrap" : "design file"} request.`}</p><div style="background:#f9fafb;padding:16px;border-radius:8px;margin:16px 0;font-size:14px;"><p style="margin:0;"><strong>Order ID:</strong> ${orderId}</p><p style="margin:8px 0 0;"><strong>Pattern:</strong> ${p.pattern.name}</p><p style="margin:8px 0 0;"><strong>Vehicle:</strong> ${p.vehicle.label}</p>${isPrint ? `<p style="margin:8px 0 0;"><strong>Yards:</strong> ${p.yards}</p>` : ""}<p style="margin:8px 0 0;"><strong>Total:</strong> $${p.totalPrice.toFixed(2)}</p>${isFulfillment ? `<p style="margin:8px 0 0;color:#059669;"><strong>Status:</strong> ✅ Paid</p>` : ""}</div>${p.renderUrl ? `<div style="margin:16px 0;"><img src="${p.renderUrl}" alt="Your design" style="width:100%;border-radius:8px;border:1px solid #ddd;" /></div>` : ""}<p style="font-size:14px;color:#333;">${isFulfillment ? (isPrint ? `Your wrap is being printed now and will ship within 2-5 business days. We'll email you tracking as soon as it's on its way.${p.totalPrice >= 750 ? " Your order qualified for FREE shipping!" : ""}` : "Your print-ready design file will be emailed to you within 24 hours.") : (isPrint ? "We'll reach out within 1 business day to confirm your order, finalize payment, and arrange shipping." : "Your print-ready design file will be emailed within 24 hours of payment.")}</p><p style="font-size:12px;color:#999;margin-top:24px;">Questions? Reply to this email.</p><p style="font-size:11px;color:#bbb;margin-top:8px;">RestylePro.ai • PatternPro™</p></div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const payload: OrderPayload = await req.json();
    if (!payload.pattern?.name || !payload.customer?.email) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const orderId = payload.orderId || `WPW-${Date.now().toString(36).toUpperCase()}`;
    const isPrint = payload.orderType === "printed_wrap";
    const isFulfillment = payload.mode === "fulfillment";

    const subject = isFulfillment
      ? (isPrint
          ? `🚀 PAID — Print & Ship (White Label) — ${payload.pattern.name} for ${payload.vehicle.label} — $${payload.totalPrice.toFixed(2)}`
          : `🚀 PAID — Design File — ${payload.pattern.name} — $${payload.totalPrice.toFixed(2)}`)
      : (isPrint
          ? `New Printed Wrap Quote — ${payload.pattern.name} for ${payload.vehicle.label} — $${payload.totalPrice.toFixed(2)}`
          : `New Design File Quote — ${payload.pattern.name} — $${payload.totalPrice.toFixed(2)}`);

    const html = buildLanceHtml(payload, orderId);

    const lanceResult = await resend.emails.send({
      from: `RestylePro Orders <${FROM_EMAIL}>`,
      to: [LANCE_EMAIL],
      reply_to: payload.customer.email,
      subject,
      html,
    });

    if ((lanceResult as any).error) {
      console.error("Resend error (Lance):", (lanceResult as any).error);
      throw new Error(`Failed to send order email: ${(lanceResult as any).error.message || "unknown"}`);
    }

    // Customer confirmation
    const customerSubject = isFulfillment
      ? `Order confirmed: ${payload.pattern.name}`
      : `Quote received: ${payload.pattern.name}`;

    await resend.emails.send({
      from: `RestylePro <${FROM_EMAIL}>`,
      to: [payload.customer.email],
      subject: customerSubject,
      html: buildCustomerHtml(payload, orderId),
    });

    return new Response(JSON.stringify({ success: true, orderId, sentTo: LANCE_EMAIL, mode: payload.mode || "quote" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Order email error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
