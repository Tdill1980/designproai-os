/**
 * DesignProAI QuickQuote — deterministic pricing engine
 *
 * Uses the 1,664-vehicle measurement database for sq ft,
 * converts to linear yards, and applies regional labor rates.
 */

import {
  findVehicle,
  getPanelBreakdown,
  type VehicleMeasurement,
  type PanelBreakdown,
} from "@/data/vehicle-measurements";

// ── Film roll width (industry standard 60" / 5ft) ────────────────
const FILM_ROLL_WIDTH_INCHES = 60;
const FILM_ROLL_WIDTH_FT = FILM_ROLL_WIDTH_INCHES / 12; // 5 ft
const WASTE_FACTOR = 1.15; // 15% waste for cuts, overlap, mistakes

// ── Regional labor rate tiers (per sq ft installed) ──────────────
// Based on wrap industry averages by US metro cost-of-living region

export type PriceRegion = "budget" | "standard" | "premium" | "luxury";

export interface RegionInfo {
  region: PriceRegion;
  label: string;
  laborPerSqFt: number; // $/sq ft for install labor
  description: string;
}

export const REGIONS: Record<PriceRegion, RegionInfo> = {
  budget: {
    region: "budget",
    label: "Budget",
    laborPerSqFt: 4.50,
    description: "Rural / low-cost markets",
  },
  standard: {
    region: "standard",
    label: "Standard",
    laborPerSqFt: 6.50,
    description: "Mid-size cities, suburbs",
  },
  premium: {
    region: "premium",
    label: "Premium",
    laborPerSqFt: 9.00,
    description: "Major metros (Dallas, Atlanta, Denver)",
  },
  luxury: {
    region: "luxury",
    label: "Luxury",
    laborPerSqFt: 12.50,
    description: "NYC, LA, SF, Miami, Chicago",
  },
};

// ── State → Region mapping ───────────────────────────────────────
export const STATE_REGIONS: Record<string, PriceRegion> = {
  // Luxury markets
  CA: "luxury", NY: "luxury", FL: "luxury", IL: "luxury",
  NJ: "luxury", CT: "luxury", MA: "luxury", HI: "luxury",
  DC: "luxury",

  // Premium markets
  TX: "premium", WA: "premium", CO: "premium", GA: "premium",
  VA: "premium", MD: "premium", AZ: "premium", NV: "premium",
  OR: "premium", MN: "premium", NC: "premium", PA: "premium",
  TN: "premium", UT: "premium",

  // Standard markets
  OH: "standard", MI: "standard", IN: "standard", MO: "standard",
  WI: "standard", SC: "standard", AL: "standard", LA: "standard",
  KY: "standard", OK: "standard", IA: "standard", KS: "standard",
  NE: "standard", NM: "standard", NH: "standard", ME: "standard",
  RI: "standard", DE: "standard", VT: "standard", ID: "standard",
  MT: "standard", ND: "standard", SD: "standard", AK: "standard",

  // Budget markets
  AR: "budget", MS: "budget", WV: "budget", WY: "budget",
};

export function getRegionForState(stateCode: string): PriceRegion {
  return STATE_REGIONS[stateCode.toUpperCase()] || "standard";
}

// ── US States list for dropdown ──────────────────────────────────
export const US_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DC", name: "Washington DC" },
  { code: "DE", name: "Delaware" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

// ── Film cost per linear yard by finish ──────────────────────────
// Based on typical 60" roll pricing from major manufacturers
export const FILM_COST_PER_YARD: Record<string, number> = {
  gloss: 28,
  satin: 30,
  matte: 30,
  metallic: 38,
  chrome: 65,
  color_flip: 55,
  brushed: 35,
  carbon: 32,
  textured: 34,
};

export function getFilmCostPerYard(finish: string): number {
  const key = finish.toLowerCase().replace(/[\s-]/g, "_");
  return FILM_COST_PER_YARD[key] || FILM_COST_PER_YARD.gloss;
}

// ── PrintPro pricing (per sq ft for printed wraps) ───────────────
// FadeWraps, PatternPro, DesignPro use printed material priced per sq ft
export const PRINT_COST_PER_SQFT: Record<string, number> = {
  standard: 8.50,    // Standard printed vinyl
  premium: 12.00,    // Premium cast vinyl with lamination
  reflective: 15.00, // Reflective printed vinyl
};

export function getPrintCostPerSqFt(quality: string = "premium"): number {
  return PRINT_COST_PER_SQFT[quality.toLowerCase()] || PRINT_COST_PER_SQFT.premium;
}

// Tools that use PrintPro sq ft pricing vs film yard pricing
export const PRINTPRO_TOOLS = ["PatternPro", "FadeWraps", "DesignPro"];
export function isPrintProTool(toolSource: string): boolean {
  return PRINTPRO_TOOLS.includes(toolSource);
}

// ── WallPro pricing (Avery Dennison® HP MPI 2610 Wall Film) ─────
// Printed at 54" panel width, $3.25 per linear foot.
// Panels billed at full 54" regardless of trimmed size.
export const WALL_FILM = {
  name: "Avery Dennison® HP MPI 2610 Wall Film",
  finish: "Matte / Luster (factory finish)",
  thickness: "6.0 mil calendared vinyl",
  adhesive: "Permanent, clear adhesive",
  opacity: "100% opacity (blocks wall color bleed-through)",
  panelWidthInches: 54,
  pricePerLinearFoot: 3.25,
  installType: "Dry install recommended",
  useCase: "Commercial interiors, offices, retail, gyms, lobbies, murals",
} as const;

export interface WallWrapEstimate {
  heightInches: number;
  widthInches: number;
  totalSqFt: number;
  panelsNeeded: number;
  linearFeetPerPanel: number;
  totalLinearFeet: number;
  materialCost: number;
  filmName: string;
}

/**
 * Calculate wall wrap pricing based on wall dimensions.
 * Panels are 54" wide. Price is $3.25/linear foot.
 * Multiple panels needed for walls wider than 54".
 */
export function calculateWallWrapEstimate(
  heightInches: number,
  widthInches: number,
): WallWrapEstimate {
  const panelsNeeded = Math.ceil(widthInches / WALL_FILM.panelWidthInches);
  const linearFeetPerPanel = heightInches / 12;
  const totalLinearFeet = Math.round(panelsNeeded * linearFeetPerPanel * 100) / 100;
  const materialCost = Math.round(totalLinearFeet * WALL_FILM.pricePerLinearFoot * 100) / 100;
  const totalSqFt = Math.round((heightInches * widthInches) / 144 * 100) / 100;

  return {
    heightInches,
    widthInches,
    totalSqFt,
    panelsNeeded,
    linearFeetPerPanel: Math.round(linearFeetPerPanel * 100) / 100,
    totalLinearFeet,
    materialCost,
    filmName: WALL_FILM.name,
  };
}

// ── Service categories ──────────────────────────────────────────
export type ServiceCategory = "color_change" | "printpro" | "graphicspro" | "patternpro" | "full_wraps" | "partial_wraps" | "chrome_delete" | "ppf" | "window_tint" | "all_products";

export interface CategoryInfo {
  id: ServiceCategory;
  label: string;
  sqFtMultiplier: number; // multiplier against full vehicle sq ft
  description: string;
}

export const SERVICE_CATEGORIES: Record<ServiceCategory, CategoryInfo> = {
  color_change: { id: "color_change", label: "Color Change Film", sqFtMultiplier: 1.0, description: "Color change vinyl wrap film" },
  printpro: { id: "printpro", label: "PrintPro", sqFtMultiplier: 1.0, description: "Printed wrap products (sq ft)" },
  graphicspro: { id: "graphicspro", label: "GraphicsPro Cut Vinyl", sqFtMultiplier: 0.2, description: "Cut-contour vinyl graphics (sq ft)" },
  patternpro: { id: "patternpro", label: "PatternPro", sqFtMultiplier: 1.0, description: "Pattern wrap priced by yard" },
  full_wraps: { id: "full_wraps", label: "Full Wraps", sqFtMultiplier: 1.0, description: "Full vehicle color change wrap" },
  partial_wraps: { id: "partial_wraps", label: "Partial Wraps", sqFtMultiplier: 0.4, description: "Partial vehicle wrap coverage" },
  chrome_delete: { id: "chrome_delete", label: "Chrome Delete", sqFtMultiplier: 0.08, description: "Chrome trim blackout" },
  ppf: { id: "ppf", label: "PPF", sqFtMultiplier: 0.35, description: "Paint protection film" },
  window_tint: { id: "window_tint", label: "Window Tint", sqFtMultiplier: 0.15, description: "Window tinting" },
  all_products: { id: "all_products", label: "All Products", sqFtMultiplier: 1.0, description: "All available products" },
};

// ── Add-on services ─────────────────────────────────────────────
// studio_proof / photoreal_proof / shop_drawing_2d removed — these are
// included with the DesignProAI subscription (renders + multi-angle
// studio output). Hardcoding them here as $75-$150 add-ons obscured the
// subscription's value, so they're stripped from the QuickQuote
// upsell catalog. Visual upsells the shop installs (chrome delete,
// PPF, tint, custom graphics, etc.) stay.
export type AddOnId = "ppf_hood" | "roof_wrap" | "chrome_delete" | "window_tint" | "custom_graphics";

export interface AddOnInfo {
  id: AddOnId;
  label: string;
  flatPrice: number; // base flat price
  description: string;
}

export const ADD_ONS: Record<AddOnId, AddOnInfo> = {
  ppf_hood: { id: "ppf_hood", label: "PPF Hood Only", flatPrice: 450, description: "Clear bra on hood" },
  roof_wrap: { id: "roof_wrap", label: "Roof Wrap", flatPrice: 350, description: "Roof panel wrap" },
  chrome_delete: { id: "chrome_delete", label: "Chrome Delete", flatPrice: 300, description: "Chrome trim blackout" },
  window_tint: { id: "window_tint", label: "Window Tint", flatPrice: 250, description: "Full window tint" },
  custom_graphics: { id: "custom_graphics", label: "Custom Graphics", flatPrice: 500, description: "Custom graphic design & install" },
};

// ── Margin calculation ──────────────────────────────────────────
export function applyMargin(basePrice: number, marginPercent: number): number {
  return Math.round(basePrice * (1 + marginPercent / 100) * 100) / 100;
}

// ── Quote number generator ───────────────────────────────────────
export function generateQuoteNumber(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `QQ-${date}-${rand}`;
}

// ── Shop pricing overrides ──────────────────────────────────────
// Merges per-shop pricing from shop_quote_pricing table on top of defaults.
// Any key present in the override replaces the default; missing keys keep defaults.

export interface ShopPricingOverrides {
  film_prices?: Record<string, number>;
  print_prices?: Record<string, number>;
  labor_rates?: Partial<Record<PriceRegion, number>>;
  add_on_prices?: Record<string, number>;
  default_margin_percent?: number;
  default_region?: string;
}

export function getFilmCostPerYardWithOverrides(finish: string, overrides?: ShopPricingOverrides): number {
  const key = finish.toLowerCase().replace(/[\s-]/g, "_");
  if (overrides?.film_prices?.[key] !== undefined) return overrides.film_prices[key];
  return FILM_COST_PER_YARD[key] || FILM_COST_PER_YARD.gloss;
}

export function getPrintCostPerSqFtWithOverrides(quality: string = "premium", overrides?: ShopPricingOverrides): number {
  const key = quality.toLowerCase();
  if (overrides?.print_prices?.[key] !== undefined) return overrides.print_prices[key];
  return PRINT_COST_PER_SQFT[key] || PRINT_COST_PER_SQFT.premium;
}

export function getLaborRateWithOverrides(region: PriceRegion, overrides?: ShopPricingOverrides): number {
  if (overrides?.labor_rates?.[region] !== undefined) return overrides.labor_rates[region]!;
  return REGIONS[region].laborPerSqFt;
}

export function getAddOnPriceWithOverrides(addOnId: string, overrides?: ShopPricingOverrides): number {
  if (overrides?.add_on_prices?.[addOnId] !== undefined) return overrides.add_on_prices[addOnId];
  return ADD_ONS[addOnId as AddOnId]?.flatPrice || 0;
}

// ── Core estimator ───────────────────────────────────────────────

export interface WrapEstimate {
  quoteNumber: string;
  vehicle: {
    year: string;
    make: string;
    model: string;
    matched: boolean; // true = exact/fuzzy match, false = fallback
    matchedTo?: string; // what vehicle we actually matched to
  };
  panels: PanelBreakdown;
  sqFt: number; // corrected sq ft (includes bumpers, mirrors, etc.)
  yardsNeeded: number; // linear yards of 60" film with waste
  isPrintPro: boolean; // true = printed wrap (sq ft pricing), false = film (yard pricing)
  materialCostPerUnit: number; // $/yard for film or $/sqft for print
  materialCostTotal: number;
  filmCostPerYard: number; // kept for backward compat
  filmCostTotal: number;
  laborPerSqFt: number;
  laborTotal: number;
  subtotal: number;
  region: PriceRegion;
  stateCode: string;
  finish: string;
  colorName: string;
  manufacturer: string;
  toolSource: "ColorPro" | "PatternPro" | "FadeWraps" | "DesignPro";
  renderUrl: string | null;
  visualizationId: string | null;
  createdAt: string;
}

export function sqFtToYards(sqFt: number): number {
  // Convert sq ft to linear yards of 60" wide film
  // Linear feet needed = sqFt / rollWidthFt, then add waste
  const linearFt = (sqFt / FILM_ROLL_WIDTH_FT) * WASTE_FACTOR;
  const linearYards = linearFt / 3;
  return Math.ceil(linearYards * 10) / 10; // round up to nearest 0.1
}

export function calculateEstimate(params: {
  year: string;
  make: string;
  model: string;
  finish: string;
  colorName: string;
  manufacturer: string;
  stateCode: string;
  toolSource: "ColorPro" | "PatternPro" | "FadeWraps" | "DesignPro";
  renderUrl?: string | null;
  visualizationId?: string | null;
  shopPricing?: ShopPricingOverrides;
}): WrapEstimate {
  const { year, make, model, finish, colorName, manufacturer, stateCode, toolSource, renderUrl, visualizationId, shopPricing } = params;

  // 1. Find vehicle — deterministic with fuzzy fallback
  const measurement = findVehicle(make, model, year);
  const matched = !!measurement;
  const matchedTo = measurement
    ? `${measurement.make} ${measurement.model} ${measurement.year}`
    : undefined;

  // Use corrected sq ft (includes bumpers, mirrors, etc.) or fallback to total
  const sqFt = measurement?.corrSqFt || measurement?.totalSqFt || 200; // 200 sq ft = mid-size sedan fallback
  const panels = measurement ? getPanelBreakdown(measurement) : {
    sides: 120, back: 25, hood: 18, roof: 22, total: 185, corrected: 200,
  };

  // 2. Convert sq ft to linear yards
  const yardsNeeded = sqFtToYards(sqFt);

  // 3. Material cost — PrintPro tools use sq ft pricing, ColorPro uses yard pricing
  const printPro = isPrintProTool(toolSource);
  let materialCostPerUnit: number;
  let materialCostTotal: number;
  let filmCostPerYard: number;
  let filmCostTotal: number;

  if (printPro) {
    // Printed wraps: price by sq ft
    materialCostPerUnit = getPrintCostPerSqFtWithOverrides("premium", shopPricing);
    materialCostTotal = Math.round(sqFt * materialCostPerUnit * 100) / 100;
    filmCostPerYard = 0;
    filmCostTotal = materialCostTotal;
  } else {
    // Film wraps: price by linear yard
    filmCostPerYard = getFilmCostPerYardWithOverrides(finish, shopPricing);
    filmCostTotal = Math.round(yardsNeeded * filmCostPerYard * 100) / 100;
    materialCostPerUnit = filmCostPerYard;
    materialCostTotal = filmCostTotal;
  }

  // 4. Labor cost by region
  const region = getRegionForState(stateCode);
  const laborPerSqFt = getLaborRateWithOverrides(region, shopPricing);
  const laborTotal = Math.round(sqFt * laborPerSqFt * 100) / 100;

  // 5. Subtotal
  const subtotal = Math.round((materialCostTotal + laborTotal) * 100) / 100;

  return {
    quoteNumber: generateQuoteNumber(),
    vehicle: { year, make, model, matched, matchedTo },
    panels,
    sqFt,
    yardsNeeded,
    isPrintPro: printPro,
    materialCostPerUnit,
    materialCostTotal,
    filmCostPerYard,
    filmCostTotal,
    laborPerSqFt,
    laborTotal,
    subtotal,
    region,
    stateCode: stateCode.toUpperCase(),
    finish,
    colorName,
    manufacturer,
    toolSource,
    renderUrl: renderUrl || null,
    visualizationId: visualizationId || null,
    createdAt: new Date().toISOString(),
  };
}
