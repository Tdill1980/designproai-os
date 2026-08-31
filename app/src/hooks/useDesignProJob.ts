/**
 * ONE JOB, LOADED ONCE, FOR EVERY SCREEN IN THE WORKFLOW.
 *
 * The five surfaces in the owner's path — Design, RevisionStudioIQ,
 * PanelProStudio, QC, WrapBox — each need the same four facts to know where the
 * job stands: its server status, its A.T.L.A.S. revisions (master + the six
 * Call-1 panels), whether a 2D Production Proof exists, and whether a WrapBox
 * pack has been built. Before this, each screen fetched its own subset and drew
 * its own conclusion, which is how PanelPro could report "Print panels 0/6"
 * while RevisionStudio showed six (RULE 0.27 §4).
 *
 * This hook is the single read. It uses the EXISTING gateway endpoints and adds
 * none: `getStatus`, `listJobFlatAtlasRevisions`, `listArtifacts`, `listWrapbox`.
 *
 * WHY WRAPBOX IS MATCHED ON designId. `WrapboxPack` carries `runId`,
 * `revisionId` and `designId` but no `generationId`, so there is no direct key.
 * `designId` is the right join anyway: it is derived canonically from the
 * generation id by one helper, it is the identity stamped on the QC certificate
 * and shown in both studios, and `WorkflowStatus` carries it too. Matching on it
 * needs no server change and cannot drift, because both sides derive it from
 * the same generation.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  dpApi,
  PRODUCTION_SURFACES,
  type FlatAtlasRevision,
  type WorkflowArtifact,
  type WorkflowStatus,
  type WrapboxPack,
} from "@/lib/designpro-api";

export type DesignProJob = {
  generationId: string;
  status: WorkflowStatus | null;
  /** Newest first. The current design is `revisions[0]`. */
  revisions: FlatAtlasRevision[];
  currentRevision: FlatAtlasRevision | null;
  hasAcceptedMaster: boolean;
  callOnePanelCount: number;
  /**
   * Every artifact published for this job. Exposed as the LIST rather than as
   * a `hasProductionProof` flag: the QC report resolves the Call-8 proof and
   * the Call-9 panels back to the six flat surfaces, which a boolean cannot
   * support — it can only say something exists, never what it is made of.
   */
  artifacts: WorkflowArtifact[];
  wrapboxPack: WrapboxPack | null;
  designId: string | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

function newestFirst(revisions: FlatAtlasRevision[]): FlatAtlasRevision[] {
  return [...revisions].sort((a, b) => Number(b.revisionSequence) - Number(a.revisionSequence));
}

export function useDesignProJob(generationId: string | null | undefined): DesignProJob {
  const id = String(generationId || "").trim();
  const [status, setStatus] = useState<WorkflowStatus | null>(null);
  const [revisions, setRevisions] = useState<FlatAtlasRevision[]>([]);
  const [artifacts, setArtifacts] = useState<WorkflowArtifact[]>([]);
  const [packs, setPacks] = useState<WrapboxPack[]>([]);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!id) {
      setStatus(null);
      setRevisions([]);
      setArtifacts([]);
      setPacks([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    // EACH READ FAILS ON ITS OWN. A job mid-Call-1 has no workflow run yet, and
    // a free job has no WrapBox pack — neither is an error, and letting one
    // absent read blank the whole header is what made these screens look broken
    // on a job that was simply early.
    void (async () => {
      const [statusResult, revisionResult, artifactResult, packResult] = await Promise.allSettled([
        dpApi.getStatus(id),
        dpApi.listJobFlatAtlasRevisions(id),
        dpApi.listArtifacts(id),
        dpApi.listWrapbox(),
      ]);
      if (cancelled) return;
      setStatus(statusResult.status === "fulfilled" ? statusResult.value : null);
      setRevisions(revisionResult.status === "fulfilled" ? newestFirst(revisionResult.value || []) : []);
      setArtifacts(artifactResult.status === "fulfilled" ? artifactResult.value || [] : []);
      setPacks(packResult.status === "fulfilled" ? packResult.value || [] : []);
      // Only the identity read failing is a real error worth showing: without
      // it there is no job, whereas the other three are legitimately empty on a
      // young job.
      if (statusResult.status === "rejected" && revisionResult.status === "rejected") {
        setError("This job could not be opened from this account.");
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id, nonce]);

  const currentRevision = revisions[0] || null;

  const callOnePanelCount = useMemo(() => {
    const panels = currentRevision?.callOnePanels || [];
    const seen = new Set(
      panels
        .map((panel) => String(panel.surfaceKey))
        .filter((key) => (PRODUCTION_SURFACES as string[]).includes(key)),
    );
    return seen.size;
  }, [currentRevision]);

  // An ACCEPTED master, not merely a persisted row: nothing is stored before
  // the deterministic and semantic gates pass, but `masterQcPassed` is the
  // explicit verdict and a null one means the record predates the gate.
  const hasAcceptedMaster = Boolean(
    currentRevision?.master?.contentHash && currentRevision?.qc?.masterQcPassed !== false,
  );

  const designId = status?.designId || null;
  const wrapboxPack = useMemo(() => {
    if (!designId) return null;
    return packs.find((pack) => pack.designId === designId) || null;
  }, [packs, designId]);

  return {
    generationId: id,
    status,
    revisions,
    currentRevision,
    hasAcceptedMaster,
    callOnePanelCount,
    artifacts,
    wrapboxPack,
    designId,
    loading,
    error,
    reload,
  };
}

export default useDesignProJob;
