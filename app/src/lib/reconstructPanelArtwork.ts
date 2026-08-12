/**
 * reconstructPanelArtwork — Flat Panel Builder engine (admin/print production).
 *
 * Carley's 3-step flow, on the 2D PROOF (not a 3D render):
 *   STEP 1  Designer draws the panel rectangle around the wrap section.
 *   STEP 2  AI removes the tires / wheel-well cutouts and fills those gaps,
 *           continuing the surrounding wrap design (masked inpaint).
 *   STEP 3  Crop to the rectangle + add bleed → flat print-ready panel.
 *
 * WHY THIS WORKS EVERY TIME (and the old "flatten the 3D render" never did):
 * the 2D proof side view is already flat geometry, so there is nothing to
 * "flatten." We only inpaint the small wheel-well boxes (a bounded, reliable
 * operation) and then deterministically crop. If the fill step is skipped or
 * fails, we still return the cropped rectangle — the tool never returns nothing.
 *
 * Reuses the proven Precision Editor path:
 *   segment-click(manualMaskBase64) → { maskUrl }
 *   revise-render-masked(imageUrl, maskUrl, prompt) → { renderUrl }  (Flux Fill Pro)
 */

import { supabase } from "@/integrations/supabase/client";

/** Normalised 0..1 rectangle on the proof (x,y = top-left). */
export interface NormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelReconstructionInput {
  panelId?: string;
  requestId?: string;
  designId?: string;
  /** Approved 2D proof the boxes were drawn on. */
  proofImageUrl: string;
  panelName?: string;
  /** driver_side | passenger_side | hood | roof | rear | front | front_bumper | rear_bumper */
  vehicleView?: string;
  /** The panel rectangle to output (STEP 1), normalised 0..1. */
  box: NormRect;
  /** Tire / wheel-well / cutout boxes to remove + fill (STEP 2), normalised 0..1. */
  removalRegions?: NormRect[];
  /** Real-world print spec. */
  finalWidthIn: number;
  finalHeightIn: number;
  bleedIn?: number; // default 1.5
  dpi?: number; // default 150
}

export interface PanelReconstructionResult {
  /** Object URL or remote URL of the produced flat panel. */
  panelUrl: string;
  widthPx: number;
  heightPx: number;
  bleedPx: number;
  /** "crop" = STEP 3 only; "ai" = STEP 2 fill ran first. */
  method: "crop" | "ai";
  reconstructed: boolean;
}

const DEFAULT_BLEED_IN = 1.5;
const DEFAULT_DPI = 150;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load proof image"));
    // Cache-bust http(s) URLs so the browser makes a FRESH CORS request instead
    // of reusing a non-CORS cached copy (the same proof is already shown on the
    // page). A reused non-CORS copy taints the canvas, which makes toBlob /
    // toDataURL fail with "PNG encode failed" — the "encode error". blob:/data:
    // URLs are same-origin already, so never rewrite those.
    img.src = /^(blob:|data:)/.test(url)
      ? url
      : url + (url.includes("?") ? "&" : "?") + "cors=" + Date.now();
  });
}

function targetPx(input: PanelReconstructionInput) {
  const dpi = input.dpi ?? DEFAULT_DPI;
  const bleedIn = input.bleedIn ?? DEFAULT_BLEED_IN;
  return {
    dpi,
    bleedIn,
    widthPx: Math.round((input.finalWidthIn + bleedIn * 2) * dpi),
    heightPx: Math.round((input.finalHeightIn + bleedIn * 2) * dpi),
    bleedPx: Math.round(bleedIn * dpi),
  };
}

/** STEP 3 — deterministic crop of the panel rectangle to print dimensions. */
async function cropToPanel(
  sourceUrl: string,
  input: PanelReconstructionInput,
  method: "crop" | "ai",
): Promise<PanelReconstructionResult> {
  const t = targetPx(input);
  // HTML <canvas> has a hard size cap (~16k px / ~256MB). A full 218" panel at
  // 150 px/in is ~33k px wide, which makes toBlob() return null ("PNG encode
  // failed"). Cap the canvas to a safe size here and let the server-side
  // "Upscale 4x" restore true print resolution.
  const MAX_EDGE = 12000;
  const MAX_AREA = 40_000_000; // ~40 MP — safe across browsers
  const clamp = Math.min(
    1,
    MAX_EDGE / Math.max(t.widthPx, t.heightPx),
    Math.sqrt(MAX_AREA / (t.widthPx * t.heightPx)),
  );
  const widthPx = Math.max(1, Math.round(t.widthPx * clamp));
  const heightPx = Math.max(1, Math.round(t.heightPx * clamp));
  const bleedPx = Math.round(t.bleedPx * clamp);

  const img = await loadImage(sourceUrl);
  const sx = Math.max(0, Math.round(input.box.x * img.naturalWidth));
  const sy = Math.max(0, Math.round(input.box.y * img.naturalHeight));
  const sw = Math.max(1, Math.round(input.box.width * img.naturalWidth));
  const sh = Math.max(1, Math.round(input.box.height * img.naturalHeight));

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, widthPx, heightPx);

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed (panel too large for the browser — use Export Print Panel for full print resolution)"))), "image/png"),
  );
  return { panelUrl: URL.createObjectURL(blob), widthPx, heightPx, bleedPx, method, reconstructed: method === "ai" };
}

/**
 * STEP 2 — build a black/white mask from the removal boxes and inpaint-fill
 * them on the 2D proof. Returns the URL of the filled proof. Throws on failure
 * so the caller can fall back to a plain crop.
 */
async function fillRemovalRegions(input: PanelReconstructionInput): Promise<string> {
  const regions = input.removalRegions || [];
  if (regions.length === 0) throw new Error("no removal regions");

  const img = await loadImage(input.proofImageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  // Black = preserve, white = repaint (Flux Fill convention).
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#FFF";
  for (const r of regions) {
    ctx.fillRect(
      r.x * canvas.width,
      r.y * canvas.height,
      r.width * canvas.width,
      r.height * canvas.height,
    );
  }
  const maskBase64 = canvas.toDataURL("image/png").split(",")[1];

  const { data: maskData, error: maskErr } = await supabase.functions.invoke("segment-click", {
    body: { manualMaskBase64: maskBase64 },
  });
  if (maskErr) throw maskErr;
  if (!maskData?.maskUrl) throw new Error("mask upload returned no URL");

  const prompt =
    "Remove the wheels, tires, and wheel-well cutouts. Continue the surrounding " +
    "vehicle wrap design — stripes, gradients, colors, patterns, and textures — " +
    "seamlessly across the gaps so the area reads as one continuous flat graphic. " +
    "Keep every other part of the image exactly as it is.";

  const { data: fillData, error: fillErr } = await supabase.functions.invoke("revise-render-masked", {
    body: { imageUrl: input.proofImageUrl, maskUrl: maskData.maskUrl, prompt, toolType: "print-production" },
  });
  if (fillErr) throw fillErr;
  if (!fillData?.renderUrl) throw new Error("fill returned no image");
  return fillData.renderUrl as string;
}

/** Whether STEP 2 (AI fill) is attempted. Falls back to crop on any failure. */
export const AI_RECONSTRUCTION_ENABLED = true;

/**
 * Public entry point used by the Flat Panel Builder. Runs STEP 2 (fill) when
 * removal boxes are present, then STEP 3 (crop + bleed). Always returns a flat
 * rectangle — if the fill fails, it falls back to cropping the raw proof.
 */
export async function reconstructPanelArtwork(
  input: PanelReconstructionInput,
): Promise<PanelReconstructionResult> {
  if (AI_RECONSTRUCTION_ENABLED && (input.removalRegions?.length ?? 0) > 0) {
    try {
      const filledUrl = await fillRemovalRegions(input);
      return await cropToPanel(filledUrl, input, "ai");
    } catch {
      // Never block production: fall back to a clean crop of the proof.
      return cropToPanel(input.proofImageUrl, input, "crop");
    }
  }
  return cropToPanel(input.proofImageUrl, input, "crop");
}
