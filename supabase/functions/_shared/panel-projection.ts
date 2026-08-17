/**
 * panel-projection.ts — Panel Quadrilateral Projection
 *
 * Maps known camera angles + vehicle dimensions to pixel coordinates
 * where each panel appears in the rendered image.
 *
 * The camera angles from view-angles-os.ts give us:
 *   - Side: perpendicular, 15ft, level with door handles, 85% frame fill
 *   - Hood: directly overhead, flat orthographic, 80% frame fill
 *   - Roof: directly overhead, 90% frame fill
 *   - Front/Rear: straight-on, 10ft, bumper height, 70% width / 75% height
 *
 * Combined with real vehicle dimensions from vehicle-specs.json,
 * we compute the 4-corner quadrilateral of each panel in the render.
 *
 * No external dependencies beyond types.
 */

import type { Point2D } from "./homography.ts";

/** Inlined from vehicle-specs-lookup.ts to avoid pulling in 265KB vehicle-specs.json */
export interface PanelDimensions {
  sideW?: number;
  sideH?: number;
  hoodW?: number;
  hoodL?: number;
  backW?: number;
  backH?: number;
  roofW?: number;
  roofL?: number;
  totalSqFt?: number;
  source: "L1-direct" | "L2-temporal" | "L3-scaled" | "none" | "input";
  matchedYear?: string;
}

// ── Panel Quad Definition ───────────────────────────────────────

export interface PanelQuad {
  panelKey: string;
  label: string;
  /** The render view this panel is extracted from */
  sourceView: string;
  /** 4 corners in pixel coordinates (clockwise: TL, TR, BR, BL) */
  corners: [Point2D, Point2D, Point2D, Point2D];
  /** Real-world panel dimensions in inches */
  widthInches: number;
  heightInches: number;
  /** Confidence 0-1: how much of the panel is visible in this view */
  confidence: number;
}

// ── Frame Fill Constants (from view-angles-os.ts) ───────────────

const FRAME_FILL = {
  side: { widthPct: 0.85, heightPct: 0.65 },
  hood: { widthPct: 0.80, heightPct: 0.80 },
  roof: { widthPct: 0.90, heightPct: 0.90 },
  front: { widthPct: 0.70, heightPct: 0.75 },
  rear: { widthPct: 0.70, heightPct: 0.75 },
};

// ── Vehicle Body Proportions ─────────────────────────────────────
// These define where on the vehicle body each panel sits.
// Values are percentages of total body length/height.
//
// Side view panel regions (percentage of body bounding box):
//   Body panel (wrapped area) excludes wheels, bumper caps, mirrors.
//   Typical vehicle: wheels occupy bottom ~35%, bumpers ~5% each end.

interface BodyProportions {
  /** Panel top edge as fraction of body height from top (0 = roof, 1 = ground) */
  panelTopPct: number;
  /** Panel bottom edge as fraction of body height */
  panelBottomPct: number;
  /** Panel left edge as fraction of body length (0 = front, 1 = rear) */
  panelLeftPct: number;
  /** Panel right edge as fraction of body length */
  panelRightPct: number;
}

// Side panel: the main wrapped area excludes wheel wells and bumper ends
const SIDE_PANEL_PROPORTIONS: BodyProportions = {
  panelTopPct: 0.05,      // just below roofline
  panelBottomPct: 0.62,   // above wheel well tops
  panelLeftPct: 0.03,     // inset from front bumper edge
  panelRightPct: 0.97,    // inset from rear bumper edge
};

// Hood: in overhead view, hood is the front portion of the vehicle top
// Hood occupies roughly front 35-45% of vehicle length
const HOOD_PROPORTIONS = {
  frontPct: 0.05,   // from front of vehicle
  rearPct: 0.42,    // to ~42% back (windshield base)
  leftPct: 0.08,    // inset from fenders
  rightPct: 0.92,
};

// Roof: in overhead view, roof is the middle section
const ROOF_PROPORTIONS = {
  frontPct: 0.25,   // from windshield top
  rearPct: 0.80,    // to rear window
  leftPct: 0.10,    // inset from roof rails
  rightPct: 0.90,
};

// ── Quad Builders Per View Type ──────────────────────────────────

/**
 * Compute panel quadrilaterals for a SIDE view render.
 *
 * Camera: perpendicular, 15ft, level with door handles
 * Frame fill: 85% width, 65% height
 * At 15ft distance, perspective distortion is minimal (~3-5° at each end).
 * We model this as a slight trapezoid narrowing at the far end.
 */
export function computeSideQuads(
  specs: PanelDimensions,
  renderWidth: number,
  renderHeight: number,
  side: "driver" | "passenger",
): PanelQuad[] {
  const sideW = specs.sideW || 172;
  const sideH = specs.sideH || 60;
  const fill = FRAME_FILL.side;

  // Vehicle bounding box in render pixels
  const vehW = renderWidth * fill.widthPct;
  const vehH = renderHeight * fill.heightPct;
  const vehX = (renderWidth - vehW) / 2;
  const vehY = (renderHeight - vehH) * 0.40; // vehicle sits slightly above center (floor visible below)

  // Panel region within vehicle bounding box
  const pp = SIDE_PANEL_PROPORTIONS;
  const panelLeft = vehX + vehW * pp.panelLeftPct;
  const panelRight = vehX + vehW * pp.panelRightPct;
  const panelTop = vehY + vehH * pp.panelTopPct;
  const panelBottom = vehY + vehH * pp.panelBottomPct;

  // At 15ft (180"), a 200" vehicle subtends about ±33° at each end
  // This creates ~2-4% keystoning. Model as slight trapezoid.
  const keystonePx = (panelRight - panelLeft) * 0.015; // 1.5% narrowing

  // For driver side (vehicle faces left): front is on left, rear is on right
  // Perspective makes the far end (rear) slightly smaller
  // For passenger side (vehicle faces right): front is on right, rear is on left
  const nearShrink = 0;
  const farShrink = keystonePx;

  let corners: [Point2D, Point2D, Point2D, Point2D];

  if (side === "driver") {
    // Vehicle faces left: front-left is closer to camera center
    corners = [
      { x: panelLeft + nearShrink, y: panelTop + nearShrink },     // TL (front-top)
      { x: panelRight - farShrink, y: panelTop + farShrink },      // TR (rear-top)
      { x: panelRight - farShrink, y: panelBottom - farShrink },   // BR (rear-bottom)
      { x: panelLeft + nearShrink, y: panelBottom - nearShrink },  // BL (front-bottom)
    ];
  } else {
    // Vehicle faces right: front-right is closer to camera center
    corners = [
      { x: panelLeft + farShrink, y: panelTop + farShrink },       // TL (rear-top)
      { x: panelRight - nearShrink, y: panelTop + nearShrink },    // TR (front-top)
      { x: panelRight - nearShrink, y: panelBottom - nearShrink }, // BR (front-bottom)
      { x: panelLeft + farShrink, y: panelBottom - farShrink },    // BL (rear-bottom)
    ];
  }

  const panelKey = side === "driver" ? "driver-side" : "passenger-side";
  const label = side === "driver" ? "DRIVER SIDE" : "PASSENGER SIDE";

  return [{
    panelKey,
    label,
    sourceView: side === "driver" ? "side" : "passenger-side",
    corners,
    widthInches: sideW,
    heightInches: sideH,
    confidence: 0.92, // Side views are nearly orthographic — high confidence
  }];
}

/**
 * Compute panel quadrilateral for a HOOD view render.
 *
 * Camera: directly overhead, flat orthographic, 80% frame fill
 * Minimal perspective — essentially a crop operation.
 */
export function computeHoodQuad(
  specs: PanelDimensions,
  renderWidth: number,
  renderHeight: number,
): PanelQuad[] {
  const hoodW = specs.hoodW || 72;
  const hoodL = specs.hoodL || 60;
  const fill = FRAME_FILL.hood;

  // Vehicle fills 80% of frame
  const fillW = renderWidth * fill.widthPct;
  const fillH = renderHeight * fill.heightPct;
  const offsetX = (renderWidth - fillW) / 2;
  const offsetY = (renderHeight - fillH) / 2;

  // Hood is the main subject in this view
  // In overhead hood view: bumper at bottom, windshield at top
  // Hood surface occupies roughly center 85% of the fill area
  const hoodLeft = offsetX + fillW * 0.08;
  const hoodRight = offsetX + fillW * 0.92;
  const hoodTop = offsetY + fillH * 0.08;
  const hoodBottom = offsetY + fillH * 0.92;

  const corners: [Point2D, Point2D, Point2D, Point2D] = [
    { x: hoodLeft, y: hoodTop },
    { x: hoodRight, y: hoodTop },
    { x: hoodRight, y: hoodBottom },
    { x: hoodLeft, y: hoodBottom },
  ];

  return [{
    panelKey: "hood",
    label: "HOOD",
    sourceView: "hood_detail",
    corners,
    widthInches: hoodW,
    heightInches: hoodL,
    confidence: 0.95, // Overhead = nearly zero distortion
  }];
}

/**
 * Compute panel quadrilateral for a ROOF view render.
 *
 * Camera: directly overhead, 90% frame fill
 * Minimal perspective — nearly flat.
 */
export function computeRoofQuad(
  specs: PanelDimensions,
  renderWidth: number,
  renderHeight: number,
): PanelQuad[] {
  const roofW = specs.roofW || 67;
  const roofL = specs.roofL || 110;
  const fill = FRAME_FILL.roof;

  const fillW = renderWidth * fill.widthPct;
  const fillH = renderHeight * fill.heightPct;
  const offsetX = (renderWidth - fillW) / 2;
  const offsetY = (renderHeight - fillH) / 2;

  // Roof view: A-pillars to trunk, roof surface fills the frame
  const rp = ROOF_PROPORTIONS;
  const roofLeft = offsetX + fillW * rp.leftPct;
  const roofRight = offsetX + fillW * rp.rightPct;
  const roofTop = offsetY + fillH * rp.frontPct;
  const roofBottom = offsetY + fillH * rp.rearPct;

  const corners: [Point2D, Point2D, Point2D, Point2D] = [
    { x: roofLeft, y: roofTop },
    { x: roofRight, y: roofTop },
    { x: roofRight, y: roofBottom },
    { x: roofLeft, y: roofBottom },
  ];

  return [{
    panelKey: "roof",
    label: "ROOF",
    sourceView: "roof",
    corners,
    widthInches: roofW,
    heightInches: roofL,
    confidence: 0.93,
  }];
}

/**
 * Compute panel quadrilateral for a REAR view render.
 *
 * Camera: straight-on, 10ft, bumper height, 70%w x 75%h
 * Mild perspective since camera is close (10ft vs 15ft for side).
 */
export function computeRearQuad(
  specs: PanelDimensions,
  renderWidth: number,
  renderHeight: number,
): PanelQuad[] {
  const backW = specs.backW || 73;
  const backH = specs.backH || 59;
  const fill = FRAME_FILL.rear;

  const fillW = renderWidth * fill.widthPct;
  const fillH = renderHeight * fill.heightPct;
  const offsetX = (renderWidth - fillW) / 2;
  const offsetY = (renderHeight - fillH) * 0.35; // vehicle slightly above center

  // Rear panel: the main rear body surface (tailgate/hatch area)
  // Excludes bumper, lights trim — approximately center 75% of fill
  const rearLeft = offsetX + fillW * 0.12;
  const rearRight = offsetX + fillW * 0.88;
  const rearTop = offsetY + fillH * 0.08;
  const rearBottom = offsetY + fillH * 0.82;

  // Slight keystoning from 10ft distance
  const keystone = (rearRight - rearLeft) * 0.02;
  const corners: [Point2D, Point2D, Point2D, Point2D] = [
    { x: rearLeft + keystone, y: rearTop },
    { x: rearRight - keystone, y: rearTop },
    { x: rearRight, y: rearBottom },
    { x: rearLeft, y: rearBottom },
  ];

  return [{
    panelKey: "rear",
    label: "REAR",
    sourceView: "rear",
    corners,
    widthInches: backW,
    heightInches: backH,
    confidence: 0.85, // Front-on views have more distortion from closer camera
  }];
}

/**
 * Compute panel quadrilateral for a FRONT view render.
 */
export function computeFrontQuad(
  specs: PanelDimensions,
  renderWidth: number,
  renderHeight: number,
): PanelQuad[] {
  const fill = FRAME_FILL.front;

  const fillW = renderWidth * fill.widthPct;
  const fillH = renderHeight * fill.heightPct;
  const offsetX = (renderWidth - fillW) / 2;
  const offsetY = (renderHeight - fillH) * 0.35;

  // Front bumper / grille area
  const frontLeft = offsetX + fillW * 0.10;
  const frontRight = offsetX + fillW * 0.90;
  const frontTop = offsetY + fillH * 0.55; // bumper is lower half
  const frontBottom = offsetY + fillH * 0.92;

  const keystone = (frontRight - frontLeft) * 0.02;
  const corners: [Point2D, Point2D, Point2D, Point2D] = [
    { x: frontLeft + keystone, y: frontTop },
    { x: frontRight - keystone, y: frontTop },
    { x: frontRight, y: frontBottom },
    { x: frontLeft, y: frontBottom },
  ];

  return [{
    panelKey: "front-bumper",
    label: "FRONT BUMPER",
    sourceView: "front",
    corners,
    widthInches: specs.backW || 73, // front width ≈ back width
    heightInches: 23, // standard bumper height
    confidence: 0.80,
  }];
}

// ── Master Dispatcher ────────────────────────────────────────────

/**
 * Get all extractable panel quads for a given view type.
 */
export function getPanelQuads(
  viewType: string,
  specs: PanelDimensions,
  renderWidth: number,
  renderHeight: number,
): PanelQuad[] {
  switch (viewType) {
    case "side":
    case "driver-side":
      return computeSideQuads(specs, renderWidth, renderHeight, "driver");
    case "passenger-side":
      return computeSideQuads(specs, renderWidth, renderHeight, "passenger");
    case "hood_detail":
    case "hood":
      return computeHoodQuad(specs, renderWidth, renderHeight);
    case "roof":
      return computeRoofQuad(specs, renderWidth, renderHeight);
    case "rear":
      return computeRearQuad(specs, renderWidth, renderHeight);
    case "front":
      return computeFrontQuad(specs, renderWidth, renderHeight);
    default:
      return [];
  }
}

/**
 * Get the list of view types needed to extract all major panels.
 */
export function getRequiredViews(): string[] {
  return ["side", "passenger-side", "hood_detail", "rear", "roof"];
}
