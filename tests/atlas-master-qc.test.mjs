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
const { passengerMirrorMae } = _test;

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
    commentary: "unbound prose",
  };
  assert.throws(
    () => parseMasterQcResponse(payload(review), { masterHash, guideHash }),
    (error) => error?.code === "atlas_master_qc_response_malformed",
  );
});

test("vehicle anatomy in a print region fails the master before proof fan-out", async () => {
  const masterBytes = await patternedMaster();
  const guideBytes = await sharp({
    create: { width: 300, height: 200, channels: 3, background: "#e5e5e5" },
  }).png().toBuffer();
  const validate = createAtlasMasterValidator({
    provider: {
      generateRaw: async ({ body }) => ({
        payload: payload({
          ...passingReview(body),
          flatArtworkOnlyContract: "fail",
          reasons: ["front and rear regions depict truck doors and wheel arches"],
        }),
        model: "gemini-2.5-flash",
        keyFingerprint: "0123456789ab",
      }),
    },
  });
  const result = await validate({ masterBytes, guideBytes, manifest, input: {} });
  assert.equal(result.accepted, false);
  assert.equal(result.code, "atlas_master_qc_semantic_failed");
  assert.match(result.reason, /flatArtworkOnlyContract/);
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

/* ── What the component rule adds over the flat-black aggregate ────────── */

// The aggregate asks how much of the zone is flat black. The component rule
// asks whether any ONE shape is a hole. Those differ in both directions, and
// these fixtures pin each direction so neither rule can be dropped as redundant.

async function driverSheet(driverExtra) {
  const clean = await zoneTile("");
  const driver = await zoneTile(driverExtra);
  return sharp({
    create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(manifest.zones.map((zone) => ({
    input: zone.surfaceKey === "driver" ? driver : clean, left: zone.x, top: zone.y,
  }))).png().toBuffer();
}

async function zoneTile(extra) {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" fill="#082f49"/>
    <rect x="8" y="8" width="84" height="84" fill="#38bdf8"/>
    <rect x="20" y="20" width="60" height="60" fill="#f97316"/>
    <rect x="35" y="35" width="30" height="30" fill="#ffffff"/>
    ${extra}
  </svg>`)).png().toBuffer();
}

test("ONE wheel arch under the flat-black aggregate is still refused", async () => {
  // 5.3% of the zone: below MAX_ZONE_FLAT_BLACK_RATIO's reach in aggregate
  // terms once the interior erosion is applied, but unmistakable as a single
  // shape. This is the case the component rule exists for.
  const result = await deterministicMasterChecks(
    await driverSheet('<circle cx="50" cy="50" r="13" fill="#000000"/>'), manifest,
  );

  assert.equal(result.accepted, false);
  assert.match(result.failures.join(" "), /driver largestCutoutComponentRatio/);
  const driver = result.zones.find((zone) => zone.surfaceKey === "driver");
  assert.ok(
    driver.largestCutoutComponentRatio > _test.MAX_ZONE_CUTOUT_COMPONENT_RATIO,
    `expected the arch to clear the component bound, saw ${driver.largestCutoutComponentRatio}`,
  );
  // Proof the checks that predate this could not have caught it: it is opaque
  // and the zone's contrast is healthy.
  assert.ok(driver.opaqueRatio >= _test.MIN_ZONE_OPAQUE_RATIO);
  assert.ok(driver.lumaStddev >= _test.MIN_ZONE_LUMA_STDDEV);
});

test("a transparent punch is seen as a cut-out, not only as missing opacity", async () => {
  const driver = manifest.zones.find((zone) => zone.surfaceKey === "driver");
  const punched = await sharp(await driverSheet(""))
    .composite([{
      // `dest-out` removes wherever the SOURCE is opaque, so the punch must be solid.
      input: await sharp({ create: { width: 26, height: 26, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer(),
      left: driver.x + 30, top: driver.y + 30, blend: "dest-out",
    }])
    .png().toBuffer();

  const result = await deterministicMasterChecks(punched, manifest);
  assert.equal(result.accepted, false);
  // A near-black test is blind to this; the hole mask counts transparency too.
  const zone = result.zones.find((item) => item.surfaceKey === "driver");
  assert.ok(
    zone.largestCutoutComponentRatio > _test.MAX_ZONE_CUTOUT_COMPONENT_RATIO,
    `transparency must register as blob material, saw ${zone.largestCutoutComponentRatio}`,
  );
});

test("black lettering carrying more ink than one arch is not a cut-out", async () => {
  const strokes = Array.from({ length: 14 }, (_, index) =>
    `<rect x="${6 + index * 6}" y="70" width="3" height="16" fill="#000000"/>`).join("");
  const result = await deterministicMasterChecks(await driverSheet(strokes), manifest);

  const driver = result.zones.find((zone) => zone.surfaceKey === "driver");
  assert.ok(driver.cutoutComponentCount >= 10, "the fixture must be many separate strokes");
  assert.ok(
    driver.largestCutoutComponentRatio <= _test.MAX_ZONE_CUTOUT_COMPONENT_RATIO,
    "glyph strokes must not read as one punched-out opening",
  );
  assert.equal(result.accepted, true, result.failures.join("; "));
});

test("dark artwork texture past the aggregate bound is not convicted as cut-outs", async () => {
  // The first real master through this gate (2026-08-24) was refused with
  // "driver flatBlackRatio=0.073 across 3761 shapes ... wheel/glass/bed shapes
  // cut out of the panel". Three thousand shapes are not wheels: that is
  // anti-aliased lettering interiors and shadow detail, which the synthetic
  // flat-colour fixtures could never produce. Forty 6x6 specks reproduce the
  // signature -- raw interior ink past 5%, every component under the 0.25%
  // concentration floor.
  const specks = Array.from({ length: 40 }, (_, index) => {
    const x = 5 + (index % 8) * 11;
    const y = 5 + Math.floor(index / 8) * 11;
    return `<rect x="${x}" y="${y}" width="6" height="6" fill="#000000"/>`;
  }).join("");
  const result = await deterministicMasterChecks(await driverSheet(specks), manifest);

  const driver = result.zones.find((zone) => zone.surfaceKey === "driver");
  assert.ok(
    driver.flatBlackRatio > _test.MAX_ZONE_FLAT_BLACK_RATIO,
    `the fixture must exceed the raw aggregate the old rule convicted on, saw ${driver.flatBlackRatio}`,
  );
  assert.ok(driver.cutoutComponentCount >= 30, "the ink must be scattered, not concentrated");
  assert.ok(
    driver.concentratedFlatBlackRatio <= _test.MAX_ZONE_FLAT_BLACK_RATIO,
    `no component reaches the concentration floor, saw ${driver.concentratedFlatBlackRatio}`,
  );
  assert.equal(result.accepted, true, result.failures.join("; "));
});

test("a clean full-bleed sheet reports no cut-out component at all", async () => {
  const result = await deterministicMasterChecks(await driverSheet(""), manifest);
  assert.equal(result.accepted, true, result.failures.join("; "));
  for (const zone of result.zones) {
    assert.equal(zone.largestCutoutComponentRatio, 0, `${zone.surfaceKey} reported a phantom cut-out`);
    assert.equal(zone.cutoutComponentCount, 0);
  }
});

/* ── Passenger mirror MAE is telemetry, never structural authority ─────── */

// Passenger is its own named Call-1 surface. The historical mirror metric is
// still useful for continuity investigations, but legitimate forward-reading
// text and side-specific placement mean it cannot decide whether the flattened
// authority is structurally valid.

const sideBySideManifest = {
  zones: [
    { surfaceKey: "passenger", x: 0, y: 0, w: 200, h: 200 },
    { surfaceKey: "driver", x: 200, y: 0, w: 200, h: 200 },
  ],
};

async function motifTile() {
  // Asymmetric on purpose -- a left/right flip must actually change it, or a
  // mirror-comparison bug could hide behind an accidentally-symmetric fixture.
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
    <rect width="200" height="200" fill="#082f49"/>
    <polygon points="20,20 150,40 60,160" fill="#38bdf8"/>
    <circle cx="150" cy="130" r="30" fill="#f97316"/>
  </svg>`)).png().toBuffer();
}

async function textBand() {
  // A forward-reading "company name" band -- high-contrast strokes so a
  // flipped copy of it reads as clearly different from the original.
  const strokes = Array.from({ length: 10 }, (_, index) =>
    `<rect x="${10 + index * 18}" y="172" width="10" height="20" fill="#ffffff"/>`).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
    <rect x="0" y="168" width="200" height="32" fill="#000000"/>
    ${strokes}
  </svg>`)).png().toBuffer();
}

async function trueMirrorMasterWithForwardText() {
  const motif = await motifTile();
  const band = await textBand();
  const driverZone = await sharp(motif).composite([{ input: band }]).png().toBuffer();
  const flippedMotif = await sharp(motif).flop().toBuffer();
  const passengerZone = await sharp(flippedMotif).composite([{ input: band }]).png().toBuffer();
  return sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: passengerZone, left: 0, top: 0 },
      { input: driverZone, left: 200, top: 0 },
    ]).png().toBuffer();
}

async function unrelatedPassengerMaster() {
  const motif = await motifTile();
  const band = await textBand();
  const driverZone = await sharp(motif).composite([{ input: band }]).png().toBuffer();
  const passengerZone = await sharp({
    create: { width: 200, height: 200, channels: 3, background: "#facc15" },
  }).composite([{
    input: await sharp({ create: { width: 60, height: 60, channels: 3, background: "#7c3aed" } }).png().toBuffer(),
    left: 70, top: 70,
  }]).png().toBuffer();
  return sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: passengerZone, left: 0, top: 0 },
      { input: driverZone, left: 200, top: 0 },
    ]).png().toBuffer();
}

/* ── A cut-out is a PRINT defect, not a broken design ───────────────────── */

// The 3D proof masks the master to the real painted body, so a hole where the
// wheel arch sits lands in the region the mask discards -- live proof, the
// Flamingo Pools seven-view set (DID-5B2EB96C) came out of a completely ungated
// cut-out master and every proof is correct. The hole only becomes real at the
// panel cut. So it is carried as a flag on the affected surfaces, and the
// design plus its seven proofs survive; PanelPro's human QC catches the panel
// on the template before it prints.

test("cut-out findings are classified apart from design-breaking failures", async () => {
  const holed = await deterministicMasterChecks(await driverSheet('<circle cx="50" cy="50" r="13" fill="#000000"/>'), manifest);
  assert.ok(holed.cutoutFindings.length > 0, "the arch must be found");
  assert.deepEqual(holed.cutoutFindings.map((item) => item.surfaceKey), ["driver"]);
  assert.deepEqual(holed.blockingFailures, [], "a hole is a print defect, not a broken design");
  assert.equal(holed.accepted, false, "spotless still means spotless");
});

test("a blank master is a broken design, and its failure is blocking", async () => {
  const blank = await sharp({
    create: { width: 300, height: 200, channels: 4, background: { r: 229, g: 229, b: 229, alpha: 1 } },
  }).png().toBuffer();
  const result = await deterministicMasterChecks(blank, manifest);
  assert.ok(result.blockingFailures.length > 0, "no contrast is not a print defect, it is no design");
  assert.match(result.blockingFailures.join("; "), /lumaStddev/);
  assert.deepEqual(result.cutoutFindings, []);
});

test("a cut-out master still earns its design review, and returns flagged with a full QC record", async () => {
  const masterBytes = await driverSheet('<circle cx="50" cy="50" r="13" fill="#000000"/>');
  const guideBytes = await sharp({
    create: { width: 300, height: 200, channels: 3, background: "#e5e5e5" },
  }).png().toBuffer();

  let rawCalls = 0;
  const validate = createAtlasMasterValidator({
    provider: {
      generateRaw: async ({ body, model }) => {
        rawCalls += 1;
        return { payload: payload(passingReview(body)), model, keyFingerprint: "0123456789ab" };
      },
    },
  });
  const result = await validate({ masterBytes, guideBytes, manifest, input: {} });

  // It is going to be shown to the customer as seven proofs, so it still has to
  // be coherent, faithful and correctly lettered.
  assert.equal(rawCalls, 1, "a cut-out must NOT short-circuit the design review");
  // Not spotless -- the authoring loop keeps re-rolling for a clean sheet.
  assert.equal(result.accepted, false);
  assert.equal(result.code, "atlas_master_qc_cutouts_present");
  assert.deepEqual(result.cutout.surfaces, ["driver"]);
  assert.equal(result.cutout.semantic, false, "the reviewer saw no hole; the pixels did");

  // The decisive part: a COMPLETE record, so the exhausted-re-roll path can
  // persist the design instead of destroying it for want of metadata.
  assert.equal(result.metadata.contract, MASTER_QC_CONTRACT);
  assert.equal(result.metadata.masterHash, _test.sha256(masterBytes));
  assert.equal(result.metadata.guideHash, _test.sha256(guideBytes));
  assert.ok(result.metadata.confidence >= 0.92);
  assert.ok(result.review, "the design review is retained");
});

test("a design-breaking failure never reaches the review and carries no cut-out flag", async () => {
  const blank = await sharp({
    create: { width: 300, height: 200, channels: 4, background: { r: 229, g: 229, b: 229, alpha: 1 } },
  }).png().toBuffer();
  let rawCalls = 0;
  const validate = createAtlasMasterValidator({
    provider: { generateRaw: async () => { rawCalls += 1; throw new Error("must not run"); } },
  });
  const result = await validate({ masterBytes: blank, guideBytes: blank, manifest, input: {} });
  assert.equal(rawCalls, 0);
  assert.equal(result.accepted, false);
  assert.equal(result.code, "atlas_master_qc_deterministic_failed");
  assert.equal(result.cutout, undefined, "nothing to flag -- there is no design to keep");
  assert.equal(result.metadata, undefined);
});

test("a true mirror twin with identical forward-reading text on both flanks passes", async () => {
  const bytes = await trueMirrorMasterWithForwardText();
  const mae = await passengerMirrorMae(bytes, sideBySideManifest);
  assert.ok(mae <= MAX_PASSENGER_MIRROR_MAE, `expected the trimmed mean to absorb the text band, saw ${mae}`);
});

test("an independently authored Passenger is measured without becoming a blocker", async () => {
  const bytes = await unrelatedPassengerMaster();
  const mae = await passengerMirrorMae(bytes, sideBySideManifest);
  assert.ok(mae > MAX_PASSENGER_MIRROR_MAE, `fixture must exceed the historical diagnostic threshold, saw ${mae}`);
  const checks = await deterministicMasterChecks(bytes, sideBySideManifest);
  assert.equal(checks.passengerMirrorMae, mae);
  assert.equal(
    checks.blockingFailures.some((finding) => /passengerMirrorMae/.test(finding)),
    false,
    "Passenger similarity must never be a structural release gate",
  );
});

// A ZONE THAT PAINTS A TRANSPARENCY CHECKERBOARD IS A PICTURE OF A CUT-OUT PNG.
//
// Live evidence 2026-08-26, the Precision Climate Solutions canary: the master
// came back as a truck silhouette with flat-black wheel arches and, filling
// everything the truck did not occupy, a PAINTED grey-and-white checkerboard —
// the pattern a design tool shows to mean "transparent". The image carried no
// alpha at all, so CUTOUT_ALPHA_MAX measured 0.0%; the checkerboard is light, so
// FLAT_BLACK_CHANNEL_MAX never looked at it. Only the black arches were seen,
// and those are the non-fatal cut-out class — so the sheet would have been
// accepted, the arches filled, and a fifth of each flank printed as a grey
// checkerboard on real vinyl.
//
// It is blocking rather than a cut-out because the fill cannot repair it: it
// masks from those same two thresholds and trips neither, and outside the
// silhouette there is no surrounding livery to grow inward.
test("a painted transparency checkerboard convicts, and light artwork does not", async () => {
  const { paintedCheckerboardSignature } = await import("../runtime/atlas-master-qc.cjs")
    .then((m) => m.default ?? m);

  const zone = { surfaceKey: "driver", x: 0, y: 0, w: 1200, h: 800 };
  const cell = 80;
  const squares = [];
  for (let y = 0; y < 800; y += cell) {
    for (let x = 0; x < 1200; x += cell) {
      const light = ((x / cell) + (y / cell)) % 2 === 0;
      squares.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${light ? "#ffffff" : "#e5e5e5"}"/>`);
    }
  }
  const checkerboard = await sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">${squares.join("")}
     <path d="M150 250 L1050 250 L1050 650 L150 650 Z" fill="#0d2f63"/>
     <path d="M150 520 C 400 380 700 600 1050 430 L1050 650 L150 650 Z" fill="#e8621f"/></svg>`,
  )).png().toBuffer();

  const convicted = await paintedCheckerboardSignature(checkerboard, zone);
  assert.equal(convicted.convicted, true, "a painted checkerboard must be blocking");
  assert.ok(convicted.alternation >= 0.8, `alternation ${convicted.alternation} must read as a grid`);

  // THE FALSE POSITIVE THAT MATTERS. A design whose light neutral region is a
  // SOLID panel, not a grid — one tone, no alternation. design-panel-ai-generate's
  // own artboard sheet is 56.6% light neutral grey and measures alternation 0.08.
  const solidLightPanel = await sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
     <rect width="1200" height="800" fill="#f2f2f2"/>
     <path d="M0 520 C 400 380 700 600 1200 430 L1200 800 L0 800 Z" fill="#e8621f"/>
     <circle cx="300" cy="260" r="150" fill="#0d2f63"/></svg>`,
  )).png().toBuffer();
  const light = await paintedCheckerboardSignature(solidLightPanel, zone);
  assert.equal(light.convicted, false, "a solid light panel is artwork, not a checkerboard");

  // And a smooth neutral gradient, which is light and colourless everywhere.
  const gradient = await sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
     <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c8c8c8"/></linearGradient></defs>
     <rect width="1200" height="800" fill="url(#g)"/></svg>`,
  )).png().toBuffer();
  assert.equal((await paintedCheckerboardSignature(gradient, zone)).convicted, false,
    "a neutral gradient is not a grid");
});

/**
 * ⛔ A VEHICLE SILHOUETTE ON A BLACK SURROUND IS A BLOCKING FAILURE.
 *
 * Owner, 2026-08-31, looking at the accepted Oasis Pools master: "Look at
 * A.T.L.A.S. it's worse then ai slop no wonder panels are shit."
 *
 * That master was ACCEPTED. Every gate passed, because:
 *   - `edgeOpaqueRatio` is the blocking full-bleed test and it measures ALPHA.
 *     A black surround is perfectly opaque, so it scored 1.00000.
 *   - the cut-out class is deliberately non-blocking at ANY size, so a single
 *     component covering 30.3% of the roof and 28.7% of the rear was recorded,
 *     "filled", and published.
 *
 * The recorded findings, verbatim from the live revision:
 *   roof      largest component 30.3%, zone 66.9% artwork
 *   rear      largest component 28.7%, zone 58.9% artwork
 *   passenger largest component 11.7%, zone 71.8% artwork
 *   driver    largest component 11.1%, zone 63.8% artwork
 *   front     largest component  6.3%, zone 79.3% artwork
 *
 * This fixture reproduces that profile: a zone that is MAJORITY artwork, with
 * the artwork confined to a shape that never reaches the border.
 */
async function silhouetteOnBlackMaster() {
  // Artwork covers a MAJORITY of the tile -- inside the 58.9-79.3% band the
  // five real zones measured -- and all of it sits inside an island that stops
  // short of the border on every side, exactly the "shape floating on a
  // surround" the owner is looking at. The inset is 6px against a 4px border
  // ring, so the whole ring is black while the zone stays majority artwork:
  // the precise combination every existing gate scored as a pass.
  const tile = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" fill="#000000"/>
    <rect x="6" y="6" width="88" height="88" rx="26" fill="#38bdf8"/>
    <rect x="20" y="20" width="60" height="60" rx="14" fill="#f97316"/>
    <rect x="35" y="35" width="30" height="30" fill="#ffffff"/>
  </svg>`)).png().toBuffer();
  return sharp({
    create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(manifest.zones.map((zone) => ({ input: tile, left: zone.x, top: zone.y }))).png().toBuffer();
}

test("a majority-artwork zone whose design never reaches its border is BLOCKING", async () => {
  const master = await silhouetteOnBlackMaster();
  const result = await deterministicMasterChecks(master, manifest);

  assert.equal(result.accepted, false, "a silhouette on a surround must never be accepted");
  const edgeFailures = result.blockingFailures.filter((line) => line.includes("edgeHoleRatio"));
  assert.ok(edgeFailures.length > 0,
    `the border-hole rule must convict, and as BLOCKING. failures: ${JSON.stringify(result.failures)}`);
  assert.match(edgeFailures[0], /not a full-bleed printable rectangle/);

  // And it must be BLOCKING, not filed as a repairable cut-out. The fill closes
  // a hole as "a soft continuation of its own border" -- on a silhouette that
  // smears the black surround inward as fake livery, which is why this class
  // can never be handed to the repair.
  const asCutout = result.cutoutFindings.filter((entry) => String(entry.finding).includes("edgeHoleRatio"));
  assert.equal(asCutout.length, 0, "the silhouette rule must never be filed as a repairable cut-out");
});

test("a legitimate black wrap still passes the border-hole rule", async () => {
  // THE GUARD THAT KEEPS THIS HONEST. CLAUDE.md: a black wrap is "90% flat
  // black with 10% artwork (passes)". Its border IS black, so without the
  // bright-majority guard the rule above would convict every black wrap ever
  // designed -- the exact class of false conviction this file was built to
  // prevent twice before.
  const tile = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" fill="#050505"/>
    <rect x="10" y="44" width="80" height="7" fill="#f97316"/>
    <rect x="10" y="56" width="52" height="4" fill="#38bdf8"/>
  </svg>`)).png().toBuffer();
  const master = await sharp({
    create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(manifest.zones.map((zone) => ({ input: tile, left: zone.x, top: zone.y }))).png().toBuffer();

  const result = await deterministicMasterChecks(master, manifest);
  const edgeFailures = result.blockingFailures.filter((line) => line.includes("edgeHoleRatio"));
  assert.equal(edgeFailures.length, 0,
    `a black wrap must not be convicted as a silhouette: ${JSON.stringify(edgeFailures)}`);
});
