/**
 * FadeWraps Batch Preset Library
 *
 * 50 unique gradient/fade wrap presets for batch rendering.
 * Each preset has a unique fade direction, color pair, and styling prompt
 * so renders never collide in the cache.
 */

export interface FadeWrapsPreset {
  id: string;
  designName: string;
  hex: string;
  finish: "Gloss" | "Satin" | "Matte";
  fadeSpec: {
    direction: "top-to-bottom" | "front-to-rear" | "diagonal" | "bottom-to-top" | "rear-to-front";
    colorFrom: string;
    colorTo: string;
    style: "smooth" | "hard" | "dissolve";
  };
  customStylingPrompt: string;
}

export const FADEWRAPS_PRESETS: FadeWrapsPreset[] = [
  // ── Top-to-Bottom Fades (12) ──────────────────────────────────────
  {
    id: "fw-tb-001", designName: "Magma Flow", hex: "#FF6B00", finish: "Gloss",
    fadeSpec: { direction: "top-to-bottom", colorFrom: "#FF6B00", colorTo: "#0A0A0A", style: "smooth" },
    customStylingPrompt: "Burnt orange at the roofline melting smoothly into pure black at the rocker panels. 8-inch smooth gradient at beltline. Real vinyl color.",
  },
  {
    id: "fw-tb-002", designName: "Rosé Dusk", hex: "#FFB7C5", finish: "Gloss",
    fadeSpec: { direction: "top-to-bottom", colorFrom: "#FFB7C5", colorTo: "#F5F5F0", style: "smooth" },
    customStylingPrompt: "Soft blush pink at the roof fading smoothly into clean pearl white at the bottom. Gentle gradient like rosé wine into fresh white.",
  },
  {
    id: "fw-tb-003", designName: "Arctic Glacier", hex: "#00CED1", finish: "Gloss",
    fadeSpec: { direction: "top-to-bottom", colorFrom: "#00CED1", colorTo: "#F0F8FF", style: "smooth" },
    customStylingPrompt: "Icy turquoise at the roof fading down into frost white at the rockers. Clean glacier melt effect, crystalline and cold.",
  },
  {
    id: "fw-tb-004", designName: "Volcanic Ash", hex: "#B22222", finish: "Matte",
    fadeSpec: { direction: "top-to-bottom", colorFrom: "#B22222", colorTo: "#2C2C2C", style: "smooth" },
    customStylingPrompt: "Deep crimson red at the roof dissolving into dark ash gray at the bottom. Matte finish, smoldering volcanic lava cooling into stone.",
  },
  {
    id: "fw-tb-005", designName: "Citrus Crush", hex: "#FFD700", finish: "Gloss",
    fadeSpec: { direction: "top-to-bottom", colorFrom: "#FFD700", colorTo: "#FF4500", style: "smooth" },
    customStylingPrompt: "Bright golden yellow at the roof fading into deep orange-red at the rockers. Warm citrus sunset gradient, vibrant and energetic.",
  },
  {
    id: "fw-tb-006", designName: "Midnight Mist", hex: "#191970", finish: "Satin",
    fadeSpec: { direction: "top-to-bottom", colorFrom: "#191970", colorTo: "#708090", style: "smooth" },
    customStylingPrompt: "Deep midnight navy at the roof dissolving into cool slate gray at the bottom. Satin finish, moody night sky fading into fog.",
  },
  {
    id: "fw-tb-007", designName: "Cotton Candy", hex: "#FFB6C1", finish: "Gloss",
    fadeSpec: { direction: "top-to-bottom", colorFrom: "#FFB6C1", colorTo: "#ADD8E6", style: "smooth" },
    customStylingPrompt: "Soft pink at the roof melting into baby blue at the rockers. Sweet pastel gradient, light and playful carnival cotton candy.",
  },
  {
    id: "fw-tb-008", designName: "Obsidian Fall", hex: "#1C1C1C", finish: "Matte",
    fadeSpec: { direction: "top-to-bottom", colorFrom: "#1C1C1C", colorTo: "#696969", style: "smooth" },
    customStylingPrompt: "Pure matte black at the roof fading into medium gray at the rockers. Stealth monochrome gradient, dark to light.",
  },
  {
    id: "fw-tb-009", designName: "Lime Shock", hex: "#32CD32", finish: "Gloss",
    fadeSpec: { direction: "top-to-bottom", colorFrom: "#32CD32", colorTo: "#0A0A0A", style: "smooth" },
    customStylingPrompt: "Electric lime green at the roof melting into pure black at the bottom. High contrast neon-to-dark gradient.",
  },
  {
    id: "fw-tb-010", designName: "Royal Velvet", hex: "#4B0082", finish: "Satin",
    fadeSpec: { direction: "top-to-bottom", colorFrom: "#4B0082", colorTo: "#C0C0C0", style: "smooth" },
    customStylingPrompt: "Rich indigo purple at the roof fading into polished silver at the rockers. Satin finish, regal and luxurious.",
  },
  {
    id: "fw-tb-011", designName: "Autumn Ember", hex: "#CC5500", finish: "Gloss",
    fadeSpec: { direction: "top-to-bottom", colorFrom: "#CC5500", colorTo: "#8B4513", style: "smooth" },
    customStylingPrompt: "Warm burnt sienna at the roof fading into rich chocolate brown at the bottom. Autumn leaf color transition, earthy and warm.",
  },
  {
    id: "fw-tb-012", designName: "Whiteout", hex: "#FFFFFF", finish: "Gloss",
    fadeSpec: { direction: "top-to-bottom", colorFrom: "#FFFFFF", colorTo: "#1A1A1A", style: "smooth" },
    customStylingPrompt: "Pure white at the roof fading smoothly into deep black at the rockers. Clean monochrome gradient, high contrast.",
  },

  // ── Front-to-Rear Fades (12) ──────────────────────────────────────
  {
    id: "fw-fr-001", designName: "Deep Current", hex: "#0A1628", finish: "Gloss",
    fadeSpec: { direction: "front-to-rear", colorFrom: "#0A1628", colorTo: "#C0C0C0", style: "smooth" },
    customStylingPrompt: "Midnight navy blue at the front sweeping back through medium blue at doors into bright metallic silver at rear quarters.",
  },
  {
    id: "fw-fr-002", designName: "Emerald Sovereign", hex: "#006B3C", finish: "Gloss",
    fadeSpec: { direction: "front-to-rear", colorFrom: "#006B3C", colorTo: "#D4AF37", style: "smooth" },
    customStylingPrompt: "Rich emerald green at the front flowing rearward into warm champagne gold. British racing green through forest green into gold at rear.",
  },
  {
    id: "fw-fr-003", designName: "Desert Storm", hex: "#C19A6B", finish: "Matte",
    fadeSpec: { direction: "front-to-rear", colorFrom: "#C19A6B", colorTo: "#2C1810", style: "smooth" },
    customStylingPrompt: "Sandy tan at the front fading rearward into dark espresso brown at the tail. Desert sand to earth, matte finish.",
  },
  {
    id: "fw-fr-004", designName: "Electric Slide", hex: "#00BFFF", finish: "Gloss",
    fadeSpec: { direction: "front-to-rear", colorFrom: "#00BFFF", colorTo: "#8B00FF", style: "smooth" },
    customStylingPrompt: "Bright electric blue at the front sweeping into vivid purple at the rear. Bold neon gradient from cyan to violet.",
  },
  {
    id: "fw-fr-005", designName: "Sunset Boulevard", hex: "#FF4500", finish: "Gloss",
    fadeSpec: { direction: "front-to-rear", colorFrom: "#FF4500", colorTo: "#FFD700", style: "smooth" },
    customStylingPrompt: "Deep orange-red at the front flowing into bright golden yellow at the rear. California sunset gradient sweeping along the body.",
  },
  {
    id: "fw-fr-006", designName: "Polar Shift", hex: "#E0F0FF", finish: "Satin",
    fadeSpec: { direction: "front-to-rear", colorFrom: "#E0F0FF", colorTo: "#003366", style: "smooth" },
    customStylingPrompt: "Icy pale blue at the front transitioning into deep navy at the rear. Arctic to ocean depth, satin finish.",
  },
  {
    id: "fw-fr-007", designName: "Chrome Fade", hex: "#C0C0C0", finish: "Gloss",
    fadeSpec: { direction: "front-to-rear", colorFrom: "#C0C0C0", colorTo: "#1A1A1A", style: "smooth" },
    customStylingPrompt: "Bright polished silver at the front sweeping into deep black at the rear. Chrome to shadow, clean metallic gradient.",
  },
  {
    id: "fw-fr-008", designName: "Coral Reef", hex: "#FF6F61", finish: "Gloss",
    fadeSpec: { direction: "front-to-rear", colorFrom: "#FF6F61", colorTo: "#008B8B", style: "smooth" },
    customStylingPrompt: "Warm coral at the front fading into deep teal at the rear. Tropical ocean gradient from warm shallow reef to deep water.",
  },
  {
    id: "fw-fr-009", designName: "Sandstorm", hex: "#EDC9AF", finish: "Matte",
    fadeSpec: { direction: "front-to-rear", colorFrom: "#EDC9AF", colorTo: "#8B6914", style: "smooth" },
    customStylingPrompt: "Light sand beige at the front fading into dark bronze at the rear. Desert wind gradient, matte finish.",
  },
  {
    id: "fw-fr-010", designName: "Neon Rush", hex: "#39FF14", finish: "Gloss",
    fadeSpec: { direction: "front-to-rear", colorFrom: "#39FF14", colorTo: "#FF1493", style: "smooth" },
    customStylingPrompt: "Screaming neon green at the front sweeping into hot pink at the rear. Bold and loud gradient, impossible to miss.",
  },
  {
    id: "fw-fr-011", designName: "Gunmetal Horizon", hex: "#2C3539", finish: "Satin",
    fadeSpec: { direction: "front-to-rear", colorFrom: "#2C3539", colorTo: "#778899", style: "smooth" },
    customStylingPrompt: "Dark gunmetal at the front fading into light slate blue-gray at the rear. Understated military gradient, satin finish.",
  },
  {
    id: "fw-fr-012", designName: "Blood Moon", hex: "#8B0000", finish: "Gloss",
    fadeSpec: { direction: "front-to-rear", colorFrom: "#8B0000", colorTo: "#0A0A0A", style: "smooth" },
    customStylingPrompt: "Deep blood red at the front dissolving into pure black at the rear. Menacing gradient, darkening as it sweeps back.",
  },

  // ── Diagonal Fades (10) ───────────────────────────────────────────
  {
    id: "fw-dg-001", designName: "Ultraviolet Shift", hex: "#8B00FF", finish: "Satin",
    fadeSpec: { direction: "diagonal", colorFrom: "#8B00FF", colorTo: "#050510", style: "smooth" },
    customStylingPrompt: "Deep electric purple at the front fading diagonally into true black at the rear. Satin finish, stealth and moody.",
  },
  {
    id: "fw-dg-002", designName: "Solar Flare", hex: "#FFD700", finish: "Gloss",
    fadeSpec: { direction: "diagonal", colorFrom: "#FFD700", colorTo: "#FF4500", style: "smooth" },
    customStylingPrompt: "Bright gold at the upper front fading diagonally into fiery orange-red at the lower rear. Sun surface eruption diagonal.",
  },
  {
    id: "fw-dg-003", designName: "Ocean Drift", hex: "#00CED1", finish: "Gloss",
    fadeSpec: { direction: "diagonal", colorFrom: "#00CED1", colorTo: "#000080", style: "smooth" },
    customStylingPrompt: "Light turquoise at the upper front fading diagonally into deep navy at the lower rear. Shallow to deep ocean diagonal.",
  },
  {
    id: "fw-dg-004", designName: "Frost Bite", hex: "#E0F8FF", finish: "Matte",
    fadeSpec: { direction: "diagonal", colorFrom: "#E0F8FF", colorTo: "#4682B4", style: "smooth" },
    customStylingPrompt: "Icy frost white at the upper front fading diagonally into steel blue at the lower rear. Matte frozen gradient.",
  },
  {
    id: "fw-dg-005", designName: "Molten Core", hex: "#FF0000", finish: "Gloss",
    fadeSpec: { direction: "diagonal", colorFrom: "#FF0000", colorTo: "#4A0404", style: "smooth" },
    customStylingPrompt: "Bright cherry red at the upper front fading diagonally into darkest maroon at the lower rear. Molten metal cooling.",
  },
  {
    id: "fw-dg-006", designName: "Toxic Spill", hex: "#39FF14", finish: "Gloss",
    fadeSpec: { direction: "diagonal", colorFrom: "#39FF14", colorTo: "#1A1A1A", style: "smooth" },
    customStylingPrompt: "Neon toxic green at the upper front dissolving diagonally into pitch black at the lower rear. Radioactive glow diagonal.",
  },
  {
    id: "fw-dg-007", designName: "Amethyst Haze", hex: "#9966CC", finish: "Satin",
    fadeSpec: { direction: "diagonal", colorFrom: "#9966CC", colorTo: "#2F0A3C", style: "smooth" },
    customStylingPrompt: "Medium amethyst purple at the upper front fading diagonally into deep plum at the lower rear. Satin gemstone gradient.",
  },
  {
    id: "fw-dg-008", designName: "Copper Canyon", hex: "#B87333", finish: "Gloss",
    fadeSpec: { direction: "diagonal", colorFrom: "#B87333", colorTo: "#1A1A1A", style: "smooth" },
    customStylingPrompt: "Rich copper at the upper front fading diagonally into black at the lower rear. Warm metallic dissolving into shadow.",
  },
  {
    id: "fw-dg-009", designName: "Blue Steel", hex: "#4682B4", finish: "Satin",
    fadeSpec: { direction: "diagonal", colorFrom: "#4682B4", colorTo: "#2C3539", style: "smooth" },
    customStylingPrompt: "Steel blue at the upper front fading diagonally into dark gunmetal at the lower rear. Satin industrial gradient.",
  },
  {
    id: "fw-dg-010", designName: "Peach Horizon", hex: "#FFDAB9", finish: "Gloss",
    fadeSpec: { direction: "diagonal", colorFrom: "#FFDAB9", colorTo: "#FF6347", style: "smooth" },
    customStylingPrompt: "Soft peach at the upper front fading diagonally into warm tomato red at the lower rear. Gentle sunrise diagonal.",
  },

  // ── Bottom-to-Top Fades (8) ───────────────────────────────────────
  {
    id: "fw-bt-001", designName: "Rising Inferno", hex: "#FF2400", finish: "Gloss",
    fadeSpec: { direction: "bottom-to-top", colorFrom: "#FF2400", colorTo: "#0A0A0A", style: "smooth" },
    customStylingPrompt: "Scorching red at the rocker panels rising up and fading into black at the roof. Flames rising from below.",
  },
  {
    id: "fw-bt-002", designName: "Tidal Rise", hex: "#006994", finish: "Gloss",
    fadeSpec: { direction: "bottom-to-top", colorFrom: "#006994", colorTo: "#F5F5F5", style: "smooth" },
    customStylingPrompt: "Deep ocean blue at the rockers rising up into clean white at the roof. Water level rising on the body.",
  },
  {
    id: "fw-bt-003", designName: "Forest Floor", hex: "#228B22", finish: "Matte",
    fadeSpec: { direction: "bottom-to-top", colorFrom: "#228B22", colorTo: "#2C2C2C", style: "smooth" },
    customStylingPrompt: "Forest green at the bottom rising into dark charcoal at the roof. Matte finish, earth to shadow.",
  },
  {
    id: "fw-bt-004", designName: "Gold Rush", hex: "#CFB53B", finish: "Gloss",
    fadeSpec: { direction: "bottom-to-top", colorFrom: "#CFB53B", colorTo: "#1A1A1A", style: "smooth" },
    customStylingPrompt: "Rich old gold at the rockers rising up into deep black at the roof. Treasure emerging from darkness.",
  },
  {
    id: "fw-bt-005", designName: "Lavender Rise", hex: "#B57EDC", finish: "Satin",
    fadeSpec: { direction: "bottom-to-top", colorFrom: "#B57EDC", colorTo: "#F5F5F5", style: "smooth" },
    customStylingPrompt: "Soft lavender at the bottom rising into pearl white at the roof. Satin finish, gentle and elegant upward fade.",
  },
  {
    id: "fw-bt-006", designName: "Ember Glow", hex: "#FF8C00", finish: "Gloss",
    fadeSpec: { direction: "bottom-to-top", colorFrom: "#FF8C00", colorTo: "#4A0000", style: "smooth" },
    customStylingPrompt: "Bright amber orange at the rockers rising into deep dark red at the roof. Ember coals glowing from below.",
  },
  {
    id: "fw-bt-007", designName: "Aqua Surge", hex: "#00FFFF", finish: "Gloss",
    fadeSpec: { direction: "bottom-to-top", colorFrom: "#00FFFF", colorTo: "#000033", style: "smooth" },
    customStylingPrompt: "Bright cyan at the bottom rising into deep dark blue at the roof. Bioluminescent ocean surge from below.",
  },
  {
    id: "fw-bt-008", designName: "Bronze Ascent", hex: "#CD7F32", finish: "Satin",
    fadeSpec: { direction: "bottom-to-top", colorFrom: "#CD7F32", colorTo: "#3B3B3B", style: "smooth" },
    customStylingPrompt: "Warm bronze at the rockers rising into dark charcoal at the roof. Satin finish, metal warming from below.",
  },

  // ── Rear-to-Front Fades (8) ───────────────────────────────────────
  {
    id: "fw-rf-001", designName: "Jet Stream", hex: "#0A0A0A", finish: "Gloss",
    fadeSpec: { direction: "rear-to-front", colorFrom: "#0A0A0A", colorTo: "#C0C0C0", style: "smooth" },
    customStylingPrompt: "Pure black at the rear sweeping forward into bright silver at the nose. Like a jet exhaust trail, dark to bright.",
  },
  {
    id: "fw-rf-002", designName: "Cherry Blossom", hex: "#FFB7C5", finish: "Gloss",
    fadeSpec: { direction: "rear-to-front", colorFrom: "#FFB7C5", colorTo: "#F5F5F5", style: "smooth" },
    customStylingPrompt: "Soft cherry blossom pink at the rear fading forward into clean white at the front. Gentle sakura petal gradient.",
  },
  {
    id: "fw-rf-003", designName: "Thunder Grey", hex: "#505050", finish: "Matte",
    fadeSpec: { direction: "rear-to-front", colorFrom: "#505050", colorTo: "#C0C0C0", style: "smooth" },
    customStylingPrompt: "Dark storm gray at the rear fading forward into light silver at the front. Matte thundercloud gradient.",
  },
  {
    id: "fw-rf-004", designName: "Tropic Punch", hex: "#FF1493", finish: "Gloss",
    fadeSpec: { direction: "rear-to-front", colorFrom: "#FF1493", colorTo: "#FFD700", style: "smooth" },
    customStylingPrompt: "Hot pink at the rear sweeping forward into golden yellow at the front. Tropical punch gradient, bold and playful.",
  },
  {
    id: "fw-rf-005", designName: "Titanium Wave", hex: "#878787", finish: "Satin",
    fadeSpec: { direction: "rear-to-front", colorFrom: "#878787", colorTo: "#D4D4D4", style: "smooth" },
    customStylingPrompt: "Medium titanium at the rear fading forward into light platinum at the front. Satin metallic wave, subtle and refined.",
  },
  {
    id: "fw-rf-006", designName: "Venom", hex: "#00FF00", finish: "Gloss",
    fadeSpec: { direction: "rear-to-front", colorFrom: "#00FF00", colorTo: "#0A0A0A", style: "smooth" },
    customStylingPrompt: "Toxic neon green at the rear fading forward into pure black at the nose. Venomous glow trailing behind the car.",
  },
  {
    id: "fw-rf-007", designName: "Wine Country", hex: "#722F37", finish: "Gloss",
    fadeSpec: { direction: "rear-to-front", colorFrom: "#722F37", colorTo: "#D4AF37", style: "smooth" },
    customStylingPrompt: "Deep wine red at the rear flowing forward into warm gold at the front. Burgundy vineyard into champagne, luxurious.",
  },
  {
    id: "fw-rf-008", designName: "Ice Storm", hex: "#B0E0E6", finish: "Satin",
    fadeSpec: { direction: "rear-to-front", colorFrom: "#B0E0E6", colorTo: "#1A1A3E", style: "smooth" },
    customStylingPrompt: "Pale powder blue at the rear fading forward into deep midnight blue at the front. Satin ice storm approaching.",
  },
];

/**
 * Get `count` unique FadeWraps presets, shuffled randomly.
 * Tracks previously used IDs in localStorage to avoid repeats across batches.
 */
export function getRandomFadeWrapsPresets(count: number): FadeWrapsPreset[] {
  const storageKey = "restylepro_used_fadewraps_presets";

  let usedIds: string[] = [];
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) usedIds = JSON.parse(stored);
  } catch { /* ignore */ }

  let available = FADEWRAPS_PRESETS.filter((p) => !usedIds.includes(p.id));

  if (available.length < count) {
    usedIds = [];
    available = [...FADEWRAPS_PRESETS];
  }

  const shuffled = [...available].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  const newUsedIds = [...usedIds, ...selected.map((p) => p.id)];
  try {
    localStorage.setItem(storageKey, JSON.stringify(newUsedIds));
  } catch { /* localStorage full */ }

  return selected;
}
