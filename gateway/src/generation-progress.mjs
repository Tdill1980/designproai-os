/**
 * Customer-safe projection of the existing generation OS snapshot.
 * This reads evidence; it never schedules, completes or repairs a stage. Raw
 * provider output, private paths, prompts and verification prose never cross
 * this boundary. Snapshot authorization remains the gateway/RPC's job.
 */
const HASH = /^[a-f0-9]{64}$/i;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];
const WORKFLOW_TYPES = ["designpro.entice_pack", "designpro.production_pack"];
const COPY = Object.freeze({
  "revision.freeze": [
    "Design saved",
    "Saving the selected design for production.",
  ],
  "manifest.resolve": [
    "Panel dimensions",
    "Confirming the checked dimensions needed for your panels.",
  ],
  "source.verify": [
    "Artwork check",
    "Checking that the artwork matches this design.",
  ],
  "panels.build": ["Panel artwork", "Preparing the artwork for each section."],
  "logos.extract": [
    "Design assets",
    "Saving the logos and available design assets.",
  ],
  "panels.delogo": [
    "Review copies",
    "Preparing separate copies for the design team to check.",
  ],
  "proof.build": [
    "Production proof",
    "Creating the panel proof with checked dimensions and bleed.",
  ],
  "pack.verify": [
    "Asset check",
    "Checking that the required design files are present.",
  ],
  "pack.activate": [
    "Design package",
    "Preparing the design package for the next step.",
  ],
  await_purchase: [
    "Production access",
    "Waiting for production access to be confirmed.",
  ],
  await_panelpro_preflight_qc: [
    "Template review",
    "The design team checks fit and important artwork placement.",
  ],
  "enhance.upscale": [
    "Print detail",
    "Preparing the image detail needed at print size.",
  ],
  "output.build": ["Print files", "Creating the individual production files."],
  "output.verify": [
    "File checks",
    "Checking the dimensions and integrity of the exported files.",
  ],
  "proofs.verify": [
    "Vehicle proof check",
    "Checking that all seven vehicle proofs match this design.",
  ],
  "views.verify": [
    "Vehicle proof check",
    "Checking that all seven vehicle proofs match this design.",
  ],
  await_final_human_qc: [
    "Final review",
    "The design team reviews the completed production files.",
  ],
  "stamp.build": [
    "Approved proofs",
    "Preparing approval marks for the reviewed proofs.",
  ],
  "zip.build": [
    "Download package",
    "Putting the checked files into the download package.",
  ],
  "wrapbox.deliver": [
    "WrapBox",
    "Making the completed package available in WrapBox.",
  ],
});
const rows = (value) => (Array.isArray(value) ? value : []);
const id = (value) => (ID.test(String(value || "")) ? String(value) : null);
const hash = (value) =>
  HASH.test(String(value || "")) ? String(value).toLowerCase() : null;
const iso = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : null;

function publicState(stage) {
  if (
    stage?.verification?.deferred === true ||
    stage?.verification?.verified === false
  )
    return "attention";
  const states = {
    completed: "complete",
    complete: "complete",
    pending: "pending",
    queued: "pending",
    running: "running",
    waiting: "waiting",
    retryable: "retrying",
    failed: "failed",
    cancelled: "cancelled",
    skipped: "skipped",
  };
  return Object.hasOwn(states, stage?.state) ? states[stage.state] : "pending";
}

/** An old completed run cannot describe the current authoring revision. */
function runMatchesRevision(run, artifacts, revision) {
  const selected = hash(revision?.masterContentHash);
  if (!selected) return false;
  const declared = hash(run.sourceMasterHash);
  const masters = new Set(
    artifacts
      .map((row) => hash(row.metadata?.sourceMasterHash))
      .filter(Boolean),
  );
  if (declared) masters.add(declared);
  if (masters.size !== 1 || !masters.has(selected)) return false;
  if (run.atlasRevisionId && run.atlasRevisionId !== revision.revisionId)
    return false;
  // The gateway may enrich a run with the unanimous six-panel source binding
  // from its immutable revision_sources snapshot, before any output exists.
  if (declared) return true;
  const panels = new Set(
    artifacts
      .filter(
        (row) =>
          row.artifactKind === "panel" &&
          hash(row.metadata?.sourceMasterHash) === selected,
      )
      .map((row) => row.surfaceKey),
  );
  return SURFACES.every((surface) => panels.has(surface));
}

export function publicGenerationProgress(snapshot) {
  const value = snapshot && typeof snapshot === "object" ? snapshot : {};
  if (
    value.contract !== "designpro.generation-os.v1" ||
    !id(value.generationId)
  ) {
    throw new Error("generation_progress_snapshot_invalid");
  }
  const revision =
    rows(value.revisions).find(
      (row) => row.revisionId === value.currentRevisionId,
    ) || null;
  const masterSaved = Boolean(revision && hash(revision.masterContentHash));
  const generationState = [
    "queued",
    "leased",
    "retryable",
    "outputs_ready",
    "failed",
    "cancelled",
  ].includes(value.requestState)
    ? value.requestState
    : "unknown";
  const generationExecutionState =
    {
      queued: "pending",
      leased: "running",
      retryable: "retrying",
      outputs_ready: "complete",
      failed: "failed",
      cancelled: "cancelled",
    }[generationState] || "pending";
  const stages = [
    {
      key: "generation.artwork",
      label: "ATLAS artwork",
      explanation: masterSaved
        ? "Your ATLAS artwork has been saved. Vehicle proofs and production checks continue separately."
        : "Creating your artwork for the six vehicle surfaces.",
      state: masterSaved
        ? "complete"
        : generationExecutionState === "complete"
          ? "attention"
          : generationExecutionState,
      dependsOn: [],
    },
    {
      key: "generation.proofs",
      label: "Vehicle proofs",
      explanation:
        generationState === "outputs_ready"
          ? "The generation request has saved its vehicle proofs. Available angles appear below."
          : "Creating the vehicle views from your saved artwork. Each available angle appears below.",
      state:
        !masterSaved &&
        !["failed", "cancelled"].includes(generationExecutionState)
          ? "pending"
          : generationExecutionState,
      dependsOn: ["generation.artwork"],
    },
  ];
  const handoffNeedsAttention = Boolean(value.revisionHandoffError);
  if (handoffNeedsAttention) stages.push({
    key: "generation.handoff",
    label: "Production preparation",
    explanation: "Your revised artwork and vehicle proofs are saved. Production preparation needs attention before it can continue.",
    state: "attention",
    dependsOn: ["generation.proofs"],
  });

  const allArtifacts = rows(value.artifacts);
  const matched = rows(value.workflowRuns).filter(
    (run) =>
      id(run.runId) &&
      WORKFLOW_TYPES.includes(run.workflowType) &&
      runMatchesRevision(
        run,
        allArtifacts.filter((artifact) => artifact.runId === run.runId),
        revision,
      ),
  );
  // There can be retries of a whole immutable workflow. Report the current run
  // for each workflow type, rather than mixing old successful stages into it.
  const currentRuns = WORKFLOW_TYPES.flatMap((type) => {
    const candidates = matched
      .filter((run) => run.workflowType === type)
      .sort(
        (a, b) =>
          (Date.parse(b.createdAt || "") || 0) -
            (Date.parse(a.createdAt || "") || 0) ||
          String(b.runId).localeCompare(String(a.runId)),
      );
    return candidates.length ? [candidates[0]] : [];
  });
  const runIds = new Set(currentRuns.map((run) => run.runId));
  const artifacts = allArtifacts.filter(
    (artifact) =>
      runIds.has(artifact.runId) &&
      id(artifact.artifactId) &&
      hash(artifact.contentHash),
  );
  const proofReady = artifacts.some(
    (artifact) =>
      artifact.artifactKind === "flat-proof" &&
      artifact.metadata?.role === "customer-2d-production-proof",
  );
  for (const run of currentRuns) {
    const runStages = rows(run.stages)
      .filter((stage) => Object.hasOwn(COPY, stage.stageKey))
      .sort(
        (a, b) =>
          Number(a.sequence || 0) - Number(b.sequence || 0) ||
          a.stageKey.localeCompare(b.stageKey),
      );
    for (const stage of runStages) {
      let state = publicState(stage);
      // Historical Call 8 could complete after deferring its proof. A finished
      // stage without that actual artifact must not be presented as a proof.
      if (
        stage.stageKey === "proof.build" &&
        state === "complete" &&
        !artifacts.some(
          (artifact) =>
            artifact.runId === run.runId &&
            artifact.artifactKind === "flat-proof" &&
            artifact.metadata?.role === "customer-2d-production-proof",
        )
      )
        state = "attention";
      stages.push({
        key: `${run.runId}:${stage.stageKey}`,
        label: COPY[stage.stageKey][0],
        explanation: COPY[stage.stageKey][1],
        state,
        dependsOn: Array.isArray(stage.dependsOn)
          ? stage.dependsOn
              .filter((key) => Object.hasOwn(COPY, key))
              .map((key) => `${run.runId}:${key}`)
          : null,
      });
    }
  }
  const production = currentRuns.find(
    (run) => run.workflowType === "designpro.production_pack",
  );
  const finished = (key) =>
    rows(production?.stages).some(
      (stage) => stage.stageKey === key && publicState(stage) === "complete",
    );
  const packageReady =
    finished("await_final_human_qc") &&
    finished("zip.build") &&
    artifacts.some(
      (artifact) =>
        artifact.runId === production?.runId && artifact.artifactKind === "zip",
    );
  const panelCount = new Set(
    artifacts
      .filter(
        (artifact) =>
          artifact.artifactKind === "panel" &&
          SURFACES.includes(artifact.surfaceKey),
      )
      .map((artifact) => artifact.surfaceKey),
  ).size;
  const updated =
    [iso(value.updatedAt), ...currentRuns.map((run) => iso(run.updatedAt))]
      .filter(Boolean)
      .sort()
      .pop() || null;
  return {
    contract: "designpro.public-generation-progress.v1",
    generationId: id(value.generationId),
    currentRevisionId: id(revision?.revisionId),
    revisionSequence: Number.isInteger(revision?.revisionSequence)
      ? revision.revisionSequence
      : null,
    generationState,
    stages,
    artifactIds: artifacts.map((artifact) => artifact.artifactId),
    workflowRevisionIds: [
      ...new Set(currentRuns.map((run) => id(run.revisionId)).filter(Boolean)),
    ],
    facts: {
      masterSaved,
      productionRunLinked: currentRuns.length > 0,
      handoffNeedsAttention,
      panelCount,
      productionProofReady: proofReady,
      packageReady,
    },
    updatedAt: updated,
  };
}
