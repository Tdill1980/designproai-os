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

// A refusing verdict. `flat_atlas` is the only acceptance; an inspector that
// cannot answer is `unavailable` and never blocks (RULE 0.30).
const BLOCKING_CLASSES = new Set(["vehicle_depiction", "map_drawn"]);
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
    "CLASS flat_atlas — a flat panel-layout sheet: rectangular regions of flat 2D print artwork laid out side by side on one sheet, like printed vinyl panels or posters laid flat. The sheet is EXPECTED to hold several rectangles, one per vehicle surface, and may carry printed panel names or captions (for example HOOD, ROOF, DRIVER, REAR): that is the layout, not a vehicle. Inside a rectangle the artwork may legitimately contain automotive MOTIFS drawn as graphics — racing livery stripes and numbers, sponsor lettering, a small stylised car icon as a logo element, grille or headlight graphics, tire-tread or carbon patterns — but ONLY on a field of artwork that fills the rectangle edge to edge with no vehicle anatomy visible.",
    "",
    "CLASS vehicle_depiction — the image shows a vehicle rather than flat printed material. This includes: an installed or wrapped vehicle, a 3D render, a photograph, a mockup, a montage of vehicle camera views, a presentation board, or a studio scene containing a vehicle. It ALSO includes any rectangle that shows a vehicle ELEVATION or VIEW — side profile, front or rear elevation, top view — recognisable by VEHICLE ANATOMY: wheels or tires, wheel arches, windows, windshield or other glass, headlights or taillights, mirrors, bumpers, a licence plate, a floor shadow or reflection, or the vehicle's body outline against a surround. That rectangle is a vehicle whatever the surround (white, grey, black, a studio floor or any colour), whether or not it is labelled, and even when it carries the livery: a race car drawn in the DRIVER rectangle is a vehicle, not a panel.",
    "",
    "ALSO vehicle_depiction: a rectangle whose artwork is a vehicle-shaped island — the artwork stops at a body outline (side profile, front or rear elevation) and a plain single-colour surround (grey, white, black or any colour) fills the rest of the rectangle. ALSO vehicle_depiction: a rectangle of otherwise continuous artwork that carries a dark or empty OPENING where a wheel, wheel arch, window, windshield or grille would sit — a disc, arch or pane of black, dark grey or blank inside the artwork. Printed vinyl has no openings; the installer cuts them. Small dark graphic details, shadows and lettering are artwork, not openings.",
    "",
    "flat_atlas requires EVERY rectangle to read as continuous print artwork edge to edge, with no vehicle-shaped boundary between artwork and surround and no vehicle anatomy anywhere on the sheet. If ANY rectangle shows anatomy, answer vehicle_depiction and name that rectangle in the evidence.",
    "",
    "",
    "CLASS map_drawn — the sheet has the LAYOUT MAP painted into the artwork. The authoring request states the panel rectangles as bare decimal fractions of the image (for example `0.0293 0.6665 0.5413 0.8025`), and on some sheets those digits are rendered as ink. Answer map_drawn when you can see, printed on the artwork: bare decimal numbers written as a leading zero and a point (0.9114, 0.3, 0.0000), or short unlabelled rows or pairs of such numbers, usually small, in a plain typeface, sitting at a rectangle's edge or corner and belonging to no part of the artwork. Also map_drawn: printed registration crosses, corner ticks, dimension arrows or a drawn frame around a rectangle.",
    "",
    "NOT map_drawn, and this distinction is the whole point: real lettering the customer asked for is artwork. A telephone number, a street address, a web address, a year, a founding date, a price, a race number, a model name, a measurement inside a logo lockup, or any word or numeral set in the artwork's own typeface and composed as part of it is `flat_atlas`. A commercial wrap is EXPECTED to carry a phone number. Judge by whether the numerals are a decimal fraction of the sheet dropped on top of the picture, not by whether numerals are present.",
    "",
    `Respond with STRICT JSON only: {"inspectionId":"${inspectionId}","outputClass":"flat_atlas"|"vehicle_depiction"|"map_drawn","confidence":0..1,"anatomyRectangles":0..12,"evidence":"one short sentence naming what you see"}`,
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
  if (!BLOCKING_CLASSES.has(outputClass) && outputClass !== "flat_atlas") {
    throw new AtlasOutputClassError("atlas_output_class_verdict_invalid", `Unknown outputClass ${cleanText(outputClass, 60)}`);
  }
  const confidence = Number(parsed?.confidence);
  const anatomy = Number(parsed?.anatomyRectangles);
  return {
    outputClass,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
    anatomyRectangles: Number.isInteger(anatomy) && anatomy >= 0 ? anatomy : null,
    evidence: cleanText(parsed?.evidence, 300),
  };
}

/**
 * THE TWO VERDICTS THAT REFUSE A SHEET.
 *
 * `vehicle_depiction` is the original: Call 1 answered with a picture of a
 * vehicle instead of printed media.
 *
 * `map_drawn` is the 2026-09-16 addition, and it convicts a defect the prompt
 * has failed to prevent four times running. The FIELD contract hands the
 * designer its six panel rectangles as bare four-decimal fractions and then
 * says "None of the map is drawn: the vinyl carries no numbers" -- a negative
 * instruction standing next to the very thing it forbids, which is the prompt
 * shape this codebase already knows Gemini over-indexes on. Runs 455b1723,
 * 7c7bd633, cc382c3c and 8c525565 all printed those digits onto the flanks,
 * and 8c525565's went all the way through Topaz onto 150-PPI print panels.
 * Wording did not stop it; only refusing the sheet does.
 *
 * Returns a durable receipt:
 *   { contract, disposition: "flat_atlas"|"vehicle_depiction"|"map_drawn"|"unavailable",
 *     blocking, confidence, evidence, model, code, reason, candidateSha256 }
 * `blocking === true` for an explicit verdict in BLOCKING_CLASSES; an
 * inspector outage still fails OPEN, exactly as before.
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
      blocking: BLOCKING_CLASSES.has(verdict.outputClass),
      confidence: verdict.confidence,
      anatomyRectangles: verdict.anatomyRectangles,
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
  BLOCKING_CLASSES,
  AtlasOutputClassError,
  classifyAtlasCandidate,
  outputClassPrompt,
};
