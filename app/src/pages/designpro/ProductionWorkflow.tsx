/**
 * One production job, end to end.
 *
 * This page reports what the server owns and asks for the two things only a
 * human can give: the PanelPro preflight approval and the final production QC
 * approval. It never builds, cuts, enhances or packages anything.
 *
 * The sections mirror the pipeline:
 *   RevisionStudio  — the customer-facing 2D Production Proof, the approved
 *                      view paired with each side's production panel, the
 *                      revision path and the Production Pack / Logo Pack route.
 *                      RevisionStudio is a REQUIRED stage of the production
 *                      flow, not optional UI: the operating invariant runs
 *                      design approved -> 2D Production Proof -> six production
 *                      sides -> RevisionStudio paired render + panel per side
 *                      -> Production Layers -> production pack. It lives here
 *                      rather than at its own route; the URL is incidental, the
 *                      responsibilities are not. Nothing about it is retired.
 *   Production Layers — the six print-ready panels cut from the approved layout
 *   Topaz            — Call 12 enhancement of each panel to print resolution
 *   Verified output  — the eighteen files (six surfaces x PNG/TIFF/EPS)
 *   Delivery         — the approval stamp, the production ZIP and the manifest
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, Circle, CircleDashed, PauseCircle, XCircle } from "lucide-react";
import {
  dpApi,
  FinalQc,
  GenieSurfaceKey,
  PreflightQc,
  PRODUCTION_SURFACES,
  SURFACE_LABEL,
  WorkflowArtifact,
  WorkflowStatus,
} from "@/lib/designpro-api";
import { selectCustomerProof } from "@/lib/designpro-artifact-selectors";
import {
  EXPECTED_OUTPUT_FILES,
  FINAL_CHECKS,
  OUTPUT_FORMATS,
  outputFormatOf,
  PREFLIGHT_CHECKS,
  STAGE_LABEL,
} from "@/lib/designpro-stages";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useStandaloneProductionLayers } from "@/hooks/useStandaloneProductionLayers";
import { ServerRevisionStudio } from "@/components/revisioniq/ServerRevisionStudio";
import {
  ContentHash,
  Loading,
  Notice,
  PageHead,
  Panel,
  SaveLink,
  StatePill,
} from "@/components/designpro/surface";

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function inches(value: unknown): string | null {
  const parsed = num(value);
  if (parsed == null) return null;
  return Number.isInteger(parsed) ? String(parsed) : String(Math.round(parsed * 100) / 100);
}

function previewable(artifact: WorkflowArtifact) {
  const path = artifact.storagePath.toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".svg"].some((ext) => path.endsWith(ext));
}

/* ── Stage timeline ──────────────────────────────────────────────── */

function StageTimeline({ job }: { job: WorkflowStatus }) {
  const icon = {
    complete: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
    running: <CircleDashed className="h-4 w-4 animate-spin text-blue-400" />,
    // A parked stage is deliberately not a spinner. It is waiting on a person.
    waiting: <PauseCircle className="h-4 w-4 text-amber-400" />,
    failed: <XCircle className="h-4 w-4 text-destructive" />,
    pending: <Circle className="h-4 w-4 text-muted-foreground/50" />,
  };
  return (
    <ol className="space-y-3">
      {job.stages.map((stage) => (
        <li key={stage.key} className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0">{icon[stage.state] || icon.pending}</span>
          <div className="min-w-0">
            <div
              className={cn(
                "text-sm font-medium",
                stage.state === "pending" && "text-muted-foreground",
              )}
            >
              {STAGE_LABEL[stage.key] || stage.label || stage.key}
            </div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {stage.state === "waiting" && stage.waitReason
                ? `waiting · ${stage.waitReason.replace(/_/g, " ")}`
                : stage.state}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ── RevisionStudio: the 2D proof and the six production layers ──── */

function RevisionStudio({
  artifacts,
  loading,
}: {
  artifacts: WorkflowArtifact[];
  loading: boolean;
}) {
  // THE PROOF IS CHOSEN BY ROLE. This is the sheet the customer approves and
  // the sheet Call 9 cuts from, so choosing it by anything else is choosing it
  // by accident.
  //
  // It used to be `kind === "flat-proof" && !item.surfaceKey`, which worked
  // only because the six canonical surfaces happen to carry a surfaceKey and
  // the customer proof happens not to. The line directly below already proves
  // that family is wider than two -- flat-wrap-layout is a third flat-proof --
  // so one more surfaceKey-less variant, a draft or a superseded sheet, and the
  // customer approves the wrong document with nothing on screen to say so.
  //
  // A run carrying two customer proofs is a contradiction in Call 8's output,
  // not a preference. selectCustomerProof throws rather than pick; caught here
  // so the page reports it instead of blanking, because a render that dies
  // tells the customer nothing.
  let proof: WorkflowArtifact | null = null;
  let proofConflict: string | null = null;
  try {
    proof = selectCustomerProof(artifacts);
  } catch (error) {
    proofConflict = error instanceof Error ? error.message : String(error);
  }
  const layout = artifacts.find(
    (item) => item.kind === "flat-proof" && item.surfaceKey === "flat-wrap-layout",
  );
  const panels = PRODUCTION_SURFACES.map((key) =>
    artifacts.find((item) => item.kind === "panel" && item.surfaceKey === key),
  ).filter((item): item is WorkflowArtifact => Boolean(item));

  if (loading && !proof && panels.length === 0) {
    return (
      <Panel eyebrow="Revision Studio">
        <Loading label="Loading Revision Studio…" />
      </Panel>
    );
  }
  if (!proof && !proofConflict && panels.length === 0) return null;

  const totalSqFt = num(proof?.metadata?.totalSqFt);

  return (
    <Panel
      eyebrow="Revision Studio"
      title="2D Production Proof"
      description="The approved proof and every print-ready panel cut from it. Deterministic per-side crops of the approved flat wrap layout — no re-render."
      aside={
        totalSqFt != null ? <Badge variant="secondary">{totalSqFt.toFixed(2)} sq ft</Badge> : undefined
      }
    >
      {proof ? (
        <figure className="overflow-hidden rounded-lg border border-border">
          <a href={proof.signedUrl} target="_blank" rel="noreferrer">
            <img src={proof.signedUrl} alt="2D Production Proof" className="w-full" />
          </a>
          <figcaption className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2 text-xs">
            <span className="text-muted-foreground">DesignProAI™ — 2D Production Proof</span>
            <SaveLink url={proof.signedUrl} name="2d-production-proof.png" />
          </figcaption>
        </figure>
      ) : proofConflict ? (
        <Notice tone="error">
          This run publishes more than one customer 2D Production Proof
          ({proofConflict}). Nothing is shown rather than guess which one you
          approved — Call 8 emitted a contradiction and it needs resolving
          before this design goes to production.
        </Notice>
      ) : (
        <Notice>The 2D production proof has not been published for this job yet.</Notice>
      )}

      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3 border-t border-border pt-6">
        <h3 className="text-base font-semibold">
          Production Layers — {panels.length} of {PRODUCTION_SURFACES.length} sides
        </h3>
        {layout && (
          <a
            href={layout.signedUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-primary hover:underline"
          >
            Open approved flat wrap layout ↗
          </a>
        )}
      </div>

      {panels.length === 0 && (
        <div className="mt-4">
          <Notice>No panels have been cut yet. They appear here once Call 9 completes.</Notice>
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {panels.map((panel) => {
          const trimW = inches(panel.metadata.trimWidthInches);
          const trimH = inches(panel.metadata.trimHeightInches);
          const printW = inches(panel.metadata.printWidthInches);
          const printH = inches(panel.metadata.printHeightInches);
          const sqFt = num(panel.metadata.surfaceSqFt);
          const rect = panel.metadata.cutRect as
            | { x: number; y: number; w: number; h: number }
            | undefined;
          return (
            <article key={panel.id} className="overflow-hidden rounded-lg border border-border bg-background">
              <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <strong className="truncate text-xs font-bold uppercase tracking-wide">
                  {SURFACE_LABEL[panel.surfaceKey] || panel.surfaceKey}
                </strong>
                {trimW && trimH && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {trimW}″ × {trimH}″
                  </span>
                )}
              </header>
              <a href={panel.signedUrl} target="_blank" rel="noreferrer" className="block bg-muted/30">
                <img
                  src={panel.signedUrl}
                  alt={`${panel.surfaceKey} print-ready panel`}
                  className="w-full object-contain"
                />
              </a>
              <div className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">Print-ready panel</span>
                  <SaveLink url={panel.signedUrl} name={`${panel.surfaceKey}-print-panel.png`} />
                </div>
                {printW && printH && (
                  <p className="text-xs text-muted-foreground">
                    {printW}″ × {printH}″ printed · 5″ bleed on all four edges
                    {sqFt != null ? ` · ${sqFt.toFixed(2)} sq ft` : ""}
                  </p>
                )}
                {rect && (
                  <p className="text-xs text-muted-foreground">
                    Cut {rect.w}×{rect.h} px at ({rect.x}, {rect.y}) of the approved layout
                  </p>
                )}
                <ContentHash value={panel.contentHash} />
              </div>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

/* ── Call 12: Topaz print enhancement ────────────────────────────── */

function TopazEnhancement({ artifacts }: { artifacts: WorkflowArtifact[] }) {
  const enhanced = PRODUCTION_SURFACES.map((key) =>
    artifacts.find((item) => item.kind === "upscaled-panel" && item.surfaceKey === key),
  ).filter((item): item is WorkflowArtifact => Boolean(item));
  if (enhanced.length === 0) return null;

  const model = String(enhanced[0].metadata.model || "");
  const anyClamped = enhanced.some((item) => item.metadata.clampedByEngineCeiling === true);

  return (
    <Panel
      eyebrow="Call 12 · Topaz"
      title="Print enhancement"
      description="Each approved panel is enhanced to its exact print resolution. Topaz output is not reproducible, so every downstream stage binds these exact hashes rather than re-running the engine."
      aside={
        <Badge variant="secondary">
          {enhanced.length} of {PRODUCTION_SURFACES.length} panels
        </Badge>
      }
    >
      {model && (
        <p className="mb-4 text-xs text-muted-foreground">
          Engine <code className="font-mono">topaz-image-enhance</code> · model{" "}
          <code className="font-mono">{model}</code> · 1500 dpi target
        </p>
      )}
      {anyClamped && (
        <div className="mb-4">
          <Notice>
            One or more panels were clamped by the engine's resolution ceiling. The planned print
            size is still met; the enhancement factor was capped.
          </Notice>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {enhanced.map((item) => {
          const width = num(item.metadata.widthPx);
          const height = num(item.metadata.heightPx);
          return (
            <div key={item.id} className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-xs font-bold uppercase tracking-wide">
                  {SURFACE_LABEL[item.surfaceKey] || item.surfaceKey}
                </strong>
                {item.metadata.reusedImmutableWinner === true && (
                  <Badge variant="outline" className="text-[10px]">
                    reused winner
                  </Badge>
                )}
              </div>
              {width != null && height != null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {width.toLocaleString()} × {height.toLocaleString()} px
                </p>
              )}
              <div className="mt-2">
                <ContentHash value={item.contentHash} />
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ── The eighteen verified production files ──────────────────────── */

function VerifiedOutputFiles({ artifacts }: { artifacts: WorkflowArtifact[] }) {
  const outputs = artifacts.filter((item) => item.kind === "output");
  if (outputs.length === 0) return null;

  const bySurface = new Map<string, Partial<Record<string, WorkflowArtifact>>>();
  for (const output of outputs) {
    const format = outputFormatOf(output.storagePath);
    if (!format) continue;
    const row = bySurface.get(output.surfaceKey) || {};
    row[format] = output;
    bySurface.set(output.surfaceKey, row);
  }
  const complete = outputs.length === EXPECTED_OUTPUT_FILES;

  return (
    <Panel
      eyebrow="Verified production output"
      title={`${outputs.length} of ${EXPECTED_OUTPUT_FILES} verified files`}
      description="Six printed surfaces in PNG, TIFF and EPS. Every file's hash is bound to the verified output receipt — the final QC gate signs off on exactly these bytes."
      aside={<StatePill state={complete ? "complete" : "running"} />}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-semibold">Surface</th>
              {OUTPUT_FORMATS.map((format) => (
                <th key={format} className="py-2 pr-4 font-semibold">
                  {format.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRODUCTION_SURFACES.map((surface: GenieSurfaceKey) => {
              const row = bySurface.get(surface) || {};
              return (
                <tr key={surface} className="border-b border-border/60 last:border-0">
                  <td className="py-3 pr-4 font-medium">{SURFACE_LABEL[surface]}</td>
                  {OUTPUT_FORMATS.map((format) => {
                    const file = row[format];
                    return (
                      <td key={format} className="py-3 pr-4 align-top">
                        {file ? (
                          <div className="space-y-1">
                            <a
                              href={file.signedUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-semibold text-primary hover:underline"
                            >
                              Open ↗
                            </a>
                            <code
                              title={file.contentHash}
                              className="block font-mono text-[10px] text-muted-foreground"
                            >
                              {file.contentHash.slice(0, 12)}…
                            </code>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">pending</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ── Stamp, ZIP and manifest ─────────────────────────────────────── */

function DeliveryArtifacts({ artifacts }: { artifacts: WorkflowArtifact[] }) {
  const rows = [
    { kind: "stamp", label: "Approval stamp", file: "approval-stamp.png" },
    { kind: "zip", label: "Production ZIP", file: "production-pack.zip" },
    { kind: "wrapbox-manifest", label: "WrapBox manifest", file: "wrapbox-manifest.json" },
  ]
    .map((row) => ({ ...row, artifact: artifacts.find((item) => item.kind === row.kind) }))
    .filter((row) => row.artifact);
  if (rows.length === 0) return null;

  return (
    <Panel
      eyebrow="Exact verified delivery"
      title="Stamp, ZIP and manifest"
      description="Minted for your authenticated session and valid for five minutes. The hash, not the link, is the durable identity."
      aside={
        <Button asChild variant="outline" size="sm">
          <Link to="/designpro/wrapbox">Open WrapBox</Link>
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.kind} className="rounded-lg border border-border bg-background p-4">
            <strong className="text-sm">{row.label}</strong>
            {row.artifact!.byteSize != null && (
              <p className="mt-1 text-xs text-muted-foreground">
                {row.artifact!.byteSize!.toLocaleString()} bytes
              </p>
            )}
            <div className="mt-2">
              <ContentHash value={row.artifact!.contentHash} />
            </div>
            <div className="mt-3">
              <SaveLink url={row.artifact!.signedUrl} name={row.file} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ── The two human release gates ─────────────────────────────────── */

function QcGate({
  gate,
  onApprove,
}: {
  gate: "preflight" | "final";
  onApprove: (qc: PreflightQc | FinalQc, notes: string) => Promise<void>;
}) {
  const items = gate === "preflight" ? PREFLIGHT_CHECKS : FINAL_CHECKS;
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const complete = items.every(([key]) => checks[key] === true);

  async function approve() {
    if (!complete) return;
    setBusy(true);
    setError("");
    try {
      await onApprove(
        Object.fromEntries(items.map(([key]) => [key, true])) as unknown as PreflightQc | FinalQc,
        notes,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Approval failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      className="border-amber-500/40"
      eyebrow="Human release gate"
      title={gate === "preflight" ? "PanelPro preflight QC" : "Final production QC"}
      description="Approval is blocked until every required check is explicitly confirmed."
    >
      <div className="space-y-3">
        {items.map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-start gap-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={checks[key] === true}
              onCheckedChange={(value) =>
                setChecks((current) => ({ ...current, [key]: value === true }))
              }
            />
            <span className="leading-6">{label}</span>
          </label>
        ))}
      </div>
      <Textarea
        className="mt-4"
        rows={3}
        maxLength={2000}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Operator notes"
      />
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <Button className="mt-4" disabled={!complete || busy} onClick={approve}>
        {busy
          ? "Recording verified approval…"
          : gate === "preflight"
            ? "Approve and release output build"
            : "Approve and release stamp + ZIP"}
      </Button>
    </Panel>
  );
}

/* ── Everything else the job published ───────────────────────────── */

function OtherArtifacts({ artifacts }: { artifacts: WorkflowArtifact[] }) {
  const shown = new Set(["flat-proof", "panel", "upscaled-panel", "output", "stamp", "zip", "wrapbox-manifest"]);
  const rest = artifacts.filter((item) => !shown.has(item.kind));
  if (rest.length === 0) return null;
  return (
    <Panel
      eyebrow="Other verified artifacts"
      title={`${rest.length} additional files`}
      description="Logo inventory and any other artifact this job published, exactly as the server recorded it."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rest.map((item) => (
          <article key={item.id} className="overflow-hidden rounded-lg border border-border bg-background">
            {previewable(item) ? (
              <a href={item.signedUrl} target="_blank" rel="noreferrer" className="block bg-muted/30">
                <img
                  src={item.signedUrl}
                  alt={`${item.kind} ${item.surfaceKey || ""}`}
                  className="h-32 w-full object-contain"
                />
              </a>
            ) : null}
            <div className="space-y-1 p-3">
              <strong className="block text-xs uppercase tracking-wide">
                {item.kind.split(/[_-]/).join(" ")}
              </strong>
              {item.surfaceKey && (
                <span className="text-xs text-muted-foreground">{item.surfaceKey}</span>
              )}
              <ContentHash value={item.contentHash} chars={12} />
              <a
                href={item.signedUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-xs font-semibold text-primary hover:underline"
              >
                Open verified file ↗
              </a>
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}

export default function ProductionWorkflow() {
  const { generationId = "" } = useParams();
  const [job, setJob] = useState<WorkflowStatus>();
  const [artifacts, setArtifacts] = useState<WorkflowArtifact[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(true);
  const [artifactsError, setArtifactsError] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      dpApi
        .getStatus(generationId)
        .then((status) => {
          setJob(status);
          setError("");
        })
        .catch(() => setError("Status unavailable.")),
    [generationId],
  );

  const loadArtifacts = useCallback(() => {
    setArtifactsLoading(true);
    return dpApi
      .listArtifacts(generationId)
      .then((result) => {
        setArtifacts(result);
        setArtifactsError("");
      })
      .catch(() => setArtifactsError("Verified artifacts could not be loaded."))
      .finally(() => setArtifactsLoading(false));
  }, [generationId]);


  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  // Signed links last five minutes; refresh them well inside that window.
  useEffect(() => {
    void loadArtifacts();
    const timer = window.setInterval(loadArtifacts, 240000);
    return () => window.clearInterval(timer);
  }, [loadArtifacts]);

  // The same resolver RevisionStudio uses, so one surface can never disagree
  // with the other about what this run published.
  const layersSource = useStandaloneProductionLayers(generationId, {
    returnPath: `/designpro/jobs/${generationId}`,
  });

  const completeCount = useMemo(
    () => job?.stages.filter((stage) => stage.state === "complete").length || 0,
    [job],
  );

  // RevisionStudio is a REQUIRED stage of the flow, not decoration. Returning
  // only "Status unavailable." here is why it reads as missing: a design whose
  // production run has not been created yet -- or whose status read failed --
  // loses the seven approved views, the proof and the panels along with it.
  // Report the real state and keep the studio on screen.
  if (!job) {
    if (!error) {
      return (
        <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
          <Loading label="Loading server status…" />
        </div>
      );
    }
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
        <PageHead
          eyebrow="Calls 8–12 · Production"
          title="RevisionStudio"
          description="The production job for this design is not reporting yet. The approved views below are the frozen Calls 1–7 set."
          backTo="/designpro/jobs"
          backLabel="Production jobs"
        />
        <Notice tone="warning">
          <div className="space-y-2">
            <strong className="block">No production job is reporting for this design yet</strong>
            <span className="block">
              The server creates the run at handoff, immediately after the seventh
              view is accepted. If this persists, the seven views were never frozen
              into Calls 8+ and the design has no proof or panels to show.
            </span>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Check again
            </Button>
          </div>
        </Notice>
        <ServerRevisionStudio
          generationId={generationId}
          job={undefined}
          artifacts={artifacts}
          artifactsLoading={artifactsLoading}
          layersSource={layersSource}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
      <PageHead
        eyebrow="Calls 8–12 · Production"
        title={job.designId}
        description={`Order # ${job.orderNumber} · Revision ${job.revision} · ${completeCount} of ${job.stages.length} stages verified`}
        backTo="/designpro/jobs"
        backLabel="Production jobs"
        aside={<StatePill state={job.state} />}
      />

      {job.failure && (
        <Notice tone="error">
          <div className="space-y-2">
            <strong className="block">{STAGE_LABEL[job.failure.stage] || job.failure.stage}</strong>
            <span className="block">{job.failure.message}</span>
            {job.failure.retryable && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => dpApi.requestResume(generationId).then(load)}
              >
                Request server resume
              </Button>
            )}
          </div>
        </Notice>
      )}

      {/* The pipeline is parked, not working. Say so and route the operator to
          the one page that can clear it, or Call 8 and Call 9 never run and the
          job reads as "still building" indefinitely. */}
      {job.state === "waiting_for_genie_dimensions" && (
        <Notice tone="warning">
          <div className="space-y-2">
            <strong className="block">GENIE vehicle dimensions need validation</strong>
            <span className="block">
              This job is stopped at <code>manifest.resolve</code>. The 2D Production
              Proof, the six production panels and everything below them cannot start
              until the vehicle's GENIE dimensions are validated by a person.
            </span>
            <Button asChild size="sm" variant="outline">
              <Link
                to={
                  job.waiting?.candidateId
                    ? `/designpro/genie-qc?candidate=${encodeURIComponent(job.waiting.candidateId)}`
                    : "/designpro/genie-qc"
                }
              >
                Validate dimensions in GENIE QC
              </Link>
            </Button>
          </div>
        </Notice>
      )}

      {job.state === "waiting_for_preflight" && (
        <QcGate
          gate="preflight"
          onApprove={async (qc, notes) => {
            await dpApi.approvePreflight(generationId, qc as PreflightQc, notes);
            await load();
          }}
        />
      )}
      {job.state === "waiting_for_final_qc" && (
        <QcGate
          gate="final"
          onApprove={async (qc, notes) => {
            await dpApi.approveFinalQc(generationId, qc as FinalQc, notes);
            await load();
          }}
        />
      )}

      <Panel eyebrow="Automatic workflow" title="Server-owned stages">
        <StageTimeline job={job} />
        {/* The two surfaces this job feeds: the customer watches the panelizer,
            the design team works the per-side board. Both read this same run. */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to={`/designpro/jobs/${generationId}/progress`}>GENIE panelizer progress</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to={`/designpro/jobs/${generationId}/panelpro`}>PanelPro Studio board</Link>
          </Button>
        </div>
      </Panel>

      {artifactsError && <Notice tone="error">{artifactsError}</Notice>}

      <ServerRevisionStudio
        generationId={generationId}
        job={job}
        artifacts={artifacts}
        artifactsLoading={artifactsLoading}
        layersSource={layersSource}
      />
      <TopazEnhancement artifacts={artifacts} />
      <VerifiedOutputFiles artifacts={artifacts} />
      <DeliveryArtifacts artifacts={artifacts} />
      <OtherArtifacts artifacts={artifacts} />
    </div>
  );
}
