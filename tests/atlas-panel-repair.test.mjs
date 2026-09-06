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

const severed = (label, kind, rect, surfaces) => ({ label, kind, status: "severed", rect, surfaces, crossings: [] });
const BADGE = severed("arctic air badge", "logo", { x: 983, y: 3240, w: 258, h: 319 }, ["roof", "hood"]);
const BANNER = severed("www.arcticair.com contact banner", "website", { x: 1249, y: 3256, w: 1831, h: 299 }, ["hood", "front", "rear"]);

test("a lockup that reads as one unit MOVES as one unit", () => {
  // Moving the badge and the banner independently would re-space or re-order
  // them, which IS a redesign. They sit 8 px apart on one contact bar. The
  // lifted rectangle is the union plus the halo dilation on every side.
  const plan = planPanelRepair({ containment: [BADGE, BANNER], manifest: MANIFEST, masterWidth: 4096 });
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].labels, ["arctic air badge", "www.arcticair.com contact banner"]);
  assert.ok(plan[0].sourceRect.x < 983 && plan[0].sourceRect.x + plan[0].sourceRect.w > 3080);
  assert.ok(plan[0].sourceRect.y < 3240 && plan[0].sourceRect.y + plan[0].sourceRect.h > 3559);
});

test("THE OWNER'S CONTRACT: contact information goes to the REAR by default, badge and all", () => {
  // Not "whichever surface already holds most of it" -- that rule put the
  // website on the hood and left the rear bare, and the owner rejected it by
  // name. A lockup carrying a website IS contact information; the badge beside
  // it rides along.
  const [entry] = planPanelRepair({ containment: [BADGE, BANNER], manifest: MANIFEST, masterWidth: 4096 });
  assert.equal(entry.placeable, true);
  assert.equal(entry.kind, "contact");
  assert.equal(entry.surfaceKey, "rear");
  assert.equal(entry.assignmentBasis, "default");
  assert.deepEqual(entry.acrossSurfaces, ["hood", "rear", "front", "roof"]);
});

test("a severed brand mark goes to the HOOD by default", () => {
  const [entry] = planPanelRepair({ containment: [BADGE], manifest: MANIFEST, masterWidth: 4096 });
  assert.equal(entry.kind, "logo");
  assert.equal(entry.surfaceKey, "hood");
  assert.equal(entry.assignmentBasis, "default");
});

test("an explicit customer placement always wins over the default", () => {
  const [entry] = planPanelRepair({
    containment: [BADGE, BANNER], manifest: MANIFEST, masterWidth: 4096,
    placements: { contact: "hood" },
  });
  assert.equal(entry.surfaceKey, "hood");
  assert.equal(entry.assignmentBasis, "customer");
});

test("a kind the contract does not assign is REFUSED, never guessed a home", () => {
  // Roof and front carry continuous artwork by default; a severed photograph
  // has no default surface, and inventing one is the heuristic this replaces.
  const photo = severed("installer photograph", "photograph", { x: 1500, y: 3200, w: 1200, h: 300 }, ["hood", "front"]);
  const [entry] = planPanelRepair({ containment: [photo], manifest: MANIFEST, masterWidth: 4096 });
  assert.equal(entry.placeable, false);
  assert.equal(entry.code, "atlas_panel_element_unassigned");
  // ...unless the customer said where it goes.
  const [placed] = planPanelRepair({ containment: [photo], manifest: MANIFEST, masterWidth: 4096, placements: { photograph: "front" } });
  assert.equal(placed.placeable, true);
  assert.equal(placed.surfaceKey, "front");
});

test("driver and passenger are never a relocation target by default", () => {
  const [entry] = planPanelRepair({
    containment: [BANNER], manifest: MANIFEST, masterWidth: 4096,
    // a default table entry can never name a flank; only the customer can
  });
  assert.notEqual(entry.surfaceKey, "driver");
  assert.notEqual(entry.surfaceKey, "passenger");
  const contact = severed("contact", "contact", { x: 1500, y: 3300, w: 800, h: 100 }, ["hood", "front"]);
  const [forced] = planPanelRepair({ containment: [contact], manifest: MANIFEST, masterWidth: 4096, placements: { contact: "driver" } });
  // explicit customer instruction may target a flank; the default never does
  assert.equal(forced.surfaceKey, "driver");
  assert.equal(forced.assignmentBasis, "customer");
});

test("the placed rectangle lies inside the rear's trim, with the installer tolerance clear", () => {
  const [entry] = planPanelRepair({ containment: [BADGE, BANNER], manifest: MANIFEST, masterWidth: 4096 });
  const rear = ZONES.find((zone) => zone.surfaceKey === "rear");
  const box = _test.placeableRect(rear);
  const rect = entry.targetRect;
  assert.ok(rect.x >= box.x, `${rect.x} >= ${box.x}`);
  assert.ok(rect.y >= box.y, `${rect.y} >= ${box.y}`);
  assert.ok(rect.x + rect.w <= box.x + box.w);
  assert.ok(rect.y + rect.h <= box.y + box.h);
  // ...and the tolerance is 2 VEHICLE INCHES, not 2 pixels.
  const inPerPx = rear.printWidthIn / rear.trim.width;
  assert.ok(Math.abs((box.x - rear.trim.x) * inPerPx - INSTALLER_INSET_IN) < 0.1);
});

test("aspect ratio is preserved and the element is never enlarged", () => {
  const [entry] = planPanelRepair({ containment: [BADGE, BANNER], manifest: MANIFEST, masterWidth: 4096 });
  const sourceAspect = entry.sourceRect.w / entry.sourceRect.h;
  const targetAspect = entry.targetRect.w / entry.targetRect.h;
  assert.ok(Math.abs(targetAspect - sourceAspect) / sourceAspect < 0.02);
  assert.ok(entry.scale <= 1);
});

test("an element that cannot fit its ASSIGNED surface is refused — never shrunk, never relocated elsewhere", () => {
  // A contact bar the full width of the sheet: on the rear it would print
  // under the legible minimum. The hood could hold it larger; that is not an
  // option the contract offers.
  const huge = severed("full-width contact bar", "contact", { x: 0, y: 3240, w: 4096, h: 20 }, ["roof", "hood", "front"]);
  const [entry] = planPanelRepair({ containment: [huge], manifest: MANIFEST, masterWidth: 4096 });
  assert.equal(entry.placeable, false);
  assert.equal(entry.code, "atlas_panel_element_does_not_fit");
  assert.equal(entry.assignedSurface, "rear");
  assert.match(entry.reason, new RegExp(`${MIN_ELEMENT_HEIGHT_IN}"`));
});

test("a refused element fails the whole repair with the reason, rather than repairing around it", async () => {
  const master = await sharp({ create: { width: 4096, height: 4096, channels: 3, background: { r: 20, g: 60, b: 120 } } }).png().toBuffer();
  const huge = severed("full-width contact bar", "contact", { x: 0, y: 3240, w: 4096, h: 20 }, ["roof", "hood", "front"]);
  await assert.rejects(
    () => repairMasterPanels({ masterBytes: master, manifest: MANIFEST, containment: [huge] }),
    (error) => error instanceof PanelRepairError && error.code === "atlas_panel_element_unplaceable" && /does not fit|minimum/.test(error.message),
  );
});

test("nothing severed means nothing changes, byte for byte", async () => {
  const master = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 20, g: 60, b: 120 } } }).png().toBuffer();
  const result = await repairMasterPanels({
    masterBytes: master,
    manifest: MANIFEST,
    containment: [{ label: "lockup", kind: "logo", status: "contained", rect: { x: 10, y: 10, w: 20, h: 20 }, surfaces: ["driver"] }],
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
    containment: [severed("contact bar", "contact", source, ["hood", "front", "rear"])],
  });
  assert.equal(result.changed, true);

  const [entry] = result.repairs;
  assert.equal(entry.placeable, true);
  assert.equal(entry.surfaceKey, "rear");

  // It is whole where it landed. The lifted crop carries its halo (15% of the
  // element's shorter side, so a glow or a hair tuft travels with it), so the
  // bar fills the INTERIOR of the target, not its outermost ring.
  const t = entry.targetRect;
  const inset = Math.ceil(Math.min(t.w, t.h) * 0.15) + 2;
  const interior = { x: t.x + inset, y: t.y + inset, w: t.w - 2 * inset, h: t.h - 2 * inset };
  assert.ok(await redAt(result.bytes, interior) > 0.98, "the moved element is not intact at its target");
  assert.ok(await redAt(result.bytes, t) > 0.6, "the target does not carry the element");

  // ...and it is GONE from where it was cut: nothing red survives on the hood
  // side of x=2198 or the front side of y=3335.
  assert.ok(await redAt(result.bytes, { x: source.x, y: source.y, w: 2198 - source.x, h: source.h }) < 0.01, "the element still sits on the hood");
  assert.ok(await redAt(result.bytes, { x: 2198, y: source.y, w: 700, h: 3335 - source.y }) < 0.01, "the element still sits on the front");

  // The vacated area is HEALED, not left transparent or black: it now carries
  // the surrounding artwork's own colour.
  const { data } = await sharp(result.bytes)
    .extract({ left: 1900, top: source.y + 40, width: 8, height: 8 })
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
    containment: [severed("contact bar", "contact", source, ["hood", "front", "rear"])],
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
  const containment = [severed("contact bar", "contact", source, ["hood", "front", "rear"])];

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
      kind: "contact",
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

test("the repaired sheet keeps the master's density, so an untouched panel hashes identically through the real cutter", async () => {
  const master = await sharp({ create: { width: 4096, height: 4096, channels: 3, background: { r: 20, g: 60, b: 120 } } })
    .withMetadata({ density: 300 }).png().toBuffer();
  const source = { x: 1700, y: 3200, w: 1200, h: 200 };
  const bar = await sharp({ create: { width: 1200, height: 200, channels: 3, background: { r: 220, g: 30, b: 40 } } }).png().toBuffer();
  const sheet = await sharp(master).composite([{ input: bar, left: source.x, top: source.y }]).withMetadata({ density: 300 }).png().toBuffer();
  const result = await repairMasterPanels({ masterBytes: sheet, manifest: MANIFEST, containment: [severed("contact bar", "contact", source, ["hood", "front", "rear"])] });
  assert.equal((await sharp(result.bytes).metadata()).density, 300);
});

test("nothing outside a zone is painted by a single byte", async () => {
  const master = await severedSheet();
  const source = { x: 1700, y: 3200, w: 1200, h: 200 };
  const result = await repairMasterPanels({ masterBytes: master, manifest: MANIFEST, containment: [severed("contact bar", "contact", source, ["hood", "front", "rear"])] });
  // The strip directly under the hood container (y >= 3558, x 1071..2198) is
  // outside every zone. Its bytes must be exactly what they were.
  const crop = (bytes) => sharp(bytes).extract({ left: 1071, top: 3558, width: 1127, height: 300 }).raw().toBuffer();
  assert.deepEqual(await crop(result.bytes), await crop(master));
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
