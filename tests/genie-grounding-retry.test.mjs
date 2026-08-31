import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const resolver = require("../runtime/genie-universal-resolver.cjs");
const { groundedCandidate, groundingPrompt } = resolver._test;

/**
 * THE GROUNDING QUESTION NAMES THE MIRROR RULE, AND A SANITY FAILURE EARNS
 * EXACTLY ONE CORRECTIVE RE-ASK.
 *
 * The first live A.T.L.A.S. acceptance run (4aa088e5, 2026-08-26 08:10) died
 * eleven seconds in with `genie_grounding_sanity_failed: overall_width_in 97.4
 * is outside van range 65-90`. 97.4" is the Ford Transit's REAL published
 * width -- with mirrors. The prompt never said which of the two figures every
 * manufacturer publishes it wanted, the model picked the wrong one, and one
 * wrong pick was a hard non-retryable kill: the sanity gate had no second
 * question, unlike the parse failure beside it which has retried since day
 * one. Same shape as convicting a proof because its judge returned 503.
 *
 * The range is NOT widened -- 65-90 stands, and these tests would fail if a
 * fixture inside the range were refused or one outside it accepted.
 */

const candidateJson = (width) => JSON.stringify({
  vehicle_class: "van", overall_length_in: 235.5, overall_width_in: width,
  overall_height_in: 83.6, wheelbase_in: 148, sub_type: "Transit 250 MR",
  confidence: "high", source_urls: ["https://www.ford.com/spec"],
});
const providerReturning = (widths, prompts) => ({
  async generateRaw({ body }) {
    prompts.push(body.contents[0].parts[0].text);
    return { payload: { candidates: [{ content: { parts: [{ text: candidateJson(widths.shift()) }] } }] } };
  },
});
const vehicle = { vehicleClass: "van", make: "Ford", model: "Transit 250", year: "2023" };

test("the base prompt demands body width excluding mirrors", () => {
  const prompt = groundingPrompt(vehicle);
  assert.match(prompt, /EXCLUDING side mirrors/);
  assert.match(prompt, /BODY width/);
});

test("an out-of-range width is re-asked once, naming the rejected value", async () => {
  const prompts = [];
  const result = await groundedCandidate(vehicle, providerReturning([97.4, 81.3], prompts));
  assert.equal(result.dimensions.overall_width_in, 81.3);
  assert.equal(prompts.length, 2, "exactly one corrective re-ask");
  assert.match(prompts[1], /97\.4 is outside van range 65-90/);
  assert.match(prompts[1], /excluding mirrors/);
});

test("a second out-of-range answer still fails closed", async () => {
  const prompts = [];
  await assert.rejects(
    () => groundedCandidate(vehicle, providerReturning([97.4, 96.8], prompts)),
    (error) => error.code === "genie_grounding_sanity_failed"
      && /two bounded grounding attempts were exhausted/.test(error.message),
  );
  assert.equal(prompts.length, 2, "the re-ask budget is one, not a loop");
});

test("an in-range first answer asks no second question", async () => {
  const prompts = [];
  const result = await groundedCandidate(vehicle, providerReturning([81.3], prompts));
  assert.equal(result.dimensions.overall_width_in, 81.3);
  assert.equal(prompts.length, 1);
});

/**
 * AN AMBIGUOUS ANSWER EARNS THE SAME ONE CORRECTIVE RE-ASK.
 *
 * The first real owner DCA on release 37c48076 (GenerationID
 * e4c16289-a972-4aca-9a37-98429d1745c5, 2026-08-31 20:09:20Z) never reached
 * Call 1. It died 25 seconds in with `genie_grounding_ambiguous: Grounding
 * returned 3 vehicle candidates; one exact OEM configuration is required` --
 * a 2022 Ford F-150 has three published box lengths and the model returned
 * all three.
 *
 * The remedy already existed and no code path could reach it. The strict tail
 * has ended in "or alternative objects" since it was written, authored for
 * precisely this defect, while the catch in `groundedCandidate` only ever
 * matched `genie_grounding_parse_failed` -- so the one grounding error whose
 * correction is spelled out verbatim in the prompt was the only one denied a
 * second question. Same shape as the Transit mirrors kill above.
 *
 * `parseGroundedJson` is NOT relaxed: it still refuses multiple alternatives
 * outright (locked in production-runtime-blockers), and a second multi-object
 * answer still ends the run.
 */

const truck = { vehicleClass: "truck", make: "Ford", model: "F150", year: "2022" };
const truckJson = (subType) => JSON.stringify({
  vehicle_class: "truck", overall_length_in: 231.7, overall_width_in: 79.9,
  overall_height_in: 75.6, wheelbase_in: 145, sub_type: subType,
  confidence: "high", source_urls: ["https://www.ford.com/spec"],
});
/** The live failure: three complete, individually valid box-length objects. */
const threeBoxes = [
  truckJson("SuperCrew 5.5' Box"),
  truckJson("SuperCrew 6.5' Box"),
  truckJson("SuperCrew 8' Box"),
].join("\n");
const truckProvider = (texts, prompts) => ({
  async generateRaw({ body }) {
    prompts.push(body.contents[0].parts[0].text);
    return { payload: { candidates: [{ content: { parts: [{ text: texts.shift() }] } }] } };
  },
});

test("three box-length alternatives are re-asked once, naming the count", async () => {
  const prompts = [];
  const result = await groundedCandidate(
    truck, truckProvider([threeBoxes, truckJson("SuperCrew 5.5' Box")], prompts),
  );
  assert.equal(result.subType, "SuperCrew 5.5' Box");
  assert.equal(prompts.length, 2, "exactly one corrective re-ask");
  assert.match(prompts[1], /Grounding returned 3 vehicle candidates/);
  assert.match(prompts[1], /Choose the single standard single-rear-wheel short-bed configuration/);
  // It must NOT be told its JSON was malformed -- every object parsed.
  assert.doesNotMatch(prompts[1], /could not be parsed/);
});

test("a second ambiguous answer still fails closed, and stays non-retryable", async () => {
  const prompts = [];
  await assert.rejects(
    () => groundedCandidate(truck, truckProvider([threeBoxes, threeBoxes], prompts)),
    (error) => error.code === "genie_grounding_ambiguous"
      && /two bounded grounding attempts were exhausted/.test(error.message)
      && error.retryable === false,
  );
  assert.equal(prompts.length, 2, "the re-ask budget is one, not a loop");
});

test("one unambiguous answer asks no second question", async () => {
  const prompts = [];
  const result = await groundedCandidate(
    truck, truckProvider([truckJson("SuperCrew 5.5' Box")], prompts),
  );
  assert.equal(result.dimensions.overall_length_in, 231.7);
  assert.equal(prompts.length, 1);
  assert.doesNotMatch(prompts[0], /Your prior answer/);
});

test("the parse and sanity retry tails are unchanged by the ambiguity branch", () => {
  assert.match(groundingPrompt(truck, true), /Your prior answer could not be parsed\./);
  assert.match(groundingPrompt(truck, "overall_width_in 97.4 is outside van range 65-90."),
    /Re-check the manufacturer specification/);
  assert.doesNotMatch(groundingPrompt(truck, true), /Choose the single standard/);
});
