/**
 * THE READER'S BOX IS A HINT; THE PIXELS DECIDE THE CUT (live 7c7bd633,
 * 2026-09-16). The passenger re-drop lifts each lockup off the driver panel
 * as one slab cut to the lockup's own extent, found by a border flood key
 * whose tolerance calibrates itself per rect: the lowest tolerance at which
 * the background keys out to the rect's edge. On the live panel 28 ate the
 * flame mark and the orange letter fills, 14 kept the ribbons out to the
 * edge, and 20 gave exactly flame-to-final-letter.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const { _test, BAND_PAD_X_FRACTION, BAND_PAD_FRACTION } = require("../runtime/atlas-passenger-mirror.cjs");
const { unionTouchingRects, tightenToLettering, bandRect } = _test;

test("bands whose padded rects touch collapse into one lockup; separate bands stay separate", () => {
  const a = { left: 10, top: 10, width: 100, height: 20 };
  const b = { left: 20, top: 28, width: 60, height: 20 }; // touches a's bottom edge region
  const c = { left: 300, top: 10, width: 50, height: 20 };
  const out = unionTouchingRects([a, b, c]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { left: 10, top: 10, width: 100, height: 38 });
  assert.deepEqual(out[1], c);
});

test("the side pad is wider than the vertical pad so a mark beside the lettering is inside the cut", () => {
  assert.ok(BAND_PAD_X_FRACTION > BAND_PAD_FRACTION);
  const r = bandRect({ xPct: 0.5, yPct: 0.5, wPct: 0.2, hPct: 0.1 }, 1000, 500);
  assert.equal(r.left, 500 - Math.round(BAND_PAD_X_FRACTION * 1000));
  assert.equal(r.top, 250 - Math.round(BAND_PAD_FRACTION * 500));
});

/**
 * A smooth gradient ribbon crosses the whole rect (the flood must walk it),
 * a crisp orange mark of the SAME hue as the ribbon sits beside crisp white
 * lettering, and the mark touches the ribbon. The calibrated key must keep
 * the mark and the word and drop the ribbon, so the tight rect is the
 * lockup's extent (mark to last letter) plus the margin -- not the whole rect
 * (ribbon kept) and not the word alone (mark eaten).
 */
test("the key calibrates to the lowest tolerance that drops the ribbon, and keeps a same-hue mark", async () => {
  const W = 800; const H = 300;
  // Raw pixels, no rasterizer anti-aliasing: a ribbon whose colour changes
  // by 12 per pixel (a tolerance of 10 cannot walk it; 14 can), a background
  // gradient, a same-hue mark touching the ribbon, and a white word.
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 3;
      let r = 27 - Math.round((x / W) * 21); let g = 111 - Math.round((x / W) * 66); let b = 168 - Math.round((x / W) * 83);
      // Triangle wave in red, +/-12 per pixel: walkable at 14, never at 10.
      if (y >= 120 && y < 180) { const p = x % 30; r = 60 + (p < 15 ? p : 30 - p) * 12; g = 120; b = 20; }
      if (x >= 200 && x < 260 && y >= 100 && y < 200) { r = 255; g = 138; b = 30; }
      if (x >= 280 && x < 600 && y >= 110 && y < 190) { r = 255; g = 255; b = 255; }
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const panel = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  const generous = { left: 100, top: 40, width: 640, height: 220 };
  const tight = await tightenToLettering(panel, generous, W);
  assert.equal(tight.tightened, true, "a calibrated tolerance was found");
  assert.ok(tight.tolerance >= 14, `the ribbon needed a walkable tolerance (got ${tight.tolerance})`);
  // Mark 200..259, word 280..599 -> lockup 200..599 (+ margin), rows 100..199.
  const margin = tight.rect.left < 200 ? 200 - tight.rect.left : 0;
  assert.ok(margin > 0 && margin <= 60, `mark's left edge kept with a margin (${margin})`);
  assert.ok(Math.abs((tight.rect.left + tight.rect.width - 1) - (599 + margin)) <= 1, "right edge is the last letter plus the same margin");
  assert.ok(Math.abs(tight.rect.top - (100 - margin)) <= 1 && Math.abs((tight.rect.top + tight.rect.height - 1) - (199 + margin)) <= 1, "rows are the lockup's, not the ribbon's");
});

test("a rect the key cannot calibrate falls back to the generous rect", async () => {
  // Pure high-frequency noise: nothing is walkable at any tolerance.
  const W = 200; const H = 100;
  const raw = Buffer.alloc(W * H * 3);
  let seed = 7;
  for (let i = 0; i < raw.length; i += 1) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; raw[i] = seed % 256; }
  const panel = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  const generous = { left: 20, top: 10, width: 160, height: 80 };
  const tight = await tightenToLettering(panel, generous, W);
  assert.equal(tight.tightened, false);
  assert.deepEqual(tight.rect, generous);
});
