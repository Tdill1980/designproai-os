// THE COLOUR-BLIND INSTRUMENT, LOCKED.
//
// Test 2's arms left the SAME structural defect — a large uniform non-artwork
// field with the panels as contoured shapes inside it — and the production
// `holeAt` predicate convicted one and cleared the other, because one field was
// near-black and the other was rgb(92,92,92). An acceptance number measured that
// way is a number about the background's colour.
//
// So the one property that matters here is: recolour the field, change nothing
// else, and every number must be identical. That is what these assert, on
// synthetic fixtures where the truth is constructed rather than judged.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  FIELD_TOLERANCE,
  MAX_NON_ARTWORK_RATIO,
  MIN_BORDER_ARTWORK_RATIO,
  fullBleedMetrics,
  zoneRect,
} from "../scripts/atlas-fullbleed-metrics.mjs";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const atlas = require("../runtime/flat-first-atlas.cjs");

const SIZE = 256;
// The REAL manifest zone shape — `{ surfaceKey, x, y, w, h }`. Writing the
// fixture to match the module's assumption instead of the manifest is exactly
// how the first live run died on NaN after spending an image call.
const manifestOf = (n = SIZE) => ({ zones: [{ surfaceKey: "zone", x: 0, y: 0, w: n, h: n }] });

// Deterministic pseudo-texture: real artwork varies pixel to pixel, so the flood
// cannot cross it. A flat colour block would be indistinguishable from a field
// and is not what a wrap panel looks like.
function artworkAt(x, y) {
  const v = (Math.imul(x + 1, 2654435761) ^ Math.imul(y + 1, 1597334677)) >>> 0;
  return [60 + (v % 160), 40 + ((v >>> 8) % 180), 30 + ((v >>> 16) % 200)];
}

async function render(paint) {
  const data = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b] = paint(x, y);
      const i = (y * SIZE + x) * 3;
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
  }
  return sharp(data, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toBuffer();
}

// A wrap panel: artwork corner to corner.
const fullBleed = () => render(artworkAt);

// A die-cut silhouette on a uniform field of whatever colour is asked for: an
// inset body shape, two wheel arches bitten out of its lower edge (reachable
// from the field, like a real arch), and one fully ENCLOSED window opening that
// the edge flood can never reach. Both paths of the metric are exercised.
const silhouetteOn = (field) => render((x, y) => {
  const inset = x > 24 && x < SIZE - 24 && y > 48 && y < SIZE - 48;
  const arch = (cx) => (x - cx) ** 2 + (y - (SIZE - 48)) ** 2 < 28 ** 2;
  const window = x > 96 && x < 160 && y > 80 && y < 128;
  if (!inset || arch(80) || arch(176) || window) return field;
  return artworkAt(x, y);
});

test("a full-bleed artwork rectangle is compliant", async () => {
  const m = await fullBleedMetrics(await fullBleed(), manifestOf(), { sharp });
  const z = m.zones.zone;
  assert.equal(z.fullBleedCompliant, true, JSON.stringify(z));
  assert.ok(z.borderArtworkRatio >= MIN_BORDER_ARTWORK_RATIO);
  assert.ok(z.nonArtworkRatio <= MAX_NON_ARTWORK_RATIO);
  assert.ok(z.contourScore < 0.02, `contourScore ${z.contourScore} on a rectangle`);
  assert.equal(m.fullBleedCompliantCount, 1);
});

test("a contoured silhouette is convicted IDENTICALLY on black, grey and white", async () => {
  const black = await fullBleedMetrics(await silhouetteOn([4, 4, 4]), manifestOf(), { sharp });
  const grey = await fullBleedMetrics(await silhouetteOn([92, 92, 92]), manifestOf(), { sharp });
  const white = await fullBleedMetrics(await silhouetteOn([250, 250, 250]), manifestOf(), { sharp });

  for (const [name, m] of [["black", black], ["grey", grey], ["white", white]]) {
    const z = m.zones.zone;
    assert.equal(z.fullBleedCompliant, false, `${name} field passed as full bleed`);
    assert.ok(z.nonArtworkRatio > 0.2, `${name}: nonArtworkRatio ${z.nonArtworkRatio}`);
    assert.ok(z.borderArtworkRatio < 0.05, `${name}: borderArtworkRatio ${z.borderArtworkRatio}`);
    assert.ok(z.contourScore > 0.02, `${name}: contourScore ${z.contourScore}`);
    assert.ok(z.interiorFieldRatio > 0, `${name}: the enclosed arch bites were not seen`);
  }

  // THE POINT. Same geometry, three field colours, and the verdict plus every
  // ratio must agree.
  //
  // Agreement is to 0.5% of the zone rather than to the bit, and that is not a
  // fudge: a field absorbs any artwork pixel whose own colour happens to sit
  // within tolerance of it, so a mid-grey field legitimately swallows a handful
  // of mid-grey artwork pixels that a near-black field does not. Measured here
  // that is ~1 pixel in 65,536. Demanding exact identity would be asserting
  // floating-point luck, not colour-blindness; a metric that actually keyed on
  // colour would move by tens of percent, as `holeAt` did between Test 2's arms
  // (0-2% against 33-53% on the same defect).
  const close = (a, b, what) => assert.ok(
    Math.abs(a - b) <= 0.005,
    `${what}: ${a} vs ${b} — the metric is not colour-blind`,
  );
  for (const [name, m] of [["grey", grey], ["white", white]]) {
    const z = m.zones.zone;
    const k = black.zones.zone;
    assert.equal(z.fullBleedCompliant, k.fullBleedCompliant, `${name}: verdict differs`);
    assert.equal(z.nonArtworkComponentCount, k.nonArtworkComponentCount, `${name}: component count differs`);
    close(z.nonArtworkRatio, k.nonArtworkRatio, `${name} nonArtworkRatio`);
    close(z.artworkRatio, k.artworkRatio, `${name} artworkRatio`);
    close(z.largestNonArtworkComponentRatio, k.largestNonArtworkComponentRatio, `${name} largestNonArtworkComponentRatio`);
    close(z.edgeReachableFieldRatio, k.edgeReachableFieldRatio, `${name} edgeReachableFieldRatio`);
    close(z.interiorFieldRatio, k.interiorFieldRatio, `${name} interiorFieldRatio`);
    close(z.borderArtworkRatio, k.borderArtworkRatio, `${name} borderArtworkRatio`);
    close(z.contourScore, k.contourScore, `${name} contourScore`);
  }
});

test("the flood cannot cross artwork, and tolerance stays tight", async () => {
  // A field that differs from its neighbour by more than the tolerance is a
  // different field, not one merged region — otherwise a gradient would swallow
  // the whole zone and every sheet would read as non-compliant.
  assert.ok(FIELD_TOLERANCE <= 16, "FIELD_TOLERANCE is loose enough to flood through artwork");
  const m = await fullBleedMetrics(await fullBleed(), manifestOf(), { sharp });
  assert.equal(m.zones.zone.nonArtworkComponentCount, 0, "the flood crossed into artwork");
});

test("the rect reader speaks the REAL manifest's field names, and fails closed", () => {
  // Built by the real buildAtlasManifest, not by hand — the defect this convicts
  // is a fixture that agreed with the code instead of with production.
  const surface = (surfaceKey, trimWidthIn, trimHeightIn) => ({
    surfaceKey,
    trimWidthIn,
    trimHeightIn,
    printWidthIn: trimWidthIn + 10,
    printHeightIn: trimHeightIn + 10,
    surfaceSqFt: (trimWidthIn * trimHeightIn) / 144,
  });
  const manifest = atlas.buildAtlasManifest([
    surface("driver", 140, 31), surface("passenger", 140, 31), surface("hood", 64, 40),
    surface("roof", 60, 58), surface("front", 64, 30), surface("rear", 64, 23),
  ], null); // null = the module's own operator-validated layout-only default

  assert.equal(manifest.zones.length, 6);
  for (const zone of manifest.zones) {
    assert.ok(Number.isFinite(zone.w) && Number.isFinite(zone.h),
      `manifest zone ${zone.surfaceKey} does not expose w/h — the reader's assumption is wrong`);
    const rect = zoneRect(zone);
    assert.equal(rect.width, zone.w);
    assert.equal(rect.height, zone.h);
    assert.ok(rect.width >= 1 && rect.height >= 1);
  }

  // No silent NaN, ever.
  assert.throws(() => zoneRect({ surfaceKey: "driver", x: 0, y: 0 }), /atlas_fullbleed_zone_rect_unreadable:driver/);
  assert.throws(() => zoneRect(undefined), /atlas_fullbleed_zone_rect_unreadable/);
});
