"use strict";

/**
 * Standalone extraction of the DP-owned universal vehicle lookup.
 * The upstream resolver's panel values are estimates. This extraction may
 * create a grounded candidate, but it never promotes estimates into print
 * geometry. Only a separately validated exact six-surface manifest is returned.
 */

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
  return { dimensions, sourceUrls, confidence: ["high", "medium", "low"].includes(candidate.confidence) ? candidate.confidence : "low", subType: String(candidate.sub_type || "").trim() || null };
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
  const apiKey = String(process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new UniversalDimensionError("genie_grounding_key_missing", "Universal GENIE grounding key is not configured");
  const prompt = `Find exact OEM exterior dimensions for ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.vehicleClass}). Use primary manufacturer spec pages or official PDFs. Return JSON only: {"overall_length_in":number,"overall_width_in":number,"overall_height_in":number,"wheelbase_in":number|null,"sub_type":string|null,"confidence":"high|medium|low","source_urls":["https://..."]}. This is a candidate for human validation; do not invent missing values.`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST", headers: { "content-type": "application/json" },
    // gemini-2.5-flash is a thinking model, and thinking tokens are charged
    // against maxOutputTokens. At 2048, a grounded search can spend the entire
    // budget before emitting a single character, which returns a candidate with
    // no text and finishReason MAX_TOKENS -- indistinguishable, to the parser
    // below, from a model that simply declined to answer. Observed live:
    // manifest.resolve failed with "Grounding response contained no JSON
    // candidate" on a 2021 Ford Transit 250. Thinking is disabled and the
    // ceiling raised so the answer, not the deliberation, gets the budget.
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new UniversalDimensionError("genie_grounding_failed", `Gemini grounding HTTP ${response.status}`, response.status >= 500 || response.status === 429);
  const raw = await response.json();
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
  const { error } = await sb.rpc("request_designpro_universal_dimension_validation", {
    p_run_id: runId, p_candidate_id: candidateId, p_stage_id: stage.id, p_lease_token: stage.lease_token,
  });
  if (error) throw new UniversalDimensionError("genie_validation_request_failed", error.message, true);
}

async function findCandidates(sb, vehicle) {
  return sb.from("designpro_vehicle_specs_universal").select("*")
    .eq("vehicle_class", vehicle.vehicleClass).ilike("make", vehicle.make).ilike("model", vehicle.model).eq("year", vehicle.year).limit(2);
}

async function resolveOrQueueUniversalDimensions(sb, rawVehicle, stage, runId) {
  const vehicle = normalizedVehicle(rawVehicle);
  const { data: rows, error } = await findCandidates(sb, vehicle);
  if (error) throw new UniversalDimensionError("genie_universal_cache_failed", error.message, true);
  if ((rows || []).length > 1) throw new UniversalDimensionError("genie_universal_identity_ambiguous", "Multiple universal GENIE candidates matched");
  if (rows?.length === 1) {
    const validated = validatedSurfaces(rows[0]);
    if (validated) return validated;
    await queueValidationRequest(sb, stage, runId, rows[0].id);
    throw new UniversalDimensionError("genie_dimension_validation_required", `GENIE candidate ${rows[0].id} requires exact six-surface validation`, false, true);
  }

  const candidate = await groundedCandidate(vehicle);
  const { data: inserted, error: insertError } = await sb.from("designpro_vehicle_specs_universal").insert({
    vehicle_class: vehicle.vehicleClass, make: vehicle.make, model: vehicle.model, year: vehicle.year,
    sub_type: candidate.subType, overall_length_in: candidate.dimensions.overall_length_in,
    overall_width_in: candidate.dimensions.overall_width_in, overall_height_in: candidate.dimensions.overall_height_in,
    wheelbase_in: candidate.dimensions.wheelbase_in, source: "gemini_grounded",
    source_urls: candidate.sourceUrls, confidence: candidate.confidence, requires_validation: true,
    raw_response: candidate.raw,
  }).select("id").single();
  if (insertError?.code === "23505") {
    const { data: racedRows, error: racedError } = await findCandidates(sb, vehicle);
    if (racedError || racedRows?.length !== 1) throw new UniversalDimensionError("genie_universal_identity_ambiguous", racedError?.message || "Concurrent GENIE candidate identity is ambiguous", true);
    await queueValidationRequest(sb, stage, runId, racedRows[0].id);
    throw new UniversalDimensionError("genie_dimension_validation_required", `GENIE candidate ${racedRows[0].id} requires exact six-surface validation`, false, true);
  }
  if (insertError) throw new UniversalDimensionError("genie_universal_cache_insert_failed", insertError.message, true);
  await queueValidationRequest(sb, stage, runId, inserted.id);
  throw new UniversalDimensionError("genie_dimension_validation_required", `GENIE candidate ${inserted.id} created; exact six-surface validation is required`, false, true);
}

module.exports = { SURFACES, UniversalDimensionError, resolveOrQueueUniversalDimensions, _test: { normalizedVehicle, assertGroundedCandidate, validatedSurfaces } };
