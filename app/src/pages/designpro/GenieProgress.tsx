/**
 * GENIE Universal Panelizer — the customer-facing build progress page.
 *
 * The glowing diagram is the ORIGINAL PanelizerProgressDiagram, reused rather
 * than reimplemented: it is the surface the customer already knows and it is
 * pure presentation with no data access of its own. What changed is where its
 * props come from. The built card fed it out of `panelizer_jobs` through a
 * browser Supabase client -- a second reader of a table this server does not
 * own. Here the same component is driven by the run's own artifacts.
 *
 * "When all panels glow, it's a go." The step rail, the glowing per-side
 * thumbnails and the terminal states are the surface the customer watches while
 * the server works, and they are reported here from the server's own run state
 * -- dpApi.getStatus, dpApi.listApprovedViews, dpApi.listArtifacts -- never from
 * a browser-driven job table.
 *
 * A side glows when its Call 9 print panel actually exists. It does not glow for
 * a view that merely rendered: the whole point of the page is to show the
 * customer that their production files are real.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Loader2,
  PauseCircle,
} from "lucide-react";
import {
  ApprovedGenerationView,
  dpApi,
  GenerationProgress,
  PRODUCTION_SURFACES,
  RENDER_ROLES,
  SOURCE_VIEW_TYPE_FOR_ROLE,
  SURFACE_LABEL,
  WorkflowArtifact,
  WorkflowStatus,
} from "@/lib/designpro-api";
import { PanelizerProgressDiagram } from "@/components/production/PanelizerProgressDiagram";
import type { PackPanel } from "@/lib/panelizer-config";
import {
  Loading,
  Notice,
  PageHead,
  Panel,
  StatePill,
} from "@/components/designpro/surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  presentWorkflowStages,
  productionProgressMessage,
  publicBuildPreviews,
  type PresentedState,
} from "@/lib/designpro-workflow-presentation.mjs";
import { selectSurfaceView } from "@/lib/studio-artifact-identity.mjs";
import {
  panelOutputApi,
  panelOutputHref,
  type PanelOutputRun,
} from "@/lib/panelpro-file-output-api";
import {
  panelOutputBlockerCopy,
  panelOutputPreviews,
  panelOutputProgress,
  panelOutputStageCopy,
  panelOutputStageState,
} from "@/lib/panelpro-file-output-view.mjs";

/** Canonical surface_key -> the zone ids PanelizerProgressDiagram lays out. */
const ZONE_ID_FOR_SURFACE: Record<string, string> = {
  driver: "driver-side",
  passenger: "passenger-side",
  hood: "hood",
  roof: "roof",
  front: "front-bumper",
  rear: "rear",
};

function StepIcon({ state }: { state: PresentedState }) {
  if (state === "complete")
    return <CheckCircle2 className="h-5 w-5 text-cyan-400" />;
  if (state === "running" || state === "retrying")
    return <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />;
  if (state === "waiting")
    return <PauseCircle className="h-5 w-5 text-amber-400" />;
  if (state === "failed" || state === "attention")
    return <AlertCircle className="h-5 w-5 text-amber-400" />;
  return <Circle className="h-5 w-5 text-muted-foreground/40" />;
}

type GenieReadState = {
  job?: WorkflowStatus;
  progress?: GenerationProgress;
  views: ApprovedGenerationView[];
  artifacts: WorkflowArtifact[];
  panelOutputRuns: PanelOutputRun[];
  panelOutputError: boolean;
  loadError: boolean;
};

/** Four independent reads share one polling cycle; a failed read has no patch. */
export async function readGenieProgress(
  generationId: string,
  client: Pick<
    typeof dpApi,
    | "getStatus"
    | "getGenerationProgress"
    | "listApprovedViews"
    | "listArtifacts"
  > = dpApi,
  outputClient: Pick<typeof panelOutputApi, "list"> = panelOutputApi,
): Promise<Partial<GenieReadState>> {
  const [status, progress, views, artifacts, panelOutputs] =
    await Promise.allSettled([
      client.getStatus(generationId),
      client.getGenerationProgress(generationId),
      client.listApprovedViews(generationId),
      client.listArtifacts(generationId),
      outputClient.list({ sourceApp: "DesignPro", generationId }),
    ]);
  const beforeHandoff =
    progress.status === "fulfilled" &&
    !progress.value.facts.productionRunLinked;
  const workflowUnavailable = (result: PromiseSettledResult<unknown>) =>
    result.status === "rejected" &&
    !(beforeHandoff && result.reason?.status === 404);
  return {
    ...(status.status === "fulfilled" ? { job: status.value } : {}),
    ...(progress.status === "fulfilled" ? { progress: progress.value } : {}),
    ...(views.status === "fulfilled" ? { views: views.value } : {}),
    ...(artifacts.status === "fulfilled" ? { artifacts: artifacts.value } : {}),
    ...(panelOutputs.status === "fulfilled"
      ? { panelOutputRuns: panelOutputs.value }
      : {}),
    panelOutputError: panelOutputs.status === "rejected",
    loadError:
      progress.status === "rejected" ||
      views.status === "rejected" ||
      workflowUnavailable(status) ||
      workflowUnavailable(artifacts),
  };
}

export function selectGenerationPanelOutput(
  runs: PanelOutputRun[],
  generationId: string,
  atlasRevisionId?: string | null,
) {
  if (!atlasRevisionId) return null;
  return (
    runs
      .filter(
        (run) =>
          run.sourceApp === "DesignPro" &&
          run.generationId === generationId &&
          run.atlasRevisionId === atlasRevisionId,
      )
      .sort(
        (a, b) =>
          (Date.parse(b.createdAt || "") || 0) -
          (Date.parse(a.createdAt || "") || 0),
      )[0] || null
  );
}

/** The child graph is observed here; its file inspection stays in its own app. */
export function GeniePanelOutputProgress({
  run,
  refreshFailed = false,
}: {
  run: PanelOutputRun;
  refreshFailed?: boolean;
}) {
  const previews = panelOutputPreviews(run.previews || []);
  const progress = panelOutputProgress(run.stages || []);
  return (
    <Panel
      eyebrow="PanelProFileOutput"
      title="Template fit and physical panels"
      description="Watch the checked template, artwork overlay and physical pieces appear as they are saved."
    >
      {refreshFailed && (
        <Notice tone="warning">
          Template output progress could not be refreshed. The last available
          previews remain below.
        </Notice>
      )}
      <p className="mb-3 text-sm">
        {panelOutputStageState(run.status)}
        {progress.total
          ? ` · ${progress.complete} of ${progress.total} reported steps complete`
          : " · No execution steps have been recorded yet"}
      </p>
      <ol className="mb-4 grid gap-2 sm:grid-cols-2">
        {(run.stages || []).map((stage) => {
          const [label, explanation] = panelOutputStageCopy(stage.key);
          return (
            <li key={stage.key} className="rounded-lg border p-3">
              <p className="text-sm font-semibold">{label}</p>
              <p className="text-xs text-muted-foreground">{explanation}</p>
              <p className="mt-1 text-xs">
                {panelOutputStageState(stage.state)}
              </p>
            </li>
          );
        })}
      </ol>
      {(run.blockers || []).map((blocker, index) => (
        <Notice key={index} tone="warning">
          {panelOutputBlockerCopy(
            typeof blocker === "string" ? blocker : blocker.code,
          )}
        </Notice>
      ))}
      <p className="my-3 text-xs text-muted-foreground">
        Cut areas stay filled with background artwork. Installation masks are
        review overlays; important artwork stays clear of those areas.
      </p>
      {previews.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {previews.map((preview) => (
            <figure
              key={preview.id}
              className="overflow-hidden rounded-lg border"
            >
              <img
                src={preview.signedUrl}
                alt={preview.label}
                className="aspect-video w-full bg-white object-contain"
              />
              <figcaption className="p-3 text-sm">
                {preview.label}
                {preview.pieceId ? ` · ${preview.pieceId}` : ""}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No verified template or placement preview has been saved for this run
          yet.
        </p>
      )}
      <Button asChild size="sm" variant="outline" className="mt-4">
        <Link to={`/panelpro-file-output/runs/${encodeURIComponent(run.id)}`}>
          Open physical panel review
        </Link>
      </Button>
    </Panel>
  );
}

export function GenieBuildRail({
  progress,
  job,
  availableViewCount,
}: {
  progress?: GenerationProgress;
  job?: WorkflowStatus;
  availableViewCount: number;
}) {
  const steps = progress?.stages || presentWorkflowStages(job?.stages);
  return (
    <Panel
      eyebrow="Build progress"
      title="Your design taking shape"
      description="Completed artwork, vehicle angles and files appear as each part is prepared."
    >
      {steps.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No execution steps have been reported yet.
        </p>
      )}
      <p className="mb-3 text-xs text-muted-foreground">
        {availableViewCount} of 7 vehicle angles available. Saved artwork does
        not mark production or human review complete.
      </p>
      <ol className="grid gap-3 sm:grid-cols-2">
        {steps.map((step) => {
          // Availability comes from the exact approved-view read. Never infer
          // seven matching current-version views from a saved master alone.
          const missingProofs =
            step.key === "generation.proofs" &&
            step.state === "complete" &&
            availableViewCount < 7;
          const state = missingProofs ? "attention" : step.state;
          return (
            <li
              key={step.key}
              className="flex items-start gap-3 rounded-lg border border-border/60 p-3"
            >
              <StepIcon state={state} />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold">{step.label}</p>
                <p className="text-xs text-muted-foreground">
                  {missingProofs
                    ? "Some vehicle angles are still unavailable for this design. Completed artwork remains visible."
                    : step.explanation}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {state === "attention"
                    ? "Needs attention"
                    : state === "running"
                      ? "In progress"
                      : state}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

export default function GenieProgress() {
  const { generationId = "" } = useParams();
  const [data, setData] = useState<GenieReadState>({
    views: [],
    artifacts: [],
    panelOutputRuns: [],
    panelOutputError: false,
    loadError: false,
  });
  const {
    job: reportedJob,
    progress,
    views: reportedViews,
    artifacts: reportedArtifacts,
    panelOutputRuns,
    panelOutputError,
    loadError,
  } = data;
  const job =
    progress &&
    reportedJob &&
    !progress.workflowRevisionIds.includes(reportedJob.revisionId || "")
      ? undefined
      : reportedJob;
  const views = progress?.currentRevisionId
    ? reportedViews.filter(
        (view) =>
          view.generationId === generationId &&
          view.atlasBinding?.revisionId === progress.currentRevisionId,
      )
    : reportedViews.filter((view) => view.generationId === generationId);
  const artifacts = progress
    ? reportedArtifacts.filter((artifact) =>
        progress.artifactIds.includes(artifact.id),
      )
    : reportedArtifacts;
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRole] = useState<string>("driver");
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const patch = await readGenieProgress(generationId);
    if (sequence !== loadSequence.current) return;
    setData((previous) => ({ ...previous, ...patch }));
    setLoading(false);
  }, [generationId]);

  useEffect(() => {
    setLoading(true);
    setData({
      views: [],
      artifacts: [],
      panelOutputRuns: [],
      panelOutputError: false,
      loadError: false,
    });
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      await load();
      if (!disposed) timer = window.setTimeout(poll, 15_000);
    };
    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      loadSequence.current += 1;
    };
  }, [load]);

  const viewByRole = useMemo(() => {
    const rows = new Map<string, ApprovedGenerationView>();
    for (const role of RENDER_ROLES) {
      const sourceType = SOURCE_VIEW_TYPE_FOR_ROLE[role];
      const row = selectSurfaceView(views, role, sourceType);
      if (row) rows.set(role, row);
    }
    return rows;
  }, [views]);

  const panelSides = useMemo(() => {
    const sides = new Set<string>();
    for (const artifact of artifacts)
      if (artifact.kind === "panel") sides.add(artifact.surfaceKey);
    return sides;
  }, [artifacts]);

  const glowing = PRODUCTION_SURFACES.filter((side) =>
    panelSides.has(side),
  ).length;
  const allGlow = glowing === PRODUCTION_SURFACES.length;

  // The diagram draws the zones a design HAS, sized from the panel the server
  // actually cut. A side with no Call 9 panel still gets a zone -- the customer
  // needs to see the hole -- but it is never reported as lit.
  const packPanels = useMemo<PackPanel[]>(
    () =>
      PRODUCTION_SURFACES.map((side) => {
        const panel = artifacts.find(
          (item) => item.kind === "panel" && item.surfaceKey === side,
        );
        const metadata = (panel?.metadata || {}) as Record<string, unknown>;
        return {
          id: ZONE_ID_FOR_SURFACE[side] || side,
          label: SURFACE_LABEL[side] || side,
          widthInches: Number(
            metadata.printWidthIn ?? metadata.widthInches ?? 0,
          ),
          heightInches: Number(
            metadata.printHeightIn ?? metadata.heightInches ?? 0,
          ),
          mirrored: metadata.deterministicMirror === true,
        };
      }),
    [artifacts],
  );

  const packState = allGlow
    ? "complete"
    : glowing > 0
      ? "processing"
      : "pending";
  const zipArtifact = artifacts.find((item) => item.kind === "zip");
  const productionProof = artifacts.find(
    (item) =>
      item.kind === "flat-proof" &&
      item.metadata?.role === "customer-2d-production-proof",
  );
  const panelOutput = selectGenerationPanelOutput(
    panelOutputRuns,
    generationId,
    progress?.currentRevisionId,
  );
  const active = viewByRole.get(activeRole);
  const buildPreviews = publicBuildPreviews(artifacts);
  const progressMessage = productionProgressMessage(job, Boolean(zipArtifact));

  if (loading && !job && !progress) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6">
        <Loading label="Loading the panelizer…" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-6">
      <PageHead
        eyebrow="GENIE Universal Panelizer"
        title={job?.designId || "Production progress"}
        description={
          job
            ? `Order # ${job.orderNumber} · Revision ${job.revision}`
            : progress
              ? `Your design is progressing${progress.revisionSequence ? ` · Revision ${progress.revisionSequence}` : ""}.`
              : "Waiting for the latest progress report."
        }
        backTo={`/designpro/jobs/${generationId}`}
        backLabel="Job"
        aside={job ? <StatePill state={job.state} /> : undefined}
      />

      {loadError && (
        <Notice tone="warning">
          Progress could not be fully refreshed. The latest available previews
          remain here while we reconnect.
        </Notice>
      )}
      {!job && !progress && !loadError && (
        <Notice tone="warning">
          No execution steps have been reported yet.
        </Notice>
      )}

      {(job || progress) && (
        <GenieBuildRail
          progress={progress}
          job={job}
          availableViewCount={viewByRole.size}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link
            to={`/revision-studio?generationId=${encodeURIComponent(generationId)}`}
          >
            RevisionStudioIQ
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link
            to={`/designpro/jobs/${encodeURIComponent(generationId)}/panelpro`}
          >
            PanelProStudio
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link
            to={panelOutputHref({
              sourceApp: "DesignPro",
              sourceJobId: generationId,
              generationId,
              ...(progress?.currentRevisionId
                ? { revisionId: progress.currentRevisionId }
                : {}),
            })}
          >
            PanelProFileOutput
          </Link>
        </Button>
      </div>

      {panelOutput && (
        <GeniePanelOutputProgress
          run={panelOutput}
          refreshFailed={panelOutputError}
        />
      )}

      {buildPreviews.length > 0 && (
        <Panel
          eyebrow="Template and coverage"
          title="See how your artwork fits"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {buildPreviews.map((preview) => (
              <figure
                key={preview.id}
                className="overflow-hidden rounded-lg border"
              >
                <img
                  src={preview.signedUrl}
                  alt={preview.label}
                  className="aspect-video w-full bg-white object-contain"
                />
                <figcaption className="p-3 text-sm">
                  {preview.label}
                  {SURFACE_LABEL[preview.surfaceKey]
                    ? ` · ${SURFACE_LABEL[preview.surfaceKey]}`
                    : ""}
                </figcaption>
              </figure>
            ))}
          </div>
        </Panel>
      )}

      {productionProof?.signedUrl && (
        <Panel
          eyebrow="Production panel proof"
          title="Your panel artwork and dimensions"
          description="The saved GENIE dimensioned proof shows trim size, print size and five inches of bleed on each outside edge. Production review is reported in the steps above."
        >
          <img
            src={productionProof.signedUrl}
            alt="GENIE production panel proof with trim dimensions and five-inch bleed"
            className="w-full rounded-lg bg-white object-contain"
          />
        </Panel>
      )}

      {(job || progress) && (
        <Panel
          eyebrow="ProductionFlow · UniversalPanelizer™"
          title="When all panels glow, it's a go"
          description={`${glowing} of ${PRODUCTION_SURFACES.length} panel artworks prepared`}
        >
          <PanelizerProgressDiagram
            panels={packPanels}
            completedCount={glowing}
            totalCount={PRODUCTION_SURFACES.length}
            status={
              job?.state === "failed" || progress?.generationState === "failed"
                ? "failed"
                : packState
            }
          />
          <p className="mt-3 text-xs text-muted-foreground">
            {progressMessage}
          </p>
          {zipArtifact &&
            (progress
              ? progress.facts.packageReady
              : job?.state === "complete") && (
              <div className="mt-3">
                <Button asChild size="sm">
                  <a
                    href={zipArtifact.signedUrl}
                    download={`production-pack-${job?.orderNumber || job?.designId || generationId}.zip`}
                  >
                    Download production pack
                  </a>
                </Button>
              </div>
            )}
        </Panel>
      )}

      {panelSides.size > 0 && (
        <Panel eyebrow="Panel artwork" title="Prepared sections">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {PRODUCTION_SURFACES.map((side) => {
              const panel = artifacts.find(
                (item) => item.kind === "panel" && item.surfaceKey === side,
              );
              return panel?.signedUrl ? (
                <figure
                  key={side}
                  className="overflow-hidden rounded-lg border"
                >
                  <img
                    src={panel.signedUrl}
                    alt={`${SURFACE_LABEL[side]} panel artwork`}
                    className="aspect-video w-full bg-white object-contain"
                  />
                  <figcaption className="p-2 text-xs">
                    {SURFACE_LABEL[side]}
                  </figcaption>
                </figure>
              ) : null;
            })}
          </div>
        </Panel>
      )}

      {job?.state === "waiting_for_genie_dimensions" && (
        <Notice tone="warning">
          <div className="space-y-2">
            <strong className="block">
              GENIE vehicle dimensions need validation
            </strong>
            <span className="block">
              Production sizing is waiting for checked vehicle dimensions.
              Completed artwork and proofs remain available while those
              measurements are reviewed.
            </span>
            <Button asChild size="sm" variant="outline">
              <Link
                to={
                  job.waiting?.candidateId
                    ? `/designpro/genie-qc?candidate=${encodeURIComponent(job.waiting.candidateId)}`
                    : "/designpro/genie-qc"
                }
              >
                Validate dimensions
              </Link>
            </Button>
          </div>
        </Notice>
      )}

      <Panel
        eyebrow={`Production views — ${glowing}/${PRODUCTION_SURFACES.length} panels processed`}
        title={
          allGlow
            ? "All panels glow — it's a go"
            : "When all panels glow, it's a go"
        }
        description={
          allGlow
            ? "Artwork is available for all six sides. File checks and human review are reported above."
            : "A side lights up when its print panel exists on the server."
        }
      >
        <div className="space-y-4">
          {active?.signedUrl ? (
            <div
              className={cn(
                "overflow-hidden rounded-xl border-2 transition-colors",
                panelSides.has(activeRole)
                  ? "border-cyan-400/70 shadow-[0_0_28px_-6px] shadow-cyan-500/50"
                  : "border-border",
              )}
            >
              <img
                src={active.signedUrl}
                alt={`${activeRole} approved view`}
                className="w-full object-cover"
              />
            </div>
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
              No approved view for this angle yet
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {RENDER_ROLES.map((role) => {
              const view = viewByRole.get(role);
              const glows = panelSides.has(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => setActiveRole(role)}
                  className={cn(
                    "w-24 overflow-hidden rounded-lg border-2 text-left transition-colors",
                    role === activeRole
                      ? "border-cyan-400"
                      : glows
                        ? "border-cyan-500/40"
                        : "border-border",
                  )}
                >
                  {view?.signedUrl ? (
                    <img
                      src={view.signedUrl}
                      alt={SURFACE_LABEL[role] || role}
                      className="aspect-video w-full object-cover"
                    />
                  ) : (
                    <div className="aspect-video w-full bg-muted/40" />
                  )}
                  <span className="block px-1 py-1 text-[9px] font-bold uppercase tracking-wide">
                    {SURFACE_LABEL[role] || role}
                  </span>
                </button>
              );
            })}
          </div>

          {allGlow && (
            <Notice tone="success">
              <div className="space-y-1">
                <strong className="block">All panels glow — it's a go</strong>
                <span className="block">{progressMessage}</span>
              </div>
            </Notice>
          )}
        </div>
      </Panel>
    </div>
  );
}
