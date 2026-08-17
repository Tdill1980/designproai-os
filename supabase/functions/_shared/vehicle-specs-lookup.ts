/**
 * vehicle-specs-lookup.ts — Deterministic Vehicle Dimension Resolver
 *
 * 3-tier fallback pipeline:
 *   L1: Direct hit — exact year/make/model from 1,660-vehicle database
 *   L2: Temporal fallback — nearest year for same make/model
 *   L3: Wheelbase anchor — calculate from a single known dimension
 *
 * Used by generate-color-render (ApproveMode) and generate-master-artboard
 * to pass real panel dimensions to Gemini for deterministic scaling.
 */

import specsJson from "./vehicle-specs.json" with { type: "json" };

interface VehicleSpec {
  make: string;
  model: string;
  year: string;
  sW: number | null; // side width
  sH: number | null; // side height
  bW: number | null; // back width
  bH: number | null; // back height
  hW: number | null; // hood width
  hL: number | null; // hood length
  rW: number | null; // roof width
  rL: number | null; // roof length
  tSF: number | null; // total sq ft
}

export interface PanelDimensions {
  sideW?: number;
  sideH?: number;
  hoodW?: number;
  hoodL?: number;
  backW?: number;
  backH?: number;
  roofW?: number;
  roofL?: number;
  totalSqFt?: number;
  source: "L1-direct" | "L2-temporal" | "L3-scaled" | "none";
  matchedYear?: string;
}

const SPECS: VehicleSpec[] = specsJson as VehicleSpec[];

/**
 * Parse year ranges like "2006-2011" or single years like "2020"
 * Returns [startYear, endYear] as numbers
 */
function parseYearRange(yearStr: string): [number, number] {
  if (yearStr.includes("-")) {
    const parts = yearStr.split("-").map((s) => parseInt(s.trim()));
    return [parts[0], parts[1]];
  }
  const y = parseInt(yearStr);
  return [y, y];
}

/**
 * Check if a target year falls within a year range string
 */
function yearInRange(targetYear: number, rangeStr: string): boolean {
  const [start, end] = parseYearRange(rangeStr);
  return targetYear >= start && targetYear <= end;
}

/**
 * Normalize make/model for matching (lowercase, trim whitespace)
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

/**
 * Normalize make with common aliases
 * "Mercedes-Benz" → "mercedes", "Chevy" → "chevrolet", etc.
 */
const MAKE_ALIASES: Record<string, string> = {
  "mercedesbenz": "mercedes",
  "chevy": "chevrolet",
  "vw": "volkswagen",
};

function normalizeMake(make: string): string {
  const n = normalize(make);
  return MAKE_ALIASES[n] || n;
}

/**
 * Token-based model matching: checks if most search words appear in the spec model
 * e.g. "Sprinter High Roof Extended" matches "Sprinter 2500 - 170WB Extended - High Roof"
 */
function modelTokenMatch(specModel: string, searchModel: string): boolean {
  const specTokens = normalize(specModel).split(/\s+/);
  const searchTokens = normalize(searchModel).split(/\s+/).filter(t => t.length > 2);
  if (searchTokens.length === 0) return false;
  const matchCount = searchTokens.filter(st => specTokens.some(sp => sp.includes(st) || st.includes(sp))).length;
  return matchCount >= Math.ceil(searchTokens.length * 0.6); // 60% of words match
}

function specToDimensions(spec: VehicleSpec, source: PanelDimensions["source"], matchedYear?: string): PanelDimensions {
  return {
    sideW: spec.sW ?? undefined,
    sideH: spec.sH ?? undefined,
    hoodW: spec.hW ?? undefined,
    hoodL: spec.hL ?? undefined,
    backW: spec.bW ?? undefined,
    backH: spec.bH ?? undefined,
    roofW: spec.rW ?? undefined,
    roofL: spec.rL ?? undefined,
    totalSqFt: spec.tSF ?? undefined,
    source,
    matchedYear: matchedYear || spec.year,
  };
}

/**
 * L1: Direct hit — exact year/make/model match
 */
function directLookup(year: string, make: string, model: string): PanelDimensions | null {
  const nMake = normalizeMake(make);
  const nModel = normalize(model);
  const targetYear = parseInt(year);

  // Try exact year range match
  for (const spec of SPECS) {
    if (normalizeMake(spec.make) === nMake && normalize(spec.model) === nModel) {
      if (yearInRange(targetYear, spec.year)) {
        return specToDimensions(spec, "L1-direct", year);
      }
    }
  }

  // Try fuzzy model match (e.g. "Camaro" matches "Camaro 2-Door Coupe")
  for (const spec of SPECS) {
    if (normalizeMake(spec.make) === nMake && normalize(spec.model).includes(nModel)) {
      if (yearInRange(targetYear, spec.year)) {
        return specToDimensions(spec, "L1-direct", year);
      }
    }
  }

  // Try token-based match (e.g. "Sprinter High Roof Extended" matches "Sprinter 2500 - 170WB Extended - High Roof")
  for (const spec of SPECS) {
    if (normalizeMake(spec.make) === nMake && modelTokenMatch(spec.model, model)) {
      if (yearInRange(targetYear, spec.year)) {
        return specToDimensions(spec, "L1-direct", year);
      }
    }
  }

  return null;
}

/**
 * L2: Temporal fallback — find closest year for same make/model
 * Vehicle body styles usually stay the same for 5-7 year generations
 */
function temporalFallback(year: string, make: string, model: string): PanelDimensions | null {
  const nMake = normalizeMake(make);
  const nModel = normalize(model);
  const targetYear = parseInt(year);

  // Collect all matching make/model entries
  const matches: { spec: VehicleSpec; distance: number; midYear: number }[] = [];

  for (const spec of SPECS) {
    const matchExact = normalizeMake(spec.make) === nMake && normalize(spec.model) === nModel;
    const matchFuzzy = normalizeMake(spec.make) === nMake && (normalize(spec.model).includes(nModel) || modelTokenMatch(spec.model, model));

    if (matchExact || matchFuzzy) {
      const [start, end] = parseYearRange(spec.year);
      const midYear = Math.floor((start + end) / 2);
      const distance = Math.abs(targetYear - midYear);
      matches.push({ spec, distance, midYear });
    }
  }

  if (matches.length === 0) return null;

  // Sort by distance (closest year first), prefer later years
  matches.sort((a, b) => a.distance - b.distance || b.midYear - a.midYear);

  const best = matches[0];
  // Only use temporal fallback if within 10 years
  if (best.distance > 10) return null;

  return specToDimensions(best.spec, "L2-temporal", best.spec.year);
}

/**
 * L3: Scale from a wheelbase anchor dimension
 * Uses proportional scaling based on a reference vehicle
 *
 * Standard proportions (derived from dataset averages):
 *   sideW ≈ wheelbase × 1.45
 *   sideH ≈ sideW × 0.32
 *   hoodW ≈ sideW × 0.37
 *   hoodL ≈ hoodW × 0.52
 *   backW ≈ hoodW × 0.88
 *   backH ≈ sideH × 1.15
 *   roofW ≈ hoodW × 0.93
 *   roofL ≈ sideW × 0.62
 */
export function scaleFromWheelbase(wheelbaseInches: number): PanelDimensions {
  const sideW = Math.round(wheelbaseInches * 1.45);
  const sideH = Math.round(sideW * 0.32);
  const hoodW = Math.round(sideW * 0.37);
  const hoodL = Math.round(hoodW * 0.52);
  const backW = Math.round(hoodW * 0.88);
  const backH = Math.round(sideH * 1.15);
  const roofW = Math.round(hoodW * 0.93);
  const roofL = Math.round(sideW * 0.62);
  const totalSqFt = Math.round(
    ((sideW * sideH * 2) + (hoodW * hoodL) + (backW * backH) + (roofW * roofL)) / 144
  );

  return {
    sideW, sideH, hoodW, hoodL, backW, backH, roofW, roofL, totalSqFt,
    source: "L3-scaled",
  };
}

/**
 * Main resolver — 3-tier fallback pipeline
 *
 * Returns panel dimensions with source indicator:
 *   L1-direct:   Exact year/make/model from database
 *   L2-temporal:  Nearest year for same make/model
 *   L3-scaled:    Calculated from wheelbase (if provided)
 *   none:         No data available
 */
export function resolveVehicleSpecs(
  year: string,
  make: string,
  model: string,
  wheelbaseInches?: number,
): PanelDimensions {
  // L1: Direct hit
  const l1 = directLookup(year, make, model);
  if (l1) {
    console.log(`[SPECS] L1 direct hit: ${year} ${make} ${model} → ${l1.sideW}"×${l1.sideH}" sides`);
    return l1;
  }

  // L2: Temporal fallback
  const l2 = temporalFallback(year, make, model);
  if (l2) {
    console.log(`[SPECS] L2 temporal fallback: ${year} ${make} ${model} → matched ${l2.matchedYear}`);
    return l2;
  }

  // L3: Wheelbase anchor scaling
  if (wheelbaseInches && wheelbaseInches > 50) {
    const l3 = scaleFromWheelbase(wheelbaseInches);
    console.log(`[SPECS] L3 wheelbase scaling: ${wheelbaseInches}" → ${l3.sideW}"×${l3.sideH}" sides`);
    return l3;
  }

  console.log(`[SPECS] No match: ${year} ${make} ${model}`);
  return { source: "none" };
}

/**
 * L4: Google grounding fallback — uses Gemini + Google Search to find
 * vehicle wheelbase, then calculates panel dimensions from it.
 * Saves the result to a Supabase table for future lookups.
 *
 * This is ASYNC and makes network calls. Only use when L1-L3 fail.
 */
export async function resolveVehicleSpecsWithGrounding(
  year: string,
  make: string,
  model: string,
  geminiApiKey: string,
  supabaseClient?: any,
): Promise<PanelDimensions> {
  // Try sync lookup first
  const sync = resolveVehicleSpecs(year, make, model);
  if (sync.source !== "none") return sync;

  console.log(`[SPECS] L4 Google grounding: searching for ${year} ${make} ${model} wheelbase...`);

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: `What is the wheelbase in inches of a ${year} ${make} ${model}? Also provide the overall length in inches if available. Return ONLY a JSON object like: {"wheelbase_inches": 148, "overall_length_inches": 231}. No explanation, just JSON.` }],
          }],
          tools: [{ googleSearch: {} }],
          generationConfig: { responseMimeType: "text/plain" },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!resp.ok) {
      console.warn(`[SPECS] L4 Gemini returned ${resp.status}`);
      return { source: "none" };
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.warn("[SPECS] L4 no JSON in Gemini response");
      return { source: "none" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const wheelbase = parsed.wheelbase_inches;

    if (!wheelbase || wheelbase < 50) {
      console.warn(`[SPECS] L4 invalid wheelbase: ${wheelbase}`);
      return { source: "none" };
    }

    const dims = scaleFromWheelbase(wheelbase);
    console.log(`[SPECS] L4 Google grounding: ${year} ${make} ${model} → wheelbase ${wheelbase}" → ${dims.sideW}"×${dims.sideH}" sides`);

    // Save to Supabase for future lookups (non-blocking)
    if (supabaseClient) {
      try {
        // Add to vehicle_specs_cache table if it exists
        await supabaseClient.from("vehicle_specs_cache").upsert({
          make,
          model,
          year_range: `${year}-${year}`,
          side_w: dims.sideW,
          side_h: dims.sideH,
          hood_w: dims.hoodW,
          hood_l: dims.hoodL,
          back_w: dims.backW,
          back_h: dims.backH,
          roof_w: dims.roofW,
          roof_l: dims.roofL,
          total_sqft: dims.totalSqFt,
          wheelbase_inches: wheelbase,
          source: "google_grounding",
        }, { onConflict: "make,model,year_range" });
        console.log(`[SPECS] L4 cached to vehicle_specs_cache`);
      } catch (cacheErr) {
        console.warn("[SPECS] L4 cache save failed (non-fatal):", cacheErr);
      }
    }

    return { ...dims, source: "L3-scaled" as const };
  } catch (err) {
    console.warn("[SPECS] L4 Google grounding error:", err);
    return { source: "none" };
  }
}
