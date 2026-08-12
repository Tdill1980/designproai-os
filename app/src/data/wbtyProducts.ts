/**
 * wbtyProducts — Wrap By The Yard MASTER category map + swatch map.
 * The FIVE parent products below are the ONLY WBTY WooCommerce product IDs;
 * every swatch falls under exactly one of them. These map directly into the
 * pricing engine's `wbyCategory`. Keep IDs stable.
 */

export type WbtyCategory = "camo_carbon" | "metal_marble" | "wicked_wild" | "bape_camo" | "modern_trippy";

// wbyCategory → WooCommerce parent product ID.
export const WBTY_PRODUCT_IDS: Record<WbtyCategory, number> = {
  camo_carbon: 1726,
  metal_marble: 39698,
  wicked_wild: 4181,
  bape_camo: 42809,
  modern_trippy: 52489,
};

// Public product titles + SKU prefixes + display color per category.
export const WBTY_CATEGORY_META: Record<WbtyCategory, { title: string; sku: string; color: string }> = {
  camo_carbon: { title: "Wrap By The Yard Camo & Carbon", sku: "WBTY-CAMO-CARBON", color: "#7C3AED" },
  metal_marble: { title: "Wrap By The Yard Metal & Marble", sku: "WBTY-METAL-MARBLE", color: "#F59E0B" },
  wicked_wild: { title: "Wrap By The Yard Wicked & Wild Wrap Prints 60\"", sku: "WBTY-WICKED-WILD", color: "#10B981" },
  bape_camo: { title: "Wrap By The Yard Bape Camo", sku: "WBTY-BAPE-CAMO", color: "#3B82F6" },
  modern_trippy: { title: "Wrap By The Yard Modern & Trippy", sku: "WBTY-MODERN-TRIPPY", color: "#EC4899" },
};

// Every swatch, grouped by its WBTY category.
export const WBTY_SWATCH_MAP: Record<WbtyCategory, string[]> = {
  camo_carbon: [
    "Sand Camo", "Black Camo", "Digital Gray Camo", "Broken Gray Camo", "Broken Red Camo",
    "Red Camo", "Orange Camo", "Hex Camo", "Vintage Camo", "Modern Camo", "Grunge Camo",
    "Digi Lime Camo", "Digi Camo", "Unicorn Camo",
    "Gray Carbon", "White Carbon", "Black Carbon 1", "Black Carbon 2", "Red Carbon",
    "Blue Carbon", "Gold Carbon 1", "Gold Carbon 2",
    "Riveted Tank", "Doomsday Rust", "Antique Patina", "Rat Rod",
  ],
  metal_marble: [
    "Gray Marble", "Azul Marble", "Smokey Marble", "Classic Marble", "Solar Flare Marble",
    "Reverse Marble", "Venetian Marble", "Egyptian Marble", "Ocean Marble", "Ghost Marble",
    "Crackle Marble", "Rose Marble", "Grecian Marble",
    "Brushed Iron", "Gold Foil", "Silver Foil", "Rose Gold Foil", "Battle Worn",
    "Aged Armor", "Diamond Plate",
  ],
  wicked_wild: [
    "Lifes A Trip", "Transformer", "Picasasso", "Abstract", "Starry Night",
    "Nebula Galaxy", "Purple Nebula Galaxy", "Dark Nebula Galaxy",
    "Rick & Morty Galaxy", "Faux Triangle Holographic", "Enter The Dragon", "Electric Blue",
    "Topography Heat Map", "Topography Map", "Hypnotic", "Block Chain", "The Matrix",
    "Faux Holographic", "Torn Camo", "Color of Money 1", "Color of Money 2",
    "Chameleon Camo Red", "Chameleon Camo Tan", "Chameleon Camo Blue",
    "Jagged Livery Blue", "Extreme Livery Yellow", "Extreme Livery Lime", "Extreme Livery Red",
    // Live-site additions (galaxy / abstract / vibrant lines)
    "Deep Galaxy", "Unicorn Galaxy", "Rainbow Galaxy", "Outerspace", "Grunge Galaxy",
    "Psychedelic Galaxy", "Mayhem", "Marble Mayhem", "Wild Girl", "Vivid Color",
    "Painted Camo", "Ice Breaker", "Abstract Color", "Color Maze", "Rigid",
    "Snake Skin", "Skull Pattern",
    "Geometric Edge", "Abstract Triangle", "Brushed Geometric", "Concept Camo",
    "Shattered", "Why So Serious?", "Anime Clouds", "Topography Camo",
  ],
  bape_camo: [
    "Red Bape Camo", "Blue Bape Camo", "Purple Bape Camo", "Pink Bape Camo", "Grey Bape Camo",
    "Rad Bape Camo", "Unicorn Bape Camo", "Psychedelic Bape Camo", "Bubble Gum Bape Camo", "Army Bape Camo",
  ],
  modern_trippy: [
    "Modern Wave", "Liquified Rainbow", "Chromatic Splash", "Psychedelic Drip",
    "Digital Graffiti", "Glitch Blast", "Abstract Pulse", "Neon Warp", "Melting Lines",
  ],
};

export const WBTY_CATEGORY_ORDER: WbtyCategory[] = ["camo_carbon", "metal_marble", "wicked_wild", "bape_camo", "modern_trippy"];

// Product spec — shared across all WBTY collections.
export const WBTY_SPEC = {
  price: "$95.50",
  unit: "yard",
  width: "60\" roll",
  material: "Avery MPI 1105 Easy Apply RS with DOL1360Z Lamination",
  pointsPerDollar: 1,
};

// "How many yards do I need?" — the real coverage guide (great ad subject).
export const WBTY_YARDAGE_GUIDE: { vehicle: string; examples: string; yards: number }[] = [
  { vehicle: "Motorcycle", examples: "Suzuki GSXR, Harley-Davidson or equivalent", yards: 5 },
  { vehicle: "Small Vehicle", examples: "Toyota Yaris, Mini Cooper or equivalent", yards: 15 },
  { vehicle: "Midsize Vehicle", examples: "Dodge Charger, Chevy Silverado Quad Cab or equivalent", yards: 20 },
  { vehicle: "Large Vehicle", examples: "Chevy Tahoe, Nissan NV200 or equivalent", yards: 25 },
];

// Reverse lookup: swatch name → its WBTY category (+ product id).
export function wbtyCategoryForSwatch(swatch: string): { category: WbtyCategory; productId: number } | null {
  const needle = swatch.trim().toLowerCase();
  for (const cat of WBTY_CATEGORY_ORDER) {
    if (WBTY_SWATCH_MAP[cat].some((s) => s.toLowerCase() === needle)) {
      return { category: cat, productId: WBTY_PRODUCT_IDS[cat] };
    }
  }
  return null;
}
