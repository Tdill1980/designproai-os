import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const flat = require("../../runtime/gemini-flat-surface.cjs");

const revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ownerId = "12345678-1234-4123-8123-123456789abc";

async function sourceViews() {
  const rows = [];
  for (let index = 0; index < flat.VIEW_KEYS.length; index += 1) {
    const viewKey = flat.VIEW_KEYS[index];
    const bytes = await sharp({ create: { width: 512 + index, height: 512, channels: 3, background: { r: 20 + index * 17, g: 80 + index, b: 140 - index } } }).png().toBuffer();
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    rows.push({ viewKey, storagePath: `users/${ownerId}/revisions/${revisionId}/inputs/${viewKey}/${contentHash}.png`, contentHash, byteSize: bytes.length, contentType: "image/png", bytes });
  }
  return rows;
}

function tileSet(materialPrefix = "pending") {
  return flat.SURFACE_KEYS.map((key, index) => ({
    key,
    trimWidthIn: 0.04 + index * 0.01,
    trimHeightIn: 0.03 + index * 0.01,
    bleedIn: 5,
    masterPath: `designpro/user_${ownerId}/${runId}/proof-masters/${key}-${materialPrefix}.png`,
    rawFlatPath: `designpro/user_${ownerId}/${runId}/proof-masters/raw/${key}-${materialPrefix}.png`,
  }));
}

const textLock = {
  bodyText: { phone: "555-0142", website: "example.test", tagline: "FAMILY OWNED SINCE 2009" },
  logoPlacements: [{ identityKey: "primary-logo", displayName: "Cascade Stoneworks", targetSurfaceKey: "driver", contentHash: "f".repeat(64) }],
};

test("flat material identity binds all seven sources, dimensions, model, and frozen text", async () => {
  const sources = await sourceViews();
  const tiles = tileSet();
  const first = flat.flatInputHash({ sourceViews: sources, tiles, revisionId, textLock, model: "gemini-3-pro-image" });
  const changedText = flat.flatInputHash({ sourceViews: sources, tiles, revisionId, textLock: { ...textLock, bodyText: { phone: "555-9999" } }, model: "gemini-3-pro-image" });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, changedText);
  assert.equal(flat.PROMPT_VERSION, "designproai-flat-surface-20260810.v2");
  assert.equal(flat.selectedImageModel(), "gemini-3-pro-image");
  assert.throws(() => flat.selectedImageModel("gemini-2.5-flash"), /image-generation model/);
});

test("a mid-six-surface crash reuses immutable raw and master winners", async () => {
  const sources = await sourceViews();
  let tiles = tileSet();
  const inputHash = flat.flatInputHash({ sourceViews: sources, tiles, revisionId, textLock, model: "gemini-3-pro-image" });
  tiles = tileSet(inputHash.slice(0, 24));
  const raw = new Map();
  const masters = new Map();
  const firstCalls = [];
  const color = (key) => {
    const index = flat.SURFACE_KEYS.indexOf(key);
    return sharp({ create: { width: 512 + index * 3, height: 512 + index * 2, channels: 3, background: { r: 35 + index * 31, g: 70 + index * 11, b: 180 - index * 17 } } }).png().toBuffer();
  };
  const common = {
    apiKey: "test-key",
    model: "gemini-3-pro-image",
    revisionId,
    inputHash,
    sourceViews: sources,
    tiles,
    textLock,
    loadExisting: async (surface) => masters.get(surface.masterPath) || null,
    loadExistingFlat: async (surface) => raw.get(surface.rawFlatPath) || null,
    persist: async (surface, bytes) => { masters.set(surface.masterPath, Buffer.from(bytes)); },
    persistFlat: async (surface, bytes) => { raw.set(surface.rawFlatPath, Buffer.from(bytes)); },
  };
  await assert.rejects(flat.authorFlatSurfaceMasters({
    ...common,
    generateSurface: async ({ surface }) => {
      firstCalls.push(surface.key);
      if (surface.key === "hood") throw new Error("forced mid-set crash");
      return color(surface.key);
    },
  }), /forced mid-set crash/);
  assert.deepEqual(firstCalls, ["driver", "passenger", "hood"]);
  assert.equal(masters.size, 2);
  assert.equal(raw.size, 2);
  const driverWinner = Buffer.from(masters.get(tiles[0].masterPath));

  const resumeCalls = [];
  const result = await flat.authorFlatSurfaceMasters({
    ...common,
    generateSurface: async ({ surface }) => { resumeCalls.push(surface.key); return color(surface.key); },
  });
  assert.deepEqual(resumeCalls, ["hood", "roof", "front", "rear"]);
  assert.equal(result.length, 6);
  assert.ok(result[0].bytes.equals(driverWinner));
  assert.equal(masters.size, 6);
  assert.equal(raw.size, 6);
  assert.ok(result.every((item) => item.flatHash && item.flatPixelWidth >= 512 && item.flatPixelHeight >= 512));
  assert.ok(result.every((item) => !Object.hasOwn(item, "reused")));
});

test("Gemini response parser fails closed on missing, duplicate, or unsupported images", () => {
  const valid = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("x").toString("base64") } }] } }] };
  assert.equal(flat._test.extractOneImageResponse(valid, "driver").contentType, "image/png");
  assert.throws(() => flat._test.extractOneImageResponse({ candidates: [{ content: { parts: [] }, finishReason: "NO_IMAGE" }] }, "driver"), /exactly one image/);
  assert.throws(() => flat._test.extractOneImageResponse({ candidates: [{ content: { parts: [valid.candidates[0].content.parts[0], valid.candidates[0].content.parts[0]] } }] }, "driver"), /received 2/);
  assert.throws(() => flat._test.extractOneImageResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "application/pdf", data: "eA==" } }] } }] }, "driver"), /unsupported/);
});
