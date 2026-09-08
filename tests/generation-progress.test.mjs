import test from "node:test";
import assert from "node:assert/strict";
import { publicGenerationProgress } from "../gateway/src/generation-progress.mjs";

const master = "a".repeat(64);
const oldMaster = "b".repeat(64);
const surfaces = ["driver", "passenger", "hood", "roof", "front", "rear"];
const stage = (stageKey, state, sequence = 1, dependsOn = []) => ({
  stageKey,
  state,
  sequence,
  dependsOn,
});
const run = (extra = {}) => ({
  runId: "run-current",
  revisionId: "manufacturing-current",
  workflowType: "designpro.entice_pack",
  sourceMasterHash: master,
  createdAt: "2026-09-08T10:00:00Z",
  stages: [],
  ...extra,
});
const snapshot = (extra = {}) => ({
  contract: "designpro.generation-os.v1",
  generationId: "generation-existing",
  requestState: "leased",
  currentRevisionId: "atlas-current",
  currentRevisionSequence: 2,
  revisions: [
    {
      revisionId: "atlas-current",
      revisionSequence: 2,
      masterContentHash: master,
    },
    {
      revisionId: "atlas-old",
      revisionSequence: 1,
      masterContentHash: oldMaster,
    },
  ],
  workflowRuns: [],
  artifacts: [],
  receipts: [],
  events: [],
  updatedAt: "2026-09-08T10:00:00Z",
  ...extra,
});
const artifact = (artifactId, artifactKind, extra = {}) => ({
  artifactId,
  artifactKind,
  runId: "run-current",
  contentHash: "c".repeat(64),
  metadata: {},
  ...extra,
});

test("generation progress exists before production handoff and master presence does not finish proofs", () => {
  const queued = publicGenerationProgress(
    snapshot({
      requestState: "queued",
      revisions: [],
      currentRevisionId: null,
    }),
  );
  assert.equal(queued.stages[0].state, "pending");
  assert.equal(queued.stages[1].state, "pending");
  assert.equal(queued.facts.productionRunLinked, false);
  const saved = publicGenerationProgress(snapshot());
  assert.equal(saved.stages[0].state, "complete");
  assert.equal(saved.stages[1].state, "running");
  assert.equal(saved.facts.packageReady, false);
  assert.equal(saved.facts.panelCount, 0);
  const refused = publicGenerationProgress(
    snapshot({ requestState: "failed" }),
  );
  assert.equal(refused.stages[0].state, "complete");
  assert.equal(refused.stages[1].state, "failed");
  assert.throws(() => publicGenerationProgress({}), /snapshot_invalid/);
});

test("revision handoff failure is visible without leaking its private database error", () => {
  const value = snapshot({requestState:"outputs_ready",revisionHandoffError:"private-sql-payload"});
  const blocked = publicGenerationProgress(value);
  assert.equal(blocked.facts.handoffNeedsAttention,true);
  assert.equal(blocked.stages.find(stage=>stage.key==="generation.handoff").state,"attention");
  assert.equal(blocked.facts.packageReady,false);
  assert.doesNotMatch(JSON.stringify(blocked),/private-sql-payload/);
  const recovered = publicGenerationProgress({...value,revisionHandoffError:null});
  assert.equal(recovered.facts.handoffNeedsAttention,false);
  assert.equal(recovered.stages.some(stage=>stage.key==="generation.handoff"),false);
});

test("immutable current-master binding reports parallel stages before their first artifacts", () => {
  const result = publicGenerationProgress(
    snapshot({
      workflowRuns: [
        run({
          stages: [
            stage("revision.freeze", "completed"),
            stage("panels.build", "running", 2, ["revision.freeze"]),
            stage("logos.extract", "running", 2, ["revision.freeze"]),
            stage("manifest.resolve", "waiting", 3, []),
            stage("await_final_human_qc", "pending", 9, ["output.verify"]),
          ],
        }),
        run({
          runId: "old-run",
          revisionId: "manufacturing-old",
          sourceMasterHash: oldMaster,
          createdAt: "2026-09-08T11:00:00Z",
          stages: [stage("zip.build", "completed")],
        }),
      ],
    }),
  );
  assert.equal(result.facts.productionRunLinked, true);
  assert.deepEqual(result.workflowRevisionIds, ["manufacturing-current"]);
  assert.equal(
    result.stages.filter((row) => row.state === "running").length,
    3,
  );
  assert.deepEqual(
    result.stages.find((row) => row.key.endsWith(":logos.extract")).dependsOn,
    ["run-current:revision.freeze"],
  );
  assert.equal(
    result.stages.find((row) => row.key.endsWith(":manifest.resolve")).state,
    "waiting",
  );
  assert.equal(
    result.stages.find((row) => row.key.endsWith(":await_final_human_qc"))
      .state,
    "pending",
  );
  assert.equal(
    result.stages.some((row) => row.key.startsWith("old-run:")),
    false,
  );
});

test("legacy run linkage needs all six positively bound panels, never timestamps or one matching side", () => {
  const panels = surfaces.map((surface) =>
    artifact(`panel-${surface}`, "panel", {
      surfaceKey: surface,
      metadata: { sourceMasterHash: master },
    }),
  );
  const value = snapshot({
    workflowRuns: [
      run({
        sourceMasterHash: undefined,
        stages: [stage("panels.build", "completed")],
      }),
    ],
    artifacts: panels.slice(0, 5),
  });
  assert.equal(
    publicGenerationProgress(value).facts.productionRunLinked,
    false,
  );
  const linked = publicGenerationProgress({ ...value, artifacts: panels });
  assert.equal(linked.facts.panelCount, 6);
  assert.deepEqual(
    linked.artifactIds,
    panels.map((row) => row.artifactId),
  );
  assert.equal(linked.facts.packageReady, false);
  assert.equal(
    publicGenerationProgress({
      ...value,
      artifacts: [
        ...panels,
        artifact("conflict", "panel", {
          surfaceKey: "driver",
          metadata: { sourceMasterHash: oldMaster },
        }),
      ],
    }).facts.productionRunLinked,
    false,
  );
});

test("a historical deferred Call 8 never appears complete without the real dimensioned proof", () => {
  const value = snapshot({
    workflowRuns: [run({ stages: [stage("proof.build", "completed")] })],
  });
  const deferred = publicGenerationProgress(value);
  assert.equal(
    deferred.stages.find((row) => row.key.endsWith(":proof.build")).state,
    "attention",
  );
  assert.equal(deferred.facts.productionProofReady, false);
  const completed = publicGenerationProgress({
    ...value,
    artifacts: [
      artifact("proof", "flat-proof", {
        metadata: { role: "customer-2d-production-proof" },
      }),
    ],
  });
  assert.equal(
    completed.stages.find((row) => row.key.endsWith(":proof.build")).state,
    "complete",
  );
  assert.equal(completed.facts.productionProofReady, true);
});

test("ZIP existence cannot bypass the completed final human review and package stage", () => {
  const value = snapshot({
    workflowRuns: [
      run({
        workflowType: "designpro.production_pack",
        stages: [
          stage("await_final_human_qc", "waiting"),
          stage("zip.build", "completed"),
        ],
      }),
    ],
    artifacts: [artifact("zip-current", "zip")],
  });
  assert.equal(publicGenerationProgress(value).facts.packageReady, false);
  value.workflowRuns[0].stages[0].state = "completed";
  assert.equal(publicGenerationProgress(value).facts.packageReady, true);
  value.workflowRuns[0].stages[0].verification = { verified: false };
  assert.equal(publicGenerationProgress(value).facts.packageReady, false);
});

test("customer projection drops arbitrary payloads, provider prose, paths, hashes and unrecognized stages", () => {
  const marker = "PRIVATE_PROMPT_OR_TEMPLATE_PATH";
  const result = publicGenerationProgress(
    snapshot({
      phase: "complete",
      privatePath: marker,
      workflowRuns: [
        run({
          stages: [
            {
              ...stage("manifest.resolve", "waiting"),
              waitReason: marker,
              errorCode: marker,
              label: marker,
              explanation: marker,
              verification: { reasoning: marker },
            },
            stage(marker, "completed"),
            stage("source.verify", "__proto__"),
          ],
        }),
      ],
      artifacts: [
        artifact("proof", "flat-proof", {
          storagePath: marker,
          metadata: {
            role: "customer-2d-production-proof",
            sourceMasterHash: master,
            prompt: marker,
          },
        }),
      ],
      events: [
        {
          eventType: marker,
          state: marker,
          payload: { thoughtSignature: marker },
        },
      ],
    }),
  );
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.equal(JSON.stringify(result).includes(master), false);
  assert.equal(
    result.stages.find((row) => row.key.endsWith(":source.verify")).state,
    "pending",
  );
  assert.equal(result.facts.packageReady, false);
});

test("a newer bound run does not inherit completion or artifact availability from an older retry", () => {
  const result = publicGenerationProgress(
    snapshot({
      workflowRuns: [
        run({ runId: "run-old", stages: [stage("panels.build", "completed")] }),
        run({
          createdAt: "2026-09-08T11:00:00Z",
          stages: [stage("panels.build", "pending")],
        }),
      ],
      artifacts: [
        artifact("old-panel", "panel", {
          runId: "run-old",
          surfaceKey: "driver",
          metadata: { sourceMasterHash: master },
        }),
      ],
    }),
  );
  assert.equal(
    result.stages.find((row) => row.key.endsWith(":panels.build")).state,
    "pending",
  );
  assert.deepEqual(result.artifactIds, []);
});
