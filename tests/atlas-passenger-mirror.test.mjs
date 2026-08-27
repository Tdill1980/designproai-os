// THE PASSENGER FLANK IS COMPOSED, NOT REQUESTED. (Trish 2026-08-27)
//
// Four canaries on one vehicle refused the same way — the model drew the
// passenger flank as a second independent composition with backward lettering:
//
//   cad013e1: "The passenger side text 'FLAMINGO POOLS' is not forward-reading.
//              The passenger side flamingo is facing the same direction..."
//
// These assertions run the SAME comparison atlas-master-qc performs, rather
// than a paraphrase of it, so a change to either side shows up here.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const { mirrorPassengerFromDriver } = require("../runtime/atlas-passenger-mirror.cjs");

// atlas-master-qc.cjs: MAX_PASSENGER_MIRROR_MAE = 0.26, trim = 0.25.
const MAX_MAE = 0.26;
const TRIM = 0.25;

const ZONE = { w: 240, h: 120 };
const manifest = {
  canvas: { widthPx: 520, heightPx: 160 },
  zones: [
    { surfaceKey: "driver", x: 10, y: 20, ...ZONE, extraction: { outputRotationDegrees: 0 } },
    { surfaceKey: "passenger", x: 270, y: 20, ...ZONE, extraction: { outputRotationDegrees: 0 } },
  ],
};

/** An asymmetric flank: a bright wedge on the left, a dark "word" block. */
async function flankPanel({ wordFill }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ZONE.w}" height="${ZONE.h}">
    <rect width="100%" height="100%" fill="#1b6fa8"/>
    <polygon points="0,0 90,0 20,${ZONE.h}" fill="#f2c14e"/>
    <circle cx="200" cy="30" r="18" fill="#e8567c"/>
    <rect x="60" y="80" width="110" height="24" fill="${wordFill}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function buildMaster({ passengerPanel }) {
  const driver = await flankPanel({ wordFill: "#ffffff" });
  const base = sharp({
    create: { width: manifest.canvas.widthPx, height: manifest.canvas.heightPx, channels: 3, background: "#ffffff" },
  });
  return base.composite([
    { input: driver, left: 10, top: 20 },
    { input: passengerPanel, left: 270, top: 20 },
  ]).png().toBuffer();
}

/** nativeZoneSignature, reproduced exactly from atlas-master-qc.cjs. */
async function zoneSignature(masterBytes, zone, { mirror = false } = {}) {
  const rotation = Number(zone?.extraction?.outputRotationDegrees || 0);
  let pipeline = sharp(masterBytes, { failOn: "error", limitInputPixels: 100_000_000 })
    .extract({ left: zone.x, top: zone.y, width: zone.w, height: zone.h })
    .rotate(rotation)
    .flatten({ background: "#ffffff" });
  if (mirror) pipeline = pipeline.flop();
  const { data } = await pipeline.toColourspace("srgb").resize(160, 64, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  return data;
}

/** passengerMirrorMae, reproduced exactly — trimmed mean, same fraction. */
async function mirrorMae(masterBytes) {
  const [mirrored, passenger] = await Promise.all([
    zoneSignature(masterBytes, manifest.zones[0], { mirror: true }),
    zoneSignature(masterBytes, manifest.zones[1]),
  ]);
  const diffs = [...mirrored].map((value, index) => Math.abs(value - passenger[index]));
  diffs.sort((a, b) => a - b);
  const keep = Math.max(1, Math.ceil(diffs.length * (1 - TRIM)));
  let total = 0;
  for (let index = 0; index < keep; index += 1) total += diffs[index];
  return total / (keep * 255);
}

/** What cad013e1 actually produced: a SECOND composition, same orientation. */
async function independentFlank() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ZONE.w}" height="${ZONE.h}">
    <rect width="100%" height="100%" fill="#8a1b1b"/>
    <polygon points="${ZONE.w},0 ${ZONE.w - 120},0 ${ZONE.w},${ZONE.h}" fill="#0f2f18"/>
    <circle cx="40" cy="95" r="26" fill="#ffffff"/>
    <rect x="120" y="20" width="100" height="30" fill="#111111"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test("the model's own passenger flank is what the QC has been refusing", async () => {
  const master = await buildMaster({ passengerPanel: await independentFlank() });
  const mae = await mirrorMae(master);
  assert.ok(mae > MAX_MAE, `an independently drawn flank must fail the mirror contract, got ${mae}`);
});

test("the composed flank drives the mirror metric to zero", async () => {
  const master = await buildMaster({ passengerPanel: await flankPanel({ wordFill: "#111111" }) });
  const mirroredMaster = await mirrorPassengerFromDriver({ masterBytes: master, manifest });
  const mae = await mirrorMae(mirroredMaster.bytes);
  assert.ok(mae < 0.01, `composed flank should be a near-exact twin, got ${mae}`);
});

test("a re-dropped brand band keeps lettering forward and still passes the contract", async () => {
  const master = await buildMaster({ passengerPanel: await flankPanel({ wordFill: "#111111" }) });
  // The word block, in driver panel space.
  const band = { xPct: 60 / ZONE.w, yPct: 80 / ZONE.h, wPct: 110 / ZONE.w, hPct: 24 / ZONE.h };
  const result = await mirrorPassengerFromDriver({ masterBytes: master, manifest, brandBands: [band] });
  assert.equal(result.bandsApplied, 1);
  const mae = await mirrorMae(result.bytes);
  assert.ok(mae < MAX_MAE, `one band's divergence must be absorbed by the trimmed mean, got ${mae}`);

  // And the band's pixels are the driver's, UN-flipped: sample the asymmetric
  // edge of the word block rather than its flat middle.
  const passengerPanel = await sharp(result.bytes)
    .extract({ left: 270, top: 20, width: ZONE.w, height: ZONE.h }).raw().toBuffer({ resolveWithObject: true });
  const at = (buf, info, x, y) => {
    const i = (y * info.width + x) * info.channels;
    return [buf[i], buf[i + 1], buf[i + 2]];
  };
  // The band was mirrored to left = 240-60-110 = 70; its first column is white.
  const [r, g, b] = at(passengerPanel.data, passengerPanel.info, 72, 90);
  assert.ok(r > 200 && g > 200 && b > 200, `the re-dropped band must carry the driver's white word, got ${r},${g},${b}`);
});

test("unequal flank zones are a manifest defect, not something to paper over", async () => {
  const bad = { ...manifest, zones: [manifest.zones[0], { ...manifest.zones[1], w: 200 }] };
  const master = await buildMaster({ passengerPanel: await flankPanel({ wordFill: "#111111" }) });
  await assert.rejects(
    () => mirrorPassengerFromDriver({ masterBytes: master, manifest: bad }),
    (error) => error?.code === "atlas_mirror_zone_size_mismatch",
  );
});

test("the authored master is never mutated", async () => {
  const master = await buildMaster({ passengerPanel: await flankPanel({ wordFill: "#111111" }) });
  const before = Buffer.from(master);
  await mirrorPassengerFromDriver({ masterBytes: master, manifest });
  assert.ok(before.equals(master), "the input buffer must be untouched");
});
