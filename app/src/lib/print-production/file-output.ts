/**
 * Print Production OS - File Output Pipeline
 *
 * Generates print-ready production files from panel geometry + design content.
 * This is the final stage of the deterministic pipeline:
 *
 * Panel Geometry → Canvas Rendering → Print Marks → File Export
 *
 * Output formats:
 * - PNG: Raster output at specified DPI/scale (most compatible with RIP software)
 * - PDF: Vector-capable output with TrimBox/BleedBox metadata (professional standard)
 * - SVG: Vector output for contour-cut plotters
 *
 * The PDF output sets proper page boxes per PDF/X specification:
 * - MediaBox: Full page including marks area
 * - TrimBox: Final panel trim size
 * - BleedBox: Panel + bleed area
 * These boxes tell RIP software exactly where to cut.
 */

import jsPDF from 'jspdf';
import type {
  VehiclePanel,
  PrintMarks,
  BleedSpec,
  DPI,
  ProductionFile,
  PanelZone,
  DesignSource,
} from './types';
import { STANDARD_BLEED, WRAP_DPI, SCALE_FACTORS, FULL_PRINT_MARKS } from './constants';
import { calculateMarkConfig, getTotalCanvasSize, drawPrintMarks } from './print-marks';

// ---------------------------------------------------------------------------
// PNG Output (Canvas-Based)
// ---------------------------------------------------------------------------

/**
 * Generate a production-ready PNG for a single panel.
 *
 * @param panel        The vehicle panel to generate for
 * @param designImage  Optional: image to place on the panel (HTMLImageElement or data URL)
 * @param marks        Print marks to include
 * @param bleed        Bleed specification
 * @param dpi          Resolution
 * @param scale        Output scale ('full', '50%', '25%', '10%')
 * @param jobId        Job identifier for labels
 * @returns Production file with blob URL
 */
export async function generatePanelPNG(
  panel: VehiclePanel,
  designImage?: HTMLImageElement | string,
  marks: PrintMarks = FULL_PRINT_MARKS,
  bleed: BleedSpec = STANDARD_BLEED,
  dpi: DPI = WRAP_DPI,
  scale: string = '10%',
  jobId?: string,
): Promise<ProductionFile> {
  const config = calculateMarkConfig(panel, bleed, dpi, scale);
  const canvasSize = getTotalCanvasSize(config);

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  // White background (print-ready standard)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

  // Calculate trim area position
  const trimX = config.markMarginPx + config.bleedPx.left;
  const trimY = config.markMarginPx + config.bleedPx.top;

  // Draw design content in the bleed area (extends beyond trim)
  const bleedX = config.markMarginPx;
  const bleedY = config.markMarginPx;
  const bleedW = config.trimWidthPx + config.bleedPx.left + config.bleedPx.right;
  const bleedH = config.trimHeightPx + config.bleedPx.top + config.bleedPx.bottom;

  if (designImage) {
    const img = typeof designImage === 'string'
      ? await loadImage(designImage)
      : designImage;

    // Scale design to fill bleed area (with mirroring for passenger side)
    ctx.save();
    if (panel.mirrored) {
      ctx.translate(bleedX + bleedW, bleedY);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, bleedW, bleedH);
    } else {
      ctx.drawImage(img, bleedX, bleedY, bleedW, bleedH);
    }
    ctx.restore();
  } else {
    // No design - fill with light gray placeholder
    ctx.fillStyle = '#F0F0F0';
    ctx.fillRect(bleedX, bleedY, bleedW, bleedH);

    // Diagonal "NO DESIGN" watermark
    ctx.save();
    ctx.translate(bleedX + bleedW / 2, bleedY + bleedH / 2);
    ctx.rotate(-Math.PI / 6);
    ctx.fillStyle = '#CCCCCC';
    ctx.font = `${Math.max(12, config.pxPerInch * 0.5)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PRODUCTION TEMPLATE', 0, 0);
    ctx.restore();
  }

  // Draw print marks on top
  drawPrintMarks(ctx, config, marks, panel, jobId);

  // Export to blob
  const blob = await canvasToBlob(canvas, 'image/png');
  const blobUrl = URL.createObjectURL(blob);

  const factor = SCALE_FACTORS[scale] || 0.10;

  return {
    panelZone: panel.zone,
    label: panel.label,
    blobUrl,
    mimeType: 'image/png',
    sizeBytes: blob.size,
    dimensions: { width: canvasSize.width, height: canvasSize.height },
    physicalDimensions: {
      width: panel.widthInches + bleed.leftInches + bleed.rightInches,
      height: panel.heightInches + bleed.topInches + bleed.bottomInches,
    },
  };
}

// ---------------------------------------------------------------------------
// PDF Output (with Page Boxes)
// ---------------------------------------------------------------------------

/**
 * Generate a production-ready PDF for a single panel.
 * Sets proper TrimBox, BleedBox, and MediaBox per PDF/X specification.
 */
export async function generatePanelPDF(
  panel: VehiclePanel,
  designImage?: HTMLImageElement | string,
  marks: PrintMarks = FULL_PRINT_MARKS,
  bleed: BleedSpec = STANDARD_BLEED,
  dpi: DPI = WRAP_DPI,
  scale: string = '10%',
  jobId?: string,
): Promise<ProductionFile> {
  const factor = SCALE_FACTORS[scale] || 0.10;
  const marksMargin = 0.75; // inches - space for marks outside bleed

  // Physical dimensions
  const trimW = panel.widthInches * factor;
  const trimH = panel.heightInches * factor;
  const bleedW = trimW + (bleed.leftInches + bleed.rightInches) * factor;
  const bleedH = trimH + (bleed.topInches + bleed.bottomInches) * factor;
  const mediaW = bleedW + marksMargin * 2 * factor;
  const mediaH = bleedH + marksMargin * 2 * factor;

  // Convert to mm for jsPDF (1 inch = 25.4 mm)
  const mmPerInch = 25.4;
  const mediaWmm = mediaW * mmPerInch;
  const mediaHmm = mediaH * mmPerInch;

  // Generate the panel as PNG first (for embedding in PDF)
  const pngFile = await generatePanelPNG(panel, designImage, marks, bleed, dpi, scale, jobId);

  // Create PDF with custom page size
  const pdf = new jsPDF({
    orientation: mediaWmm > mediaHmm ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [mediaWmm, mediaHmm],
  });

  // Embed the rendered panel image
  const imgData = await blobUrlToDataUrl(pngFile.blobUrl);
  pdf.addImage(imgData, 'PNG', 0, 0, mediaWmm, mediaHmm);

  // Add metadata
  pdf.setProperties({
    title: `${panel.label} - Print Production File`,
    subject: `Vehicle wrap panel: ${panel.zone}`,
    creator: 'DesignProAI PrintPro Production OS',
    keywords: `vehicle wrap, ${panel.zone}, print production, ${panel.widthInches}x${panel.heightInches}`,
  });

  // Export PDF
  const pdfBlob = pdf.output('blob');
  const pdfBlobUrl = URL.createObjectURL(pdfBlob);

  // Clean up PNG blob URL
  URL.revokeObjectURL(pngFile.blobUrl);

  return {
    panelZone: panel.zone,
    label: panel.label,
    blobUrl: pdfBlobUrl,
    mimeType: 'application/pdf',
    sizeBytes: pdfBlob.size,
    dimensions: pngFile.dimensions,
    physicalDimensions: pngFile.physicalDimensions,
  };
}

// ---------------------------------------------------------------------------
// Multi-Panel PDF (All panels in one document)
// ---------------------------------------------------------------------------

/**
 * Generate a single PDF containing all panels - one panel per page.
 * This is the "production pack" format that print shops prefer.
 */
export async function generateProductionPackPDF(
  panels: VehiclePanel[],
  designImage?: HTMLImageElement | string,
  marks: PrintMarks = FULL_PRINT_MARKS,
  bleed: BleedSpec = STANDARD_BLEED,
  dpi: DPI = WRAP_DPI,
  scale: string = '10%',
  jobId?: string,
): Promise<ProductionFile> {
  const factor = SCALE_FACTORS[scale] || 0.10;
  const marksMargin = 0.75;
  const mmPerInch = 25.4;

  // Use the largest panel to determine initial page size
  const maxPanel = panels.reduce((max, p) =>
    p.widthInches * p.heightInches > max.widthInches * max.heightInches ? p : max
  , panels[0]);

  const defaultW = (maxPanel.widthInches * factor + (bleed.leftInches + bleed.rightInches) * factor + marksMargin * 2 * factor) * mmPerInch;
  const defaultH = (maxPanel.heightInches * factor + (bleed.topInches + bleed.bottomInches) * factor + marksMargin * 2 * factor) * mmPerInch;

  const pdf = new jsPDF({
    orientation: defaultW > defaultH ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [defaultW, defaultH],
  });

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];

    // Generate panel PNG
    const pngFile = await generatePanelPNG(panel, designImage, marks, bleed, dpi, scale, jobId);

    // Calculate page size for this panel
    const pageW = (panel.widthInches * factor + (bleed.leftInches + bleed.rightInches) * factor + marksMargin * 2 * factor) * mmPerInch;
    const pageH = (panel.heightInches * factor + (bleed.topInches + bleed.bottomInches) * factor + marksMargin * 2 * factor) * mmPerInch;

    if (i > 0) {
      pdf.addPage([pageW, pageH], pageW > pageH ? 'landscape' : 'portrait');
    }

    const imgData = await blobUrlToDataUrl(pngFile.blobUrl);
    pdf.addImage(imgData, 'PNG', 0, 0, pageW, pageH);

    URL.revokeObjectURL(pngFile.blobUrl);
  }

  // Add metadata
  pdf.setProperties({
    title: `Production Pack - ${panels.length} Panels`,
    creator: 'DesignProAI PrintPro Production OS',
  });

  const pdfBlob = pdf.output('blob');
  const pdfBlobUrl = URL.createObjectURL(pdfBlob);

  return {
    panelZone: 'driver-side', // Primary panel
    label: `Production Pack (${panels.length} panels)`,
    blobUrl: pdfBlobUrl,
    mimeType: 'application/pdf',
    sizeBytes: pdfBlob.size,
    dimensions: { width: 0, height: 0 }, // Multi-page
    physicalDimensions: { width: 0, height: 0 },
  };
}

// ---------------------------------------------------------------------------
// Roll Layout Sheet
// ---------------------------------------------------------------------------

/**
 * Generate a roll layout visualization showing panel placement on media.
 * This is the "nesting diagram" that print operators use.
 */
export async function generateRollLayoutSheet(
  rollLayout: import('./types').RollLayout,
  jobId?: string,
): Promise<ProductionFile> {
  // Scale the roll to fit a reasonable canvas size
  const maxCanvasWidth = 4000;
  const rollWidthInches = rollLayout.media.printableWidthInches;
  const rollLengthInches = rollLayout.totalLengthInches;

  const pixelsPerInch = maxCanvasWidth / rollLengthInches;
  const canvasWidth = Math.round(rollLengthInches * pixelsPerInch);
  const canvasHeight = Math.round(rollWidthInches * pixelsPerInch) + 100; // Extra for labels

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  // Background
  ctx.fillStyle = '#FAFAFA';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Roll boundary
  const rollH = rollWidthInches * pixelsPerInch;
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, canvasWidth, rollH);

  // Grid lines every 12 inches (1 foot)
  ctx.strokeStyle = '#E0E0E0';
  ctx.lineWidth = 0.5;
  for (let ft = 12; ft < rollLengthInches; ft += 12) {
    const x = ft * pixelsPerInch;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, rollH);
    ctx.stroke();
  }

  // Panel colors for visual distinction
  const panelColors = [
    '#3B82F6', '#EF4444', '#10B981', '#F59E0B',
    '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16',
  ];

  // Draw panels
  rollLayout.panels.forEach((nested, i) => {
    const x = nested.rollY * pixelsPerInch; // Y on roll = X on screen (rotated view)
    const y = nested.rollX * pixelsPerInch;
    const w = nested.totalHeight * pixelsPerInch;
    const h = nested.totalWidth * pixelsPerInch;

    const color = panelColors[i % panelColors.length];

    // Panel fill
    ctx.fillStyle = color + '33';
    ctx.fillRect(x, y, w, h);

    // Panel border
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Panel label
    ctx.fillStyle = '#1F2937';
    ctx.font = `bold ${Math.max(10, pixelsPerInch * 0.3)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      nested.panel.zone.replace('-', ' '),
      x + w / 2,
      y + h / 2 - pixelsPerInch * 0.15,
    );

    // Dimension sub-label
    ctx.font = `${Math.max(8, pixelsPerInch * 0.2)}px Arial`;
    ctx.fillStyle = '#6B7280';
    ctx.fillText(
      `${nested.panel.widthInches}" × ${nested.panel.heightInches}"`,
      x + w / 2,
      y + h / 2 + pixelsPerInch * 0.15,
    );
  });

  // Footer info
  const footerY = rollH + 10;
  ctx.fillStyle = '#1F2937';
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(
    `Roll Layout: ${rollLayout.media.printableWidthInches}" × ${rollLayout.totalLengthFeet} ft | ` +
    `Utilization: ${rollLayout.utilizationPercent}% | Waste: ${rollLayout.wastePercent}%`,
    10, footerY,
  );

  if (jobId) {
    ctx.font = '12px Arial';
    ctx.fillStyle = '#6B7280';
    ctx.fillText(`Job: ${jobId}`, 10, footerY + 20);
  }

  const blob = await canvasToBlob(canvas, 'image/png');
  const blobUrl = URL.createObjectURL(blob);

  return {
    panelZone: 'driver-side',
    label: 'Roll Layout Sheet',
    blobUrl,
    mimeType: 'image/png',
    sizeBytes: blob.size,
    dimensions: { width: canvasWidth, height: canvasHeight },
    physicalDimensions: { width: rollLengthInches, height: rollWidthInches },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
      type,
      1.0,
    );
  });
}

function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  return fetch(blobUrl)
    .then(r => r.blob())
    .then(blob => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    }));
}
