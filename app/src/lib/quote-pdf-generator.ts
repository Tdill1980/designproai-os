import jsPDF from 'jspdf';
import { PLATFORM_LABEL } from '@/lib/tool-registry';
import { supabase } from '@/integrations/supabase/client';

// Header brand mark — the official two-tone DesignProAI logo (sprocket
// character + wordmark). Same asset that's been rendering fine in the
// PDF footer since day one, so we know it's CORS-accessible from the
// browser. Falls back to a text-only credit if the image can't load.
const PLATFORM_LOGO_URL =
  'https://designproai.com/sprocket/restyleproai-logo.png';

// Footer credit reuses the same brand mark, sized smaller.
const PLATFORM_FOOTER_LOGO_URL = PLATFORM_LOGO_URL;

const PLATFORM_GALLERY_URL = 'https://designproai.com/gallery';
const PLATFORM_PRICING_URL = 'https://designproai.com/pricing';
const PLATFORM_ORDER_URL = 'https://weprintwraps.com';

interface PricingTierCard {
  tier_slug: string;
  label: string;
  price: string;
  cta_url: string;
  image_url: string | null;
  sort_order: number;
}

/**
 * Pull the 4 admin-uploaded pricing-tier cards rendered at the bottom
 * of every Quote PDF. Public read on `pricing_tier_pdf_cards` so this
 * works without auth. Best-effort — any failure yields an empty array
 * and the bottom panel is hidden.
 */
async function fetchPricingTierCards(): Promise<PricingTierCard[]> {
  try {
    const { data, error } = await (supabase.from('pricing_tier_pdf_cards') as any)
      .select('tier_slug, label, price, cta_url, image_url, sort_order')
      .order('sort_order', { ascending: true })
      .limit(4);
    if (error || !data) return [];
    return data as PricingTierCard[];
  } catch {
    return [];
  }
}


export interface QuotePDFData {
  quoteNumber: string;
  createdAt: string;
  shopName: string;
  shopLogoUrl?: string | null;
  /**
   * Shop's public website (e.g. "weprintwraps.com"). Rendered in the
   * top-corner co-brand strip as "DesignProAI × weprintwraps.com" with
   * the domain as a clickable hyperlink. Pass without protocol — the
   * generator adds https:// at link time.
   */
  shopWebsite?: string | null;
  /**
   * One-click "Pay / Add to Cart" link the customer can tap from the
   * PDF. For WPW shops this is the Woo `?add-to-cart=…` URL with every
   * line item pre-loaded; other shops can pass any checkout URL.
   * Renders a green "Pay Now → Add to Cart" CTA under the totals row.
   */
  payUrl?: string | null;
  customer?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
  };
  vehicle: {
    year?: string | null;
    make?: string | null;
    model?: string | null;
  };
  manufacturer?: string | null;
  colorName?: string | null;
  finish?: string | null;
  category?: string | null;
  sqFt?: number | null;
  yardsNeeded?: number | null;
  shopCost?: number | null;
  customerTotal: number;
  marginPercent?: number | null;
  lineItems?: Array<{ label: string; detail?: string; amount: number }>;
  renderUrl?: string | null;
  status?: string | null;
}

// ── Colors ──────────────────────────────────────────────────────────────
const BLUE    = { r: 59, g: 130, b: 246 };  // #3b82f6
const DARK    = { r: 30, g: 41,  b: 59  };  // #1e293b
const MUTED   = { r: 100, g: 116, b: 139 }; // #64748b
const LINE    = { r: 203, g: 213, b: 225 }; // #cbd5e1
const LIGHT   = { r: 241, g: 245, b: 249 }; // #f1f5f9
const WHITE   = { r: 255, g: 255, b: 255 };

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Load an image URL as a data-URL with its natural dimensions.
 *
 * `maxPixelDim` (optional, default 1600) caps the largest dimension by
 * downscaling through a canvas before serializing. Without this the PDF
 * embeds the FULL native-res source — a 4K vehicle render is ~7 MB and
 * four tool-card images push a one-page quote PDF to 30 MB+, which
 * blows past Gmail/Outlook's ~25 MB attachment ceiling. 1600 px on the
 * long edge is still print-grade for a card that renders at ~150 px on
 * the page (≈10x oversample) and keeps a multi-image quote under 2 MB.
 *
 * JPEG output at quality 0.85 — visually identical to the source for
 * photographic renders, no banding. Skips the canvas roundtrip when the
 * source already fits under the cap so logos/SVGs aren't recompressed.
 */
function loadImageAsDataUrl(
  url: string,
  maxPixelDim: number = 1600,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      try {
        const longest = Math.max(img.naturalWidth, img.naturalHeight);
        if (longest <= maxPixelDim) {
          // Already small — pass the original bytes through unchanged.
          const res = await fetch(url);
          const blob = await res.blob();
          const reader = new FileReader();
          reader.onloadend = () =>
            resolve({
              dataUrl: reader.result as string,
              width: img.naturalWidth,
              height: img.naturalHeight,
            });
          reader.onerror = () => reject(new Error('FileReader failed'));
          reader.readAsDataURL(blob);
          return;
        }
        // Downscale through a canvas. Keep aspect ratio.
        const scale = maxPixelDim / longest;
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable'));
          return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ dataUrl, width: w, height: h });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = url;
  });
}

/** Format a number as USD currency. */
function usd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}

// WPW pre-designed-fade-wraps pricing (mirrors WpwFadeWrapConfigurator).
// Used so a single saved FadeWrap line is rendered on the PDF as one
// row per component (size + addons + roof) instead of a single $1,690
// row with the configurator summary jammed into the detail column.
const FADEWRAP_COMPONENT_PRICES: Array<{ match: RegExp; label: string; price: number }> = [
  { match: /^small sides$/i,  label: 'Small sides (144x59.5)',  price: 600 },
  { match: /^medium sides$/i, label: 'Medium sides (172x59.5)', price: 710 },
  { match: /^large sides$/i,  label: 'Large sides (200x59.5)',  price: 825 },
  { match: /^xl sides$/i,     label: 'XL sides (240x59.5)',     price: 990 },
  { match: /^hood$/i,         label: 'Hood (72x59.5)',          price: 160 },
  { match: /^front bumper$/i, label: 'Front Bumper (38x120.5)', price: 200 },
  { match: /^rear\+bumper$/i, label: 'Rear, including bumper',  price: 395 },
  { match: /^roof small$/i,   label: 'Roof - Small (72x59.5)',  price: 160 },
  { match: /^roof medium$/i,  label: 'Roof - Medium (110x59.5)', price: 225 },
  { match: /^roof large$/i,   label: 'Roof - Large (160x59.5)', price: 330 },
];

// Match the original `WPW FadeWrap` saves AND the post-fix
// `WPW Fade Wrap` (with space) saves so the PDF breakdown works on both.
// Without all four forms here, new quotes were skipping the expansion
// and rendering as a single opaque "WPW Fade Wrap" row.
const FADEWRAP_LABELS = new Set([
  'WPW FadeWrap',
  'WPW Fade Wrap',
  'RestyleLibrary FadeWrap',
  'RestyleLibrary Fade Wrap',
]);

function expandLineItem(
  item: { label: string; detail?: string; amount: number },
): Array<{ label: string; detail?: string; amount: number }> {
  if (!FADEWRAP_LABELS.has(item.label) || !item.detail) return [item];

  const segments = item.detail
    .split('·')
    .map((s) => s.trim())
    .filter((s) => s && !/^\d+\s*(each|sqft|yards?|hr)/i.test(s));

  const rows: Array<{ label: string; detail?: string; amount: number }> = [];
  let finishNote: string | undefined;
  let matched = 0;

  for (const seg of segments) {
    const hit = FADEWRAP_COMPONENT_PRICES.find((c) => c.match.test(seg));
    if (hit) {
      rows.push({ label: hit.label, amount: hit.price });
      matched += 1;
    } else if (/gloss|matte|satin/i.test(seg)) {
      finishNote = seg;
    }
  }

  if (matched === 0) return [item];

  if (finishNote && rows.length > 0) {
    rows[0] = { ...rows[0], detail: finishNote };
  }

  // Reconcile rounding gaps so the breakdown sums to the saved amount.
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  const diff = Math.round((item.amount - sum) * 100) / 100;
  if (Math.abs(diff) >= 0.01) {
    rows.push({ label: 'Adjustment', amount: diff });
  }

  // Prepend a section header so the customer can tell at a glance that
  // every row below is part of a Fade Wrap order, not a stack of
  // unrelated line items. Amount = 0 so it doesn't double-count.
  // The header label preserves the original "WPW Fade Wrap" wording
  // (or RestyleLibrary variant) for traceability.
  return [
    { label: item.label, detail: 'Fade Wrap — components below', amount: 0 },
    ...rows,
  ];
}

/** Draw a horizontal rule across the content area. */
function drawHR(pdf: jsPDF, y: number, marginL: number, marginR: number) {
  pdf.setDrawColor(LINE.r, LINE.g, LINE.b);
  pdf.setLineWidth(0.4);
  pdf.line(marginL, y, pdf.internal.pageSize.getWidth() - marginR, y);
}

// ── Main generator ──────────────────────────────────────────────────────

export async function generateQuotePDF(data: QuotePDFData): Promise<void> {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter', // 215.9 x 279.4 mm
  });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const mL = 16; // left margin
  const mR = 16; // right margin
  const contentW = pageW - mL - mR;
  let y = 18; // running vertical cursor

  // Pre-load the two platform marks: the rocket (header co-brand) and
  // the small sprocket (footer credit). Either can fail independently
  // — we fall through to text-only marks in that case.
  let rocketData: { dataUrl: string; width: number; height: number } | null = null;
  try {
    rocketData = await loadImageAsDataUrl(PLATFORM_LOGO_URL);
  } catch {
    rocketData = null;
  }
  let sprocketData: { dataUrl: string; width: number; height: number } | null = null;
  try {
    sprocketData = await loadImageAsDataUrl(PLATFORM_FOOTER_LOGO_URL);
  } catch {
    sprocketData = null;
  }

  // ─── PLATFORM CO-BRAND ─────────────────────────────────────────────
  // Two-tone DesignProAI logo (sprocket + wordmark) sits at the top
  // of every quote so the platform identity always travels with the
  // PDF. Just the logo — no "for <Shop>" text, since the shop name
  // already lives in the big header line below and customers were
  // seeing it printed twice.
  const coBrandH = 12;
  let coBrandX = mL;
  if (rocketData) {
    const rocketW = (rocketData.width / rocketData.height) * coBrandH;
    pdf.addImage(rocketData.dataUrl, 'PNG', coBrandX, y - 8, rocketW, coBrandH);
    coBrandX += rocketW + 3;
  } else {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
    pdf.text('DesignProAI', coBrandX, y);
    coBrandX += pdf.getTextWidth('DesignProAI') + 3;
  }

  // Co-brand: "× weprintwraps.com" — domain is rendered as a clickable
  // hyperlink so customers can tap straight into the shop's site from
  // the PDF (e.g. an emailed quote opened in Mail / Acrobat).
  if (data.shopWebsite) {
    const cleanDomain = data.shopWebsite
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/$/, '');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    pdf.text('×', coBrandX, y);
    coBrandX += pdf.getTextWidth('×') + 2;
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
    pdf.textWithLink(cleanDomain, coBrandX, y, {
      url: `https://${cleanDomain}`,
    });
  }
  y += 8;

  // ─── HEADER ─────────────────────────────────────────────────────────

  // Shop logo (if uploaded) — top-left, prominent. When the shop has no
  // logo of its own we intentionally skip the image and let the shop
  // name carry the brand in font.
  let logoEndX = mL;
  let logoBottomY = y;
  if (data.shopLogoUrl) {
    try {
      const logo = await loadImageAsDataUrl(data.shopLogoUrl);
      const maxH = 22;
      const maxW = 50;
      const scale = Math.min(maxW / logo.width, maxH / logo.height);
      const w = logo.width * scale;
      const h = logo.height * scale;
      pdf.addImage(logo.dataUrl, 'PNG', mL, y - 4, w, h);
      logoEndX = mL + w + 4;
      logoBottomY = y - 4 + h;
    } catch {
      // logo failed to load — fall through to the text-only header
    }
  }

  // Shop name next to logo (or alone, if no logo)
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.setTextColor(DARK.r, DARK.g, DARK.b);
  pdf.text(data.shopName, logoEndX, y + 4);

  // "QUOTE" title — right-aligned
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.text('QUOTE', pageW - mR, y, { align: 'right' });

  // Quote number
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  pdf.text(`#${data.quoteNumber}`, pageW - mR, y + 6, { align: 'right' });

  // Date
  const displayDate = data.createdAt
    ? new Date(data.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
  pdf.text(displayDate, pageW - mR, y + 11, { align: 'right' });

  // Status badge (if provided)
  if (data.status) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text(data.status.toUpperCase(), pageW - mR, y + 16, { align: 'right' });
  }

  y = Math.max(y + 22, logoBottomY + 4);
  drawHR(pdf, y, mL, mR);
  y += 8;

  // ─── CUSTOMER & VEHICLE ─────────────────────────────────────────────

  const colLeft = mL;
  const colRight = mL + contentW / 2 + 10;

  // Customer info — left column
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.text('CUSTOMER', colLeft, y);
  y += 5;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(DARK.r, DARK.g, DARK.b);

  const custY = y;
  if (data.customer?.name) {
    pdf.setFont('helvetica', 'bold');
    pdf.text(data.customer.name, colLeft, y);
    pdf.setFont('helvetica', 'normal');
    y += 4.5;
  }
  if (data.customer?.company) {
    pdf.text(data.customer.company, colLeft, y);
    y += 4.5;
  }
  if (data.customer?.email) {
    pdf.text(data.customer.email, colLeft, y);
    y += 4.5;
  }
  if (data.customer?.phone) {
    pdf.text(data.customer.phone, colLeft, y);
    y += 4.5;
  }
  if (!data.customer?.name && !data.customer?.email) {
    pdf.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    pdf.text('No customer info', colLeft, y);
    y += 4.5;
  }

  // Vehicle info — right column
  let vy = custY - 5; // reset to same row as customer heading
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.text('VEHICLE', colRight, vy);
  vy += 5;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(DARK.r, DARK.g, DARK.b);
  const vehicleStr = [data.vehicle.year, data.vehicle.make, data.vehicle.model]
    .filter(Boolean)
    .join(' ') || 'Not specified';
  pdf.text(vehicleStr, colRight, vy);

  y = Math.max(y, vy + 6) + 4;
  drawHR(pdf, y, mL, mR);
  y += 8;

  // ─── PRODUCT DETAILS ───────────────────────────────────────────────

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.text('PRODUCT DETAILS', mL, y);
  y += 6;

  pdf.setFontSize(9);
  pdf.setTextColor(DARK.r, DARK.g, DARK.b);

  const details: [string, string][] = [];
  if (data.category)     details.push(['Product / Category', data.category]);
  if (data.manufacturer) details.push(['Manufacturer', data.manufacturer]);
  if (data.colorName)    details.push(['Color', data.colorName]);
  if (data.finish)       details.push(['Finish', data.finish]);
  if (data.sqFt)         details.push(['Square Footage', `${data.sqFt} sq ft`]);
  if (data.yardsNeeded)  details.push(['Yards Needed', `${data.yardsNeeded} yds`]);

  for (const [label, value] of details) {
    pdf.setFont('helvetica', 'bold');
    pdf.text(`${label}:`, mL, y);
    pdf.setFont('helvetica', 'normal');
    pdf.text(value, mL + 40, y);
    y += 5;
  }

  y += 4;
  drawHR(pdf, y, mL, mR);
  y += 8;

  // (Old "Render Preview" block removed — the full-width hero band
  // above the customer section now carries the imagery role.)

  // ─── LINE ITEMS TABLE ──────────────────────────────────────────────

  // Check if we need a new page before the table
  if (y + 40 > pageH - 30) {
    pdf.addPage();
    y = 18;
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.text('PRICING', mL, y);
  y += 6;

  // Table header background
  pdf.setFillColor(LIGHT.r, LIGHT.g, LIGHT.b);
  pdf.rect(mL, y - 3.5, contentW, 7, 'F');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(DARK.r, DARK.g, DARK.b);
  pdf.text('Item', mL + 2, y);
  pdf.text('Detail', mL + 70, y);
  pdf.text('Amount', pageW - mR - 2, y, { align: 'right' });
  y += 7;

  // Line items — expand FadeWrap rows into per-component sub-lines so
  // the customer sees what builds up to the total instead of a single
  // 'WPW FadeWrap … $1,690' row.
  const rawItems = data.lineItems && data.lineItems.length > 0
    ? data.lineItems
    : [{ label: 'Vehicle Wrap', detail: vehicleStr, amount: data.customerTotal }];
  const items = rawItems.flatMap(expandLineItem);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(DARK.r, DARK.g, DARK.b);

  // Column geometry: Item | Detail | Amount. Detail wraps to multiple
  // lines so the full FadeWrap summary (size · panels · color · finish)
  // shows up instead of being cut at 40 chars.
  const labelColX  = mL + 2;
  const detailColX = mL + 70;
  const amountColX = pageW - mR - 2;
  const amountColLeft = amountColX - 28; // reserve room for "$1,234.56"
  const detailColW = Math.max(20, amountColLeft - detailColX - 2);
  const labelColW  = Math.max(20, detailColX - labelColX - 2);

  let subtotal = 0;
  for (const item of items) {
    const labelLines  = pdf.splitTextToSize(item.label, labelColW) as string[];
    const detailLines = item.detail
      ? (pdf.splitTextToSize(item.detail, detailColW) as string[])
      : [];
    const rowLines = Math.max(1, labelLines.length, detailLines.length);
    const lineH = 4.6;
    const rowH = rowLines * lineH;

    pdf.setTextColor(DARK.r, DARK.g, DARK.b);
    pdf.text(labelLines, labelColX, y);

    if (detailLines.length > 0) {
      pdf.setTextColor(MUTED.r, MUTED.g, MUTED.b);
      pdf.text(detailLines, detailColX, y);
      pdf.setTextColor(DARK.r, DARK.g, DARK.b);
    }

    pdf.text(usd(item.amount), amountColX, y, { align: 'right' });
    subtotal += item.amount;
    y += rowH + 1.5;

    pdf.setDrawColor(LINE.r, LINE.g, LINE.b);
    pdf.setLineWidth(0.15);
    pdf.line(mL, y - 2.5, pageW - mR, y - 2.5);
  }

  y += 2;

  // Subtotal (only show if more than one line item)
  if (items.length > 1) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    pdf.text('Subtotal', mL + 70, y);
    pdf.text(usd(subtotal), pageW - mR - 2, y, { align: 'right' });
    y += 7;
  }

  // TOTAL row — bold, larger, with background
  pdf.setFillColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.rect(mL, y - 4, contentW, 9, 'F');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  pdf.text('TOTAL', mL + 2, y + 1);
  pdf.text(usd(data.customerTotal), pageW - mR - 2, y + 1, { align: 'right' });
  y += 14;

  // ─── PAY / ADD TO CART CTA ─────────────────────────────────────────
  // Green pill that hyperlinks to the customer's pre-loaded cart so they
  // can pay straight from the PDF without going through the shop site.
  if (data.payUrl) {
    if (y + 16 > pageH - 30) {
      pdf.addPage();
      y = 18;
    }
    const btnH = 11;
    // Widen the pill so the longer "Add to WePrintWraps.com Cart" label
    // doesn't overflow and there's breathing room around the glyphs.
    const btnW = 120;
    const btnX = (pageW - btnW) / 2;
    const btnY = y;
    pdf.setFillColor(34, 197, 94); // emerald-500
    pdf.roundedRect(btnX, btnY, btnW, btnH, 2.5, 2.5, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(WHITE.r, WHITE.g, WHITE.b);
    const label = 'Add to WePrintWraps.com Cart';
    pdf.textWithLink(
      label,
      btnX + btnW / 2 - pdf.getTextWidth(label) / 2,
      btnY + btnH / 2 + 1.6,
      { url: data.payUrl },
    );
    // Clickable area covers the whole button, not just the glyph baseline.
    pdf.link(btnX, btnY, btnW, btnH, { url: data.payUrl });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    pdf.text(
      'One-click checkout — your items are pre-loaded in your cart.',
      pageW / 2,
      btnY + btnH + 4,
      { align: 'center' },
    );
    y += btnH + 10;
  }

  // ─── ADD-ONS (conditional) ─────────────────────────────────────────

  // Check if any add-on information exists in line items
  const addOnItems = data.lineItems?.filter(
    (li) =>
      li.label.toLowerCase().includes('drawing') ||
      li.label.toLowerCase().includes('proof') ||
      li.label.toLowerCase().includes('add-on') ||
      li.label.toLowerCase().includes('addon')
  );

  if (addOnItems && addOnItems.length > 0) {
    if (y + 20 > pageH - 30) {
      pdf.addPage();
      y = 18;
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
    pdf.text('ADD-ONS', mL, y);
    y += 6;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(DARK.r, DARK.g, DARK.b);

    for (const addon of addOnItems) {
      pdf.text(`  \u2022  ${addon.label}`, mL, y);
      if (addon.detail) {
        pdf.setTextColor(MUTED.r, MUTED.g, MUTED.b);
        pdf.text(addon.detail, mL + 60, y);
        pdf.setTextColor(DARK.r, DARK.g, DARK.b);
      }
      pdf.text(usd(addon.amount), pageW - mR - 2, y, { align: 'right' });
      y += 5;
    }

    y += 4;
  }


  // ─── PRICING TIER PANEL ────────────────────────────────────────────
  // Single bottom upsell block: 4 admin-uploaded cards (Starter /
  // DesignProLite / DesignProStudio / DesignProPlus). Each card has an
  // image the admin uploaded on /admin/quote-pdf-cards, a tier label,
  // a price, and a clickable URL the admin set (gallery / pricing /
  // order page / etc.). Skipped automatically if the table is empty
  // or there isn't space above the footer.
  const tierCards = await fetchPricingTierCards();
  if (tierCards.length > 0) {
    const titleH = 8;
    const cardH = 38;
    const cardGap = 3;
    const cardCount = Math.min(tierCards.length, 4);
    const cardW = (contentW - cardGap * (cardCount - 1)) / cardCount;
    const imageH = 18;
    // titleH now needs room for both the headline + the pricing line
    // (was 1 line, now 2). Bump panelH accordingly so we don't run
    // off the bottom margin.
    const panelH = titleH + 4 + cardH + 2;

    if (y + panelH < pageH - 16) {
      // Headline + pricing pitch (replaces the old "pick your plan" line).
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.setTextColor(DARK.r, DARK.g, DARK.b);
      pdf.text(
        'DesignProAI — like having a graphic designer at your fingertips',
        mL,
        y + 4,
      );
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(MUTED.r, MUTED.g, MUTED.b);
      pdf.text(
        'Membership $399/mo  •  WPW customers save $50 — $349/mo  •  DesignPacks $299 (own print-ready files)',
        mL,
        y + 9,
      );
      const cardsY = y + titleH + 4;

      for (let i = 0; i < cardCount; i++) {
        const card = tierCards[i];
        const x = mL + i * (cardW + cardGap);

        // Card border
        pdf.setDrawColor(LINE.r, LINE.g, LINE.b);
        pdf.setLineWidth(0.3);
        pdf.roundedRect(x, cardsY, cardW, cardH, 1.5, 1.5, 'S');

        // Image area (top of card). Use "contain" scaling so the image
        // never overflows the box and bleeds onto the label area below.
        // Black letterbox fills any leftover whitespace.
        if (card.image_url) {
          try {
            const img = await loadImageAsDataUrl(card.image_url);
            const scale = Math.min(cardW / img.width, imageH / img.height);
            const drawW = img.width * scale;
            const drawH = img.height * scale;
            const drawX = x + (cardW - drawW) / 2;
            const drawY = cardsY + (imageH - drawH) / 2;
            pdf.setFillColor(0, 0, 0);
            pdf.rect(x + 0.3, cardsY + 0.3, cardW - 0.6, imageH, 'F');
            pdf.addImage(img.dataUrl, 'JPEG', drawX, drawY, drawW, drawH);
          } catch {
            pdf.setFillColor(LIGHT.r, LIGHT.g, LIGHT.b);
            pdf.rect(x + 0.3, cardsY + 0.3, cardW - 0.6, imageH, 'F');
          }
        } else {
          // Empty placeholder so the card layout doesn't shift before
          // the admin uploads an image.
          pdf.setFillColor(LIGHT.r, LIGHT.g, LIGHT.b);
          pdf.rect(x + 0.3, cardsY + 0.3, cardW - 0.6, imageH, 'F');
        }

        // Label — auto-shrink so long names like "DesignProStudio"
        // don't overflow the narrow card width.
        pdf.setFont('helvetica', 'bold');
        const maxLabelWidth = cardW - 4;
        let labelFontSize = 9;
        pdf.setFontSize(labelFontSize);
        while (
          labelFontSize > 6 &&
          pdf.getTextWidth(card.label) > maxLabelWidth
        ) {
          labelFontSize -= 0.5;
          pdf.setFontSize(labelFontSize);
        }
        pdf.setTextColor(DARK.r, DARK.g, DARK.b);
        pdf.text(card.label, x + cardW / 2, cardsY + imageH + 5, {
          align: 'center',
        });

        // Price
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
        pdf.text(card.price, x + cardW / 2, cardsY + imageH + 11, {
          align: 'center',
        });

        // CTA caption — explicit so it's clear the card is clickable
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
        pdf.text('Try it →', x + cardW / 2, cardsY + imageH + 16, {
          align: 'center',
        });

        // Whole card clickable to the admin-set URL.
        if (card.cta_url) {
          pdf.link(x, cardsY, cardW, cardH, { url: card.cta_url });
        }
      }

      y += panelH;
    }
  }

  // ─── FOOTER ─────────────────────────────────────────────────────────

  const footerY = pageH - 10;

  // Small RP sprocket + "Generated by DesignProAI™" — bottom center.
  // Sprocket is intentionally small so the shop's own header branding
  // stays the prominent mark on the page.
  const platformLabel = `Generated by ${PLATFORM_LABEL}`;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  const labelW = pdf.getTextWidth(platformLabel);
  let platformLogoW = 0;
  if (sprocketData) {
    const sprocketH = 5;
    platformLogoW = (sprocketData.width / sprocketData.height) * sprocketH;
  }
  const gap = sprocketData ? 2 : 0;
  const groupW = platformLogoW + gap + labelW;
  const groupX = (pageW - groupW) / 2;
  if (sprocketData) {
    pdf.addImage(
      sprocketData.dataUrl,
      'PNG',
      groupX,
      footerY - 4,
      platformLogoW,
      5,
    );
  }
  pdf.text(platformLabel, groupX + platformLogoW + gap, footerY);

  // "QuickQuote™" watermark — bottom-right corner
  pdf.setFont('helvetica', 'italic');
  pdf.setFontSize(7);
  pdf.setTextColor(LINE.r, LINE.g, LINE.b);
  pdf.text('QuickQuote\u2122', pageW - mR, footerY, { align: 'right' });

  // ─── SAVE ───────────────────────────────────────────────────────────

  const safeShop = data.shopName.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30);
  const filename = `Quote-${data.quoteNumber}-${safeShop}.pdf`;
  pdf.save(filename);
}
