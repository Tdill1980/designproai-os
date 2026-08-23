"use strict";

/**
 * Server-native Standard DesignPanel provider.
 *
 * The stage names remain the product contract:
 *   design-panel-ai-generate -> generate-color-render
 * They are not Supabase Function calls here. The standalone runtime sends the
 * proven prompts directly through its own Gemini provider pool. View 1 invents
 * the design; every later view is conditioned on the verified immutable View 1
 * winner and changes only the camera.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { canonicalizeVehicle, briefWantsPhoto, truckBedClause } = require("./designiq-prompt.cjs");
const angles = require("./view-angles.cjs");
const {
  PHOTOREALISM_CONTRACT_VERSION,
  PHOTOREALISM_REQUIREMENT,
} = require("./photorealism-prompt.cjs");
const {
  STUDIO_CONTRACT_VERSION,
  STUDIO_ENVIRONMENT,
  STUDIO_REINFORCEMENT,
} = require("./studio-os.cjs");

const BUCKET = "wrap-files";
const SERVER_PROVIDER_CONTRACT = "designpro.designpanel-server-provider.v1";
const ATLAS_SERVER_PROVIDER_CONTRACT = "designpro.atlas-designpanel-server-provider.v1";
const ARTIFACT_AUDIT_CONTRACT = "designpro.generation-artifact-audit.v1";
const HERO_VIEW = "side";
const DRIVER_VIEW = "side";
const PASSENGER_VIEW = "passenger-side";
const ATLAS_VIEW_SURFACES = Object.freeze({
  side: "driver",
  "passenger-side": "passenger",
  hood_detail: "hood",
  front: "front",
  rear: "rear",
  "close-up": "driver",
  roof: "roof",
});
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
// Gemini rejects generateContent request bodies at 20 MiB. The body includes
// base64 expansion and prompt JSON, so leave a deterministic envelope rather
// than comparing only decoded image bytes against the provider limit.
const GEMINI_REQUEST_LIMIT_BYTES = 20 * 1024 * 1024;
const GEMINI_REQUEST_SAFETY_BYTES = 256 * 1024;
const MAX_ATLAS_REQUEST_BYTES = GEMINI_REQUEST_LIMIT_BYTES - GEMINI_REQUEST_SAFETY_BYTES;
const MAX_ATLAS_DRIVER_REFERENCE_BYTES = 1_500_000;
const MAX_ATLAS_DRIVER_REFERENCE_EDGE = 1280;
const MAX_PASSENGER_EDGE = 2560;
const PASSENGER_TEXT_FIX_TIMEOUT_MS = 90_000;
const ORIENTATION_W = 64;
const ORIENTATION_H = 32;
const PASSENGER_FRAMING_W = 96;
const PASSENGER_FRAMING_H = 54;
const MAX_PASSENGER_FRAMING_MAE = 0.18;
const STANDARD_QC_MODEL = "gemini-2.5-flash";
const STANDARD_QC_TIMEOUT_MS = 45_000;
const STANDARD_QC_CONFIDENCE = 0.9;
const FINISH_SPEC = Object.freeze({
  gloss: "High-gloss laminate — shiny wet-look surface with crisp reflections.",
  matte: "Matte laminate — completely flat, zero reflections, velvet appearance.",
  satin: "Satin laminate — soft sheen between matte and gloss, silk-like.",
});

// Exact production coverage contract from
// supabase/functions/_shared/view-angles-os.ts. Atlas changes the artwork
// authority, never what a real installer may wrap.
const WRAP_COVERAGE_RULES = `
WRAP COVERAGE — MANDATORY:
The vinyl wrap covers ONLY painted body panels. The following areas must remain UNWRAPPED and show their original factory appearance:
- Grille / front grille mesh — NOT wrapped, factory appearance
- Manufacturer emblems and badges (Ford, Chevy, RAM, etc.) — NOT wrapped, visible
- Windshield — NOT wrapped, clear glass
- Driver and passenger side windows — NOT wrapped, clear glass
- Rear window — NOT wrapped, clear glass
- Headlights and taillights — NOT wrapped, factory appearance
- Wheels, tires, wheel wells — NOT wrapped
- Door handles — NOT wrapped
- Side mirrors — NOT wrapped
- Chrome trim, rain gutters, antenna — NOT wrapped
TRUCK BED: on a pickup, the wrap covers the outer painted panels — cab, bed sides, and tailgate exterior; the open bed interior stays bare factory bedliner.
This is how real vehicle wraps work. Vinyl goes on painted body panels only.
`;

// Camera/framing-only reinforcement. Artwork is supplied by the exact native
// Atlas zone crop; adding logo/layout/flow instructions here would become a
// second design prompt and let each proof invent a different wrap.
const VIEW_REINFORCEMENT = Object.freeze({
  // Keep the DesignPanel detail treatment, but never contradict the locked
  // 18-inch view-angles-os camera with either historical 12-inch or 3-5-foot
  // duplicate framing. The imported angle contract remains authoritative.
  "close-up": " This is a CLOSE-UP design-detail photograph at the locked camera distance above. Show the vinyl texture grain, laminate sheen, ink depth, printed pattern, color transitions or artwork conforming to the body curve. A body line, panel edge or door handle may provide scale. The wrap design fills 90%+ of frame. This is NOT a full vehicle shot and NOT a three-quarter vehicle view.",
  "passenger-side": " This is the PASSENGER SIDE of the vehicle — the opposite side from the driver. The vehicle faces RIGHT in frame (nose pointing right). All text and lettering reads correctly left-to-right, NEVER mirrored. Show the passenger-side wheels.",
  roof: " This is a TOP-DOWN ROOF view — camera is DIRECTLY ABOVE the vehicle pointing straight down at 90 degrees. Orthographic flat top-down, NOT tilted and NOT angled. Frame only the roof/cab-top panel between windshield and rear glass. Crop tightly so that panel fills the frame. Exclude hood, front end, cargo bed, tailgate, wheels, mirrors, vehicle sides, floor and walls.",
  hood_detail: " This is a TOP-DOWN HOOD view — camera is DIRECTLY ABOVE the hood pointing straight down. Orthographic flat overhead, NOT a 3/4 glamour shot. Frame only the hood between windshield base and front bumper edge, with the hood filling the frame.",
  front: " This is a STRAIGHT-ON FRONT view — camera is DIRECTLY in front at grille/bumper height, perpendicular and perfectly symmetrical. NOT a 3/4 angle, rotated or tilted view. Frame grille, both headlights, hood edge, front bumper and windshield head-on, with the front filling the frame.",
  rear: " This is a STRAIGHT-ON REAR view — camera is DIRECTLY behind at tailgate/bumper height, perpendicular and perfectly symmetrical. NOT a 3/4 angle, rotated or tilted view. Frame rear glass/tailgate, both tail lights and rear bumper head-on, with the rear filling the frame.",
});

// Ported from app/src/utils/passenger-mirror.ts. The server calls Gemini
// directly for the same surgical text repair; it does not invoke revise-render
// or any other Edge Function.
const PASSENGER_TEXT_FIX_PROMPT = `This is a horizontally mirrored vehicle wrap. All text, lettering, numbers, URLs, and logos are BACKWARDS (mirror-reversed). Your ONLY task: flip every text/lettering element so it reads correctly left-to-right. Do NOT change the vehicle, design, colors, patterns, background, or any non-text element. CRITICAL: Keep the EXACT same straight-on side camera angle — do NOT rotate, tilt, or change the perspective in any way. The output must be a perfectly flat, straight-on side view identical to the input framing. Output the corrected image.

KEEP THE FRAMING IDENTICAL: match the attached image's exact camera angle, zoom, crop, distance, and vehicle position. Do not re-frame, zoom, reposition, or recompose the shot. This is an EDIT of the attached photo — apply the design changes requested above directly onto it.`;

// The deterministic mirror already contains the accepted vehicle, wrap and
// photography. These imported production contracts are preservation checks in
// the surgical text edit, never permission to relight or redesign the pixels.
const PASSENGER_TEXT_FIX_WITH_PRODUCTION_LOCKS = `${PASSENGER_TEXT_FIX_PROMPT}

PRESERVATION-ONLY CAMERA CONTRACT — the input already satisfies this; do not re-render or reframe it:
${angles.cameraAngle(PASSENGER_VIEW)}

PRESERVATION-ONLY STUDIO/LIGHTING CONTRACT — retain the input's existing studio and lighting pixel-for-pixel except corrected glyphs:
${STUDIO_ENVIRONMENT}
${STUDIO_REINFORCEMENT}

PRESERVATION-ONLY PHOTOGRAPHY CONTRACT — retain the input's existing vehicle/vinyl photography pixel-for-pixel except corrected glyphs:
${PHOTOREALISM_REQUIREMENT}`;

function passengerTextFixPrompt(atlasAuthority = null) {
  if (!atlasAuthority) return PASSENGER_TEXT_FIX_WITH_PRODUCTION_LOCKS;
  return `${PASSENGER_TEXT_FIX_WITH_PRODUCTION_LOCKS}

IMAGE 1 is the deterministic opposite-facing mirror whose vehicle geometry, camera and framing must stay pixel-identical. IMAGE 2 is the exact accepted PASSENGER native-zone crop from the flattened A.T.L.A.S. master (sha256 ${atlasAuthority.contentHash}). Use IMAGE 2 only as the forward-reading glyph and passenger-artwork identity authority. It is NOT permission to recompose IMAGE 1. The accepted master guarantees Passenger is mirror-compatible with Driver; preserve IMAGE 1's non-text pixels and placement, correct its glyphs to the exact forward-reading passenger identity, and invent nothing.`;
}

const PASSENGER_TEXT_FIX_SYSTEM_INSTRUCTION = {
  parts: [{
    text: "You are a master vehicle-wrap designer revising the attached wrap proof. Read the user's full request and EXECUTE EVERY change they ask for the way an experienced designer would — including substantial ones: recoloring zones, changing where the wrap covers or stops, removing the wrap from a panel, resizing or repositioning graphics and logos, and following hand-drawn lines/marks on any reference image that show where the wrap should cut off or how it should lay. Do the complete request, not just the first part. ABSOLUTE RULE 1 (PRESERVE THE UNMENTIONED): Any design element the user does NOT mention — other panels, colors, finishes, existing text, logos, graphics, the background — stays exactly as it is in the input. Change what they asked for; leave the rest untouched. ABSOLUTE RULE 2 (CAMERA + VEHICLE): Keep the EXACT camera angle, perspective, framing, and field of view, and the vehicle's make/model, body shape, panels, windows, wheels, and proportions identical to the input. Never rotate, tilt, or change the viewing angle or the vehicle itself. Return the edited image.",
  }],
};

class DesignPanelServerError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function populated(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(String(value || "").trim());
}

async function standardProofTransport(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) {
    throw new DesignPanelServerError("designpanel_quality_image_missing", "Standard proof bytes are required", false);
  }
  return sharp(bytes, { limitInputPixels: false })
    .rotate()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

function standardProofQcPrompt({ input = {}, sourceViewType, inspectionId }) {
  const vehicle = input.vehicle && typeof input.vehicle === "object" ? input.vehicle : {};
  const vehicleName = [vehicle.year, vehicle.make, vehicle.model, vehicle.type].filter(Boolean).join(" ");
  const businessName = String(input.companyName || input.businessName || input.business || "").trim();
  const phone = String(input.phone || "").trim();
  const website = String(input.website || "").trim();
  const photoRequired = briefWantsPhoto(String(input.brief || input.designBrief || input.description || ""));
  const pickup = Boolean(truckBedClause(vehicleName));
  return `Inspect the attached Standard DesignProAI vehicle-wrap proof. Be strict: this is a release gate, not design feedback.
Inspection identity: ${inspectionId}
Expected view: ${angles.viewLabel(sourceViewType)} (${sourceViewType})
Expected vehicle: ${vehicleName || "the specified vehicle"}
Exact business name: ${businessName || "none supplied"}
Exact phone: ${phone || "none supplied"}
Exact website: ${website || "none supplied"}
Uploaded customer logo supplied: ${input.logoAsset ? "yes — logo must look intentionally placed and faithful, not substituted" : "no — generated logo must still be distinctive and industry-specific"}
Photographic subject explicitly required by brief: ${photoRequired ? "yes — it must look like a real high-resolution photograph, not illustration or AI mush" : "no"}
Pickup-bed rule applies: ${pickup ? "yes — open bed floor, inner walls, rails and wheel-well humps must show bare factory bedliner with zero artwork" : "no"}

Reject if any visible customer wording is backwards, misspelled, replaced or unreadable. Reject generic/stock/template branding, malformed logos, incoherent imagery, fake lettering, obvious AI artifacts, a wrong vehicle, a wrong camera, an unprofessional wrap, artwork on glass/lights/wheels/trim, or artwork inside an open pickup bed. The result must be a photorealistic installed-vinyl studio proof. Return exactly one JSON object and no markdown:
{"inspectionId":"${inspectionId}","cameraPass":boolean,"vehiclePass":boolean,"customerTextPass":boolean,"logoPass":boolean,"requestedPhotoPass":boolean,"professionalDesignPass":boolean,"photorealismPass":boolean,"studioPass":boolean,"wrapCoveragePass":boolean,"pickupBedPass":boolean,"confidence":number,"reasons":[string]}`;
}

function standardProofQcReview(payload, inspectionId) {
  const candidate = payload?.candidates?.[0];
  if (String(candidate?.finishReason || "").toUpperCase() !== "STOP") {
    throw new DesignPanelServerError("designpanel_quality_incomplete", "Standard proof inspector did not finish", true);
  }
  const texts = (candidate?.content?.parts || []).filter((part) => typeof part?.text === "string");
  if (texts.length !== 1 || Buffer.byteLength(texts[0].text, "utf8") > 16 * 1024) {
    throw new DesignPanelServerError("designpanel_quality_response_invalid", "Standard proof inspector returned an invalid response", true);
  }
  let review;
  try { review = JSON.parse(texts[0].text.trim()); } catch {
    throw new DesignPanelServerError("designpanel_quality_response_invalid", "Standard proof inspector response was not JSON", true);
  }
  const fields = [
    "cameraPass", "vehiclePass", "customerTextPass", "logoPass", "requestedPhotoPass",
    "professionalDesignPass", "photorealismPass", "studioPass", "wrapCoveragePass", "pickupBedPass",
  ];
  if (review?.inspectionId !== inspectionId
    || fields.some((field) => typeof review?.[field] !== "boolean")
    || !Number.isFinite(Number(review?.confidence))
    || !Array.isArray(review?.reasons)) {
    throw new DesignPanelServerError("designpanel_quality_response_invalid", "Standard proof inspector fields were invalid", true);
  }
  const failed = fields.filter((field) => review[field] !== true);
  if (failed.length || Number(review.confidence) < STANDARD_QC_CONFIDENCE) {
    throw new DesignPanelServerError(
      "designpanel_quality_rejected",
      `Standard proof rejected: ${[...failed, ...review.reasons].join("; ")}`.slice(0, 700),
      true,
    );
  }
  return review;
}

async function inspectStandardProof({ provider, input, sourceViewType, bytes, signal }) {
  if (!provider || typeof provider.generateRaw !== "function") {
    throw new DesignPanelServerError("designpanel_quality_transport_missing", "Standard proof QC requires provider.generateRaw", false);
  }
  const inspectionId = sha256(bytes);
  const transport = await standardProofTransport(bytes);
  const result = await provider.generateRaw({
    model: STANDARD_QC_MODEL,
    body: {
      contents: [{ parts: [
        { inlineData: { mimeType: "image/jpeg", data: transport.toString("base64") } },
        { text: standardProofQcPrompt({ input, sourceViewType, inspectionId }) },
      ] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    },
    signal,
    timeoutMs: STANDARD_QC_TIMEOUT_MS,
    label: `Standard ${angles.viewLabel(sourceViewType)} semantic QC`,
  });
  return standardProofQcReview(result?.payload, inspectionId);
}

/** Artifact-level evidence required to compare a run with the Porsche baseline. */
function proofPromptAudit({ input = {}, sourceViewType, prompt, renderMethod }) {
  const vehicle = input.vehicle && typeof input.vehicle === "object" ? input.vehicle : {};
  const promptText = String(prompt || "");
  const companyPresent = populated(input.companyName || input.businessName || input.business);
  const logoPresent = Boolean(input.logoAsset);
  const phonePresent = populated(input.phone);
  const websitePresent = populated(input.website);
  return {
    contract: ARTIFACT_AUDIT_CONTRACT,
    sourceViewType,
    renderMethod,
    promptHash: sha256(Buffer.from(promptText, "utf8")),
    promptLength: Buffer.byteLength(promptText, "utf8"),
    studioContractVersion: STUDIO_CONTRACT_VERSION,
    viewAngleContractVersion: angles.VIEW_ANGLE_CONTRACT_VERSION,
    photographyContractVersion: PHOTOREALISM_CONTRACT_VERSION,
    structuredInputs: {
      brief: populated(input.brief || input.designBrief || input.description),
      vehicleYear: populated(vehicle.year),
      vehicleMake: populated(vehicle.make),
      vehicleModel: populated(vehicle.model),
      vehicleType: populated(vehicle.type),
      companyName: companyPresent,
      industry: populated(input.industry),
      colors: populated(input.colors) || populated(input.brandColors),
      style: populated(input.style) || populated(input.styleDescriptors),
      phone: phonePresent,
      website: websitePresent,
      logo: logoPresent,
      visionBoardImageCount: Array.isArray(input.visionBoardImages) ? input.visionBoardImages.length : 0,
      bulletPointCount: Array.isArray(input.bulletPoints) ? input.bulletPoints.length : 0,
      mascot: populated(input.mascot),
    },
    brandingPresent: companyPresent || logoPresent,
    phonePresent,
    logoPresent,
  };
}

function vehicleDescription(input) {
  const vehicleInput = input?.vehicle || {};
  const makeModel = canonicalizeVehicle(vehicleInput.make, vehicleInput.model, vehicleInput.year)
    || [vehicleInput.make, vehicleInput.model].filter(Boolean).join(" ");
  return [vehicleInput.year, makeModel, vehicleInput.type]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ") || "the exact requested vehicle";
}

function pickupVehicle(input) {
  return /\b(pickup|truck|f[- ]?\d{3}|silverado|sierra|tacoma|tundra|ridgeline|ranger|colorado|canyon|frontier|titan|ram|gladiator|maverick)\b/i
    .test(vehicleDescription(input));
}

function atlasIdentity(atlas = {}) {
  const authority = atlas.authorityMetadata && typeof atlas.authorityMetadata === "object"
    ? atlas.authorityMetadata
    : {};
  return Object.freeze({
    masterContentHash: String(atlas.masterContentHash || authority.masterContentHash || "").toLowerCase(),
    projectionContentHash: String(atlas.projectionContentHash || authority.projectionContentHash || "").toLowerCase(),
    manifestContentHash: String(atlas.manifestContentHash || authority.manifestContentHash || "").toLowerCase(),
    revisionId: atlas.revisionId || authority.revisionId || null,
    revisionSequence: atlas.revisionSequence || authority.revisionSequence || null,
  });
}

async function atlasViewIdentity(atlas, sourceViewType) {
  const expectedSurface = ATLAS_VIEW_SURFACES[sourceViewType];
  if (!expectedSurface) {
    throw new DesignPanelServerError(
      "designpanel_atlas_view_invalid",
      `${sourceViewType || "missing"} is not one of Driver, Passenger, Hood, Front, Rear, Close-Up, Roof`,
      false,
    );
  }
  const source = atlas?.conditioningIdentityFor || atlas?.viewAuthorities;
  const candidate = typeof source === "function"
    ? await source(sourceViewType)
    : source?.[sourceViewType];
  const identity = atlasIdentity(atlas);
  if (!candidate || candidate.contract !== "designpro.flat-first-atlas-view-authority.v1"
    || candidate.sourceViewType !== sourceViewType
    || candidate.surfaceKey !== expectedSurface
    || candidate.sourceMasterHash !== identity.masterContentHash) {
    throw new DesignPanelServerError(
      "designpanel_atlas_view_authority_invalid",
      `${sourceViewType}: exact ${expectedSurface} authority is not bound to this master`,
      false,
    );
  }
  assertHash(candidate.contentHash, `${sourceViewType} Atlas zone hash`);
  return Object.freeze({
    contract: candidate.contract,
    sourceViewType,
    surfaceKey: expectedSurface,
    contentHash: String(candidate.contentHash).toLowerCase(),
    sourceMasterHash: identity.masterContentHash,
  });
}

function assertHash(value, label) {
  if (!/^[0-9a-f]{64}$/.test(String(value || ""))) {
    throw new DesignPanelServerError("designpanel_atlas_identity_invalid", `${label} is required`, false);
  }
}

function decodeInlineData(part) {
  const inlineData = part?.inlineData;
  const mimeType = String(inlineData?.mimeType || "").toLowerCase();
  const data = String(inlineData?.data || "");
  if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)
    || !data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new DesignPanelServerError(
      "designpanel_atlas_conditioning_invalid",
      "Atlas conditioning must contain one inline PNG, JPEG or WebP identity",
      false,
    );
  }
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length) {
    throw new DesignPanelServerError("designpanel_atlas_conditioning_invalid", "Atlas conditioning bytes are empty", false);
  }
  return { bytes, mimeType };
}

async function resolveAtlasConditioningParts(atlas, sourceViewType, callParts = null) {
  // generation-worker already constructs the master-bound, view-specific
  // Atlas projection parts on each slot. Preserve those exact call.parts by
  // default; an explicit factory callback is supported for direct callers and
  // focused tests, but neither path reconstructs the Atlas here.
  const source = (Array.isArray(callParts) && callParts.length)
    ? callParts
    : atlas.conditioningPartsFor || atlas.conditioningParts;
  const candidate = typeof source === "function" ? await source(sourceViewType) : source;
  if (!Array.isArray(candidate) || !candidate.length) {
    throw new DesignPanelServerError(
      "designpanel_atlas_conditioning_missing",
      `${sourceViewType}: immutable Atlas conditioning parts are required`,
      false,
    );
  }
  // One exact native surface crop is the complete artwork authority for this
  // proof. A second image here could silently become another design source.
  const imageParts = candidate.filter((part) => part?.inlineData);
  if (imageParts.length !== 1) {
    throw new DesignPanelServerError(
      "designpanel_atlas_conditioning_invalid",
      `${sourceViewType}: expected exactly one canonical Atlas image, received ${imageParts.length}`,
      false,
    );
  }
  const { bytes } = decodeInlineData(imageParts[0]);
  const identity = atlasIdentity(atlas);
  const viewIdentity = await atlasViewIdentity(atlas, sourceViewType);
  assertHash(identity.masterContentHash, "Atlas master hash");
  assertHash(identity.projectionContentHash, "Atlas projection hash");
  if (sha256(bytes) !== viewIdentity.contentHash) {
    throw new DesignPanelServerError(
      "designpanel_atlas_view_authority_hash_mismatch",
      `${sourceViewType}: Atlas conditioning bytes do not match the exact ${viewIdentity.surfaceKey} identity`,
      false,
    );
  }
  return candidate.map((part) => ({
    ...(part?.text == null ? {} : { text: String(part.text) }),
    ...(part?.inlineData ? { inlineData: { ...part.inlineData } } : {}),
  }));
}

async function compactAtlasDriverReference(bytes, options = {}) {
  const maxBytes = Math.min(
    MAX_ATLAS_DRIVER_REFERENCE_BYTES,
    Math.max(100_000, Number(options.maxBytes) || MAX_ATLAS_DRIVER_REFERENCE_BYTES),
  );
  const maxEdge = Math.min(
    MAX_ATLAS_DRIVER_REFERENCE_EDGE,
    Math.max(640, Number(options.maxEdge) || MAX_ATLAS_DRIVER_REFERENCE_EDGE),
  );
  const qualities = [88, 82, 75, 68, 60, 52];
  const edges = [...new Set([maxEdge, Math.min(maxEdge, 1120), Math.min(maxEdge, 960), 800, 640])]
    .filter((edge) => edge <= maxEdge);
  for (const edge of edges) {
    for (const quality of qualities) {
      const candidate = await sharp(bytes, { limitInputPixels: false })
        .rotate()
        .resize(edge, edge, { fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
        .jpeg({ quality, chromaSubsampling: "4:2:0", optimiseCoding: true })
        .toBuffer();
      if (candidate.length <= maxBytes) {
        return {
          mimeType: "image/jpeg",
          data: candidate.toString("base64"),
          byteSize: candidate.length,
          contentHash: sha256(candidate),
        };
      }
    }
  }
  throw new DesignPanelServerError(
    "designpanel_atlas_driver_reference_too_large",
    `The verified Driver anchor cannot be conditioned below ${maxBytes} bytes`,
    false,
  );
}

function estimatedGeminiImageRequestBytes({ parts, aspectRatio = "16:9", imageSize = "4K", responseModalities = ["TEXT", "IMAGE"], temperature = 1 }) {
  return Buffer.byteLength(JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      responseModalities,
      temperature,
      imageConfig: { aspectRatio, imageSize },
    },
  }));
}

function assertAtlasRequestWithinLimit(request, configuredMaxBytes = MAX_ATLAS_REQUEST_BYTES) {
  const maxBytes = Math.min(
    MAX_ATLAS_REQUEST_BYTES,
    Math.max(1, Number(configuredMaxBytes) || MAX_ATLAS_REQUEST_BYTES),
  );
  const byteSize = estimatedGeminiImageRequestBytes(request);
  if (byteSize > maxBytes) {
    throw new DesignPanelServerError(
      "designpanel_atlas_request_too_large",
      `Atlas projection request is ${byteSize} bytes; bounded maximum is ${maxBytes}`,
      false,
    );
  }
  return byteSize;
}

function buildAtlasProjectionPrompt({ input, sourceViewType, hasDriverAnchor, authorityIdentity = null }) {
  const vehicle = vehicleDescription(input);
  const finish = String(input?.finish || "Gloss");
  const finishSpec = FINISH_SPEC[finish.toLowerCase()] || FINISH_SPEC.gloss;
  const viewLabel = angles.viewLabel(sourceViewType).toLowerCase();
  const reinforcement = VIEW_REINFORCEMENT[sourceViewType] || "";
  const surfaceKey = authorityIdentity?.surfaceKey || ATLAS_VIEW_SURFACES[sourceViewType];
  const pickupRoofOverride = sourceViewType === "roof" && pickupVehicle(input)
    ? "\nPICKUP CAB-ROOF OVERRIDE: For this pickup, CAB ROOF ONLY between windshield and rear cab glass overrides the imported generalized phrase ‘A-pillars to trunk.’ The hood, complete front end, cargo bed/box, bedliner, tailgate, wheels, mirrors, body sides, floor and walls must be outside the frame."
    : "";
  const photoLock = briefWantsPhoto(String(input?.brief || ""))
    ? "\nPHOTOGRAPHIC REALISM LOCK: preserve photographic artwork in the Atlas as a real high-resolution color photograph; never turn it into illustration, vector art or clip-art."
    : "";
  const driverRole = hasDriverAnchor
    ? `\nThe second attached image is the byte-verified accepted Driver proof. Use it ONLY to keep the exact vehicle anatomy, wheelbase, cab/bed configuration, studio, lighting, physical vinyl finish and visible installed scale continuous. It is not permission to infer, redraw or replace hidden artwork; where the Driver proof and Atlas could be read differently, the Atlas wins.`
    : "\nNo prior 3D proof is attached to this first projection. Establish the Driver proof directly from the Atlas and the locked vehicle/camera/photography contracts below.";

  return `CAMERA ANGLE (LOCKED — read this FIRST):
${angles.cameraAngle(sourceViewType)}

Render the ${viewLabel} proof of this exact ${vehicle}. This is the sanctioned generate-color-render photography stage. It is texture projection from one already-approved design-panel-ai-generate flat master, NOT another design call.

ARTWORK AUTHORITY — NON-NEGOTIABLE:
The first attached image is the immutable A.T.L.A.S. native ${String(surfaceKey || "target").toUpperCase()} zone crop and the SOLE artwork authority for this proof. Project those exact pixels onto that corresponding painted surface. Preserve every color, photograph, pattern, gradient, graphic, logo, wordmark, character, spelling, relative scale, hierarchy and flow. Never redraw hidden content from Driver, borrow another master zone, redesign, reimagine, beautify, simplify, restyle, recolor, mirror, move, resize, substitute, autocomplete or invent. The crop is full-bleed behind future installer cut lines; mask it to factory glass/openings in the photo without relocating the master artwork.${driverRole}

VIEW FIDELITY — NON-NEGOTIABLE:
Reproduce the identical approved design on the same vehicle from the ${viewLabel} camera angle defined above.${reinforcement}
${pickupRoofOverride}
The artwork is LOCKED. Treat this as photographing one real wrapped vehicle while only the camera moves. The design does not change between angles.

Finish: ${finish.toUpperCase()} — ${finishSpec} Keep this finish identical across every view.

${WRAP_COVERAGE_RULES}
${truckBedClause(vehicle)}

${STUDIO_ENVIRONMENT}
${STUDIO_REINFORCEMENT}
${PHOTOREALISM_REQUIREMENT}

The exact vehicle, wrap, studio, lighting and finish remain continuous; only the camera moves. Output one 16:9 photorealistic vehicle proof only. Never output an installer map, panel sheet, dieline, labels, dimensions or annotations.${photoLock}`;
}

async function buildAtlasProjectionRequest({ atlas, input, sourceViewType, call, driverReference = null }) {
  angles.assertTextDirectionGuard(sourceViewType);
  const authorityIdentity = await atlasViewIdentity(atlas, sourceViewType);
  const atlasParts = await resolveAtlasConditioningParts(atlas, sourceViewType, call?.parts);
  const prompt = buildAtlasProjectionPrompt({
    input,
    sourceViewType,
    hasDriverAnchor: Boolean(driverReference),
    authorityIdentity,
  });
  const parts = [
    { text: prompt },
    { text: `IMAGE 1 — IMMUTABLE A.T.L.A.S. ${authorityIdentity.surfaceKey.toUpperCase()} NATIVE-ZONE CROP sha256 ${authorityIdentity.contentHash} (SOLE ARTWORK AUTHORITY).` },
    ...atlasParts,
    ...(driverReference ? [
      { text: "IMAGE 2 — BYTE-VERIFIED DRIVER PROOF (VEHICLE/STUDIO/FINISH CONTINUITY ONLY)." },
      { inlineData: { mimeType: driverReference.mimeType, data: driverReference.data } },
    ] : []),
  ];
  const responseModalities = Number(call?.attempt) === 3 ? ["IMAGE"] : ["TEXT", "IMAGE"];
  const requestByteSize = assertAtlasRequestWithinLimit({
    parts,
    aspectRatio: call?.aspectRatio || angles.aspectRatio(sourceViewType),
    imageSize: call?.imageSize || angles.resolutionTier(sourceViewType),
    responseModalities,
    temperature: 1,
  }, atlas.maxRequestBytes);
  return {
    parts,
    responseModalities,
    requestByteSize,
    authorityIdentity,
    audit: proofPromptAudit({
      input,
      sourceViewType,
      prompt,
      renderMethod: "generate-color-render",
    }),
  };
}

function buildReproductionPrompt({ input, sourceViewType }) {
  const vehicleInput = input?.vehicle || {};
  const makeModel = canonicalizeVehicle(vehicleInput.make, vehicleInput.model, vehicleInput.year)
    || [vehicleInput.make, vehicleInput.model].filter(Boolean).join(" ");
  const vehicle = [vehicleInput.year, makeModel].filter(Boolean).join(" ") || "the exact requested vehicle";
  const finish = String(input?.finish || "Gloss");
  const finishSpec = FINISH_SPEC[finish.toLowerCase()] || FINISH_SPEC.gloss;
  const viewLabel = angles.viewLabel(sourceViewType).toLowerCase();
  const brief = String(input?.brief || "");
  const photoLock = briefWantsPhoto(brief)
    ? "\n\nPHOTOGRAPHIC REALISM LOCK: preserve any photographic imagery as a real high-resolution color photograph; never turn it into illustration, vector art, or clip-art."
    : "";

  return `CAMERA ANGLE (LOCKED — read this FIRST):
${angles.cameraAngle(sourceViewType)}

IMAGE 1 and IMAGE 2 are two copies of the SAME verified, immutable driver-side winner created by design-panel-ai-generate. Render the SAME ${vehicle} with the SAME wrap design from the ${viewLabel} angle. This is generate-color-render reproduction, not another design decision.

Preserve every color, pattern, graphic, logo, wordmark, line of text, spelling, scale, position, and hierarchy from View 1. Never redesign, restyle, recolor, simplify, mirror, autocomplete, replace, or invent. All visible text must read correctly left-to-right. Apply the design naturally to only the painted body panels visible in this camera view; windows, lights, wheels, tires, trim, glass, grilles, and manufacturer emblems remain factory.

Finish: ${finish.toUpperCase()} — ${finishSpec} Keep this finish identical across every view.

${STUDIO_ENVIRONMENT}

${WRAP_COVERAGE_RULES}
${truckBedClause(vehicle)}

The vehicle and studio must be the same as View 1; only the camera moves.${photoLock}`;
}

function reproductionParts({ attempt, prompt, reference }) {
  const safeAttempt = Math.min(4, Math.max(1, Number(attempt) || 1));
  const text = safeAttempt === 1
    ? prompt
    : safeAttempt === 2
      ? `[GENERATE IMAGE] Create a photorealistic production asset: ${prompt}`.slice(0, 2000)
      : `[GENERATE IMAGE] ${prompt}`.slice(0, 1000);
  return {
    parts: [
      { text },
      { inlineData: reference },
      { inlineData: reference },
    ],
    responseModalities: safeAttempt === 3 ? ["IMAGE"] : ["TEXT", "IMAGE"],
  };
}

/** Exact server equivalent of generatePassengerMirror's canvas operation. */
async function generatePassengerMirror(driverBytes) {
  let image = sharp(driverBytes, { limitInputPixels: false }).rotate();
  const metadata = await image.metadata();
  // Browser Image dimensions already reflect EXIF orientation. Sharp metadata
  // reports the stored dimensions as width/height and the browser-equivalent
  // dimensions under autoOrient, so size the exact same visible image the
  // canonical canvas producer sizes.
  const width = Number(metadata.autoOrient?.width || metadata.width || 0);
  const height = Number(metadata.autoOrient?.height || metadata.height || 0);
  const longEdge = Math.max(width, height);
  if (!width || !height) throw new Error("driver image dimensions are unavailable");
  if (longEdge > MAX_PASSENGER_EDGE) {
    image = image.resize({
      width: Math.round(width * (MAX_PASSENGER_EDGE / longEdge)),
      height: Math.round(height * (MAX_PASSENGER_EDGE / longEdge)),
      fit: "fill",
      kernel: "lanczos3",
    });
  }
  return image.flop().jpeg({ quality: 92 }).toBuffer();
}

/** Ported verbatim in behaviour from passenger-mirror.ts. */
function designLikelyHasText(opts = {}) {
  if (opts.designIQMode === "commercial" || opts.modeType === "commercial") return true;
  if (["designpanelpro", "designpro", "recreatepro", "restyle"].includes(opts.modeType)
    || opts.designIQMode === "restyle") return true;
  const lower = String(opts.prompt || "").toLowerCase();
  return [
    "text", "letter", "font", "word", "name", "number", "phone",
    "url", "website", ".com", "logo", "brand", "slogan", "tagline",
    "company", "business", "sign", "label", "writing", "script",
    "sponsor", "racing", "livery", "decal", "graphic",
  ].some((keyword) => lower.includes(keyword));
}

async function orientationSignature(bytes) {
  const { data, info } = await sharp(bytes, { limitInputPixels: false })
    .rotate()
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .resize(ORIENTATION_W, ORIENTATION_H, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = new Float64Array(ORIENTATION_W * ORIENTATION_H);
  for (let index = 0; index < out.length; index += 1) {
    const offset = index * info.channels;
    const red = data[offset];
    const green = info.channels > 1 ? data[offset + 1] : red;
    const blue = info.channels > 2 ? data[offset + 2] : red;
    out[index] = 0.299 * red + 0.587 * green + 0.114 * blue;
  }
  return out;
}

function orientationVerdict(driver, candidate, width = ORIENTATION_W, height = ORIENTATION_H) {
  if (!driver || !candidate || driver.length !== candidate.length || driver.length !== width * height) return null;
  let asIs = 0;
  let mirrored = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = driver[y * width + x];
      asIs += Math.abs(value - candidate[y * width + x]);
      mirrored += Math.abs(value - candidate[y * width + (width - 1 - x)]);
    }
  }
  if (asIs < mirrored * 0.9) return true;
  if (mirrored < asIs * 0.9) return false;
  return null;
}

async function textFixUndidTheMirror(driverBytes, candidateBytes) {
  try {
    const [driver, candidate] = await Promise.all([
      orientationSignature(driverBytes),
      orientationSignature(candidateBytes),
    ]);
    return orientationVerdict(driver, candidate, ORIENTATION_W, ORIENTATION_H);
  } catch {
    return null;
  }
}

async function visiblePixelDimensions(bytes) {
  const metadata = await sharp(bytes, { limitInputPixels: false }).metadata();
  const width = Number(metadata.autoOrient?.width || metadata.width || 0);
  const height = Number(metadata.autoOrient?.height || metadata.height || 0);
  if (!width || !height) throw new Error("image dimensions are unavailable");
  return { width, height };
}

async function passengerFramingSignature(bytes) {
  const { data, info } = await sharp(bytes, { limitInputPixels: false })
    .rotate()
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .resize(PASSENGER_FRAMING_W, PASSENGER_FRAMING_H, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const signature = new Uint8Array(PASSENGER_FRAMING_W * PASSENGER_FRAMING_H * 3);
  for (let pixel = 0; pixel < PASSENGER_FRAMING_W * PASSENGER_FRAMING_H; pixel += 1) {
    const inputOffset = pixel * info.channels;
    const outputOffset = pixel * 3;
    signature[outputOffset] = data[inputOffset];
    signature[outputOffset + 1] = info.channels > 1 ? data[inputOffset + 1] : data[inputOffset];
    signature[outputOffset + 2] = info.channels > 2 ? data[inputOffset + 2] : data[inputOffset];
  }
  return signature;
}

/**
 * Fail-closed passenger repair guard. The text model is allowed to make a
 * surgical glyph correction, never to resize, crop, zoom, or recompose the
 * canonical deterministic mirror.
 */
async function passengerFramingVerdict(rawMirrorBytes, candidateBytes) {
  try {
    const [rawDimensions, candidateDimensions] = await Promise.all([
      visiblePixelDimensions(rawMirrorBytes),
      visiblePixelDimensions(candidateBytes),
    ]);
    if (rawDimensions.width !== candidateDimensions.width
      || rawDimensions.height !== candidateDimensions.height) {
      return {
        matches: false,
        reason: "pixel-dimensions-mismatch",
        rawDimensions,
        candidateDimensions,
        mae: null,
      };
    }

    const [rawSignature, candidateSignature] = await Promise.all([
      passengerFramingSignature(rawMirrorBytes),
      passengerFramingSignature(candidateBytes),
    ]);
    if (rawSignature.length !== candidateSignature.length || !rawSignature.length) {
      return {
        matches: false,
        reason: "framing-signature-invalid",
        rawDimensions,
        candidateDimensions,
        mae: null,
      };
    }
    let absoluteDifference = 0;
    for (let index = 0; index < rawSignature.length; index += 1) {
      absoluteDifference += Math.abs(rawSignature[index] - candidateSignature[index]);
    }
    const mae = absoluteDifference / (rawSignature.length * 255);
    return {
      matches: mae <= MAX_PASSENGER_FRAMING_MAE,
      reason: mae <= MAX_PASSENGER_FRAMING_MAE ? "matched" : "framing-mismatch",
      rawDimensions,
      candidateDimensions,
      mae,
    };
  } catch (cause) {
    return {
      matches: false,
      reason: "framing-verification-error",
      rawDimensions: null,
      candidateDimensions: null,
      mae: null,
      detail: String(cause?.message || cause).slice(0, 300),
    };
  }
}

function passengerRepairRequestByteSize(parts) {
  return Buffer.byteLength(JSON.stringify({
    systemInstruction: PASSENGER_TEXT_FIX_SYSTEM_INSTRUCTION,
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      temperature: 1,
      imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
    },
  }));
}

function passengerRepairParts(mirrorBytes, authorityInlineData, atlasAuthority) {
  return [
    { inlineData: { mimeType: "image/jpeg", data: mirrorBytes.toString("base64") } },
    ...(authorityInlineData ? [{ inlineData: { ...authorityInlineData } }] : []),
    { text: passengerTextFixPrompt(atlasAuthority) },
  ];
}

async function reencodePassengerTransport(bytes, quality) {
  return sharp(bytes, { failOn: "error", limitInputPixels: false })
    .rotate()
    .flatten({ background: "#ffffff" })
    .jpeg({ quality, chromaSubsampling: "4:2:0", mozjpeg: true })
    .toBuffer();
}

async function buildPassengerTextFixRequest({
  mirrorBytes,
  atlasAuthority = null,
  maxRequestBytes = MAX_ATLAS_REQUEST_BYTES,
}) {
  const configured = Number(maxRequestBytes);
  const requestLimit = Math.min(
    MAX_ATLAS_REQUEST_BYTES,
    Number.isFinite(configured) && configured > 0 ? configured : MAX_ATLAS_REQUEST_BYTES,
  );
  const authorityBytes = atlasAuthority
    ? decodeInlineData({ inlineData: atlasAuthority.inlineData }).bytes
    : null;
  let parts = passengerRepairParts(
    mirrorBytes,
    atlasAuthority?.inlineData || null,
    atlasAuthority,
  );
  let requestByteSize = passengerRepairRequestByteSize(parts);
  if (requestByteSize <= requestLimit) {
    return { parts, requestByteSize, transportDerived: false };
  }

  // Preserve dimensions and composition. Only deterministic JPEG quality is
  // reduced; no crop, resize or generative preprocessing may enter this edit.
  for (const quality of [86, 80, 74, 68, 60, 52, 44, 36]) {
    const mirrorTransport = await reencodePassengerTransport(mirrorBytes, quality);
    const authorityTransport = authorityBytes
      ? await reencodePassengerTransport(authorityBytes, quality)
      : null;
    parts = passengerRepairParts(
      mirrorTransport,
      authorityTransport ? { mimeType: "image/jpeg", data: authorityTransport.toString("base64") } : null,
      atlasAuthority,
    );
    requestByteSize = passengerRepairRequestByteSize(parts);
    if (requestByteSize <= requestLimit) {
      return { parts, requestByteSize, transportDerived: true, quality };
    }
  }
  throw new DesignPanelServerError(
    "designpanel_atlas_passenger_request_too_large",
    `Passenger authority repair request is ${requestByteSize} bytes after bounded same-dimension transport; maximum is ${requestLimit}`,
    false,
  );
}

async function fixMirrorText({ mirrorBytes, provider, call, atlasAuthority = null }) {
  const repairRequest = await buildPassengerTextFixRequest({
    mirrorBytes,
    atlasAuthority,
    maxRequestBytes: call?.maxRequestBytes,
  });
  const deadline = new AbortController();
  const signal = call?.signal
    ? AbortSignal.any([call.signal, deadline.signal])
    : deadline.signal;
  let timer;
  const hardTimeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`text-fix timed out after ${PASSENGER_TEXT_FIX_TIMEOUT_MS / 1000}s`);
      deadline.abort(error);
      reject(error);
    }, PASSENGER_TEXT_FIX_TIMEOUT_MS);
    timer.unref?.();
  });

  try {
    const fixed = await Promise.race([
      provider.generateImage({
        ...call,
        // The proven revise-render rawPrompt path is image-first, instruction-last.
        parts: repairRequest.parts,
        aspectRatio: "16:9",
        imageSize: "4K",
        responseModalities: ["TEXT", "IMAGE"],
        systemInstruction: PASSENGER_TEXT_FIX_SYSTEM_INSTRUCTION,
        temperature: 1,
        signal,
        timeoutMs: PASSENGER_TEXT_FIX_TIMEOUT_MS,
        label: "passenger mirror text repair",
      }),
      hardTimeout,
    ]);
    return {
      ...fixed,
      metadata: {
        ...(fixed?.metadata || {}),
        passengerRepairRequestByteSize: repairRequest.requestByteSize,
        passengerRepairTransportDerived: repairRequest.transportDerived,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * THE passenger-side producer, ported from app/src/utils/passenger-mirror.ts.
 * It never asks the ordinary renderer to invent a passenger angle.
 */
async function producePassengerView({ driverBytes, provider, call, prompt = "", atlasAuthority = null }) {
  let rawMirror = null;
  let lastMirrorError = null;
  for (let attempt = 1; attempt <= 2 && !rawMirror; attempt += 1) {
    try {
      rawMirror = await generatePassengerMirror(driverBytes);
    } catch (cause) {
      lastMirrorError = cause;
    }
  }
  if (!rawMirror) {
    throw new DesignPanelServerError(
      "designpanel_passenger_mirror_failed",
      `Passenger mirror failed: ${String(lastMirrorError?.message || lastMirrorError || "unknown error")}`,
      false,
    );
  }

  const rawResult = (textRepair, detail = null) => ({
    bytes: rawMirror,
    contentType: "image/jpeg",
    model: "sharp-deterministic-mirror",
    keyFingerprint: null,
    attempts: [],
    metadata: {
      passengerProducer: "producePassengerView",
      deterministicMirror: true,
      textRepair,
      ...(detail ? { textRepairDetail: detail } : {}),
    },
  });

  if (!designLikelyHasText({ modeType: "designpanelpro", prompt })) {
    return rawResult("not-required");
  }

  const failures = [];
  for (let repairAttempt = 1; repairAttempt <= 2; repairAttempt += 1) {
    let fixed;
    try {
      fixed = await fixMirrorText({
        mirrorBytes: rawMirror,
        provider,
        call: { ...call, passengerRepairAttempt: repairAttempt },
        atlasAuthority,
      });
    } catch (cause) {
      failures.push(`attempt ${repairAttempt}: ${String(cause?.message || cause).slice(0, 240)}`);
      continue;
    }

    const undone = await textFixUndidTheMirror(driverBytes, fixed.bytes);
    if (undone === true) {
      failures.push(`attempt ${repairAttempt}: returned driver-facing image`);
      continue;
    }
    if (undone !== false) {
      failures.push(`attempt ${repairAttempt}: orientation was ambiguous`);
      continue;
    }

    const framing = await passengerFramingVerdict(rawMirror, fixed.bytes);
    if (!framing.matches) {
      failures.push(
        `attempt ${repairAttempt}: ${framing.reason}${framing.detail ? ` (${framing.detail})` : ""}`,
      );
      continue;
    }
    return {
      ...fixed,
      metadata: {
        passengerProducer: "producePassengerView",
        deterministicMirror: true,
        textRepair: "accepted-opposite-facing",
        textRepairAttempts: repairAttempt,
        framingVerified: true,
        framingMae: framing.mae,
        pixelDimensions: framing.candidateDimensions,
      },
    };
  }

  // A raw mirror is useful only as an edit source. Publishing it as the
  // passenger proof guarantees every word and logo is backwards, which is
  // worse than a failed slot. Two bounded surgical repairs were attempted;
  // now fail closed and let the generation engine record the rejected slot.
  throw new DesignPanelServerError(
    "designpanel_passenger_text_repair_required",
    `Passenger text repair did not produce a verified forward-reading proof: ${failures.join("; ")}`.slice(0, 900),
    false,
  );
}

function createDesignPanelServerProvider(options = {}) {
  const supabase = options.supabase;
  const provider = options.provider;
  const requestId = String(options.requestId || "").trim().toLowerCase();
  const generationId = String(options.generationId || "").trim().toLowerCase();
  const tenantKey = String(options.tenantKey || "").trim();
  const input = options.input && typeof options.input === "object" ? options.input : {};
  if (!supabase) throw new DesignPanelServerError("designpanel_server_supabase_missing", "A Supabase client is required");
  if (!provider?.generateImage) throw new DesignPanelServerError("designpanel_server_transport_missing", "The server Gemini provider is required");
  if (!requestId || !generationId || !tenantKey) {
    throw new DesignPanelServerError("designpanel_server_identity_missing", "Request, generation and tenant identities are required");
  }

  const expectedPrefix = `designpro/${tenantKey}/${generationId}/calls-1-7/${HERO_VIEW}/`;
  let hero = null;

  async function hydrateHero() {
    if (hero) return hero;
    const { data, error } = await supabase
      .from("designpro_generation_views")
      .select("storage_path,content_hash,byte_size,content_type")
      .eq("request_id", requestId)
      .eq("source_view_type", HERO_VIEW)
      .is("superseded_at", null)
      .maybeSingle();
    if (error) throw new DesignPanelServerError("designpanel_server_hero_lookup_failed", error.message, true);
    if (!data?.storage_path) return null;

    const storagePath = String(data.storage_path);
    const contentHash = String(data.content_hash || "").toLowerCase();
    const byteSize = Number(data.byte_size);
    const contentType = String(data.content_type || "").toLowerCase();
    if (!storagePath.startsWith(expectedPrefix) || !/^[0-9a-f]{64}$/.test(contentHash)
      || !Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_REFERENCE_BYTES
      || !["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
      throw new DesignPanelServerError("designpanel_server_hero_identity_invalid", "The accepted View 1 identity is invalid", false);
    }
    const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(storagePath);
    if (downloadError || !blob) {
      throw new DesignPanelServerError("designpanel_server_hero_download_failed", downloadError?.message || "View 1 bytes are missing", true);
    }
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (bytes.length !== byteSize || sha256(bytes) !== contentHash) {
      throw new DesignPanelServerError("designpanel_server_hero_hash_mismatch", "View 1 bytes do not match the immutable database identity", false);
    }
    const bounded = await sharp(bytes, { limitInputPixels: false })
      .rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    hero = Object.freeze({
      storagePath, contentHash, byteSize, contentType, bytes,
      reference: { mimeType: "image/png", data: bounded.toString("base64") },
    });
    return hero;
  }

  async function generateImage(call = {}) {
    const sourceViewType = String(call.sourceViewType || "").trim();
    if (!sourceViewType) throw new DesignPanelServerError("designpanel_server_view_missing", "A source view is required");

    const qualityChecked = async (generated) => {
      if (typeof provider.generateRaw !== "function") {
        if (provider.contract) {
          throw new DesignPanelServerError(
            "designpanel_quality_transport_missing",
            "The production image provider cannot perform Standard proof QC",
            false,
          );
        }
        // Unit-test doubles without the production transport remain usable;
        // the real provider always carries a contract and generateRaw.
        return generated;
      }
      const review = await inspectStandardProof({
        provider,
        input,
        sourceViewType,
        bytes: generated.bytes,
        signal: call.signal,
      });
      return {
        ...generated,
        metadata: {
          ...(generated.metadata || {}),
          standardQualityContract: "designpro.standard-proof-semantic-qc.v1",
          standardQualityConfidence: Number(review.confidence),
          standardQualityInspectionId: review.inspectionId,
        },
      };
    };
    if (sourceViewType === HERO_VIEW) {
      const generated = await qualityChecked(await provider.generateImage(call));
      return {
        ...generated,
        contract: SERVER_PROVIDER_CONTRACT,
        metadata: {
          stage: "design-panel-ai-generate",
          execution: "server-native",
          anchoredToView1: false,
        },
      };
    }

    const acceptedHero = await hydrateHero();
    if (!acceptedHero) {
      throw new DesignPanelServerError("designpanel_server_hero_required", `${sourceViewType}: accepted View 1 is required`, false);
    }
    if (sourceViewType === PASSENGER_VIEW) {
      const generated = await qualityChecked(await producePassengerView({
        driverBytes: acceptedHero.bytes,
        provider,
        call,
        prompt: [
          input?.brief,
          input?.companyName,
          input?.phone,
          input?.website,
          input?.textLayerPrompt,
          input?.logoAsset ? "verified customer logo" : "",
        ].filter(Boolean).join("\n"),
      }));
      return {
        ...generated,
        contract: SERVER_PROVIDER_CONTRACT,
        metadata: {
          ...(generated.metadata || {}),
          stage: "generate-color-render",
          execution: "server-native",
          anchoredToView1: true,
          heroStoragePath: acceptedHero.storagePath,
          heroContentHash: acceptedHero.contentHash,
        },
      };
    }
    const request = reproductionParts({
      attempt: call.attempt,
      prompt: buildReproductionPrompt({ input, sourceViewType }),
      reference: acceptedHero.reference,
    });
    const generated = await qualityChecked(await provider.generateImage({
      ...call,
      parts: request.parts,
      responseModalities: request.responseModalities,
      temperature: 1,
    }));
    return {
      ...generated,
      contract: SERVER_PROVIDER_CONTRACT,
      metadata: {
        ...(generated.metadata || {}),
        stage: "generate-color-render",
        execution: "server-native",
        anchoredToView1: true,
        heroStoragePath: acceptedHero.storagePath,
        heroContentHash: acceptedHero.contentHash,
      },
    };
  }

  return {
    generateImage,
    hydrateHero,
    contract: SERVER_PROVIDER_CONTRACT,
    maxProviderAttempts: 4,
    models: [...(provider.models || [])],
    keyCount: Number(provider.keyCount || 0),
  };
}

/**
 * A.T.L.A.S. projection provider.
 *
 * A.T.L.A.S. has already made the sole creative decision before this provider
 * is constructed. This adapter therefore runs only generate-color-render:
 * Driver from the immutable flat master, Passenger through the canonical
 * deterministic producer, then each remaining camera from that same flat
 * master plus the accepted Driver as vehicle/studio continuity evidence.
 */
function createAtlasDesignPanelProvider(options = {}) {
  const provider = options.provider;
  const input = options.input && typeof options.input === "object" ? options.input : {};
  const atlas = options.atlas && typeof options.atlas === "object" ? options.atlas : null;
  if (!atlas) {
    throw new DesignPanelServerError(
      "designpanel_atlas_conditioning_missing",
      "The immutable Atlas conditioning parts are required",
      false,
    );
  }
  const identity = atlasIdentity(atlas);
  assertHash(identity.masterContentHash, "Atlas master hash");
  assertHash(identity.projectionContentHash, "Atlas projection hash");

  // Reuse the standard provider's exact database/storage View-1 identity
  // verification. Atlas has a different generation policy, not a second way
  // to trust or download accepted Driver bytes.
  const driverStore = createDesignPanelServerProvider(options);
  let compactDriver = null;

  function atlasMetadata(extra = {}) {
    return {
      stage: "generate-color-render",
      execution: "server-native",
      anchoredToFlatAtlas: true,
      atlasMasterContentHash: identity.masterContentHash,
      atlasProjectionContentHash: identity.projectionContentHash,
      ...(identity.manifestContentHash ? { atlasManifestContentHash: identity.manifestContentHash } : {}),
      ...(identity.revisionId ? { atlasRevisionId: identity.revisionId } : {}),
      ...(identity.revisionSequence ? { atlasRevisionSequence: identity.revisionSequence } : {}),
      ...extra,
    };
  }

  async function compactAcceptedDriver(acceptedDriver) {
    if (compactDriver?.contentHash === acceptedDriver.contentHash) return compactDriver.reference;
    const reference = await compactAtlasDriverReference(acceptedDriver.bytes, {
      maxBytes: atlas.maxDriverReferenceBytes,
      maxEdge: atlas.maxDriverReferenceEdge,
    });
    compactDriver = { contentHash: acceptedDriver.contentHash, reference };
    return reference;
  }

  async function generateImage(call = {}) {
    const sourceViewType = String(call.sourceViewType || "").trim();
    if (!sourceViewType) throw new DesignPanelServerError("designpanel_server_view_missing", "A source view is required");

    if (sourceViewType === PASSENGER_VIEW) {
      // The deterministic Driver mirror locks vehicle/camera/framing. The
      // verified Passenger crop is passed as a second, hash-bound glyph/art
      // identity reference; the surgical prompt forbids recomposition.
      const authorityIdentity = await atlasViewIdentity(atlas, sourceViewType);
      const conditioning = await resolveAtlasConditioningParts(atlas, sourceViewType, call?.parts);
      const authorityPart = conditioning.find((part) => part?.inlineData);
      const acceptedDriver = await driverStore.hydrateHero();
      if (!acceptedDriver) {
        throw new DesignPanelServerError(
          "designpanel_server_driver_required",
          `${sourceViewType}: accepted Driver is required`,
          false,
        );
      }
      const generated = await producePassengerView({
        driverBytes: acceptedDriver.bytes,
        provider,
        call,
        prompt: input?.brief,
        atlasAuthority: {
          ...authorityIdentity,
          inlineData: { ...authorityPart.inlineData },
        },
      });
      return {
        ...generated,
        contract: ATLAS_SERVER_PROVIDER_CONTRACT,
        metadata: {
          ...(generated.metadata || {}),
          ...proofPromptAudit({
            input,
            sourceViewType,
            prompt: passengerTextFixPrompt(authorityIdentity),
            renderMethod: "producePassengerView",
          }),
          ...atlasMetadata({
            anchoredToView1: true,
            driverStoragePath: acceptedDriver.storagePath,
            driverContentHash: acceptedDriver.contentHash,
            atlasConditioningVerified: true,
            atlasZoneContract: authorityIdentity.contract,
            atlasZoneContentHash: authorityIdentity.contentHash,
            atlasZoneSurfaceKey: authorityIdentity.surfaceKey,
            atlasZonePassedToPassengerRepair: true,
          }),
        },
      };
    }

    let acceptedDriver = null;
    let driverReference = null;
    if (sourceViewType !== DRIVER_VIEW) {
      acceptedDriver = await driverStore.hydrateHero();
      if (!acceptedDriver) {
        throw new DesignPanelServerError(
          "designpanel_server_driver_required",
          `${sourceViewType}: accepted Driver is required`,
          false,
        );
      }
      driverReference = await compactAcceptedDriver(acceptedDriver);
    }
    const request = await buildAtlasProjectionRequest({
      atlas,
      input,
      sourceViewType,
      call,
      driverReference,
    });
    const generated = await provider.generateImage({
      ...call,
      parts: request.parts,
      responseModalities: request.responseModalities,
      temperature: 1,
      label: `A.T.L.A.S. ${angles.viewLabel(sourceViewType)} projection`,
    });
    return {
      ...generated,
      contract: ATLAS_SERVER_PROVIDER_CONTRACT,
      metadata: {
        ...(generated.metadata || {}),
        ...request.audit,
        ...atlasMetadata({
          anchoredToView1: Boolean(acceptedDriver),
          ...(acceptedDriver ? {
            driverStoragePath: acceptedDriver.storagePath,
            driverContentHash: acceptedDriver.contentHash,
            driverReferenceByteSize: driverReference.byteSize,
            driverReferenceContentHash: driverReference.contentHash,
          } : {}),
          atlasConditioningVerified: true,
          atlasZoneContract: request.authorityIdentity.contract,
          atlasZoneContentHash: request.authorityIdentity.contentHash,
          atlasZoneSurfaceKey: request.authorityIdentity.surfaceKey,
          requestByteSize: request.requestByteSize,
        }),
      },
    };
  }

  return {
    generateImage,
    hydrateDriver: driverStore.hydrateHero,
    contract: ATLAS_SERVER_PROVIDER_CONTRACT,
    maxProviderAttempts: 4,
    models: [...(provider.models || [])],
    keyCount: Number(provider.keyCount || 0),
  };
}

module.exports = {
  ARTIFACT_AUDIT_CONTRACT,
  ATLAS_SERVER_PROVIDER_CONTRACT,
  SERVER_PROVIDER_CONTRACT,
  DesignPanelServerError,
  buildAtlasProjectionPrompt,
  buildAtlasProjectionRequest,
  buildReproductionPrompt,
  compactAtlasDriverReference,
  createAtlasDesignPanelProvider,
  createDesignPanelServerProvider,
  designLikelyHasText,
  estimatedGeminiImageRequestBytes,
  fixMirrorText,
  generatePassengerMirror,
  inspectStandardProof,
  orientationSignature,
  orientationVerdict,
  passengerFramingVerdict,
  proofPromptAudit,
  producePassengerView,
  reproductionParts,
  _test: {
    assertAtlasRequestWithinLimit,
    atlasIdentity,
    atlasViewIdentity,
    buildPassengerTextFixRequest,
    resolveAtlasConditioningParts,
    sha256,
    GEMINI_REQUEST_LIMIT_BYTES,
    MAX_ATLAS_REQUEST_BYTES,
    MAX_ATLAS_DRIVER_REFERENCE_BYTES,
    ORIENTATION_W,
    ORIENTATION_H,
    PASSENGER_FRAMING_W,
    PASSENGER_FRAMING_H,
    MAX_PASSENGER_FRAMING_MAE,
    PASSENGER_TEXT_FIX_TIMEOUT_MS,
    PASSENGER_TEXT_FIX_PROMPT,
    PASSENGER_TEXT_FIX_WITH_PRODUCTION_LOCKS,
    passengerTextFixPrompt,
    PASSENGER_TEXT_FIX_SYSTEM_INSTRUCTION,
    passengerRepairRequestByteSize,
    PHOTOREALISM_REQUIREMENT,
    VIEW_REINFORCEMENT,
    WRAP_COVERAGE_RULES,
    STANDARD_QC_MODEL,
    STANDARD_QC_CONFIDENCE,
    standardProofQcPrompt,
    standardProofQcReview,
  },
};
