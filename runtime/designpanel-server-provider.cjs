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
const { canonicalizeVehicle, briefWantsPhoto } = require("./designiq-prompt.cjs");
const angles = require("./view-angles.cjs");
const { STUDIO_ENVIRONMENT } = require("./studio-os.cjs");

const BUCKET = "wrap-files";
const SERVER_PROVIDER_CONTRACT = "designpro.designpanel-server-provider.v1";
const HERO_VIEW = "side";
const PASSENGER_VIEW = "passenger-side";
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_PASSENGER_EDGE = 2560;
const PASSENGER_TEXT_FIX_TIMEOUT_MS = 90_000;
const ORIENTATION_W = 64;
const ORIENTATION_H = 32;
const FINISH_SPEC = Object.freeze({
  gloss: "High-gloss laminate — shiny wet-look surface with crisp reflections.",
  matte: "Matte laminate — completely flat, zero reflections, velvet appearance.",
  satin: "Satin laminate — soft sheen between matte and gloss, silk-like.",
});

// Ported from app/src/utils/passenger-mirror.ts. The server calls Gemini
// directly for the same surgical text repair; it does not invoke revise-render
// or any other Edge Function.
const PASSENGER_TEXT_FIX_PROMPT = `This is a horizontally mirrored vehicle wrap. All text, lettering, numbers, URLs, and logos are BACKWARDS (mirror-reversed). Your ONLY task: flip every text/lettering element so it reads correctly left-to-right. Do NOT change the vehicle, design, colors, patterns, background, or any non-text element. CRITICAL: Keep the EXACT same straight-on side camera angle — do NOT rotate, tilt, or change the perspective in any way. The output must be a perfectly flat, straight-on side view identical to the input framing. Output the corrected image.

KEEP THE FRAMING IDENTICAL: match the attached image's exact camera angle, zoom, crop, distance, and vehicle position. Do not re-frame, zoom, reposition, or recompose the shot. This is an EDIT of the attached photo — apply the design changes requested above directly onto it.`;

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

async function fixMirrorText({ mirrorBytes, provider, call }) {
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
    return await Promise.race([
      provider.generateImage({
        ...call,
        // The proven revise-render rawPrompt path is image-first, instruction-last.
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: mirrorBytes.toString("base64") } },
          { text: PASSENGER_TEXT_FIX_PROMPT },
        ],
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
  } finally {
    clearTimeout(timer);
  }
}

/**
 * THE passenger-side producer, ported from app/src/utils/passenger-mirror.ts.
 * It never asks the ordinary renderer to invent a passenger angle.
 */
async function producePassengerView({ driverBytes, provider, call, prompt = "" }) {
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

  let fixed;
  try {
    fixed = await fixMirrorText({ mirrorBytes: rawMirror, provider, call });
  } catch (cause) {
    return rawResult("failed-raw-mirror-kept", String(cause?.message || cause).slice(0, 300));
  }

  const undone = await textFixUndidTheMirror(driverBytes, fixed.bytes);
  if (undone === true) {
    return rawResult("returned-driver-facing-raw-mirror-kept");
  }
  return {
    ...fixed,
    metadata: {
      passengerProducer: "producePassengerView",
      deterministicMirror: true,
      textRepair: undone === false ? "accepted-opposite-facing" : "accepted-ambiguous-orientation",
    },
  };
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
    if (sourceViewType === HERO_VIEW) {
      const generated = await provider.generateImage(call);
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
      const generated = await producePassengerView({
        driverBytes: acceptedHero.bytes,
        provider,
        call,
        prompt: input?.brief,
      });
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
    const generated = await provider.generateImage({
      ...call,
      parts: request.parts,
      responseModalities: request.responseModalities,
      temperature: 1,
    });
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

module.exports = {
  SERVER_PROVIDER_CONTRACT,
  DesignPanelServerError,
  buildReproductionPrompt,
  createDesignPanelServerProvider,
  designLikelyHasText,
  fixMirrorText,
  generatePassengerMirror,
  orientationSignature,
  orientationVerdict,
  producePassengerView,
  reproductionParts,
  _test: {
    sha256,
    ORIENTATION_W,
    ORIENTATION_H,
    PASSENGER_TEXT_FIX_TIMEOUT_MS,
    PASSENGER_TEXT_FIX_PROMPT,
    PASSENGER_TEXT_FIX_SYSTEM_INSTRUCTION,
  },
};
