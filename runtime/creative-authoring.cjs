"use strict";

/**
 * The canonical authoring boundary: Calls 1-7 record what they decided.
 *
 * design-master-author.cjs (Phase 6) can assemble a Design Master from creative
 * direction plus authoritative facts. design-master.cjs validates the result.
 * designpro-master-cycle.cjs renders every surface from it. What none of them
 * had was a producer: nothing in the runtime ever emitted `creativeAssets` or a
 * `composition`, so Call 8 refused every run with
 * `call8_design_master_input_missing` and the chain could not start.
 *
 * This is that producer, and it is deliberately NOT a second creative brain.
 * It calls the same provider, with the same key pool, on the same customer
 * brief that already drives the seven views. The only change is that the model
 * is asked to STATE its creative decisions as data before it paints anything.
 *
 * THE DIVISION OF AUTHORITY IS THE SAME ONE THE AUTHOR MODULE ENFORCES.
 *
 *   the model decides   palette, imagery, which roles exist, stacking order,
 *                       which surface each graphic belongs on
 *   this module decides every coordinate, extent and bleed, computed from the
 *                       GENIE manifest
 *   the snapshot owns   every canonical string
 *   the inventory owns  every logo file
 *
 * So a returned specification cannot carry geometry even if it tries: the
 * placement fields are computed here and the model's are never read. And the
 * brief it receives has the customer's own canonical strings redacted out of
 * it, so a creative asset cannot come back with the customer's domain painted
 * into it because the model was never told what that domain is.
 *
 * WHAT THIS IS NOT. It never looks at a rendered vehicle view. The seven views
 * are approval output; production artwork is authored here, from the brief,
 * before any surface is rendered. Nothing in this file reads a render, and
 * nothing reconstructs artwork from one.
 *
 * V1 SCOPE — SURFACE-SPACE PLACEMENT. Every creative layer is placed in a named
 * surface's own space, whose bounds are that surface's GENIE trim plus the 5in
 * production bleed on each edge. Global-space layers (one graphic spanning
 * driver -> hood -> front) are expressible in the master contract and are a
 * later increment: they need the author's global packing geometry, and
 * duplicating that math here would be a second source of truth for where a
 * surface sits.
 */

const {
  CREATIVE_ROLES, CREATIVE_LAYER_TYPES, BLEED_INCHES, CREATIVE_BRIEF_CONTRACT, assertCreativeBriefIsClean,
} = require("./design-master-author.cjs");

const CREATIVE_AUTHORING_CONTRACT = "designpro.creative-authoring.v1";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
// Gemini accepts a fixed set of aspect ratios. A creative asset is generated at
// the ratio closest to the surface it will be placed on, so the placement
// scales it rather than distorting it.
const ASPECT_RATIOS = Object.freeze([
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
]);
const MAX_ASSETS = 8;
const SRGB_RE = /^#[0-9a-f]{6}$/i;
const TOKEN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

class CreativeAuthoringError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "CreativeAuthoringError";
  }
}

function fail(code, message) {
  throw new CreativeAuthoringError(code, message);
}

function nearestAspectRatio(widthIn, heightIn) {
  const target = Number(widthIn) / Number(heightIn);
  let best = ASPECT_RATIOS[0];
  for (const entry of ASPECT_RATIOS) {
    if (Math.abs(Math.log(entry.value / target)) < Math.abs(Math.log(best.value / target))) best = entry;
  }
  return best.label;
}

/**
 * Every string the customer owns, gathered from the places that are already
 * authoritative for it. These are what the model must never be shown and must
 * never hand back.
 */
function canonicalStringsFrom({ bodyText, input }) {
  const strings = [];
  for (const entry of Array.isArray(bodyText) ? bodyText : []) {
    const value = String(entry?.string || "").trim();
    if (value) strings.push(value);
  }
  for (const field of ["businessName", "business", "domain", "website", "phone", "email"]) {
    const value = String(input?.[field] || "").trim();
    if (value) strings.push(value);
  }
  // Longest first so redacting "Precision Climate" does not leave a fragment of
  // "PrecisionClimateAZ.com" behind.
  return [...new Set(strings)].sort((a, b) => b.length - a.length);
}

function redact(text, strings) {
  let output = String(text || "");
  for (const value of strings) {
    if (!value) continue;
    const pattern = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    output = output.replace(pattern, "the customer's name");
  }
  return output;
}

/**
 * The brief the model is allowed to see: the customer's creative intent with
 * their identity removed. Style, industry, colour direction and the vehicle
 * survive; names, domains and phone numbers do not.
 *
 * Returned as the author module's `designpro.creative-brief.v1` object rather
 * than prose, because that is the shape assertCreativeBriefIsClean audits — and
 * this brief has to survive that audit before a single asset is painted.
 */
function buildCreativeBrief({ input, canonicalStrings }) {
  const vehicle = input?.vehicle || {};
  const intent = redact(
    String(input?.brief || input?.designBrief || input?.description || "").trim(),
    canonicalStrings,
  );
  const colours = Array.isArray(input?.colors)
    ? input.colors.map((value) => String(value || "").trim()).filter(Boolean)
    : String(input?.colors || "").trim() ? [String(input.colors).trim()] : [];

  return {
    contract: CREATIVE_BRIEF_CONTRACT,
    intent: intent || "Professional commercial vehicle wrap artwork.",
    industry: String(input?.industry || "").trim(),
    colours,
    style: String(input?.style || "").trim(),
    // Descriptive only. No dimension ever enters the brief: the author refuses a
    // brief carrying geometry, and geometry is this module's job anyway.
    vehicle: {
      year: String(vehicle.year || "").trim(),
      make: String(vehicle.make || "").trim(),
      model: String(vehicle.model || "").trim(),
      type: String(vehicle.type || "").trim(),
    },
  };
}

/** The brief rendered for the model, from the audited object. */
function briefProse(brief) {
  const lines = [brief.intent];
  if (brief.industry) lines.push(`Industry: ${brief.industry}`);
  if (brief.colours?.length) lines.push(`Colour direction: ${brief.colours.join(", ")}`);
  if (brief.style) lines.push(`Style: ${brief.style}`);
  const descriptor = [brief.vehicle?.year, brief.vehicle?.make, brief.vehicle?.model]
    .map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  lines.push(`Vehicle: ${descriptor || "commercial vehicle"}${brief.vehicle?.type ? ` (${brief.vehicle.type})` : ""}`);
  return lines.join("\n");
}

function specificationPrompt({ creativeBrief, surfaces }) {
  const surfaceList = surfaces
    .map((surface) => `${surface.surfaceKey} (${surface.widthIn}in x ${surface.heightIn}in)`)
    .join(", ");
  return [
    "You are the senior creative director for a vehicle wrap studio.",
    "Decide the artwork for this wrap and RETURN THE DECISION AS JSON. Do not draw anything yet.",
    "",
    "BRIEF",
    briefProse(creativeBrief),
    "",
    `SURFACES: ${surfaceList}`,
    "",
    "Return exactly this JSON shape:",
    '{"palette":[{"token":"kebab-case-name","srgb":"#rrggbb"}],',
    ' "assets":[{"assetId":"kebab-case-id","role":"background|texture|pattern|abstract|decorative|photography",',
    '            "surfaceKey":"driver|passenger|hood|roof|front|rear","zOrder":0,"opacity":1.0,',
    '            "blend":"normal","prompt":"what to paint"}]}',
    "",
    "RULES:",
    "- Every surface listed above must be covered by at least one asset whose role is background.",
    "- `prompt` describes IMAGERY ONLY: colour, texture, gradient, pattern, photographic or abstract",
    "  content. It must never ask for words, letters, numerals, lettering, a logo, a wordmark, a phone",
    "  number, a domain or any readable text. Type and marks are placed later by the production system,",
    "  not painted into artwork.",
    "- Do not invent a company name and do not describe one.",
    "- 2 to 8 assets in total. Lower zOrder paints first.",
    "- Return JSON only.",
  ].join("\n");
}

// Words that mean the model tried to paint identity into an asset. A creative
// asset carrying lettering would become the source of a string it has no
// authority over, which is exactly the failure the master contract exists to
// prevent -- so it is refused here rather than composited and discovered later.
const FORBIDDEN_PROMPT_TERMS = Object.freeze([
  "text", "lettering", "letters", "word", "wordmark", "logo", "typography", "font",
  "phone number", "domain", "website", "url", "slogan", "tagline", "sign writing", "signage",
  "caption", "label", "name of", "spelling", "numerals", "digits",
]);

function assertPromptIsImageryOnly(prompt, label) {
  const lowered = String(prompt || "").toLowerCase();
  for (const term of FORBIDDEN_PROMPT_TERMS) {
    if (lowered.includes(term)) {
      fail("creative_prompt_requests_identity",
        `${label} asks for "${term}"; a creative asset is imagery only, and type and marks are placed by the production system`);
    }
  }
}

/**
 * Fail-closed reading of what the model returned. Nothing is defaulted or
 * repaired: a specification that does not say what it decided is not a
 * decision, and guessing on its behalf would put this module back in the
 * business of inventing the design.
 */
function validateSpecification(raw, { surfaces, canonicalStrings }) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("creative_spec_invalid", "the specification is not a JSON object");

  const palette = [];
  const tokens = new Set();
  for (const entry of Array.isArray(raw.palette) ? raw.palette : []) {
    const token = String(entry?.token || "").trim().toLowerCase();
    const srgb = String(entry?.srgb || "").trim().toLowerCase();
    if (!TOKEN_RE.test(token)) fail("creative_palette_token_invalid", `palette token "${entry?.token}" is not a kebab-case token`);
    if (!SRGB_RE.test(srgb)) fail("creative_palette_srgb_invalid", `palette ${token}.srgb must be #rrggbb`);
    if (tokens.has(token)) fail("creative_palette_duplicate", `palette token ${token} is declared twice`);
    tokens.add(token);
    palette.push({ token, srgb });
  }
  if (!palette.length) fail("creative_palette_empty", "the specification declares no palette");

  const surfaceByKey = new Map(surfaces.map((surface) => [surface.surfaceKey, surface]));
  const assets = Array.isArray(raw.assets) ? raw.assets : [];
  if (!assets.length) fail("creative_assets_empty", "the specification plans no creative assets");
  if (assets.length > MAX_ASSETS) fail("creative_assets_excessive", `the specification plans ${assets.length} assets; the ceiling is ${MAX_ASSETS}`);

  const ids = new Set();
  const covered = new Set();
  const planned = assets.map((entry, index) => {
    const label = `assets[${index}]`;
    const assetId = String(entry?.assetId || "").trim().toLowerCase();
    if (!TOKEN_RE.test(assetId)) fail("creative_asset_id_invalid", `${label}.assetId "${entry?.assetId}" is not a kebab-case token`);
    // `logo-<identityKey>` is the author's reserved namespace for real logo
    // files. A generated asset must never occupy one.
    if (assetId.startsWith("logo-")) fail("creative_asset_id_reserved", `${label}.assetId ${assetId} is in the reserved logo namespace`);
    if (ids.has(assetId)) fail("creative_asset_duplicate", `${label}.assetId ${assetId} is declared twice`);
    ids.add(assetId);

    const role = String(entry?.role || "").trim().toLowerCase();
    if (!CREATIVE_ROLES.includes(role)) fail("creative_asset_role_unknown", `${label}.role "${entry?.role}" is not one of ${CREATIVE_ROLES.join(", ")}`);

    const surfaceKey = String(entry?.surfaceKey || "").trim().toLowerCase();
    const surface = surfaceByKey.get(surfaceKey);
    if (!surface) fail("creative_asset_surface_unknown", `${label}.surfaceKey "${entry?.surfaceKey}" is not one of the six production surfaces`);
    if (role === "background") covered.add(surfaceKey);

    const type = String(entry?.type || "raster").trim().toLowerCase();
    if (!CREATIVE_LAYER_TYPES.includes(type)) fail("creative_asset_type_invalid", `${label}.type "${type}" is not a creative layer type`);

    const prompt = String(entry?.prompt || "").trim();
    if (prompt.length < 8) fail("creative_asset_prompt_missing", `${label}.prompt does not describe what to paint`);
    assertPromptIsImageryOnly(prompt, `${label}.prompt`);
    // The model was never shown these strings. If one comes back it means the
    // redaction leaked or the model inferred it, and either way the artwork
    // must not carry it.
    for (const value of canonicalStrings) {
      if (prompt.toLowerCase().includes(String(value).toLowerCase())) {
        fail("creative_prompt_carries_canonical_string",
          `${label}.prompt names a string the revision snapshot owns; generated artwork is never the source of a customer's own words`);
      }
    }

    const zOrder = Number(entry?.zOrder);
    if (!Number.isFinite(zOrder)) fail("creative_asset_z_invalid", `${label}.zOrder must be a number`);
    const opacity = entry?.opacity === undefined ? 1 : Number(entry.opacity);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) fail("creative_asset_opacity_invalid", `${label}.opacity must be between 0 and 1`);

    return { assetId, role, surfaceKey, surface, type, prompt, zOrder, opacity, blend: String(entry?.blend || "normal").trim().toLowerCase() };
  });

  const uncovered = surfaces.map((surface) => surface.surfaceKey).filter((key) => !covered.has(key));
  if (uncovered.length) {
    fail("creative_surface_uncovered", `no background asset covers ${uncovered.join(", ")}; every production surface must carry artwork`);
  }
  return { palette, planned };
}

/**
 * The surfaces the design is authored against, read from the bound GENIE
 * manifest. Geometry has exactly one source and this is it.
 */
function surfacesFromManifest(manifest) {
  const expected = Array.isArray(manifest?.expectedSurfaces) ? manifest.expectedSurfaces : null;
  if (!expected) fail("creative_manifest_missing", "authoring requires the bound GENIE dimension manifest");
  const surfaces = [];
  for (const key of SURFACE_KEYS) {
    const entry = expected.find((item) => String(item?.surfaceKey || "").trim().toLowerCase() === key);
    if (!entry) fail("creative_manifest_incomplete", `the manifest is missing ${key}`);
    const widthIn = Number(entry.widthInches);
    const heightIn = Number(entry.heightInches);
    if (!(widthIn > 0 && heightIn > 0)) fail("creative_manifest_dimension_invalid", `${key} has no positive GENIE dimensions`);
    surfaces.push({ surfaceKey: key, widthIn, heightIn });
  }
  return surfaces;
}

/**
 * Produce the authoring input Call 8 consumes.
 *
 * Returns the exact object that belongs at `revisionSnapshot.designMaster`:
 * a clean creative brief, the generated creative assets with their provenance,
 * and a composition whose every coordinate was computed here from the manifest.
 */
async function authorCreativeInput({
  provider, store, manifest, input, bodyText, ownerId, revisionId, imageSize = "4K", logger,
}) {
  if (!provider?.generateSpecification || !provider?.generateImage) {
    fail("creative_provider_invalid", "authoring requires a provider offering both generateSpecification and generateImage");
  }
  if (!store?.putImmutableBytes) fail("creative_store_invalid", "authoring requires a generation store");
  if (!String(ownerId || "").trim() || !String(revisionId || "").trim()) {
    fail("creative_identity_missing", "authoring requires the owner and revision it is authoring for");
  }

  const surfaces = surfacesFromManifest(manifest);
  const canonicalStrings = canonicalStringsFrom({ bodyText, input });
  const creativeBrief = buildCreativeBrief({ input, canonicalStrings });
  // Audited here, at the point of production, rather than trusted. If the
  // redaction ever leaks a canonical string the run stops before a model is
  // paid to paint it.
  assertCreativeBriefIsClean(creativeBrief, {
    textStrings: canonicalStrings,
    logoHashes: [],
  });

  const direction = await provider.generateSpecification({
    parts: [{ text: specificationPrompt({ creativeBrief, surfaces }) }],
    label: "creative direction",
  });
  const { palette, planned } = validateSpecification(direction.specification, { surfaces, canonicalStrings });
  logger?.(`creative direction: ${planned.length} assets, ${palette.length} palette entries (${direction.model})`);

  const creativeAssets = [];
  const layers = [];
  for (const plan of planned) {
    const bleedWidthIn = plan.surface.widthIn + BLEED_INCHES * 2;
    const bleedHeightIn = plan.surface.heightIn + BLEED_INCHES * 2;
    const painted = await provider.generateImage({
      parts: [{ text: `${plan.prompt}\n\nPaint imagery only: no words, letters, numerals, logos or readable marks of any kind. Fill the entire frame edge to edge.` }],
      aspectRatio: nearestAspectRatio(bleedWidthIn, bleedHeightIn),
      imageSize,
      label: `creative asset ${plan.assetId}`,
    });
    const extension = painted.contentType === "image/png" ? "png" : painted.contentType === "image/webp" ? "webp" : "jpg";
    const stored = await store.putImmutableBytes({
      storagePath: `users/${ownerId}/revisions/${revisionId}/authoring/${plan.assetId}.${extension}`,
      bytes: painted.bytes,
      contentType: painted.contentType,
    });
    // Measured, never assumed: minPxPerInch is what this asset actually
    // delivers across the extent it is placed at, and the master contract
    // rejects a placement that cannot carry its own resolution.
    const { width, height } = await imageDimensions(painted.bytes);
    creativeAssets.push({
      assetId: plan.assetId,
      kind: "raster",
      contentHash: stored.contentHash,
      storagePath: stored.storagePath,
      role: plan.role,
      generatedBy: `${direction.contract}:${painted.model}:${painted.keyFingerprint}`,
      intrinsic: { widthPx: width, heightPx: height },
      minPxPerInch: Math.min(width / bleedWidthIn, height / bleedHeightIn),
    });
    layers.push({
      layerId: `${plan.surfaceKey}-${plan.assetId}`,
      assetId: plan.assetId,
      type: plan.type,
      space: plan.surfaceKey,
      // Every coordinate below is computed from the manifest. The model's
      // opinion about placement, if it offered one, was never read.
      extent: { widthIn: bleedWidthIn, heightIn: bleedHeightIn },
      transform: { x: 0, y: 0, scale: 1, rotate: 0 },
      zOrder: plan.zOrder,
      opacity: plan.opacity,
      blend: plan.blend,
    });
    logger?.(`  ${plan.assetId} (${plan.role} on ${plan.surfaceKey}) ${width}x${height}px`);
  }

  return {
    contractVersion: CREATIVE_AUTHORING_CONTRACT,
    creativeBrief,
    palette,
    creativeAssets,
    composition: { layers },
    provenance: {
      specificationModel: direction.model,
      specificationKeyFingerprint: direction.keyFingerprint,
      surfaceSource: "genie.dimension-manifest",
      redactedCanonicalStrings: canonicalStrings.length,
      authoredFrom: "customer-brief",
      readsRenderedViews: false,
    },
  };
}

/**
 * Intrinsic pixel size, read from the encoded bytes. sharp is already a runtime
 * dependency of the production stages, so this adds no new surface.
 */
async function imageDimensions(bytes) {
  const sharp = require("sharp");
  const metadata = await sharp(bytes, { limitInputPixels: false }).metadata();
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  if (!(width > 0 && height > 0)) fail("creative_asset_undecodable", "a generated creative asset has no readable pixel dimensions");
  return { width, height };
}

module.exports = {
  CREATIVE_AUTHORING_CONTRACT,
  MAX_ASSETS,
  CreativeAuthoringError,
  authorCreativeInput,
  briefProse,
  buildCreativeBrief,
  canonicalStringsFrom,
  nearestAspectRatio,
  redact,
  specificationPrompt,
  surfacesFromManifest,
  validateSpecification,
  _test: { assertPromptIsImageryOnly, imageDimensions, FORBIDDEN_PROMPT_TERMS },
};
