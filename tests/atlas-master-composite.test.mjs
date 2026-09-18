// ARCHITECTURE_DAG.md chunk 8 — `master.composite`. Layer 0 + Layer 1.
//
// THE COORDINATE TRANSFORM IS THE WHOLE RISK. The plan's boxes are normalized to
// the surface's trim rectangle in the PANEL'S READING orientation; the sheet
// stores a flank ROTATED. Get the transform wrong and the company name lands in
// the wrong place, or mirrored — the exact family of defect this port exists to
// end, and one that a test asserting "we called composite with some numbers"
// would happily certify.
//
// So it is proven by ROUND TRIP: composite onto a synthetic sheet, then extract
// the panel the way the runtime really extracts it (crop the trim rect, rotate
// by -rotationDegrees), and read the pixels back.
//
// The marker is deliberately ASYMMETRIC — left half red, right half blue — so a
// mirror is visible. A symmetric fixture cannot fail this test, which is what
// made the earlier passenger fixtures useless.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const runtimeRequire = createRequire(join(HERE, "..", "runtime", "package.json"));
const composite = runtimeRequire(join(HERE, "..", "runtime", "atlas-master-composite.cjs"));
const sharp = runtimeRequire("sharp");

const DRIVER = { surfaceKey: "driver", rotationDegrees: 90, trim: { x: 100, y: 100, w: 200, h: 600 } };
const PASSENGER = { surfaceKey: "passenger", rotationDegrees: -90, trim: { x: 700, y: 100, w: 200, h: 600 } };
const ZONES = [DRIVER, PASSENGER];
const BOX = { xPct: 0.1, yPct: 0.25, wPct: 0.3, hPct: 0.4 };

/** A white sheet, so anything composited onto it is unmistakable. */
const master = () => sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } }).png().toBuffer();

/** LEFT HALF RED, RIGHT HALF BLUE. Asymmetric on purpose. */
async function marker() {
  return sharp({ create: { width: 120, height: 40, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
    .composite([{
      input: await sharp({ create: { width: 60, height: 40, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toBuffer(),
      left: 60, top: 0,
    }])
    .png().toBuffer();
}

const plan = (surfaces) => ({
  placements: surfaces.map(({ surfaceKey, box, mirroredFrom = null }) => ({
    surfaceKey, role: "typography", storagePath: "atlas-elements/t.png", contentHash: "a".repeat(64),
    box, mirroredFrom, flipped: false,
  })),
});

/** Exactly what the runtime does: crop the trim rect, then undo the rotation. */
async function readPanel(sheetBytes, zone) {
  return sharp(sheetBytes)
    .extract({ left: zone.trim.x, top: zone.trim.y, width: zone.trim.w, height: zone.trim.h })
    .rotate(-(Number(zone.rotationDegrees) || 0))
    .png().toBuffer();
}

async function pixelAt(bytes, x, y) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

const isRed = (p) => p.r > 200 && p.b < 60;
const isBlue = (p) => p.b > 200 && p.r < 60;
const isWhite = (p) => p.r > 200 && p.g > 200 && p.b > 200;

test("the sheet placement algebra matches the header, for all three rotations", () => {
  // TWO SIZES, AND ON A FLANK THEY ARE TRANSPOSED. `drawWidth`/`drawHeight`
  // are READING space (what `.resize()` is handed, before the rotate);
  // `sheetWidth`/`sheetHeight` are the footprint ON THE SHEET afterwards.
  // Reading one as the other is what made a correct composite convict itself
  // on the first production run that reached it (ac8ab0a0, 2026-09-18) -- note
  // that `left` below already derives from 80, the post-rotation width, so the
  // algebra always knew which pair it was using.

  // rot +90: left = trim.x + (trim.w - ry - dh), top = trim.y + rx
  const driver = composite.sheetPlacement(DRIVER, BOX);
  assert.deepEqual(driver, {
    left: 100 + (200 - 50 - 80), top: 100 + 60,
    drawWidth: 180, drawHeight: 80, sheetWidth: 80, sheetHeight: 180, rotation: 90,
  });

  // rot -90: left = trim.x + ry, top = trim.y + (trim.h - rx - dw)
  const passenger = composite.sheetPlacement(PASSENGER, BOX);
  assert.deepEqual(passenger, {
    left: 700 + 50, top: 100 + (600 - 60 - 180),
    drawWidth: 180, drawHeight: 80, sheetWidth: 80, sheetHeight: 180, rotation: -90,
  });

  // rot 0: the identity case, for a surface that is not a flank. Here and only
  // here are the two pairs the same number.
  const flat = composite.sheetPlacement({ surfaceKey: "hood", rotationDegrees: 0, trim: { x: 10, y: 20, w: 600, h: 200 } }, BOX);
  assert.deepEqual(flat, {
    left: 10 + 60, top: 20 + 50,
    drawWidth: 180, drawHeight: 80, sheetWidth: 180, sheetHeight: 80, rotation: 0,
  });

  // The footprint must stay inside the flank it belongs to. A transposed
  // 180-wide box on a 200-wide column very nearly fits, which is exactly why
  // this went unnoticed until real pixels measured it.
  for (const [placement, zone] of [[driver, DRIVER], [passenger, PASSENGER]]) {
    assert.ok(placement.left + placement.sheetWidth <= zone.trim.x + zone.trim.w);
    assert.ok(placement.top + placement.sheetHeight <= zone.trim.y + zone.trim.h);
  }

  assert.throws(
    () => composite.sheetPlacement({ surfaceKey: "x", rotationDegrees: 45, trim: { x: 0, y: 0, w: 10, h: 10 } }, BOX),
    (err) => err.code === "atlas_composite_rotation_unsupported",
  );
});

test("ROUND TRIP: the element lands on the planned box, un-mirrored, on the driver", async () => {
  const sheet = await composite.compositeElementsOntoMaster({
    cleanMasterBytes: await master(), zones: ZONES,
    plan: plan([{ surfaceKey: "driver", box: BOX }]),
    artwork: new Map([["typography", await marker()]]),
  });
  const panel = await readPanel(sheet.bytes, DRIVER);

  const meta = await sharp(panel).metadata();
  assert.equal(meta.width, 600, "the panel reads 600x200 — the flank's reading orientation");
  assert.equal(meta.height, 200);

  // Planned reading box: x 60..240, y 50..130.
  assert.ok(isRed(await pixelAt(panel, 70, 90)), "the element's LEFT edge must be red");
  assert.ok(isBlue(await pixelAt(panel, 230, 90)), "its RIGHT edge must be blue — a mirror fails here");
  assert.ok(isWhite(await pixelAt(panel, 40, 90)), "nothing outside the box");
  assert.ok(isWhite(await pixelAt(panel, 300, 90)), "nothing past the box");
  assert.ok(isWhite(await pixelAt(panel, 150, 20)), "nothing above the box");
  assert.ok(isWhite(await pixelAt(panel, 150, 170)), "nothing below the box");
});

test("ROUND TRIP: the PASSENGER box is mirrored and the artwork is NOT", async () => {
  const mirrored = { ...BOX, xPct: 1 - BOX.xPct - BOX.wPct };
  const sheet = await composite.compositeElementsOntoMaster({
    cleanMasterBytes: await master(), zones: ZONES,
    plan: plan([{ surfaceKey: "passenger", box: mirrored, mirroredFrom: "driver" }]),
    artwork: new Map([["typography", await marker()]]),
  });
  const panel = await readPanel(sheet.bytes, PASSENGER);

  // Mirrored reading box: x 360..540 (1 - 0.1 - 0.3 = 0.6 -> 360).
  assert.ok(isRed(await pixelAt(panel, 370, 90)), "LEFT edge still red on the passenger");
  assert.ok(isBlue(await pixelAt(panel, 530, 90)), "RIGHT edge still blue — the artwork is never flipped");
  assert.ok(isWhite(await pixelAt(panel, 200, 90)), "and the driver's x-position is empty here");
  assert.equal(sheet.applied[0].flipped, false);
  assert.equal(sheet.applied[0].mirroredFrom, "driver");
});

test("both flanks at once: same artwork, mirrored boxes, both reading forward", async () => {
  const sheet = await composite.compositeElementsOntoMaster({
    cleanMasterBytes: await master(), zones: ZONES,
    plan: plan([
      { surfaceKey: "driver", box: BOX },
      { surfaceKey: "passenger", box: { ...BOX, xPct: 1 - BOX.xPct - BOX.wPct }, mirroredFrom: "driver" },
    ]),
    artwork: new Map([["typography", await marker()]]),
  });
  const driver = await readPanel(sheet.bytes, DRIVER);
  const passenger = await readPanel(sheet.bytes, PASSENGER);
  assert.ok(isRed(await pixelAt(driver, 70, 90)) && isBlue(await pixelAt(driver, 230, 90)));
  assert.ok(isRed(await pixelAt(passenger, 370, 90)) && isBlue(await pixelAt(passenger, 530, 90)));
  assert.equal(sheet.applied.length, 2);
});

test("the CLEAN master is preserved byte for byte", async () => {
  const clean = await master();
  const sheet = await composite.compositeElementsOntoMaster({
    cleanMasterBytes: clean, zones: ZONES,
    plan: plan([{ surfaceKey: "driver", box: BOX }]),
    artwork: new Map([["typography", await marker()]]),
  });
  const { createHash } = await import("node:crypto");
  assert.equal(sheet.cleanMasterHash, createHash("sha256").update(clean).digest("hex"),
    "Layer 0 is provenance and a floor — an element edit re-composites onto it rather than healing paint");
  assert.notEqual(sheet.contentHash, sheet.cleanMasterHash, "the composited sheet is its own artifact");
  assert.equal(sheet.changed, true);
  assert.equal(clean.length, (await master()).length, "the input buffer is never mutated");
});

test("no placements is a clean sheet, not a failure", async () => {
  const clean = await master();
  const sheet = await composite.compositeElementsOntoMaster({ cleanMasterBytes: clean, zones: ZONES, plan: { placements: [] } });
  assert.equal(sheet.changed, false);
  assert.equal(sheet.contentHash, sheet.cleanMasterHash, "with nothing to place, the composited master IS the clean one");
  assert.equal(sheet.bytes, clean);
});

test("missing artwork is RETRYABLE, and a bad master is not", async () => {
  await assert.rejects(
    async () => composite.compositeElementsOntoMaster({
      cleanMasterBytes: await master(), zones: ZONES,
      plan: plan([{ surfaceKey: "driver", box: BOX }]), artwork: new Map(),
    }),
    (err) => err.code === "atlas_composite_element_missing" && err.retryable === true,
  );
  await assert.rejects(
    () => composite.compositeElementsOntoMaster({ cleanMasterBytes: null, zones: ZONES, plan: plan([]) }),
    (err) => err.code === "atlas_composite_master_invalid",
  );
});

// THE LIVE GEOMETRY THAT CONVICTED ITSELF (element run ac8ab0a0, generation
// d8c2e779, 2026-09-18 -- the first production run ever to reach
// master.composite).
//
// Numbers below are read off that run's own rows: the driver zone from the
// stored run definition's manifest, the typography box from element.lockup's
// placement output. Nothing here is synthetic, which matters because the
// synthetic fixtures are precisely what missed this.
test("LIVE ac8ab0a0: the driver lockup's footprint stays inside the driver zone", () => {
  const driver = { surfaceKey: "driver", rotationDegrees: -90, trim: { x: 2838, y: 711, w: 979, h: 2674 } };
  const spot = composite.sheetPlacement(driver, { wPct: 0.34, hPct: 0.240872, xPct: 0.08, yPct: 0.247321 });

  // Reading space: a wide, short banner -- correct, that is how the lockup is
  // read once the flank is rotated upright.
  assert.equal(spot.drawWidth, 909);
  assert.equal(spot.drawHeight, 236);
  // Sheet space: the transpose. A tall, narrow strip down a tall, narrow column.
  assert.equal(spot.sheetWidth, 236);
  assert.equal(spot.sheetHeight, 909);

  const zoneRight = driver.trim.x + driver.trim.w;
  // The real footprint fits its own column with room to spare...
  assert.ok(spot.left + spot.sheetWidth <= zoneRight,
    "the composited lockup must land inside the driver flank");
  // ...while the reading-space size, read as a sheet extent, runs 172px PAST
  // the flank's own right edge and out into the gutter. That is what
  // darkDeltaOutside used to mask with, so it excluded the wrong 909x236
  // rectangle and left 74% of the lockup's ink outside the mask -- counted as
  // damage to a base the composite had not touched. Measured live:
  //   atlas_composite_altered_base: 0.0275% of the sheet
  assert.ok(spot.left + spot.drawWidth > zoneRight,
    "this is the regression: the reading-space width is NOT a sheet extent here");
});
