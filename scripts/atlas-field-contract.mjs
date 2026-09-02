#!/usr/bin/env node
/**
 * FIELD CONTRACT — the ONLY two changes to the model-facing prompt for the
 * `field-bands-v1` recovery harness. Not production.
 *
 * The deployed prompt is [DesignPanelAI creative assembly] + [flat-master output
 * contract tail]. This keeps the creative assembly byte for byte except ONE
 * exact-match sentence swap (the "flat orthographic panels" scene clause, which
 * is the presentation swap at index.ts:741 -- not creative intelligence), and
 * replaces the tail with a field contract: one uninterrupted full-bleed
 * composition, described as three horizontal MOVEMENTS. No containers, no
 * panel objects, no guide, no labels, no vehicle-body-piece framing.
 *
 * OWNER: the three-movement language is approved ONLY as a Phase-1
 * compositional experiment. It is NOT the permanent DesignPanelAI design
 * formula. Territories govern where useful composition must survive; they are
 * not the design style. Creative parity is an acceptance criterion.
 *
 * The forbidden-word guard runs on the TAIL only. The deployed creative prefix
 * legitimately contains "never an on-vehicle photograph", "flowing across the
 * panels", "every rectangle" -- a whole-prompt guard would convict production's
 * own words. Those prefix phrases are a second variable and are not touched.
 */
import { splitDeployedPrompt } from "./atlas-print-media-contract.mjs";
import { createHash } from "node:crypto";
import { NOSE_EDGE } from "./atlas-field-territories.mjs";

const sha = (v) => createHash("sha256").update(v).digest("hex");

export const FIELD_TAIL_MAX_CHARS = 1400;

/** The presentation clause inside the creative assembly (index.ts:741 / :907). */
export const DEPLOYED_SCENE_CLAUSE =
  "as ONE FLAT print-production master — flat orthographic panels of pure printed vinyl artwork, never an on-vehicle photograph.";
/** Keeps the v19-restored "never an on-vehicle photograph"; changes only the object. */
export const FIELD_SCENE_CLAUSE =
  "as ONE continuous full-bleed field of pure printed vinyl artwork — the way the vinyl looks coming off the printer before anything is cut or applied, never an on-vehicle photograph.";

/**
 * Word-boundary patterns. Everything the owner listed for Test 7b, plus the
 * container vocabulary the governing model rules out.
 */
export const FORBIDDEN_IN_FIELD_TAIL = [
  "artboard", "panel", "layout", "template", "sheet", "wheel", "window", "glass",
  "silhouette", "hole", "arch", "seam", "bumper", "headlight", "do not", "never a",
  "avoid", "container", "box", "region", "six", "surface", "A.T.L.A.S.",
].map((word) => ({ word, pattern: new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") }));

export function assertFieldTailClean(tail) {
  for (const { word, pattern } of FORBIDDEN_IN_FIELD_TAIL) {
    if (pattern.test(tail)) throw new Error(`field contract: tail contains forbidden framing "${word}"`);
  }
  if (tail.length > FIELD_TAIL_MAX_CHARS) {
    throw new Error(`field contract: tail is ${tail.length} chars, over the ${FIELD_TAIL_MAX_CHARS} ceiling`);
  }
  return tail;
}

export function replaceExactlyOnce(text, from, to) {
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`exact-match swap: "${from.slice(0, 40)}…" is not in the text`);
  if (text.indexOf(from, at + 1) >= 0) throw new Error(`exact-match swap: "${from.slice(0, 40)}…" appears more than once`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/** "front to rear" runs nose→tail; nose-left means left→right. */
export function sweepPhrase(noseEdge) {
  if (noseEdge === "left") return "Forward energy sweeps left to right.";
  if (noseEdge === "right") return "Forward energy sweeps right to left.";
  throw new Error(`field contract: unknown noseEdge ${JSON.stringify(noseEdge)}`);
}

/**
 * Build the field tail from the deployed tail, so the vehicle context is
 * carried across verbatim rather than restated.
 */
export function fieldContract(deployedTail, { noseEdge = NOSE_EDGE } = {}) {
  const vehicle = /for this exact (.+?) \((.+?)\)/.exec(deployedTail);
  if (!vehicle) throw new Error("field contract: could not read the vehicle context out of the deployed tail");
  const [, vehicleName, bodyClass] = vehicle;

  const tail = [
    "OUTPUT — ONE CONTINUOUS FULL-BLEED COMPOSITION on one square 4K image.",
    `Paint the entire square, edge to edge on all four sides, as one uninterrupted field of printed vinyl artwork for this exact ${vehicleName} (${bodyClass}) — ground colour, texture and motion running continuously across the entire image, the way a roll of printed vinyl looks flat on the table before it is cut or applied. It is the artwork itself, straight-on and flat.`,
    "",
    "Compose it as three horizontal movements that flow into one another:",
    `• MOVEMENT ONE — the upper band, about the top quarter: hero artwork territory. The company name sits complete inside it, with breathing room above and below. ${sweepPhrase(noseEdge.driver)}`,
    `• MOVEMENT TWO — the middle band, the same height: a second hero territory restating the brand story in full, composed afresh. The company name sits complete inside it too. ${sweepPhrase(noseEdge.passenger)}`,
    "• MOVEMENT THREE — the lower band, the bottom half: supporting texture territory. The same field, palette and motion continue at a calmer register, secondary motifs only; every letter and logo lives in movements one and two.",
    "",
    "Lettering reads left to right throughout. Each focal element sits inside one movement; only the ground and its motion cross between movements. Gallery-grade custom artwork with real depth, movement and a wow factor, drawn flat for printing.",
  ].join("\n");

  return assertFieldTailClean(tail);
}

/**
 * @returns { creative, creativeField, deployedTail, fieldTail, prompt, sceneSwap }
 * with the byte-identity of the creative assembly PROVEN: the swap reverses to
 * the deployed prefix exactly, and the field prompt starts with the swapped
 * prefix exactly.
 */
export function buildFieldPrompt(deployedPrompt, opts = {}) {
  const { creative, tail } = splitDeployedPrompt(deployedPrompt);
  const creativeField = replaceExactlyOnce(creative, DEPLOYED_SCENE_CLAUSE, FIELD_SCENE_CLAUSE);
  if (replaceExactlyOnce(creativeField, FIELD_SCENE_CLAUSE, DEPLOYED_SCENE_CLAUSE) !== creative) {
    throw new Error("field contract: the scene swap does not reverse to the deployed creative assembly");
  }
  const fieldTail = fieldContract(tail, opts);
  const prompt = creativeField + fieldTail;
  if (!prompt.startsWith(creativeField)) throw new Error("field contract: the creative assembly did not survive");
  return {
    creative,
    creativeField,
    deployedTail: tail,
    fieldTail,
    prompt,
    sceneSwap: { from: DEPLOYED_SCENE_CLAUSE, to: FIELD_SCENE_CLAUSE },
  };
}

export const GENERATION_CONFIG = {
  responseModalities: ["TEXT", "IMAGE"],
  imageConfig: { aspectRatio: "1:1", imageSize: "4K" },
};

function partSummary(part, index) {
  if (part.text != null) {
    return { index, kind: "text", chars: part.text.length, sha256: sha(part.text), preview: part.text.slice(0, 90).replace(/\s+/g, " ") };
  }
  const bytes = Buffer.from(part.inlineData?.data || "", "base64");
  return { index, kind: "image", mimeType: part.inlineData?.mimeType, bytes: bytes.length, sha256: sha(bytes) };
}

/**
 * The field request: the prompt, then customer references (none on the
 * fixture). ZERO structural images. Exported so a test can convict a guide or
 * a teaching proof sneaking back in.
 */
export function buildFieldRequest({ prompt, referenceParts = [], model }) {
  const parts = [{ text: prompt }, ...referenceParts];
  const serialize = (p) => JSON.stringify({ contents: [{ role: "user", parts: p }], generationConfig: GENERATION_CONFIG });
  const request = {
    label: "FIELD-one-continuous-composition",
    model,
    generationConfig: GENERATION_CONFIG,
    promptChars: prompt.length,
    promptSha256: sha(prompt),
    partCount: parts.length,
    modelInputImageCount: parts.filter((p) => p.inlineData?.data).length,
    customerReferenceCount: referenceParts.length,
    modelRequestByteSize: Buffer.byteLength(serialize(parts), "utf8"),
    parts: parts.map(partSummary),
  };
  if (request.modelInputImageCount !== request.customerReferenceCount) {
    throw new Error("field request carries a structural image — the model must receive no guide and no teaching sheet");
  }
  if (request.parts[0].kind !== "text") throw new Error("field request must open with the prompt");
  return { parts, request, serialize };
}
