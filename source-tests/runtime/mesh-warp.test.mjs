// Phase 4: the warp moves artwork, it does not invent it.
//
// Every property here is a property the 3D proof depends on. A warp that
// resamples slightly differently between hosts breaks reproducibility; a warp
// that flips a cell breaks the one thing a customer reads a proof for.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { warpSurface, meshExtentPx, _test } = require("../../runtime/mesh-warp.cjs");
const { inverseBilinear, cellBounds } = _test;

/** A source raster whose colour encodes its own coordinates. */
function gradient(width, height) {
  const bytes = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      bytes[index] = Math.round((x / (width - 1)) * 255);
      bytes[index + 1] = Math.round((y / (height - 1)) * 255);
      bytes[index + 2] = 64;
    }
  }
  return bytes;
}

function rect(box, { rows = 1, cols = 1 } = {}) {
  const points = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      const u = col / cols, v = row / rows;
      points.push({ u, v, x: box.x + u * box.w, y: box.y + v * box.h });
    }
  }
  return { rows, cols, points };
}

const pixel = (buffer, width, x, y) => {
  const index = (y * width + x) * 4;
  return [buffer[index], buffer[index + 1], buffer[index + 2], buffer[index + 3]];
};

test("inverse bilinear recovers the cell coordinates a forward map produced", () => {
  // A general quad: no axis alignment, no right angles, so the quadratic branch
  // is the one under test rather than the degenerate one.
  const quad = [10, 20, 190, 40, 30, 160, 210, 210];
  for (const s of [0, 0.25, 0.5, 0.75, 1]) {
    for (const t of [0, 0.3, 0.6, 1]) {
      const x = (1 - s) * (1 - t) * quad[0] + s * (1 - t) * quad[2] + (1 - s) * t * quad[4] + s * t * quad[6];
      const y = (1 - s) * (1 - t) * quad[1] + s * (1 - t) * quad[3] + (1 - s) * t * quad[5] + s * t * quad[7];
      const found = inverseBilinear(x, y, quad);
      assert.ok(found, `no solution for s=${s} t=${t}`);
      assert.ok(Math.abs(found.s - s) < 1e-9, `s ${found.s} != ${s}`);
      assert.ok(Math.abs(found.t - t) < 1e-9, `t ${found.t} != ${t}`);
    }
  }
  // An axis-aligned cell makes the quadratic term vanish exactly; the linear
  // branch must handle it rather than dividing by zero.
  const square = [0, 0, 100, 0, 0, 50, 100, 50];
  const axis = inverseBilinear(25, 30, square);
  assert.ok(Math.abs(axis.s - 0.25) < 1e-12);
  assert.ok(Math.abs(axis.t - 0.6) < 1e-12);
  // Outside is outside.
  assert.equal(inverseBilinear(-40, 25, square), null);
  assert.equal(inverseBilinear(160, 25, square), null);
});

test("an identity warp reproduces the source exactly, pixel for pixel", () => {
  const source = gradient(64, 32);
  // The mesh corners land on pixel *edges*, so a destination pixel centre
  // (x+0.5) maps to source coordinate x — an exact hit on a sample, with no
  // interpolation weight to round.
  const out = warpSurface({
    source, sourceWidth: 64, sourceHeight: 32,
    mesh: { rows: 1, cols: 1, points: [
      { u: 0, v: 0, x: 0.5, y: 0.5 }, { u: 1, v: 0, x: 63.5, y: 0.5 },
      { u: 0, v: 1, x: 0.5, y: 31.5 }, { u: 1, v: 1, x: 63.5, y: 31.5 },
    ] },
    frameWidth: 64, frameHeight: 32,
  });
  for (const [x, y] of [[0, 0], [63, 31], [17, 9], [40, 22]]) {
    const index = (y * 64 + x) * 3;
    assert.deepEqual(pixel(out, 64, x, y), [source[index], source[index + 1], source[index + 2], 255]);
  }
});

test("alpha is coverage, so no artwork is indistinguishable from black artwork", () => {
  const source = Buffer.alloc(8 * 8 * 3, 0); // pure black artwork
  const out = warpSurface({
    source, sourceWidth: 8, sourceHeight: 8,
    mesh: rect({ x: 20, y: 20, w: 30, h: 30 }),
    frameWidth: 100, frameHeight: 100,
  });
  assert.deepEqual(pixel(out, 100, 35, 35), [0, 0, 0, 255], "black artwork is painted");
  assert.deepEqual(pixel(out, 100, 5, 5), [0, 0, 0, 0], "unpainted frame stays uncovered");
});

test("the same inputs warp to the same bytes, and different meshes do not", () => {
  const source = gradient(120, 60);
  const args = { source, sourceWidth: 120, sourceHeight: 60, frameWidth: 300, frameHeight: 200 };
  const first = warpSurface({ ...args, mesh: rect({ x: 20, y: 20, w: 260, h: 160 }, { rows: 3, cols: 5 }) });
  const second = warpSurface({ ...args, mesh: rect({ x: 20, y: 20, w: 260, h: 160 }, { rows: 3, cols: 5 }) });
  assert.equal(first.equals(second), true);

  const moved = warpSurface({ ...args, mesh: rect({ x: 21, y: 20, w: 260, h: 160 }, { rows: 3, cols: 5 }) });
  assert.equal(first.equals(moved), false);

  // A subdivided mesh over the same rectangle describes the same map, so the
  // artwork must land in the same place regardless of how finely it is cut.
  const coarse = warpSurface({ ...args, mesh: rect({ x: 20, y: 20, w: 260, h: 160 }, { rows: 1, cols: 1 }) });
  const fine = warpSurface({ ...args, mesh: rect({ x: 20, y: 20, w: 260, h: 160 }, { rows: 4, cols: 4 }) });
  let differing = 0;
  for (let index = 0; index < coarse.length; index += 4) {
    if (Math.abs(coarse[index] - fine[index]) > 1) differing += 1;
  }
  assert.equal(differing, 0, `${differing} pixels moved when the mesh was subdivided`);
});

test("a warp cannot mirror artwork that the mesh does not mirror", () => {
  // The source is a hard left/right split. After a forward warp the left half
  // must still be on the left: a mirrored panel on a proof is the failure this
  // whole architecture exists to make impossible.
  const width = 32, height = 8;
  const source = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      source[index] = x < width / 2 ? 255 : 0;
      source[index + 2] = x < width / 2 ? 0 : 255;
    }
  }
  const out = warpSurface({
    source, sourceWidth: width, sourceHeight: height,
    mesh: rect({ x: 0, y: 0, w: 200, h: 50 }, { rows: 2, cols: 4 }),
    frameWidth: 200, frameHeight: 50,
  });
  assert.equal(pixel(out, 200, 20, 25)[0], 255, "the red half stayed left");
  assert.equal(pixel(out, 200, 180, 25)[2], 255, "the blue half stayed right");
});

test("mesh extent reports the source resolution a panel actually needs", () => {
  // 260 destination pixels across one unit of u, 160 down one unit of v.
  const extent = meshExtentPx(rect({ x: 20, y: 20, w: 260, h: 160 }, { rows: 4, cols: 4 }));
  assert.equal(extent.widthPx, 260);
  assert.equal(extent.heightPx, 160);
  // Subdividing changes neither: each cell covers a proportionally smaller
  // slice of u, so the implied full-surface resolution is unchanged.
  const finer = meshExtentPx(rect({ x: 20, y: 20, w: 260, h: 160 }, { rows: 16, cols: 16 }));
  assert.equal(finer.widthPx, 260);
  assert.equal(finer.heightPx, 160);
});

test("cell bounds stay inside the frame", () => {
  const bounds = cellBounds([-50, -50, 400, -20, -30, 400, 420, 430], 200, 150);
  assert.deepEqual(bounds, { left: 0, top: 0, right: 199, bottom: 149 });
});

test("a source that does not match its declared size is refused", () => {
  assert.throws(() => warpSurface({
    source: Buffer.alloc(10), sourceWidth: 64, sourceHeight: 32,
    mesh: rect({ x: 0, y: 0, w: 10, h: 10 }), frameWidth: 20, frameHeight: 20,
  }), (error) => error.code === "warp_source_invalid");
  assert.throws(() => warpSurface({
    source: gradient(8, 8), sourceWidth: 8, sourceHeight: 8,
    mesh: { rows: 2, cols: 2, points: [] }, frameWidth: 20, frameHeight: 20,
  }), (error) => error.code === "warp_mesh_incomplete");
});
