// THE PROOFS AND THE PANELS COME FROM THE SAME REPAIRED SHEET.
//
// The cut-out fill existed and was reachable, but only the PANEL half used it.
// The proof half -- the JPEG projection and the six exact surface crops the
// proof QC judges against -- was still built from the authored sheet, holes and
// all, on the stated theory that a hole "lands in the region the proof masks
// away".
//
// Production canary 6667efac-6d62-4e8f-bf3c-39aa805ed352 (2026-08-26) disproved
// that theory with a measurement, not an opinion: the driver and passenger
// flanks each came back with 26.7% of the zone punched out across four
// components. A rectangle with wheel-arch bites and a glass band cut out of it
// does not read as livery, it reads as a vehicle -- and the proof QC, which is
// handed that exact crop as "the sole artwork authority", said so, verbatim:
//
//   side          "The candidate proof shows a Ford F250 Crew Cab truck, but
//                  the authority image shows a cargo van."
//   passenger-side "the authority image is a van"
//   close-up      "the authority image depicts a van. This is a mismatch in the
//                  exact target vehicle."
//
// Three of seven proofs survived, and the three that survived (roof, rear,
// hood_detail) were the ones whose surfaces had the smallest cut-outs or none.
// The repaired duplicate -- a solid rectangle of continuous livery -- sat
// unused by the proof half the whole time.
//
// These tests pin the two halves to one sheet. Nothing here relaxes a
// threshold, changes authoring, or lets a hole through: the fill's own mask and
// the master QC's own verdicts are unchanged.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const atlas = require("../runtime/flat-first-atlas.cjs");
const source = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("../runtime/designpanel-server-provider.cjs", import.meta.url), "utf8");
const proofQcSource = readFileSync(new URL("../runtime/atlas-proof-qc.cjs", import.meta.url), "utf8");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("the projection and the panels are cut from the same repaired sheet", () => {
  // One expression each. If either ever takes `masterBytes` again, the proof
  // half is back on the holed original and the canary failure returns.
  assert.match(source, /cutCallOnePanels\(surfaceSourceBytes, manifest, masterHash\)/);
  assert.match(source, /projectionDerivative\(surfaceSourceBytes\)/);
  assert.doesNotMatch(source, /await projectionDerivative\(masterBytes\)/);
});

test("the six exact surface crops the proof QC judges are built from the repaired sheet", () => {
  assert.match(source, /const viewAuthorities = await buildViewAuthorities\(surfaceSourceBytes, manifest\);/);
  assert.doesNotMatch(source, /buildViewAuthorities\(masterBytes, manifest\)/);
});

test("the canonical master is still persisted unmodified and stays the lineage identity", () => {
  // The repair is a duplicate. The authored bytes are what the revision row
  // and every UI binding are keyed by, exactly as before.
  assert.match(source, /storagePath: masterStoragePath, bytes: masterBytes, contentType: "image\/png"/);
  assert.match(source, /master: \{\s*storagePath: row\.master_storage_path,/);
});

test("a panel's sourceMasterHash is the canonical master, so PanelPro can pair it with its proof", async () => {
  const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
  const sharp = runtimeRequire("sharp");
  const canvas = atlas.CANVAS;
  const surfaceSourceBytes = await sharp({
    create: { width: canvas.widthPx, height: canvas.heightPx, channels: 4, background: "#123456" },
  }).png().toBuffer();
  const canonicalMasterHash = "a".repeat(64);
  const manifest = {
    zones: atlas.SURFACE_KEYS.map((surfaceKey, index) => ({
      surfaceKey,
      trimWidthIn: 100, trimHeightIn: 50, printWidthIn: 110, printHeightIn: 60,
      surfaceSqFt: 34.7, effectivePpi: 20,
      extraction: { x: index * 200, y: 0, w: 180, h: 90, outputRotationDegrees: 0 },
    })),
  };

  const panels = await atlas.cutCallOnePanels(surfaceSourceBytes, manifest, canonicalMasterHash);
  assert.equal(panels.length, atlas.SURFACE_KEYS.length);
  for (const panel of panels) {
    // Lineage: what the proof also publishes. Pairing is done on this.
    assert.equal(panel.sourceMasterHash, canonicalMasterHash);
    // Provenance: which bytes the pixels were actually cut from.
    assert.equal(panel.surfaceSourceHash, sha256(surfaceSourceBytes));
  }

  // With no canonical hash supplied the panel falls back to its own source, so
  // a caller that forgets the argument never publishes an empty lineage.
  const orphaned = await atlas.cutCallOnePanels(surfaceSourceBytes, manifest);
  assert.equal(orphaned[0].sourceMasterHash, sha256(surfaceSourceBytes));
});

test("every consumer binds the surface authority to the surface source, not the master", () => {
  // flat-first-atlas: the identity gate the proof provider goes through.
  assert.match(source, /authority\.sourceMasterHash !== surfaceSourceHashOf\(atlas\)/);
  assert.match(source, /function surfaceSourceHashOf\(atlas\) \{/);
  // atlas-proof-qc: the judge's own staleness check.
  assert.match(proofQcSource, /atlas\?\.metadata\?\.panelSourceHash/);
  // designpanel-server-provider: the renderer refuses conditioning bytes that
  // are not the sheet this revision cut its surfaces from.
  assert.match(providerSource, /candidate\.sourceMasterHash !== identity\.surfaceSourceHash/);
  assert.match(providerSource, /surfaceSourceHash: String\(/);
  // generation-worker: what it publishes to the provider and re-asserts on the
  // accepted rows.
  assert.match(workerSource, /surfaceSourceHash: flatAtlas\.projection\.sourceMasterHash/);
  assert.match(workerSource, /authority\.projectionSourceMasterHash !== flatAtlas\.projection\.sourceMasterHash/);
});

test("a resumed revision recomputes the repair and refuses a drifted one", () => {
  // The repaired sheet is never stored -- `fillMasterCutouts` is deterministic,
  // so a resumed run rebuilds it. The recorded `panelSourceHash` is what proves
  // the rebuild is the same sheet the first pass used.
  assert.match(source, /const surfaceFill = await fillMasterCutouts\(/);
  assert.match(source, /flat_atlas_surface_source_mismatch/);
  assert.match(source, /const expectedProjection = await projectionDerivative\(surfaceSourceBytes\);/);
});
