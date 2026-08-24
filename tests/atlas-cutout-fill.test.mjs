import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const { FILL_CONTRACT, fillMasterCutouts } = require("../runtime/atlas-cutout-fill.cjs");
const { deterministicMasterChecks } = require("../runtime/atlas-master-qc.cjs");

/**
 * A punched wheel arch is closed by continuing the artwork that borders it.
 *
 * The master itself is never touched -- it stays the proof authority, and the
 * proofs mask that region away regardless. Only the PANEL source is filled, and
 * only inside the shapes the gate convicted, because the fill reads its mask
 * from the same thresholds the detector does.
 */

const manifest = {
  zones: ["driver", "passenger"].map((surfaceKey, index) => ({
    surfaceKey,
    x: index * 400,
    y: 0,
    w: 400,
    h: 200,
    extraction: { outputRotationDegrees: 0 },
  })),
};

async function texturedZone({ hole = false } = {}) {
  const layers = [];
  for (let index = 0; index < 60; index += 1) {
    layers.push({
      input: await sharp({
        create: {
          width: 14, height: 14, channels: 3,
          background: index % 3 ? (index % 2 ? "#3aa0d8" : "#f2a25c") : "#8ad6a0",
        },
      }).png().toBuffer(),
      left: (index * 41) % 386,
      top: (index * 59) % 186,
    });
  }
  if (hole) {
    layers.push({
      input: await sharp({ create: { width: 90, height: 90, channels: 3, background: "#000000" } }).png().toBuffer(),
      left: 150, top: 60,
    });
  }
  return sharp({ create: { width: 400, height: 200, channels: 3, background: "#eef4fa" } })
    .composite(layers).png().toBuffer();
}

async function master({ driverHole }) {
  return sharp({ create: { width: 800, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: await texturedZone({ hole: driverHole }), left: 0, top: 0 },
      { input: await texturedZone({ hole: false }), left: 400, top: 0 },
    ]).png().toBuffer();
}

const zoneRaw = (bytes, left) =>
  sharp(bytes).extract({ left, top: 0, width: 400, height: 200 }).raw().toBuffer();

test("a punched wheel arch is closed, and the filled duplicate passes the gate", async () => {
  const bytes = await master({ driverHole: true });

  const before = await deterministicMasterChecks(bytes, manifest);
  assert.equal(before.accepted, false);
  assert.deepEqual(before.cutoutFindings.map((item) => item.surfaceKey), ["driver"]);
  assert.deepEqual(before.blockingFailures, [], "a hole is not a design failure");

  const result = await fillMasterCutouts(bytes, manifest, ["driver"]);
  assert.equal(result.changed, true);
  assert.equal(result.contract, FILL_CONTRACT);
  assert.equal(result.filled.length, 1);
  assert.equal(result.filled[0].surfaceKey, "driver");
  assert.equal(result.filled[0].components, 1, "one arch is one shape");
  assert.equal(result.filled[0].unresolvedPixels, 0, "the hole must close completely");

  // The panel source is now printable by the gate's own measure.
  const after = await deterministicMasterChecks(result.bytes, manifest);
  assert.equal(after.accepted, true, after.failures.join("; "));
  assert.deepEqual(after.cutoutFindings, []);
});

test("the authored master is never mutated, and untouched zones stay byte-identical", async () => {
  const bytes = await master({ driverHole: true });
  const originalCopy = Buffer.from(bytes);

  const result = await fillMasterCutouts(bytes, manifest, ["driver"]);

  assert.ok(Buffer.compare(bytes, originalCopy) === 0, "the input buffer must not be written through");
  assert.notEqual(Buffer.compare(result.bytes, bytes), 0, "the duplicate must actually differ");
  assert.equal(
    Buffer.compare(await zoneRaw(bytes, 400), await zoneRaw(result.bytes, 400)),
    0,
    "a zone the detector never convicted must come back untouched",
  );
});

test("a clean master is returned unchanged rather than re-encoded", async () => {
  const bytes = await master({ driverHole: false });
  const clean = await deterministicMasterChecks(bytes, manifest);
  assert.equal(clean.accepted, true, clean.failures.join("; "));

  // No convicted surfaces means nothing to fill -- and the panel source hash
  // must therefore equal the master hash, so the same buffer comes back.
  const result = await fillMasterCutouts(bytes, manifest, []);
  assert.equal(result.changed, false);
  assert.deepEqual(result.filled, []);
  assert.equal(result.bytes, bytes, "an unfilled master must be the same buffer, not a copy");
});

test("naming a surface with no convicted hole fills nothing", async () => {
  const bytes = await master({ driverHole: false });
  const result = await fillMasterCutouts(bytes, manifest, ["driver", "passenger"]);
  assert.equal(result.changed, false, "the fill follows the detector, not the caller's list");
  assert.deepEqual(result.filled, []);
});

test("the fill is reproducible: the same sheet fills to the same bytes", async () => {
  const bytes = await master({ driverHole: true });
  const first = await fillMasterCutouts(bytes, manifest, ["driver"]);
  const second = await fillMasterCutouts(bytes, manifest, ["driver"]);
  assert.equal(Buffer.compare(first.bytes, second.bytes), 0);
});
