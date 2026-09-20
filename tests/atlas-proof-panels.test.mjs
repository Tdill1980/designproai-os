/**
 * THE THREE QUADRANTS COME OUT AS ARTIFACTS, CUT BY THE CODE THAT DREW THEM.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-18: "the three quadrants ... panels with the graphics, panels
 * without the overlay graphic just the design, and the graphic overlays by
 * themselves", and "each template will have different size rectangles based on
 * vehicle type."
 *
 * The proof sheet is a document; what production consumes are the rectangles
 * inside it. Until this, nothing cut them — `atlas-proof-zone-gate.cjs`
 * measured the cells and discarded the pixels.
 *
 * WHAT THESE ASSERTIONS ARE FOR, each tied to a way this can be wrong:
 *
 *   - the rectangles come from `containerLayout`, the function that DREW them.
 *     A cutter that re-derives its own geometry drifts from the drawing on the
 *     first slot-width change, and the drift is invisible: you get plausible
 *     panels of the wrong regions.
 *   - they scale with the sheet. The container is authored at 1536x1024 and the
 *     model returns 5056x3392, so an absolute rectangle cuts the wrong third of
 *     the sheet while looking entirely reasonable in a unit test.
 *   - a sheet of the wrong SHAPE is refused, not cut.
 *   - zone 3 has FIVE slots and no inches, because a cut graphic is sized at
 *     the plotter. Asserting six there would be asserting the wrong product.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { cutProofPanels, scaleCell, QUADRANTS, PANELS_CONTRACT } =
  require_("../runtime/atlas-proof-panels.cjs");
const { parsePanelRows, containerLayout, WIDTH, HEIGHT } =
  require_("../runtime/atlas-proof-container-template.cjs");
const sharp = require_("../runtime/node_modules/sharp");

const TRANSIT = parsePanelRows([
  'DRIVER: 215" wide x 66" high', 'PASSENGER: 215" wide x 66" high',
  'HOOD: 69" wide x 42" high', 'ROOF: 65" wide x 89" high',
  'FRONT: 69" wide x 31.5" high', 'REAR: 69" wide x 50" high',
]);
const F250 = parsePanelRows([
  'DRIVER: 251" wide x 60" high', 'PASSENGER: 251" wide x 60" high',
  'HOOD: 66" wide x 62" high', 'ROOF: 82" wide x 68" high',
  'FRONT: 80" wide x 34" high', 'REAR: 78" wide x 44" high',
]);

/** Distinct artwork rectangles on a page; a solid image has no panel boundaries. */
async function sheet(w, h, manifest = TRANSIT, { shift = 0, missing = null } = {}) {
  const layout = containerLayout(manifest);
  const sx = w / layout.width, sy = h / layout.height;
  const rects = ["zone1", "zone2", "zone3"].flatMap((zone) => layout[zone]
    .filter((cell) => `${zone}:${cell.surfaceKey}` !== missing)
    .map((cell) => `<rect x="${(cell.x + shift) * sx}" y="${cell.y * sy}" width="${cell.w * sx}" height="${cell.h * sy}" fill="#235a89"/>`));
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="white"/>${rects.join("")}</svg>`)).png().toBuffer();
}

test("all three quadrants come out: 6 branded, 6 clean, 5 cut graphics", async () => {
  const out = await cutProofPanels({ proofBytes: await sheet(3072, 2048), manifest: TRANSIT, sharp });
  assert.equal(out.contract, PANELS_CONTRACT);
  assert.equal(out.refused, null);

  const byZone = (z) => out.panels.filter((p) => p.zone === z);
  assert.equal(byZone("zone1").length, 6, "zone 1 is the six branded production panels");
  assert.equal(byZone("zone2").length, 6, "zone 2 is the same six without the overlay");
  // FIVE, not six. Zone 3 is logo / tagline / contact / promo / icons — the
  // owner's own slots — and it is not a per-surface band.
  assert.equal(byZone("zone3").length, 5, "zone 3 is the five cut-graphic slots");

  assert.deepEqual(byZone("zone1").map((p) => p.role), Array(6).fill(QUADRANTS.zone1));
  assert.deepEqual(byZone("zone3").map((p) => p.surfaceKey),
    ["logo", "tagline", "contact", "promo", "icons"]);

  // Every panel carries BYTES that decode, at the rectangle it claims.
  for (const panel of out.panels) {
    const meta = await sharp(panel.bytes).metadata();
    assert.equal(meta.width, panel.rect.width, `${panel.zone}/${panel.surfaceKey} width`);
    assert.equal(meta.height, panel.rect.height, `${panel.zone}/${panel.surfaceKey} height`);
    assert.ok(panel.byteSize > 0);
  }
});

test("detected bounds follow shifted artwork; identity is not assigned from array order", async () => {
  const layout = containerLayout(TRANSIT);
  const out = await cutProofPanels({ proofBytes: await sheet(3072, 2048, TRANSIT, { shift: 6 }), manifest: TRANSIT, sharp });
  assert.equal(out.refused, null);
  for (const panel of out.panels.filter((p) => p.zone !== "zone3")) {
    const cell = layout[panel.zone].find((c) => c.surfaceKey === panel.surfaceKey);
    const expected = scaleCell({ ...cell, x: cell.x + 6 }, layout, out.sheet);
    assert.ok(Math.abs(panel.rect.left - expected.left) <= 5);
    assert.ok(Math.abs(panel.rect.width - expected.width) <= 5);
    assert.equal(panel.positionalPremiseVerified, true);
    assert.equal(panel.productionApproved, false);
  }
});

test("reflowed equal-aspect flanks and missing panels refuse instead of guessing", async () => {
  const shifted = await cutProofPanels({ proofBytes: await sheet(3072, 2048, TRANSIT, { shift: 60 }), manifest: TRANSIT, sharp });
  assert.match(shifted.refused, /panel_identity_ambiguous/);
  assert.deepEqual(shifted.panels, []);
  const missing = await cutProofPanels({ proofBytes: await sheet(3072, 2048, TRANSIT, { missing: "zone1:rear" }), manifest: TRANSIT, sharp });
  assert.match(missing.refused, /panel_count:5<6/);
  assert.deepEqual(missing.panels, []);
});

test("a bigger sheet moves every rectangle proportionally — nothing is absolute", async () => {
  // An absolute rectangle cuts the wrong region of a 5056px sheet while looking
  // perfectly sensible against the 1536px container it was written for.
  const small = await cutProofPanels({ proofBytes: await sheet(1536, 1024), manifest: TRANSIT, sharp });
  const large = await cutProofPanels({ proofBytes: await sheet(5056, 3371), manifest: TRANSIT, sharp });
  assert.equal(small.refused, null);
  assert.equal(large.refused, null);
  const k = 5056 / 1536;

  for (let i = 0; i < small.panels.length; i += 1) {
    const a = small.panels[i].rect;
    const b = large.panels.find((p) => p.zone === small.panels[i].zone && p.surfaceKey === small.panels[i].surfaceKey).rect;
    assert.ok(Math.abs(b.left - a.left * k) <= 9,
      `${small.panels[i].surfaceKey} left did not scale: ${a.left}*${k.toFixed(2)} vs ${b.left}`);
    assert.ok(Math.abs(b.width - a.width * k) <= 9,
      `${small.panels[i].surfaceKey} width did not scale`);
  }
});

test("each vehicle gets DIFFERENT rectangles — the template is not pinned to one", async () => {
  // Owner: "each template will have different size rectangles based on vehicle
  // type." An F250 flank is 4.19:1 against a Transit's 3.25, and its roof is
  // landscape where the Transit's is portrait — so the cut must differ too.
  const t = await cutProofPanels({ proofBytes: await sheet(3072, 2048), manifest: TRANSIT, sharp });
  const f = await cutProofPanels({ proofBytes: await sheet(3072, 2048, F250), manifest: F250, sharp });

  const roofOf = (r) => r.panels.find((p) => p.zone === "zone1" && p.surfaceKey === "roof").rect;
  const tRoof = roofOf(t);
  const fRoof = roofOf(f);
  assert.ok(tRoof.height > tRoof.width, "the Transit roof cell is portrait");
  assert.ok(fRoof.width > fRoof.height, "the F250 roof cell is landscape");

  // And the cut graphics do NOT move: they are slots on the document, not
  // surfaces of the vehicle.
  const cut = (r) => r.panels.filter((p) => p.zone === "zone3").map((p) => p.rect);
  assert.deepEqual(cut(t), cut(f), "zone 3 slots are document furniture and must not vary by vehicle");
});

test("every panel carries the inches it stands for, and a cut graphic carries none", async () => {
  const out = await cutProofPanels({ proofBytes: await sheet(3072, 2048), manifest: TRANSIT, sharp });
  const driver = out.panels.find((p) => p.zone === "zone1" && p.surfaceKey === "driver");
  assert.equal(driver.widthIn, 215);
  assert.equal(driver.heightIn, 66);
  // The clean twin stands for the same physical rectangle.
  const clean = out.panels.find((p) => p.zone === "zone2" && p.surfaceKey === "driver");
  assert.equal(clean.widthIn, 215);
  assert.equal(clean.heightIn, 66);
  // A cut graphic is sized at the plotter; claiming inches here would be a
  // number nothing measured.
  for (const g of out.panels.filter((p) => p.zone === "zone3")) {
    assert.equal(g.widthIn, null, `${g.surfaceKey} must not claim print inches`);
    assert.equal(g.heightIn, null);
  }
});

test("a sheet of the wrong SHAPE is refused, never cut into plausible wrong regions", async () => {
  // The edge's shape gate refuses a genuine re-flow first; this is the second
  // door. Cutting a stretched sheet yields six believable panels of the wrong
  // thirds, which is worse than a refusal because nothing downstream can tell.
  const square = await cutProofPanels({ proofBytes: await sheet(2048, 2048), manifest: TRANSIT, sharp });
  assert.match(String(square.refused), /atlas_proof_panels_aspect_drift/);
  assert.deepEqual(square.panels, []);

  await assert.rejects(
    () => cutProofPanels({ proofBytes: Buffer.from("nope"), manifest: TRANSIT, sharp }),
    (err) => /unreadable_sheet|unsupported image format|Input buffer/i.test(err.message),
  );
});

test("geometric evidence is recorded for located panels; Zone 3 remains unverified", async () => {
  // atlas-proof-zone-gate recorded it falsified on live sheet d5314267: the
  // model keeps the bands and the identities and arranges the panels itself.
  // Four live sheets have held the order; four is not a law. A consumer that
  // needs certainty asks PanelPro's human QC, and it can only do that if the
  // panel says so rather than looking authoritative.
  const out = await cutProofPanels({ proofBytes: await sheet(3072, 2048), manifest: TRANSIT, sharp });
  for (const panel of out.panels) {
    assert.equal(panel.positionalPremiseVerified, panel.zone !== "zone3",
      `${panel.zone}/${panel.surfaceKey} claims a placement nothing has proven`);
    assert.equal(typeof panel.fit, "number", "every panel reports how much of its cell is painted");
  }
});

test("the container's own canvas is what the scaling is relative to", () => {
  // A hard-coded 1536 here and a changed WIDTH there is a silent halving of
  // every rectangle, so the constant is read rather than repeated.
  const layout = containerLayout(TRANSIT);
  assert.equal(layout.width, WIDTH);
  assert.equal(layout.height, HEIGHT);
  const rect = scaleCell({ x: 0, y: 0, w: WIDTH, h: HEIGHT }, layout, { width: 4000, height: 2667 });
  assert.equal(rect.left, 0);
  assert.equal(rect.top, 0);
  assert.equal(rect.width, 4000, "a full-canvas cell must cover the whole sheet");
  assert.equal(rect.height, 2667);
});
