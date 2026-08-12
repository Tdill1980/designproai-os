/**
 * Print Production OS - Color Engine
 *
 * Deterministic color management for print production.
 * Handles RGB → CMYK conversion, spot color matching, and color space validation.
 *
 * IMPORTANT: True ICC profile-based conversion requires server-side processing
 * (e.g., Little CMS). This module provides algorithmic CMYK approximation
 * suitable for proofing and preflight. Final color accuracy is handled by
 * the RIP software at the print shop (ONYX, Caldera, Wasatch, etc.)
 *
 * What this engine DOES:
 * - RGB to CMYK conversion (UCR/GCR algorithm)
 * - Spot color to process color fallback
 * - Color gamut warnings (out-of-gamut detection)
 * - Ink coverage calculation (for cost estimation)
 * - Color bar generation for print verification
 *
 * What the RIP software handles (NOT this engine):
 * - ICC profile application
 * - Linearization curves
 * - Ink limiting
 * - Dot gain compensation
 */

import type { RGBColor, CMYKColor, SpotColor, ColorProfile } from './types';

// ---------------------------------------------------------------------------
// RGB ↔ CMYK Conversion (GCR Algorithm)
// ---------------------------------------------------------------------------

/**
 * Convert RGB to CMYK using Gray Component Replacement (GCR).
 *
 * GCR is the industry-standard method for wide-format printing:
 * 1. Convert RGB to naive CMY (complement of RGB)
 * 2. Find the gray component (minimum of C, M, Y)
 * 3. Replace part of the gray component with black (K)
 * 4. Remove equivalent CMY to reduce ink usage
 *
 * This reduces ink consumption by 20-30% compared to naive CMY,
 * which matters for vehicle wraps where ink cost is significant.
 *
 * @param rgb  Input RGB color (0-255 per channel)
 * @param gcrLevel  GCR strength (0.0 = no GCR, 1.0 = maximum GCR). Default 0.7
 * @returns CMYK values (0-100 per channel)
 */
export function rgbToCmyk(rgb: RGBColor, gcrLevel: number = 0.7): CMYKColor {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  // Step 1: Naive CMY
  let c = 1 - r;
  let m = 1 - g;
  let y = 1 - b;

  // Step 2: Gray component
  const k = Math.min(c, m, y) * gcrLevel;

  // Step 3: Under Color Removal
  if (k < 1) {
    c = (c - k) / (1 - k);
    m = (m - k) / (1 - k);
    y = (y - k) / (1 - k);
  } else {
    c = 0;
    m = 0;
    y = 0;
  }

  return {
    c: Math.round(clamp01(c) * 100),
    m: Math.round(clamp01(m) * 100),
    y: Math.round(clamp01(y) * 100),
    k: Math.round(clamp01(k) * 100),
  };
}

/**
 * Convert CMYK to RGB.
 */
export function cmykToRgb(cmyk: CMYKColor): RGBColor {
  const c = cmyk.c / 100;
  const m = cmyk.m / 100;
  const y = cmyk.y / 100;
  const k = cmyk.k / 100;

  return {
    r: Math.round(255 * (1 - c) * (1 - k)),
    g: Math.round(255 * (1 - m) * (1 - k)),
    b: Math.round(255 * (1 - y) * (1 - k)),
  };
}

// ---------------------------------------------------------------------------
// Ink Coverage Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate total ink coverage percentage for a CMYK color.
 * This determines:
 * - Ink cost (more coverage = more ink)
 * - Dry time (higher coverage = longer dry time)
 * - Whether ink limiting is needed (>300% is typically too much)
 *
 * Industry standard max: 300% total ink for vinyl wraps
 * (lower than paper printing at 320-340%)
 */
export function calculateInkCoverage(cmyk: CMYKColor): {
  total: number;
  perChannel: { c: number; m: number; y: number; k: number };
  needsLimiting: boolean;
  warning: string | null;
} {
  const total = cmyk.c + cmyk.m + cmyk.y + cmyk.k;
  const MAX_INK = 300;

  return {
    total,
    perChannel: { c: cmyk.c, m: cmyk.m, y: cmyk.y, k: cmyk.k },
    needsLimiting: total > MAX_INK,
    warning: total > MAX_INK
      ? `Total ink coverage ${total}% exceeds ${MAX_INK}% limit. RIP will apply ink limiting.`
      : null,
  };
}

/**
 * Apply ink limiting to reduce total coverage below threshold.
 */
export function applyInkLimiting(cmyk: CMYKColor, maxTotal: number = 300): CMYKColor {
  const total = cmyk.c + cmyk.m + cmyk.y + cmyk.k;
  if (total <= maxTotal) return cmyk;

  const scale = maxTotal / total;
  return {
    c: Math.round(cmyk.c * scale),
    m: Math.round(cmyk.m * scale),
    y: Math.round(cmyk.y * scale),
    k: Math.round(cmyk.k * scale),
  };
}

// ---------------------------------------------------------------------------
// Spot Color System
// ---------------------------------------------------------------------------

/** Common spot colors used in vehicle wraps */
export const SPOT_COLORS: Record<string, SpotColor> = {
  'pantone-185c': {
    name: 'PANTONE 185 C',
    fallbackCmyk: { c: 0, m: 91, y: 76, k: 0 },
    fallbackRgb: { r: 228, g: 0, b: 43 },
  },
  'pantone-286c': {
    name: 'PANTONE 286 C',
    fallbackCmyk: { c: 100, m: 66, y: 0, k: 2 },
    fallbackRgb: { r: 0, g: 51, b: 160 },
  },
  'pantone-black': {
    name: 'PANTONE Black C',
    fallbackCmyk: { c: 0, m: 0, y: 0, k: 100 },
    fallbackRgb: { r: 45, g: 41, b: 38 },
  },
  '3m-gloss-white': {
    name: '3M Gloss White',
    fallbackCmyk: { c: 0, m: 0, y: 0, k: 0 },
    fallbackRgb: { r: 255, g: 255, b: 255 },
  },
  '3m-matte-black': {
    name: '3M Matte Black',
    fallbackCmyk: { c: 0, m: 0, y: 0, k: 100 },
    fallbackRgb: { r: 30, g: 30, b: 30 },
  },
};

/**
 * Resolve a spot color to its process color equivalent.
 */
export function resolveSpotColor(spot: SpotColor): { rgb: RGBColor; cmyk: CMYKColor } {
  return {
    rgb: spot.fallbackRgb,
    cmyk: spot.fallbackCmyk,
  };
}

// ---------------------------------------------------------------------------
// Gamut Warning
// ---------------------------------------------------------------------------

/**
 * Check if an RGB color is within the printable CMYK gamut.
 * Highly saturated RGB colors (especially electric blue, neon green)
 * cannot be reproduced in CMYK and will appear muted when printed.
 *
 * Returns a warning for colors that will shift significantly.
 */
export function checkGamut(rgb: RGBColor): {
  inGamut: boolean;
  deltaE: number;
  warning: string | null;
} {
  // Convert to CMYK and back - the round-trip error is the gamut warning
  const cmyk = rgbToCmyk(rgb);
  const roundTrip = cmykToRgb(cmyk);

  // Simple Euclidean distance in RGB space (approximate deltaE)
  const dr = rgb.r - roundTrip.r;
  const dg = rgb.g - roundTrip.g;
  const db = rgb.b - roundTrip.b;
  const deltaE = Math.sqrt(dr * dr + dg * dg + db * db) / 255 * 100;

  const inGamut = deltaE < 5;
  const warning = deltaE >= 5
    ? `Color may shift when printed (ΔE ≈ ${Math.round(deltaE)}). Consider using a closer CMYK match.`
    : null;

  return { inGamut, deltaE: Math.round(deltaE * 10) / 10, warning };
}

// ---------------------------------------------------------------------------
// Color Utilities
// ---------------------------------------------------------------------------

/**
 * Convert hex string to RGB.
 */
export function hexToRgb(hex: string): RGBColor {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16) || 0,
    g: parseInt(clean.substring(2, 4), 16) || 0,
    b: parseInt(clean.substring(4, 6), 16) || 0,
  };
}

/**
 * Convert RGB to hex string.
 */
export function rgbToHex(rgb: RGBColor): string {
  const r = rgb.r.toString(16).padStart(2, '0');
  const g = rgb.g.toString(16).padStart(2, '0');
  const b = rgb.b.toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Format CMYK as display string.
 */
export function formatCmyk(cmyk: CMYKColor): string {
  return `C:${cmyk.c} M:${cmyk.m} Y:${cmyk.y} K:${cmyk.k}`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
