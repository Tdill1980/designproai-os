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
 * panelizer-flatten — Deterministic panel extraction via perspective warp
 *
 * Flow:
 *   1. Gemini detects panel corner coordinates on the 3D render (text-only)
 *   2. Perspective transform (pure math) warps each panel region to a flat rectangle
 *   3. All flat panels composited onto a single artboard
 *   4. Existing QC upscaler handles final print resolution
 *
 * This function does NOT use Gemini for image generation — only for corner detection.
 * The actual flatten+fill is 100% deterministic (homography matrix + bilinear interpolation).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import {
  getServiceClient,
  uploadToStorage,
  getSignedUrl,
  fetchImageBytes,
  uint8ArrayToBase64,
} from "../_shared/panelizer-os/storage.ts";
import {
  BUCKET,
  GEMINI_QA_MODEL,
  PPI,
  BLEED_INCHES,
  MAX_TILE_INCHES,
  OVERLAP_INCHES,
  lookupVehicle,
} from "../_shared/panelizer-os/constants.ts";

// ── Types ──────────────────────────────────────────────────────────

interface PanelCorners {
  panelName: string;
  topLeft: [number, number];
  topRight: [number, number];
  bottomRight: [number, number];
  bottomLeft: [number, number];
}

interface FlatPanel {
  panelName: string;
  storagePath: string;
  signedUrl: string;
  widthPx: number;
  heightPx: number;
  widthInches: number;
  heightInches: number;
}

interface RequestBody {
  job_id: string;
  user_id: string;
  render_urls: Record<string, string>; // e.g. { "driver_side": "url", "rear_3q": "url" }
  vehicle_make: string;
  vehicle_model: string;
  panels?: string[]; // optional subset, default = all detected
}

// ── Panel definitions per render view ──────────────────────────────

const VIEW_PANELS: Record<string, string[]> = {
  driver_side: ["driver_side"],
  passenger_side: ["passenger_side"],
  front_3q: ["hood", "front_bumper"],
  rear_3q: ["rear", "rear_bumper"],
  top: ["roof"],
  driver_3q: ["driver_side", "hood"],
  rear: ["rear"],
  front: ["hood", "front_bumper"],
};

// ── CORS headers ───────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Gemini corner detection ────────────────────────────────────────

async function detectPanelCorners(
  renderBase64: string,
  renderMime: string,
  renderWidth: number,
  renderHeight: number,
  panelNames: string[],
): Promise<PanelCorners[]> {
  const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) throw new Error("No Gemini API key configured");

  const panelList = panelNames.join(", ");

  const prompt = `You are analyzing a 3D vehicle render image that is ${renderWidth}x${renderHeight} pixels.

Identify the EXACT pixel coordinates of the 4 corners for each of these vehicle panels: ${panelList}

For each panel, return the corners in this exact order:
- topLeft: top-left corner of the panel as visible on the vehicle
- topRight: top-right corner
- bottomRight: bottom-right corner
- bottomLeft: bottom-left corner

The coordinates must be in pixel units relative to the image (0,0 is top-left of image).

If a panel is not visible or too occluded in this view, set all corners to [-1, -1].

Return ONLY valid JSON array, no other text:
[
  {
    "panelName": "driver_side",
    "topLeft": [x, y],
    "topRight": [x, y],
    "bottomRight": [x, y],
    "bottomLeft": [x, y]
  }
]`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: renderMime, data: renderBase64 } },
          { text: prompt },
        ],
      }],
      generationConfig: {
        responseModalities: ["TEXT"],
        temperature: 0.1, // Low temp for precise coordinates
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini corner detection failed (${resp.status}): ${errText}`);
  }

  const result = await resp.json();
  const textPart = result.candidates?.[0]?.content?.parts?.find((p: any) => p.text);
  if (!textPart) throw new Error("Gemini returned no text for corner detection");

  // Extract JSON from response (may be wrapped in ```json blocks)
  let jsonStr = textPart.text.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  try {
    const corners: PanelCorners[] = JSON.parse(jsonStr);
    // Filter out panels where all corners are -1 (not visible)
    return corners.filter((c) =>
      c.topLeft[0] >= 0 && c.topRight[0] >= 0 &&
      c.bottomRight[0] >= 0 && c.bottomLeft[0] >= 0
    );
  } catch (e) {
    console.error(`[FLATTEN] Failed to parse corner JSON: ${jsonStr}`);
    throw new Error(`Corner detection returned invalid JSON: ${e}`);
  }
}

// ── Perspective warp (pure math) ───────────────────────────────────

/**
 * Compute 3x3 homography matrix from 4 source→destination point pairs.
 * Uses Gaussian elimination to solve the 8×8 linear system.
 *
 * src/dst format: [[x0,y0], [x1,y1], [x2,y2], [x3,y3]]
 * Returns flat 9-element array [h0..h8] where h8 = 1
 */
function computeHomography(
  src: [number, number][],
  dst: [number, number][],
): number[] {
  // Build 8x9 augmented matrix
  // For each point pair (sx,sy) → (dx,dy):
  //   sx*h0 + sy*h1 + h2 - sx*dx*h6 - sy*dx*h7 = dx
  //   sx*h3 + sy*h4 + h5 - sx*dy*h6 - sy*dy*h7 = dy
  const A: number[][] = [];

  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx, dx]);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy, dy]);
  }

  // Gaussian elimination with partial pivoting
  const n = 8;
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    let maxVal = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(A[row][col]);
      if (val > maxVal) { maxVal = val; maxRow = row; }
    }
    if (maxVal < 1e-10) throw new Error("Singular matrix in homography computation");

    // Swap rows
    if (maxRow !== col) [A[col], A[maxRow]] = [A[maxRow], A[col]];

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / A[col][col];
      for (let j = col; j <= n; j++) {
        A[row][j] -= factor * A[col][j];
      }
    }
  }

  // Back substitution
  const h = new Array(8).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = A[row][n]; // RHS
    for (let col = row + 1; col < n; col++) {
      sum -= A[row][col] * h[col];
    }
    h[row] = sum / A[row][row];
  }

  // Return as 9-element matrix with h8 = 1
  return [...h, 1];
}

/**
 * Apply inverse homography warp to extract a flat panel from a source image.
 * For each output pixel, compute its source position via inverse transform,
 * then sample with bilinear interpolation.
 */
async function perspectiveWarp(
  srcImage: Image,
  corners: PanelCorners,
  outWidth: number,
  outHeight: number,
): Promise<Image> {
  // Source points: the 4 corners on the 3D render
  const src: [number, number][] = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];

  // Destination points: the flat output rectangle
  const dst: [number, number][] = [
    [0, 0],
    [outWidth - 1, 0],
    [outWidth - 1, outHeight - 1],
    [0, outHeight - 1],
  ];

  // We need the INVERSE transform: output → source
  // So compute homography from dst → src
  const H = computeHomography(dst, src);

  const out = new Image(outWidth, outHeight);

  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      // Apply homography: [sx, sy, sw] = H * [ox, oy, 1]
      const sw = H[6] * ox + H[7] * oy + H[8];
      if (Math.abs(sw) < 1e-10) continue;

      const sx = (H[0] * ox + H[1] * oy + H[2]) / sw;
      const sy = (H[3] * ox + H[4] * oy + H[5]) / sw;

      // Bilinear interpolation
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      // Bounds check (ImageScript uses 1-indexed)
      if (x0 < 0 || y0 < 0 || x1 >= srcImage.width || y1 >= srcImage.height) continue;

      const fx = sx - x0;
      const fy = sy - y0;

      // Get 4 neighbor pixels (1-indexed in ImageScript)
      const p00 = srcImage.getPixelAt(x0 + 1, y0 + 1);
      const p10 = srcImage.getPixelAt(x1 + 1, y0 + 1);
      const p01 = srcImage.getPixelAt(x0 + 1, y1 + 1);
      const p11 = srcImage.getPixelAt(x1 + 1, y1 + 1);

      // Extract RGBA channels (32-bit packed: RRGGBBAA)
      const r = bilinear(
        (p00 >> 24) & 0xFF, (p10 >> 24) & 0xFF,
        (p01 >> 24) & 0xFF, (p11 >> 24) & 0xFF, fx, fy,
      );
      const g = bilinear(
        (p00 >> 16) & 0xFF, (p10 >> 16) & 0xFF,
        (p01 >> 16) & 0xFF, (p11 >> 16) & 0xFF, fx, fy,
      );
      const b = bilinear(
        (p00 >> 8) & 0xFF, (p10 >> 8) & 0xFF,
        (p01 >> 8) & 0xFF, (p11 >> 8) & 0xFF, fx, fy,
      );
      const a = bilinear(
        p00 & 0xFF, p10 & 0xFF,
        p01 & 0xFF, p11 & 0xFF, fx, fy,
      );

      // Pack back to 32-bit RGBA
      const pixel = ((r & 0xFF) << 24) | ((g & 0xFF) << 16) | ((b & 0xFF) << 8) | (a & 0xFF);
      out.setPixelAt(ox + 1, oy + 1, pixel);
    }
  }

  return out;
}

function bilinear(
  v00: number, v10: number, v01: number, v11: number,
  fx: number, fy: number,
): number {
  return Math.round(
    v00 * (1 - fx) * (1 - fy) +
    v10 * fx * (1 - fy) +
    v01 * (1 - fx) * fy +
    v11 * fx * fy,
  );
}

// ── Horizontal flip for passenger side ─────────────────────────────

async function flipHorizontal(image: Image): Promise<Image> {
  const flipped = new Image(image.width, image.height);
  for (let y = 1; y <= image.height; y++) {
    for (let x = 1; x <= image.width; x++) {
      flipped.setPixelAt(image.width - x + 1, y, image.getPixelAt(x, y));
    }
  }
  return flipped;
}

// ── Panel dimension calculator ─────────────────────────────────────

interface PanelDimensions {
  panelName: string;
  widthInches: number;
  heightInches: number;
  widthPx: number;
  heightPx: number;
  isSplit: boolean;
  splitPart?: "upper" | "lower";
}

function getPanelDimensions(
  vehicle: ReturnType<typeof lookupVehicle>,
): PanelDimensions[] {
  const panels: PanelDimensions[] = [];
  const needsSplit = vehicle.bodyHeightInches > MAX_TILE_INCHES;

  // Side panels
  if (needsSplit) {
    // Upper + lower split at body line
    const upperH = Math.ceil(vehicle.bodyHeightInches / 2) + OVERLAP_INCHES;
    const lowerH = Math.ceil(vehicle.bodyHeightInches / 2) + OVERLAP_INCHES;
    panels.push({
      panelName: "driver_side_upper",
      widthInches: vehicle.bodyLengthInches,
      heightInches: upperH,
      widthPx: Math.round((vehicle.bodyLengthInches + BLEED_INCHES * 2) * PPI),
      heightPx: Math.round((upperH + BLEED_INCHES * 2) * PPI),
      isSplit: true,
      splitPart: "upper",
    });
    panels.push({
      panelName: "driver_side_lower",
      widthInches: vehicle.bodyLengthInches,
      heightInches: lowerH,
      widthPx: Math.round((vehicle.bodyLengthInches + BLEED_INCHES * 2) * PPI),
      heightPx: Math.round((lowerH + BLEED_INCHES * 2) * PPI),
      isSplit: true,
      splitPart: "lower",
    });
  } else {
    panels.push({
      panelName: "driver_side",
      widthInches: vehicle.bodyLengthInches,
      heightInches: vehicle.bodyHeightInches,
      widthPx: Math.round((vehicle.bodyLengthInches + BLEED_INCHES * 2) * PPI),
      heightPx: Math.round((vehicle.bodyHeightInches + BLEED_INCHES * 2) * PPI),
      isSplit: false,
    });
  }

  // Hood
  panels.push({
    panelName: "hood",
    widthInches: vehicle.hoodWidthInches,
    heightInches: vehicle.hoodLengthInches,
    widthPx: Math.round((vehicle.hoodWidthInches + BLEED_INCHES * 2) * PPI),
    heightPx: Math.round((vehicle.hoodLengthInches + BLEED_INCHES * 2) * PPI),
    isSplit: false,
  });

  // Rear
  panels.push({
    panelName: "rear",
    widthInches: vehicle.backWidthInches,
    heightInches: vehicle.backHeightInches,
    widthPx: Math.round((vehicle.backWidthInches + BLEED_INCHES * 2) * PPI),
    heightPx: Math.round((vehicle.backHeightInches + BLEED_INCHES * 2) * PPI),
    isSplit: false,
  });

  // Roof
  panels.push({
    panelName: "roof",
    widthInches: vehicle.roofLengthInches,
    heightInches: vehicle.roofWidthInches,
    widthPx: Math.round((vehicle.roofLengthInches + BLEED_INCHES * 2) * PPI),
    heightPx: Math.round((vehicle.roofWidthInches + BLEED_INCHES * 2) * PPI),
    isSplit: false,
  });

  return panels;
}

// ── Artboard compositor ────────────────────────────────────────────

/**
 * Lay out all flat panels on a single artboard canvas.
 * Layout:
 *   Row 1: Driver side (full width)
 *   Row 2: Passenger side (full width) — mirrored from driver
 *   Row 3: Hood | Rear | Roof (proportional widths)
 *
 * For split vehicles:
 *   Row 1: Driver upper
 *   Row 2: Driver lower
 *   Row 3: Passenger upper (flipped)
 *   Row 4: Passenger lower (flipped)
 *   Row 5: Hood | Rear | Roof
 */
async function compositeArtboard(
  panelImages: Map<string, Image>,
  panelDims: PanelDimensions[],
): Promise<Image> {
  const GAP = 20; // pixels between panels
  const LABEL_HEIGHT = 40; // space for panel labels

  // Calculate artboard dimensions
  // Find the widest panel for canvas width
  let maxWidth = 0;
  const rows: { panels: string[]; height: number }[] = [];

  // Determine row layout
  const hasSplit = panelDims.some((p) => p.isSplit);
  const sideNames = hasSplit
    ? ["driver_side_upper", "driver_side_lower"]
    : ["driver_side"];
  const passengerNames = sideNames.map((n) => n.replace("driver", "passenger"));

  // Side rows
  for (const name of sideNames) {
    const img = panelImages.get(name);
    if (img) {
      rows.push({ panels: [name], height: img.height + LABEL_HEIGHT });
      if (img.width > maxWidth) maxWidth = img.width;
    }
  }

  // Passenger rows
  for (const name of passengerNames) {
    const img = panelImages.get(name);
    if (img) {
      rows.push({ panels: [name], height: img.height + LABEL_HEIGHT });
      if (img.width > maxWidth) maxWidth = img.width;
    }
  }

  // Bottom row: hood, rear, roof side by side
  const bottomPanels = ["hood", "rear", "roof"].filter((n) => panelImages.has(n));
  if (bottomPanels.length > 0) {
    let bottomWidth = 0;
    let bottomMaxHeight = 0;
    for (const name of bottomPanels) {
      const img = panelImages.get(name)!;
      bottomWidth += img.width + GAP;
      if (img.height > bottomMaxHeight) bottomMaxHeight = img.height;
    }
    bottomWidth -= GAP; // remove trailing gap
    if (bottomWidth > maxWidth) maxWidth = bottomWidth;
    rows.push({ panels: bottomPanels, height: bottomMaxHeight + LABEL_HEIGHT });
  }

  // Total height
  const totalHeight = rows.reduce((sum, r) => sum + r.height + GAP, 0) - GAP + GAP * 2;
  const canvasWidth = maxWidth + GAP * 2;

  console.log(`[FLATTEN] Artboard: ${canvasWidth}x${totalHeight}px`);

  // Create canvas (dark background)
  const canvas = new Image(canvasWidth, totalHeight);
  // Fill with dark gray (0x1A1A1AFF)
  for (let y = 1; y <= canvas.height; y++) {
    for (let x = 1; x <= canvas.width; x++) {
      canvas.setPixelAt(x, y, 0x1A1A1AFF);
    }
  }

  // Place panels
  let curY = GAP;
  for (const row of rows) {
    if (row.panels.length === 1) {
      // Single panel row — center horizontally
      const name = row.panels[0];
      const img = panelImages.get(name);
      if (!img) { curY += row.height + GAP; continue; }

      const offsetX = Math.floor((canvasWidth - img.width) / 2);
      compositeImage(canvas, img, offsetX, curY + LABEL_HEIGHT);
    } else {
      // Multiple panels — lay out left to right, centered
      let totalW = 0;
      for (const name of row.panels) {
        const img = panelImages.get(name);
        if (img) totalW += img.width + GAP;
      }
      totalW -= GAP;

      let offsetX = Math.floor((canvasWidth - totalW) / 2);
      for (const name of row.panels) {
        const img = panelImages.get(name);
        if (!img) continue;
        compositeImage(canvas, img, offsetX, curY + LABEL_HEIGHT);
        offsetX += img.width + GAP;
      }
    }

    curY += row.height + GAP;
  }

  return canvas;
}

/** Copy src image onto dst at offset (1-indexed ImageScript) */
function compositeImage(dst: Image, src: Image, offsetX: number, offsetY: number): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const dx = offsetX + x + 1;
      const dy = offsetY + y + 1;
      if (dx < 1 || dx > dst.width || dy < 1 || dy > dst.height) continue;
      dst.setPixelAt(dx, dy, src.getPixelAt(x + 1, y + 1));
    }
  }
}

// ── Main handler ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body: RequestBody = await req.json();
    const { job_id, user_id, render_urls, vehicle_make, vehicle_model } = body;

    if (!job_id || !user_id || !render_urls || !vehicle_make || !vehicle_model) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: job_id, user_id, render_urls, vehicle_make, vehicle_model" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    console.log(`[FLATTEN] Starting job ${job_id} for ${vehicle_make} ${vehicle_model}`);
    console.log(`[FLATTEN] Render views: ${Object.keys(render_urls).join(", ")}`);

    // 1. Look up vehicle dimensions
    const vehicle = lookupVehicle(vehicle_make, vehicle_model);
    console.log(`[FLATTEN] Vehicle: ${vehicle.bodyLengthInches}"x${vehicle.bodyHeightInches}" (${vehicle.category}, ${vehicle.source})`);
    console.log(`[FLATTEN] Two-panel split needed: ${vehicle.bodyHeightInches > MAX_TILE_INCHES}`);

    // 2. Get panel dimensions
    const panelDims = getPanelDimensions(vehicle);
    console.log(`[FLATTEN] Panels to extract: ${panelDims.map((p) => p.panelName).join(", ")}`);

    // 3. Process each render view
    const panelImages = new Map<string, Image>();
    const flatPanels: FlatPanel[] = [];

    for (const [viewName, renderUrl] of Object.entries(render_urls)) {
      console.log(`[FLATTEN] Processing view: ${viewName}`);

      // Fetch and decode render
      const renderBytes = await fetchImageBytes(renderUrl);
      const renderImage = await Image.decode(renderBytes);
      const renderBase64 = uint8ArrayToBase64(renderBytes);
      const renderMime = "image/png";

      console.log(`[FLATTEN] Render ${viewName}: ${renderImage.width}x${renderImage.height}px`);

      // Determine which panels to extract from this view
      const panelsForView = VIEW_PANELS[viewName] || [viewName];
      const targetPanels = panelsForView.filter((name) =>
        panelDims.some((pd) => pd.panelName === name || pd.panelName.startsWith(name))
      );

      if (targetPanels.length === 0) {
        console.log(`[FLATTEN] No matching panels for view ${viewName}, skipping`);
        continue;
      }

      // Detect corners via Gemini
      const detectedCorners = await detectPanelCorners(
        renderBase64,
        renderMime,
        renderImage.width,
        renderImage.height,
        targetPanels,
      );

      console.log(`[FLATTEN] Detected ${detectedCorners.length} panels in ${viewName}`);

      // Warp each detected panel
      for (const corners of detectedCorners) {
        // Find matching panel dimensions
        const panelDim = panelDims.find((pd) =>
          pd.panelName === corners.panelName ||
          pd.panelName.startsWith(corners.panelName)
        );
        if (!panelDim) continue;

        // For split panels, we need to handle upper/lower
        if (panelDim.isSplit && corners.panelName === "driver_side") {
          // Warp the full side first, then split
          const fullW = Math.round((vehicle.bodyLengthInches + BLEED_INCHES * 2) * PPI);
          const fullH = Math.round((vehicle.bodyHeightInches + BLEED_INCHES * 2) * PPI);

          console.log(`[FLATTEN] Warping full ${corners.panelName}: ${fullW}x${fullH}px`);
          const fullPanel = await perspectiveWarp(renderImage, corners, fullW, fullH);

          // Split into upper and lower
          const splitY = Math.floor(fullH / 2);
          const overlapPx = Math.round(OVERLAP_INCHES * PPI);

          // Upper panel
          const upperH = splitY + overlapPx;
          const upper = new Image(fullW, upperH);
          for (let y = 1; y <= upperH; y++) {
            for (let x = 1; x <= fullW; x++) {
              if (y <= fullPanel.height) {
                upper.setPixelAt(x, y, fullPanel.getPixelAt(x, y));
              }
            }
          }
          panelImages.set("driver_side_upper", upper);

          // Lower panel
          const lowerStartY = splitY - overlapPx;
          const lowerH = fullH - lowerStartY;
          const lower = new Image(fullW, lowerH);
          for (let y = 1; y <= lowerH; y++) {
            for (let x = 1; x <= fullW; x++) {
              const srcY = lowerStartY + y;
              if (srcY >= 1 && srcY <= fullPanel.height) {
                lower.setPixelAt(x, y, fullPanel.getPixelAt(x, srcY));
              }
            }
          }
          panelImages.set("driver_side_lower", lower);

          console.log(`[FLATTEN] Split driver side: upper=${fullW}x${upperH}, lower=${fullW}x${lowerH}`);
        } else {
          // Standard single panel warp
          const outW = panelDim.widthPx;
          const outH = panelDim.heightPx;

          console.log(`[FLATTEN] Warping ${corners.panelName}: ${outW}x${outH}px`);
          const warped = await perspectiveWarp(renderImage, corners, outW, outH);
          panelImages.set(panelDim.panelName, warped);
        }
      }
    }

    // 4. Generate passenger side by flipping driver side
    for (const [name, img] of panelImages) {
      if (name.startsWith("driver_side")) {
        const passengerName = name.replace("driver", "passenger");
        if (!panelImages.has(passengerName)) {
          console.log(`[FLATTEN] Flipping ${name} → ${passengerName}`);
          const flipped = await flipHorizontal(img);
          panelImages.set(passengerName, flipped);
        }
      }
    }

    // 5. Save individual panels to storage
    const storagePanelPrefix = `renders/panelizer-jobs/${job_id}/flatten`;

    for (const [name, img] of panelImages) {
      const pngBytes = new Uint8Array(await img.encode());
      const path = `${storagePanelPrefix}/${name}_${img.width}x${img.height}.png`;

      await uploadToStorage(path, pngBytes, "image/png");
      const url = await getSignedUrl(path);

      const dim = panelDims.find((pd) => pd.panelName === name);
      flatPanels.push({
        panelName: name,
        storagePath: path,
        signedUrl: url,
        widthPx: img.width,
        heightPx: img.height,
        widthInches: dim?.widthInches || 0,
        heightInches: dim?.heightInches || 0,
      });

      console.log(`[FLATTEN] Saved ${name}: ${path} (${(pngBytes.length / 1024).toFixed(0)}KB)`);
    }

    // 6. Composite artboard
    console.log(`[FLATTEN] Compositing artboard with ${panelImages.size} panels`);
    const artboard = await compositeArtboard(panelImages, panelDims);
    const artboardBytes = new Uint8Array(await artboard.encode());
    const artboardPath = `${storagePanelPrefix}/artboard_${artboard.width}x${artboard.height}.png`;

    await uploadToStorage(artboardPath, artboardBytes, "image/png");
    const artboardUrl = await getSignedUrl(artboardPath);

    console.log(`[FLATTEN] Artboard saved: ${artboardPath} (${(artboardBytes.length / 1024).toFixed(0)}KB)`);

    // 7. Return results
    const result = {
      job_id,
      vehicle: {
        make: vehicle_make,
        model: vehicle_model,
        bodyLengthInches: vehicle.bodyLengthInches,
        bodyHeightInches: vehicle.bodyHeightInches,
        category: vehicle.category,
        twoPanel: vehicle.bodyHeightInches > MAX_TILE_INCHES,
      },
      panels: flatPanels,
      artboard: {
        storagePath: artboardPath,
        signedUrl: artboardUrl,
        widthPx: artboard.width,
        heightPx: artboard.height,
      },
      panelCount: flatPanels.length,
    };

    console.log(`[FLATTEN] Job ${job_id} complete — ${flatPanels.length} panels + artboard`);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`[FLATTEN] Error:`, err);
    return new Response(
      JSON.stringify({ error: err.message || String(err) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
