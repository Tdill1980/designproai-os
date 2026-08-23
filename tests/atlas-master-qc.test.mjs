import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const {
  MASTER_QC_CONTRACT,
  MAX_PASSENGER_MIRROR_MAE,
  createAtlasMasterValidator,
  deterministicMasterChecks,
  parseMasterQcResponse,
  _test,
} = require("../runtime/atlas-master-qc.cjs");

const zoneKeys = ["driver", "passenger", "hood", "roof", "front", "rear"];
const manifest = {
  zones: zoneKeys.map((surfaceKey, index) => ({
    surfaceKey,
    x: (index % 3) * 100,
    y: Math.floor(index / 3) * 100,
    w: 100,
    h: 100,
    extraction: { outputRotationDegrees: 0 },
  })),
  installerMap: {
    passenger: "left",
    driver: "right",
    centerOrderTopToBottom: ["rear", "roof", "hood", "front"],
  },
};

async function patternedMaster() {
  const tile = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" fill="#082f49"/>
    <rect x="8" y="8" width="84" height="84" fill="#38bdf8"/>
    <rect x="20" y="20" width="60" height="60" fill="#f97316"/>
    <rect x="35" y="35" width="30" height="30" fill="#ffffff"/>
  </svg>`)).png().toBuffer();
  return sharp({
    create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(manifest.zones.map((zone) => ({ input: tile, left: zone.x, top: zone.y }))).png().toBuffer();
}

function passingReview(body) {
  const props = body.generationConfig.responseSchema.properties;
  return {
    contract: MASTER_QC_CONTRACT,
    masterSha256: props.masterSha256.enum[0],
    guideSha256: props.guideSha256.enum[0],
    outputFormatContract: "pass",
    topologyContract: "pass",
    zoneCoverageContract: "pass",
    fullBleedNoCutoutsContract: "pass",
    coherentDesignContract: "pass",
    briefFidelityContract: "pass",
    brandTextContract: "not_applicable",
    passengerMirrorContract: "pass",
    artifactFreeContract: "pass",
    confidence: 0.98,
    reasons: [],
  };
}

function payload(review) {
  return { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(review) }] } }] };
}

test("master acceptance grades the actual full-bleed authority before persistence", async () => {
  const masterBytes = await patternedMaster();
  const guideBytes = await sharp({
    create: { width: 300, height: 200, channels: 3, background: "#e5e5e5" },
  }).png().toBuffer();
  const deterministic = await deterministicMasterChecks(masterBytes, manifest);
  assert.equal(deterministic.accepted, true);
  assert.ok(deterministic.zones.every((zone) => zone.opaqueRatio === 1 && zone.edgeOpaqueRatio === 1));
  assert.ok(deterministic.passengerMirrorMae <= MAX_PASSENGER_MIRROR_MAE);

  let rawCalls = 0;
  const validate = createAtlasMasterValidator({
    provider: {
      generateRaw: async ({ body, model }) => {
        rawCalls += 1;
        assert.equal(model, "gemini-2.5-flash");
        assert.equal(body.generationConfig.responseMimeType, "application/json");
        assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
        assert.equal(body.generationConfig.maxOutputTokens, 2048);
        assert.deepEqual(body.generationConfig.responseSchema.required, _test.RESPONSE_FIELDS);
        return {
          payload: payload(passingReview(body)),
          model,
          keyFingerprint: "0123456789ab",
        };
      },
    },
  });
  const result = await validate({ masterBytes, guideBytes, manifest, input: { brief: "layered pool wrap" } });
  assert.equal(result.accepted, true);
  assert.equal(result.metadata.contract, MASTER_QC_CONTRACT);
  assert.equal(result.metadata.masterHash, _test.sha256(masterBytes));
  assert.equal(result.metadata.guideHash, _test.sha256(guideBytes));
  assert.equal(rawCalls, 1);
});

test("blank zones fail deterministically and never reach the semantic provider", async () => {
  const blank = await sharp({
    create: { width: 300, height: 200, channels: 4, background: { r: 229, g: 229, b: 229, alpha: 1 } },
  }).png().toBuffer();
  let rawCalls = 0;
  const validate = createAtlasMasterValidator({
    provider: { generateRaw: async () => { rawCalls += 1; throw new Error("must not run"); } },
  });
  const result = await validate({ masterBytes: blank, guideBytes: blank, manifest, input: {} });
  assert.equal(result.accepted, false);
  assert.equal(result.code, "atlas_master_qc_deterministic_failed");
  assert.match(result.reason, /lumaStddev/);
  assert.equal(rawCalls, 0);
});

test("master QC parser is identity-bound and rejects extra fields", () => {
  const masterHash = "a".repeat(64);
  const guideHash = "b".repeat(64);
  const review = {
    contract: MASTER_QC_CONTRACT,
    masterSha256: masterHash,
    guideSha256: guideHash,
    outputFormatContract: "pass",
    topologyContract: "pass",
    zoneCoverageContract: "pass",
    fullBleedNoCutoutsContract: "pass",
    coherentDesignContract: "pass",
    briefFidelityContract: "pass",
    brandTextContract: "not_applicable",
    passengerMirrorContract: "pass",
    artifactFreeContract: "pass",
    confidence: 0.98,
    reasons: [],
    commentary: "unbound prose",
  };
  assert.throws(
    () => parseMasterQcResponse(payload(review), { masterHash, guideHash }),
    (error) => error?.code === "atlas_master_qc_response_malformed",
  );
});


/**
 * A wrap panel is a solid rectangle -- the installer cuts the wheel opening and
 * the window out of the finished print. On 2026-08-23 the Becky's Bakery master
 * came back as a van silhouette with the arches and glass punched out and filled
 * flat black, and every deterministic check reported pass, because opaqueRatio
 * only asks whether a pixel is opaque and black is opaque.
 *
 * The discriminator is the SHARE of the zone that is artwork, not how bright the
 * artwork is: a mostly-black wrap still has vivid accents, so a mean taken over
 * its non-black pixels reads high and would convict it.
 */
async function cutoutZoneFixture({ holes, dark }) {
  const width = 400;
  const height = 200;
  const layers = [];
  for (let index = 0; index < 40; index += 1) {
    layers.push({
      input: await sharp({ create: { width: 12, height: 12, channels: 3, background: index % 2 ? "#a8d8f0" : "#f7c8a0" } }).png().toBuffer(),
      left: (index * 37) % (width - 12),
      top: (index * 53) % (height - 12),
    });
  }
  if (holes) {
    for (const [left, top, w, h] of [[40, 120, 70, 70], [270, 120, 70, 70], [120, 30, 150, 60]]) {
      layers.push({
        input: await sharp({ create: { width: w, height: h, channels: 3, background: "#000000" } }).png().toBuffer(),
        left, top,
      });
    }
  }
  return sharp({ create: { width, height, channels: 3, background: dark ? "#101010" : "#f2d8e8" } })
    .composite(layers).png().toBuffer();
}

const cutoutManifest = {
  zones: ["driver", "passenger"].map((surfaceKey) => ({ surfaceKey, x: 0, y: 0, w: 400, h: 200 })),
};

test("a zone with the wheel arches and glass cut out of it is refused", async () => {
  const bytes = await cutoutZoneFixture({ holes: true, dark: false });
  const result = await deterministicMasterChecks(bytes, cutoutManifest);
  assert.equal(result.accepted, false);
  assert.ok(
    result.failures.some((failure) => /flatBlackRatio/.test(failure) && /cut out of the panel/.test(failure)),
    `expected a cutout failure, got ${JSON.stringify(result.failures)}`,
  );
  assert.ok(result.zones[0].flatBlackRatio > 0.05);
  assert.ok(result.zones[0].nonBlackFraction >= 0.55, "the zone is still mostly artwork");
});

test("a solid panel of continuous artwork passes the cutout check", async () => {
  const bytes = await cutoutZoneFixture({ holes: false, dark: false });
  const result = await deterministicMasterChecks(bytes, cutoutManifest);
  assert.equal(result.zones[0].flatBlackRatio, 0);
  assert.equal(result.failures.filter((failure) => /flatBlackRatio/.test(failure)).length, 0);
});

test("a genuinely black wrap is not mistaken for a punched-out panel", async () => {
  const bytes = await cutoutZoneFixture({ holes: false, dark: true });
  const result = await deterministicMasterChecks(bytes, cutoutManifest);
  // Overwhelmingly flat black -- and legal, because the zone is not mostly
  // artwork with holes in it, it is a dark design.
  assert.ok(result.zones[0].flatBlackRatio > 0.5);
  assert.ok(result.zones[0].nonBlackFraction < 0.55);
  assert.equal(
    result.failures.filter((failure) => /flatBlackRatio/.test(failure)).length,
    0,
    "a dark design must not be convicted as a cutout",
  );
});
