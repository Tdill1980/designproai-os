/**
 * THE COMPOSITION IS EXECUTED HERE, NOT DESCRIBED.
 *
 * `tests/atlas-repair-before-reroll.test.mjs` pins where the composition sits
 * and what it must refuse, by reading the source. That is the right test for
 * "the guard exists", and it is worth nothing as evidence that the guard RUNS:
 * a source assertion passes just as happily over code that throws on its first
 * real buffer.
 *
 * This file calls `composePassengerFromDriver` with real PNG bytes, a real
 * GENIE-shaped manifest and a fake provider, and checks the pixels that come
 * back. Every decline path is exercised as a path, not as a string.
 *
 * The owner's ruling (2026-09-07) is "we need a mirrored version for passenger
 * of driver". The two things that ruling must not cost are asserted directly:
 * a design whose lettering cannot be located keeps its authored passenger, and
 * no failure anywhere becomes a thrown error that would fail an accepted run.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const { _test } = require("../runtime/flat-first-atlas.cjs");
const { composePassengerFromDriver } = _test;
const masterQc = require("../runtime/atlas-master-qc.cjs");

const ZONE = { w: 240, h: 120 };
const CANVAS = { widthPx: 1040, heightPx: 320 };

/**
 * SIX ZONES, BECAUSE THE BAND READER DEMANDS SIX.
 *
 * `requireManifest` in atlas-master-qc refuses anything but the exact six-zone
 * A.T.L.A.S. manifest -- so a two-flank fixture cannot reach the band read at
 * all, and a mirror test built on one would silently exercise only the decline
 * paths while appearing to cover the composition. The centre four are present
 * for that reason and are never touched by the composition.
 */
const CENTRE = { w: 200, h: 100 };
const manifest = {
  canvas: CANVAS,
  zones: [
    { surfaceKey: "driver", x: 10, y: 20, ...ZONE },
    { surfaceKey: "passenger", x: 270, y: 20, ...ZONE },
    { surfaceKey: "hood", x: 530, y: 20, ...CENTRE },
    { surfaceKey: "roof", x: 750, y: 20, ...CENTRE },
    { surfaceKey: "front", x: 530, y: 160, ...CENTRE },
    { surfaceKey: "rear", x: 750, y: 160, ...CENTRE },
  ].map((zone) => ({
    ...zone,
    rotationDegrees: 0,
    extraction: { x: zone.x, y: zone.y, w: zone.w, h: zone.h, outputRotationDegrees: 0 },
  })),
};

/** An asymmetric panel, so a mirror is detectable rather than a no-op. */
async function panel(w, h, wordFill) {
  return sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
       <rect width="100%" height="100%" fill="#1b6fa8"/>
       <polygon points="0,0 ${Math.round(w * 0.38)},0 ${Math.round(w * 0.08)},${h}" fill="#f2c14e"/>
       <circle cx="${Math.round(w * 0.83)}" cy="${Math.round(h * 0.25)}" r="${Math.round(h * 0.15)}" fill="#e8567c"/>
       <rect x="${Math.round(w * 0.25)}" y="${Math.round(h * 0.66)}" width="${Math.round(w * 0.46)}" height="${Math.round(h * 0.2)}" fill="${wordFill}"/>
     </svg>`,
  )).png().toBuffer();
}

async function master() {
  const composites = await Promise.all(manifest.zones.map(async (zone) => ({
    input: await panel(zone.w, zone.h, zone.surfaceKey === "passenger" ? "#111111" : "#ffffff"),
    left: zone.x,
    top: zone.y,
  })));
  return sharp({ create: { width: CANVAS.widthPx, height: CANVAS.heightPx, channels: 3, background: "#ffffff" } })
    .composite(composites).png().toBuffer();
}

const guideBytes = () => sharp({
  create: { width: CANVAS.widthPx, height: CANVAS.heightPx, channels: 3, background: "#111111" },
}).png().toBuffer();

/**
 * A provider that answers the master-QC schema exactly.
 *
 * THE ECHOED HASHES ARE OF THE ORIGINAL BYTES, NOT THE ONES ON THE WIRE. The
 * validator computes its identity from the buffers it was handed and then sends
 * `boundedTransport` copies -- resized and re-encoded to fit the request budget
 * -- so a fake that hashes the inline parts fails `atlas_master_qc_identity_
 * mismatch` and returns no bands. That is the real binding working; the harness
 * has to respect it rather than route around it.
 */
function providerReturning(bands, { masterHash, guideHash, onCall = () => {} } = {}) {
  return {
    generateRaw: async ({ body }) => {
      onCall(body);
      const review = {
        contract: masterQc.MASTER_QC_CONTRACT,
        masterSha256: masterHash,
        guideSha256: guideHash,
        outputFormatContract: "pass", flatArtworkOnlyContract: "pass",
        topologyContract: "pass", zoneCoverageContract: "pass",
        fullBleedNoCutoutsContract: "pass", coherentDesignContract: "pass",
        briefFidelityContract: "pass", brandTextContract: "pass",
        passengerMirrorContract: "not_applicable", artifactFreeContract: "pass",
        confidence: 1, reasons: [], driverBrandBands: bands,
      };
      return { payload: { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(review) }] } }] } };
    },
  };
}

const sha = (bytes) => masterQc._test.sha256(bytes);

const NO_BRAND = { vehicle: { year: "2022", make: "Ford", model: "Transit Connect" } };
const WITH_BRAND = { ...NO_BRAND, companyName: "Arctic Air", phone: "555-0142" };

/** The real QC comparison, so this file cannot drift from the gate. */
async function mirrorMae(bytes) {
  return masterQc._test.passengerMirrorMae(bytes, manifest);
}

test("a design with no brand strings mirrors, and never calls the provider", async () => {
  let calls = 0;
  const result = await composePassengerFromDriver({
    masterBytes: await master(),
    manifest,
    guideBytes: await guideBytes(),
    input: NO_BRAND,
    provider: providerReturning([], { onCall: () => { calls += 1; } }),
  });

  assert.equal(result.composed, true, result.reason || "");
  assert.equal(calls, 0, "a design with no lettering must not spend a band read");
  assert.equal(result.bandsApplied, 0);
  assert.ok(Buffer.isBuffer(result.bytes) && result.bytes.length > 0);
});

test("the composed flank is actually Driver mirrored, measured by the gate's own comparison", async () => {
  const before = await master();
  const result = await composePassengerFromDriver({
    masterBytes: before, manifest, guideBytes: await guideBytes(),
    input: NO_BRAND, provider: providerReturning([]),
  });
  assert.equal(result.composed, true);

  // The authored passenger was a different flank; the composed one is Driver's
  // twin. This is the same measurement `deterministicMasterChecks` reports.
  const maeBefore = await mirrorMae(before);
  const maeAfter = await mirrorMae(result.bytes);
  assert.ok(maeBefore > 0.05, `the fixture must start asymmetric (was ${maeBefore})`);
  assert.ok(maeAfter < 0.01, `the composed flank must be Driver's mirror (was ${maeAfter})`);

  // The DRIVER half must be untouched -- composition writes one zone only.
  const driverOf = (bytes) => sharp(bytes)
    .extract({ left: 10, top: 20, width: ZONE.w, height: ZONE.h }).raw().toBuffer();
  assert.deepEqual(await driverOf(result.bytes), await driverOf(before), "Driver must not be rewritten");
});

test("a lettered design composes when the bands are located, and re-drops them un-flipped", async () => {
  const bands = [{ xPct: 0.25, yPct: 0.66, wPct: 0.46, hPct: 0.2 }];
  const masterBytes = await master();
  const guide = await guideBytes();
  const result = await composePassengerFromDriver({
    masterBytes, manifest, guideBytes: guide, input: WITH_BRAND,
    provider: providerReturning(bands, { masterHash: sha(masterBytes), guideHash: sha(guide) }),
  });

  assert.equal(result.composed, true, result.reason || "");
  assert.equal(result.bandsApplied, 1, "the located band must be re-dropped");
  assert.equal(result.brandStringCount, 2);

  // The band is the deliberate divergence from a pure mirror: the artwork is
  // flipped, the lettering is not. The gate's trimmed mean absorbs exactly one
  // band's worth, so the result must still read as a mirror.
  const mae = await mirrorMae(result.bytes);
  assert.ok(mae < 0.26, `a re-dropped band must not break the mirror check (was ${mae})`);
});

// ── EVERY DECLINE IS A PATH, AND NONE OF THEM THROWS ────────────────────────

test("a lettered design whose bands cannot be located keeps its authored passenger", async () => {
  const before = await master();
  const result = await composePassengerFromDriver({
    masterBytes: before, manifest, guideBytes: await guideBytes(),
    input: WITH_BRAND, provider: providerReturning([]),
  });

  assert.equal(result.composed, false);
  assert.equal(result.reason, "brand_bands_not_located");
  assert.equal(result.bytes, undefined, "a decline must return no bytes to promote");
  // The caller keeps `masterBytes`, so the authored passenger survives -- which
  // is the behaviour of every run before this change.
  assert.ok((await mirrorMae(before)) > 0.05, "the authored flank is untouched");
});

test("an absent reader declines instead of composing blind", async () => {
  const bytes = await master();
  const guide = await guideBytes();
  for (const [label, args] of [
    ["no provider", { provider: null }],
    ["provider without generateRaw", { provider: {} }],
    ["no guide", { provider: providerReturning([{ xPct: 0.1, yPct: 0.1, wPct: 0.2, hPct: 0.2 }]), guideBytes: null }],
  ]) {
    const result = await composePassengerFromDriver({
      masterBytes: bytes, manifest, guideBytes: guide, input: WITH_BRAND, ...args,
    });
    assert.equal(result.composed, false, label);
    assert.equal(result.reason, "brand_band_reader_unavailable", label);
  }
});

test("a reader that throws declines rather than failing an accepted run", async () => {
  const result = await composePassengerFromDriver({
    masterBytes: await master(), manifest, guideBytes: await guideBytes(), input: WITH_BRAND,
    provider: { generateRaw: async () => { throw new Error("seam exploded"); } },
  });
  // The validator swallows its own errors and returns no bands, so this lands
  // on the not-located guard. Either way it is a decline, never a throw.
  assert.equal(result.composed, false);
  assert.ok(
    ["brand_band_read_failed", "brand_bands_not_located"].includes(result.reason),
    `unexpected reason ${result.reason}`,
  );
});

test("flanks the manifest did not build as twins are never composed across", async () => {
  const lopsided = {
    canvas: CANVAS,
    zones: manifest.zones.map((z) => (z.surfaceKey === "passenger" ? { ...z, w: ZONE.w - 40 } : z)),
  };
  const result = await composePassengerFromDriver({
    masterBytes: await master(), manifest: lopsided, guideBytes: await guideBytes(),
    input: NO_BRAND, provider: providerReturning([]),
  });
  assert.equal(result.composed, false);
  assert.equal(result.reason, "flank_zones_not_twins");
});

test("a missing flank zone declines rather than throwing", async () => {
  for (const missing of ["driver", "passenger"]) {
    const result = await composePassengerFromDriver({
      masterBytes: await master(),
      manifest: { canvas: CANVAS, zones: manifest.zones.filter((z) => z.surfaceKey !== missing) },
      guideBytes: await guideBytes(), input: NO_BRAND, provider: providerReturning([]),
    });
    assert.equal(result.composed, false, missing);
    assert.equal(result.reason, "flank_zones_not_twins", missing);
  }
});
