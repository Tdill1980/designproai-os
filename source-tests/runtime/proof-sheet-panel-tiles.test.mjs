// ⛔ THE 2D PRODUCTION PROOF SHOWS THE SIX PANELS. NOT THE 3D PROOFS.
//    (Trish 2026-08-29.)
//
// This file replaces `proof-sheet-compatibility.test.mjs` and
// `proof-sheet-view-selection.test.mjs`, which existed only to lock the
// SEVENTH cell -- the Close-Up photograph, or on historical runs the 3D Hero.
// Between them they asserted, in four tests, exactly which studio photograph
// belonged in the bottom-right corner of a sheet titled "2D Production Proof",
// and that a sheet with neither was refused.
//
// Both were faithful locks on the wrong contract. `renderProofSheet` took the
// seven persona-photographer renders and laid them out as the production
// document; the same pixels, flattened by Gemini, then became the customer's
// print files. The owner's description was exact: screenshots presented as
// print files.
//
// The sheet is now the six Call-1 panels -- deterministic geometric crops of
// the accepted A.T.L.A.S. master, at GENIE trim with the five-inch bleed --
// and the vacated seventh cell carries a DRAWN provenance block naming the
// master they came from. There is no view key anywhere in this contract, and
// a caller may not pass one.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const {
  SURFACE_ORDER,
  SURFACE_LABELS,
  proofSheetLayout,
  renderProofSheet,
} = require("../../runtime/proof-sheet.cjs");

const surfaceKeys = ["driver", "passenger", "hood", "roof", "front", "rear"];
const surfaces = surfaceKeys.map((surfaceKey, index) => ({
  surfaceKey,
  widthInches: 120 + index,
  heightInches: 48 + index,
}));

// A panel is a SOLID RECTANGLE of continuous artwork (RULE 0.15), so the
// fixture is one: opaque, corner to corner, no alpha and no hole.
function panelBytes(hue) {
  return sharp({ create: { width: 24, height: 16, channels: 3, background: { r: hue, g: 60, b: 120 } } })
    .png().toBuffer();
}

async function panelSet(keys = surfaceKeys) {
  const entries = await Promise.all(keys.map(async (key, index) => [key, await panelBytes(20 + index * 20)]));
  return Object.fromEntries(entries);
}

const proofInput = (panels) => ({
  panels,
  surfaces,
  vehicle: { year: 2026, make: "Ford", model: "F-250" },
  designName: "Panel proof contract",
  finish: "gloss",
  designId: "DID-PANEL01",
  orderNumber: "PANEL-1",
  proofBinding: "a".repeat(64),
  masterHash: "b".repeat(64),
});

test("the sheet has exactly six cells, one per canonical surface", async () => {
  const sheet = await renderProofSheet(proofInput(await panelSet()));
  assert.deepEqual(Object.keys(sheet.layout.cells), [...SURFACE_ORDER]);
  assert.equal(SURFACE_ORDER.length, 6);
  for (const key of surfaceKeys) assert.equal(sheet.layout.cells[key].label, SURFACE_LABELS[key]);
});

test("there is no seventh photograph cell, under any name", async () => {
  const sheet = await renderProofSheet(proofInput(await panelSet()));
  for (const viewKey of ["closeup", "hero3d", "hero-3d", "side", "passenger-side"]) {
    assert.equal(Object.hasOwn(sheet.layout.cells, viewKey), false, `${viewKey} must not have a cell`);
  }
  // And nothing in the module still names one.
  assert.equal(SURFACE_LABELS.closeup, undefined);
  assert.equal(SURFACE_LABELS.hero3d, undefined);
});

test("the vacated cell is a drawn provenance block naming the master", async () => {
  const layout = proofSheetLayout();
  // It occupies the corner the Close-Up used to: column 2, bottom row.
  assert.ok(layout.provenanceCell?.frame);
  assert.equal(layout.provenanceCell.frame.x, layout.margin + 2 * layout.columnWidth);
  assert.equal(layout.provenanceCell.frame.y, layout.bodyTop + 2 * layout.rowHeight);
  const { provenanceMarkup } = require("../../runtime/proof-sheet.cjs")._test;
  const markup = provenanceMarkup(layout.provenanceCell, {
    masterHash: "c".repeat(64), panelCount: 6, sourceLabel: "cut from one A.T.L.A.S. master",
  });
  assert.match(markup, /SOURCE OF THESE PANELS/);
  assert.match(markup, /6 deterministic panels/);
  assert.match(markup, /A\.T\.L\.A\.S\. MASTER/);
  assert.match(markup, new RegExp("c".repeat(32)));
  assert.match(markup, /Geometric crop\. No AI step\./);
});

test("a missing panel is refused -- it is never filled with anything else", async () => {
  const { hood: _hood, ...missingHood } = await panelSet();
  await assert.rejects(
    renderProofSheet(proofInput(missingHood)),
    (error) => error.code === "proof_sheet_panel_missing" && /hood/.test(error.message),
  );
});

test("a `views` payload does not render -- the parameter is gone", async () => {
  // The exact shape the old contract accepted. It must now fail as an absent
  // panel set rather than quietly composing a page of photographs.
  const views = await panelSet([...surfaceKeys, "closeup"]);
  await assert.rejects(
    renderProofSheet({ ...proofInput(undefined), views }),
    (error) => error.code === "proof_sheet_panel_missing",
  );
});

test("every tile reports the GENIE geometry its own panel was cut to", async () => {
  const sheet = await renderProofSheet(proofInput(await panelSet()));
  assert.equal(sheet.tiles.length, 6);
  for (const tile of sheet.tiles) {
    const surface = surfaces.find((item) => item.surfaceKey === tile.surfaceKey);
    assert.equal(tile.trimWidthIn, surface.widthInches);
    assert.equal(tile.trimHeightIn, surface.heightInches);
    // Five inches of bleed on each of the four edges, so ten on each axis.
    assert.equal(tile.printWidthIn, surface.widthInches + 10);
    assert.equal(tile.printHeightIn, surface.heightInches + 10);
  }
});

test("the same panels and geometry compose the same sheet, byte for byte", async () => {
  // Determinism is the whole claim now that nothing generative sits behind it:
  // a proof that cannot be rebuilt and compared has to be trusted instead.
  const panels = await panelSet();
  const first = await renderProofSheet(proofInput(panels));
  const second = await renderProofSheet(proofInput(panels));
  assert.deepEqual(first.bytes, second.bytes);
});
