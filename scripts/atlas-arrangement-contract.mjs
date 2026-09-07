#!/usr/bin/env node
/**
 * TEST 12 — ARRANGEMENT. Is the vehicle-unroll LAYOUT the cue that makes
 * Gemini draw a vehicle?
 *
 * Twelve recorded experiments share one perfect correlation: every request
 * that asked for the six surfaces arranged as an unroll — two tall flank
 * columns either side of a centre spine — came back with anatomy, voids or
 * contour failure, in every draw; every request that did not (thirds, bands)
 * came back anatomy-free and full-bleed. It holds inside one sheet too: on
 * b14af361 (2026-09-07) driver, passenger and front failed while hood, roof
 * and rear passed — the surfaces whose rectangles ARE a recognisable vehicle
 * shape are the ones that fail. Tests 1–8 and Anchor v1–v4 varied the
 * teaching image, its labels, its order, the output-contract wording and a
 * negative; none varied the arrangement itself. This does, and nothing else.
 *
 *   A  the deployed request with the teaching proof ABSENT (Test 8's arm B —
 *      measured 0/6, template signatures, anatomy): creative assembly byte for
 *      byte, deployed six-surface tail, guide text, the production UNROLL
 *      guide. 3 parts, 1 image.
 *   B  the same six named surfaces at the same print inches, the same guide
 *      text, the same creative assembly byte for byte — arranged as STACKED
 *      BANDS: driver across the top, passenger directly beneath it, the four
 *      centre surfaces in a row along the bottom. Nothing rotated. The only
 *      prose that changes is the five arrangement phrases of the tail, each
 *      swapped exactly once and reverse-provable. 3 parts, 1 image.
 *
 * The teaching proof is absent from BOTH arms on purpose. It is a picture of
 * the unroll; sending it beside a bands guide would hand the model two
 * contradictory arrangements, which Test 3 showed collapses the output class.
 * Test 8 already established that the unroll fails without it, so A is a
 * known-failing control drawn fresh and interleaved, not an assumption.
 *
 * Both arms are cut by the REAL `cutCallOnePanels` from their own manifests,
 * so the six files B produces are the files production would produce.
 *
 * Harness only. No deploy, no env write, no prompt change, no generation,
 * revision, view or artifact row.
 */
import { createHash } from "node:crypto";
import { splitDeployedPrompt } from "./atlas-print-media-contract.mjs";
import { replaceExactlyOnce } from "./atlas-field-contract.mjs";

const sha = (v) => createHash("sha256").update(v).digest("hex");

export const ARRANGEMENT_CONTRACT = "designpro.atlas-arrangement-ab.v1";
export const ARRANGEMENT_TOPOLOGY = "stacked-bands-v1";

/** Row order, top to bottom; cell order, left to right. */
export const BAND_ROWS = Object.freeze([
  Object.freeze(["driver"]),
  Object.freeze(["passenger"]),
  Object.freeze(["rear", "roof", "hood", "front"]),
]);
export const BAND_PLACEMENT = Object.freeze({
  driver: "top-band",
  passenger: "second-band",
  rear: "bottom-row",
  roof: "bottom-row",
  hood: "bottom-row",
  front: "bottom-row",
});

const OUTER_PADDING_PX = 192;
const ROW_GUTTER_PX = 72;
const CELL_GUTTER_PX = 36;

/**
 * The bands manifest, derived from the production unroll manifest so every
 * surface keeps its exact print inches, bleed, proof dependencies and flank
 * guidance. Only x/y/w/h, rotation and placement change.
 *
 * Every rectangle is drawn in its NATIVE orientation (rotation 0), so the
 * extractor's `outputRotationDegrees` is 0 on all six and a panel is the
 * rectangle as drawn. Each row is fitted to the available width; if the three
 * rows together overrun the height they are scaled down uniformly, so
 * relative proportion within a row is exact and across rows is preserved.
 */
export function buildBandsManifest(legacy, { atlas }) {
  if (!legacy || !Array.isArray(legacy.zones) || legacy.zones.length !== 6) {
    throw new Error("arrangement: a six-zone production manifest is required");
  }
  const { CANVAS, SURFACE_KEYS } = atlas;
  const { trimRectangle, zoneEffectivePpi } = atlas._test;
  const byKey = new Map(legacy.zones.map((zone) => [zone.surfaceKey, zone]));
  for (const key of SURFACE_KEYS) {
    if (!byKey.has(key)) throw new Error(`arrangement: the production manifest has no ${key} zone`);
  }

  const availableWidth = CANVAS.widthPx - OUTER_PADDING_PX * 2;
  const availableHeight = CANVAS.heightPx - OUTER_PADDING_PX * 2;

  const rows = BAND_ROWS.map((keys) => {
    // Native aspect (width over height) of each print rectangle, bleed included.
    const aspects = keys.map((key) => byKey.get(key).printWidthIn / byKey.get(key).printHeightIn);
    const usableWidth = availableWidth - CELL_GUTTER_PX * (keys.length - 1);
    const height = usableWidth / aspects.reduce((total, value) => total + value, 0);
    return { keys, aspects, height };
  });
  const totalHeight = rows.reduce((total, row) => total + row.height, 0) + ROW_GUTTER_PX * (rows.length - 1);
  const scale = Math.min(1, availableHeight / totalHeight);

  const placed = new Map();
  let y = Math.round(OUTER_PADDING_PX + (availableHeight - totalHeight * scale) / 2);
  for (const row of rows) {
    const h = Math.max(1, Math.round(row.height * scale));
    const widths = row.aspects.map((aspect) => Math.max(1, Math.round(h * aspect)));
    const rowWidth = widths.reduce((total, value) => total + value, 0) + CELL_GUTTER_PX * (row.keys.length - 1);
    let x = Math.round(OUTER_PADDING_PX + (availableWidth - rowWidth) / 2);
    row.keys.forEach((key, index) => {
      placed.set(key, { x, y, w: widths[index], h });
      x += widths[index] + CELL_GUTTER_PX;
    });
    y += h + ROW_GUTTER_PX;
  }

  const zones = SURFACE_KEYS.map((surfaceKey) => {
    const source = byKey.get(surfaceKey);
    const rect = placed.get(surfaceKey);
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > CANVAS.widthPx || rect.y + rect.h > CANVAS.heightPx) {
      throw new Error(`arrangement: ${surfaceKey} falls outside the canvas`);
    }
    const zone = { ...rect, rotationDegrees: 0 };
    return {
      surfaceKey,
      placement: BAND_PLACEMENT[surfaceKey],
      x: zone.x,
      y: zone.y,
      w: zone.w,
      h: zone.h,
      rotationDegrees: 0,
      extraction: { x: zone.x, y: zone.y, w: zone.w, h: zone.h, outputRotationDegrees: 0 },
      trim: trimRectangle(zone, source),
      trimWidthIn: source.trimWidthIn,
      trimHeightIn: source.trimHeightIn,
      bleedIn: { ...source.bleedIn },
      printWidthIn: source.printWidthIn,
      printHeightIn: source.printHeightIn,
      surfaceSqFt: source.surfaceSqFt,
      effectivePpi: zoneEffectivePpi(zone, source),
      proofDependencies: [...(source.proofDependencies || [])],
      guideFill: source.guideFill,
      flankTopology: source.flankTopology || null,
    };
  });

  // No two rectangles may touch: a shared edge would let one surface's artwork
  // be counted, or cut, as another's.
  for (let i = 0; i < zones.length; i += 1) {
    for (let j = i + 1; j < zones.length; j += 1) {
      const a = zones[i];
      const b = zones[j];
      const separate = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      if (!separate) throw new Error(`arrangement: ${a.surfaceKey} and ${b.surfaceKey} overlap`);
    }
  }

  const minimumEffectivePpi = Math.min(...zones.map((zone) => zone.effectivePpi));
  return {
    ...legacy,
    topology: ARRANGEMENT_TOPOLOGY,
    arrangement: {
      contract: ARRANGEMENT_CONTRACT,
      rows: BAND_ROWS.map((keys) => [...keys]),
      derivedFrom: legacy.topology,
      scale: Number(scale.toFixed(4)),
    },
    installerMap: {
      driver: "top-band",
      passenger: "second-band",
      bottomRowLeftToRight: [...BAND_ROWS[2]],
      longitudinalOrder: "vehicle-rear-to-front",
    },
    zones,
    quality: {
      ...legacy.quality,
      minimumEffectivePpi,
      upscalingRequiredBeforeAnyProductionExport: minimumEffectivePpi < legacy.quality.targetPrintPpi,
    },
  };
}

// ── THE FIVE ARRANGEMENT PHRASES, AND ONLY THOSE ─────────────────────────────
//
// Each pair is swapped exactly once in the deployed tail and reversed exactly
// once to prove nothing else moved. The bullets are replaced in place, so B's
// list reads top to bottom in the order the bands are stacked.
export const ARRANGEMENT_SWAPS = Object.freeze([
  ["• PASSENGER SIDE — the tall panel down the left", "• DRIVER SIDE — the long panel across the top"],
  ["• DRIVER SIDE — the tall panel down the right", "• PASSENGER SIDE — the long panel directly beneath it"],
  ["• REAR, then ROOF, then HOOD, then FRONT — the centre column, top to bottom", "• REAR, then ROOF, then HOOD, then FRONT — the row of four along the bottom, left to right"],
  ["The left and right flanks are the two sides of the SAME vehicle", "The two long panels are the two sides of the SAME vehicle"],
  ["The centre panels carry that same composition across the", "The four panels along the bottom carry that same composition across the"],
].map((pair) => Object.freeze(pair)));

/**
 * Words that may not enter through the swap. Anatomy vocabulary and negatives
 * are the two prompt shapes this investigation has already measured as
 * harmful (Anchor v4; RULE 0.32), so the arrangement change is not allowed to
 * smuggle either in.
 */
export const FORBIDDEN_IN_ADDED_TEXT = [
  "wheel", "tire", "tyre", "window", "glass", "silhouette", "hole", "cutout", "cut-out", "arch",
  "seam", "bumper", "headlight", "door", "fender", "do not", "don't", "never", "avoid", "no ",
].map((word) => ({ word, pattern: new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") }));

export function assertAddedTextClean(text, where = "the added text") {
  for (const { word, pattern } of FORBIDDEN_IN_ADDED_TEXT) {
    if (pattern.test(text)) throw new Error(`arrangement: ${where} contains forbidden wording "${word}"`);
  }
  return text;
}

export function applyArrangementSwaps(tail) {
  let out = tail;
  for (const [from, to] of ARRANGEMENT_SWAPS) out = replaceExactlyOnce(out, from, to);
  return out;
}

export function reverseArrangementSwaps(tail) {
  let out = tail;
  for (const [from, to] of [...ARRANGEMENT_SWAPS].reverse()) out = replaceExactlyOnce(out, to, from);
  return out;
}

/**
 * The B prompt from the deployed prompt: creative assembly untouched, tail with
 * the five arrangement phrases swapped. The reverse proof is computed, not
 * asserted: undoing the swaps must give back the deployed prompt byte for byte.
 */
export function buildArrangementPrompt(deployedPrompt) {
  const { creative, tail } = splitDeployedPrompt(deployedPrompt);
  const arrangementTail = applyArrangementSwaps(tail);
  if (reverseArrangementSwaps(arrangementTail) !== tail) {
    throw new Error("arrangement: the swaps do not reverse to the deployed tail");
  }
  for (const [, to] of ARRANGEMENT_SWAPS) assertAddedTextClean(to, `swap → "${to.slice(0, 40)}…"`);
  const prompt = creative + arrangementTail;
  if (!prompt.startsWith(creative)) throw new Error("arrangement: the creative assembly did not survive");
  if (prompt === deployedPrompt) throw new Error("arrangement: the prompt is unchanged — nothing is being tested");
  return {
    creative,
    deployedTail: tail,
    arrangementTail,
    prompt,
    swaps: ARRANGEMENT_SWAPS.map(([from, to]) => ({ from, to })),
    reverseProof: true,
    creativeSha256: sha(creative),
    deployedTailSha256: sha(tail),
    arrangementTailSha256: sha(arrangementTail),
  };
}

export const GENERATION_CONFIG = Object.freeze({
  responseModalities: ["TEXT", "IMAGE"],
  imageConfig: { aspectRatio: "1:1", imageSize: "4K" },
});

function partSummary(part, index) {
  if (part.text != null) {
    return { index, kind: "text", chars: part.text.length, sha256: sha(part.text), preview: part.text.slice(0, 90).replace(/\s+/g, " ") };
  }
  const bytes = Buffer.from(part.inlineData?.data || "", "base64");
  return { index, kind: "image", mimeType: part.inlineData?.mimeType, bytes: bytes.length, sha256: sha(bytes) };
}

/**
 * The two requests and the guards that make this exactly an arrangement test:
 * three parts each, one guide image each, the guide instruction identical, the
 * teaching proof in neither, the prompts differing only by the swapped tail.
 */
export function buildArrangementRequests({
  deployedPrompt, arrangement, targetGuideText, guideBytesA, guideBytesB, model, teachingProofSha256,
}) {
  if (arrangement.prompt !== arrangement.creative + arrangement.arrangementTail) {
    throw new Error("arrangement: the B prompt is not creative + arrangement tail");
  }
  if (!deployedPrompt.startsWith(arrangement.creative)) throw new Error("arrangement: arm A does not start with the shared creative assembly");
  const image = (bytes) => ({ inlineData: { mimeType: "image/png", data: Buffer.from(bytes).toString("base64") } });
  const partsA = [{ text: deployedPrompt }, { text: targetGuideText }, image(guideBytesA)];
  const partsB = [{ text: arrangement.prompt }, { text: targetGuideText }, image(guideBytesB)];

  const serialize = (parts) => JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: GENERATION_CONFIG });
  const describe = (label, parts, text) => ({
    label,
    model,
    generationConfig: GENERATION_CONFIG,
    promptChars: text.length,
    promptSha256: sha(text),
    partCount: parts.length,
    modelInputImageCount: parts.filter((p) => p.inlineData?.data).length,
    modelRequestByteSize: Buffer.byteLength(serialize(parts), "utf8"),
    parts: parts.map(partSummary),
  });
  const requests = {
    A: describe("A-unroll-guide-only", partsA, deployedPrompt),
    B: describe("B-stacked-bands", partsB, arrangement.prompt),
  };

  for (const arm of ["A", "B"]) {
    if (requests[arm].partCount !== 3) throw new Error(`arm ${arm} has ${requests[arm].partCount} parts, expected 3`);
    if (requests[arm].modelInputImageCount !== 1) throw new Error(`arm ${arm} must carry exactly one image, the guide`);
    if (!requests[arm].parts[1].preview.startsWith("CURRENT TARGET GUIDE")) throw new Error(`arm ${arm} part 1 is not the target-guide instruction`);
    if (teachingProofSha256 && requests[arm].parts.some((p) => p.sha256 === teachingProofSha256)) {
      throw new Error(`arm ${arm} carries the teaching proof — both arms must be guide-only`);
    }
  }
  if (requests.A.parts[1].sha256 !== requests.B.parts[1].sha256) throw new Error("the guide instruction differs between arms");
  if (requests.A.parts[0].sha256 === requests.B.parts[0].sha256) throw new Error("the prompts are identical — nothing is being tested");
  if (requests.A.parts[2].sha256 === requests.B.parts[2].sha256) throw new Error("the guide images are identical — the arrangement did not change");

  return { partsA, partsB, requests, serialize };
}
