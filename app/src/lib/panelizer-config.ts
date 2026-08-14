/**
 * GENIE Production Panelizer OS - Configuration
 *
 * All panel dimensions from WePrintWraps production specs.
 * Panel heights now come from the 260-row vehicle measurements CSV database.
 * Vehicles taller than 53.5" get tiled into Panel 1 (upper) + Panel 2 (lower).
 *
 * Output files are generated at 10% scale with 750 DPI embedded in TIFF.
 * RIP software scales to 1000% for full-size output.
 *
 * Pixel formula: inches × PPI (75) = pixels
 * PPI = PRINT_DPI (750) × OUTPUT_SCALE (0.10) = 75 px/inch
 * Example: Side 218" × 53.5" → 16,350 × 4,013 px
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SidePanelSize = 'small' | 'medium' | 'large' | 'xl';
export type RoofSize = 'none' | 'small' | 'medium' | 'large';

export interface PanelDimension {
  widthInches: number;
  heightInches: number;
  label: string;
  hint: string;
}

/** Real vehicle dimensions from the 1600-row measurement database */
export interface VehicleDims {
  sideW: number;
  sideH: number;
  hoodW?: number;
  hoodL?: number;
  roofW?: number;
  roofL?: number;
  backW?: number;
  backH?: number;
}

export interface PanelSelection {
  sideSize: SidePanelSize;
  addHood: boolean;
  addFrontBumper: boolean;
  addRearBumper: boolean;
  roofSize: RoofSize;
  /** True for tall vehicles (vans) that need upper + lower panels per side */
  twoPanel?: boolean;
  /** Real vehicle dimensions from database — overrides universal tier sizes when present */
  vehicleDims?: VehicleDims;
}

export interface ProductionPackConfig {
  panels: PanelSelection;
  finish: string;
  generationId: string;
  panelUrl: string;
}

// ---------------------------------------------------------------------------
// Side panel dimensions (x2 - driver + passenger, passenger is mirrored)
// ---------------------------------------------------------------------------

export const SIDE_PANELS: Record<SidePanelSize, PanelDimension> = {
  small:  { widthInches: 144,  heightInches: 59.5, label: 'Small',  hint: 'Sedans, coupes' },
  medium: { widthInches: 172,  heightInches: 59.5, label: 'Medium', hint: 'Midsize SUVs, crossovers' },
  large:  { widthInches: 200,  heightInches: 59.5, label: 'Large',  hint: 'Full-size trucks, vans' },
  xl:     { widthInches: 240,  heightInches: 59.5, label: 'XL',     hint: 'Box trucks, extended vans' },
};

// ---------------------------------------------------------------------------
// Add-on panels (universal sizes)
// ---------------------------------------------------------------------------

export const ADDON_PANELS = {
  hood:         { widthInches: 72,    heightInches: 59.5, label: 'Hood' },
  frontBumper:  { widthInches: 120.5, heightInches: 38,   label: 'Front Bumper' },
  rearBumper:   { widthInches: 120,   heightInches: 38,   label: 'Rear Bumper' },
  rear:         { widthInches: 72.5,  heightInches: 59,   label: 'Rear' },
} as const;

// ---------------------------------------------------------------------------
// Roof sizes
// ---------------------------------------------------------------------------

export const ROOF_PANELS: Record<Exclude<RoofSize, 'none'>, PanelDimension> = {
  small:  { widthInches: 72,  heightInches: 59.5, label: 'Roof Small',  hint: 'Coupes, sedans' },
  medium: { widthInches: 110, heightInches: 59.5, label: 'Roof Medium', hint: 'SUVs, crossovers' },
  large:  { widthInches: 160, heightInches: 59.5, label: 'Roof Large',  hint: 'Vans, box trucks' },
};

// ---------------------------------------------------------------------------
// Print specs
// ---------------------------------------------------------------------------

export const BLEED_INCHES = 0.5;
export const PRINT_DPI = 1500;      // Embedded in TIFF metadata (at 10% scale = 150 DPI full size)
export const MIN_DPI = 1500;        // Legacy alias - always use PRINT_DPI
export const OUTPUT_SCALE = 0.10;   // 10% scale - RIP scales to 1000% = 150 DPI full size
export const PPI = PRINT_DPI * OUTPUT_SCALE; // 150 px/inch
export const OUTPUT_FORMAT = 'png' as const;

// ---------------------------------------------------------------------------
// Pricing (V1 - flat rate)
// ---------------------------------------------------------------------------

export const PRODUCTION_PACK_PRICE_CENTS = 29900; // $299.00

// ---------------------------------------------------------------------------
// Pixel math helpers
// ---------------------------------------------------------------------------

/** Convert inches to pixels using PPI (75 px/inch at 10% scale) */
export function inchesToPixels(inches: number, dpi: number = PRINT_DPI): number {
  return Math.round(inches * PPI);
}

/** Get output pixel dimensions for a panel at 10% scale with bleed */
export function panelPixelDimensions(
  widthInches: number,
  heightInches: number,
  dpi: number = PRINT_DPI,
  bleed: number = BLEED_INCHES,
  scale: number = OUTPUT_SCALE,
): { width: number; height: number; widthWithBleed: number; heightWithBleed: number } {
  return {
    width: Math.round(widthInches * PPI),
    height: Math.round(heightInches * PPI),
    widthWithBleed: Math.round((widthInches + bleed * 2) * PPI),
    heightWithBleed: Math.round((heightInches + bleed * 2) * PPI),
  };
}

// ---------------------------------------------------------------------------
// Pack panel list builder
// ---------------------------------------------------------------------------

export interface PackPanel {
  id: string;
  label: string;
  widthInches: number;
  heightInches: number;
  mirrored: boolean;
  cropZone?: 'upper' | 'lower';
}

// Two-panel height threshold - matches server-side constant (MAX_TILE_INCHES).
// If vehicle body height exceeds 59" (max printable on 60" roll with trim),
// panels are split into Panel 1 (upper) + Panel 2 (lower) with 1" overlap.
// Most full-size pickup truck side heights (~57") fit in a single panel on a 60" roll.
export const MAX_TILE_INCHES = 59;
export const OVERLAP_INCHES = 1.0;
export const TWO_PANEL_HEIGHT_THRESHOLD = MAX_TILE_INCHES;

/** Build the list of panels in a production pack based on user selections.
 *  When vehicleDims is provided (from the 1600-row database), uses REAL
 *  vehicle dimensions instead of the universal tier bucket sizes. */
export function buildPanelList(selection: PanelSelection): PackPanel[] {
  const side = SIDE_PANELS[selection.sideSize];
  const vd = selection.vehicleDims;
  const panels: PackPanel[] = [];

  // Use real vehicle dims when available, fall back to universal tier
  const sideW = vd?.sideW ?? side.widthInches;
  const sideH = vd?.sideH ?? side.heightInches;

  if (selection.twoPanel) {
    // Tall vehicle (van/truck) - two panels per side at body line break
    const upperHeight = MAX_TILE_INCHES;
    const lowerHeight = Math.round((sideH - MAX_TILE_INCHES + OVERLAP_INCHES) * 10) / 10;
    panels.push(
      { id: 'driver-side-panel1', label: `Driver Side - Panel 1`, widthInches: sideW, heightInches: upperHeight, mirrored: false, cropZone: 'upper' },
      { id: 'driver-side-panel2', label: `Driver Side - Panel 2`, widthInches: sideW, heightInches: lowerHeight, mirrored: false, cropZone: 'lower' },
      { id: 'passenger-side-panel1', label: `Passenger Side - Panel 1`, widthInches: sideW, heightInches: upperHeight, mirrored: true, cropZone: 'upper' },
      { id: 'passenger-side-panel2', label: `Passenger Side - Panel 2`, widthInches: sideW, heightInches: lowerHeight, mirrored: true, cropZone: 'lower' },
    );
  } else {
    // Standard - one panel per side
    panels.push(
      { id: 'driver-side', label: 'Driver Side', widthInches: sideW, heightInches: sideH, mirrored: false },
      { id: 'passenger-side', label: 'Passenger Side', widthInches: sideW, heightInches: sideH, mirrored: true },
    );
  }

  if (selection.addHood) {
    const hoodW = vd?.hoodW ?? ADDON_PANELS.hood.widthInches;
    const hoodL = vd?.hoodL ?? ADDON_PANELS.hood.heightInches;
    panels.push({ id: 'hood', label: 'Hood', widthInches: hoodW, heightInches: hoodL, mirrored: false });
  }

  if (selection.addFrontBumper) {
    panels.push({ id: 'front-bumper', label: 'Front Bumper', widthInches: ADDON_PANELS.frontBumper.widthInches, heightInches: ADDON_PANELS.frontBumper.heightInches, mirrored: false });
  }

  if (selection.addRearBumper) {
    // Includes both rear and rear bumper
    const rearW = vd?.backW ?? ADDON_PANELS.rear.widthInches;
    const rearH = vd?.backH ?? ADDON_PANELS.rear.heightInches;
    panels.push({ id: 'rear', label: 'Rear', widthInches: rearW, heightInches: rearH, mirrored: false });
    panels.push({ id: 'rear-bumper', label: 'Rear Bumper', widthInches: ADDON_PANELS.rearBumper.widthInches, heightInches: ADDON_PANELS.rearBumper.heightInches, mirrored: false });
  }

  if (selection.roofSize !== 'none') {
    const roof = ROOF_PANELS[selection.roofSize];
    const roofW = vd?.roofL ?? roof.widthInches;
    const roofH = vd?.roofW ?? roof.heightInches;
    panels.push({ id: 'roof', label: roof.label, widthInches: roofW, heightInches: roofH, mirrored: false });
  }

  return panels;
}

/** Format inches as display string */
export function formatDimension(widthInches: number, heightInches: number): string {
  return `${widthInches}" × ${heightInches}"`;
}
