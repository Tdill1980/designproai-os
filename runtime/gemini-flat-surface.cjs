"use strict";

const { createHash } = require("node:crypto");
const sharp = require("sharp");

const FLAT_SURFACE_CONTRACT = "designpro.gemini-flat-surface.v1";
const PROMPT_VERSION = "designproai-flat-surface-20260806.v1";
const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const VIEW_KEYS = Object.freeze([...SURFACE_KEYS, "hero3d"]);
const HASH_RE = /^[0-9a-f]{64}$/;
const ALLOWED_RESPONSE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_MASTER_PIXELS = 650_000_000;
const SUPPORTED_ASPECTS = Object.freeze([
  ["1:1", 1], ["2:3", 2 / 3], ["3:2", 3 / 2], ["3:4", 3 / 4],
  ["4:3", 4 / 3], ["4:5", 4 / 5], ["5:4", 5 / 4], ["9:16", 9 / 16],
  ["16:9", 16 / 9], ["21:9", 21 / 9],
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value) {
  return sha256(Buffer.from(JSON.stringify(canonical(value))));
}

function normalizeTextLock(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("frozen Call 8 text lock is required");
  const bodyText = value.bodyText;
  const logoPlacements = Array.isArray(value.logoPlacements) ? value.logoPlacements : [];
  const strings = [];
  const visit = (item) => {
    if (typeof item === "string" || typeof item === "number") {
      const text = String(item).replace(/\s+/g, " ").trim();
      if (text && text.length <= 240) strings.push(text);
      return;
    }
    if (Array.isArray(item)) for (const child of item.slice(0, 100)) visit(child);
    else if (item && typeof item === "object") for (const key of Object.keys(item).sort().slice(0, 100)) visit(item[key]);
  };
  visit(bodyText);
  const placements = logoPlacements.map((item, index) => {
    const identityKey = String(item?.identityKey || "").trim();
    const displayName = String(item?.displayName || "").replace(/\s+/g, " ").trim();
    const targetSurfaceKey = String(item?.targetSurfaceKey || item?.surfaceKey || "").trim();
    if (!identityKey || !displayName || !SURFACE_KEYS.includes(targetSurfaceKey)) throw new Error(`invalid logo text-lock placement ${index}`);
    strings.push(displayName);
    return { placementIndex: index, identityKey, displayName, targetSurfaceKey, contentHash: String(item.contentHash || "").toLowerCase() };
  });
  const allowedVisibleStrings = [...new Set(strings)].sort((left, right) => left.localeCompare(right));
  if (allowedVisibleStrings.length > 200) throw new Error("frozen Call 8 text lock is too large");
  return Object.freeze({
    contract: "designpro.call8-text-lock.v1",
    bodyText: canonical(bodyText),
    logoPlacements: placements,
    allowedVisibleStrings,
  });
}

function selectedImageModel(value = process.env.GOOGLE_IMAGE_MODEL) {
  const model = String(value || DEFAULT_IMAGE_MODEL).trim();
  if (!/^gemini-[a-z0-9.-]*image[a-z0-9.-]*$/.test(model)) {
    throw new Error("GOOGLE_IMAGE_MODEL must name an explicit Gemini image-generation model");
  }
  return model;
}

function normalizeSourceSet(sourceViews) {
  if (!Array.isArray(sourceViews) || sourceViews.length !== VIEW_KEYS.length) {
    throw new Error("exactly seven immutable source views are required");
  }
  const byKey = new Map();
  for (const item of sourceViews) {
    const viewKey = String(item?.viewKey || "").trim().toLowerCase();
    const contentHash = String(item?.contentHash || "").trim().toLowerCase();
    const storagePath = String(item?.storagePath || "").trim();
    const contentType = String(item?.contentType || "").trim().toLowerCase();
    const byteSize = Number(item?.byteSize);
    if (!VIEW_KEYS.includes(viewKey) || byKey.has(viewKey) || !HASH_RE.test(contentHash)
      || !storagePath || !Number.isSafeInteger(byteSize) || byteSize <= 0 || !contentType.startsWith("image/")) {
      throw new Error(`invalid immutable source identity for ${viewKey || "unknown view"}`);
    }
    byKey.set(viewKey, Object.freeze({ viewKey, storagePath, contentHash, byteSize, contentType, bytes: item.bytes }));
  }
  if (VIEW_KEYS.some((key) => !byKey.has(key))) throw new Error("the seven-view source set is incomplete");
  if (new Set([...byKey.values()].map((item) => item.contentHash)).size !== VIEW_KEYS.length) {
    throw new Error("the seven immutable source views must have distinct byte hashes");
  }
  return byKey;
}

function normalizeTiles(tiles) {
  if (!Array.isArray(tiles) || tiles.length !== SURFACE_KEYS.length) throw new Error("exactly six flat surfaces are required");
  const byKey = new Map();
  for (const tile of tiles) {
    const key = String(tile?.key || "").trim().toLowerCase();
    const trimWidthIn = Number(tile?.trimWidthIn);
    const trimHeightIn = Number(tile?.trimHeightIn);
    const bleedIn = Number(tile?.bleedIn);
    if (!SURFACE_KEYS.includes(key) || byKey.has(key) || !(trimWidthIn > 0 && trimHeightIn > 0) || bleedIn !== 5) {
      throw new Error(`invalid flat-surface geometry for ${key || "unknown surface"}`);
    }
    byKey.set(key, Object.freeze({ ...tile, key, trimWidthIn, trimHeightIn, bleedIn }));
  }
  if (SURFACE_KEYS.some((key) => !byKey.has(key))) throw new Error("the six-surface set is incomplete");
  return byKey;
}

function flatInputHash({ sourceViews, tiles, revisionId, textLock, model = selectedImageModel() }) {
  const sources = normalizeSourceSet(sourceViews);
  const surfaces = normalizeTiles(tiles);
  const frozenText = normalizeTextLock(textLock);
  return hashJson({
    contract: FLAT_SURFACE_CONTRACT,
    promptVersion: PROMPT_VERSION,
    model: selectedImageModel(model),
    revisionId: String(revisionId || "").trim().toLowerCase(),
    textLock: frozenText,
    sources: VIEW_KEYS.map((viewKey) => {
      const item = sources.get(viewKey);
      return { viewKey, storagePath: item.storagePath, contentHash: item.contentHash, byteSize: item.byteSize, contentType: item.contentType };
    }),
    surfaces: SURFACE_KEYS.map((key) => {
      const item = surfaces.get(key);
      return { key, trimWidthIn: item.trimWidthIn, trimHeightIn: item.trimHeightIn, bleedIn: item.bleedIn };
    }),
  });
}

function closestAspect(width, height) {
  const ratio = Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : 16 / 9;
  return SUPPORTED_ASPECTS.reduce((best, candidate) => (
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best
  ))[0];
}

function flatPrompt(surfaceKey, vehicleName, sourceSetHash, textLock) {
  const label = surfaceKey.toUpperCase();
  const allowedText = textLock.allowedVisibleStrings.length
    ? textLock.allowedVisibleStrings.map((value) => JSON.stringify(value)).join(", ")
    : "NONE";
  return `Create the FLAT, RECTANGULAR, PANEL-READY artwork for the ${label} of this ${vehicleName || "vehicle"}, using the attached approved render as the surface source and the attached hero render only as the cross-vehicle design anchor.

OUTPUT ONLY THE ARTWORK CANVAS. Completely remove the vehicle body, cab, windows, glass, wheels, tires, wheel arches, bumpers, mirrors, lights, handles, seams, ground, studio, shadows, reflections, highlights, and every white or transparent cutout. Continue the real surrounding artwork through every area those vehicle parts covered. Fill all four edges with the design. There must be no vehicle silhouette, no white margin, no transparency, no labels, no dimensions, no border, and no mockup.

Do not redesign, restyle, simplify, or substitute anything. Preserve every graphic and every permitted line of lettering exactly as shown, glyph for glyph, in the same position, size, arrangement, and colors. Preserve exact color relationships, imagery, gradients, patterns, element routing, scale, and placement. Keep photographic elements photographic.

TEXT LOCK: the ONLY visible strings you may render are: ${allowedText}. Never invent, correct, autocomplete, replace, or add a phone number, URL, tagline, company name, badge, or other lettering. If the source contains text not present in this list, omit that text rather than guessing it. PanelPro will compare the result against this exact frozen list.

This returned rectangle becomes the immutable Call 8 flat-surface source. Nothing after it is allowed to heal, invent, or substitute pixels. Seven-view source-set binding: ${sourceSetHash}.`;
}

async function compactReference(item) {
  if (!Buffer.isBuffer(item.bytes) || item.bytes.length !== item.byteSize || sha256(item.bytes) !== item.contentHash) {
    throw new Error(`${item.viewKey} source bytes do not match their immutable identity`);
  }
  const bytes = await sharp(item.bytes, { limitInputPixels: false })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { mimeType: "image/jpeg", data: bytes.toString("base64") };
}

function extractOneImageResponse(payload, label) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  const images = Array.isArray(parts) ? parts.filter((part) => part?.inlineData?.data) : [];
  if (images.length !== 1) {
    const reason = payload?.candidates?.[0]?.finishReason || payload?.promptFeedback?.blockReason || "unknown";
    throw new Error(`${label} Gemini response must contain exactly one image (received ${images.length}; ${reason})`);
  }
  const mimeType = String(images[0].inlineData.mimeType || "").toLowerCase();
  if (!ALLOWED_RESPONSE_TYPES.has(mimeType)) throw new Error(`${label} Gemini returned unsupported ${mimeType || "content type"}`);
  const bytes = Buffer.from(String(images[0].inlineData.data), "base64");
  if (!bytes.length) throw new Error(`${label} Gemini returned an empty image`);
  return { bytes, contentType: mimeType };
}

async function assertOpaqueImage(bytes, label) {
  const image = sharp(bytes, { limitInputPixels: false });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width < 512 || metadata.height < 512) {
    throw new Error(`${label} flat surface is missing or too small`);
  }
  if (metadata.hasAlpha) {
    const alpha = (await image.stats()).channels[3];
    if (alpha && alpha.min < 255) throw new Error(`${label} flat surface contains forbidden transparency`);
  }
  return metadata;
}

async function generateOneSurface({ apiKey, model, surface, ownReference, heroReference, sourceSetHash, textLock, vehicleName, fetchImpl = fetch, signal }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: flatPrompt(surface.key, vehicleName, sourceSetHash, textLock) },
            { text: "APPROVED HERO DESIGN ANCHOR — palette, typography, photography, and graphic routing only:" },
            { inlineData: heroReference },
            { text: `AUTHORITATIVE ${surface.key.toUpperCase()} SURFACE RENDER — geometry and content source:` },
            { inlineData: ownReference },
          ] }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: closestAspect(surface.trimWidthIn, surface.trimHeightIn), imageSize: "4K" },
          },
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
      }
      const image = extractOneImageResponse(await response.json(), surface.key);
      await assertOpaqueImage(image.bytes, surface.key);
      return image.bytes;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw new Error(`${surface.key} flat-surface generation failed closed after 3 attempts: ${lastError?.message || lastError}`);
}

async function masterFromFlat(flatBytes, surface, pixelsPerInch = 150) {
  await assertOpaqueImage(flatBytes, surface.key);
  const trimWidth = Math.max(1, Math.round(surface.trimWidthIn * pixelsPerInch));
  const trimHeight = Math.max(1, Math.round(surface.trimHeightIn * pixelsPerInch));
  const bleed = Math.round(surface.bleedIn * pixelsPerInch);
  if ((trimWidth + bleed * 2) * (trimHeight + bleed * 2) > MAX_MASTER_PIXELS) {
    throw new Error(`${surface.key} validated geometry exceeds the bounded 1:10 @1500dpi worker budget`);
  }
  let trim = await sharp(flatBytes, { limitInputPixels: false })
    .resize(trimWidth, trimHeight, { fit: "inside", kernel: "lanczos3" })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  const fitted = await sharp(trim).metadata();
  const left = Math.floor((trimWidth - fitted.width) / 2);
  const right = trimWidth - fitted.width - left;
  const top = Math.floor((trimHeight - fitted.height) / 2);
  const bottom = trimHeight - fitted.height - top;
  if (left || right || top || bottom) {
    trim = await sharp(trim).extend({ left, right, top, bottom, extendWith: "mirror" }).png().toBuffer();
  }
  return sharp(trim).extend({ left: bleed, right: bleed, top: bleed, bottom: bleed, extendWith: "mirror" }).png().toBuffer();
}

async function validateMaster(bytes, surface, pixelsPerInch = 150) {
  const metadata = await assertOpaqueImage(bytes, `${surface.key} master`);
  const expectedWidth = Math.round((surface.trimWidthIn + surface.bleedIn * 2) * pixelsPerInch);
  const expectedHeight = Math.round((surface.trimHeightIn + surface.bleedIn * 2) * pixelsPerInch);
  if (expectedWidth * expectedHeight > MAX_MASTER_PIXELS) throw new Error(`${surface.key} master exceeds the bounded pixel budget`);
  if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
    throw new Error(`${surface.key} immutable master geometry drifted`);
  }
  return metadata;
}

/**
 * Sequential, retry-safe Call 8 authoring. An immutable master at the fixed
 * material-addressed run/surface path is the winner. A later retry verifies and
 * reuses that winner instead of asking an image model to reproduce its bytes.
 */
async function authorFlatSurfaceMasters(options) {
  const model = selectedImageModel(options.model);
  const sources = normalizeSourceSet(options.sourceViews);
  const surfaces = normalizeTiles(options.tiles);
  const textLock = normalizeTextLock(options.textLock);
  const inputHash = flatInputHash({ sourceViews: options.sourceViews, tiles: options.tiles, revisionId: options.revisionId, textLock, model });
  if (options.inputHash && String(options.inputHash).toLowerCase() !== inputHash) throw new Error("flat-surface material hash mismatch");
  const apiKey = String(options.apiKey || "").trim();
  if (!apiKey && !options.generateSurface) throw new Error("Google image API key is required");
  const generated = options.generateSurface || generateOneSurface;
  const heroReference = await compactReference(sources.get("hero3d"));
  const results = [];
  for (const key of SURFACE_KEYS) {
    if (options.signal?.aborted) throw new Error("flat-surface authoring aborted after lease loss");
    const surface = surfaces.get(key);
    const existingMaster = await options.loadExisting(surface);
    let flatBytes = options.loadExistingFlat ? await options.loadExistingFlat(surface) : null;
    if (existingMaster && !flatBytes) throw new Error(`${key} immutable master is missing its raw flat-surface winner`);
    if (!flatBytes) {
      const ownReference = await compactReference(sources.get(key));
      const generatedBytes = await generated({
        apiKey, model, surface, ownReference, heroReference, sourceSetHash: inputHash, textLock,
        vehicleName: options.vehicleName, fetchImpl: options.fetchImpl, signal: options.signal,
      });
      await assertOpaqueImage(generatedBytes, key);
      flatBytes = await sharp(generatedBytes, { limitInputPixels: false }).flatten({ background: "#ffffff" }).png().toBuffer();
      if (options.signal?.aborted) throw new Error("flat-surface authoring aborted before raw winner write");
      if (!options.persistFlat) throw new Error("raw flat-surface persistence is required");
      await options.persistFlat(surface, flatBytes);
    } else {
      flatBytes = Buffer.from(flatBytes);
    }
    const flatMetadata = await assertOpaqueImage(flatBytes, key);
    if (existingMaster) {
      const bytes = Buffer.from(existingMaster);
      const metadata = await validateMaster(bytes, surface);
      results.push({
        key, bytes, metadata, inputHash, model, flatHash: sha256(flatBytes),
        flatPixelWidth: flatMetadata.width, flatPixelHeight: flatMetadata.height,
        normalizationScaleX: Math.round((surface.trimWidthIn * 150 / flatMetadata.width) * 10000) / 10000,
        normalizationScaleY: Math.round((surface.trimHeightIn * 150 / flatMetadata.height) * 10000) / 10000,
      });
      continue;
    }
    const master = await masterFromFlat(flatBytes, surface);
    const metadata = await validateMaster(master, surface);
    if (options.signal?.aborted) throw new Error("flat-surface authoring aborted before immutable write");
    await options.persist(surface, master);
    results.push({
      key, bytes: master, metadata, inputHash, model, flatHash: sha256(flatBytes),
      flatPixelWidth: flatMetadata.width, flatPixelHeight: flatMetadata.height,
      normalizationScaleX: Math.round((surface.trimWidthIn * 150 / flatMetadata.width) * 10000) / 10000,
      normalizationScaleY: Math.round((surface.trimHeightIn * 150 / flatMetadata.height) * 10000) / 10000,
    });
  }
  if (results.length !== SURFACE_KEYS.length || new Set(results.map((item) => sha256(item.bytes))).size !== SURFACE_KEYS.length) {
    throw new Error("the six flat-surface masters must be complete and byte-distinct");
  }
  return results;
}

module.exports = {
  DEFAULT_IMAGE_MODEL,
  FLAT_SURFACE_CONTRACT,
  MAX_MASTER_PIXELS,
  PROMPT_VERSION,
  SURFACE_KEYS,
  VIEW_KEYS,
  authorFlatSurfaceMasters,
  flatInputHash,
  normalizeTextLock,
  selectedImageModel,
  _test: {
    assertOpaqueImage,
    closestAspect,
    extractOneImageResponse,
    flatPrompt,
    masterFromFlat,
    normalizeTextLock,
    normalizeSourceSet,
    normalizeTiles,
    validateMaster,
  },
};
