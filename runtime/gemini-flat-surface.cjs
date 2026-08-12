"use strict";

/**
 * Shared Call 8 identity helpers: the seven-view source contract, the frozen
 * text lock and the image-model gate.
 *
 * The six per-surface generation calls that used to live here are gone. Each
 * of them was handed the 3D hero render as a "cross-vehicle design anchor",
 * and because the hero is a three-quarter view the hood, roof, front and rear
 * calls were each shown a large driver-side image and told to follow its
 * graphic routing. That put driver artwork on every panel. Call 8 now authors
 * one continuous design in gemini-flat-wrap.cjs and Call 9 cuts it.
 */

const { createHash } = require("node:crypto");

const FLAT_SURFACE_CONTRACT = "designpro.gemini-flat-surface.v1";
const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const VIEW_KEYS = Object.freeze([...SURFACE_KEYS, "hero3d"]);
const HASH_RE = /^[0-9a-f]{64}$/;
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

function closestAspect(width, height) {
  const ratio = Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : 16 / 9;
  return SUPPORTED_ASPECTS.reduce((best, candidate) => (
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best
  ))[0];
}

module.exports = {
  DEFAULT_IMAGE_MODEL,
  FLAT_SURFACE_CONTRACT,
  SURFACE_KEYS,
  VIEW_KEYS,
  closestAspect,
  hashJson,
  normalizeSourceSet,
  normalizeTextLock,
  selectedImageModel,
  _test: {
    closestAspect,
    normalizeTextLock,
    normalizeSourceSet,
  },
};
