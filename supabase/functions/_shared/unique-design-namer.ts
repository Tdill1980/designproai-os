/**
 * Unique Design Name Generator
 *
 * Generates creative, unique 2-4 word design names for marketplace listings.
 * Checks against existing names in neuralnetwork_design_dna to prevent duplicates.
 */

const ADJECTIVES = [
  "Midnight", "Arctic", "Phantom", "Shadow", "Crimson", "Eclipse", "Neon",
  "Obsidian", "Solar", "Venom", "Storm", "Titanium", "Stealth", "Inferno",
  "Glacier", "Thunder", "Carbon", "Onyx", "Apex", "Nebula", "Voltage",
  "Blaze", "Frost", "Raven", "Ember", "Zenith", "Cobalt", "Vortex",
  "Iron", "Chrome", "Sapphire", "Jade", "Copper", "Scarlet", "Slate",
  "Amber", "Ivory", "Indigo", "Olive", "Ash", "Pearl", "Ruby",
  "Dusk", "Dawn", "Lunar", "Astral", "Prism", "Matte", "Satin",
  "Razor", "Drift", "Turbo", "Aero", "Flash", "Nitro", "Fury",
  "Bolt", "Pulse", "Surge", "Wave", "Flux", "Nova", "Zero",
];

const NOUNS = [
  "Viper", "Panther", "Raptor", "Hawk", "Wolf", "Cobra", "Falcon",
  "Phantom", "Ghost", "Wraith", "Specter", "Reaper", "Hunter", "Striker",
  "Blitz", "Bolt", "Strike", "Edge", "Blade", "Claw", "Fang",
  "Drift", "Flow", "Shift", "Surge", "Rush", "Force", "Torque",
  "Fury", "Storm", "Tempest", "Cyclone", "Thunder", "Lightning", "Voltage",
  "Armor", "Shield", "Titan", "Apex", "Zenith", "Summit", "Peak",
  "Circuit", "Grid", "Matrix", "Vector", "Prism", "Helix", "Axis",
  "GT", "RS", "Pro", "Sport", "Rally", "Touring", "Edition",
];

const SUFFIXES = [
  "GT", "RS", "Pro", "Sport", "Edition", "Series", "EVO", "X",
  "LX", "SE", "SS", "MK2", "V2", "Elite", "Max", "Ultra",
];

/**
 * Generate a candidate design name (2-4 words)
 */
function generateCandidate(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];

  // Avoid duplicating the same word (e.g. "Phantom Phantom")
  if (adj === noun) {
    const altNoun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return `${adj} ${altNoun}`;
  }

  // 30% chance to add a suffix for variety
  if (Math.random() < 0.3) {
    const suffix = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
    return `${adj} ${noun} ${suffix}`;
  }

  return `${adj} ${noun}`;
}

/**
 * Generate a unique design name that doesn't already exist in the database.
 * Falls back to appending a numeric suffix if collisions persist.
 */
export async function generateUniqueDesignName(
  supabase: any,
  maxAttempts = 20,
): Promise<string> {
  // Fetch existing design names to check against
  const { data: existingNames } = await supabase
    .from("neuralnetwork_design_dna")
    .select("design_name")
    .not("design_name", "is", null);

  const usedNames = new Set(
    (existingNames || []).map((r: any) => (r.design_name || "").toLowerCase()),
  );

  // Also check marketplace listings titles
  const { data: listingTitles } = await supabase
    .from("marketplace_listings")
    .select("title");

  for (const listing of listingTitles || []) {
    const parts = (listing.title || "").split(" — ");
    if (parts.length > 1) {
      usedNames.add(parts[1].toLowerCase());
    }
  }

  // Try to generate a unique name
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = generateCandidate();
    if (!usedNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  // Fallback: append a random number
  const base = generateCandidate();
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${base} ${num}`;
}
