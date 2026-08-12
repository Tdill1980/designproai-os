/**
 * Print Production OS - WPW Panel Aspect Ratios
 *
 * Maps every WePrintWraps panel size to its exact aspect ratio string
 * for the Gemini API's imageConfig.aspectRatio parameter.
 *
 * When the AI flat-panel generator uses the correct aspect ratio,
 * the output matches the panel proportions exactly - eliminating
 * the lossy center-crop step from the old pipeline.
 *
 * Ratio derivation:
 *   ratio = GCD-reduced(widthInches, heightInches)
 *   e.g., Large Side = 200 × 59.5 → multiply by 2 → 400:119 → simplify → 40:12 (≈3.33:1)
 *
 * These ratios are passed directly to Gemini's imageConfig.aspectRatio.
 */

import { WRAP_DPI, SCALE_FACTORS } from './constants';
import type { DPI, Pixels } from './types';

// ---------------------------------------------------------------------------
// WPW Aspect Ratio Table
// ---------------------------------------------------------------------------

export interface AspectRatioEntry {
  /** Gemini-compatible aspect ratio string (e.g., "40:12") */
  ratio: string;
  /** Numeric ratio value (width / height) */
  numeric: number;
  /** Physical width in inches */
  widthInches: number;
  /** Physical height in inches */
  heightInches: number;
  /** Human-readable label */
  label: string;
}

/**
 * Complete aspect ratio lookup for all WPW panel types and sizes.
 *
 * Keys follow the pattern: "{panelType}:{size}" for sized panels,
 * or just "{panelType}" for fixed-size addon panels.
 */
export const WPW_ASPECT_RATIOS: Record<string, AspectRatioEntry> = {
  // --- Side Panels (59.5" height, variable width) ---
  'side:small':  { ratio: '29:12',   numeric: 144 / 59.5,   widthInches: 144,   heightInches: 59.5, label: 'Side Small' },
  'side:medium': { ratio: '35:12',   numeric: 172 / 59.5,   widthInches: 172,   heightInches: 59.5, label: 'Side Medium' },
  'side:large':  { ratio: '40:12',   numeric: 200 / 59.5,   widthInches: 200,   heightInches: 59.5, label: 'Side Large' },
  'side:xl':     { ratio: '48:12',   numeric: 240 / 59.5,   widthInches: 240,   heightInches: 59.5, label: 'Side XL' },

  // --- Addon Panels (fixed sizes) ---
  'hood':          { ratio: '6:5',      numeric: 72 / 59.5,    widthInches: 72,    heightInches: 59.5, label: 'Hood' },
  'front-bumper':  { ratio: '241:76',   numeric: 120.5 / 38,   widthInches: 120.5, heightInches: 38,   label: 'Front Bumper' },
  'rear':          { ratio: '145:118',  numeric: 72.5 / 59,    widthInches: 72.5,  heightInches: 59,   label: 'Rear' },
  'rear-bumper':   { ratio: '60:19',    numeric: 120 / 38,     widthInches: 120,   heightInches: 38,   label: 'Rear Bumper' },

  // --- Roof Panels (59.5" height, variable width) ---
  'roof:small':  { ratio: '6:5',    numeric: 72 / 59.5,   widthInches: 72,  heightInches: 59.5, label: 'Roof Small' },
  'roof:medium': { ratio: '22:12',  numeric: 110 / 59.5,  widthInches: 110, heightInches: 59.5, label: 'Roof Medium' },
  'roof:large':  { ratio: '32:12',  numeric: 160 / 59.5,  widthInches: 160, heightInches: 59.5, label: 'Roof Large' },
};

// ---------------------------------------------------------------------------
// Lookup Functions
// ---------------------------------------------------------------------------

/**
 * Get the Gemini aspect ratio string for a panel.
 *
 * @param panelType  'side' | 'hood' | 'front-bumper' | 'rear' | 'rear-bumper' | 'roof'
 * @param size       Size variant for side/roof panels: 'small' | 'medium' | 'large' | 'xl'
 * @returns Aspect ratio string (e.g., "40:12") or null if not found
 */
export function getAspectRatio(
  panelType: string,
  size?: string,
): string | null {
  // Side and roof panels require a size
  if (panelType === 'side' || panelType === 'roof') {
    const key = `${panelType}:${size || 'medium'}`;
    return WPW_ASPECT_RATIOS[key]?.ratio ?? null;
  }

  // Addon panels are fixed-size
  return WPW_ASPECT_RATIOS[panelType]?.ratio ?? null;
}

/**
 * Get the full aspect ratio entry for a panel.
 */
export function getAspectRatioEntry(
  panelType: string,
  size?: string,
): AspectRatioEntry | null {
  if (panelType === 'side' || panelType === 'roof') {
    const key = `${panelType}:${size || 'medium'}`;
    return WPW_ASPECT_RATIOS[key] ?? null;
  }
  return WPW_ASPECT_RATIOS[panelType] ?? null;
}

// ---------------------------------------------------------------------------
// Pixel Dimension Calculator
// ---------------------------------------------------------------------------

/**
 * Calculate exact WPW pixel dimensions for a panel.
 *
 * Formula: pixels = physicalInches × scaleFactor × DPI
 *
 * At 10% scale / 150 DPI:
 *   Large Side (200"): 200 × 0.10 × 150 = 3,000 px wide
 *   Side height (59.5"): 59.5 × 0.10 × 150 = 893 px tall
 *
 * @param widthInches   Physical panel width
 * @param heightInches  Physical panel height
 * @param dpi           Target DPI (default: 150)
 * @param scale         Scale string (default: '10%')
 * @returns Exact pixel dimensions
 */
export function getTargetPixels(
  widthInches: number,
  heightInches: number,
  dpi: DPI = WRAP_DPI,
  scale: string = '10%',
): { width: Pixels; height: Pixels } {
  const factor = SCALE_FACTORS[scale] || 0.10;
  return {
    width: Math.round(widthInches * factor * dpi),
    height: Math.round(heightInches * factor * dpi),
  };
}

/**
 * Calculate pixel dimensions including bleed extension.
 *
 * @param widthInches   Physical panel width
 * @param heightInches  Physical panel height
 * @param bleedInches   Bleed on each edge (default: 0.5")
 * @param dpi           Target DPI (default: 150)
 * @param scale         Scale string (default: '10%')
 */
export function getTargetPixelsWithBleed(
  widthInches: number,
  heightInches: number,
  bleedInches: number = 0.5,
  dpi: DPI = WRAP_DPI,
  scale: string = '10%',
): { trim: { width: Pixels; height: Pixels }; withBleed: { width: Pixels; height: Pixels } } {
  const factor = SCALE_FACTORS[scale] || 0.10;
  return {
    trim: {
      width: Math.round(widthInches * factor * dpi),
      height: Math.round(heightInches * factor * dpi),
    },
    withBleed: {
      width: Math.round((widthInches + bleedInches * 2) * factor * dpi),
      height: Math.round((heightInches + bleedInches * 2) * factor * dpi),
    },
  };
}

// ---------------------------------------------------------------------------
// Aspect Ratio Validation
// ---------------------------------------------------------------------------

/**
 * Validate that an image's actual dimensions match the expected aspect ratio.
 *
 * Used after Gemini generates a flat panel to verify it honored the
 * aspectRatio constraint. Tolerance accounts for Gemini's slight
 * rounding (typically within 2-3%).
 *
 * @param actualWidth    Image width in pixels
 * @param actualHeight   Image height in pixels
 * @param expectedRatio  Expected ratio string (e.g., "40:12")
 * @param tolerance      Max allowed deviation (default: 0.05 = 5%)
 */
export function validateAspectRatio(
  actualWidth: number,
  actualHeight: number,
  expectedRatio: string,
  tolerance: number = 0.05,
): { valid: boolean; actualRatio: number; expectedNumeric: number; deviation: number } {
  const [wStr, hStr] = expectedRatio.split(':');
  const expectedNumeric = parseInt(wStr, 10) / parseInt(hStr, 10);
  const actualRatio = actualWidth / actualHeight;
  const deviation = Math.abs(actualRatio - expectedNumeric) / expectedNumeric;

  return {
    valid: deviation <= tolerance,
    actualRatio: Math.round(actualRatio * 1000) / 1000,
    expectedNumeric: Math.round(expectedNumeric * 1000) / 1000,
    deviation: Math.round(deviation * 10000) / 10000,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get all aspect ratios for a panel selection (used when generating a full set).
 * Returns an array of { panelKey, aspectRatio, entry } for each panel in the set.
 */
export function getAspectRatiosForSelection(selection: {
  sideSize: string;
  addHood: boolean;
  addFrontBumper: boolean;
  addRearBumper: boolean;
  roofSize: string;
}): Array<{ panelKey: string; aspectRatio: string; entry: AspectRatioEntry }> {
  const result: Array<{ panelKey: string; aspectRatio: string; entry: AspectRatioEntry }> = [];

  // Driver side
  const sideEntry = getAspectRatioEntry('side', selection.sideSize);
  if (sideEntry) {
    result.push({ panelKey: 'driver-side', aspectRatio: sideEntry.ratio, entry: sideEntry });
    // Passenger side uses same ratio (mirrored in post-processing)
    result.push({ panelKey: 'passenger-side', aspectRatio: sideEntry.ratio, entry: sideEntry });
  }

  // Hood
  if (selection.addHood) {
    const hoodEntry = getAspectRatioEntry('hood');
    if (hoodEntry) result.push({ panelKey: 'hood', aspectRatio: hoodEntry.ratio, entry: hoodEntry });
  }

  // Front Bumper
  if (selection.addFrontBumper) {
    const fbEntry = getAspectRatioEntry('front-bumper');
    if (fbEntry) result.push({ panelKey: 'front-bumper', aspectRatio: fbEntry.ratio, entry: fbEntry });
  }

  // Rear + Rear Bumper
  if (selection.addRearBumper) {
    const rearEntry = getAspectRatioEntry('rear');
    if (rearEntry) result.push({ panelKey: 'rear', aspectRatio: rearEntry.ratio, entry: rearEntry });

    const rbEntry = getAspectRatioEntry('rear-bumper');
    if (rbEntry) result.push({ panelKey: 'rear-bumper', aspectRatio: rbEntry.ratio, entry: rbEntry });
  }

  // Roof
  if (selection.roofSize && selection.roofSize !== 'none') {
    const roofEntry = getAspectRatioEntry('roof', selection.roofSize);
    if (roofEntry) result.push({ panelKey: 'roof', aspectRatio: roofEntry.ratio, entry: roofEntry });
  }

  return result;
}
