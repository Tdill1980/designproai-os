import type {
  ApprovedGenerationView,
  FlatAtlasRevision,
  FlatAtlasCallOnePanel,
  WorkflowArtifact,
} from "./designpro-api";
export function artifactsForStudioRevision(
  artifacts: readonly WorkflowArtifact[],
  revision: FlatAtlasRevision | null,
): WorkflowArtifact[];
export function selectAtlasRevision(
  revisions: readonly FlatAtlasRevision[],
  revisionId?: string | null,
): FlatAtlasRevision | null;
export function viewBelongsToRevision(
  view: ApprovedGenerationView,
  revision: FlatAtlasRevision | null,
): boolean;
export function artifactBelongsToRevision(
  artifact: WorkflowArtifact,
  revision: FlatAtlasRevision | null,
): boolean;
export function callOnePanelBelongsToRevision(
  panel: FlatAtlasCallOnePanel,
  revision: FlatAtlasRevision,
): boolean;
export function selectSurfaceView(
  views: readonly ApprovedGenerationView[],
  surfaceKey: string,
  sourceViewType: string,
  revision?: FlatAtlasRevision | null,
): ApprovedGenerationView | null;
export function panelReviewState(input: {
  panel?:
    | Pick<WorkflowArtifact, "surfaceKey" | "metadata">
    | FlatAtlasCallOnePanel
    | null;
  revision?: FlatAtlasRevision | null;
  humanApproved?: boolean;
}): {
  approved: boolean;
  state: "needs_correction" | "approved" | "pending_qc";
  label: string;
};
