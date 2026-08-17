import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient, getExternalSupabaseUrl } from "../_shared/external-db.ts";
import { PDFDocument, StandardFonts, rgb, type PDFImage } from "https://esm.sh/pdf-lib@1.17.1";

/** Safely fetch and embed an image into the PDF, handling unknown formats gracefully. */
async function safeEmbedImage(pdf: PDFDocument, imageUrl: string): Promise<PDFImage | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      console.warn(`Image fetch failed (${res.status}): ${imageUrl}`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('png')) {
      return await pdf.embedPng(bytes);
    } else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      return await pdf.embedJpg(bytes);
    } else {
      // Unknown format — try JPG first (most common), then PNG as fallback
      try { return await pdf.embedJpg(bytes); }
      catch { try { return await pdf.embedPng(bytes); } catch { return null; } }
    }
  } catch (e) {
    console.error(`Failed to embed image: ${imageUrl}`, e);
    return null;
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * GENERATE-MYVEHICLE-PROOF-PDF
 *
 * Generates a professional before/after proof sheet for "My Vehicle" photo edits.
 *
 * Page 1: Before/after photos side-by-side + vehicle info + vinyl info + price + signatures
 * Page 2 (optional): Multi-view grid when multiple views are provided
 * Last page (optional): Terms & conditions
 */

interface ViewEdit {
  viewType: string;
  beforeUrl: string;
  afterUrl: string;
}

interface VehicleInfo {
  year?: string;
  make?: string;
  model?: string;
}

interface ColorInfo {
  manufacturer?: string;
  colorName?: string;
  productCode?: string;
  finish?: string;
  hex?: string;
}

interface YardageInfo {
  totalSqFt: number;
  linearYards: number;
  panels?: {
    sides: number;
    back: number;
    hood: number;
    roof: number;
    total: number;
    corrected: number;
  };
}

interface ProofPayload {
  views: ViewEdit[];
  vehicleInfo: VehicleInfo;
  colorInfo: ColorInfo;
  customerName?: string;
  shopName?: string;
  shopLogoUrl?: string;
  price?: string;
  includeTerms?: boolean;
  toolName?: string;
  yardage?: YardageInfo;
}

const TERMS_TEXT = `TERMS & CONDITIONS OF APPROVAL:

1. COLOR ACCURACY: Digital previews are approximate representations. Actual film colors may vary due to lighting conditions, screen calibration, and manufacturer batch variations. Customer acknowledges viewing physical swatches is recommended before final approval.

2. PHYSICAL SWATCH REVIEW: Customer confirms they have been offered the opportunity to review physical vinyl swatches prior to approval and understands digital-to-physical color differences may exist.

3. PRE-EXISTING CONDITIONS: Vehicle condition may affect film adhesion and final appearance. Existing paint damage, rust, dents, or previous wrap residue may impact installation quality and warranty coverage.

4. PRODUCTION AUTHORIZATION: By signing this approval, customer authorizes production using the specified manufacturer vinyl film and design as shown. Changes requested after approval may incur additional charges and delays.

5. WARRANTY: Final wrap quality is subject to manufacturer film specifications and proper installation procedures. Installation warranty terms will be provided separately.

6. DESIGN MODIFICATIONS: Minor adjustments may be made during installation to accommodate vehicle contours, panel edges, and other physical constraints. These are considered standard practice.

7. CANCELLATION: Once production has begun, cancellation may result in charges for materials and labor already expended.

8. LIABILITY: The shop is not liable for variations between digital proof and final installed product that fall within standard industry tolerances.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: ProofPayload = await req.json();

    console.log("📄 Generating My Vehicle proof PDF:", {
      views: payload.views?.length,
      vehicle: payload.vehicleInfo,
      color: payload.colorInfo?.colorName,
      includeTerms: payload.includeTerms,
    });

    const supabase = createExternalClient();
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const proofDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    const vehicleStr = [
      payload.vehicleInfo?.year,
      payload.vehicleInfo?.make,
      payload.vehicleInfo?.model,
    ].filter(Boolean).join(' ') || 'Vehicle';

    const wrapDesc = [
      payload.colorInfo?.manufacturer,
      payload.colorInfo?.finish,
      payload.colorInfo?.colorName,
    ].filter(Boolean).join(' ') || 'Custom Wrap';

    const toolBadge = payload.toolName || 'My Vehicle';

    // Generate quote number: MVQ-YYMMDD-XXXX
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const quoteNumber = `MVQ-${yy}${mm}${dd}-${rand}`;

    // ===== PAGE 1: BEFORE/AFTER PROOF =====
    const page1 = pdf.addPage([792, 612]); // Landscape letter
    const { width, height } = page1.getSize();
    const margin = 40;

    // --- HEADER ---
    page1.drawText(`RestyleProAI\u2122 \u2014 ${toolBadge}`, {
      x: margin, y: height - 35, size: 16, font: fontBold, color: rgb(0, 0, 0),
    });
    page1.drawText(`${vehicleStr} \u2014 ${wrapDesc}`, {
      x: margin, y: height - 52, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2),
    });

    if (payload.shopName) {
      page1.drawText(payload.shopName, {
        x: margin, y: height - 65, size: 9, font, color: rgb(0.4, 0.4, 0.4),
      });
    }

    // Date + Quote # top-right
    const dateWidth = font.widthOfTextAtSize(proofDate, 9);
    page1.drawText(proofDate, {
      x: width - margin - dateWidth, y: height - 35, size: 9, font, color: rgb(0.4, 0.4, 0.4),
    });
    const quoteLabel = `Quote #: ${quoteNumber}`;
    const quoteLabelWidth = fontBold.widthOfTextAtSize(quoteLabel, 9);
    page1.drawText(quoteLabel, {
      x: width - margin - quoteLabelWidth, y: height - 48, size: 9, font: fontBold, color: rgb(0, 0, 0),
    });
    const proofLabel = 'Design Approval Proof';
    const proofLabelWidth = fontBold.widthOfTextAtSize(proofLabel, 10);
    page1.drawText(proofLabel, {
      x: width - margin - proofLabelWidth, y: height - 62, size: 10, font: fontBold, color: rgb(0, 0, 0),
    });

    // Header separator
    page1.drawLine({
      start: { x: margin, y: height - 72 },
      end: { x: width - margin, y: height - 72 },
      thickness: 1, color: rgb(0.2, 0.2, 0.2),
    });

    // --- BEFORE / AFTER IMAGES ---
    const imgAreaTop = height - 90;
    const imgAreaWidth = (width - margin * 2 - 20) / 2; // Two columns with 20px gap
    const imgAreaHeight = 240;

    // Use first view for primary before/after
    const primaryView = payload.views?.[0];

    // BEFORE label
    page1.drawText('BEFORE (Original)', {
      x: margin, y: imgAreaTop + 2, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3),
    });

    // AFTER label
    page1.drawText(`AFTER (${wrapDesc})`, {
      x: margin + imgAreaWidth + 20, y: imgAreaTop + 2, size: 10, font: fontBold, color: rgb(0.15, 0.45, 0.15),
    });

    // Embed before image
    if (primaryView?.beforeUrl) {
      const img = await safeEmbedImage(pdf, primaryView.beforeUrl);
      if (img) {
        const imgAspect = img.width / img.height;
        const cellAspect = imgAreaWidth / imgAreaHeight;
        let drawW = imgAreaWidth;
        let drawH = imgAreaHeight;
        if (imgAspect > cellAspect) { drawH = imgAreaWidth / imgAspect; }
        else { drawW = imgAreaHeight * imgAspect; }

        const offsetX = margin + (imgAreaWidth - drawW) / 2;
        const offsetY = (imgAreaTop - imgAreaHeight) + (imgAreaHeight - drawH) / 2;

        page1.drawImage(img, { x: offsetX, y: offsetY, width: drawW, height: drawH });
      }
    }

    // Before image border
    page1.drawRectangle({
      x: margin, y: imgAreaTop - imgAreaHeight,
      width: imgAreaWidth, height: imgAreaHeight,
      borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5,
    });

    // Embed after image
    if (primaryView?.afterUrl) {
      const img = await safeEmbedImage(pdf, primaryView.afterUrl);
      if (img) {
        const imgAspect = img.width / img.height;
        const cellAspect = imgAreaWidth / imgAreaHeight;
        let drawW = imgAreaWidth;
        let drawH = imgAreaHeight;
        if (imgAspect > cellAspect) { drawH = imgAreaWidth / imgAspect; }
        else { drawW = imgAreaHeight * imgAspect; }

        const afterX = margin + imgAreaWidth + 20;
        const offsetX = afterX + (imgAreaWidth - drawW) / 2;
        const offsetY = (imgAreaTop - imgAreaHeight) + (imgAreaHeight - drawH) / 2;

        page1.drawImage(img, { x: offsetX, y: offsetY, width: drawW, height: drawH });
      }
    }

    // After image border
    page1.drawRectangle({
      x: margin + imgAreaWidth + 20, y: imgAreaTop - imgAreaHeight,
      width: imgAreaWidth, height: imgAreaHeight,
      borderColor: rgb(0.15, 0.45, 0.15), borderWidth: 1,
    });

    // --- VINYL INFORMATION BAR ---
    const filmBarY = imgAreaTop - imgAreaHeight - 25;
    const filmBarHeight = 38;
    const gridWidth = width - margin * 2;

    page1.drawRectangle({
      x: margin, y: filmBarY,
      width: gridWidth, height: filmBarHeight,
      color: rgb(0.1, 0.1, 0.1),
    });

    let filmInfoX = margin + 15;
    const filmInfoY = filmBarY + 13;

    if (payload.colorInfo?.manufacturer) {
      page1.drawText('Manufacturer:', { x: filmInfoX, y: filmInfoY + 12, size: 7, font, color: rgb(0.6, 0.6, 0.6) });
      page1.drawText(payload.colorInfo.manufacturer, { x: filmInfoX, y: filmInfoY, size: 10, font: fontBold, color: rgb(1, 1, 1) });
      filmInfoX += 130;
    }

    if (payload.colorInfo?.colorName) {
      page1.drawText('Color:', { x: filmInfoX, y: filmInfoY + 12, size: 7, font, color: rgb(0.6, 0.6, 0.6) });
      page1.drawText(payload.colorInfo.colorName, { x: filmInfoX, y: filmInfoY, size: 10, font: fontBold, color: rgb(1, 1, 1) });
      filmInfoX += 150;
    }

    if (payload.colorInfo?.productCode) {
      page1.drawText('Code:', { x: filmInfoX, y: filmInfoY + 12, size: 7, font, color: rgb(0.6, 0.6, 0.6) });
      page1.drawText(payload.colorInfo.productCode, { x: filmInfoX, y: filmInfoY, size: 10, font: fontBold, color: rgb(1, 1, 1) });
      filmInfoX += 110;
    }

    if (payload.colorInfo?.finish) {
      page1.drawText('Finish:', { x: filmInfoX, y: filmInfoY + 12, size: 7, font, color: rgb(0.6, 0.6, 0.6) });
      page1.drawText(payload.colorInfo.finish, { x: filmInfoX, y: filmInfoY, size: 10, font: fontBold, color: rgb(1, 1, 1) });
      filmInfoX += 100;
    }

    // Color swatch box
    if (payload.colorInfo?.hex) {
      const hex = payload.colorInfo.hex.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      page1.drawRectangle({
        x: width - margin - 40, y: filmBarY + 6,
        width: 26, height: 26,
        color: rgb(r, g, b),
        borderColor: rgb(1, 1, 1), borderWidth: 1,
      });
    }

    // --- VEHICLE INFO + PRICE LINE ---
    const infoLineY = filmBarY - 22;
    page1.drawText('Vehicle:', {
      x: margin, y: infoLineY, size: 9, font, color: rgb(0.4, 0.4, 0.4),
    });
    page1.drawText(vehicleStr, {
      x: margin + 48, y: infoLineY, size: 10, font: fontBold, color: rgb(0, 0, 0),
    });

    // Price field
    page1.drawText('Quoted Price:', {
      x: width / 2, y: infoLineY, size: 9, font, color: rgb(0.4, 0.4, 0.4),
    });
    if (payload.price) {
      page1.drawText(`$${payload.price}`, {
        x: width / 2 + 75, y: infoLineY, size: 11, font: fontBold, color: rgb(0, 0, 0),
      });
    }
    page1.drawLine({
      start: { x: width / 2 + 75, y: infoLineY - 2 },
      end: { x: width / 2 + 200, y: infoLineY - 2 },
      thickness: 0.5, color: rgb(0.5, 0.5, 0.5),
    });

    // --- YARDAGE / MATERIAL ESTIMATE ---
    let yardageSectionHeight = 0;
    if (payload.yardage) {
      const yardY = infoLineY - 30;
      page1.drawText('MATERIAL ESTIMATE', {
        x: margin, y: yardY, size: 9, font: fontBold, color: rgb(0, 0.48, 1),
      });
      const y2 = yardY - 14;
      page1.drawText(`Total Coverage: ${payload.yardage.totalSqFt.toFixed(1)} sq ft`, {
        x: margin, y: y2, size: 8, font, color: rgb(0.3, 0.3, 0.3),
      });
      page1.drawText(`Linear Yards (60" roll, +15% waste): ${payload.yardage.linearYards} yds`, {
        x: margin + 160, y: y2, size: 8, font, color: rgb(0.3, 0.3, 0.3),
      });
      if (payload.yardage.panels) {
        const p = payload.yardage.panels;
        const y3 = y2 - 12;
        page1.drawText(`Sides: ${p.sides.toFixed(1)}  Hood: ${p.hood.toFixed(1)}  Roof: ${p.roof.toFixed(1)}  Back: ${p.back.toFixed(1)} sq ft`, {
          x: margin, y: y3, size: 7, font, color: rgb(0.5, 0.5, 0.5),
        });
        yardageSectionHeight = 45;
      } else {
        yardageSectionHeight = 30;
      }
    }

    // --- APPROVAL SECTION ---
    const approvalY = infoLineY - 35 - yardageSectionHeight;
    page1.drawText('CUSTOMER APPROVAL', {
      x: margin, y: approvalY, size: 10, font: fontBold, color: rgb(0, 0, 0),
    });

    // Customer name
    const custNameY = approvalY - 22;
    page1.drawText('Customer Name:', { x: margin, y: custNameY, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    if (payload.customerName) {
      page1.drawText(payload.customerName, { x: margin + 85, y: custNameY, size: 10, font: fontBold, color: rgb(0, 0, 0) });
    }
    page1.drawLine({
      start: { x: margin + 85, y: custNameY - 2 },
      end: { x: margin + 260, y: custNameY - 2 },
      thickness: 0.5, color: rgb(0.5, 0.5, 0.5),
    });

    // Approval checkboxes
    const checkY = custNameY - 22;
    page1.drawRectangle({ x: margin, y: checkY - 2, width: 10, height: 10, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 1 });
    page1.drawText('I APPROVE this design for production', { x: margin + 15, y: checkY, size: 9, font, color: rgb(0, 0, 0) });

    page1.drawRectangle({ x: margin + 260, y: checkY - 2, width: 10, height: 10, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 1 });
    page1.drawText('REVISIONS REQUESTED (see notes)', { x: margin + 275, y: checkY, size: 9, font, color: rgb(0, 0, 0) });

    // Signature lines
    const sigY = checkY - 32;
    page1.drawText('Customer Signature:', { x: margin, y: sigY, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    page1.drawLine({ start: { x: margin + 105, y: sigY - 2 }, end: { x: margin + 310, y: sigY - 2 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });

    page1.drawText('Date:', { x: margin + 325, y: sigY, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    page1.drawLine({ start: { x: margin + 355, y: sigY - 2 }, end: { x: margin + 455, y: sigY - 2 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });

    const shopSigY = sigY - 24;
    page1.drawText('Shop Representative:', { x: margin, y: shopSigY, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    page1.drawLine({ start: { x: margin + 115, y: shopSigY - 2 }, end: { x: margin + 310, y: shopSigY - 2 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });

    page1.drawText('Date:', { x: margin + 325, y: shopSigY, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    page1.drawLine({ start: { x: margin + 355, y: shopSigY - 2 }, end: { x: margin + 455, y: shopSigY - 2 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });

    // Footer
    page1.drawLine({ start: { x: margin, y: 35 }, end: { x: width - margin, y: 35 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    const footerText = `Quote #: ${quoteNumber} | Generated by RestyleProAI | ${proofDate}`;
    const footerWidth = font.widthOfTextAtSize(footerText, 8);
    page1.drawText(footerText, {
      x: width / 2 - footerWidth / 2, y: 20, size: 8, font, color: rgb(0.5, 0.5, 0.5),
    });

    // ===== PAGE 2: MULTI-VIEW BEFORE/AFTER GRID (if > 1 view) =====
    if (payload.views && payload.views.length > 1) {
      const page2 = pdf.addPage([792, 612]);
      const { width: w2, height: h2 } = page2.getSize();

      // Header
      page2.drawText('All Views — Before & After', {
        x: margin, y: h2 - 35, size: 16, font: fontBold, color: rgb(0, 0, 0),
      });
      page2.drawText(`${vehicleStr} \u2014 ${wrapDesc}  |  Quote #: ${quoteNumber}`, {
        x: margin, y: h2 - 52, size: 10, font, color: rgb(0.3, 0.3, 0.3),
      });
      page2.drawLine({
        start: { x: margin, y: h2 - 60 },
        end: { x: w2 - margin, y: h2 - 60 },
        thickness: 1, color: rgb(0.2, 0.2, 0.2),
      });

      // Grid: each cell is a before/after pair (left=before, right=after)
      const gridTop = h2 - 80;
      const cols = 2; // 2 pairs per row
      const rows = 3; // up to 6 views
      const gridW = w2 - margin * 2;
      const gridH = 400;
      const spacing = 10;
      const pairW = (gridW - spacing * (cols - 1)) / cols; // width per pair
      const pairH = (gridH - spacing * (rows - 1)) / rows; // height per pair
      const halfW = (pairW - 4) / 2; // each image gets half the pair width

      const viewLabels: Record<string, string> = {
        'front': 'Front', 'driver-side': 'Driver Side', 'passenger-side': 'Passenger Side',
        'rear': 'Rear', 'top': 'Top', 'hood': 'Hood Detail', 'detail': 'Detail',
        'hero': 'Hero', 'side': 'Side',
      };

      for (let i = 0; i < Math.min(payload.views.length, 6); i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const view = payload.views[i];

        const pairX = margin + col * (pairW + spacing);
        const pairY = gridTop - row * (pairH + spacing) - pairH;

        // Before image (left half)
        if (view.beforeUrl) {
          const img = await safeEmbedImage(pdf, view.beforeUrl);
          if (img) {
            const ar = img.width / img.height;
            const cr = halfW / pairH;
            let dw = halfW, dh = pairH;
            if (ar > cr) dh = halfW / ar; else dw = pairH * ar;
            page2.drawImage(img, { x: pairX + (halfW - dw) / 2, y: pairY + (pairH - dh) / 2, width: dw, height: dh });
          }
        }
        page2.drawRectangle({ x: pairX, y: pairY, width: halfW, height: pairH, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });

        // After image (right half)
        const afterX = pairX + halfW + 4;
        if (view.afterUrl) {
          const img = await safeEmbedImage(pdf, view.afterUrl);
          if (img) {
            const ar = img.width / img.height;
            const cr = halfW / pairH;
            let dw = halfW, dh = pairH;
            if (ar > cr) dh = halfW / ar; else dw = pairH * ar;
            page2.drawImage(img, { x: afterX + (halfW - dw) / 2, y: pairY + (pairH - dh) / 2, width: dw, height: dh });
          }
        }
        page2.drawRectangle({ x: afterX, y: pairY, width: halfW, height: pairH, borderColor: rgb(0.15, 0.45, 0.15), borderWidth: 0.75 });

        // Labels: "Before" / "After" inside top of each cell
        page2.drawText('Before', { x: pairX + 3, y: pairY + pairH - 10, size: 6, font, color: rgb(0.5, 0.5, 0.5) });
        page2.drawText('After', { x: afterX + 3, y: pairY + pairH - 10, size: 6, font: fontBold, color: rgb(0.15, 0.45, 0.15) });

        // View label below pair
        const label = viewLabels[view.viewType] || view.viewType || `View ${i + 1}`;
        page2.drawText(label, {
          x: pairX + pairW / 2 - fontBold.widthOfTextAtSize(label, 8) / 2,
          y: pairY - 12, size: 8, font: fontBold, color: rgb(0.2, 0.2, 0.2),
        });
      }

      // Footer
      page2.drawLine({ start: { x: margin, y: 35 }, end: { x: w2 - margin, y: 35 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
      const f2 = `Page 2 | Quote #: ${quoteNumber} | Generated by RestyleProAI | ${proofDate}`;
      page2.drawText(f2, {
        x: w2 / 2 - font.widthOfTextAtSize(f2, 8) / 2, y: 20, size: 8, font, color: rgb(0.5, 0.5, 0.5),
      });
    }

    // ===== TERMS PAGE (if enabled) =====
    if (payload.includeTerms) {
      const termsPage = pdf.addPage([612, 792]); // Portrait
      const { width: tw, height: th } = termsPage.getSize();

      termsPage.drawText('TERMS & CONDITIONS', {
        x: 50, y: th - 50, size: 18, font: fontBold, color: rgb(0, 0, 0),
      });
      termsPage.drawLine({
        start: { x: 50, y: th - 60 }, end: { x: tw - 50, y: th - 60 },
        thickness: 1, color: rgb(0.2, 0.2, 0.2),
      });

      const termsLines = TERMS_TEXT.split('\n');
      let termsY = th - 90;
      const lineH = 14;

      for (const line of termsLines) {
        if (termsY < 80) break;
        const isSectionHeader = /^\d\./.test(line.trim());
        const maxW = tw - 100;
        const words = line.split(' ');
        let currentLine = '';

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const testWidth = (isSectionHeader ? fontBold : font).widthOfTextAtSize(testLine, isSectionHeader ? 10 : 9);

          if (testWidth > maxW) {
            termsPage.drawText(currentLine, {
              x: 50, y: termsY, size: isSectionHeader ? 10 : 9,
              font: isSectionHeader ? fontBold : font, color: rgb(0, 0, 0),
            });
            termsY -= lineH;
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }

        if (currentLine) {
          termsPage.drawText(currentLine, {
            x: 50, y: termsY, size: isSectionHeader ? 10 : 9,
            font: isSectionHeader ? fontBold : font, color: rgb(0, 0, 0),
          });
          termsY -= lineH;
        }
        if (isSectionHeader) termsY -= 4;
      }

      const pageNum = payload.views && payload.views.length > 1 ? 3 : 2;
      const termsFooter = `Page ${pageNum} | Generated by RestyleProAI | ${proofDate}`;
      termsPage.drawText(termsFooter, {
        x: tw / 2 - font.widthOfTextAtSize(termsFooter, 8) / 2, y: 30, size: 8, font, color: rgb(0.5, 0.5, 0.5),
      });
    }

    // Save and upload PDF
    const pdfBytes = await pdf.save();
    const fileId = crypto.randomUUID();
    const fileName = `pdf/myvehicle-proof-${fileId}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("wrap-files")
      .upload(fileName, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error(`Failed to upload PDF: ${uploadError.message}`);
    }

    const publicUrl = `${getExternalSupabaseUrl()}/storage/v1/object/public/wrap-files/${fileName}`;

    console.log("✅ My Vehicle proof PDF generated:", publicUrl);

    return new Response(
      JSON.stringify({ success: true, url: publicUrl, fileId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error("❌ PDF generation error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
