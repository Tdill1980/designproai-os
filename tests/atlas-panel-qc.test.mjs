import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
// sharp lives in the runtime image, not the repo root (same as tests/atlas-artwork-compose.test.mjs)

const require_ = createRequire(import.meta.url);
const sharp = require_("../runtime/node_modules/sharp");
const {
  boxToMasterRect,
  crossedEdges,
  inspectAtlasPanels,
  locateMasterElements,
  planElementContainment,
  PanelQcError,
} = require_("../runtime/atlas-panel-qc.cjs");

/**
 * THE FIXTURE IS THE REAL FAILED RUN.
 *
 * Zones are Arctic Air `63e6629a`'s own persisted A.T.L.A.S. manifest
 * (`1532c871…`, 2022 Toyota Prius, master 4096x4096). Element boxes are
 * measured off that master's pixels: the bottom band carries ONE contact
 * lockup, an `ARCTIC AIR` badge at x 985..1240 followed by a
 * `Www.ArcticAir.com` banner at x 1250..3080, both spanning y 3240..3560.
 *
 * The cut lines through that band are x=1071 (roof|hood), x=2198 (hood|front
 * and hood|rear) and y=3335 (front|rear). So the badge is cut in two and the
 * banner in three, which is exactly what the six delivered panels show:
 * `Www.Arct` on the hood, `ticAir.com` on the rear, a banner sliver on the
 * front and a badge sliver on the roof.
 */
const ARCTIC_AIR_ZONES = [
  { surfaceKey: "driver", x: 0, y: 72, width: 4096, height: 1221, trim: { x: 113, y: 185, width: 3870, height: 995 }, printWidthIn: 171.1, printHeightIn: 44, bleedInches: 5 },
  { surfaceKey: "passenger", x: 0, y: 1437, width: 4096, height: 1221, trim: { x: 113, y: 1550, width: 3870, height: 995 }, printWidthIn: 171.1, printHeightIn: 44, bleedInches: 5 },
  { surfaceKey: "roof", x: 0, y: 2730, width: 1071, height: 1207, trim: { x: 82, y: 2812, width: 907, height: 1043 }, printWidthIn: 55.44, printHeightIn: 63.78, bleedInches: 5 },
  { surfaceKey: "hood", x: 1071, y: 2730, width: 1127, height: 828, trim: { x: 1153, y: 2812, width: 963, height: 664 }, printWidthIn: 58.9, printHeightIn: 40.59, bleedInches: 5 },
  { surfaceKey: "front", x: 2198, y: 2730, width: 1898, height: 605, trim: { x: 2280, y: 2812, width: 1734, height: 441 }, printWidthIn: 106.03, printHeightIn: 27, bleedInches: 5 },
  { surfaceKey: "rear", x: 2198, y: 3335, width: 1127, height: 590, trim: { x: 2280, y: 3417, width: 963, height: 426 }, printWidthIn: 58.9, printHeightIn: 26.06, bleedInches: 5 },
];

const ARCTIC_AIR_MANIFEST = { zones: ARCTIC_AIR_ZONES };

// box_2d is [ymin, xmin, ymax, xmax] normalized 0..1000 of the 4096 master.
const px = (value) => Math.round((value / 4096) * 1000);
const ARCTIC_AIR_ELEMENTS = [
  { label: "yeti shield lockup", b: [px(330), px(690), px(1000), px(3290)] },
  { label: "installer photograph", b: [px(1575), px(502), px(2525), px(2865)] },
  { label: "arctic air wordmark", b: [px(1602), px(2350), px(2297), px(3579)] },
  { label: "arctic air badge", b: [px(3240), px(985), px(3560), px(1240)] },
  { label: "www.arcticair.com contact banner", b: [px(3255), px(1250), px(3555), px(3080)] },
];

const masterBytes = async (width = 4096, height = 4096) =>
  sharp({ create: { width, height, channels: 3, background: { r: 20, g: 60, b: 120 } } }).png().toBuffer();

const panelBytes = (zone) =>
  sharp({ create: { width: zone.width, height: zone.height, channels: 3, background: { r: 20, g: 60, b: 120 } } }).png().toBuffer();

async function arcticAirPanels() {
  const panels = [];
  for (const zone of ARCTIC_AIR_ZONES) panels.push({ surfaceKey: zone.surfaceKey, bytes: await panelBytes(zone) });
  return panels;
}

test("box_2d converts to master pixels", () => {
  assert.deepEqual(boxToMasterRect([0, 0, 1000, 1000], 4096, 4096), { x: 0, y: 0, w: 4096, h: 4096 });
  assert.deepEqual(boxToMasterRect([500, 250, 750, 500], 4096, 4096), { x: 1024, y: 2048, w: 1024, h: 1024 });
});

test("crossedEdges names every side an element runs off", () => {
  const outer = { x: 100, y: 100, w: 200, h: 200 };
  assert.deepEqual(crossedEdges({ x: 120, y: 120, w: 50, h: 50 }, outer, 0), []);
  assert.deepEqual(crossedEdges({ x: 50, y: 120, w: 100, h: 50 }, outer, 0), ["left"]);
  assert.deepEqual(crossedEdges({ x: 50, y: 50, w: 400, h: 400 }, outer, 0).sort(), ["bottom", "left", "right", "top"]);
});

test("THE ARCTIC AIR DEFECT: the contact lockup is convicted, the flanks are not", async () => {
  const report = await inspectAtlasPanels({
    masterBytes: await masterBytes(),
    panels: await arcticAirPanels(),
    manifest: ARCTIC_AIR_MANIFEST,
    locateElements: async () => ARCTIC_AIR_ELEMENTS,
  });

  assert.equal(report.locateUnavailable, null);
  assert.deepEqual(report.failing.sort(), ["front", "hood", "rear", "roof"]);
  assert.deepEqual(report.passing.sort(), ["driver", "passenger"]);

  const byLabel = new Map(report.elementsLocated.map((item) => [item.label, item]));

  // The two flank elements print whole — this is why driver and passenger came
  // back correct, and why a repair must not touch them.
  assert.equal(byLabel.get("yeti shield lockup").status, "contained");
  assert.deepEqual(byLabel.get("yeti shield lockup").surfaces, ["driver"]);
  assert.equal(byLabel.get("installer photograph").status, "contained");
  assert.deepEqual(byLabel.get("installer photograph").surfaces, ["passenger"]);
  assert.equal(byLabel.get("arctic air wordmark").status, "contained");
  assert.deepEqual(byLabel.get("arctic air wordmark").surfaces, ["passenger"]);

  // The badge is cut by x=1071.
  const badge = byLabel.get("arctic air badge");
  assert.equal(badge.status, "severed");
  assert.deepEqual(badge.surfaces.sort(), ["hood", "roof"]);

  // The banner is cut by x=2198 and by y=3335.
  const banner = byLabel.get("www.arcticair.com contact banner");
  assert.equal(banner.status, "severed");
  assert.deepEqual(banner.surfaces.sort(), ["front", "hood", "rear"]);

  const rear = report.surfaces.find((surface) => surface.surfaceKey === "rear");
  assert.equal(rear.ok, false);
  assert.deepEqual(rear.elementsSevered, ["www.arcticair.com contact banner"]);
  assert.equal(rear.findings[0].code, "atlas_panel_element_severed");

  const driver = report.surfaces.find((surface) => surface.surfaceKey === "driver");
  assert.equal(driver.ok, true);
  assert.deepEqual(driver.findings, []);
  assert.deepEqual(driver.elementsIntact, ["yeti shield lockup"]);
});

test("an element inside the bleed but inside its own container is reported separately", async () => {
  // Nudged so it clears the hood's trim on the left but stays inside the hood
  // container: the panel carries it, the installer's trim cut bites it.
  const element = { label: "hood badge", b: [px(2900), px(1090), px(3000), px(1400)] };
  const containment = planElementContainment([element], ARCTIC_AIR_MANIFEST, 4096, 4096);
  assert.equal(containment[0].status, "in_bleed");
  assert.deepEqual(containment[0].surfaces, ["hood"]);
  assert.deepEqual(containment[0].crossings[0].edges, ["left"]);
});

test("a clean sheet passes every surface", async () => {
  const report = await inspectAtlasPanels({
    masterBytes: await masterBytes(),
    panels: await arcticAirPanels(),
    manifest: ARCTIC_AIR_MANIFEST,
    // Every element well inside one trim rectangle.
    locateElements: async () => [
      { label: "flank lockup", b: [px(400), px(800), px(900), px(3000)] },
      { label: "hood badge", b: [px(2900), px(1300), px(3300), px(1900)] },
      { label: "rear contact", b: [px(3500), px(2400), px(3700), px(3100)] },
    ],
  });
  assert.deepEqual(report.failing, []);
  assert.equal(report.passing.length, 6);
});

test("a panel cut to the wrong aspect is convicted without any locator", async () => {
  const zone = ARCTIC_AIR_ZONES.find((z) => z.surfaceKey === "driver");
  const report = await inspectAtlasPanels({
    masterBytes: await masterBytes(),
    // portrait bytes for a landscape flank
    panels: [{ surfaceKey: "driver", bytes: await sharp({ create: { width: 1221, height: 4096, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer() }],
    manifest: { zones: [zone] },
    locateElements: async () => [],
  });
  assert.equal(report.failing[0], "driver");
  assert.equal(report.surfaces[0].findings[0].code, "atlas_panel_orientation_mismatch");
});

test("a locator outage fails OPEN with a durable receipt, never as a pass", async () => {
  const report = await inspectAtlasPanels({
    masterBytes: await masterBytes(),
    panels: await arcticAirPanels(),
    manifest: ARCTIC_AIR_MANIFEST,
    locateElements: async () => { throw new Error("provider unreachable"); },
  });
  assert.match(report.locateUnavailable, /provider unreachable/);
  assert.equal(report.elementsLocated, null);
  // "we could not look" must never read as "we looked and it was fine"
  assert.equal(report.passing.length, 0);
  assert.equal(report.failing.length, 6);
});

test("the ported locator re-asks rather than guessing a missing box", async () => {
  let calls = 0;
  const geminiJson = async () => {
    calls += 1;
    if (calls < 3) return { elements: [{ label: "wordmark" }] }; // no box_2d
    return { elements: [{ label: "wordmark", box_2d: [10, 10, 90, 90] }] };
  };
  const located = await locateMasterElements("Zm9v", { geminiJson });
  assert.equal(calls, 3);
  assert.deepEqual(located, [{ label: "wordmark", b: [10, 10, 90, 90] }]);
});

test("a locator that never returns a usable box raises, it does not return empty", async () => {
  await assert.rejects(
    () => locateMasterElements("Zm9v", { geminiJson: async () => ({ elements: [{ label: "x" }] }) }),
    (error) => error instanceof PanelQcError && error.code === "atlas_panel_qc_locate_unavailable",
  );
});

test("panel QC never asks the model to author anything", () => {
  const { ELEMENT_LOCATE_PROMPT } = require_("../runtime/atlas-panel-qc.cjs");
  for (const forbidden of ["draw", "generate", "create", "design", "render", "paint"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}`, "i").test(ELEMENT_LOCATE_PROMPT),
      `the locate prompt must not ask the model to ${forbidden} anything`,
    );
  }
  assert.match(ELEMENT_LOCATE_PROMPT, /Locate/);
});
