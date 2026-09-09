/** Identity checks shared by the two studios. These select stored bytes only. */
const hash = (value) =>
  /^[a-f0-9]{64}$/i.test(String(value || ""))
    ? String(value).toLowerCase()
    : "";

export function selectAtlasRevision(revisions, revisionId) {
  const rows = Array.isArray(revisions) ? revisions : [];
  if (revisionId) return rows.find((row) => row.id === revisionId) || null;
  return (
    [...rows].sort(
      (a, b) => Number(b.revisionSequence) - Number(a.revisionSequence),
    )[0] || null
  );
}

export function viewBelongsToRevision(view, revision) {
  if (!revision) return !view?.atlasBinding?.masterContentHash;
  return (
    view?.generationId === revision.generationId &&
    hash(view?.atlasBinding?.masterContentHash) !== "" &&
    hash(view.atlasBinding.masterContentHash) ===
      hash(revision.master?.contentHash) &&
    (!view.atlasBinding.revisionId ||
      view.atlasBinding.revisionId === revision.id)
  );
}

export function artifactBelongsToRevision(artifact, revision) {
  const metadata = artifact?.metadata || {};
  if (!revision) return !metadata.sourceMasterHash;
  if (artifact?.kind === "panel" && metadata.promotedFrom === "atlas-call1") {
    const source = (revision.callOnePanels || []).find(
      (panel) => panel.surfaceKey === artifact.surfaceKey,
    );
    if (
      !source ||
      hash(source.contentHash) === "" ||
      hash(source.contentHash) !== hash(artifact.contentHash)
    )
      return false;
  }
  if (
    !metadata.sourceMasterHash &&
    metadata.role === "customer-2d-production-proof"
  ) {
    // Older Call 8 receipts bind the exact six input panel hashes, rather than
    // the master directly. That is usable evidence; an unbound URL is not.
    const panels = revision.callOnePanels || [];
    const sources = metadata.sourcePanelHashes || {};
    return (
      panels.length === 6 &&
      Object.keys(sources).length === 6 &&
      panels.every(
        (panel) =>
          hash(sources[panel.surfaceKey]) !== "" &&
          hash(sources[panel.surfaceKey]) === hash(panel.contentHash),
      )
    );
  }
  // metadata.revisionId is the manufacturing revision, a separate existing ID.
  // atlasRevisionId, when provided, is the authoring revision.
  return (
    hash(metadata.sourceMasterHash) !== "" &&
    hash(metadata.sourceMasterHash) === hash(revision.master?.contentHash) &&
    (!metadata.atlasRevisionId || metadata.atlasRevisionId === revision.id)
  );
}

export function callOnePanelBelongsToRevision(panel, revision) {
  return (
    hash(panel?.sourceMasterHash) !== "" &&
    hash(panel.sourceMasterHash) === hash(revision?.master?.contentHash)
  );
}

/**
 * Older output receipts omit a master hash. Their immutable workflow run can
 * establish membership only when all six own-side panels prove this master.
 * Never use this route for an unbound production panel or a conflicting proof.
 */
export function artifactsForStudioRevision(artifacts, revision) {
  if (!revision) return [...artifacts];
  const byRun = new Map();
  for (const artifact of artifacts) {
    if (!artifact.runId) continue;
    const rows = byRun.get(artifact.runId) || [];
    rows.push(artifact);
    byRun.set(artifact.runId, rows);
  }
  const provedRuns = new Set();
  for (const [runId, rows] of byRun) {
    const masters = new Set(
      rows.map((row) => hash(row.metadata?.sourceMasterHash)).filter(Boolean),
    );
    const surfaces = new Set(
      rows
        .filter(
          (row) =>
            row.kind === "panel" && artifactBelongsToRevision(row, revision),
        )
        .map((row) => row.surfaceKey),
    );
    if (
      masters.size === 1 &&
      masters.has(hash(revision.master?.contentHash)) &&
      ["driver", "passenger", "hood", "roof", "front", "rear"].every(
        (surface) => surfaces.has(surface),
      )
    )
      provedRuns.add(runId);
  }
  return artifacts.filter((artifact) => {
    if (artifactBelongsToRevision(artifact, revision)) return true;
    const metadata = artifact.metadata || {};
    return (
      artifact.kind !== "panel" &&
      !metadata.sourceMasterHash &&
      !metadata.atlasRevisionId &&
      !metadata.sourcePanelHashes &&
      provedRuns.has(artifact.runId)
    );
  });
}

/** A camera alias never turns an opposite side or close-up into this proof. */
export function selectSurfaceView(views, surfaceKey, sourceViewType, revision) {
  const candidates = (views || []).filter(
    (view) =>
      view.surfaceKey === surfaceKey &&
      view.sourceViewType === sourceViewType &&
      (revision === undefined || viewBelongsToRevision(view, revision)),
  );
  const identities = new Set(candidates.map((view) => hash(view.contentHash)));
  return identities.size === 1 && !identities.has("") ? candidates[0] : null;
}

/** Artifact presence, promotion and passing human QC are distinct states. */
export function panelReviewState({ panel, revision, humanApproved = false }) {
  const surfaceKey = panel?.surfaceKey;
  const metadata = panel?.metadata || {};
  const affected = revision?.qc?.masterCutoutSurfaces || [];
  const unresolved = (revision?.qc?.cutoutFillApplied || []).some(
    (row) => row.surfaceKey === surfaceKey && Number(row.unresolvedPixels) > 0,
  );
  if (
    metadata.productionEligible === false ||
    metadata.qcPassed === false ||
    revision?.qc?.masterQcPassed === false ||
    affected.includes(surfaceKey) ||
    unresolved
  ) {
    return {
      approved: false,
      state: "needs_correction",
      label: "Artwork needs review",
    };
  }
  if (humanApproved)
    return { approved: true, state: "approved", label: "Human QC approved" };
  return { approved: false, state: "pending_qc", label: "Pending human QC" };
}
