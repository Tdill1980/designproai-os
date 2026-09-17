// CONTAIN-FIT + EDGE-EXTEND CLOSES THE ASPECT GAP WITHOUT CROPPING, TILING OR
// DISTORTING (owner ruling, Trish 2026-09-17: "wire the exact active modules
// from RestylePro into designproai-os so the generation output matches the
// original production standard" — and, on the three alternatives, "No cropping,
// no tiling, no stretching").
//
// Ported from `restylepro-os`
// `supabase/functions/recreatepro-flat-panels/index.ts` `containExtend`, which
// RestylePro introduced on 2026-07-25 after `coverCrop` was reported as "front
// and hood cropped wrong". Its own comment states the rule: fill the trim,
// extend for bleed, never crop the design.
//
// THE MEASUREMENT THIS EXISTS FOR, from generation c3067608's own stored
// manifest (2026-09-17 22:30Z, the most recent real vehicle):
//
//   surface     zone        ratio    vs 21:9 (2.333:1, widest emittable)
//   front       1158x315    3.676    1.576
//   driver      985x2758    2.800    1.200
//   passenger   985x2758    2.800    1.200
//
// The old ceiling was 1.12, so front and both flanks were refused on EVERY
// vehicle whose surfaces exceed ~2.61:1 — refusing a model that had produced
// exactly the canvas it was asked for. Three of the four hero-driver failures
// that day read `front: aspect_drift:1.342`, each one discarding a completed
// `surface.*.view` render and falling over to the flat-sheet contract.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const hero = require("../runtime/atlas-hero-driver.cjs");

/** A 21:9 sheet — the widest canvas this model can emit — in three vertical bands. */
async function wideSheet(width = 2333, height = 1000) {
  const band = Math.floor(width / 3);
  return sharp({ create: { width, height, channels: 3, background: { r: 20, g: 120, b: 190 } } })
    .composite([
      { input: { create: { width: band, height, channels: 3, background: { r: 240, g: 60, b: 40 } } }, left: 0, top: 0 },
      { input: { create: { width: band, height, channels: 3, background: { r: 250, g: 230, b: 40 } } }, left: width - band, top: 0 },
    ]).png().toBuffer();
}

const px = (raw, info, x, y) => {
  const o = (y * info.width + x) * info.channels;
  return [raw[o], raw[o + 1], raw[o + 2]];
};
const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test("front at 3.676:1 — the shape that refused live — is accepted, whole and undistorted", async () => {
  // c3067608's front zone. The target is WIDER than the source, so contain-fit
  // binds on height and the margin is horizontal.
  const targetWidth = 1158, targetHeight = 315;
  const source = await wideSheet();
  const result = await hero.evaluateAuthored("front", source, targetWidth, targetHeight);

  assert.equal(result.accepted, true,
    "a 21:9 return against a 3.676:1 front is the model complying, not failing");
  const meta = await sharp(result.bytes).metadata();
  assert.equal(meta.width, targetWidth);
  assert.equal(meta.height, targetHeight);

  // ONE UNIFORM SCALE — that is what "no stretching" means here. The fitted
  // artwork keeps the source's own aspect to within a pixel of rounding.
  const c = result.containment;
  assert.equal(c.contract, hero.CONTAIN_EXTEND_CONTRACT);
  assert.equal(c.fittedHeightPx, targetHeight, "contain-fit binds exactly one axis");
  const sourceMeta = await sharp(source).metadata();
  const sourceRatio = sourceMeta.width / sourceMeta.height;
  const fittedRatio = c.fittedWidthPx / c.fittedHeightPx;
  assert.ok(Math.abs(fittedRatio - sourceRatio) < 0.01,
    `uniform scale only: ${fittedRatio.toFixed(4)} vs ${sourceRatio.toFixed(4)}`);

  // ...and the margin is real, on the axis contain-fit left short.
  assert.ok(c.bleedXPx > 0, "the wide front leaves a horizontal margin to bleed into");
  assert.equal(c.bleedYPx, 0);
});

test("both of the source's outer bands survive — nothing is cropped off the long axis", async () => {
  // This is the defect `coverCrop` was replaced for: a 3:1 target cover-cropped
  // from a 16:9/21:9 source slices the ends off. Contain-fit cannot, so the
  // FIRST and LAST bands of the source must both still be present.
  const targetWidth = 1158, targetHeight = 315;
  const result = await hero.evaluateAuthored("front", await wideSheet(), targetWidth, targetHeight);
  const { data, info } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
  const c = result.containment;
  const left = c.bleedXPx > 0 ? Math.floor((targetWidth - c.fittedWidthPx) / 2) : 0;
  const mid = Math.floor(targetHeight / 2);

  assert.ok(near(px(data, info, left + 4, mid), [240, 60, 40]),
    "the source's LEFT band is still inside the panel");
  assert.ok(near(px(data, info, left + c.fittedWidthPx - 5, mid), [250, 230, 40]),
    "the source's RIGHT band is still inside the panel — a cover-crop would have removed it");
  assert.ok(near(px(data, info, Math.floor(targetWidth / 2), mid), [20, 120, 190]),
    "and the centre band is unchanged");
});

test("the margin is the design's OWN edge pixels, so the panel is full bleed", async () => {
  const targetWidth = 1158, targetHeight = 315;
  const result = await hero.evaluateAuthored("front", await wideSheet(), targetWidth, targetHeight);
  const { data, info } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
  const mid = Math.floor(targetHeight / 2);

  // RULE 0.32 / RULE 0.15: the rectangle is printable artwork corner to corner.
  // Extending the fitted design's edge columns is the same natural bleed the
  // 5" outer bleed already uses — never white, never a frame.
  assert.ok(near(px(data, info, 0, mid), [240, 60, 40]),
    "the far-left column continues the design's left edge, not a white margin");
  assert.ok(near(px(data, info, targetWidth - 1, mid), [250, 230, 40]),
    "the far-right column continues the design's right edge");
  for (const corner of [[0, 0], [targetWidth - 1, 0], [0, targetHeight - 1], [targetWidth - 1, targetHeight - 1]]) {
    const [r, g, b] = px(data, info, corner[0], corner[1]);
    assert.ok(!(r > 248 && g > 248 && b > 248), `corner ${corner} must not be bare white`);
  }
});

test("the flank at 2.800:1 — refused at drift 1.200 — is accepted", async () => {
  // c3067608's driver/passenger zone. The zone is STORED rotated (985x2758),
  // but `zonePixelSize` un-rotates it, so the sheet is judged in its READING
  // orientation — which is why the live refusal was 1.200 (2.800/2.333) and not
  // the 6.5 a portrait comparison would have produced.
  const targetWidth = 2758, targetHeight = 985;
  const result = await hero.evaluateAuthored("driver", await wideSheet(), targetWidth, targetHeight);

  assert.equal(result.accepted, true, "drift 1.200 was a compliant 21:9 canvas all along");
  const meta = await sharp(result.bytes).metadata();
  assert.equal(meta.width, targetWidth);
  assert.equal(meta.height, targetHeight);
  assert.ok(result.containment.bleedXPx > 0);
});

test("the vertical branch: a hood taller than its source bleeds from the top and bottom ROWS", async () => {
  // c3067608's hood, 1086x676 (1.607:1), from the same 21:9 return. Here
  // contain-fit binds on WIDTH, so the margin is vertical — the other half of
  // the port, and the one whose edge rows span the full width because `ox` is 0.
  const targetWidth = 1086, targetHeight = 676;
  const result = await hero.evaluateAuthored("hood", await wideSheet(), targetWidth, targetHeight);

  assert.equal(result.accepted, true);
  const c = result.containment;
  assert.equal(c.fittedWidthPx, targetWidth, "contain-fit binds exactly one axis");
  assert.equal(c.bleedXPx, 0);
  assert.ok(c.bleedYPx > 0);
  // The two bands together are the whole vertical gap: nothing is left blank.
  assert.equal(c.bleedYPx, targetHeight - c.fittedHeightPx);

  const { data, info } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
  const midX = Math.floor(targetWidth / 2);
  assert.ok(near(px(data, info, midX, 0), [20, 120, 190]),
    "the top row continues the design's own top edge");
  assert.ok(near(px(data, info, midX, targetHeight - 1), [20, 120, 190]),
    "and the bottom row continues its bottom edge");
  // Both outer bands of the source still present across the fitted width.
  const midY = Math.floor(targetHeight / 2);
  assert.ok(near(px(data, info, 2, midY), [240, 60, 40]));
  assert.ok(near(px(data, info, targetWidth - 3, midY), [250, 230, 40]));
});

test("a canvas so wrong the design would occupy under half its panel is still refused", async () => {
  // The bound that REPLACES refuse-on-drift, and it is about artwork coverage
  // rather than canvas shape: at drift d the design spans 1/d of the long axis,
  // so 2.0 means at least half of every panel is the design itself. A near-square
  // return against a 6:1 strip is drift 6 — genuinely not the sheet that was
  // asked for, and correctly refused.
  const result = await hero.evaluateAuthored("front", await wideSheet(1000, 1000), 1800, 300);
  assert.equal(result.accepted, false);
  assert.match(result.reason, /^aspect_drift:6\.000/);
  assert.ok(hero.MAX_CONTAIN_DRIFT_RATIO === 2.0);
});

test("an exact-shape return is a no-op: no margin, no second resample", async () => {
  const result = await hero.evaluateAuthored("hood", await wideSheet(1086, 676), 1086, 676);
  assert.equal(result.accepted, true);
  assert.equal(result.containment.bleedXPx, 0);
  assert.equal(result.containment.bleedYPx, 0);
  assert.equal(result.containment.scale, 1);
});

test("the port reads as RestylePro's, and names the source it was recovered from", async () => {
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../runtime/atlas-hero-driver.cjs", import.meta.url), "utf8"));
  // RULE 1: the reference is named in the code, not only in a commit message.
  assert.match(source, /recreatepro-flat-panels\/index\.ts` `containExtend`/,
    "the exact RestylePro file and function must be named at the port");
  // And the three rejected alternatives are stated, so a later session does not
  // reintroduce one as an "optimisation".
  for (const forbidden of [/cover-crop/i, /TILES it/, /DISTORTS/]) {
    assert.match(source, forbidden);
  }
});
