import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const angles = require("../runtime/view-angles.cjs");
const { PHOTOREALISM_REQUIREMENT } = require("../runtime/photorealism-prompt.cjs");
const { STUDIO_ENVIRONMENT, STUDIO_REINFORCEMENT } = require("../runtime/studio-os.cjs");
const {
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
  assert.ok(verdict.metadata.requestByteSize < 18 * 1024 * 1024);
  assert.equal(verdict.metadata.candidateTransportDerived, false);
  assert.equal(verdict.metadata.atlasTransportDerived, false);
});

test("wrong view, passenger orientation, Atlas drift, pickup roof leakage and uncertainty all reject fail-closed", async (t) => {
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
      assert.equal(verdict.accepted, false);
      assert.equal(verdict.code, code);
    });
  }
});

test("analyzer errors, malformed JSON, identity mismatch and incomplete answers can never accept a proof", async (t) => {
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
      assert.equal(verdict.accepted, false);
      assert.equal(verdict.code, code);
      // None of these produced a completed QC verdict, so none of them may
      // consume the design-rejection budget. The engine reads this flag and
      // retries the inspection as an infrastructure failure instead.
      assert.equal(verdict.verdictUnavailable, true,
        `${name} must be flagged verdictUnavailable so it cannot spend a design rejection`);
    });
  }
});

test("a completed rejection verdict is NOT flagged verdictUnavailable", async () => {
  const f = await fixture();
  const generateRaw = async ({ body }) => {
    const review = passingReview(responseIdentity(body), { atlasContinuityContract: "fail", reasons: ["invented text"] });
    return { payload: payload(review) };
  };
  const validate = createAtlasProofValidator({ provider: { generateRaw }, atlas: f.atlas, input: f.input });
  const verdict = await validate({ bytes: f.proofBytes, contentType: "image/png", sourceViewType: "side" });
  assert.equal(verdict.accepted, false);
  assert.notEqual(verdict.verdictUnavailable, true,
    "a real completed rejection must consume the design-rejection budget");
});

test("unknown Hero requests, corrupt pixels and oversized requests are rejected before analyzer transport", async (t) => {
  const f = await fixture();
  let calls = 0;
  const provider = { generateRaw: async () => { calls += 1; throw new Error("must not be called"); } };

  await t.test("Hero is not a proof view", async () => {
    const validate = createAtlasProofValidator({ provider, atlas: f.atlas, input: f.input });
    const verdict = await validate({ bytes: f.proofBytes, contentType: "image/png", sourceViewType: "hero-3d" });
    assert.equal(verdict.accepted, false);
    assert.equal(verdict.code, "atlas_qc_view_invalid");
  });

  await t.test("corrupt output", async () => {
    const validate = createAtlasProofValidator({ provider, atlas: f.atlas, input: f.input });
    const verdict = await validate({ bytes: Buffer.from("not an image"), contentType: "image/png", sourceViewType: "side" });
    assert.equal(verdict.accepted, false);
    assert.equal(verdict.code, "atlas_qc_image_invalid");
  });

  await t.test("request budget", async () => {
    const validate = createAtlasProofValidator({ provider, atlas: f.atlas, input: f.input, maxRequestBytes: 1024 });
    const verdict = await validate({ bytes: f.proofBytes, contentType: "image/png", sourceViewType: "side" });
    assert.equal(verdict.accepted, false);
    assert.equal(verdict.code, "atlas_qc_request_too_large");
  });

  assert.equal(calls, 0);
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
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.code, "atlas_qc_orientation_failed");
});
