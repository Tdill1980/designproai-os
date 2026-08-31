/**
 * THE CUT-OUT FILL IS DETERMINISTIC AND MUST STAY CHEAP.
 *
 * `diffuseInto` closes a convicted hole by growing its own border inward. It is
 * documented as costing ~100ms. On generation `7a1062f4-982e-4948-8318-9801b311d7e3`
 * it cost 174,678ms -- 75% of the whole of Call 1, against a 42s Gemini call --
 * because every pass copied the entire zone buffer and rescanned every pixel of
 * the zone, whether or not it was part of a hole.
 *
 * The repair iterates the frontier and drops the per-pass copy. Neither changes
 * a single output pixel, and this file is what proves that: the ORIGINAL
 * implementation is kept here verbatim as the reference, and the shipped one
 * must agree with it byte for byte on every fixture.
 *
 * Do not "simplify" this by deleting the reference. A performance change to a
 * deterministic image operation is only safe while something still checks the
 * pixels, and the fill feeds both the six production panels and the seven
 * proofs (RULE 0.15, corrected 2026-08-26).
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { _test, MAX_FILL_PASSES } = require("../runtime/atlas-cutout-fill.cjs");
const { diffuseInto } = _test;

/** The pre-2026-08-31 implementation, verbatim, as the correctness oracle. */
function referenceDiffuseInto(data, width, height, channels, mask) {
  const pending = Uint8Array.from(mask);
  let remaining = 0;
  for (let index = 0; index < pending.length; index += 1) if (pending[index]) remaining += 1;

  for (let pass = 0; pass < MAX_FILL_PASSES && remaining > 0; pass += 1) {
    const source = Uint8Array.from(data);
    const settledThisPass = [];
    for (let index = 0; index < pending.length; index += 1) {
      if (!pending[index]) continue;
      const x = index % width;
      const y = (index - x) / width;
      let count = 0;
      const totals = new Array(channels).fill(0);
      const sample = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const neighbour = ny * width + nx;
        if (pending[neighbour]) return;
        const offset = neighbour * channels;
        for (let c = 0; c < channels; c += 1) totals[c] += source[offset + c];
        count += 1;
      };
      sample(x - 1, y); sample(x + 1, y); sample(x, y - 1); sample(x, y + 1);
      sample(x - 1, y - 1); sample(x + 1, y - 1); sample(x - 1, y + 1); sample(x + 1, y + 1);
      if (!count) continue;
      const offset = index * channels;
      for (let c = 0; c < channels; c += 1) data[offset + c] = Math.round(totals[c] / count);
      if (channels > 3) data[offset + channels - 1] = 255;
      settledThisPass.push(index);
    }
    if (!settledThisPass.length) break;
    for (const index of settledThisPass) { pending[index] = 0; remaining -= 1; }
  }
  return remaining;
}

const CHANNELS = 4;

/** Deterministic pseudo-artwork, so a fixture is reproducible across machines. */
function artwork(width, height, seed = 1) {
  const data = new Uint8Array(width * height * CHANNELS);
  let state = seed >>> 0;
  for (let i = 0; i < width * height; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const offset = i * CHANNELS;
    data[offset] = state & 0xff;
    data[offset + 1] = (state >>> 8) & 0xff;
    data[offset + 2] = (state >>> 16) & 0xff;
    data[offset + 3] = 255;
  }
  return data;
}

function rectMask(width, height, left, top, w, h) {
  const mask = new Uint8Array(width * height);
  for (let y = top; y < top + h; y += 1) {
    for (let x = left; x < left + w; x += 1) mask[y * width + x] = 1;
  }
  return mask;
}

function ellipseMask(width, height, cx, cy, rx, ry) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) mask[y * width + x] = 1;
    }
  }
  return mask;
}

const FIXTURES = [
  { name: "single pixel", width: 16, height: 16, mask: (w, h) => rectMask(w, h, 8, 8, 1, 1) },
  { name: "small square", width: 32, height: 32, mask: (w, h) => rectMask(w, h, 10, 10, 6, 6) },
  { name: "wheel-arch ellipse", width: 96, height: 96, mask: (w, h) => ellipseMask(w, h, 48, 48, 22, 14) },
  { name: "wide glass band", width: 128, height: 64, mask: (w, h) => rectMask(w, h, 20, 18, 70, 22) },
  {
    name: "hole touching the zone edge",
    width: 64, height: 64,
    mask: (w, h) => rectMask(w, h, 0, 20, 14, 14),
  },
  {
    // Nothing borders artwork, so neither implementation can close it. Both must
    // bail on the same pass and report the same unresolved count.
    name: "fully masked zone (unclosable)",
    width: 24, height: 24,
    mask: (w, h) => rectMask(w, h, 0, 0, w, h),
  },
];

test("the frontier fill reproduces the reference implementation exactly", () => {
  for (const fixture of FIXTURES) {
    const { name, width, height } = fixture;
    const mask = fixture.mask(width, height);

    const shipped = artwork(width, height, 7);
    const reference = artwork(width, height, 7);
    assert.deepEqual(
      Buffer.from(shipped), Buffer.from(reference),
      `${name}: fixtures must start identical`,
    );

    const shippedUnresolved = diffuseInto(shipped, width, height, CHANNELS, mask);
    const referenceUnresolved = referenceDiffuseInto(reference, width, height, CHANNELS, mask);

    assert.equal(
      shippedUnresolved, referenceUnresolved,
      `${name}: unresolved pixel count must match the reference`,
    );
    assert.deepEqual(
      Buffer.from(shipped), Buffer.from(reference),
      `${name}: every filled pixel must match the reference byte for byte`,
    );
  }
});

test("a zone with no convicted hole is left untouched", () => {
  const width = 48;
  const height = 48;
  const data = artwork(width, height, 3);
  const before = Buffer.from(data);
  const unresolved = diffuseInto(data, width, height, CHANNELS, new Uint8Array(width * height));
  assert.equal(unresolved, 0);
  assert.deepEqual(Buffer.from(data), before, "a clean zone must come back byte-identical");
});

test("a production-scale flank hole closes in well under a second", () => {
  // The driver flank of a 4096px master, with a wheel-arch-scale opening. The
  // old implementation is quadratic here -- this is the shape that cost 175s in
  // production. The budget is deliberately far above a good result and far
  // below the defect, so it catches a regression without being flaky on slow CI.
  const width = 1024;
  const height = 2400;
  const data = artwork(width, height, 11);
  const mask = ellipseMask(width, height, 512, 1200, 160, 160);

  const started = process.hrtime.bigint();
  const unresolved = diffuseInto(data, width, height, CHANNELS, mask);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.equal(unresolved, 0, "the hole must close completely");
  assert.ok(
    elapsedMs < 1000,
    `a production-scale hole must close in under 1000ms, took ${elapsedMs.toFixed(0)}ms`,
  );
});
