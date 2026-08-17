/**
 * proof-email.ts
 *
 * Resend email helpers for the Proof Approval System. Uses the verified
 * @restyleproai.com sender domain (same one `send-client-proof-email` uses
 * after the PR #1155 fix).
 *
 * Templates:
 *   - sendProofToClient   — "Please review your design" with the view URL
 *   - notifyShopOfOutcome — "Proof approved/declined by <customer>"
 *
 * Both return { ok: true } on delivery success or { ok: false, error } on
 * failure. Callers decide whether failure should block the parent flow; in
 * proof-send the client email is required (block) and in proof-sign the
 * shop notification is best-effort (non-blocking).
 */

import { isApproveProLive } from "./approvepro-runtime.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function getApiKey(): string | null {
  const key = Deno.env.get("RESEND_API_KEY");
  return key && key.length > 0 ? key : null;
}

export type EmailResult =
  | { ok: true; id: string; subject?: string; html?: string }
  | { ok: false; reason: "disabled" | "missing_key" | "http_error" | "network_error"; error?: string; subject?: string; html?: string };

async function sendResend(
  from: string,
  to: string,
  subject: string,
  html: string,
  cc?: string[],
): Promise<EmailResult> {
  if (!isApproveProLive()) {
    console.warn("proof-email: ApprovePro is disabled; outbound proof email suppressed");
    return { ok: false, reason: "disabled", error: "APPROVEPRO_LIVE is not true" };
  }
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("proof-email: RESEND_API_KEY not set — skipping send");
    return { ok: false, reason: "missing_key" };
  }

  const ccList = (cc || [])
    .map((e) => (typeof e === "string" ? e.trim() : ""))
    .filter((e) => e.length > 0 && e.toLowerCase() !== to.toLowerCase());

  const payload: Record<string, unknown> = { from, to, subject, html };
  if (ccList.length > 0) payload.cc = ccList;

  let resp: Response;
  try {
    resp = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err: any) {
    console.error("proof-email: network error:", err?.message || err);
    return { ok: false, reason: "network_error", error: err?.message };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error(`proof-email: HTTP ${resp.status}`, text.slice(0, 400));
    return { ok: false, reason: "http_error", error: text.slice(0, 400) };
  }

  const json = await resp.json().catch(() => ({}));
  return { ok: true, id: json?.id || "" };
}

// ────────────────────────────────────────────────────────────────────────────
// Client: "Please review your design"
// ────────────────────────────────────────────────────────────────────────────

interface ClientProofEmailParams {
  customerEmail: string;
  customerName?: string | null;
  shopName: string;
  designName: string;
  vehicleSummary: string; // e.g. "2024 Ford F-150"
  heroImageUrl?: string | null;
  viewUrl: string;
  customMessage?: string | null;
  expiresAtIso: string;
  mode: "sign_only" | "revision_loop";
}

export async function sendProofToClient(
  params: ClientProofEmailParams,
): Promise<EmailResult> {
  const expiresReadable = new Date(params.expiresAtIso).toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric", year: "numeric" },
  );
  const greeting = params.customerName
    ? `Hi ${esc(params.customerName)},`
    : "Hi,";
  const modeLine = params.mode === "revision_loop"
    ? "Review your design below. Love it? Approve it. Want a change? You can revise it yourself — just tap “Revise with AI,” type what you’d like (e.g. “remove the S” or “make the red darker”), and a new version renders in under a minute. No design skills needed."
    : "Review the design below and approve or decline.";

  const subject = `Your ${params.designName} design is ready for review`;
  // WPW orders send from the proven-deliverable Design@weprintwraps.com (the
  // sender that reaches external inboxes); RestylePro-direct keeps restyleproai.
  // Using the WPW domain also avoids same-domain quarantine to @restyleproai.com.
  const from = /weprint\s*wraps|wpw/i.test(params.shopName || "")
    ? `${params.shopName} <Design@weprintwraps.com>`
    : `${params.shopName} <noreply@restyleproai.com>`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f5f5f7;margin:0;padding:24px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <tr><td style="height:6px;background:linear-gradient(90deg,#3b82f6,#ec4899);font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:20px 28px 0;text-align:center;">
      <span style="font-size:20px;font-weight:800;color:#111;letter-spacing:-0.5px;">${esc(params.shopName)}</span>
      <div style="margin-top:3px;font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#9ca3af;">Powered by ApprovePro&trade;</div>
    </td></tr>
    <tr><td style="padding:18px 28px 0;">
      <p style="margin:0 0 8px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#888;">Your design proof</p>
      <h1 style="margin:0 0 6px;font-size:22px;line-height:1.25;color:#111;">${esc(params.designName)}</h1>
      ${params.vehicleSummary ? `<p style="margin:0 0 4px;color:#555;font-size:14px;">${esc(params.vehicleSummary)}</p>` : ""}
    </td></tr>

    ${params.heroImageUrl ? `
    <tr><td style="padding:16px 28px 0;">
      <img src="${esc(params.heroImageUrl)}" alt="" style="width:100%;max-width:560px;height:auto;border-radius:8px;display:block;" />
    </td></tr>
    ` : ""}

    <tr><td style="padding:22px 28px 0;">
      <p style="margin:0 0 6px;font-size:15px;color:#222;">${greeting}</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#222;">${esc(modeLine)}</p>
      ${params.customMessage ? `<div style="margin:0 0 14px;padding:12px 14px;background:#f5f7fa;border-left:3px solid #00C7FF;border-radius:4px;font-size:14px;color:#333;line-height:1.5;">${esc(params.customMessage)}</div>` : ""}
    </td></tr>

    <tr><td style="padding:4px 28px 8px;text-align:center;">
      <a href="${esc(params.viewUrl)}"
         style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 36px;border-radius:10px;mso-padding-alt:14px 36px;">
        Review Your Design
      </a>
    </td></tr>
${params.mode === "revision_loop" ? `
    <tr><td style="padding:14px 28px 4px;text-align:center;font-size:12px;color:#888;">
      Want a change? Do it yourself in seconds — or approve:
    </td></tr>
    <tr><td style="padding:4px 28px 6px;text-align:center;">
      <a href="${esc(params.viewUrl)}?action=revise"
         style="display:inline-block;background:linear-gradient(90deg,#7c3aed,#2563eb);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 26px;border-radius:9px;margin:0 4px 8px;">
        ✏️ Revise with AI
      </a>
      <a href="${esc(params.viewUrl)}?action=approve"
         style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 26px;border-radius:9px;margin:0 4px 8px;">
        ✓ Approve
      </a>
      <p style="margin:10px 0 0;font-size:12px;color:#666;line-height:1.5;">
        <strong>How to revise:</strong> tap <strong>Revise with AI</strong> above, type your change in plain words
        (and attach a photo/logo if you have one), then send. Your updated design appears right there — keep going until it’s perfect.
      </p>
      <p style="margin:8px 0 0;font-size:11px;color:#999;">Link expires ${esc(expiresReadable)}</p>
    </td></tr>
` : `
    <tr><td style="padding:8px 28px 4px;text-align:center;font-size:12px;color:#888;">
      Or one-click approve:
    </td></tr>
    <tr><td style="padding:4px 28px 24px;text-align:center;">
      <a href="${esc(params.viewUrl)}?action=approve"
         style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 22px;border-radius:8px;margin:0 4px;">
        ✓ Approve
      </a>
      <p style="margin:14px 0 0;font-size:11px;color:#888;">To request changes or decline, open the proof and tell us why &mdash; that detail goes straight to the design team.</p>
      <p style="margin:6px 0 0;font-size:11px;color:#888;">Link expires ${esc(expiresReadable)}</p>
    </td></tr>
`}

    <tr><td style="padding:20px 28px;border-top:1px solid #eee;font-size:11px;color:#999;line-height:1.5;">
      If the button doesn't work, paste this link into your browser:<br/>
      <span style="color:#2563eb;word-break:break-all;">${esc(params.viewUrl)}</span>
    </td></tr>
  </table>
</body>
</html>`;

  // Return the exact subject + html that went out so callers can persist it
  // for ApprovePro's "view exact email" replay.
  const result = await sendResend(from, params.customerEmail, subject, html);
  return { ...result, subject, html };
}

// ────────────────────────────────────────────────────────────────────────────
// Shop: "Customer approved / declined your proof"
// ────────────────────────────────────────────────────────────────────────────

interface ShopOutcomeEmailParams {
  shopEmail: string;
  shopName: string;
  customerName?: string | null;
  customerEmail: string;
  designName: string;
  vehicleSummary: string;
  outcome: "approved" | "declined";
  declineReason?: string | null;
  signedPdfUrl?: string | null; // signed URL to audit bucket
  signedAtIso: string;
  proofId: string;
  manageUrl?: string | null;
  // Shop-side workbench link (ApprovePro page, scoped to this proof). Lets
  // the design team jump straight to the upload + history view.
  workbenchUrl?: string | null;
  // Customer-facing proof page URL (same one the client clicks in their
  // email). Helpful for the design team to preview what the customer
  // actually saw before responding.
  viewUrl?: string | null;
  // Production order context (approved path). When the proof links to a
  // panelizer_jobs row, we surface the sq ft + order number so the human
  // designer can verify the size before pricing and paste the correct WPW
  // cart link into their quote.
  totalSqft?: number | null;
  panelCount?: number | null;
  orderNumber?: string | null;
  // Extra recipients to Cc (e.g. design team). Auth user stays as primary To.
  ccEmails?: string[];
}

export async function notifyShopOfOutcome(
  params: ShopOutcomeEmailParams,
): Promise<EmailResult> {
  const outcomeLabel = params.outcome === "approved" ? "APPROVED" : "DECLINED";
  const outcomeColor = params.outcome === "approved" ? "#16a34a" : "#dc2626";
  const subject = `${outcomeLabel}: ${params.designName} — ${params.customerName || params.customerEmail}`;
  const from = `RestylePro Proofs <noreply@restyleproai.com>`;
  const signedReadable = new Date(params.signedAtIso).toLocaleString(
    "en-US",
    { timeZone: "UTC", hour12: false },
  );

  const sqftLine = (params.totalSqft != null && params.totalSqft > 0)
    ? `<strong>${params.totalSqft.toFixed(1)} sq ft</strong>${params.panelCount ? ` &middot; ${params.panelCount} panels` : ""}`
    : "";
  const orderLine = params.orderNumber
    ? `<strong>Order ${esc(params.orderNumber)}</strong>`
    : "";
  const productionFacts = [orderLine, sqftLine].filter(Boolean).join(" &middot; ");
  // The auth user who sent the proof = the initial designer assigned to this
  // job. Surfacing them in the card lets the rest of the team know who owns
  // the next step when the entire shop is Cc'd.
  const designerLine = params.shopName
    ? `Initial designer: <strong>${esc(params.shopName)}</strong>`
    : "";

  const nextStepsBlock = params.outcome === "declined"
    ? `
        <div style="margin:18px 0 6px;padding:14px 16px;background:#f5f7fa;border-left:3px solid #2563eb;border-radius:4px;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#111;letter-spacing:.5px;text-transform:uppercase;">Send a revision</p>
          <ol style="margin:0;padding-left:18px;font-size:14px;color:#333;line-height:1.55;">
            <li>Open the job in ApprovePro (button below).</li>
            <li>Scroll down to the <em>Upload</em> section.</li>
            <li>Drag in the revised file &mdash; status flips back to <strong>Sent</strong> and the customer gets the new version automatically.</li>
          </ol>
        </div>`
    : `
        <div style="margin:18px 0 6px;padding:14px 16px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:4px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#111;letter-spacing:.5px;text-transform:uppercase;">Your next step</p>
          ${designerLine ? `<p style="margin:0 0 6px;font-size:13px;color:#374151;">${designerLine}</p>` : ""}
          ${productionFacts ? `<p style="margin:0 0 8px;font-size:14px;color:#111;line-height:1.55;">${productionFacts}</p>` : ""}
          <ol style="margin:0;padding-left:18px;font-size:14px;color:#333;line-height:1.55;">
            <li>Verify the sq ft on the signed PDF (button below).</li>
            <li>Calculate the printed wrap cost.</li>
            <li>Send ${esc(params.customerName || "the customer")} a quote with the correct WPW cart link.</li>
          </ol>
        </div>`;

  const actionButtons = (params.workbenchUrl || params.viewUrl) ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:12px 0 4px;">
          <tr>
            ${params.workbenchUrl ? `
            <td align="center" style="padding:4px;">
              <a href="${esc(params.workbenchUrl)}" style="display:inline-block;background:${outcomeColor};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">
                Open in ApprovePro
              </a>
            </td>` : ""}
            ${params.viewUrl ? `
            <td align="center" style="padding:4px;">
              <a href="${esc(params.viewUrl)}" style="display:inline-block;background:#fff;color:#333;border:1px solid #d1d5db;text-decoration:none;font-weight:600;font-size:14px;padding:10px 22px;border-radius:8px;">
                See what the customer sees
              </a>
            </td>` : ""}
          </tr>
        </table>` : "";

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f5f5f7;margin:0;padding:24px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:28px;">
      <div style="display:inline-block;padding:4px 10px;background:${outcomeColor};color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;border-radius:4px;">${outcomeLabel}</div>
      <h1 style="margin:12px 0 6px;font-size:22px;color:#111;">${esc(params.designName)}</h1>
      ${params.vehicleSummary ? `<p style="margin:0 0 6px;color:#555;font-size:14px;">${esc(params.vehicleSummary)}</p>` : ""}
      <p style="margin:0 0 8px;color:#333;font-size:15px;">
        <strong>${esc(params.customerName || params.customerEmail)}</strong>
        &lt;${esc(params.customerEmail)}&gt;
        ${params.outcome === "approved" ? "signed" : "declined"} at ${esc(signedReadable)} UTC.
      </p>
      ${params.declineReason ? `
        <div style="margin:14px 0;padding:14px 16px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:4px;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#991b1b;letter-spacing:.5px;text-transform:uppercase;">What the customer said</p>
          <p style="margin:0;font-size:14px;color:#222;line-height:1.55;white-space:pre-wrap;">${esc(params.declineReason)}</p>
        </div>` : ""}
      ${params.signedPdfUrl ? `
        <p style="margin:16px 0;">
          <a href="${esc(params.signedPdfUrl)}" style="color:#2563eb;font-weight:600;text-decoration:none;">
            Download signed PDF &rarr;
          </a>
        </p>` : params.outcome === "approved" ? `
        <p style="margin:16px 0;color:#888;font-size:12px;">
          PDF generation was skipped (DocRaptor key not configured). The approval is still legally recorded in the audit log.
        </p>` : ""}
      ${nextStepsBlock}
      ${actionButtons}
      <p style="margin:18px 0 0;font-size:11px;color:#999;">Proof ID: ${esc(params.proofId)}</p>
    </td></tr>
  </table>
</body>
</html>`;

  const result = await sendResend(from, params.shopEmail, subject, html, params.ccEmails);
  // Return the exact subject + html that went out so callers can persist it
  // for ApprovePro's "Emails sent" ledger + "view exact email" replay.
  return { ...result, subject, html };
}

function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ────────────────────────────────────────────────────────────────────────────
// Customer: "Your design is approved — order your printed wrap" (cart-on-approve)
//
// The moment the customer signs, we email them the WePrintWraps cart link so
// they can buy the printed wrap immediately instead of waiting 1–2 days for a
// designer to hand-calculate sq ft and send a quote. The sq ft is the real
// panelizer total when available, otherwise a vehicle-based estimate; either
// way the WPW cart confirms final pricing at checkout. Branded ApprovePro ×
// WePrintWraps so it reads as one continuous journey.
// ────────────────────────────────────────────────────────────────────────────

interface CustomerReadyToOrderParams {
  customerEmail: string;
  customerName?: string | null;
  shopName: string;
  designName: string;
  vehicleSummary: string;
  heroImageUrl?: string | null;
  cartUrl: string;
  sqft: number;
  estimatedPrice: number;
  sqftIsEstimate: boolean;
  // Customer portal link, so they can message the team with questions.
  viewUrl?: string | null;
}

export async function notifyCustomerReadyToOrder(
  params: CustomerReadyToOrderParams,
): Promise<EmailResult> {
  const greeting = params.customerName ? `Hi ${esc(params.customerName)},` : "Hi,";
  const subject = `🎉 Your ${params.designName} is approved — order your printed wrap`;
  const from = `${params.shopName} <Design@weprintwraps.com>`;
  const sqftLabel = params.sqftIsEstimate
    ? `~${Math.round(params.sqft)} sq ft (estimated — confirmed at checkout)`
    : `${params.sqft.toFixed(1)} sq ft`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f5f5f7;margin:0;padding:24px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <tr><td bgcolor="#3b82f6" style="height:6px;background:#3b82f6;background:linear-gradient(90deg,#3b82f6,#ec4899);font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:20px 28px 0;text-align:center;">
      <span style="font-size:20px;font-weight:800;color:#111;letter-spacing:-0.5px;">${esc(params.shopName)}</span>
      <div style="margin-top:3px;font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#9ca3af;">ApprovePro&trade; &middot; Vehicle Wrap Design &amp; Approval System</div>
    </td></tr>
    <tr><td style="padding:18px 28px 0;">
      <div style="display:inline-block;padding:4px 10px;background:#16a34a;color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;border-radius:4px;">APPROVED</div>
      <h1 style="margin:10px 0 6px;font-size:22px;line-height:1.25;color:#111;">${esc(params.designName)}</h1>
      ${params.vehicleSummary ? `<p style="margin:0 0 4px;color:#555;font-size:14px;">${esc(params.vehicleSummary)}</p>` : ""}
    </td></tr>
    ${params.heroImageUrl ? `
    <tr><td style="padding:16px 28px 0;">
      <img src="${esc(params.heroImageUrl)}" alt="" style="width:100%;max-width:560px;height:auto;border-radius:8px;display:block;" />
    </td></tr>` : ""}
    <tr><td style="padding:22px 28px 0;">
      <p style="margin:0 0 10px;font-size:15px;color:#222;">${greeting}</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#222;">
        Your wrap design is approved and ready to print! You can <strong>order your printed wrap right now</strong> — no waiting on a quote.
      </p>
      <div style="margin:0 0 6px;padding:14px 16px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:4px;">
        <p style="margin:0;font-size:14px;color:#111;line-height:1.6;">
          <strong>Printed wrap</strong><br/>
          Coverage: ${esc(sqftLabel)}<br/>
          Estimated total: <strong>$${Math.round(params.estimatedPrice).toLocaleString()}</strong>
        </p>
      </div>
    </td></tr>
    <tr><td style="padding:18px 28px 6px;text-align:center;">
      <a href="${esc(params.cartUrl)}"
         style="display:inline-block;background-color:#2563eb;background:linear-gradient(90deg,#3b82f6,#ec4899);color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 38px;border-radius:10px;mso-padding-alt:14px 38px;">
        Order my printed wrap &rarr;
      </a>
    </td></tr>
    ${params.viewUrl ? `
    <tr><td style="padding:6px 28px 24px;text-align:center;font-size:12px;color:#888;">
      Questions before you buy? <a href="${esc(params.viewUrl)}" style="color:#2563eb;text-decoration:none;font-weight:600;">Message our team in your portal &rarr;</a>
    </td></tr>` : `<tr><td style="height:18px;"></td></tr>`}
  </table>
</body>
</html>`;

  const result = await sendResend(from, params.customerEmail, subject, html);
  return { ...result, subject, html };
}

// ────────────────────────────────────────────────────────────────────────────
// Shop: "Client requested a revision" (Phase 3)
// ────────────────────────────────────────────────────────────────────────────

interface ShopRevisionRequestedEmailParams {
  shopEmail: string;
  shopName: string;
  customerName?: string | null;
  customerEmail: string;
  designName: string;
  vehicleSummary: string;
  revisionNotes: string;
  referenceImageUrls: string[]; // signed URLs, valid at least 14 days
  manageUrl: string;
  // Shop-side workbench link (ApprovePro page scoped to this proof). Lets
  // the design team jump straight to the upload + history view.
  workbenchUrl?: string | null;
  // Customer-facing proof page URL (same one the client clicks in their
  // email). Helpful for the design team to preview exactly what the
  // customer saw before responding.
  viewUrl?: string | null;
  proofId: string;
  versionNumber: number;
  // Extra recipients to Cc (e.g. design team). Auth user stays as primary To.
  ccEmails?: string[];
}

export async function notifyShopRevisionRequested(
  params: ShopRevisionRequestedEmailParams,
): Promise<EmailResult> {
  const subject = `Revision requested: ${params.designName} — ${params.customerName || params.customerEmail}`;
  const from = `RestylePro Proofs <noreply@restyleproai.com>`;
  const refsBlock = params.referenceImageUrls.length > 0
    ? `<div style="margin:14px 0;">
         <p style="margin:0 0 6px;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:1px;">Reference images from client</p>
         <div style="display:flex;flex-wrap:wrap;gap:6px;">
           ${params.referenceImageUrls.slice(0, 4).map((u) =>
             `<img src="${esc(u)}" alt="" style="max-width:46%;max-height:140px;border:1px solid #e5e5e5;border-radius:4px;" />`
           ).join("")}
         </div>
       </div>`
    : "";

  // Prefer workbenchUrl as the primary CTA (drops the team right into the
  // upload section). Fall back to manageUrl if workbenchUrl wasn't passed.
  const primaryCtaUrl = params.workbenchUrl || params.manageUrl;
  const secondaryButton = params.viewUrl ? `
            <td align="center" style="padding:4px;">
              <a href="${esc(params.viewUrl)}" style="display:inline-block;background:#fff;color:#333;border:1px solid #d1d5db;text-decoration:none;font-weight:600;font-size:14px;padding:10px 22px;border-radius:8px;">
                See what the customer sees
              </a>
            </td>` : "";

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f5f5f7;margin:0;padding:24px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:28px;">
      <div style="display:inline-block;padding:4px 10px;background:#a855f7;color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;border-radius:4px;">REVISION REQUESTED &middot; v${params.versionNumber}</div>
      <h1 style="margin:12px 0 6px;font-size:22px;color:#111;">${esc(params.designName)}</h1>
      ${params.vehicleSummary ? `<p style="margin:0 0 6px;color:#555;font-size:14px;">${esc(params.vehicleSummary)}</p>` : ""}
      <p style="margin:0 0 4px;color:#333;font-size:14px;">
        <strong>${esc(params.customerName || params.customerEmail)}</strong>
        &lt;${esc(params.customerEmail)}&gt; requested changes on version ${params.versionNumber}.
      </p>
      <div style="margin:14px 0;padding:14px;background:#faf5ff;border-left:3px solid #a855f7;border-radius:4px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#7c3aed;letter-spacing:.5px;text-transform:uppercase;">What the customer wants changed</p>
        <p style="margin:0;font-size:14px;color:#222;line-height:1.55;white-space:pre-wrap;">${esc(params.revisionNotes)}</p>
      </div>
      ${refsBlock}
      <div style="margin:18px 0 6px;padding:14px 16px;background:#f5f7fa;border-left:3px solid #2563eb;border-radius:4px;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#111;letter-spacing:.5px;text-transform:uppercase;">Send the revision</p>
        <ol style="margin:0;padding-left:18px;font-size:14px;color:#333;line-height:1.55;">
          <li>Open the job in ApprovePro (button below).</li>
          <li>Scroll down to the <em>Upload</em> section.</li>
          <li>Drag in the revised file &mdash; the customer auto-gets the &ldquo;Updated: ${esc(params.designName)} (v${params.versionNumber + 1})&rdquo; email at the same link, no re-send needed.</li>
        </ol>
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:12px 0 4px;">
        <tr>
          <td align="center" style="padding:4px;">
            <a href="${esc(primaryCtaUrl)}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#ec4899);color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:10px;">
              Open in ApprovePro
            </a>
          </td>
          ${secondaryButton}
        </tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#999;">Proof ID: ${esc(params.proofId)}</p>
    </td></tr>
  </table>
</body>
</html>`;

  const result = await sendResend(from, params.shopEmail, subject, html, params.ccEmails);
  // Return the exact subject + html for ApprovePro's "Emails sent" ledger.
  return { ...result, subject, html };
}

// ────────────────────────────────────────────────────────────────────────────
// Client: "We've updated the design — take another look" (Phase 3)
// ────────────────────────────────────────────────────────────────────────────

interface ClientNewVersionEmailParams {
  customerEmail: string;
  customerName?: string | null;
  shopName: string;
  designName: string;
  vehicleSummary: string;
  heroImageUrl?: string | null;
  viewUrl: string;
  shopMessage?: string | null;
  versionNumber: number;
  expiresAtIso: string;
}

export async function notifyClientNewVersion(
  params: ClientNewVersionEmailParams,
): Promise<EmailResult> {
  const expiresReadable = new Date(params.expiresAtIso).toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric", year: "numeric" },
  );
  const greeting = params.customerName
    ? `Hi ${esc(params.customerName)},`
    : "Hi,";

  const subject = `Updated: ${params.designName} (v${params.versionNumber})`;
  const from = `${params.shopName} <noreply@restyleproai.com>`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f5f5f7;margin:0;padding:24px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <tr><td style="height:6px;background:linear-gradient(90deg,#3b82f6,#ec4899);font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:20px 28px 0;text-align:center;">
      <span style="font-size:20px;font-weight:800;color:#111;letter-spacing:-0.5px;">${esc(params.shopName)}</span>
      <div style="margin-top:3px;font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#9ca3af;">Powered by ApprovePro&trade;</div>
    </td></tr>
    <tr><td style="padding:18px 28px 0;">
      <div style="display:inline-block;padding:4px 10px;background:linear-gradient(135deg,#3b82f6,#ec4899);color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;border-radius:4px;">VERSION ${params.versionNumber}</div>
      <h1 style="margin:10px 0 6px;font-size:22px;line-height:1.25;color:#111;">${esc(params.designName)}</h1>
      ${params.vehicleSummary ? `<p style="margin:0 0 4px;color:#555;font-size:14px;">${esc(params.vehicleSummary)}</p>` : ""}
    </td></tr>

    ${params.heroImageUrl ? `
    <tr><td style="padding:16px 28px 0;">
      <img src="${esc(params.heroImageUrl)}" alt="" style="width:100%;max-width:560px;height:auto;border-radius:8px;display:block;" />
    </td></tr>
    ` : ""}

    <tr><td style="padding:22px 28px 0;">
      <p style="margin:0 0 10px;font-size:15px;color:#222;">${greeting}</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#222;">We've updated your design based on your feedback. Take another look and approve, request another revision, or decline.</p>
      ${params.shopMessage ? `<div style="margin:0 0 14px;padding:12px 14px;background:#f5f7fa;border-left:3px solid #00C7FF;border-radius:4px;font-size:14px;color:#333;line-height:1.5;">${esc(params.shopMessage)}</div>` : ""}
    </td></tr>

    <tr><td style="padding:4px 28px 24px;text-align:center;">
      <a href="${esc(params.viewUrl)}"
         style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 36px;border-radius:10px;mso-padding-alt:14px 36px;">
        Review the Update
      </a>
      <p style="margin:16px 0 0;font-size:12px;color:#888;">Link expires ${esc(expiresReadable)}</p>
    </td></tr>
  </table>
</body>
</html>`;

  // Return the exact subject + html that went out so callers can persist it
  // for ApprovePro's "view exact email" replay.
  const result = await sendResend(from, params.customerEmail, subject, html);
  return { ...result, subject, html };
}

// ────────────────────────────────────────────────────────────────────────────
// Email ledger — records EVERY outbound proof email as an `email_sent`
// proof_event so ApprovePro's "Emails sent" panel shows the complete trail
// automatically (initial send, resends, shop notifications on approve/
// decline/revision, and the customer's new-version email). Without this,
// only proof-send logged its email and the shop/customer notifications went
// out silently — the #1 "I can't see what the customer was sent" gap.
//
// Always non-blocking: a logging failure must NEVER break the customer's
// approve/decline/revision action, so every insert is wrapped in try/catch.
// ────────────────────────────────────────────────────────────────────────────

export type ProofEmailKind =
  | "initial_send"
  | "resend"
  | "new_version"
  | "outcome_approved"
  | "outcome_declined"
  | "revision_requested"
  | "ready_to_order";

export async function recordProofEmail(
  db: any,
  params: {
    proofId: string;
    direction: "to_customer" | "to_shop";
    kind: ProofEmailKind;
    to: string;
    result: EmailResult;
    actorRole?: string;
    actorUserId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  try {
    const r = params.result;
    await db.from("proof_events").insert({
      proof_id: params.proofId,
      event_type: "email_sent",
      actor_role: params.actorRole || "system",
      actor_user_id: params.actorUserId ?? null,
      ip: params.ip ?? null,
      user_agent: params.userAgent ?? null,
      payload: {
        direction: params.direction,
        kind: params.kind,
        to: params.to,
        subject: r.subject ?? null,
        // Exact HTML the recipient received (when the send succeeded), for the
        // "view exact email" replay in the workbench.
        html: r.ok ? (r.html ?? null) : null,
        delivered: r.ok,
        resend_id: r.ok ? r.id : null,
        error: r.ok ? null : (r.error ?? r.reason ?? null),
      },
    });
  } catch (e) {
    console.warn("recordProofEmail: non-fatal log failure:", (e as any)?.message || e);
  }
}
