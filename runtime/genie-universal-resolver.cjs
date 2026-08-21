"use strict";

/**
 * Standalone extraction of the DP-owned universal vehicle lookup.
 * The upstream resolver's panel values are estimates. This extraction may
 * create a grounded candidate, but it never promotes estimates into print
 * geometry. Only a separately validated exact six-surface manifest is returned.
 */

const { ProviderError, createProvider } = require("./generation-provider.cjs");

// One provider for the process, not one per lookup: the key pool's health and
// cooldown only mean anything if the same instance sees the next call.
let groundingProvider = null;
function provider() {
  if (!groundingProvider) groundingProvider = createProvider();
  return groundingProvider;
}

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

class UniversalDimensionError extends Error {
  constructor(code, message, retryable = false, stageHandled = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.stageHandled = stageHandled;
  }
}

function normalizedVehicle(vehicle) {
  const vehicleClass = String(vehicle.type || vehicle.vehicleClass || "").trim().toLowerCase().replace(/[ -]+/g, "_");
  const make = String(vehicle.make || "").trim();
  const model = String(vehicle.model || "").trim();
  const year = String(vehicle.year || "").trim();
  if (!ALLOWED_CLASSES.has(vehicleClass) || !make || !model || !/^\d{4}$/.test(year)) {
    throw new UniversalDimensionError("genie_vehicle_identity_invalid", "Universal GENIE requires class, four-digit year, make and model");
  }
  return { vehicleClass, make, model, year };
}

const DERIVED_SURFACES_CONTRACT = "designpro.genie-derived-surfaces.v1";

/**
 * The six wrap surfaces, derived from a grounded candidate.
 *
 * Ported from restylepro-os supabase/functions/panelizer-step-validate/index.ts
 * (:208-250 normalization, :344 cacheVehicleDims write-back). That fallback is
 * what let an unknown vehicle be designed at all: ground the wheelbase and
 * overall dimensions, calculate the panels, write them back so the next job for
 * the same vehicle is a cache hit, and carry on. Only the derivation crossed
 * over here originally -- the grounded overalls were stored and the run parked,
 * which stopped a design on a vehicle nobody had validated yet.
 *
 * Every guard below is the source's, kept because each one is a live failure:
 *
 *  - THE LENGTH CLAMP. A side panel runs front-to-rear along the body, so it
 *    can never exceed overall length. The original names the case in its own
 *    comment: a Ram 2500 mega cab grounded to ~260" on a ~247" truck. Clamped
 *    to 92% of real length.
 *  - THE RANGE REJECT. Out-of-range numbers return null rather than a plausible
 *    wrong panel, because a wrong panel prints.
 *  - THE SWAP CORRECT. A side is always wider than it is tall; a transposed
 *    pair is a transcription error, not a narrow tall vehicle.
 *
 * Returns null when the candidate cannot be derived honestly. Null parks the
 * run for operator validation, which is the same answer as before this existed.
 */
function deriveSurfaces(candidate, dimensions) {
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const overallLength = number(dimensions.overall_length_in);
  const overallWidth = number(dimensions.overall_width_in);
  const overallHeight = number(dimensions.overall_height_in);
  const wheelbase = number(dimensions.wheelbase_in);

  let sideWidth = number(candidate.sideWidth) || (overallLength ? overallLength - 9 : 0);
  const sideHeightRaw = number(candidate.sideHeight) || (overallHeight ? overallHeight * 0.78 : 0);

  // The clamp, before anything else reads sideWidth.
  if (overallLength > 80 && sideWidth > overallLength * 0.97) sideWidth = overallLength * 0.92;

  if (!sideWidth || !sideHeightRaw) return null;
  if (sideWidth < 80 || sideWidth > 350 || sideHeightRaw < 25 || sideHeightRaw > 120) return null;
  if (wheelbase && (wheelbase < 60 || wheelbase > 250)) return null;

  const driverWidth = Math.round(Math.max(sideWidth, sideHeightRaw));
  const driverHeight = Math.round(Math.min(sideWidth, sideHeightRaw));

  const surfaces = {
    driver: { widthInches: driverWidth, heightInches: driverHeight },
    // The passenger side of a vehicle is the same panel as the driver side.
    // It is stated rather than mirrored downstream because manufacturing owns
    // mirroring as an explicit operator action, never a pipeline default.
    passenger: { widthInches: driverWidth, heightInches: driverHeight },
    hood: {
      widthInches: Math.round(number(candidate.hoodWidth) || overallWidth * 0.85 || driverWidth * 0.37),
      heightInches: Math.round(number(candidate.hoodLength) || 38),
    },
    roof: {
      widthInches: Math.round(number(candidate.roofWidth) || overallWidth * 0.80 || driverWidth * 0.35),
      heightInches: Math.round(number(candidate.roofLength) || wheelbase * 0.6 || 66),
    },
    front: {
      widthInches: Math.round(number(candidate.frontWidth) || overallWidth * 0.85 || 66),
      heightInches: Math.round(number(candidate.frontHeight) || overallHeight * 0.45 || 42),
    },
    rear: {
      widthInches: Math.round(number(candidate.backWidth) || overallWidth * 0.85 || 66),
      heightInches: Math.round(number(candidate.backHeight) || overallHeight * 0.45 || 42),
    },
  };
  for (const key of SURFACES) {
    const surface = surfaces[key];
    if (!(surface.widthInches > 0 && surface.heightInches > 0)) return null;
  }
  return {
    contractVersion: DERIVED_SURFACES_CONTRACT,
    surfaces,
    // Named so a reader can tell which numbers a human still owes us. `front`
    // is the one with no restylepro precedent; the rest are ported formulas.
    derivation: {
      source: "panelizer-step-validate.google-grounded-formulas",
      clampedToOverallLength: overallLength > 80 && number(candidate.sideWidth) > overallLength * 0.97,
      withoutPrecedent: ["front"],
    },
  };
}

/**
 * Derived surfaces as the row states them. The shape mirrors validatedSurfaces
 * exactly so a caller consumes one or the other without branching, and the
 * provenance says which it got.
 */
function derivedSurfaces(row) {
  const manifest = row.panels;
  if (!manifest || manifest.contractVersion !== DERIVED_SURFACES_CONTRACT
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
    universalValidation: {
      provenance: "grounded-derived",
      validatorId: null,
      validatedAt: null,
      sourceUrls: row.source_urls || [],
      candidateId: row.id,
      derivation: manifest.derivation || null,
    },
  };
}

function assertGroundedCandidate(candidate, vehicleClass) {
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
    dimensions, sourceUrls,
    confidence: ["high", "medium", "low"].includes(candidate.confidence) ? candidate.confidence : "low",
    subType: String(candidate.sub_type || "").trim() || null,
    // The calculated panel numbers ride along unvalidated; deriveSurfaces owns
    // every guard on them, so nothing here has to know the formulas.
    panelCandidate: candidate,
  };
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
  };
}

async function groundedCandidate(vehicle) {
  // The formulas are ported verbatim from restylepro-os
  // supabase/functions/panelizer-step-validate/index.ts:158-177, including the
  // reason the wheelbase estimate was rejected. They are stated to the model
  // rather than applied afterwards for the same reason the original did it that
  // way: the model knows the rear overhang and the trim variant, and computing
  // hoodLength here would mean guessing at both.
  //
  // `front` has NO counterpart in that source -- restylepro's GENIE derives
  // side, hood, roof and back only. It is asked for symmetrically with back and
  // recorded as the one derived value with no proven precedent.
  const prompt = `Find exact OEM exterior dimensions for ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.vehicleClass}). Use primary manufacturer spec pages or official PDFs.

If this exact model was not produced in that year, use the real dimensions of the generation that WAS produced. Do not invent numbers.

Then CALCULATE the vinyl wrap panel dimensions using these formulas:
- sideWidth = overall length minus 8 to 10 inches (a full-side wrap runs nearly the ENTIRE body length; do NOT use wheelbase x 1.45 -- that badly undersizes sedans)
- sideHeight = overall height x 0.75 to 0.82 (the wrappable body side from rocker to roof-drip)
- hoodWidth = overall width x 0.85
- hoodLength = front overhang (overall length - wheelbase - rear overhang, typically 35-45 inches)
- roofWidth = overall width x 0.80
- roofLength = wheelbase x 0.60
- frontWidth = overall width x 0.85
- frontHeight = overall height x 0.45
- backWidth = overall width x 0.85
- backHeight = overall height x 0.45

Return JSON only: {"overall_length_in":number,"overall_width_in":number,"overall_height_in":number,"wheelbase_in":number|null,"sub_type":string|null,"confidence":"high|medium|low","source_urls":["https://..."],"sideWidth":number,"sideHeight":number,"hoodWidth":number,"hoodLength":number,"roofWidth":number,"roofLength":number,"frontWidth":number,"frontHeight":number,"backWidth":number,"backHeight":number}

This is a candidate for human validation; do not invent missing values. Omit any measurement you cannot source, and omit the calculated panel value that depends on it -- a formula applied to a guessed input is still a guess.`;
  // The endpoint and the credential belong to generation-provider, which owns
  // the key pool, its health and the one URL this runtime speaks to. This call
  // used to build both itself, which put it outside rotation and outside any
  // future provider move.
  let raw;
  try {
    ({ payload: raw } = await provider().generateRaw({
      model: "gemini-2.5-flash",
      label: "GENIE grounded dimensions",
      timeoutMs: 45_000,
      body: {
        // gemini-2.5-flash is a thinking model and thinking tokens are charged
        // against maxOutputTokens, so at 2048 a grounded search could spend the
        // whole budget before emitting a character -- returning empty text with
        // finishReason MAX_TOKENS, which the parser below read as "no JSON here".
        // Observed live on a 2021 Ford Transit 250.
        //
        // The ceiling is raised rather than the thinking suppressed. Turning
        // thinking off did clear the truncation, but the model then answered with
        // zeros for every dimension, which the range check rejected
        // ("overall_length_in 0 is outside van range 160-290") -- reading OEM spec
        // pages and reconciling trim variants is the part of this job that needs
        // the reasoning. 8192 leaves room for both the deliberation and the answer.
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      },
    }));
  } catch (error) {
    // The provider's codes are transport truth; GENIE's callers key off these
    // two, so the boundary is translated rather than widened.
    if (error instanceof ProviderError && error.code === "provider_key_missing") {
      throw new UniversalDimensionError("genie_grounding_key_missing", "Universal GENIE grounding key is not configured");
    }
    throw new UniversalDimensionError("genie_grounding_failed", `Gemini grounding failed: ${error?.message || error}`, true);
  }
  const candidate = raw?.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text || "").join("") || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    // Say which of the several silent shapes this was, or the next failure is
    // as opaque as this one: a truncated answer, a safety block and an empty
    // response all arrive here looking identical.
    const finish = String(candidate?.finishReason || raw?.promptFeedback?.blockReason || "none");
    const excerpt = text.trim().slice(0, 160).replace(/\s+/g, " ");
    throw new UniversalDimensionError(
      "genie_grounding_parse_failed",
      `Grounding response contained no JSON candidate (finishReason=${finish}, textLength=${text.length}${excerpt ? `, excerpt=${JSON.stringify(excerpt)}` : ""})`,
      finish === "MAX_TOKENS",
    );
  }
  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch { throw new UniversalDimensionError("genie_grounding_parse_failed", "Grounding response JSON was invalid"); }
  const groundingUrls = raw?.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk) => chunk.web?.uri).filter(Boolean) || [];
  parsed.source_urls = [...(Array.isArray(parsed.source_urls) ? parsed.source_urls : []), ...groundingUrls];
  return { ...assertGroundedCandidate(parsed, vehicle.vehicleClass), raw };
}

async function queueValidationRequest(sb, stage, runId, candidateId) {
  // Calls 1-7 resolve dimensions with no stage and no lease -- there is no run
  // to park. Requesting validation for a run that does not exist would throw on
  // stage.id, which is a crash where the caller expects an answer.
  if (!stage || !runId) return;
  const { error } = await sb.rpc("request_designpro_universal_dimension_validation", {
    p_run_id: runId, p_candidate_id: candidateId, p_stage_id: stage.id, p_lease_token: stage.lease_token,
  });
  if (error) throw new UniversalDimensionError("genie_validation_request_failed", error.message, true);
}

async function findCandidates(sb, vehicle) {
  return sb.from("designpro_vehicle_specs_universal").select("*")
    .eq("vehicle_class", vehicle.vehicleClass).ilike("make", vehicle.make).ilike("model", vehicle.model).eq("year", vehicle.year).limit(2);
}

/**
 * @param options.allowDerived  Accept grounded-derived surfaces instead of
 *   parking. Calls 1-7 pass true: a design is drawn, not printed, and blocking
 *   the drawing on a human measurement stops work that no measurement changes.
 *   manifest.resolve leaves it false, so the production path still admits only
 *   operator-validated geometry.
 */
async function resolveOrQueueUniversalDimensions(sb, rawVehicle, stage, runId, options = {}) {
  const allowDerived = options.allowDerived === true;
  const vehicle = normalizedVehicle(rawVehicle);
  const { data: rows, error } = await findCandidates(sb, vehicle);
  if (error) throw new UniversalDimensionError("genie_universal_cache_failed", error.message, true);
  if ((rows || []).length > 1) throw new UniversalDimensionError("genie_universal_identity_ambiguous", "Multiple universal GENIE candidates matched");
  if (rows?.length === 1) {
    const validated = validatedSurfaces(rows[0]);
    if (validated) return { ...validated, universalValidation: { ...validated.universalValidation, provenance: "operator-validated" } };
    if (allowDerived) {
      const derived = derivedSurfaces(rows[0]);
      if (derived) return derived;
    }
    await queueValidationRequest(sb, stage, runId, rows[0].id);
    throw new UniversalDimensionError("genie_dimension_validation_required", `GENIE candidate ${rows[0].id} requires exact six-surface validation`, false, true);
  }

  const candidate = await groundedCandidate(vehicle);
  const derived = deriveSurfaces(candidate.panelCandidate || {}, candidate.dimensions);
  const { data: inserted, error: insertError } = await sb.from("designpro_vehicle_specs_universal").insert({
    vehicle_class: vehicle.vehicleClass, make: vehicle.make, model: vehicle.model, year: vehicle.year,
    sub_type: candidate.subType, overall_length_in: candidate.dimensions.overall_length_in,
    overall_width_in: candidate.dimensions.overall_width_in, overall_height_in: candidate.dimensions.overall_height_in,
    wheelbase_in: candidate.dimensions.wheelbase_in, source: "gemini_grounded",
    source_urls: candidate.sourceUrls, confidence: candidate.confidence, requires_validation: true,
    raw_response: candidate.raw,
    // The write-back. restylepro's cacheVehicleDims existed so "the next job for
    // the same vehicle is a DB hit"; the same numbers land here, in the row's
    // own `panels` slot. requires_validation stays TRUE: these are derived, and
    // saying otherwise would claim a human measured a vehicle nobody has seen.
    panels: derived || {},
  }).select("*").single();
  if (insertError?.code === "23505") {
    const { data: racedRows, error: racedError } = await findCandidates(sb, vehicle);
    if (racedError || racedRows?.length !== 1) throw new UniversalDimensionError("genie_universal_identity_ambiguous", racedError?.message || "Concurrent GENIE candidate identity is ambiguous", true);
    const racedValidated = validatedSurfaces(racedRows[0]);
    if (racedValidated) return { ...racedValidated, universalValidation: { ...racedValidated.universalValidation, provenance: "operator-validated" } };
    if (allowDerived) {
      const racedDerived = derivedSurfaces(racedRows[0]);
      if (racedDerived) return racedDerived;
    }
    await queueValidationRequest(sb, stage, runId, racedRows[0].id);
    throw new UniversalDimensionError("genie_dimension_validation_required", `GENIE candidate ${racedRows[0].id} requires exact six-surface validation`, false, true);
  }
  if (insertError) throw new UniversalDimensionError("genie_universal_cache_insert_failed", insertError.message, true);
  if (allowDerived) {
    const freshlyDerived = derivedSurfaces(inserted);
    if (freshlyDerived) return freshlyDerived;
  }
  await queueValidationRequest(sb, stage, runId, inserted.id);
  throw new UniversalDimensionError("genie_dimension_validation_required", `GENIE candidate ${inserted.id} created; exact six-surface validation is required`, false, true);
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

module.exports = { DERIVED_SURFACES_CONTRACT, SURFACES, UniversalDimensionError, expectedSurfacesFromRow, resolveOrQueueUniversalDimensions, _test: { normalizedVehicle, assertGroundedCandidate, deriveSurfaces, derivedSurfaces, validatedSurfaces } };
