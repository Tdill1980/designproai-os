/**
 * GENIE Universal Panelizer — the customer-facing build progress page.
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, Circle, Loader2, PauseCircle } from "lucide-react";
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
import { Loading, Notice, PageHead, Panel, StatePill } from "@/components/designpro/surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The seven rail steps the customer knows, each backed by the server stages that
 * actually prove it. A step is complete only when every stage behind it is.
 */
const RAIL: Array<{ key: string; label: string; stages: string[] }> = [
  { key: "panel", label: "Panel", stages: ["revision.freeze", "manifest.resolve"] },
  { key: "optim", label: "Optim", stages: ["proof.build"] },
  { key: "qa", label: "QA", stages: ["panels.build"] },
  { key: "pack", label: "Pack", stages: ["pack.verify", "pack.activate"] },
  { key: "detect", label: "Detect", stages: ["logos.extract", "panels.delogo"] },
  { key: "admin", label: "Admin", stages: ["await_panelpro_preflight_qc", "await_final_human_qc"] },
  { key: "ready", label: "Ready", stages: ["zip.build", "wrapbox.deliver"] },
];

type StepState = "complete" | "active" | "waiting" | "pending";

function railState(job: WorkflowStatus | undefined, stages: string[]): StepState {
  if (!job) return "pending";
  const rows = job.stages.filter((stage) => stages.includes(stage.key));
  if (!rows.length) return "pending";
  if (rows.every((stage) => stage.state === "complete")) return "complete";
  if (rows.some((stage) => stage.state === "waiting")) return "waiting";
  if (rows.some((stage) => stage.state === "running")) return "active";
  return "pending";
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "complete") return <CheckCircle2 className="h-5 w-5 text-cyan-400" />;
  if (state === "active") return <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />;
  if (state === "waiting") return <PauseCircle className="h-5 w-5 text-amber-400" />;
  return <Circle className="h-5 w-5 text-muted-foreground/40" />;
}

export default function GenieProgress() {
  const { generationId = "" } = useParams();
  const [job, setJob] = useState<WorkflowStatus>();
  const [views, setViews] = useState<ApprovedGenerationView[]>([]);
  const [artifacts, setArtifacts] = useState<WorkflowArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRole] = useState<string>("driver");

  const load = useCallback(async () => {
    const [status, viewRows, artifactRows] = await Promise.all([
      dpApi.getStatus(generationId).catch(() => undefined),
      dpApi.listApprovedViews(generationId).catch(() => []),
      dpApi.listArtifacts(generationId).catch(() => []),
    ]);
    setJob(status);
    setViews(viewRows);
    setArtifacts(artifactRows);
    setLoading(false);
  }, [generationId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
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
  const active = viewByRole.get(activeRole);

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

      {!job && <Notice tone="warning">This design has not been handed to the production pipeline yet.</Notice>}

      {job && (
        <Panel eyebrow="Build progress" title="Every stage the server owns">
          <ol className="flex flex-wrap items-center gap-x-3 gap-y-4">
            {RAIL.map((step, index) => {
              const state = railState(job, step.stages);
              return (
                <li key={step.key} className="flex items-center gap-3">
                  <div className="flex flex-col items-center gap-1">
                    <StepIcon state={state} />
                    <span
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-wider",
                        state === "complete" && "text-cyan-400",
                        state === "active" && "text-cyan-300",
                        state === "waiting" && "text-amber-400",
                        state === "pending" && "text-muted-foreground/50",
                      )}
                    >
                      {step.label}
                    </span>
                  </div>
                  {index < RAIL.length - 1 && <span className="text-muted-foreground/30">—</span>}
                </li>
              );
            })}
          </ol>
        </Panel>
      )}

      {job?.state === "waiting_for_genie_dimensions" && (
        <Notice tone="warning">
          <div className="space-y-2">
            <strong className="block">GENIE vehicle dimensions need validation</strong>
            <span className="block">
              The build is stopped until the vehicle's dimensions are validated. Panels
              are cut to those exact dimensions, so nothing downstream can start first.
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
                  Your production files are with the design team for quality control.
                </span>
              </div>
            </Notice>
          )}
        </div>
      </Panel>
    </div>
  );
}
