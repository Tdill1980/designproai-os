/**
 * ColorPro Batch Preset Library
 *
 * 60 unique vinyl wrap color presets for batch rendering.
 * Each preset has a unique colorName + hex + finish + colorLibrary combo
 * so renders never collide in the cache.
 *
 * Organized by manufacturer: 3M, Avery Dennison, KPMF, Hexis, TeckWrap, Oracal
 */

export interface ColorProPreset {
  id: string;
  colorName: string;
  hex: string;
  finish: "Gloss" | "Satin" | "Matte";
  colorLibrary: string;
  designName: string;
}

export const COLORPRO_PRESETS: ColorProPreset[] = [
  // ── 3M 2080 Series (15) ──────────────────────────────────────────
  { id: "cp-3m-001", colorName: "Hot Rod Red", hex: "#CC0000", finish: "Gloss", colorLibrary: "3m", designName: "3M Hot Rod Red" },
  { id: "cp-3m-002", colorName: "Burnt Orange", hex: "#CC5500", finish: "Gloss", colorLibrary: "3m", designName: "3M Burnt Orange" },
  { id: "cp-3m-003", colorName: "Sunflower Yellow", hex: "#FFD300", finish: "Gloss", colorLibrary: "3m", designName: "3M Sunflower Yellow" },
  { id: "cp-3m-004", colorName: "Acid Green", hex: "#B0BF1A", finish: "Matte", colorLibrary: "3m", designName: "3M Matte Acid Green" },
  { id: "cp-3m-005", colorName: "Riviera Blue", hex: "#009FE3", finish: "Gloss", colorLibrary: "3m", designName: "3M Riviera Blue" },
  { id: "cp-3m-006", colorName: "Midnight Blue", hex: "#003366", finish: "Matte", colorLibrary: "3m", designName: "3M Matte Midnight Blue" },
  { id: "cp-3m-007", colorName: "Deep Space", hex: "#1A1A3E", finish: "Gloss", colorLibrary: "3m", designName: "3M Deep Space" },
  { id: "cp-3m-008", colorName: "Plum Explosion", hex: "#6B2D5B", finish: "Gloss", colorLibrary: "3m", designName: "3M Plum Explosion" },
  { id: "cp-3m-009", colorName: "Charcoal Metallic", hex: "#3C3C3C", finish: "Gloss", colorLibrary: "3m", designName: "3M Charcoal Metallic" },
  { id: "cp-3m-010", colorName: "Sterling Silver", hex: "#C4C4C4", finish: "Gloss", colorLibrary: "3m", designName: "3M Sterling Silver" },
  { id: "cp-3m-011", colorName: "Dragon Fire Red", hex: "#8B0000", finish: "Gloss", colorLibrary: "3m", designName: "3M Dragon Fire Red" },
  { id: "cp-3m-012", colorName: "Fierce Fuchsia", hex: "#C8007A", finish: "Gloss", colorLibrary: "3m", designName: "3M Fierce Fuchsia" },
  { id: "cp-3m-013", colorName: "Anthracite", hex: "#383838", finish: "Matte", colorLibrary: "3m", designName: "3M Matte Anthracite" },
  { id: "cp-3m-014", colorName: "Bright Yellow", hex: "#FFD100", finish: "Gloss", colorLibrary: "3m", designName: "3M Bright Yellow" },
  { id: "cp-3m-015", colorName: "Brown Metallic", hex: "#5C3A21", finish: "Matte", colorLibrary: "3m", designName: "3M Matte Brown Metallic" },

  // ── Avery Dennison Supreme Wrapping Film (15) ─────────────────────
  { id: "cp-av-001", colorName: "Nardo Gray", hex: "#8C8C8C", finish: "Satin", colorLibrary: "avery-dennison", designName: "Avery Nardo Gray" },
  { id: "cp-av-002", colorName: "Black Rose Metallic", hex: "#3B0A1E", finish: "Gloss", colorLibrary: "avery-dennison", designName: "Avery Black Rose Metallic" },
  { id: "cp-av-003", colorName: "Cardinal Red", hex: "#C41E3A", finish: "Gloss", colorLibrary: "avery-dennison", designName: "Avery Cardinal Red" },
  { id: "cp-av-004", colorName: "Passion Red", hex: "#E21836", finish: "Gloss", colorLibrary: "avery-dennison", designName: "Avery Passion Red" },
  { id: "cp-av-005", colorName: "Emerald Green", hex: "#006B3C", finish: "Gloss", colorLibrary: "avery-dennison", designName: "Avery Emerald Green" },
  { id: "cp-av-006", colorName: "Cosmic Blue", hex: "#1A237E", finish: "Gloss", colorLibrary: "avery-dennison", designName: "Avery Cosmic Blue" },
  { id: "cp-av-007", colorName: "Teal", hex: "#008080", finish: "Gloss", colorLibrary: "avery-dennison", designName: "Avery Teal" },
  { id: "cp-av-008", colorName: "Blaze Orange", hex: "#FF6700", finish: "Gloss", colorLibrary: "avery-dennison", designName: "Avery Blaze Orange" },
  { id: "cp-av-009", colorName: "Bubblegum Pink", hex: "#FF69B4", finish: "Gloss", colorLibrary: "avery-dennison", designName: "Avery Bubblegum Pink" },
  { id: "cp-av-010", colorName: "Gold", hex: "#D4AF37", finish: "Gloss", colorLibrary: "avery-dennison", designName: "Avery Gold" },
  { id: "cp-av-011", colorName: "Diamond White", hex: "#F5F5F5", finish: "Gloss", colorLibrary: "avery-dennison", designName: "Avery Diamond White" },
  { id: "cp-av-012", colorName: "Purple", hex: "#6A0DAD", finish: "Gloss", colorLibrary: "avery-dennison", designName: "Avery Purple" },
  { id: "cp-av-013", colorName: "Matte Military Green", hex: "#4B5320", finish: "Matte", colorLibrary: "avery-dennison", designName: "Avery Matte Military Green" },
  { id: "cp-av-014", colorName: "Satin Pearl White", hex: "#F0EAD6", finish: "Satin", colorLibrary: "avery-dennison", designName: "Avery Satin Pearl White" },
  { id: "cp-av-015", colorName: "Dark Grey", hex: "#555555", finish: "Matte", colorLibrary: "avery-dennison", designName: "Avery Matte Dark Grey" },

  // ── KPMF (10) ─────────────────────────────────────────────────────
  { id: "cp-kp-001", colorName: "Tiffany Blue", hex: "#81D8D0", finish: "Gloss", colorLibrary: "kpmf", designName: "KPMF Tiffany Blue" },
  { id: "cp-kp-002", colorName: "Champagne Gold", hex: "#C9A96E", finish: "Gloss", colorLibrary: "kpmf", designName: "KPMF Champagne Gold" },
  { id: "cp-kp-003", colorName: "Wine Red", hex: "#722F37", finish: "Gloss", colorLibrary: "kpmf", designName: "KPMF Wine Red" },
  { id: "cp-kp-004", colorName: "Pacific Blue", hex: "#1CA9C9", finish: "Gloss", colorLibrary: "kpmf", designName: "KPMF Pacific Blue" },
  { id: "cp-kp-005", colorName: "Matte Iced Blue Titanium", hex: "#6E8B9E", finish: "Matte", colorLibrary: "kpmf", designName: "KPMF Matte Iced Blue Titanium" },
  { id: "cp-kp-006", colorName: "Gloss Dark Blue", hex: "#00205B", finish: "Gloss", colorLibrary: "kpmf", designName: "KPMF Dark Blue" },
  { id: "cp-kp-007", colorName: "Racing Red", hex: "#D40000", finish: "Gloss", colorLibrary: "kpmf", designName: "KPMF Racing Red" },
  { id: "cp-kp-008", colorName: "Satin Aurora Green", hex: "#3B7A57", finish: "Satin", colorLibrary: "kpmf", designName: "KPMF Satin Aurora Green" },
  { id: "cp-kp-009", colorName: "Matte Graphite", hex: "#474747", finish: "Matte", colorLibrary: "kpmf", designName: "KPMF Matte Graphite" },
  { id: "cp-kp-010", colorName: "Bronze", hex: "#8C7853", finish: "Gloss", colorLibrary: "kpmf", designName: "KPMF Bronze" },

  // ── Hexis (5) ─────────────────────────────────────────────────────
  { id: "cp-hx-001", colorName: "Satin Khaki Green", hex: "#6B6B47", finish: "Satin", colorLibrary: "hexis", designName: "Hexis Satin Khaki Green" },
  { id: "cp-hx-002", colorName: "Lagoon Blue", hex: "#006994", finish: "Gloss", colorLibrary: "hexis", designName: "Hexis Lagoon Blue" },
  { id: "cp-hx-003", colorName: "Indian Pink", hex: "#D65C8F", finish: "Gloss", colorLibrary: "hexis", designName: "Hexis Indian Pink" },
  { id: "cp-hx-004", colorName: "Matte Asphalt Grey", hex: "#4E4E4E", finish: "Matte", colorLibrary: "hexis", designName: "Hexis Matte Asphalt Grey" },
  { id: "cp-hx-005", colorName: "Ruby Red Metallic", hex: "#9B111E", finish: "Gloss", colorLibrary: "hexis", designName: "Hexis Ruby Red Metallic" },

  // ── TeckWrap (5) ──────────────────────────────────────────────────
  { id: "cp-tw-001", colorName: "Chrome Gold", hex: "#FFD700", finish: "Gloss", colorLibrary: "teckwrap", designName: "TeckWrap Chrome Gold" },
  { id: "cp-tw-002", colorName: "Rose Gold", hex: "#B76E79", finish: "Gloss", colorLibrary: "teckwrap", designName: "TeckWrap Rose Gold" },
  { id: "cp-tw-003", colorName: "Midnight Purple", hex: "#2E0854", finish: "Gloss", colorLibrary: "teckwrap", designName: "TeckWrap Midnight Purple" },
  { id: "cp-tw-004", colorName: "Satin Cement Gray", hex: "#9E9E9E", finish: "Satin", colorLibrary: "teckwrap", designName: "TeckWrap Satin Cement Gray" },
  { id: "cp-tw-005", colorName: "Matte Army Green", hex: "#4B5320", finish: "Matte", colorLibrary: "teckwrap", designName: "TeckWrap Matte Army Green" },

  // ── Oracal (5) ────────────────────────────────────────────────────
  { id: "cp-or-001", colorName: "Red Metallic", hex: "#B22222", finish: "Gloss", colorLibrary: "oracal", designName: "Oracal Red Metallic" },
  { id: "cp-or-002", colorName: "Fjord Blue", hex: "#0277BD", finish: "Gloss", colorLibrary: "oracal", designName: "Oracal Fjord Blue" },
  { id: "cp-or-003", colorName: "Fir Green", hex: "#1B4D3E", finish: "Gloss", colorLibrary: "oracal", designName: "Oracal Fir Green" },
  { id: "cp-or-004", colorName: "Dove Grey", hex: "#B0B0B0", finish: "Matte", colorLibrary: "oracal", designName: "Oracal Matte Dove Grey" },
  { id: "cp-or-005", colorName: "Light Ivory", hex: "#FFF8E1", finish: "Gloss", colorLibrary: "oracal", designName: "Oracal Light Ivory" },

  // ── Inozetek (5) ──────────────────────────────────────────────────
  { id: "cp-iz-001", colorName: "Miami Blue", hex: "#00BFFF", finish: "Gloss", colorLibrary: "inozetek", designName: "Inozetek Miami Blue" },
  { id: "cp-iz-002", colorName: "Frozen Berry", hex: "#8E4585", finish: "Satin", colorLibrary: "inozetek", designName: "Inozetek Satin Frozen Berry" },
  { id: "cp-iz-003", colorName: "Lunar Rock", hex: "#7D8471", finish: "Matte", colorLibrary: "inozetek", designName: "Inozetek Matte Lunar Rock" },
  { id: "cp-iz-004", colorName: "Racing Yellow", hex: "#FFE600", finish: "Gloss", colorLibrary: "inozetek", designName: "Inozetek Racing Yellow" },
  { id: "cp-iz-005", colorName: "Quicksand Khaki", hex: "#C8B98B", finish: "Matte", colorLibrary: "inozetek", designName: "Inozetek Matte Quicksand Khaki" },
];

/**
 * Get `count` unique ColorPro presets, shuffled randomly.
 * Tracks previously used IDs in localStorage to avoid repeats across batches.
 */
export function getRandomColorProPresets(count: number): ColorProPreset[] {
  const storageKey = "restylepro_used_colorpro_presets";

  let usedIds: string[] = [];
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) usedIds = JSON.parse(stored);
  } catch { /* ignore */ }

  let available = COLORPRO_PRESETS.filter((p) => !usedIds.includes(p.id));

  if (available.length < count) {
    usedIds = [];
    available = [...COLORPRO_PRESETS];
  }

  const shuffled = [...available].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  const newUsedIds = [...usedIds, ...selected.map((p) => p.id)];
  try {
    localStorage.setItem(storageKey, JSON.stringify(newUsedIds));
  } catch { /* localStorage full */ }

  return selected;
}
