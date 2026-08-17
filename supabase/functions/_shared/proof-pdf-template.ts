/**
 * proof-pdf-template.ts
 *
 * Generates the HTML used for the tamper-evident signed proof PDF. The PDF
 * is the legal artifact — every detail that matters for ESIGN/UETA is in it:
 *
 *   - Design name + vehicle summary + finish
 *   - Hero render (active version) inlined as <img src>
 *   - Shop name + logo (white-label if set)
 *   - Customer typed name + drawn signature (inline PNG)
 *   - UTC timestamp of signing
 *   - Signer IP address
 *   - ESIGN/UETA disclosure
 *   - Proof UUID + signature SHA-256 (printed as a verification footer)
 *
 * Rendered by DocRaptor (Prince XML engine) — keep HTML simple, no JS.
 */

export interface ProofPdfLineItem {
  line_number: number;
  title: string;
  description?: string | null;
  render_url?: string | null;
  status: "pending" | "approved" | "declined" | "revising";
  decline_reason?: string | null;
  change_request?: string | null;
  approved_at?: string | null;
  declined_at?: string | null;
  revision_requested_at?: string | null;
}

export interface ProofPdfContext {
  proofId: string;
  designName: string;
  vehicle: {
    year?: string | null;
    make?: string | null;
    model?: string | null;
    type?: string | null;
  };
  finishType?: string | null;

  heroImageUrl: string | null;
  additionalViewUrls?: string[]; // up to 4 more views on a second page

  // Phase 8C — when set, the PDF bakes per-line outcomes after the hero.
  lineItems?: ProofPdfLineItem[];

  shop: {
    name: string;
    email: string;
    logoUrl?: string | null;
  };

  customer: {
    typedName: string;
    email: string;
    name?: string | null;
  };

  signatureDataUrl: string; // data:image/png;base64,...
  signedAtIso: string; // UTC
  signerIp: string | null;

  proofSha256Hint: string; // first 16 hex chars of the PDF SHA-256 after generation
  // ^ note: this is a chicken-and-egg situation. We stamp with the pre-sign
  //   body SHA; the bucket filename uses the full post-generation SHA. See
  //   proof-sign for the flow.
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

function formatVehicle(
  v: ProofPdfContext["vehicle"],
): string {
  const parts = [v.year, v.make, v.model].filter(Boolean);
  return parts.join(" ");
}

function statusBadgeHtml(
  status: ProofPdfLineItem["status"],
): string {
  const map: Record<ProofPdfLineItem["status"], { label: string; color: string }> = {
    approved: { label: "APPROVED", color: "#16a34a" },
    declined: { label: "DECLINED", color: "#dc2626" },
    revising: { label: "REVISION REQUESTED", color: "#a855f7" },
    pending: { label: "PENDING", color: "#6b7280" },
  };
  const cfg = map[status] || map.pending;
  return `<span style="display:inline-block;padding:2px 8px;background:${cfg.color};color:#fff;font-size:8.5pt;font-weight:700;letter-spacing:0.5px;border-radius:3px;">${cfg.label}</span>`;
}

function renderLineItemsHtml(items: ProofPdfLineItem[]): string {
  if (!items || items.length === 0) return "";
  const rows = items
    .slice()
    .sort((a, b) => a.line_number - b.line_number)
    .map((li) => {
      const note = li.status === "declined"
        ? li.decline_reason
        : li.status === "revising"
        ? li.change_request
        : null;
      return `
        <div class="line-item">
          <div class="line-item-header">
            <div class="line-item-title">
              <span class="line-item-number">#${li.line_number}</span>
              ${esc(li.title)}
            </div>
            ${statusBadgeHtml(li.status)}
          </div>
          ${li.description ? `<div class="line-item-desc">${esc(li.description)}</div>` : ""}
          ${
            li.render_url
              ? `<div class="line-item-image"><img src="${esc(li.render_url)}" alt="${esc(li.title)}" /></div>`
              : ""
          }
          ${
            note
              ? `<div class="line-item-note"><strong>${li.status === "declined" ? "Reason:" : "Customer note:"}</strong> ${esc(note)}</div>`
              : ""
          }
        </div>`;
    })
    .join("\n");

  return `
    <h2>Line Items (${items.length})</h2>
    <div class="line-items">
      ${rows}
    </div>`;
}

export function renderProofPdfHtml(ctx: ProofPdfContext): string {
  const vehicleLine = formatVehicle(ctx.vehicle);
  const finishLine = ctx.finishType
    ? `<strong>Finish:</strong> ${esc(ctx.finishType)}`
    : "";
  const signedLocal = new Date(ctx.signedAtIso).toUTCString();
  const additional = (ctx.additionalViewUrls || []).slice(0, 4);
  const lineItems = ctx.lineItems || [];
  const hasLineItems = lineItems.length > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Signed Proof — ${esc(ctx.designName)}</title>
<style>
  @page { size: Letter; margin: 0.75in; }
  body {
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: #111;
    font-size: 11pt;
    line-height: 1.4;
    margin: 0;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #111;
    padding-bottom: 12px;
    margin-bottom: 18px;
  }
  .header .brand { font-size: 16pt; font-weight: bold; }
  .header .subtitle { font-size: 9pt; color: #555; letter-spacing: 1px; text-transform: uppercase; }
  .header .logo { max-height: 50px; max-width: 140px; }
  h1 { font-size: 18pt; margin: 0 0 4px; }
  h2 { font-size: 13pt; margin: 18px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
  .meta { margin-bottom: 14px; }
  .meta div { margin-bottom: 3px; }
  .hero { text-align: center; margin: 12px 0 18px; }
  .hero img { max-width: 100%; max-height: 4.5in; border: 1px solid #ddd; }
  .additional {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
  }
  .additional img {
    width: 48%;
    max-height: 2.5in;
    border: 1px solid #ddd;
    object-fit: contain;
  }
  .signature-block {
    border: 1px solid #111;
    padding: 14px;
    margin: 18px 0;
    background: #fafafa;
  }
  .signature-block .drawn {
    border-bottom: 1px solid #555;
    padding-bottom: 6px;
    margin-bottom: 10px;
    min-height: 80px;
    text-align: center;
  }
  .signature-block img {
    max-height: 80px;
    max-width: 100%;
  }
  .signer-meta { font-size: 10pt; }
  .signer-meta td { padding: 3px 8px 3px 0; vertical-align: top; }
  .signer-meta td:first-child { font-weight: bold; width: 130px; }
  .disclosure {
    font-size: 8.5pt;
    color: #444;
    margin-top: 24px;
    padding-top: 10px;
    border-top: 1px dashed #ccc;
    line-height: 1.35;
  }
  .verification-footer {
    margin-top: 18px;
    font-family: "Courier New", monospace;
    font-size: 8pt;
    color: #666;
    border-top: 1px solid #eee;
    padding-top: 6px;
  }
  .line-items { margin-top: 4px; }
  .line-item {
    border: 1px solid #d4d4d8;
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 8px;
    background: #fafafa;
    page-break-inside: avoid;
  }
  .line-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .line-item-title {
    font-weight: 600;
    font-size: 11pt;
  }
  .line-item-number {
    display: inline-block;
    margin-right: 6px;
    padding: 1px 6px;
    background: #e4e4e7;
    border-radius: 3px;
    font-size: 9pt;
    color: #444;
  }
  .line-item-desc {
    font-size: 10pt;
    color: #555;
    margin: 4px 0 6px;
  }
  .line-item-image {
    margin: 6px 0;
    text-align: center;
  }
  .line-item-image img {
    max-width: 100%;
    max-height: 2.4in;
    border: 1px solid #e4e4e7;
    border-radius: 4px;
  }
  .line-item-note {
    margin-top: 6px;
    padding: 6px 8px;
    background: #fff;
    border-left: 3px solid #a1a1aa;
    font-size: 10pt;
    color: #333;
    line-height: 1.4;
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${esc(ctx.shop.name)}</div>
      <div class="subtitle">Vehicle Wrap Design Proof — Signed</div>
    </div>
    ${
    ctx.shop.logoUrl
      ? `<img class="logo" src="${esc(ctx.shop.logoUrl)}" alt="" />`
      : ""
  }
  </div>

  <h1>${esc(ctx.designName)}</h1>
  <div class="meta">
    ${vehicleLine ? `<div><strong>Vehicle:</strong> ${esc(vehicleLine)}</div>` : ""}
    ${finishLine ? `<div>${finishLine}</div>` : ""}
    <div><strong>Customer:</strong> ${esc(ctx.customer.name || ctx.customer.typedName)} &lt;${esc(ctx.customer.email)}&gt;</div>
  </div>

  ${
    ctx.heroImageUrl && !hasLineItems
      ? `<div class="hero"><img src="${esc(ctx.heroImageUrl)}" alt="Approved design" /></div>`
      : ""
  }

  ${hasLineItems ? renderLineItemsHtml(lineItems) : ""}

  ${
    additional.length > 0 && !hasLineItems
      ? `<h2>Additional Views</h2>
         <div class="additional">
           ${additional.map((u) => `<img src="${esc(u)}" alt="" />`).join("\n")}
         </div>`
      : ""
  }

  <div class="signature-block">
    <h2 style="margin-top:0; border:none; padding:0;">Electronic Signature</h2>
    <div class="drawn">
      <img src="${esc(ctx.signatureDataUrl)}" alt="Signature" />
    </div>
    <table class="signer-meta">
      <tr><td>Signer (typed):</td><td>${esc(ctx.customer.typedName)}</td></tr>
      <tr><td>Email:</td><td>${esc(ctx.customer.email)}</td></tr>
      <tr><td>Signed at (UTC):</td><td>${esc(signedLocal)}</td></tr>
      <tr><td>IP address:</td><td>${esc(ctx.signerIp || "Not captured")}</td></tr>
      <tr><td>Proof ID:</td><td>${esc(ctx.proofId)}</td></tr>
    </table>
  </div>

  <div class="disclosure">
    <strong>ESIGN / UETA Disclosure.</strong> By typing their printed name
    and drawing their signature above, the signer affirms they intend to
    electronically sign this document and that this electronic signature
    has the same legal force and effect as a handwritten signature. Under
    the U.S. Electronic Signatures in Global and National Commerce Act
    (ESIGN, 15 U.S.C. § 7001 et seq.) and the Uniform Electronic
    Transactions Act (UETA) as adopted by the signer's state, this record
    cannot be denied legal effect solely because it is in electronic form.
    The signer may request a paper copy from the shop at any time; consent
    to electronic signing may be withdrawn by notifying the shop before the
    next action in the transaction.
  </div>

  <div class="verification-footer">
    Document ID: ${esc(ctx.proofId)} · Content hint: ${esc(ctx.proofSha256Hint)}
    · Generated: ${esc(signedLocal)}
  </div>
</body>
</html>`;
}
