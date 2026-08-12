/**
 * WBTY / PatternPro Batch Preset Library
 *
 * 50 unique pattern wrap presets for batch rendering.
 * Each preset has a unique pattern name, hex, and styling prompt
 * so renders never collide in the cache.
 */

export interface WBTYPreset {
  id: string;
  designName: string;
  colorName: string;
  hex: string;
  finish: "Gloss" | "Satin" | "Matte";
  customStylingPrompt: string;
}

export const WBTY_PRESETS: WBTYPreset[] = [
  // ── Camouflage Patterns (8) ───────────────────────────────────────
  {
    id: "wt-cm-001", designName: "Timber Ridge Camo", colorName: "Timber Ridge Camo", hex: "#4A5D23", finish: "Matte",
    customStylingPrompt: "Realistic woodland camouflage - oak leaves, pine branches, bark textures in autumn browns, olive greens, and tan. Like real Mossy Oak printed film. Matte flat finish.",
  },
  {
    id: "wt-cm-002", designName: "Operator Hex", colorName: "Operator Hex", hex: "#5C5B3A", finish: "Matte",
    customStylingPrompt: "Digital hexagonal military camo in flat dark earth and olive drab green. Small hexagon tiles shifting between three shades of military green and brown. Matte flat finish.",
  },
  {
    id: "wt-cm-003", designName: "Arctic White Camo", colorName: "Arctic White Camo", hex: "#E8E8E8", finish: "Matte",
    customStylingPrompt: "Winter arctic camouflage pattern. White, light gray, and pale blue irregular shapes. Snow camo like military winter operations. Matte finish.",
  },
  {
    id: "wt-cm-004", designName: "Desert Digi", colorName: "Desert Digi", hex: "#C2B280", finish: "Matte",
    customStylingPrompt: "Digital desert camouflage - small rectangular pixels in sand, tan, light brown, and khaki. US military MARPAT desert pattern style. Matte flat finish.",
  },
  {
    id: "wt-cm-005", designName: "Urban Fracture", colorName: "Urban Fracture", hex: "#555555", finish: "Matte",
    customStylingPrompt: "Urban gray camouflage with angular geometric shapes in dark gray, medium gray, light gray, and black. City environment camo. Matte finish.",
  },
  {
    id: "wt-cm-006", designName: "Shadow Grass", colorName: "Shadow Grass", hex: "#3B5323", finish: "Matte",
    customStylingPrompt: "Marsh grass and cattail camouflage. Tall grass silhouettes, cattails, and reeds in greens, browns, and dark shadows. Duck blind camo. Matte finish.",
  },
  {
    id: "wt-cm-007", designName: "Kryptek Neptune", colorName: "Kryptek Neptune", hex: "#2F4F4F", finish: "Matte",
    customStylingPrompt: "Kryptek-style transitional camouflage with organic flowing shapes in ocean blues, dark teals, and deep navy. Marine environment pattern. Matte finish.",
  },
  {
    id: "wt-cm-008", designName: "Autumn Blaze Camo", colorName: "Autumn Blaze Camo", hex: "#8B4513", finish: "Matte",
    customStylingPrompt: "Fall foliage camouflage - orange, red, yellow, and brown autumn leaves with oak and maple leaf shapes. Late October hunting camo. Matte finish.",
  },

  // ── Carbon Fiber & Technical (8) ──────────────────────────────────
  {
    id: "wt-cf-001", designName: "Forged Carbon", colorName: "Forged Carbon", hex: "#1A1A1A", finish: "Gloss",
    customStylingPrompt: "Forged carbon fiber - chopped swirled random carbon fiber strands like Lamborghini factory carbon. Marbled swirl with random fiber orientation. High-gloss clearcoat.",
  },
  {
    id: "wt-cf-002", designName: "Carbon Twill 2x2", colorName: "Carbon Twill 2x2", hex: "#202020", finish: "Gloss",
    customStylingPrompt: "Standard 2x2 twill weave carbon fiber. Classic diagonal pattern with repeating interlocking fibers. Black with subtle silver thread highlights. High-gloss finish.",
  },
  {
    id: "wt-cf-003", designName: "Red Carbon Hybrid", colorName: "Red Carbon Hybrid", hex: "#8B0000", finish: "Gloss",
    customStylingPrompt: "Carbon fiber with red Kevlar hybrid weave. Standard 2x2 twill with alternating black carbon and bright red aramid threads. High-gloss clearcoat.",
  },
  {
    id: "wt-cf-004", designName: "Brushed Titanium", colorName: "Brushed Titanium", hex: "#878787", finish: "Satin",
    customStylingPrompt: "Brushed titanium metal texture. Fine horizontal brush lines in medium gray with subtle directional reflection. Satin finish.",
  },
  {
    id: "wt-cf-005", designName: "Brushed Aluminum", colorName: "Brushed Aluminum", hex: "#A9A9A9", finish: "Satin",
    customStylingPrompt: "Brushed aluminum metal texture. Fine linear brush marks in light silver-gray. Like real milled aluminum panel. Satin finish.",
  },
  {
    id: "wt-cf-006", designName: "Honeycomb Mesh", colorName: "Honeycomb Mesh", hex: "#2C2C2C", finish: "Gloss",
    customStylingPrompt: "Black honeycomb mesh pattern. Hexagonal repeating grid like carbon fiber or speaker grille mesh. Dark black with subtle depth. Gloss finish.",
  },
  {
    id: "wt-cf-007", designName: "Kevlar Gold Weave", colorName: "Kevlar Gold Weave", hex: "#B8860B", finish: "Gloss",
    customStylingPrompt: "Pure Kevlar aramid fiber weave in golden yellow. Tight plain weave pattern with visible fiber texture. Gloss finish.",
  },
  {
    id: "wt-cf-008", designName: "Diamond Plate", colorName: "Diamond Plate", hex: "#B0B0B0", finish: "Satin",
    customStylingPrompt: "Industrial aluminum diamond plate texture. Raised diamond tread pattern like truck bed liner. Light metallic gray with realistic depth. Satin finish.",
  },

  // ── Racing & Stripe Patterns (8) ──────────────────────────────────
  {
    id: "wt-rc-001", designName: "Heritage Stripe", colorName: "Heritage Stripe", hex: "#F5F5F0", finish: "Gloss",
    customStylingPrompt: "Pearl white body with three thin parallel racing stripes - dark navy, red, light blue - running from front lip over hood, roof, down rear decklid. Martini Racing style.",
  },
  {
    id: "wt-rc-002", designName: "Le Mans Gulf", colorName: "Le Mans Gulf", hex: "#6CACE4", finish: "Gloss",
    customStylingPrompt: "Gulf Oil racing livery. Light powder blue body with wide orange center stripe running nose to tail. Clean vintage motorsport.",
  },
  {
    id: "wt-rc-003", designName: "Rally Cross", colorName: "Rally Cross", hex: "#FFFFFF", finish: "Gloss",
    customStylingPrompt: "White body with bold blue and red diagonal rally stripes slashing across the doors and fenders. WRC rally car aesthetic, aggressive angular graphics.",
  },
  {
    id: "wt-rc-004", designName: "Dual Matte Stripe", colorName: "Dual Matte Stripe", hex: "#1A1A1A", finish: "Matte",
    customStylingPrompt: "Matte black body with two wide satin gray racing stripes running center hood to trunk. Classic American muscle car dual stripe. Flat finish.",
  },
  {
    id: "wt-rc-005", designName: "Checkered Flag", colorName: "Checkered Flag", hex: "#000000", finish: "Gloss",
    customStylingPrompt: "Black and white checkered flag pattern wrapping the entire vehicle. Classic racing checkerboard squares, evenly sized. High-gloss finish.",
  },
  {
    id: "wt-rc-006", designName: "GT Endurance", colorName: "GT Endurance", hex: "#CC0000", finish: "Gloss",
    customStylingPrompt: "Rosso corsa red body with a single white roundel circle on each door and white nose stripe. Vintage Ferrari GT racing style.",
  },
  {
    id: "wt-rc-007", designName: "Neon Circuit", colorName: "Neon Circuit", hex: "#0A0A0A", finish: "Gloss",
    customStylingPrompt: "Black body with thin neon green pinstripe accents tracing the body panel edges and contour lines. Tron-inspired circuit board lines glowing on black.",
  },
  {
    id: "wt-rc-008", designName: "BRG Twin Stripe", colorName: "BRG Twin Stripe", hex: "#004225", finish: "Gloss",
    customStylingPrompt: "British Racing Green body with two thin gold pinstripes running from the nose over center of hood, roof, and trunk. Classic British motorsport.",
  },

  // ── Animal & Nature Prints (8) ────────────────────────────────────
  {
    id: "wt-an-001", designName: "Black Panther", colorName: "Black Panther", hex: "#0A0A0A", finish: "Gloss",
    customStylingPrompt: "Dark leopard print on black. Subtle black-on-black leopard rosette spots barely visible until light catches them. Stealth animal print. Gloss finish.",
  },
  {
    id: "wt-an-002", designName: "Zebra Stripe", colorName: "Zebra Stripe", hex: "#F5F5F5", finish: "Gloss",
    customStylingPrompt: "Bold black and white zebra stripe pattern. Wide organic zebra stripes flowing across the body panels. High contrast animal print. Gloss finish.",
  },
  {
    id: "wt-an-003", designName: "Python Scale", colorName: "Python Scale", hex: "#8B7355", finish: "Satin",
    customStylingPrompt: "Realistic python snakeskin texture. Diamond-shaped scales in browns, tans, and dark accents. Real reptile skin texture with depth. Satin finish.",
  },
  {
    id: "wt-an-004", designName: "Tiger Flame", colorName: "Tiger Flame", hex: "#FF8C00", finish: "Gloss",
    customStylingPrompt: "Orange and black tiger stripe pattern. Bold tiger stripes flowing from the nose rearward. Vivid orange with jet black stripes. Gloss finish.",
  },
  {
    id: "wt-an-005", designName: "Crocodile Black", colorName: "Crocodile Black", hex: "#1A1A1A", finish: "Satin",
    customStylingPrompt: "Black crocodile skin leather texture. Realistic raised rectangular alligator scale pattern in deep black. Luxurious exotic leather look. Satin finish.",
  },
  {
    id: "wt-an-006", designName: "Koi Pond", colorName: "Koi Pond", hex: "#003366", finish: "Gloss",
    customStylingPrompt: "Japanese koi fish swimming through deep blue water. Orange, white, and gold koi with flowing fins amid blue water ripples. Gloss finish.",
  },
  {
    id: "wt-an-007", designName: "Shark Skin", colorName: "Shark Skin", hex: "#4A4A4A", finish: "Matte",
    customStylingPrompt: "Gray shark skin texture with fine micro-scale pattern. Realistic marine predator skin in dark gray. Aggressive and minimal. Matte finish.",
  },
  {
    id: "wt-an-008", designName: "Coral Garden", colorName: "Coral Garden", hex: "#FF6F61", finish: "Gloss",
    customStylingPrompt: "Underwater coral reef pattern. Colorful corals, sea fans, and marine life in warm pinks, oranges, blues, and greens. Gloss finish.",
  },

  // ── Abstract & Geometric (5) ──────────────────────────────────────
  {
    id: "wt-ab-001", designName: "Black Widow", colorName: "Black Widow", hex: "#0A0A0A", finish: "Matte",
    customStylingPrompt: "Full body matte black with a red pinstripe along the lower rocker panels that widens to a diamond at center of each door. One red accent on murdered-out black.",
  },
  {
    id: "wt-ab-002", designName: "Pixel Storm", colorName: "Pixel Storm", hex: "#1A1A1A", finish: "Gloss",
    customStylingPrompt: "Glitch pixel dissolve effect. Small square pixels in neon blue and pink scattering across a black body, denser at the rear fading to nothing at the front.",
  },
  {
    id: "wt-ab-003", designName: "Marble Nero", colorName: "Marble Nero", hex: "#1C1C1C", finish: "Gloss",
    customStylingPrompt: "Black marble texture with white and gold veining. Nero Marquina polished stone with natural vein patterns. High-gloss finish.",
  },
  {
    id: "wt-ab-004", designName: "Galaxy Nebula", colorName: "Galaxy Nebula", hex: "#0B0B2E", finish: "Gloss",
    customStylingPrompt: "Deep space nebula print. Swirling purple and blue cosmic gas clouds with white star points scattered throughout. Gloss finish.",
  },
  {
    id: "wt-ab-005", designName: "Geometric Shatter", colorName: "Geometric Shatter", hex: "#2C2C2C", finish: "Matte",
    customStylingPrompt: "Angular geometric shattered glass pattern. Triangular facets in dark grays, blacks, and one accent of electric blue. Matte finish.",
  },

  // ── Wood & Natural Textures (5) ───────────────────────────────────
  {
    id: "wt-wd-001", designName: "Walnut Burl", colorName: "Walnut Burl", hex: "#4A3000", finish: "Gloss",
    customStylingPrompt: "Rich walnut burl wood grain. Swirling burl eye patterns in deep brown with warm amber highlights. High-gloss finish.",
  },
  {
    id: "wt-wd-002", designName: "Barn Wood", colorName: "Barn Wood", hex: "#8B7355", finish: "Matte",
    customStylingPrompt: "Weathered reclaimed barn wood planks. Aged gray-brown wood with visible grain, nail holes, and patina. Matte finish.",
  },
  {
    id: "wt-wd-003", designName: "Teak Deck", colorName: "Teak Deck", hex: "#C19A6B", finish: "Satin",
    customStylingPrompt: "Golden teak wood grain with straight parallel grain lines. Like a yacht deck. Warm honey-gold wood tone. Satin finish.",
  },
  {
    id: "wt-wd-004", designName: "Ebony Piano", colorName: "Ebony Piano", hex: "#1A1008", finish: "Gloss",
    customStylingPrompt: "Deep ebony wood grain in near-black with subtle dark brown grain visible under light. Mirror-like high-gloss finish.",
  },
  {
    id: "wt-wd-005", designName: "Cork Texture", colorName: "Cork Texture", hex: "#C4A882", finish: "Matte",
    customStylingPrompt: "Natural cork bark texture. Fine granular cork surface in warm light brown tones. Matte finish.",
  },
];

/**
 * Get `count` unique WBTY/PatternPro presets, shuffled randomly.
 * Tracks previously used IDs in localStorage to avoid repeats across batches.
 */
export function getRandomWBTYPresets(count: number): WBTYPreset[] {
  const storageKey = "restylepro_used_wbty_presets";

  let usedIds: string[] = [];
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) usedIds = JSON.parse(stored);
  } catch { /* ignore */ }

  let available = WBTY_PRESETS.filter((p) => !usedIds.includes(p.id));

  if (available.length < count) {
    usedIds = [];
    available = [...WBTY_PRESETS];
  }

  const shuffled = [...available].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  const newUsedIds = [...usedIds, ...selected.map((p) => p.id)];
  try {
    localStorage.setItem(storageKey, JSON.stringify(newUsedIds));
  } catch { /* localStorage full */ }

  return selected;
}
