#!/usr/bin/env node
/**
 * ANCHOR CONTRACT — the ONLY change to the model-facing Call-1 request for the
 * anchor-restoration harness. Not production.
 *
 * Owner decision (2026-09-02): keep production `CENTER_ORDER`
 * (REAR → ROOF → HOOD → FRONT — the order the known-good Flamingo master
 * `5b2eb96c` was authored on); keep the DesignPanelAI creative assembly byte
 * for byte; keep the Flamingo labeled teaching proof, the neutral guide and the
 * two text parts that introduce them; keep model, config and ONE image request.
 * Replace ONLY the output tail of part 0 with the owner's object-first anchor:
 *
 *   A.T.L.A.S. is DesignProAI's canonical flattened design topology. For the
 *   vehicle-design embodiment it represents a top-view vehicle-wrap design as a
 *   flattened 2D topology — the printable exterior skin of the completely
 *   wrapped 3D vehicle pressed flat from above and unfolded into one
 *   dimensionally governed design space. The six regions are subdivisions of
 *   that one skin, not six objects laid out on a sheet.
 *
 * The object comes first; the regions appear afterwards, in prose, as
 * subdivisions. No bullet list of panels. No negative list of forbidden
 * gestalts. The centre-order phrase is generated from the SAME order the guide
 * is drawn from, so text and mask cannot disagree.
 */
import { createHash } from "node:crypto";
import { splitDeployedPrompt } from "./atlas-print-media-contract.mjs";

const sha = (v) => createHash("sha256").update(v).digest("hex");

export const ANCHOR_CONTRACT = "designpro.atlas-anchor-restoration.v1";
export const ANCHOR_TAIL_MAX_CHARS = 1700;

/** Pinned on the F250 fixture (2022 Ford F250 Crew Cab (truck), CENTER_ORDER). */
export const EXPECTED_ANCHOR_TAIL_CHARS_F250 = 1574;
export const EXPECTED_ANCHOR_TAIL_SHA256_PREFIX_F250 = "352498f8b2c7714c";

/** The one deployed sentence carried across verbatim (it names "the sheet"). */
export const NO_CAPTIONS_SENTENCE =
  "Set no region names, surface IDs, legends or captions anywhere in the artwork — those words are for the server, never for the sheet.";

const CENTER_SURFACES = Object.freeze(["rear", "roof", "hood", "front"]);

/**
 * Word-boundary patterns the tail may not carry: container / panel-object
 * vocabulary, vehicle anatomy, presentation, and every negative. "sheet" is
 * checked after the one carried-across sentence is removed.
 */
export const FORBIDDEN_IN_ANCHOR_TAIL = [
  "panel", "artboard", "layout", "template", "sheet", "band", "field", "wheel", "window", "glass",
  "silhouette", "render", "mockup", "container", "box", "do not", "never a", "avoid",
].map((word) => ({ word, pattern: new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") }));

export function assertAnchorTailClean(tail) {
  if (!tail.includes(NO_CAPTIONS_SENTENCE)) throw new Error("anchor contract: the no-captions sentence is missing");
  const checked = tail.replace(NO_CAPTIONS_SENTENCE, "");
  for (const { word, pattern } of FORBIDDEN_IN_ANCHOR_TAIL) {
    if (pattern.test(checked)) throw new Error(`anchor contract: tail contains forbidden framing "${word}"`);
  }
  if (tail.length > ANCHOR_TAIL_MAX_CHARS) {
    throw new Error(`anchor contract: tail is ${tail.length} chars, over the ${ANCHOR_TAIL_MAX_CHARS} ceiling`);
  }
  return tail;
}

/** Object-first: the six regions may only be named AFTER the one design space is defined. */
export function assertObjectFirst(tail) {
  const object = tail.indexOf("design space");
  const region = tail.search(/\bregion/i);
  if (object < 0) throw new Error("anchor contract: the object definition (\"design space\") is missing");
  if (region < 0) throw new Error("anchor contract: the regions are never named");
  if (region < object) throw new Error("anchor contract: a region is named before the object is defined — not object-first");
  return tail;
}

/** "rear, roof, hood and front" — from the SAME order the guide is drawn from. */
export function centerOrderPhrase(centerOrder) {
  if (!Array.isArray(centerOrder) || centerOrder.length !== 4) throw new Error("anchor contract: centerOrder must name four centre surfaces");
  const sorted = [...centerOrder].sort().join(",");
  if (sorted !== [...CENTER_SURFACES].sort().join(",")) throw new Error(`anchor contract: centerOrder ${JSON.stringify(centerOrder)} is not a permutation of rear/roof/hood/front`);
  return `${centerOrder.slice(0, 3).join(", ")} and ${centerOrder[3]}`;
}

/**
 * Build the anchor tail from the deployed tail, so the vehicle context is
 * lifted by the existing regex rather than retyped.
 */
export function anchorContract(deployedTail, { centerOrder } = {}) {
  const vehicle = /for this exact (.+?) \((.+?)\)/.exec(deployedTail);
  if (!vehicle) throw new Error("anchor contract: could not read the vehicle context out of the deployed tail");
  const [, vehicleName, bodyClass] = vehicle;
  const centre = centerOrderPhrase(centerOrder);

  const tail = [
    "A.T.L.A.S. — DesignProAI’s canonical flattened design topology, on one square 4K canvas.",
    "For the vehicle-design embodiment, A.T.L.A.S. represents a top-view vehicle-wrap design as a flattened 2D topology: "
    + "conceptually, the printable exterior skin of the completely wrapped 3D vehicle is pressed flat from above and unfolded "
    + `into one dimensionally governed design space. Here that vehicle is this exact ${vehicleName} (${bodyClass}).`,
    "",
    "Create one cohesive professional vehicle-wrap design across this flattened topology. Every defined topology region is "
    + "printable artwork and must be filled completely edge-to-edge with intentional finished design. The complete flattened "
    + "topology represents one coordinated vehicle-wrap design.",
    "",
    "The supplied A.T.L.A.S. example shows how that flattened skin is spatially organized; the supplied neutral guide is this "
    + "vehicle’s own flattened skin at its real proportions. Within it, the two long flank regions (passenger side down the "
    + "left, driver side down the right) carry the wrap’s primary compositions, and the four central regions "
    + `(${centre}, stacked top to bottom in the centre) carry its supporting compositions — all subdivisions of the same one `
    + "flattened printable skin. Driver and Passenger are coordinated but independently composed; they are not mirrored "
    + `artwork. ${NO_CAPTIONS_SENTENCE}`,
    "",
    "Gallery-grade custom artwork with real depth, movement and a wow factor, drawn straight-on and flat for printing.",
  ].join("\n");

  return assertObjectFirst(assertAnchorTailClean(tail));
}

/**
 * @returns { creative, deployedTail, anchorTail, prompt } with the byte
 * identity of the creative assembly PROVEN: the prompt is exactly the deployed
 * creative prefix followed by the anchor tail.
 */
export function buildAnchorPrompt(deployedPrompt, opts = {}) {
  const { creative, tail } = splitDeployedPrompt(deployedPrompt);
  const anchorTail = anchorContract(tail, opts);
  const prompt = creative + anchorTail;
  if (!prompt.startsWith(creative) || prompt.slice(creative.length) !== anchorTail) {
    throw new Error("anchor contract: the creative assembly did not survive");
  }
  return { creative, deployedTail: tail, anchorTail, prompt };
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
 * — with only part 0's tail changed. Every other part is asserted against the
 * sha the deployed edge sent (`expected`), so a drifted teaching text, a
 * substituted proof, a moved guide or a missing part is refused before any
 * provider call.
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
