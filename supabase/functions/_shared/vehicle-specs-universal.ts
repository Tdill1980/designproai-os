/**
 * vehicle-specs-universal.ts — Google-grounded spec lookup for non-standard vehicles.
 *
 * This is the spec lookup layer for the "push-button per vehicle type" feature.
 * It is called by render-motorcycle, render-boat, render-bus, render-rv (and any
 * future non-car edge function) to fetch real exterior dimensions BEFORE the
 * render prompt is built.
 *
 * Flow:
 *   1. Check the vehicle_specs_universal cache table (by class/make/model/year)
 *   2. If hit → return immediately with cached dims + requires_validation flag
 *   3. If miss → call Gemini 2.0 Flash with Google Search grounding
 *      The prompt is CLASS-SPECIFIC and asks for OEM spec sheets, dealer
 *      brochures, manufacturer tech drawings, and cites sources
 *   4. Parse dimensions from the response
 *   5. Run class-specific sanity checks (so motorcycles aren't rejected for
 *      being "too small" the way the car-only vehicle-lookup rejects them)
 *   6. Run class-specific panel estimation
 *   7. Insert into vehicle_specs_universal (requires_validation = TRUE by default)
 *   8. Return the specs + grounding source URLs
 *
 * Every non-standard-vehicle render feeds through this helper, so production
 * panels will ALWAYS have a human-verified dimension set behind them before
 * they reach the printer.
 */

import { getGeminiKey, hasGeminiKey } from "./gemini-key-pool.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VehicleClass =
  | "motorcycle"
  | "boat"
  | "bus"
  | "rv"
  | "trailer"
  | "aircraft"
  | "heavy_equipment"
  | "car"
  | "truck"
  | "suv"
  | "van";

export interface VehicleDimensions {
  overall_length_in: number;
  overall_width_in: number;
  overall_height_in: number;
  wheelbase_in?: number;
}

export interface UniversalPanels {
  total_sq_ft: number;
  // Motorcycle
  tank_sq_ft?: number;
  fairing_sq_ft?: number;
  tail_sq_ft?: number;
  fender_sq_ft?: number;
  // Boat
  hull_side_sq_ft?: number;
  hull_bottom_sq_ft?: number;
  deck_sq_ft?: number;
  topside_sq_ft?: number;
  // Bus / RV
  side_sq_ft?: number;
  rear_sq_ft?: number;
  front_sq_ft?: number;
  roof_sq_ft?: number;
}

export interface UniversalVehicleSpecs {
  id?: string;
  vehicle_class: VehicleClass;
  make: string;
  model: string;
  year: string;
  sub_type?: string;
  dimensions: VehicleDimensions;
  panels: UniversalPanels;
  source: string;
  source_urls: string[];
  confidence: "high" | "medium" | "low";
  requires_validation: boolean;
  cached: boolean;
}

// ---------------------------------------------------------------------------
// Class-specific sanity ranges (inches)
// ---------------------------------------------------------------------------

const SANITY_RANGES: Record<VehicleClass, { length: [number, number]; width: [number, number]; height: [number, number] }> = {
  motorcycle: { length: [55, 130], width: [20, 45], height: [35, 65] },
  boat: { length: [100, 700], width: [40, 240], height: [30, 200] },
  bus: { length: [240, 540], width: [80, 110], height: [100, 165] },
  rv: { length: [200, 540], width: [80, 110], height: [80, 165] },
  trailer: { length: [60, 636], width: [48, 102], height: [36, 162] },
  aircraft: { length: [150, 2500], width: [150, 2500], height: [60, 500] },
  heavy_equipment: { length: [100, 800], width: [60, 300], height: [60, 250] },
  car: { length: [100, 260], width: [50, 90], height: [45, 80] },
  truck: { length: [150, 280], width: [60, 95], height: [60, 90] },
  suv: { length: [140, 240], width: [60, 90], height: [55, 85] },
  van: { length: [160, 290], width: [65, 90], height: [70, 120] },
};

// ---------------------------------------------------------------------------
// Class-specific Google-grounding prompts
// ---------------------------------------------------------------------------

function buildGroundingPrompt(vehicleClass: VehicleClass, year: string, make: string, model: string): string {
  const vehicleString = `${year || "current model year"} ${make} ${model}`;
  const baseInstruction = `Find the exact manufacturer exterior dimensions for a ${vehicleString}. Search official OEM spec sheets, dealer brochures, manufacturer tech drawings, and reputable review sites. Prefer primary sources (manufacturer websites, official spec PDFs).`;

  const classSpecific: Record<VehicleClass, string> = {
    motorcycle: `${baseInstruction}

For motorcycles I specifically need:
1. Overall length (inches) — wheel to wheel
2. Overall width (inches) — handlebar to handlebar OR widest fairing
3. Seat height / overall height (inches) — from ground to top of windscreen if present
4. Wheelbase (inches)

Return ONLY a JSON object with these exact keys and the source URLs you used:
{"overall_length_in": NUMBER, "overall_width_in": NUMBER, "overall_height_in": NUMBER, "wheelbase_in": NUMBER, "sub_type": "sport_bike|cruiser|tourer|adventure|standard|scooter", "confidence": "high|medium|low", "source_urls": ["url1", "url2"]}`,

    boat: `${baseInstruction}

For boats I specifically need:
1. Overall length / LOA (inches) — convert from feet if needed (1 ft = 12 in)
2. Beam / maximum width (inches)
3. Height (inches) — from waterline to top of highest point (t-top, tower, cabin)
4. Hull type / configuration

Return ONLY a JSON object with these exact keys and the source URLs you used:
{"overall_length_in": NUMBER, "overall_width_in": NUMBER, "overall_height_in": NUMBER, "sub_type": "center_console|runabout|bowrider|cruiser|pontoon|yacht|bass_boat|sport_fishing", "confidence": "high|medium|low", "source_urls": ["url1", "url2"]}`,

    bus: `${baseInstruction}

For buses I specifically need:
1. Overall length (inches) — nose to tail including bumpers
2. Overall width (inches) — excluding mirrors
3. Overall height (inches) — including any rooftop equipment
4. Wheelbase (inches)

Return ONLY a JSON object with these exact keys and the source URLs you used:
{"overall_length_in": NUMBER, "overall_width_in": NUMBER, "overall_height_in": NUMBER, "wheelbase_in": NUMBER, "sub_type": "transit_bus|school_bus|motorcoach|shuttle|double_decker|articulated", "confidence": "high|medium|low", "source_urls": ["url1", "url2"]}`,

    rv: `${baseInstruction}

For RVs / motorhomes / campers I specifically need:
1. Overall length (inches) — convert from feet if needed
2. Overall width (inches) — body only, excluding slide-outs
3. Overall height (inches) — including roof accessories
4. Wheelbase (inches)

Return ONLY a JSON object with these exact keys and the source URLs you used:
{"overall_length_in": NUMBER, "overall_width_in": NUMBER, "overall_height_in": NUMBER, "wheelbase_in": NUMBER, "sub_type": "class_a_gas|class_a_diesel|class_b|class_c|super_c|fifth_wheel|travel_trailer|toy_hauler", "confidence": "high|medium|low", "source_urls": ["url1", "url2"]}`,

    trailer: `${baseInstruction}

For trailers (enclosed cargo, utility, race, gooseneck, flatbed, dump) I specifically need:
1. Overall length (inches) — front of trailer body to rear, excluding tongue/hitch
2. Overall width (inches) — body width, excluding fenders if exposed
3. Overall height (inches) — deck to top of roof for enclosed, or deck height only for open
4. Deck length if different from overall length

Search OEM manufacturer specs (Featherlite, Big Tex, Sundowner, Pace, Wells Cargo, Look, Continental Cargo, ATC, inTech, exiss, etc.), dealer brochures, and trailer-specific reference sites. Standard DOT max width is 102 in; common heights are 6-7 ft (cargo), 7.5-8.5 ft (race), up to 13.5 ft for some toy haulers.

Return ONLY a JSON object with these exact keys and the source URLs you used:
{"overall_length_in": NUMBER, "overall_width_in": NUMBER, "overall_height_in": NUMBER, "sub_type": "enclosed_cargo|utility_open|race_trailer|gooseneck|flatbed|dump|car_hauler|horse|concession", "confidence": "high|medium|low", "source_urls": ["url1", "url2"]}`,

    aircraft: `${baseInstruction}

For aircraft I specifically need:
1. Overall length (inches)
2. Wingspan (inches) — treat as "width"
3. Overall height (inches)

Return ONLY a JSON object with these exact keys:
{"overall_length_in": NUMBER, "overall_width_in": NUMBER, "overall_height_in": NUMBER, "sub_type": "general_aviation|jet|helicopter|experimental", "confidence": "high|medium|low", "source_urls": ["url1"]}`,

    heavy_equipment: `${baseInstruction}

For heavy equipment (excavators, loaders, dozers, cranes) I specifically need:
1. Overall length (inches) with boom/arm retracted
2. Overall width (inches)
3. Overall height (inches) with cab / ROPS

Return ONLY a JSON object with these exact keys:
{"overall_length_in": NUMBER, "overall_width_in": NUMBER, "overall_height_in": NUMBER, "sub_type": "excavator|loader|dozer|crane|skid_steer|backhoe", "confidence": "high|medium|low", "source_urls": ["url1"]}`,

    car: `${baseInstruction}

Return ONLY a JSON object with these exact keys:
{"overall_length_in": NUMBER, "overall_width_in": NUMBER, "overall_height_in": NUMBER, "wheelbase_in": NUMBER, "confidence": "high|medium|low", "source_urls": ["url1"]}`,
    truck: `${baseInstruction}

Return ONLY a JSON object with these exact keys:
{"overall_length_in": NUMBER, "overall_width_in": NUMBER, "overall_height_in": NUMBER, "wheelbase_in": NUMBER, "confidence": "high|medium|low", "source_urls": ["url1"]}`,
    suv: `${baseInstruction}

Return ONLY a JSON object with these exact keys:
{"overall_length_in": NUMBER, "overall_width_in": NUMBER, "overall_height_in": NUMBER, "wheelbase_in": NUMBER, "confidence": "high|medium|low", "source_urls": ["url1"]}`,
    van: `${baseInstruction}

Return ONLY a JSON object with these exact keys:
{"overall_length_in": NUMBER, "overall_width_in": NUMBER, "overall_height_in": NUMBER, "wheelbase_in": NUMBER, "confidence": "high|medium|low", "source_urls": ["url1"]}`,
  };

  return classSpecific[vehicleClass];
}

// ---------------------------------------------------------------------------
// Class-specific panel estimators
// ---------------------------------------------------------------------------

function estimatePanels(vehicleClass: VehicleClass, d: VehicleDimensions): UniversalPanels {
  const L = d.overall_length_in;
  const W = d.overall_width_in;
  const H = d.overall_height_in;
  const sqft = (sqIn: number) => Math.round((sqIn / 144) * 10) / 10;

  switch (vehicleClass) {
    case "motorcycle": {
      // Motorcycles wrap: tank, front fairing, tail fairing, fenders
      const tank_sq_ft = sqft(W * 0.9 * H * 0.25 * 2); // top + sides of tank
      const fairing_sq_ft = sqft(W * H * 0.4 * 2); // front fairing both sides
      const tail_sq_ft = sqft(W * 0.8 * H * 0.2 * 2);
      const fender_sq_ft = sqft(W * 0.5 * 12 * 2); // front + rear fender tops
      const total_sq_ft = Math.round((tank_sq_ft + fairing_sq_ft + tail_sq_ft + fender_sq_ft) * 10) / 10;
      return { tank_sq_ft, fairing_sq_ft, tail_sq_ft, fender_sq_ft, total_sq_ft };
    }
    case "boat": {
      // Boats wrap: hull sides (port + starboard), transom, topsides above waterline
      const hull_side_sq_ft = sqft(L * 0.95 * H * 0.6); // each side, above waterline
      const hull_bottom_sq_ft = 0; // bottom not wrapped
      const deck_sq_ft = sqft(L * 0.7 * W * 0.7); // walkable deck (partial coverage)
      const topside_sq_ft = sqft(L * 0.4 * H * 0.35); // console / cabin sides
      const total_sq_ft = Math.round((hull_side_sq_ft * 2 + deck_sq_ft + topside_sq_ft) * 10) / 10;
      return { hull_side_sq_ft, hull_bottom_sq_ft, deck_sq_ft, topside_sq_ft, total_sq_ft };
    }
    case "bus":
    case "rv": {
      // Full-size vehicles: huge side panels dominate
      const side_sq_ft = sqft(L * 0.92 * H * 0.75); // each side
      const rear_sq_ft = sqft(W * 0.88 * H * 0.7);
      const front_sq_ft = sqft(W * 0.85 * H * 0.55);
      const roof_sq_ft = sqft(L * 0.85 * W * 0.8);
      const total_sq_ft = Math.round((side_sq_ft * 2 + rear_sq_ft + front_sq_ft + roof_sq_ft) * 10) / 10;
      return { side_sq_ft, rear_sq_ft, front_sq_ft, roof_sq_ft, total_sq_ft };
    }
    case "trailer": {
      // Trailers: flat side panels are dominant, often enclosed front wall
      // and rear doors. Coverage is more uniform than bus/rv since no
      // tapered front fascia.
      const side_sq_ft = sqft(L * 0.96 * H * 0.85); // long flat side, near full coverage
      const rear_sq_ft = sqft(W * 0.92 * H * 0.85); // back door panel
      const front_sq_ft = sqft(W * 0.92 * H * 0.85); // front wall (enclosed); open trailers 0
      const roof_sq_ft = sqft(L * 0.9 * W * 0.85); // optional, only if covered top
      const total_sq_ft = Math.round((side_sq_ft * 2 + rear_sq_ft + front_sq_ft + roof_sq_ft) * 10) / 10;
      return { side_sq_ft, rear_sq_ft, front_sq_ft, roof_sq_ft, total_sq_ft };
    }
    case "aircraft":
    case "heavy_equipment": {
      // Rough estimate — mostly the sides and top
      const side_sq_ft = sqft(L * H * 0.8);
      const roof_sq_ft = sqft(L * W * 0.5);
      const total_sq_ft = Math.round((side_sq_ft * 2 + roof_sq_ft) * 10) / 10;
      return { side_sq_ft, roof_sq_ft, total_sq_ft };
    }
    default: {
      // Cars/trucks/SUVs/vans — use standard estimator
      const side_sq_ft = sqft(L * 0.92 * H * 0.52);
      const rear_sq_ft = sqft(W * 0.88 * H * 0.58);
      const front_sq_ft = sqft(W * 0.82 * L * 0.25);
      const roof_sq_ft = sqft(W * 0.78 * L * 0.33);
      const total_sq_ft = Math.round((side_sq_ft * 2 + rear_sq_ft + front_sq_ft + roof_sq_ft) * 10) / 10;
      return { side_sq_ft, rear_sq_ft, front_sq_ft, roof_sq_ft, total_sq_ft };
    }
  }
}

// ---------------------------------------------------------------------------
// Google-grounded Gemini call
// ---------------------------------------------------------------------------

interface GroundingResult {
  dims: VehicleDimensions;
  sub_type?: string;
  confidence: "high" | "medium" | "low";
  source_urls: string[];
  raw: unknown;
}

async function groundingLookup(
  vehicleClass: VehicleClass,
  year: string,
  make: string,
  model: string,
): Promise<GroundingResult> {
  const prompt = buildGroundingPrompt(vehicleClass, year, make, model);
  const apiKey = getGeminiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini grounding API ${res.status}: ${err.substring(0, 300)}`);
  }

  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || "")
      .join("") || "";

  // Extract grounding URIs from metadata (Gemini returns these when googleSearch is used)
  const groundingUris: string[] = [];
  const groundingMetadata = data?.candidates?.[0]?.groundingMetadata;
  if (groundingMetadata?.groundingChunks) {
    for (const chunk of groundingMetadata.groundingChunks) {
      if (chunk.web?.uri) groundingUris.push(chunk.web.uri);
    }
  }

  // Parse JSON from response text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Could not parse dimensions JSON from Gemini response: ${text.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const dims: VehicleDimensions = {
    overall_length_in: Number(parsed.overall_length_in) || 0,
    overall_width_in: Number(parsed.overall_width_in) || 0,
    overall_height_in: Number(parsed.overall_height_in) || 0,
    wheelbase_in: parsed.wheelbase_in ? Number(parsed.wheelbase_in) : undefined,
  };

  // Merge model-reported source_urls with Google grounding uris
  const modelSources: string[] = Array.isArray(parsed.source_urls) ? parsed.source_urls : [];
  const all_source_urls = Array.from(new Set([...modelSources, ...groundingUris]));

  return {
    dims,
    sub_type: parsed.sub_type,
    confidence: parsed.confidence || "medium",
    source_urls: all_source_urls,
    raw: data,
  };
}

function runSanityCheck(vehicleClass: VehicleClass, dims: VehicleDimensions): void {
  const ranges = SANITY_RANGES[vehicleClass];
  const [lMin, lMax] = ranges.length;
  const [wMin, wMax] = ranges.width;
  const [hMin, hMax] = ranges.height;

  if (dims.overall_length_in < lMin || dims.overall_length_in > lMax) {
    throw new Error(
      `Implausible length ${dims.overall_length_in}" for ${vehicleClass} (expected ${lMin}–${lMax}")`
    );
  }
  if (dims.overall_width_in < wMin || dims.overall_width_in > wMax) {
    throw new Error(
      `Implausible width ${dims.overall_width_in}" for ${vehicleClass} (expected ${wMin}–${wMax}")`
    );
  }
  if (dims.overall_height_in < hMin || dims.overall_height_in > hMax) {
    throw new Error(
      `Implausible height ${dims.overall_height_in}" for ${vehicleClass} (expected ${hMin}–${hMax}")`
    );
  }
}

// ---------------------------------------------------------------------------
// Main lookup function (exported)
// ---------------------------------------------------------------------------

export async function resolveUniversalVehicleSpecs(
  supabase: any,
  vehicleClass: VehicleClass,
  year: string,
  make: string,
  model: string,
): Promise<UniversalVehicleSpecs> {
  const makeTrimmed = (make || "").trim();
  const modelTrimmed = (model || "").trim();
  const yearTrimmed = (year || "").trim();

  if (!makeTrimmed || !modelTrimmed) {
    throw new Error("make and model are required for spec lookup");
  }

  // 1. Cache lookup
  try {
    const { data: cached } = await supabase
      .from("vehicle_specs_universal")
      .select("*")
      .eq("vehicle_class", vehicleClass)
      .ilike("make", makeTrimmed)
      .ilike("model", modelTrimmed)
      .eq("year", yearTrimmed)
      .limit(1)
      .maybeSingle();

    if (cached) {
      console.log(`[vehicle-specs-universal] Cache HIT for ${vehicleClass}: ${yearTrimmed} ${makeTrimmed} ${modelTrimmed}`);
      return {
        id: cached.id,
        vehicle_class: cached.vehicle_class,
        make: cached.make,
        model: cached.model,
        year: cached.year,
        sub_type: cached.sub_type,
        dimensions: {
          overall_length_in: cached.overall_length_in,
          overall_width_in: cached.overall_width_in,
          overall_height_in: cached.overall_height_in,
          wheelbase_in: cached.wheelbase_in,
        },
        panels: cached.panels || {},
        source: cached.source,
        source_urls: cached.source_urls || [],
        confidence: cached.confidence,
        requires_validation: cached.requires_validation,
        cached: true,
      };
    }
  } catch (cacheErr) {
    console.warn("[vehicle-specs-universal] Cache lookup failed (continuing to live lookup):", cacheErr);
  }

  // 2. Live Google-grounded lookup
  if (!hasGeminiKey()) {
    throw new Error("Gemini API key unavailable — cannot look up non-standard vehicle specs");
  }

  console.log(`[vehicle-specs-universal] Cache MISS — Google grounding lookup: ${vehicleClass} ${yearTrimmed} ${makeTrimmed} ${modelTrimmed}`);
  const grounding = await groundingLookup(vehicleClass, yearTrimmed, makeTrimmed, modelTrimmed);

  // 3. Sanity check (class-aware, does NOT reject motorcycles/boats/buses)
  runSanityCheck(vehicleClass, grounding.dims);

  // 4. Panel estimation (class-aware)
  const panels = estimatePanels(vehicleClass, grounding.dims);

  // 5. Cache insert
  let insertedId: string | undefined;
  try {
    const { data: inserted, error: insertErr } = await supabase
      .from("vehicle_specs_universal")
      .upsert(
        {
          vehicle_class: vehicleClass,
          make: makeTrimmed,
          model: modelTrimmed,
          year: yearTrimmed,
          sub_type: grounding.sub_type || null,
          overall_length_in: grounding.dims.overall_length_in,
          overall_width_in: grounding.dims.overall_width_in,
          overall_height_in: grounding.dims.overall_height_in,
          wheelbase_in: grounding.dims.wheelbase_in || null,
          panels,
          source: "gemini_grounded",
          source_urls: grounding.source_urls,
          confidence: grounding.confidence,
          requires_validation: true, // ALWAYS true for non-standard vehicles
          raw_response: grounding.raw,
        },
        { onConflict: "vehicle_class,make,model,year" },
      )
      .select("id")
      .single();

    if (insertErr) {
      console.error("[vehicle-specs-universal] Cache insert failed:", insertErr.message);
    } else {
      insertedId = inserted?.id;
      console.log(`[vehicle-specs-universal] Cached new spec: ${insertedId}`);
    }
  } catch (insertEx) {
    console.error("[vehicle-specs-universal] Cache insert exception:", insertEx);
  }

  return {
    id: insertedId,
    vehicle_class: vehicleClass,
    make: makeTrimmed,
    model: modelTrimmed,
    year: yearTrimmed,
    sub_type: grounding.sub_type,
    dimensions: grounding.dims,
    panels,
    source: "gemini_grounded",
    source_urls: grounding.source_urls,
    confidence: grounding.confidence,
    requires_validation: true,
    cached: false,
  };
}

// ---------------------------------------------------------------------------
// Human-readable summary for prompt injection
// ---------------------------------------------------------------------------

export function formatSpecsForPrompt(specs: UniversalVehicleSpecs): string {
  const d = specs.dimensions;
  const subType = specs.sub_type ? ` (${specs.sub_type.replace(/_/g, " ")})` : "";
  const parts = [
    `Vehicle dimensions${subType}: ${d.overall_length_in}" long × ${d.overall_width_in}" wide × ${d.overall_height_in}" tall`,
  ];
  if (d.wheelbase_in) parts.push(`${d.wheelbase_in}" wheelbase`);
  if (specs.panels.total_sq_ft) parts.push(`~${specs.panels.total_sq_ft} sq ft wrap coverage`);
  return parts.join(", ");
}
