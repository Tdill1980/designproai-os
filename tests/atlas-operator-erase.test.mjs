// PANELPRO STUDIO OPERATOR ERASE.
//
// Carley pops a text block off a panel on the vector template, the runtime
// fills it from that panel's own artwork, and the type comes back as a layer.
// These lock the two halves that matter: the guards that keep it a CORRECTION
// rather than a redesign, and the wiring that keeps it on the existing
// correction lineage instead of inventing an artifact kind on the frozen seam.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../runtime/", import.meta.url));
const sharp = require("sharp");
const { erasePanelRegions, MAX_ERASE_FRACTION, ERASE_CONTRACT } = require("../runtime/atlas-cutout-fill.cjs");

const RUNTIME_INDEX = readFileSync(new URL("../runtime/index.js", import.meta.url), "utf8");

// A panel with a flowing background and one bright "mark" on it, which is the
// shape of the real problem: artwork everywhere, a compact bright element to
// lift, and nothing behind the element that was ever drawn.
async function panelWithMark({ width = 640, height = 240 } = {}) {
  const channels = 4;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      // a diagonal gradient with a stripe, so a clone has structure to match
      data[offset] = 40 + ((x * 90) / width) | 0;
      data[offset + 1] = 60 + ((y * 70) / height) | 0;
      data[offset + 2] = 120 + (((x + y) * 60) / (width + height)) | 0;
      data[offset + 3] = 255;
      if ((x + y) % 37 < 3) { data[offset] = 200; data[offset + 1] = 120; data[offset + 2] = 60; }
    }
  }
  // the mark: a bright block in the middle third
  for (let y = 90; y < 150; y += 1) {
    for (let x = 200; x < 440; x += 1) {
      const offset = (y * width + x) * channels;
      data[offset] = 250; data[offset + 1] = 248; data[offset + 2] = 240;
    }
  }
  const bytes = await sharp(data, { raw: { width, height, channels } }).png().toBuffer();
  return { bytes, width, height };
}

test("a region outside the panel is refused rather than clamped", async () => {
  const { bytes } = await panelWithMark();
  for (const region of [
    { x: -0.1, y: 0.1, w: 0.2, h: 0.2 },
    { x: 0.9, y: 0.1, w: 0.2, h: 0.2 },   // runs off the right edge
    { x: 0.1, y: 0.1, w: 0, h: 0.2 },      // zero width
  ]) {
    await assert.rejects(() => erasePanelRegions(bytes, [region]),
      (error) => error.code === "atlas_erase_region_invalid",
      `${JSON.stringify(region)} must be refused, not silently clamped`);
  }
});

test("no regions is refused", async () => {
  const { bytes } = await panelWithMark();
  await assert.rejects(() => erasePanelRegions(bytes, []),
    (error) => error.code === "atlas_erase_regions_required");
});

// RULE 0.22 forbids GENERATION and permits CORRECTION. The line between them
// here is size: popping a text block off a flank is a correction, and erasing a
// third of the artwork is a new design.
test("a region too large to be a correction is refused", async () => {
  const { bytes } = await panelWithMark();
  const oversized = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
  assert.ok(oversized.w * oversized.h > MAX_ERASE_FRACTION, "fixture must exceed the ceiling");
  await assert.rejects(() => erasePanelRegions(bytes, [oversized]),
    (error) => error.code === "atlas_erase_region_too_large");
});

test("the erased region no longer carries the mark, and the panel keeps its size", async () => {
  const { bytes, width, height } = await panelWithMark();
  const result = await erasePanelRegions(bytes, [{ x: 0.3, y: 0.35, w: 0.4, h: 0.3 }]);
  assert.equal(result.contract, ERASE_CONTRACT);
  assert.equal(result.widthPx, width);
  assert.equal(result.heightPx, height);
  assert.equal(result.unresolvedPixels, 0, "a region surrounded by artwork must close completely");

  const before = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const after = await sharp(result.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  // Inside the erased box the near-white mark must be gone.
  let brightAfter = 0;
  for (let y = 100; y < 140; y += 1) {
    for (let x = 230; x < 410; x += 1) {
      const offset = (y * width + x) * 4;
      if (Math.min(after.data[offset], after.data[offset + 1], after.data[offset + 2]) > 220) brightAfter += 1;
    }
  }
  assert.equal(brightAfter, 0, "the mark must not survive inside the erased region");

  // Outside it, nothing may be touched: a correction edits what was selected.
  let changedOutside = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= 150 && x < 500 && y >= 60 && y < 190) continue; // the box plus its dilation
      const offset = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        if (before.data[offset + c] !== after.data[offset + c]) { changedOutside += 1; break; }
      }
    }
  }
  assert.equal(changedOutside, 0, "pixels outside the selection must be byte-identical");
});

// "must have the ability to magic layer off text but keep fonts" -- the lift is
// what makes the erase non-destructive. Re-rendering would mean guessing the
// typeface; the plate carries the panel's own pixels instead.
test("the type comes back as a transparent layer carrying the original pixels", async () => {
  const { bytes, width } = await panelWithMark();
  const result = await erasePanelRegions(bytes, [{ x: 0.3, y: 0.35, w: 0.4, h: 0.3 }]);
  assert.ok(result.liftedBytes, "a lifted layer is required when something was erased");
  assert.ok(result.liftedPixels > 0);

  const lifted = await sharp(result.liftedBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(lifted.info.channels, 4, "the lifted plate must carry alpha");

  // Where the mark was, the plate must be opaque and hold the MARK's colour --
  // not a re-render, not the background.
  const centre = ((120 * width) + 320) * 4;
  assert.ok(lifted.data[centre + 3] > 200, "the mark must be opaque on the lifted plate");
  assert.ok(Math.min(lifted.data[centre], lifted.data[centre + 1], lifted.data[centre + 2]) > 220,
    "the lifted plate must carry the mark's own colour");

  // Far outside the selection the plate must be fully transparent, or the
  // "layer" is really a copy of the panel.
  const outside = ((10 * width) + 10) * 4;
  assert.equal(lifted.data[outside + 3], 0, "the lifted plate must be empty outside the selection");
});

// THE WIRING. The endpoint is thin glue, and what must not drift is WHERE it
// puts the result: the existing correction lineage, never a new artifact kind.
test("the endpoint records through the correction lineage and nothing else", () => {
  const start = RUNTIME_INDEX.indexOf('app.post("/internal/panels/erase"');
  assert.ok(start > 0, "the operator erase endpoint must exist");
  const handler = RUNTIME_INDEX.slice(start, RUNTIME_INDEX.indexOf('app.post("/internal/wrapbox/recipient"', start));
  assert.ok(handler.length > 500, "handler not located");

  assert.match(handler, /record_designpro_corrected_panel/,
    "a correction must go through the correction RPC, which keeps both artifacts and demands a reason");
  // The frozen seam does not move for this feature.
  for (const forbidden of ["panel-base", "panel-mark", "artifact_kind: \"panel\"", "delete("]) {
    assert.ok(!handler.includes(forbidden),
      `the erase endpoint must not ${forbidden} -- it corrects, it does not redefine or destroy`);
  }
  // It must erase the ACTIVE artifact, the same rule Call 12 enhances by, or a
  // second edit would silently revert the first.
  assert.match(handler, /corrected-panel"\s*\)\s*\|\|\s*branded/,
    "the newest correction is the source when one exists");
  // And it must prove the bytes are the ones the database named.
  assert.match(handler, /panel_erase_source_changed/,
    "the source hash must be verified before it is edited");
  assert.match(handler, /panel_erase_reason_required/,
    "the designer's reason is required before the work is done, not after");
});
