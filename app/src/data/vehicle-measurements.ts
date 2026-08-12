// Vehicle Measurement Data for RestylePro Visualizer Suite
// Imports CSV at build time via Vite ?raw and parses into typed objects
import csvRaw from "./vehicle-measurements.csv?raw";

export interface VehicleMeasurement {
  make: string;
  model: string;
  year: string;
  sideW: number | null;
  sideH: number | null;
  sideSqFt: number | null;
  backW: number | null;
  backH: number | null;
  backSqFt: number | null;
  hoodW: number | null;
  hoodL: number | null;
  hoodSqFt: number | null;
  roofW: number | null;
  roofL: number | null;
  roofSqFt: number | null;
  totalSqFt: number | null;
  corrSqFt: number | null;
}

export interface PanelBreakdown {
  sides: number;
  back: number;
  hood: number;
  roof: number;
  total: number;
  corrected: number;
}

function parseCSVLine(line: string): string[] {
  // Detect delimiter: tab-separated or comma-separated
  const delim = line.includes("\t") ? "\t" : ",";
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === delim && !inQuotes) { parts.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  parts.push(current.trim());
  return parts;
}

function num(s: string | undefined): number | null {
  if (!s || s === "-" || s.trim() === "") return null;
  const val = parseFloat(s);
  return isNaN(val) ? null : val;
}

function parseCSV(raw: string): VehicleMeasurement[] {
  const lines = raw.trim().split("\n");
  // Skip header row
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const p = parseCSVLine(line);
    // Fix ~100 rows where side width/height are swapped (width < height).
    // Width should always be the longer dimension for side panels.
    const rawSideA = num(p[3]);
    const rawSideB = num(p[4]);
    let sideW: number | null = null;
    let sideH: number | null = null;
    if (rawSideA != null && rawSideB != null) {
      sideW = Math.max(rawSideA, rawSideB);
      sideH = Math.min(rawSideA, rawSideB);
    } else {
      sideW = rawSideA;
      sideH = rawSideB;
    }
    return {
      make: p[0] || "",
      model: p[1] || "",
      year: p[2] || "",
      sideW,
      sideH,
      sideSqFt: num(p[5]),
      backW: num(p[6]),
      backH: num(p[7]),
      backSqFt: num(p[8]),
      hoodW: num(p[9]),
      hoodL: num(p[10]),
      hoodSqFt: num(p[11]),
      roofW: num(p[12]),
      roofL: num(p[13]),
      roofSqFt: num(p[14]),
      totalSqFt: num(p[15]),
      corrSqFt: num(p[16]),
    };
  });
}

export const VEHICLE_MEASUREMENTS: VehicleMeasurement[] = parseCSV(csvRaw);

/** Sorted list of unique vehicle makes */
export function getUniqueMakes(): string[] {
  const makes = new Set(VEHICLE_MEASUREMENTS.map(v => v.make));
  return Array.from(makes).sort();
}

/** Sorted models for a given make */
export function getModelsForMake(make: string): string[] {
  const models = new Set(
    VEHICLE_MEASUREMENTS
      .filter(v => v.make.toLowerCase() === make.toLowerCase())
      .map(v => v.model)
  );
  return Array.from(models).sort();
}

/** Available year ranges for a given make + model */
export function getYearsForMakeModel(make: string, model: string): string[] {
  return VEHICLE_MEASUREMENTS
    .filter(
      v =>
        v.make.toLowerCase() === make.toLowerCase() &&
        v.model.toLowerCase() === model.toLowerCase()
    )
    .map(v => v.year);
}

/** Find vehicle by make + model with progressive fallback:
 *  1. Exact make + exact model
 *  2. Fuzzy make (contains) + exact model
 *  3. Fuzzy make + model starts with / contains
 *  Handles "Mercedes-Benz" matching "Mercedes", "Sprinter" matching "Sprinter 2500 - 144WB" etc. */
export function findVehicle(
  make: string,
  model: string,
  year?: string
): VehicleMeasurement | undefined {
  const makeLower = make.toLowerCase().trim();
  const modelLower = model.toLowerCase().trim();

  // Normalize make: "Mercedes-Benz" → also try "Mercedes"
  const makeVariants = [makeLower];
  if (makeLower.includes("-")) makeVariants.push(makeLower.split("-")[0].trim());
  if (makeLower.includes(" ")) makeVariants.push(makeLower.split(" ")[0].trim());

  const matchesMake = (v: VehicleMeasurement) =>
    makeVariants.some(mk => v.make.toLowerCase() === mk || v.make.toLowerCase().includes(mk) || mk.includes(v.make.toLowerCase()));

  // 1. Exact make + exact model (+ optional year)
  const exact = VEHICLE_MEASUREMENTS.find(
    v => matchesMake(v) && v.model.toLowerCase() === modelLower && (!year || v.year === year)
  );
  if (exact) return exact;

  // 2. Make match + model starts with query (e.g., "Sprinter" matches "Sprinter 2500 - 144WB - High Roof")
  const startsWith = VEHICLE_MEASUREMENTS.find(
    v => matchesMake(v) && v.model.toLowerCase().startsWith(modelLower) && (!year || v.year === year)
  );
  if (startsWith) return startsWith;

  // 3. Make match + model contains query (without year filter for broader match)
  const contains = VEHICLE_MEASUREMENTS.find(
    v => matchesMake(v) && v.model.toLowerCase().includes(modelLower)
  );
  if (contains) return contains;

  // 3.5. Make match + ALL words in query appear in model name
  // Handles "Transit High Roof" matching "Transit 148 WB High Roof"
  const queryWords = modelLower.split(/\s+/).filter(w => w.length > 1);
  if (queryWords.length > 1) {
    const allWordsMatch = VEHICLE_MEASUREMENTS.find(
      v => matchesMake(v) && queryWords.every(w => v.model.toLowerCase().includes(w))
    );
    if (allWordsMatch) return allWordsMatch;
  }

  // 3.6. Make match + first word of query matches (e.g. "Transit" matches any Transit variant)
  const firstWord = queryWords[0];
  if (firstWord) {
    const firstWordMatch = VEHICLE_MEASUREMENTS.find(
      v => matchesMake(v) && v.model.toLowerCase().startsWith(firstWord)
    );
    if (firstWordMatch) return firstWordMatch;
  }

  // 4. Model-only search (last resort)
  const modelOnly = VEHICLE_MEASUREMENTS.find(
    v => v.model.toLowerCase() === modelLower || v.model.toLowerCase().startsWith(modelLower)
  );
  return modelOnly;
}

/** Fuzzy search across make, model, year */
export function searchVehicles(query: string): VehicleMeasurement[] {
  const q = query.toLowerCase();
  return VEHICLE_MEASUREMENTS.filter(v =>
    `${v.make} ${v.model} ${v.year}`.toLowerCase().includes(q)
  );
}

/** Get panel-by-panel sq ft breakdown for a vehicle */
export function getPanelBreakdown(v: VehicleMeasurement): PanelBreakdown {
  return {
    sides: (v.sideSqFt || 0) * 2, // Both sides
    back: v.backSqFt || 0,
    hood: v.hoodSqFt || 0,
    roof: v.roofSqFt || 0,
    total: v.totalSqFt || 0,
    corrected: v.corrSqFt || 0,
  };
}

// ---------------------------------------------------------------------------
// WePrintWraps Universal Panelizer size mapping
// ---------------------------------------------------------------------------
// Side panel sizes - mapped by vehicle side WIDTH (the longer dimension).
// The universal panel must be wide enough to cover the vehicle side.
//   Small  (144×59.5): vehicle side width < 144"
//   Medium (172×59.5): vehicle side width 144" to < 172"
//   Large  (200×59.5): vehicle side width 172" to < 200"
//   XL     (240×59.5): vehicle side width ≥ 200"
// ---------------------------------------------------------------------------

export interface WPWSideSize {
  tier: "small" | "medium" | "large" | "xl";
  label: string;
  price: number;
  panelWidth: number;
  panelHeight: number;
}

export interface WPWRoofSize {
  size: "small" | "medium" | "large";
  label: string;
  price: number;
  panelWidth: number;
  panelHeight: number;
}

/** Map a vehicle's side width (inches) to the correct WPW Universal Panelizer size */
export function calculatePricingTier(sideWidth: number): WPWSideSize {
  if (sideWidth < 144) return { tier: "small", label: "Small", price: 600, panelWidth: 144, panelHeight: 59.5 };
  if (sideWidth < 172) return { tier: "medium", label: "Medium", price: 710, panelWidth: 172, panelHeight: 59.5 };
  if (sideWidth < 200) return { tier: "large", label: "Large", price: 825, panelWidth: 200, panelHeight: 59.5 };
  return { tier: "xl", label: "XL", price: 990, panelWidth: 240, panelHeight: 59.5 };
}

/** Map a vehicle's roof length (inches) to the correct WPW Roof panel size.
 *  Returns null if the vehicle has no roof data. */
export function mapToRoofSize(roofLength: number | null): WPWRoofSize | null {
  if (roofLength == null || roofLength <= 0) return null;
  if (roofLength <= 72) return { size: "small", label: "Roof Small", price: 160, panelWidth: 72, panelHeight: 59.5 };
  if (roofLength <= 110) return { size: "medium", label: "Roof Medium", price: 225, panelWidth: 110, panelHeight: 59.5 };
  return { size: "large", label: "Roof Large", price: 330, panelWidth: 160, panelHeight: 59.5 };
}

/** Full WPW mapping for a vehicle - side tier + roof size */
export function mapVehicleToWPW(v: VehicleMeasurement) {
  const sideTier = v.sideW != null ? calculatePricingTier(v.sideW) : null;
  const roof = mapToRoofSize(v.roofL);
  return { sideTier, roof };
}
