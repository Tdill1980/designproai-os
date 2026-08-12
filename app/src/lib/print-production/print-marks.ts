/**
 * Print Production OS - Print Marks Renderer
 *
 * Draws industry-standard print marks onto canvas or SVG:
 * - Crop marks (L-shaped corner indicators for trim lines)
 * - Registration marks (crosshair targets for multi-pass alignment)
 * - Color bars (CMYK verification strips)
 * - Panel labels (zone name, dimensions, job ID)
 * - Fold marks (dashed lines for wrap-around edges)
 *
 * These marks are what RIP software reads to know where to cut,
 * and what installers use to verify alignment.
 *
 * All drawing is done on HTML5 Canvas for client-side generation.
 * Coordinates are in pixels (pre-scaled).
 */

import type { BleedSpec, PrintMarks, VehiclePanel, DPI } from './types';
import {
  CROP_MARK_LENGTH,
  CROP_MARK_OFFSET,
  CROP_MARK_WEIGHT_PT,
  REGISTRATION_MARK_DIAMETER,
  COLOR_BAR_HEIGHT,
  SCALE_FACTORS,
} from './constants';

// ---------------------------------------------------------------------------
// Mark Drawing Configuration
// ---------------------------------------------------------------------------

interface MarkConfig {
  /** Panel width in pixels (trim area) */
  trimWidthPx: number;
  /** Panel height in pixels (trim area) */
  trimHeightPx: number;
  /** Bleed in pixels */
  bleedPx: { top: number; bottom: number; left: number; right: number };
  /** Extra margin for marks area outside bleed */
  markMarginPx: number;
  /** Scale factor (pixels per inch) */
  pxPerInch: number;
}

/**
 * Calculate mark configuration from panel specs.
 */
export function calculateMarkConfig(
  panel: VehiclePanel,
  bleed: BleedSpec,
  dpi: DPI,
  scale: string = '10%',
): MarkConfig {
  const factor = SCALE_FACTORS[scale] || 0.10;
  const pxPerInch = factor * dpi;

  return {
    trimWidthPx: Math.round(panel.widthInches * pxPerInch),
    trimHeightPx: Math.round(panel.heightInches * pxPerInch),
    bleedPx: {
      top: Math.round(bleed.topInches * pxPerInch),
      bottom: Math.round(bleed.bottomInches * pxPerInch),
      left: Math.round(bleed.leftInches * pxPerInch),
      right: Math.round(bleed.rightInches * pxPerInch),
    },
    markMarginPx: Math.round(0.75 * pxPerInch), // 0.75" margin for marks
    pxPerInch,
  };
}

/**
 * Get the total canvas size needed for a panel with marks.
 */
export function getTotalCanvasSize(config: MarkConfig): { width: number; height: number } {
  return {
    width: config.trimWidthPx + config.bleedPx.left + config.bleedPx.right + config.markMarginPx * 2,
    height: config.trimHeightPx + config.bleedPx.top + config.bleedPx.bottom + config.markMarginPx * 2,
  };
}

// ---------------------------------------------------------------------------
// Canvas Drawing Functions
// ---------------------------------------------------------------------------

/**
 * Draw all requested print marks onto a canvas context.
 * The design content should already be drawn at the correct position.
 */
export function drawPrintMarks(
  ctx: CanvasRenderingContext2D,
  config: MarkConfig,
  marks: PrintMarks,
  panel: VehiclePanel,
  jobId?: string,
): void {
  // Origin of the trim area (inside bleed + mark margin)
  const trimX = config.markMarginPx + config.bleedPx.left;
  const trimY = config.markMarginPx + config.bleedPx.top;
  const trimW = config.trimWidthPx;
  const trimH = config.trimHeightPx;

  if (marks.cropMarks) {
    drawCropMarks(ctx, trimX, trimY, trimW, trimH, config);
  }

  if (marks.registrationMarks) {
    drawRegistrationMarks(ctx, trimX, trimY, trimW, trimH, config);
  }

  if (marks.colorBars) {
    drawColorBars(ctx, trimX, trimY, trimW, trimH, config);
  }

  if (marks.panelLabels) {
    drawPanelLabel(ctx, trimX, trimY, trimW, trimH, config, panel, jobId);
  }

  if (marks.dimensionLabels) {
    drawDimensionLabels(ctx, trimX, trimY, trimW, trimH, config, panel);
  }

  // Always draw bleed boundary (thin dashed line)
  drawBleedBoundary(ctx, trimX, trimY, trimW, trimH, config);
}

// ---------------------------------------------------------------------------
// Crop Marks
// ---------------------------------------------------------------------------

/**
 * Draw L-shaped crop marks at each corner of the trim area.
 * Industry standard: 0.375" long, 0.125" offset from trim edge, 0.25pt weight.
 */
function drawCropMarks(
  ctx: CanvasRenderingContext2D,
  trimX: number, trimY: number,
  trimW: number, trimH: number,
  config: MarkConfig,
): void {
  const markLen = CROP_MARK_LENGTH * config.pxPerInch;
  const offset = CROP_MARK_OFFSET * config.pxPerInch;
  const weight = Math.max(1, CROP_MARK_WEIGHT_PT * config.pxPerInch / 72);

  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = weight;
  ctx.lineCap = 'butt';

  // Top-left corner
  drawCornerMark(ctx, trimX, trimY, -1, -1, markLen, offset);
  // Top-right corner
  drawCornerMark(ctx, trimX + trimW, trimY, 1, -1, markLen, offset);
  // Bottom-left corner
  drawCornerMark(ctx, trimX, trimY + trimH, -1, 1, markLen, offset);
  // Bottom-right corner
  drawCornerMark(ctx, trimX + trimW, trimY + trimH, 1, 1, markLen, offset);

  ctx.restore();
}

function drawCornerMark(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  dx: number, dy: number,
  len: number, offset: number,
): void {
  // Horizontal line
  ctx.beginPath();
  ctx.moveTo(cx + dx * offset, cy);
  ctx.lineTo(cx + dx * (offset + len), cy);
  ctx.stroke();

  // Vertical line
  ctx.beginPath();
  ctx.moveTo(cx, cy + dy * offset);
  ctx.lineTo(cx, cy + dy * (offset + len));
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Registration Marks
// ---------------------------------------------------------------------------

/**
 * Draw crosshair registration targets at the midpoint of each edge.
 * These are used for multi-pass print alignment (CMYK registration).
 */
function drawRegistrationMarks(
  ctx: CanvasRenderingContext2D,
  trimX: number, trimY: number,
  trimW: number, trimH: number,
  config: MarkConfig,
): void {
  const radius = (REGISTRATION_MARK_DIAMETER / 2) * config.pxPerInch;
  const offset = (CROP_MARK_OFFSET + CROP_MARK_LENGTH + 0.125) * config.pxPerInch;

  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1, 0.5 * config.pxPerInch / 72);

  // Top center
  drawCrosshair(ctx, trimX + trimW / 2, trimY - offset, radius);
  // Bottom center
  drawCrosshair(ctx, trimX + trimW / 2, trimY + trimH + offset, radius);
  // Left center
  drawCrosshair(ctx, trimX - offset, trimY + trimH / 2, radius);
  // Right center
  drawCrosshair(ctx, trimX + trimW + offset, trimY + trimH / 2, radius);

  ctx.restore();
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number,
): void {
  // Outer circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Inner circle (smaller)
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.3, 0, Math.PI * 2);
  ctx.stroke();

  // Crosshair lines
  ctx.beginPath();
  ctx.moveTo(cx - radius * 1.5, cy);
  ctx.lineTo(cx + radius * 1.5, cy);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy - radius * 1.5);
  ctx.lineTo(cx, cy + radius * 1.5);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Color Bars
// ---------------------------------------------------------------------------

/**
 * Draw CMYK color verification bars below the trim area.
 * Print operators use these to verify ink density and registration.
 */
function drawColorBars(
  ctx: CanvasRenderingContext2D,
  trimX: number, trimY: number,
  trimW: number, trimH: number,
  config: MarkConfig,
): void {
  const barHeight = COLOR_BAR_HEIGHT * config.pxPerInch;
  const barY = trimY + trimH + config.bleedPx.bottom + barHeight;
  const barWidth = trimW / 8; // 8 patches

  const colors = [
    '#00FFFF', // Cyan
    '#FF00FF', // Magenta
    '#FFFF00', // Yellow
    '#000000', // Black
    '#FF0000', // Red (M+Y)
    '#00FF00', // Green (C+Y)
    '#0000FF', // Blue (C+M)
    '#808080', // 50% Gray
  ];

  ctx.save();
  colors.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(trimX + i * barWidth, barY, barWidth, barHeight);
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(trimX + i * barWidth, barY, barWidth, barHeight);
  });
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Panel Labels
// ---------------------------------------------------------------------------

/**
 * Draw panel identification label in the mark margin area.
 * Includes: zone name, dimensions, mirrored indicator, job ID.
 */
function drawPanelLabel(
  ctx: CanvasRenderingContext2D,
  trimX: number, trimY: number,
  trimW: number, trimH: number,
  config: MarkConfig,
  panel: VehiclePanel,
  jobId?: string,
): void {
  ctx.save();

  const fontSize = Math.max(8, Math.round(config.pxPerInch * 0.12));
  ctx.font = `${fontSize}px "Courier New", monospace`;
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';

  const labelY = trimY - config.bleedPx.top - fontSize - 4;
  const labelLines = [
    `${panel.label}${panel.mirrored ? ' [MIRRORED]' : ''}`,
    `Trim: ${panel.widthInches}" × ${panel.heightInches}" | Zone: ${panel.zone}`,
  ];
  if (jobId) {
    labelLines.push(`Job: ${jobId} | ${new Date().toISOString().split('T')[0]}`);
  }

  labelLines.forEach((line, i) => {
    ctx.fillText(line, trimX, labelY - (labelLines.length - 1 - i) * (fontSize + 2));
  });

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Dimension Labels
// ---------------------------------------------------------------------------

/**
 * Draw dimension arrows and labels on each edge of the trim area.
 */
function drawDimensionLabels(
  ctx: CanvasRenderingContext2D,
  trimX: number, trimY: number,
  trimW: number, trimH: number,
  config: MarkConfig,
  panel: VehiclePanel,
): void {
  ctx.save();

  const fontSize = Math.max(7, Math.round(config.pxPerInch * 0.10));
  ctx.font = `${fontSize}px "Courier New", monospace`;
  ctx.fillStyle = '#333333';
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = Math.max(0.5, config.pxPerInch / 150);

  // Width label (top edge)
  const widthLabel = `${panel.widthInches}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const topLabelY = trimY - config.bleedPx.top - fontSize * 3 - 4;
  ctx.fillText(widthLabel, trimX + trimW / 2, topLabelY);

  // Draw width dimension line with arrows
  const arrowSize = Math.max(3, fontSize * 0.4);
  const dimLineY = topLabelY + 2;

  ctx.beginPath();
  ctx.moveTo(trimX, dimLineY);
  ctx.lineTo(trimX + trimW, dimLineY);
  ctx.stroke();

  // Left arrow
  drawArrowhead(ctx, trimX, dimLineY, 'left', arrowSize);
  // Right arrow
  drawArrowhead(ctx, trimX + trimW, dimLineY, 'right', arrowSize);

  // Height label (left edge)
  ctx.save();
  ctx.translate(trimX - config.bleedPx.left - fontSize * 2, trimY + trimH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${panel.heightInches}"`, 0, 0);
  ctx.restore();

  ctx.restore();
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  direction: 'left' | 'right',
  size: number,
): void {
  const dx = direction === 'left' ? size : -size;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx, y - size / 2);
  ctx.lineTo(x + dx, y + size / 2);
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Bleed Boundary
// ---------------------------------------------------------------------------

/**
 * Draw a thin dashed line showing the bleed boundary.
 */
function drawBleedBoundary(
  ctx: CanvasRenderingContext2D,
  trimX: number, trimY: number,
  trimW: number, trimH: number,
  config: MarkConfig,
): void {
  const bleedX = trimX - config.bleedPx.left;
  const bleedY = trimY - config.bleedPx.top;
  const bleedW = trimW + config.bleedPx.left + config.bleedPx.right;
  const bleedH = trimH + config.bleedPx.top + config.bleedPx.bottom;

  ctx.save();
  ctx.strokeStyle = '#0088FF';
  ctx.lineWidth = Math.max(0.5, config.pxPerInch / 200);
  ctx.setLineDash([config.pxPerInch * 0.05, config.pxPerInch * 0.05]);
  ctx.strokeRect(bleedX, bleedY, bleedW, bleedH);

  // Trim boundary (solid)
  ctx.strokeStyle = '#FF0000';
  ctx.setLineDash([]);
  ctx.lineWidth = Math.max(0.5, config.pxPerInch / 150);
  ctx.strokeRect(trimX, trimY, trimW, trimH);

  ctx.restore();
}
