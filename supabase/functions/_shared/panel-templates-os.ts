/**
 * ═══════════════════════════════════════════════════════════════
 *  TRADE SECRET — CONFIDENTIAL & PROPRIETARY
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *
 *  Proprietary canonical PANEL-TEMPLATE / artboard-output config —
 *  a TRADE SECRET of RestylePro / LoopMighty Software Development LLC, part of the
 *  DesignIQ™ / GENIE™ / LiftIQ Engine™ architecture (patent-pending
 *  system & methods).
 *
 *  Do NOT copy, publish, distribute, disclose, or reproduce — in
 *  whole or in part — without express written permission.
 *  See /NOTICE and docs/TRADEMARKS.md. Not legal advice.
 * ═══════════════════════════════════════════════════════════════
 */
/**
 * PANEL TEMPLATES OS v1.0 — Flat-Panel Artboard Template Suite
 * ============================================================
 * The single source of truth for the BLANK flat-panel rectangle of every side —
 * the print artboard the AI designs INTO and GENIE slices true-size panels from.
 *
 * This is the panel-side counterpart to view-angles-os.ts:
 *   - view-angles-os.ts  → enforces the 7 canonical CAMERA ANGLES (3D proof).
 *   - panel-templates-os.ts → enforces the canonical FLAT PANELS (print artboard).
 *
 * THE LAW (why this file exists):
 *   A panel is a FLAT RECTANGLE at a TRUE physical size — NOT an AI-guessed crop
 *   of a 3D render. Every production surface (production-flow-engine, the GENIE
 *   panelizer, the 2D/print proof, the element-lift) imports the SAME template
 *   from here, so a driver-side panel is ALWAYS the same enforced rectangle and
 *   the same enforced inches everywhere. One source of truth = no drift.
 *
 * THE BLANK TEMPLATE (what gets PASSED to the AI):
 *   getPanelTemplate(side, dims) returns the blank artboard rectangle (true-size
 *   inches + the print pixel canvas + the nearest Gemini aspect) plus the artboard
 *   directive. The AI is handed the BLANK template and designs the artwork to fill
 *   it edge-to-edge — so its output is already a print-ready artboard file for that
 *   panel, correctly sized, instead of a render that has to be cropped.
 *
 * DO NOT MODIFY dimensions/order without explicit Trish approval + diff review.
 */

/**
 * The canonical print panels in LOCKED PRODUCTION ORDER — driver-side first,
 * mirroring view-angles-os VIEW_ORDER so the proof, the panelizer, and the
 * production pack all agree on sequence.
 *
 *  1. driver_side   — primary print panel, customer approves FIRST
 *  2. passenger_side — mirror of driver (flipped, text stays readable)
 *  3. hood          — hood panel
 *  4. roof          — top panel
 *  5. front_bumper  — front fascia panel
 *  6. rear_bumper   — rear fascia panel
 */
export const PANEL_ORDER = [
  "driver_side",
  "passenger_side",
  "hood",
  "roof",
  "front_bumper",
  "rear_bumper",
] as const;

export type PanelSide = typeof PANEL_ORDER[number];

/** Human-readable print labels (match the production proof legend exactly). */
export const PANEL_LABELS: Record<PanelSide, string> = {
  driver_side: "DRIVER SIDE",
  passenger_side: "PASSENGER SIDE",
  hood: "HOOD",
  roof: "ROOF",
  front_bumper: "FRONT BUMPER",
  rear_bumper: "REAR BUMPER",
};

/** Mandatory print spec — locked. */
export const BLEED_INCHES = 2;
export const PRINT_DPI = 300;

/**
 * Side → which measured fields of the vehicle_dimensions / panelizer-step-validate
 * `estimatedDimensions` payload give this panel its TRUE width × height (inches).
 *
 * This is the authoritative mapping that was previously inlined in
 * production-flow-engine.resolvePanelInches() — now canonical so every caller
 * resolves the SAME rectangle. `fallback` covers vehicles whose record lacks a
 * dedicated bumper measurement (front/rear fascia ≈ body width × a short height).
 */
export const PANEL_DIMENSION_FIELDS: Record<
  PanelSide,
  { width: string; height: string; fallback?: { width: string; height: string } }
> = {
  driver_side: { width: "bodyLengthInches", height: "bodyHeightInches" },
  passenger_side: { width: "bodyLengthInches", height: "bodyHeightInches" },
  hood: { width: "hoodWidthInches", height: "hoodLengthInches" },
  roof: { width: "roofWidthInches", height: "roofLengthInches" },
  front_bumper: {
    width: "frontWidthInches",
    height: "frontHeightInches",
    fallback: { width: "backWidthInches", height: "backHeightInches" },
  },
  rear_bumper: { width: "backWidthInches", height: "backHeightInches" },
};

/**
 * Gemini aspectRatio enum — the BLANK template's print rectangle is snapped to the
 * nearest supported ratio so the AI paints the full artboard with no letterboxing.
 */
const GEMINI_ASPECTS: Array<{ label: string; ratio: number }> = [
  { label: "21:9", ratio: 21 / 9 }, { label: "16:9", ratio: 16 / 9 },
  { label: "3:2", ratio: 3 / 2 }, { label: "4:3", ratio: 4 / 3 },
  { label: "5:4", ratio: 5 / 4 }, { label: "1:1", ratio: 1 },
  { label: "4:5", ratio: 4 / 5 }, { label: "3:4", ratio: 3 / 4 },
  { label: "2:3", ratio: 2 / 3 }, { label: "9:16", ratio: 9 / 16 },
];

export function nearestGeminiAspect(widthIn: number, heightIn: number): string {
  if (!widthIn || !heightIn) return "16:9";
  const target = widthIn / heightIn;
  let best = GEMINI_ASPECTS[0], diff = Infinity;
  for (const a of GEMINI_ASPECTS) {
    const d = Math.abs(a.ratio - target);
    if (d < diff) { diff = d; best = a; }
  }
  return best.label;
}

/** Normalize any loose side alias (the 3D view keys, "driver", etc.) to a PanelSide. */
export function normalizePanelSide(raw: string): PanelSide {
  const s = (raw || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (s.startsWith("passenger")) return "passenger_side";
  if (s.startsWith("driver") || s === "side") return "driver_side";
  if (s.startsWith("hood")) return "hood";
  if (s.startsWith("roof")) return "roof";
  if (s.startsWith("front")) return "front_bumper";
  if (s.startsWith("rear") || s.startsWith("back")) return "rear_bumper";
  return "driver_side";
}

export interface PanelTemplate {
  side: PanelSide;
  label: string;
  /** TRUE finished artwork size (no bleed), inches. */
  artWidthIn: number;
  artHeightIn: number;
  /** TRUE print size INCLUDING the 2" bleed all around, inches. */
  printWidthIn: number;
  printHeightIn: number;
  /** Print canvas in pixels at 300 DPI (the blank artboard the AI fills). */
  canvasW: number;
  canvasH: number;
  /** Nearest Gemini aspect for the blank rectangle. */
  aspect: string;
  totalSqFt: number;
  isPassenger: boolean;
  /** The artboard directive PASSED to the AI — design INTO this blank rectangle. */
  directive: string;
}

/**
 * Resolve the inches for a side from a measured-dimensions payload (the
 * `estimatedDimensions` object from panelizer-step-validate / vehicle_dimensions).
 * Returns null when the record can't supply a real width AND height for the side —
 * callers MUST treat null as "cannot enforce size" and refuse rather than guess.
 */
export function resolvePanelInches(
  side: PanelSide,
  dims: Record<string, number | undefined | null>,
): { w: number; h: number } | null {
  const spec = PANEL_DIMENSION_FIELDS[side];
  const num = (k?: string) => {
    const v = k ? dims[k] : undefined;
    return typeof v === "number" && isFinite(v) && v > 0 ? v : undefined;
  };
  let w = num(spec.width);
  let h = num(spec.height);
  if ((!w || !h) && spec.fallback) {
    w = w || num(spec.fallback.width);
    h = h || num(spec.fallback.height);
  }
  return w && h ? { w, h } : null;
}

/**
 * Build the BLANK flat-panel artboard template for a side at its true size.
 * This is the object you PASS to the AI / panelizer / proof so the panel size is
 * ENFORCED everywhere. Returns null when the vehicle record can't size the panel.
 */
export function getPanelTemplate(
  rawSide: string,
  dims: Record<string, number | undefined | null>,
): PanelTemplate | null {
  const side = normalizePanelSide(rawSide);
  const base = resolvePanelInches(side, dims);
  if (!base) return null;

  const printWidthIn = base.w + BLEED_INCHES * 2;
  const printHeightIn = base.h + BLEED_INCHES * 2;
  const aspect = nearestGeminiAspect(printWidthIn, printHeightIn);
  const totalSqFt = parseFloat(((printWidthIn * printHeightIn) / 144).toFixed(4));
  const label = PANEL_LABELS[side];

  return {
    side,
    label,
    artWidthIn: base.w,
    artHeightIn: base.h,
    printWidthIn,
    printHeightIn,
    canvasW: Math.round(printWidthIn * PRINT_DPI),
    canvasH: Math.round(printHeightIn * PRINT_DPI),
    aspect,
    totalSqFt,
    isPassenger: side === "passenger_side",
    directive:
      `FLAT PRINT ARTBOARD — ${label}. This is a blank rectangular print panel ` +
      `${base.w}" × ${base.h}" (plus ${BLEED_INCHES}" bleed all around → ` +
      `${printWidthIn}" × ${printHeightIn}" at ${PRINT_DPI} DPI). Design the wrap ` +
      `artwork to fill this flat rectangle edge-to-edge as a head-on, perfectly ` +
      `flat 2D artboard — NOT a photo of a vehicle, NO perspective, NO wheels, ` +
      `windows, body contours, reflections or studio. The artwork must extend ` +
      `into the ${BLEED_INCHES}" bleed so there is no white edge after trimming.` +
      (side === "passenger_side"
        ? ` Mirror of the driver side; ALL text/logos still read correctly left-to-right.`
        : ""),
  };
}

/** The full ordered set of blank templates for a vehicle (skips any side the record can't size). */
export function getAllPanelTemplates(
  dims: Record<string, number | undefined | null>,
): PanelTemplate[] {
  return PANEL_ORDER
    .map((side) => getPanelTemplate(side, dims))
    .filter((t): t is PanelTemplate => t !== null);
}
