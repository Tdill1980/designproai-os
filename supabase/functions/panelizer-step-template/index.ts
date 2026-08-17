/**
 * ─────────────────────────────────────────────────────────────
 *  GENIE™ Universal Panelizer
 *  Part of the LiftIQ Engine™ / Prompt-to-Production™ architecture.
 *
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *  Proprietary & confidential. Contains trade-secret methods
 *  (layer-separated generative render & panel synthesis).
 *  Trademarks: GENIE™, DesignIQ™, LiftIQ™ — see /NOTICE and
 *  docs/TRADEMARKS.md. Not legal advice.
 * ─────────────────────────────────────────────────────────────
 */
/**
 * panelizer-step-template — Step 2.5: Canvas Template Generator
 *
 * Input:  { panels, userId, jobId, vehicle }
 * Output: { canvases: { [panelKey]: storagePath }, overviewPath }
 *
 * Programmatically generates black canvas images at exact panel dimensions.
 * Each canvas serves as a visual target for Gemini — "fill this rectangle."
 * Also builds a composite overview showing all panels in a labeled grid.
 *
 * No AI — pure math + imagescript pixel drawing.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { uploadToStorage, uint8ArrayToBase64 } from "../_shared/panelizer-os/storage.ts";
import { tempPath } from "../_shared/panelizer-os/constants.ts";

// Canvas resolution: longest side normalized to this value.
// Use 2048 to encourage Gemini to produce larger output images.
const CANVAS_MAX_PX = 2048;
// Composite overview width
const OVERVIEW_WIDTH = 2048;
// Layout spacing in the composite
const OVERVIEW_PAD = 16;
const OVERVIEW_ROW_GAP = 24;
const OVERVIEW_BG = 0x222222FF;    // Dark gray background
const LABEL_COLOR = 0xFFFFFFFF;    // White text
const BORDER_COLOR = 0xFFFFFF99;   // Semi-transparent white border
const CROSSHAIR_COLOR = 0xFFFFFF44; // Faint white crosshair

interface PanelInput {
  panelKey: string;
  panelType: string;
  label: string;
  widthInches: number;
  heightInches: number;
  mirrored: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { panels, userId, jobId, vehicle } = await req.json();

    if (!panels || !userId || !jobId) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[TEMPLATE] Job ${jobId} — generating canvas templates for ${panels.length} panels`);
    const startMs = Date.now();

    const panelList: PanelInput[] = panels;
    // Only generate canvases for non-mirrored panels (mirrored = flipped copy of driver side)
    const uniquePanels = panelList.filter((p) => !p.mirrored);

    const canvases: Record<string, string> = {};

    // ── Generate individual black canvases per panel ─────────────
    for (const panel of uniquePanels) {
      const { w, h } = canvasDimensions(panel.widthInches, panel.heightInches);
      console.log(`[TEMPLATE] ${panel.panelKey}: ${panel.widthInches}"x${panel.heightInches}" → ${w}x${h}px canvas`);

      const canvas = new Image(w, h);
      canvas.fill(0x000000FF); // Solid black

      // Draw thin dashed white border inset 4px from edges
      drawDashedBorder(canvas, 4, BORDER_COLOR, 2);

      // Draw center crosshair (faint, shows "fill me" visual cue)
      drawCrosshair(canvas, CROSSHAIR_COLOR);

      // Encode and upload
      const canvasBytes = await canvas.encode();
      const storagePath = tempPath(userId, jobId, `step-template-${panel.panelKey}`);
      await uploadToStorage(storagePath, canvasBytes, "image/png");
      canvases[panel.panelKey] = storagePath;

      console.log(`[TEMPLATE] ${panel.panelKey}: ${(canvasBytes.byteLength / 1024).toFixed(0)} KB`);
    }

    // ── Generate composite overview ──────────────────────────────
    const overviewPath = await buildCompositeOverview(uniquePanels, userId, jobId, vehicle || "Vehicle");

    const totalMs = Date.now() - startMs;
    console.log(`[TEMPLATE] Done: ${Object.keys(canvases).length} canvases + overview in ${totalMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        canvases,
        overviewPath,
        panelCount: Object.keys(canvases).length,
        step: "template",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[TEMPLATE] Error:", err);
    return new Response(
      JSON.stringify({ error: `Template step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ── Canvas dimension calculator ──────────────────────────────────

function canvasDimensions(widthInches: number, heightInches: number): { w: number; h: number } {
  const ratio = widthInches / heightInches;
  if (ratio >= 1) {
    return { w: CANVAS_MAX_PX, h: Math.round(CANVAS_MAX_PX / ratio) };
  }
  return { w: Math.round(CANVAS_MAX_PX * ratio), h: CANVAS_MAX_PX };
}

// ── Draw a dashed border inset from edges ────────────────────────

function drawDashedBorder(img: Image, inset: number, color: number, thickness: number) {
  const w = img.width;
  const h = img.height;
  const dashLen = 8;
  const gapLen = 6;

  // Top and bottom edges
  for (let x = inset; x < w - inset; x++) {
    const inDash = Math.floor((x - inset) / (dashLen + gapLen)) % 1 === 0
      && ((x - inset) % (dashLen + gapLen)) < dashLen;
    if (!inDash) continue;
    for (let t = 0; t < thickness; t++) {
      const topY = inset + t + 1;
      const botY = h - inset - t;
      if (topY >= 1 && topY <= h) img.setPixelAt(x + 1, topY, color);
      if (botY >= 1 && botY <= h) img.setPixelAt(x + 1, botY, color);
    }
  }

  // Left and right edges
  for (let y = inset; y < h - inset; y++) {
    const inDash = Math.floor((y - inset) / (dashLen + gapLen)) % 1 === 0
      && ((y - inset) % (dashLen + gapLen)) < dashLen;
    if (!inDash) continue;
    for (let t = 0; t < thickness; t++) {
      const leftX = inset + t + 1;
      const rightX = w - inset - t;
      if (leftX >= 1 && leftX <= w) img.setPixelAt(leftX, y + 1, color);
      if (rightX >= 1 && rightX <= w) img.setPixelAt(rightX, y + 1, color);
    }
  }
}

// ── Draw center crosshair ────────────────────────────────────────

function drawCrosshair(img: Image, color: number) {
  const cx = Math.round(img.width / 2);
  const cy = Math.round(img.height / 2);
  const armLen = Math.min(40, Math.round(Math.min(img.width, img.height) * 0.08));

  // Horizontal arm
  for (let x = cx - armLen; x <= cx + armLen; x++) {
    if (x >= 1 && x <= img.width && cy >= 1 && cy <= img.height) {
      img.setPixelAt(x, cy, color);
    }
  }
  // Vertical arm
  for (let y = cy - armLen; y <= cy + armLen; y++) {
    if (cx >= 1 && cx <= img.width && y >= 1 && y <= img.height) {
      img.setPixelAt(cx, y, color);
    }
  }
}

// ── Composite overview builder ───────────────────────────────────
// Arranges all panels in a labeled grid showing the full vehicle layout.
// Row 1: Side panel(s)
// Row 2: Hood + Roof + Rear
// Row 3: Front Bumper + Rear Bumper

async function buildCompositeOverview(
  panels: PanelInput[],
  userId: string,
  jobId: string,
  vehicle: string,
): Promise<string> {
  // Group panels by type
  const sides = panels.filter((p) => p.panelType === "side");
  const addons = panels.filter((p) => ["addon", "roof"].includes(p.panelType));

  // Separate addons into rows: hood/roof/rear in row 2, bumpers in row 3
  const row2Panels = addons.filter((p) => ["hood", "roof", "rear"].includes(p.panelKey));
  const row3Panels = addons.filter((p) => p.panelKey.includes("bumper"));

  // Build rows with scaled dimensions
  const rows: { panels: { panel: PanelInput; scaledW: number; scaledH: number }[]; rowH: number }[] = [];

  // Row 1: Side panels
  if (sides.length > 0) {
    const rowPanels = sides.map((p) => {
      const scale = (OVERVIEW_WIDTH - OVERVIEW_PAD * 2) / p.widthInches;
      return { panel: p, scaledW: Math.round(p.widthInches * scale), scaledH: Math.round(p.heightInches * scale) };
    });
    rows.push({ panels: rowPanels, rowH: Math.max(...rowPanels.map((r) => r.scaledH)) });
  }

  // Row 2: Hood + Roof + Rear
  if (row2Panels.length > 0) {
    const totalW = row2Panels.reduce((s, p) => s + p.widthInches, 0);
    const availW = OVERVIEW_WIDTH - OVERVIEW_PAD * 2 - (row2Panels.length - 1) * OVERVIEW_PAD;
    const scale = availW / totalW;
    const rowPanels = row2Panels.map((p) => ({
      panel: p,
      scaledW: Math.round(p.widthInches * scale),
      scaledH: Math.round(p.heightInches * scale),
    }));
    rows.push({ panels: rowPanels, rowH: Math.max(...rowPanels.map((r) => r.scaledH)) });
  }

  // Row 3: Bumpers
  if (row3Panels.length > 0) {
    const totalW = row3Panels.reduce((s, p) => s + p.widthInches, 0);
    const availW = OVERVIEW_WIDTH - OVERVIEW_PAD * 2 - (row3Panels.length - 1) * OVERVIEW_PAD;
    const scale = availW / totalW;
    const rowPanels = row3Panels.map((p) => ({
      panel: p,
      scaledW: Math.round(p.widthInches * scale),
      scaledH: Math.round(p.heightInches * scale),
    }));
    rows.push({ panels: rowPanels, rowH: Math.max(...rowPanels.map((r) => r.scaledH)) });
  }

  // Calculate total height
  const titleHeight = 20;
  const totalH = titleHeight + OVERVIEW_PAD
    + rows.reduce((s, r) => s + r.rowH + OVERVIEW_ROW_GAP, 0)
    + OVERVIEW_PAD;

  // Create composite image
  const overview = new Image(OVERVIEW_WIDTH, Math.max(100, totalH));
  overview.fill(OVERVIEW_BG);

  // Draw title
  drawText(overview, OVERVIEW_PAD, 8, `${vehicle.toUpperCase()} - PANEL LAYOUT`, LABEL_COLOR);

  // Draw each row
  let curY = titleHeight + OVERVIEW_PAD;
  for (const row of rows) {
    let curX = OVERVIEW_PAD;
    for (const { panel, scaledW, scaledH } of row.panels) {
      // Draw black panel rectangle
      fillRect(overview, curX, curY, scaledW, scaledH, 0x000000FF);

      // Draw white outline
      drawRectOutline(overview, curX, curY, scaledW, scaledH, LABEL_COLOR, 1);

      // Draw label centered at top of panel
      const labelText = `${panel.label.toUpperCase()} ${panel.widthInches}"x${panel.heightInches}"`;
      const textX = curX + Math.max(2, Math.round((scaledW - labelText.length * 5) / 2));
      const textY = curY + Math.max(4, Math.round(scaledH / 2) - 3);
      drawText(overview, textX, textY, labelText, LABEL_COLOR);

      curX += scaledW + OVERVIEW_PAD;
    }
    curY += row.rowH + OVERVIEW_ROW_GAP;
  }

  // Encode and upload
  const overviewBytes = await overview.encode();
  const storagePath = tempPath(userId, jobId, "step-template-overview");
  await uploadToStorage(storagePath, overviewBytes, "image/png");

  console.log(`[TEMPLATE] Composite overview: ${OVERVIEW_WIDTH}x${totalH}px (${(overviewBytes.byteLength / 1024).toFixed(0)} KB)`);
  return storagePath;
}

// ── Drawing helpers ──────────────────────────────────────────────

function fillRect(img: Image, x: number, y: number, w: number, h: number, color: number) {
  for (let py = y; py < y + h && py < img.height; py++) {
    for (let px = x; px < x + w && px < img.width; px++) {
      if (px >= 0 && py >= 0) {
        img.setPixelAt(px + 1, py + 1, color);
      }
    }
  }
}

function drawRectOutline(img: Image, x: number, y: number, w: number, h: number, color: number, thickness: number) {
  for (let t = 0; t < thickness; t++) {
    // Top & bottom
    for (let px = x; px < x + w; px++) {
      const topY = y + t;
      const botY = y + h - 1 - t;
      if (px >= 0 && px < img.width) {
        if (topY >= 0 && topY < img.height) img.setPixelAt(px + 1, topY + 1, color);
        if (botY >= 0 && botY < img.height) img.setPixelAt(px + 1, botY + 1, color);
      }
    }
    // Left & right
    for (let py = y; py < y + h; py++) {
      const leftX = x + t;
      const rightX = x + w - 1 - t;
      if (py >= 0 && py < img.height) {
        if (leftX >= 0 && leftX < img.width) img.setPixelAt(leftX + 1, py + 1, color);
        if (rightX >= 0 && rightX < img.width) img.setPixelAt(rightX + 1, py + 1, color);
      }
    }
  }
}

// ── Simple 4x5 bitmap font (same as cropmarks step) ─────────────

const FONT_4X5: Record<string, number[]> = {
  A: [0b0110,0b1001,0b1111,0b1001,0b1001],
  B: [0b1110,0b1001,0b1110,0b1001,0b1110],
  C: [0b0111,0b1000,0b1000,0b1000,0b0111],
  D: [0b1110,0b1001,0b1001,0b1001,0b1110],
  E: [0b1111,0b1000,0b1110,0b1000,0b1111],
  F: [0b1111,0b1000,0b1110,0b1000,0b1000],
  G: [0b0111,0b1000,0b1011,0b1001,0b0111],
  H: [0b1001,0b1001,0b1111,0b1001,0b1001],
  I: [0b1110,0b0100,0b0100,0b0100,0b1110],
  J: [0b0001,0b0001,0b0001,0b1001,0b0110],
  K: [0b1001,0b1010,0b1100,0b1010,0b1001],
  L: [0b1000,0b1000,0b1000,0b1000,0b1111],
  M: [0b1001,0b1111,0b1111,0b1001,0b1001],
  N: [0b1001,0b1101,0b1111,0b1011,0b1001],
  O: [0b0110,0b1001,0b1001,0b1001,0b0110],
  P: [0b1110,0b1001,0b1110,0b1000,0b1000],
  Q: [0b0110,0b1001,0b1001,0b1010,0b0101],
  R: [0b1110,0b1001,0b1110,0b1010,0b1001],
  S: [0b0111,0b1000,0b0110,0b0001,0b1110],
  T: [0b1111,0b0100,0b0100,0b0100,0b0100],
  U: [0b1001,0b1001,0b1001,0b1001,0b0110],
  V: [0b1001,0b1001,0b1001,0b0110,0b0110],
  W: [0b1001,0b1001,0b1111,0b1111,0b1001],
  X: [0b1001,0b1001,0b0110,0b1001,0b1001],
  Y: [0b1001,0b1001,0b0110,0b0100,0b0100],
  Z: [0b1111,0b0001,0b0110,0b1000,0b1111],
  "0": [0b0110,0b1001,0b1001,0b1001,0b0110],
  "1": [0b0100,0b1100,0b0100,0b0100,0b1110],
  "2": [0b0110,0b1001,0b0010,0b0100,0b1111],
  "3": [0b1110,0b0001,0b0110,0b0001,0b1110],
  "4": [0b1001,0b1001,0b1111,0b0001,0b0001],
  "5": [0b1111,0b1000,0b1110,0b0001,0b1110],
  "6": [0b0111,0b1000,0b1110,0b1001,0b0110],
  "7": [0b1111,0b0001,0b0010,0b0100,0b0100],
  "8": [0b0110,0b1001,0b0110,0b1001,0b0110],
  "9": [0b0110,0b1001,0b0111,0b0001,0b1110],
  '"': [0b1010,0b1010,0b0000,0b0000,0b0000],
  " ": [0b0000,0b0000,0b0000,0b0000,0b0000],
  ".": [0b0000,0b0000,0b0000,0b0000,0b0100],
  "-": [0b0000,0b0000,0b1111,0b0000,0b0000],
  "x": [0b0000,0b1001,0b0110,0b1001,0b0000],
  "(": [0b0010,0b0100,0b0100,0b0100,0b0010],
  ")": [0b0100,0b0010,0b0010,0b0010,0b0100],
  "/": [0b0001,0b0010,0b0100,0b1000,0b0000],
  "+": [0b0000,0b0100,0b1110,0b0100,0b0000],
};

function drawText(img: Image, startX: number, startY: number, text: string, color: number) {
  let cx = startX;
  for (const ch of text) {
    const glyph = FONT_4X5[ch.toUpperCase()] || FONT_4X5[ch] || FONT_4X5[" "];
    if (!glyph) { cx += 5; continue; }
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 4; col++) {
        if (glyph[row] & (1 << (3 - col))) {
          const px = cx + col;
          const py = startY + row;
          if (px >= 0 && px < img.width && py >= 0 && py < img.height) {
            img.setPixelAt(px + 1, py + 1, color);
          }
        }
      }
    }
    cx += 5;
  }
}
