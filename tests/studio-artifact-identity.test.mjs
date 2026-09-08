import test from "node:test";
import assert from "node:assert/strict";
import {
  artifactBelongsToRevision,
  artifactsForStudioRevision,
  callOnePanelBelongsToRevision,
  panelReviewState,
  selectAtlasRevision,
  selectSurfaceView,
  viewBelongsToRevision,
} from "../app/src/lib/studio-artifact-identity.mjs";
import {
  panelOutputPreviews,
  panelOutputProgress,
  panelOutputSafeReviewUrl,
  panelOutputStageCopy,
} from "../app/src/lib/panelpro-file-output-view.mjs";

const master = "a".repeat(64);
const revision = {
  id: "atlas-revision-2",
  generationId: "generation",
  revisionSequence: 2,
  master: { contentHash: master },
  callOnePanels: ["driver", "passenger", "hood", "roof", "front", "rear"].map(
    (surfaceKey, i) => ({
      surfaceKey,
      sourceMasterHash: master,
      contentHash: String(i + 1).repeat(64),
    }),
  ),
};
const driver = {
  generationId: "generation",
  surfaceKey: "driver",
  sourceViewType: "side",
  signedUrl: "https://example.test/driver",
  contentHash: "b".repeat(64),
  atlasBinding: { masterContentHash: master, revisionId: revision.id },
};

test("selected revision is exact; unsorted history and absent IDs never select another revision", () => {
  const old = { ...revision, id: "old", revisionSequence: 1 };
  assert.equal(selectAtlasRevision([revision, old]), revision);
  assert.equal(selectAtlasRevision([revision, old], "old"), old);
  assert.equal(selectAtlasRevision([revision, old], "missing"), null);
});
test("proof selection requires its own surface, exact camera, generation and revision", () => {
  assert.equal(selectSurfaceView([driver], "driver", "side", revision), driver);
  assert.equal(
    selectSurfaceView([driver], "passenger", "passenger-side", revision),
    null,
  );
  assert.equal(
    selectSurfaceView(
      [{ ...driver, sourceViewType: "closeup" }],
      "driver",
      "side",
      revision,
    ),
    null,
  );
  assert.equal(
    viewBelongsToRevision({ ...driver, generationId: "other" }, revision),
    false,
  );
  assert.equal(
    viewBelongsToRevision(
      {
        ...driver,
        atlasBinding: { ...driver.atlasBinding, revisionId: "old" },
      },
      revision,
    ),
    false,
  );
  assert.equal(
    viewBelongsToRevision({ ...driver, atlasBinding: null }, revision),
    false,
  );
  assert.equal(
    selectSurfaceView(
      [driver, { ...driver, contentHash: "c".repeat(64) }],
      "driver",
      "side",
      revision,
    ),
    null,
  );
});
test("unbound historical artwork cannot occupy an ATLAS version's production panel", () => {
  assert.equal(artifactBelongsToRevision({ metadata: {} }, revision), false);
  assert.equal(
    artifactBelongsToRevision(
      { metadata: { sourceMasterHash: "d".repeat(64) } },
      revision,
    ),
    false,
  );
  assert.equal(
    artifactBelongsToRevision(
      {
        metadata: {
          sourceMasterHash: master,
          revisionId: "manufacturing-revision",
        },
      },
      revision,
    ),
    true,
  );
  assert.equal(
    callOnePanelBelongsToRevision(
      { sourceMasterHash: "d".repeat(64) },
      revision,
    ),
    false,
  );
});
test("Call 8's six exact panel hashes prove its revision even on older proof metadata", () => {
  const metadata = {
    role: "customer-2d-production-proof",
    sourcePanelHashes: Object.fromEntries(
      revision.callOnePanels.map((panel) => [
        panel.surfaceKey,
        panel.contentHash,
      ]),
    ),
  };
  assert.equal(artifactBelongsToRevision({ metadata }, revision), true);
  assert.equal(
    artifactBelongsToRevision(
      {
        metadata: {
          ...metadata,
          sourcePanelHashes: {
            ...metadata.sourcePanelHashes,
            rear: "9".repeat(64),
          },
        },
      },
      revision,
    ),
    false,
  );
});

test("unbound old output receipts require the same immutable run and a full six-panel lineage proof", () => {
  const panels = revision.callOnePanels.map((panel) => ({
    ...panel,
    id: panel.surfaceKey,
    kind: "panel",
    runId: "run-2",
    metadata: { sourceMasterHash: master, promotedFrom: "atlas-call1" },
  }));
  const zip = { id: "zip", kind: "zip", runId: "run-2", metadata: {} };
  const foreign = { ...zip, id: "foreign", runId: "run-1" };
  const unboundPanel = { ...panels[0], id: "unbound-panel", metadata: {} };
  const selected = artifactsForStudioRevision(
    [...panels, zip, foreign, unboundPanel],
    revision,
  );
  assert.equal(selected.includes(zip), true);
  assert.equal(selected.includes(foreign), false);
  assert.equal(selected.includes(unboundPanel), false);
  assert.equal(
    artifactsForStudioRevision([...panels.slice(1), zip], revision).includes(
      zip,
    ),
    false,
  );
});
test("a promoted artifact is inspectable but never inherits QC approval from its presence", () => {
  const panel = {
    surfaceKey: "driver",
    metadata: { promotedFrom: "atlas-call1" },
  };
  assert.equal(panelReviewState({ panel, revision }).approved, false);
  assert.equal(
    panelReviewState({ panel, revision, humanApproved: true }).approved,
    true,
  );
  assert.equal(
    panelReviewState({
      panel,
      revision: { ...revision, qc: { masterCutoutSurfaces: ["driver"] } },
      humanApproved: true,
    }).state,
    "needs_correction",
  );
});
test("PPO reports measured stage completion and never displays private templates or raw narration", () => {
  assert.deepEqual(panelOutputProgress([]), {
    complete: 0,
    total: 0,
    percent: null,
  });
  assert.equal(
    panelOutputProgress([{ state: "complete" }, { state: "waiting" }]).percent,
    50,
  );
  assert.equal(
    panelOutputStageCopy("SECRET_PROVIDER_PROMPT").join(" ").includes("SECRET"),
    false,
  );
  const preview = {
    role: "template-overlay",
    approvedDisplay: true,
    geometryValidated: true,
    provenance: "generated-branded",
    contentHash: master,
    profileHash: master,
    signedUrl: "https://example.test/overlay.png",
  };
  assert.equal(panelOutputPreviews([preview]).length, 1);
  for (const mutation of [
    { approvedDisplay: false },
    { geometryValidated: false },
    { provenance: "private-dropbox-template" },
    { signedUrl: "designpro://proof/id" },
    { role: "private-template" },
  ])
    assert.equal(panelOutputPreviews([{ ...preview, ...mutation }]).length, 0);
  assert.equal(
    panelOutputSafeReviewUrl("https://attacker.test", "generation"),
    "/designpro/jobs/generation/panelpro",
  );
});
