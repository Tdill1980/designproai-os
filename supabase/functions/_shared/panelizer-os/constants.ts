/**
 * panelizer-os/constants.ts — Shared constants for the Panelizer OS pipeline
 *
 * All panel dimensions, DPI specs, vehicle sq-ft data, and storage paths
 * used across the chain of small edge functions.
 *
 * This replicates what RIP software (ONYX, Caldera, Wasatch) uses
 * for panel sizing, bleed, crop marks, and color conversion.
 */

// ── Storage ──────────────────────────────────────────────────────
export const BUCKET = "wrap-files";
export const TEMP_PREFIX = "production-packs";
export const FINAL_PREFIX = "production-packs";

// ── DPI & Output ─────────────────────────────────────────────────
// Files are produced at 10% of actual size. RIP software scales to 1000%.
// TIFF metadata declares 1500 DPI at 10% scale = 150 DPI at full size.
// Pixel formula: panel_inches × 150 = pixel dimensions.
// Example: Side 155" × 57" → 23,250 × 8,550 px (1500 DPI at 10% → 150 DPI full size).
export const PRINT_DPI = 1500;          // Embedded in TIFF metadata (at 10% scale = 150 DPI full size)
export const OUTPUT_DPI = 1500;         // Used for pixel calculations with OUTPUT_SCALE
export const FULL_SIZE_DPI = 150;       // Effective DPI when RIP scales to 1000%
export const OUTPUT_SCALE = 0.10;       // 10% scale factor (RIP software scales to full)
export const MAX_MEGAPIXELS = 16;       // Edge function memory safe (~64 MB RGBA + encoding overhead, fits 256MB limit)
export const BLEED_INCHES = 1.5;        // 1.5" bleed on all edges (WePrintWraps standard)

// ── Crop Mark Config ─────────────────────────────────────────────
export const CROP_MARK_LENGTH_INCHES = 0.375; // 3/8" crop marks
export const CROP_MARK_WEIGHT_PT = 0.5;       // Hairline weight
export const CROP_MARK_OFFSET_INCHES = 0.125; // 1/8" gap from trim line

// ── Master Texture Reference ─────────────────────────────────────
export const MASTER_WIDTH_INCHES = 240;
export const MASTER_HEIGHT_INCHES = 59.5;

// ── Tiling / Split Panel Support ────────────────────────────────
// Panels taller than MAX_TILE_INCHES get split into upper + lower tiles.
// 59" = max printable height on standard 60" vinyl roll with trim.
// Most full-size pickup truck sides (~57") fit in a single panel on a 60" roll.
// Adjacent tiles overlap by OVERLAP_INCHES at the seam for seamless install.
export const ROLL_WIDTH_INCHES = 60;    // standard vinyl roll width
export const MAX_TILE_INCHES = 59;      // max panel height before splitting (roll width minus bleed + trim)
export const OVERLAP_INCHES = 1.0;      // 1" overlap at seams between tiles
export const TWO_PANEL_HEIGHT_THRESHOLD = MAX_TILE_INCHES; // legacy alias
// Max printable panel height: roll width minus bleed on both edges minus 1" trim margin
export const MAX_PRINTABLE_HEIGHT = ROLL_WIDTH_INCHES - BLEED_INCHES * 2 - 1; // 55.5" at 1.5" bleed

// ── Pixels Per Inch ─────────────────────────────────────────────
// inches × PPI = pixels. PPI = 150 DPI × 1.0 scale = 150 px/inch.
export const PPI = PRINT_DPI * OUTPUT_SCALE; // 150 pixels per inch
export const BLEED_PX = Math.round(BLEED_INCHES * PPI); // 225 pixels (1.5" × 150 PPI)

// ── Panel Dimensions (WePrintWraps standard) ─────────────────────
export interface PanelSpec {
  widthInches: number;
  heightInches: number;
  label: string;
}

export const SIDE_PANELS: Record<string, PanelSpec> = {
  small:  { widthInches: 144,  heightInches: 59.5, label: "Side Panel Small" },
  medium: { widthInches: 172,  heightInches: 59.5, label: "Side Panel Medium" },
  large:  { widthInches: 200,  heightInches: 59.5, label: "Side Panel Large" },
  xl:     { widthInches: 240,  heightInches: 59.5, label: "Side Panel XL" },
};

export const ADDON_PANELS: Record<string, PanelSpec> = {
  hood:        { widthInches: 72,    heightInches: 59.5, label: "Hood" },
  frontBumper: { widthInches: 120.5, heightInches: 38,   label: "Front Bumper" },
  rear:        { widthInches: 72.5,  heightInches: 59,   label: "Rear" },
  rearBumper:  { widthInches: 120,   heightInches: 38,   label: "Rear Bumper" },
};

export const ROOF_PANELS: Record<string, PanelSpec> = {
  small:  { widthInches: 72,  heightInches: 59.5, label: "Roof Small" },
  medium: { widthInches: 110, heightInches: 59.5, label: "Roof Medium" },
  large:  { widthInches: 160, heightInches: 59.5, label: "Roof Large" },
};

// ── Vehicle Dimensions ──────────────────────────────────────────
// Real sq-ft data from CSV database + inline fallbacks.
// lookupVehicle() searches the 260-row CSV database first, then falls back.
import {
  lookupVehicleFromDB,
  classifyVehicle,
  VEHICLE_DB,
  type VehicleRecord,
  type VehicleCategory,
} from "./vehicle-database.ts";

export interface VehicleDimensions {
  bodyLengthInches: number;
  bodyHeightInches: number;
  hoodWidthInches: number;
  hoodLengthInches: number;
  roofLengthInches: number;
  roofWidthInches: number;
  backWidthInches: number;
  backHeightInches: number;
  totalSqFt: number;
  wheelbaseInches?: number;
  overallLengthInches?: number;
  category: VehicleCategory;
  source: "csv" | "inline" | "fallback" | "google_search" | "trailer";
}

export type { VehicleCategory, VehicleRecord };

// Lookup map keyed by lowercase model name for quick "is this vehicle in the DB?" checks.
// Used by panelizer-step-validate's estimateOnly mode.
export const VEHICLE_DIMENSIONS: Record<string, VehicleDimensions> = {};
for (const v of VEHICLE_DB) {
  const key = v.model.toLowerCase().trim();
  const category = classifyVehicle(v.make, v.model);
  VEHICLE_DIMENSIONS[key] = {
    bodyLengthInches: v.sideWidth,
    bodyHeightInches: v.sideHeight,
    hoodWidthInches: v.hoodWidth || 56,
    hoodLengthInches: v.hoodLength || 36,
    roofLengthInches: v.roofLength || 66,
    roofWidthInches: v.roofWidth || 44,
    backWidthInches: v.backWidth || 66,
    backHeightInches: v.backHeight || 42,
    totalSqFt: v.totalSqFt || 0,
    category,
    source: "csv",
  };
}

// Legacy inline dimensions map is replaced by the CSV vehicle database.
// See vehicle-database.ts for the full 260-row lookup with fuzzy matching.
// CATEGORY_DEFAULTS kept for backward compatibility.
export const CATEGORY_DEFAULTS: Record<string, VehicleDimensions> = {
  compact:  { bodyLengthInches: 155, bodyHeightInches: 48, hoodWidthInches: 52, hoodLengthInches: 36, roofLengthInches: 58, roofWidthInches: 42, backWidthInches: 64, backHeightInches: 40, totalSqFt: 170, category: "compact", source: "fallback" },
  midsize:  { bodyLengthInches: 175, bodyHeightInches: 50, hoodWidthInches: 56, hoodLengthInches: 42, roofLengthInches: 66, roofWidthInches: 44, backWidthInches: 66, backHeightInches: 42, totalSqFt: 200, category: "midsize", source: "fallback" },
  fullsize: { bodyLengthInches: 195, bodyHeightInches: 54, hoodWidthInches: 62, hoodLengthInches: 48, roofLengthInches: 72, roofWidthInches: 50, backWidthInches: 72, backHeightInches: 44, totalSqFt: 240, category: "fullsize", source: "fallback" },
  suv:      { bodyLengthInches: 190, bodyHeightInches: 60, hoodWidthInches: 60, hoodLengthInches: 40, roofLengthInches: 90, roofWidthInches: 52, backWidthInches: 72, backHeightInches: 48, totalSqFt: 250, category: "suv", source: "fallback" },
  truck:    { bodyLengthInches: 200, bodyHeightInches: 65, hoodWidthInches: 68, hoodLengthInches: 50, roofLengthInches: 70, roofWidthInches: 58, backWidthInches: 76, backHeightInches: 54, totalSqFt: 290, category: "truck", source: "fallback" },
  van:      { bodyLengthInches: 218, bodyHeightInches: 90, hoodWidthInches: 58, hoodLengthInches: 40, roofLengthInches: 160, roofWidthInches: 58, backWidthInches: 70, backHeightInches: 62, totalSqFt: 380, category: "van", source: "fallback" },
};

// ── WPW Aspect Ratios for Gemini API ────────────────────────────
// These are passed to imageConfig.aspectRatio in the Gemini API call
// so the AI generates flat panels at the exact panel proportions.
export const WPW_ASPECT_RATIOS: Record<string, string> = {
  // Side panels
  "side:small":  "29:12",   // 144 × 59.5"
  "side:medium": "35:12",   // 172 × 59.5"
  "side:large":  "40:12",   // 200 × 59.5"
  "side:xl":     "48:12",   // 240 × 59.5"
  // Addon panels
  "hood":          "6:5",     // 72 × 59.5"
  "front-bumper":  "241:76",  // 120.5 × 38"
  "rear":          "145:118", // 72.5 × 59"
  "rear-bumper":   "60:19",   // 120 × 38"
  // Roof panels
  "roof:small":  "6:5",    // 72 × 59.5"
  "roof:medium": "22:12",  // 110 × 59.5"
  "roof:large":  "32:12",  // 160 × 59.5"
};

/**
 * Get the Gemini aspect ratio for a panel.
 * @param panelKey  Panel identifier: 'driver-side', 'hood', 'roof', etc.
 * @param panelType 'side' | 'addon' | 'roof'
 * @param sideSize  Size for side panels: 'small' | 'medium' | 'large' | 'xl'
 * @param roofSize  Size for roof panels: 'small' | 'medium' | 'large'
 */
export function getAspectRatioForPanel(
  panelKey: string,
  panelType: string,
  sideSize?: string,
  roofSize?: string,
): string | null {
  if (panelType === "side") {
    return WPW_ASPECT_RATIOS[`side:${sideSize || "medium"}`] || null;
  }
  if (panelType === "roof") {
    return WPW_ASPECT_RATIOS[`roof:${roofSize || "medium"}`] || null;
  }
  // Addon panels — use panelKey directly (hood, front-bumper, rear, rear-bumper)
  return WPW_ASPECT_RATIOS[panelKey] || null;
}

// ── Gemini Config ────────────────────────────────────────────────
// gemini-3-pro-image-preview (Nano Banana Pro) — NO shutdown date announced.
// The March 9 shutdown is for gemini-3-pro-preview (TEXT model), not image.
// PRIMARY: gemini-3-pro-image-preview (highest quality)
// FALLBACK: gemini-3.1-flash-image-preview (Nano Banana 2 — 4K, fast)
export const GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview";
export const GEMINI_FALLBACK_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
export const GEMINI_QA_MODEL = "gemini-2.5-flash"; // gemini-2.0-flash retired by Google

// Gemini supported aspect ratios for image generation.
// 4:1, 8:1, 1:4, 1:8 are NOT supported by gemini-3-pro-image-preview (400 error).
// Wide panels (side large/xl) fall back to 21:9 or null (auto).
export const GEMINI_SUPPORTED_RATIOS = [
  "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9",
] as const;

/**
 * Map a custom aspect ratio to the nearest Gemini-supported ratio.
 * Accepts either a ratio string — toSupportedRatio("48:12") — or explicit
 * dimensions — toSupportedRatio(width, height) — so callers can pass the
 * resolved panel W×H directly. Input "48:12" (= 4.0) → "21:9" (= 2.33, closest
 * wide option). If already a supported ratio, returns it unchanged.
 */
export function toSupportedRatio(ratioOrWidth: string | number, height?: number): string {
  const ratio = typeof ratioOrWidth === "number"
    ? (ratioOrWidth > 0 && (height || 0) > 0 ? `${ratioOrWidth}:${height}` : "")
    : ratioOrWidth;
  if (!ratio) return "16:9";
  if (GEMINI_SUPPORTED_RATIOS.includes(ratio as any)) return ratio;
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return "16:9";
  const target = w / h;
  let best: string = GEMINI_SUPPORTED_RATIOS[0];
  let bestDiff = Infinity;
  for (const sr of GEMINI_SUPPORTED_RATIOS) {
    const [sw, sh] = sr.split(":").map(Number);
    const diff = Math.abs(sw / sh - target);
    if (diff < bestDiff) { bestDiff = diff; best = sr; }
  }
  return best;
}

// ── Replicate Config ─────────────────────────────────────────────
export const REPLICATE_MODEL_VERSION = "f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa";
export const REPLICATE_POLL_MAX = 30;
export const REPLICATE_POLL_INTERVAL_MS = 1000;

// Crop model — lightweight Cog model that accepts image + fractional crop coords.
// Deploy via: cog push r8.im/<your-org>/image-crop
// Then paste the version hash here.
export const REPLICATE_CROP_MODEL_VERSION = "DEPLOY_COG_MODEL_AND_PASTE_VERSION_HERE";

// ── Pipeline Identity ────────────────────────────────────────────
// GENIE — Graphic Export Native Intelligence Engine
// The AI file output specialist that reverse-engineers 3D renders into
// flat, print-ready production panels. Like a real file output specialist
// at WePrintWraps.com — the artist creates the design, GENIE creates the files.
export const PIPELINE_NAME = "GENIE Production Panelizer OS";
export const PIPELINE_VERSION = "7.0-genie";

// ── Few-Shot Reference Examples ─────────────────────────────────
// Real WPW proof sheets that show GENIE Production Panelizer OS what professional output looks like.
// Stored in Supabase Storage. Gemini receives one example per call
// so it understands the quality standard and flat-panel format.
// Category map: pick the closest example for the vehicle being processed.
export const GENIE_EXAMPLES_PREFIX = "genie-examples";

export const GENIE_EXAMPLE_FILES: Record<string, string> = {
  car: "car-proof-sheet.png",       // Fallout Camaro — flat panels for a car
  van: "van-proof-sheet.png",       // Marz Mechanical Transit — two-panel van
  truck: "truck-proof-sheet.png",   // Truck example (falls back to car if missing)
  suv: "suv-proof-sheet.png",       // SUV example (falls back to car if missing)
};

// Map vehicle categories to example keys (with fallback chain)
export function getExampleKeyForCategory(category: string): string[] {
  switch (category) {
    case "van":      return ["van", "truck", "car"];
    case "truck":    return ["truck", "car"];
    case "suv":      return ["suv", "truck", "car"];
    case "compact":
    case "midsize":
    case "fullsize": return ["car"];
    default:         return ["car"];
  }
}

// ── Helper: memory-safe DPI ──────────────────────────────────────
// Calculates pixel dimensions at OUTPUT_DPI × OUTPUT_SCALE (= 75 px/inch).
// If the resulting megapixels exceed MAX_MEGAPIXELS, reduces DPI to fit.
export function getSafeDpi(widthInches: number, heightInches: number): { dpi: number; capped: boolean } {
  const wScaled = (widthInches + BLEED_INCHES * 2) * OUTPUT_SCALE;
  const hScaled = (heightInches + BLEED_INCHES * 2) * OUTPUT_SCALE;
  const targetMp = (wScaled * OUTPUT_DPI) * (hScaled * OUTPUT_DPI) / 1_000_000;

  if (targetMp <= MAX_MEGAPIXELS) {
    return { dpi: OUTPUT_DPI, capped: false };
  }
  const area = wScaled * hScaled;
  const maxDpi = Math.floor(Math.sqrt(MAX_MEGAPIXELS * 1_000_000 / area));
  console.log(`[DPI] Panel ${widthInches}"×${heightInches}" would be ${targetMp.toFixed(1)} MP at ${OUTPUT_DPI} DPI — capped to ${maxDpi} DPI (${(area * maxDpi * maxDpi / 1_000_000).toFixed(1)} MP)`);
  return { dpi: maxDpi, capped: true };
}

// ── Helper: storage paths ────────────────────────────────────────
export function tempPath(userId: string, jobId: string, stepName: string, ext = "png"): string {
  return `${TEMP_PREFIX}/${userId}/temp/${jobId}/${stepName}.${ext}`;
}

export function finalPath(userId: string, orderNumber: string, filename: string): string {
  return `${FINAL_PREFIX}/${userId}/${orderNumber}/${filename}`;
}

// ── Helper: look up vehicle dimensions ───────────────────────────
// Searches the 260-row CSV database first, then category fallbacks.
// NEVER defaults to 240" × 59.5" — uses real vehicle dimensions.
export function lookupVehicle(make: string, model: string): VehicleDimensions {
  const { record, category, source } = lookupVehicleFromDB(make, model);

  if (source === "csv") {
    return {
      bodyLengthInches: record.sideWidth,
      bodyHeightInches: record.sideHeight,
      hoodWidthInches: record.hoodWidth || CATEGORY_DEFAULTS[category]?.hoodWidthInches || 56,
      hoodLengthInches: record.hoodLength || CATEGORY_DEFAULTS[category]?.hoodLengthInches || 36,
      roofLengthInches: record.roofLength || CATEGORY_DEFAULTS[category]?.roofLengthInches || 66,
      roofWidthInches: record.roofWidth || CATEGORY_DEFAULTS[category]?.roofWidthInches || 44,
      backWidthInches: record.backWidth || CATEGORY_DEFAULTS[category]?.backWidthInches || 66,
      backHeightInches: record.backHeight || CATEGORY_DEFAULTS[category]?.backHeightInches || 42,
      totalSqFt: record.totalSqFt || 0,
      category,
      source: "csv",
    };
  }

  // Fallback to category defaults
  return CATEGORY_DEFAULTS[category] || CATEGORY_DEFAULTS.midsize;
}

// ── Helper: check if vehicle needs two panels per side ──────────
// Splits at MAX_TILE_INCHES (53.5") — any panel zone taller than this
// gets tiled into upper + lower with OVERLAP_INCHES (1") overlap.
export function isTwoPanelVehicle(vehicle: VehicleDimensions): boolean {
  return vehicle.bodyHeightInches > MAX_TILE_INCHES;
}

// ── Helper: GCD for aspect ratio simplification ─────────────────
function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

// ── Helper: master texture aspect ratio for two-panel vehicles ──
// Master must capture full body height (not just 59.5") so the
// upper and lower crop zones get the correct design content.
export function getTwoPanelMasterRatio(bodyHeightInches: number, sideWidthInches: number): string {
  const w = Math.round(sideWidthInches);
  const h = Math.round(bodyHeightInches);
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

// ── Helper: validate panel size vs vehicle ───────────────────────
export interface SizeValidation {
  fits: boolean;
  coveragePercent: number;
  recommendation: string;
  validatedWidth: number;
  validatedHeight: number;
  twoPanel: boolean;
  bodyHeightInches: number;
}

export function validatePanelSize(
  sideSize: string,
  vehicle: VehicleDimensions,
): SizeValidation {
  const panel = SIDE_PANELS[sideSize];
  if (!panel) {
    return {
      fits: false,
      coveragePercent: 0,
      recommendation: `Unknown size: ${sideSize}`,
      validatedWidth: 172,
      validatedHeight: 59.5,
      twoPanel: false,
      bodyHeightInches: vehicle.bodyHeightInches,
    };
  }

  const twoPanel = isTwoPanelVehicle(vehicle);
  const widthCoverage = (panel.widthInches / vehicle.bodyLengthInches) * 100;

  // For two-panel vehicles, height is covered by stacking two 59.5" panels.
  // Two panels × 59.5" = 119" — covers any production van (Transit 90", Sprinter 96").
  const heightCoverage = twoPanel
    ? ((panel.heightInches * 2) / vehicle.bodyHeightInches) * 100
    : (panel.heightInches / vehicle.bodyHeightInches) * 100;

  const fits = widthCoverage >= 90 && (twoPanel || heightCoverage >= 85);

  let recommendation = "";
  if (widthCoverage < 90) {
    // Find minimum size that covers
    const sizes = Object.entries(SIDE_PANELS);
    for (const [key, spec] of sizes) {
      if ((spec.widthInches / vehicle.bodyLengthInches) * 100 >= 90) {
        recommendation = `Upgrade to ${key} (${spec.widthInches}" covers ${((spec.widthInches / vehicle.bodyLengthInches) * 100).toFixed(0)}%)`;
        break;
      }
    }
    if (!recommendation) recommendation = "Vehicle may be too large for standard panels";
  } else if (twoPanel) {
    recommendation = `${sideSize} covers ${widthCoverage.toFixed(0)}% width — two panels per side at body line break`;
  } else {
    recommendation = `${sideSize} covers ${widthCoverage.toFixed(0)}% width — good fit`;
  }

  return {
    fits,
    coveragePercent: Math.min(widthCoverage, heightCoverage),
    recommendation,
    validatedWidth: panel.widthInches,
    validatedHeight: panel.heightInches,
    twoPanel,
    bodyHeightInches: vehicle.bodyHeightInches,
  };
}

// ── Helper: inches to pixels at 10% scale ────────────────────────
// Formula: inches × PPI (75) = pixels.
// This gives the actual pixel dimensions of the output files.
export function inchesToPx(inches: number): number {
  return Math.round(inches * PPI);
}
