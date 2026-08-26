import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { runAtlasProofStages } = require("../runtime/generation-worker.cjs");
const { buildAtlasProjectionRequest } = require("../runtime/designpanel-server-provider.cjs");
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
 * AND THE CYCLE IS REAL: THE INSPECTOR'S FINDINGS REACH THE RE-ATTEMPT.
 *
 * The engine appends corrections to call.parts (correctedParts), and the atlas
 * projection builder passes call.parts through resolveAtlasConditioningParts,
 * which preserves text parts. This pins that path -- if a refactor ever drops
 * the trailing correction, a bigger budget really would be re-rolling the same
 * dice, which is exactly what this test exists to refuse.
 */
test("a correction carried in call.parts survives into the projection request", async () => {
  const png = await sharp({
    create: { width: 64, height: 32, channels: 3, background: { r: 20, g: 40, b: 80 } },
  }).png().toBuffer();
  const hash = createHash("sha256").update(png).digest("hex");
  const atlas = {
    masterContentHash: hash,
    projectionContentHash: hash,
    viewAuthorities: {
      hood_detail: {
        sourceViewType: "hood_detail", surfaceKey: "hood", sourceMasterHash: hash,
        contentHash: hash, contract: "designpro.flat-first-atlas-view-authority.v1",
      },
    },
    maxRequestBytes: 10_000_000,
  };
  const finding = "PREVIOUS ATTEMPT REJECTED BY THE HOOD PROOF INSPECTOR.\n- Camera height is too low";
  const request = await buildAtlasProjectionRequest({
    atlas,
    input: { vehicle: { year: "2023", make: "Ford", model: "Transit" }, finish: "Gloss", brief: "b" },
    sourceViewType: "hood_detail",
    call: {
      attempt: 2,
      parts: [
        { inlineData: { mimeType: "image/png", data: png.toString("base64") } },
        { text: "projection prompt" },
        { text: finding },
      ],
    },
  });
  const texts = request.parts.filter((part) => typeof part.text === "string").map((part) => part.text);
  assert.ok(
    texts.some((text) => text.includes("Camera height is too low")),
    "the inspector's finding must survive into the rebuilt projection request",
  );
});
