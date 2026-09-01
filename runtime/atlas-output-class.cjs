"use strict";

/**
 * CALL-1 OUTPUT-CLASS GATE — owner ruling, Trish 2026-09-01:
 *
 * > "Call 1 is A.T.L.A.S. authority only. The only valid Call-1 image output
 * >  is ONE flat A.T.L.A.S. panel-layout source containing ONE cohesive
 * >  vehicle wrap unwrapped flat. Any installed vehicle, 3D vehicle, vehicle
 * >  montage, presentation board, camera view, studio render, or mockup is
 * >  categorically invalid at Call 1. Do not allow any Call-1 candidate that
 * >  is not A.T.L.A.S. to become canonical or fan out downstream."
 *
 * Why this exists: DCA generation 470cb0e9 (2026-09-01) proved Gemini can
 * answer the approved v17 request with a photorealistic vehicle-mockup
 * montage (edge master 6200fd41…), and every deterministic structural gate
 * passed it — those gates convict silhouettes, voids and template leakage,
 * and a bright photoreal vehicle render measures as 94%+ "artwork". The six
 * canonical panels then faithfully cut pictures of a van.
 *
 * This gate asks Gemini ONE narrow class question about the candidate, at
 * temperature 0, before acceptance and before any fan-out:
 * flat panel-layout sheet, or vehicle depiction?
 *
 * Blocking policy (deliberately asymmetric):
 * - An explicit VEHICLE-DEPICTION verdict fails CLOSED — the candidate is
 *   refused (`flat_atlas_master_output_class_invalid`) and never becomes
 *   canonical. This narrows the older "semantic review is advisory" rule by
 *   the owner's own 2026-09-01 decision, for the output-class question ONLY.
 * - A transport/config/parse failure fails OPEN with a durable `unavailable`
 *   receipt: a Gemini inspector outage must not brick all authoring, and the
 *   deterministic structural gates still hold. The receipt makes the gap
 *   auditable rather than silent.
 *
 * This module never creates, edits or persists artwork.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");

const OUTPUT_CLASS_CONTRACT = "designpro.atlas-output-class-gate.v1";
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 45_000;
// An explicit vehicle verdict below this confidence is still refused — the
// class question is binary and the inspector runs at temperature 0, so any
// affirmative vehicle answer is treated as real. The threshold exists only so
// the receipt records what the inspector reported.
const MAX_TRANSPORT_DIMENSION = 1280;
const MAX_TRANSPORT_BYTES = 4_000_000;

class AtlasOutputClassError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "AtlasOutputClassError";
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function cleanText(value, max = 400) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * The inspector prompt. Positive definitions of BOTH classes, one binary
 * question, no quality judgment, no creative direction. The inspectionId
 * binds the answer to the exact candidate bytes.
 */
function outputClassPrompt(inspectionId) {
  return [
    "You are a print-production inspector. Classify this ONE image by OUTPUT CLASS only. Do not judge quality, style or branding.",
    "",
    "CLASS flat_atlas — a flat panel-layout sheet: rectangular regions of flat 2D print artwork laid out side by side on one sheet, like printed vinyl panels or posters laid flat. Pure graphics fill each rectangle. No vehicle body is depicted anywhere.",
    "",
    "CLASS vehicle_depiction — the image shows a vehicle in any form: an installed or wrapped vehicle, a 3D render, a photograph, a mockup, a montage of vehicle views, a presentation board, or a studio scene containing a vehicle. Wheels, tires, glass, mirrors, lights, body contours, shadows on a floor, or multiple camera views of a vehicle all place the image in this class.",
    "",
    `Respond with STRICT JSON only: {"inspectionId":"${inspectionId}","outputClass":"flat_atlas"|"vehicle_depiction","confidence":0..1,"evidence":"one short sentence naming what you see"}`,
  ].join("\n");
}

async function boundedTransport(bytes) {
  const image = sharp(bytes, { limitInputPixels: 268_402_689 });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) {
    throw new AtlasOutputClassError("atlas_output_class_candidate_undecodable", "The Call-1 candidate bytes are not a decodable image");
  }
  const out = await image
    .resize({ width: MAX_TRANSPORT_DIMENSION, height: MAX_TRANSPORT_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  if (out.length > MAX_TRANSPORT_BYTES) {
    throw new AtlasOutputClassError("atlas_output_class_transport_too_large", `Inspector transport is ${out.length} bytes`);
  }
  return out;
}

function parseVerdict(payload, inspectionId) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => typeof p?.text === "string").map((p) => p.text).join("\n").trim();
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch {
    throw new AtlasOutputClassError("atlas_output_class_response_unparseable", `Inspector returned non-JSON: ${cleanText(text, 160)}`);
  }
  if (parsed?.inspectionId !== inspectionId) {
    throw new AtlasOutputClassError("atlas_output_class_inspection_mismatch", "Inspector answered for different bytes");
  }
  const outputClass = String(parsed?.outputClass || "");
  if (outputClass !== "flat_atlas" && outputClass !== "vehicle_depiction") {
    throw new AtlasOutputClassError("atlas_output_class_verdict_invalid", `Unknown outputClass ${cleanText(outputClass, 60)}`);
  }
  const confidence = Number(parsed?.confidence);
  return {
    outputClass,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
    evidence: cleanText(parsed?.evidence, 300),
  };
}

/**
 * Classify one Call-1 candidate. Returns a durable receipt:
 *   { contract, disposition: "flat_atlas"|"vehicle_depiction"|"unavailable",
 *     blocking, confidence, evidence, model, code, reason, candidateSha256 }
 * `blocking === true` ONLY for an explicit vehicle_depiction verdict.
 */
async function classifyAtlasCandidate({ provider, bytes, model = DEFAULT_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const candidateSha256 = sha256(bytes);
  const base = { contract: OUTPUT_CLASS_CONTRACT, candidateSha256, model };
  const unavailable = (error) => ({
    ...base,
    disposition: "unavailable",
    blocking: false,
    confidence: null,
    evidence: null,
    code: error instanceof AtlasOutputClassError ? error.code : "atlas_output_class_inspector_failed",
    reason: cleanText(error?.message || error, 400),
  });
  if (!provider || typeof provider.generateRaw !== "function") {
    return unavailable(new AtlasOutputClassError("atlas_output_class_transport_missing", "Output-class gate requires provider.generateRaw"));
  }
  if (!/^gemini-[a-z0-9.-]+$/.test(String(model)) || /image/.test(String(model))) {
    return unavailable(new AtlasOutputClassError("atlas_output_class_model_invalid", `${model} is not an inspection model`));
  }
  try {
    const transport = await boundedTransport(bytes);
    const inspectionId = candidateSha256.slice(0, 16);
    const result = await provider.generateRaw({
      model,
      body: {
        contents: [{ parts: [
          { inlineData: { mimeType: "image/jpeg", data: transport.toString("base64") } },
          { text: outputClassPrompt(inspectionId) },
        ] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      },
      signal,
      timeoutMs,
      label: "A.T.L.A.S. Call-1 output-class gate",
    });
    const verdict = parseVerdict(result?.payload, inspectionId);
    return {
      ...base,
      disposition: verdict.outputClass,
      blocking: verdict.outputClass === "vehicle_depiction",
      confidence: verdict.confidence,
      evidence: verdict.evidence,
      code: null,
      reason: null,
    };
  } catch (error) {
    return unavailable(error);
  }
}

module.exports = {
  OUTPUT_CLASS_CONTRACT,
  AtlasOutputClassError,
  classifyAtlasCandidate,
  outputClassPrompt,
};
