"use strict";

/**
 * Fail-closed visual acceptance gate for the seven A.T.L.A.S. customer proofs.
 *
 * Generation prompts are necessary, but they are not evidence that an image
 * obeyed the requested camera. This module sends the actual candidate proof
 * and a bounded transport derivative of the immutable flattened Atlas to the
 * existing server-only provider.generateRaw seam, asks for strict structured
 * inspection, and accepts only an unambiguous all-pass verdict.
 *
 * This gate does not create, edit or persist artwork. It is deliberately
 * independent of the proof generator so a failed view is rejected by the
 * generation engine instead of becoming an accepted row.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");
const angles = require("./view-angles.cjs");
const { PHOTOREALISM_REQUIREMENT } = require("./photorealism-prompt.cjs");
const { STUDIO_ENVIRONMENT, STUDIO_REINFORCEMENT } = require("./studio-os.cjs");

const QC_CONTRACT = "designpro.atlas-proof-semantic-qc.v1";
const DEFAULT_QC_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.9;
const MAX_RESPONSE_TEXT_BYTES = 16 * 1024;
const MAX_REQUEST_BYTES = 18 * 1024 * 1024;
const MAX_ATLAS_TRANSPORT_BYTES = 1_500_000;
const MAX_CANDIDATE_TRANSPORT_BYTES = 5_000_000;
const MAX_TRANSPORT_DIMENSION = 1600;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const STATUS = Object.freeze(["pass", "fail", "uncertain", "not_applicable"]);

const VIEW_CONTRACTS = Object.freeze({
  side: Object.freeze({
    label: "Driver",
    orientation: "pass",
    roofBoundary: "not_applicable",
    acceptance: "Perfect straight driver-side elevation. Vehicle nose points LEFT; both driver-side wheels are visible; no three-quarter perspective.",
  }),
  "passenger-side": Object.freeze({
    label: "Passenger",
    orientation: "pass",
    roofBoundary: "not_applicable",
    acceptance: "Perfect straight passenger-side elevation. Vehicle nose points RIGHT; both passenger-side wheels are visible; every word, URL and phone number reads forward, never mirrored.",
  }),
  hood_detail: Object.freeze({
    label: "Hood",
    orientation: "not_applicable",
    roofBoundary: "not_applicable",
    acceptance: "Directly overhead hood-only composition. Hood fills the frame between windshield base and front bumper edge; no angled glamour view.",
  }),
  front: Object.freeze({
    label: "Front",
    orientation: "pass",
    roofBoundary: "not_applicable",
    acceptance: "Perfectly straight-on symmetrical front view at grille height; not a three-quarter or hero view.",
  }),
  rear: Object.freeze({
    label: "Rear",
    orientation: "pass",
    roofBoundary: "not_applicable",
    acceptance: "Perfectly straight-on symmetrical rear view at bumper height; not a three-quarter or hero view.",
  }),
  "close-up": Object.freeze({
    label: "Close-Up",
    orientation: "not_applicable",
    roofBoundary: "not_applicable",
    acceptance: "A sharp body-panel design detail at the locked 18-inch camera distance, showing real vinyl grain, laminate sheen, body contour and readable artwork; not a whole-vehicle presentation.",
  }),
  roof: Object.freeze({
    label: "Roof",
    orientation: "not_applicable",
    roofBoundary: "pass",
    acceptance: "True 90-degree overhead CAB-ROOF-ONLY frame. For a pickup, the hood/front end, open cargo bed, tailgate, bed interior, wheels, mirrors, vehicle sides, floor and walls are absent. The cab roof between windshield and rear glass fills the frame.",
  }),
});

const OBSERVED_VIEW_VALUES = Object.freeze([
  ...Object.values(VIEW_CONTRACTS).map((entry) => entry.label),
  "Hero",
  "Other",
  "Uncertain",
]);

const RESPONSE_FIELDS = Object.freeze([
  "contract",
  "proofSha256",
  "atlasSha256",
  "authoritySha256",
  "expectedView",
  "observedView",
  "cameraContract",
  "framingContract",
  "orientationContract",
  "roofBoundaryContract",
  "photorealismContract",
  "studioLightingContract",
  "atlasContinuityContract",
  "vehicleContinuityContract",
  "artifactFreeContract",
  "confidence",
  "reasons",
]);

class AtlasProofQcError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireBuffer(value, label) {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    throw new AtlasProofQcError("atlas_qc_image_missing", `${label} image bytes are required`);
  }
  return value;
}

function requireContentType(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(normalized)) {
    throw new AtlasProofQcError("atlas_qc_image_type_invalid", `${label} content type ${normalized || "missing"} is not supported`);
  }
  return normalized;
}

function requireHash(bytes, expected, label) {
  const actual = sha256(bytes);
  if (expected != null && String(expected) !== actual) {
    throw new AtlasProofQcError("atlas_qc_image_hash_mismatch", `${label} bytes do not match their immutable sha256`);
  }
  return actual;
}

function cleanText(value, max = 240) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function vehicleDescription(input) {
  const vehicle = input?.vehicle && typeof input.vehicle === "object" ? input.vehicle : input || {};
  const fields = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim, vehicle.type || vehicle.vehicleType || vehicle.vehicleClass]
    .map((value) => cleanText(value, 80)).filter(Boolean);
  return fields.join(" ") || "the exact target vehicle supplied to A.T.L.A.S.";
}

function pickupVehicle(input) {
  const description = vehicleDescription(input).toLowerCase();
  return /\b(pickup|truck|f[- ]?\d{3}|silverado|sierra|tacoma|tundra|ridgeline|ranger|colorado|canyon|frontier|ram)\b/.test(description);
}

function atlasTopologySummary(atlas) {
  const manifest = atlas?.manifest;
  if (!manifest || typeof manifest !== "object") return "No separate topology prose; use the flattened Atlas pixels as sole artwork authority.";
  const summary = {
    topology: manifest.topology || null,
    installerMap: manifest.installerMap || null,
    zones: Array.isArray(manifest.zones)
      ? manifest.zones.map((zone) => ({
        surfaceKey: cleanText(zone?.surfaceKey, 80),
        proofDependencies: Array.isArray(zone?.proofDependencies)
          ? zone.proofDependencies.map((entry) => cleanText(entry, 40)).filter(Boolean)
          : [],
      }))
      : [],
  };
  return JSON.stringify(summary).slice(0, 5000);
}

function buildAtlasProofQcPrompt({
  sourceViewType, input, atlas, proofHash, atlasHash, authorityHash, authoritySurface,
}) {
  const view = VIEW_CONTRACTS[sourceViewType];
  if (!view) {
    throw new AtlasProofQcError(
      "atlas_qc_view_invalid",
      `${sourceViewType || "missing"} is not one of the seven A.T.L.A.S. proof views`,
    );
  }
  const pickup = pickupVehicle(input);
  return `A.T.L.A.S. CUSTOMER-PROOF ACCEPTANCE INSPECTION — ${QC_CONTRACT}

You are a strict visual quality-control inspector, not a designer. Do not edit, improve or reinterpret either image. Grade the first attached image (CANDIDATE PROOF) against the second attached image (EXACT NATIVE ${String(authoritySurface).toUpperCase()} ZONE CROP). That crop was deterministically extracted from the accepted flattened A.T.L.A.S. master and is the sole artwork authority for this proof. Do not compare against or infer from any other master zone. Perspective may change how these exact pixels appear on a real body panel, but colors, distinctive graphics, logos, lettering, photographic scenes, scale relationships and flow must remain the same design. Invented or moved artwork is a failure.

Expected proof: ${view.label}
Exact target vehicle: ${vehicleDescription(input)}
Pickup roof rule active: ${pickup ? "YES" : "NO"}
Candidate original sha256: ${proofHash}
Canonical Atlas original sha256: ${atlasHash}
Exact ${authoritySurface} authority sha256: ${authorityHash}
Atlas topology summary: ${atlasTopologySummary(atlas)}

EXPECTED CAMERA CONTRACT — imported from view-angles-os:
${angles.cameraAngle(sourceViewType)}

VIEW-SPECIFIC ACCEPTANCE:
${view.acceptance}
${sourceViewType === "roof" && pickup ? "This pickup roof proof FAILS if any open bed, bedliner, cargo box, tailgate, hood, wheel, side body, floor or wall is visible. Do not excuse a bed view as a roof view." : ""}
${sourceViewType === "side" ? "Driver orientation FAILS if the nose points right." : ""}
${sourceViewType === "passenger-side" ? "Passenger orientation FAILS if the nose points left or if any readable lettering is horizontally reversed." : ""}
Any three-quarter glamour composition is Hero, not one of these seven exact proofs, and must fail.

PHOTOGRAPHY CONTRACT — imported from photorealism-prompt:
${PHOTOREALISM_REQUIREMENT}

STUDIO AND LIGHTING CONTRACT — imported from Studio OS:
${STUDIO_ENVIRONMENT}
${STUDIO_REINFORCEMENT}

INSPECTION RULES:
1. Set observedView from visible camera evidence, not the file name or expected label.
2. Mark a contract "pass" only when the pixels affirmatively prove it. If cropped, hidden, unreadable or ambiguous, use "uncertain" — never give benefit of the doubt.
3. cameraContract and framingContract grade the exact locked angle and frame-fill requirements above.
4. orientationContract must be "pass" for Driver, Passenger, Front and Rear; it must be "not_applicable" for Hood, Close-Up and Roof.
5. roofBoundaryContract must be "pass" for Roof and "not_applicable" for every other view.
6. photorealismContract grades real automotive photography, installed cast vinyl, coherent geometry and physical materials.
7. studioLightingContract grades the identical premium wrap-shop environment and its bright color-accurate lighting. Camera-specific tight crops need not reveal floor or walls when the angle contract excludes them.
8. atlasContinuityContract compares the candidate artwork only to the exact attached ${authoritySurface} crop. New art, missing dominant motifs, moved/re-scaled brand elements, a different layout/palette, copied content from another zone or an independently designed surface is a failure.
9. vehicleContinuityContract grades the exact vehicle body/cab/bed configuration and plausible anatomy.
10. artifactFreeContract fails melted bodywork, extra wheels, duplicated parts, malformed lettering, impossible panel lines, phantom reflections or other AI artifacts.
11. Echo the proof, canonical Atlas and exact surface-authority sha256 values exactly. Return only the schema-bound JSON object. No Markdown or prose.
`;
}

function responseSchema({ expectedView, proofHash, atlasHash, authorityHash }) {
  const status = { type: "STRING", enum: [...STATUS] };
  return {
    type: "OBJECT",
    propertyOrdering: [...RESPONSE_FIELDS],
    properties: {
      contract: { type: "STRING", enum: [QC_CONTRACT] },
      proofSha256: { type: "STRING", enum: [proofHash] },
      atlasSha256: { type: "STRING", enum: [atlasHash] },
      authoritySha256: { type: "STRING", enum: [authorityHash] },
      expectedView: { type: "STRING", enum: [expectedView] },
      observedView: { type: "STRING", enum: [...OBSERVED_VIEW_VALUES] },
      cameraContract: status,
      framingContract: status,
      orientationContract: status,
      roofBoundaryContract: status,
      photorealismContract: status,
      studioLightingContract: status,
      atlasContinuityContract: status,
      vehicleContinuityContract: status,
      artifactFreeContract: status,
      confidence: { type: "NUMBER", minimum: 0, maximum: 1 },
      reasons: { type: "ARRAY", maxItems: 8, items: { type: "STRING" } },
    },
    required: [...RESPONSE_FIELDS],
  };
}

async function assertDecodable(bytes, label) {
  try {
    const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 }).metadata();
    if (!metadata.width || !metadata.height) throw new Error("missing dimensions");
    return { width: metadata.width, height: metadata.height };
  } catch (error) {
    throw new AtlasProofQcError("atlas_qc_image_invalid", `${label} is not a decodable image: ${cleanText(error?.message || error, 160)}`);
  }
}

async function boundedJpegTransport(bytes, maxBytes, label) {
  const dimensions = await assertDecodable(bytes, label);
  const widths = [MAX_TRANSPORT_DIMENSION, 1400, 1200, 1024];
  const qualities = [86, 80, 74, 68];
  for (const width of widths) {
    for (const quality of qualities) {
      const transport = await sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 })
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toBuffer();
      if (transport.length <= maxBytes) {
        return {
          bytes: transport,
          contentType: "image/jpeg",
          originalDimensions: dimensions,
          transportDimensions: await assertDecodable(transport, `${label} transport`),
          derived: true,
        };
      }
    }
  }
  throw new AtlasProofQcError("atlas_qc_transport_too_large", `${label} could not fit the bounded visual-inspection transport`);
}

async function atlasTransport(atlas, sourceViewType) {
  const authority = atlas?.viewAuthorities?.[sourceViewType];
  const expectedSurface = {
    side: "driver", "passenger-side": "passenger", hood_detail: "hood",
    front: "front", rear: "rear", "close-up": "driver", roof: "roof",
  }[sourceViewType];
  if (!authority || authority.contract !== "designpro.flat-first-atlas-view-authority.v1"
    || authority.sourceViewType !== sourceViewType
    || authority.surfaceKey !== expectedSurface
    || authority.sourceMasterHash !== atlas?.master?.contentHash) {
    throw new AtlasProofQcError(
      "atlas_qc_view_authority_invalid",
      `${sourceViewType}: exact ${expectedSurface || "unknown"} Atlas authority is missing or stale`,
    );
  }
  const bytes = requireBuffer(authority.bytes, `${sourceViewType} Atlas authority`);
  const contentType = requireContentType(authority.contentType, `${sourceViewType} Atlas authority`);
  const hash = requireHash(bytes, authority.contentHash, `${sourceViewType} Atlas authority`);
  const dimensions = await assertDecodable(bytes, `${sourceViewType} Atlas authority`);
  if (bytes.length <= MAX_ATLAS_TRANSPORT_BYTES) {
    return {
      bytes, contentType, hash, surfaceKey: expectedSurface,
      originalDimensions: dimensions, transportDimensions: dimensions, derived: false,
    };
  }
  return {
    ...(await boundedJpegTransport(bytes, MAX_ATLAS_TRANSPORT_BYTES, `${sourceViewType} Atlas authority`)),
    hash,
    surfaceKey: expectedSurface,
  };
}

function makeBody({
  prompt, candidate, atlasImage, sourceViewType, proofHash, atlasHash, authorityHash,
}) {
  const expectedView = VIEW_CONTRACTS[sourceViewType].label;
  return {
    contents: [{
      role: "user",
      parts: [
        { text: `${prompt}\n\nIMAGE 1 — CANDIDATE PROOF TO GRADE (original sha256 ${proofHash}):` },
        { inlineData: { mimeType: candidate.contentType, data: candidate.bytes.toString("base64") } },
        { text: `IMAGE 2 — EXACT ${atlasImage.surfaceKey.toUpperCase()} ZONE CROP, SOLE ARTWORK AUTHORITY (original sha256 ${authorityHash}; canonical Atlas sha256 ${atlasHash}):` },
        { inlineData: { mimeType: atlasImage.contentType, data: atlasImage.bytes.toString("base64") } },
      ],
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1536,
      responseMimeType: "application/json",
      responseSchema: responseSchema({ expectedView, proofHash, atlasHash, authorityHash }),
    },
  };
}

async function buildAtlasProofQcRequest({
  atlas,
  bytes,
  contentType,
  sourceViewType,
  input,
  maxRequestBytes = MAX_REQUEST_BYTES,
}) {
  const configuredBudget = Number(maxRequestBytes);
  if (!Number.isFinite(configuredBudget) || configuredBudget < 1024) {
    throw new AtlasProofQcError("atlas_qc_request_budget_invalid", "A.T.L.A.S. proof inspection requires a finite request budget of at least 1024 bytes");
  }
  // This module owns the hard provider ceiling. A caller may lower it for a
  // deployment/test, but may never raise it past the safe server budget.
  const requestBudget = Math.min(configuredBudget, MAX_REQUEST_BYTES);
  const view = VIEW_CONTRACTS[sourceViewType];
  if (!view) throw new AtlasProofQcError("atlas_qc_view_invalid", `${sourceViewType || "missing"} is not one of the seven A.T.L.A.S. proof views`);
  const proofBytes = requireBuffer(bytes, "candidate proof");
  const proofContentType = requireContentType(contentType, "candidate proof");
  const proofHash = sha256(proofBytes);
  const proofDimensions = await assertDecodable(proofBytes, "candidate proof");
  const projectionBytes = requireBuffer(atlas?.projection?.bytes, "canonical Atlas projection");
  const atlasHash = requireHash(
    projectionBytes,
    atlas?.projection?.contentHash,
    "canonical Atlas projection",
  );
  const canonical = await atlasTransport(atlas, sourceViewType);
  const prompt = buildAtlasProofQcPrompt({
    sourceViewType,
    input,
    atlas,
    proofHash,
    atlasHash,
    authorityHash: canonical.hash,
    authoritySurface: canonical.surfaceKey,
  });

  let candidate = {
    bytes: proofBytes,
    contentType: proofContentType,
    originalDimensions: proofDimensions,
    transportDimensions: proofDimensions,
    derived: false,
  };
  let body = makeBody({
    prompt,
    candidate,
    atlasImage: canonical,
    sourceViewType,
    proofHash,
    atlasHash,
    authorityHash: canonical.hash,
  });
  let requestByteSize = Buffer.byteLength(JSON.stringify(body));

  // Preserve the exact generated bytes whenever they fit. Only a candidate
  // that would breach the model's request ceiling is converted to a bounded,
  // orientation-normalized visual transport; its original hash remains the
  // identity the reviewer must echo.
  if (requestByteSize > requestBudget) {
    candidate = await boundedJpegTransport(proofBytes, MAX_CANDIDATE_TRANSPORT_BYTES, "candidate proof");
    body = makeBody({
      prompt,
      candidate,
      atlasImage: canonical,
      sourceViewType,
      proofHash,
      atlasHash,
      authorityHash: canonical.hash,
    });
    requestByteSize = Buffer.byteLength(JSON.stringify(body));
  }
  if (requestByteSize > requestBudget) {
    throw new AtlasProofQcError(
      "atlas_qc_request_too_large",
      `A.T.L.A.S. proof inspection request is ${requestByteSize} bytes, above the ${requestBudget}-byte server budget`,
    );
  }

  return {
    body,
    metadata: {
      contract: QC_CONTRACT,
      expectedView: view.label,
      proofHash,
      atlasHash,
      authorityHash: canonical.hash,
      zoneHash: canonical.hash,
      zoneSurfaceKey: canonical.surfaceKey,
      requestByteSize,
      candidateTransportDerived: candidate.derived,
      atlasTransportDerived: canonical.derived,
      candidateOriginalDimensions: candidate.originalDimensions,
      candidateTransportDimensions: candidate.transportDimensions,
      atlasOriginalDimensions: canonical.originalDimensions,
      atlasTransportDimensions: canonical.transportDimensions,
    },
  };
}

function responseText(payload) {
  const candidate = payload?.candidates?.[0];
  const finishReason = String(candidate?.finishReason || "");
  if (finishReason && finishReason !== "STOP") {
    throw new AtlasProofQcError("atlas_qc_analyzer_incomplete", `Proof inspector stopped with ${cleanText(finishReason, 80)}`);
  }
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  if (parts.some((part) => part?.inlineData || part?.functionCall || part?.functionResponse)) {
    throw new AtlasProofQcError("atlas_qc_response_malformed", "Proof inspector returned a non-JSON response part");
  }
  const texts = parts.filter((part) => typeof part?.text === "string").map((part) => part.text);
  if (texts.length !== 1) {
    throw new AtlasProofQcError("atlas_qc_response_malformed", `Proof inspector returned ${texts.length} text parts instead of one JSON object`);
  }
  const text = texts[0].trim();
  if (!text || Buffer.byteLength(text) > MAX_RESPONSE_TEXT_BYTES) {
    throw new AtlasProofQcError("atlas_qc_response_malformed", "Proof inspector returned an empty or oversized JSON response");
  }
  return text;
}

function parseAtlasProofQcResponse(payload, expected) {
  let review;
  try {
    review = JSON.parse(responseText(payload));
  } catch (error) {
    if (error instanceof AtlasProofQcError) throw error;
    throw new AtlasProofQcError("atlas_qc_response_malformed", "Proof inspector response was not exact JSON");
  }
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    throw new AtlasProofQcError("atlas_qc_response_malformed", "Proof inspector JSON was not an object");
  }
  const keys = Object.keys(review).sort();
  const expectedKeys = [...RESPONSE_FIELDS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new AtlasProofQcError("atlas_qc_response_malformed", "Proof inspector JSON fields did not match the locked schema");
  }
  if (review.contract !== QC_CONTRACT
    || review.proofSha256 !== expected.proofHash
    || review.atlasSha256 !== expected.atlasHash
    || review.authoritySha256 !== expected.authorityHash
    || review.expectedView !== expected.expectedView) {
    throw new AtlasProofQcError("atlas_qc_response_identity_mismatch", "Proof inspector response did not bind to this proof, Atlas and expected view");
  }
  const contractFields = RESPONSE_FIELDS.filter((field) => /Contract$/.test(field) && field !== "contract");
  for (const field of contractFields) {
    if (!STATUS.includes(review[field])) {
      throw new AtlasProofQcError("atlas_qc_response_malformed", `${field} is not a locked inspection status`);
    }
  }
  if (!Number.isFinite(review.confidence) || review.confidence < 0 || review.confidence > 1) {
    throw new AtlasProofQcError("atlas_qc_response_malformed", "Proof inspector confidence must be between zero and one");
  }
  if (!Array.isArray(review.reasons) || review.reasons.length > 8
    || review.reasons.some((reason) => typeof reason !== "string" || !cleanText(reason, 240))) {
    throw new AtlasProofQcError("atlas_qc_response_malformed", "Proof inspector reasons must be a bounded string array");
  }
  return review;
}

function rejectionFor(review, expected, confidenceThreshold) {
  const failure = (field) => review[field] !== "pass";
  const irrelevantFailure = (field) => review[field] !== "not_applicable";
  let code = null;
  if (review.observedView !== expected.expectedView) code = "atlas_qc_view_mismatch";
  else if (failure("cameraContract") || failure("framingContract")) code = "atlas_qc_camera_failed";
  else if (expected.orientation === "pass" ? failure("orientationContract") : irrelevantFailure("orientationContract")) code = "atlas_qc_orientation_failed";
  else if (expected.roofBoundary === "pass" ? failure("roofBoundaryContract") : irrelevantFailure("roofBoundaryContract")) code = "atlas_qc_roof_boundary_failed";
  else if (failure("atlasContinuityContract")) code = "atlas_qc_design_drift";
  else if (failure("vehicleContinuityContract")) code = "atlas_qc_vehicle_failed";
  else if (failure("photorealismContract")) code = "atlas_qc_photorealism_failed";
  else if (failure("studioLightingContract")) code = "atlas_qc_studio_failed";
  else if (failure("artifactFreeContract")) code = "atlas_qc_artifacts_detected";
  else if (review.confidence < confidenceThreshold) code = "atlas_qc_uncertain";

  if (!code) return null;
  const modelReasons = review.reasons.map((reason) => cleanText(reason, 240)).filter(Boolean);
  const statuses = RESPONSE_FIELDS
    .filter((field) => /Contract$/.test(field) && field !== "contract" && review[field] !== "pass" && review[field] !== "not_applicable")
    .map((field) => `${field}=${review[field]}`);
  const reason = [...statuses, ...modelReasons].join("; ").slice(0, 500)
    || `A.T.L.A.S. proof inspection rejected ${expected.expectedView}`;
  return { accepted: false, code, reason, review };
}

function createAtlasProofValidator({
  provider,
  atlas,
  input,
  model = DEFAULT_QC_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
  maxRequestBytes = MAX_REQUEST_BYTES,
} = {}) {
  if (!provider || typeof provider.generateRaw !== "function") {
    throw new AtlasProofQcError("atlas_qc_provider_invalid", "A.T.L.A.S. semantic QC requires the server provider.generateRaw seam");
  }
  if (!atlas) throw new AtlasProofQcError("atlas_qc_atlas_missing", "A.T.L.A.S. semantic QC requires the immutable flattened Atlas");
  if (!/^gemini-[a-z0-9.-]+$/.test(String(model)) || /image/.test(String(model))) {
    throw new AtlasProofQcError("atlas_qc_model_invalid", `${model} is not an explicit Gemini multimodal inspection model`);
  }
  const threshold = Number(confidenceThreshold);
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 1) {
    throw new AtlasProofQcError("atlas_qc_threshold_invalid", "A.T.L.A.S. proof QC confidence threshold must be between 0.5 and 1");
  }
  const boundedTimeoutMs = Number(timeoutMs);
  if (!Number.isFinite(boundedTimeoutMs) || boundedTimeoutMs < 1_000 || boundedTimeoutMs > 60_000) {
    throw new AtlasProofQcError("atlas_qc_timeout_invalid", "A.T.L.A.S. proof QC timeout must be between 1000 and 60000 milliseconds");
  }

  return async function validateAtlasProof({ bytes, contentType, sourceViewType, signal } = {}) {
    try {
      const request = await buildAtlasProofQcRequest({
        atlas,
        bytes,
        contentType,
        sourceViewType,
        input,
        maxRequestBytes,
      });
      const result = await provider.generateRaw({
        model,
        body: request.body,
        signal,
        timeoutMs: boundedTimeoutMs,
        label: `A.T.L.A.S. ${request.metadata.expectedView} semantic QC`,
      });
      const review = parseAtlasProofQcResponse(result?.payload, request.metadata);
      const rejection = rejectionFor(
        review,
        { ...VIEW_CONTRACTS[sourceViewType], expectedView: request.metadata.expectedView },
        threshold,
      );
      if (rejection) return rejection;
      return {
        accepted: true,
        code: null,
        reason: null,
        review,
        metadata: {
          ...request.metadata,
          model: result?.model || model,
          keyFingerprint: result?.keyFingerprint || null,
          confidence: review.confidence,
        },
      };
    } catch (error) {
      const known = error instanceof AtlasProofQcError;
      return {
        accepted: false,
        code: known ? error.code : "atlas_qc_analyzer_failed",
        reason: cleanText(known ? error.message : `A.T.L.A.S. proof inspector failed: ${error?.message || error}`, 500),
      };
    }
  };
}

module.exports = {
  AtlasProofQcError,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_QC_MODEL,
  MAX_REQUEST_BYTES,
  QC_CONTRACT,
  VIEW_CONTRACTS,
  buildAtlasProofQcPrompt,
  buildAtlasProofQcRequest,
  createAtlasProofValidator,
  parseAtlasProofQcResponse,
  _test: {
    MAX_ATLAS_TRANSPORT_BYTES,
    MAX_CANDIDATE_TRANSPORT_BYTES,
    MAX_RESPONSE_TEXT_BYTES,
    OBSERVED_VIEW_VALUES,
    RESPONSE_FIELDS,
    STATUS,
    atlasTransport,
    boundedJpegTransport,
    rejectionFor,
    responseSchema,
    sha256,
  },
};
