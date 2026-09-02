// ANCHOR RESTORATION HARNESS — LOCKS. One draw, harness only, option A.
//
// These convict, without a provider call, every way the harness could quietly
// stop being what the owner approved: the creative assembly changing by a
// byte, the tail drifting from the approved text, a region named before the
// object is defined, a forbidden container/anatomy/negative word entering the
// tail, the centre-order phrase disagreeing with the order the guide is drawn
// from, a part of the deployed five-part request moving or being substituted,
// and the pinned deployed shas drifting from the captured deployed request.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ANCHOR_TAIL_MAX_CHARS,
  EXPECTED_ANCHOR_TAIL_CHARS_F250,
  EXPECTED_ANCHOR_TAIL_SHA256_PREFIX_F250,
  FORBIDDEN_IN_ANCHOR_TAIL,
  NO_CAPTIONS_SENTENCE,
  anchorContract,
  assertAnchorTailClean,
  assertObjectFirst,
  buildAnchorPrompt,
  buildAnchorRequest,
  centerOrderPhrase,
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

test("the deployed-prompt fixture is the one the edge sends", () => {
  assert.equal(DEPLOYED_PROMPT.length, 4587);
  assert.equal(sha256(DEPLOYED_PROMPT), "dcb73e9eae229cd88af6bcdb4a3874e1050b266fa98a55b79fee65d0b7e610b2");
});

test("production CENTER_ORDER is the known-good order and the anchor phrase follows it", () => {
  assert.deepEqual([...atlas.CENTER_ORDER], ["rear", "roof", "hood", "front"]);
  assert.equal(centerOrderPhrase(atlas.CENTER_ORDER), "rear, roof, hood and front");
  assert.equal(centerOrderPhrase(["hood", "roof", "rear", "front"]), "hood, roof, rear and front");
  assert.throws(() => centerOrderPhrase(["rear", "roof", "hood"]), /four centre surfaces/);
  assert.throws(() => centerOrderPhrase(["rear", "roof", "hood", "driver"]), /not a permutation/);
  const tail = anchorContract(buildAnchorPrompt(DEPLOYED_PROMPT, { centerOrder: atlas.CENTER_ORDER }).deployedTail, { centerOrder: atlas.CENTER_ORDER });
  assert.ok(tail.includes("(rear, roof, hood and front, stacked top to bottom in the centre)"));
});

test("the creative assembly is byte-identical and only the tail changes", () => {
  const anchor = buildAnchorPrompt(DEPLOYED_PROMPT, { centerOrder: atlas.CENTER_ORDER });
  assert.ok(DEPLOYED_PROMPT.startsWith(anchor.creative));
  assert.equal(anchor.creative.length, 2622);
  assert.ok(sha256(anchor.creative).startsWith("7e011c6c20b5fa29"));
  assert.equal(anchor.prompt, anchor.creative + anchor.anchorTail);
  assert.equal(anchor.creative + anchor.deployedTail, DEPLOYED_PROMPT);
  for (const literal of [
    "You are the senior vehicle-wrap designer at a sign and wrap company",
    "THE CONCEPT — the heart of this design; build everything around it:",
    "Translate anything the brief names into concrete design",
    "This business needs its own logo",
    "Finish: GLOSS — wet-look surface",
    "never an on-vehicle photograph",
  ]) assert.ok(anchor.creative.includes(literal), `creative block missing: ${literal}`);
  assert.ok(!anchor.prompt.includes("OUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD"));
});

test("the tail is exactly the owner-approved text on the F250 fixture", () => {
  const { anchorTail } = buildAnchorPrompt(DEPLOYED_PROMPT, { centerOrder: atlas.CENTER_ORDER });
  assert.equal(anchorTail.length, EXPECTED_ANCHOR_TAIL_CHARS_F250);
  assert.ok(sha256(anchorTail).startsWith(EXPECTED_ANCHOR_TAIL_SHA256_PREFIX_F250), `tail sha ${sha256(anchorTail).slice(0, 16)}`);
  assert.ok(anchorTail.length <= ANCHOR_TAIL_MAX_CHARS);
  // the owner's exact sentences
  assert.ok(anchorTail.startsWith("A.T.L.A.S. — DesignProAI’s canonical flattened design topology, on one square 4K canvas.\n"));
  assert.ok(anchorTail.includes("For the vehicle-design embodiment, A.T.L.A.S. represents a top-view vehicle-wrap design as a flattened 2D topology: conceptually, the printable exterior skin of the completely wrapped 3D vehicle is pressed flat from above and unfolded into one dimensionally governed design space."));
  assert.ok(anchorTail.includes("Create one cohesive professional vehicle-wrap design across this flattened topology. Every defined topology region is printable artwork and must be filled completely edge-to-edge with intentional finished design. The complete flattened topology represents one coordinated vehicle-wrap design."));
  assert.ok(anchorTail.includes("Here that vehicle is this exact 2022 Ford F250 Crew Cab (truck)."), "the vehicle context is lifted from the deployed tail");
  assert.ok(anchorTail.includes("all subdivisions of the same one flattened printable skin"));
  assert.ok(anchorTail.includes("Driver and Passenger are coordinated but independently composed; they are not mirrored artwork."));
  assert.ok(anchorTail.includes(NO_CAPTIONS_SENTENCE));
  assert.ok(anchorTail.endsWith("Gallery-grade custom artwork with real depth, movement and a wow factor, drawn straight-on and flat for printing."));
  // no bullet list of panels, no negative list of gestalts
  assert.ok(!anchorTail.includes("• "));
  assert.ok(!/do not reinterpret/i.test(anchorTail));
});

test("object-first: the regions are named only after the one design space is defined", () => {
  const { anchorTail } = buildAnchorPrompt(DEPLOYED_PROMPT, { centerOrder: atlas.CENTER_ORDER });
  assert.ok(anchorTail.indexOf("design space") < anchorTail.search(/\bregion/i));
  assert.doesNotThrow(() => assertObjectFirst(anchorTail));
  assert.throws(() => assertObjectFirst("Fill every region. Then the design space."), /not object-first/);
  assert.throws(() => assertObjectFirst("one design space and nothing else"), /never named/);
  assert.throws(() => assertObjectFirst("regions only"), /missing/);
});

test("the tail carries no container, panel, anatomy, presentation or negative framing", () => {
  const { anchorTail } = buildAnchorPrompt(DEPLOYED_PROMPT, { centerOrder: atlas.CENTER_ORDER });
  for (const { word } of FORBIDDEN_IN_ANCHOR_TAIL) {
    assert.throws(
      () => assertAnchorTailClean(`${anchorTail}\n${word} appears here`),
      new RegExp(`forbidden framing "${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
      `guard did not convict "${word}"`,
    );
  }
  // "sheet" is allowed ONLY inside the carried-across no-captions sentence
  assert.doesNotThrow(() => assertAnchorTailClean(anchorTail));
  assert.throws(() => assertAnchorTailClean(`${anchorTail}\nOne flat sheet.`), /forbidden framing "sheet"/);
  assert.throws(() => assertAnchorTailClean("x".repeat(10)), /no-captions sentence is missing/);
  assert.throws(() => assertAnchorTailClean(`${NO_CAPTIONS_SENTENCE}${"x".repeat(ANCHOR_TAIL_MAX_CHARS)}`), /over the 1700 ceiling/);
  // word boundaries: "whole" and "boxed-in" style false positives do not fire on prose words
  assert.doesNotThrow(() => assertAnchorTailClean(`${NO_CAPTIONS_SENTENCE} the whole handsome unfolding`));
});

test("the pinned deployed shas in the recovery script match the captured deployed request", async () => {
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
  // exactly one draw, refused otherwise
  assert.ok(source.includes("if (DRAWS !== 1) throw new Error"));
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
  // customer references sit between the proof and the guide pair, as production sends them
  const withRef = buildAnchorRequest({
    prompt: "p", teachingReferenceText: teachingText, teachingBytes: TEACHING_PROOF, targetGuideText: guideText, guideBytes, model: "m", expected,
    referenceParts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }],
  });
  assert.equal(withRef.request.partCount, 6);
  assert.equal(withRef.request.modelInputImageCount, 3);
  assert.deepEqual(withRef.request.parts.map((p) => p.kind), ["text", "text", "image", "image", "text", "image"]);
  // a drifted teaching text, substituted proof, drifted guide text, or wrong guide image is refused
  const base = { prompt: "p", teachingReferenceText: teachingText, teachingBytes: TEACHING_PROOF, targetGuideText: guideText, guideBytes, model: "m", expected };
  assert.throws(() => buildAnchorRequest({ ...base, teachingReferenceText: "drifted" }), /not the deployed teaching instruction/);
  assert.throws(() => buildAnchorRequest({ ...base, teachingBytes: Buffer.from("substitute") }), /not the pinned owner teaching proof/);
  assert.throws(() => buildAnchorRequest({ ...base, targetGuideText: "drifted" }), /not the deployed guide text/);
  assert.throws(() => buildAnchorRequest({ ...base, guideBytes: Buffer.from("other guide") }), /not the production guide/);
  assert.throws(() => buildAnchorRequest({ ...base, expected: null }), /expected part shas are required/);
  // off the default fixture the guide image is rendered live and not pinned
  assert.doesNotThrow(() => buildAnchorRequest({ ...base, guideBytes: Buffer.from("other guide"), expected: { ...expected, guideImage: null } }));
});
