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
  //
  // ⚠️ INVERTED 2026-08-31. This asserted the third argument was `masterHash`,
  // under the two-master model where the repaired sheet cut the panels while
  // the PRE-repair sheet stayed canonical. The owner retired that model: after
  // post-repair re-validation the repaired bytes ARE the accepted canonical
  // master, so the lineage argument is now `acceptedMasterHash`. On a clean run
  // the two are the same value; on a repaired one there is no longer a second
  // master for them to disagree about.
  assert.match(source, /cutCallOnePanels\(surfaceSourceBytes, manifest, acceptedMasterHash, \{/);
  assert.match(source, /projectionDerivative\(surfaceSourceBytes\)/);
  assert.doesNotMatch(source, /await projectionDerivative\(masterBytes\)/);
});

test("the six exact surface crops the proof QC judges are built from the repaired sheet", () => {
  // THE GUARANTEE IS UNCHANGED; THE SEAM MOVED ONE STEP CLOSER TO THE PANEL.
  //
  // The authorities used to be a SECOND crop of the repaired sheet, taken with
  // the same rects the panels use. They are now an encode OF THE PANELS, and
  // the panels are cut from `surfaceSourceBytes` -- so the proof half is still
  // conditioned on the repaired sheet and can no longer diverge from what the
  // customer buys, because there is one crop instead of two that agree
  // (owner 2026-08-27: "each proof uses its own extracted panel as immutable
  // artwork authority").
  assert.match(source, /await buildViewAuthorities\(authorityPanels\)/);
  // Same inversion as above: the lineage argument is the ACCEPTED master.
  assert.match(source, /cutCallOnePanels\(surfaceSourceBytes, manifest, acceptedMasterHash/);
  assert.doesNotMatch(source, /buildViewAuthorities\(masterBytes/);
  // And a resumed run re-cuts from the repaired sheet, never the authored one.
  assert.match(source, /await cutCallOnePanels\(surfaceSourceBytes, manifest, row\.master_content_hash\)/);
});

test("the ACCEPTED master is what persists and what every binding is keyed by", () => {
  // ⚠️ INVERTED 2026-08-31, AND THE TITLE CHANGED WITH IT.
  //
  // This asserted "the canonical master is still persisted unmodified" -- that
  // the PRE-repair authored bytes were what the revision row and every UI
  // binding were keyed by, with the repaired sheet living only as an unstored
  // duplicate. That is precisely the split the owner rejected: "A.T.L.A.S.
  // shown to humans = bad original, Panels/proof authority = repaired
  // derivative. That is not one canonical authority."
  //
  // What persists is now the sheet that PASSED structural re-validation. On a
  // clean master that is byte-identical to what this test used to assert,
  // because the fill returns the same buffer and the path is the same one.
  assert.match(source, /storagePath: acceptedMasterStoragePath, bytes: acceptedMasterBytes, contentType: "image\/png"/);
  assert.match(source, /master: \{\s*storagePath: row\.master_storage_path,/);
  // The pre-repair sheet is not lost -- it is recorded as provenance, and is
  // never again called the canonical or accepted master.
  assert.match(source, /preRepairMasterHash,/);
});

test("a panel's sourceMasterHash is the canonical master, so PanelPro can pair it with its proof", async () => {
  const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
  const sharp = runtimeRequire("sharp");
  const canvas = atlas.CANVAS;
  const surfaceSourceBytes = await sharp({
    create: { width: canvas.widthPx, height: canvas.heightPx, channels: 4, background: "#123456" },
  }).png().toBuffer();
  const canonicalMasterHash = "a".repeat(64);
  // `cutCallOnePanels` now refuses to cut without the GENIE manifest identity
  // that built the containers (owner 2026-08-27: "Fail closed if those
  // provenance fields are absent"), so the fixture states it.
  const manifest = {
    geometryResolution: {
      contract: "designpro.genie-manifest.v1",
      genieManifestId: "0".repeat(32),
      genieManifestHash: "0".repeat(64),
      state: "derived",
      derivationContract: "designpro.genie-front-derived.v1",
      derivedSurfaces: ["front"],
      geometrySourceRowId: "row-fixture",
      productionEligible: false,
      operatorValidated: false,
    },
    zones: atlas.SURFACE_KEYS.map((surfaceKey, index) => ({
      surfaceKey,
      trimWidthIn: 100, trimHeightIn: 50, printWidthIn: 110, printHeightIn: 60,
      surfaceSqFt: 34.7, effectivePpi: 20,
      extraction: { x: index * 200, y: 0, w: 180, h: 90, outputRotationDegrees: 0 },
    })),
  };

  const panelTimings = [];
  const panels = await atlas.cutCallOnePanels(surfaceSourceBytes, manifest, canonicalMasterHash, {
    onPanelTiming: (timing) => panelTimings.push(timing),
  });
  assert.equal(panels.length, atlas.SURFACE_KEYS.length);
  assert.deepEqual(panelTimings.map((timing) => timing.surfaceKey), atlas.PANEL_EXTRACTION_ORDER);
  assert.ok(panelTimings.every((timing) => timing.attempt === 1
    && Number.isInteger(timing.durationMs) && timing.durationMs >= 0));
  for (const panel of panels) {
    // Lineage: what the proof also publishes. Pairing is done on this.
    assert.equal(panel.sourceMasterHash, canonicalMasterHash);
    // Provenance: which bytes the pixels were actually cut from.
    assert.equal(panel.surfaceSourceHash, sha256(surfaceSourceBytes));
  }

  // With no canonical hash supplied the panel falls back to its own source, so
  // a caller that forgets the argument never publishes an empty lineage.
  const orphaned = await atlas.cutCallOnePanels(surfaceSourceBytes, manifest, undefined, {
    onPanelTiming() { throw new Error("timing observer is not authority"); },
  });
  assert.equal(orphaned[0].sourceMasterHash, sha256(surfaceSourceBytes));
});

test("every consumer binds the surface authority to the surface source, not the master", () => {
  // flat-first-atlas: the identity gate the proof provider goes through.
  assert.match(source, /authority\.sourceMasterHash !== surfaceSourceHashOf\(atlas\)/);
  assert.match(source, /function surfaceSourceHashOf\(atlas\) \{/);
  // atlas-proof-qc: the judge's own staleness check.
  assert.match(proofQcSource, /atlas\?\.metadata\?\.panelSourceHash/);
  // designpanel-server-provider: the renderer no longer receives conditioning
  // BYTES at all -- it sends the photographer a storage PATH -- so the
  // byte-level refusal it used to perform moved to the two ends of that
  // transport. What it must still do is resolve the panel through
  // `atlasPanelForProofView` (which reads the surface-source-derived record)
  // and hash-verify what comes back.
  assert.match(providerSource, /atlas\.panelFor\(sourceViewType\)/);
  assert.match(providerSource, /designpanel_atlas_proof_hash_mismatch/);
  // flat-first-atlas: the resolver that binds a shot to its own surface's panel
  // and to the master that panel names.
  assert.match(source, /function atlasPanelForProofView\(atlas, sourceViewType\)/);
  assert.match(source, /sourceMasterHash: String\(panel\.sourceMasterHash/);
  // and the photographer refuses a panel whose bytes are not the artifact named.
  const photographer = readFileSync(
    new URL("../supabase/functions/persona-photographer-render/index.ts", import.meta.url), "utf8",
  );
  assert.match(photographer, /atlas_proof_panel_hash_mismatch/);
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
