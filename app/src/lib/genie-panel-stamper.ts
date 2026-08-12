/**
 * genie-panel-stamper.ts - Canvas-based GENIE panel overlay compositor
 *
 * Takes a render image URL and draws GENIE panel boundaries (cyan rectangles
 * with dimension labels) directly onto the image using Canvas 2D API.
 * Returns a PNG Blob that can be saved/uploaded - the overlay is permanently
 * baked into the image (unlike the CSS-only GlassmorphismPanelOverlay).
 *
 * Usage:
 *   const blob = await stampGenieOverlay(renderUrl, "side", "medium");
 *   // Upload blob to Supabase Storage or trigger download
 */

import {
  SIDE_PANELS,
  ADDON_PANELS,
  type SidePanelSize,
} from "@/lib/panelizer-config";

// ── Panel positioning constants (mirrors GlassmorphismPanelOverlay.tsx) ──
const MAX_BODY_WIDTH_PCT = 92;
const BODY_CENTER_PCT = 50;
const SIDE_TOP_PCT = 18;
const SIDE_HEIGHT_PCT = 56;
const TWO_PANEL_UPPER_TOP_PCT = 16;
const TWO_PANEL_UPPER_HEIGHT_PCT = 26;
const TWO_PANEL_LOWER_TOP_PCT = 46;
const TWO_PANEL_LOWER_HEIGHT_PCT = 28;

interface PanelRect {
  label: string;
  widthInches: number;
  heightInches: number;
  topPct: number;
  leftPct: number;
  widthPct: number;
  heightPct: number;
}

/** Real vehicle dimensions — when present, these override the SIDE_PANELS preset
 *  so the overlay labels match the 2D proof (e.g. Cybertruck 223.7" × 59"
 *  instead of the generic "medium" tier 172" × 59.5"). */
export interface VehicleDims {
  sideW?: number;
  sideH?: number;
  hoodW?: number;
  hoodL?: number;
  roofW?: number;
  roofL?: number;
  backW?: number;
  backH?: number;
  frontBumperW?: number;
  frontBumperH?: number;
  rearBumperW?: number;
  rearBumperH?: number;
}

function getSidePos() {
  return {
    topPct: SIDE_TOP_PCT,
    leftPct: BODY_CENTER_PCT - MAX_BODY_WIDTH_PCT / 2,
    widthPct: MAX_BODY_WIDTH_PCT,
    heightPct: SIDE_HEIGHT_PCT,
  };
}

function getUpperPos() {
  return {
    topPct: TWO_PANEL_UPPER_TOP_PCT,
    leftPct: BODY_CENTER_PCT - MAX_BODY_WIDTH_PCT / 2,
    widthPct: MAX_BODY_WIDTH_PCT,
    heightPct: TWO_PANEL_UPPER_HEIGHT_PCT,
  };
}

function getLowerPos() {
  return {
    topPct: TWO_PANEL_LOWER_TOP_PCT,
    leftPct: BODY_CENTER_PCT - MAX_BODY_WIDTH_PCT / 2,
    widthPct: MAX_BODY_WIDTH_PCT,
    heightPct: TWO_PANEL_LOWER_HEIGHT_PCT,
  };
}

/**
 * Build panel rectangles for a given view type - same logic as
 * GlassmorphismPanelOverlay's getPanelZones but returns raw percentages.
 *
 * When `vehicleDims` is supplied (real dims from the vehicle database),
 * the labels show those dimensions so the 3D overlay matches the 2D proof.
 * Otherwise falls back to SIDE_PANELS tier presets.
 */
function getPanelRects(
  viewType: string,
  sidePanelSize: SidePanelSize = "medium",
  twoPanel = false,
  vehicleDims?: VehicleDims,
): PanelRect[] {
  const side = SIDE_PANELS[sidePanelSize];
  const sideW = vehicleDims?.sideW ?? side.widthInches;
  const sideH = vehicleDims?.sideH ?? side.heightInches;
  const hoodW = vehicleDims?.hoodW ?? ADDON_PANELS.hood.widthInches;
  const hoodL = vehicleDims?.hoodL ?? ADDON_PANELS.hood.heightInches;
  const backW = vehicleDims?.backW ?? ADDON_PANELS.rear.widthInches;
  const backH = vehicleDims?.backH ?? ADDON_PANELS.rear.heightInches;
  const fbumperW = vehicleDims?.frontBumperW ?? ADDON_PANELS.frontBumper.widthInches;
  const fbumperH = vehicleDims?.frontBumperH ?? ADDON_PANELS.frontBumper.heightInches;
  const rbumperW = vehicleDims?.rearBumperW ?? ADDON_PANELS.rearBumper.widthInches;
  const rbumperH = vehicleDims?.rearBumperH ?? ADDON_PANELS.rearBumper.heightInches;

  switch (viewType) {
    case "side":
    case "driver-side":
      if (twoPanel) {
        return [
          { label: "Driver Upper", widthInches: sideW, heightInches: sideH, ...getUpperPos() },
          { label: "Driver Lower", widthInches: sideW, heightInches: sideH, ...getLowerPos() },
        ];
      }
      return [{ label: "Driver Side", widthInches: sideW, heightInches: sideH, ...getSidePos() }];

    case "passenger-side":
      if (twoPanel) {
        return [
          { label: "Passenger Upper", widthInches: sideW, heightInches: sideH, ...getUpperPos() },
          { label: "Passenger Lower", widthInches: sideW, heightInches: sideH, ...getLowerPos() },
        ];
      }
      return [{ label: "Passenger Side", widthInches: sideW, heightInches: sideH, ...getSidePos() }];

    case "hood_detail":
      return [{
        label: "Hood",
        widthInches: hoodW,
        heightInches: hoodL,
        topPct: 8, leftPct: 8, widthPct: 84, heightPct: 84,
      }];

    case "front":
      return [
        { label: "Hood (Front)", widthInches: hoodW, heightInches: hoodL, topPct: 6, leftPct: 15, widthPct: 70, heightPct: 42 },
        { label: "Front Bumper", widthInches: fbumperW, heightInches: fbumperH, topPct: 52, leftPct: 10, widthPct: 80, heightPct: 40 },
      ];

    case "rear":
      return [
        { label: "Rear / Trunk", widthInches: backW, heightInches: backH, topPct: 6, leftPct: 12, widthPct: 76, heightPct: 48 },
        { label: "Rear Bumper", widthInches: rbumperW, heightInches: rbumperH, topPct: 58, leftPct: 10, widthPct: 80, heightPct: 34 },
      ];

    case "close-up":
      return [{
        label: "Detail Panel",
        widthInches: sideW,
        heightInches: sideH,
        topPct: 8, leftPct: 8, widthPct: 84, heightPct: 84,
      }];

    default:
      return [{ label: "Driver Side", widthInches: sideW, heightInches: sideH, ...getSidePos() }];
  }
}

/**
 * Load an image from URL into an HTMLImageElement.
 * Uses crossOrigin="anonymous" so canvas.toBlob() works.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Draw GENIE panel overlay onto a render image and return a PNG Blob.
 *
 * @param renderUrl - URL of the 3D render image
 * @param viewType - View angle ("side", "hood_detail", "front", etc.)
 * @param sidePanelSize - Panel size tier for side panels
 * @param twoPanel - Whether vehicle needs two-panel split
 * @returns PNG Blob with panels baked in
 */
export async function stampGenieOverlay(
  renderUrl: string,
  viewType: string,
  sidePanelSize: SidePanelSize = "medium",
  twoPanel = false,
  vehicleDims?: VehicleDims,
): Promise<Blob> {
  const img = await loadImage(renderUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Draw the render image
  ctx.drawImage(img, 0, 0, w, h);

  // Get panel rectangles for this view — uses real vehicle dims when available
  // so labels match the 2D proof (e.g. "Driver Side - 224" × 56"" not the
  // generic preset "Driver Side - 172" × 59.5"").
  const panels = getPanelRects(viewType, sidePanelSize, twoPanel, vehicleDims);

  // Draw each panel zone
  const CYAN = "rgba(0, 200, 255, 0.85)";
  const CYAN_FILL = "rgba(0, 200, 255, 0.08)";

  for (const panel of panels) {
    const x = (panel.leftPct / 100) * w;
    const y = (panel.topPct / 100) * h;
    const pw = (panel.widthPct / 100) * w;
    const ph = (panel.heightPct / 100) * h;

    // Fill with very subtle cyan tint
    ctx.fillStyle = CYAN_FILL;
    ctx.fillRect(x, y, pw, ph);

    // Draw cyan border (2px scaled)
    const borderWidth = Math.max(2, Math.round(w / 500));
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(x, y, pw, ph);

    // Draw corner brackets for visual emphasis
    const bracketLen = Math.min(pw, ph) * 0.08;
    ctx.lineWidth = borderWidth + 1;
    ctx.strokeStyle = CYAN;
    // Top-left
    ctx.beginPath();
    ctx.moveTo(x, y + bracketLen); ctx.lineTo(x, y); ctx.lineTo(x + bracketLen, y);
    ctx.stroke();
    // Top-right
    ctx.beginPath();
    ctx.moveTo(x + pw - bracketLen, y); ctx.lineTo(x + pw, y); ctx.lineTo(x + pw, y + bracketLen);
    ctx.stroke();
    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(x, y + ph - bracketLen); ctx.lineTo(x, y + ph); ctx.lineTo(x + bracketLen, y + ph);
    ctx.stroke();
    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(x + pw - bracketLen, y + ph); ctx.lineTo(x + pw, y + ph); ctx.lineTo(x + pw, y + ph - bracketLen);
    ctx.stroke();

    // Draw label with dimensions
    const fontSize = Math.max(11, Math.round(w / 80));
    const dimText = `${panel.widthInches}" × ${panel.heightInches}"`;
    const labelText = `${panel.label} - ${dimText}`;

    // Label background pill
    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    const textWidth = ctx.measureText(labelText).width;
    const pillPadX = fontSize * 0.6;
    const pillPadY = fontSize * 0.35;
    const pillX = x + 6;
    const pillY = y + ph - fontSize - pillPadY * 2 - 6;
    const pillW = textWidth + pillPadX * 2;
    const pillH = fontSize + pillPadY * 2;

    ctx.fillStyle = "rgba(0, 200, 255, 0.9)";
    ctx.beginPath();
    const r = 4;
    ctx.moveTo(pillX + r, pillY);
    ctx.lineTo(pillX + pillW - r, pillY);
    ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + r);
    ctx.lineTo(pillX + pillW, pillY + pillH - r);
    ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - r, pillY + pillH);
    ctx.lineTo(pillX + r, pillY + pillH);
    ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - r);
    ctx.lineTo(pillX, pillY + r);
    ctx.quadraticCurveTo(pillX, pillY, pillX + r, pillY);
    ctx.fill();

    // Label text
    ctx.fillStyle = "#000";
    ctx.fillText(labelText, pillX + pillPadX, pillY + pillPadY + fontSize * 0.85);

    // "GENIE" badge in top-left of panel
    const badgeFontSize = Math.max(9, Math.round(w / 110));
    ctx.font = `bold ${badgeFontSize}px Inter, sans-serif`;
    const badgeText = "GENIE";
    const badgeW = ctx.measureText(badgeText).width + badgeFontSize;
    const badgeH = badgeFontSize + 6;
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(x + 6, y + 6, badgeW, badgeH);
    ctx.fillStyle = "#00C8FF";
    ctx.fillText(badgeText, x + 6 + badgeFontSize * 0.5, y + 6 + badgeFontSize + 1);
  }

  // Convert canvas to blob
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Canvas toBlob failed")),
      "image/png",
      1.0,
    );
  });
}

/**
 * Stamp GENIE overlay and trigger browser download.
 */
export async function downloadGenieOverlay(
  renderUrl: string,
  viewType: string,
  fileName: string,
  sidePanelSize: SidePanelSize = "medium",
  twoPanel = false,
  vehicleDims?: VehicleDims,
): Promise<void> {
  const blob = await stampGenieOverlay(renderUrl, viewType, sidePanelSize, twoPanel, vehicleDims);
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
}

/**
 * Stamp GENIE overlay and upload to Supabase Storage.
 * Returns the public URL of the uploaded composite image.
 */
export async function stampAndUploadGenieOverlay(
  supabase: any,
  renderUrl: string,
  viewType: string,
  storagePath: string,
  sidePanelSize: SidePanelSize = "medium",
  twoPanel = false,
  vehicleDims?: VehicleDims,
): Promise<string> {
  const blob = await stampGenieOverlay(renderUrl, viewType, sidePanelSize, twoPanel, vehicleDims);
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const { error } = await supabase.storage
    .from("wrap-files")
    .upload(storagePath, bytes, { contentType: "image/png", upsert: true });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data: { publicUrl } } = supabase.storage
    .from("wrap-files")
    .getPublicUrl(storagePath);

  return publicUrl;
}
