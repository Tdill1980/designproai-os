"use strict";

const { createHash } = require("node:crypto");

const BUCKET = "wrap-files";
const EDGE_PROVIDER_CONTRACT = "designpro.designpanel-edge-provider.v1";
const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class DesignPanelEdgeError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function secretFingerprint(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function normalizedBaseUrl(value) {
  const url = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new DesignPanelEdgeError("designpanel_edge_url_invalid", "A valid standalone Supabase URL is required");
  }
  return url;
}

function validatePrivatePath(path, ownerId) {
  const value = String(path || "");
  if (!value || value.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(value)
    || !value.startsWith(`renders/${ownerId}/`)) {
    throw new DesignPanelEdgeError(
      "designpanel_edge_storage_identity_invalid",
      "The Edge function did not return an owner-scoped render identity",
      false,
    );
  }
  return value;
}

function safeDetail(payload, fallback) {
  return String(payload?.message || payload?.error || payload?.code || fallback || "Edge render failed")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function createDesignPanelEdgeProvider(options = {}) {
  const supabase = options.supabase;
  const supabaseUrl = normalizedBaseUrl(options.supabaseUrl || process.env.SUPABASE_URL);
  const serviceRoleKey = String(options.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const ownerId = String(options.ownerId || "").trim().toLowerCase();
  const requestId = String(options.requestId || "").trim().toLowerCase();
  const input = options.input && typeof options.input === "object" ? options.input : {};
  const fetchImpl = options.fetchImpl || fetch;

  if (!supabase) throw new DesignPanelEdgeError("designpanel_edge_supabase_missing", "A Supabase client is required");
  if (!serviceRoleKey) throw new DesignPanelEdgeError("designpanel_edge_secret_missing", "The standalone service credential is required");
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(requestId)) {
    throw new DesignPanelEdgeError("designpanel_edge_identity_invalid", "Owner and request identities must be UUIDs");
  }

  const keyFingerprint = secretFingerprint(serviceRoleKey);
  let ownerEmail = null;
  let hero = null;

  async function resolveOwnerEmail() {
    if (ownerEmail) return ownerEmail;
    const { data, error } = await supabase.auth.admin.getUserById(ownerId);
    const email = String(data?.user?.email || "").trim().toLowerCase();
    if (error || data?.user?.id !== ownerId || !email) {
      throw new DesignPanelEdgeError(
        "designpanel_edge_owner_unavailable",
        error?.message || "The generation owner does not have a usable authenticated email",
        false,
      );
    }
    ownerEmail = email;
    return email;
  }

  async function signPath(storagePath, expiresIn = 900) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresIn);
    if (error || !data?.signedUrl) {
      throw new DesignPanelEdgeError(
        "designpanel_edge_sign_failed",
        `Could not sign ${storagePath}: ${error?.message || "missing signed URL"}`,
        true,
      );
    }
    return data.signedUrl;
  }

  async function signedReferences() {
    const references = [];
    for (const [index, asset] of (Array.isArray(input.visionBoardImages) ? input.visionBoardImages : []).entries()) {
      if (!asset?.storagePath) continue;
      references.push({
        slotLabel: index === 0 ? "VisionBoard Reference" : `VisionBoard Reference ${index + 1}`,
        storageUrl: await signPath(String(asset.storagePath)),
      });
    }
    if (input.logoAsset?.storagePath) {
      references.push({
        slotLabel: "Customer Logo",
        storageUrl: await signPath(String(input.logoAsset.storagePath)),
      });
    }
    return references;
  }

  async function invoke(functionName, body, { signal, timeoutMs = 180_000 } = {}) {
    let response;
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      response = await fetchImpl(`${supabaseUrl}/functions/v1/${encodeURIComponent(functionName)}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "x-designpro-owner-id": ownerId,
        },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      throw new DesignPanelEdgeError(
        "designpanel_edge_unreachable",
        `${functionName}: ${String(error?.message || error)}`,
        true,
      );
    }

    const text = await response.text().catch(() => "");
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; }
    catch { payload = { error: text.slice(0, 500) }; }

    if (!response.ok) {
      throw new DesignPanelEdgeError(
        `designpanel_edge_${response.status}`,
        `${functionName}: ${safeDetail(payload, response.statusText)}`,
        response.status === 429 || response.status >= 500,
      );
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new DesignPanelEdgeError("designpanel_edge_response_invalid", `${functionName}: invalid JSON response`, false);
    }
    return payload;
  }

  async function downloadResult(payload, functionName) {
    const storagePath = validatePrivatePath(payload?.storagePath, ownerId);
    const contentType = String(payload?.contentType || "").toLowerCase().split(";", 1)[0];
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new DesignPanelEdgeError(
        "designpanel_edge_content_type_invalid",
        `${functionName}: unsupported ${contentType || "content type"}`,
        false,
      );
    }
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !data) {
      throw new DesignPanelEdgeError(
        "designpanel_edge_download_failed",
        `${functionName}: ${error?.message || "render bytes missing"}`,
        true,
      );
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    if (!bytes.length) {
      throw new DesignPanelEdgeError("designpanel_edge_empty", `${functionName}: render bytes are empty`, true);
    }
    return { storagePath, contentType, bytes };
  }

  async function hydrateHero() {
    if (hero) return hero;
    const { data, error } = await supabase
      .from("designpro_generation_views")
      .select("storage_path,content_type,metadata")
      .eq("request_id", requestId)
      .eq("source_view_type", "side")
      .is("superseded_at", null)
      .maybeSingle();
    if (error) {
      throw new DesignPanelEdgeError("designpanel_edge_hero_lookup_failed", error.message, true);
    }
    if (!data?.storage_path) return null;
    hero = {
      storagePath: String(data.storage_path),
      contentType: String(data.content_type || "image/png"),
      designAnchorText: String(data.metadata?.provider?.designAnchorText || "").trim() || null,
    };
    return hero;
  }

  async function generateHero({ signal, timeoutMs }) {
    const vehicle = input.vehicle || {};
    const referenceImages = await signedReferences();
    const contactLine = [input.phone, input.website]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" | ");
    const payload = await invoke("design-panel-ai-generate", {
      mode: input.mode === "commercial" || input.companyName || input.businessName ? "commercial" : "restyle",
      prompt: String(input.brief || "").trim(),
      style: input.style,
      finish: input.finish || "Gloss",
      substrate: input.substrate,
      companyName: input.companyName || input.businessName,
      mascot: input.mascot,
      bulletPoints: input.bulletPoints,
      industryType: input.industry,
      phone: contactLine || undefined,
      brandColors: input.brandColors || (Array.isArray(input.colors) ? input.colors.join(", ") : undefined),
      fontStyle: input.fontStyle,
      qrEnabled: input.qrEnabled,
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      visionBoardImages: referenceImages.length ? referenceImages : undefined,
      visionboard_intent: input.visionboardIntent || "style_inspiration",
      styleDescriptors: input.styleDescriptors,
      viewType: "side",
      forceNew: true,
    }, { signal, timeoutMs });
    const result = await downloadResult(payload, "design-panel-ai-generate");
    hero = {
      storagePath: result.storagePath,
      contentType: result.contentType,
      designAnchorText: String(payload.designAnchorText || "").trim() || null,
    };
    return {
      ...result,
      model: "gemini-3-pro-image-preview",
      keyFingerprint,
      attempts: [{ functionName: "design-panel-ai-generate", status: 200 }],
      contract: EDGE_PROVIDER_CONTRACT,
      metadata: {
        sourceFunction: "design-panel-ai-generate",
        designAnchorText: hero.designAnchorText,
      },
    };
  }

  async function generateView({ sourceViewType, imageSize, signal, timeoutMs }) {
    const currentHero = await hydrateHero();
    if (!currentHero?.storagePath) {
      throw new DesignPanelEdgeError(
        "designpanel_edge_hero_required",
        `${sourceViewType}: the accepted driver-side hero must exist before photographer views run`,
        false,
      );
    }
    const vehicle = input.vehicle || {};
    const heroReferenceUrl = await signPath(currentHero.storagePath);
    const email = await resolveOwnerEmail();
    const payload = await invoke("generate-color-render", {
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      modeType: "designpanelpro",
      viewType: sourceViewType,
      userEmail: email,
      skipLookups: true,
      skipCacheStorage: true,
      skipCache: true,
      forceNew: true,
      imageSizeOverride: imageSize || undefined,
      colorData: {
        panelUrl: heroReferenceUrl,
        heroReferenceUrl,
        panelName: input.designName || input.companyName || "DesignProAI",
        finish: input.finish || "Gloss",
        designAnchorText: currentHero.designAnchorText,
        customStylingPrompt: String(input.brief || "").trim(),
      },
    }, { signal, timeoutMs });
    const result = await downloadResult(payload, "generate-color-render");
    return {
      ...result,
      model: "gemini-3-pro-image-preview",
      keyFingerprint,
      attempts: [{ functionName: "generate-color-render", status: 200 }],
      contract: EDGE_PROVIDER_CONTRACT,
      metadata: { sourceFunction: "generate-color-render", heroStoragePath: currentHero.storagePath },
    };
  }

  async function generateImage(optionsForImage = {}) {
    const sourceViewType = String(optionsForImage.sourceViewType || "");
    if (sourceViewType === "side") return generateHero(optionsForImage);
    if (!sourceViewType) {
      throw new DesignPanelEdgeError("designpanel_edge_view_missing", "The server-owned view type is required", false);
    }
    return generateView({ ...optionsForImage, sourceViewType });
  }

  return {
    generateImage,
    hydrateHero,
    contract: EDGE_PROVIDER_CONTRACT,
    maxProviderAttempts: 1,
    models: ["design-panel-ai-generate", "generate-color-render"],
    keyCount: 0,
  };
}

module.exports = {
  EDGE_PROVIDER_CONTRACT,
  DesignPanelEdgeError,
  createDesignPanelEdgeProvider,
  _test: { normalizedBaseUrl, secretFingerprint, validatePrivatePath },
};
