// HISTORICAL MIRROR UTILITY + NON-BLOCKING CONTINUITY TELEMETRY. (2026-08-31)
//
// `atlas-passenger-mirror` previously overwrote the authored Passenger region
// to satisfy `passengerMirrorMae`. Active flat-first Call 1 no longer imports or
// invokes it: Passenger is its own named authority. These fixtures remain to
// keep the historical diagnostic/utility math understood, not to authorize a
// Driver-to-Passenger substitution.
//
//   f72c10f0-8e36-489f-95c0-da6c55a75c5b   passengerMirrorMae=0.37993
//   45f0ea61-0f65-4a30-98c8-f1a0e29f9591   passengerMirrorMae=0.39117  (2 attempts)
//
// Two independent defects, both invisible to the suite that already existed:
//
//   1. THE COMPOSER undid the DRIVER's rotation on the way back into the sheet.
//      The flanks carry opposite rotations (+90 passenger, -90 driver), so the
//      composed panel landed exactly 180 degrees out.
//   2. THE CHECKER chained `.rotate()` with `.flop()`, and sharp applies the
//      flop FIRST -- so it compared `rotate(flop(driver))` against
//      `rotate(passenger)` and a perfect twin scored WORSE than two unrelated
//      flanks.
//
// `tests/atlas-passenger-mirror.test.mjs` could not see either one: it pins
// both zones at `outputRotationDegrees: 0`, where the two bugs are identities,
// and it REPRODUCES the signature function instead of calling it.
//
// So this file does the opposite of both. It builds the manifest with the real
// `buildAtlasManifest` from real GENIE surface dimensions, and it scores with
// the real `deterministicMasterChecks`. Nothing here is a paraphrase.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const { buildAtlasManifest } = require("../runtime/flat-first-atlas.cjs");
const { mirrorPassengerFromDriver } = require("../runtime/atlas-passenger-mirror.cjs");
const { deterministicMasterChecks, MAX_PASSENGER_MIRROR_MAE } = require("../runtime/atlas-master-qc.cjs");

// A 2018 Ford Transit 148 WB High Roof, exactly as the GENIE catalog resolves
// it. The flank zones this produces are 1153x2782 at -90 (driver) and +90
// (passenger) -- the opposite rotations both defects hid behind.
const SURFACES = [
  { surfaceKey: "driver", widthInches: 231.3, heightInches: 90 },
  { surfaceKey: "passenger", widthInches: 231.3, heightInches: 90 },
  { surfaceKey: "hood", widthInches: 70.9, heightInches: 36 },
  { surfaceKey: "roof", widthInches: 170, heightInches: 71.8 },
  { surfaceKey: "front", widthInches: 79, heightInches: 27 },
  { surfaceKey: "rear", widthInches: 79, heightInches: 73.6 },
];

const manifest = buildAtlasManifest(SURFACES, null);
const zoneOf = (surfaceKey) => manifest.zones.find((zone) => zone.surfaceKey === surfaceKey);

/** Strongly asymmetric, low-frequency artwork: it survives the 160x64 downsample. */
function livery(width, height, { base, band, wedge, dot }) {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="${base}"/>
    <rect width="${width}" height="${Math.round(height * 0.25)}" fill="${band}"/>
    <rect y="${Math.round(height * 0.25)}" width="${Math.round(width * 0.3)}"
      height="${Math.round(height * 0.75)}" fill="${wedge}"/>
    <circle cx="${Math.round(width * 0.75)}" cy="${Math.round(height * 0.8)}"
      r="${Math.round(width * 0.2)}" fill="${dot}"/>
  </svg>`);
}

/** What cad013e1 produced: the passenger flank drawn as its own composition. */
function independentFlank(width, height) {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="#804000"/>
    <rect y="${Math.round(height * 0.6)}" width="${width}" height="${Math.round(height * 0.4)}" fill="#00ffff"/>
  </svg>`);
}

/** A sheet whose passenger flank is a SECOND, INDEPENDENT composition. */
async function masterWithMismatchedFlanks() {
  const overlays = [];
  for (const zone of manifest.zones) {
    const art = zone.surfaceKey === "passenger"
      ? independentFlank(zone.w, zone.h)
      : livery(zone.w, zone.h, { base: "#000080", band: "#ffffff", wedge: "#ff0000", dot: "#00ff00" });
    overlays.push({ input: await sharp(art).png().toBuffer(), left: zone.x, top: zone.y });
  }
  return sharp({
    create: {
      width: manifest.canvas.widthPx, height: manifest.canvas.heightPx,
      channels: 4, background: "#101820",
    },
  }).composite(overlays).png().toBuffer();
}

test("the two flanks carry opposite rotations -- the geometry both defects hid behind", () => {
  assert.equal(zoneOf("driver").extraction.outputRotationDegrees, 90);
  assert.equal(zoneOf("passenger").extraction.outputRotationDegrees, -90);
  assert.equal(zoneOf("driver").w, zoneOf("passenger").w);
  assert.equal(zoneOf("driver").h, zoneOf("passenger").h);
});

test("a sheet with two independently authored flanks reports telemetry but is not refused", async () => {
  const checks = await deterministicMasterChecks(await masterWithMismatchedFlanks(), manifest);
  assert.ok(
    checks.passengerMirrorMae > MAX_PASSENGER_MIRROR_MAE,
    `fixture must exceed the historical diagnostic threshold, measured ${checks.passengerMirrorMae}`,
  );
  assert.equal(checks.blockingFailures.some((finding) => /passengerMirrorMae/.test(finding)), false);
});

test("the historical mirror utility drives the diagnostic metric to zero", async () => {
  const master = await masterWithMismatchedFlanks();
  const mirrored = await mirrorPassengerFromDriver({ masterBytes: master, manifest, brandBands: [] });
  assert.ok(mirrored?.bytes, "the repair must return a sheet");

  const checks = await deterministicMasterChecks(mirrored.bytes, manifest);
  // Not "under the bound" -- ZERO. The passenger flank is literally the driver's
  // pixels, mirrored; anything above the noise floor means the two modules have
  // drifted apart again, whichever one moved.
  assert.ok(
    checks.passengerMirrorMae < 0.01,
    `a composed twin must read ~0, measured ${checks.passengerMirrorMae}`,
  );
  assert.equal(
    checks.blockingFailures.filter((finding) => /passengerMirrorMae/.test(finding)).length,
    0,
    "the diagnostic metric is never a structural finding",
  );
});

test("the composed panel is the driver panel mirrored, and not rotated by 180", async () => {
  const master = await masterWithMismatchedFlanks();
  const { bytes } = await mirrorPassengerFromDriver({ masterBytes: master, manifest, brandBands: [] });

  // Both panels as the checker reads them: extract, then the zone's own rotation.
  const panel = async (zone) => sharp(bytes, { limitInputPixels: false })
    .extract({ left: zone.x, top: zone.y, width: zone.w, height: zone.h })
    .rotate(Number(zone.extraction.outputRotationDegrees))
    .flatten({ background: "#ffffff" })
    .png().toBuffer();
  const raw = async (buffer) => (await sharp(buffer).removeAlpha().raw().toBuffer());
  const mae = (a, b) => {
    let total = 0;
    for (let index = 0; index < a.length; index += 1) total += Math.abs(a[index] - b[index]);
    return total / (a.length * 255);
  };

  const driverPanel = await panel(zoneOf("driver"));
  const passengerPanel = await raw(await panel(zoneOf("passenger")));

  // THE FLOP IS ITS OWN PASS here too, for the same reason it is in both modules.
  const flopped = await raw(await sharp(driverPanel).flop().png().toBuffer());
  const floppedThenTurned = await raw(
    await sharp(await sharp(driverPanel).flop().png().toBuffer()).rotate(180).png().toBuffer(),
  );

  assert.ok(mae(flopped, passengerPanel) < 0.01,
    "the passenger panel must be flop(driver panel)");
  assert.ok(mae(floppedThenTurned, passengerPanel) > 0.1,
    "and must NOT be flop(driver panel) turned 180 -- that was the live defect");
});
