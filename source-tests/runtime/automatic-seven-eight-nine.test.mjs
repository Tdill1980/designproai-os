import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { STAGES, RECEIPTS, _test } = require("../runtime/designpro-standalone-claimant.cjs");

const views = {
  driver: "https://assets.example/driver.png", passenger: "https://assets.example/passenger.png",
  hood: "https://assets.example/hood.png", roof: "https://assets.example/roof.png",
  front: "https://assets.example/front.png", rear: "https://assets.example/rear.png",
  hero3d: "https://assets.example/hero.png",
};

test("seven distinct views automatically precede flat proof, panels and logos", () => {
  assert.deepEqual(STAGES.slice(0, 7), ["revision.freeze", "manifest.resolve", "proof.build", "panels.build", "logos.extract", "pack.verify", "pack.activate"]);
  assert.deepEqual(RECEIPTS.slice(0, 4), ["views.seven-source", "call8.flat-proof", "call9.surface-panels", "call10.logo-inventory"]);
  assert.equal(new Set(Object.values(_test.exactSevenViews({ renderUrls: views }))).size, 7);
});

test("missing or reused required view refuses the chain", () => {
  const missing = { ...views }; delete missing.roof;
  assert.throws(() => _test.exactSevenViews({ renderUrls: missing }), /roof view is missing/);
  const reused = { ...views, passenger: views.driver };
  assert.throws(() => _test.exactSevenViews({ renderUrls: reused }), /distinct source assets/);
});

test("Call 8 proof carries deterministic dimensions, five-inch bleed and square feet", () => {
  const expectedSurfaces = [
    ["driver", 163, 56], ["passenger", 163, 56], ["hood", 65, 42],
    ["roof", 58, 70], ["front", 66, 42], ["rear", 66, 42],
  ].map(([surfaceKey, widthInches, heightInches]) => ({ surfaceKey, widthInches, heightInches, bleed: { top: 5, right: 5, bottom: 5, left: 5 }, surfaceSqFt: _test.round2(widthInches * heightInches / 144), sourceView: views[surfaceKey] }));
  const totalSqFt = _test.round2(expectedSurfaces.reduce((sum, item) => sum + item.widthInches * item.heightInches / 144, 0));
  const built = _test.call8ProofRequest({ tenant_key: "test", id: "00000000-0000-0000-0000-000000000001" }, { expectedSurfaces, totalSqFt });
  assert.equal(built.totalSqFt, totalSqFt);
  assert.equal(built.request.tiles.length, 6);
  assert.ok(built.request.tiles.every((tile) => tile.bleedIn === 5 && tile.trimWidthIn > 0 && tile.trimHeightIn > 0));
  assert.match(built.request.overlaySvg, new RegExp(`GENIE TOTAL: ${totalSqFt.toFixed(2)} SQ FT`));
});
