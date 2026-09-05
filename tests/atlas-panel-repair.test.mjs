import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const sharp = require_("../runtime/node_modules/sharp");
const {
  planPanelRepair,
  repairMasterPanels,
  INSTALLER_INSET_IN,
  MIN_ELEMENT_HEIGHT_IN,
  PanelRepairError,
  _test,
} = require_("../runtime/atlas-panel-repair.cjs");
const { inspectAtlasPanels } = require_("../runtime/atlas-panel-qc.cjs");

/**
 * ARCTIC AIR `63e6629a`'s own geometry. The bottom band carries ONE contact
 * lockup -- an `ARCTIC AIR` badge at x 983..1241 and a `Www.ArcticAir.com`
 * banner at x 1249..3080, both y 3240..3559 -- and the cut lines x=1071,
 * x=2198 and y=3335 all run through it.
 */
const ZONES = [
  { surfaceKey: "driver", x: 0, y: 72, width: 4096, height: 1221, trim: { x: 113, y: 185, width: 3870, height: 995 }, printWidthIn: 171.1, printHeightIn: 44, bleedInches: 5 },
  { surfaceKey: "passenger", x: 0, y: 1437, width: 4096, height: 1221, trim: { x: 113, y: 1550, width: 3870, height: 995 }, printWidthIn: 171.1, printHeightIn: 44, bleedInches: 5 },
  { surfaceKey: "roof", x: 0, y: 2730, width: 1071, height: 1207, trim: { x: 82, y: 2812, width: 907, height: 1043 }, printWidthIn: 55.44, printHeightIn: 63.78, bleedInches: 5 },
  { surfaceKey: "hood", x: 1071, y: 2730, width: 1127, height: 828, trim: { x: 1153, y: 2812, width: 963, height: 664 }, printWidthIn: 58.9, printHeightIn: 40.59, bleedInches: 5 },
  { surfaceKey: "front", x: 2198, y: 2730, width: 1898, height: 605, trim: { x: 2280, y: 2812, width: 1734, height: 441 }, printWidthIn: 106.03, printHeightIn: 27, bleedInches: 5 },
  { surfaceKey: "rear", x: 2198, y: 3335, width: 1127, height: 590, trim: { x: 2280, y: 3417, width: 963, height: 426 }, printWidthIn: 58.9, printHeightIn: 26.06, bleedInches: 5 },
];
const MANIFEST = { zones: ZONES };

const severed = (label, rect, surfaces) => ({ label, status: "severed", rect, surfaces, crossings: [] });
const BADGE = severed("arctic air badge", { x: 983, y: 3240, w: 258, h: 319 }, ["roof", "hood"]);
const BANNER = severed("www.arcticair.com contact banner", { x: 1249, y: 3256, w: 1831, h: 299 }, ["hood", "front", "rear"]);

test("a lockup that reads as one unit MOVES as one unit", () => {
  // Moving the badge and the banner independently would re-space or re-order
  // them, which IS a redesign. They sit 8 px apart on one contact bar.
  const plan = planPanelRepair({ containment: [BADGE, BANNER], manifest: MANIFEST, masterWidth: 4096 });
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].labels, ["arctic air badge", "www.arcticair.com contact banner"]);
  assert.deepEqual(plan[0].sourceRect, { x: 983, y: 3240, w: 2097, h: 319 });
});

test("the element goes to the surface that already holds most of it — minimise the move", () => {
  // hood holds 949x318, rear 882x220, front 882x79, roof 88x319. Any other
  // rule is code inventing wrap layout, which is what the owner rejected.
  const [entry] = planPanelRepair({ containment: [BADGE, BANNER], manifest: MANIFEST, masterWidth: 4096 });
  assert.equal(entry.placeable, true);
  assert.equal(entry.surfaceKey, "hood");
  assert.deepEqual(entry.acrossSurfaces, ["hood", "rear", "front", "roof"]);
});

test("the placed rectangle lies inside the hood's trim, with the installer tolerance clear", () => {
  const [entry] = planPanelRepair({ containment: [BADGE, BANNER], manifest: MANIFEST, masterWidth: 4096 });
  const hood = ZONES.find((zone) => zone.surfaceKey === "hood");
  const box = _test.placeableRect(hood);
  const rect = entry.targetRect;
  assert.ok(rect.x >= box.x, `${rect.x} >= ${box.x}`);
  assert.ok(rect.y >= box.y, `${rect.y} >= ${box.y}`);
  assert.ok(rect.x + rect.w <= box.x + box.w);
  assert.ok(rect.y + rect.h <= box.y + box.h);
  // ...and the tolerance is 2 VEHICLE INCHES, not 2 pixels.
  const inPerPx = hood.printWidthIn / hood.trim.width;
  assert.ok(Math.abs((box.x - hood.trim.x) * inPerPx - INSTALLER_INSET_IN) < 0.1);
});

test("aspect ratio is preserved and the element is never enlarged", () => {
  const [entry] = planPanelRepair({ containment: [BADGE, BANNER], manifest: MANIFEST, masterWidth: 4096 });
  const sourceAspect = entry.sourceRect.w / entry.sourceRect.h;
  const targetAspect = entry.targetRect.w / entry.targetRect.h;
  assert.ok(Math.abs(targetAspect - sourceAspect) / sourceAspect < 0.02);
  assert.ok(entry.scale <= 1);
});

test("an element that cannot print legibly anywhere is refused, not shrunk to fit", () => {
  // A band the full width of the sheet: every surface would have to print it
  // under the legible minimum.
  const huge = severed("full-width bar", { x: 0, y: 3240, w: 4096, h: 20 }, ["roof", "hood", "front"]);
  const [entry] = planPanelRepair({ containment: [huge], manifest: MANIFEST, masterWidth: 4096 });
  assert.equal(entry.placeable, false);
  assert.match(entry.reason, new RegExp(`${MIN_ELEMENT_HEIGHT_IN}"`));
});

test("an element outside every container is refused", () => {
  const orphan = severed("stray mark", { x: 3400, y: 3700, w: 200, h: 200 }, []);
  const [entry] = planPanelRepair({ containment: [orphan], manifest: MANIFEST, masterWidth: 4096 });
  assert.equal(entry.placeable, false);
  assert.match(entry.reason, /outside every surface container/);
});

test("nothing severed means nothing changes, byte for byte", async () => {
  const master = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 20, g: 60, b: 120 } } }).png().toBuffer();
  const result = await repairMasterPanels({
    masterBytes: master,
    manifest: MANIFEST,
    containment: [{ label: "lockup", status: "contained", rect: { x: 10, y: 10, w: 20, h: 20 }, surfaces: ["driver"] }],
  });
  assert.equal(result.changed, false);
  assert.equal(result.bytes, master);
});

/**
 * THE WHOLE REPAIR, ON A SYNTHETIC SHEET THAT REPRODUCES THE DEFECT.
 *
 * A red bar is painted straddling the hood|front boundary at x=2198, so the cut
 * severs it exactly as the Arctic Air contact lockup was severed. After the
 * repair the bar's pixels must be GONE from the boundary and PRESENT, whole,
 * inside one surface.
 */
async function severedSheet() {
  const bar = await sharp({ create: { width: 1200, height: 200, channels: 3, background: { r: 220, g: 30, b: 40 } } }).png().toBuffer();
  return sharp({ create: { width: 4096, height: 4096, channels: 3, background: { r: 20, g: 60, b: 120 } } })
    .composite([{ input: bar, left: 1700, top: 3200 }])
    .png()
    .toBuffer();
}

const redAt = async (bytes, rect) => {
  const { data, info } = await sharp(bytes).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }).raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] > 180 && data[i + 1] < 90) red += 1;
  return red / (rect.w * rect.h);
};

test("the severed bar leaves the boundary and lands whole inside one surface", async () => {
  const master = await severedSheet();
  const source = { x: 1700, y: 3200, w: 1200, h: 200 };
  assert.ok(await redAt(master, source) > 0.99, "the fixture really is one solid bar across the cut");

  const result = await repairMasterPanels({
    masterBytes: master,
    manifest: MANIFEST,
    containment: [severed("contact bar", source, ["hood", "front", "rear"])],
  });
  assert.equal(result.changed, true);

  const [entry] = result.repairs;
  assert.equal(entry.placeable, true);

  // It is whole where it landed...
  assert.ok(await redAt(result.bytes, entry.targetRect) > 0.95, "the moved element is not intact at its target");

  // ...and it no longer crosses the cut. The target rectangle may overlap where
  // the element used to be -- "minimise the move" is the point -- so the test
  // is that NOTHING red survives outside it, not that the old rectangle is
  // empty. A strip on the far side of x=2198 is exactly the defect.
  const beyondCut = { x: 2198, y: source.y - 20, w: 900, h: source.h + 40 };
  assert.ok(await redAt(result.bytes, beyondCut) < 0.01, "the element still crosses the hood|front boundary");

  // The vacated area is HEALED, not left transparent or black: it now carries
  // the surrounding artwork's own colour.
  const { data } = await sharp(result.bytes)
    .extract({ left: 2400, top: source.y + 40, width: 8, height: 8 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.ok(data[2] > 80, "the vacated region did not heal to the surrounding ground");
});

test("a passing surface is byte-identical after the repair — a repair is never a redesign", async () => {
  const master = await severedSheet();
  const source = { x: 1700, y: 3200, w: 1200, h: 200 };
  const result = await repairMasterPanels({
    masterBytes: master,
    manifest: MANIFEST,
    containment: [severed("contact bar", source, ["hood", "front", "rear"])],
  });
  for (const key of ["driver", "passenger"]) {
    const zone = ZONES.find((z) => z.surfaceKey === key);
    const crop = (bytes) => sharp(bytes).extract({ left: zone.x, top: zone.y, width: zone.width, height: zone.height }).raw().toBuffer();
    assert.deepEqual(await crop(result.bytes), await crop(master), `${key} was modified by a repair aimed elsewhere`);
  }
});

test("the repaired sheet passes the panel QC that convicted the original", async () => {
  const master = await severedSheet();
  const source = { x: 1700, y: 3200, w: 1200, h: 200 };
  const containment = [severed("contact bar", source, ["hood", "front", "rear"])];

  const result = await repairMasterPanels({ masterBytes: master, manifest: MANIFEST, containment });
  const [entry] = result.repairs;

  const panels = [];
  for (const zone of ZONES) {
    panels.push({
      surfaceKey: zone.surfaceKey,
      bytes: await sharp(result.bytes).extract({ left: zone.x, top: zone.y, width: zone.width, height: zone.height }).png().toBuffer(),
    });
  }
  // The locator now finds the element where the repair put it, which is what a
  // live re-run does over the repaired bytes.
  const after = await inspectAtlasPanels({
    masterBytes: result.bytes,
    panels,
    manifest: MANIFEST,
    locateElements: async () => [{
      label: "contact bar",
      b: [
        Math.round((entry.targetRect.y / 4096) * 1000),
        Math.round((entry.targetRect.x / 4096) * 1000),
        Math.round(((entry.targetRect.y + entry.targetRect.h) / 4096) * 1000),
        Math.round(((entry.targetRect.x + entry.targetRect.w) / 4096) * 1000),
      ],
    }],
  });
  assert.deepEqual(after.failing, []);
  assert.equal(after.passing.length, 6);
});

test("panel repair never asks a model for anything", () => {
  const source = require_("node:fs").readFileSync(new URL("../runtime/atlas-panel-repair.cjs", import.meta.url), "utf8");
  for (const name of ["generateRaw", "geminiJson", "inlineData", "responseMimeType"]) {
    assert.ok(!source.includes(name), `panel repair must not reach a provider (found ${name})`);
  }
});

test("a master that cannot be decoded raises rather than returning something", async () => {
  await assert.rejects(
    () => repairMasterPanels({ masterBytes: null, manifest: MANIFEST, containment: [] }),
    (error) => error instanceof PanelRepairError && error.code === "atlas_panel_repair_master_missing",
  );
});
