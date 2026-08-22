import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const {
  CLOSEUP_VIEW_ORDER,
  VIEW_ORDER,
  renderProofSheet,
} = require("../../runtime/proof-sheet.cjs");

const surfaceKeys = ["driver", "passenger", "hood", "roof", "front", "rear"];
const surfaces = surfaceKeys.map((surfaceKey, index) => ({
  surfaceKey,
  widthInches: 120 + index,
  heightInches: 48 + index,
}));

async function imageBytes() {
  return sharp({
    create: { width: 24, height: 16, channels: 3, background: "#137c8b" },
  }).png().toBuffer();
}

async function proofViews(seventh) {
  const bytes = await imageBytes();
  return Object.fromEntries([...surfaceKeys, seventh].map((key) => [key, bytes]));
}

const proofInput = (views) => ({
  views,
  surfaces,
  vehicle: { year: 2026, make: "Ford", model: "F-250" },
  designName: "Compatibility bridge",
  finish: "gloss",
  designId: "DID-BRIDGE",
  orderNumber: "BRIDGE-1",
  proofBinding: "a".repeat(64),
});

test("Call 8 renders Close-Up and historical Hero under their exact identities", async () => {
  const closeup = await renderProofSheet(proofInput(await proofViews("closeup")));
  assert.deepEqual(Object.keys(closeup.layout.cells), CLOSEUP_VIEW_ORDER);
  assert.ok(closeup.layout.cells.closeup);
  assert.equal(closeup.layout.cells.hero3d, undefined);

  const historicalHero = await renderProofSheet(proofInput(await proofViews("hero3d")));
  assert.deepEqual(Object.keys(historicalHero.layout.cells), VIEW_ORDER);
  assert.ok(historicalHero.layout.cells.hero3d);
  assert.equal(historicalHero.layout.cells.closeup, undefined);
});

test("Call 8 rejects both or neither compatible seventh identity", async () => {
  const closeupViews = await proofViews("closeup");
  await assert.rejects(
    renderProofSheet(proofInput({ ...closeupViews, hero3d: await imageBytes() })),
    (error) => error.code === "proof_sheet_seventh_view_invalid",
  );

  const { closeup: _closeup, ...noSeventh } = closeupViews;
  await assert.rejects(
    renderProofSheet(proofInput(noSeventh)),
    (error) => error.code === "proof_sheet_seventh_view_invalid",
  );
});
