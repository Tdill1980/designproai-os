"use strict";

/**
 * Call 8 authoring: ONE continuous flat wrap design for the whole vehicle.
 *
 * The previous boundary made six independent image calls, one per surface, and
 * handed every one of them the 3D hero render as a "cross-vehicle design
 * anchor". The hero is a three-quarter view — mostly driver side — so the hood,
 * roof, front and rear calls were each shown a large driver-side image and told
 * to follow its graphic routing. That is how driver artwork reached every
 * panel. There is no per-surface call here to contaminate: the design is
 * authored once, and Call 9 cuts the panels out of it.
 *
 * The authored layout is the immutable winner at a material-addressed path. A
 * retry verifies and reuses that winner instead of asking a model to reproduce
 * its bytes.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { normalizeTextLock, selectedImageModel, VIEW_KEYS, _test: flatSurfaceInternals } = require("./gemini-flat-surface.cjs");
const { layoutIdentity, normalizeGeneratedLayout } = require("./flat-wrap-layout.cjs");
const { endpointFor } = require("./generation-provider.cjs");

const FLAT_WRAP_CONTRACT = "designpro.gemini-flat-wrap.v1";
const PROMPT_VERSION = "designproai-flat-wrap-20260812.v1";
const ALLOWED_RESPONSE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const HASH_RE = /^[0-9a-f]{64}$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

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
    if (!VIEW_KEYS.includes(viewKey) || byKey.has(viewKey) || !HASH_RE.test(contentHash) || !storagePath
      || !Number.isSafeInteger(byteSize) || byteSize <= 0 || !contentType.startsWith("image/")) {
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

/**
 * Binds the single authored design to its seven immutable sources, the exact
 * cut map, the frozen text lock and the model. Any drift changes the hash and
 * the stage refuses to reuse a stale winner.
 */
function flatWrapInputHash({ sourceViews, layout, revisionId, textLock, model = selectedImageModel() }) {
  const sources = normalizeSourceSet(sourceViews);
  const frozenText = normalizeTextLock(textLock);
  return sha256(Buffer.from(JSON.stringify(canonical({
    contract: FLAT_WRAP_CONTRACT,
    promptVersion: PROMPT_VERSION,
    model: selectedImageModel(model),
    revisionId: String(revisionId || "").trim().toLowerCase(),
    textLock: frozenText,
    layout: layoutIdentity(layout),
    canvas: { width: layout.width, height: layout.height, scalePxPerInch: layout.scalePxPerInch },
    sources: VIEW_KEYS.map((viewKey) => {
      const item = sources.get(viewKey);
      return { viewKey, storagePath: item.storagePath, contentHash: item.contentHash, byteSize: item.byteSize, contentType: item.contentType };
    }),
  }))));
}

function wrapPrompt(vehicleName, layout, sourceSetHash, textLock) {
  const allowedText = textLock.allowedVisibleStrings.length
    ? textLock.allowedVisibleStrings.map((value) => JSON.stringify(value)).join(", ")
    : "NONE";
  const coverage = layout.cells
    .map((cell) => `${cell.surfaceKey} ${cell.trimWidthIn}in x ${cell.trimHeightIn}in`)
    .join(", ");
  return `Create ONE continuous FLAT wrap design for a ${vehicleName || "vehicle"}, exactly as a wrap designer paints a single graphic across a full vehicle template before it is cut into panels.

OUTPUT ONLY THE ARTWORK CANVAS, ${layout.canvasWidthIn} x ${layout.canvasHeightIn} proportions. The design must run edge to edge and corner to corner as one unbroken composition. Completely remove the vehicle body, cab, windows, glass, wheels, tires, wheel arches, bumpers, mirrors, lights, handles, seams, ground, studio, shadows, reflections, highlights, and every white or transparent cutout. There must be no vehicle silhouette, no panel outlines, no grid, no labels, no dimensions, no border, no margin, no transparency and no mockup.

This single canvas will be mechanically cut into the six production panels (${coverage}), so the composition must stay interesting and complete across the whole surface. Do not centre a single focal object; do not leave empty or repeating regions; do not compose it as separate tiles.

Take the palette, imagery, gradients, patterns, photographic treatment and graphic language from the attached approved renders of this exact design. Do not redesign, restyle, simplify or substitute anything. Keep photographic elements photographic.

TEXT LOCK: the ONLY visible strings you may render are: ${allowedText}. Never invent, correct, autocomplete, replace or add a phone number, URL, tagline, company name, badge or other lettering. If the source contains text not present in this list, omit that text rather than guessing it. Customer logos are printed on top of these panels later and must NOT be drawn into this base artwork.

This returned canvas becomes the immutable Call 8 flat wrap layout. Nothing after it is allowed to heal, invent or substitute pixels. Seven-view source-set binding: ${sourceSetHash}.`;
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
  return bytes;
}

async function compactReference(item) {
  if (!Buffer.isBuffer(item.bytes) || item.bytes.length !== item.byteSize || sha256(item.bytes) !== item.contentHash) {
    throw new Error(`${item.viewKey} source bytes do not match their immutable identity`);
  }
  const bytes = await sharp(item.bytes, { limitInputPixels: false })
    .rotate().flatten({ background: "#ffffff" })
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { mimeType: "image/jpeg", data: bytes.toString("base64") };
}

async function generateOneLayout({ apiKey, model, layout, references, sourceSetHash, textLock, vehicleName, fetchImpl = fetch, signal }) {
  // Endpoint and credential come from the provider, which is the one place
  // this runtime states where a model lives. The retry below stays local: it
  // is a backoff on one key, not the provider's rotation across a pool.
  const request = endpointFor(model, apiKey);
  const parts = [{ text: wrapPrompt(vehicleName, layout, sourceSetHash, textLock) }];
  for (const reference of references) {
    parts.push({ text: `APPROVED ${reference.viewKey.toUpperCase()} RENDER of this exact design — palette, imagery and graphic language reference:` });
    parts.push({ inlineData: reference.inline });
  }
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: flatSurfaceInternals.closestAspect(layout.width, layout.height), imageSize: "4K" },
          },
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
      }
      return extractOneImageResponse(await response.json(), "flat wrap layout");
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw new Error(`flat wrap layout generation failed closed after 3 attempts: ${lastError?.message || lastError}`);
}

async function authorFlatWrapLayout(options) {
  const model = selectedImageModel(options.model);
  const sources = normalizeSourceSet(options.sourceViews);
  const textLock = normalizeTextLock(options.textLock);
  const layout = options.layout;
  const inputHash = flatWrapInputHash({ sourceViews: options.sourceViews, layout, revisionId: options.revisionId, textLock, model });
  if (options.inputHash && String(options.inputHash).toLowerCase() !== inputHash) throw new Error("flat wrap material hash mismatch");
  const apiKey = String(options.apiKey || "").trim();
  if (!apiKey && !options.generateLayout) throw new Error("Google image API key is required");

  const existing = options.loadExisting ? await options.loadExisting() : null;
  if (existing) {
    const bytes = Buffer.from(existing);
    const metadata = await sharp(bytes, { limitInputPixels: false }).metadata();
    if (metadata.width !== layout.width || metadata.height !== layout.height) {
      throw new Error(`immutable flat wrap winner is ${metadata.width}x${metadata.height}, not the recorded ${layout.width}x${layout.height}`);
    }
    return { bytes, contentHash: sha256(bytes), inputHash, model, promptVersion: PROMPT_VERSION, reused: true };
  }

  const references = [];
  for (const viewKey of VIEW_KEYS) references.push({ viewKey, inline: await compactReference(sources.get(viewKey)) });
  const generate = options.generateLayout || generateOneLayout;
  const generated = await generate({
    apiKey, model, layout, references, sourceSetHash: inputHash, textLock,
    vehicleName: options.vehicleName, fetchImpl: options.fetchImpl, signal: options.signal,
  });
  const bytes = await normalizeGeneratedLayout(generated, layout);
  if (options.signal?.aborted) throw new Error("flat wrap authoring aborted before immutable write");
  if (!options.persist) throw new Error("flat wrap persistence is required");
  await options.persist(bytes);
  return {
    bytes, contentHash: sha256(bytes), inputHash, model, promptVersion: PROMPT_VERSION, reused: false,
    generatedSha256: sha256(generated),
  };
}

module.exports = {
  FLAT_WRAP_CONTRACT,
  PROMPT_VERSION,
  authorFlatWrapLayout,
  flatWrapInputHash,
  _test: { extractOneImageResponse, normalizeSourceSet, wrapPrompt },
};
