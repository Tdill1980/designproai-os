/**
 * wpw-work-order-pdf — client-side PDF generator for the WPW production
 * team. Replaces the browser's print stack (which produced empty jobs
 * → printer firmware pages). Renders a deterministic letter-paper
 * Work Order using jsPDF and triggers a direct download.
 *
 * No server, no edge function, no auth race. Uses the order data the
 * modal already has in memory.
 */
import jsPDF from "jspdf";
import type { WpwOrder } from "@/hooks/useWpwOrders";
import { extractBriefAndUploads, fileNameFromUrl } from "@/lib/wpw-order-extract";

const PAGE_WIDTH_PT = 612;
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH_PT - MARGIN * 2;
const PAGE_HEIGHT_PT = 792;

const fmtCurrency = (n: number | null | undefined, code?: string | null) => {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code || "USD",
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const addressLines = (addr: Record<string, unknown> | null | undefined): string[] => {
  if (!addr) return [];
  const get = (k: string) => (typeof addr[k] === "string" ? (addr[k] as string) : "");
  const name = [get("first_name"), get("last_name")].filter(Boolean).join(" ");
  const company = get("company");
  const street = [get("address_1"), get("address_2")].filter(Boolean).join(", ");
  const cityLine = [get("city"), get("state"), get("postcode")].filter(Boolean).join(", ");
  const country = get("country");
  return [name, company, street, cityLine, country].filter(Boolean);
};

interface PdfState {
  doc: jsPDF;
  y: number;
}

function newPageIfNeeded(s: PdfState, needed: number) {
  if (s.y + needed > PAGE_HEIGHT_PT - MARGIN) {
    s.doc.addPage();
    s.y = MARGIN;
  }
}

function drawText(s: PdfState, text: string, opts: {
  size?: number;
  bold?: boolean;
  color?: [number, number, number];
  x?: number;
  align?: "left" | "right" | "center";
  width?: number;
} = {}) {
  const size = opts.size ?? 10;
  s.doc.setFontSize(size);
  s.doc.setFont("helvetica", opts.bold ? "bold" : "normal");
  if (opts.color) s.doc.setTextColor(opts.color[0], opts.color[1], opts.color[2]);
  else s.doc.setTextColor(0, 0, 0);
  const x = opts.x ?? MARGIN;
  const width = opts.width ?? CONTENT_WIDTH;
  const lines = s.doc.splitTextToSize(text, width);
  newPageIfNeeded(s, lines.length * size * 1.3 + 2);
  s.doc.text(lines, x, s.y, { align: opts.align ?? "left" });
  s.y += lines.length * size * 1.3;
}

function drawHr(s: PdfState, weight = 0.5) {
  newPageIfNeeded(s, 6);
  s.doc.setDrawColor(180);
  s.doc.setLineWidth(weight);
  s.doc.line(MARGIN, s.y, PAGE_WIDTH_PT - MARGIN, s.y);
  s.y += 6;
}

function drawSpacer(s: PdfState, h: number) {
  s.y += h;
}

function drawSectionLabel(s: PdfState, text: string) {
  newPageIfNeeded(s, 16);
  drawText(s, text.toUpperCase(), {
    size: 8,
    bold: true,
    color: [110, 110, 110],
  });
  drawSpacer(s, 2);
}

export function buildWorkOrderPdf(order: WpwOrder): Blob {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const s: PdfState = { doc, y: MARGIN };

  // Header
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("Work Order", MARGIN, s.y + 10);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110);
  doc.text("WePrintWraps — production", MARGIN, s.y + 24);

  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text("Order", PAGE_WIDTH_PT - MARGIN, s.y + 10, { align: "right" });
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text(`#${order.order_number || order.id}`, PAGE_WIDTH_PT - MARGIN, s.y + 28, { align: "right" });
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(110);
  doc.text((order.status || "—").replace(/-/g, " ").toUpperCase(), PAGE_WIDTH_PT - MARGIN, s.y + 40, { align: "right" });

  s.y += 52;
  drawHr(s, 1.5);

  // Customer + dates
  drawSectionLabel(s, "Customer");
  const startY = s.y;
  drawText(s, order.customer_name || "—", { size: 11, bold: true });
  if (order.customer_email) drawText(s, order.customer_email, { size: 10, color: [80, 80, 80] });
  const phone = (order.billing as Record<string, unknown> | null)?.phone;
  if (typeof phone === "string" && phone) drawText(s, phone, { size: 10, color: [80, 80, 80] });
  const customerEndY = s.y;

  s.y = startY;
  drawText(s, "Dates", { size: 8, bold: true, color: [110, 110, 110], x: PAGE_WIDTH_PT - MARGIN - 200, width: 200, align: "right" });
  drawText(s, `Placed: ${fmtDate(order.date_created)}`, { size: 10, x: PAGE_WIDTH_PT - MARGIN - 200, width: 200, align: "right" });
  if (order.date_completed) drawText(s, `Completed: ${fmtDate(order.date_completed)}`, { size: 10, x: PAGE_WIDTH_PT - MARGIN - 200, width: 200, align: "right" });
  if (order.payment_method) drawText(s, `Paid via ${order.payment_method}`, { size: 9, color: [110, 110, 110], x: PAGE_WIDTH_PT - MARGIN - 200, width: 200, align: "right" });

  s.y = Math.max(customerEndY, s.y) + 8;

  // Customer note
  const { customerNote, uploads, documents } = extractBriefAndUploads(order, order.wpw_order_items || []);
  if (customerNote) {
    drawHr(s);
    drawSectionLabel(s, "Customer Note");
    s.doc.setFillColor(255, 251, 235);
    s.doc.setDrawColor(245, 158, 11);
    s.doc.setLineWidth(0.5);
    const noteLines = doc.splitTextToSize(customerNote, CONTENT_WIDTH - 12);
    const noteHeight = noteLines.length * 10 * 1.3 + 12;
    newPageIfNeeded(s, noteHeight + 6);
    s.doc.rect(MARGIN, s.y, CONTENT_WIDTH, noteHeight, "FD");
    s.doc.setFontSize(10);
    s.doc.setFont("helvetica", "normal");
    s.doc.setTextColor(50);
    s.doc.text(noteLines, MARGIN + 6, s.y + 12);
    s.y += noteHeight + 6;
  }

  // Addresses
  if (order.shipping || order.billing) {
    drawHr(s);
    const startAddrY = s.y;
    if (order.shipping && addressLines(order.shipping).length > 0) {
      drawSectionLabel(s, "Ship To");
      addressLines(order.shipping).forEach((line) =>
        drawText(s, line, { size: 10 }),
      );
    }
    const shipEndY = s.y;
    if (order.billing && addressLines(order.billing).length > 0) {
      s.y = startAddrY;
      drawText(s, "BILL TO", { size: 8, bold: true, color: [110, 110, 110], x: MARGIN + CONTENT_WIDTH / 2, width: CONTENT_WIDTH / 2 });
      drawSpacer(s, 2);
      addressLines(order.billing).forEach((line) =>
        drawText(s, line, { size: 10, x: MARGIN + CONTENT_WIDTH / 2, width: CONTENT_WIDTH / 2 }),
      );
    }
    s.y = Math.max(shipEndY, s.y) + 4;
  }

  // Items table
  const items = order.wpw_order_items || [];
  if (items.length > 0) {
    drawHr(s);
    drawSectionLabel(s, `Items (${items.length})`);
    // Header row
    newPageIfNeeded(s, 18);
    s.doc.setFont("helvetica", "bold");
    s.doc.setFontSize(9);
    s.doc.setTextColor(0);
    s.doc.text("Item", MARGIN, s.y);
    s.doc.text("SKU", MARGIN + CONTENT_WIDTH * 0.55, s.y);
    s.doc.text("Qty", MARGIN + CONTENT_WIDTH * 0.78, s.y, { align: "right" });
    s.doc.text("Total", MARGIN + CONTENT_WIDTH, s.y, { align: "right" });
    s.y += 4;
    s.doc.setDrawColor(0);
    s.doc.setLineWidth(1);
    s.doc.line(MARGIN, s.y, PAGE_WIDTH_PT - MARGIN, s.y);
    s.y += 8;

    s.doc.setFont("helvetica", "normal");
    s.doc.setFontSize(9);
    items.forEach((it) => {
      const nameLines = s.doc.splitTextToSize(it.name || "—", CONTENT_WIDTH * 0.5);
      const rowH = Math.max(12, nameLines.length * 10);
      newPageIfNeeded(s, rowH + 4);
      s.doc.text(nameLines, MARGIN, s.y);
      s.doc.text(it.sku || "—", MARGIN + CONTENT_WIDTH * 0.55, s.y);
      s.doc.text(String(it.quantity ?? 1), MARGIN + CONTENT_WIDTH * 0.78, s.y, { align: "right" });
      s.doc.text(fmtCurrency(it.total, order.currency), MARGIN + CONTENT_WIDTH, s.y, { align: "right" });
      s.y += rowH;
      s.doc.setDrawColor(220);
      s.doc.setLineWidth(0.3);
      s.doc.line(MARGIN, s.y, PAGE_WIDTH_PT - MARGIN, s.y);
      s.y += 4;
    });
  }

  // Totals
  drawSpacer(s, 4);
  newPageIfNeeded(s, 60);
  const totalsX = PAGE_WIDTH_PT - MARGIN - 140;
  s.doc.setFontSize(10);
  s.doc.setFont("helvetica", "normal");
  s.doc.setTextColor(80);
  if (order.subtotal != null) {
    s.doc.text("Subtotal", totalsX, s.y);
    s.doc.text(fmtCurrency(order.subtotal, order.currency), PAGE_WIDTH_PT - MARGIN, s.y, { align: "right" });
    s.y += 14;
  }
  if (order.shipping_total != null && order.shipping_total > 0) {
    s.doc.text("Shipping", totalsX, s.y);
    s.doc.text(fmtCurrency(order.shipping_total, order.currency), PAGE_WIDTH_PT - MARGIN, s.y, { align: "right" });
    s.y += 14;
  }
  if (order.tax_total != null && order.tax_total > 0) {
    s.doc.text("Tax", totalsX, s.y);
    s.doc.text(fmtCurrency(order.tax_total, order.currency), PAGE_WIDTH_PT - MARGIN, s.y, { align: "right" });
    s.y += 14;
  }
  s.doc.setDrawColor(0);
  s.doc.setLineWidth(1);
  s.doc.line(totalsX, s.y, PAGE_WIDTH_PT - MARGIN, s.y);
  s.y += 14;
  s.doc.setFont("helvetica", "bold");
  s.doc.setTextColor(0);
  s.doc.text("Total", totalsX, s.y);
  s.doc.text(fmtCurrency(order.total, order.currency), PAGE_WIDTH_PT - MARGIN, s.y, { align: "right" });
  s.y += 18;

  // Tracking
  if (order.tracking_number || order.tracking_url) {
    drawHr(s);
    drawSectionLabel(s, "Tracking");
    if (order.tracking_carrier) drawText(s, `Carrier: ${order.tracking_carrier}`, { size: 10 });
    if (order.tracking_number) drawText(s, `Number: ${order.tracking_number}`, { size: 10, bold: true });
    if (order.tracking_url) drawText(s, order.tracking_url, { size: 9, color: [80, 80, 80] });
    drawSpacer(s, 4);
  }

  // Customer-uploaded artwork (filenames + URLs only — no embedded
  // thumbnails so PDF generation is instant and offline-safe)
  if (uploads.length > 0) {
    drawHr(s);
    drawSectionLabel(s, `Customer-Uploaded Artwork (${uploads.length})`);
    uploads.forEach((url, i) => {
      drawText(s, `${i + 1}. ${fileNameFromUrl(url)}`, { size: 10, bold: true });
      drawText(s, url, { size: 8, color: [80, 80, 80] });
      drawSpacer(s, 2);
    });
  }

  if (documents.length > 0) {
    drawHr(s);
    drawSectionLabel(s, `Customer Files (${documents.length})`);
    documents.forEach((url, i) => {
      drawText(s, `${i + 1}. ${fileNameFromUrl(url)}`, { size: 10, bold: true });
      drawText(s, url, { size: 8, color: [80, 80, 80] });
      drawSpacer(s, 2);
    });
  }

  // Footer
  drawSpacer(s, 8);
  drawHr(s);
  drawText(
    s,
    `Generated from RestylePro · ${new Date().toLocaleString("en-US")}    Order #${order.order_number || order.id}`,
    { size: 8, color: [120, 120, 120] },
  );

  return doc.output("blob");
}

export function downloadWorkOrderPdf(order: WpwOrder) {
  const blob = buildWorkOrderPdf(order);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `WPW-Order-${order.order_number || order.id}-WorkOrder.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
