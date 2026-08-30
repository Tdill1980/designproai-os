// A CUT-OUT MUST REACH THE REPAIR STAGE THE SYSTEM ALREADY HAS.
//
// RULE 0.15 is explicit that a cut-out never destroys the design: the 3D proof
// masks the master to the painted body, so a hole where the wheel arch sits
// lands in the region the mask discards, and the hole only becomes real at the
// panel cut -- where atlas-cutout-fill.cjs closes it deterministically.
// `fullBleedNoCutoutsContract` is deliberately absent from the fatal
// `requiredPass` list for exactly that reason.
//
// The reviewer records the same holes a SECOND time under
// `zoneCoverageContract`, which IS fatal, and that conviction returned before
// the cut-out classification could run. So the repair was unreachable:
//
//     detect cut-out -> classify repairable -> reviewer sees the same cut-out
//       -> master killed -> fill never runs
//
// Live evidence 2026-08-25, canary ff1566c3-1c46-42b4-87a8-0209d63a72ec: three
// authoring attempts refused on zoneCoverageContract ALONE -- every finding a
// wheel/glass shape, artifactFreeContract passing, nothing else failing -- and
// the run died with zero revisions. A design the architecture says should have
// survived and been repaired.
//
// These tests pin the narrow escape and, just as importantly, everything that
// must stay fatal around it. No threshold moves; nothing is reclassified as a
// cut-out that was not already one.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");

const {
  MASTER_QC_CONTRACT,
  createAtlasMasterValidator,
  deterministicMasterChecks,
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
    passenger: "left", driver: "right",
    centerOrderTopToBottom: ["rear", "roof", "hood", "front"],
  },
};

const guideBytes = await sharp({
  create: { width: 300, height: 200, channels: 3, background: "#e5e5e5" },
}).png().toBuffer();

/**
 * A sheet that is bright artwork everywhere except ONE flat-black disc per
 * zone -- a wheel arch. Opaque throughout, so it clears the deterministic
 * full-bleed floor and reaches the semantic stage exactly as the live masters
 * did; the disc is what `largestCutoutComponentRatio` convicts.
 */
async function masterWithWheelArches() {
  const tile = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" fill="#0f766e"/>
    <rect x="6" y="6" width="88" height="88" fill="#f59e0b"/>
    <rect x="26" y="26" width="48" height="48" fill="#e11d48"/>
    <circle cx="50" cy="50" r="14" fill="#000000"/>
  </svg>`)).png().toBuffer();
  return sharp({ create: { width: 300, height: 200, channels: 4, background: "#000000" } })
    .composite(manifest.zones.map((zone) => ({ input: tile, left: zone.x, top: zone.y })))
    .png().toBuffer();
}

/** Textured artwork, no holes anywhere -- a clean sheet. */
async function cleanMaster() {
  const tile = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" fill="#0f766e"/>
    <rect x="6" y="6" width="88" height="88" fill="#f59e0b"/>
    <rect x="26" y="26" width="48" height="48" fill="#e11d48"/>
    <rect x="44" y="44" width="12" height="12" fill="#ffffff"/>
  </svg>`)).png().toBuffer();
  return sharp({ create: { width: 300, height: 200, channels: 4, background: "#000000" } })
    .composite(manifest.zones.map((zone) => ({ input: tile, left: zone.x, top: zone.y })))
    .png().toBuffer();
}

function review(body, overrides = {}) {
  const props = body.generationConfig.responseSchema.properties;
  return {
    contract: MASTER_QC_CONTRACT,
    masterSha256: props.masterSha256.enum[0],
    guideSha256: props.guideSha256.enum[0],
    outputFormatContract: "pass",
    flatArtworkOnlyContract: "pass",
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
    driverBrandBands: [],
    ...overrides,
  };
}

function validatorReturning(overrides) {
  return createAtlasMasterValidator({
    provider: {
      generateRaw: async ({ body, model }) => ({
        payload: {
          candidates: [{
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(review(body, overrides)) }] },
          }],
        },
        model,
        keyFingerprint: "0123456789ab",
      }),
    },
  });
}

const INPUT = { brief: "layered commercial wrap" };

test("the fixture actually produces classified cut-outs and clears the full-bleed floor", async () => {
  // If this drifts, every test below is grading the wrong thing.
  const checks = await deterministicMasterChecks(await masterWithWheelArches(), manifest);
  assert.equal(checks.blockingFailures.length, 0,
    `the arch fixture must not fail deterministically: ${checks.blockingFailures.join("; ")}`);
  assert.ok(checks.cutoutFindings.length > 0, "the arch fixture must be classified as cut-outs");
  const clean = await deterministicMasterChecks(await cleanMaster(), manifest);
  assert.equal(clean.accepted, true, `the clean fixture must pass: ${clean.failures.join("; ")}`);
});

// A. cut-out-only zoneCoverageContract failure -> non-fatal cut-out path
test("A: coverage failing on classified cut-outs alone reaches the repair path", async () => {
  const validate = validatorReturning({
    zoneCoverageContract: "fail",
    fullBleedNoCutoutsContract: "fail",
    reasons: ["the driver zone has a wheel shape cut out of the panel"],
    driverBrandBands: [],
  });
  const result = await validate({
    masterBytes: await masterWithWheelArches(), guideBytes, manifest, input: INPUT,
  });
  assert.equal(result.code, "atlas_master_qc_cutouts_present",
    `expected the repair path, got ${result.code}: ${result.reason}`);
  assert.equal(result.accepted, false, "a cut-out master is still not spotless");
  assert.ok(result.cutout.surfaces.length > 0, "the affected surfaces must be named for PanelPro");
  // The metadata block is what flat-first-atlas.cjs requires before it will
  // break out and keep the design; without it the run still dies.
  assert.equal(result.metadata.contract, MASTER_QC_CONTRACT);
  assert.equal(result.metadata.masterHash, _test.sha256(await masterWithWheelArches()));
});

// B. zoneCoverage failing for anything other than classified cut-outs -> fatal
test("B: coverage failing without classified cut-outs stays fatal", async () => {
  // Same reviewer verdict, but on a master the deterministic layer found clean.
  // Nothing was measured as a hole, so there is nothing to repair.
  const validate = validatorReturning({
    zoneCoverageContract: "fail",
    fullBleedNoCutoutsContract: "fail",
    reasons: ["the hood zone contains a transparent area"],
    driverBrandBands: [],
  });
  const result = await validate({ masterBytes: await cleanMaster(), guideBytes, manifest, input: INPUT });
  assert.equal(result.code, "atlas_master_qc_semantic_failed");
  assert.match(result.reason, /zoneCoverageContract/);
});

test("B2: coverage failing while the reviewer reports NO holes stays fatal", async () => {
  // The discriminator that keeps a genuinely unpainted zone fatal: the reviewer
  // must itself agree the coverage problem is holes. Transparency without holes
  // leaves fullBleedNoCutoutsContract passing, so this is not repairable.
  const validate = validatorReturning({
    zoneCoverageContract: "fail",
    fullBleedNoCutoutsContract: "pass",
    reasons: ["the hood zone contains a transparent area, violating full bleed"],
    driverBrandBands: [],
  });
  const result = await validate({
    masterBytes: await masterWithWheelArches(), guideBytes, manifest, input: INPUT,
  });
  assert.equal(result.code, "atlas_master_qc_semantic_failed");
});

// C. cut-outs plus another fatal semantic failure -> still fatal
test("C: cut-outs alongside any other fatal contract stay fatal", async () => {
  for (const [field, label] of [
    ["coherentDesignContract", "coherence"],
    ["topologyContract", "topology"],
    ["briefFidelityContract", "brief fidelity"],
    ["passengerMirrorContract", "passenger mirror"],
    ["outputFormatContract", "output format"],
    ["flatArtworkOnlyContract", "flat artwork only"],
  ]) {
    const validate = validatorReturning({
      zoneCoverageContract: "fail",
      fullBleedNoCutoutsContract: "fail",
      [field]: "fail",
      reasons: [`wheel shape cut out, and ${label} is broken`],
    driverBrandBands: [],
    });
    const result = await validate({
      masterBytes: await masterWithWheelArches(), guideBytes, manifest, input: INPUT,
    });
    assert.equal(result.code, "atlas_master_qc_semantic_failed",
      `${field} must remain fatal even beside cut-outs`);
    assert.match(result.reason, new RegExp(field));
  }
});

test("C2: low confidence beside cut-outs stays fatal", async () => {
  const validate = validatorReturning({
    zoneCoverageContract: "fail",
    fullBleedNoCutoutsContract: "fail",
    confidence: 0.4,
    reasons: ["wheel shape cut out"],
    driverBrandBands: [],
  });
  const result = await validate({
    masterBytes: await masterWithWheelArches(), guideBytes, manifest, input: INPUT,
  });
  assert.equal(result.code, "atlas_master_qc_semantic_failed");
  assert.match(result.reason, /confidence/);
});

// D. artifactFreeContract failure -> still fatal
test("D: an artifact-free failure stays fatal, cut-outs or not", async () => {
  // This is the guide-label defect. It must never be laundered through the
  // cut-out escape: a surface name painted into the artwork prints on the vinyl
  // and no deterministic fill removes it.
  for (const master of [await masterWithWheelArches(), await cleanMaster()]) {
    const validate = validatorReturning({
      zoneCoverageContract: "fail",
      fullBleedNoCutoutsContract: "fail",
      artifactFreeContract: "fail",
      reasons: ["the hood zone contains the guide label 'HOOD'"],
    driverBrandBands: [],
    });
    const result = await validate({ masterBytes: master, guideBytes, manifest, input: INPUT });
    assert.equal(result.code, "atlas_master_qc_semantic_failed");
    assert.match(result.reason, /artifactFreeContract/);
  }
});

test("D2: artifact-free may alias the same measured cut-out without buying another design call", async () => {
  const validate = validatorReturning({
    zoneCoverageContract: "fail",
    fullBleedNoCutoutsContract: "fail",
    artifactFreeContract: "fail",
    reasons: ["roof contains one wheel/glass/bed shape cut out of the panel"],
    driverBrandBands: [],
  });
  const result = await validate({
    masterBytes: await masterWithWheelArches(), guideBytes, manifest, input: INPUT,
  });
  assert.equal(result.code, "atlas_master_qc_cutouts_present");
  assert.ok(result.cutout.surfaces.length > 0);
});

test("D3: mixed cut-out and real artifact language remains fatal", async () => {
  const validate = validatorReturning({
    zoneCoverageContract: "fail",
    fullBleedNoCutoutsContract: "fail",
    artifactFreeContract: "fail",
    reasons: ["wheel opening is cut out and a guide label is printed on the panel"],
    driverBrandBands: [],
  });
  const result = await validate({
    masterBytes: await masterWithWheelArches(), guideBytes, manifest, input: INPUT,
  });
  assert.equal(result.code, "atlas_master_qc_semantic_failed");
});

// E. deterministic thresholds unchanged
test("E: the deterministic thresholds this fix relies on are unchanged", async () => {
  assert.equal(_test.MIN_ZONE_OPAQUE_RATIO, 0.995);
  assert.equal(_test.MIN_ZONE_EDGE_OPAQUE_RATIO, 0.99);
  assert.equal(_test.MIN_ZONE_LUMA_STDDEV, 6);
  assert.equal(_test.MAX_ZONE_CUTOUT_COMPONENT_RATIO, 0.02);
  assert.equal(_test.MAX_ZONE_FLAT_BLACK_RATIO, 0.05);
  assert.equal(_test.CUTOUT_BRIGHT_MAJORITY, 0.55);
  assert.equal(_test.MIN_CUTOUT_COMPONENT_RATIO, 0.0025);
  assert.equal(_test.DEFAULT_CONFIDENCE_THRESHOLD, 0.92);
  // A blank or unpainted zone is still a broken DESIGN and still short-circuits
  // before the provider is ever called -- the escape cannot reach it.
  const blank = await sharp({
    create: { width: 300, height: 200, channels: 4, background: { r: 229, g: 229, b: 229, alpha: 1 } },
  }).png().toBuffer();
  let calls = 0;
  const validate = createAtlasMasterValidator({
    provider: { generateRaw: async () => { calls += 1; throw new Error("must not run"); } },
  });
  const result = await validate({ masterBytes: blank, guideBytes, manifest, input: INPUT });
  assert.equal(result.code, "atlas_master_qc_deterministic_failed");
  assert.equal(calls, 0, "a broken design must never reach the semantic reviewer");
});

test("a spotless master is still accepted, and still requires zero findings", async () => {
  const validate = validatorReturning({});
  const result = await validate({ masterBytes: await cleanMaster(), guideBytes, manifest, input: INPUT });
  assert.equal(result.accepted, true);
  assert.equal(result.metadata.contract, MASTER_QC_CONTRACT);
});
