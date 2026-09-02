// ANCHOR RESTORATION HARNESS v2 — LOCKS. One draw, harness only, option A,
// object-schema cleanup.
//
// These convict, without a provider call, every way the harness could quietly
// stop being what the owner approved: a seventh swap or a swap that is not
// exactly-once, the creative assembly changing by anything other than the six
// swaps (the reverse proof), the object definition landing after the first
// design-space instruction, a panel / body-object word surviving before the
// placement tail, an anatomy or negative word entering the added text, the
// centre-order phrase disagreeing with the order the guide is drawn from, a
// part of the deployed five-part request moving or being substituted, and the
// pinned deployed shas drifting from the captured deployed request.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ANCHOR_CONTRACT,
  CREATIVE_OBJECT_SWAPS,
  EXPECTED_ANCHOR_PROMPT_CHARS_F250,
  EXPECTED_ANCHOR_PROMPT_SHA256_PREFIX_F250,
  EXPECTED_SWAPPED_CREATIVE_CHARS_F250,
  EXPECTED_SWAPPED_CREATIVE_SHA256_PREFIX_F250,
  FORBIDDEN_IN_ADDED_TEXT,
  FORBIDDEN_OBJECT_WORDS,
  NO_CAPTIONS_SENTENCE,
  applyCreativeObjectSwaps,
  assertNoObjectWords,
  buildAnchorPrompt,
  buildAnchorRequest,
  centerOrderPhrase,
  objectDefinitionBlock,
  placementTail,
  reverseCreativeObjectSwaps,
} from "../scripts/atlas-anchor-contract.mjs";

const require = createRequire(import.meta.url);
const atlas = require("../runtime/flat-first-atlas.cjs");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");

// The deployed prompt, captured off the harness on run 33595250518 and pinned
// by sha against the deployed edge (4,587 chars).
const DEPLOYED_PROMPT = readFileSync(new URL("../docs/ab/object-model-33595250518-prompt-A.txt", import.meta.url), "utf8");
// The deployed five-part request, captured on run 33597621527 (arm A).
const DEPLOYED_REQUEST = JSON.parse(readFileSync(new URL("../docs/ab/teaching-proof-absent-33597621527-requests.json", import.meta.url), "utf8")).requests.A;
const TEACHING_PROOF = readFileSync(new URL("../runtime/atlas-examples/flamingo-labeled-atlas-teaching-proof.png", import.meta.url));
const build = () => buildAnchorPrompt(DEPLOYED_PROMPT, { centerOrder: atlas.CENTER_ORDER });

test("the deployed-prompt fixture is the one the edge sends", () => {
  assert.equal(DEPLOYED_PROMPT.length, 4587);
  assert.equal(sha256(DEPLOYED_PROMPT), "dcb73e9eae229cd88af6bcdb4a3874e1050b266fa98a55b79fee65d0b7e610b2");
  assert.equal(ANCHOR_CONTRACT, "designpro.atlas-anchor-restoration.v2");
});

test("production CENTER_ORDER is the known-good order and the placement phrase follows it", () => {
  assert.deepEqual([...atlas.CENTER_ORDER], ["rear", "roof", "hood", "front"]);
  assert.equal(centerOrderPhrase(atlas.CENTER_ORDER), "rear, roof, hood and front");
  assert.throws(() => centerOrderPhrase(["rear", "roof", "hood"]), /four centre surfaces/);
  assert.throws(() => centerOrderPhrase(["rear", "roof", "hood", "driver"]), /not a permutation/);
  assert.ok(placementTail(atlas.CENTER_ORDER).includes("(rear, roof, hood and front, stacked top to bottom in the centre)"));
});

test("exactly six exact-match swaps, each applied once, and the reverse proof reproduces the deployed creative byte for byte", () => {
  assert.equal(CREATIVE_OBJECT_SWAPS.length, 6);
  const r = build();
  assert.equal(r.creative.length, 2622);
  assert.ok(r.creativeSha256.startsWith("7e011c6c20b5fa29"));
  assert.equal(r.swappedCreative.length, EXPECTED_SWAPPED_CREATIVE_CHARS_F250);
  assert.ok(r.swappedCreativeSha256.startsWith(EXPECTED_SWAPPED_CREATIVE_SHA256_PREFIX_F250), r.swappedCreativeSha256.slice(0, 16));
  assert.equal(r.reverseProof, true);
  assert.equal(reverseCreativeObjectSwaps(r.swappedCreative), r.creative);
  for (const [from, to] of CREATIVE_OBJECT_SWAPS) {
    assert.equal(r.creative.split(from).length, 2, `deployed creative must carry "${from}" exactly once`);
    assert.ok(!r.swappedCreative.includes(from), `"${from}" survived the swap`);
    assert.ok(r.swappedCreative.includes(to), `"${to}" missing after the swap`);
  }
  // a creative that lacks one phrase, or carries it twice, is refused
  assert.throws(() => applyCreativeObjectSwaps(r.creative.replace("bare panel", "bare metal")), /is not in the text/);
  assert.throws(() => applyCreativeObjectSwaps(`${r.creative}\nflat orthographic panels of pure printed vinyl artwork`), /more than once/);
});

test("the six swaps are the owner-approved replacements, word for word", () => {
  const pairs = CREATIVE_OBJECT_SWAPS.map(([from, to]) => `${from} => ${to}`);
  assert.deepEqual(pairs, [
    "flat orthographic panels of pure printed vinyl artwork => the flattened A.T.L.A.S. design topology of pure printed vinyl artwork",
    "background color and texture flowing across the panels => background color and texture flowing continuously across the flattened A.T.L.A.S. design topology",
    "rather than flat shapes on bare panel => rather than flat shapes on bare vinyl",
    "The vinyl finish is gloss across every panel — consistent finish on every surface. => The vinyl finish is gloss across the whole flattened A.T.L.A.S. design topology — one consistent finish throughout.",
    "The artwork fills every rectangle edge to edge — solid printed vinyl, corner to corner. => The artwork fills every topology region edge to edge — solid printed vinyl, corner to corner.",
    "angular faceted panels with sharp swept edges => angular faceted plates with sharp swept edges",
  ]);
});

test("the prompt is persona · object definition · swapped creative · placement, pinned on the F250 fixture", () => {
  const r = build();
  assert.equal(r.prompt, r.persona + r.objectBlock + r.creativeBody + r.placement);
  assert.equal(r.prompt.length, EXPECTED_ANCHOR_PROMPT_CHARS_F250);
  assert.ok(sha256(r.prompt).startsWith(EXPECTED_ANCHOR_PROMPT_SHA256_PREFIX_F250), `prompt sha ${sha256(r.prompt).slice(0, 16)}`);
  assert.ok(r.persona.startsWith("You are the senior vehicle-wrap designer at a sign and wrap company"));
  assert.equal(r.objectBlock, objectDefinitionBlock("2022 Ford F250 Crew Cab", "truck"));
  assert.ok(r.objectBlock.startsWith("A.T.L.A.S. — DesignProAI’s canonical flattened design topology, on one square 4K canvas.\n"));
  assert.ok(r.objectBlock.includes("For the vehicle-design embodiment, A.T.L.A.S. represents a top-view vehicle-wrap design as a flattened 2D topology: conceptually, the printable exterior skin of the completely wrapped 3D vehicle is pressed flat from above and unfolded into one dimensionally governed design space. Here that vehicle is this exact 2022 Ford F250 Crew Cab (truck)."));
  assert.ok(r.objectBlock.includes("Create one cohesive professional vehicle-wrap design across this flattened topology. Every defined topology region is printable artwork and must be filled completely edge-to-edge with intentional finished design. The complete flattened topology represents one coordinated vehicle-wrap design."));
  assert.ok(r.creativeBody.startsWith("Design the printed wrap artwork for a 2022 Ford F250 Crew Cab (truck) as ONE FLAT print-production master — the flattened A.T.L.A.S. design topology of pure printed vinyl artwork, never an on-vehicle photograph."));
  assert.ok(r.placement.includes("all subdivisions of the same one flattened printable skin"));
  assert.ok(r.placement.includes("Driver and Passenger are coordinated but independently composed; they are not mirrored artwork."));
  assert.ok(r.placement.includes(NO_CAPTIONS_SENTENCE));
  assert.ok(r.prompt.endsWith("Gallery-grade custom artwork with real depth, movement and a wow factor, drawn straight-on and flat for printing."));
  assert.ok(!r.prompt.includes("OUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD"));
  assert.ok(!r.prompt.includes("• "));
  assert.ok(!/do not reinterpret/i.test(r.prompt));
});

test("ordering: the object definition precedes the first design-space instruction and the first region", () => {
  const r = build();
  const object = r.prompt.indexOf("design space");
  assert.ok(object > r.prompt.indexOf("worth what the customer paid"), "the persona comes first");
  assert.ok(object < r.prompt.indexOf("Design the printed wrap artwork for"));
  assert.ok(object < r.prompt.search(/\bregion/i));
});

test("no panel / body-object word survives before the placement tail; the added text carries no anatomy or negative", () => {
  const r = build();
  const beforeTail = r.persona + r.objectBlock + r.creativeBody;
  assert.doesNotThrow(() => assertNoObjectWords(beforeTail, "x"));
  assert.equal(beforeTail.match(/\b(panel|panels|artboard|orthographic|body|rectangle|rectangles|sheet|template|mockup|silhouette)\b/gi), null);
  for (const { word } of FORBIDDEN_OBJECT_WORDS) {
    assert.throws(() => assertNoObjectWords(`${beforeTail}\n${word} appears here`, "x"), new RegExp(`forbidden object framing "${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `guard did not convict "${word}"`);
  }
  for (const { word } of FORBIDDEN_IN_ADDED_TEXT) {
    assert.throws(() => assertNoObjectWords(`${r.objectBlock}\n${word} appears here`, "x", FORBIDDEN_IN_ADDED_TEXT), /forbidden object framing/, `added-text guard did not convict "${word}"`);
  }
  // "sheet" survives only inside the carried-across no-captions sentence
  assert.equal(r.prompt.match(/\bsheet\b/g).length, 1);
  assert.ok(r.placement.replace(NO_CAPTIONS_SENTENCE, "").search(/\bsheet\b/) < 0);
  // the creative's own wording that is NOT object schema is untouched
  assert.ok(beforeTail.includes("render it with rich photographic realism"));
  assert.ok(beforeTail.includes("invent no website, email address or street address"));
});

test("every non-object creative instruction survives byte for byte", () => {
  const r = build();
  for (const literal of [
    "You are the senior vehicle-wrap designer at a sign and wrap company — 20 years of $5,000-per-vehicle commercial fleet graphics, printed on vinyl and installed on real trucks and vans. You amplify each brief into an original design built for this one business — premium, readable at a glance from across a parking lot, and worth what the customer paid.",
    "never an on-vehicle photograph. This is the single design authority for the complete vehicle, not six independent graphics.",
    "mid-ground graphic motion, and foreground accent detail — with real dimension",
    "The company name reads clearly at a glance; how the branding is composed is your creative call.",
    "THE CONCEPT — the heart of this design; build everything around it:",
    "Translate anything the brief names into concrete design — color story, layout, graphic motifs, focal treatment",
    "CLIENT BRIEF:",
    "This business needs its own logo — decide its form from this brief alone.",
    "No phone number was provided — show the company name only and add no contact information.",
    "No website was supplied — invent no website, email address or street address, and display none anywhere on the design.",
    "Industry: HVAC and climate control",
    "When the brief names a real subject (a home, building, product, landscape, or scene), render it with rich photographic realism",
    "Finish: GLOSS — wet-look surface, mirror-sharp specular highlights, deep saturated color, visible reflections in the printed graphic elements.",
    "solid printed vinyl, corner to corner.",
  ]) assert.ok(r.prompt.includes(literal), `creative instruction missing: ${literal.slice(0, 60)}`);
});

test("the pinned deployed shas in the recovery script match the captured deployed request", () => {
  const source = readFileSync(new URL("../scripts/atlas-anchor-recovery.mjs", import.meta.url), "utf8");
  const pin = (key) => new RegExp(`${key}: "([a-f0-9]{64})"`).exec(source)?.[1];
  assert.equal(pin("promptSha256"), DEPLOYED_REQUEST.parts[0].sha256);
  assert.equal(pin("teachingText"), DEPLOYED_REQUEST.parts[1].sha256);
  assert.equal(pin("teachingImage"), DEPLOYED_REQUEST.parts[2].sha256);
  assert.equal(pin("guideText"), DEPLOYED_REQUEST.parts[3].sha256);
  assert.equal(pin("guideImage"), DEPLOYED_REQUEST.parts[4].sha256);
  assert.equal(DEPLOYED_REQUEST.partCount, 5);
  assert.equal(DEPLOYED_REQUEST.modelInputImageCount, 2);
  assert.ok(source.includes("modelRequestByteSize: 4762109"));
  assert.equal(sha256(TEACHING_PROOF), DEPLOYED_REQUEST.parts[2].sha256, "the bundled teaching proof is the owner's bytes");
  assert.ok(source.includes("if (DRAWS !== 1) throw new Error"));
  assert.ok(source.includes("EXPECTED_ANCHOR_PROMPT_SHA256_PREFIX_F250"));
  assert.ok(source.includes("reverseProof"));
});

test("the anchor request is the deployed five-part shape with every other part pinned", () => {
  const teachingText = "LABELED A.T.L.A.S. TEACHING REFERENCE. placeholder";
  const guideText = "CURRENT TARGET GUIDE — placeholder";
  const guideBytes = Buffer.from("guide-png-bytes");
  const expected = { teachingText: sha256(teachingText), teachingImage: sha256(TEACHING_PROOF), guideText: sha256(guideText), guideImage: sha256(guideBytes) };
  const { request, parts } = buildAnchorRequest({
    prompt: "p", teachingReferenceText: teachingText, teachingBytes: TEACHING_PROOF, targetGuideText: guideText, guideBytes, model: "gemini-3-pro-image", expected,
  });
  assert.equal(request.partCount, 5);
  assert.equal(request.modelInputImageCount, 2);
  assert.equal(request.customerReferenceCount, 0);
  assert.deepEqual(request.parts.map((p) => p.kind), ["text", "text", "image", "text", "image"]);
  assert.equal(request.parts[2].sha256, expected.teachingImage);
  assert.equal(request.parts[4].sha256, expected.guideImage);
  assert.deepEqual(request.generationConfig, { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "4K" } });
  assert.equal(parts.length, 5);
  const withRef = buildAnchorRequest({
    prompt: "p", teachingReferenceText: teachingText, teachingBytes: TEACHING_PROOF, targetGuideText: guideText, guideBytes, model: "m", expected,
    referenceParts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }],
  });
  assert.equal(withRef.request.partCount, 6);
  assert.equal(withRef.request.modelInputImageCount, 3);
  assert.deepEqual(withRef.request.parts.map((p) => p.kind), ["text", "text", "image", "image", "text", "image"]);
  const base = { prompt: "p", teachingReferenceText: teachingText, teachingBytes: TEACHING_PROOF, targetGuideText: guideText, guideBytes, model: "m", expected };
  assert.throws(() => buildAnchorRequest({ ...base, teachingReferenceText: "drifted" }), /not the deployed teaching instruction/);
  assert.throws(() => buildAnchorRequest({ ...base, teachingBytes: Buffer.from("substitute") }), /not the pinned owner teaching proof/);
  assert.throws(() => buildAnchorRequest({ ...base, targetGuideText: "drifted" }), /not the deployed guide text/);
  assert.throws(() => buildAnchorRequest({ ...base, guideBytes: Buffer.from("other guide") }), /not the production guide/);
  assert.throws(() => buildAnchorRequest({ ...base, expected: null }), /expected part shas are required/);
  assert.doesNotThrow(() => buildAnchorRequest({ ...base, guideBytes: Buffer.from("other guide"), expected: { ...expected, guideImage: null } }));
});
