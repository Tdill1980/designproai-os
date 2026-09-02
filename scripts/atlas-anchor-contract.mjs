#!/usr/bin/env node
/**
 * ANCHOR CONTRACT v2 — OBJECT-SCHEMA CLEANUP. Harness only. Not production.
 *
 * Draw 1 of v1 (run 33642303437) put the owner's object-first A.T.L.A.S.
 * anchor at the END of Part 0, after a creative assembly whose third line had
 * already told the model the object is "flat orthographic panels" with texture
 * "flowing across the panels". The earlier instruction won: Gemini drew
 * vehicle-body-piece mockups and ignored the guide.
 *
 * Owner finding (2026-09-02): the creative intelligence is worth preserving;
 * the object-schema phrases inside it are not creative intelligence. So v2:
 *
 *   1. the governing object definition MOVES to directly after the persona
 *      line, BEFORE any creative instruction that refers to the design space;
 *   2. exactly SIX exact-match phrase swaps remove the remaining panel /
 *      body-object semantics from the creative assembly (each must match
 *      exactly once, and reversing them plus removing the inserted block must
 *      reproduce the deployed creative assembly byte for byte);
 *   3. the placement paragraph (example, guide, six regions as subdivisions,
 *      Driver/Passenger, no captions) and the gallery-grade close stay at the
 *      end, because the example and guide follow as parts 1–4.
 *
 * Persona, concept, brief, translation, logo architecture, contact lock,
 * photographic-realism rule, the FINISH_SPECS text, style, movement, depth:
 * untouched. No negative added. No wheel/window/body-part word added. The
 * centre-order phrase is generated from the SAME order the guide is drawn
 * from, so text and mask cannot disagree.
 */
import { createHash } from "node:crypto";
import { splitDeployedPrompt } from "./atlas-print-media-contract.mjs";
import { replaceExactlyOnce } from "./atlas-field-contract.mjs";

const sha = (v) => createHash("sha256").update(v).digest("hex");

export const ANCHOR_CONTRACT = "designpro.atlas-anchor-restoration.v2";

/** Pinned on the F250 fixture (2022 Ford F250 Crew Cab (truck), CENTER_ORDER). */
export const EXPECTED_ANCHOR_PROMPT_CHARS_F250 = 4293;
export const EXPECTED_ANCHOR_PROMPT_SHA256_PREFIX_F250 = "8014a3665f40bd24";
export const EXPECTED_SWAPPED_CREATIVE_CHARS_F250 = 2720;
export const EXPECTED_SWAPPED_CREATIVE_SHA256_PREFIX_F250 = "458ea7a537cf9940";

/** The one deployed sentence carried across verbatim (it names "the sheet"). */
export const NO_CAPTIONS_SENTENCE =
  "Set no region names, surface IDs, legends or captions anywhere in the artwork — those words are for the server, never for the sheet.";

const CENTER_SURFACES = Object.freeze(["rear", "roof", "hood", "front"]);

/**
 * The six exact-match swaps inside the deployed creative assembly. Each is
 * object-schema language (or, for #6, the last bare "panels" before the
 * anchor); none is creative direction. Order matters only for the reverse
 * proof, which undoes them in reverse.
 */
export const CREATIVE_OBJECT_SWAPS = Object.freeze([
  ["flat orthographic panels of pure printed vinyl artwork", "the flattened A.T.L.A.S. design topology of pure printed vinyl artwork"],
  ["background color and texture flowing across the panels", "background color and texture flowing continuously across the flattened A.T.L.A.S. design topology"],
  ["rather than flat shapes on bare panel", "rather than flat shapes on bare vinyl"],
  ["The vinyl finish is gloss across every panel — consistent finish on every surface.", "The vinyl finish is gloss across the whole flattened A.T.L.A.S. design topology — one consistent finish throughout."],
  ["The artwork fills every rectangle edge to edge — solid printed vinyl, corner to corner.", "The artwork fills every topology region edge to edge — solid printed vinyl, corner to corner."],
  ["angular faceted panels with sharp swept edges", "angular faceted plates with sharp swept edges"],
].map((pair) => Object.freeze(pair)));

/**
 * Object-schema and negative vocabulary that may not appear anywhere in the
 * prompt BEFORE the placement tail (word-boundary, case-insensitive). "sheet"
 * survives only inside the carried-across no-captions sentence in the tail.
 */
const wordPatterns = (words) => words.map((word) => ({ word, pattern: new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") }));
export const FORBIDDEN_OBJECT_WORDS = wordPatterns([
  "panel", "panels", "artboard", "orthographic", "body", "rectangle", "rectangles", "layout of", "template", "sheet",
  "mockup", "silhouette",
]);
/** The ADDED text (object block + placement tail) additionally carries no anatomy, presentation or negative framing. */
export const FORBIDDEN_IN_ADDED_TEXT = wordPatterns([
  "wheel", "window", "glass", "render", "container", "box", "band", "field", "do not", "never a", "avoid",
]);

export function assertNoObjectWords(text, where, extra = []) {
  for (const { word, pattern } of [...FORBIDDEN_OBJECT_WORDS, ...extra]) {
    if (pattern.test(text)) throw new Error(`anchor contract: ${where} contains forbidden object framing "${word}"`);
  }
  return text;
}

/** "rear, roof, hood and front" — from the SAME order the guide is drawn from. */
export function centerOrderPhrase(centerOrder) {
  if (!Array.isArray(centerOrder) || centerOrder.length !== 4) throw new Error("anchor contract: centerOrder must name four centre surfaces");
  const sorted = [...centerOrder].sort().join(",");
  if (sorted !== [...CENTER_SURFACES].sort().join(",")) throw new Error(`anchor contract: centerOrder ${JSON.stringify(centerOrder)} is not a permutation of rear/roof/hood/front`);
  return `${centerOrder.slice(0, 3).join(", ")} and ${centerOrder[3]}`;
}

/** The governing object definition — the owner's two paragraphs, vehicle lifted from the deployed tail. */
export function objectDefinitionBlock(vehicleName, bodyClass) {
  return [
    "A.T.L.A.S. — DesignProAI’s canonical flattened design topology, on one square 4K canvas.",
    "For the vehicle-design embodiment, A.T.L.A.S. represents a top-view vehicle-wrap design as a flattened 2D topology: "
    + "conceptually, the printable exterior skin of the completely wrapped 3D vehicle is pressed flat from above and unfolded "
    + `into one dimensionally governed design space. Here that vehicle is this exact ${vehicleName} (${bodyClass}).`,
    "",
    "Create one cohesive professional vehicle-wrap design across this flattened topology. Every defined topology region is "
    + "printable artwork and must be filled completely edge-to-edge with intentional finished design. The complete flattened "
    + "topology represents one coordinated vehicle-wrap design.",
    "",
  ].join("\n");
}

/** The placement paragraph + close — stays at the end, after the creative assembly. */
export function placementTail(centerOrder) {
  const centre = centerOrderPhrase(centerOrder);
  return [
    "The supplied A.T.L.A.S. example shows how that flattened skin is spatially organized; the supplied neutral guide is this "
    + "vehicle’s own flattened skin at its real proportions. Within it, the two long flank regions (passenger side down the "
    + "left, driver side down the right) carry the wrap’s primary compositions, and the four central regions "
    + `(${centre}, stacked top to bottom in the centre) carry its supporting compositions — all subdivisions of the same one `
    + "flattened printable skin. Driver and Passenger are coordinated but independently composed; they are not mirrored "
    + `artwork. ${NO_CAPTIONS_SENTENCE}`,
    "",
    "Gallery-grade custom artwork with real depth, movement and a wow factor, drawn straight-on and flat for printing.",
  ].join("\n");
}

/** Apply the six swaps (each exactly once) to the deployed creative assembly. */
export function applyCreativeObjectSwaps(creative) {
  let out = creative;
  for (const [from, to] of CREATIVE_OBJECT_SWAPS) out = replaceExactlyOnce(out, from, to);
  return out;
}

/** Undo the six swaps in reverse order — the reverse proof. */
export function reverseCreativeObjectSwaps(swapped) {
  let out = swapped;
  for (const [from, to] of [...CREATIVE_OBJECT_SWAPS].reverse()) out = replaceExactlyOnce(out, to, from);
  return out;
}

/**
 * Build the v2 prompt from the deployed prompt:
 *   persona (deployed L1) · object definition · swapped creative (deployed L3…L19) · placement tail
 *
 * @returns { creative, swappedCreative, persona, objectBlock, creativeBody, deployedTail, placement, prompt, swaps, reverseProof }
 */
export function buildAnchorPrompt(deployedPrompt, { centerOrder } = {}) {
  const { creative, tail } = splitDeployedPrompt(deployedPrompt);
  const vehicle = /for this exact (.+?) \((.+?)\)/.exec(tail);
  if (!vehicle) throw new Error("anchor contract: could not read the vehicle context out of the deployed tail");
  const [, vehicleName, bodyClass] = vehicle;

  const swappedCreative = applyCreativeObjectSwaps(creative);
  const cut = swappedCreative.indexOf("\n\n");
  if (cut < 0) throw new Error("anchor contract: the creative assembly has no persona paragraph break");
  const persona = swappedCreative.slice(0, cut + 2);
  const creativeBody = swappedCreative.slice(cut + 2);
  if (!persona.startsWith("You are the senior vehicle-wrap designer")) throw new Error("anchor contract: the first paragraph is not the persona");
  if (!creativeBody.startsWith("Design the printed wrap artwork for")) throw new Error("anchor contract: the second paragraph is not the design-space instruction");

  const objectBlock = objectDefinitionBlock(vehicleName, bodyClass);
  const placement = placementTail(centerOrder);
  const prompt = persona + objectBlock + creativeBody + placement;

  // Reverse proof: remove the block, undo the swaps → the deployed creative assembly, byte for byte.
  const reverseProof = reverseCreativeObjectSwaps(persona + creativeBody) === creative
    && prompt === persona + objectBlock + creativeBody + placement;
  if (!reverseProof) throw new Error("anchor contract: the reverse proof failed — the creative assembly did not survive");

  // Object-first: nothing before the placement tail may name a panel / body object / negative,
  // and the object definition must precede the first design-space instruction and the first "region".
  const beforeTail = persona + objectBlock + creativeBody;
  assertNoObjectWords(beforeTail, "the prompt before the placement tail");
  assertNoObjectWords(objectBlock, "the object definition", FORBIDDEN_IN_ADDED_TEXT);
  assertNoObjectWords(placement.replace(NO_CAPTIONS_SENTENCE, ""), "the placement tail", FORBIDDEN_IN_ADDED_TEXT);
  const object = prompt.indexOf("design space");
  if (object < 0) throw new Error("anchor contract: the object definition (\"design space\") is missing");
  if (prompt.indexOf("Design the printed wrap artwork for") < object) throw new Error("anchor contract: the design-space instruction precedes the object definition");
  if (prompt.search(/\bregion/i) < object) throw new Error("anchor contract: a region is named before the object is defined — not object-first");

  return {
    creative, swappedCreative, persona, objectBlock, creativeBody, deployedTail: tail, placement, prompt,
    swaps: CREATIVE_OBJECT_SWAPS.map(([from, to]) => ({ from, to })),
    reverseProof,
    creativeSha256: sha(creative),
    swappedCreativeSha256: sha(swappedCreative),
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
 * The anchor request: the deployed FIVE-part shape, in the deployed order —
 *   [0] prompt  [1] teaching text  [2] Flamingo proof  [refs…]  [n-2] guide text  [n-1] guide image
 * — with only part 0 changed. Every other part is asserted against the sha the
 * deployed edge sent (`expected`), so a drifted teaching text, a substituted
 * proof, a moved guide or a missing part is refused before any provider call.
 */
export function buildAnchorRequest({
  prompt, teachingReferenceText, teachingBytes, targetGuideText, guideBytes, referenceParts = [], model, expected,
}) {
  if (!expected || !expected.teachingText || !expected.teachingImage || !expected.guideText) {
    throw new Error("anchor request: expected part shas are required (teachingText, teachingImage, guideText[, guideImage])");
  }
  const image = (bytes) => ({ inlineData: { mimeType: "image/png", data: Buffer.from(bytes).toString("base64") } });
  const parts = [
    { text: prompt },
    { text: teachingReferenceText }, image(teachingBytes),
    ...referenceParts,
    { text: targetGuideText }, image(guideBytes),
  ];
  const serialize = (p) => JSON.stringify({ contents: [{ role: "user", parts: p }], generationConfig: GENERATION_CONFIG });
  const request = {
    label: "ANCHOR-restoration",
    contract: ANCHOR_CONTRACT,
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
  const n = parts.length;
  if (n !== 5 + referenceParts.length) throw new Error(`anchor request has ${n} parts, expected ${5 + referenceParts.length}`);
  if (request.modelInputImageCount !== 2 + referenceParts.filter((p) => p.inlineData?.data).length) {
    throw new Error("anchor request must carry exactly the teaching proof and the target guide as structural images");
  }
  if (request.parts[0].kind !== "text") throw new Error("anchor request must open with the prompt");
  if (request.parts[1].sha256 !== expected.teachingText) throw new Error("part 1 is not the deployed teaching instruction");
  if (request.parts[2].sha256 !== expected.teachingImage) throw new Error("part 2 is not the pinned owner teaching proof");
  if (request.parts[n - 2].sha256 !== expected.guideText) throw new Error("the guide instruction is not the deployed guide text");
  if (expected.guideImage && request.parts[n - 1].sha256 !== expected.guideImage) throw new Error("the guide image is not the production guide for this fixture");
  if (request.parts[n - 1].kind !== "image") throw new Error("the request must end with the neutral guide image, as production does");
  return { parts, request, serialize };
}
