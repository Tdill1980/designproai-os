"use strict";

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
  const retryInstruction = strictRetry
    ? " Your prior answer could not be parsed. Return exactly ONE complete JSON object, with no Markdown fence, prose, comments, trailing text, or alternative objects."
    : "";
  return `Find exact OEM exterior dimensions for ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.vehicleClass}). Use primary manufacturer spec pages or official PDFs. Where the named cab has multiple bed lengths, use the standard single-rear-wheel short-bed configuration and name that exact configuration in sub_type; never return alternative objects. Return JSON only: {"vehicle_class":"${vehicle.vehicleClass}","overall_length_in":number,"overall_width_in":number,"overall_height_in":number,"wheelbase_in":number|null,"sub_type":string|null,"confidence":"high|medium|low","source_urls":["https://..."]}. This is a candidate for human validation; do not invent missing values.${retryInstruction}`;
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let rawResult;
    try {
      rawResult = await transport.generateRaw({
        model: "gemini-2.5-flash",
        body: {
          contents: [{ parts: [{ text: groundingPrompt(vehicle, attempt === 1) }] }],
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
      if (error?.code !== "genie_grounding_parse_failed" || attempt === 1) {
        if (error?.code === "genie_grounding_parse_failed" && attempt === 1) {
          throw new UniversalDimensionError(
            error.code,
            `${error.message}; two bounded grounding attempts were exhausted`,
            true,
          );
        }
        throw error;
      }
      lastParseError = error;
      continue;
    }
    const groundingUrls = candidate?.groundingMetadata?.groundingChunks
      ?.map((chunk) => chunk.web?.uri).filter(Boolean) || [];
    parsed.source_urls = [...(Array.isArray(parsed.source_urls) ? parsed.source_urls : []), ...groundingUrls];
    return { ...assertGroundedCandidate(parsed, vehicle.vehicleClass), raw };
  }
  throw lastParseError || new UniversalDimensionError("genie_grounding_parse_failed", "Grounding response JSON was invalid", true);
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
async function resolveFlatAtlasPreviewDimensions(sb, rawVehicle, provider) {
  const vehicle = normalizedVehicle(rawVehicle);
  const { data: rows, error } = await findCandidates(sb, vehicle);
  if (error) throw new UniversalDimensionError("genie_universal_cache_failed", error.message, true);
  if ((rows || []).length > 1) throw new UniversalDimensionError("genie_universal_identity_ambiguous", "Multiple universal GENIE candidates matched");
  if (rows?.length === 1) {
    return attachVehicleClassResolution(
      validatedSurfaces(rows[0]) || provisionalDimensionsFromCandidate(rows[0], vehicle.vehicleClass),
      vehicle,
    );
  }

  const grounded = await groundedCandidate(vehicle, provider);
  const row = await insertOrReadGroundedCandidate(sb, vehicle, grounded);
  return attachVehicleClassResolution(
    validatedSurfaces(row) || provisionalDimensionsFromCandidate(row, vehicle.vehicleClass),
    vehicle,
  );
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
  PROOF_GEOMETRY_CONTRACT,
  PROVISIONAL_ESTIMATOR_CONTRACT,
  SURFACES,
  UniversalDimensionError,
  expectedSurfacesFromRow,
  resolveFlatAtlasPreviewDimensions,
  resolveOrQueueUniversalDimensions,
  _test: {
    assertGroundedCandidate,
    attachVehicleClassResolution,
    groundedInsertPayload,
    normalizedVehicle,
    parseGroundedJson,
    provisionalDimensionsFromCandidate,
    validatedSurfaces,
  },
};
