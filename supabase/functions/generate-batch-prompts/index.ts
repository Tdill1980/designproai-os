/**
 * generate-batch-prompts — AI-powered unique prompt generation
 *
 * Uses Gemini to generate fresh, unique vehicle wrap design prompts
 * for batch rendering. Supports both "restyle" (artistic) and
 * "commercial" (business fleet) categories.
 *
 * Input:
 *   {
 *     category: "restyle" | "commercial",
 *     count:    number (1-20),
 *     trade?:   string  // optional CreatorMarket slug to scope commercial
 *                       // prompts to a single trade (e.g. "hvac", "dental",
 *                       // "roofing"). Ignored for restyle.
 *   }
 *
 * Output:
 *   { prompts: PromptPreset[] }   // each row carries trade_category when
 *                                  // the caller passed a trade slug.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey } from "../_shared/gemini-key-pool.ts";

const GEMINI_MODEL = "gemini-2.5-flash"; // dated preview retired by Google
const MAX_COUNT = 20;

const RESTYLE_SYSTEM = `You are a world-class vehicle wrap designer. Generate unique, creative vehicle wrap design prompts for photorealistic 3D rendering.

Each prompt must be a DETAILED visual description of an artistic/aesthetic vehicle wrap. Include:
- Specific colors, gradients, textures, and materials
- Visual elements (patterns, imagery, effects) and where they appear on the vehicle body
- Mood and style direction
- NO text, logos, phone numbers, or business branding
- Each prompt should be 80-150 words of rich visual description

Return ONLY valid JSON — no markdown, no code fences, no explanation.

Format:
[
  {
    "name": "Short Creative Name (2-4 words)",
    "subcategory": "One of: Cyberpunk, Tactical, Racing, Nature, Cultural, Luxury, Street Art, Chameleon, Mythical, Geometric, Seasons, Wildlife, Cosmos, Steampunk, Botanical, Abstract, Elemental, Oceanic, Gothic, Prismatic",
    "prompt": "Full detailed wrap description...",
    "tags": ["tag1", "tag2", "tag3"],
    "style": "short style descriptor"
  }
]

Make every prompt COMPLETELY DIFFERENT in theme, color palette, and visual approach. No two should share the same concept.`;

const COMMERCIAL_SYSTEM = `You are a commercial vehicle wrap designer for real businesses. Generate unique business fleet wrap design prompts for photorealistic 3D rendering.

Each prompt must describe a COMPLETE commercial vehicle wrap including:
- Business name (make up realistic ones)
- Industry-appropriate color scheme and design elements
- A photograph description of the business's work/product on one side
- Contact info (make up phone numbers, websites)
- Taglines and service lists
- Logo descriptions
- Each prompt should be 80-150 words

Return ONLY valid JSON — no markdown, no code fences, no explanation.

Format:
[
  {
    "name": "Business Name",
    "subcategory": "One of: Food & Beverage, Construction, Automotive, Healthcare, Real Estate, Delivery, Events, Technology, Landscaping, Fitness, Pet Services, Education, Cleaning, Legal, Photography",
    "prompt": "Full detailed commercial wrap description...",
    "tags": ["tag1", "tag2", "tag3"],
    "vehicle": { "year": "2025", "make": "Ford", "model": "Transit Cargo Van" }
  }
]

Use realistic business names and appropriate vehicles for each industry. Every prompt must be for a DIFFERENT industry and business type.`;

const COMMERCIAL_VEHICLES = [
  { year: "2025", make: "Ford", model: "Transit Cargo Van" },
  { year: "2025", make: "Mercedes-Benz", model: "Sprinter 2500" },
  { year: "2024", make: "Ford", model: "F-250 Super Duty" },
  { year: "2025", make: "Ram", model: "ProMaster 1500" },
  { year: "2024", make: "Chevrolet", model: "Colorado Z71" },
  { year: "2024", make: "Ford", model: "F-350 Super Duty" },
  { year: "2025", make: "Ram", model: "2500 Tradesman" },
  { year: "2025", make: "Ford", model: "F-150 XLT" },
  { year: "2024", make: "Nissan", model: "Titan XD" },
  { year: "2025", make: "Toyota", model: "Tacoma TRD Pro" },
  { year: "2025", make: "Ford", model: "E-Transit 350" },
  { year: "2024", make: "Chevrolet", model: "Silverado 1500 LT" },
  { year: "2025", make: "Toyota", model: "Highlander Hybrid" },
  { year: "2024", make: "Honda", model: "Odyssey" },
  { year: "2025", make: "Subaru", model: "Outback" },
];

/**
 * Trade-scoped instructions. When the caller passes a `trade` slug we
 * inject this hint into the system prompt so every prompt comes back
 * tailored to that industry (and gets stamped with the matching CM
 * trade_category at the bottom of the handler).
 */
const TRADE_INSTRUCTIONS: Record<
  string,
  { label: string; hint: string; vehicles: typeof COMMERCIAL_VEHICLES }
> = {
  real_estate: {
    label: "Real Estate",
    hint: "Real estate agency / realtor — lifestyle photography of a beautiful home, sophisticated typography, broker contact info, MLS-style branding.",
    vehicles: [
      { year: "2025", make: "Toyota", model: "Highlander Hybrid" },
      { year: "2024", make: "Honda", model: "Odyssey" },
      { year: "2025", make: "Chevrolet", model: "Traverse RS" },
      { year: "2025", make: "Subaru", model: "Outback" },
    ],
  },
  hvac: {
    label: "HVAC",
    hint: "HVAC contractor — split hot/cold visual (frost blue + warm orange), photograph of a modern ductless mini-split or rooftop unit, '24/7 Service · Heating · Cooling · IAQ' tagline, license number callout.",
    vehicles: [
      { year: "2025", make: "Ram", model: "2500 Tradesman" },
      { year: "2024", make: "Ford", model: "F-250 Super Duty" },
      { year: "2024", make: "Nissan", model: "Titan XD" },
    ],
  },
  plumbing: {
    label: "Plumbing",
    hint: "Plumbing service — water/pipe imagery, photograph of clean copper pipework or a modern faucet install, 'Licensed · Bonded · 24/7 Emergency' badge, blue and chrome palette.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Mercedes-Benz", model: "Sprinter 2500" },
      { year: "2025", make: "Ram", model: "ProMaster 1500" },
    ],
  },
  dental: {
    label: "Dental",
    hint: "Family dental practice — minty teal-to-white gradient, photograph of a confident bright smile, sparkle-tooth logo, 'New Patients Welcome · Invisalign · Same-Day Crowns' badge.",
    vehicles: [
      { year: "2024", make: "Honda", model: "Odyssey" },
      { year: "2025", make: "Toyota", model: "Highlander Hybrid" },
    ],
  },
  home_health: {
    label: "Home Health",
    hint: "Mobile / in-home health service — calm clinical white + medical blue, EKG line accent, photograph of a friendly caregiver with a senior at home, Medicare-accepted badge.",
    vehicles: [
      { year: "2025", make: "Toyota", model: "Highlander Hybrid" },
      { year: "2025", make: "Subaru", model: "Outback" },
    ],
  },
  pool: {
    label: "Pool & Spa",
    hint: "Pool and spa service — turquoise water gradient with photoreal water surface, photograph of a clean modern pool, leaf-net + chlorine flask icons, 'Weekly Service · Repairs · Openings' tagline.",
    vehicles: [
      { year: "2025", make: "Ram", model: "2500 Tradesman" },
      { year: "2024", make: "Ford", model: "F-250 Super Duty" },
    ],
  },
  spa_beauty: {
    label: "Spa & Beauty",
    hint: "Med-spa / beauty studio — soft blush rose-gold palette, elegant serif logo, photograph of a calming treatment room or fresh-faced model, 'Botox · Lashes · Facials · HydraFacial' service list.",
    vehicles: [
      { year: "2025", make: "Chevrolet", model: "Traverse RS" },
      { year: "2025", make: "Toyota", model: "Highlander Hybrid" },
    ],
  },
  landscaping: {
    label: "Landscaping",
    hint: "Landscaping / lawn care — deep forest green and earth tones, photograph of a manicured lawn or fresh mulch bed, leaf and mower icon, 'Mowing · Mulch · Hardscapes · Irrigation' service list.",
    vehicles: [
      { year: "2024", make: "Ford", model: "F-250 Super Duty" },
      { year: "2025", make: "Ram", model: "2500 Tradesman" },
    ],
  },
  electrician: {
    label: "Electrician",
    hint: "Electrical contractor — white wrap with electric-blue lightning bolt, photograph of a smart panel install, 'Master Electrician · 24/7 Emergency' badge, license number on doors.",
    vehicles: [
      { year: "2025", make: "Ram", model: "2500 Tradesman" },
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
    ],
  },
  cleaning: {
    label: "Cleaning",
    hint: "Commercial / residential cleaning — bright clean white with sky-blue accents, sparkle and bubble graphic, photograph of a spotless modern kitchen or office, 'Bonded · Insured · Eco-Friendly' badge.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Ram", model: "ProMaster 1500" },
    ],
  },
  food_truck: {
    label: "Food Truck",
    hint: "Food truck / mobile catering — appetizing close-up food photograph dominating one side, bold hand-lettered logo, neon menu callouts, Instagram handle prominent.",
    vehicles: [
      { year: "2025", make: "Mercedes-Benz", model: "Sprinter 2500" },
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
    ],
  },
  pest_control: {
    label: "Pest Control",
    hint: "Pest control service — clean white with caution-yellow accents, photograph of a uniformed technician spraying a baseboard, shield + bug-out icon, 'Eco-Safe · Family Safe · Guaranteed' badge.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Ram", model: "ProMaster 1500" },
    ],
  },
  roofing: {
    label: "Roofing",
    hint: "Roofing contractor — slate-gray-to-sky-blue gradient, photograph of architectural shingles or a finished metal roof, mountain-peak shield logo, 'GAF Master Elite · Storm Experts · Free Estimates' badge.",
    vehicles: [
      { year: "2024", make: "Ford", model: "F-350 Super Duty" },
      { year: "2024", make: "Nissan", model: "Titan XD" },
    ],
  },
  auto_service: {
    label: "Auto Service",
    hint: "Auto repair / detailing — gloss-black with chrome pinstripe, photograph of a ceramic-coated hood reflection or fresh tire install, wrench-and-piston logo, 'ASE Certified · All Makes · Free Estimates' badge.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Ram", model: "ProMaster 1500" },
    ],
  },
  construction: {
    label: "Construction",
    hint: "General contractor / builder — steel-gray with blueprint grid overlay, safety-orange accent stripe, photograph of a completed modern build, hard-hat + hammer icon, 'Licensed · Bonded · Insured' with license number.",
    vehicles: [
      { year: "2024", make: "Ford", model: "F-350 Super Duty" },
      { year: "2024", make: "Nissan", model: "Titan XD" },
    ],
  },
  // ---------------------------------------------------------------
  // Phase 2 trades — added for highest-Google-volume wrap buyers.
  // ---------------------------------------------------------------
  towing: {
    label: "Towing",
    hint: "Towing & recovery service — high-visibility fire-red and reflective white split, photograph of a flatbed loaded with a wrecked SUV, heavy-duty hook + crane icon, 'Flatbed · Heavy Duty · Motorcycle · 24/7 Roadside' service list, dispatch phone in massive digits.",
    vehicles: [
      { year: "2024", make: "Ford", model: "F-450 Super Duty" },
      { year: "2024", make: "Ram", model: "3500 Heavy Duty" },
    ],
  },
  mobile_detail: {
    label: "Mobile Detail",
    hint: "Mobile auto detailing — gloss-black with photoreal water bead graphics and chrome pinstripe, photograph of a freshly ceramic-coated hood reflecting a showroom, foam cannon + microfiber icons, 'Paint Correction · Ceramic · PPF · We Come to You' tagline.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Ram", model: "ProMaster 1500" },
    ],
  },
  junk_removal: {
    label: "Junk Removal",
    hint: "Junk removal / hauling — bright safety-yellow and black hazard stripe, photograph of two crew members loading a dumpster trailer behind the truck, dumpster + truck icon, 'Same-Day Pickup · Eco Recycling · Free Estimates' service list.",
    vehicles: [
      { year: "2024", make: "Ford", model: "F-350 Super Duty" },
      { year: "2024", make: "Ram", model: "3500 Heavy Duty" },
    ],
  },
  moving: {
    label: "Moving",
    hint: "Moving company / movers — friendly navy-and-white with a bold moving-box icon, photograph of uniformed movers carrying a sofa from a moving truck, 'Local · Long Distance · Packing · Storage' service list, family-owned tagline.",
    vehicles: [
      { year: "2025", make: "Ford", model: "E-Transit 350" },
      { year: "2025", make: "Mercedes-Benz", model: "Sprinter 2500" },
    ],
  },
  tree_service: {
    label: "Tree Service",
    hint: "Tree service / arborist — deep forest green with rough wood-grain texture lower third, photograph of a climber in harness pruning a mature oak, chainsaw + leaf icon, 'Removal · Pruning · Stump Grinding · 24/7 Storm Response' service list.",
    vehicles: [
      { year: "2024", make: "Ford", model: "F-350 Super Duty" },
      { year: "2024", make: "Ram", model: "3500 Heavy Duty" },
    ],
  },
  pet_grooming: {
    label: "Pet Grooming",
    hint: "Mobile pet grooming — soft pastel teal-pink palette with a playful paw-print trail, photograph of a freshly groomed golden retriever sitting proudly, scissors + bow icon, 'Full Groom · Bath · Nail Trim · We Come to You' service list.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Mercedes-Benz", model: "Sprinter 2500" },
    ],
  },
  restoration: {
    label: "Restoration",
    hint: "Water / fire / mold restoration — clean white with bold red emergency stripe, photograph of a technician in PPE setting up industrial drying fans, shield + droplet icon, '24/7 Emergency · Insurance Approved · IICRC Certified' badge.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Ram", model: "ProMaster 1500" },
    ],
  },
  solar: {
    label: "Solar",
    hint: "Solar installer — bright sun-yellow to deep navy gradient, photograph of a residential rooftop array gleaming in sunlight, radiant sunburst behind logo, 'Save 40% on Energy · $0 Down Financing · NABCEP Certified' service list.",
    vehicles: [
      { year: "2025", make: "Ram", model: "2500 Tradesman" },
      { year: "2024", make: "Ford", model: "F-250 Super Duty" },
    ],
  },
  painting: {
    label: "Painting",
    hint: "Painting contractor — clean white with a single bold paint-roller stripe in brand color, photograph of a freshly painted accent wall with crisp trim lines, paint can + brush icon, 'Interior · Exterior · Cabinets · Free Color Consult' service list.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Ram", model: "ProMaster 1500" },
    ],
  },
  window_cleaning: {
    label: "Window & Pressure Wash",
    hint: "Window cleaning & pressure washing — fresh sky-blue and white with photoreal water spray graphic, photograph of a spotless glass storefront or a pressure wand cleaning a driveway, squeegee + droplet icon, 'Windows · Gutters · Soft Wash · Insured' service list.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Ram", model: "ProMaster 1500" },
    ],
  },
  handyman: {
    label: "Handyman",
    hint: "Handyman / home repair — friendly navy + safety-orange with a bold wrench-and-screwdriver icon, photograph of a uniformed pro hanging a TV mount or repairing a door, 'One Call · Honest Pricing · No Job Too Small' tagline.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Ram", model: "ProMaster 1500" },
    ],
  },
  locksmith: {
    label: "Locksmith",
    hint: "Locksmith / mobile lockout — secure deep red and black with brushed-steel pinstripe, photograph of a tech rekeying a deadbolt with key blanks visible, key + shield icon, '24/7 Lockout · Auto · Home · Commercial' service list.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Ram", model: "ProMaster 1500" },
    ],
  },
  fitness: {
    label: "Fitness",
    hint: "Personal trainer / mobile fitness — aggressive matte black with energetic red slash accents, photograph of an athlete mid-kettlebell-swing with motion blur, barbell + flame icon, 'Personal Training · Group Classes · Online Coaching' service list.",
    vehicles: [
      { year: "2025", make: "Toyota", model: "Highlander Hybrid" },
      { year: "2025", make: "Chevrolet", model: "Traverse RS" },
    ],
  },
  flooring: {
    label: "Flooring",
    hint: "Flooring contractor — rich walnut-grain texture lower body, photograph of freshly installed wide-plank hardwood with a level on top, plank-stack + tile-diamond icon, 'Hardwood · Tile · LVP · Carpet · Free In-Home Estimate' service list.",
    vehicles: [
      { year: "2024", make: "Ford", model: "F-350 Super Duty" },
      { year: "2024", make: "Ram", model: "3500 Heavy Duty" },
    ],
  },
  catering: {
    label: "Catering",
    hint: "Catering company — appetizing close-up photograph of a beautifully plated entrée dominating one side, elegant serif logo, 'Weddings · Corporate · Events · Custom Menus' service list, Instagram handle prominent.",
    vehicles: [
      { year: "2025", make: "Mercedes-Benz", model: "Sprinter 2500" },
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
    ],
  },
  photography: {
    label: "Photography",
    hint: "Wedding / event photographer — moody charcoal with a single bold gold typographic mark, photograph of a couple silhouetted against a sunset, camera + aperture icon, 'Weddings · Engagements · Portraits · Brand Sessions' service list.",
    vehicles: [
      { year: "2025", make: "Subaru", model: "Outback" },
      { year: "2025", make: "Toyota", model: "Highlander Hybrid" },
    ],
  },
  wraps: {
    label: "Wraps",
    hint: "Vehicle wrap / PPF / window tint installer — dramatic peel-back vinyl reveal effect (satin black tearing away to chrome underneath), photograph of a finished color-change wrap on an exotic on the passenger side, squeegee + roll-of-vinyl icon, 'Color Change · Commercial Fleet · PPF · Ceramic Tint' service list, Instagram handle prominent.",
    vehicles: [
      { year: "2025", make: "Ford", model: "Transit Cargo Van" },
      { year: "2025", make: "Ram", model: "ProMaster 1500" },
      { year: "2025", make: "Mercedes-Benz", model: "Sprinter 2500" },
    ],
  },
  general: {
    label: "General",
    hint: "Generic small business — clean modern branding suitable for any service company, bold sans-serif logo, professional photography of a happy customer interaction, 'Locally Owned · Family Operated' tagline.",
    vehicles: COMMERCIAL_VEHICLES,
  },
};

const RESTYLE_VEHICLES = [
  { year: "2024", make: "Porsche", model: "911 GT3" },
  { year: "2024", make: "McLaren", model: "720S" },
  { year: "2024", make: "Lamborghini", model: "Huracán" },
  { year: "2024", make: "BMW", model: "M4" },
  { year: "2024", make: "Ford", model: "Mustang GT" },
  { year: "2024", make: "Chevrolet", model: "Corvette C8" },
  { year: "2024", make: "Tesla", model: "Model S Plaid" },
  { year: "2024", make: "Audi", model: "RS e-tron GT" },
  { year: "2024", make: "Mercedes-AMG", model: "GT" },
  { year: "2024", make: "Nissan", model: "Z" },
  { year: "2024", make: "Ferrari", model: "Roma" },
  { year: "2024", make: "Toyota", model: "Supra" },
  { year: "2024", make: "Dodge", model: "Challenger" },
  { year: "2025", make: "Porsche", model: "Taycan Turbo S" },
  { year: "2024", make: "Lexus", model: "LC 500" },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { category, count: rawCount, trade: rawTrade } = await req.json();

    if (!category || !["restyle", "commercial"].includes(category)) {
      return new Response(
        JSON.stringify({ error: "category must be 'restyle' or 'commercial'" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    const count = Math.min(Math.max(parseInt(rawCount) || 5, 1), MAX_COUNT);
    const isRestyle = category === "restyle";

    // Only commercial gets trade-scoping. Restyle stays generic-artistic.
    const tradeKey = !isRestyle && typeof rawTrade === "string" && rawTrade in TRADE_INSTRUCTIONS
      ? rawTrade
      : null;
    const tradeMeta = tradeKey ? TRADE_INSTRUCTIONS[tradeKey] : null;

    let systemPrompt = isRestyle ? RESTYLE_SYSTEM : COMMERCIAL_SYSTEM;
    if (tradeMeta) {
      systemPrompt += `

INDUSTRY SCOPE — every single prompt below must be for a ${tradeMeta.label} business.
Hint: ${tradeMeta.hint}

Each prompt must use a DIFFERENT business name, color palette, and visual concept — but they all must be in the ${tradeMeta.label} industry. Pick the appropriate vehicle from this list (rotate so no two prompts share a vehicle if possible): ${tradeMeta.vehicles.map((v) => `${v.year} ${v.make} ${v.model}`).join(" | ")}.`;
    }

    const userPrompt = tradeMeta
      ? `Generate exactly ${count} unique ${tradeMeta.label} fleet wrap design prompts. Same industry, completely different brands and visual concepts.`
      : `Generate exactly ${count} unique ${isRestyle ? "artistic vehicle wrap" : "commercial fleet wrap"} design prompts. Make each one completely different in theme, color palette, and concept.`;

    const apiKey = getGeminiKey();
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] },
          ],
          generationConfig: {
            temperature: 1.0,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("[generate-batch-prompts] Gemini API error:", response.status, errText);
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      throw new Error("No text returned from Gemini");
    }

    // Parse JSON — strip markdown fences if present
    let parsed: any[];
    try {
      const cleaned = rawText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("[generate-batch-prompts] JSON parse error:", rawText.slice(0, 500));
      throw new Error("Failed to parse Gemini response as JSON");
    }

    if (!Array.isArray(parsed)) {
      throw new Error("Gemini response is not an array");
    }

    // Map to PromptPreset format with unique IDs and vehicles. When the
    // caller scoped to a trade, prefer that trade's vehicle pool so the
    // batch lands on appropriate trucks/vans even if Gemini drifted.
    const vehiclePool = isRestyle
      ? RESTYLE_VEHICLES
      : tradeMeta?.vehicles ?? COMMERCIAL_VEHICLES;
    const shuffledVehicles = [...vehiclePool].sort(() => Math.random() - 0.5);

    const prompts = parsed.slice(0, count).map((item: any, idx: number) => ({
      id: `gen_${category}_${tradeKey ? tradeKey + "_" : ""}${Date.now()}_${idx}`,
      prompt: item.prompt || "",
      category,
      subcategory: item.subcategory || (tradeMeta?.label ?? "Generated"),
      tags: item.tags || [],
      name: item.name || `Generated ${idx + 1}`,
      style: item.style || undefined,
      vehicle:
        // Prefer the trade pool over Gemini's pick — Gemini frequently
        // returns vehicles that don't make sense for the trade.
        tradeMeta
          ? shuffledVehicles[idx % shuffledVehicles.length]
          : item.vehicle || shuffledVehicles[idx % shuffledVehicles.length],
      // Stamp the CM trade slug so the UI can insert into
      // marketplace_listings.trade_category without remapping.
      trade_category: tradeKey || null,
    }));

    console.log(`[generate-batch-prompts] Generated ${prompts.length} ${category} prompts`);

    return new Response(
      JSON.stringify({ prompts }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error: unknown) {
    console.error("[generate-batch-prompts] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
