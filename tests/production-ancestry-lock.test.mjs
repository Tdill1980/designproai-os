// ⛔ EVERY PRODUCTION SURFACE'S ANCESTRY MUST RESOLVE TO atlas-call1.
//    ANY ANCESTRY CONTAINING A 3D PROOF MUST FAIL. (Trish 2026-08-29, step 6.)
//
// The fixtures below are not invented shapes. The "contaminated" ones are the
// exact metadata the pipeline wrote in production:
//
//   * `proofDerivedPanel` is the shape `panels.build`'s deleted fail-open arm
//     stamped from 2026-08-21 (commit 2eb62f3, #123) -- `ownSourceViewKey` and
//     `ownSourceViewSha256` joined 6/6 to `designpro_generation_views`, every
//     row produced by `persona-photographer-render`.
//
//   * `flatSurfaceProof` is the Call-8 receipt shape whose `surfaceFields`
//     carried `designpro.gemini-flat-surface.server.v4` -- six Gemini
//     flattenings of those same photographs.
//
// Both were correctly dimensioned by GENIE, correctly keyed, correctly hashed
// and correctly six. Every check the system had passed them. That is why this
// test asks the one question none of the others did.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ProvenanceError,
  assertPanelAncestry,
  assertProofSheetAncestry,
  assertRunProductionAncestry,
} = require("../runtime/production-provenance.cjs");

const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];
const MASTER = "a".repeat(64);
const panelHash = (index) => String(index).repeat(64).slice(0, 64);

function call1Panel(surfaceKey, index) {
  return {
    surfaceKey,
    metadata: {
      source: "atlas-call1-panel",
      promotedFrom: "atlas-call1",
      deterministic: true,
      sourceStoragePath: `designpro/user_x/gen/flat-first/v1/revisions/1/panels/${panelHash(index)}.png`,
      sourceContentHash: panelHash(index),
      sourceMasterHash: MASTER,
      trimWidthIn: 251, trimHeightIn: 60, printWidthIn: 261, printHeightIn: 70,
    },
  };
}

const legalPanels = () => SURFACES.map((key, index) => call1Panel(key, index + 1));
const acceptedPanels = () => SURFACES.map((key, index) => ({ surfaceKey: key, contentHash: panelHash(index + 1) }));

const legalProof = () => ({
  metadata: {
    role: "customer-2d-production-proof",
    producer: "designpro.call8-panel-proof.v4",
    deterministic: true,
    assembledFrom: "atlas-call1-panels",
    dimensionsAuthority: "genie-universal-panelizer",
    sourcePanelHashes: Object.fromEntries(SURFACES.map((key, index) => [key, panelHash(index + 1)])),
  },
});

test("the legal chain passes: master -> deterministic crop -> Call-1 panel", () => {
  const summary = assertRunProductionAncestry({
    panels: legalPanels(), proof: legalProof(), acceptedPanels: acceptedPanels(),
  });
  assert.equal(summary.ancestry, "atlas-call1");
  assert.equal(summary.panelCount, 6);
  assert.equal(summary.proofVerified, true);
});

test("a panel flattened from its 3D proof is refused, GENIE dimensions and all", () => {
  // The live shape, 2026-08-21 through 2026-08-29.
  const proofDerivedPanel = {
    surfaceKey: "driver",
    metadata: {
      call: 9,
      sourceRule: "one-own-surface-region-per-output-side",
      extractionContract: "designpro.server-grid-slice.v1",
      step: "gridslice",
      deterministic: true,
      ownSourceViewKey: "driver",
      ownSourceViewSha256: "f".repeat(64),
      sourceFieldHash: "e".repeat(64),
      trimWidthInches: 251, trimHeightInches: 60,
      bleed: { top: 5, right: 5, bottom: 5, left: 5 },
      dpi: 1500,
    },
  };
  // It is refused on the POSITIVE evidence first -- there is no atlas-call1
  // anywhere in its ancestry -- which is the check a pure blocklist would miss.
  assert.throws(() => assertPanelAncestry(proofDerivedPanel), (error) => {
    assert.ok(error instanceof ProvenanceError);
    assert.equal(error.code, "production_ancestry_not_atlas_call1");
    return true;
  });
});

test("a 3D-proof marker is refused even on an otherwise perfect Call-1 panel", () => {
  // The negative sweep, tested where the positive evidence cannot help: an
  // artifact that declares atlas-call1 correctly but still carries a view
  // binding is a panel someone re-derived from a photograph and re-labelled.
  for (const contamination of [
    { ownSourceViewKey: "driver" },
    { ownSourceViewSha256: "f".repeat(64) },
    { sourceFieldPath: "designpro/user_x/run/proof-masters/raw/driver.png" },
    { shotKey: "passenger-side" },
    { viewKey: "closeup" },
    { producer: "persona-photographer-render" },
    { extractionContract: "designpro.gemini-flat-surface.server.v4" },
    { note: "reproduced from the call7-proof-region-v1 vault entry" },
  ]) {
    const panel = call1Panel("driver", 1);
    Object.assign(panel.metadata, contamination);
    assert.throws(
      () => assertPanelAncestry(panel),
      (error) => error.code === "production_ancestry_contains_3d_proof",
      `${Object.keys(contamination)[0]} must refuse the panel`,
    );
  }
});

test("a nested 3D-proof marker is found, not only a top-level one", () => {
  const panel = call1Panel("hood", 3);
  panel.metadata.lineage = { upstream: [{ producer: "persona-photographer-render" }] };
  assert.throws(
    () => assertPanelAncestry(panel),
    (error) => error.code === "production_ancestry_contains_3d_proof",
  );
});

test("a panel missing its positive evidence is refused, not assumed clean", () => {
  for (const [field, code] of [
    ["source", "production_ancestry_not_atlas_call1"],
    ["promotedFrom", "production_ancestry_not_atlas_call1"],
    ["deterministic", "production_ancestry_not_deterministic"],
    ["sourceStoragePath", "production_ancestry_incomplete"],
    ["sourceContentHash", "production_ancestry_incomplete"],
    ["sourceMasterHash", "production_ancestry_incomplete"],
  ]) {
    const panel = call1Panel("roof", 4);
    delete panel.metadata[field];
    assert.throws(
      () => assertPanelAncestry(panel),
      (error) => error.code === code,
      `a panel with no ${field} must be refused with ${code}`,
    );
  }
});

test("a proof sheet composed from the 3D proofs is refused", () => {
  // The Call-8 shape before 2026-08-29: seven photographs laid out under the
  // heading "2D Production Proof", with the flattened fields recorded beside
  // them. It declares no panel ancestry at all.
  const flatSurfaceProof = {
    metadata: {
      role: "customer-2d-production-proof",
      contract: "designpro.call8-2d-production-proof.v1",
      imageModel: "gemini-3-pro-image",
      dimensionsAuthority: "genie-universal-panelizer",
      totalSqFt: 412.5,
    },
  };
  assert.throws(
    () => assertProofSheetAncestry(flatSurfaceProof),
    (error) => error.code === "production_ancestry_not_atlas_call1",
  );
});

test("a proof sheet must name six distinct panels behind its six tiles", () => {
  const sameTwice = legalProof();
  sameTwice.metadata.sourcePanelHashes.passenger = sameTwice.metadata.sourcePanelHashes.driver;
  assert.throws(
    () => assertProofSheetAncestry(sameTwice),
    (error) => error.code === "production_ancestry_incomplete",
  );

  const short = legalProof();
  delete short.metadata.sourcePanelHashes.rear;
  assert.throws(
    () => assertProofSheetAncestry(short),
    (error) => error.code === "production_ancestry_incomplete",
  );
});

test("declaring atlas-call1 is not enough — it must be THIS revision's panel", () => {
  // A panel with impeccable metadata naming a Call-1 panel from another
  // revision is a different design, correctly labelled. The run-level check is
  // what catches it, because nothing about the panel alone is wrong.
  const panels = legalPanels();
  panels[0].metadata.sourceContentHash = "9".repeat(64);
  assert.throws(
    () => assertRunProductionAncestry({ panels, proof: legalProof(), acceptedPanels: acceptedPanels() }),
    (error) => error.code === "production_ancestry_not_this_revision",
  );
});

test("source.verify runs this gate before anything is upscaled, packed or delivered", async () => {
  const { readFile } = await import("node:fs/promises");
  const claimant = await readFile(new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
  const stage = claimant.slice(
    claimant.indexOf('stage.stage_key === "source.verify"'),
    claimant.indexOf('stage.stage_key === "await_panelpro_preflight_qc"'),
  );
  assert.ok(stage.length > 0, "the source.verify stage must still be findable");
  assert.match(stage, /assertRunProductionAncestry\(\{/);
  assert.match(stage, /acceptedPanels: await callOnePanelSet\(sb, run\)/);
  // Before the copy that hands the artifacts to the paid half.
  assert.ok(
    stage.indexOf("assertRunProductionAncestry({") < stage.indexOf("copyPinnedSourceArtifact("),
    "the ancestry gate must run before any artifact is copied into the production run",
  );
  // And it is a hard refusal, never a recorded note.
  assert.match(stage, /throw new StageError\(\s*String\(error\?\.code \|\| "production_ancestry_invalid"\)/);
});
