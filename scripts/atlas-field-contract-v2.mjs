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

/* ────────────────────────────────────────────────────────────────────────────
 * TEST 12 — SIX-REGION TOPOLOGY TEXT (owner-approved candidate, ONE draw)
 *
 * RULE 0.34 rejected the v24 one-field / thirds composition and approved the
 * direction: restore the single-master six-surface A.T.L.A.S. flattened
 * topology — PASSENGER | REAR / ROOF / HOOD / FRONT | DRIVER — and require the
 * ORIGINAL Call-1 draw to fill every production territory with intentional,
 * anatomy-free, full-bleed artwork.
 *
 * HONEST CLASSIFICATION: a topology-text experiment, the same family as Test 3,
 * which was null. The untested cell is zero images + zero surface names + the
 * edge-to-edge extent sentence + a positional description of the arrangement.
 * A hypothesis, not a prediction, and one draw is one draw.
 *
 * It reuses the v2 machinery unchanged — the same seven reversible creative
 * swaps, the same reverse proof, the same whole-prompt and tail guards, the
 * same request builder that refuses a structural image. ONLY the tail differs
 * from `fieldContractV2`: thirds become the six-region arrangement, and no
 * heading strings exist that could be rendered as labels (run 1a0e6b70 printed
 * its "UPPER THIRD" / "MIDDLE THIRD" headings into the artwork).
 *
 * ⛔ NO DATABASE, NO SUPABASE CREDENTIAL, NO PROVIDER OBJECT. Tests 9–11 read
 * GENIE live, which needs the SERVICE-ROLE key — `designpro_vehicle_specs_universal`
 * and `designpro_vehicle_dimensions` are both `REVOKE ALL … FROM PUBLIC, anon,
 * authenticated` with `GRANT ALL … TO service_role`, so no lesser credential can
 * read them. The owner forbids the service-role key in this container, so the
 * PHYSICAL DIMENSIONS are pinned from run 33659500846's artifact instead and
 * `sixRegionManifest` rebuilds the topology with the production
 * `buildAtlasManifest`. The container therefore needs exactly ONE variable, and
 * only for the draw: GEMINI_API_KEY.
 *
 * ⚠️ THREE DIFFERENT OBJECTS LIVE IN THAT ARTIFACT. DO NOT CONFLATE THEM.
 *   1. the GENIE PHYSICAL-DIMENSION AUTHORITY — six trim inch pairs, the GENIE
 *      manifest hash and the geometry state. Topology-independent: the harness
 *      asserts the thirds territories carry the same inches as the legacy zones,
 *      so both topologies quote the same physical vehicle. THIS is what is
 *      pinned as INPUT here, and it is the only geometry provenance claimed.
 *   2. the LEGACY six-surface `buildAtlasManifest` topology (tall passenger
 *      column left, tall driver column right, REAR/ROOF/HOOD/FRONT stacked
 *      centre) — recorded in that run under `$.legacyZones` and NOT USED BY IT.
 *      Run 33659500846 cut no panel from these rectangles.
 *   3. Draw 1's ACTUAL extraction manifest — `$.zones`, contract
 *      `designpro.atlas-field-territories.v2`, topology `field-thirds-v2`:
 *      driver (362,0,3371,1365), passenger (362,1365,3371,1365) and four
 *      smaller areas from y=2730, all at rotation 0. THOSE cut its six panels,
 *      and `panels.json` proves it — driver 3371×1365 px at 20.68 px/in, not
 *      1153×2848 at 17.47.
 * Test 12 DELIBERATELY uses object 2, because RULE 0.34 makes the restored
 * six-surface topology the target architecture. It is the target, never Draw 1's
 * receipt, and nothing in this file may describe it as one.
 * ──────────────────────────────────────────────────────────────────────────── */

export const SIX_REGION_CONTRACT = "designpro.atlas-six-region-prompt.v1";

/** The owner-approved request, to the byte. The draw is refused unless all of these reproduce. */
export const APPROVED_SIX_REGION = Object.freeze({
  promptSha256: "2c460057a646f12722bf0f50019987d1506b2215a72f1ae26a642901ca4ccc24",
  promptChars: 3983,
  modelRequestByteSize: 4210,
  partCount: 1,
  modelInputImageCount: 0,
  customerReferenceCount: 0,
  model: "gemini-3-pro-image",
  generationConfigJson: '{"responseModalities":["TEXT","IMAGE"],"imageConfig":{"aspectRatio":"1:1","imageSize":"4K"}}',
  temperature: null,
  tailChars: 1285,
  tailSha256: "1b67338c53a6b983adaaf80c0606d9a5107cfc8a1871ccba21e5c844001dcb34",
  creativeFieldChars: 2698,
  deployedPromptSha256: "dcb73e9eae229cd88af6bcdb4a3874e1050b266fa98a55b79fee65d0b7e610b2",
  deployedPromptChars: 4587,
});

/**
 * Everything pinned out of harness run 33659500846, with each object named for
 * exactly what it is. Artifact filenames, JSON paths and sha256 are recorded so
 * a later reader can re-open the source rather than trust this comment.
 */
export const PINNED_GENIE = Object.freeze({
  sourceRun: "33659500846",

  // ── 1. GENIE PHYSICAL-DIMENSION AUTHORITY — the only geometry INPUT ────────
  // Source: territories.json `$.zones[*].trimWidthIn` / `.trimHeightIn`
  // (sha256 408250fc…), identical to panels.json `$[*].trimWidthIn` /
  // `.trimHeightIn` (sha256 4f7da3ed…). Topology-independent: the run asserts
  // "territory inches drifted from the legacy zone" and did not throw, so the
  // thirds territories and the legacy zones quote the same physical vehicle.
  vehicle: { type: "truck", year: "2022", make: "Ford", model: "F250 Crew Cab" },
  genieManifestHash: "879291d3a9120666dda28205807fdee7e6cce8e7caabf116aa7b4b078327008b",
  geometryState: "measured",
  bleedInches: 5,
  inches: Object.freeze({
    driver: [153, 56], passenger: [153, 56], hood: [71.5, 56],
    roof: [74.3, 54.8], front: [129, 34], rear: [76, 54],
  }),
  dimensionSource: Object.freeze({
    artifact: "territories.json",
    jsonPath: "$.zones[*].trimWidthIn / $.zones[*].trimHeightIn",
    sha256: "408250fcf6f000cdf4cdb42b4f13d586bd8d05ccabf8d1052786ab4f871018d9",
    corroboratingArtifact: "panels.json",
    corroboratingJsonPath: "$[*].trimWidthIn / $[*].trimHeightIn",
    corroboratingSha256: "4f7da3edeffc1b14888e924e2bd99952fed8db5c757781e3301aa601fbc6b42f",
  }),

  // ── 2. LEGACY six-surface buildAtlasManifest topology — the TARGET, and a ──
  // CONSISTENCY CHECK ONLY. Source: territories.json `$.legacyZones` (same
  // sha256 as above). Run 33659500846 RECORDED these rectangles and CUT NOTHING
  // FROM THEM. They are not that run's extraction receipt and must never be
  // described as one. Test 12 uses this topology deliberately, because RULE 0.34
  // makes it the target architecture.
  legacyZones: Object.freeze({
    driver: [2751, 624, 1153, 2848, -90, 17.47],
    passenger: [192, 624, 1153, 2848, 90, 17.47],
    hood: [1417, 2310, 1262, 1022, 0, 15.48],
    roof: [1417, 1304, 1262, 970, 0, 14.97],
    front: [1417, 3368, 1262, 399, 0, 9.07],
    rear: [1417, 329, 1262, 939, 0, 14.67],
  }),
  legacyZonesSource: Object.freeze({
    artifact: "territories.json",
    jsonPath: "$.legacyZones",
    sha256: "408250fcf6f000cdf4cdb42b4f13d586bd8d05ccabf8d1052786ab4f871018d9",
    role: "recorded for reference by run 33659500846; NOT its extraction manifest",
  }),

  // ── 3. Draw 1's ACTUAL extraction manifest — recorded here ONLY so this ────
  // file can never again be read as if the tall columns were Draw 1's receipt.
  // Source: territories.json `$.zones`, contract
  // designpro.atlas-field-territories.v2, topology field-thirds-v2. panels.json
  // confirms it: driver was cut 3371×1365 px at 20.68 px/in.
  draw1ActualExtractionTerritories: Object.freeze({
    contract: "designpro.atlas-field-territories.v2",
    topology: "field-thirds-v2",
    jsonPath: "$.zones",
    zones: Object.freeze({
      driver: [362, 0, 3371, 1365, 0],
      passenger: [362, 1365, 3371, 1365, 0],
      roof: [120, 2730, 1066, 820, 0],
      hood: [1186, 2730, 1031, 835, 0],
      front: [2217, 2730, 1758, 557, 0],
      rear: [2217, 3287, 1088, 809, 0],
    }),
    note: "these cut run 33659500846's six panels; the tall columns above did not",
  }),
});

/**
 * The six-region tail. Vehicle context is lifted out of the deployed tail, never
 * restated. No surface names, no coordinates, no headings, no negatives — the
 * whole-prompt and tail guards enforce that, not this comment.
 *
 * Orientation is derived from `buildAtlasManifest`, not guessed: passenger is
 * the left column at +90 and driver the right column at −90, and the centre
 * column runs REAR → ROOF → HOOD → FRONT top to bottom. `sixRegionManifest`
 * refuses if the manifest ever contradicts those words.
 */
export function sixRegionContract(deployedTail) {
  const vehicle = /for this exact (.+?) \((.+?)\)/.exec(deployedTail);
  if (!vehicle) throw new Error("six-region contract: could not read the vehicle context out of the deployed tail");
  const [, vehicleName, bodyClass] = vehicle;
  const tail = [
    "OUTPUT — ONE CONTINUOUS FULL-BLEED COMPOSITION on one square 4K image.",
    `Paint the entire square, edge to edge on all four sides, as one uninterrupted field of printed vinyl artwork for this exact ${vehicleName} (${bodyClass}) — ground colour, texture and motion running continuously across the whole image, straight-on and flat.`,
    "",
    "Down the whole left edge, turned a quarter turn clockwise, the design makes a complete hero statement, the company name whole and legible inside it, its forward energy running from top to bottom. Down the whole right edge, turned a quarter turn anticlockwise, it makes that statement again, composed afresh as its own arrangement, the company name whole and legible there too, forward energy again running top to bottom. Between those two, the same design resolves four more times, stacked one above the next from top to bottom, each one level and each intentionally finished with its own focal detail.",
    "",
    "The ground, its texture and its motion run unbroken across the whole square, so every part flows into the next without interruption. Lettering follows the long axis of whatever part it sits in. Every letter in the image is wording from the brief above. Gallery-grade custom artwork with real depth, movement and a wow factor, drawn flat for printing.",
  ].join("\n");
  return assertFieldTailClean(tail);
}

/** Identical to `buildFieldPromptV2` except for the tail. Same swaps, same reverse proof, same guards. */
export function buildSixRegionPromptV2(deployedPrompt) {
  const { creative, tail } = splitDeployedPrompt(deployedPrompt);
  const creativeField = applyCreativeFieldSwaps(creative);
  if (reverseCreativeFieldSwaps(creativeField) !== creative) {
    throw new Error("six-region contract: the seven swaps do not reverse to the deployed creative assembly");
  }
  const fieldTail = sixRegionContract(tail);
  const prompt = creativeField + fieldTail;
  assertFieldPromptClean(creativeField, "the swapped creative assembly");
  assertFieldPromptClean(prompt);
  return {
    creative, creativeField, deployedTail: tail, fieldTail, prompt,
    swaps: CREATIVE_FIELD_SWAPS.map(([from, to]) => ({ from, to })),
    reverseProof: true,
    creativeSha256: sha(creative), creativeFieldSha256: sha(creativeField),
    tailSha256: sha(fieldTail), promptSha256: sha(prompt),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * TEST 13 — TEST 12 PLUS NORMALIZED GENIE-DERIVED TERRITORY PROPORTIONS
 *
 * Run 33823909617 (test 12) was the first evidenced result combining a
 * recognizable six-territory topology, anatomy-free artwork and no
 * instructional labels — and it failed registration: the model composed the
 * right arrangement at ITS OWN proportions (flanks 4.0:1, centre rows 2.0:1)
 * against GENIE's (2.47:1 and 1.2–3.2:1), so every canonical cut crossed a
 * drawn boundary. The offline registration proof showed identification is
 * deterministic on that master but any mapping discards 33–38% of each
 * territory. Registration was deterministic for that ONE master; it is not
 * proven generally. GENIE supplies the authoritative proportions; the model is
 * conditioned to compose within them — it never "carries" production geometry.
 *
 * Test 13 changes ONE thing: a single paragraph of normalized proportions,
 * derived by code from `manifest.zones`, inserted after the arrangement
 * paragraph. Brief, topology order, orientation wording, model, request
 * configuration, zero-image input and every other byte are unchanged, and the
 * preflight proves it — removing the insertion must reproduce test 12's sha.
 * Passenger orientation is deliberately NOT addressed here. No labels, no
 * surface names, no teaching image, no guide.
 * ──────────────────────────────────────────────────────────────────────────── */

export const SIX_REGION_PROPORTIONS_CONTRACT = "designpro.atlas-six-region-prompt.v2-proportions";
/** Test 12's tail was 1285 chars under the 1400 harness ceiling; the proportions add 317. */
export const SIX_REGION_PROPORTIONS_TAIL_MAX_CHARS = 1700;
const PROPORTIONS_ANCHOR = "each intentionally finished with its own focal detail.";

/** The owner-approved test-13 request, to the byte, plus its exact relationship to test 12. */
export const APPROVED_SIX_REGION_PROPORTIONS = Object.freeze({
  ...APPROVED_SIX_REGION,
  promptSha256: "4906f932e57d68cc125ab0c37bebac049885ad25f2093259d68b06a7a71df98a",
  promptChars: 4300,
  modelRequestByteSize: 4529,
  tailChars: 1602,
  tailSha256: "31318e8523141ce789785fb2dc3614324a66ba88d2eab73d4dc60b20bcc1a942",
  parentPromptSha256: APPROVED_SIX_REGION.promptSha256,
  insertionOffset: 3631,
  insertionChars: 317,
  proportionsText: "Proportions, measured as fractions of the square, across then down: the left part 0.0469 to 0.3284 and 0.1523 to 0.8477; the right part 0.6716 to 0.9531 and 0.1523 to 0.8477; the four between them 0.3459 to 0.6541 across, and down from the top 0.0803 to 0.3096, 0.3184 to 0.5552, 0.5640 to 0.8135, 0.8223 to 0.9197.",
});

/** Normalized zone extents, four decimals, derived from the production manifest — never typed. */
export function genieProportionsSentence(manifest) {
  const Z = Object.fromEntries(manifest.zones.map((z) => [z.surfaceKey, z]));
  const W = manifest.canvas.widthPx, H = manifest.canvas.heightPx;
  const f = (v) => (Math.round(v * 10000) / 10000).toFixed(4);
  const xs = (z) => `${f(z.x / W)} to ${f((z.x + z.w) / W)}`;
  const ys = (z) => `${f(z.y / H)} to ${f((z.y + z.h) / H)}`;
  const centre = ["rear", "roof", "hood", "front"];
  if (centre.some((k) => xs(Z[k]) !== xs(Z.rear))) throw new Error("proportions: the centre column is not one horizontal span");
  if (ys(Z.passenger) !== ys(Z.driver)) throw new Error("proportions: the flanks differ vertically");
  return `Proportions, measured as fractions of the square, across then down: the left part ${xs(Z.passenger)} and ${ys(Z.passenger)}; the right part ${xs(Z.driver)} and ${ys(Z.driver)}; the four between them ${xs(Z.rear)} across, and down from the top ${centre.map((k) => ys(Z[k])).join(", ")}.`;
}

/** Test 12's tail with the proportions paragraph inserted after the arrangement paragraph. */
export function sixRegionProportionsContract(deployedTail, manifest) {
  const base = sixRegionContract(deployedTail);
  const at = base.indexOf(PROPORTIONS_ANCHOR);
  if (at < 0 || base.indexOf(PROPORTIONS_ANCHOR, at + 1) >= 0) throw new Error("proportions: the insertion anchor is not unique in the test-12 tail");
  const cut = at + PROPORTIONS_ANCHOR.length;
  const sentence = genieProportionsSentence(manifest);
  if (sentence !== APPROVED_SIX_REGION_PROPORTIONS.proportionsText) throw new Error("proportions: the sentence derived from the manifest is not the owner-approved sentence — refusing");
  const tail = base.slice(0, cut) + "\n\n" + sentence + base.slice(cut);
  for (const { word, pattern } of FORBIDDEN_IN_FIELD_TAIL) if (pattern.test(tail)) throw new Error(`proportions: tail contains forbidden framing "${word}"`);
  if (tail.length > SIX_REGION_PROPORTIONS_TAIL_MAX_CHARS) throw new Error(`proportions: tail is ${tail.length} chars, over the ${SIX_REGION_PROPORTIONS_TAIL_MAX_CHARS} ceiling`);
  return tail;
}

/** Identical to buildSixRegionPromptV2 except the tail; also returns the parent (test-12) sha for the proof. */
export function buildSixRegionProportionsPromptV2(deployedPrompt, manifest) {
  const t12 = buildSixRegionPromptV2(deployedPrompt);
  const fieldTail = sixRegionProportionsContract(t12.deployedTail, manifest);
  const prompt = t12.creativeField + fieldTail;
  assertFieldPromptClean(prompt);
  return { ...t12, fieldTail, prompt, tailSha256: sha(fieldTail), promptSha256: sha(prompt), parentPromptSha256: t12.promptSha256, parentPromptChars: t12.prompt.length };
}

/**
 * Build the target six-surface A.T.L.A.S. topology from the pinned GENIE inches
 * with the REAL production `buildAtlasManifest`, then cross-check it against the
 * legacy zones run 33659500846 RECORDED BUT DID NOT USE, and against the
 * orientation the approved tail describes in words.
 *
 * The cross-check proves the pinned inches still produce the same six-surface
 * layout that run's `buildAtlasManifest` produced. It is NOT a claim that those
 * rectangles cut anything: Draw 1's panels were cut by `field-thirds-v2`
 * (`PINNED_GENIE.draw1ActualExtractionTerritories`).
 */
export function sixRegionManifest(buildAtlasManifest) {
  const surfaces = Object.entries(PINNED_GENIE.inches).map(([surfaceKey, [widthInches, heightInches]]) => ({
    surfaceKey, widthInches, heightInches,
    surfaceSqFt: Math.round((widthInches * heightInches / 144) * 100) / 100,
    bleed: { top: 5, right: 5, bottom: 5, left: 5 },
  }));
  const manifest = buildAtlasManifest(surfaces, null, PINNED_GENIE.vehicle.type);
  for (const zone of manifest.zones) {
    const pinned = PINNED_GENIE.legacyZones[zone.surfaceKey];
    const built = [zone.x, zone.y, zone.w, zone.h, zone.rotationDegrees, zone.effectivePpi];
    if (!pinned || built.join(",") !== pinned.join(",")) {
      throw new Error(`six-region geometry: ${zone.surfaceKey} rebuilt as (${built.join(", ")}) but run ${PINNED_GENIE.sourceRun} recorded (${(pinned || []).join(", ")}) in territories.json $.legacyZones — refusing the draw`);
    }
  }
  const z = (k) => manifest.zones.find((q) => q.surfaceKey === k);
  for (const [key, placement, rotation] of [["passenger", "left-flank", 90], ["driver", "right-flank", -90]]) {
    if (z(key).placement !== placement || z(key).rotationDegrees !== rotation) {
      throw new Error(`six-region orientation: ${key} is ${z(key).placement} at ${z(key).rotationDegrees}°, the approved wording assumes ${placement} at ${rotation}°`);
    }
  }
  const centre = ["rear", "roof", "hood", "front"];
  const ordered = manifest.zones.filter((q) => centre.includes(q.surfaceKey)).sort((a, b) => a.y - b.y).map((q) => q.surfaceKey);
  if (ordered.join(",") !== centre.join(",")) {
    throw new Error(`six-region orientation: the centre column reads ${ordered.join(" → ")} top to bottom, the approved wording assumes ${centre.join(" → ")}`);
  }
  if (centre.some((k) => z(k).rotationDegrees !== 0)) throw new Error("six-region orientation: a centre zone is rotated; the approved wording assumes level");
  manifest.geometryResolution = {
    genieManifestHash: PINNED_GENIE.genieManifestHash,
    state: PINNED_GENIE.geometryState,
    source: `GENIE physical dimensions pinned from harness run ${PINNED_GENIE.sourceRun} (territories.json ${PINNED_GENIE.dimensionSource.jsonPath}); no database read`,
    productionEligible: false,
    operatorValidated: true,
  };
  return {
    manifest,
    orientation: { passenger: "left-flank +90", driver: "right-flank -90", centreTopToBottom: centre },
    provenance: {
      dimensionAuthority: PINNED_GENIE.dimensionSource,
      topologySource: "rebuilt now by the production buildAtlasManifest from those dimensions",
      crossCheckedAgainst: PINNED_GENIE.legacyZonesSource,
      notDraw1ExtractionReceipt: PINNED_GENIE.draw1ActualExtractionTerritories,
    },
  };
}

/**
 * PREFLIGHT. Every owner-approved value, checked before a single byte leaves the
 * runner. Any drift — a re-worded tail, a different fixture, a model swap, an
 * added temperature, an extra part, any image part — throws here.
 */
export function assertApprovedSixRegionRequest({ deployedPrompt, field, request, serialize, parts, lock = APPROVED_SIX_REGION }) {
  const A = lock;
  const fail = (what, expected, actual) => {
    throw new Error(`six-region preflight: ${what} is ${JSON.stringify(actual)}, the owner approved ${JSON.stringify(expected)} — refusing the draw`);
  };
  if (sha(deployedPrompt) !== A.deployedPromptSha256) fail("the deployed prompt sha256", A.deployedPromptSha256, sha(deployedPrompt));
  if (deployedPrompt.length !== A.deployedPromptChars) fail("the deployed prompt length", A.deployedPromptChars, deployedPrompt.length);
  if (field.reverseProof !== true) fail("the creative reverse proof", true, field.reverseProof);
  if (field.creativeField.length !== A.creativeFieldChars) fail("the swapped creative length", A.creativeFieldChars, field.creativeField.length);
  if (field.fieldTail.length !== A.tailChars) fail("the tail length", A.tailChars, field.fieldTail.length);
  if (field.tailSha256 !== A.tailSha256) fail("the tail sha256", A.tailSha256, field.tailSha256);
  if (field.promptSha256 !== A.promptSha256) fail("the prompt sha256", A.promptSha256, field.promptSha256);
  if (field.prompt.length !== A.promptChars) fail("the prompt length", A.promptChars, field.prompt.length);
  if (request.partCount !== A.partCount) fail("the part count", A.partCount, request.partCount);
  if (request.modelInputImageCount !== A.modelInputImageCount) fail("the image-part count", A.modelInputImageCount, request.modelInputImageCount);
  if (request.customerReferenceCount !== A.customerReferenceCount) fail("the customer-reference count", A.customerReferenceCount, request.customerReferenceCount);
  if (parts.length !== 1 || parts[0]?.text !== field.prompt) fail("the parts array", "exactly one text part carrying the approved prompt", parts.map((p) => (p.text != null ? "text" : "image")));
  if (request.model !== A.model) fail("the model", A.model, request.model);
  if (JSON.stringify(request.generationConfig) !== A.generationConfigJson) fail("the generationConfig", A.generationConfigJson, JSON.stringify(request.generationConfig));
  const body = serialize(parts);
  if (Buffer.byteLength(body, "utf8") !== A.modelRequestByteSize) fail("the serialized body size", A.modelRequestByteSize, Buffer.byteLength(body, "utf8"));
  if (body !== JSON.stringify({ contents: [{ role: "user", parts: [{ text: field.prompt }] }], generationConfig: GENERATION_CONFIG })) {
    fail("the serialized body", "contents[0].parts = [the approved prompt] and nothing else", "a different body shape");
  }
  if (/"temperature"/.test(body)) fail("temperature", "absent", "present");
  if (A.parentPromptSha256) {
    // test 13 is test 12 plus ONE inserted paragraph: removing it must reproduce test 12 byte for byte
    const { insertionOffset: off, insertionChars: n } = A;
    const parent = field.prompt.slice(0, off) + field.prompt.slice(off + n);
    if (sha(parent) !== A.parentPromptSha256) fail("the prompt with the proportions removed", `the parent prompt ${A.parentPromptSha256}`, sha(parent));
    if (field.prompt.slice(off + 2, off + n) !== A.proportionsText) fail("the inserted paragraph", A.proportionsText.slice(0, 40) + "…", field.prompt.slice(off + 2, off + 42) + "…");
  }
  return {
    contract: A.parentPromptSha256 ? SIX_REGION_PROPORTIONS_CONTRACT : SIX_REGION_CONTRACT, promptSha256: field.promptSha256, promptChars: field.prompt.length,
    modelRequestByteSize: request.modelRequestByteSize, partCount: request.partCount,
    modelInputImageCount: request.modelInputImageCount, model: request.model,
    generationConfig: request.generationConfig, temperature: null,
    verdict: "PASS — every owner-approved value reproduced",
  };
}

/**
 * ALLOWLIST fence, installed before anything can reach the network: the ONLY
 * outbound request this process may make is `budget` calls to the approved image
 * model. Every other URL — any host, any method — throws. There is no retry and
 * no reroll anywhere in this file, and this makes that structural rather than
 * asserted.
 */
export function installNetworkFence({ imageModel, budget = 1 }) {
  const inner = globalThis.fetch;
  const allowed = `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent`;
  const state = { imageRequestsSent: 0, imageRequestsAttempted: 0, refused: [], budget, allowed };
  globalThis.fetch = async (input, init) => {
    const url = String(typeof input === "string" ? input : input?.url || input);
    const bare = url.split("?")[0];
    if (bare !== allowed) {
      state.refused.push(bare);
      throw new Error(`network fence: ${bare} refused — this run may reach exactly one URL, ${allowed}`);
    }
    state.imageRequestsAttempted += 1;
    if (state.imageRequestsAttempted > state.budget) {
      state.refused.push(`${bare} (over budget)`);
      throw new Error(`network fence: image request ${state.imageRequestsAttempted} refused — the owner approved exactly ${state.budget}, and there is no reroll`);
    }
    state.imageRequestsSent += 1;
    return inner(input, init);
  };
  return state;
}

/**
 * Refuse to hand back evidence that contains a credential. Walks every text file
 * under the evidence directory for each secret's literal value and for anything
 * shaped like a key query parameter.
 */
export async function assertEvidenceCarriesNoSecrets(dir, secrets) {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const TEXT = /\.(txt|json|md|log)$/i;
  const scanned = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!TEXT.test(entry.name)) continue;
      const text = readFileSync(path, "utf8");
      scanned.push(path);
      for (const secret of secrets) {
        if (secret && text.includes(secret)) throw new Error(`evidence scrub: ${path} contains a credential — refusing to publish it`);
      }
      const m = /[?&]key=[A-Za-z0-9_-]/.exec(text);
      if (m) throw new Error(`evidence scrub: ${path} contains a "key=" query parameter — refusing to publish it`);
    }
  };
  walk(dir);
  return { scannedFiles: scanned.length, secretsChecked: secrets.filter(Boolean).length };
}

/* ────────────────────────────────────────────────────────────────────────────
 * THE TEST-12 RUNNER. Harness only. Not production. ONE image call.
 *
 * The owner-approved boundary, and nothing beyond it:
 *   1. exactly ONE Gemini image call — no reroll on any outcome;
 *   2. the RAW return is hashed and written FIRST, before any transformation;
 *   3. `normalizeAtlasMaster` + `cutCallOnePanels`, the existing production
 *      extractor, on the production six-region topology;
 *   4. STOP. No repair, no fill, no gate retry, no output-class inspection, no
 *      per-file inspection, no proofs, no second draw;
 *   5. report raw master, canonical master, the six crops with dimensions,
 *      orientation, pixel measurements and sha256, and latency.
 *
 * Environment, allowlisted: NOTHING under `--capture-only true`; GEMINI_API_KEY
 * and nothing else for the draw. It reads no database, mints no
 * GenerationID/DesignID/RevisionID, and uploads nothing.
 * ──────────────────────────────────────────────────────────────────────────── */

const SIX_REGION_SURFACE_ORDER = ["driver", "passenger", "hood", "roof", "front", "rear"];

async function runSixRegionDraw() {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fullBleedMetrics } = await import("./atlas-fullbleed-metrics.mjs");

  const args = Object.fromEntries(
    process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
  );
  const OUT = args.out || "./ab-evidence";
  mkdirSync(join(OUT, "panels"), { recursive: true });
  const log = (m) => process.stdout.write(`  ${m}\n`);
  const pct = (v) => `${(v * 100).toFixed(1)}%`;

  if (Number(args.draws ?? 1) !== 1) throw new Error(`six-region: the owner approved exactly ONE draw; --draws ${args.draws} refused`);
  const captureOnly = String(args["capture-only"]).toLowerCase() === "true";
  const variant = String(args.variant || "six-region");
  if (variant !== "six-region" && variant !== "proportions") throw new Error(`unknown --variant ${variant}`);
  const PROPORTIONS = variant === "proportions";
  const LOCK = PROPORTIONS ? APPROVED_SIX_REGION_PROPORTIONS : APPROVED_SIX_REGION;
  const CONTRACT = PROPORTIONS ? SIX_REGION_PROPORTIONS_CONTRACT : SIX_REGION_CONTRACT;
  const TAG = PROPORTIONS ? "six-region-proportions" : "six-region";
  // The ceiling the tail was actually checked against. Test 13's tail is 1602
  // chars, legally, under its own 1700 ceiling; reporting test 12's 1400 here
  // would put a contradiction into machine-verifiable evidence. Receipt only —
  // the guards inside sixRegionContract / sixRegionProportionsContract are
  // unchanged and remain the things that can refuse.
  const ACTIVE_TAIL_CEILING = PROPORTIONS ? SIX_REGION_PROPORTIONS_TAIL_MAX_CHARS : FIELD_TAIL_MAX_CHARS;

  // Requirement, enforced rather than asserted: a capture-only run receives no
  // Gemini credential at all, and refuses to continue if one was handed to it.
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (captureOnly && apiKey) throw new Error("capture-only must receive NO Gemini credential; GEMINI_API_KEY is set — refusing to run");
  if (!captureOnly && !apiKey) throw new Error("the draw needs GEMINI_API_KEY and it is not set");

  const require_ = (await import("node:module")).createRequire(join(process.cwd(), "runtime/"));
  const sharp = require_("sharp");
  const atlas = require_("./flat-first-atlas.cjs");

  const call1Path = args.call1 || "./atlas-call1-build/atlas-call1-prompt.mjs";
  const call1 = await import(new URL(call1Path, `file://${process.cwd()}/`).href);
  const fence = installNetworkFence({ imageModel: call1.AUTHORING_MODEL, budget: 1 });

  const BRIEF = args.brief || "Bold commercial HVAC wrap for Precision Climate Solutions: deep blue base with "
    + "sunrise-orange airflow ribbons sweeping front to rear, clean modern sans-serif "
    + "company name, high contrast and legible at highway distance.";
  const VEHICLE = {
    type: args["vehicle-type"] || PINNED_GENIE.vehicle.type,
    year: args["vehicle-year"] || PINNED_GENIE.vehicle.year,
    make: args["vehicle-make"] || PINNED_GENIE.vehicle.make,
    model: args["vehicle-model"] || PINNED_GENIE.vehicle.model,
  };
  if (JSON.stringify(VEHICLE) !== JSON.stringify(PINNED_GENIE.vehicle)) {
    throw new Error(`six-region: the geometry is pinned to ${JSON.stringify(PINNED_GENIE.vehicle)}; ${JSON.stringify(VEHICLE)} would need a GENIE read this run is not permitted to make`);
  }
  const V3_INPUT = {
    contractVersion: "designpro.calls-1-7-input.v3",
    pipelineMode: "flat-first-atlas-v1",
    vehicle: VEHICLE,
    brief: BRIEF,
    designName: args["design-name"] || "Teaching-proof field A/B",
    mode: "commercial",
    industry: args.industry || "HVAC and climate control",
    colors: (args.colors || "deep blue,sunrise orange").split(",").map((c) => c.trim()),
    style: args.style || "modern commercial",
  };

  // ── 1. the TARGET six-surface topology, rebuilt from the pinned GENIE inches
  //       and cross-checked against run 33659500846 $.legacyZones (which that
  //       run recorded and did not use). Its panels were cut by field-thirds-v2.
  const { manifest, orientation, provenance } = sixRegionManifest(atlas.buildAtlasManifest);
  log(`geometry: GENIE physical dimensions pinned from run ${PINNED_GENIE.sourceRun} ${PINNED_GENIE.dimensionSource.artifact} ${PINNED_GENIE.dimensionSource.jsonPath} (sha ${PINNED_GENIE.dimensionSource.sha256.slice(0, 16)}) — zero database reads`);
  log(`topology: rebuilt now by buildAtlasManifest, cross-checked against ${PINNED_GENIE.legacyZonesSource.jsonPath} of that run — which that run RECORDED and DID NOT USE`);
  log(`for the record, run ${PINNED_GENIE.sourceRun} actually cut its panels with ${PINNED_GENIE.draw1ActualExtractionTerritories.topology}: driver (${PINNED_GENIE.draw1ActualExtractionTerritories.zones.driver.join(', ')})`);
  log(`topology ${manifest.topology} · contract ${manifest.contract} · GENIE ${PINNED_GENIE.genieManifestHash.slice(0, 16)} (${PINNED_GENIE.geometryState})`);
  log(`orientation: passenger ${orientation.passenger} · driver ${orientation.driver} · centre ${orientation.centreTopToBottom.join(" → ")}`);
  for (const z of manifest.zones) {
    log(`    ${z.surfaceKey.padEnd(10)} ${String(z.placement).padEnd(14)} (${z.x}, ${z.y}, ${z.w}, ${z.h})  rot ${z.rotationDegrees}°  ${z.printWidthIn}×${z.printHeightIn} in  ${z.effectivePpi} px/in`);
  }

  // ── 2. the deployed assembly, then the approved six-region prompt ──────────
  //
  // ⛔ HARNESS-ONLY BRANCH SELECTION. Since v24, `atlasEdgeRequestBody` sets
  // `fieldContract` unconditionally (runtime/flat-first-atlas.cjs:1571), which
  // selects the edge's ONE-FIELD branch — the branch RULE 0.34 rejected. The
  // still-deployed six-surface A.T.L.A.S. branch of the same function is
  // selected by the ABSENCE of that field, so test 12 removes it from ITS OWN
  // COPY of the request body. Nothing in production changes: this deletes a key
  // from a local object, and `atlasEdgeRequestBody` itself is untouched.
  //
  // Asserted both ways, so the run refuses rather than drifts: the product path
  // must still be setting the field, and it must be gone before assembly.
  const edgeBody = atlas._test.atlasEdgeRequestBody(V3_INPUT, manifest, {});
  if (edgeBody.fieldContract !== FIELD_CONTRACT_V2) {
    throw new Error(`six-region: expected the product path to set fieldContract ${JSON.stringify(FIELD_CONTRACT_V2)}, found ${JSON.stringify(edgeBody.fieldContract ?? null)} — the branch this test selects is no longer the one it was written against`);
  }
  const { fieldContract: removedFieldContract, ...sixSurfaceBody } = edgeBody;
  if ("fieldContract" in sixSurfaceBody) throw new Error("six-region: fieldContract survived removal; the one-field branch would be selected");
  const branchSelection = {
    productPathSet: removedFieldContract,
    removedForThisTest: true,
    selects: "the deployed six-surface A.T.L.A.S. branch of design-panel-ai-generate",
    scope: "harness only — a key deleted from a local copy of the request body; atlasEdgeRequestBody is unchanged",
  };
  log(`branch selection: the product path set fieldContract ${removedFieldContract}; removed from this test's own copy to select the six-surface branch (harness only)`);
  const assembled = call1.buildAtlasCall1Prompt(sixSurfaceBody);
  if (assembled.references.length) throw new Error("this fixture must carry no customer references");
  const field = PROPORTIONS ? buildSixRegionProportionsPromptV2(assembled.prompt, manifest) : buildSixRegionPromptV2(assembled.prompt);
  const { parts, request, serialize } = buildFieldRequestV2({ prompt: field.prompt, referenceParts: [], model: call1.AUTHORING_MODEL });
  const preflight = assertApprovedSixRegionRequest({ deployedPrompt: assembled.prompt, field, request, serialize, parts, lock: LOCK });
  log("");
  log(`PREFLIGHT ${preflight.verdict} (${CONTRACT})`);
  if (PROPORTIONS) log(`    parent (test 12)  sha ${field.parentPromptSha256.slice(0, 16)}  ${field.parentPromptChars} chars — reproduced by removing the ${LOCK.insertionChars}-char insertion at offset ${LOCK.insertionOffset}`);
  log(`    deployed prompt   sha ${sha(assembled.prompt).slice(0, 16)}  ${assembled.prompt.length} chars`);
  log(`    creative assembly ${field.creative.length} → ${field.creativeField.length} chars, ${field.swaps.length} swaps, reverse proof ${field.reverseProof}`);
  log(`    tail              sha ${field.tailSha256.slice(0, 16)}  ${field.fieldTail.length} chars (ceiling ${ACTIVE_TAIL_CEILING})`);
  log(`    prompt            sha ${field.promptSha256}  ${field.prompt.length} chars`);
  log(`    request           ${request.partCount} text part, ${request.modelInputImageCount} images, ${request.modelRequestByteSize} bytes, model ${request.model}, ${JSON.stringify(GENERATION_CONFIG)}, no temperature`);

  const parity = {
    contract: CONTRACT,
    label: PROPORTIONS ? "TEST 13 — test 12 plus normalized GENIE-derived proportions" : "TEST 12 — six-region topology text (owner-approved candidate)",
    honestClassification: "topology-text experiment, same family as Test 3; the untested cell is zero images + zero surface names + the extent sentence + a positional description",
    deployedPrompt: { sha256: sha(assembled.prompt), chars: assembled.prompt.length },
    creativeAssembly: { deployedChars: field.creative.length, deployedSha256: field.creativeSha256, fieldChars: field.creativeField.length, fieldSha256: field.creativeFieldSha256, swaps: field.swaps, reverseProof: field.reverseProof },
    tail: { deployedChars: field.deployedTail.length, deployedSha256: sha(field.deployedTail), sixRegionChars: field.fieldTail.length, sixRegionSha256: field.tailSha256, ceiling: ACTIVE_TAIL_CEILING },
    approvedLock: LOCK,
    branchSelection,
    pinnedGeometry: PINNED_GENIE,
    geometryProvenance: provenance,
    preflight,
    orientation,
    request,
  };
  const writeEvidence = (name, body) => writeFileSync(join(OUT, name), body);
  writeEvidence("parity.json", JSON.stringify(parity, null, 2));
  writeEvidence("prompt-deployed.txt", assembled.prompt);
  writeEvidence(`prompt-${TAG}.txt`, field.prompt);
  writeEvidence("creative-deployed.txt", field.creative);
  writeEvidence(`creative-${TAG}.txt`, field.creativeField);
  writeEvidence("tail-deployed.txt", field.deployedTail);
  writeEvidence(`tail-${TAG}.txt`, field.fieldTail);
  writeEvidence("swaps.json", JSON.stringify(field.swaps, null, 2));
  writeEvidence("requests.json", JSON.stringify({ vehicle: VEHICLE, brief: BRIEF, request, body: serialize(parts) }, null, 2));

  const scrub = async () => {
    const receipt = await assertEvidenceCarriesNoSecrets(OUT, [apiKey]);
    log(`evidence scrub: ${receipt.scannedFiles} text file(s) scanned, ${receipt.secretsChecked} credential value(s) checked, none present`);
    return receipt;
  };

  if (captureOnly) {
    writeEvidence("results.json", JSON.stringify({
      contract: CONTRACT, captureOnly: true, imageRequestsExecuted: 0,
      geminiCredentialPresent: false, databaseReads: 0, databaseWrites: 0, parity, request,
    }, null, 2));
    const scrubReceipt = await scrub();
    log("");
    log(`capture-only: request and preflight written; ZERO image calls, ZERO credentials, ZERO database access (scrub: ${scrubReceipt.scannedFiles} files clean)`);
    return;
  }

  // ── 3. exactly ONE image call ─────────────────────────────────────────────
  log("");
  log(`DRAW 1: calling ${call1.AUTHORING_MODEL} (1 text part, 0 images, ${request.modelRequestByteSize} bytes) …`);
  const started = Date.now();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${call1.AUTHORING_MODEL}:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: serialize(parts), signal: AbortSignal.timeout(300_000) },
  );
  const elapsedMs = Date.now() - started;
  if (!response.ok) throw new Error(`draw 1 HTTP ${response.status} — no retry, no reroll`);
  const payload = await response.json();
  const candidateParts = payload?.candidates?.[0]?.content?.parts || [];
  const image = candidateParts.find((p) => p?.inlineData?.data);
  const textOut = candidateParts.filter((p) => typeof p?.text === "string").map((p) => p.text).join("\n");
  if (!image) throw new Error(`draw 1 returned no image (${payload?.candidates?.[0]?.finishReason || "unknown"}) — no retry, no reroll`);

  // ── 4. the RAW bytes, written and hashed before anything touches them ─────
  const rawBytes = Buffer.from(image.inlineData.data, "base64");
  const rawSha = sha(rawBytes);
  writeFileSync(join(OUT, `draw1-${TAG}-raw.png`), rawBytes);
  writeEvidence("draw1-design-text.txt", textOut.slice(0, 4000));
  const rawMeta = await sharp(rawBytes, { limitInputPixels: false }).metadata();
  log(`draw 1: ${(rawBytes.length / 1024).toFixed(0)}KB, ${rawMeta.width}×${rawMeta.height}, in ${(elapsedMs / 1000).toFixed(1)}s — RAW written FIRST, sha ${rawSha.slice(0, 16)}`);
  log(`network fence: ${fence.imageRequestsSent} request sent of budget ${fence.budget}; ${fence.refused.length} refused; the only reachable URL is ${fence.allowed}`);

  // ── 5. deterministic canonicalization — the production path, unchanged ────
  const normalized = await atlas.normalizeAtlasMaster(rawBytes, manifest);
  const masterBytes = normalized.bytes;
  const masterHash = sha(masterBytes);
  writeFileSync(join(OUT, `draw1-${TAG}-master-masked.png`), masterBytes);
  const unmasked = await sharp(rawBytes, { limitInputPixels: false }).rotate()
    .resize(manifest.canvas.widthPx, manifest.canvas.heightPx, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha().png({ compressionLevel: 6 }).toBuffer();
  writeFileSync(join(OUT, `draw1-${TAG}-unmasked-4096.png`), unmasked);
  log(`canonical master: delivered ${normalized.deliveredWidthPx}×${normalized.deliveredHeightPx}, nativelyFourK=${normalized.nativelyFourK}, sha ${masterHash.slice(0, 16)}`);

  // ── 6. pixel measurements (colour-blind, telemetry, no gate) ──────────────
  const bleedMetrics = await fullBleedMetrics(masterBytes, manifest);
  const trimMetrics = await fullBleedMetrics(masterBytes, { zones: manifest.zones.map((z) => ({ surfaceKey: z.surfaceKey, rect: z.trim })) });
  const wholeField = await fullBleedMetrics(unmasked, { zones: [{ surfaceKey: "field", x: 0, y: 0, w: manifest.canvas.widthPx, h: manifest.canvas.heightPx }] });
  const wf = wholeField.zones.field;
  log(`pixel measurements (telemetry only): bleed rects ${bleedMetrics.fullBleedCompliantCount}/6 · trim rects ${trimMetrics.fullBleedCompliantCount}/6 · whole field nonArtwork ${pct(wf.nonArtworkRatio)}, border ${pct(wf.borderArtworkRatio)}`);
  for (const key of SIX_REGION_SURFACE_ORDER) {
    const b = bleedMetrics.zones[key]; const t = trimMetrics.zones[key];
    log(`    ${key.padEnd(10)} bleed ${b.fullBleedCompliant ? "OK " : "NO "} nonArt ${pct(b.nonArtworkRatio).padStart(6)} border ${pct(b.borderArtworkRatio).padStart(6)}   trim ${t.fullBleedCompliant ? "OK " : "NO "} nonArt ${pct(t.nonArtworkRatio).padStart(6)} border ${pct(t.borderArtworkRatio).padStart(6)}`);
  }

  // ── 7. the six crops, cut by the REAL production extractor ────────────────
  const panels = [];
  await atlas.cutCallOnePanels(masterBytes, manifest, masterHash, {
    onPanel: async (panel) => {
      writeFileSync(join(OUT, "panels", `panel-${panel.surfaceKey}.png`), panel.bytes);
      panels.push(panel);
      log(`    cut ${panel.surfaceKey.padEnd(10)} ${panel.pixelWidth}×${panel.pixelHeight}px  ${panel.printWidthIn}×${panel.printHeightIn}in print  ${panel.effectivePpi} px/in  ${panel.contentHash.slice(0, 16)}`);
    },
  });
  const hashes = new Set(panels.map((p) => p.contentHash));
  if (panels.length !== 6 || hashes.size !== 6) throw new Error(`expected six distinct canonical files, got ${panels.length} / ${hashes.size} distinct`);
  const Z = (k) => manifest.zones.find((q) => q.surfaceKey === k);
  const panelRecords = panels.map((p) => ({
    surfaceKey: p.surfaceKey, contentHash: p.contentHash, byteSize: p.byteSize,
    pixelWidth: p.pixelWidth, pixelHeight: p.pixelHeight,
    placement: Z(p.surfaceKey).placement,
    zoneRotationDegrees: Z(p.surfaceKey).rotationDegrees,
    extractionOutputRotationDegrees: Z(p.surfaceKey).extraction?.outputRotationDegrees ?? null,
    trimWidthIn: p.trimWidthIn, trimHeightIn: p.trimHeightIn, printWidthIn: p.printWidthIn, printHeightIn: p.printHeightIn,
    bleedInches: p.bleedInches, effectivePpiNative: p.effectivePpi,
    sourceMasterHash: p.sourceMasterHash, sourceMasterHashIsCanonical: p.sourceMasterHash === masterHash,
    method: p.method, deterministic: p.deterministic,
    bleedNonArtworkRatio: bleedMetrics.zones[p.surfaceKey].nonArtworkRatio,
    trimNonArtworkRatio: trimMetrics.zones[p.surfaceKey].nonArtworkRatio,
  }));
  writeEvidence("panels.json", JSON.stringify(panelRecords, null, 2));

  // ── 8. contact sheet for the owner's eye (sharp only, zero AI) ────────────
  const S = 2048;
  const f = S / manifest.canvas.widthPx;
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${manifest.zones.map((z) => `
    <rect x="${z.x * f}" y="${z.y * f}" width="${z.w * f}" height="${z.h * f}" fill="none" stroke="#00e5ff" stroke-width="3"/>
    <rect x="${z.trim.x * f}" y="${z.trim.y * f}" width="${z.trim.w * f}" height="${z.trim.h * f}" fill="none" stroke="#ffd400" stroke-width="2" stroke-dasharray="10 8"/>
    <text x="${z.x * f + 10}" y="${z.y * f + 30}" font-family="sans-serif" font-size="26" font-weight="700" fill="#00e5ff" stroke="#000" stroke-width="1">${z.surfaceKey.toUpperCase()} ${z.printWidthIn}×${z.printHeightIn}in</text>`).join("")}</svg>`);
  const byKey = new Map(panels.map((p) => [p.surfaceKey, p]));
  const rowH = 300;
  const stack = [["driver", S], ["passenger", S]].map(([k, w]) => [byKey.get(k), Math.round(w * byKey.get(k).pixelHeight / byKey.get(k).pixelWidth)]);
  const total = S + 40 * 4 + stack.reduce((a, [, h]) => a + h, 0) + rowH + 12 * 5;
  const composites = [{ input: await sharp(unmasked, { limitInputPixels: false }).resize(S, S).composite([{ input: overlay }]).png().toBuffer(), left: 0, top: 0 }];
  const captions = [];
  let y = S + 12;
  const cap = (t) => { captions.push(`<text x="12" y="${y + 28}" font-family="monospace" font-size="22" fill="#fff">${t}</text>`); y += 40; };
  cap(`SIX-REGION ${manifest.topology} · cyan = territory · yellow dashed = trim · the model never saw this overlay`);
  for (const [p, h] of stack) {
    cap(`${p.surfaceKey.toUpperCase()} ${p.pixelWidth}×${p.pixelHeight}px · ${p.printWidthIn}×${p.printHeightIn}in · ${p.contentHash.slice(0, 16)}`);
    composites.push({ input: await sharp(p.bytes).resize(S, h).png().toBuffer(), left: 0, top: y });
    y += h + 12;
  }
  const centre = ["rear", "roof", "hood", "front"].map((k) => byKey.get(k));
  cap(centre.map((p) => `${p.surfaceKey.toUpperCase()} ${p.contentHash.slice(0, 12)}`).join("   ·   "));
  let x = 0;
  for (const p of centre) {
    const w = Math.min(Math.round(rowH * p.pixelWidth / p.pixelHeight), S - x);
    if (w < 8) break;
    composites.push({ input: await sharp(p.bytes).resize(w, rowH).png().toBuffer(), left: x, top: y });
    x += w + 12;
  }
  await sharp({ create: { width: S, height: total, channels: 3, background: "#101010" } })
    .composite([...composites, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${total}">${captions.join("")}</svg>`), left: 0, top: 0 }])
    .png({ compressionLevel: 6 }).toFile(join(OUT, "contact-sheet.png"));

  // ── 9. receipts and report. No verdict is issued here. ────────────────────
  const results = {
    contract: CONTRACT,
    ranAt: new Date().toISOString(),
    imageRequestsExecuted: fence.imageRequestsSent,
    imageRequestBudget: fence.budget,
    networkRequestsRefusedByFence: fence.refused,
    onlyReachableUrl: fence.allowed,
    databaseReads: 0,
    databaseWrites: 0,
    outputClassInspections: 0,
    perFileInspections: 0,
    vehicle: VEHICLE,
    brief: BRIEF,
    model: call1.AUTHORING_MODEL,
    topology: manifest.topology,
    manifestContract: manifest.contract,
    genieManifestHash: PINNED_GENIE.genieManifestHash,
    geometryProvenance: provenance,
    orientation,
    parity,
    draw: {
      elapsedMs, rawSha256: rawSha, rawByteSize: rawBytes.length, rawWidthPx: rawMeta.width, rawHeightPx: rawMeta.height,
      httpStatus: response.status, finishReason: payload?.candidates?.[0]?.finishReason ?? null,
      deliveredWidthPx: normalized.deliveredWidthPx, deliveredHeightPx: normalized.deliveredHeightPx, nativelyFourK: normalized.nativelyFourK,
      canonicalMasterSha256: masterHash, rawVsCanonicalHashesDiffer: rawSha !== masterHash,
      normalization: "resize to 4096x4096 (fit: fill, lanczos3) + ensureAlpha + zone mask (dest-in) + PNG re-encode; artwork pixels inside the territories are not repainted",
      designText: textOut.slice(0, 2000),
    },
    pixelMeasurements: { bleedRects: bleedMetrics, trimRects: trimMetrics, wholeField },
    panels: panelRecords,
    stoppedAfter: "six crops — no repair, no fill, no gate retry, no output-class inspection, no proofs, no second draw",
    ownerJudgementRequired: [
      "A.T.L.A.S. TOPOLOGY — passenger left column, driver right column, REAR/ROOF/HOOD/FRONT stacked centre",
      "ANATOMY-FREE — no wheel arch, window, seam, contour or silhouette anywhere in the six files",
      "FULL BLEED — every file's artwork reaches all four of its own edges",
      "INTENTIONAL COMPOSITION — hood, roof, front and rear are composed, not wallpaper",
      "NO RENDERED LABELS — no heading, legend, frame, border or gutter printed into the artwork",
    ],
  };
  writeEvidence("results.json", JSON.stringify(results, null, 2));

  const P = (k) => panelRecords.find((q) => q.surfaceKey === k);
  writeEvidence("REPORT.md", [
    PROPORTIONS ? "# Test 13 — six-region topology text + GENIE proportions, Draw 1" : "# Test 12 — six-region topology text, Draw 1",
    "",
    "Harness only. ONE Gemini image call, ZERO inspections, ZERO database access. No repair, no fill, no gate, no second draw. **Green is not a pass** — every number here is telemetry and the verdict is the owner's, on the images.",
    "",
    "This is a **topology-text experiment**, the same family as Test 3 (which was null). It is not a prediction.",
    "",
    "## 1. Untouched raw master",
    "",
    `\`draw1-${TAG}-raw.png\` — exactly what Gemini returned, written and hashed before any transformation. sha256 \`${rawSha}\`, ${rawBytes.length} B, ${rawMeta.width}×${rawMeta.height}.`,
    "",
    "## 2. Request / provider receipt",
    "",
    "| | |", "|---|---|",
    `| prompt sha256 | \`${field.promptSha256}\` |`,
    `| prompt chars | ${field.prompt.length} |`,
    `| request bytes | ${request.modelRequestByteSize} |`,
    `| parts | ${request.partCount} text, ${request.modelInputImageCount} image |`,
    `| model | \`${request.model}\` |`,
    `| generationConfig | \`${JSON.stringify(GENERATION_CONFIG)}\` |`,
    `| temperature | absent |`,
    `| HTTP | ${response.status} |`,
    `| finishReason | ${payload?.candidates?.[0]?.finishReason ?? "—"} |`,
    `| latency | ${(elapsedMs / 1000).toFixed(1)} s |`,
    `| image requests sent | **${fence.imageRequestsSent}** of budget ${fence.budget} |`,
    `| other network requests | ${fence.refused.length} attempted, all refused by the fence |`,
    `| database reads / writes | 0 / 0 |`,
    `| branch selection | product path set \`${branchSelection.productPathSet}\`; removed from this test's own copy of the body to select ${branchSelection.selects}. ${branchSelection.scope} |`,
    "",
    "## 3. Deterministic flattened A.T.L.A.S. master",
    "",
    `\`draw1-${TAG}-master-masked.png\` sha256 \`${masterHash}\`. Raw and canonical hashes differ: **${rawSha !== masterHash}**. Normalization = ${results.draw.normalization}. Topology \`${manifest.topology}\`, manifest contract \`${manifest.contract}\`, GENIE \`${PINNED_GENIE.genieManifestHash}\`.`,
    "",
    "### Geometry provenance — three different objects, kept apart",
    "",
    "| object | source | role here |",
    "|---|---|---|",
    `| GENIE physical-dimension authority | run ${PINNED_GENIE.sourceRun} \`${PINNED_GENIE.dimensionSource.artifact}\` \`${PINNED_GENIE.dimensionSource.jsonPath}\`, sha256 \`${PINNED_GENIE.dimensionSource.sha256.slice(0, 16)}\` | the pinned INPUT; topology-independent |`,
    `| six-surface \`buildAtlasManifest\` topology | rebuilt here now, cross-checked against \`${PINNED_GENIE.legacyZonesSource.jsonPath}\` of that run | the TARGET architecture (RULE 0.34). That run recorded these rectangles and **cut nothing from them** |`,
    `| \`${PINNED_GENIE.draw1ActualExtractionTerritories.topology}\` extraction manifest | that run's \`${PINNED_GENIE.draw1ActualExtractionTerritories.jsonPath}\` — driver (${PINNED_GENIE.draw1ActualExtractionTerritories.zones.driver.join(", ")}), passenger (${PINNED_GENIE.draw1ActualExtractionTerritories.zones.passenger.join(", ")}), four smaller areas from y=2730 | what ACTUALLY cut that run's six panels. **Not used here, and not the source of the tall columns above.** |`,
    "",
    "## 4. The six crops",
    "",
    "| surface | placement | zone rot | extract rot | territory (x, y, w, h) | file px | print in | native px/in | sha256 | sourceMasterHash = canonical |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...SIX_REGION_SURFACE_ORDER.map((k) => `| ${k} | ${P(k).placement} | ${P(k).zoneRotationDegrees}° | ${P(k).extractionOutputRotationDegrees}° | (${Z(k).x}, ${Z(k).y}, ${Z(k).w}, ${Z(k).h}) | ${P(k).pixelWidth}×${P(k).pixelHeight} | ${P(k).printWidthIn}×${P(k).printHeightIn} | ${P(k).effectivePpiNative} | \`${P(k).contentHash.slice(0, 16)}\` | ${P(k).sourceMasterHashIsCanonical} |`),
    "",
    `Six distinct files: ${hashes.size === 6} · Driver ≠ Passenger bytes: ${P("driver").contentHash !== P("passenger").contentHash} · method \`${panelRecords[0].method}\`, deterministic ${panelRecords.every((p) => p.deterministic)}.`,
    "",
    "## 5. Pixel measurements (colour-blind, telemetry)",
    "",
    `Whole field: nonArtwork ${pct(wf.nonArtworkRatio)}, border artwork ${pct(wf.borderArtworkRatio)}, edge-reachable field ${pct(wf.edgeReachableFieldRatio)}. A smooth painted ground reads as non-artwork to this instrument; it cannot see a wheel arch, a rendered label or a frame. The owner's eye decides.`,
    "",
    "| surface | bleed nonArt | bleed border | bleed OK | trim nonArt | trim border | trim OK |",
    "|---|---|---|---|---|---|---|",
    ...SIX_REGION_SURFACE_ORDER.map((k) => { const b = bleedMetrics.zones[k]; const t = trimMetrics.zones[k]; return `| ${k} | ${pct(b.nonArtworkRatio)} | ${pct(b.borderArtworkRatio)} | ${b.fullBleedCompliant ? "yes" : "no"} | ${pct(t.nonArtworkRatio)} | ${pct(t.borderArtworkRatio)} | ${t.fullBleedCompliant ? "yes" : "no"} |`; }),
    "",
    "## 6. Visual defect assessment — the owner's, not the harness's",
    "",
    "Open `contact-sheet.png`, then the six files in `panels/`. Judge:",
    "",
    ...results.ownerJudgementRequired.map((q) => `- ${q}`),
    "",
    "## STOP",
    "",
    `Stopped after ${results.stoppedAfter}. No GenerationID, DesignID or RevisionID was minted; no database row was read or written; nothing was uploaded.`,
    "",
  ].join("\n"));

  await scrub();
  log("");
  log(`draw 1 written; results.json, REPORT.md, parity.json, contact-sheet.png and panels/ in ${OUT}`);
  log("STOP — no repair, no proofs, no second draw.");
}

/**
 * The only place a credential could reach stdout is an error message that
 * happened to quote the request URL, so redact before printing rather than
 * hoping no error ever does.
 */
export function redactCredentials(text) {
  const key = String(process.env.GEMINI_API_KEY || "").trim();
  let out = String(text ?? "");
  if (key) out = out.split(key).join("[REDACTED]");
  return out.replace(/([?&]key=)[A-Za-z0-9_-]+/g, "$1[REDACTED]");
}

if (process.argv[1] && process.argv[1].endsWith("atlas-field-contract-v2.mjs")) {
  runSixRegionDraw().catch((error) => {
    console.error(`\nFAILED: ${redactCredentials(error?.message || error)}`);
    process.exitCode = 1;
  });
}
