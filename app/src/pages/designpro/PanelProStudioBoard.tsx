/**
 * PanelPro Studio — the design team's per-side validation board.
 *
 * This is the board the team works: for each canonical side, the REAL DESIGN
 * PROOF (the approved 3D view this run was frozen against) sits beside its
 * PRINT PANEL (the Call 9 artifact), so a panel is never judged on its own.
 * A designer downloads the panel, lays it on the vehicle-dimension template,
 * and ticks the side off.
 *
 * It is deliberately NOT a producer. The RestylePro board carried "Pull panel",
 * "Upload panel" and "Mirror from driver" because the browser built panels
 * there; on this server the panels are produced deterministically by Call 9 at
 * GENIE dimensions with 5" bleed, and a second producer in the UI is exactly
 * what the one-sanctioned-chain rule forbids. A side with no panel is reported
 * as a gap the server has to fill, never patched by hand here.
 *
 * It carries the whole back half, because the team needs every panel asset in
 * one place to sign anything off: the branded Call 9 panels, the Call 11
 * de-logoed QC duplicates, the Call 10 logo inventory, the Topaz print-resolution
 * panels, and the eighteen verified output files.
 *
 * Two real server gates run through it. The six side attestations plus the six
 * preflight checks both travel to await_panelpro_preflight_qc, which releases the
 * panels into Topaz and the output build; the three final checks roll into
 * await_final_human_qc, which is what lets the run stamp, ZIP and deliver to
 * WrapBox. Nothing ships until both are ticked, which is the rule the board
 * always had.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, Download, FileArchive, ImageOff, PackageCheck, ShieldCheck } from "lucide-react";
import {
  ApprovedGenerationView,
  dpApi,
  FinalQc,
  FlatAtlasRevision,
  GenieSurfaceKey,
  PreflightQc,
  PRODUCTION_SURFACES,
  SURFACE_LABEL,
  WorkflowArtifact,
  WorkflowStatus,
} from "@/lib/designpro-api";
import {
  EXPECTED_OUTPUT_FILES,
  FINAL_CHECKS,
  OUTPUT_FORMATS,
  outputFormatOf,
  PREFLIGHT_CHECKS,
} from "@/lib/designpro-stages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  ContentHash,
  Loading,
  Notice,
  PageHead,
  Panel,
  SaveLink,
  StatePill,
} from "@/components/designpro/surface";
import { cn } from "@/lib/utils";

function inches(value: unknown): string | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number.isInteger(parsed) ? String(parsed) : String(Math.round(parsed * 100) / 100);
}

function panelSize(artifact: WorkflowArtifact | undefined): string | null {
  if (!artifact) return null;
  const metadata = artifact.metadata || {};
  const width = inches((metadata as Record<string, unknown>).printWidthIn ?? (metadata as Record<string, unknown>).widthInches);
  const height = inches((metadata as Record<string, unknown>).printHeightIn ?? (metadata as Record<string, unknown>).heightInches);
  return width && height ? `${width}″ × ${height}″` : null;
}

function SideCard({
  surfaceKey,
  view,
  panel,
  approved,
  onToggle,
}: {
  surfaceKey: GenieSurfaceKey;
  view: ApprovedGenerationView | undefined;
  panel: WorkflowArtifact | undefined;
  approved: boolean;
  onToggle: (next: boolean) => void;
}) {
  const size = panelSize(panel);
  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        approved ? "border-emerald-500/50 bg-emerald-500/5" : "border-border bg-card",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold tracking-tight">{SURFACE_LABEL[surfaceKey] || surfaceKey}</h3>
        <div className="flex items-center gap-2">
          {size && <span className="text-xs text-muted-foreground">{size}</span>}
          <Badge variant={approved ? "default" : "secondary"}>
            {approved ? "Approved" : panel ? "Pending" : "No panel"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Real design proof
          </div>
          {view?.signedUrl ? (
            <img
              src={view.signedUrl}
              alt={`${surfaceKey} approved view`}
              className="aspect-video w-full rounded-lg border border-border object-cover"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
              No approved view
            </div>
          )}
          {view && <ContentHash value={view.contentHash} />}
        </div>

        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Print panel
          </div>
          {panel?.signedUrl ? (
            <img
              src={panel.signedUrl}
              alt={`${surfaceKey} print panel`}
              className="aspect-video w-full rounded-lg border border-border bg-white object-contain"
            />
          ) : (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted-foreground">
              <ImageOff className="h-4 w-4" />
              Not produced yet
            </div>
          )}
          {panel && <ContentHash value={panel.contentHash} />}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {panel?.signedUrl && (
          <Button asChild size="sm" variant="outline">
            <a href={panel.signedUrl} download={`${surfaceKey}-print-panel.png`}>
              <Download className="mr-1 h-4 w-4" /> Download panel
            </a>
          </Button>
        )}
        <Button
          size="sm"
          variant={approved ? "secondary" : "default"}
          disabled={!panel}
          onClick={() => onToggle(!approved)}
        >
          <CheckCircle2 className="mr-1 h-4 w-4" />
          {approved ? "Approved · undo" : "Approve side"}
        </Button>
        {!panel && (
          <span className="text-xs text-muted-foreground">
            The server produces this panel at Call 9. It is never hand-built here.
          </span>
        )}
      </div>
    </div>
  );
}

export default function PanelProStudioBoard() {
  const { generationId = "" } = useParams();
  const [job, setJob] = useState<WorkflowStatus>();
  const [views, setViews] = useState<ApprovedGenerationView[]>([]);
  const [artifacts, setArtifacts] = useState<WorkflowArtifact[]>([]);
  const [atlasRevisions, setAtlasRevisions] = useState<FlatAtlasRevision[]>([]);
  const [atlasVersion, setAtlasVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [approvedSides, setApprovedSides] = useState<Set<string>>(new Set());
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [finalChecks, setFinalChecks] = useState<Record<string, boolean>>({});
  const [finalNotes, setFinalNotes] = useState("");
  const [finalSubmitting, setFinalSubmitting] = useState(false);
  const [finalError, setFinalError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [status, viewRows, artifactRows, atlasRows] = await Promise.all([
      dpApi.getStatus(generationId).catch(() => undefined),
      dpApi.listApprovedViews(generationId).catch(() => []),
      dpApi.listArtifacts(generationId).catch(() => []),
      // A Standard run has no atlas. An empty list is the honest answer, not an
      // error, so the board renders without the section rather than failing.
      dpApi.listJobFlatAtlasRevisions(generationId).catch(() => []),
    ]);
    setJob(status);
    setViews(viewRows);
    setArtifacts(artifactRows);
    setAtlasRevisions(atlasRows);
    setAtlasVersion((current) => Math.min(current, Math.max(0, atlasRows.length - 1)));
    setError(status ? "" : "The production job for this design is not reporting.");
    setLoading(false);
  }, [generationId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 120_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const viewBySide = useMemo(() => {
    const rows = new Map<string, ApprovedGenerationView>();
    // Exact surface_key binding only. Never array order, never a nearest match:
    // pairing a panel with the wrong side's proof is how a board approves the
    // wrong artwork.
    for (const view of views) if (!rows.has(view.surfaceKey)) rows.set(view.surfaceKey, view);
    return rows;
  }, [views]);

  const panelBySide = useMemo(() => {
    const rows = new Map<string, WorkflowArtifact>();
    for (const artifact of artifacts) {
      if (artifact.kind !== "panel") continue;
      if (!rows.has(artifact.surfaceKey)) rows.set(artifact.surfaceKey, artifact);
    }
    return rows;
  }, [artifacts]);

  const qcPanelBySide = useMemo(() => {
    const rows = new Map<string, WorkflowArtifact>();
    for (const artifact of artifacts) {
      if (artifact.kind !== "qc-panel") continue;
      if (!rows.has(artifact.surfaceKey)) rows.set(artifact.surfaceKey, artifact);
    }
    return rows;
  }, [artifacts]);

  const logos = useMemo(() => artifacts.filter((a) => a.kind === "logo"), [artifacts]);
  const upscaledBySide = useMemo(() => {
    const rows = new Map<string, WorkflowArtifact>();
    for (const artifact of artifacts) {
      if (artifact.kind !== "upscaled-panel") continue;
      if (!rows.has(artifact.surfaceKey)) rows.set(artifact.surfaceKey, artifact);
    }
    return rows;
  }, [artifacts]);
  const outputs = useMemo(() => artifacts.filter((a) => a.kind === "output"), [artifacts]);
  const stamp = useMemo(() => artifacts.find((a) => a.kind === "stamp"), [artifacts]);
  const zip = useMemo(() => artifacts.find((a) => a.kind === "zip"), [artifacts]);
  const wrapbox = useMemo(() => artifacts.find((a) => a.kind === "wrapbox-manifest"), [artifacts]);

  const producedCount = PRODUCTION_SURFACES.filter((side) => panelBySide.has(side)).length;
  const everySideApproved = PRODUCTION_SURFACES.every((side) => approvedSides.has(side));
  const everyCheckTicked = PREFLIGHT_CHECKS.every(([key]) => checks[key]);
  const waitingForGate = job?.state === "waiting_for_preflight";
  const everyFinalTicked = FINAL_CHECKS.every(([key]) => finalChecks[key]);
  const waitingForFinal = job?.state === "waiting_for_final_qc";

  const toggleSide = (side: string, next: boolean) => {
    setApprovedSides((current) => {
      const updated = new Set(current);
      if (next) updated.add(side);
      else updated.delete(side);
      return updated;
    });
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      await dpApi.approvePreflight(
        generationId,
        // The per-side approvals travel with the checkboxes. They are what the
        // board actually gates on, so the receipt should record them too.
        { ...checks, approvedSides: [...approvedSides].sort() } as unknown as PreflightQc,
        notes,
      );
      await load();
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "The preflight approval was refused.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitFinal = async () => {
    setFinalSubmitting(true);
    setFinalError("");
    try {
      await dpApi.approveFinalQc(generationId, finalChecks as unknown as FinalQc, finalNotes);
      await load();
    } catch (cause) {
      setFinalError(cause instanceof Error ? cause.message : "The final approval was refused.");
    } finally {
      setFinalSubmitting(false);
    }
  };

  if (loading && !job) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
        <Loading label="Loading the production board…" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
      <PageHead
        eyebrow="PanelPro Studio"
        title={job?.designId || "Production board"}
        description={
          job
            ? `Order # ${job.orderNumber} · Revision ${job.revision} · ${producedCount}/6 panels produced`
            : "No production run is reporting for this design yet."
        }
        backTo={`/designpro/jobs/${generationId}`}
        backLabel="Job"
        aside={job ? <StatePill state={job.state} /> : undefined}
      />

      {error && <Notice tone="warning">{error}</Notice>}

      {job && producedCount < PRODUCTION_SURFACES.length && (
        <Notice tone="warning">
          <div className="space-y-1">
            <strong className="block">
              {producedCount} of {PRODUCTION_SURFACES.length} print panels exist
            </strong>
            <span className="block">
              Call 9 has not produced every side. Panels are cut deterministically from
              the approved proof at GENIE dimensions with 5″ bleed — a missing side is
              server work, never a hand-built panel dropped in here.
            </span>
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link to={`/designpro/jobs/${generationId}`}>Open the job to see what is blocked</Link>
            </Button>
          </div>
        </Notice>
      )}

      {atlasRevisions.length > 0 && (() => {
        const selected = atlasRevisions[Math.min(atlasVersion, atlasRevisions.length - 1)];
        return (
          <Panel
            eyebrow="Call 1 · A.T.L.A.S."
            title="The canonical master every panel was cut from"
            description="The design team's authority, never the customer's. The buyer sees the seven 3D proofs and, in RevisionStudio, the six panels cut from this sheet."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Vehicle layout", url: selected.guideUrl, name: "atlas-vehicle-layout.png" },
                { label: "Flattened top-view master", url: selected.masterUrl, name: "atlas-master.png" },
              ].map(({ label, url, name }) => (
                <div key={label} className="rounded-lg border border-border p-2">
                  <div className="mb-1 text-xs font-semibold">{label}</div>
                  {url ? (
                    <>
                      <a href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt={label} className="aspect-[4/3] w-full rounded bg-white object-contain" />
                      </a>
                      <SaveLink url={url} name={name} />
                    </>
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                      <ImageOff className="mr-1.5 h-4 w-4" /> Not signed
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{selected.widthPx}×{selected.heightPx} px</span>
              <span>{Math.round(selected.effectivePpi * 10) / 10} effective PPI</span>
              <span>{selected.promptVersion}</span>
              <ContentHash value={selected.masterContentHash || ""} chars={14} />
            </div>

            {/* Version history. A revision starts a new A.T.L.A.S. lineage against
                the same design, so these are ordered oldest first and numbered
                across the whole generation rather than by per-request sequence. */}
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Version history · {atlasRevisions.length}
              </div>
              <div className="flex flex-wrap gap-2">
                {atlasRevisions.map((revision, index) => (
                  <button
                    key={revision.id}
                    type="button"
                    onClick={() => setAtlasVersion(index)}
                    className={cn(
                      "w-24 overflow-hidden rounded-lg border text-left transition",
                      index === Math.min(atlasVersion, atlasRevisions.length - 1)
                        ? "border-primary ring-1 ring-primary/40"
                        : "border-border hover:border-muted-foreground",
                    )}
                    title={revision.instruction || `Version ${index + 1}`}
                  >
                    {revision.masterUrl ? (
                      <img src={revision.masterUrl} alt={`Version ${index + 1}`} className="aspect-square w-full bg-white object-contain" />
                    ) : (
                      <div className="flex aspect-square items-center justify-center bg-muted text-muted-foreground">
                        <ImageOff className="h-4 w-4" />
                      </div>
                    )}
                    <div className="truncate border-t border-border px-1.5 py-1 text-[10px] font-semibold">
                      V{index + 1}
                    </div>
                  </button>
                ))}
              </div>
              {selected.instruction && (
                <p className="mt-2 text-xs text-muted-foreground">
                  This version was asked for: “{selected.instruction}”
                </p>
              )}
            </div>
          </Panel>
        );
      })()}

      <Panel
        eyebrow="Per-side validation"
        title="Download each panel, check it on the vehicle template, approve the side"
      >
        <div className="grid gap-4">
          {PRODUCTION_SURFACES.map((side) => (
            <SideCard
              key={side}
              surfaceKey={side}
              view={viewBySide.get(side)}
              panel={panelBySide.get(side)}
              approved={approvedSides.has(side)}
              onToggle={(next) => toggleSide(side, next)}
            />
          ))}
        </div>
      </Panel>

      {qcPanelBySide.size > 0 && (
        <Panel
          eyebrow="Call 11"
          title="De-logoed QC duplicates"
          description="Non-authoritative sizing/template instruments derived from the branded panels. They are never printed and never enter the output set."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PRODUCTION_SURFACES.filter((side) => qcPanelBySide.has(side)).map((side) => {
              const artifact = qcPanelBySide.get(side)!;
              return (
                <div key={side} className="rounded-lg border border-border p-2">
                  <div className="mb-1 text-xs font-semibold">{SURFACE_LABEL[side] || side}</div>
                  {artifact.signedUrl && (
                    <img
                      src={artifact.signedUrl}
                      alt={`${side} QC panel`}
                      className="aspect-video w-full rounded bg-white object-contain"
                    />
                  )}
                  <SaveLink url={artifact.signedUrl} name={`${side}-qc-panel.png`} />
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {logos.length > 0 && (
        <Panel
          eyebrow="Call 10"
          title={`Logo assets · ${logos.length}`}
          description="The separated logo inventory the design team resizes on a vehicle template, and the Logo Pack the customer can buy."
        >
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {logos.map((artifact) => (
              <div key={artifact.id} className="rounded-lg border border-border p-2">
                {artifact.signedUrl && (
                  <img
                    src={artifact.signedUrl}
                    alt="logo asset"
                    className="aspect-square w-full rounded bg-[repeating-conic-gradient(#0002_0_25%,transparent_0_50%)] bg-[length:16px_16px] object-contain"
                  />
                )}
                <div className="mt-1 truncate text-[10px] text-muted-foreground">
                  {artifact.surfaceKey || "unassigned"}
                </div>
                <SaveLink url={artifact.signedUrl} name={`logo-${artifact.id}.png`} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {upscaledBySide.size > 0 && (
        <Panel
          eyebrow="Call 12 · Topaz"
          title={`Print-resolution panels · ${upscaledBySide.size}/${PRODUCTION_SURFACES.length}`}
          description="The branded panels enhanced to print size after preflight. These are the production path; the QC duplicates are never upscaled."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PRODUCTION_SURFACES.filter((side) => upscaledBySide.has(side)).map((side) => {
              const artifact = upscaledBySide.get(side)!;
              return (
                <div key={side} className="rounded-lg border border-border p-2">
                  <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                    <span>{SURFACE_LABEL[side] || side}</span>
                    <span className="text-muted-foreground">{panelSize(artifact) || ""}</span>
                  </div>
                  {artifact.signedUrl && (
                    <img src={artifact.signedUrl} alt={`${side} upscaled panel`} className="aspect-video w-full rounded bg-white object-contain" />
                  )}
                  <ContentHash value={artifact.contentHash} />
                  <SaveLink url={artifact.signedUrl} name={`${side}-print.png`} />
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {outputs.length > 0 && (
        <Panel
          eyebrow="Production output"
          title={`Verified output files · ${outputs.length}/${EXPECTED_OUTPUT_FILES}`}
          description="Six surfaces × PNG, TIFF and EPS. The final gate signs off exactly these."
        >
          <div className="space-y-3">
            {OUTPUT_FORMATS.map((format) => {
              const rows = outputs.filter((artifact) => outputFormatOf(artifact.storagePath) === format);
              return (
                <div key={format} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
                    <span>{format}</span>
                    <span className="text-muted-foreground">
                      {rows.length}/{PRODUCTION_SURFACES.length}
                    </span>
                  </div>
                  {/* Presence alone cannot be signed off. The final gate asks a
                      human to certify resolution, print dimensions and colour
                      mode, which means the human has to be able to open the
                      file -- so every one of the eighteen is downloadable here,
                      not just counted. */}
                  <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {PRODUCTION_SURFACES.map((side) => {
                      const artifact = rows.find((row) => row.surfaceKey === side);
                      return (
                        <div
                          key={side}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]",
                            artifact ? "border-emerald-500/40" : "border-border",
                          )}
                        >
                          <span className={artifact ? "text-emerald-300" : "text-muted-foreground"}>
                            {SURFACE_LABEL[side] || side}
                          </span>
                          {artifact ? (
                            <span className="flex shrink-0 items-center gap-2">
                              <span className="text-muted-foreground">
                                {artifact.byteSize == null
                                  ? ""
                                  : `${(Number(artifact.byteSize) / 1_048_576).toFixed(1)} MB`}
                              </span>
                              <SaveLink url={artifact.signedUrl} name={`${side}-print.${format}`} />
                            </span>
                          ) : (
                            <span className="text-muted-foreground">pending</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel
        eyebrow="The gate"
        title="PanelPro preflight approval"
        description="Every side approved above, then every attestation below. This is the one server gate; nothing reaches Topaz or the output files without it."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span>
              {approvedSides.size}/{PRODUCTION_SURFACES.length} sides approved
            </span>
          </div>

          <div className="space-y-3">
            {PREFLIGHT_CHECKS.map(([key, label]) => (
              <label key={key} className="flex items-start gap-3 text-sm">
                <Checkbox
                  checked={checks[key] === true}
                  onCheckedChange={(value) => setChecks((current) => ({ ...current, [key]: value === true }))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Reviewer notes"
            rows={3}
          />

          {submitError && <Notice tone="error">{submitError}</Notice>}
          {!waitingForGate && job && (
            <Notice tone="info">
              This run is not at the preflight gate yet (current state: {job.state}).
            </Notice>
          )}

          <Button
            disabled={!everySideApproved || !everyCheckTicked || submitting || !waitingForGate}
            onClick={() => void submit()}
          >
            {submitting ? "Submitting…" : "Approve preflight"}
          </Button>
        </div>
      </Panel>

      {/* The second gate. Preflight releases the panels into Topaz and the output
          build; this one signs off the finished files and is what lets the run
          stamp, zip and deliver to WrapBox. */}
      <Panel
        eyebrow="Final production QC"
        title="Sign off the finished output files"
        description="The last gate before the QC stamp, the ZIP and the WrapBox delivery."
      >
        <div className="space-y-4">
          <div className="space-y-3">
            {FINAL_CHECKS.map(([key, label]) => (
              <label key={key} className="flex items-start gap-3 text-sm">
                <Checkbox
                  checked={finalChecks[key] === true}
                  onCheckedChange={(value) => setFinalChecks((current) => ({ ...current, [key]: value === true }))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <Textarea
            value={finalNotes}
            onChange={(event) => setFinalNotes(event.target.value)}
            placeholder="Final reviewer notes"
            rows={3}
          />

          {finalError && <Notice tone="error">{finalError}</Notice>}
          {!waitingForFinal && job && (
            <Notice tone="info">
              This run is not at the final QC gate yet (current state: {job.state}).
            </Notice>
          )}

          <Button
            disabled={!everyFinalTicked || finalSubmitting || !waitingForFinal}
            onClick={() => void submitFinal()}
          >
            {finalSubmitting ? "Submitting…" : "Approve final QC"}
          </Button>
        </div>
      </Panel>

      <Panel
        eyebrow="Delivery"
        title="Stamp, ZIP and WrapBox"
        description="What the run produced after the final gate. Nothing here is built in the browser."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
              <ShieldCheck className="h-4 w-4" /> QC stamp
            </div>
            {stamp ? (
              <>
                {stamp.signedUrl && (
                  <img src={stamp.signedUrl} alt="QC certificate" className="w-full rounded border border-border bg-white object-contain" />
                )}
                <SaveLink url={stamp.signedUrl} name="qc-certificate.png" />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Produced after final QC approval.</p>
            )}
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
              <FileArchive className="h-4 w-4" /> Production ZIP
            </div>
            {zip ? (
              <>
                <ContentHash value={zip.contentHash} />
                <SaveLink url={zip.signedUrl} name="production-pack.zip" />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Built once the stamp exists.</p>
            )}
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
              <PackageCheck className="h-4 w-4" /> WrapBox
            </div>
            {wrapbox ? (
              <>
                <ContentHash value={wrapbox.contentHash} />
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link to="/designpro/wrapbox">Open WrapBox</Link>
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Delivered after the ZIP is sealed.</p>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
