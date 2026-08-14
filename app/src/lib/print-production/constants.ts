/**
 * Print Production OS - Industry Constants
 *
 * These values come from real-world print production standards.
 * Sources: 3M IJ180Cv3 specs, Avery Dennison MPI 1105, FESPA guidelines,
 * and WePrintWraps production specs.
 */

import type { BleedSpec, PrintMarks, ColorProfile, MediaSpec } from './types';

// ---------------------------------------------------------------------------
// Resolution Standards
// ---------------------------------------------------------------------------

/** Standard DPI for vehicle wraps viewed at arm's length (3-5 feet) */
export const WRAP_DPI = 150;

/** High-res DPI for close-up panels (bumpers, door handles) */
export const DETAIL_DPI = 300;

/** Maximum DPI - beyond this is wasted on vinyl substrates */
export const MAX_DPI = 720;

/** Output scale factor - files generated at 10% for transfer, RIP upscales */
export const OUTPUT_SCALE_FACTOR = 0.10;

/** Scale factor lookup */
export const SCALE_FACTORS: Record<string, number> = {
  'full': 1.0,
  '50%': 0.50,
  '25%': 0.25,
  '10%': 0.10,
};

// ---------------------------------------------------------------------------
// Bleed & Overlap Standards
// ---------------------------------------------------------------------------

/** Standard bleed for vehicle wrap panels */
export const STANDARD_BLEED: BleedSpec = {
  topInches: 0.5,
  bottomInches: 0.5,
  leftInches: 0.5,
  rightInches: 0.5,
};

/** Extended bleed for panels that wrap around edges */
export const WRAP_EDGE_BLEED: BleedSpec = {
  topInches: 1.0,
  bottomInches: 1.0,
  leftInches: 1.0,
  rightInches: 1.0,
};

/** Standard seam overlap between adjacent panels */
export const STANDARD_OVERLAP_INCHES = 0.5;

/** Maximum seam overlap for high-stress areas */
export const MAX_OVERLAP_INCHES = 1.0;

// ---------------------------------------------------------------------------
// Media Widths
// ---------------------------------------------------------------------------

/** Standard vinyl roll width (most common in the industry) */
export const STANDARD_ROLL_WIDTH = 60;

/** 3M standard roll width */
export const ROLL_WIDTH_3M = 54;

/** Printable area (accounting for printer grip margins) */
export const PRINTABLE_WIDTH_60 = 58;
export const PRINTABLE_WIDTH_54 = 52;

/** Vinyl roll height = printable width (the height of panels on roll) */
export const VINYL_HEIGHT = 59.5; // 60" roll with 0.25" trim each side

// ---------------------------------------------------------------------------
// Common Media Presets
// ---------------------------------------------------------------------------

export const MEDIA_PRESETS: Record<string, MediaSpec> = {
  '3m-ij180': {
    type: 'cast-vinyl',
    rollWidthInches: 54,
    printableWidthInches: 52,
    maxLengthInches: 1800,
    laminate: 'gloss',
    manufacturer: '3M',
    productCode: 'IJ180Cv3',
  },
  '3m-ij180-matte': {
    type: 'cast-vinyl',
    rollWidthInches: 54,
    printableWidthInches: 52,
    maxLengthInches: 1800,
    laminate: 'matte',
    manufacturer: '3M',
    productCode: 'IJ180Cv3',
  },
  'avery-mpi1105': {
    type: 'cast-vinyl',
    rollWidthInches: 60,
    printableWidthInches: 58,
    maxLengthInches: 1800,
    laminate: 'gloss',
    manufacturer: 'Avery Dennison',
    productCode: 'MPI 1105',
  },
  'avery-mpi1105-satin': {
    type: 'cast-vinyl',
    rollWidthInches: 60,
    printableWidthInches: 58,
    maxLengthInches: 1800,
    laminate: 'satin',
    manufacturer: 'Avery Dennison',
    productCode: 'MPI 1105',
  },
  'generic-60': {
    type: 'cast-vinyl',
    rollWidthInches: 60,
    printableWidthInches: 58,
    maxLengthInches: 1800,
    laminate: 'gloss',
  },
  'generic-54': {
    type: 'cast-vinyl',
    rollWidthInches: 54,
    printableWidthInches: 52,
    maxLengthInches: 1800,
    laminate: 'gloss',
  },
  'reflective': {
    type: 'reflective',
    rollWidthInches: 48,
    printableWidthInches: 46,
    maxLengthInches: 600,
    laminate: 'none',
  },
};

// ---------------------------------------------------------------------------
// Print Marks Configuration
// ---------------------------------------------------------------------------

/** Full professional print marks */
export const FULL_PRINT_MARKS: PrintMarks = {
  cropMarks: true,
  registrationMarks: true,
  colorBars: true,
  foldMarks: false,
  panelLabels: true,
  dimensionLabels: true,
};

/** Minimal marks (crop only) */
export const MINIMAL_PRINT_MARKS: PrintMarks = {
  cropMarks: true,
  registrationMarks: false,
  colorBars: false,
  foldMarks: false,
  panelLabels: true,
  dimensionLabels: false,
};

/** No marks (AI-generated panels for preview only) */
export const NO_PRINT_MARKS: PrintMarks = {
  cropMarks: false,
  registrationMarks: false,
  colorBars: false,
  foldMarks: false,
  panelLabels: false,
  dimensionLabels: false,
};

// ---------------------------------------------------------------------------
// Color Profiles
// ---------------------------------------------------------------------------

export const COLOR_PROFILES: Record<string, ColorProfile> = {
  srgb: {
    name: 'sRGB IEC61966-2.1',
    space: 'rgb',
    renderingIntent: 'perceptual',
  },
  fogra39: {
    name: 'ISO Coated v2 (FOGRA39)',
    space: 'cmyk',
    renderingIntent: 'relative',
  },
  gracol: {
    name: 'GRACoL2013_CRPC6',
    space: 'cmyk',
    renderingIntent: 'relative',
  },
  swop: {
    name: 'US Web Coated (SWOP) v2',
    space: 'cmyk',
    renderingIntent: 'perceptual',
  },
};

// ---------------------------------------------------------------------------
// Crop Mark Geometry
// ---------------------------------------------------------------------------

/** Length of crop mark lines (inches) */
export const CROP_MARK_LENGTH = 0.375;

/** Offset of crop marks from trim edge (inches) */
export const CROP_MARK_OFFSET = 0.125;

/** Crop mark line weight (points) - 0.25pt is industry standard */
export const CROP_MARK_WEIGHT_PT = 0.25;

/** Registration mark diameter (inches) */
export const REGISTRATION_MARK_DIAMETER = 0.375;

/** Color bar strip height (inches) */
export const COLOR_BAR_HEIGHT = 0.25;

// ---------------------------------------------------------------------------
// Print Time Estimates (based on typical 1440 DPI eco-solvent printer)
// ---------------------------------------------------------------------------

/** Approximate print speed: sq ft per hour at production quality */
export const PRINT_SPEED_SQFT_PER_HOUR = 120;

/** Setup time per job in minutes */
export const JOB_SETUP_MINUTES = 15;
