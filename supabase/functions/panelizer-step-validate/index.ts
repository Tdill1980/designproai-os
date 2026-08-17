/**
 * ─────────────────────────────────────────────────────────────
 *  GENIE™ Universal Panelizer
 *  Part of the LiftIQ Engine™ / Prompt-to-Production™ architecture.
 *
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *  Proprietary & confidential. Contains trade-secret methods
 *  (layer-separated generative render & panel synthesis).
 *  Trademarks: GENIE™, DesignIQ™, LiftIQ™ — see /NOTICE and
 *  docs/TRADEMARKS.md. Not legal advice.
 * ─────────────────────────────────────────────────────────────
 */
/**
 * panelizer-step-validate — Step 1: VALIDATE
 *
 * Input:  { vehicleMake, vehicleModel, sideSize, addHood, addRoof, roofSize,
 *           addFrontBumper, addRearBumper, addRear }
 * Output: { panels: [...], validation: {...} }
 *
 * Looks up the vehicle in the 260-row CSV database (fuzzy match).
 * Returns REAL panel dimensions from the vehicle measurements.
 * NEVER defaults to 240" × 59.5" — uses actual vehicle body dimensions.
 *
 * Panels taller than MAX_TILE_INCHES (53.5") get tiled into
 * Panel 1 (upper) + Panel 2 (lower) with 1" overlap at the seam.
 *
 * No AI, no images — pure math.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import {
  lookupVehicle,
  validatePanelSize,
  isTwoPanelVehicle,
  BLEED_INCHES,
  MAX_TILE_INCHES,
  MAX_PRINTABLE_HEIGHT,
  ROLL_WIDTH_INCHES,
  OVERLAP_INCHES,
  PPI,
  inchesToPx,
  VEHICLE_DIMENSIONS,
  CATEGORY_DEFAULTS,
  type VehicleDimensions,
} from "../_shared/panelizer-os/constants.ts";
import { classifyVehicle } from "../_shared/panelizer-os/vehicle-database.ts";

// ── Make normalization (typo repair) ────────────────────────────────
// Fix make misspellings BEFORE any lookup (DB, cache key, Google grounding)
// so "infinity" / "infinitity" ground as "Infiniti". Small alias map +
// repeated-letter collapse + edit-distance ≤ 2 against a canonical list —
// deterministic, no fuzzy-match library. Unknown makes pass through unchanged.
const CANONICAL_MAKES: Record<string, string> = {
  infiniti: "Infiniti", chevrolet: "Chevrolet", volkswagen: "Volkswagen",
  "mercedes-benz": "Mercedes-Benz", "land rover": "Land Rover", mini: "MINI",
  toyota: "Toyota", honda: "Honda", nissan: "Nissan", ford: "Ford",
  dodge: "Dodge", ram: "Ram", gmc: "GMC", jeep: "Jeep", subaru: "Subaru",
  hyundai: "Hyundai", kia: "Kia", mazda: "Mazda", lexus: "Lexus",
  acura: "Acura", audi: "Audi", bmw: "BMW", porsche: "Porsche",
  tesla: "Tesla", cadillac: "Cadillac", buick: "Buick", lincoln: "Lincoln",
  chrysler: "Chrysler", mitsubishi: "Mitsubishi", volvo: "Volvo",
  jaguar: "Jaguar", genesis: "Genesis", freightliner: "Freightliner",
  peterbilt: "Peterbilt", kenworth: "Kenworth", isuzu: "Isuzu", hino: "Hino",
};
const MAKE_ALIASES: Record<string, string> = {
  infinity: "infiniti", infinit: "infiniti", infinitity: "infiniti",
  chevy: "chevrolet", vw: "volkswagen",
  mercedes: "mercedes-benz", benz: "mercedes-benz", "mercedes benz": "mercedes-benz",
  landrover: "land rover", "land-rover": "land rover",
};

// Levenshtein distance with early exit once it exceeds `max`.
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Canonical lowercase make key ("infinitity" → "infiniti"). Returns the
// cleaned input when no confident match exists — never invents a make.
function normalizeMakeKey(raw: string | null | undefined): string {
  const lower = (raw || "").toLowerCase().trim();
  if (!lower) return lower;
  if (MAKE_ALIASES[lower]) return MAKE_ALIASES[lower];
  if (CANONICAL_MAKES[lower]) return lower;
  // Collapse repeated letters ("hondda" → "honda") and re-check.
  const collapsed = lower.replace(/([a-z])\1+/g, "$1");
  if (MAKE_ALIASES[collapsed]) return MAKE_ALIASES[collapsed];
  if (CANONICAL_MAKES[collapsed]) return collapsed;
  // Closest canonical make within edit distance 2 — gated on length ≥ 6 AND a
  // matching 3-char prefix so short/near makes (kia/ram, lotus↔lexus) can't
  // be mis-mapped.
  if (lower.length >= 6) {
    for (const canon of Object.keys(CANONICAL_MAKES)) {
      if (canon.length >= 6 && canon.slice(0, 3) === lower.slice(0, 3) && editDistance(lower, canon, 2) <= 2) {
        return canon;
      }
    }
  }
  return lower;
}

// Display-cased make for the grounding prompt ("infinitity" → "Infiniti").
function normalizeMakeDisplay(raw: string | null | undefined): string {
  const key = normalizeMakeKey(raw);
  return CANONICAL_MAKES[key] || raw || "";
}

// ── Google Search dimension lookup via Gemini ──────────────────────
// Uses Gemini with google_search tool to find real vehicle specs online.
// Returns validated dimensions or null if search fails / data looks bad.
async function searchVehicleDimensions(
  make: string,
  model: string,
  year: number | null,
): Promise<VehicleDimensions | null> {
  const key = getGeminiKey();
  // Normalize make misspellings (normalizeMakeDisplay above) so grounding
  // searches the REAL make (e.g. "infinitity" → "Infiniti"). An impossible
  // year (a year the model was never sold — e.g. "2015 Q45", which ended in
  // 2006) must NOT sink the search; the prompt below tells the model to use
  // the model's actual production-year specs when the given year doesn't exist.
  const normMake = normalizeMakeDisplay(make) || make;
  const yearStr = year ? `${year} ` : "";
  const vehicleName = `${yearStr}${normMake} ${model}`.trim();

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: `Look up the real vehicle specifications for a ${vehicleName}. I need ACTUAL measurements from manufacturer specs or trusted automotive sources (edmunds.com, caranddriver.com, motortrend.com, manufacturer websites).

IMPORTANT: If a "${vehicleName}" was never produced in that exact year (the model was not sold that year — e.g. an Infiniti Q45 ended in 2006), DO NOT invent numbers. Instead use the specifications from the years this make + model WAS actually produced — identify the correct generation and use its real dimensions.

Find these measurements and convert all to INCHES:
- Wheelbase
- Overall length
- Overall width (without mirrors)
- Overall height
- Cargo/bed length (if truck)

Then CALCULATE these vinyl wrap panel dimensions using the formulas:
- sideWidth = overall length minus 8 to 10 inches (a full-side wrap runs nearly the ENTIRE body length; do NOT use wheelbase × 1.45 — that badly undersizes sedans)
- sideHeight = overall height × 0.75 to 0.82 (the wrappable body side from rocker to roof-drip)
- hoodWidth = overall width × 0.85
- hoodLength = front overhang (overall length - wheelbase - rear overhang, typically 35-45 inches)
- roofWidth = overall width × 0.80
- roofLength = wheelbase × 0.60
- backWidth = overall width × 0.85
- backHeight = overall height × 0.45

Return ONLY valid JSON, no markdown, no explanation:
{
  "wheelbase": <inches>,
  "overallLength": <inches>,
  "overallWidth": <inches>,
  "overallHeight": <inches>,
  "sideWidth": <calculated panel width in inches>,
  "sideHeight": <calculated panel height in inches>,
  "hoodWidth": <inches>,
  "hoodLength": <inches>,
  "roofWidth": <inches>,
  "roofLength": <inches>,
  "backWidth": <inches>,
  "backHeight": <inches>,
  "totalSqFt": <total wrap coverage both sides + hood + roof + rear in square feet>
}`,
          }],
        }],
        tools: [{ google_search: {} }],
      }),
    },
  );

  if (!resp.ok) {
    console.warn(`[VALIDATE] Google Search API error: ${resp.status}`);
    return null;
  }

  const result = await resp.json();
  const text = result?.candidates?.[0]?.content?.parts
    ?.filter((p: any) => p.text)
    ?.map((p: any) => p.text)
    ?.join("") || "";

  try {
    const clean = text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(clean);

    let sideW = Number(parsed.sideWidth);
    const sideH = Number(parsed.sideHeight);
    const wheelbase = Number(parsed.wheelbase);
    const overallLength = Number(parsed.overallLength) || 0;

    // A side wrap panel runs front-to-rear along the body, so it can NEVER exceed
    // the vehicle's overall length. The wheelbase×1.45 estimate (and total-length
    // misreads) overshoot on long-cab/long-bed trucks — e.g. a Ram 2500 mega cab
    // grounded to ~260" when the truck itself is ~247". Clamp to the real
    // wrappable side length so the print panels are always physically correct.
    if (overallLength > 80 && sideW > overallLength * 0.97) {
      const corrected = Math.round(overallLength * 0.92);
      console.warn(`[VALIDATE] Side width ${sideW}" > overall length ${overallLength}" — correcting to ${corrected}"`);
      sideW = corrected;
    }

    // Sanity checks — reject obviously wrong data
    if (!sideW || !sideH || sideW < 80 || sideW > 350 || sideH < 25 || sideH > 120) {
      console.warn(`[VALIDATE] Google Search dims out of range: side ${sideW}"×${sideH}" — rejecting`);
      return null;
    }
    if (wheelbase && (wheelbase < 60 || wheelbase > 250)) {
      console.warn(`[VALIDATE] Google Search wheelbase out of range: ${wheelbase}" — rejecting`);
      return null;
    }

    // Ensure width > height for side panels (auto-correct swap)
    const finalSideW = Math.max(sideW, sideH);
    const finalSideH = Math.min(sideW, sideH);

    return {
      bodyLengthInches: Math.round(finalSideW),
      bodyHeightInches: Math.round(finalSideH),
      hoodWidthInches: Math.round(Number(parsed.hoodWidth) || finalSideW * 0.37),
      hoodLengthInches: Math.round(Number(parsed.hoodLength) || 38),
      roofWidthInches: Math.round(Number(parsed.roofWidth) || finalSideW * 0.35),
      roofLengthInches: Math.round(Number(parsed.roofLength) || wheelbase * 0.6 || 66),
      backWidthInches: Math.round(Number(parsed.backWidth) || 66),
      backHeightInches: Math.round(Number(parsed.backHeight) || 42),
      totalSqFt: Math.round(Number(parsed.totalSqFt) || 0),
      wheelbaseInches: wheelbase ? Math.round(wheelbase) : undefined,
      overallLengthInches: overallLength > 0 ? Math.round(overallLength) : undefined,
      category: "midsize" as any, // will be overridden by classifyVehicle
      source: "google_search" as any,
    };
  } catch (parseErr) {
    console.warn(`[VALIDATE] Failed to parse Google Search response: ${parseErr}`);
    console.warn(`[VALIDATE] Raw text: ${text.slice(0, 300)}`);
    return null;
  }
}

// ── Trailer / box-truck dimension derivation ───────────────────────
// Cars derive side width from wheelbase (sideWidth ≈ wheelbase × 1.45).
// A 15' enclosed trailer / 14' box truck has a SHORT axle wheelbase but a
// long flat body, so that formula collapsed a 180" trailer down to ~8ft
// (the production-blocking bug on order #35072). For these body types we
// parse the STATED length instead of inferring from a wheelbase, and skip
// the car formula entirely.
const TRAILER_RE =
  /\btrailers?\b|\benclosed\b|\bgooseneck\b|\bflatbed\b|\bcargo\s*trailer\b|\butility\s*trailer\b|\bconcession\b|\bconcession\s*trailer\b/i;
const BOX_RE =
  /\bbox\s*truck\b|\bbox\s*van\b|\bcube\s*van\b|\bstraight\s*truck\b|\bbox\b/i;

type TrailerKind = "enclosed" | "box";

function normalizeVehicleType(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function detectTrailerKind(text: string, vehicleType: unknown = ""): TrailerKind | null {
  const normalizedVehicleType = normalizeVehicleType(vehicleType);

  // The explicit UI/API selection is authoritative. A trailer brief may contain
  // the word "box" ("box trailer", "box-style trailer"), but that must not route
  // it through the taller box-truck/roof contract.
  if (normalizedVehicleType === "trailer") return "enclosed";

  if (!text) return null;
  if (BOX_RE.test(text)) return "box";
  if (TRAILER_RE.test(text)) return "enclosed";
  return null;
}

// Parse a stated body length to inches: "15'", "15 ft", "15-foot", "15ft".
function parseStatedLengthInches(text: string): number | null {
  if (!text) return null;
  const m = text.match(/\b(\d{1,2})\s*(?:'|’|-?\s*(?:ft\b|foot\b|feet\b))/i);
  if (m) {
    const ft = Number(m[1]);
    if (ft >= 4 && ft <= 53) return ft * 12; // 4ft utility → 53ft semi trailer
  }
  return null;
}

// Build full-rectangle panel dimensions for a trailer/box body from its
// STATED length. Returns null if the text isn't a trailer/box or has no
// stated length (so the caller falls through to CSV/Google as before).
function deriveTrailerDimensions(text: string, vehicleType: unknown = ""): VehicleDimensions | null {
  const kind = detectTrailerKind(text, vehicleType);
  if (!kind) return null;
  const lengthIn = parseStatedLengthInches(text);
  if (!lengthIn) return null; // no stated length → can't safely skip the formula

  // Standard enclosed cargo / box-body geometry (inches). Box trucks ride
  // taller than enclosed trailers; both are ~96" (8ft) wide bodies.
  const height = kind === "box" ? 96 : 84;
  const width = 96;
  const sideWidth = lengthIn;
  const sideHeight = height;
  // Enclosed trailers use the locked four-wall print contract: driver,
  // passenger, front, rear. Box trucks preserve their existing roof coverage.
  const includeRoof = kind === "box";
  const totalSqFt = Math.round(
    (sideWidth * sideHeight * 2 + width * sideHeight * 2 + (includeRoof ? sideWidth * width : 0)) / 144,
  );

  return {
    bodyLengthInches: sideWidth,
    bodyHeightInches: sideHeight,
    hoodWidthInches: 0, // flat-front body — no hood panel
    hoodLengthInches: 0,
    roofWidthInches: includeRoof ? width : 0,
    roofLengthInches: includeRoof ? sideWidth : 0,
    backWidthInches: width,
    backHeightInches: sideHeight,
    totalSqFt,
    category: "van" as any, // closest tall-box category for downstream defaults
    source: "trailer",
  };
}

function tierForWidth(w: number): string {
  return w < 144 ? "small" : w < 172 ? "medium" : w < 200 ? "large" : "xl";
}

// Persist derived/searched dims to vehicle_dimensions so the next job for the
// same vehicle is a DB hit. Best-effort: never throws.
async function cacheVehicleDims(
  make: string,
  model: string,
  year: number | null,
  dims: VehicleDimensions,
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await supabase.from("vehicle_dimensions").insert({
      make: normalizeMakeKey(make),
      model: (model || "").toLowerCase().trim(),
      year_range: year ? `${year}` : null,
      year_start: year || null,
      year_end: year || null,
      side_width: dims.bodyLengthInches,
      side_height: dims.bodyHeightInches,
      hood_width: dims.hoodWidthInches,
      hood_length: dims.hoodLengthInches,
      roof_width: dims.roofWidthInches,
      roof_length: dims.roofLengthInches,
      back_width: dims.backWidthInches,
      back_height: dims.backHeightInches,
      total_sqft: dims.totalSqFt || null,
      recommended_size: tierForWidth(dims.bodyLengthInches),
    });
    console.log(`[VALIDATE] ✓ Cached ${make} ${model} to vehicle_dimensions (source=${dims.source})`);
  } catch (insertErr: any) {
    console.warn(`[VALIDATE] Failed to cache dims: ${insertErr.message}`);
  }
}

interface PanelPlan {
  panelKey: string;
  panelType: "side" | "addon" | "roof";
  label: string;
  widthInches: number;
  heightInches: number;
  widthWithBleed: number;
  heightWithBleed: number;
  widthPx: number;
  heightPx: number;
  mirrored: boolean;
  sqFt: number;
  cropZone?: "upper" | "lower";
}

// Sanity bounds for vehicle side-panel dimensions (inches).
// Width spans cars (~140") through extended box vans (~290").
// Height spans coupes/convertibles (~30") through sleeper-cab semis
// (Volvo VNL ~144", International 9000ix ~156"), so the high bound
// has to leave room for those. Rows outside this range (e.g. McLaren
// 720S at 28" height) are bad data and must NOT be returned — we fall
// through to the next layer in the cascade (CSV → Google → defaults).
const MIN_SIDE_W = 50; // "Cab Only" medium-duty truck cabs go as low as ~57"
const MAX_SIDE_W = 350;
const MIN_SIDE_H = 40; // McLaren 720S row was 28" — clearly bad
const MAX_SIDE_H = 165; // Volvo VNL sleeper / Intl 9000ix top out ~156"

function isSideDimsSane(w: number | null | undefined, h: number | null | undefined): boolean {
  if (!w || !h) return false;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return false;
  return w >= MIN_SIDE_W && w <= MAX_SIDE_W && h >= MIN_SIDE_H && h <= MAX_SIDE_H;
}

// Score a DB row against the requested model year. Higher score = better
// match. With multiple year-range rows (e.g. five generations of Camry),
// we prefer the row whose year_start..year_end window covers the user's
// year; otherwise the row whose midpoint is closest.
function scoreYearMatch(row: any, year: number | null): number {
  if (!year || !Number.isFinite(year)) return 0;
  const ys = Number(row.year_start);
  const ye = Number(row.year_end);
  if (Number.isFinite(ys) && Number.isFinite(ye)) {
    if (year >= ys && year <= ye) return 1_000_000; // perfect cover
    const mid = (ys + ye) / 2;
    return -Math.abs(year - mid); // closer midpoint = higher score
  }
  // Fallback: parse the year_range string if year_start/end weren't filled
  const yr = String(row.year_range || "");
  const m = yr.match(/(\d{4})(?:\s*[-–]\s*(\d{4}))?/);
  if (m) {
    const s = Number(m[1]);
    const e = m[2] ? Number(m[2]) : s;
    if (year >= s && year <= e) return 1_000_000;
    return -Math.abs(year - (s + e) / 2);
  }
  return 0;
}

// Given a candidate set of rows, pick the best sane one for this year.
// Tokenize a model string for matching. Besides splitting on punctuation/space,
// we ALSO split at letter↔digit boundaries so a glued trim/cab suffix becomes its
// own token: "f150xlt" → ["150","xlt"], "ram2500" → ["ram","2500"]. Without this
// the whole string is one token, so an order saved as "f150xlt" (no space) never
// matches the curated "F150 XLT" row and falls through to a wrong fuzzy match
// (e.g. the 133.9"×111.5" 8000-9000 day-cab) — stamping the wrong sizes on the 2D
// proof AND the print panels. Applied identically to query + row tokens so the
// overlap scoring in pickBestRow stays symmetric.
const splitGlued = (s: string): string =>
  (s || "")
    .toLowerCase()
    .replace(/(\d)([a-z])/g, "$1 $2")  // "f150xlt" → "f150 xlt", "150hd" → "150 hd"
    .replace(/([a-z])(\d)/g, "$1 $2"); // "ram2500" → "ram 2500" (keeps query/row symmetric)
const modelToks = (s: string | null | undefined): string[] =>
  splitGlued(s || "").split(/[^a-z0-9]+/).filter((t) => t.length > 1);

function pickBestRow(rows: any[] | null | undefined, year: number | null, queryModel?: string): any | null {
  if (!rows?.length) return null;
  const sane = rows.filter((r: any) => {
    const w = Math.max(Number(r.side_width) || 0, Number(r.side_height) || 0);
    const h = Math.min(Number(r.side_width) || 0, Number(r.side_height) || 0);
    return isSideDimsSane(w, h);
  });
  if (sane.length === 0) return null;

  // Variant-aware ranking. The fuzzy fetch can return several trims of the same
  // model (e.g. mega cab 6'4 box vs the impossible 8ft box, crew cab, reg cab).
  // Rank by how many of the QUERY's model tokens the row matches (so the right
  // cab style / box wins), then by year closeness, then prefer the SMALLER side
  // so an oversized outlier variant doesn't win when the query under-specifies.
  const qToks = modelToks(queryModel);
  const overlap = (r: any): number => {
    if (!qToks.length) return 0;
    const mt = new Set(modelToks(r.model));
    return qToks.filter((t) => mt.has(t)).length;
  };
  const sideOf = (r: any) => Math.max(Number(r.side_width) || 0, Number(r.side_height) || 0);
  sane.sort((a: any, b: any) => {
    const ov = overlap(b) - overlap(a);
    if (ov !== 0) return ov;
    const yr = scoreYearMatch(b, year) - scoreYearMatch(a, year);
    if (yr !== 0) return yr;
    return sideOf(a) - sideOf(b);
  });
  return sane[0];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      vehicleMake,
      vehicleModel,
      vehicleYear,
      // Optional free-text context (brief / design name) so trailer & box-truck
      // bodies can be detected even when make/model alone don't say "trailer".
      bodyText = "",
      // Explicit vehicle class from DesignPro/Production Pack. When this is
      // "trailer", it outranks incidental words such as "box" in the brief.
      vehicleType = "",
      estimateOnly,
      sideSize = "medium",
      addHood = false,
      addRoof = false,
      roofSize = "medium",
      addFrontBumper = false,
      addRearBumper = false,
      addRear = false,
    } = await req.json();

    // Resolve the CURRENT request's stated trailer geometry before consulting
    // any generic make/model cache. Cached rows can describe another body length
    // or even a car/box-truck variant; the customer's stated length is newer and
    // therefore authoritative for this job.
    const normalizedVehicleType = normalizeVehicleType(vehicleType);
    const explicitTrailer = normalizedVehicleType === "trailer";
    const trailerText = `${vehicleMake || ""} ${vehicleModel || ""} ${bodyText || ""}`;
    const currentTrailerDims = deriveTrailerDimensions(trailerText, normalizedVehicleType);

    // ── AI estimation mode ─────────────────────────────────────
    if (estimateOnly) {
      if (currentTrailerDims) {
        const tier = tierForWidth(currentTrailerDims.bodyLengthInches);
        console.log(`[VALIDATE-EST] Current trailer/box request: side ${currentTrailerDims.bodyLengthInches}"×${currentTrailerDims.bodyHeightInches}" → ${tier}`);
        await cacheVehicleDims(vehicleMake || "", vehicleModel || "", vehicleYear || null, currentTrailerDims);
        return new Response(
          JSON.stringify({
            found: true,
            sideSize: tier,
            roofSize: "none",
            source: "trailer",
            estimatedSideWidth: currentTrailerDims.bodyLengthInches,
            estimatedDimensions: currentTrailerDims,
            totalSqFt: currentTrailerDims.totalSqFt || null,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // An explicit trailer without a stated length must fail closed. Do not let a
      // stale generic DB/CSV row or the car wheelbase formula invent print geometry.
      if (explicitTrailer) {
        return new Response(
          JSON.stringify({
            found: false,
            sideSize: "medium",
            roofSize: "none",
            source: "unresolved",
            reason: "trailer_length_required",
            estimatedDimensions: null,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 1. Check Supabase vehicle_dimensions table first (most up-to-date)
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const sbClient = createClient(supabaseUrl, supabaseServiceKey);
        const makeLower = normalizeMakeKey(vehicleMake);
        const modelLower = (vehicleModel || "").toLowerCase().trim();

        // Order by side_width desc so when duplicate (make, model) rows
        // exist (~180 dup pairs as of 2026-05) we deterministically prefer
        // the full-body row over a door-only measurement.
        let { data: rows } = await sbClient
          .from("vehicle_dimensions")
          .select("*")
          .ilike("make", makeLower)
          .ilike("model", modelLower)
          .order("side_width", { ascending: false, nullsFirst: false })
          .limit(5);
        if (!rows?.length && modelLower) {
          const { data: partial } = await sbClient
            .from("vehicle_dimensions")
            .select("*")
            .ilike("make", `%${makeLower}%`)
            .ilike("model", `%${modelLower}%`)
            .order("side_width", { ascending: false, nullsFirst: false })
            .limit(5);
          rows = partial;
        }
        if (!rows?.length && modelLower) {
          const { data: modelOnly } = await sbClient
            .from("vehicle_dimensions")
            .select("*")
            .ilike("model", `%${modelLower}%`)
            .order("side_width", { ascending: false, nullsFirst: false })
            .limit(5);
          rows = modelOnly;
        }
        // Glued-trim-aware broad fetch (same fix as the main validate path):
        // "f150xlt" → ["150","xlt"] → %150%xlt% reaches the curated "F150 XLT"
        // row so quotes use the right sizing instead of a wrong fuzzy match.
        if (!rows?.length && modelLower) {
          const qToks = modelToks(modelLower);
          if (qToks.length) {
            const { data: variantRows } = await sbClient
              .from("vehicle_dimensions")
              .select("*")
              .ilike("make", `%${makeLower}%`)
              .ilike("model", `%${qToks.slice(0, 2).join("%")}%`)
              .limit(40);
            rows = variantRows;
          }
        }

        // Among the matched rows, pick the sane one closest to the
        // user's vehicleYear. Rows that fail sanity (e.g. McLaren 720S
        // with 28" height) are skipped so the cascade can continue to
        // CSV / Google.
        const saneRow = pickBestRow(rows, vehicleYear || null, modelLower);
        if (rows?.length && !saneRow) {
          console.warn(
            `[VALIDATE-EST] DB row(s) for ${vehicleMake} ${vehicleModel} failed sanity check — falling through to CSV/Google`,
          );
        }

        if (saneRow) {
          const r = saneRow;
          const rawW = Number(r.side_width) || 0;
          const rawH = Number(r.side_height) || 0;
          const sideWidth = Math.max(rawW, rawH);
          const sideHeight = Math.min(rawW, rawH);
          const category = classifyVehicle(vehicleMake || "", vehicleModel || "");
          const tier = sideWidth < 144 ? "small" : sideWidth < 172 ? "medium" : sideWidth < 200 ? "large" : "xl";
          const vehicle = {
            bodyLengthInches: sideWidth,
            bodyHeightInches: sideHeight,
            hoodWidthInches: Number(r.hood_width) || CATEGORY_DEFAULTS[category]?.hoodWidthInches || 56,
            hoodLengthInches: Number(r.hood_length) || CATEGORY_DEFAULTS[category]?.hoodLengthInches || 36,
            roofLengthInches: Number(r.roof_length) || CATEGORY_DEFAULTS[category]?.roofLengthInches || 66,
            roofWidthInches: Number(r.roof_width) || CATEGORY_DEFAULTS[category]?.roofWidthInches || 44,
            backWidthInches: Number(r.back_width) || CATEGORY_DEFAULTS[category]?.backWidthInches || 66,
            backHeightInches: Number(r.back_height) || CATEGORY_DEFAULTS[category]?.backHeightInches || 42,
            totalSqFt: Number(r.total_sqft) || 0,
            category,
            source: "csv" as const,
          };
          console.log(`[VALIDATE-EST] DB match: ${r.make} ${r.model} — side ${sideWidth}"×${sideHeight}"`);
          return new Response(
            JSON.stringify({ found: true, sideSize: tier, roofSize: "none", source: "database", estimatedDimensions: vehicle, totalSqFt: vehicle.totalSqFt || null }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } catch (dbErr: any) {
        console.warn(`[VALIDATE-EST] DB lookup failed: ${dbErr.message}`);
      }

      // 2. Fallback to embedded CSV
      const modelLower = (vehicleModel || "").toLowerCase().trim();
      const inDB = !!VEHICLE_DIMENSIONS[modelLower] ||
        Object.keys(VEHICLE_DIMENSIONS).some(k => modelLower.includes(k) || k.includes(modelLower));

      if (inDB) {
        const vehicle = lookupVehicle(vehicleMake || "", vehicleModel || "");
        // ONLY a real csv record — NEVER the generic CATEGORY_FALLBACK. Accepting
        // the fallback here silently returned generic sedan dims (175x50) for
        // unknown vehicles (e.g. Infiniti Q45), short-circuiting Google grounding.
        // Old default logic removed — an unknown vehicle must fall through to grounding.
        if (vehicle.source === "csv" && isSideDimsSane(vehicle.bodyLengthInches, vehicle.bodyHeightInches)) {
          const tier = vehicle.bodyLengthInches < 144 ? "small"
            : vehicle.bodyLengthInches < 172 ? "medium"
            : vehicle.bodyLengthInches < 200 ? "large" : "xl";
          return new Response(
            JSON.stringify({
              found: true,
              sideSize: tier,
              roofSize: "none",
              source: "database",
              estimatedDimensions: vehicle,
              totalSqFt: vehicle.totalSqFt || null,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        console.warn(
          `[VALIDATE-EST] CSV dims for ${vehicleMake} ${vehicleModel} failed sanity check (${vehicle.bodyLengthInches}"×${vehicle.bodyHeightInches}") — falling through to Google`,
        );
      }

      // Google Search fallback — find real specs online via Gemini + google_search
      if (hasGeminiKey() && (vehicleMake || vehicleModel)) {
        try {
          const searchDims = await searchVehicleDimensions(
            vehicleMake || "", vehicleModel || "", vehicleYear || null,
          );
          if (searchDims) {
            const sideWidth = searchDims.bodyLengthInches;
            const tier = sideWidth < 144 ? "small"
              : sideWidth < 172 ? "medium"
              : sideWidth < 200 ? "large" : "xl";
            console.log(`[VALIDATE] Google Search estimated ${vehicleMake} ${vehicleModel}: side ${sideWidth}" → ${tier}`);

            // Cache to DB for future lookups
            try {
              const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
              const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
              const supabase = createClient(supabaseUrl, supabaseServiceKey);
              await supabase.from("vehicle_dimensions").insert({
                make: normalizeMakeKey(vehicleMake),
                model: (vehicleModel || "").toLowerCase().trim(),
                year_range: vehicleYear ? `${vehicleYear}` : null,
                year_start: vehicleYear || null,
                year_end: vehicleYear || null,
                side_width: searchDims.bodyLengthInches,
                side_height: searchDims.bodyHeightInches,
                hood_width: searchDims.hoodWidthInches,
                hood_length: searchDims.hoodLengthInches,
                roof_width: searchDims.roofWidthInches,
                roof_length: searchDims.roofLengthInches,
                back_width: searchDims.backWidthInches,
                back_height: searchDims.backHeightInches,
                total_sqft: searchDims.totalSqFt || null,
                recommended_size: tier,
              });
              console.log(`[VALIDATE] ✓ Cached ${vehicleMake} ${vehicleModel} to vehicle_dimensions`);
            } catch (insertErr: any) {
              console.warn(`[VALIDATE] Failed to cache dims: ${insertErr.message}`);
            }

            return new Response(
              JSON.stringify({
                found: true,
                sideSize: tier,
                roofSize: "none",
                source: "google_search",
                estimatedSideWidth: sideWidth,
                estimatedDimensions: searchDims,
                totalSqFt: searchDims.totalSqFt || null,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        } catch (searchErr: any) {
          console.warn("[VALIDATE] Google Search estimation failed:", searchErr.message);
        }
      }

      return new Response(
        JSON.stringify({ found: false, sideSize: "medium", roofSize: "none", source: "default", reason: "no_verified_dimensions" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[VALIDATE] Vehicle: ${vehicleMake} ${vehicleModel}, Side: ${sideSize}`);

    // The current stated trailer dimensions outrank every generic cache/CSV row.
    let vehicle: VehicleDimensions | null = currentTrailerDims;
    if (vehicle) {
      console.log(`[VALIDATE] Current trailer/box request: side ${vehicle.bodyLengthInches}" × ${vehicle.bodyHeightInches}" (stated length, before cache)`);
      await cacheVehicleDims(vehicleMake || "", vehicleModel || "", vehicleYear || null, vehicle);
    }

    // Step 1: Try the 1,600-row Supabase vehicle_dimensions table only when the
    // current request did not provide trailer geometry.
    if (!vehicle && !explicitTrailer) {
      try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const makeLower = normalizeMakeKey(vehicleMake);
      const modelLower = (vehicleModel || "").toLowerCase().trim();

      // Order by side_width desc so duplicate (make, model) rows
      // resolve deterministically to the full-body row (not a door-only
      // measurement). Fetch a handful so we can sanity-filter below.
      let { data: rows } = await supabase
        .from("vehicle_dimensions")
        .select("*")
        .ilike("make", makeLower)
        .ilike("model", modelLower)
        .order("side_width", { ascending: false, nullsFirst: false })
        .limit(5);

      // Try partial match if no exact match
      if (!rows?.length && modelLower) {
        const { data: partialRows } = await supabase
          .from("vehicle_dimensions")
          .select("*")
          .ilike("make", `%${makeLower}%`)
          .ilike("model", `%${modelLower}%`)
          .order("side_width", { ascending: false, nullsFirst: false })
          .limit(5);
        rows = partialRows;
      }

      // Try model-only match
      if (!rows?.length && modelLower) {
        const { data: modelRows } = await supabase
          .from("vehicle_dimensions")
          .select("*")
          .ilike("model", `%${modelLower}%`)
          .order("side_width", { ascending: false, nullsFirst: false })
          .limit(5);
        rows = modelRows;
      }

      // VARIANT-AWARE broad fetch. The substring queries above are brittle to
      // punctuation/box wording — e.g. "%ram 2500 mega cab%" matches
      // "Ram 2500 Mega Cab 8ft box" but NOT "Ram 2500 - Mega Cab - 6'4 box" —
      // so the wrong (or largest) trim could win. Fetch every row that shares
      // the first two model tokens (e.g. ram + 2500) so ALL trims/box-lengths
      // are candidates, then let pickBestRow score them against the full query.
      // Use the glued-trim-aware tokenizer so "f150xlt" → ["150","xlt"] and the
      // broad fetch (%150%xlt%) reaches the curated "F150 XLT" row instead of
      // missing it (which dropped the cascade onto a wrong fuzzy match).
      const qToks = modelToks(modelLower);
      if (qToks.length) {
        const broad = `%${qToks.slice(0, 2).join("%")}%`;
        const { data: variantRows } = await supabase
          .from("vehicle_dimensions")
          .select("*")
          .ilike("make", `%${makeLower}%`)
          .ilike("model", broad)
          .limit(40);
        if (variantRows?.length) {
          const keyOf = (r: any) => r.id ?? `${r.make}|${r.model}|${r.year_range}`;
          const seen = new Set((rows || []).map(keyOf));
          rows = [...(rows || []), ...variantRows.filter((r: any) => !seen.has(keyOf(r)))];
        }
      }

      // Pick the sane row closest to the user's vehicleYear. Rows
      // that fail sanity (e.g. side_height of 28" for a McLaren) are
      // skipped so the cascade can fall through to CSV / Google.
      const saneRow = pickBestRow(rows, vehicleYear || null, modelLower);
      if (rows?.length && !saneRow) {
        console.warn(
          `[VALIDATE] DB row(s) for ${vehicleMake} ${vehicleModel} failed sanity check — falling through to CSV/Google`,
        );
      }

      if (saneRow) {
        const r = saneRow;
        // Auto-correct swapped width/height
        const rawW = Number(r.side_width) || 0;
        const rawH = Number(r.side_height) || 0;
        let sideWidth = Math.max(rawW, rawH);
        const sideHeight = Math.min(rawW, rawH);
        // Self-correct a cached overshoot: a side wrap panel can never exceed the
        // vehicle's overall length, so if a stored row overshot (e.g. an old
        // wheelbase x 1.45 ground), clamp it to the real wrappable side. Only when
        // overall_length is known — older rows without it are left untouched.
        const ovl = Number(r.overall_length) || 0;
        if (ovl > 80 && sideWidth > ovl * 0.97) {
          const corrected = Math.round(ovl * 0.92);
          console.warn(`[VALIDATE] Cached side ${sideWidth}" > overall length ${ovl}" — self-correcting to ${corrected}"`);
          sideWidth = corrected;
        }
        const category = classifyVehicle(vehicleMake || "", vehicleModel || "");

        vehicle = {
          bodyLengthInches: sideWidth,
          bodyHeightInches: sideHeight,
          hoodWidthInches: Number(r.hood_width) || CATEGORY_DEFAULTS[category]?.hoodWidthInches || 56,
          hoodLengthInches: Number(r.hood_length) || CATEGORY_DEFAULTS[category]?.hoodLengthInches || 36,
          roofLengthInches: Number(r.roof_length) || CATEGORY_DEFAULTS[category]?.roofLengthInches || 66,
          roofWidthInches: Number(r.roof_width) || CATEGORY_DEFAULTS[category]?.roofWidthInches || 44,
          backWidthInches: Number(r.back_width) || CATEGORY_DEFAULTS[category]?.backWidthInches || 66,
          backHeightInches: Number(r.back_height) || CATEGORY_DEFAULTS[category]?.backHeightInches || 42,
          totalSqFt: Number(r.total_sqft) || 0,
          category,
          source: "csv" as const,
        };
        console.log(`[VALIDATE] DB match: ${r.make} ${r.model} (${r.year_range}) — side ${sideWidth}" × ${sideHeight}" (from 1600-row table)`);
      }
      } catch (dbErr: any) {
        console.warn(`[VALIDATE] DB lookup failed, falling back to embedded CSV: ${dbErr.message}`);
      }
    }

    // Step 2: Fall back to embedded 260-row CSV if DB didn't match. Explicit
    // trailers never use the generic automotive CSV path.
    if (!vehicle && !explicitTrailer) {
      const csvResult = lookupVehicle(vehicleMake || "", vehicleModel || "");
      // Only use CSV if it found an actual match AND the dims pass
      // sanity. Otherwise fall through to Google Search below.
      if (
        csvResult.source === "csv" &&
        isSideDimsSane(csvResult.bodyLengthInches, csvResult.bodyHeightInches)
      ) {
        vehicle = csvResult;
        console.log(`[VALIDATE] CSV match: ${vehicle.category} — side ${vehicle.bodyLengthInches}" × ${vehicle.bodyHeightInches}"`);
      } else if (csvResult.source === "csv") {
        console.warn(
          `[VALIDATE] CSV dims for ${vehicleMake} ${vehicleModel} failed sanity check (${csvResult.bodyLengthInches}"×${csvResult.bodyHeightInches}") — falling through to Google`,
        );
      }
    }

    // Step 2.5: Google Search lookup via Gemini — find real specs online and cache to DB
    if (!vehicle && !explicitTrailer && hasGeminiKey() && (vehicleMake || vehicleModel)) {
      try {
        console.log(`[VALIDATE] No DB/CSV match — searching Google for ${vehicleMake} ${vehicleModel} specs...`);
        const searchDims = await searchVehicleDimensions(
          vehicleMake || "", vehicleModel || "", vehicleYear || null,
        );
        if (searchDims) {
          const category = classifyVehicle(vehicleMake || "", vehicleModel || "");
          vehicle = { ...searchDims, category, source: "google_search" as any };
          console.log(`[VALIDATE] Google Search found: side ${vehicle.bodyLengthInches}" × ${vehicle.bodyHeightInches}", wheelbase ${searchDims.wheelbaseInches || "?"}"`);

          // Persist to vehicle_dimensions table for future jobs
          try {
            const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
            const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            const yearStr = vehicleYear ? `${vehicleYear}` : null;
            await supabase.from("vehicle_dimensions").insert({
              make: normalizeMakeKey(vehicleMake),
              model: (vehicleModel || "").toLowerCase().trim(),
              year_range: yearStr,
              year_start: vehicleYear || null,
              year_end: vehicleYear || null,
              side_width: vehicle.bodyLengthInches,
              side_height: vehicle.bodyHeightInches,
              hood_width: vehicle.hoodWidthInches,
              hood_length: vehicle.hoodLengthInches,
              roof_width: vehicle.roofWidthInches,
              roof_length: vehicle.roofLengthInches,
              back_width: vehicle.backWidthInches,
              back_height: vehicle.backHeightInches,
              total_sqft: vehicle.totalSqFt || null,
              overall_length: vehicle.overallLengthInches || null,
              recommended_size: vehicle.bodyLengthInches < 144 ? "small"
                : vehicle.bodyLengthInches < 172 ? "medium"
                : vehicle.bodyLengthInches < 200 ? "large" : "xl",
            });
            console.log(`[VALIDATE] ✓ Cached ${vehicleMake} ${vehicleModel} to vehicle_dimensions`);
          } catch (insertErr: any) {
            console.warn(`[VALIDATE] Failed to cache dims: ${insertErr.message}`);
          }
        }
      } catch (searchErr: any) {
        console.warn(`[VALIDATE] Google Search lookup failed: ${searchErr.message}`);
      }
    }

    // Step 3: NO generic default. If DB, CSV, and Google grounding all missed,
    // the vehicle's real dims are UNKNOWN. Return found:false so the job flags it
    // as unverified (needs manual dims / re-ground) instead of silently printing
    // generic sedan sizes (175x50) — which produced wrong print files. The old
    // category-fallback default was removed on purpose; do NOT reintroduce it.
    if (!vehicle) {
      const unresolvedReason = explicitTrailer
        ? "trailer_length_required"
        : "no_verified_dimensions";
      console.warn(`[VALIDATE] No verified dims for ${vehicleMake} ${vehicleModel} — returning found:false (${unresolvedReason}), NO generic default`);
      return new Response(
        JSON.stringify({
          found: false,
          sideSize: "medium",
          roofSize: "none",
          source: "unresolved",
          reason: unresolvedReason,
          estimatedDimensions: null,
          panels: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    console.log(`[VALIDATE] Found: ${vehicle.category} (${vehicle.source}) — side ${vehicle.bodyLengthInches}" × ${vehicle.bodyHeightInches}"`);

    // Validate panel size coverage
    const sizeValidation = validatePanelSize(sideSize, vehicle);
    console.log(`[VALIDATE] Coverage: ${sizeValidation.coveragePercent.toFixed(0)}% — ${sizeValidation.recommendation}`);

    // Check if vehicle needs tiled panels (height > 53.5")
    const twoPanel = isTwoPanelVehicle(vehicle);
    if (twoPanel) {
      console.log(`[VALIDATE] Tall vehicle: ${vehicle.bodyHeightInches}" > ${MAX_TILE_INCHES}" — will split into upper/lower tiles`);
    }

    // Build panel plan using REAL vehicle dimensions
    const panels: PanelPlan[] = [];

    // Use REAL vehicle body dimensions for side panels
    const realSideWidth = vehicle.bodyLengthInches;
    const realSideHeight = vehicle.bodyHeightInches;

    if (twoPanel) {
      // Split side into upper + lower tiles with overlap
      const upperHeight = MAX_TILE_INCHES;
      const lowerHeight = Math.round((realSideHeight - MAX_TILE_INCHES + OVERLAP_INCHES) * 10) / 10;

      panels.push(buildPlan("driver-side-panel1", "side",
        { widthInches: realSideWidth, heightInches: upperHeight, label: "Driver Side - Panel 1" },
        false, "upper"));
      panels.push(buildPlan("driver-side-panel2", "side",
        { widthInches: realSideWidth, heightInches: lowerHeight, label: "Driver Side - Panel 2" },
        false, "lower"));
      panels.push(buildPlan("passenger-side-panel1", "side",
        { widthInches: realSideWidth, heightInches: upperHeight, label: "Passenger Side - Panel 1" },
        true, "upper"));
      panels.push(buildPlan("passenger-side-panel2", "side",
        { widthInches: realSideWidth, heightInches: lowerHeight, label: "Passenger Side - Panel 2" },
        true, "lower"));

      console.log(`[VALIDATE] Side panels: ${realSideWidth}" × [${upperHeight}" + ${lowerHeight}"] with ${OVERLAP_INCHES}" overlap`);
    } else {
      panels.push(buildPlan("driver-side", "side",
        { widthInches: realSideWidth, heightInches: realSideHeight, label: "Driver Side" },
        false));
      panels.push(buildPlan("passenger-side", "side",
        { widthInches: realSideWidth, heightInches: realSideHeight, label: "Passenger Side" },
        true));
    }

    // Build vehicle-specific addon panel specs from real dimensions
    const vehicleAddons = getVehicleAddonSpecs(vehicle);

    if (addHood) {
      panels.push(buildPlan("hood", "addon", vehicleAddons.hood, false));
    }
    if (addRear) {
      panels.push(buildPlan("rear", "addon", vehicleAddons.rear, false));
    }
    if (addFrontBumper) {
      panels.push(buildPlan("front-bumper", "addon", vehicleAddons.frontBumper, false));
    }
    if (addRearBumper) {
      panels.push(buildPlan("rear-bumper", "addon", vehicleAddons.rearBumper, false));
    }
    if (addRoof) {
      panels.push(buildPlan("roof", "roof", vehicleAddons.roof, false));
    }

    const panelSqFt = panels.reduce((sum, p) => sum + p.sqFt, 0);
    // Use the CSV database total sq ft if available (more accurate — includes curves),
    // otherwise use panel-calculated sq ft
    const dbSqFt = vehicle.totalSqFt || 0;
    const totalSqFt = dbSqFt > 0 ? dbSqFt : Math.round(panelSqFt * 10) / 10;

    console.log(`[VALIDATE] Sq ft: panel-calc=${panelSqFt.toFixed(1)}, db=${dbSqFt}, using=${totalSqFt}`);

    // Determine the actual sideSize tier from real vehicle dimensions
    const validatedSideSize = realSideWidth < 144 ? "small"
      : realSideWidth < 172 ? "medium"
      : realSideWidth < 200 ? "large" : "xl";
    console.log(`[VALIDATE] Validated sideSize: "${validatedSideSize}" (body length ${realSideWidth}")`);

    // dims_verified: true if dimensions came from verified DB, CSV, Google Search,
    // or the trailer/box path (derived from the customer's STATED length).
    // "fallback" (generic category defaults) are NOT reliable for production print.
    const dimsVerified = vehicle.source === "csv" || vehicle.source === "google_search" || vehicle.source === "trailer";

    if (!dimsVerified) {
      console.warn(`[VALIDATE] ⚠️ UNVERIFIED DIMS for ${vehicleMake} ${vehicleModel} — source="${vehicle.source}", category="${vehicle.category}". DO NOT PRINT without manual verification.`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sideSize: validatedSideSize,
        dims_verified: dimsVerified,
        vehicle: {
          make: vehicleMake,
          model: vehicleModel,
          ...vehicle,
        },
        sizeValidation,
        panels,
        totalPanels: panels.length,
        totalSqFt,
        panelSqFt: Math.round(panelSqFt * 10) / 10,
        dbSqFt,
        rollWidth: ROLL_WIDTH_INCHES,
        maxPrintableHeight: MAX_PRINTABLE_HEIGHT,
        twoPanel,
        step: "validate",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[VALIDATE] Error:", err);
    return new Response(
      JSON.stringify({ error: `Validate step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// Build vehicle-specific addon panel specs from the vehicle dimensions database.
function getVehicleAddonSpecs(vehicle: VehicleDimensions) {
  const hoodWidth = vehicle.hoodWidthInches || 56;
  const hoodLength = vehicle.hoodLengthInches || 36;
  const roofLength = vehicle.roofLengthInches || 66;
  const roofWidth = vehicle.roofWidthInches || 44;
  const backWidth = vehicle.backWidthInches || 66;
  const backHeight = vehicle.backHeightInches || 42;

  // Bumper: spans full front/rear width, height by category
  const bumperHeightByCategory: Record<string, number> = {
    compact: 24, midsize: 27, fullsize: 30, suv: 32, truck: 34, van: 30,
  };
  const bumperHeight = bumperHeightByCategory[vehicle.category] || 30;
  const bumperWidth = Math.round(hoodWidth * 1.8) || 111;

  console.log(`[VALIDATE] Addon specs: hood ${hoodWidth}"×${hoodLength}", roof ${roofWidth}"×${roofLength}", back ${backWidth}"×${backHeight}"`);

  // WIDTH THEN LENGTH, ON EVERY SURFACE. The roof was the ONE entry in this
  // object that read `roofLength` as its width — hood directly above it uses
  // `hoodWidth, hoodLength`, and every consumer downstream reads the roof the
  // same width-then-length way:
  //   panel-pro-extract  dimsForView       → roofWidthInches, roofLengthInches
  //   run-production-flow getVehiclePanelDims → roofWidthInches, roofLengthInches
  // So GENIE stamped the roof transposed against the dimensions every reader
  // then used. Owner ruling 2026-08-01: width and length, matching everywhere
  // else.
  return {
    hood: { widthInches: hoodWidth, heightInches: hoodLength, label: "Hood" },
    rear: { widthInches: backWidth, heightInches: backHeight, label: "Rear" },
    frontBumper: { widthInches: bumperWidth, heightInches: bumperHeight, label: "Front Bumper" },
    rearBumper: { widthInches: bumperWidth, heightInches: bumperHeight, label: "Rear Bumper" },
    roof: { widthInches: roofWidth, heightInches: roofLength, label: "Roof" },
  };
}

function buildPlan(
  panelKey: string,
  panelType: "side" | "addon" | "roof",
  spec: { widthInches: number; heightInches: number; label: string },
  mirrored: boolean,
  cropZone?: "upper" | "lower",
): PanelPlan {
  // Enforce roll-width fit: the shorter dimension + bleed must fit on 59.5" roll.
  // If both dimensions exceed MAX_PRINTABLE_HEIGHT, cap the height.
  let w = spec.widthInches;
  let h = spec.heightInches;
  const minDim = Math.min(w, h);
  if (minDim + BLEED_INCHES * 2 > ROLL_WIDTH_INCHES) {
    // Both dims too big for roll — cap height to MAX_PRINTABLE_HEIGHT
    if (h > MAX_PRINTABLE_HEIGHT) {
      console.log(`[VALIDATE] ${spec.label}: height ${h}" exceeds roll limit ${MAX_PRINTABLE_HEIGHT}" — capping`);
      h = MAX_PRINTABLE_HEIGHT;
    }
    if (w > MAX_PRINTABLE_HEIGHT && w <= h) {
      console.log(`[VALIDATE] ${spec.label}: width ${w}" exceeds roll limit — capping`);
      w = MAX_PRINTABLE_HEIGHT;
    }
  }
  // Single dimension check: if height + bleed > roll, orient so shorter side = height
  if (h + BLEED_INCHES * 2 > ROLL_WIDTH_INCHES && w + BLEED_INCHES * 2 <= ROLL_WIDTH_INCHES) {
    console.log(`[VALIDATE] ${spec.label}: rotating ${w}"×${h}" → ${h}"×${w}" to fit ${ROLL_WIDTH_INCHES}" roll`);
    [w, h] = [h, w];
  }

  const sqFt = Math.round((w * h) / 144 * 10) / 10;
  const wBleed = w + BLEED_INCHES * 2;
  const hBleed = h + BLEED_INCHES * 2;

  return {
    panelKey,
    panelType,
    label: spec.label,
    widthInches: w,
    heightInches: h,
    widthWithBleed: wBleed,
    heightWithBleed: hBleed,
    widthPx: inchesToPx(wBleed),
    heightPx: inchesToPx(hBleed),
    mirrored,
    sqFt,
    ...(cropZone ? { cropZone } : {}),
  };
}
