#!/usr/bin/env node
/**
 * TEST 7 — the model-facing description of WHAT IS BEING CREATED.
 *
 * Six image-side variables were null. The hypothesis is no longer "wheel wells":
 * it is that Gemini has the wrong mental model of the output object — it is
 * drawing SIX VEHICLE-PANEL OBJECTS ON AN ARTBOARD instead of FILLING SIX
 * AUTHORITATIVE RECTANGULAR PRINT-MEDIA REGIONS EDGE TO EDGE. That single
 * reading explains the vehicle contours, the wheel wells, the rectangles drawn
 * smaller than their zones, the surrounding empty fields, the copied technical
 * labels, and the invented "A.T.L.A.S. ARTBOARD" string at once.
 *
 * So this replaces the object/format framing of the flat-master output contract
 * with one positive print-media contract, and changes nothing else.
 *
 * The deployed prompt is [DesignPanelAI creative assembly] + [flat-master output
 * contract], and the contract is the TAIL. Arm B keeps the creative assembly
 * byte for byte and swaps only that tail, so "the creative intelligence is
 * preserved" is a structural fact rather than a claim.
 *
 * NO NEGATIVE IS ADDED. Nothing about wheel wells, windows, silhouettes, holes,
 * vehicle anatomy or forbidden objects appears in B — the builder refuses to
 * emit a tail containing any of them.
 */

export const OWNER_CONTRACT = [
  "Create one cohesive vehicle-wrap print design across the six supplied rectangular print areas.",
  "Each entire rectangle is printable vinyl artwork.",
  "Fill every rectangle completely edge-to-edge with the continuous design.",
].join(" ");

// Words the owner ruled out of B: object/format framing, and every negative.
export const FORBIDDEN_IN_B = [
  "artboard", "template", "panel layout", "panel sheet", "wheel", "window", "glass",
  "silhouette", "hole", "arch", "seam", "bumper", "headlight", "do not", "never a",
  "no panel names", "avoid",
];

/**
 * Build arm B's tail from arm A's own tail, so the vehicle context and the six
 * region names are carried across verbatim rather than restated.
 */
export function printMediaContract(deployedTail) {
  const vehicle = /for this exact (.+?) \((.+?)\)/.exec(deployedTail);
  if (!vehicle) throw new Error("print-media contract: could not read the vehicle context out of the deployed tail");
  const [, vehicleName, bodyClass] = vehicle;

  const regionLines = deployedTail
    .split("\n")
    .filter((line) => line.startsWith("• "))
    .map((line) => line.replace(/\bthe tall panel\b/g, "the tall area").replace(/\bpanel\b/g, "area"));
  if (regionLines.length !== 3) {
    throw new Error(`print-media contract: expected 3 region lines in the deployed tail, found ${regionLines.length}`);
  }

  const tail = [
    "OUTPUT — ONE SQUARE 4K IMAGE OF FLAT PRINTED VINYL.",
    `${OWNER_CONTRACT} The design is for this exact ${vehicleName} (${bodyClass}).`,
    "",
    "The six print areas, and where each one sits:",
    ...regionLines,
    "",
    "One design, continuous across all six areas. The left and right areas carry the SAME design — the palette, "
    + "the imagery, the motion and the branding continue from one to the other. The centre areas carry that same "
    + "composition. Customer-facing wording reads normally in every area.",
    "",
    "Each rectangle is opaque printed graphic art reaching all four of its own edges: the same kind of image as a "
    + "printed poster, or a roll of printed vinyl laid flat on a table. It is the artwork by itself, before anything "
    + "is cut or applied. Customer-requested photographic imagery is a photograph printed INTO that flat art. "
    + "Vehicle appearance, installed boundaries and presentation lighting are produced downstream by the seven proof "
    + "projections and are absent here.",
    "",
    "Gallery-grade custom artwork with real depth, movement and a wow factor, drawn straight-on and flat for printing.",
  ].join("\n");

  const lowered = tail.toLowerCase();
  for (const word of FORBIDDEN_IN_B) {
    if (lowered.includes(word)) throw new Error(`print-media contract: arm B contains forbidden framing "${word}"`);
  }
  return tail;
}

/** Split the deployed prompt into [creative assembly, flat-master tail]. */
export function splitDeployedPrompt(prompt) {
  const at = prompt.indexOf("OUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD");
  if (at < 0) throw new Error("the deployed prompt no longer opens its output contract with the pinned header");
  if (prompt.indexOf("OUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD", at + 1) >= 0) {
    throw new Error("the output-contract header appears more than once");
  }
  return { creative: prompt.slice(0, at), tail: prompt.slice(at) };
}

export function buildPrintMediaPrompt(prompt) {
  const { creative, tail } = splitDeployedPrompt(prompt);
  const reframed = creative + printMediaContract(tail);
  if (!reframed.startsWith(creative)) throw new Error("the creative assembly did not survive the swap");
  return { creative, deployedTail: tail, printMediaTail: printMediaContract(tail), prompt: reframed };
}
