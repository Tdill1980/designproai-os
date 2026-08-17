// material-calculator.ts
// Senior-Designer Accurate Film Usage Calculator
// Handles color-change zones + cut vinyl graphics + multi-layer logic

export interface ZoneMaterialEstimate {
  zone: string;
  filmName: string;
  yards: number;
  sqft: number;
  notes?: string;
}

/**
 * SMALL COMPONENTS → use simplified square footage
 * THEN ALWAYS enforce minimum 1 yard ordering
 */
const SMALL_COMPONENT_SQFT: Record<string, number> = {
  calipers: 0.8,        // 4 calipers @ ~0.2 each
  mirrors: 3,           // pair of mirrors
  handles: 1,           // set of handles
  pillars: 3,           // A/B/C pillars
  trim: 2,
  stripe: 6,
  hood_graphic: 6,
  roof_graphic: 10
};

/**
 * LARGE BODY PANELS → industry standard sq ft estimates
 */
const LARGE_PANEL_SQFT: Record<string, number> = {
  hood: 10,
  roof: 20,
  fender: 10,
  bumper_front: 16,
  bumper_rear: 15,
  door: 12,
  quarter: 20
};

/**
 * FULL VEHICLE SURFACE AREAS
 * Used for top/bottom split or full color-change wraps
 */
const VEHICLE_BASE_SQFT: Record<string, number> = {
  "tesla model x": 350,
  "tesla model 3": 260,
  "tesla model y": 290,
  "tesla model s": 300,
  "dodge charger": 300,
  "chevy silverado": 400,
  "ford transit": 550,
};

/**
 * Calculates sq ft + yards for a given zone
 */
export function calculateMaterialForZone(
  zone: string,
  vehicleName: string,
  finish: string,
  filmName: string
): ZoneMaterialEstimate {
  
  const zoneLower = zone.toLowerCase();

  // ---------------------------------------------------------------------
  // 1️⃣ MICRO COMPONENTS (calipers, mirrors, handles, trim)
  // ---------------------------------------------------------------------
  const smallKey = Object.keys(SMALL_COMPONENT_SQFT).find(k =>
    zoneLower.includes(k)
  );

  if (smallKey) {
    const sqft = SMALL_COMPONENT_SQFT[smallKey];

    return {
      zone,
      filmName,
      sqft,
      yards: 1, // ALWAYS minimum 1 yard
      notes: "Minimum 1 yard required for small components and cut vinyl"
    };
  }

  // ---------------------------------------------------------------------
  // 2️⃣ FULL WRAP / TOP / BOTTOM (use full vehicle sq ft * zone ratio)
  // ---------------------------------------------------------------------
  const vehicleKey = Object.keys(VEHICLE_BASE_SQFT).find(v =>
    vehicleName.toLowerCase().includes(v)
  );

  if (
    zoneLower.includes("full") ||
    zoneLower.includes("body") ||
    zoneLower.includes("top") ||
    zoneLower.includes("bottom")
  ) {
    const base = vehicleKey ? VEHICLE_BASE_SQFT[vehicleKey] : 300;

    // Top/Bottom splits
    let portion = base;
    if (zoneLower.includes("top")) portion = base * 0.45;
    if (zoneLower.includes("bottom")) portion = base * 0.55;

    // Oversize factor based on finish
    const multiplier =
      finish.toLowerCase().includes("chrome")
        ? 1.40
        : finish.toLowerCase().includes("matte")
        ? 1.20
        : 1.10;

    const sqft = portion * multiplier;
    const yards = Math.ceil(sqft / 27); // ALWAYS round UP for installer safety

    return {
      zone,
      filmName,
      sqft,
      yards
    };
  }

  // ---------------------------------------------------------------------
  // 3️⃣ LARGE PANELS (hood, roof, bumpers, doors, fenders)
  // ---------------------------------------------------------------------
  const largeKey = Object.keys(LARGE_PANEL_SQFT).find(k =>
    zoneLower.includes(k)
  );

  if (largeKey) {
    let sqft = LARGE_PANEL_SQFT[largeKey];

    // Finish-based oversize factor
    sqft *= finish.toLowerCase().includes("chrome")
      ? 1.40
      : finish.toLowerCase().includes("matte")
      ? 1.20
      : 1.10;

    const yards = Math.ceil(sqft / 27);

    return {
      zone,
      filmName,
      sqft,
      yards
    };
  }

  // ---------------------------------------------------------------------
  // 4️⃣ FALLBACK — unknown small zone → treat like small accent
  // ---------------------------------------------------------------------
  return {
    zone,
    filmName,
    sqft: 10,
    yards: 1,
    notes: "Fallback: small zone estimated at 10 sq ft → 1 yard"
  };
}
