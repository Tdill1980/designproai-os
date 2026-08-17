import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient, getExternalSupabaseUrl } from "../_shared/external-db.ts";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * GENERATE-APPROVEPRO-PDF
 * 
 * Server-side PDF generation for proof sheets.
 * Accepts deterministic payload and generates:
 * - Page 1: 6-view proof sheet with all metadata
 * - Page 2: Terms & conditions (if includeTerms is true)
 * 
 * Returns the public URL of the saved PDF.
 */

interface ViewData {
  type: string;
  url: string;
  label?: string;
}

interface VehicleInfo {
  year?: string;
  make?: string;
  model?: string;
}

interface ProofPayload {
  // Tool identification (from registry)
  toolName: string;
  
  // Views to include
  views: ViewData[];
  
  // Vehicle info
  vehicleInfo: VehicleInfo;
  
  // Film/design information
  manufacturer?: string;
  filmName?: string;
  productCode?: string;
  finish?: string;
  
  // Customer/shop info
  customerName?: string;
  shopName?: string;
  shopLogoUrl?: string;
  
  // Options
  includeTerms?: boolean;
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
    if (
      String(payload.toolName || "").toLowerCase().includes("approve") &&
      !isApproveProLive()
    ) {
      return approveProDisabledResponse();
    }
    
    console.log("📄 Generating proof PDF:", {
      toolName: payload.toolName,
      vehicle: payload.vehicleInfo,
      filmName: payload.filmName,
      includeTerms: payload.includeTerms,
    });

    // Connect to EXTERNAL database for storage operations
    const supabase = createExternalClient();

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // ===== PAGE 1: PROOF SHEET =====
    const page1 = pdf.addPage([792, 612]); // Landscape letter
    const { width, height } = page1.getSize();

    // Helper function for Page 1
    const drawText = (text: string, x: number, y: number, size = 12, bold = false) => {
      page1.drawText(text, {
        x,
        y,
        size,
        font: bold ? fontBold : font,
        color: rgb(0, 0, 0),
      });
    };

    // === HEADER ===
    const vehicleStr = [payload.vehicleInfo?.year, payload.vehicleInfo?.make, payload.vehicleInfo?.model]
      .filter(Boolean)
      .join(' ') || 'Vehicle';

    // Wrap description for title
    const wrapDesc = [payload.manufacturer, payload.finish, payload.filmName].filter(Boolean).join(' ') || 'Custom Wrap';
    const titleStr = `${vehicleStr} — ${wrapDesc}`;

    // Tool name + title (top-left)
    drawText(payload.toolName || 'RestyleProAI', 40, height - 35, 18, true);
    drawText(titleStr, 40, height - 52, 10, true);

    // Shop name below (if available)
    if (payload.shopName) {
      drawText(payload.shopName, 40, height - 65, 9, false);
    }

    // Date (top-right)
    const proofDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const dateWidth = font.widthOfTextAtSize(proofDate, 9);
    page1.drawText(proofDate, { x: width - 40 - dateWidth, y: height - 35, size: 9, font: font, color: rgb(0.4, 0.4, 0.4) });
    const approvalLabel = 'Design Approval Proof';
    const approvalWidth = fontBold.widthOfTextAtSize(approvalLabel, 10);
    page1.drawText(approvalLabel, { x: width - 40 - approvalWidth, y: height - 50, size: 10, font: fontBold, color: rgb(0, 0, 0) });

    // Horizontal separator
    page1.drawLine({
      start: { x: 40, y: height - 72 },
      end: { x: width - 40, y: height - 72 },
      thickness: 1,
      color: rgb(0.2, 0.2, 0.2),
    });

    // === 6-VIEW GRID ===
    const gridStartY = height - 90;
    const gridMargin = 40;
    const gridSpacing = 12;
    const cols = 3;
    const rows = 2;
    const gridWidth = width - (gridMargin * 2);
    const gridHeight = 300;
    const cellWidth = (gridWidth - (gridSpacing * (cols - 1))) / cols;
    const cellHeight = (gridHeight - (gridSpacing * (rows - 1))) / rows;

    // View order for grid — matches ProfessionalProofSheet client layout (6 cells)
    const viewOrder = ['side', 'passenger-side', 'hood_detail', 'rear', 'close-up', 'roof'];
    const viewLabels: Record<string, string> = {
      'side': 'Driver Side',
      'driver-side': 'Driver Side',
      'passenger-side': 'Passenger Side',
      'hood_detail': 'Hood',
      'front': 'Front',
      'rear': 'Rear',
      'close-up': 'Close-Up',
      'roof': 'Roof',
    };

    // Determine tool badge for overlay
    const toolNameLower = (payload.toolName || '').toLowerCase();
    const toolBadge = toolNameLower.includes('colorpro') ? 'ColorPro'
      : toolNameLower.includes('designproai') ? 'DesignProAI'
      : toolNameLower.includes('restylelibrary') ? 'RestyleLibrary'
      : toolNameLower.includes('designpanel') ? 'DesignProAI'
      : toolNameLower.includes('fade') ? 'FadeWraps'
      : toolNameLower.includes('approve') ? 'ApprovePro'
      : toolNameLower.includes('wbty') ? 'WBTY'
      : 'RestyleProAI';

    // Build vehicle + vinyl info line for overlay
    const overlayVehicle = [payload.vehicleInfo?.year, payload.vehicleInfo?.make, payload.vehicleInfo?.model].filter(Boolean).join(' ');
    const overlayFilm = [payload.manufacturer, payload.finish, payload.filmName].filter(Boolean).join(' ');
    const overlayInfoLine = [overlayVehicle, overlayFilm].filter(Boolean).join(' | ');

    // Deduplication: track which view indices have been used
    const usedViewIndices = new Set<number>();

    for (let i = 0; i < 6; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);

      const cellX = gridMargin + (col * (cellWidth + gridSpacing));
      const cellY = gridStartY - (row * (cellHeight + gridSpacing)) - cellHeight;

      // Find matching view with deduplication
      const viewType = viewOrder[i];
      let view: ViewData | undefined;
      let forceFlip = false;
      const viewIdx = payload.views.findIndex((v, idx) => {
        if (usedViewIndices.has(idx)) return false;
        const vLower = v.type.toLowerCase();
        if (viewType === 'side' && (vLower === 'side' || vLower.includes('driver'))) return true;
        if (viewType === 'hood_detail' && (vLower.includes('hood') || vLower === 'hood_detail' || vLower === 'detail')) return true;
        if (viewType === 'passenger-side' && vLower.includes('passenger')) return true;
        if (viewType === 'rear' && vLower.includes('rear')) return true;
        if (viewType === 'close-up' && (vLower.includes('close') || vLower.includes('closeup') || vLower === 'detail')) return true;
        if (viewType === 'roof' && (vLower === 'roof' || vLower === 'hero' || vLower === 'top')) return true;
        return false;
      });
      if (viewIdx >= 0) {
        usedViewIndices.add(viewIdx);
        view = payload.views[viewIdx];
      }

      // Fallback: if no dedicated passenger-side view, use driver side flipped
      if (!view && viewType === 'passenger-side') {
        const driverView = payload.views.find(v => {
          const vl = v.type.toLowerCase();
          return vl === 'side' || vl.includes('driver');
        });
        if (driverView?.url) {
          view = { ...driverView, type: 'passenger-side', label: 'Passenger Side' };
          forceFlip = true;
        }
      }

      if (view?.url) {
        try {
          const res = await fetch(view.url);
          if (res.ok) {
            const bytes = new Uint8Array(await res.arrayBuffer());
            const contentType = res.headers.get('content-type') || '';

            // Try to embed image — attempt PNG first, then JPG as fallback.
            // Supabase Storage may serve images with incorrect content-type headers,
            // or the actual format may differ from the header.
            let img;
            try {
              if (contentType.includes('png')) {
                img = await pdf.embedPng(bytes);
              } else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
                img = await pdf.embedJpg(bytes);
              } else {
                // Unknown content-type: try PNG first (most common from Gemini), then JPG
                try {
                  img = await pdf.embedPng(bytes);
                } catch {
                  img = await pdf.embedJpg(bytes);
                }
              }
            } catch {
              // If content-type-based embed failed, try the other format
              try {
                if (contentType.includes('png')) {
                  img = await pdf.embedJpg(bytes);
                } else {
                  img = await pdf.embedPng(bytes);
                }
              } catch (fallbackErr) {
                console.log("Could not embed image (tried both PNG and JPG):", fallbackErr);
              }
            }

            if (img) {
              // Scale to fit cell while maintaining aspect ratio
              const imgAspect = img.width / img.height;
              const cellAspect = cellWidth / cellHeight;

              let drawWidth = cellWidth;
              let drawHeight = cellHeight;

              if (imgAspect > cellAspect) {
                drawHeight = cellWidth / imgAspect;
              } else {
                drawWidth = cellHeight * imgAspect;
              }

              const offsetX = cellX + (cellWidth - drawWidth) / 2;
              const offsetY = cellY + (cellHeight - drawHeight) / 2;

              // Mirror passenger-side image horizontally if using driver-side URL as fallback
              const isPassenger = viewType === 'passenger-side';
              const vUrl = view.url.toLowerCase();
              const needsMirror = forceFlip || (isPassenger && !vUrl.includes('passenger'));

              if (needsMirror) {
                // Horizontal flip: negative width draws mirrored, offset x to right edge
                page1.drawImage(img, {
                  x: offsetX + drawWidth,
                  y: offsetY,
                  width: -drawWidth,
                  height: drawHeight,
                });
              } else {
                page1.drawImage(img, {
                  x: offsetX,
                  y: offsetY,
                  width: drawWidth,
                  height: drawHeight,
                });
              }

              // Overlay: tool badge — upper-left of image, bold white with dark shadow
              const badgeText = toolBadge + '\u2122';
              // Dark shadow behind text
              page1.drawText(badgeText, { x: offsetX + 5.5, y: offsetY + drawHeight - 13.5, size: 7, font: fontBold, color: rgb(0, 0, 0) });
              // White text on top
              page1.drawText(badgeText, { x: offsetX + 5, y: offsetY + drawHeight - 13, size: 7, font: fontBold, color: rgb(1, 1, 1) });

              // Overlay: vehicle + vinyl info — bottom-right of image, regular white with dark shadow
              if (overlayInfoLine) {
                const infoWidth = font.widthOfTextAtSize(overlayInfoLine, 5);
                const infoX = offsetX + drawWidth - infoWidth - 4;
                const infoY = offsetY + 4;
                // Dark shadow
                page1.drawText(overlayInfoLine, { x: infoX + 0.5, y: infoY - 0.5, size: 5, font: font, color: rgb(0, 0, 0) });
                // White text
                page1.drawText(overlayInfoLine, { x: infoX, y: infoY, size: 5, font: font, color: rgb(1, 1, 1) });
              }
            }
          } else {
            console.log(`Image fetch failed for ${viewType}: HTTP ${res.status}`);
          }
        } catch (imgErr) {
          console.log("Could not embed image for", viewType, ":", imgErr);
        }
      }

      // Draw cell border
      page1.drawRectangle({
        x: cellX,
        y: cellY,
        width: cellWidth,
        height: cellHeight,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 0.5,
      });

      // Draw label below cell
      let label = view?.label || viewLabels[viewType] || viewType;
      if (forceFlip) label += ' (Mirror)';
      page1.drawText(label, {
        x: cellX + cellWidth / 2 - fontBold.widthOfTextAtSize(label, 8) / 2,
        y: cellY - 12,
        size: 8,
        font: fontBold,
        color: rgb(0.2, 0.2, 0.2),
      });
    }

    // === FILM INFORMATION BAR ===
    const filmBarY = gridStartY - gridHeight - 50;
    page1.drawRectangle({
      x: gridMargin,
      y: filmBarY,
      width: gridWidth,
      height: 35,
      color: rgb(0.1, 0.1, 0.1),
    });

    // Film info text
    let filmInfoX = gridMargin + 15;
    const filmInfoY = filmBarY + 12;
    
    if (payload.manufacturer) {
      page1.drawText('Manufacturer:', { x: filmInfoX, y: filmInfoY + 10, size: 7, font: font, color: rgb(0.6, 0.6, 0.6) });
      page1.drawText(payload.manufacturer, { x: filmInfoX, y: filmInfoY, size: 10, font: fontBold, color: rgb(1, 1, 1) });
      filmInfoX += 120;
    }
    
    if (payload.filmName) {
      page1.drawText('Color:', { x: filmInfoX, y: filmInfoY + 10, size: 7, font: font, color: rgb(0.6, 0.6, 0.6) });
      page1.drawText(payload.filmName, { x: filmInfoX, y: filmInfoY, size: 10, font: fontBold, color: rgb(1, 1, 1) });
      filmInfoX += 150;
    }
    
    if (payload.productCode) {
      page1.drawText('Code:', { x: filmInfoX, y: filmInfoY + 10, size: 7, font: font, color: rgb(0.6, 0.6, 0.6) });
      page1.drawText(payload.productCode, { x: filmInfoX, y: filmInfoY, size: 10, font: fontBold, color: rgb(1, 1, 1) });
      filmInfoX += 100;
    }
    
    if (payload.finish) {
      page1.drawText('Finish:', { x: filmInfoX, y: filmInfoY + 10, size: 7, font: font, color: rgb(0.6, 0.6, 0.6) });
      page1.drawText(payload.finish, { x: filmInfoX, y: filmInfoY, size: 10, font: fontBold, color: rgb(1, 1, 1) });
    }

    // === APPROVAL SECTION ===
    const approvalY = filmBarY - 50;
    drawText('CUSTOMER APPROVAL', gridMargin, approvalY, 10, true);
    
    // Customer name
    const customerNameY = approvalY - 25;
    page1.drawText('Customer Name:', { x: gridMargin, y: customerNameY, size: 9, font: font, color: rgb(0.4, 0.4, 0.4) });
    if (payload.customerName) {
      page1.drawText(payload.customerName, { x: gridMargin + 85, y: customerNameY, size: 10, font: fontBold, color: rgb(0, 0, 0) });
    }
    page1.drawLine({
      start: { x: gridMargin + 85, y: customerNameY - 2 },
      end: { x: gridMargin + 250, y: customerNameY - 2 },
      thickness: 0.5,
      color: rgb(0.5, 0.5, 0.5),
    });

    // Approval checkboxes
    const checkboxY = customerNameY - 25;
    page1.drawRectangle({ x: gridMargin, y: checkboxY - 2, width: 10, height: 10, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 1 });
    page1.drawText('I APPROVE this design for production', { x: gridMargin + 15, y: checkboxY, size: 9, font: font, color: rgb(0, 0, 0) });
    
    page1.drawRectangle({ x: gridMargin + 250, y: checkboxY - 2, width: 10, height: 10, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 1 });
    page1.drawText('REVISIONS REQUESTED (see notes)', { x: gridMargin + 265, y: checkboxY, size: 9, font: font, color: rgb(0, 0, 0) });

    // Signature lines
    const sigY = checkboxY - 35;
    page1.drawText('Customer Signature:', { x: gridMargin, y: sigY, size: 9, font: font, color: rgb(0.4, 0.4, 0.4) });
    page1.drawLine({ start: { x: gridMargin + 100, y: sigY - 2 }, end: { x: gridMargin + 300, y: sigY - 2 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
    
    page1.drawText('Date:', { x: gridMargin + 320, y: sigY, size: 9, font: font, color: rgb(0.4, 0.4, 0.4) });
    page1.drawLine({ start: { x: gridMargin + 350, y: sigY - 2 }, end: { x: gridMargin + 450, y: sigY - 2 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });

    page1.drawText('Shop Representative:', { x: width / 2, y: sigY, size: 9, font: font, color: rgb(0.4, 0.4, 0.4) });
    page1.drawLine({ start: { x: width / 2 + 110, y: sigY - 2 }, end: { x: width - 100, y: sigY - 2 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
    
    page1.drawText('Date:', { x: width - 90, y: sigY, size: 9, font: font, color: rgb(0.4, 0.4, 0.4) });
    page1.drawLine({ start: { x: width - 60, y: sigY - 2 }, end: { x: width - 40, y: sigY - 2 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });

    // === FOOTER ===
    page1.drawLine({ start: { x: 40, y: 35 }, end: { x: width - 40, y: 35 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    const footerText = `Generated by RestyleProAI | ${proofDate}`;
    const footerWidth = font.widthOfTextAtSize(footerText, 8);
    page1.drawText(footerText, {
      x: width / 2 - footerWidth / 2,
      y: 20,
      size: 8,
      font: font,
      color: rgb(0.5, 0.5, 0.5),
    });

    // ===== PAGE 2: TERMS & CONDITIONS (if enabled) =====
    if (payload.includeTerms) {
      const page2 = pdf.addPage([612, 792]); // Portrait letter
      const { width: w2, height: h2 } = page2.getSize();

      // Header
      page2.drawText('TERMS & CONDITIONS', {
        x: 50,
        y: h2 - 50,
        size: 18,
        font: fontBold,
        color: rgb(0, 0, 0),
      });

      page2.drawLine({
        start: { x: 50, y: h2 - 60 },
        end: { x: w2 - 50, y: h2 - 60 },
        thickness: 1,
        color: rgb(0.2, 0.2, 0.2),
      });

      // Terms text - split into lines
      const termsLines = TERMS_TEXT.split('\n');
      let termsY = h2 - 90;
      const lineHeight = 14;

      for (const line of termsLines) {
        if (termsY < 80) break; // Stop if we run out of page

        const isSectionHeader = /^\d\./.test(line.trim());
        
        // Word wrap long lines
        const maxWidth = w2 - 100;
        const words = line.split(' ');
        let currentLine = '';
        
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const testWidth = (isSectionHeader ? fontBold : font).widthOfTextAtSize(testLine, isSectionHeader ? 10 : 9);
          
          if (testWidth > maxWidth) {
            page2.drawText(currentLine, {
              x: 50,
              y: termsY,
              size: isSectionHeader ? 10 : 9,
              font: isSectionHeader ? fontBold : font,
              color: rgb(0, 0, 0),
            });
            termsY -= lineHeight;
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        
        if (currentLine) {
          page2.drawText(currentLine, {
            x: 50,
            y: termsY,
            size: isSectionHeader ? 10 : 9,
            font: isSectionHeader ? fontBold : font,
            color: rgb(0, 0, 0),
          });
          termsY -= lineHeight;
        }

        // Extra spacing after section headers
        if (isSectionHeader) {
          termsY -= 4;
        }
      }

      // Footer
      page2.drawText(`Page 2 of 2 | Generated by RestyleProAI | ${proofDate}`, {
        x: w2 / 2 - 80,
        y: 30,
        size: 8,
        font: font,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    // Save and upload PDF
    const pdfBytes = await pdf.save();
    const fileId = crypto.randomUUID();
    const fileName = `pdf/${fileId}.pdf`;

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

    console.log("✅ PDF generated successfully:", publicUrl);

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
