"use strict";

const { createHash } = require("node:crypto");

/**
 * Standalone extraction of the DP-owned universal vehicle lookup.
 * The upstream resolver's panel values are estimates. This extraction may
 * create a grounded candidate, but it never promotes estimates into print
 * geometry. Production callers receive only a separately validated exact six-
 * surface manifest. The A.T.L.A.S. Calls 1-7 preview has a separate resolver
 * which may use cited, deterministic provisional rectangles for layout only.
 */

const { createProvider, ProviderError } = require("./generation-provider.cjs");

const ALLOWED_CLASSES = new Set(["car", "truck", "suv", "van", "motorcycle", "boat", "bus", "rv", "trailer", "aircraft", "heavy_equipment"]);
const SURFACES = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const SANITY_RANGES = Object.freeze({
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
});
const PROOF_GEOMETRY_CONTRACT = "designpro.genie-proof-geometry-authority.v1";
const PROVISIONAL_ESTIMATOR_CONTRACT = "designpro.genie-provisional-atlas-geometry.v1";
const FLAT_ATLAS_PREVIEW_CLASSES = new Set(["car", "truck", "suv", "van"]);

class UniversalDimensionError extends Error {
  constructor(code, message, retryable = false, stageHandled = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.stageHandled = stageHandled;
  }
}

function normalizedVehicle(vehicle) {
  const declaredVehicleClass = String(vehicle.type || vehicle.vehicleClass || "").trim().toLowerCase().replace(/[ -]+/g, "_");
  const make = String(vehicle.make || "").trim();
  const model = String(vehicle.model || "").trim();
  const year = String(vehicle.year || "").trim();
  if (!ALLOWED_CLASSES.has(declaredVehicleClass) || !make || !model || !/^\d{4}$/.test(year)) {
    throw new UniversalDimensionError("genie_vehicle_identity_invalid", "Universal GENIE requires class, four-digit year, make and model");
  }
  // F-Series pickup identity is unambiguous even when an older saved form has
  // retained its historical default of `car`. Resolve that known identity
  // before cache lookup, grounding, topology and proof prompts. This is not a
  // dimensional guess: it only corrects the body class for Ford's named pickup
  // line, and the original declaration remains on the audit metadata below.
  const vehicleClass = /^ford$/i.test(make)
    && /\bf[\s-]?(?:150|250|350|450|550)\b/i.test(model)
    ? "truck"
    : declaredVehicleClass;
  return {
    vehicleClass,
    declaredVehicleClass,
    vehicleClassCorrected: vehicleClass !== declaredVehicleClass,
    make,
    model,
    year,
  };
}

function assertGroundedCandidate(candidate, vehicleClass) {
  const groundedVehicleClass = String(candidate.vehicle_class || "").trim().toLowerCase().replace(/[ -]+/g, "_");
  if (groundedVehicleClass && groundedVehicleClass !== vehicleClass) {
    throw new UniversalDimensionError(
      "genie_vehicle_class_mismatch",
      `Grounded vehicle class ${groundedVehicleClass} does not match resolved class ${vehicleClass}`,
    );
  }
  const ranges = SANITY_RANGES[vehicleClass];
  const dimensions = {
    overall_length_in: Number(candidate.overall_length_in),
    overall_width_in: Number(candidate.overall_width_in),
    overall_height_in: Number(candidate.overall_height_in),
    wheelbase_in: candidate.wheelbase_in == null ? null : Number(candidate.wheelbase_in),
  };
  for (const [key, rangeKey] of [["overall_length_in", "length"], ["overall_width_in", "width"], ["overall_height_in", "height"]]) {
    const value = dimensions[key]; const [minimum, maximum] = ranges[rangeKey];
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new UniversalDimensionError("genie_grounding_sanity_failed", `${key} ${value} is outside ${vehicleClass} range ${minimum}-${maximum}`);
    }
  }
  const sourceUrls = Array.isArray(candidate.source_urls) ? [...new Set(candidate.source_urls.filter((value) => /^https:\/\//.test(String(value))))] : [];
  if (!sourceUrls.length) throw new UniversalDimensionError("genie_grounding_sources_missing", "Grounded vehicle candidate has no HTTPS source citations");
  return {
    dimensions,
    sourceUrls,
    confidence: ["high", "medium", "low"].includes(candidate.confidence) ? candidate.confidence : "low",
    subType: String(candidate.sub_type || "").trim() || null,
    resolvedVehicleClass: vehicleClass,
  };
}

/**
 * THE GENIE PANELIZER CATALOG IS THE SIZE AUTHORITY. (Trish 2026-08-27)
 *
 * `vehicle_dimensions` is the measured GENIE catalog -- 1781 rows migrated from
 * the predecessor project, the same sheet the shop has always cut from. Until
 * 2026-08-27 nothing in the A.T.L.A.S. path read it: the catalog was empty on
 * this project, and `resolveFlatAtlasPreviewDimensions` fell through to
 * `provisionalDimensionsFromCandidate`, which scales a grounded bounding box by
 * hardcoded per-class constants.
 *
 * The cost, measured on the owner's own vehicle: GENIE has the F-250 Super Duty
 * Crew Cab at a 251x60 side. The estimator produced 153x56 -- ninety-eight
 * inches short. Every container in the flattened master was therefore its
 * CLASS's average, never that truck's. "None of them are the right size."
 *
 * So the catalog is consulted FIRST, and the estimator is what happens only
 * when the catalog has never seen the vehicle.
 */
const GENIE_CATALOG_TABLE = "vehicle_dimensions";

/**
 * FRONT IS DERIVED, AND IT SAYS SO. (Trish 2026-08-27)
 *
 * The 1,781-row catalog measures four surfaces -- side, back, hood, roof --
 * and carries NO front column at all. So `front` can never be measured today,
 * and the honest thing is to name the derivation rather than let a class
 * constant masquerade as a measurement. Every derived front records this
 * contract, the exact catalog fields it came from, and their values.
 *
 * The exception is meant to disappear: populate real front_width/front_height
 * in GENIE and `front` becomes `measured` like the other five, with no code
 * change beyond deleting the derivation branch.
 */
const FRONT_DERIVATION_CONTRACT = "designpro.genie-front-derived.v1";

/**
 * FOUR CORRUPT ROWS PASS THE YEAR FILTER AND WOULD MATCH ANYTHING.
 *
 * Live, 2026-08-27: four Ford rows carry an entire TSV line in `model` --
 * `"F150 SuperCrew 5'5 box\t2018-2020\t227.1\t57.0\t..."` -- with every
 * dimension column NULL and both year columns NULL. Null years passed the year
 * filter (it treated "no years" as "covers every year"), so a 2024 lookup drew
 * them into the candidate pool, where only the completeness filter happened to
 * drop them.
 *
 * A row that cannot state which vehicle or which years it measures is not a
 * weaker match; it is not a row. Quarantine is applied BEFORE matching so it
 * cannot be reached by a tie-break.
 */
function catalogRowIsIntact(row) {
  const model = String(row?.model || "");
  if (!model.trim()) return false;
  // Embedded tabs mean the spreadsheet column split failed and the whole line
  // landed in one field.
  if (/[\t\n\r]/.test(model)) return false;
  const start = Number(row?.year_start);
  const end = Number(row?.year_end);
  // A year range is mandatory: it is the only thing that stops a 2017-2020
  // record answering for a 2024 vehicle.
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (start < 1950 || end > 2100 || end < start) return false;
  // Sane numeric ranges on the four measured surfaces. A vehicle surface is
  // between a foot and forty feet on its long edge.
  for (const [a, b] of [
    [row.side_width, row.side_height], [row.back_width, row.back_height],
    [row.hood_width, row.hood_length], [row.roof_width, row.roof_length],
  ]) {
    const first = Number(a);
    const second = Number(b);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return false;
    if (first <= 6 || second <= 6 || first > 480 || second > 480) return false;
  }
  return true;
}

function normalizeModelTokens(value) {
  const words = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 0);
  // "F250" AND "F-250" MUST PRODUCE THE SAME SIGNAL.
  //
  // The customer types `F250 Crew Cab`; the catalog says
  // `F-250, 350, 450, 550 - Super Duty - Crew Cab Long Box`. Split on
  // punctuation alone, those are `f250` versus `f` + `250`, so the model NUMBER
  // -- the strongest identifier in the whole string -- contributed nothing and
  // the row scored 2 on `crew` + `cab` alone. `F-650 Crew Cab / Cab Only`
  // scored exactly the same 2, which is how a medium-duty cab-only row came to
  // tie a Super Duty pickup. Emitting the letter/digit split alongside the
  // joined form makes `250` a shared token, so the F-250 row scores 3 and the
  // F-650 stays at 2.
  const tokens = new Set();
  for (const word of words) {
    tokens.add(word);
    const parts = word.match(/[a-z]+|[0-9]+/g);
    if (parts && parts.length > 1) for (const part of parts) tokens.add(part);
  }
  return [...tokens];
}

/**
 * Catalog model strings are shop language -- "F-250, 350, 450, 550 - Super Duty
 * - Crew Cab Long Box" -- and customers type "F250 Crew Cab". Score by how much
 * of what the CUSTOMER said the catalog row accounts for, so a row that covers
 * more of their words wins, and ties go to the least specific row rather than
 * an arbitrary one.
 */
function scoreCatalogRow(row, modelTokens) {
  const rowTokens = new Set(normalizeModelTokens(row.model));
  let score = 0;
  for (const token of modelTokens) if (rowTokens.has(token)) score += 1;
  return score;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * A panel is stated long-edge first. Some catalog rows carry the side
 * transposed (49x172 where the neighbouring row says 175x48), and a flank
 * container built from the transposed pair is a portrait rectangle on a vehicle
 * that is obviously landscape. Order by magnitude rather than trusting the
 * column name, for the two surfaces where the distinction is unambiguous.
 */
function landscape(a, b) {
  const first = positiveNumber(a);
  const second = positiveNumber(b);
  if (!first || !second) return null;
  return { widthInches: Math.max(first, second), heightInches: Math.min(first, second) };
}

function surfacesFromGenieCatalog(row, vehicleClass) {
  const side = landscape(row.side_width, row.side_height);
  const rear = landscape(row.back_width, row.back_height);
  const hood = landscape(row.hood_width, row.hood_length);
  const roof = landscape(row.roof_width, row.roof_length);
  if (!side || !rear || !hood || !roof) return null;

  // GENIE measures four surfaces, because those are the four a shop cuts from
  // the sheet. PASSENGER is the driver flank mirrored -- identical geometry by
  // construction, which is exactly what the deterministic mirror already
  // assumes. FRONT is the one surface the catalog does not carry, so it is
  // derived from the measured rear width and hood depth and LABELLED derived;
  // it is never presented as a measured value.
  const frontHeight = Math.max(12, Math.round(hood.heightInches * 0.75 * 10) / 10);
  const front = { widthInches: rear.widthInches, heightInches: frontHeight };
  // The derivation, stated so a reader can reproduce it from the row.
  const frontDerivation = {
    contract: FRONT_DERIVATION_CONTRACT,
    authority: "derived",
    surfaceKey: "front",
    derivedFrom: {
      backWidthIn: rear.widthInches,
      hoodDepthIn: hood.heightInches,
      catalogRowId: row.id || null,
    },
    rule: "widthInches = back long edge; heightInches = max(12, hood short edge x 0.75)",
    trimWidthIn: front.widthInches,
    trimHeightIn: front.heightInches,
    operatorValidated: false,
  };
  // A derivation that cannot produce a physically valid front is a failure, not
  // a smaller number: fail closed and let an operator state the dimension.
  if (!(front.widthInches > 12 && front.heightInches > 12
    && front.widthInches <= 200 && front.heightInches <= 200)) return null;
  return {
    surfaces: {
      driver: side,
      passenger: side,
      hood,
      roof,
      front,
      rear,
    },
    derivedSurfaces: ["front"],
    frontDerivation,
    mirroredSurfaces: ["passenger"],
    totalSqft: positiveNumber(row.total_sqft),
    vehicleClass,
  };
}

async function findGenieCatalogSurfaces(sb, vehicle) {
  const modelTokens = normalizeModelTokens(vehicle.model);
  if (!modelTokens.length) return null;
  const year = Number(vehicle.year);
  let query = sb.from(GENIE_CATALOG_TABLE).select("*").ilike("make", vehicle.make).limit(400);
  const { data: rows, error } = await query;
  // The catalog is a convenience over the estimator, never a gate: a lookup
  // failure must not take down an authoring run that could still proceed.
  if (error || !Array.isArray(rows) || !rows.length) return null;

  // QUARANTINE FIRST. A malformed row may not participate in matching at all.
  const intact = rows.filter(catalogRowIsIntact);
  if (!intact.length) return null;

  // YEAR IS MANDATORY, AND A MISS IS A MISS. (Trish 2026-08-27)
  //
  // This used to treat an unparseable year as "covers every year", and the
  // caller below fell back to the WHOLE make when nothing matched the year --
  // so a 2024 F-250 was one scoring point away from being cut to a 2017-2020
  // record. A record that does not cover the customer's year is not a weaker
  // match for that vehicle; it is a different vehicle.
  if (!Number.isFinite(year)) return null;
  const inYear = intact.filter((row) => (
    year >= Number(row.year_start) && year <= Number(row.year_end)
  ));
  // A ROW MISSING THREE OF ITS FOUR MEASURED SURFACES IS NOT A WEAKER MATCH --
  // IT IS NOT A MATCH.
  //
  // `surfacesFromGenieCatalog` needs side, rear, hood and roof; a row without
  // them returns null, and that null was indistinguishable from "the catalog has
  // never seen this vehicle", so the whole lookup fell through to the grounded
  // estimator in silence. Live: canary 7323fd73 (2026-08-27) resolved
  // `gemini_grounded` for a 2009 Ford F250 Crew Cab that GENIE measures at
  // 251x60, because the tie-break below preferred the SHORTEST model string and
  // `F-650 Crew Cab / Cab Only` (25 chars, back/hood/roof all NULL) beat
  // `F-250, 350, 450, 550 - Super Duty - Crew Cab Long Box` (53 chars).
  //
  // Completeness is therefore a filter, applied before scoring, not something a
  // tie-break can lose.
  // ...and never widen back to the whole make. `inYear` only, or nothing.
  const measured = inYear.filter((row) => (
    landscape(row.side_width, row.side_height)
    && landscape(row.back_width, row.back_height)
    && landscape(row.hood_width, row.hood_length)
    && landscape(row.roof_width, row.roof_length)
  ));
  if (!measured.length) return null;
  const pool = measured;

  let best = null;
  let bestScore = 0;
  for (const row of pool) {
    const score = scoreCatalogRow(row, modelTokens);
    if (score < bestScore) continue;
    if (score > bestScore
      || (best && String(row.model || "").length < String(best.model || "").length)) {
      best = row;
      bestScore = score;
    }
  }
  // One shared token is coincidence ("van", "4 door"). Require either most of
  // what the customer typed, or two independent tokens.
  const required = Math.min(2, modelTokens.length);
  if (!best || bestScore < required) return null;

  const mapped = surfacesFromGenieCatalog(best, vehicle.vehicleClass);
  if (!mapped) return null;
  return { row: best, ...mapped, matchedTokens: bestScore, modelTokenCount: modelTokens.length };
  // NOTE: five surfaces here are `measured` and `front` is `derived`; the split
  // is carried on the manifest by `derivedSurfaces` + `frontDerivation`.
}

function catalogDimensionRow(match, vehicle) {
  const s = match.surfaces;
  return {
    id: match.row.id,
    make: match.row.make,
    model: match.row.model,
    side_width: s.driver.widthInches,
    side_height: s.driver.heightInches,
    passenger_width: s.passenger.widthInches,
    passenger_height: s.passenger.heightInches,
    hood_width: s.hood.widthInches,
    hood_length: s.hood.heightInches,
    roof_width: s.roof.widthInches,
    roof_length: s.roof.heightInches,
    front_width: s.front.widthInches,
    front_height: s.front.heightInches,
    rear_width: s.rear.widthInches,
    rear_height: s.rear.heightInches,
    proofGeometryAuthority: {
      contract: PROOF_GEOMETRY_CONTRACT,
      status: "genie-catalog",
      purpose: "calls-1-7-layout-only",
      candidateId: match.row.id,
      source: "genie-panelizer-catalog",
      sourceUrls: [],
      confidence: "high",
      operatorValidated: false,
      // Layout geometry, exactly like every other authority this file emits.
      // It was OMITTED, and normalizedGeometryAuthority reads
      // `productionEligible !== false` -- so `undefined` threw
      // flat_atlas_geometry_authority_invalid the moment the catalog matched.
      productionEligible: false,
      catalogModel: match.row.model,
      catalogYearRange: match.row.year_range || null,
      catalogTotalSqft: match.totalSqft,
      matchedModelTokens: `${match.matchedTokens}/${match.modelTokenCount}`,
      derivedSurfaces: match.derivedSurfaces,
      mirroredSurfaces: match.mirroredSurfaces,
    },
  };
}

/**
 * ONE IMMUTABLE MANIFEST IDENTITY, BOUND TO EVERY CONSUMER. (Trish 2026-08-27)
 *
 * "The exact same immutable GENIE manifest must drive ATLAS container geometry
 * -> master QC -> six deterministic panel crops -> 3D proof surface authority
 * -> PanelPro -> RevisionStudioIQ -> ProductionFlow."
 *
 * The hash is taken over the six resolved surfaces plus the authority state, so
 * two runs that resolved the same vehicle the same way share an id, and any
 * change of dimension, source row or authority produces a different one. It is
 * computed here, at the single resolver, because a manifest identity minted
 * downstream would be an identity for the copy rather than the source.
 */
function stampGeometryResolution(row, resolution) {
  const surfaces = {};
  for (const surfaceKey of SURFACES) {
    surfaces[surfaceKey] = expectedSurfacesFromRow(row)?.[surfaceKey] || null;
  }
  const material = JSON.stringify({
    contract: "designpro.genie-manifest.v1",
    state: resolution.state,
    sourceRowId: resolution.geometrySourceRowId || null,
    derivationContract: resolution.derivationContract || null,
    surfaces,
  });
  const genieManifestHash = createHash("sha256").update(material, "utf8").digest("hex");
  row.geometryResolution = {
    contract: "designpro.genie-manifest.v1",
    genieManifestId: genieManifestHash.slice(0, 32),
    genieManifestHash,
    ...resolution,
  };
  return row;
}

function validatedSurfaces(row) {
  if (row.requires_validation !== false || !row.validated_by || !row.validated_at) return null;
  const manifest = row.validated_surfaces;
  if (!manifest || manifest.contractVersion !== "designpro.genie-validated-surfaces.v1"
    || !manifest.surfaces || typeof manifest.surfaces !== "object" || Array.isArray(manifest.surfaces)) return null;
  const parsed = {};
  for (const surfaceKey of SURFACES) {
    const widthInches = Number(manifest.surfaces[surfaceKey]?.widthInches);
    const heightInches = Number(manifest.surfaces[surfaceKey]?.heightInches);
    if (!(widthInches > 0 && heightInches > 0)) return null;
    parsed[surfaceKey] = { widthInches, heightInches };
  }
  return {
    id: row.id, make: row.make, model: row.model,
    side_width: parsed.driver.widthInches, side_height: parsed.driver.heightInches,
    passenger_width: parsed.passenger.widthInches, passenger_height: parsed.passenger.heightInches,
    hood_width: parsed.hood.widthInches, hood_length: parsed.hood.heightInches,
    roof_width: parsed.roof.widthInches, roof_length: parsed.roof.heightInches,
    front_width: parsed.front.widthInches, front_height: parsed.front.heightInches,
    rear_width: parsed.rear.widthInches, rear_height: parsed.rear.heightInches,
    universalValidation: { validatorId: row.validated_by, validatedAt: row.validated_at, sourceUrls: row.source_urls || [], candidateId: row.id },
    proofGeometryAuthority: {
      contract: PROOF_GEOMETRY_CONTRACT,
      status: "validated",
      purpose: "calls-1-7-layout-only",
      candidateId: row.id,
      candidateHash: row.candidate_hash || null,
      source: row.source || "operator-validated",
      sourceUrls: row.source_urls || [],
      confidence: row.confidence || "high",
      operatorValidated: true,
      validatedBy: row.validated_by,
      validatedAt: row.validated_at,
      productionEligible: false,
    },
  };
}

function roundDimension(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Deterministic proof-layout rectangles derived only from cited exterior
 * dimensions. They establish A.T.L.A.S. proportions; they are never exact
 * panel geometry and are never eligible for Calls 8+ or print output.
 */
function provisionalDimensionsFromCandidate(row, vehicleClass) {
  if (!FLAT_ATLAS_PREVIEW_CLASSES.has(vehicleClass)) {
    throw new UniversalDimensionError(
      "genie_flat_atlas_topology_unsupported",
      `A.T.L.A.S. rectangular vehicle topology does not support ${vehicleClass}`,
    );
  }
  const candidate = assertGroundedCandidate({
    overall_length_in: row.overall_length_in,
    overall_width_in: row.overall_width_in,
    overall_height_in: row.overall_height_in,
    wheelbase_in: row.wheelbase_in,
    source_urls: row.source_urls,
    confidence: row.confidence,
    sub_type: row.sub_type,
  }, vehicleClass);
  const length = candidate.dimensions.overall_length_in;
  const width = candidate.dimensions.overall_width_in;
  const height = candidate.dimensions.overall_height_in;
  const wheelbase = candidate.dimensions.wheelbase_in;

  // The side is nearly the whole body; the remaining rectangles follow the
  // long-standing GENIE proof estimator. Bounds avoid degenerate shapes while
  // preserving the grounded vehicle's proportions.
  const sideHeightFactor = { car: 0.76, truck: 0.72, suv: 0.78, van: 0.82 }[vehicleClass];
  const roofLengthFactor = { car: 0.6, truck: 0.45, suv: 0.55, van: 0.5 }[vehicleClass];
  const frontHeight = { car: 27, truck: 34, suv: 32, van: 30 }[vehicleClass];
  const sideWidth = clamp(length - 9, length * 0.82, length * 0.97);
  const sideHeight = clamp(height * sideHeightFactor, height * 0.62, height * 0.9);
  const hoodWidth = width * 0.85;
  const estimatedOverhang = wheelbase && length > wheelbase
    ? (length - wheelbase) * 0.55
    : length * 0.19;
  const hoodLength = clamp(estimatedOverhang, length * 0.12, length * 0.28);
  const roofWidth = width * 0.8;
  const roofLength = clamp((wheelbase || length * 0.58) * roofLengthFactor, length * 0.25, length * 0.58);
  const faceWidth = width * 0.85;
  const faceHeight = height * 0.45;

  return {
    id: row.id,
    make: row.make,
    model: row.model,
    side_width: roundDimension(sideWidth),
    side_height: roundDimension(sideHeight),
    passenger_width: roundDimension(sideWidth),
    passenger_height: roundDimension(sideHeight),
    hood_width: roundDimension(hoodWidth),
    hood_length: roundDimension(hoodLength),
    roof_width: roundDimension(roofWidth),
    roof_length: roundDimension(roofLength),
    // Front bumper vinyl is an unfolded envelope and is intentionally wider
    // than the straight-on rear face rectangle.
    front_width: roundDimension(hoodWidth * 1.8),
    front_height: roundDimension(frontHeight),
    rear_width: roundDimension(faceWidth),
    rear_height: roundDimension(faceHeight),
    proofGeometryAuthority: {
      contract: PROOF_GEOMETRY_CONTRACT,
      status: "provisional",
      purpose: "calls-1-7-layout-only",
      candidateId: row.id,
      candidateHash: row.candidate_hash || null,
      source: row.source || "gemini_grounded",
      sourceUrls: candidate.sourceUrls,
      confidence: candidate.confidence,
      estimatorContract: PROVISIONAL_ESTIMATOR_CONTRACT,
      operatorValidated: false,
      validatedBy: null,
      validatedAt: null,
      productionEligible: false,
    },
  };
}

/**
 * Extract one complete JSON object without the old greedy `{...}` match. The
 * scanner respects quoted braces and escapes, accepts ordinary fenced output,
 * and refuses multiple independently valid objects instead of silently picking
 * one trim/bed alternative.
 */
function parseGroundedJson(text, raw = {}) {
  const source = String(text || "").trim();
  if (source) {
    try {
      const direct = JSON.parse(source);
      if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
    } catch {
      // Fenced/prose-wrapped JSON is handled by the balanced scanner below.
    }
  }

  const slices = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let sawObjectStart = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"' && depth > 0) {
      inString = true;
      continue;
    }
    if (character === "{") {
      sawObjectStart = true;
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        slices.push(source.slice(start, index + 1));
        start = -1;
      }
    }
  }

  const objects = [];
  for (const slice of slices) {
    try {
      const value = JSON.parse(slice);
      if (value && typeof value === "object" && !Array.isArray(value)) objects.push(value);
    } catch {
      // Invalid balanced candidates are reported below; never repair them.
    }
  }
  if (objects.length === 1) return objects[0];
  if (objects.length > 1) {
    throw new UniversalDimensionError(
      "genie_grounding_ambiguous",
      `Grounding returned ${objects.length} vehicle candidates; one exact OEM configuration is required`,
    );
  }

  const candidate = raw?.candidates?.[0];
  const finish = String(candidate?.finishReason || raw?.promptFeedback?.blockReason || "none");
  const excerpt = source.slice(0, 160).replace(/\s+/g, " ");
  throw new UniversalDimensionError(
    "genie_grounding_parse_failed",
    `Grounding response ${sawObjectStart ? "contained invalid JSON" : "contained no JSON candidate"} (finishReason=${finish}, textLength=${source.length}${excerpt ? `, excerpt=${JSON.stringify(excerpt)}` : ""})`,
    true,
  );
}

function groundingPrompt(vehicle, strictRetry = false) {
  // A parse retry, a sanity retry and an ambiguity retry ask for different
  // corrections, so the second attempt names the actual defect instead of a
  // generic "try again".
  //
  // The ambiguity tail is NOT the parse tail. "Your prior answer could not be
  // parsed" is false here -- every object parsed perfectly, there were just
  // several of them -- and telling the model its JSON was malformed sends it
  // to fix the syntax it already got right. What it has to do instead is
  // CHOOSE, so the correction restates the selection rule the base prompt
  // already carries and names how many alternatives came back.
  const retryInstruction = strictRetry && typeof strictRetry === "object" && strictRetry.ambiguous
    ? ` Your prior answer was rejected: ${strictRetry.ambiguous} Choose the single standard single-rear-wheel short-bed configuration, name that exact configuration in sub_type, and return exactly ONE complete JSON object, with no Markdown fence, prose, comments, trailing text, or alternative objects.`
    : typeof strictRetry === "string"
    ? ` Your prior answer was rejected: ${strictRetry} Re-check the manufacturer specification and return corrected values; report body dimensions excluding mirrors.`
    : strictRetry
      ? " Your prior answer could not be parsed. Return exactly ONE complete JSON object, with no Markdown fence, prose, comments, trailing text, or alternative objects."
      : "";
  return `Find exact OEM exterior dimensions for ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.vehicleClass}). Use primary manufacturer spec pages or official PDFs. Where the named cab has multiple bed lengths, use the standard single-rear-wheel short-bed configuration and name that exact configuration in sub_type; never return alternative objects. overall_width_in is the vehicle BODY width EXCLUDING side mirrors -- manufacturers publish both, and the with-mirrors figure is wrong here because these dimensions size wrap panels for the painted body. Return JSON only: {"vehicle_class":"${vehicle.vehicleClass}","overall_length_in":number,"overall_width_in":number,"overall_height_in":number,"wheelbase_in":number|null,"sub_type":string|null,"confidence":"high|medium|low","source_urls":["https://..."]}. This is a candidate for human validation; do not invent missing values.${retryInstruction}`;
}

async function groundedCandidate(vehicle, provider) {
  let transport = provider;
  if (!transport) {
    try { transport = createProvider({}); }
    catch (error) {
      if (error instanceof ProviderError && error.code === "provider_key_missing") {
        throw new UniversalDimensionError("genie_grounding_key_missing", "Universal GENIE grounding key is not configured");
      }
      throw error;
    }
  }
  if (typeof transport.generateRaw !== "function") {
    throw new UniversalDimensionError("genie_grounding_provider_invalid", "Universal GENIE requires the server generation provider", true);
  }

  let lastParseError = null;
  let strictInstruction = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let rawResult;
    try {
      rawResult = await transport.generateRaw({
        model: "gemini-2.5-flash",
        body: {
          contents: [{ parts: [{ text: groundingPrompt(vehicle, strictInstruction || attempt === 1) }] }],
          tools: [{ googleSearch: {} }],
          // Do not add responseMimeType here: the deployed model combines
          // Gemini 2.5 Flash with Google Search, while structured output plus
          // built-in tools is a Gemini 3 contract. Parsing remains fail-closed.
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
        },
        timeoutMs: 45_000,
        label: `GENIE grounding attempt ${attempt + 1}`,
      });
    } catch (error) {
      if (error instanceof ProviderError) {
        throw new UniversalDimensionError("genie_grounding_failed", error.message, error.retryable !== false);
      }
      throw error;
    }

    const raw = rawResult.payload;
    const candidate = raw?.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text || "").join("") || "";
    let parsed;
    try {
      parsed = parseGroundedJson(text, raw);
    } catch (error) {
      // AN AMBIGUOUS ANSWER EARNS ONE CORRECTIVE RE-ASK, EXACTLY LIKE A PARSE
      // FAILURE AND A SANITY FAILURE. (2026-08-31)
      //
      // The first real owner DCA on release 37c48076 (GenerationID
      // e4c16289-a972-4aca-9a37-98429d1745c5, 20:09:20Z) died 25 seconds in,
      // before Call 1, with `genie_grounding_ambiguous: Grounding returned 3
      // vehicle candidates`. A 2022 Ford F-150 has three published box lengths,
      // and the model answered with all three.
      //
      // The correction for that already existed and was unreachable. Both
      // sibling classes retry once, and `groundingPrompt`'s strict tail has
      // said "or alternative objects" since it was written -- authored for this
      // exact defect, and no code path could ever reach it, because the catch
      // below only ever matched `genie_grounding_parse_failed`. So the one
      // grounding error whose remedy is spelled out verbatim in the prompt was
      // the one that got no second question.
      //
      // This is the same one-noise-event-kills-the-run shape the sanity retry
      // was added for, and the same remedy: ask once more, name what was
      // rejected, fail closed on a second offence. `parseGroundedJson` is NOT
      // relaxed -- it still refuses multiple alternatives outright, and the
      // lock on that refusal stands untouched. Nothing here widens a
      // threshold, picks a candidate on the model's behalf, or invents
      // geometry; a second multi-object answer still ends the run.
      const earnsReAsk = error?.code === "genie_grounding_parse_failed"
        || error?.code === "genie_grounding_ambiguous";
      if (!earnsReAsk) throw error;
      if (attempt === 1) {
        throw new UniversalDimensionError(
          error.code,
          `${error.message}; two bounded grounding attempts were exhausted`,
          // Ambiguity stays non-retryable at the caller, exactly as before:
          // re-running the whole request is not what fixes a model that keeps
          // offering alternatives. Parse failure keeps its retryable flag.
          error.code === "genie_grounding_parse_failed",
        );
      }
      if (error.code === "genie_grounding_ambiguous") {
        strictInstruction = { ambiguous: error.message };
        continue;
      }
      lastParseError = error;
      continue;
    }
    const groundingUrls = candidate?.groundingMetadata?.groundingChunks
      ?.map((chunk) => chunk.web?.uri).filter(Boolean) || [];
    parsed.source_urls = [...(Array.isArray(parsed.source_urls) ? parsed.source_urls : []), ...groundingUrls];
    // A SANITY FAILURE EARNS ONE CORRECTIVE RE-ASK, EXACTLY LIKE A PARSE
    // FAILURE. The first live acceptance run died here in one shot: Gemini
    // reported the Ford Transit's real published 97.4" WITH-MIRRORS width,
    // the van range (65-90) rightly refused it, and the run was killed with
    // no second question -- the same one-noise-event-kills-the-run shape as
    // convicting a proof because its judge returned 503. The range is not
    // widened: the retry tells the model exactly what was rejected and why,
    // and a second out-of-range answer still fails closed.
    try {
      return { ...assertGroundedCandidate(parsed, vehicle.vehicleClass), raw };
    } catch (error) {
      if (error?.code !== "genie_grounding_sanity_failed") throw error;
      if (attempt === 1) {
        throw new UniversalDimensionError(
          error.code, `${error.message}; two bounded grounding attempts were exhausted`,
        );
      }
      strictInstruction = `${error.message}.`;
      continue;
    }
  }
  throw lastParseError
    || new UniversalDimensionError("genie_grounding_parse_failed", "Grounding response JSON was invalid", true);
}

async function queueValidationRequest(sb, stage, runId, candidateId) {
  // Calls 1-7 (including A.T.L.A.S.) can resolve geometry before a production
  // workflow stage exists. In that context there is nothing legitimate to
  // lease or auto-resume, so report validation-required without dereferencing
  // a fabricated stage. Production callers still park their real stage below.
  if (!stage?.id || !stage?.lease_token || !runId) return false;
  const { error } = await sb.rpc("request_designpro_universal_dimension_validation", {
    p_run_id: runId, p_candidate_id: candidateId, p_stage_id: stage.id, p_lease_token: stage.lease_token,
  });
  if (error) throw new UniversalDimensionError("genie_validation_request_failed", error.message, true);
  return true;
}

async function findCandidates(sb, vehicle) {
  return sb.from("designpro_vehicle_specs_universal").select("*")
    .eq("vehicle_class", vehicle.vehicleClass).ilike("make", vehicle.make).ilike("model", vehicle.model).eq("year", vehicle.year).limit(2);
}

function groundedInsertPayload(vehicle, candidate) {
  const provisional = provisionalDimensionsFromCandidate({
    id: null,
    make: vehicle.make,
    model: vehicle.model,
    overall_length_in: candidate.dimensions.overall_length_in,
    overall_width_in: candidate.dimensions.overall_width_in,
    overall_height_in: candidate.dimensions.overall_height_in,
    wheelbase_in: candidate.dimensions.wheelbase_in,
    source: "gemini_grounded",
    source_urls: candidate.sourceUrls,
    confidence: candidate.confidence,
    sub_type: candidate.subType,
  }, vehicle.vehicleClass);
  return {
    vehicle_class: vehicle.vehicleClass, make: vehicle.make, model: vehicle.model, year: vehicle.year,
    sub_type: candidate.subType, overall_length_in: candidate.dimensions.overall_length_in,
    overall_width_in: candidate.dimensions.overall_width_in, overall_height_in: candidate.dimensions.overall_height_in,
    wheelbase_in: candidate.dimensions.wheelbase_in, source: "gemini_grounded",
    source_urls: candidate.sourceUrls, confidence: candidate.confidence, requires_validation: true,
    panels: {
      contract: PROVISIONAL_ESTIMATOR_CONTRACT,
      status: "provisional",
      purpose: "calls-1-7-layout-only",
      inputs: {
        overallLengthInches: candidate.dimensions.overall_length_in,
        overallWidthInches: candidate.dimensions.overall_width_in,
        overallHeightInches: candidate.dimensions.overall_height_in,
        wheelbaseInches: candidate.dimensions.wheelbase_in,
      },
      surfaces: expectedSurfacesFromRow(provisional).map((surface) => ({
        surfaceKey: surface.surfaceKey,
        widthInches: surface.widthInches,
        heightInches: surface.heightInches,
        bleedInchesPerEdge: 5,
      })),
      productionEligible: false,
    },
    raw_response: candidate.raw,
  };
}

function attachVehicleClassResolution(dimensions, vehicle) {
  return {
    ...dimensions,
    resolvedVehicleClass: vehicle.vehicleClass,
    vehicleClassResolution: {
      declared: vehicle.declaredVehicleClass,
      resolved: vehicle.vehicleClass,
      corrected: vehicle.vehicleClassCorrected,
      authority: vehicle.vehicleClassCorrected ? "canonical-model-identity" : "request",
    },
  };
}

async function insertOrReadGroundedCandidate(sb, vehicle, candidate) {
  const { data: inserted, error: insertError } = await sb.from("designpro_vehicle_specs_universal")
    .insert(groundedInsertPayload(vehicle, candidate)).select("*").single();
  if (insertError?.code !== "23505") {
    if (insertError) throw new UniversalDimensionError("genie_universal_cache_insert_failed", insertError.message, true);
    return inserted;
  }
  const { data: racedRows, error: racedError } = await findCandidates(sb, vehicle);
  if (racedError || racedRows?.length !== 1) {
    throw new UniversalDimensionError("genie_universal_identity_ambiguous", racedError?.message || "Concurrent GENIE candidate identity is ambiguous", true);
  }
  return racedRows[0];
}

/**
 * Calls 1-7 only. A sane, cited Google-grounded candidate may establish the
 * proportions of the proof-only A.T.L.A.S. guide without operator work. This
 * function never queues production and never returns universalValidation for
 * provisional geometry.
 */
/**
 * THE CHEAP READ, FOR A FORM THE CUSTOMER IS STILL TYPING INTO.
 *
 * `resolveFlatAtlasPreviewDimensions` is not safe to call from a browser: on a
 * catalog miss it makes a Gemini grounding request AND inserts a candidate row.
 * Debounced keystrokes would turn that into a cost and abuse surface.
 *
 * This is the same resolution ORDER minus that last step -- measured catalog,
 * then an operator-validated row, then a cached candidate -- and it never
 * grounds and never writes. A miss returns `unresolved` with the near-miss rows
 * attached, which is what lets the UI say "which one is yours?" instead of
 * "we could not find your vehicle".
 *
 * The near misses matter because of a real gap: the catalog is keyed on
 * configuration strings ("F-250, 350, 450, 550 - Super Duty - Crew Cab Long
 * Box") and the request carries no config field, so a match depends on the
 * customer having typed "Crew Cab" into a free-text Model box. Offering them
 * the rows we do have turns that from a dead end into one click.
 */
async function previewGenieDimensionsFromCatalog(sb, rawVehicle) {
  const vehicle = normalizedVehicle(rawVehicle);
  const match = await findGenieCatalogSurfaces(sb, vehicle);
  if (match) {
    const row = stampGeometryResolution(
      attachVehicleClassResolution(catalogDimensionRow(match, vehicle), vehicle),
      {
        state: "derived",
        measuredSurfaces: ["driver", "passenger", "hood", "roof", "rear"],
        derivedSurfaces: match.derivedSurfaces || ["front"],
        derivationContract: FRONT_DERIVATION_CONTRACT,
        geometrySourceRowId: match.row?.id || null,
        catalogModel: match.row?.model || null,
        catalogYearRange: match.row?.year_range || null,
        productionEligible: true,
        operatorValidated: false,
      },
    );
    return { resolution: row.geometryResolution, surfaces: expectedSurfacesFromRow(row), candidates: [] };
  }

  const { data: rows } = await findCandidates(sb, vehicle);
  if (rows?.length === 1) {
    const validated = validatedSurfaces(rows[0]);
    if (validated) {
      const row = stampGeometryResolution(
        attachVehicleClassResolution(validated, vehicle),
        {
          state: "measured",
          measuredSurfaces: [...SURFACES],
          derivedSurfaces: [],
          geometrySourceRowId: rows[0].id,
          productionEligible: true,
          operatorValidated: true,
        },
      );
      return { resolution: row.geometryResolution, surfaces: expectedSurfacesFromRow(row), candidates: [] };
    }
  }

  // No authoritative record. Offer what the catalog DOES hold for this make, so
  // the customer can recognise their own configuration.
  return {
    resolution: {
      contract: "designpro.genie-manifest.v1",
      state: "unresolved",
      productionEligible: false,
      operatorValidated: false,
      reason: "no_authoritative_genie_row_for_year_and_configuration",
      vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    },
    surfaces: [],
    candidates: await nearMissCatalogRows(sb, vehicle),
  };
}

/**
 * Rows for the same make whose model shares a token with what the customer
 * typed, in any year. Deliberately NOT year-filtered: the point is to show a
 * 2017-2020 record to someone who typed 2024, labelled with its own years so
 * choosing it is an informed act.
 */
async function nearMissCatalogRows(sb, vehicle) {
  const tokens = normalizeModelTokens(vehicle.model);
  if (!tokens.length) return [];
  const { data: rows, error } = await sb
    .from(GENIE_CATALOG_TABLE).select("*").ilike("make", vehicle.make).limit(400);
  if (error || !Array.isArray(rows)) return [];
  return rows
    .filter(catalogRowIsIntact)
    .map((row) => ({ row, score: scoreCatalogRow(row, tokens) }))
    .filter((entry) => entry.score > 0 && surfacesFromGenieCatalog(entry.row, vehicle.vehicleClass))
    .sort((a, b) => b.score - a.score || String(a.row.model).length - String(b.row.model).length)
    .slice(0, 6)
    .map(({ row }) => ({
      id: row.id,
      model: row.model,
      yearRange: row.year_range || `${row.year_start}-${row.year_end}`,
      sideWidthIn: Number(row.side_width),
      sideHeightIn: Number(row.side_height),
    }));
}

async function resolveFlatAtlasPreviewDimensions(sb, rawVehicle, provider) {
  const vehicle = normalizedVehicle(rawVehicle);

  // THE MEASURED CATALOG WINS. Owner directive 2026-08-27: "It should be using
  // GENIE Panelizer database to get sizes for ATLAS."
  //
  // ⛔ A LOOKUP FAILURE IS NOT A CATALOG MISS. It used to be
  // `.catch(() => null)`, which made a broken query, a permission error and
  // "this vehicle has never been measured" the same event -- and all three
  // then produced a Gemini guess wearing the same shape as a measurement.
  // A thrown error is now a thrown error.
  const catalogMatch = await findGenieCatalogSurfaces(sb, vehicle);
  if (catalogMatch) {
    return stampGeometryResolution(
      attachVehicleClassResolution(catalogDimensionRow(catalogMatch, vehicle), vehicle),
      {
        // Five measured surfaces and one formally derived front. It is not
        // "measured" outright, because one of the six is not.
        state: "derived",
        measuredSurfaces: ["driver", "passenger", "hood", "roof", "rear"],
        derivedSurfaces: catalogMatch.derivedSurfaces || ["front"],
        derivationContract: FRONT_DERIVATION_CONTRACT,
        frontDerivation: catalogMatch.frontDerivation || null,
        geometrySourceRowId: catalogMatch.row?.id || null,
        catalogModel: catalogMatch.row?.model || null,
        catalogYearRange: catalogMatch.row?.year_range || null,
        productionEligible: true,
        operatorValidated: false,
      },
    );
  }

  const { data: rows, error } = await findCandidates(sb, vehicle);
  if (error) throw new UniversalDimensionError("genie_universal_cache_failed", error.message, true);
  if ((rows || []).length > 1) throw new UniversalDimensionError("genie_universal_identity_ambiguous", "Multiple universal GENIE candidates matched");
  if (rows?.length === 1) {
    const validated = validatedSurfaces(rows[0]);
    if (validated) {
      // An operator measured this vehicle. That is the only thing in the system
      // that outranks the catalog.
      return stampGeometryResolution(attachVehicleClassResolution(validated, vehicle), {
        state: "measured",
        measuredSurfaces: [...SURFACES],
        derivedSurfaces: [],
        geometrySourceRowId: rows[0].id,
        productionEligible: true,
        operatorValidated: true,
      });
    }
    return stampGeometryResolution(
      attachVehicleClassResolution(
        provisionalDimensionsFromCandidate(rows[0], vehicle.vehicleClass), vehicle,
      ),
      {
        state: "provisional",
        productionEligible: false,
        operatorValidated: false,
        reason: "cached_grounded_candidate_awaiting_operator_validation",
        geometrySourceRowId: rows[0].id,
      },
    );
  }

  // ⛔ FAIL CLOSED ON A YEAR / CONFIGURATION MISS. (Trish 2026-08-27, locked)
  //
  // "Do not silently fall back to Gemini for production geometry. That is what
  // created the 122\" front and poisoned the panel chain."
  //
  // Measured, on the owner's own vehicle: a 2024 Ford F-250 has NO row in the
  // catalog -- the newest Super Duty ends at 2020 -- so the year-eligible pool
  // was a Bronco and a Transit 250 van. Scoring `F-250` against `transit 250`
  // shares the token `250`, one point below the threshold. A single point
  // stood between that truck's six panels and a cargo van's dimensions.
  // Behind it, the estimator produced a 132.4" front on a truck whose front is
  // about eighty inches wide, and every panel downstream inherited it.
  //
  // The estimator is still allowed to describe a PREVIEW, but it may never
  // present itself as authority: the caller receives `unresolved` with the
  // grounded candidate attached, marks the geometry provisional and
  // production-ineligible, and PanelPro shows that plainly. Production unlocks
  // on an operator validation or a real catalog row, never on a guess.
  // The estimator still RUNS -- the owner allows it as a preview aid -- but it
  // may never present itself as authority. The state below is what production
  // reads, and it says `unresolved`.
  const grounded = await groundedCandidate(vehicle, provider);
  const row = await insertOrReadGroundedCandidate(sb, vehicle, grounded);
  const validated = validatedSurfaces(row);
  if (validated) return attachVehicleClassResolution(validated, vehicle);
  const provisional = attachVehicleClassResolution(
    provisionalDimensionsFromCandidate(row, vehicle.vehicleClass),
    vehicle,
  );
  // The state travels WITH the geometry, so no downstream stage has to infer it
  // from the shape of the object.
  return stampGeometryResolution(provisional, {
    state: "unresolved",
    productionEligible: false,
    operatorValidated: false,
    reason: "no_authoritative_genie_row_for_year_and_configuration",
    vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    geometrySourceRowId: row.id,
  });
}

async function resolveOrQueueUniversalDimensions(sb, rawVehicle, stage, runId, provider) {
  const vehicle = normalizedVehicle(rawVehicle);
  const { data: rows, error } = await findCandidates(sb, vehicle);
  if (error) throw new UniversalDimensionError("genie_universal_cache_failed", error.message, true);
  if ((rows || []).length > 1) throw new UniversalDimensionError("genie_universal_identity_ambiguous", "Multiple universal GENIE candidates matched");
  if (rows?.length === 1) {
    const validated = validatedSurfaces(rows[0]);
    if (validated) return attachVehicleClassResolution(validated, vehicle);
    const queued = await queueValidationRequest(sb, stage, runId, rows[0].id);
    throw new UniversalDimensionError("genie_dimension_validation_required", `GENIE candidate ${rows[0].id} requires exact six-surface validation`, false, queued);
  }

  const candidate = await groundedCandidate(vehicle, provider);
  const inserted = await insertOrReadGroundedCandidate(sb, vehicle, candidate);
  const validated = validatedSurfaces(inserted);
  if (validated) return attachVehicleClassResolution(validated, vehicle);
  const queued = await queueValidationRequest(sb, stage, runId, inserted.id);
  throw new UniversalDimensionError("genie_dimension_validation_required", `GENIE candidate ${inserted.id} created; exact six-surface validation is required`, false, queued);
}


/**
 * The six production surfaces as the validated dimension row states them.
 *
 * This mirrors, field for field, the mapping designpro-standalone-claimant.cjs
 * performs in manifest.resolve (its `dim(...)` calls). It exists so the
 * authoring producer can be handed the SAME surfaces at Calls 1-7 time that
 * manifest.resolve will bind to the run later: a creative layer's extent is
 * capped at its surface's bleed box, so authoring against different numbers
 * than the run binds would fail Call 8 on every job.
 *
 * Locked by tests/genie-surface-mapping.test.ts against the claimant's mapping.
 */
function expectedSurfacesFromRow(row) {
  const dim = (width, height, surfaceKey) => {
    const widthInches = Number(width);
    const heightInches = Number(height);
    if (!(widthInches > 0 && heightInches > 0)) {
      throw new UniversalDimensionError("genie_surface_dimensions_missing", `GENIE dimensions missing for ${surfaceKey}`);
    }
    return {
      surfaceKey,
      widthInches,
      heightInches,
      surfaceSqFt: Math.round((widthInches * heightInches / 144) * 100) / 100,
      bleed: { top: 5, right: 5, bottom: 5, left: 5 },
    };
  };
  return [
    dim(row.side_width, row.side_height, "driver"),
    dim(row.passenger_width || row.side_width, row.passenger_height || row.side_height, "passenger"),
    dim(row.hood_width, row.hood_length, "hood"),
    dim(row.roof_width, row.roof_length, "roof"),
    dim(row.front_width, row.front_height, "front"),
    dim(row.rear_width, row.rear_height, "rear"),
  ];
}

module.exports = {
  findGenieCatalogSurfaces,
  surfacesFromGenieCatalog,
  catalogDimensionRow,
  normalizeModelTokens,
  PROOF_GEOMETRY_CONTRACT,
  PROVISIONAL_ESTIMATOR_CONTRACT,
  FRONT_DERIVATION_CONTRACT,
  SURFACES,
  UniversalDimensionError,
  expectedSurfacesFromRow,
  resolveFlatAtlasPreviewDimensions,
  previewGenieDimensionsFromCatalog,
  resolveOrQueueUniversalDimensions,
  _test: {
    assertGroundedCandidate,
    groundedCandidate,
    groundingPrompt,
    attachVehicleClassResolution,
    groundedInsertPayload,
    normalizedVehicle,
    parseGroundedJson,
    provisionalDimensionsFromCandidate,
    validatedSurfaces,
    catalogRowIsIntact,
    stampGeometryResolution,
  },
};
