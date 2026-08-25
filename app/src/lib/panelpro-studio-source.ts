/**
 * The server-owned source behind the PanelPro Studio board.
 *
 * `AdminGeminiCompareStudio.tsx` is the design team's real production
 * workspace: search a job by order number, see every side's print panel beside
 * its real design proof, slide one over the other to compare, keep a version
 * history per side, approve each side, run the QC checklist, build the print
 * files, stamp and send to WrapBox. It is the page the team already knows, and
 * it stays exactly as it is.
 *
 * What changed underneath it is where a job comes from. It used to read a
 * panelizer job row, fall back to an ApprovePro approval, resolve a
 * visualization for the views and a design row for the proof, and persist its
 * own per-side state into `concept_json.qc_side_panels`. Four stores, none of
 * which exist here, and a browser writing production state into all of them.
 *
 * A DesignProAI job is one server-owned run. This adapter projects that run
 * into the exact `Job` shape the page reads -- `all_view_urls`,
 * `concept_json.flat_proof_url`, `concept_json.qc_side_panels[sideKey]` -- so
 * the whole board renders unchanged against artifacts the runtime produced and
 * hashed.
 *
 * THE PAGE STOPS PRODUCING. Panels are cut deterministically at Call 9 from the
 * accepted A.T.L.A.S. master, so the board reads them; it does not extract,
 * flatten, separate or mirror. The one write it keeps is the one the design team
 * genuinely needs -- a panel a human corrected against the real vehicle
 * template, recorded against the surface it replaces with the original kept.
 */
import {
  dpApi,
  ROLE_FOR_SOURCE_VIEW_TYPE,
  type ApprovedGenerationView,
  type FlatAtlasRevision,
  type GenieSurfaceKey,
  type WorkflowArtifact,
  type WorkflowStatus,
} from "@/lib/designpro-api";
import { selectCustomerProof } from "@/lib/designpro-artifact-selectors";

/**
 * The board's own side vocabulary -> the server's surface key.
 *
 * Exact, never fuzzy. The historical page carried alias lists per side because
 * a view could arrive under any of half a dozen keys depending on which
 * pipeline produced it; one pipeline produces them now, and it states the
 * surface.
 */
export const SURFACE_FOR_SIDE_KEY: Record<string, GenieSurfaceKey> = {
  driver_side: "driver",
  passenger_side: "passenger",
  hood: "hood",
  roof: "roof",
  front: "front",
  rear: "rear",
};

/** One version of a side's panel, oldest first, as the board's history reads. */
export type PanelProSideVersion = {
  id: string;
  url: string;
  source: string;
  at: string | null;
  note: string | null;
  contentHash: string;
  /** True for a file a human corrected against the real vehicle template. */
  humanCorrected: boolean;
};

export type PanelProSidePanel = {
  /** The ACTIVE production artwork for this side: newest correction, else Call 9. */
  gemini_url: string;
  versions: PanelProSideVersion[];
  approved: boolean;
  print_dims: {
    widthInches: number | null;
    heightInches: number | null;
    bleedInches: number | null;
    source: string;
  } | null;
  /**
   * What the board's compare view is really asking: are this proof and this
   * panel the same design? Both halves publish their binding, so the answer is
   * a comparison rather than a hope.
   */
  atlas: {
    proofMasterHash: string | null;
    panelMasterHash: string | null;
    /** null when either side has no binding -- absent is not the same as drift. */
    matches: boolean | null;
  };
};

export type PanelProStudioJob = {
  id: string;
  generation_id: string;
  order_number: string;
  design_id: string;
  status: string;
  revision: number;
  vehicle_year: number | null;
  vehicle_make: string;
  vehicle_model: string;
  /** The customer's brief, verbatim. Never a paraphrase. */
  brief: string | null;
  created_at: string | null;
  all_view_urls: Record<string, string>;
  concept_json: {
    flat_proof_url: string;
    render_urls: Record<string, string>;
    qc_side_panels: Record<string, PanelProSidePanel>;
  };
  /** Every A.T.L.A.S. version this design has been through, oldest first. */
  atlas_versions: FlatAtlasRevision[];
  /** The rest of the production stream the board displays and downloads. */
  logos: WorkflowArtifact[];
  qc_panels: WorkflowArtifact[];
  upscaled: WorkflowArtifact[];
  outputs: WorkflowArtifact[];
  stamp: WorkflowArtifact | null;
  zip: WorkflowArtifact | null;
  wrapbox: WorkflowArtifact | null;
  /** The run's state, so the board can say which gate it is actually at. */
  state: WorkflowStatus["state"];
  current_stage: string;
  revision_id: string | null;
};

function viewUrls(views: readonly ApprovedGenerationView[]): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const view of views) {
    if (!view.signedUrl) continue;
    // Both names, because the board keys by camera and the rest of the app keys
    // by role. Each entry is the exact identity the server stated.
    urls[view.sourceViewType] = view.signedUrl;
    const role = ROLE_FOR_SOURCE_VIEW_TYPE[view.sourceViewType];
    if (role) urls[role] = view.signedUrl;
  }
  return urls;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * One side's panel history, active file and binding.
 *
 * Versions are additive: the Call 9 panel is version one and every human
 * correction is appended, so nothing a designer uploaded ever replaces what the
 * server produced. The newest correction is the active production artwork,
 * which is also what Call 12 enhances -- the board and the pipeline agree by
 * construction rather than by convention.
 */
function sidePanelFor(input: {
  sideKey: string;
  panel: WorkflowArtifact | undefined;
  corrections: WorkflowArtifact[];
  view: ApprovedGenerationView | undefined;
  approved: boolean;
}): PanelProSidePanel | null {
  if (!input.panel) return null;
  const metadata = (input.panel.metadata || {}) as Record<string, unknown>;
  const versions: PanelProSideVersion[] = [
    {
      id: input.panel.id,
      url: input.panel.signedUrl,
      source: "call9",
      at: null,
      note: "Cut deterministically from the accepted master at GENIE dimensions with 5″ bleed.",
      contentHash: input.panel.contentHash,
      humanCorrected: false,
    },
    ...[...input.corrections]
      .sort((left, right) =>
        String(left.metadata?.correctedAt || "").localeCompare(String(right.metadata?.correctedAt || "")))
      .map((correction) => ({
        id: correction.id,
        url: correction.signedUrl,
        source: "human-correction",
        at: String(correction.metadata?.correctedAt || "") || null,
        note: String(correction.metadata?.reason || "") || null,
        contentHash: correction.contentHash,
        humanCorrected: true,
      })),
  ];
  const active = versions[versions.length - 1];
  const proofMasterHash = input.view?.atlasBinding?.masterContentHash || null;
  const panelMasterHash = typeof metadata.sourceMasterHash === "string" ? metadata.sourceMasterHash : null;
  return {
    gemini_url: active.url,
    versions,
    approved: input.approved,
    print_dims: {
      widthInches: numberOrNull(metadata.printWidthIn ?? metadata.widthInches),
      heightInches: numberOrNull(metadata.printHeightIn ?? metadata.heightInches),
      bleedInches: numberOrNull(metadata.bleedInches),
      // Where the numbers came from, so the card can say "verified" rather than
      // implying a tape measure was involved.
      source: String(metadata.geometryPurpose || "genie"),
    },
    atlas: {
      proofMasterHash,
      panelMasterHash,
      matches: proofMasterHash && panelMasterHash ? proofMasterHash === panelMasterHash : null,
    },
  };
}

/** Project one server run into the Job shape the board reads. */
export function studioJobFrom(input: {
  job: WorkflowStatus;
  views: readonly ApprovedGenerationView[];
  artifacts: readonly WorkflowArtifact[];
  atlasRevisions: readonly FlatAtlasRevision[];
  approvedSides?: ReadonlySet<string>;
}): PanelProStudioJob {
  const bySurface = (kind: string) => {
    const rows = new Map<string, WorkflowArtifact>();
    for (const artifact of input.artifacts) {
      if (artifact.kind !== kind) continue;
      if (!rows.has(artifact.surfaceKey)) rows.set(artifact.surfaceKey, artifact);
    }
    return rows;
  };
  const panels = bySurface("panel");
  const corrections = new Map<string, WorkflowArtifact[]>();
  for (const artifact of input.artifacts) {
    if (artifact.kind !== "corrected-panel") continue;
    const list = corrections.get(artifact.surfaceKey) || [];
    list.push(artifact);
    corrections.set(artifact.surfaceKey, list);
  }
  const viewBySurface = new Map<string, ApprovedGenerationView>();
  for (const view of input.views) {
    if (!viewBySurface.has(view.surfaceKey)) viewBySurface.set(view.surfaceKey, view);
  }

  const qcSidePanels: Record<string, PanelProSidePanel> = {};
  for (const [sideKey, surface] of Object.entries(SURFACE_FOR_SIDE_KEY)) {
    const side = sidePanelFor({
      sideKey,
      panel: panels.get(surface),
      corrections: corrections.get(surface) || [],
      view: viewBySurface.get(surface),
      approved: input.approvedSides?.has(sideKey) === true,
    });
    // A side with no Call 9 panel is deliberately absent rather than an empty
    // record: the board's own "the server produces this" state is the honest
    // one, and a placeholder would read as a panel that exists but failed.
    if (side) qcSidePanels[sideKey] = side;
  }

  const proof = selectCustomerProof([...input.artifacts]);
  const urls = viewUrls(input.views);
  const year = Number(input.job.vehicle?.year);

  return {
    id: input.job.generationId,
    generation_id: input.job.generationId,
    order_number: input.job.orderNumber,
    design_id: input.job.designId,
    status: input.job.currentStage,
    revision: input.job.revision,
    vehicle_year: Number.isFinite(year) && year > 0 ? year : null,
    vehicle_make: input.job.vehicle?.make || "",
    vehicle_model: input.job.vehicle?.model || "",
    brief: input.job.brief,
    created_at: input.job.createdAt,
    all_view_urls: urls,
    concept_json: {
      flat_proof_url: proof?.signedUrl || "",
      render_urls: urls,
      qc_side_panels: qcSidePanels,
    },
    atlas_versions: [...input.atlasRevisions],
    logos: input.artifacts.filter((artifact) => artifact.kind === "logo"),
    qc_panels: input.artifacts.filter((artifact) => artifact.kind === "qc-panel"),
    upscaled: input.artifacts.filter((artifact) => artifact.kind === "upscaled-panel"),
    outputs: input.artifacts.filter((artifact) => artifact.kind === "output"),
    stamp: input.artifacts.find((artifact) => artifact.kind === "stamp") || null,
    zip: input.artifacts.find((artifact) => artifact.kind === "zip") || null,
    wrapbox: input.artifacts.find((artifact) => artifact.kind === "wrapbox-manifest") || null,
    state: input.job.state,
    current_stage: input.job.currentStage,
    revision_id: input.job.revisionId,
  };
}

/** Everything the board needs for one job, in one read. */
export async function loadPanelProStudioJob(
  generationId: string,
  approvedSides?: ReadonlySet<string>,
): Promise<PanelProStudioJob | null> {
  const id = String(generationId || "").trim();
  if (!id) return null;
  const job = await dpApi.getStatus(id).catch(() => null);
  if (!job) return null;
  const [views, artifacts, atlasRevisions] = await Promise.all([
    dpApi.listApprovedViews(job.generationId).catch(() => [] as ApprovedGenerationView[]),
    dpApi.listArtifacts(job.generationId).catch(() => [] as WorkflowArtifact[]),
    // A run with no A.T.L.A.S. lineage answers an empty list, which is the
    // honest state for a Standard design rather than an error.
    dpApi.listJobFlatAtlasRevisions(job.generationId).catch(() => [] as FlatAtlasRevision[]),
  ]);
  return studioJobFrom({ job, views, artifacts, atlasRevisions, approvedSides });
}

/**
 * The recent-jobs list the board opens on, newest first.
 *
 * Identity only -- order number, design id, vehicle, state. The board loads a
 * job's artifacts when one is chosen, so browsing does not sign forty jobs'
 * worth of URLs that expire in five minutes anyway.
 */
export async function listPanelProStudioJobs(): Promise<
  Array<Pick<PanelProStudioJob,
    "id" | "generation_id" | "order_number" | "design_id" | "status" | "created_at"
    | "vehicle_year" | "vehicle_make" | "vehicle_model" | "state">>
> {
  const jobs = await dpApi.listJobs();
  return jobs.map((job) => {
    const year = Number(job.vehicle?.year);
    return {
      id: job.generationId,
      generation_id: job.generationId,
      order_number: job.orderNumber,
      design_id: job.designId,
      status: job.currentStage,
      created_at: job.createdAt,
      vehicle_year: Number.isFinite(year) && year > 0 ? year : null,
      vehicle_make: job.vehicle?.make || "",
      vehicle_model: job.vehicle?.model || "",
      state: job.state,
    };
  }).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

/**
 * Find a job by whatever the designer typed: an order number, a design id, or
 * the generation itself.
 *
 * The historical search ran four ilike queries across two tables and an
 * approval's metadata, because the order number lived somewhere different in
 * each. The run mints and owns its order number, so this matches against what
 * the gateway already returned.
 */
export async function findPanelProStudioJob(query: string): Promise<string | null> {
  const raw = String(query || "").trim();
  if (!raw) return null;
  if (/^[0-9a-f-]{36}$/i.test(raw)) return raw.toLowerCase();
  const jobs = await listPanelProStudioJobs();
  const digits = raw.replace(/[^0-9]/g, "");
  const needle = raw.toLowerCase();
  const match = jobs.find((job) =>
    job.order_number.toLowerCase() === needle
    || job.design_id.toLowerCase() === needle
    || job.generation_id === needle
    || (digits.length >= 4 && job.order_number.replace(/[^0-9]/g, "").includes(digits)));
  return match?.generation_id || null;
}
