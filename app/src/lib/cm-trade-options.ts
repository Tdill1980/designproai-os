/**
 * CreatorMarket trade taxonomy — single source of truth.
 *
 * `slug` matches the marketplace_listings.trade_category CHECK constraint
 * and the chip filter on /creatormarket. `label` is the human-facing
 * filter text. `industryHint` and `vehicles` are used by the
 * AI-prompt-batch generator so each trade's brand-new designs land on a
 * sensible vehicle (e.g. dental → minivan, roofing → F-250).
 */

export interface CmTrade {
  slug: string;
  label: string;
  /** One-line industry framing for the AI prompt generator. */
  industryHint: string;
  /** Suggested vehicle pool — rotate through these when bulk-rendering. */
  vehicles: { year: string; make: string; model: string }[];
}

const COMMERCIAL_VAN: CmTrade["vehicles"] = [
  { year: "2025", make: "Ford", model: "Transit Cargo Van" },
  { year: "2025", make: "Mercedes-Benz", model: "Sprinter 2500" },
  { year: "2025", make: "Ram", model: "ProMaster 1500" },
  { year: "2025", make: "Ford", model: "E-Transit 350" },
];

const SERVICE_TRUCK: CmTrade["vehicles"] = [
  { year: "2025", make: "Ram", model: "2500 Tradesman" },
  { year: "2024", make: "Ford", model: "F-250 Super Duty" },
  { year: "2024", make: "Chevrolet", model: "Silverado 2500 HD" },
  { year: "2025", make: "Ford", model: "F-150 XLT" },
];

const SUV_FAMILY: CmTrade["vehicles"] = [
  { year: "2025", make: "Toyota", model: "Highlander Hybrid" },
  { year: "2024", make: "Honda", model: "Odyssey" },
  { year: "2025", make: "Chevrolet", model: "Traverse RS" },
  { year: "2025", make: "Subaru", model: "Outback" },
];

const HEAVY_DUTY: CmTrade["vehicles"] = [
  { year: "2024", make: "Ford", model: "F-350 Super Duty" },
  { year: "2024", make: "Nissan", model: "Titan XD" },
  { year: "2024", make: "Ram", model: "3500 Heavy Duty" },
];

// Service-trade pickups + cargo vans used by trades that need to haul
// equipment, dumpsters, or finished work to the customer.
const HAUL_RIG: CmTrade["vehicles"] = [
  { year: "2024", make: "Ford", model: "F-350 Super Duty" },
  { year: "2024", make: "Ram", model: "3500 Heavy Duty" },
  { year: "2024", make: "Ford", model: "F-450 Super Duty" },
];

export const CM_TRADES: CmTrade[] = [
  {
    slug: "real_estate",
    label: "Real Estate",
    industryHint:
      "Real estate agency / realtor — modern lifestyle photography of a beautiful home, sophisticated typography, broker contact info, MLS-style branding.",
    vehicles: SUV_FAMILY,
  },
  {
    slug: "hvac",
    label: "HVAC",
    industryHint:
      "HVAC contractor — split hot/cold visual (frost blue + warm orange), photograph of a modern ductless mini-split or rooftop unit, 24/7 service tagline, license number callout.",
    vehicles: SERVICE_TRUCK,
  },
  {
    slug: "plumbing",
    label: "Plumbing",
    industryHint:
      "Plumbing service — water/pipe imagery, photograph of clean copper pipework or a modern faucet install, 'Licensed · Bonded · 24/7 Emergency' badge, blue and chrome palette.",
    vehicles: COMMERCIAL_VAN,
  },
  {
    slug: "dental",
    label: "Dental",
    industryHint:
      "Family dental practice — minty teal-to-white gradient, photograph of a confident bright smile, sparkle-tooth logo, 'New Patients Welcome · Invisalign · Same-Day Crowns' badge.",
    vehicles: SUV_FAMILY,
  },
  {
    slug: "home_health",
    label: "Home Health",
    industryHint:
      "Mobile / in-home health service — calm clinical white + medical blue, EKG line accent, photograph of a friendly caregiver with a senior at home, Medicare-accepted badge.",
    vehicles: SUV_FAMILY,
  },
  {
    slug: "pool",
    label: "Pool & Spa",
    industryHint:
      "Pool and spa service — turquoise water gradient with photoreal water surface texture, photograph of a clean modern pool, leaf-net + chlorine flask icons, 'Weekly Service · Repairs · Openings' tagline.",
    vehicles: SERVICE_TRUCK,
  },
  {
    slug: "spa_beauty",
    label: "Spa & Beauty",
    industryHint:
      "Med-spa / beauty studio — soft blush rose-gold palette, elegant serif logo, photograph of a calming treatment room or fresh-faced model, 'Botox · Lashes · Facials · HydraFacial' service list.",
    vehicles: SUV_FAMILY,
  },
  {
    slug: "landscaping",
    label: "Landscaping",
    industryHint:
      "Landscaping / lawn care — deep forest green and earth tones, photograph of a manicured lawn or fresh mulch bed, leaf and mower icon, 'Mowing · Mulch · Hardscapes · Irrigation' service list.",
    vehicles: SERVICE_TRUCK,
  },
  {
    slug: "electrician",
    label: "Electrician",
    industryHint:
      "Electrical contractor — white wrap with electric-blue lightning bolt, photograph of a smart panel install, 'Master Electrician · 24/7 Emergency' badge, license number on doors.",
    vehicles: SERVICE_TRUCK,
  },
  {
    slug: "cleaning",
    label: "Cleaning",
    industryHint:
      "Commercial / residential cleaning — bright clean white with sky-blue accents, sparkle and bubble graphic, photograph of a spotless modern kitchen or office, 'Bonded · Insured · Eco-Friendly' badge.",
    vehicles: COMMERCIAL_VAN,
  },
  {
    slug: "food_truck",
    label: "Food Truck",
    industryHint:
      "Food truck / mobile catering — appetizing close-up food photograph dominating one side, bold hand-lettered logo, neon menu callouts, Instagram handle prominent.",
    vehicles: COMMERCIAL_VAN,
  },
  {
    slug: "pest_control",
    label: "Pest Control",
    industryHint:
      "Pest control service — clean white with caution-yellow accents, photograph of a uniformed technician spraying a baseboard, shield + bug-out icon, 'Eco-Safe · Family Safe · Guaranteed' badge.",
    vehicles: COMMERCIAL_VAN,
  },
  {
    slug: "roofing",
    label: "Roofing",
    industryHint:
      "Roofing contractor — slate-gray-to-sky-blue gradient, photograph of architectural shingles or a finished metal roof, mountain-peak shield logo, 'GAF Master Elite · Storm Experts · Free Estimates' badge.",
    vehicles: HEAVY_DUTY,
  },
  {
    slug: "auto_service",
    label: "Auto Service",
    industryHint:
      "Auto repair / detailing — gloss-black with chrome pinstripe, photograph of a ceramic-coated hood reflection or fresh tire install, wrench-and-piston logo, 'ASE Certified · All Makes · Free Estimates' badge.",
    vehicles: COMMERCIAL_VAN,
  },
  {
    slug: "construction",
    label: "Construction",
    industryHint:
      "General contractor / builder — steel-gray with blueprint grid overlay, safety-orange accent stripe, photograph of a completed modern build, hard-hat + hammer icon, 'Licensed · Bonded · Insured' with license number.",
    vehicles: HEAVY_DUTY,
  },
  // ---------------------------------------------------------------
  // Common Google-search wrap-buyer trades (added Phase 2). Same
  // shape as the originals — each gets a CM filter chip, an AI
  // prompt scope, and a sensible vehicle pool.
  // ---------------------------------------------------------------
  {
    slug: "towing",
    label: "Towing",
    industryHint:
      "Towing & recovery service — high-visibility fire-red and reflective white split, photograph of a flatbed loaded with a wrecked SUV, heavy-duty hook + crane icon, 'Flatbed · Heavy Duty · Motorcycle · 24/7 Roadside' service list, dispatch phone in massive digits.",
    vehicles: [
      { year: "2024", make: "Ford", model: "F-450 Super Duty" },
      { year: "2024", make: "Ram", model: "3500 Heavy Duty" },
    ],
  },
  {
    slug: "mobile_detail",
    label: "Mobile Detail",
    industryHint:
      "Mobile auto detailing — gloss-black with photoreal water bead graphics and chrome pinstripe, photograph of a freshly ceramic-coated hood reflecting a showroom, foam cannon + microfiber icons, 'Paint Correction · Ceramic · PPF · We Come to You' tagline.",
    vehicles: COMMERCIAL_VAN,
  },
  {
    slug: "junk_removal",
    label: "Junk Removal",
    industryHint:
      "Junk removal / hauling — bright safety-yellow and black hazard stripe, photograph of two crew members loading a dumpster trailer behind the truck, dumpster + truck icon, 'Same-Day Pickup · Eco Recycling · Free Estimates' service list.",
    vehicles: HAUL_RIG,
  },
  {
    slug: "moving",
    label: "Moving",
    industryHint:
      "Moving company / movers — friendly navy-and-white with a bold moving-box icon, photograph of uniformed movers carrying a sofa from a moving truck, 'Local · Long Distance · Packing · Storage' service list, family-owned tagline.",
    vehicles: [
      { year: "2025", make: "Ford", model: "E-Transit 350" },
      { year: "2025", make: "Mercedes-Benz", model: "Sprinter 2500" },
    ],
  },
  {
    slug: "tree_service",
    label: "Tree Service",
    industryHint:
      "Tree service / arborist — deep forest green with rough wood-grain texture lower third, photograph of a climber in harness pruning a mature oak, chainsaw + leaf icon, 'Removal · Pruning · Stump Grinding · 24/7 Storm Response' service list.",
    vehicles: HAUL_RIG,
  },
  {
    slug: "pet_grooming",
    label: "Pet Grooming",
    industryHint:
      "Mobile pet grooming — soft pastel teal-pink palette with a playful paw-print trail, photograph of a freshly groomed golden retriever sitting proudly, scissors + bow icon, 'Full Groom · Bath · Nail Trim · We Come to You' service list.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Mercedes-Benz", model: "Sprinter 2500" },
    ],
  },
  {
    slug: "restoration",
    label: "Restoration",
    industryHint:
      "Water / fire / mold restoration — clean white with bold red emergency stripe, photograph of a technician in PPE setting up industrial drying fans, shield + droplet icon, '24/7 Emergency · Insurance Approved · IICRC Certified' badge.",
    vehicles: COMMERCIAL_VAN,
  },
  {
    slug: "solar",
    label: "Solar",
    industryHint:
      "Solar installer — bright sun-yellow to deep navy gradient, photograph of a residential rooftop array gleaming in sunlight, radiant sunburst behind logo, 'Save 40% on Energy · $0 Down Financing · NABCEP Certified' service list.",
    vehicles: SERVICE_TRUCK,
  },
  {
    slug: "painting",
    label: "Painting",
    industryHint:
      "Painting contractor — clean white with a single bold paint-roller stripe in brand color, photograph of a freshly painted accent wall with crisp trim lines, paint can + brush icon, 'Interior · Exterior · Cabinets · Free Color Consult' service list.",
    vehicles: COMMERCIAL_VAN,
  },
  {
    slug: "window_cleaning",
    label: "Window & Pressure Wash",
    industryHint:
      "Window cleaning & pressure washing — fresh sky-blue and white with photoreal water spray graphic, photograph of a spotless glass storefront or a pressure wand cleaning a driveway, squeegee + droplet icon, 'Windows · Gutters · Soft Wash · Insured' service list.",
    vehicles: COMMERCIAL_VAN,
  },
  {
    slug: "handyman",
    label: "Handyman",
    industryHint:
      "Handyman / home repair — friendly navy + safety-orange with a bold wrench-and-screwdriver icon, photograph of a uniformed pro hanging a TV mount or repairing a door, 'One Call · Honest Pricing · No Job Too Small' tagline.",
    vehicles: COMMERCIAL_VAN,
  },
  {
    slug: "locksmith",
    label: "Locksmith",
    industryHint:
      "Locksmith / mobile lockout — secure deep red and black with brushed-steel pinstripe, photograph of a tech rekeying a deadbolt with key blanks visible, key + shield icon, '24/7 Lockout · Auto · Home · Commercial' service list.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Ram", model: "ProMaster 1500" },
    ],
  },
  {
    slug: "fitness",
    label: "Fitness",
    industryHint:
      "Personal trainer / mobile fitness — aggressive matte black with energetic red slash accents, photograph of an athlete mid-kettlebell-swing with motion blur, barbell + flame icon, 'Personal Training · Group Classes · Online Coaching' service list.",
    vehicles: SUV_FAMILY,
  },
  {
    slug: "flooring",
    label: "Flooring",
    industryHint:
      "Flooring contractor — rich walnut-grain texture lower body, photograph of freshly installed wide-plank hardwood with a level on top, plank-stack + tile-diamond icon, 'Hardwood · Tile · LVP · Carpet · Free In-Home Estimate' service list.",
    vehicles: HAUL_RIG,
  },
  {
    slug: "catering",
    label: "Catering",
    industryHint:
      "Catering company — appetizing close-up photograph of a beautifully plated entrée dominating one side, elegant serif logo, 'Weddings · Corporate · Events · Custom Menus' service list, Instagram handle prominent.",
    vehicles: [
      { year: "2025", make: "Mercedes-Benz", model: "Sprinter 2500" },
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
    ],
  },
  {
    slug: "photography",
    label: "Photography",
    industryHint:
      "Wedding / event photographer — moody charcoal with a single bold gold typographic mark, photograph of a couple silhouetted against a sunset, camera + aperture icon, 'Weddings · Engagements · Portraits · Brand Sessions' service list.",
    vehicles: SUV_FAMILY,
  },
  {
    slug: "wraps",
    label: "Wraps",
    industryHint:
      "Vehicle wrap / PPF / window tint installer — dramatic peel-back vinyl reveal effect where satin black tears away to expose chrome underneath, photograph of a finished color-change wrap on an exotic on the passenger side, squeegee + roll-of-vinyl icon, 'Color Change · Commercial Fleet · PPF · Ceramic Tint' service list, Instagram handle prominent.",
    vehicles: COMMERCIAL_VAN,
  },
  {
    slug: "general",
    label: "General",
    industryHint:
      "Generic small business — clean modern branding suitable for any service company, bold sans-serif logo, professional photography of a happy customer interaction, 'Locally Owned · Family Operated' tagline.",
    vehicles: [...SERVICE_TRUCK, ...COMMERCIAL_VAN],
  },
];

export function getTradeBySlug(slug: string | null | undefined): CmTrade | null {
  if (!slug) return null;
  return CM_TRADES.find((t) => t.slug === slug) || null;
}
