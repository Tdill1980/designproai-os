/**
 * genie-grid-template.ts — Hybrid Design OS: The Math Layer
 *
 * Separates "soul" (Gemini creative) from "math" (deterministic panel layout).
 * Generates a precise grid specification from vehicle-specs.json dimensions
 * so Gemini knows EXACTLY where each panel goes on the canvas.
 *
 * The Grid Template tells Gemini:
 *   "Here are 5 rectangles. Fill them with your design.
 *    The rectangles are at THESE exact positions and proportions."
 *
 * Gemini handles: color, texture, composition, flow, branding
 * Code handles: panel positions, dimensions, aspect ratios, DPI
 *
 * Layout Logic (Standard 5-Panel):
 * ┌─────────────────────────────────────────────────┐
 * │                  DRIVER SIDE                      │ ~35% height
 * │                 (real inches from CSV)             │
 * ├─────────────────────────────────────────────────┤
 * │                PASSENGER SIDE                     │ ~35% height
 * │                 (mirror of driver)                │
 * ├──────────┬──────────┬──────────────────────────┤
 * │   HOOD   │   REAR   │          ROOF              │ ~30% height
 * │          │          │                             │
 * └──────────┴──────────┴──────────────────────────┘
 *
 * Bottom panel widths are proportional to their real-world inches.
 */

import type { PanelDimensions } from "./vehicle-specs-lookup.ts";

// ── Grid Zone Types ─────────────────────────────────────────────

export interface GridZone {
  key: string;
  label: string;
  widthInches: number;
  heightInches: number;
  /** Position on canvas as percentage (0-100) */
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface GenieGrid {
  zones: GridZone[];
  canvasAspect: string;
  vehicleDesc: string;
  specsSource: string;
  totalWidthInches: number;
  totalHeightInches: number;
}

// ── Grid Layout Builder ─────────────────────────────────────────

/**
 * Build a Genie Grid layout from vehicle dimensions.
 * Returns precise percentage-based zones for each panel.
 *
 * Layout rules:
 * - Sides take top ~70% of canvas (stacked)
 * - Bottom panels share remaining ~30% proportionally
 * - All proportions derived from real inch dimensions
 */
export function buildGenieGrid(
  specs: PanelDimensions,
  options: {
    addHood?: boolean;
    addRear?: boolean;
    addRoof?: boolean;
    vehicleDesc?: string;
  } = {},
): GenieGrid {
  const sideW = specs.sideW || 172;
  const sideH = specs.sideH || 60;
  const hoodW = specs.hoodW || 72;
  const hoodL = specs.hoodL || 60;
  const backW = specs.backW || 73;
  const backH = specs.backH || 59;
  const roofW = specs.roofW || 67;
  const roofL = specs.roofL || 110;

  const addHood = options.addHood !== false;
  const addRear = options.addRear !== false;
  const addRoof = options.addRoof !== false;

  // Calculate layout proportions
  // Side panels are the dominant feature — their width defines the canvas
  const canvasWidthInches = sideW; // Canvas width = side panel width

  // Bottom panel set: which panels are included?
  const bottomPanels: { key: string; label: string; wInches: number; hInches: number }[] = [];
  if (addHood) bottomPanels.push({ key: "hood", label: "HOOD", wInches: hoodW, hInches: hoodL });
  if (addRear) bottomPanels.push({ key: "rear", label: "REAR", wInches: backW, hInches: backH });
  if (addRoof) bottomPanels.push({ key: "roof", label: "ROOF", wInches: roofW, hInches: roofL });

  // Total bottom width in inches (for proportional splitting)
  const totalBottomInches = bottomPanels.reduce((sum, p) => sum + p.wInches, 0);

  // Height distribution: sides get 70%, bottom gets 30% (if bottom panels exist)
  const hasBottom = bottomPanels.length > 0;
  const sideHeightPct = hasBottom ? 35 : 50; // Each side panel
  const bottomHeightPct = hasBottom ? 30 : 0;
  const gapPct = 0; // No gap between panels (edge-to-edge)

  const zones: GridZone[] = [];

  // ── DRIVER SIDE (top) ──
  zones.push({
    key: "driver-side",
    label: "DRIVER SIDE",
    widthInches: sideW,
    heightInches: sideH,
    xPct: 0,
    yPct: 0,
    wPct: 100,
    hPct: sideHeightPct,
  });

  // ── PASSENGER SIDE (middle) ──
  zones.push({
    key: "passenger-side",
    label: "PASSENGER SIDE",
    widthInches: sideW,
    heightInches: sideH,
    xPct: 0,
    yPct: sideHeightPct,
    wPct: 100,
    hPct: sideHeightPct,
  });

  // ── BOTTOM PANELS (proportional width) ──
  if (hasBottom) {
    let xOffset = 0;
    for (const bp of bottomPanels) {
      const widthPct = (bp.wInches / totalBottomInches) * 100;
      zones.push({
        key: bp.key,
        label: bp.label,
        widthInches: bp.wInches,
        heightInches: bp.hInches,
        xPct: Math.round(xOffset * 10) / 10,
        yPct: sideHeightPct * 2,
        wPct: Math.round(widthPct * 10) / 10,
        hPct: bottomHeightPct,
      });
      xOffset += widthPct;
    }
  }

  // Calculate total canvas dimensions
  const maxBottomH = bottomPanels.length > 0
    ? Math.max(...bottomPanels.map(p => p.hInches))
    : 0;
  const totalHeightInches = sideH * 2 + maxBottomH;

  return {
    zones,
    canvasAspect: "16:9",
    vehicleDesc: options.vehicleDesc || "Vehicle",
    specsSource: specs.source,
    totalWidthInches: canvasWidthInches,
    totalHeightInches,
  };
}

// ── Prompt Section Builder ──────────────────────────────────────

/**
 * Build the GENIE GRID prompt section that constrains Gemini's panel placement.
 * This is the "math layer" — precise coordinates for each panel zone.
 *
 * Stays under 800 chars to keep total prompt under 4K golden limit.
 */
export function buildGenieGridPromptSection(grid: GenieGrid): string {
  const zoneLines = grid.zones.map(z =>
    `  ${z.label}: ${z.widthInches}" x ${z.heightInches}" → position (${z.xPct}%, ${z.yPct}%) size (${z.wPct}% x ${z.hPct}%)`
  ).join("\n");

  return `GENIE GRID — Panel Layout (${grid.specsSource} database):
${zoneLines}

Place your design within these exact panel zones. The grid defines WHERE each panel sits on the canvas. Fill each zone edge-to-edge. The design flows continuously across all zones as one cohesive wrap — colors and textures connect across zone boundaries.

Driver Side and Passenger Side share the same design (Passenger is mirrored in print).`;
}

/**
 * Build a complete artboard prompt with Genie Grid constraints.
 * Combines the design brief with the deterministic grid layout.
 *
 * Target: under 2,500 chars total.
 */
export function buildGridConstrainedArtboardPrompt(params: {
  designDescription: string;
  companyName?: string;
  vehicleMake: string;
  vehicleModel: string;
  finish?: string;
  grid: GenieGrid;
}): string {
  const { designDescription, companyName, vehicleMake, vehicleModel, finish, grid } = params;

  const gridSection = buildGenieGridPromptSection(grid);

  return `Generate a MASTER ARTBOARD for a ${vehicleMake} ${vehicleModel} vehicle wrap.

${gridSection}

DESIGN DIRECTION: "${designDescription}"
${companyName ? `COMPANY: ${companyName}` : ""}
${finish ? `FINISH: ${finish}` : ""}

The artboard is a flat 2D canvas with all panels arranged as labeled rectangles. Each panel is filled edge-to-edge with bold, high-contrast design. Text and logos in clear safe zones, large and readable. Every pixel is filled — design bleeds to all edges.

Generate the flat artboard image now.`;
}

// ── SVG Template Builder ────────────────────────────────────────

/** Default dimensions for generic 5-panel fallback (midsize SUV average) */
const GENERIC_SPECS: PanelDimensions = {
  sideW: 172, sideH: 60,
  hoodW: 72, hoodL: 60,
  backW: 73, backH: 59,
  roofW: 67, roofL: 110,
  source: "none",
};

/**
 * Build an SVG template image: black background, white-stroke rectangles
 * labeled with panel name + dimensions. This is the reference image
 * sent to Gemini so it knows WHERE each panel goes.
 *
 * @param grid - GenieGrid from buildGenieGrid() (or generic fallback)
 * @param width - SVG canvas width in pixels (default 1500)
 * @returns SVG string
 */
export function buildGenieGridSVG(grid: GenieGrid, width = 1500): string {
  const height = Math.round(width * (9 / 16)); // 16:9 aspect
  const rects = grid.zones.map((z) => {
    const x = Math.round((z.xPct / 100) * width);
    const y = Math.round((z.yPct / 100) * height);
    const w = Math.round((z.wPct / 100) * width);
    const h = Math.round((z.hPct / 100) * height);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const fontSize = Math.max(12, Math.round(h * 0.12));
    return `  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#fff" stroke-width="2"/>
  <text x="${cx}" y="${cy - fontSize * 0.6}" text-anchor="middle" fill="#fff" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold">${z.label}</text>
  <text x="${cx}" y="${cy + fontSize * 0.6}" text-anchor="middle" fill="#aaa" font-size="${Math.round(fontSize * 0.75)}" font-family="Arial, sans-serif">${z.widthInches}" × ${z.heightInches}"</text>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#000"/>
  <text x="${width / 2}" y="28" text-anchor="middle" fill="#666" font-size="16" font-family="Arial, sans-serif">${grid.vehicleDesc} — ${grid.specsSource}</text>
${rects}
</svg>`;
}

/**
 * Build a generic 5-panel SVG template using average midsize SUV dimensions.
 * Used when vehicle-specs.json has no match (source === "none").
 */
export function buildGenericGridSVG(vehicleDesc = "Generic Vehicle", width = 1500): string {
  const grid = buildGenieGrid(GENERIC_SPECS, {
    addHood: true,
    addRear: true,
    addRoof: true,
    vehicleDesc,
  });
  // Override specsSource label for generic
  grid.specsSource = "generic-fallback";
  return buildGenieGridSVG(grid, width);
}

// ── Aspect Ratio Calculator ─────────────────────────────────────

/** Gemini-supported aspect ratios, ordered by preference for artboards */
const GEMINI_ASPECT_RATIOS = [
  { label: "21:9", ratio: 21 / 9 },   // 2.333 — ultrawide, ideal for stacked panels
  { label: "16:9", ratio: 16 / 9 },   // 1.778 — wide landscape
  { label: "3:2", ratio: 3 / 2 },     // 1.500
  { label: "4:3", ratio: 4 / 3 },     // 1.333
  { label: "5:4", ratio: 5 / 4 },     // 1.250
  { label: "1:1", ratio: 1 / 1 },     // 1.000
  { label: "4:5", ratio: 4 / 5 },     // 0.800
  { label: "3:4", ratio: 3 / 4 },     // 0.750
  { label: "2:3", ratio: 2 / 3 },     // 0.667
  { label: "9:16", ratio: 9 / 16 },   // 0.5625
] as const;

/**
 * Calculate the best Gemini aspect_ratio from artboard layout dimensions.
 * Compares the artboard's actual width/height ratio to Gemini's supported
 * ratios and picks the closest match.
 */
export function calculateArtboardAspectRatio(grid: GenieGrid): string {
  const actual = grid.totalWidthInches / grid.totalHeightInches;
  let best = GEMINI_ASPECT_RATIOS[0];
  let bestDiff = Math.abs(actual - best.ratio);
  for (const ar of GEMINI_ASPECT_RATIOS) {
    const diff = Math.abs(actual - ar.ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ar;
    }
  }
  return best.label;
}
