"use strict";

/**
 * Server Call 8 flat-surface authoring.
 *
 * Each production surface is flattened from that surface's own immutable
 * DesignPanel render. The hero/driver render is never attached to another
 * surface. Call 9 later runs deterministic gridslice against these fields.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");

const FLAT_SURFACE_CONTRACT = "designpro.gemini-flat-surface.server.v4";
const PROMPT_VERSION = "designproai-sidefield-generate-qc-retry-server-20260821.v1";
const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const VIEW_KEYS = Object.freeze([...SURFACE_KEYS, "hero3d"]);
const HASH_RE = /^[0-9a-f]{64}$/;
const ALLOWED_RESPONSE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const QC_HARD_ISSUES = new Set(["wrong_design", "tiled_or_repeated"]);
const QC_ALLOWED_ISSUES = new Set([
  "vehicle_remnants", "floor_or_background", "wrong_design",
  "tiled_or_repeated", "text_missing", "qc_unavailable",
]);
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("frozen Call 8 text lock is required");
  }
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
    else if (item && typeof item === "object") {
      for (const key of Object.keys(item).sort().slice(0, 100)) visit(item[key]);
    }
  };
  visit(bodyText);
  const placements = logoPlacements.map((item, index) => {
    const identityKey = String(item?.identityKey || "").trim();
    const displayName = String(item?.displayName || "").replace(/\s+/g, " ").trim();
    const targetSurfaceKey = String(item?.targetSurfaceKey || item?.surfaceKey || "").trim().toLowerCase();
    const contentHash = String(item?.contentHash || "").trim().toLowerCase();
    if (!identityKey || !displayName || !SURFACE_KEYS.includes(targetSurfaceKey) || !HASH_RE.test(contentHash)) {
      throw new Error(`invalid logo text-lock placement ${index}`);
    }
    strings.push(displayName);
    return { placementIndex: index, identityKey, displayName, targetSurfaceKey, contentHash };
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

function normalizeSurfaces(surfaces) {
  if (!Array.isArray(surfaces) || surfaces.length !== SURFACE_KEYS.length) {
    throw new Error("exactly six GENIE surfaces are required");
  }
  const byKey = new Map();
  for (const surface of surfaces) {
    const surfaceKey = String(surface?.surfaceKey || surface?.key || "").trim().toLowerCase();
    const trimWidthIn = Number(surface?.widthInches ?? surface?.trimWidthIn);
    const trimHeightIn = Number(surface?.heightInches ?? surface?.trimHeightIn);
    if (!SURFACE_KEYS.includes(surfaceKey) || byKey.has(surfaceKey) || !(trimWidthIn > 0) || !(trimHeightIn > 0)) {
      throw new Error(`invalid GENIE surface ${surfaceKey || "unknown"}`);
    }
    byKey.set(surfaceKey, Object.freeze({ surfaceKey, trimWidthIn, trimHeightIn }));
  }
  if (SURFACE_KEYS.some((key) => !byKey.has(key))) throw new Error("the six-surface set is incomplete");
  return byKey;
}

function flatSurfaceInputHash({ sourceViews, surfaces, revisionId, textLock, model = selectedImageModel() }) {
  const sources = normalizeSourceSet(sourceViews);
  const geometry = normalizeSurfaces(surfaces);
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
    surfaces: SURFACE_KEYS.map((surfaceKey) => geometry.get(surfaceKey)),
  });
}

function closestAspect(width, height) {
  const ratio = Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : 16 / 9;
  return SUPPORTED_ASPECTS.reduce((best, candidate) => (
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best
  ))[0];
}

function cleanTiers(surfaceKey, vehicleName, sourceSetHash, textLock) {
  const label = surfaceKey.toUpperCase();
  const allowedText = textLock.allowedVisibleStrings.length
    ? textLock.allowedVisibleStrings.map((value) => JSON.stringify(value)).join(", ")
    : "NONE";
  const identity = `This is the ${label} of the approved ${vehicleName || "vehicle"}. Use only the attached ${label} render. Do not import, recall, mirror, or continue artwork from the driver side, another surface, or an earlier request. TEXT LOCK: the only visible strings allowed are ${allowedText}. Never invent, correct, autocomplete, replace, or add lettering. Immutable seven-view source-set binding: ${sourceSetHash}.`;
  const brandLine = "KEEP every logo, company name, and all lettering of the WRAP DESIGN exactly as shown — same content, spelling, size, position, and colors; never redraw or reflow type. Manufacturer emblems and model badges belong to the VEHICLE and must not appear.";
  return [
    `${identity}\n\nTake the attached image and EDIT it — do not redraw, restyle, or reinvent anything. Remove only the vehicle STRUCTURE: windows and glass, wheels, tires, wheel arches, bumpers, grille, mirrors, lights, door handles, panel seams, manufacturer badges and emblems, the ground, and the studio background. The painted BODY COLOR is part of the wrap design — keep it as the flat background covering the same share of the canvas it covers on the vehicle. KEEP every graphic EXACTLY as shown — identical colors, shapes, gradients, and flow, at the SAME size and position. NEVER tile, repeat, duplicate, enlarge, or add graphics, and NEVER fill plain body-color areas with extra pattern — large solid areas are correct. If it contains a flag, preserve that exact flag and never replace it with a stock flag. ${brandLine} Extend the body color and existing artwork naturally to all four edges so the result is ONE continuous flat rectangle — the same wrap design flattened, nothing new invented.`,
    `${identity}\n\nEdit the attached image: remove the vehicle structure (glass, wheels, bumpers, mirrors, lights, seams, manufacturer badges/emblems, ground, and background), but keep all wrap text and logos exactly in place. Keep the painted body color as the flat background and every graphic exactly as-is at its original size and position. Do not tile, repeat, or add pattern; plain body-color areas stay plain. Extend the body color and artwork naturally edge to edge.`,
    `${identity}\n\nRemove the vehicle structure while keeping every wrap graphic and line of lettering in place. Keep the exact body color and graphics at their original scale and position, extending them naturally to every edge. Add nothing new. Output only one opaque, edge-to-edge flat artwork rectangle.`,
  ];
}

function flatPrompt(surfaceKey, vehicleName, sourceSetHash, textLock, attempt = 1) {
  return cleanTiers(surfaceKey, vehicleName, sourceSetHash, textLock)[Math.min(Math.max(1, attempt) - 1, 2)];
}

async function verifiedReference(item) {
  if (!Buffer.isBuffer(item.bytes) || item.bytes.length !== item.byteSize || sha256(item.bytes) !== item.contentHash) {
    throw new Error(`${item.viewKey} source bytes do not match their immutable identity`);
  }
  const metadata = await sharp(item.bytes, { limitInputPixels: false }).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`${item.viewKey} source is not a decodable raster`);
  return { mimeType: item.contentType, data: item.bytes.toString("base64"), bytes: item.bytes };
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

async function generateOneSurface({ apiKeys, model, surface, ownReference, sourceSetHash, textLock, vehicleName, attempt, fetchImpl = fetch, signal }) {
  let lastError = "no image";
  for (const apiKey of apiKeys) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: `PANEL REFERENCE (${surface.surfaceKey}) — flatten THIS exact wrap side into ONE continuous flat field:` },
            { text: flatPrompt(surface.surfaceKey, vehicleName, sourceSetHash, textLock, attempt) },
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
        lastError = `HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`;
        if (response.status === 429 || response.status >= 500) continue;
        return null;
      }
      const bytes = extractOneImageResponse(await response.json(), surface.surfaceKey);
      await assertOpaqueImage(bytes, surface.surfaceKey);
      return bytes;
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  if (lastError) return null;
  return null;
}

async function judgeSurface({ apiKeys, model, ownReference, fieldBytes, surfaceKey, fetchImpl = fetch, signal }) {
  const prompt = `You are print-production QC for vehicle wraps. IMAGE 1 is the approved ${surfaceKey} render. IMAGE 2 must be that exact side flattened into ONE continuous field: no glass, wheels, bumpers, lights, floor, studio, shadows, reflections, or manufacturer emblems; painted body color preserved; every wrap graphic at its original scale and position; all wrap logos and lettering kept exactly in place; nothing invented, tiled, or repeated. Return ONLY JSON: {"pass":true|false,"issues":[...],"note":"one short sentence"}. Allowed issue codes: "vehicle_remnants", "floor_or_background", "wrong_design", "tiled_or_repeated", "text_missing". Only list real problems.`;
  try {
    const fieldSmall = await sharp(fieldBytes, { limitInputPixels: false }).resize(1024, 1024, { fit: "inside" }).png().toBuffer();
    const sourceSmall = await sharp(ownReference.bytes, { limitInputPixels: false }).resize(1024, 1024, { fit: "inside" }).png().toBuffer();
    for (const apiKey of apiKeys) {
      try {
        const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: prompt },
              { inlineData: { mimeType: "image/png", data: sourceSmall.toString("base64") } },
              { inlineData: { mimeType: "image/png", data: fieldSmall.toString("base64") } },
            ] }],
            generationConfig: { responseModalities: ["TEXT"], temperature: 0 },
          }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
        });
        if (response.status === 429 || response.status >= 500) continue;
        if (!response.ok) break;
        const payload = await response.json();
        const text = (payload?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || "").join("");
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) break;
        const verdict = JSON.parse(match[0]);
        const issues = Array.isArray(verdict.issues) ? verdict.issues.map(String) : [];
        const unknown = issues.filter((issue) => !QC_ALLOWED_ISSUES.has(issue));
        if (unknown.length) return { pass: false, issues: ["wrong_design"], note: `QC returned unknown issue code ${unknown[0]}` };
        return { pass: verdict.pass === true && issues.length === 0, issues, note: String(verdict.note || "").slice(0, 240) };
      } catch { /* rotate the server key pool */ }
    }
  } catch { /* preserve the proven fail-open judge behavior */ }
  return { pass: true, issues: ["qc_unavailable"], note: "QC judge unavailable — accepted with explicit flag" };
}

async function authorFlatSurfaceFields(options) {
  const model = selectedImageModel(options.model);
  const sources = normalizeSourceSet(options.sourceViews);
  const surfaces = normalizeSurfaces(options.surfaces);
  const textLock = normalizeTextLock(options.textLock);
  const inputHash = flatSurfaceInputHash({ sourceViews: options.sourceViews, surfaces: options.surfaces, revisionId: options.revisionId, textLock, model });
  if (options.inputHash && String(options.inputHash).toLowerCase() !== inputHash) throw new Error("flat-surface material hash mismatch");
  const apiKeys = [...new Set((options.apiKeys || String(options.apiKey || "").split(","))
    .map((value) => String(value || "").trim()).filter(Boolean))];
  if (!apiKeys.length && !options.generateSurface) throw new Error("Google image API key is required");
  const generate = options.generateSurface || generateOneSurface;
  const judge = options.judgeSurface || judgeSurface;
  const pause = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const results = [];
  for (const surfaceKey of SURFACE_KEYS) {
    if (options.signal?.aborted) throw new Error("flat-surface authoring aborted after lease loss");
    const surface = surfaces.get(surfaceKey);
    let bytes = options.loadExisting ? await options.loadExisting(surface) : null;
    let reused = Boolean(bytes);
    let qc = reused
      ? { accepted: true, pass: true, issues: ["immutable_winner_reused"], note: "Previously QC-gated immutable field reused", attempts: 0 }
      : null;
    if (!bytes) {
      const ownReference = await verifiedReference(sources.get(surfaceKey));
      let best = null;
      let lastReason = "no image";
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const generated = await generate({
          apiKeys, model, surface, ownReference, sourceSetHash: inputHash, textLock, attempt,
          vehicleName: options.vehicleName, fetchImpl: options.fetchImpl, signal: options.signal,
        });
        if (!generated) {
          lastReason = `generation attempt ${attempt} returned no image`;
          if (attempt < 3) await pause(1500 * attempt);
          continue;
        }
        const candidate = await sharp(generated, { limitInputPixels: false })
          .rotate().flatten({ background: "#ffffff" }).removeAlpha().png().toBuffer();
        const verdict = await judge({
          apiKeys, model, ownReference, fieldBytes: candidate, surfaceKey,
          fetchImpl: options.fetchImpl, signal: options.signal,
        });
        const issues = Array.isArray(verdict?.issues) ? verdict.issues.map(String) : ["wrong_design"];
        const hard = issues.some((issue) => QC_HARD_ISSUES.has(issue));
        const accepted = verdict?.pass === true || issues.includes("qc_unavailable");
        const observed = { accepted: true, pass: verdict?.pass === true, issues, note: String(verdict?.note || "").slice(0, 240), attempts: attempt };
        if (accepted) { best = { bytes: candidate, qc: observed }; break; }
        if (!hard && !best) best = { bytes: candidate, qc: observed };
        lastReason = `QC: ${issues.join(",")}`;
        if (attempt < 3) await pause(1500 * attempt);
      }
      if (!best) throw new Error(`${surfaceKey} flat-surface generation failed closed after 3 attempts: ${lastReason}`);
      bytes = best.bytes;
      qc = best.qc;
      if (options.signal?.aborted) throw new Error("flat-surface authoring aborted before immutable write");
      if (!options.persist) throw new Error("flat-surface persistence is required");
      await options.persist(surface, bytes);
      reused = false;
    } else {
      bytes = Buffer.from(bytes);
    }
    const metadata = await assertOpaqueImage(bytes, surfaceKey);
    results.push(Object.freeze({
      contract: FLAT_SURFACE_CONTRACT,
      surfaceKey,
      bytes,
      contentHash: sha256(bytes),
      byteSize: bytes.length,
      pixelWidth: metadata.width,
      pixelHeight: metadata.height,
      trimWidthIn: surface.trimWidthIn,
      trimHeightIn: surface.trimHeightIn,
      ownSourceViewKey: surfaceKey,
      ownSourceViewSha256: sources.get(surfaceKey).contentHash,
      inputHash,
      model,
      promptVersion: PROMPT_VERSION,
      qc,
      reused,
    }));
  }
  if (results.length !== SURFACE_KEYS.length || new Set(results.map((item) => item.contentHash)).size !== SURFACE_KEYS.length) {
    throw new Error("the six own-surface fields must be complete and byte-distinct");
  }
  return results;
}

module.exports = {
  DEFAULT_IMAGE_MODEL,
  FLAT_SURFACE_CONTRACT,
  PROMPT_VERSION,
  SURFACE_KEYS,
  VIEW_KEYS,
  authorFlatSurfaceFields,
  flatSurfaceInputHash,
  normalizeTextLock,
  selectedImageModel,
  _test: { assertOpaqueImage, cleanTiers, closestAspect, extractOneImageResponse, flatPrompt, judgeSurface, normalizeSourceSet, normalizeSurfaces, verifiedReference },
};
