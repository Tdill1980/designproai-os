"use strict";

/**
 * Standard DesignPanel transport for the two sanctioned Supabase producers.
 *
 * The droplet remains the durable queue, lease and immutable-persistence owner.
 * It does not reproduce either image producer locally:
 *   View 1      -> design-panel-ai-generate
 *   Views 2-7  -> generate-color-render
 *
 * A.T.L.A.S. intentionally does not use this adapter. Its independent,
 * explicitly-selected projection provider remains in designpanel-server-provider.cjs.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");
const {
  DesignPanelServerError,
  inspectStandardProof,
} = require("./designpanel-server-provider.cjs");

const BUCKET = "wrap-files";
const EDGE_PROVIDER_CONTRACT = "designpro.designpanel-edge-provider.v1";
const HERO_VIEW = "side";
const LOCKED_MODEL = "gemini-3-pro-image-preview";
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_EDGE_REFERENCE_BYTES = 3 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function compactHeroReference(bytes) {
  const source = Buffer.from(bytes);
  const firstPass = await sharp(source)
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
  if (firstPass.length <= MAX_EDGE_REFERENCE_BYTES) return firstPass;
  const fallback = await sharp(source)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 74, chromaSubsampling: "4:2:0", mozjpeg: true })
    .toBuffer();
  if (!fallback.length || fallback.length > MAX_EDGE_REFERENCE_BYTES) {
    throw edgeError(
      "designpanel_edge_reference_budget_exceeded",
      "The verified Driver could not be reduced to the Edge photographer budget",
    );
  }
  return fallback;
}

function edgeError(code, message, retryable = false) {
  return new DesignPanelServerError(code, message, retryable);
}

function canonicalProjectUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw edgeError("designpanel_edge_url_invalid", "The Supabase project URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw edgeError("designpanel_edge_url_invalid", "The Supabase project URL must be an HTTPS origin");
  }
  return url.origin;
}

function ownerIdFromTenant(tenantKey) {
  const ownerId = String(tenantKey || "").trim().toLowerCase().replace(/^user_/, "");
  if (!UUID_PATTERN.test(ownerId)) {
    throw edgeError("designpanel_edge_owner_invalid", "The generation owner identity is invalid");
  }
  return ownerId;
}

function responseSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function signedAsset(supabase, projectUrl, label, asset) {
  const storagePath = String(asset?.storagePath || "").trim();
  const bucket = String(asset?.bucket || BUCKET).trim();
  if (!storagePath || storagePath.startsWith("/") || storagePath.includes("..") || bucket !== BUCKET) {
    throw edgeError("designpanel_edge_reference_invalid", `${label} reference identity is invalid`);
  }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 900);
  const storageUrl = String(data?.signedUrl || "").trim();
  let parsed;
  try {
    parsed = new URL(storageUrl);
  } catch {
    parsed = null;
  }
  if (error || !parsed || parsed.origin !== projectUrl || !parsed.pathname.startsWith("/storage/v1/")) {
    throw edgeError("designpanel_edge_reference_url_missing", `${label} reference URL is unavailable`, true);
  }
  return { slotLabel: label, storageUrl };
}

async function referenceImages(supabase, projectUrl, input) {
  const images = [];
  if (input?.logoAsset) images.push(await signedAsset(supabase, projectUrl, "Customer logo", input.logoAsset));
  for (const [index, asset] of (Array.isArray(input?.visionBoardImages) ? input.visionBoardImages : []).entries()) {
    if (asset) images.push(await signedAsset(supabase, projectUrl, `VisionBoard ${index + 1}`, asset));
  }
  // The sanctioned producer itself caps this list at six. Cap here as well so
  // the uploaded customer logo always wins the first reference position.
  return images.slice(0, 6);
}

async function readJsonResponse(response) {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw edgeError(
      "designpanel_edge_response_invalid",
      `The Edge Function returned invalid JSON (${response.status})`,
      response.status >= 500,
    );
  }
}

function edgeFailure(functionName, response, payload) {
  const detail = String(payload?.message || payload?.error || payload?.code || `HTTP ${response.status}`).slice(0, 400);
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  return edgeError(`designpanel_${functionName.replaceAll("-", "_")}_failed`, `${functionName}: ${detail}`, retryable);
}

function createDesignPanelEdgeProvider(options = {}) {
  const supabase = options.supabase;
  const qualityProvider = options.provider;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const requestId = String(options.requestId || "").trim().toLowerCase();
  const generationId = String(options.generationId || "").trim().toLowerCase();
  const tenantKey = String(options.tenantKey || "").trim();
  const input = options.input && typeof options.input === "object" ? options.input : {};
  const supabaseUrl = canonicalProjectUrl(options.supabaseUrl || process.env.SUPABASE_URL);
  const serviceRoleKey = String(options.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const ownerId = ownerIdFromTenant(tenantKey);
  const referenceCompactor = options.referenceCompactor || compactHeroReference;

  if (!supabase) throw edgeError("designpanel_edge_supabase_missing", "A Supabase client is required");
  if (typeof fetchImpl !== "function") throw edgeError("designpanel_edge_fetch_missing", "The Edge Function transport is unavailable");
  if (serviceRoleKey.length < 32) throw edgeError("designpanel_edge_key_missing", "The Supabase server key is unavailable");
  if (!requestId || !generationId) {
    throw edgeError("designpanel_edge_identity_missing", "Request and generation identities are required");
  }

  const expectedPrefix = `designpro/${tenantKey}/${generationId}/calls-1-7/${HERO_VIEW}/`;
  let hero = null;
  let compactHero = null;
  let ownerEmail = null;

  async function resolveOwnerEmail() {
    if (ownerEmail) return ownerEmail;
    const { data, error } = await supabase.auth.admin.getUserById(ownerId);
    const email = String(data?.user?.email || "").trim().toLowerCase();
    if (error || !email) {
      throw edgeError("designpanel_edge_owner_lookup_failed", error?.message || "The generation owner email is unavailable", true);
    }
    ownerEmail = email;
    return ownerEmail;
  }

  async function invoke(functionName, body, signal) {
    const response = await fetchImpl(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "content-type": "application/json",
        "x-designpro-owner-id": ownerId,
        ...(functionName === "generate-color-render" ? { "x-designpro-mode": "designpanelpro" } : {}),
      },
      body: JSON.stringify(body),
      signal: responseSignal(signal, 155_000),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw edgeFailure(functionName, response, payload);
    return payload;
  }

  async function downloadResult(functionName, payload) {
    const storagePath = String(payload?.storagePath || "").trim();
    const contentType = String(payload?.contentType || "image/png").toLowerCase();
    const functionPrefix = functionName === "design-panel-ai-generate"
      ? `renders/${ownerId}/DesignPanelPro/ai-generated/`
      : `renders/${ownerId}/designpanelpro/`;
    if (!storagePath.startsWith(functionPrefix) || storagePath.includes("..")) {
      throw edgeError("designpanel_edge_result_identity_invalid", `${functionName} returned an invalid owner-scoped object identity`);
    }
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw edgeError("designpanel_edge_result_type_invalid", `${functionName} returned unsupported ${contentType}`);
    }
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !data) {
      throw edgeError("designpanel_edge_result_download_failed", error?.message || `${functionName} result bytes are unavailable`, true);
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES) {
      throw edgeError("designpanel_edge_result_size_invalid", `${functionName} returned an invalid image size`);
    }
    return { bytes, contentType, storagePath };
  }

  async function hydrateHero() {
    if (hero) return hero;
    const { data, error } = await supabase
      .from("designpro_generation_views")
      .select("storage_path,content_hash,byte_size,content_type,metadata")
      .eq("request_id", requestId)
      .eq("source_view_type", HERO_VIEW)
      .is("superseded_at", null)
      .maybeSingle();
    if (error) throw edgeError("designpanel_edge_hero_lookup_failed", error.message, true);
    if (!data?.storage_path) return null;

    const storagePath = String(data.storage_path);
    const contentHash = String(data.content_hash || "").toLowerCase();
    const byteSize = Number(data.byte_size);
    const contentType = String(data.content_type || "").toLowerCase();
    if (!storagePath.startsWith(expectedPrefix) || !/^[0-9a-f]{64}$/.test(contentHash)
      || !Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_REFERENCE_BYTES
      || !ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw edgeError("designpanel_edge_hero_identity_invalid", "The accepted Driver identity is invalid");
    }
    const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(storagePath);
    if (downloadError || !blob) {
      throw edgeError("designpanel_edge_hero_download_failed", downloadError?.message || "Driver bytes are missing", true);
    }
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (bytes.length !== byteSize || sha256(bytes) !== contentHash) {
      throw edgeError("designpanel_edge_hero_hash_mismatch", "Driver bytes do not match their immutable identity");
    }
    hero = Object.freeze({
      storagePath,
      contentHash,
      byteSize,
      contentType,
      bytes,
      designAnchorText: String(data.metadata?.designAnchorText || "").trim(),
    });
    return hero;
  }

  async function signedHeroUrl(storagePath) {
    // Mint immediately before each photographer call. Six sequential views can
    // legitimately span longer than one shared URL lifetime.
    const { data: signedData, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 900);
    const signedUrl = String(signedData?.signedUrl || "").trim();
    let parsed;
    try {
      parsed = new URL(signedUrl);
    } catch {
      parsed = null;
    }
    if (signedError || !parsed || parsed.origin !== supabaseUrl || !parsed.pathname.startsWith("/storage/v1/")) {
      throw edgeError("designpanel_edge_hero_url_missing", "The accepted Driver signed URL is unavailable", true);
    }
    return signedUrl;
  }

  async function compactHeroUrl() {
    const acceptedHero = await hydrateHero();
    if (!acceptedHero) {
      throw edgeError("designpanel_edge_hero_required", "The accepted Driver is required");
    }
    if (compactHero?.sourceHash === acceptedHero.contentHash) {
      return signedHeroUrl(compactHero.storagePath);
    }

    const bytes = Buffer.from(await referenceCompactor(acceptedHero.bytes));
    if (!bytes.length || bytes.length > MAX_EDGE_REFERENCE_BYTES) {
      throw edgeError(
        "designpanel_edge_reference_budget_exceeded",
        "The verified Driver reference exceeds the Edge photographer budget",
      );
    }
    const compactHash = sha256(bytes);
    const storagePath = [
      "designpro",
      tenantKey,
      generationId,
      "calls-1-7",
      "_edge-reference",
      acceptedHero.contentHash,
      `${compactHash}.jpg`,
    ].join("/");
    const bucket = supabase.storage.from(BUCKET);
    const { error: uploadError } = await bucket.upload(storagePath, bytes, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (uploadError) {
      const { data: existing, error: downloadError } = await bucket.download(storagePath);
      if (downloadError || !existing) {
        throw edgeError(
          "designpanel_edge_reference_upload_failed",
          uploadError.message || "The compact Driver reference could not be stored",
          true,
        );
      }
      const existingBytes = Buffer.from(await existing.arrayBuffer());
      if (existingBytes.length !== bytes.length || sha256(existingBytes) !== compactHash) {
        throw edgeError(
          "designpanel_edge_reference_hash_mismatch",
          "The stored compact Driver reference does not match its immutable identity",
        );
      }
    }
    compactHero = Object.freeze({
      sourceHash: acceptedHero.contentHash,
      contentHash: compactHash,
      byteSize: bytes.length,
      storagePath,
    });
    return signedHeroUrl(storagePath);
  }

  async function qualityChecked(sourceViewType, generated, signal) {
    if (typeof qualityProvider?.generateRaw !== "function") return generated;
    const review = await inspectStandardProof({
      provider: qualityProvider,
      input,
      sourceViewType,
      bytes: generated.bytes,
      signal,
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
  }

  async function generateImage(call = {}) {
    const sourceViewType = String(call.sourceViewType || "").trim();
    if (!sourceViewType) throw edgeError("designpanel_edge_view_missing", "A source view is required");
    const vehicle = input?.vehicle || {};

    if (sourceViewType === HERO_VIEW) {
      const payload = await invoke("design-panel-ai-generate", {
        mode: input?.mode === "commercial" || input?.companyName ? "commercial" : "restyle",
        prompt: String(input?.brief || "Professional commercial vehicle wrap design.").trim(),
        style: input?.style,
        finish: input?.finish || "Gloss",
        companyName: input?.companyName,
        mascot: input?.mascot,
        bulletPoints: Array.isArray(input?.bulletPoints) ? input.bulletPoints : [],
        industryType: input?.industry,
        phone: input?.phone,
        brandColors: input?.brandColors || (Array.isArray(input?.colors) ? input.colors.join(", ") : input?.colors),
        fontStyle: input?.fontStyle,
        qrEnabled: input?.qrEnabled === true,
        vehicleYear: vehicle.year,
        vehicleMake: vehicle.make,
        vehicleModel: vehicle.model,
        visionBoardImages: await referenceImages(supabase, supabaseUrl, input),
        visionboard_intent: input?.visionboardIntent || "style_inspiration",
        viewType: HERO_VIEW,
        forceNew: true,
      }, call.signal);
      if (payload?.success !== true || !payload?.storagePath || !payload?.renderUrl) {
        throw edgeError("designpanel_designer_response_invalid", "design-panel-ai-generate did not return a completed render", true);
      }
      const stored = await downloadResult("design-panel-ai-generate", payload);
      return qualityChecked(sourceViewType, {
        ...stored,
        model: LOCKED_MODEL,
        keyFingerprint: "supabase-edge",
        attempts: [],
        contract: EDGE_PROVIDER_CONTRACT,
        metadata: {
          stage: "design-panel-ai-generate",
          sourceFunction: "design-panel-ai-generate",
          execution: "supabase-edge-function",
          anchoredToView1: false,
          designAnchorText: String(payload.designAnchorText || "").trim(),
        },
      }, call.signal);
    }

    const acceptedHero = await hydrateHero();
    if (!acceptedHero) {
      throw edgeError("designpanel_edge_hero_required", `${sourceViewType}: accepted Driver is required`);
    }
    const payload = await invoke("generate-color-render", {
      vehicleYear: String(vehicle.year || ""),
      vehicleMake: String(vehicle.make || ""),
      vehicleModel: String(vehicle.model || ""),
      modeType: "designpanelpro",
      viewType: sourceViewType,
      userEmail: await resolveOwnerEmail(),
      imageSizeOverride: call.imageSize,
      colorData: {
        colorName: input?.designName || input?.companyName || "DesignProAI",
        panelName: input?.designName || input?.companyName || "DesignProAI",
        finish: input?.finish || "Gloss",
        heroReferenceUrl: await compactHeroUrl(),
        designAnchorText: acceptedHero.designAnchorText,
        originalPrompt: String(input?.brief || "").trim(),
      },
      skipLookups: true,
      skipCacheStorage: true,
      skipCache: true,
      forceNew: true,
    }, call.signal);
    if (payload?.sourceFunction !== "generate-color-render" || !payload?.storagePath || !payload?.renderUrl) {
      throw edgeError("designpanel_photographer_response_invalid", "generate-color-render did not return a completed render", true);
    }
    const stored = await downloadResult("generate-color-render", payload);
    return qualityChecked(sourceViewType, {
      ...stored,
      model: LOCKED_MODEL,
      keyFingerprint: "supabase-edge",
      attempts: [],
      contract: EDGE_PROVIDER_CONTRACT,
      metadata: {
        stage: "generate-color-render",
        sourceFunction: "generate-color-render",
        execution: "supabase-edge-function",
        anchoredToView1: true,
        heroStoragePath: acceptedHero.storagePath,
        heroContentHash: acceptedHero.contentHash,
      },
    }, call.signal);
  }

  return {
    generateImage,
    hydrateHero,
    contract: EDGE_PROVIDER_CONTRACT,
    maxProviderAttempts: 4,
    models: [LOCKED_MODEL],
    keyCount: 0,
  };
}

module.exports = {
  EDGE_PROVIDER_CONTRACT,
  LOCKED_MODEL,
  MAX_EDGE_REFERENCE_BYTES,
  compactHeroReference,
  createDesignPanelEdgeProvider,
};
