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
