// ARCHITECTURE_DAG.md chunk 6 — `element.lockup`, the placement manifest.
//
// Normalized {xPct, yPct, wPct, hPct} in the vocabulary RestylePro already uses.
// Zero AI, zero pixels: dimensions in, a plan out.
//
// The three properties that are GEOMETRY, and therefore locked here:
//
//   1. ASPECT IS PRESERVED. The two axes are normalized against different pixel
//      dimensions, so holding an element's shape means
//        hPct = wPct x (elemH/elemW) x (trimW/trimH)
//      Get it wrong and the customer's logo is stretched -- a defect nobody
//      notices until it is on vinyl.
//   2. THE PASSENGER BOX IS THE DRIVER BOX MIRRORED (xPct' = 1 - xPct - wPct),
//      and the ELEMENT is not flipped. Same physical place on the vehicle, still
//      reading left to right. This is the whole payoff of the port: no band to
//      read back, nothing to paste over.
//   3. NOTHING LEAVES THE SAFE AREA, and an over-tall stack scales as a GROUP so
//      the arrangement survives instead of one element shrinking out of
//      proportion.
//
// Arrangement (left-anchored, vertically centred, logo/type/contact) is TASTE
// with a named constant each, not law.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const runtimeRequire = createRequire(join(HERE, "..", "runtime", "package.json"));
const lockup = runtimeRequire(join(HERE, "..", "runtime", "atlas-element-lockup.cjs"));

// A driver flank as it really sits: rotated 90 degrees on the 4096 sheet, so its
// displayed 600x2400 reads as a 2400x600 panel.
const FLANK = { surfaceKey: "driver", rotationDegrees: 90, trim: { w: 600, h: 2400 } };
const ZONES = [FLANK, { surfaceKey: "passenger", rotationDegrees: -90, trim: { w: 600, h: 2400 } }];
const el = (role, width, height) => ({ role, width, height, contentHash: role[0].repeat(64), storagePath: `atlas-elements/${role}.png` });

const boxOf = (plan, surfaceKey, role) => plan.placements.find((p) => p.surfaceKey === surfaceKey && p.role === role).box;

// Boxes are rounded to 1e-6 on purpose -- a manifest with eighteen decimals of
// float noise is not a manifest. So aspect is compared RELATIVELY, at a
// tolerance that rounding cannot breach even on a heavily scaled group, rather
// than at an absolute 1e-6 that rounding alone would fail.
const aspectCloseTo = (actual, expected, what) => assert.ok(
  Math.abs(actual - expected) / expected < 1e-3,
  `${what}: aspect ${actual} is not ${expected}`,
);

test("a rotated flank is measured in its own reading orientation", () => {
  assert.deepEqual(lockup.readingTrimSize(FLANK), { w: 2400, h: 600 });
  assert.deepEqual(lockup.readingTrimSize({ rotationDegrees: 0, trim: { w: 1200, h: 800 } }), { w: 1200, h: 800 });
});

test("aspect ratio survives the normalized axes", () => {
  const plan = lockup.planElementLockup({ zones: ZONES, elements: [el("typography", 1600, 400), el("contact", 1600, 200)] });
  const trim = lockup.readingTrimSize(FLANK);

  for (const [role, source] of [["typography", [1600, 400]], ["contact", [1600, 200]]]) {
    const box = boxOf(plan, "driver", role);
    const drawnW = box.wPct * trim.w;
    const drawnH = box.hPct * trim.h;
    const sourceAspect = source[0] / source[1];
    aspectCloseTo(drawnW / drawnH, sourceAspect, `${role} drawn ${drawnW}x${drawnH}`);
  }
});

test("the passenger box is the driver box mirrored, and the element is NOT flipped", () => {
  const plan = lockup.planElementLockup({ zones: ZONES, elements: [el("typography", 1600, 400)] });
  const driver = boxOf(plan, "driver", "typography");
  const passenger = boxOf(plan, "passenger", "typography");

  assert.ok(Math.abs(passenger.xPct - (1 - driver.xPct - driver.wPct)) < 1e-6, "RULE 0.36's own mapping");
  assert.equal(passenger.yPct, driver.yPct);
  assert.equal(passenger.wPct, driver.wPct);
  assert.equal(passenger.hPct, driver.hPct);

  // The mirror is the BOX. Flip the artwork and the company name reads
  // backwards -- which is the live defect 8eec8162 shipped.
  for (const placement of plan.placements) {
    assert.equal(placement.flipped, false, "the element is composited un-flipped, always");
  }
  assert.equal(plan.placements.find((p) => p.surfaceKey === "passenger").mirroredFrom, "driver");
  assert.equal(plan.placements.find((p) => p.surfaceKey === "driver").mirroredFrom, null);

  // Both flanks, and only the flanks, until the owner rules on the other four.
  assert.deepEqual([...new Set(plan.placements.map((p) => p.surfaceKey))].sort(), ["driver", "passenger"]);
});

test("the stack is ordered logo, typography, contact — and stays inside the safe area", () => {
  const plan = lockup.planElementLockup({
    zones: ZONES,
    elements: [el("contact", 1600, 200), el("typography", 1600, 400), el("logo", 800, 800)],
  });
  const driver = plan.placements.filter((p) => p.surfaceKey === "driver");
  assert.deepEqual(driver.map((p) => p.role), ["logo", "typography", "contact"],
    "input order must not decide the arrangement");

  // Strictly descending down the panel, no overlap.
  for (let i = 1; i < driver.length; i += 1) {
    const above = driver[i - 1].box;
    const below = driver[i].box;
    assert.ok(below.yPct >= above.yPct + above.hPct, `${driver[i].role} overlaps ${driver[i - 1].role}`);
  }

  for (const { box } of plan.placements) {
    assert.ok(box.xPct >= 0 && box.yPct >= 0);
    assert.ok(box.xPct + box.wPct <= 1);
    assert.ok(box.yPct + box.hPct <= 1);
  }
});

test("an over-tall stack scales as a GROUP, never one element out of proportion", () => {
  // Three tall elements on a short panel: the natural stack cannot fit.
  const tall = [el("logo", 400, 1200), el("typography", 400, 1200), el("contact", 400, 1200)];
  const plan = lockup.planElementLockup({ zones: ZONES, elements: tall });
  assert.ok(plan.arrangement.groupScale < 1, "expected the group to be scaled down");

  const driver = plan.placements.filter((p) => p.surfaceKey === "driver");
  const last = driver[driver.length - 1].box;
  assert.ok(last.yPct + last.hPct <= 1, "the stack must still land inside the panel");

  // Every element scaled by the SAME factor: their widths stay equal, and each
  // keeps its own aspect.
  const widths = new Set(driver.map((p) => p.box.wPct));
  assert.equal(widths.size, 1, "one lockup width, scaled once");
  const trim = lockup.readingTrimSize(FLANK);
  for (const placement of driver) {
    const drawn = (placement.box.wPct * trim.w) / (placement.box.hPct * trim.h);
    aspectCloseTo(drawn, 400 / 1200, `${placement.role} after group scaling`);
  }
});

test("nothing to place is null, not an empty plan", () => {
  assert.equal(lockup.planElementLockup({ zones: ZONES, elements: [] }), null);
  assert.equal(lockup.planElementLockup({ zones: ZONES, elements: [{ role: "mystery", width: 10, height: 10 }] }), null);
});

test("an element with no dimensions, or a missing flank, refuses rather than guessing", () => {
  assert.throws(
    () => lockup.planElementLockup({ zones: ZONES, elements: [{ role: "typography", width: 0, height: 10 }] }),
    (err) => err.code === "atlas_lockup_element_invalid",
  );
  assert.throws(
    () => lockup.planElementLockup({ zones: [{ surfaceKey: "hood", trim: { w: 10, h: 10 } }], elements: [el("typography", 100, 50)] }),
    (err) => err.code === "atlas_lockup_zone_invalid",
  );
  assert.throws(
    () => lockup.planElementLockup({ zones: [{ surfaceKey: "driver", trim: { w: 0, h: 0 } }], elements: [el("typography", 100, 50)] }),
    (err) => err.code === "atlas_lockup_zone_invalid",
  );
});

test("the plan carries the constants it was built from, so a receipt explains itself", () => {
  const plan = lockup.planElementLockup({ zones: ZONES, elements: [el("typography", 1600, 400)] });
  assert.equal(plan.contract, "designpro.atlas-element-lockup.v1");
  assert.equal(plan.primarySurface, "driver");
  assert.equal(plan.deterministic, true);
  assert.equal(plan.arrangement.lockupWidthPct, lockup.LOCKUP_WIDTH_PCT);
  assert.equal(plan.arrangement.safeMarginPct, lockup.SAFE_MARGIN_PCT);
  assert.equal(plan.arrangement.horizontalAnchor, "left");
  assert.equal(plan.arrangement.verticalAnchor, "middle");
});

test("the same elements plan the same boxes, twice", () => {
  const once = lockup.planElementLockup({ zones: ZONES, elements: [el("typography", 1600, 400), el("contact", 1600, 200)] });
  const twice = lockup.planElementLockup({ zones: ZONES, elements: [el("typography", 1600, 400), el("contact", 1600, 200)] });
  assert.deepEqual(once, twice);
});
