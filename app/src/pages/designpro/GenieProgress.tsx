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
import { AlertCircle, CheckCircle2, Circle, Loader2, PauseCircle } from "lucide-react";
import {
  ApprovedGenerationView,
  dpApi,
  PRODUCTION_SURFACES,
  RENDER_ROLES,
  SOURCE_VIEW_TYPE_FOR_ROLE,
  SURFACE_LABEL,
  WorkflowArtifact,
  WorkflowStatus,
} from "@/lib/designpro-api";
import { PanelizerProgressDiagram } from "@/components/production/PanelizerProgressDiagram";
import type { PackPanel } from "@/lib/panelizer-config";
import { Loading, Notice, PageHead, Panel, StatePill } from "@/components/designpro/surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { presentWorkflowStages, productionProgressMessage, publicBuildPreviews, type PresentedState } from "@/lib/designpro-workflow-presentation.mjs";

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
  if (state === "complete") return <CheckCircle2 className="h-5 w-5 text-cyan-400" />;
  if (state === "running" || state === "retrying") return <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />;
  if (state === "waiting") return <PauseCircle className="h-5 w-5 text-amber-400" />;
  if (state === "failed" || state === "attention") return <AlertCircle className="h-5 w-5 text-amber-400" />;
  return <Circle className="h-5 w-5 text-muted-foreground/40" />;
}

export default function GenieProgress() {
  const { generationId = "" } = useParams();
  const [job, setJob] = useState<WorkflowStatus>();
  const [views, setViews] = useState<ApprovedGenerationView[]>([]);
  const [artifacts, setArtifacts] = useState<WorkflowArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeRole, setActiveRole] = useState<string>("driver");
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const [status, viewRows, artifactRows] = await Promise.allSettled([
      dpApi.getStatus(generationId),
      dpApi.listApprovedViews(generationId),
      dpApi.listArtifacts(generationId),
    ]);
    if (sequence !== loadSequence.current) return;
    if (status.status === "fulfilled") setJob(status.value);
    if (viewRows.status === "fulfilled") setViews(viewRows.value);
    if (artifactRows.status === "fulfilled") setArtifacts(artifactRows.value);
    setLoadError([status, viewRows, artifactRows].some((result) => result.status === "rejected"));
    setLoading(false);
  }, [generationId]);

  useEffect(() => {
    setLoading(true);
    setJob(undefined);
    setViews([]);
    setArtifacts([]);
    setLoadError(false);
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      await load();
      if (!disposed) timer = window.setTimeout(poll, 15_000);
    };
    void poll();
    return () => { disposed = true; window.clearTimeout(timer); loadSequence.current += 1; };
  }, [load]);

  const viewByRole = useMemo(() => {
    const rows = new Map<string, ApprovedGenerationView>();
    for (const role of RENDER_ROLES) {
      const sourceType = SOURCE_VIEW_TYPE_FOR_ROLE[role];
      const row = views.find((view) => view.sourceViewType === sourceType || view.surfaceKey === role);
      if (row) rows.set(role, row);
    }
    return rows;
  }, [views]);

  const panelSides = useMemo(() => {
    const sides = new Set<string>();
    for (const artifact of artifacts) if (artifact.kind === "panel") sides.add(artifact.surfaceKey);
    return sides;
  }, [artifacts]);

  const glowing = PRODUCTION_SURFACES.filter((side) => panelSides.has(side)).length;
  const allGlow = glowing === PRODUCTION_SURFACES.length;

  // The diagram draws the zones a design HAS, sized from the panel the server
  // actually cut. A side with no Call 9 panel still gets a zone -- the customer
  // needs to see the hole -- but it is never reported as lit.
  const packPanels = useMemo<PackPanel[]>(() => PRODUCTION_SURFACES.map((side) => {
    const panel = artifacts.find((item) => item.kind === "panel" && item.surfaceKey === side);
    const metadata = (panel?.metadata || {}) as Record<string, unknown>;
    return {
      id: ZONE_ID_FOR_SURFACE[side] || side,
      label: SURFACE_LABEL[side] || side,
      widthInches: Number(metadata.printWidthIn ?? metadata.widthInches ?? 0),
      heightInches: Number(metadata.printHeightIn ?? metadata.heightInches ?? 0),
      mirrored: metadata.deterministicMirror === true,
    };
  }), [artifacts]);

  const packState = allGlow ? "complete" : glowing > 0 ? "processing" : "pending";
  const zipArtifact = artifacts.find((item) => item.kind === "zip");
  const active = viewByRole.get(activeRole);
  const buildSteps = presentWorkflowStages(job?.stages);
  const buildPreviews = publicBuildPreviews(artifacts);
  const progressMessage = productionProgressMessage(job, Boolean(zipArtifact));

  if (loading && !job) {
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
            : "No production run is reporting for this design yet."
        }
        backTo={`/designpro/jobs/${generationId}`}
        backLabel="Job"
        aside={job ? <StatePill state={job.state} /> : undefined}
      />

      {loadError && <Notice tone="warning">Progress could not be fully refreshed. The latest available previews remain here while we reconnect.</Notice>}
      {!job && !loadError && <Notice tone="warning">This design has not been handed to the production pipeline yet.</Notice>}

      {job && (
        <Panel eyebrow="Build progress" title="Your design taking shape" description="Completed files appear below as each part is prepared.">
          {buildSteps.length === 0 && <p className="text-sm text-muted-foreground">{job.state === "queued" ? "Your design is queued for preparation." : "Your artwork and vehicle views are being prepared. Completed previews appear below."}</p>}
          <ol className="grid gap-3 sm:grid-cols-2">
            {buildSteps.map((step) => {
              const state = step.state;
              return (
                <li key={step.key} className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
                  <StepIcon state={state} />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.explanation}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{state === "attention" ? "Needs attention" : state === "running" ? "In progress" : state}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Panel>
      )}

      {buildPreviews.length > 0 && (
        <Panel eyebrow="Template and coverage" title="See how your artwork fits">
          <div className="grid gap-4 sm:grid-cols-2">
            {buildPreviews.map((preview) => (
              <figure key={preview.id} className="overflow-hidden rounded-lg border">
                <img src={preview.signedUrl} alt={preview.label} className="aspect-video w-full bg-white object-contain" />
                <figcaption className="p-3 text-sm">{preview.label}{SURFACE_LABEL[preview.surfaceKey] ? ` · ${SURFACE_LABEL[preview.surfaceKey]}` : ""}</figcaption>
              </figure>
            ))}
          </div>
        </Panel>
      )}

      {job && (
        <Panel
          eyebrow="ProductionFlow · UniversalPanelizer™"
          title="When all panels glow, it's a go"
          description={`${glowing} of ${PRODUCTION_SURFACES.length} panel artworks prepared`}
        >
          <PanelizerProgressDiagram
            panels={packPanels}
            completedCount={glowing}
            totalCount={PRODUCTION_SURFACES.length}
            status={job.state === "failed" ? "failed" : packState}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            {progressMessage}
          </p>
          {zipArtifact && (
            <div className="mt-3">
              <Button asChild size="sm">
                <a href={zipArtifact.signedUrl} download={`production-pack-${job.orderNumber || job.designId}.zip`}>
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
              const panel = artifacts.find((item) => item.kind === "panel" && item.surfaceKey === side);
              return panel?.signedUrl ? (
                <figure key={side} className="overflow-hidden rounded-lg border">
                  <img src={panel.signedUrl} alt={`${SURFACE_LABEL[side]} panel artwork`} className="aspect-video w-full bg-white object-contain" />
                  <figcaption className="p-2 text-xs">{SURFACE_LABEL[side]}</figcaption>
                </figure>
              ) : null;
            })}
          </div>
        </Panel>
      )}

      {job?.state === "waiting_for_genie_dimensions" && (
        <Notice tone="warning">
          <div className="space-y-2">
            <strong className="block">GENIE vehicle dimensions need validation</strong>
            <span className="block">
              Production sizing is waiting for checked vehicle dimensions. Completed
              artwork and proofs remain available while those measurements are reviewed.
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
        title={allGlow ? "All panels glow — it's a go" : "When all panels glow, it's a go"}
        description={
          allGlow
            ? "Every side has a verified production panel."
            : "A side lights up when its print panel exists on the server."
        }
      >
        <div className="space-y-4">
          {active?.signedUrl ? (
            <div
              className={cn(
                "overflow-hidden rounded-xl border-2 transition-colors",
                panelSides.has(activeRole) ? "border-cyan-400/70 shadow-[0_0_28px_-6px] shadow-cyan-500/50" : "border-border",
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
                    role === activeRole ? "border-cyan-400" : glows ? "border-cyan-500/40" : "border-border",
                  )}
                >
                  {view?.signedUrl ? (
                    <img src={view.signedUrl} alt={SURFACE_LABEL[role] || role} className="aspect-video w-full object-cover" />
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
                <span className="block">
                  {progressMessage}
                </span>
              </div>
            </Notice>
          )}
        </div>
      </Panel>
    </div>
  );
}
