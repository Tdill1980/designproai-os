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
 * panelizer-step-cropmarks — Step 8b: Add crop/registration marks
 *
 * Input:  { inputPath, userId, jobId, panelKey, widthInches, heightInches }
 * Output: { storagePath } — panel with crop marks composited
 *
 * Draws thin registration/crop marks at the four trim corners,
 * exactly like ONYX's "finishing marks" tool. Marks are placed
 * in the bleed zone so they get trimmed off.
 *
 * No AI — pure pixel drawing.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { downloadFromStorage, uploadToStorage } from "../_shared/panelizer-os/storage.ts";
import {
  tempPath,
  BLEED_INCHES,
  PRINT_DPI,
  OUTPUT_SCALE,
  CROP_MARK_LENGTH_INCHES,
  CROP_MARK_OFFSET_INCHES,
} from "../_shared/panelizer-os/constants.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { inputPath, userId, jobId, panelKey, widthInches, heightInches, label, orderNumber } = await req.json();

    if (!inputPath || !userId || !jobId || !panelKey) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[CROPMARKS] Job ${jobId} — adding crop marks to ${panelKey}`);
    const startMs = Date.now();

    // Download panel (which already has bleed)
    const inputBytes = await downloadFromStorage(inputPath);
    const img = await Image.decode(inputBytes);
    const W = img.width;
    const H = img.height;

    // Calculate mark dimensions in pixels
    // Image is at 10% scale, so bleed pixels = BLEED_INCHES × OUTPUT_SCALE × PRINT_DPI
    const bleedPx = Math.round(BLEED_INCHES * OUTPUT_SCALE * PRINT_DPI);
    const markLen = Math.max(4, Math.round(CROP_MARK_LENGTH_INCHES * OUTPUT_SCALE * PRINT_DPI));
    const markOff = Math.max(1, Math.round(CROP_MARK_OFFSET_INCHES * OUTPUT_SCALE * PRINT_DPI));
    const markColor = 0x000000FF; // Black, fully opaque

    // Trim corners (where the actual panel edge meets the bleed)
    const trimLeft = bleedPx;
    const trimRight = W - bleedPx;
    const trimTop = bleedPx;
    const trimBottom = H - bleedPx;

    // Draw crop marks at each corner
    // Top-left corner
    drawHLine(img, trimLeft - markOff - markLen, trimTop, markLen, markColor);
    drawVLine(img, trimLeft, trimTop - markOff - markLen, markLen, markColor);

    // Top-right corner
    drawHLine(img, trimRight + markOff, trimTop, markLen, markColor);
    drawVLine(img, trimRight, trimTop - markOff - markLen, markLen, markColor);

    // Bottom-left corner
    drawHLine(img, trimLeft - markOff - markLen, trimBottom, markLen, markColor);
    drawVLine(img, trimLeft, trimBottom + markOff, markLen, markColor);

    // Bottom-right corner
    drawHLine(img, trimRight + markOff, trimBottom, markLen, markColor);
    drawVLine(img, trimRight, trimBottom + markOff, markLen, markColor);

    // ── Metadata text in bottom-right bleed zone ──────────────────
    // Panel name, dimensions, job number, and scale info.
    // Gets trimmed off but is visible on the print sheet before cutting.
    if (widthInches && heightInches) {
      const panelLabel = (label || panelKey).toUpperCase();
      const orderStr = orderNumber ? ` ${orderNumber}` : "";
      const metaText = `${panelLabel} | ${widthInches}" x ${heightInches}" |${orderStr} 10% SCALE`;
      const textY = trimBottom + Math.round(bleedPx * 0.3);
      const textX = trimRight - metaText.length * 5 - 4;
      const textColor = 0x00C7FFFF; // Cyan

      drawMetaText(img, Math.max(1, textX), Math.min(textY, H - 6), metaText, textColor, W, H);

      console.log(`[CROPMARKS] Metadata: ${metaText}`);
    }

    // Encode and upload
    const outputBytes = await img.encode();
    const storagePath = tempPath(userId, jobId, `step-8b-cropmarks-${panelKey}`);
    await uploadToStorage(storagePath, outputBytes, "image/png");

    console.log(`[CROPMARKS] ${panelKey}: marks added (bleed=${bleedPx}px, mark=${markLen}px) in ${Date.now() - startMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        storagePath,
        panelKey,
        cropMarksPx: markLen,
        bleedPx,
        step: "cropmarks",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[CROPMARKS] Error:", err);
    return new Response(
      JSON.stringify({ error: `Cropmarks step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/** Draw a horizontal line (1px thick) */
function drawHLine(img: Image, x: number, y: number, length: number, color: number) {
  for (let i = 0; i < length; i++) {
    const px = x + i;
    if (px >= 1 && px <= img.width && y >= 1 && y <= img.height) {
      img.setPixelAt(px, y, color);
    }
  }
}

/** Draw a vertical line (1px thick) */
function drawVLine(img: Image, x: number, y: number, length: number, color: number) {
  for (let i = 0; i < length; i++) {
    const py = y + i;
    if (x >= 1 && x <= img.width && py >= 1 && py <= img.height) {
      img.setPixelAt(x, py, color);
    }
  }
}

/** Simple 4×5 pixel bitmap font for metadata text in bleed zone */
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
  "'": [0b0100,0b0100,0b0000,0b0000,0b0000],
  " ": [0b0000,0b0000,0b0000,0b0000,0b0000],
  ".": [0b0000,0b0000,0b0000,0b0000,0b0100],
  "-": [0b0000,0b0000,0b1111,0b0000,0b0000],
  "x": [0b0000,0b1001,0b0110,0b1001,0b0000],
  "(": [0b0010,0b0100,0b0100,0b0100,0b0010],
  ")": [0b0100,0b0010,0b0010,0b0010,0b0100],
};

/** Draw text using the 4×5 pixel bitmap font */
function drawMetaText(img: Image, startX: number, startY: number, text: string, color: number, maxW: number, maxH: number) {
  let cx = startX;
  for (const ch of text) {
    const glyph = FONT_4X5[ch.toUpperCase()] || FONT_4X5[" "];
    if (!glyph) { cx += 5; continue; }
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 4; col++) {
        if (glyph[row] & (1 << (3 - col))) {
          const px = cx + col;
          const py = startY + row;
          if (px >= 1 && px <= maxW && py >= 1 && py <= maxH) {
            img.setPixelAt(px, py, color);
          }
        }
      }
    }
    cx += 5; // 4px char + 1px gap
  }
}
