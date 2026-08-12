/**
 * DesignPro Premium Batch Preset Library
 *
 * 30 high-end commercial wrap presets with photo-integrated design language.
 * Think Les Mills, Equinox, Compass — premium brands where photography is
 * woven INTO the design composition, not pasted on top.
 *
 * Every prompt describes HOW the photo integrates: blended, masked, faded,
 * duotone-treated, geometric-clipped, layered with texture. The photo is
 * a design element, not a decal.
 *
 * Industries: Premium Fitness, Luxury Real Estate, High-End Auto, Med Spa,
 * Architecture, Premium F&B, Tech/Creative, Luxury Events
 */

export interface DesignProPreset {
  id: string;
  designName: string;
  prompt: string;
  mode: "commercial" | "restyle";
  subcategory: string;
  tags: string[];
  vehicle: { year: string; make: string; model: string };
}

export const DESIGNPRO_PREMIUM_PRESETS: DesignProPreset[] = [
  // ── Premium Fitness & Wellness (5) ────────────────────────────────
  {
    id: "dp-fit-001",
    designName: "Apex Performance Lab",
    subcategory: "Premium Fitness",
    tags: ["gym", "fitness", "premium", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Mercedes-Benz", model: "Sprinter 2500" },
    prompt: "Design Type: Commercial. Company: Apex Performance Lab. Matte black full body. A dramatic photograph of an elite athlete mid-deadlift dissolves into an angular geometric shatter pattern — the image is broken into triangular shards that scatter across the doors and fade into the matte black body toward the front fender, as if the photo is exploding outward from the rear quarter. Each shard has a subtle burnt orange edge glow. 'APEX' in massive condensed white sans-serif on the hood. Thin orange accent line at the beltline connecting the design. apexperformancelab.com on the rear doors. The photo IS the design — not separate from it.",
  },
  {
    id: "dp-fit-002",
    designName: "FORM Studio",
    subcategory: "Premium Fitness",
    tags: ["yoga", "pilates", "studio", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Tesla", model: "Model X" },
    prompt: "Design Type: Commercial. Company: FORM Studio. Satin white full wrap. A golden-hour photograph of a woman in a graceful warrior pose is treated as a soft duotone in sage green and cream — the image is masked inside a large organic flowing shape that wraps from the rear door across the passenger side, with the figure's silhouette bleeding into soft watercolor washes that follow the body lines of the vehicle. No hard edges — the photo melts into the white body like a yoga flow. 'FORM' in elegant thin serif with extreme letter-spacing on the driver door in muted sage. formstudio.co on the tailgate. Kinfolk editorial energy.",
  },
  {
    id: "dp-fit-003",
    designName: "GRIT Boxing Club",
    subcategory: "Premium Fitness",
    tags: ["boxing", "mma", "athletic", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Ford", model: "Bronco Raptor" },
    prompt: "Design Type: Commercial. Company: GRIT Boxing Club. Matte gunmetal gray full wrap. A high-contrast black-and-white photograph of a boxer's taped hands mid-strike is integrated into a paint-splatter explosion — the impact point of the punch erupts into real paint splatter and grunge texture that splatters across both doors and onto the fender, mixing photographic realism with graphic destruction. A single red diagonal stripe slashes across the hood. 'GRIT' in bold distressed stencil letters on the driver side emerging from the splatter. gritboxing.com on the rear. Fight poster meets street art.",
  },
  {
    id: "dp-fit-004",
    designName: "Elevation Cycle Studio",
    subcategory: "Premium Fitness",
    tags: ["cycling", "spin", "cardio", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Range Rover", model: "Sport" },
    prompt: "Design Type: Commercial. Company: Elevation Cycle Studio. Deep navy satin wrap. A photograph of a packed spin class — riders backlit by dramatic purple and blue LEDs — is masked inside a series of sweeping speed lines that flow from the front wheel arch back toward the tail, creating a motion-blur integration where the photo fades through translucent gradient bands. Thin neon purple accent line traces the beltline as if powered by the energy in the photo. 'ELEVATION' in wide-spaced white caps on the driver door. elevationcycle.com on the rear. SoulCycle meets velocity.",
  },
  {
    id: "dp-fit-005",
    designName: "IronHaus Strength Co",
    subcategory: "Premium Fitness",
    tags: ["crossfit", "strength", "industrial", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Chevrolet", model: "Silverado 2500HD" },
    prompt: "Design Type: Commercial. Company: IronHaus Strength Co. Raw concrete gray textured wrap. A dramatic photograph of an athlete doing a clean-and-jerk with chalk dust exploding is composited inside the outline of a giant industrial gear emblem that spans the passenger side — the photo fills the gear shape while the concrete texture surrounds it. Riveted steel plate accents on the fender arches frame the composition. 'IRONHAUS' in stencil military font in flat black on the driver side. ironhaus.fit on the tailgate. The photo lives inside the brand identity, not beside it.",
  },

  // ── Luxury Real Estate (5) ────────────────────────────────────────
  {
    id: "dp-re-001",
    designName: "Meridian Luxury Properties",
    subcategory: "Luxury Real Estate",
    tags: ["realtor", "luxury", "mansion", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Cadillac", model: "Escalade" },
    prompt: "Design Type: Commercial. Company: Meridian Luxury Properties. Satin black full wrap. A twilight photograph of a $12M modern estate — glass walls glowing amber, infinity pool, palm silhouettes — is integrated as a wide cinematic band across the lower third of both sides, framed by thin gold metallic pinstripe borders top and bottom. The photo wraps continuously around the vehicle at door-handle height like a film strip of luxury. The upper two-thirds stays clean satin black. 'MERIDIAN' in thin gold serif with wide spacing on the upper door panel. meridianluxury.com on the rear in gold. Architectural Digest driving down the street.",
  },
  {
    id: "dp-re-002",
    designName: "Compass Elite Group",
    subcategory: "Luxury Real Estate",
    tags: ["real estate", "coastal", "aerial", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "BMW", model: "X7" },
    prompt: "Design Type: Commercial. Company: Compass Elite Group. Pearl white satin wrap. An aerial drone photograph of a coastal estate on a cliff — turquoise water, white architecture — is treated with a soft fade-to-white and masked into a large diamond geometric shape centered on the passenger side. The diamond's edges are crisp but the photo inside softly desaturates toward the edges, blending into the pearl white body. Thin charcoal lines extend from the diamond corners along body lines as design accents. 'COMPASS ELITE' in refined charcoal sans-serif on the driver door. compasselite.com on the rear. Sotheby's-level restraint.",
  },
  {
    id: "dp-re-003",
    designName: "Vault Development Group",
    subcategory: "Luxury Real Estate",
    tags: ["developer", "condo", "urban", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Mercedes-Benz", model: "GLS 580" },
    prompt: "Design Type: Commercial. Company: Vault Development Group. Matte charcoal wrap. A dusk photograph of a luxury high-rise tower — every floor glowing amber through glass — is composited as a reflection in a stylized architectural window frame that spans the passenger doors. The photo appears as if you are looking through the vehicle's body into the building beyond, with subtle brushed copper framing the window shape. 'VAULT' in bold geometric copper letters on the driver side. vaultdevelopment.com on the rear. The wrap is a portal into their portfolio.",
  },
  {
    id: "dp-re-004",
    designName: "Prestige Ranch & Land",
    subcategory: "Luxury Real Estate",
    tags: ["ranch", "land", "rural", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Ford", model: "F-350 Super Duty" },
    prompt: "Design Type: Commercial. Company: Prestige Ranch & Land. Warm cream upper body with saddle brown leather texture on the lower third. A golden hour photograph of a sprawling Montana ranch — white fencing, grazing horses, mountain backdrop — is treated as a soft sepia-toned panoramic strip that runs along the beltline from nose to tail, like a landscape painting framed between the cream above and leather below. A branded iron ranch mark burns subtly into the driver door as the logo. 'PRESTIGE RANCH & LAND' in Western serif in dark brown below the panoramic band. prestigeranchland.com on the tailgate. Ralph Lauren meets the open range.",
  },
  {
    id: "dp-re-005",
    designName: "Lux Interior Design Studio",
    subcategory: "Luxury Real Estate",
    tags: ["interior design", "luxury", "home", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Porsche", model: "Cayenne" },
    prompt: "Design Type: Commercial. Company: Lux Interior Design Studio. Warm greige satin wrap. A photograph of a designer living room — custom millwork, marble fireplace, linen furniture, natural light — is overlaid at 40% opacity as a full-side ghost image that lets the greige body color show through, creating a dreamy double-exposure effect where the interior space blends with the vehicle's curves. Muted gold accent at the beltline. 'LUX' in elegant thin display font on the driver door. luxinteriors.com on the rear. Quiet luxury — the photo whispers, it does not shout.",
  },

  // ── Premium Food & Beverage (5) ───────────────────────────────────
  {
    id: "dp-fb-001",
    designName: "Ember Omakase",
    subcategory: "Premium F&B",
    tags: ["sushi", "japanese", "fine dining", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Lexus", model: "LX 600" },
    prompt: "Design Type: Commercial. Company: Ember Omakase. Deep charcoal black wrap. A close-up photograph of a chef's hands placing an exquisite piece of A5 wagyu nigiri with gold leaf is composited inside a large circular enso brushstroke — the Japanese calligraphy circle frames the photo on the passenger side while ink splatters and brush texture radiate outward, blending into the black body. A thin red lacquer accent line traces the beltline. 'EMBER' in clean serif on the driver door in warm gold. emberomakase.com on the rear. The enso circle IS the brand, the photo lives inside it.",
  },
  {
    id: "dp-fb-002",
    designName: "Harvest & Hearth",
    subcategory: "Premium F&B",
    tags: ["farm to table", "restaurant", "organic", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Rivian", model: "R1S" },
    prompt: "Design Type: Commercial. Company: Harvest & Hearth. Warm terracotta to cream gradient. A photograph of a rustic farm table set outdoors at golden hour — artisanal bread, heirloom tomatoes, wine — is woven into a botanical illustration frame of hand-drawn herbs, olive branches, and wheat stalks. The photo sits within the illustration like a vignette, with drawn elements growing out of the photo's edges and curling along the body lines. 'HARVEST & HEARTH' in hand-drawn serif on the driver door. harvestandhearth.com on the rear. The illustration and photo are one composition.",
  },
  {
    id: "dp-fb-003",
    designName: "Noire Wine Bar",
    subcategory: "Premium F&B",
    tags: ["wine", "bar", "luxury", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Mercedes-AMG", model: "GT" },
    prompt: "Design Type: Commercial. Company: Noire Wine Bar. Gloss midnight black wrap. A photograph of a sommelier pouring deep red Burgundy into crystal — candlelight, golden bokeh — is treated as a rich duotone in black and deep burgundy, then faded into the gloss black from the rear quarter forward so the image dissolves into the vehicle's own dark reflection. The wine pour appears to flow with the body lines. A thin burgundy accent traces the rocker panel. 'NOIRE' in tall thin gold serif on the driver door. noirewine.com on the rear. Moody speakeasy energy — the photo IS the darkness.",
  },
  {
    id: "dp-fb-004",
    designName: "Matcha Ritual",
    subcategory: "Premium F&B",
    tags: ["matcha", "tea", "wellness", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Tesla", model: "Model Y" },
    prompt: "Design Type: Commercial. Company: Matcha Ritual. Clean matte white wrap. An overhead photograph of a traditional matcha preparation — bamboo whisk, emerald froth in a ceramic chawan — is integrated into a clean circular cutout centered on the passenger door, surrounded by delicate hand-drawn concentric circles that ripple outward along the body like water rings in a zen garden. The circles are in muted matcha green, thinning as they expand. 'MATCHA RITUAL' in minimalist sans-serif in forest green on the driver door. matcharitual.co on the rear. Japanese minimalism — the circle of tea, the ripples of intention.",
  },
  {
    id: "dp-fb-005",
    designName: "Kindling Steakhouse",
    subcategory: "Premium F&B",
    tags: ["steakhouse", "premium", "meat", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "GMC", model: "Sierra Denali" },
    prompt: "Design Type: Commercial. Company: Kindling Steakhouse. Deep oxblood red fading to charcoal black at the rear. A photograph of a tomahawk ribeye being seared over open flame is composited with real fire and ember particle effects — the fire from the photo extends beyond the image bounds, with sparks and embers scattering across the hood and fender as glowing orange particles on the dark body. The photo blends seamlessly where flame meets vehicle. 'KINDLING' in bold serif with a subtle ember texture inside the letters on the driver door in brass. kindlingsteakhouse.com on the rear. The vehicle looks like it is on fire from the grill.",
  },

  // ── Med Spa & Aesthetics (4) ──────────────────────────────────────
  {
    id: "dp-ms-001",
    designName: "Revive Aesthetics",
    subcategory: "Med Spa",
    tags: ["medspa", "botox", "beauty", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "BMW", model: "iX" },
    prompt: "Design Type: Commercial. Company: Revive Aesthetics. Soft pearl white satin wrap. A close-up beauty editorial photograph of a woman's face with flawless dewy skin is treated as a high-key desaturated image that fades into the pearl white body — her features dissolve into the vehicle surface like a beauty product advertisement where the model becomes the packaging. Soft rose gold particle dust drifts across the transition zone. 'REVIVE' in elegant thin sans-serif in rose gold on the driver door. reviveaesthetics.com on the rear. Glossier meets automotive design — the face becomes the vehicle.",
  },
  {
    id: "dp-ms-002",
    designName: "Cryo Recovery Lab",
    subcategory: "Med Spa",
    tags: ["cryotherapy", "recovery", "biohacking", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Porsche", model: "Macan" },
    prompt: "Design Type: Commercial. Company: Cryo Recovery Lab. Metallic ice blue wrap. A photograph of an athlete stepping out of a cryo chamber with vapor billowing is integrated with frost and ice crystal textures that spread outward from the photo across the doors — the vapor from the image transitions into real crystalline ice patterns that crawl along the body panels as if the vehicle itself is freezing. 'CRYO' in bold geometric white letters on the driver side, each letter coated in frost texture. cryorecoverylab.com on the rear. The entire vehicle feels sub-zero.",
  },
  {
    id: "dp-ms-003",
    designName: "Aura IV Wellness",
    subcategory: "Med Spa",
    tags: ["iv therapy", "wellness", "hydration", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Mercedes-Benz", model: "EQE SUV" },
    prompt: "Design Type: Commercial. Company: Aura IV Wellness. Soft lavender-to-pale-blue gradient satin wrap. A photograph of a relaxed client receiving an IV drip in a spa-like setting is composited inside a large abstract fluid shape — an organic blob of soft gradient color that floats on the passenger side like a vitamin droplet, with the photo living inside the shape. Smaller translucent fluid shapes in pink, blue, and gold float around it like supplement capsules in water. 'AURA' in clean modern serif in deep violet on the driver door. auraivwellness.com on the rear. The photo lives inside the brand's visual language.",
  },
  {
    id: "dp-ms-004",
    designName: "Sculpt Body Studio",
    subcategory: "Med Spa",
    tags: ["body sculpting", "coolsculpting", "aesthetics", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Audi", model: "e-tron GT" },
    prompt: "Design Type: Commercial. Company: Sculpt Body Studio. Matte warm bronze fading to matte black. An artistic photograph of a sculpted torso with dramatic side-lighting is rendered as a large-scale bronze metallic relief — the photo is treated to look like embossed metal, with highlights and shadows that match the vehicle's own body curves. The image appears stamped into the passenger side as if the vehicle was cast from the same mold as the body. 'SCULPT' in bold condensed white on the driver side. sculptbodystudio.com on the rear. Calvin Klein fragrance ad meets industrial sculpture.",
  },

  // ── Luxury Auto & Lifestyle (3) ───────────────────────────────────
  {
    id: "dp-au-001",
    designName: "Vault Auto Gallery",
    subcategory: "Luxury Auto",
    tags: ["exotic cars", "dealership", "collector", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Lamborghini", model: "Urus" },
    prompt: "Design Type: Commercial. Company: Vault Auto Gallery. Satin black wrap. A photograph of a collector showroom — a row of exotics under museum lighting, polished concrete — is composited as a reflection in a giant chrome mirror panel that spans the passenger doors. The photo appears as a reflection caught in the vehicle's own surface, with subtle chrome edge distortion at the borders. The rest of the body is clean satin black. 'VAULT' in bold geometric chrome on the driver side. vaultautogallery.com on the rear. The showroom lives inside the vehicle's reflection.",
  },
  {
    id: "dp-au-002",
    designName: "Monarch Chauffeur",
    subcategory: "Luxury Auto",
    tags: ["chauffeur", "limo", "executive", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Mercedes-Benz", model: "S-Class" },
    prompt: "Design Type: Commercial. Company: Monarch Chauffeur Services. Deep satin navy wrap. A photograph of a chauffeur opening the rear door at a private jet terminal is treated as a subtle embossed watermark — visible only at certain angles through a texture shift in the satin finish across the rear door, like a hidden image in security printing. Gold pinstripe at the beltline. 'MONARCH' in refined gold serif with a minimal crown on the driver door. monarchchauffeur.com on the rear in gold. The photo is there, but only the observant will see it — ultra-understated luxury.",
  },
  {
    id: "dp-au-003",
    designName: "Precision Motorsport",
    subcategory: "Luxury Auto",
    tags: ["racing", "track", "performance", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Porsche", model: "911 GT3" },
    prompt: "Design Type: Commercial. Company: Precision Motorsport. Carbon fiber textured lower half with matte white upper body. A photograph of a race car at full speed through a corner with tire smoke is sliced into horizontal speed lines — the photo is cut into thin strips that stretch and stagger backward along the doors, creating a motion-blur slit-scan effect where the racing image disintegrates into velocity across the body. Red accent stripe from nose to tail connecting the motion. 'PRECISION' in bold condensed white on the driver side. precisionmotorsport.co on the rear. Speed visualized through design.",
  },

  // ── Tech, Architecture & Creative (3) ─────────────────────────────
  {
    id: "dp-tc-001",
    designName: "Luminary Creative Agency",
    subcategory: "Tech & Creative",
    tags: ["agency", "creative", "branding", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Rivian", model: "R1T" },
    prompt: "Design Type: Commercial. Company: Luminary Creative Agency. Matte warm gray wrap. A photograph of a creative team at work in a sunlit industrial loft is composited inside the silhouette outline of a giant lightbulb shape on the passenger side — the team photo fills the bulb while the filament inside is rendered as a glowing electric coral line that continues beyond the bulb, tracing along the beltline as a design accent. 'LUMINARY' in clean geometric charcoal on the driver door. weareluminary.com on the rear. The idea literally illuminates the brand.",
  },
  {
    id: "dp-tc-002",
    designName: "Atlas Cloud Solutions",
    subcategory: "Tech & Creative",
    tags: ["saas", "cloud", "tech", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Tesla", model: "Model S" },
    prompt: "Design Type: Commercial. Company: Atlas Cloud Solutions. Clean matte white wrap. A photograph of a modern data center — blue LED server racks extending to infinity — is composited into a large hexagonal grid pattern across the passenger side where each hexagon reveals a different zoomed section of the data center, creating a compound-eye mosaic effect. The hexagons are smaller and denser at the center, larger at the edges. Electric blue accent on the lower third. 'ATLAS' in bold futuristic navy on the driver door. atlascloud.io on the rear. Enterprise infrastructure visualized as design.",
  },
  {
    id: "dp-tc-003",
    designName: "Forge Architecture",
    subcategory: "Tech & Creative",
    tags: ["architecture", "design", "modern", "photo"],
    mode: "commercial",
    vehicle: { year: "2024", make: "Volvo", model: "XC90" },
    prompt: "Design Type: Commercial. Company: Forge Architecture. Warm concrete gray satin wrap. A photograph of a striking modern building — cantilevered concrete, floor-to-ceiling glass, dramatic angles — is rendered as an architectural blueprint overlay where the photo fades into technical line drawings at the edges, showing the building in transition from photograph to wireframe to construction document. Thin black lines extend from the drawing into dimensioning marks along the body lines. 'FORGE' in bold sans-serif black on the driver side. forgearchitecture.com on the rear. The wrap IS the design process — from vision to reality.",
  },
];

/**
 * Get `count` unique DesignPro premium presets, shuffled randomly.
 * Tracks used IDs in localStorage to avoid repeats across batches.
 */
export function getRandomDesignProPresets(count: number): DesignProPreset[] {
  const storageKey = "restylepro_used_designpro_presets";

  let usedIds: string[] = [];
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) usedIds = JSON.parse(stored);
  } catch { /* ignore */ }

  let available = DESIGNPRO_PREMIUM_PRESETS.filter((p) => !usedIds.includes(p.id));

  if (available.length < count) {
    usedIds = [];
    available = [...DESIGNPRO_PREMIUM_PRESETS];
  }

  const shuffled = [...available].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  const newUsedIds = [...usedIds, ...selected.map((p) => p.id)];
  try {
    localStorage.setItem(storageKey, JSON.stringify(newUsedIds));
  } catch { /* localStorage full */ }

  return selected;
}

/** Get all presets for a specific subcategory */
export function getDesignProPresetsByCategory(subcategory: string): DesignProPreset[] {
  return DESIGNPRO_PREMIUM_PRESETS.filter((p) => p.subcategory === subcategory);
}

/** Get all unique subcategories */
export function getDesignProCategories(): string[] {
  return [...new Set(DESIGNPRO_PREMIUM_PRESETS.map((p) => p.subcategory))];
}
