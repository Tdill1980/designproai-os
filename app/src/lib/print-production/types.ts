/**
 * Print Production OS - Core Type Definitions
 *
 * These types model the entire deterministic print production pipeline:
 * Vehicle → Panel Geometry → Design Placement → Bleed/Overlap →
 * Nesting on Roll → Print Marks → RIP-Ready File Output
 */

// ---------------------------------------------------------------------------
// Units & Measurement
// ---------------------------------------------------------------------------

/** All internal measurements are in inches unless stated otherwise */
export type Inches = number;
export type Pixels = number;
export type SquareFeet = number;
export type DPI = number;

export interface Dimension2D {
  width: Inches;
  height: Inches;
}

export interface PixelDimension {
  width: Pixels;
  height: Pixels;
}

export interface BoundingBox {
  x: Inches;
  y: Inches;
  width: Inches;
  height: Inches;
}

// ---------------------------------------------------------------------------
// Color Management
// ---------------------------------------------------------------------------

export interface CMYKColor {
  c: number; // 0–100
  m: number; // 0–100
  y: number; // 0–100
  k: number; // 0–100
}

export interface RGBColor {
  r: number; // 0–255
  g: number; // 0–255
  b: number; // 0–255
}

export type ColorSpace = 'rgb' | 'cmyk' | 'spot';

export interface SpotColor {
  name: string;       // e.g. "PANTONE 185 C"
  fallbackCmyk: CMYKColor;
  fallbackRgb: RGBColor;
}

export interface ColorProfile {
  name: string;            // e.g. "FOGRA39", "GRACoL2013"
  space: ColorSpace;
  renderingIntent: 'perceptual' | 'relative' | 'saturation' | 'absolute';
}

// ---------------------------------------------------------------------------
// Media & Substrate
// ---------------------------------------------------------------------------

export type MediaType = 'cast-vinyl' | 'calendered-vinyl' | 'reflective' | 'perforated' | 'clear';
export type LaminateType = 'gloss' | 'satin' | 'matte' | 'none';

export interface MediaSpec {
  type: MediaType;
  rollWidthInches: Inches;        // Standard: 54" or 60"
  printableWidthInches: Inches;   // Actual printable width after margins (e.g., 52" or 58")
  maxLengthInches: Inches;        // Max roll length (typically 150 feet = 1800")
  laminate: LaminateType;
  manufacturer?: string;          // e.g., "3M", "Avery Dennison"
  productCode?: string;           // e.g., "IJ180Cv3"
}

export const DEFAULT_MEDIA: MediaSpec = {
  type: 'cast-vinyl',
  rollWidthInches: 60,
  printableWidthInches: 58,
  maxLengthInches: 1800,
  laminate: 'gloss',
};

// ---------------------------------------------------------------------------
// Vehicle Panel Zones
// ---------------------------------------------------------------------------

export type PanelZone =
  | 'driver-side'
  | 'passenger-side'
  | 'hood'
  | 'roof'
  | 'rear'
  | 'front-bumper'
  | 'rear-bumper'
  | 'trunk';

export interface VehiclePanel {
  zone: PanelZone;
  label: string;
  widthInches: Inches;
  heightInches: Inches;
  sqFt: SquareFeet;
  /** Passenger side is mirrored print of driver side */
  mirrored: boolean;
  /** Overlap required with adjacent panels */
  overlapInches: Inches;
}

export interface VehiclePanelSet {
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  panels: VehiclePanel[];
  totalSqFt: SquareFeet;
  correctedSqFt: SquareFeet;
}

// ---------------------------------------------------------------------------
// Print Specifications (the "job ticket")
// ---------------------------------------------------------------------------

export interface BleedSpec {
  topInches: Inches;
  bottomInches: Inches;
  leftInches: Inches;
  rightInches: Inches;
}

export interface OverlapSpec {
  /** Extra material for seam overlap between adjacent panels */
  seamOverlapInches: Inches;
  /** Side the overlap extends from */
  side: 'left' | 'right' | 'both';
}

export interface PrintMarks {
  cropMarks: boolean;
  registrationMarks: boolean;
  colorBars: boolean;
  foldMarks: boolean;
  panelLabels: boolean;
  dimensionLabels: boolean;
}

export type OutputFormat = 'pdf' | 'svg' | 'png';
export type OutputScale = 'full' | '50%' | '25%' | '10%';

export interface OutputSpec {
  format: OutputFormat;
  dpi: DPI;
  scale: OutputScale;
  colorProfile: ColorProfile;
  embedFonts: boolean;
}

export interface PrintJobSpec {
  id: string;
  createdAt: string;
  vehiclePanels: VehiclePanelSet;
  media: MediaSpec;
  bleed: BleedSpec;
  overlap: OverlapSpec;
  marks: PrintMarks;
  output: OutputSpec;
  designSource: DesignSource;
}

// ---------------------------------------------------------------------------
// Design Sources
// ---------------------------------------------------------------------------

export type DesignSourceType = 'solid-color' | 'pattern-tile' | 'gradient-fade' | 'custom-upload' | 'ai-generated';

export interface DesignSource {
  type: DesignSourceType;
  /** For solid color */
  color?: RGBColor | CMYKColor | SpotColor;
  /** For pattern/tile/upload - URL to source image */
  imageUrl?: string;
  /** For gradient fades */
  gradient?: GradientSpec;
  /** Finish applied on top */
  finish: LaminateType;
}

export interface GradientSpec {
  type: 'linear' | 'radial';
  angle: number;   // degrees, 0 = left-to-right
  stops: Array<{ position: number; color: RGBColor }>;
}

// ---------------------------------------------------------------------------
// Nesting / Roll Layout
// ---------------------------------------------------------------------------

export interface NestedPanel {
  panel: VehiclePanel;
  /** Position on the roll media */
  rollX: Inches;    // Distance from left edge of roll
  rollY: Inches;    // Distance from roll start (unrolled length)
  /** Total dimensions including bleed */
  totalWidth: Inches;
  totalHeight: Inches;
  /** Whether this panel is rotated 90° to fit */
  rotated: boolean;
}

export interface RollLayout {
  media: MediaSpec;
  panels: NestedPanel[];
  /** Total linear footage used */
  totalLengthInches: Inches;
  totalLengthFeet: number;
  /** Waste percentage */
  wastePercent: number;
  /** Utilization percentage */
  utilizationPercent: number;
}

// ---------------------------------------------------------------------------
// Production Output
// ---------------------------------------------------------------------------

export interface ProductionFile {
  panelZone: PanelZone;
  label: string;
  /** Blob URL for download */
  blobUrl: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Pixel dimensions of the output */
  dimensions: PixelDimension;
  /** Physical dimensions (at full scale) */
  physicalDimensions: Dimension2D;
}

export interface ProductionResult {
  jobSpec: PrintJobSpec;
  rollLayout: RollLayout;
  files: ProductionFile[];
  /** Combined roll layout sheet (all panels on roll) */
  rollLayoutFile?: ProductionFile;
  /** Summary for display */
  summary: ProductionSummary;
}

export interface ProductionSummary {
  totalPanels: number;
  totalSqFt: SquareFeet;
  mediaUsedFeet: number;
  wastePercent: number;
  estimatedPrintTime: string;
  rollsRequired: number;
}
