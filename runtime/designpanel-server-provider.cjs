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
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const FINISH_SPEC = Object.freeze({
  gloss: "High-gloss laminate — shiny wet-look surface with crisp reflections.",
  matte: "Matte laminate — completely flat, zero reflections, velvet appearance.",
  satin: "Satin laminate — soft sheen between matte and gloss, silk-like.",
});

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
      storagePath, contentHash, byteSize, contentType,
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
  reproductionParts,
  _test: { sha256 },
};
