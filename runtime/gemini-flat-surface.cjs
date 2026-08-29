"use strict";

/**
 * The shared surface/view vocabulary, the frozen Call-8 text lock, and the
 * image-model name the 3D projections resolve.
 *
 * It used to be "Server Call 8 flat-surface authoring" -- see the banner below
 * for what that was and why it is gone. Nothing in this file generates an
 * image any more, and nothing in it may.
 */

const { createHash } = require("node:crypto");

const FLAT_SURFACE_CONTRACT = "designpro.gemini-flat-surface.server.v4";
const PROMPT_VERSION = "designproai-sidefield-generate-qc-retry-server-20260821.v1";
const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
// The seventh immutable proof is the locked Close-Up view. It is a 3D proof --
// presentation only, and NOT proof-sheet content since 2026-08-29: the Call-8
// sheet's six tiles are the Call-1 panels. The six SURFACE_KEYS are the
// canonical production surfaces.
const VIEW_KEYS = Object.freeze([...SURFACE_KEYS, "closeup"]);
const LEGACY_VIEW_KEYS = Object.freeze([...SURFACE_KEYS, "hero3d"]);
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

function sourceViewKeys(sourceViews) {
  if (!Array.isArray(sourceViews) || sourceViews.length !== VIEW_KEYS.length) {
    throw new Error("exactly seven immutable source views are required");
  }
  const keys = new Set(sourceViews.map((item) => String(item?.viewKey || "").trim().toLowerCase()));
  if (VIEW_KEYS.every((key) => keys.has(key))) return VIEW_KEYS;
  if (LEGACY_VIEW_KEYS.every((key) => keys.has(key))) return LEGACY_VIEW_KEYS;
  throw new Error("the seven-view source set requires exactly one Close-Up or immutable historical Hero proof");
}

// ⛔ THE FLAT-SURFACE AUTHORING PASS IS DELETED. DO NOT BRING IT BACK.
//   (Trish 2026-08-29.)
//
// This module used to own `authorFlatSurfaceFields` and its machinery --
// `flatSurfaceInputHash`, `cleanTiers`, `flatPrompt`, `generateOneSurface`,
// `judgeSurface`, `assertOpaqueImage`, `normalizeSourceSet`,
// `normalizeSurfaces`. Call 8 handed it the SEVEN 3D PROOF PHOTOGRAPHS and it
// made one Gemini image call per surface to flatten each photograph back into a
// rectangle. Those rectangles became the proof sheet's tiles AND, through
// `panels.build`'s fail-open arm, the customer's print files.
//
// That is the source-authority inversion the owner named, and its rule is
// brutally simple: no pixel originating from a 3D proof may ever become a
// Call-8 surface, production panel, print file, or ZIP asset. The only legal
// production artwork source is the Call-1 flattened A.T.L.A.S. master -> exact
// deterministic container crop -> Call-1 panel.
//
// Call 8 is now `runtime/call8-proof-material.cjs` + `runtime/proof-sheet.cjs`:
// deterministic assembly of the six Call-1 panels, zero image requests. What
// survives here is the shared VOCABULARY every stage still speaks -- the six
// surface keys, the seven view keys, the frozen text lock, and the model name
// the 3D PROJECTIONS (which are downstream and presentation-only) resolve. If
// you find yourself re-adding an image call to this file, the design is wrong.

function closestAspect(width, height) {
  const ratio = Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : 16 / 9;
  return SUPPORTED_ASPECTS.reduce((best, candidate) => (
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best
  ))[0];
}

module.exports = {
  DEFAULT_IMAGE_MODEL,
  FLAT_SURFACE_CONTRACT,
  PROMPT_VERSION,
  SURFACE_KEYS,
  VIEW_KEYS,
  LEGACY_VIEW_KEYS,
  normalizeTextLock,
  selectedImageModel,
  sourceViewKeys,
  _test: { closestAspect },
};
