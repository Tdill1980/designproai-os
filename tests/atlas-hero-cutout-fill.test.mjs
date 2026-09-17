import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const { _test } = require("../runtime/atlas-hero-driver.cjs");

const { evaluateAuthored } = _test;

/**
 * RULE 0.15 -- "DO NOT RE-ROLL FOR A CUT-OUT. FILL IT."
 *
 * The hero flatten refused every sheet whose aggregate near-black share
 * exceeded MAX_AUTHORED_HOLE_RATIO (0.2%) and never ran the deterministic fill
 * the six-surface path has run before its own verdict since 2026-08-24. Live
 * cost, generation 828f31f7 (2026-09-17): `unresolved_area:0.00292` -- a 0.3%
 * defect against a 0.2% ceiling -- discarded a completed hero view and a
 * flattened driver, and the six-surface fail-over then died on a 35.8%
 * passenger cut-out.
 *
 * Every case below is verified to fail against the pre-fix runtime except
 * where noted as the unchanged behaviour it must preserve.
 */

const W = 400;
const H = 200;

/** Vivid, non-black artwork: a gradient so the fill has real pixels to grow from. */
async function artwork() {
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 3;
      raw[o] = 40 + Math.floor((x / W) * 200);
      raw[o + 1] = 90 + Math.floor((y / H) * 140);
      raw[o + 2] = 200 - Math.floor((x / W) * 120);
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

/** One solid near-black disc -- a wheel arch. `radius` sets its share of the sheet. */
async function withDisc(radius) {
  const base = await artwork();
  const { data, info } = await sharp(base).raw().toBuffer({ resolveWithObject: true });
  const cx = Math.floor(W / 2);
  const cy = Math.floor(H / 2);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
      const o = (y * W + x) * info.channels;
      data[o] = 6; data[o + 1] = 6; data[o + 2] = 6;
    }
  }
  return sharp(data, { raw: { width: W, height: H, channels: info.channels } }).png().toBuffer();
}

/** Near-black ink SCATTERED as many tiny specks -- lettering interiors, shadow detail. */
async function withScatteredInk(targetRatio) {
  const base = await artwork();
  const { data, info } = await sharp(base).raw().toBuffer({ resolveWithObject: true });
  const want = Math.round(W * H * targetRatio);
  // 2x2 specks: each is 4px, far under MIN_CUTOUT_COMPONENT_RATIO (0.25% = 200px).
  let placed = 0;
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  while (placed < want) {
    const x = 1 + Math.floor(rand() * (W - 3));
    const y = 1 + Math.floor(rand() * (H - 3));
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        const o = ((y + dy) * W + (x + dx)) * info.channels;
        if (data[o] > 20) placed += 1;
        data[o] = 5; data[o + 1] = 5; data[o + 2] = 5;
      }
    }
  }
  return sharp(data, { raw: { width: W, height: H, channels: info.channels } }).png().toBuffer();
}

test("a clean sheet is accepted untouched and pays for no repair", async () => {
  const verdict = await evaluateAuthored("driver", await artwork(), W, H);
  assert.equal(verdict.accepted, true);
  assert.equal(verdict.repaired, null, "a clean sheet must not run the fill");
  assert.ok(verdict.holeRatio <= 0.002);
});

test("a convicted cut-out is FILLED and the sheet is accepted, not re-rolled", async () => {
  // r=14 -> ~615px of 80,000 = 0.77%, over the 0.2% ceiling and over the
  // fill's own 0.25% component floor. Pre-fix this returned
  // `unresolved_area:0.00769`.
  const verdict = await evaluateAuthored("driver", await withDisc(14), W, H);
  assert.equal(verdict.accepted, true, "a cut-out must be repaired, never refused");
  assert.ok(verdict.repaired, "the repair must be recorded on the receipt");
  assert.ok(verdict.repaired.pixels > 0, "the fill must have convicted the disc");
  assert.ok(verdict.repaired.holeRatioBefore > 0.002, "the receipt records what arrived");
  assert.ok(verdict.holeRatio <= 0.002, `repaired sheet still holed: ${verdict.holeRatio}`);
});

test("the repaired bytes -- not the arriving bytes -- are what is accepted", async () => {
  const arrived = await withDisc(14);
  const verdict = await evaluateAuthored("driver", arrived, W, H);
  assert.equal(verdict.accepted, true);
  const { data, info } = await sharp(verdict.bytes).raw().toBuffer({ resolveWithObject: true });
  const centre = ((H / 2) * W + W / 2) * info.channels;
  assert.ok(
    Math.max(data[centre], data[centre + 1], data[centre + 2]) > 24,
    "the centre of the filled disc must carry artwork, not near-black",
  );
});

test("scattered near-black ink is ARTWORK, not a hole -- RULE 0.15's own discriminator", async () => {
  // 0.4% of the sheet as 2x2 specks: over the aggregate ceiling, but not one
  // component reaches MIN_CUTOUT_COMPONENT_RATIO. Pre-fix this refused.
  const verdict = await evaluateAuthored("driver", await withScatteredInk(0.004), W, H);
  assert.equal(verdict.accepted, true, "specks of dark ink must not refuse a sheet");
  assert.ok(verdict.holeRatio > 0.002, "the fixture must actually exceed the aggregate ceiling");
  assert.equal(verdict.repaired?.convicted, 0, "nothing was convicted, and the receipt says so");
  assert.ok(verdict.repaired?.scatteredResidue > 0.002);
});

test("a void the fill cannot grow artwork into still REFUSES", async () => {
  // A sheet that is ENTIRELY near-black: the fill convicts it and has nothing
  // to continue from, so `unresolvedPixels` is the whole rectangle and the
  // aggregate does not move. RULE 0.15: "large-hole repair cannot recreate
  // artwork Gemini never generated."
  const black = await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 4, g: 4, b: 4 } },
  }).png().toBuffer();
  const verdict = await evaluateAuthored("driver", black, W, H);
  assert.equal(verdict.accepted, false, "an unfillable sheet must fail closed");
  assert.match(verdict.reason, /^unresolved_area:[0-9.]+:repaired:\d+$/);
});

test("a LARGE but fillable void is repaired here and judged by the master gates", async () => {
  // Deliberate, and not a relaxed threshold: a quarter-panel disc on
  // continuable artwork closes cleanly, and the assembled sheet then faces the
  // SAME whole-master gates every topology faces -- `edgeHoleRatio`, the
  // structural re-validation and the output-class inspector. Convicting it
  // twice, once per surface on an aggregate and again on the master, is what
  // made the hero flatten refuse work the rest of the system repairs.
  const radius = Math.floor(Math.sqrt((W * H * 0.25) / Math.PI));
  const verdict = await evaluateAuthored("driver", await withDisc(radius), W, H);
  assert.equal(verdict.accepted, true);
  assert.ok(verdict.repaired.pixels > W * H * 0.2, "the disc must have been convicted whole");
  assert.equal(verdict.repaired.unresolvedPixels, 0, "it had artwork to grow from");
});

test("the aspect and decode gates are unchanged -- the fill runs only after them", async () => {
  const wrongAspect = await sharp({
    create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 100, b: 50 } },
  }).png().toBuffer();
  const verdict = await evaluateAuthored("driver", wrongAspect, W, H);
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /^aspect_drift:/);
});
