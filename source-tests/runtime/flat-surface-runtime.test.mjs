import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const layoutModule = require("../../runtime/flat-wrap-layout.cjs");
const wrap = require("../../runtime/gemini-flat-wrap.cjs");

const revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
// New authoring is bound to the exact active proof set. Historical Hero input
// compatibility is exercised separately by automatic-seven-eight-nine.test;
// every material-hash and immutable-retry assertion in this file must cover
// the production Close-Up path.
const viewKeys = ["driver", "passenger", "hood", "roof", "front", "rear", "closeup"];
const textLock = {
  bodyText: { phone: "555-0142" },
  logoPlacements: [{ identityKey: "primary", displayName: "Flamingo Pools", targetSurfaceKey: "driver", contentHash: "f".repeat(64) }],
};
// Real 2023 Ford F-350 Crew Cab geometry from the production proof.
const surfaces = [
  { surfaceKey: "driver", widthInches: 153, heightInches: 56 },
  { surfaceKey: "passenger", widthInches: 153, heightInches: 56 },
  { surfaceKey: "hood", widthInches: 71.5, heightInches: 54 },
  { surfaceKey: "roof", widthInches: 74.3, heightInches: 54.8 },
  { surfaceKey: "front", widthInches: 68, heightInches: 40 },
  { surfaceKey: "rear", widthInches: 76, heightInches: 34 },
];

async function sourceViews(keys = viewKeys) {
  return Promise.all(keys.map(async (viewKey, index) => {
    const bytes = await sharp({ create: { width: 64 + index, height: 48 + index, channels: 3, background: { r: 20 + index * 30, g: 90, b: 160 } } }).png().toBuffer();
    return {
      viewKey,
      storagePath: `users/owner/revisions/${revisionId}/inputs/${viewKey}.png`,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.length,
      contentType: "image/png",
      bytes,
    };
  }));
}

// A continuous design, the way Call 8 authors it: one composition running edge
// to edge, never six tiles.
async function continuousDesign(width, height, seed = 0) {
  const shapes = Array.from({ length: 30 }, (_, index) =>
    `<ellipse cx="${((index + seed) * 397) % width}" cy="${((index + seed) * 613) % height}" rx="${300 + index * 29}" ry="${180 + index * 17}" fill="hsl(${(index * 37 + 170 + seed * 20) % 360},70%,${35 + (index % 5) * 8}%)" opacity="0.6"/>`).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="hsl(${(190 + seed * 25) % 360},65%,45%)"/>${shapes}</svg>`)).png().toBuffer();
}

test("the cut map is a pure function of the validated GENIE manifest", () => {
  const first = layoutModule.flatWrapLayout(surfaces);
  const second = layoutModule.flatWrapLayout([...surfaces].reverse());
  assert.equal(layoutModule.layoutIdentity(first), layoutModule.layoutIdentity(second));
  assert.deepEqual(first.cells.map((cell) => cell.surfaceKey), ["driver", "passenger", "hood", "roof", "front", "rear"]);
  for (const cell of first.cells) {
    const surface = surfaces.find((item) => item.surfaceKey === cell.surfaceKey);
    assert.equal(cell.bleedIn, 5);
    assert.equal(cell.printWidthIn, surface.widthInches + 10);
    assert.equal(cell.printHeightIn, surface.heightInches + 10);
    assert.equal(cell.w, cell.trimWidthPx + cell.bleedPx * 2);
    assert.equal(cell.h, cell.trimHeightPx + cell.bleedPx * 2);
    assert.ok(cell.x >= 0 && cell.y >= 0 && cell.x + cell.w <= first.width && cell.y + cell.h <= first.height);
  }
  // Rectangles must never overlap, or one surface would carry another's art.
  for (const left of first.cells) {
    for (const right of first.cells) {
      if (left === right) continue;
      const disjoint = left.x + left.w <= right.x || right.x + right.w <= left.x
        || left.y + left.h <= right.y || right.y + right.h <= left.y;
      assert.ok(disjoint, `${left.surfaceKey} overlaps ${right.surfaceKey}`);
    }
  }
});

test("a drifted cut map is refused rather than trusted", () => {
  const layout = layoutModule.flatWrapLayout(surfaces);
  assert.equal(layoutModule.layoutIdentity(layoutModule.assertLayoutMatches(layout, surfaces)), layoutModule.layoutIdentity(layout));
  const moved = { ...layout, cells: layout.cells.map((cell, index) => (index === 0 ? { ...cell, x: cell.x + 1 } : cell)) };
  assert.throws(() => layoutModule.assertLayoutMatches(moved, surfaces), /not the deterministic layout/);
  assert.throws(() => layoutModule.assertLayoutMatches(null, surfaces), /requires the deterministic flat wrap layout/);
  assert.throws(() => layoutModule.flatWrapLayout(surfaces.map((item) => ({ ...item, bleedIn: 3 }))), /exactly 5 inches of bleed/);
});

test("Call 9 cuts reproduce byte for byte and never regenerate", async () => {
  const layout = layoutModule.flatWrapLayout(surfaces);
  const design = await continuousDesign(1400, Math.round(1400 * layout.height / layout.width));
  const flat = await layoutModule.normalizeGeneratedLayout(design, layout);
  const metadata = await sharp(flat).metadata();
  assert.equal(metadata.width, layout.width);
  assert.equal(metadata.height, layout.height);

  const first = await layoutModule.cutAllPanels(flat, layout);
  const second = await layoutModule.cutAllPanels(flat, layout);
  assert.deepEqual(first.map((panel) => panel.contentHash), second.map((panel) => panel.contentHash));
  assert.equal(new Set(first.map((panel) => panel.contentHash)).size, 6);
  for (const panel of first) {
    assert.equal(panel.bytes.length, panel.byteSize);
    assert.equal(createHash("sha256").update(panel.bytes).digest("hex"), panel.contentHash);
    const cut = await sharp(panel.bytes).metadata();
    assert.equal(cut.width, panel.cell.w);
    assert.equal(cut.height, panel.cell.h);
  }
});

test("a layout raster that is not the recorded canvas fails the cut closed", async () => {
  const layout = layoutModule.flatWrapLayout(surfaces);
  const wrongSize = await sharp({ create: { width: layout.width - 7, height: layout.height, channels: 3, background: "#ffffff" } }).png().toBuffer();
  await assert.rejects(() => layoutModule.cutPanel(wrongSize, layout, "driver"), /not the recorded/);
  const correctSize = await sharp({ create: { width: layout.width, height: layout.height, channels: 3, background: "#ffffff" } }).png().toBuffer();
  await assert.rejects(() => layoutModule.cutPanel(correctSize, layout, "spoiler"), /no layout rectangle/);
});

test("two surfaces carrying the same artwork fail the run", async () => {
  const layout = layoutModule.flatWrapLayout(surfaces);
  // A flat canvas: every rectangle is visually identical, which is exactly the
  // July 24 failure where driver artwork reached every panel.
  const uniform = await sharp({ create: { width: layout.width, height: layout.height, channels: 3, background: "#2f6f8f" } }).png().toBuffer();
  const panels = await Promise.all(layout.cells.map(async (cell) => layoutModule.cutPanel(uniform, layout, cell.surfaceKey)));
  await assert.rejects(() => layoutModule.assertSurfacesAreDistinct(panels), /carries the same artwork as/);

  const design = await continuousDesign(1400, Math.round(1400 * layout.height / layout.width));
  const flat = await layoutModule.normalizeGeneratedLayout(design, layout);
  const real = await layoutModule.cutAllPanels(flat, layout);
  const fingerprints = await layoutModule.assertSurfacesAreDistinct(real);
  assert.equal(new Set(Object.values(fingerprints)).size, 6);
});

test("the authored design binds every source, the cut map, the text lock and the model", async () => {
  const layout = layoutModule.flatWrapLayout(surfaces);
  const views = await sourceViews();
  const base = wrap.flatWrapInputHash({ sourceViews: views, layout, revisionId, textLock });
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(wrap.flatWrapInputHash({ sourceViews: [...views].reverse(), layout, revisionId, textLock }), base);

  const swapped = views.map((item) => (item.viewKey === "roof" ? { ...item, contentHash: "a".repeat(64) } : item));
  assert.notEqual(wrap.flatWrapInputHash({ sourceViews: swapped, layout, revisionId, textLock }), base);
  const changedCloseUp = views.map((item) => (item.viewKey === "closeup"
    ? { ...item, contentHash: "b".repeat(64) }
    : item));
  assert.notEqual(
    wrap.flatWrapInputHash({ sourceViews: changedCloseUp, layout, revisionId, textLock }),
    base,
    "the active Close-Up proof is part of the immutable material identity",
  );
  const widerLayout = layoutModule.flatWrapLayout(surfaces.map((item) => (item.surfaceKey === "hood" ? { ...item, widthInches: 80 } : item)));
  assert.notEqual(wrap.flatWrapInputHash({ sourceViews: views, layout: widerLayout, revisionId, textLock }), base);
  assert.notEqual(wrap.flatWrapInputHash({ sourceViews: views, layout, revisionId, textLock: { ...textLock, bodyText: { phone: "555-0143" } } }), base);
  assert.notEqual(wrap.flatWrapInputHash({ sourceViews: views, layout, revisionId, textLock, model: "gemini-2.5-flash-image" }), base);
  assert.throws(() => wrap.flatWrapInputHash({ sourceViews: views.slice(0, 6), layout, revisionId, textLock }), /exactly seven immutable source views/);
});

test("Call 8 material accepts exact Close-Up or historical Hero source sets", async () => {
  const layout = layoutModule.flatWrapLayout(surfaces);
  const closeupViews = await sourceViews(["driver", "passenger", "hood", "roof", "front", "rear", "closeup"]);
  assert.match(wrap.flatWrapInputHash({ sourceViews: closeupViews, layout, revisionId, textLock }), /^[0-9a-f]{64}$/);

  const historicalHeroViews = await sourceViews(["driver", "passenger", "hood", "roof", "front", "rear", "hero3d"]);
  assert.match(
    wrap.flatWrapInputHash({ sourceViews: historicalHeroViews, layout, revisionId, textLock }),
    /^[0-9a-f]{64}$/,
  );
  const hero = historicalHeroViews.find((view) => view.viewKey === "hero3d");
  assert.ok(hero, "the historical compatibility fixture must contain a real Hero source");
  const both = [...closeupViews.filter((view) => view.viewKey !== "roof"), hero];
  assert.throws(
    () => wrap.flatWrapInputHash({ sourceViews: both, layout, revisionId, textLock }),
    /exactly one Close-Up or immutable historical Hero proof/,
  );
  assert.throws(
    () => wrap.flatWrapInputHash({
      sourceViews: historicalHeroViews.filter((view) => view.viewKey !== "hero3d"),
      layout,
      revisionId,
      textLock,
    }),
    /exactly seven immutable source views/,
  );
});

test("a retry reuses the immutable authored design instead of authoring a second one", async () => {
  const layout = layoutModule.flatWrapLayout(surfaces);
  const views = await sourceViews();
  const stored = new Map();
  let authorCalls = 0;
  const options = {
    apiKey: "test-key", layout, revisionId, sourceViews: views, textLock, vehicleName: "2023 Ford F-350 Crew Cab",
    generateLayout: async () => {
      authorCalls += 1;
      return continuousDesign(1200, Math.round(1200 * layout.height / layout.width), authorCalls);
    },
    loadExisting: async () => stored.get("layout") || null,
    persist: async (bytes) => { stored.set("layout", Buffer.from(bytes)); },
  };

  const first = await wrap.authorFlatWrapLayout(options);
  assert.equal(authorCalls, 1);
  assert.equal(first.reused, false);
  assert.match(first.contentHash, /^[0-9a-f]{64}$/);

  const second = await wrap.authorFlatWrapLayout(options);
  assert.equal(authorCalls, 1, "a retry must not ask the model for a second design");
  assert.equal(second.reused, true);
  assert.equal(second.contentHash, first.contentHash);

  // The cuts taken from the reused winner are the same cuts.
  const before = await layoutModule.cutAllPanels(first.bytes, layout);
  const after = await layoutModule.cutAllPanels(second.bytes, layout);
  assert.deepEqual(before.map((panel) => panel.contentHash), after.map((panel) => panel.contentHash));
});

test("authoring refuses a mismatched material hash and a stale winner of the wrong size", async () => {
  const layout = layoutModule.flatWrapLayout(surfaces);
  const views = await sourceViews();
  await assert.rejects(() => wrap.authorFlatWrapLayout({
    apiKey: "test-key", layout, revisionId, sourceViews: views, textLock,
    inputHash: "b".repeat(64), generateLayout: async () => continuousDesign(800, 1200),
    loadExisting: async () => null, persist: async () => {},
  }), /material hash mismatch/);

  const wrongSize = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#ffffff" } }).png().toBuffer();
  await assert.rejects(() => wrap.authorFlatWrapLayout({
    apiKey: "test-key", layout, revisionId, sourceViews: views, textLock,
    generateLayout: async () => continuousDesign(800, 1200),
    loadExisting: async () => wrongSize, persist: async () => {},
  }), /not the recorded/);
});

test("a generated design far off the required proportions is refused", async () => {
  const layout = layoutModule.flatWrapLayout(surfaces);
  const square = await continuousDesign(1200, 1200);
  await assert.rejects(() => layoutModule.normalizeGeneratedLayout(square, layout), /too far from the required/);
  const tiny = await sharp({ create: { width: 64, height: 96, channels: 3, background: "#ffffff" } }).png().toBuffer();
  await assert.rejects(() => layoutModule.normalizeGeneratedLayout(tiny, layout), /missing or too small/);
});

test("the authoring prompt keeps logos out of the base and carries no cross-vehicle anchor", () => {
  const layout = layoutModule.flatWrapLayout(surfaces);
  const frozen = require("../../runtime/gemini-flat-surface.cjs").normalizeTextLock(textLock);
  const prompt = wrap._test.wrapPrompt("2023 Ford F-350 Crew Cab", layout, "a".repeat(64), frozen);
  assert.match(prompt, /ONE continuous FLAT wrap design/);
  assert.match(prompt, /Customer logos are printed on top of these panels later and must NOT be drawn into this base artwork/);
  assert.match(prompt, /"Flamingo Pools"/);
  assert.doesNotMatch(prompt, /anchor/i);
  assert.doesNotMatch(prompt, /driver side only|follow the hero/i);
});

test("Gemini response parser fails closed on missing, duplicate, or unsupported images", () => {
  const inline = (mimeType) => ({ inlineData: { mimeType, data: Buffer.from("x").toString("base64") } });
  assert.throws(() => wrap._test.extractOneImageResponse({ candidates: [{ content: { parts: [] } }] }, "layout"), /exactly one image/);
  assert.throws(() => wrap._test.extractOneImageResponse({ candidates: [{ content: { parts: [inline("image/png"), inline("image/png")] } }] }, "layout"), /exactly one image/);
  assert.throws(() => wrap._test.extractOneImageResponse({ candidates: [{ content: { parts: [inline("application/pdf")] } }] }, "layout"), /unsupported/);
  assert.equal(wrap._test.extractOneImageResponse({ candidates: [{ content: { parts: [inline("image/png")] } }] }, "layout").length, 1);
});
