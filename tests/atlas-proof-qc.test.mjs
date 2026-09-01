import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const angles = require("../runtime/view-angles.cjs");
const { runSlot } = require("../runtime/generation-engine.cjs");
const { PHOTOREALISM_REQUIREMENT } = require("../runtime/photorealism-prompt.cjs");
const { STUDIO_ENVIRONMENT, STUDIO_REINFORCEMENT } = require("../runtime/studio-os.cjs");
const {
  ADVISORY_POLICY_CONTRACT,
  QC_CONTRACT,
  VIEW_CONTRACTS,
  buildAtlasProofQcPrompt,
  createAtlasProofValidator,
  parseAtlasProofQcResponse,
  _test,
} = require("../runtime/atlas-proof-qc.cjs");

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function image(width, height, background) {
  return sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
}

async function fixture() {
  const atlasBytes = await image(96, 96, "#00a9ce");
  const proofBytes = await image(160, 90, "#f06292");
  const masterContentHash = hash(atlasBytes);
  const surfaces = {
    side: "driver", "passenger-side": "passenger", hood_detail: "hood",
    front: "front", rear: "rear", "close-up": "driver", roof: "roof",
  };
  const viewAuthorities = Object.fromEntries(Object.entries(surfaces).map(([sourceViewType, surfaceKey]) => [
    sourceViewType,
    {
      contract: "designpro.flat-first-atlas-view-authority.v1",
      sourceViewType,
      surfaceKey,
      bytes: atlasBytes,
      contentType: "image/png",
      contentHash: hash(atlasBytes),
      byteSize: atlasBytes.length,
      sourceMasterHash: masterContentHash,
    },
  ]));
  return {
    atlas: {
      master: { contentHash: masterContentHash },
      projection: {
        bytes: atlasBytes,
        contentType: "image/png",
        contentHash: hash(atlasBytes),
      },
      viewAuthorities,
      manifest: {
        topology: "flattened-top-view",
        installerMap: { passenger: "left", driver: "right" },
        zones: [
          { surfaceKey: "driver", proofDependencies: ["side", "close-up"] },
          { surfaceKey: "passenger", proofDependencies: ["passenger-side"] },
          { surfaceKey: "roof", proofDependencies: ["roof"] },
        ],
      },
    },
    input: {
      vehicle: { year: "2024", make: "Ford", model: "F-250", type: "pickup truck" },
    },
    atlasBytes,
    proofBytes,
  };
}

function responseIdentity(body) {
  const properties = body.generationConfig.responseSchema.properties;
  return {
    proofHash: properties.proofSha256.enum[0],
    atlasHash: properties.atlasSha256.enum[0],
    authorityHash: properties.authoritySha256.enum[0],
    expectedView: properties.expectedView.enum[0],
  };
}

function passingReview(identity, overrides = {}) {
  const orientation = ["Driver", "Passenger", "Front", "Rear"].includes(identity.expectedView)
    ? "pass"
    : "not_applicable";
  const roofBoundary = identity.expectedView === "Roof" ? "pass" : "not_applicable";
  return {
    contract: QC_CONTRACT,
    proofSha256: identity.proofHash,
    atlasSha256: identity.atlasHash,
    authoritySha256: identity.authorityHash,
    expectedView: identity.expectedView,
    observedView: identity.expectedView,
    cameraContract: "pass",
    framingContract: "pass",
    orientationContract: orientation,
    roofBoundaryContract: roofBoundary,
    photorealismContract: "pass",
    studioLightingContract: "pass",
    atlasContinuityContract: "pass",
    vehicleContinuityContract: "pass",
    artifactFreeContract: "pass",
    confidence: 0.97,
    reasons: [],
    ...overrides,
  };
}

function payload(review, finishReason = "STOP") {
  return {
    candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(review) }] } }],
  };
}

test("the QC contract imports the locked seven angles, photography and Studio OS lighting without creating a Hero slot", () => {
  const expected = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];
  assert.deepEqual(Object.keys(VIEW_CONTRACTS), expected);
  assert.deepEqual(expected, angles.viewOrder());
  assert.equal(Object.hasOwn(VIEW_CONTRACTS, "hero-3d"), false);

  for (const sourceViewType of expected) {
    const prompt = buildAtlasProofQcPrompt({
      sourceViewType,
      input: { vehicle: { year: "2024", make: "Ford", model: "F-250", type: "pickup truck" } },
      atlas: { manifest: { topology: "flattened-top-view" } },
      proofHash: "a".repeat(64),
      atlasHash: "b".repeat(64),
      authorityHash: "c".repeat(64),
      authoritySurface: sourceViewType === "passenger-side" ? "passenger" : sourceViewType === "hood_detail" ? "hood" : sourceViewType === "close-up" ? "driver" : sourceViewType,
    });
    assert.ok(prompt.includes(angles.cameraAngle(sourceViewType)), `${sourceViewType} lost its locked angle`);
    assert.ok(prompt.includes(PHOTOREALISM_REQUIREMENT), `${sourceViewType} lost the photography contract`);
    assert.ok(prompt.includes(STUDIO_ENVIRONMENT), `${sourceViewType} lost Studio OS`);
    assert.ok(prompt.includes(STUDIO_REINFORCEMENT), `${sourceViewType} lost Studio OS reinforcement`);
    assert.match(prompt, /sole artwork authority for this proof/i);
  }

  const roof = buildAtlasProofQcPrompt({
    sourceViewType: "roof",
    input: { vehicle: { year: "2024", make: "Ford", model: "F-250", type: "pickup truck" } },
    atlas: {},
    proofHash: "a".repeat(64),
    atlasHash: "b".repeat(64),
    authorityHash: "c".repeat(64),
    authoritySurface: "roof",
  });
  assert.match(roof, /CAB-ROOF-ONLY/);
  assert.match(roof, /open bed, bedliner, cargo box, tailgate, hood, wheel, side body, floor or wall is visible/);
});

test("the validator grades the actual candidate inline against the canonical Atlas with bounded schema JSON", async () => {
  const f = await fixture();
  const calls = [];
  const provider = {
    generateRaw: async (call) => {
      calls.push(call);
      const identity = responseIdentity(call.body);
      return {
        payload: payload(passingReview(identity)),
        model: call.model,
        keyFingerprint: "0123456789ab",
      };
    },
  };
  const validate = createAtlasProofValidator({ provider, atlas: f.atlas, input: f.input });
  const verdict = await validate({
    bytes: f.proofBytes,
    contentType: "image/png",
    sourceViewType: "passenger-side",
  });

  assert.equal(verdict.accepted, true);
  assert.equal(verdict.review.observedView, "Passenger");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "gemini-2.5-flash");
  assert.equal(calls[0].timeoutMs, 45_000);
  assert.equal(calls[0].body.generationConfig.temperature, 0);
  assert.equal(calls[0].body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(calls[0].body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.equal(calls[0].body.generationConfig.maxOutputTokens, 2048);
  assert.deepEqual(calls[0].body.generationConfig.responseSchema.required, _test.RESPONSE_FIELDS);
  const parts = calls[0].body.contents[0].parts;
  assert.equal(parts[1].inlineData.mimeType, "image/png");
  assert.equal(parts[1].inlineData.data, f.proofBytes.toString("base64"), "QC did not receive the actual candidate bytes inline");
  assert.equal(parts[3].inlineData.data, f.atlasBytes.toString("base64"));
  assert.equal(verdict.metadata.zoneSurfaceKey, "passenger");
  assert.equal(verdict.metadata.zoneHash, hash(f.atlasBytes));
  assert.equal(verdict.metadata.policyContract, ADVISORY_POLICY_CONTRACT);
  assert.equal(verdict.metadata.semanticDisposition, "pass");
  assert.equal(verdict.metadata.semanticCode, null);
  assert.deepEqual(verdict.metadata.semanticReview, verdict.review);
  assert.ok(verdict.metadata.requestByteSize < 18 * 1024 * 1024);
  assert.equal(verdict.metadata.candidateTransportDerived, false);
  assert.equal(verdict.metadata.atlasTransportDerived, false);
});

test("semantic findings are retained as advisory receipts without rejecting presentation proofs", async (t) => {
  const f = await fixture();
  const cases = [
    ["side", { observedView: "Hero" }, "atlas_qc_view_mismatch"],
    ["passenger-side", { orientationContract: "fail", reasons: ["Nose points left."] }, "atlas_qc_orientation_failed"],
    ["front", { atlasContinuityContract: "uncertain", reasons: ["Dominant artwork cannot be matched."] }, "atlas_qc_design_drift"],
    ["roof", { roofBoundaryContract: "fail", reasons: ["Open pickup bed is visible."] }, "atlas_qc_roof_boundary_failed"],
    ["rear", { confidence: 0.71, reasons: ["Camera evidence is ambiguous."] }, "atlas_qc_uncertain"],
  ];
  for (const [sourceViewType, overrides, code] of cases) {
    await t.test(`${sourceViewType} -> ${code}`, async () => {
      const provider = {
        generateRaw: async ({ body }) => {
          const identity = responseIdentity(body);
          return { payload: payload(passingReview(identity, overrides)), model: "gemini-2.5-flash" };
        },
      };
      const validate = createAtlasProofValidator({ provider, atlas: f.atlas, input: f.input });
      const verdict = await validate({ bytes: f.proofBytes, contentType: "image/png", sourceViewType });
      assert.equal(verdict.accepted, true);
      assert.equal(verdict.advisory, true);
      assert.equal(verdict.metadata.policyContract, ADVISORY_POLICY_CONTRACT);
      assert.equal(verdict.metadata.semanticDisposition, "review_required");
      assert.equal(verdict.metadata.semanticCode, code);
      assert.equal(typeof verdict.metadata.semanticReason, "string");
      assert.deepEqual(verdict.metadata.semanticReview, verdict.review);
    });
  }
});

test("an advisory semantic finding persists the first proof without an image reroll", async () => {
  const f = await fixture();
  let imageCalls = 0;
  let persisted = null;
  // A PHOTOGRAPHIC critique. This fixture used to raise
  // `atlasContinuityContract: "fail"`, which the owner ruled BLOCKING on
  // 2026-09-01 -- see the two tests below. Studio lighting is the class that
  // stays advisory: "keep things like studio-light streaks advisory for now."
  const validate = createAtlasProofValidator({
    provider: {
      generateRaw: async ({ body }) => {
        const identity = responseIdentity(body);
        return {
          payload: payload(passingReview(identity, {
            studioLightingContract: "fail",
            reasons: ["The LED strips read as streaks on the upper body."],
          })),
          model: "gemini-2.5-flash",
        };
      },
    },
    atlas: f.atlas,
    input: f.input,
  });
  const store = {
    async findAcceptedSlot() { return null; },
    async acquireSlotLease() { return { token: "lease" }; },
    async releaseSlotLease() {},
    async recordAttemptStarted() {},
    async recordAttemptFinished() {},
    async putImmutableBytes() {},
    async persistAcceptedSlot(row) { persisted = row; return row; },
    async markSlotFailed() { throw new Error("an advisory finding may not fail the slot"); },
  };
  const result = await runSlot({
    requestId: "request",
    tenantKey: "user_owner",
    generationId: "generation",
    sourceViewType: "front",
    consumerRole: "front",
    provider: {
      async generateImage() {
        imageCalls += 1;
        return {
          bytes: f.proofBytes,
          contentType: "image/png",
          model: "gemini-3-pro-image",
          keyFingerprint: "000000000000",
        };
      },
    },
    store,
    promptParts: [],
    aspectRatio: "4:3",
    imageSize: "4K",
    validate,
    allowOrphanReconciliation: false,
    maxProviderAttempts: 4,
    maxRegenerations: 4,
  });

  assert.equal(result.state, "accepted");
  assert.equal(result.providerCalls, 1);
  assert.equal(imageCalls, 1);
  assert.equal(persisted.metadata.validation.semanticDisposition, "review_required");
  assert.equal(persisted.metadata.validation.semanticCode, "atlas_qc_studio_failed");
});

// ═══ CONTINUITY IS BLOCKING, AND IT BUYS EXACTLY ONE RE-RENDER.
//
// Owner ruling, 2026-09-01: "atlasContinuityContract: fail -> candidate cannot
// publish -> one proof-only rerender -> if still fail, stop that proof. But
// keep things like studio-light streaks advisory for now."
//
// DID-134FC3CA is why: the inspector CORRECTLY reported that the Driver proof
// had changed the customer's wrap, and the proof published anyway. Detection
// without consequence is what these two tests convict.

test("an explicit continuity failure blocks publication and buys exactly one proof-only re-render", async () => {
  const f = await fixture();
  let imageCalls = 0;
  let failedReason = null;
  const validate = createAtlasProofValidator({
    provider: {
      generateRaw: async ({ body }) => {
        const identity = responseIdentity(body);
        return {
          payload: payload(passingReview(identity, {
            atlasContinuityContract: "fail",
            reasons: ["The vehicle carries a different wrap than the authority crop."],
          })),
          model: "gemini-2.5-flash",
        };
      },
    },
    atlas: f.atlas,
    input: f.input,
  });
  const store = {
    async findAcceptedSlot() { return null; },
    async acquireSlotLease() { return { token: "lease" }; },
    async releaseSlotLease() {},
    async recordAttemptStarted() {},
    async recordAttemptFinished() {},
    async putImmutableBytes() {},
    async persistAcceptedSlot() { throw new Error("a blocked proof may not be persisted"); },
    async markSlotFailed(row) { failedReason = row; return row; },
  };
  const result = await runSlot({
    requestId: "request",
    tenantKey: "user_owner",
    generationId: "generation",
    sourceViewType: "side",
    consumerRole: "side",
    provider: {
      async generateImage() {
        imageCalls += 1;
        return {
          bytes: f.proofBytes,
          contentType: "image/png",
          model: "gemini-3-pro-image",
          keyFingerprint: "000000000000",
        };
      },
    },
    store,
    promptParts: [],
    aspectRatio: "16:9",
    imageSize: "4K",
    validate,
    allowOrphanReconciliation: false,
    // The slot's own budget is deliberately larger than the continuity budget:
    // this proves the STOP comes from the terminal verdict, not from running
    // the transport budget out.
    maxProviderAttempts: 4,
    maxRegenerations: 4,
  });

  assert.notEqual(result.state, "accepted");
  // The original render, plus exactly ONE proof-only re-render. Not four.
  assert.equal(imageCalls, 2);
  assert.equal(result.providerCalls, 2);
  assert.ok(failedReason, "a blocked proof must terminate the slot rather than publish");
});

test("the first continuity failure carries a correction and does not redesign the artwork", async () => {
  const f = await fixture();
  const validate = createAtlasProofValidator({
    provider: {
      generateRaw: async ({ body }) => {
        const identity = responseIdentity(body);
        return {
          payload: payload(passingReview(identity, {
            atlasContinuityContract: "fail",
            reasons: ["The dominant wordmark from the crop is absent."],
          })),
          model: "gemini-2.5-flash",
        };
      },
    },
    atlas: f.atlas,
    input: f.input,
  });
  const first = await validate({ bytes: f.proofBytes, contentType: "image/png", sourceViewType: "side" });
  assert.equal(first.accepted, false);
  assert.equal(first.code, "atlas_qc_design_drift");
  assert.equal(first.terminal, false, "the first verdict must buy a re-render");
  assert.equal(first.metadata.semanticDisposition, "blocked");
  assert.equal(first.metadata.continuityAttempt, 1);
  // A re-render is PROOF-ONLY. The correction may not tell the renderer to
  // change the wrap to satisfy the inspector -- Call-1 artwork is never edited
  // to compensate for a presentation failure.
  assert.match(first.correction, /Do not redesign, restyle, recolor or move any artwork/);

  const second = await validate({ bytes: f.proofBytes, contentType: "image/png", sourceViewType: "side" });
  assert.equal(second.accepted, false);
  assert.equal(second.terminal, true, "the second verdict must stop that proof");
  assert.equal(second.metadata.continuityAttempt, 2);
});

test("an UNCERTAIN continuity verdict stays advisory and still publishes", async () => {
  const f = await fixture();
  const validate = createAtlasProofValidator({
    provider: {
      generateRaw: async ({ body }) => {
        const identity = responseIdentity(body);
        return {
          payload: payload(passingReview(identity, {
            atlasContinuityContract: "uncertain",
            reasons: ["Reviewer could not resolve the flank at this resolution."],
          })),
          model: "gemini-2.5-flash",
        };
      },
    },
    atlas: f.atlas,
    input: f.input,
  });
  const verdict = await validate({ bytes: f.proofBytes, contentType: "image/png", sourceViewType: "side" });
  // The owner's ruling names `fail`. Convicting on the reviewer hedging is the
  // same error as blocking on a lighting critique.
  assert.equal(verdict.accepted, true);
  assert.equal(verdict.advisory, true);
  assert.equal(verdict.metadata.semanticDisposition, "review_required");
});

test("an oversized advisory payload persists the first proof without reviewer or image reroll", async () => {
  const f = await fixture();
  let imageCalls = 0;
  let reviewerCalls = 0;
  let persisted = null;
  const validate = createAtlasProofValidator({
    provider: { generateRaw: async () => { reviewerCalls += 1; throw new Error("must not be called"); } },
    atlas: f.atlas,
    input: f.input,
    maxRequestBytes: 1024,
  });
  const store = {
    async findAcceptedSlot() { return null; },
    async acquireSlotLease() { return { token: "lease" }; },
    async releaseSlotLease() {},
    async recordAttemptStarted() {},
    async recordAttemptFinished() {},
    async putImmutableBytes() {},
    async persistAcceptedSlot(row) { persisted = row; return row; },
    async markSlotFailed() { throw new Error("advisory transport may not fail the slot"); },
  };
  const result = await runSlot({
    requestId: "request",
    tenantKey: "user_owner",
    generationId: "generation",
    sourceViewType: "side",
    consumerRole: "driver",
    provider: {
      async generateImage() {
        imageCalls += 1;
        return {
          bytes: f.proofBytes,
          contentType: "image/png",
          model: "gemini-3-pro-image",
          keyFingerprint: "000000000000",
        };
      },
    },
    store,
    promptParts: [],
    aspectRatio: "4:3",
    imageSize: "4K",
    validate,
    allowOrphanReconciliation: false,
    maxProviderAttempts: 4,
    maxRegenerations: 4,
  });

  assert.equal(result.state, "accepted");
  assert.equal(result.providerCalls, 1);
  assert.equal(imageCalls, 1);
  assert.equal(reviewerCalls, 0);
  assert.equal(persisted.metadata.validation.semanticDisposition, "unavailable");
  assert.equal(persisted.metadata.validation.semanticCode, "atlas_qc_request_too_large");
  assert.equal(persisted.metadata.validation.proofHash, hash(f.proofBytes));
  assert.equal(persisted.metadata.validation.authorityHash, hash(f.atlasBytes));
});

test("analyzer errors and unusable responses publish an unavailable advisory after deterministic preflight", async (t) => {
  const f = await fixture();
  const cases = [
    ["transport error", async () => { throw new Error("vision service unavailable"); }, "atlas_qc_analyzer_failed"],
    ["not JSON", async () => ({ payload: { candidates: [{ content: { parts: [{ text: "PASS" }] } }] } }), "atlas_qc_response_malformed"],
    ["wrong hash", async ({ body }) => {
      const review = passingReview(responseIdentity(body), { proofSha256: "f".repeat(64) });
      return { payload: payload(review) };
    }, "atlas_qc_response_identity_mismatch"],
    ["truncated", async ({ body }) => ({ payload: payload(passingReview(responseIdentity(body)), "MAX_TOKENS") }), "atlas_qc_analyzer_incomplete"],
  ];
  for (const [name, generateRaw, code] of cases) {
    await t.test(name, async () => {
      const validate = createAtlasProofValidator({ provider: { generateRaw }, atlas: f.atlas, input: f.input });
      const verdict = await validate({ bytes: f.proofBytes, contentType: "image/png", sourceViewType: "side" });
      assert.equal(verdict.accepted, true);
      assert.equal(verdict.advisory, true);
      assert.equal(verdict.metadata.policyContract, ADVISORY_POLICY_CONTRACT);
      assert.equal(verdict.metadata.semanticDisposition, "unavailable");
      assert.equal(verdict.metadata.semanticCode, code);
      assert.equal(verdict.metadata.confidence, null);
    });
  }
});

test("deterministic proof failures remain blocking while analyzer transport is advisory", async (t) => {
  const f = await fixture();
  let calls = 0;
  const provider = { generateRaw: async () => { calls += 1; throw new Error("must not be called"); } };

  await t.test("Hero is not a proof view", async () => {
    const validate = createAtlasProofValidator({ provider, atlas: f.atlas, input: f.input });
    const verdict = await validate({ bytes: f.proofBytes, contentType: "image/png", sourceViewType: "hero-3d" });
    assert.equal(verdict.accepted, false);
    assert.equal(verdict.structuralInvalid, true);
    assert.equal(verdict.code, "atlas_qc_view_invalid");
  });

  await t.test("corrupt output", async () => {
    const validate = createAtlasProofValidator({ provider, atlas: f.atlas, input: f.input });
    const verdict = await validate({ bytes: Buffer.from("not an image"), contentType: "image/png", sourceViewType: "side" });
    assert.equal(verdict.accepted, false);
    assert.equal(verdict.structuralInvalid, true);
    assert.equal(verdict.code, "atlas_qc_image_invalid");
  });

  await t.test("request budget", async () => {
    const validate = createAtlasProofValidator({ provider, atlas: f.atlas, input: f.input, maxRequestBytes: 1024 });
    const verdict = await validate({ bytes: f.proofBytes, contentType: "image/png", sourceViewType: "side" });
    assert.equal(verdict.accepted, true);
    assert.equal(verdict.advisory, true);
    assert.equal(verdict.metadata.semanticDisposition, "unavailable");
    assert.equal(verdict.metadata.semanticCode, "atlas_qc_request_too_large");
    assert.equal(verdict.metadata.proofHash, hash(f.proofBytes));
    assert.equal(verdict.metadata.authorityHash, hash(f.atlasBytes));
  });

  await t.test("stale authority hash", async () => {
    const atlas = {
      ...f.atlas,
      viewAuthorities: {
        ...f.atlas.viewAuthorities,
        side: { ...f.atlas.viewAuthorities.side, contentHash: "f".repeat(64) },
      },
    };
    const validate = createAtlasProofValidator({ provider, atlas, input: f.input });
    const verdict = await validate({ bytes: f.proofBytes, contentType: "image/png", sourceViewType: "side" });
    assert.equal(verdict.accepted, false);
    assert.equal(verdict.structuralInvalid, true);
    assert.equal(verdict.code, "atlas_qc_image_hash_mismatch");
  });

  await t.test("wrong surface authority", async () => {
    const atlas = {
      ...f.atlas,
      viewAuthorities: {
        ...f.atlas.viewAuthorities,
        side: { ...f.atlas.viewAuthorities.side, surfaceKey: "passenger" },
      },
    };
    const validate = createAtlasProofValidator({ provider, atlas, input: f.input });
    const verdict = await validate({ bytes: f.proofBytes, contentType: "image/png", sourceViewType: "side" });
    assert.equal(verdict.accepted, false);
    assert.equal(verdict.structuralInvalid, true);
    assert.equal(verdict.code, "atlas_qc_view_authority_invalid");
  });

  assert.equal(calls, 0);
});

test("missing or invalid semantic reviewer configuration is unavailable, never structural", async (t) => {
  const f = await fixture();
  const cases = [
    ["missing reviewer seam", {}, {}, "atlas_qc_provider_invalid"],
    ["invalid reviewer model", { generateRaw: async () => { throw new Error("must not be called"); } }, { model: "gemini-3-pro-image" }, "atlas_qc_model_invalid"],
    ["invalid reviewer timeout", { generateRaw: async () => { throw new Error("must not be called"); } }, { timeoutMs: 100 }, "atlas_qc_timeout_invalid"],
  ];
  for (const [name, provider, options, code] of cases) {
    await t.test(name, async () => {
      const validate = createAtlasProofValidator({ provider, atlas: f.atlas, input: f.input, ...options });
      const verdict = await validate({
        bytes: f.proofBytes,
        contentType: "image/png",
        sourceViewType: "passenger-side",
      });
      assert.equal(verdict.accepted, true);
      assert.equal(verdict.advisory, true);
      assert.equal(verdict.metadata.policyContract, ADVISORY_POLICY_CONTRACT);
      assert.equal(verdict.metadata.semanticDisposition, "unavailable");
      assert.equal(verdict.metadata.semanticCode, code);
      assert.equal(verdict.metadata.proofHash, hash(f.proofBytes));
      assert.equal(verdict.metadata.zoneSurfaceKey, "passenger");
    });
  }
});

test("the strict parser rejects extra fields and non-applicable contract inflation", async () => {
  const identity = {
    proofHash: "a".repeat(64), atlasHash: "b".repeat(64),
    authorityHash: "c".repeat(64), expectedView: "Close-Up",
  };
  assert.throws(
    () => parseAtlasProofQcResponse(payload({ ...passingReview(identity), commentary: "looks good" }), identity),
    (error) => error?.code === "atlas_qc_response_malformed",
  );

  const f = await fixture();
  const provider = {
    generateRaw: async ({ body }) => {
      const current = responseIdentity(body);
      return { payload: payload(passingReview(current, { orientationContract: "pass" })) };
    },
  };
  const validate = createAtlasProofValidator({ provider, atlas: f.atlas, input: f.input });
  const verdict = await validate({ bytes: f.proofBytes, contentType: "image/png", sourceViewType: "close-up" });
  assert.equal(verdict.accepted, true);
  assert.equal(verdict.metadata.semanticDisposition, "review_required");
  assert.equal(verdict.metadata.semanticCode, "atlas_qc_orientation_failed");
});
