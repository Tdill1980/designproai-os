import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const { renderProofSheet } = require("../../runtime/proof-sheet.cjs");

const productionKeys = ["driver", "passenger", "hood", "roof", "front", "rear"];
const surfaces = productionKeys.map((surfaceKey, index) => ({
  surfaceKey,
  widthInches: 60 + index,
  heightInches: 30 + index,
}));

async function proofImage(red) {
  return sharp({
    create: {
      width: 8,
      height: 6,
      channels: 3,
      background: { r: red, g: 60, b: 120 },
    },
  }).png().toBuffer();
}

async function viewSet(seventhKey, includeOtherSeventh = false) {
  const entries = await Promise.all(
    [...productionKeys, seventhKey].map(async (viewKey, index) => [viewKey, await proofImage(20 + index * 20)]),
  );
  if (includeOtherSeventh) {
    const other = seventhKey === "closeup" ? "hero3d" : "closeup";
    entries.push([other, await proofImage(240)]);
  }
  return Object.fromEntries(entries);
}

const proofInput = (views) => ({
  views,
  surfaces,
  vehicle: { year: "2026", make: "Ford", model: "F-350" },
  designName: "Close-Up contract test",
  finish: "gloss",
  designId: "DID-TEST0001",
  orderNumber: "TEST-1",
  proofBinding: "a".repeat(64),
});

test("proof sheet rejects co-present Close-Up and historical Hero identities", async () => {
  await assert.rejects(
    renderProofSheet(proofInput(await viewSet("closeup", true))),
    (error) => error.code === "proof_sheet_seventh_view_invalid",
  );
});

test("proof sheet retains immutable historical Hero only when Close-Up is absent", async () => {
  const result = await renderProofSheet(proofInput(await viewSet("hero3d")));
  assert.deepEqual(Object.keys(result.layout.cells), [
    "driver", "roof", "passenger", "hood", "front", "rear", "hero3d",
  ]);
  assert.equal(result.layout.cells.hero3d.label, "APPROVED 3D HERO (HISTORICAL)");
  assert.equal(Object.hasOwn(result.layout.cells, "closeup"), false);
});
