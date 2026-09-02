#!/usr/bin/env node
/**
 * FIELD CONTRACT v2 — the model-facing prompt for the `field-thirds-v2`
 * recovery harness. Not production.
 *
 * Owner ruling (2026-09-02): Gemini authors ONE uninterrupted full-bleed
 * professional vehicle-wrap composition. It must NOT receive six model-facing
 * production containers, the neutral six-pane guide, a six-pane teaching sheet,
 * six named production objects, panel-layout framing, artboard/template
 * framing, or wheel/window/body-piece negatives. DesignPanelAI keeps the
 * creative job; the OS keeps the production job.
 *
 * The deployed prompt is [DesignPanelAI creative assembly] + [flat-master
 * output-contract tail]. v2 keeps the creative assembly byte for byte EXCEPT
 * seven exact-match, reversible swaps that remove the remaining panel/rectangle
 * object schema from it (the anchor v1–v4 finding: "do not freeze bad wording
 * just because it lives in the creative assembly"), and replaces the tail with
 * a field contract that names THIRDS — the fractions the model drew in
 * `field-bands-v1` — so the composition brief and the code-owned territories
 * describe the same picture.
 *
 * Guards (no provider call): every swap is reversed to prove the deployed
 * creative assembly survives; the WHOLE prompt is checked for object-schema and
 * negative vocabulary, with a short exemption list of creative literals that
 * production owns (the FINISH_SPECS "wet-look surface", the v19-restored "never
 * an on-vehicle photograph", the design-vocabulary "color story, layout,
 * graphic motifs"); the tail is checked against the v1 list as well.
 */
import { createHash } from "node:crypto";
import { splitDeployedPrompt } from "./atlas-print-media-contract.mjs";
import { replaceExactlyOnce, sweepPhrase, GENERATION_CONFIG, FORBIDDEN_IN_FIELD_TAIL, assertFieldTailClean, FIELD_TAIL_MAX_CHARS } from "./atlas-field-contract.mjs";
import { NOSE_EDGE } from "./atlas-field-territories.mjs";

const sha = (v) => createHash("sha256").update(v).digest("hex");

export const FIELD_CONTRACT_V2 = "designpro.atlas-field-prompt.v2";
export { GENERATION_CONFIG, FIELD_TAIL_MAX_CHARS, FORBIDDEN_IN_FIELD_TAIL };

/**
 * Seven exact-match swaps inside the creative assembly. Each names ONLY the
 * object the artwork is; persona, concept, brief, translation, logo, contact
 * lock, photographic-realism rule, FINISH_SPECS text, style, movement and depth
 * are untouched. Swap 1 is the `field-bands-v1` scene swap verbatim.
 */
export const CREATIVE_FIELD_SWAPS = Object.freeze([
  [
    "as ONE FLAT print-production master — flat orthographic panels of pure printed vinyl artwork, never an on-vehicle photograph.",
    "as ONE continuous full-bleed field of pure printed vinyl artwork — the way the vinyl looks coming off the printer before anything is cut or applied, never an on-vehicle photograph.",
  ],
  ["This is the single design authority for the complete vehicle, not six independent graphics.", "This is the single design authority for the complete vehicle — one design, one composition."],
  ["background color and texture flowing across the panels", "background color and texture flowing continuously across the whole field"],
  ["rather than flat shapes on bare panel", "rather than flat shapes on bare vinyl"],
  ["The vinyl finish is gloss across every panel — consistent finish on every surface.", "The vinyl finish is gloss across the whole field — one consistent finish throughout."],
  ["The artwork fills every rectangle edge to edge — solid printed vinyl, corner to corner.", "The artwork fills the entire field edge to edge — solid printed vinyl, corner to corner."],
  ["angular faceted panels with sharp swept edges", "angular faceted plates with sharp swept edges"],
].map((pair) => Object.freeze(pair)));

/** Creative literals production owns that the whole-prompt guard must not convict. */
export const APPROVED_CREATIVE_PHRASES = Object.freeze([
  "wet-look surface",
  "never an on-vehicle photograph",
  "color story, layout, graphic motifs",
]);

// A trailing word boundary only where the term ends in a word character ("A.T.L.A.S." ends in a dot).
const wordPatterns = (words) => words.map((word) => ({
  word,
  pattern: new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${/\w$/.test(word) ? "\\b" : ""}`, "i"),
}));
/**
 * Object-schema, topology and negative vocabulary that may not appear ANYWHERE
 * in the model-facing prompt (word-boundary, case-insensitive) after the
 * approved creative literals are stripped.
 */
export const FORBIDDEN_IN_FIELD_PROMPT = wordPatterns([
  "panel", "panels", "artboard", "orthographic", "rectangle", "rectangles", "sheet", "template", "mockup",
  "silhouette", "layout", "container", "containers", "box", "boxes", "region", "regions", "surface", "surfaces",
  "six", "zone", "zones", "wheel", "wheels", "window", "windows", "glass", "do not", "never a", "avoid",
  "A.T.L.A.S.", "topology", "guide", "label", "labels", "caption", "captions",
]);
const stripApproved = (text) => APPROVED_CREATIVE_PHRASES.reduce((out, phrase) => out.split(phrase).join(""), text);

export function assertFieldPromptClean(prompt, where = "the field prompt") {
  const text = stripApproved(prompt);
  for (const { word, pattern } of FORBIDDEN_IN_FIELD_PROMPT) {
    if (pattern.test(text)) throw new Error(`field contract v2: ${where} contains forbidden framing "${word}"`);
  }
  return prompt;
}

export function applyCreativeFieldSwaps(creative) {
  let out = creative;
  for (const [from, to] of CREATIVE_FIELD_SWAPS) out = replaceExactlyOnce(out, from, to);
  return out;
}

export function reverseCreativeFieldSwaps(swapped) {
  let out = swapped;
  for (const [from, to] of [...CREATIVE_FIELD_SWAPS].reverse()) out = replaceExactlyOnce(out, to, from);
  return out;
}

/**
 * The v2 tail: one continuous composition in three equal horizontal thirds —
 * the same thirds the code-owned territories occupy. No topology words, no
 * negatives. Vehicle context is lifted from the deployed tail, never restated.
 */
export function fieldContractV2(deployedTail, { noseEdge = NOSE_EDGE } = {}) {
  const vehicle = /for this exact (.+?) \((.+?)\)/.exec(deployedTail);
  if (!vehicle) throw new Error("field contract v2: could not read the vehicle context out of the deployed tail");
  const [, vehicleName, bodyClass] = vehicle;
  const tail = [
    "OUTPUT — ONE CONTINUOUS FULL-BLEED COMPOSITION on one square 4K image.",
    `Paint the entire square, edge to edge on all four sides, as one uninterrupted field of printed vinyl artwork for this exact ${vehicleName} (${bodyClass}) — ground colour, texture and motion running continuously across the whole image, straight-on and flat.`,
    "",
    "Compose it in three equal horizontal thirds that read as one picture:",
    `• THE UPPER THIRD — the primary hero passage: a complete, wide statement of the design, the company name whole and legible inside it, clear of the third's top and bottom edges. ${sweepPhrase(noseEdge.driver)}`,
    `• THE MIDDLE THIRD — a second hero passage telling the brand story in full, composed afresh as its own arrangement, the company name whole and legible inside it too. ${sweepPhrase(noseEdge.passenger)}`,
    "• THE LOWER THIRD — the supporting register: the same ground, palette and motion at a calmer intensity, secondary motifs, finished artwork everywhere. The brand mark may appear here once, compact and whole; every other letter lives in the upper two thirds.",
    "",
    "Lettering reads left to right throughout. Each focal element sits inside one third; the ground and its motion flow through all three continuously, so the transitions are invisible. Gallery-grade custom artwork with real depth, movement and a wow factor, drawn flat for printing.",
  ].join("\n");
  return assertFieldTailClean(tail);
}

/**
 * @returns { creative, creativeField, deployedTail, fieldTail, prompt, swaps, reverseProof }
 * The creative assembly's byte identity is PROVEN: reversing the seven swaps
 * reproduces the deployed creative exactly, and the prompt opens with the
 * swapped creative exactly.
 */
export function buildFieldPromptV2(deployedPrompt, opts = {}) {
  const { creative, tail } = splitDeployedPrompt(deployedPrompt);
  const creativeField = applyCreativeFieldSwaps(creative);
  const reverseProof = reverseCreativeFieldSwaps(creativeField) === creative;
  if (!reverseProof) throw new Error("field contract v2: the seven swaps do not reverse to the deployed creative assembly");
  const fieldTail = fieldContractV2(tail, opts);
  const prompt = creativeField + fieldTail;
  if (!prompt.startsWith(creativeField)) throw new Error("field contract v2: the creative assembly did not survive");
  assertFieldPromptClean(creativeField, "the swapped creative assembly");
  assertFieldPromptClean(prompt);
  return {
    creative,
    creativeField,
    deployedTail: tail,
    fieldTail,
    prompt,
    swaps: CREATIVE_FIELD_SWAPS.map(([from, to]) => ({ from, to })),
    reverseProof,
    creativeSha256: sha(creative),
    creativeFieldSha256: sha(creativeField),
    promptSha256: sha(prompt),
  };
}

function partSummary(part, index) {
  if (part.text != null) {
    return { index, kind: "text", chars: part.text.length, sha256: sha(part.text), preview: part.text.slice(0, 90).replace(/\s+/g, " ") };
  }
  const bytes = Buffer.from(part.inlineData?.data || "", "base64");
  return { index, kind: "image", mimeType: part.inlineData?.mimeType, bytes: bytes.length, sha256: sha(bytes) };
}

/**
 * The v2 request: the prompt, then verified customer references (none on the
 * fixture). ZERO structural images — a guide or a teaching sheet is refused.
 */
export function buildFieldRequestV2({ prompt, referenceParts = [], model }) {
  const parts = [{ text: prompt }, ...referenceParts];
  const serialize = (p) => JSON.stringify({ contents: [{ role: "user", parts: p }], generationConfig: GENERATION_CONFIG });
  const request = {
    label: "FIELD-v2-one-continuous-composition",
    contract: FIELD_CONTRACT_V2,
    model,
    generationConfig: GENERATION_CONFIG,
    promptChars: prompt.length,
    promptSha256: sha(prompt),
    partCount: parts.length,
    modelInputImageCount: parts.filter((p) => p.inlineData?.data).length,
    customerReferenceCount: referenceParts.filter((p) => p.inlineData?.data).length,
    modelRequestByteSize: Buffer.byteLength(serialize(parts), "utf8"),
    parts: parts.map(partSummary),
  };
  if (request.modelInputImageCount !== request.customerReferenceCount || referenceParts.some((p) => !p.inlineData?.data)) {
    throw new Error("field request v2 carries a structural image or an extra text part — only verified customer reference images may follow the prompt; no guide, no teaching sheet, no topology text");
  }
  if (request.parts[0].kind !== "text") throw new Error("field request v2 must open with the prompt");
  return { parts, request, serialize };
}
