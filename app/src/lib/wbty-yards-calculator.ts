/**
 * WBTY Deterministic Yard Calculator
 *
 * Source: WePrintWraps official "How Many Yards of Wrap do I need?" guide
 *
 *   Motorcycle      → 5 yards
 *   Small Vehicle   → 15 yards   (Yaris, Mini Cooper, etc.)
 *   Midsize Vehicle → 20 yards   (Charger, Silverado Quad Cab, etc.)
 *   Large Vehicle   → 25 yards   (Tahoe, NV200, vans, etc.)
 *
 * Classification is purely make/model based — no API call needed.
 */

export type VehicleSize = "motorcycle" | "small" | "midsize" | "large";

export interface YardTier {
  size: VehicleSize;
  yards: number;
  label: string;
  examples: string[];
}

export const YARD_TIERS: Record<VehicleSize, YardTier> = {
  motorcycle: {
    size: "motorcycle",
    yards: 5,
    label: "Motorcycle",
    examples: ["Suzuki GSXR", "Harley Davidson", "Sport Bike", "Cruiser"],
  },
  small: {
    size: "small",
    yards: 15,
    label: "Small Vehicle",
    examples: ["Toyota Yaris", "Mini Cooper", "Honda Fit", "Fiat 500"],
  },
  midsize: {
    size: "midsize",
    yards: 20,
    label: "Midsize Vehicle",
    examples: ["Dodge Charger", "Chevy Silverado Quad Cab", "Honda Accord", "Camry"],
  },
  large: {
    size: "large",
    yards: 25,
    label: "Large Vehicle",
    examples: ["Chevy Tahoe", "Nissan NV200", "Ford Transit", "Suburban"],
  },
};

const PRICE_PER_YARD = 95.5;

// ── Make/Model lookup tables ──────────────────────────────────────

const MOTORCYCLE_MAKES = new Set([
  "harley-davidson", "harley", "ducati", "ktm", "kawasaki", "yamaha",
  "suzuki", "honda motorcycle", "triumph", "indian", "bmw motorrad",
  "aprilia", "moto guzzi", "vespa", "piaggio", "royal enfield", "husqvarna",
]);

const MOTORCYCLE_MODELS = [
  "gsxr", "ninja", "cbr", "yzf", "r1", "r6", "panigale", "monster",
  "scrambler", "softail", "fatboy", "road king", "street glide",
  "sportster", "iron", "fxr", "dyna", "hayabusa", "busa",
];

const SMALL_MODELS = [
  // Compact/subcompact cars
  "yaris", "fit", "fiesta", "spark", "sonic", "mirage", "rio",
  "mini cooper", "mini", "cooper", "fiat 500", "500", "smart",
  "iq", "scion iq", "ka", "panda", "matiz",
  // Hatchbacks
  "golf", "polo", "fox", "up", "i20", "i10", "swift",
  "civic", "corolla", "elantra", "sentra", "versa",
];

const LARGE_MODELS = [
  // Full-size SUVs
  "tahoe", "suburban", "yukon", "expedition", "navigator", "armada",
  "sequoia", "qx80", "escalade", "land cruiser", "lx", "qx", "gx",
  // Vans
  "nv200", "nv1500", "nv2500", "nv3500", "transit", "sprinter",
  "promaster", "express", "savana", "metris", "caravan", "town and country",
  "pacifica", "odyssey", "sienna", "quest", "carnival",
  // Heavy duty trucks
  "f-250", "f250", "f-350", "f350", "f-450", "f450",
  "silverado 2500", "silverado 3500", "sierra 2500", "sierra 3500",
  "ram 2500", "ram 3500", "titan xd", "tundra crewmax",
];

const MIDSIZE_MODELS = [
  // Sedans
  "charger", "challenger", "300", "impala", "malibu", "fusion",
  "taurus", "altima", "maxima", "accord", "camry", "avalon",
  "sonata", "optima", "k5", "stinger", "es", "is", "gs",
  "3 series", "5 series", "c-class", "e-class", "a4", "a6",
  // Crossovers
  "rav4", "cr-v", "rogue", "escape", "equinox", "edge",
  "explorer", "pilot", "highlander", "pathfinder", "murano",
  "cherokee", "grand cherokee", "wrangler", "4runner", "tacoma",
  // Pickups (regular/quad cab)
  "silverado", "sierra", "ram 1500", "ram", "f-150", "f150",
  "tundra", "titan", "ridgeline", "frontier", "colorado", "canyon",
  "ranger", "gladiator", "maverick", "santa cruz",
];

/**
 * Classify a vehicle into one of 4 size buckets.
 * Falls back to 'midsize' if unrecognized (most common case).
 */
export function classifyVehicle(
  make: string,
  model: string,
): VehicleSize {
  const m = (make || "").toLowerCase().trim();
  const md = (model || "").toLowerCase().trim();
  const combined = `${m} ${md}`;

  // 1. Motorcycle by make
  if (MOTORCYCLE_MAKES.has(m)) return "motorcycle";

  // 2. Motorcycle by model keyword
  if (MOTORCYCLE_MODELS.some((kw) => md.includes(kw) || combined.includes(kw))) {
    return "motorcycle";
  }

  // 3. Large vehicle by model keyword (check before midsize since some overlap)
  if (LARGE_MODELS.some((kw) => md.includes(kw))) return "large";

  // 4. Small vehicle by model keyword
  if (SMALL_MODELS.some((kw) => md === kw || md.includes(kw))) return "small";

  // 5. Midsize by model keyword
  if (MIDSIZE_MODELS.some((kw) => md.includes(kw))) return "midsize";

  // 6. Default fallback
  return "midsize";
}

export interface YardCalculation {
  size: VehicleSize;
  tier: YardTier;
  yards: number;
  pricePerYard: number;
  totalPrice: number;
  vehicleLabel: string;
}

export function calculateYards(
  year: string | number,
  make: string,
  model: string,
): YardCalculation {
  const size = classifyVehicle(make, model);
  const tier = YARD_TIERS[size];
  const yards = tier.yards;
  const totalPrice = +(yards * PRICE_PER_YARD).toFixed(2);

  return {
    size,
    tier,
    yards,
    pricePerYard: PRICE_PER_YARD,
    totalPrice,
    vehicleLabel: `${year} ${make} ${model}`.trim(),
  };
}

/** Override calculation with a manual yard count (still re-prices) */
export function recalcWithYards(yards: number): { yards: number; totalPrice: number; pricePerYard: number } {
  return {
    yards,
    pricePerYard: PRICE_PER_YARD,
    totalPrice: +(yards * PRICE_PER_YARD).toFixed(2),
  };
}

/** Design-file-only price (one-time fee, no yardage) */
export const DESIGN_FILE_PRICE = 49;
