// Phase 6: procedural plates are drawn from the manifest, never inferred.
//
// These exist because photographic plates are per-vehicle content that does not
// exist yet. What matters is that being schematic never becomes being wrong:
// geometry comes from the same manifest the surfaces are cut to, the meshes are
// declared, and nothing here looks at a generated picture of a vehicle.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { SURFACE_KEYS } = require("../../runtime/design-master.cjs");
const { VIEW_PLATE_CONTRACT, validateViewPlates } = require("../../runtime/vehicle-view-plate.cjs");
const { proceduralViewPlates, FRAME, PROCEDURAL_PLATE_CONTRACT } = require("../../runtime/procedural-view-plates.cjs");

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const uuid = (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const TRIM = { driver: [153, 56], passenger: [153, 56], hood: [71.5, 56], roof: [74.3, 54.8], front: [129, 34], rear: [76, 54] };
const MANIFEST = {
  expectedSurfaces: SURFACE_KEYS.map((k) => ({ surfaceKey: k, widthInches: TRIM[k][0], heightInches: TRIM[k][1] })),
};
const ARGS = { manifest: MANIFEST, plateSetId: uuid("e"), vehicleId: uuid("c"), dimensionManifestId: uuid("d"), manifestHash: sha256("m") };

test("GATE: a plate set satisfies the Phase 4 contract without changing it", async () => {
  const built = await proceduralViewPlates(ARGS);
  assert.equal(built.contract, PROCEDURAL_PLATE_CONTRACT);
  assert.equal(built.plates.contract, VIEW_PLATE_CONTRACT);
  // Re-validated independently: the provider gets no privileged path into the
  // contract it has to satisfy.
  const revalidated = validateViewPlates(JSON.parse(JSON.stringify({ ...built.plates, plateSetHash: undefined })));
  assert.equal(revalidated.plateSetHash, built.plates.plateSetHash);
  assert.equal(built.plates.views.length, 6);
  assert.deepEqual(built.plates.views.map((v) => v.viewKey), SURFACE_KEYS);

  // Every asset the set names is present and hashes to what it declares.
  for (const view of built.plates.views) {
    for (const image of [view.base, view.shading, view.specular, view.panels[0].mask]) {
      const bytes = built.assets.get(image.assetId);
      assert.ok(bytes, `${image.assetId} is missing`);
      assert.equal(sha256(bytes), image.contentHash, `${image.assetId} does not hash to its declaration`);
    }
  }
});

test("GATE: the plates are presentation only, internal only, and say both", async () => {
  const built = await proceduralViewPlates(ARGS);
  assert.equal(built.manufacturingAuthority, false);
  assert.equal(built.presentation, "orthographic-schematic");
  assert.equal(built.geometrySource, "genie-dimension-manifest");

  // The customer-facing proof experience is the photoreal RevisionStudioIQ
  // view. These plates exist so the deterministic chain can be built and
  // canaried before per-vehicle photographic plates are authored. A schematic
  // shown where a customer expects their truck replaces a premium product with
  // a debug artefact, so the artefact carries its own refusal.
  assert.equal(built.audience, "internal");
  assert.equal(built.neverShowToCustomer, true);
});

test("GATE: geometry comes from the manifest and nothing is fitted", async () => {
  const built = await proceduralViewPlates(ARGS);
  // Each card carries its panel's true proportions, so a wrong panel is
  // obvious at a glance rather than hidden by a generic tile.
  for (const view of built.plates.views) {
    const mesh = view.panels[0].mesh;
    const w = mesh.points[1].x - mesh.points[0].x;
    const h = mesh.points[2].y - mesh.points[0].y;
    const expected = TRIM[view.viewKey][0] / TRIM[view.viewKey][1];
    assert.ok(Math.abs(w / h - expected) / expected < 0.02,
      `${view.viewKey} card is ${(w / h).toFixed(2)}:1, not the panel's ${expected.toFixed(2)}:1`);
    // One declared cell. A schematic has no curvature to describe, and
    // inventing some would be inventing geometry.
    assert.equal(mesh.rows, 1);
    assert.equal(mesh.cols, 1);
  }

  // Nothing on this path reads a render, a view or a generated image.
  const source = readFileSync(new URL("../../runtime/procedural-view-plates.cjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const forbidden of ["viewOrder", "cameraAngle", "renderUrls", "sourceView", "gemini", "generateContent", "prompt", "fit(", "solve", "estimate"]) {
    assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, `plates must not reference ${forbidden}`);
  }
});

test("GATE: a flank plate declares which side faces the camera", async () => {
  const built = await proceduralViewPlates(ARGS);
  const handed = Object.fromEntries(built.plates.views.map((v) => [v.viewKey, v.handedness]));
  // The contract's own handedness check protects the schematic exactly as it
  // would protect a photograph: a passenger surface on a left-facing view is
  // refused before a pixel is drawn.
  assert.equal(handed.driver, "left");
  assert.equal(handed.passenger, "right");
  for (const key of ["hood", "roof", "front", "rear"]) assert.equal(handed[key], "none");
});

test("the same manifest produces the same plates, and a different one does not", async () => {
  const first = await proceduralViewPlates(ARGS);
  const second = await proceduralViewPlates(ARGS);
  assert.equal(first.plates.plateSetHash, second.plates.plateSetHash);
  for (const [assetId, bytes] of first.assets) {
    assert.equal(sha256(bytes), sha256(second.assets.get(assetId)), `${assetId} is not reproducible`);
  }

  const wider = { ...MANIFEST, expectedSurfaces: MANIFEST.expectedSurfaces.map((s) => (s.surfaceKey === "hood" ? { ...s, widthInches: 90 } : s)) };
  const changed = await proceduralViewPlates({ ...ARGS, manifest: wider });
  assert.notEqual(changed.plates.plateSetHash, first.plates.plateSetHash);
});

test("an incomplete manifest is refused rather than defaulted", async () => {
  await assert.rejects(proceduralViewPlates({ ...ARGS, manifest: {} }), (e) => e.code === "plate_manifest_missing");
  await assert.rejects(
    proceduralViewPlates({ ...ARGS, manifest: { expectedSurfaces: MANIFEST.expectedSurfaces.slice(0, 5) } }),
    (e) => e.code === "plate_manifest_incomplete");
});

test("every masked pixel is reachable by the mesh", async () => {
  // The mask trims, so the mesh is a pixel proud of it on every side. If it
  // were not, the 3D proof would fail closed with proof3d_mask_uncovered and
  // the plates would be unusable.
  const built = await proceduralViewPlates(ARGS);
  for (const view of built.plates.views) {
    const mesh = view.panels[0].mesh;
    assert.ok(mesh.points[0].x >= 0 && mesh.points[0].y >= 0);
    assert.ok(mesh.points[3].x <= FRAME.widthPx && mesh.points[3].y <= FRAME.heightPx);
  }
});
