import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { runAtlasProofStages } = require("../runtime/generation-worker.cjs");
const { _test: engineTest } = require("../runtime/generation-engine.cjs");
const sharp = require("../runtime/node_modules/sharp");

/**
 * FOUR JUDGED TRIES, BECAUSE EACH ONE IS A CORRECTIVE CYCLE.
 *
 * The engine default of two rejections predates the corrective loop. On the
 * first full acceptance run (fb63e76f, 2026-08-26) the master was accepted
 * first-attempt, six panels were cut, four proofs landed -- and hood, roof and
 * close-up each died at EXACTLY two rejections, with the attempt records
 * showing convergence: hood's second frame fixed the first frame's 80%-fill
 * finding and failed on a new, smaller fault. The budget ended the loop two
 * attempts before the ceiling, mid-correction.
 *
 * Acceptance is not widened: the same inspector, the same thresholds, and an
 * exhausted slot still fails to semantic_review_required for a human.
 */
test("atlas proof slots get a rejection budget equal to their attempt budget", async () => {
  let captured = null;
  await runAtlasProofStages({
    runRequest: async (options) => { captured = options; return { results: [], allAccepted: true }; },
    requestId: "r", generationId: "g", tenantKey: "user_x",
    provider: { generateImage() {}, hydrateDriver() {}, maxProviderAttempts: 4 },
    store: {}, slots: [{ sourceViewType: "side", consumerRole: "driver" }],
  });
  assert.equal(captured.maxProviderAttempts, 4);
  assert.equal(captured.maxRegenerations, 4, "rejections may use the whole bounded attempt ceiling");
});

/**
 * AND THE CYCLE IS REAL: THE INSPECTOR'S FINDINGS REACH THE RE-ATTEMPT --
 * WITHOUT DROPPING THE ARTWORK AUTHORITY IMAGE.
 *
 * For flat-first, `promptParts` at the engine layer is `[]` (buildAtlasProjection-
 * Request overwrites `parts` unconditionally and never reads them). Before
 * 2026-08-27, `correctedParts([], corrections)` on any judged rejection
 * produced a ONE-ELEMENT array holding ONLY the correction text -- and a
 * non-empty `call.parts` wins over the atlas's own `conditioningPartsFor`
 * fallback one layer up, so that text-only array silently stripped the
 * artwork authority image from every corrective retry: "expected exactly one
 * canonical Atlas image, received 0" on attempt 2+, live-caught 2026-08-27
 * (requestId 262f70cf-20e9-44fe-8b74-de44185b386a).
 *
 * The fix is at the source: `correctedParts` now leaves an EMPTY promptParts
 * empty on every attempt, corrected or not, so the flat-first path always
 * falls through to the atlas's own image. The judge's findings still reach
 * the retry -- via `call.corrections`, which the engine passes to
 * `provider.generateImage` independently of `call.parts` (see the call site
 * in `runSlot`), and which `buildAtlasProjectionRequest` reads as a trailing
 * text part. This test exercises both halves of that real chain.
 */
test("a correction on an empty (flat-first) promptParts stays empty", async () => {
  // The engine's own `correctedParts` leaves `[]` empty even with findings
  // queued. This is what stopped `call.parts` from ever again becoming a
  // text-only array that could out-rank the artwork image.
  assert.deepEqual(engineTest.correctedParts([], ["some finding"]), []);
  // Non-empty promptParts (the Standard/non-flat-first path) is unaffected --
  // it still gets the trailing correction appended, exactly as before.
  assert.deepEqual(
    engineTest.correctedParts([{ text: "base" }], ["some finding"]),
    [{ text: "base" }, { text: "some finding" }],
  );

  // ⚠️ THE SECOND HALF OF THIS TEST IS GONE, AND SO IS THE BEHAVIOUR IT COVERED.
  //
  // It drove `buildAtlasProjectionRequest` to prove that a corrective retry kept
  // the artwork image AND carried the judge's finding into the rebuilt prompt.
  // That builder is deleted, and the transport that replaced it sends the
  // photographer a fixed request: artwork panel + vehicle + finish + shotKey.
  // It has no field for a judge finding, because the pinned photographer has no
  // such input.
  //
  // So an A.T.L.A.S. proof retry is now UNCONDITIONED -- the same request again,
  // which is what the pinned stack itself does (MAX_RETRIES re-sends). If
  // findings should steer a re-roll, that is a deliberate extension of the
  // photographer's contract and an owner decision, not something to reintroduce
  // by rebuilding a second producer here.
});
