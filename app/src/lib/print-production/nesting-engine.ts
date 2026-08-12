/**
 * Print Production OS - Nesting Engine
 *
 * Deterministic Bottom-Left-Fill (BLF) algorithm for optimal panel placement
 * on roll media. This replicates what professional RIP software does when
 * arranging panels on vinyl roll stock.
 *
 * Algorithm (adapted from Burke et al. 2006 BLF heuristic):
 * 1. Sort panels by height (tallest first) - maximizes fill on fixed-width roll
 * 2. For each panel, try to place it in the bottom-left-most available position
 * 3. Try both orientations (normal and rotated 90°) - pick the one that wastes less
 * 4. Track occupied regions to prevent overlap
 * 5. Calculate total linear footage and waste percentage
 *
 * This is 100% deterministic - same inputs always produce same layout.
 */

import type {
  VehiclePanel,
  VehiclePanelSet,
  MediaSpec,
  BleedSpec,
  NestedPanel,
  RollLayout,
  Inches,
} from './types';
import { STANDARD_BLEED, PRINT_SPEED_SQFT_PER_HOUR, JOB_SETUP_MINUTES } from './constants';
import { DEFAULT_MEDIA } from './types';

// ---------------------------------------------------------------------------
// Nesting Configuration
// ---------------------------------------------------------------------------

/** Gap between panels on roll (for cutting clearance) */
const PANEL_GAP_INCHES = 0.25;

/** Minimum utilization threshold - below this, suggest different media */
const MIN_UTILIZATION_THRESHOLD = 0.60;

// ---------------------------------------------------------------------------
// Core Nesting Algorithm
// ---------------------------------------------------------------------------

/**
 * Nest a set of vehicle panels onto roll media using Bottom-Left-Fill.
 *
 * @param panelSet   The vehicle panel set to nest
 * @param media      Media specification (roll width, printable width)
 * @param bleed      Bleed specification
 * @returns Optimized roll layout
 */
export function nestPanelsOnRoll(
  panelSet: VehiclePanelSet,
  media: MediaSpec = DEFAULT_MEDIA,
  bleed: BleedSpec = STANDARD_BLEED,
): RollLayout {
  const printableWidth = media.printableWidthInches;

  // Calculate total dimensions for each panel (including bleed)
  const panelsWithDims = panelSet.panels.map(panel => {
    const totalW = panel.widthInches + bleed.leftInches + bleed.rightInches;
    const totalH = panel.heightInches + bleed.topInches + bleed.bottomInches;
    return { panel, totalW, totalH };
  });

  // Sort by height descending (tallest first for BLF)
  panelsWithDims.sort((a, b) => b.totalH - a.totalH);

  const placed: NestedPanel[] = [];
  const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];

  for (const { panel, totalW, totalH } of panelsWithDims) {
    // Try normal orientation first
    const normalPos = findBottomLeftPosition(totalW, totalH, printableWidth, occupied);

    // Try rotated 90° (swap width/height)
    const rotatedPos = findBottomLeftPosition(totalH, totalW, printableWidth, occupied);

    let bestX: number;
    let bestY: number;
    let bestW: number;
    let bestH: number;
    let rotated: boolean;

    if (normalPos && rotatedPos) {
      // Pick the orientation that uses less linear length
      const normalEnd = normalPos.y + totalH;
      const rotatedEnd = rotatedPos.y + totalW;
      if (normalEnd <= rotatedEnd) {
        bestX = normalPos.x;
        bestY = normalPos.y;
        bestW = totalW;
        bestH = totalH;
        rotated = false;
      } else {
        bestX = rotatedPos.x;
        bestY = rotatedPos.y;
        bestW = totalH;
        bestH = totalW;
        rotated = true;
      }
    } else if (normalPos) {
      bestX = normalPos.x;
      bestY = normalPos.y;
      bestW = totalW;
      bestH = totalH;
      rotated = false;
    } else if (rotatedPos) {
      bestX = rotatedPos.x;
      bestY = rotatedPos.y;
      bestW = totalH;
      bestH = totalW;
      rotated = true;
    } else {
      // Neither fits - place at the end of the roll (overflow)
      const maxY = occupied.length > 0
        ? Math.max(...occupied.map(r => r.y + r.h))
        : 0;
      bestX = 0;
      bestY = maxY + PANEL_GAP_INCHES;
      bestW = totalW;
      bestH = totalH;
      rotated = false;
    }

    placed.push({
      panel,
      rollX: bestX,
      rollY: bestY,
      totalWidth: bestW,
      totalHeight: bestH,
      rotated,
    });

    occupied.push({
      x: bestX,
      y: bestY,
      w: bestW + PANEL_GAP_INCHES,
      h: bestH + PANEL_GAP_INCHES,
    });
  }

  // Calculate layout metrics
  const maxLength = placed.length > 0
    ? Math.max(...placed.map(p => p.rollY + p.totalHeight))
    : 0;

  const totalPanelArea = placed.reduce((sum, p) => sum + p.totalWidth * p.totalHeight, 0);
  const totalRollArea = printableWidth * maxLength;
  const utilizationPercent = totalRollArea > 0
    ? Math.round((totalPanelArea / totalRollArea) * 1000) / 10
    : 0;
  const wastePercent = Math.round((100 - utilizationPercent) * 10) / 10;

  return {
    media,
    panels: placed,
    totalLengthInches: Math.ceil(maxLength),
    totalLengthFeet: Math.ceil(maxLength / 12 * 10) / 10,
    wastePercent,
    utilizationPercent,
  };
}

// ---------------------------------------------------------------------------
// Bottom-Left-Fill Position Finding
// ---------------------------------------------------------------------------

/**
 * Find the bottom-left-most position where a rectangle can be placed
 * without overlapping existing rectangles and within roll width.
 */
function findBottomLeftPosition(
  width: number,
  height: number,
  rollWidth: number,
  occupied: Array<{ x: number; y: number; w: number; h: number }>,
): { x: number; y: number } | null {
  // Panel must fit within roll width
  if (width > rollWidth) return null;

  // If nothing placed yet, start at origin
  if (occupied.length === 0) {
    return { x: 0, y: 0 };
  }

  // Generate candidate positions:
  // 1. Origin (0, 0)
  // 2. Right edge of each occupied rectangle
  // 3. Top edge of each occupied rectangle
  const candidates: Array<{ x: number; y: number }> = [
    { x: 0, y: 0 },
  ];

  for (const rect of occupied) {
    // Right of this rect
    candidates.push({ x: rect.x + rect.w, y: rect.y });
    // Above this rect
    candidates.push({ x: rect.x, y: rect.y + rect.h });
    // Top-right corner
    candidates.push({ x: rect.x + rect.w, y: rect.y + rect.h });
    // Left edge, above this rect
    candidates.push({ x: 0, y: rect.y + rect.h });
  }

  // Filter and sort candidates: bottom-first (smallest y), then left-first (smallest x)
  const validPositions = candidates
    .filter(pos => {
      // Must fit within roll width
      if (pos.x + width > rollWidth) return false;
      if (pos.x < 0 || pos.y < 0) return false;

      // Must not overlap any occupied rectangle
      return !occupied.some(rect => rectanglesOverlap(
        pos.x, pos.y, width, height,
        rect.x, rect.y, rect.w, rect.h,
      ));
    })
    .sort((a, b) => {
      // Sort by Y first (bottom), then X (left)
      if (Math.abs(a.y - b.y) > 0.01) return a.y - b.y;
      return a.x - b.x;
    });

  return validPositions.length > 0 ? validPositions[0] : null;
}

/**
 * Check if two rectangles overlap (with a small epsilon for floating point)
 */
function rectanglesOverlap(
  x1: number, y1: number, w1: number, h1: number,
  x2: number, y2: number, w2: number, h2: number,
): boolean {
  const eps = 0.001;
  return !(
    x1 + w1 <= x2 + eps ||
    x2 + w2 <= x1 + eps ||
    y1 + h1 <= y2 + eps ||
    y2 + h2 <= y1 + eps
  );
}

// ---------------------------------------------------------------------------
// Multi-Roll Splitting
// ---------------------------------------------------------------------------

/**
 * If a layout exceeds maximum roll length, split into multiple rolls.
 */
export function splitIntoRolls(
  layout: RollLayout,
  maxLengthInches: number = 1800,
): RollLayout[] {
  if (layout.totalLengthInches <= maxLengthInches) {
    return [layout];
  }

  // Split panels into groups that fit within maxLength
  const rolls: RollLayout[] = [];
  let currentPanels: NestedPanel[] = [];
  let currentMaxY = 0;

  const sortedPanels = [...layout.panels].sort((a, b) => a.rollY - b.rollY);

  for (const panel of sortedPanels) {
    const panelEnd = panel.rollY + panel.totalHeight;

    if (panelEnd > maxLengthInches && currentPanels.length > 0) {
      // Start a new roll
      rolls.push(createRollFromPanels(currentPanels, layout.media, currentMaxY));
      // Re-offset remaining panels
      const offsetY = panel.rollY;
      currentPanels = [{
        ...panel,
        rollY: panel.rollY - offsetY,
      }];
      currentMaxY = panel.totalHeight;
    } else {
      currentPanels.push(panel);
      currentMaxY = Math.max(currentMaxY, panelEnd);
    }
  }

  if (currentPanels.length > 0) {
    rolls.push(createRollFromPanels(currentPanels, layout.media, currentMaxY));
  }

  return rolls;
}

function createRollFromPanels(
  panels: NestedPanel[],
  media: MediaSpec,
  totalLengthInches: number,
): RollLayout {
  const totalPanelArea = panels.reduce((sum, p) => sum + p.totalWidth * p.totalHeight, 0);
  const totalRollArea = media.printableWidthInches * totalLengthInches;
  const utilization = totalRollArea > 0 ? (totalPanelArea / totalRollArea) * 100 : 0;

  return {
    media,
    panels,
    totalLengthInches: Math.ceil(totalLengthInches),
    totalLengthFeet: Math.ceil(totalLengthInches / 12 * 10) / 10,
    wastePercent: Math.round((100 - utilization) * 10) / 10,
    utilizationPercent: Math.round(utilization * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Estimators
// ---------------------------------------------------------------------------

/**
 * Estimate print time for a roll layout.
 */
export function estimatePrintTime(layout: RollLayout): {
  printMinutes: number;
  totalMinutes: number;
  display: string;
} {
  const totalSqFt = layout.panels.reduce(
    (sum, p) => sum + (p.totalWidth * p.totalHeight) / 144,
    0,
  );
  const printMinutes = Math.ceil((totalSqFt / PRINT_SPEED_SQFT_PER_HOUR) * 60);
  const totalMinutes = printMinutes + JOB_SETUP_MINUTES;

  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const display = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return { printMinutes, totalMinutes, display };
}

/**
 * Calculate the number of rolls needed for a layout.
 */
export function calculateRollsRequired(
  totalLengthInches: number,
  maxRollLengthInches: number = 1800,
): number {
  return Math.ceil(totalLengthInches / maxRollLengthInches);
}
