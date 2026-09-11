import { test } from "node:test";
import assert from "node:assert/strict";
import {
  maskFromRgba, edt, dilate, erode, closeMask, components, groupComponents, cropMask,
  traceBoundaries, polygonArea, cleanLoop, simplifyClosed, bleedRing, minFeatureWidth,
  quantizeColors, maskForPaletteIndex, shelfPack, loopsToPathD, smallLetterRuns,
} from "../supabase/functions/_shared/cut-contour/geometry.mjs";

/**
 * The cut-contour geometry core, exercised on synthetic rasters whose exact
 * answers are known. This is the Illustrator-by-hand half of the WPW guide
 * (Pathfinder → Unite, Offset Path, nesting) as deterministic code; if any of
 * these move, a plotter file changes shape.
 */

function canvas(width, height) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255); // white, opaque
  return { width, height, data };
}
function disc(c, cx, cy, r, rgb = [200, 30, 30]) {
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) {
      const p = (y * c.width + x) * 4;
      c.data[p] = rgb[0]; c.data[p + 1] = rgb[1]; c.data[p + 2] = rgb[2]; c.data[p + 3] = 255;
    }
  }
}
function rect(c, x0, y0, w, h, rgb = [20, 40, 160]) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const p = (y * c.width + x) * 4;
    c.data[p] = rgb[0]; c.data[p + 1] = rgb[1]; c.data[p + 2] = rgb[2]; c.data[p + 3] = 255;
  }
}

test("a white background is not art; opaque colour is", () => {
  const c = canvas(10, 10);
  rect(c, 2, 2, 3, 3);
  const mask = maskFromRgba(c.data, c.width, c.height);
  assert.equal(mask.reduce((a, b) => a + b, 0), 9);
  assert.equal(mask[2 * 10 + 2], 1);
  assert.equal(mask[0], 0);
});

test("the distance transform is exact and names the nearest art pixel", () => {
  const mask = new Uint8Array(7 * 7);
  mask[3 * 7 + 3] = 1;
  const { dist, nearest } = edt(mask, 7, 7);
  assert.equal(dist[3 * 7 + 3], 0);
  assert.equal(dist[3 * 7 + 6], 3);
  assert.ok(Math.abs(dist[0] - Math.hypot(3, 3)) < 1e-6);
  assert.equal(nearest[0], 3 * 7 + 3);
});

test("dilate grows a square by the radius, erode shrinks it back, close seals a hairline gap", () => {
  const mask = new Uint8Array(30 * 30);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) mask[y * 30 + x] = 1;
  const grown = dilate(mask, 30, 30, 2);
  assert.equal(grown[10 * 30 + 8], 1);
  assert.equal(grown[10 * 30 + 7], 0);
  const back = erode(grown, 30, 30, 2);
  assert.deepEqual([...back], [...mask]);
  // Two blocks one pixel apart become one after a close of radius 1.
  const split = new Uint8Array(30 * 30);
  for (let y = 5; y < 25; y++) { for (let x = 5; x < 14; x++) split[y * 30 + x] = 1; for (let x = 15; x < 25; x++) split[y * 30 + x] = 1; }
  assert.equal(components(split, 30, 30).components.length, 2);
  assert.equal(components(closeMask(split, 30, 30, 1), 30, 30).components.length, 1);
});

test("components drop specks, and neighbouring letters group into one element", () => {
  const c = canvas(200, 60);
  rect(c, 10, 10, 20, 40); rect(c, 34, 10, 20, 40); rect(c, 58, 10, 20, 40); // a "word"
  rect(c, 150, 20, 30, 30);                                                  // a logo far away
  rect(c, 100, 5, 1, 1);                                                     // a speck
  const mask = maskFromRgba(c.data, c.width, c.height);
  const { components: comps } = components(mask, c.width, c.height, 4);
  assert.equal(comps.length, 4, "speck removed, four real components");
  const groups = groupComponents(comps, 6);
  assert.equal(groups.length, 2);
  // Letter spacing scales with type size: 4 px apart at 40 px tall is one word
  // even with a tiny absolute gap, while the far logo stays its own element.
  assert.equal(groupComponents(comps, 1, 0.6).length, 2);
  assert.equal(groupComponents(comps, 1, 0).length, 4);
  assert.equal(groups[0].components.length, 3, "the three letters are one element");
  assert.deepEqual([groups[0].minX, groups[0].maxX], [10, 77]);
});

test("Pathfinder → Unite on pixels: one silhouette per shape, holes traced too, area preserved", () => {
  const c = canvas(300, 300);
  disc(c, 150, 150, 100);
  const mask = maskFromRgba(c.data, c.width, c.height);
  const loops = traceBoundaries(mask, c.width, c.height);
  assert.equal(loops.length, 1);
  const cleaned = cleanLoop(loops[0]);
  assert.ok(cleaned.length >= 12 && cleaned.length <= 200, `vertex count ${cleaned.length}`);
  const area = Math.abs(polygonArea(cleaned));
  assert.ok(Math.abs(area - Math.PI * 100 * 100) / (Math.PI * 100 * 100) < 0.03, `area ${area}`);
  assert.ok(polygonArea(loops[0]) > 0, "outer boundary runs clockwise on screen");

  // A ring: outer boundary + the counter, opposite orientation.
  const ring = new Uint8Array(mask.length);
  const inner = canvas(300, 300); disc(inner, 150, 150, 40);
  const innerMask = maskFromRgba(inner.data, 300, 300);
  for (let i = 0; i < ring.length; i++) ring[i] = mask[i] && !innerMask[i] ? 1 : 0;
  const ringLoops = traceBoundaries(ring, 300, 300);
  assert.equal(ringLoops.length, 2);
  const areas = ringLoops.map(polygonArea).sort((a, b) => a - b);
  assert.ok(areas[0] < 0 && areas[1] > 0, "hole is counter-clockwise, silhouette clockwise");
});

test("the collinear-run collapse keeps a rectangle at exactly four corners", () => {
  const mask = new Uint8Array(20 * 20);
  for (let y = 4; y < 14; y++) for (let x = 3; x < 17; x++) mask[y * 20 + x] = 1;
  const loops = traceBoundaries(mask, 20, 20);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].length, 4);
  assert.equal(simplifyClosed(loops[0], 0.5).length, 4);
  assert.match(loopsToPathD(loops, { scale: 2 }), /^M6 8 L34 8 L34 28 L6 28 Z$/);
});

test("the bleed ring carries the artwork's own edge colour outward and nothing else", () => {
  const c = canvas(60, 60);
  rect(c, 20, 20, 20, 20, [10, 200, 30]);
  const mask = maskFromRgba(c.data, 60, 60);
  const ring = bleedRing(c.data, mask, 60, 60, 3);
  const px = (x, y) => Array.from(ring.subarray((y * 60 + x) * 4, (y * 60 + x) * 4 + 4));
  assert.deepEqual(px(18, 30), [10, 200, 30, 255], "inside the ring: art colour");
  assert.deepEqual(px(30, 30), [0, 0, 0, 0], "art itself is not part of the ring");
  assert.deepEqual(px(15, 30), [0, 0, 0, 0], "beyond the radius: transparent");
});

test("thin-detail check reports the widest point of the thinnest element", () => {
  const c = canvas(80, 40);
  rect(c, 5, 5, 30, 30);   // fat block
  rect(c, 50, 5, 2, 30);   // hairline
  const mask = maskFromRgba(c.data, 80, 40);
  const { labels, components: comps } = components(mask, 80, 40);
  const width = minFeatureWidth(mask, 80, 40, labels, comps.map((k) => k.id));
  assert.ok(width <= 3 && width >= 1, `hairline width ${width}`);
});

test("colour separation finds each film and ignores the background", () => {
  const c = canvas(90, 30);
  rect(c, 0, 0, 30, 30, [255, 0, 0]);
  rect(c, 30, 0, 30, 30, [0, 0, 255]);
  rect(c, 60, 0, 30, 30, [250, 5, 5]); // anti-aliased shade of the red film
  const mask = maskFromRgba(c.data, 90, 30);
  const { palette, index } = quantizeColors(c.data, mask, 90, 30, { maxColors: 4 });
  assert.equal(palette.length, 2, "near-identical reds merge into one film");
  const reds = maskForPaletteIndex(index, palette.findIndex((p) => p.r > 200));
  assert.equal(reds.reduce((a, b) => a + b, 0), 60 * 30);
});

test("nesting keeps every graphic inside the 51.5\" cut-contour height and never overlaps", () => {
  const items = [
    { id: "logo", w: 30, h: 30 }, { id: "logo2", w: 30, h: 30 }, { id: "text", w: 60, h: 8 },
    { id: "text2", w: 60, h: 8 }, { id: "tall", w: 10, h: 70 },
  ];
  const { placements, sheetW, sheetH } = shelfPack(items, 51.5, 0.75);
  assert.equal(placements.length, 5);
  for (const p of placements) {
    assert.ok(p.y + p.h <= 51.5 + 1e-9, `${p.id} exceeds the sheet height`);
    assert.ok(!p.oversize);
  }
  assert.ok(placements.find((p) => p.id === "tall").rotated, "a 70\" tall strip lies down");
  for (let i = 0; i < placements.length; i++) for (let j = i + 1; j < placements.length; j++) {
    const a = placements[i], b = placements[j];
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.ok(!overlap, `${a.id} overlaps ${b.id}`);
  }
  assert.ok(sheetH <= 51.5 && sheetW > 0);
  const huge = shelfPack([{ id: "van-side", w: 180, h: 60 }], 51.5, 0.75);
  assert.ok(huge.placements[0].oversize, "a side larger than the plotter in both dimensions is flagged for tiling");
});

test("cropMask keeps only the requested component ids inside the window", () => {
  const c = canvas(40, 20);
  rect(c, 2, 2, 5, 5); rect(c, 20, 2, 5, 5);
  const mask = maskFromRgba(c.data, 40, 20);
  const { labels, components: comps } = components(mask, 40, 20);
  const crop = cropMask(mask, 40, 0, 0, 40, 20, labels, [comps[0].id]);
  assert.equal(crop.reduce((a, b) => a + b, 0), 25);
});

test("lettering under the minimum height is a run of similar shapes on a line; a logo is not", () => {
  const c = canvas(300, 120);
  for (let i = 0; i < 5; i++) rect(c, 10 + i * 24, 40, 18, 30);   // five 30 px "letters" on a line
  rect(c, 200, 10, 80, 100);                                       // one big logo
  const mask = maskFromRgba(c.data, 300, 120);
  const { components: comps } = components(mask, 300, 120);
  const runs = smallLetterRuns(comps, 40);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].count, 5);
  assert.equal(runs[0].heightPx, 30);
  assert.equal(smallLetterRuns(comps, 20).length, 0, "30 px letters are fine when the minimum is 20 px");
});
