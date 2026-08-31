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
import { JobWorkflowHeader } from "@/components/designpro/JobWorkflowHeader";
import { FullQcPanel } from "@/components/designpro/FullQcPanel";
import type { PanelQcReport } from "@/lib/designpro-panel-qc";
import { CheckCircle2, Download, FileArchive, ImageOff, PackageCheck, ShieldCheck, UploadCloud, Wand2 } from "lucide-react";
import {
  ApiError,
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
import {
  assetsForVersion,
  designVersionsFrom,
  exactTimestamp,
} from "@/lib/design-version-history";
import { cn } from "@/lib/utils";

/** A stable empty list, so a side with no history does not remount its card. */
const EMPTY_ARTIFACTS: WorkflowArtifact[] = [];

function inches(value: unknown): string | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number.isInteger(parsed) ? String(parsed) : String(Math.round(parsed * 100) / 100);
}

/**
 * The panel's own stamped geometry. Call 9 writes `printWidthInches` /
 * `printHeightInches` (trim plus the 5" bleed on every edge) and the trim
 * separately -- the older `printWidthIn` / `widthInches` spellings are read too
 * so an artifact from before that naming still shows its size instead of
 * silently rendering nothing.
 */
function panelGeometry(artifact: WorkflowArtifact | undefined) {
  const metadata = (artifact?.metadata || {}) as Record<string, unknown>;
  const printWidthIn = Number(metadata.printWidthInches ?? metadata.printWidthIn ?? metadata.widthInches);
  const printHeightIn = Number(metadata.printHeightInches ?? metadata.printHeightIn ?? metadata.heightInches);
  const trimWidthIn = Number(metadata.trimWidthInches ?? metadata.trimWidthIn);
  const trimHeightIn = Number(metadata.trimHeightInches ?? metadata.trimHeightIn);
  return {
    printWidthIn: Number.isFinite(printWidthIn) && printWidthIn > 0 ? printWidthIn : null,
    printHeightIn: Number.isFinite(printHeightIn) && printHeightIn > 0 ? printHeightIn : null,
    trimWidthIn: Number.isFinite(trimWidthIn) && trimWidthIn > 0 ? trimWidthIn : null,
    trimHeightIn: Number.isFinite(trimHeightIn) && trimHeightIn > 0 ? trimHeightIn : null,
    surfaceSqFt: Number(metadata.surfaceSqFt) > 0 ? Number(metadata.surfaceSqFt) : null,
  };
}

function panelSize(artifact: WorkflowArtifact | undefined): string | null {
  if (!artifact) return null;
  const { printWidthIn, printHeightIn } = panelGeometry(artifact);
  const width = inches(printWidthIn);
  const height = inches(printHeightIn);
  return width && height ? `${width}″ × ${height}″` : null;
}

/** The print target every panel is enhanced to: 150 PPI across trim + 5" bleed. */
const PRINT_TARGET_PPI = 150;

/** The pixel width the enhancement started from, as the derivative recorded it. */
function sourcePixelWidth(artifact: WorkflowArtifact): number | null {
  const pixels = (artifact.metadata || {})["sourcePixels"] as { widthPx?: unknown } | undefined;
  const width = Number(pixels?.widthPx);
  return Number.isFinite(width) && width > 0 ? width : null;
}

function SideCard({
  surfaceKey,
  view,
  panel,
  corrections,
  upscaled,
  approved,
  onToggle,
  onCorrect,
  onUpscale,
}: {
  surfaceKey: GenieSurfaceKey;
  view: ApprovedGenerationView | undefined;
  panel: WorkflowArtifact | undefined;
  /** Every human correction for this side, newest first. */
  corrections: WorkflowArtifact[];
  /** Every enhanced derivative for this side, newest first. */
  upscaled: WorkflowArtifact[];
  approved: boolean;
  onToggle: (next: boolean) => void;
  onCorrect: (surfaceKey: GenieSurfaceKey, file: File, reason: string) => Promise<void>;
  onUpscale: (surfaceKey: GenieSurfaceKey) => Promise<void>;
}) {
  const size = panelSize(panel);
  // THE PAIR MUST COME FROM ONE MASTER, AND THIS IS WHERE THAT IS CHECKED.
  //
  // A.T.L.A.S. authors one flattened master, the six panels are deterministic
  // extractions of it, and each proof is conditioned on that same surface's
  // region -- the runtime already refuses to render a proof whose conditioning
  // bytes do not hash to the master zone. But the two halves of this card
  // arrive from different endpoints, and until now nothing compared them here:
  // a panel cut from a different master, or from an earlier revision, would sit
  // beside its proof looking perfectly normal. Both sides already publish the
  // binding -- `atlasBinding.masterContentHash` on the view, `sourceMasterHash`
  // on the panel artifact -- so the check costs a comparison and turns "looks
  // wired" into "is wired".
  //
  // Only a real disagreement is called out. A Standard run has no master, and
  // an older artifact predating the binding carries no hash; neither is drift,
  // so neither is reported as drift.
  const proofMaster = view?.atlasBinding?.masterContentHash || null;
  const panelMaster = typeof panel?.metadata?.sourceMasterHash === "string"
    ? panel.metadata.sourceMasterHash
    : null;
  const lineageKnown = Boolean(proofMaster && panelMaster);
  const lineageMatches = lineageKnown && proofMaster === panelMaster;

  // THE ACTIVE PRODUCTION ARTIFACT FOR THIS SIDE.
  //
  // Normally the Call 9 panel. When the team has corrected one against the real
  // vehicle template, the newest correction is what Call 12 enhances and what
  // reaches print -- so it is what this card shows as active, with the branded
  // original still downloadable beside it. Both are kept; neither replaces the
  // other in the vault.
  const active = corrections[0] || panel;
  const correctedActive = Boolean(corrections[0]);
  const [correctionFile, setCorrectionFile] = useState<File | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [trimOnly, setTrimOnly] = useState(false);
  const [upscaling, setUpscaling] = useState(false);
  const [upscaleError, setUpscaleError] = useState("");
  // THE ACTIVE PANEL'S REAL PIXEL SIZE, MEASURED RATHER THAN ASSUMED.
  //
  // A Call 9 panel stamps its own pixel dimensions, but a human-corrected file
  // arrives from a designer's machine and carries none -- the server records
  // what it was told, not what it decoded. Reading naturalWidth off the image
  // the card already loaded is the honest answer for both, and it is what makes
  // the effective-DPI figure below true of the file actually sitting there.
  const [activePixels, setActivePixels] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => { setActivePixels(null); }, [active?.contentHash]);

  const geometry = panelGeometry(panel);
  /**
   * How much of the panel is bleed, as a percentage of each axis.
   *
   * The panel is trim plus exactly 5 inches on every edge, so the trim box is
   * inset by 5/printInches on each side. Null when the panel does not state
   * both its trim and print inches -- an inset guessed from one of them would
   * draw the cut line in the wrong place, and a wrong cut line is worse than
   * no cut line.
   */
  const trimInsetPct = geometry.printWidthIn && geometry.printHeightIn
    && geometry.trimWidthIn && geometry.trimHeightIn
    ? {
        x: ((geometry.printWidthIn - geometry.trimWidthIn) / 2 / geometry.printWidthIn) * 100,
        y: ((geometry.printHeightIn - geometry.trimHeightIn) / 2 / geometry.printHeightIn) * 100,
      }
    : null;
  const latestUpscale = upscaled[0];
  // An enhancement made from bytes that are no longer active is stale: the team
  // corrected the panel after it ran, so it enhanced the file they rejected.
  const upscaleSourceHash = typeof latestUpscale?.metadata?.sourcePanelHash === "string"
    ? latestUpscale.metadata.sourcePanelHash
    : null;
  const upscaleCurrent = Boolean(latestUpscale && upscaleSourceHash === active?.contentHash);
  const sourceWidthPx = activePixels?.w
    ?? (Number((active?.metadata as Record<string, unknown> | undefined)?.pixelWidth) || null);
  const sourceHeightPx = activePixels?.h
    ?? (Number((active?.metadata as Record<string, unknown> | undefined)?.pixelHeight) || null);
  // Effective DPI is what the file can actually print at across its own physical
  // size -- pixels over inches. It is the number that decides whether a panel
  // needs enhancing, so it is computed here rather than read from a field that
  // may describe a different artifact.
  const effectiveDpi = sourceWidthPx && geometry.printWidthIn
    ? Math.round((sourceWidthPx / geometry.printWidthIn) * 10) / 10
    : null;
  const targetWidthPx = geometry.printWidthIn ? Math.round(geometry.printWidthIn * PRINT_TARGET_PPI) : null;
  const targetHeightPx = geometry.printHeightIn ? Math.round(geometry.printHeightIn * PRINT_TARGET_PPI) : null;

  const runUpscale = async () => {
    setUpscaling(true);
    setUpscaleError("");
    try {
      await onUpscale(surfaceKey);
    } catch (cause) {
      setUpscaleError(cause instanceof Error ? cause.message : "The upscale was refused.");
    } finally {
      setUpscaling(false);
    }
  };

  const submitCorrection = async () => {
    if (!correctionFile || correctionReason.trim().length < 8) return;
    setCorrecting(true);
    setCorrectionError("");
    try {
      await onCorrect(surfaceKey, correctionFile, correctionReason.trim());
      setCorrectionFile(null);
      setCorrectionReason("");
      setCorrectionOpen(false);
    } catch (cause) {
      setCorrectionError(cause instanceof Error ? cause.message : "The correction was refused.");
    } finally {
      setCorrecting(false);
    }
  };

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
          <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>
              {trimOnly ? "Panel · trim, no bleed" : "Panel with 5″ bleed"}
              {correctedActive ? " · corrected" : ""}
            </span>
            <span className="flex items-center gap-1.5">
              {correctedActive && (
                <Badge variant="outline" className="border-amber-500/60 text-amber-600 dark:text-amber-400">
                  human corrected
                </Badge>
              )}
              {/* THE SAME BYTES, SHOWN TWO WAYS. Not a second file and not a
                  second producer: the panel IS trim plus 5" of bleed on every
                  edge, so the trim view is that exact artifact displayed
                  without its margin, and the bleed view draws the cut line on
                  top of it. What the installer cuts to becomes something the
                  team can see rather than something they have to imagine. */}
              {trimInsetPct && (
                <button
                  type="button"
                  onClick={() => setTrimOnly((on) => !on)}
                  className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal hover:bg-muted"
                >
                  {trimOnly ? "Show bleed" : "Show trim"}
                </button>
              )}
            </span>
          </div>
          {active?.signedUrl ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-white">
              <img
                src={active.signedUrl}
                alt={`${surfaceKey} print panel`}
                className="h-full w-full object-contain"
                style={trimOnly && trimInsetPct
                  ? {
                      // Scale the panel up so its trim box fills the frame, and
                      // pull the bleed off every edge. Pure display geometry
                      // derived from the panel's own stamped inches.
                      transform: `scale(${100 / (100 - 2 * trimInsetPct.x)}, ${100 / (100 - 2 * trimInsetPct.y)})`,
                    }
                  : undefined}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth && image.naturalHeight) {
                    setActivePixels({ w: image.naturalWidth, h: image.naturalHeight });
                  }
                }}
              />
              {/* Where the cut lands, on the bleed view. */}
              {!trimOnly && trimInsetPct && (
                <div
                  className="pointer-events-none absolute border border-dashed border-destructive/70"
                  style={{
                    left: `${trimInsetPct.x}%`,
                    right: `${trimInsetPct.x}%`,
                    top: `${trimInsetPct.y}%`,
                    bottom: `${trimInsetPct.y}%`,
                  }}
                />
              )}
            </div>
          ) : (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted-foreground">
              <ImageOff className="h-4 w-4" />
              Not produced yet
            </div>
          )}
          {active && <ContentHash value={active.contentHash} />}
        </div>
      </div>

      {/* One line stating whether this proof and this panel are the same
          design. It is the whole point of showing them side by side. */}
      {(view || panel) && (
        <div
          className={cn(
            "mt-2 text-[11px] font-semibold",
            !lineageKnown
              ? "text-muted-foreground"
              : lineageMatches
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-destructive",
          )}
        >
          {!lineageKnown
            ? "No master binding on this pair"
            : lineageMatches
              ? "Proof and panel share one A.T.L.A.S. master"
              : "DIFFERENT MASTERS — this panel was not cut from the proof's design"}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {active?.signedUrl && (
          <Button asChild size="sm" variant="outline">
            <a href={active.signedUrl} download={`${surfaceKey}-print-panel.png`}>
              <Download className="mr-1 h-4 w-4" />
              {correctedActive ? "Download corrected panel" : "Download panel"}
            </a>
          </Button>
        )}
        {/* The branded Call 9 panel stays downloadable even when a correction is
            active. Both versions are kept on purpose: the original is what the
            server produced and what the correction is bound to. */}
        {correctedActive && panel?.signedUrl && (
          <Button asChild size="sm" variant="ghost">
            <a href={panel.signedUrl} download={`${surfaceKey}-original-panel.png`}>
              <Download className="mr-1 h-4 w-4" /> Original
            </a>
          </Button>
        )}
        {panel && (
          <Button size="sm" variant="ghost" onClick={() => setCorrectionOpen((open) => !open)}>
            <UploadCloud className="mr-1 h-4 w-4" />
            {correctionOpen ? "Cancel correction" : "Upload corrected panel"}
          </Button>
        )}
        {/* A side whose panel came from a different master cannot be approved.
            This gate releases artwork to print; signing off a pair that is
            provably not the same design is the one thing it must never do. */}
        <Button
          size="sm"
          variant={approved ? "secondary" : "default"}
          disabled={!panel || (lineageKnown && !lineageMatches)}
          onClick={() => onToggle(!approved)}
        >
          <CheckCircle2 className="mr-1 h-4 w-4" />
          {approved ? "Approved · undo" : "Approve side"}
        </Button>
        {lineageKnown && !lineageMatches && (
          <span className="text-xs text-destructive">
            Approval is blocked until the panel is cut from this proof's master.
          </span>
        )}
        {!panel && (
          <span className="text-xs text-muted-foreground">
            The server produces this panel at Call 9. It is never hand-built here.
          </span>
        )}
      </div>

      {/* PRODUCTION RESOLUTION, AND THE REAL UPSCALE ON DEMAND.
          A panel is cut from a 4096px master shared by six surfaces, so a long
          side leaves Call 9 at roughly 20 PPI against a 150-PPI print target.
          Call 12 enhances all six automatically once the purchase and preflight
          gates release; this runs that same enhancement on one side, now, so the
          team can watch a panel reach print geometry and check the result before
          trusting it unattended. It writes a NEW derivative -- the panel it came
          from is never touched and stays downloadable above. */}
      {active && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Production resolution
            </span>
            <Badge
              variant={upscaleCurrent ? "default" : latestUpscale ? "outline" : "secondary"}
              className={cn(!upscaleCurrent && latestUpscale && "border-amber-500/60 text-amber-600 dark:text-amber-400")}
            >
              {upscaleCurrent
                ? "Upscaled"
                : latestUpscale
                  ? "Upscale stale — active panel changed"
                  : "Not upscaled"}
            </Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-5">
            <div>
              <dt className="text-muted-foreground">Source resolution</dt>
              <dd className="font-mono font-semibold">
                {sourceWidthPx && sourceHeightPx ? `${sourceWidthPx} × ${sourceHeightPx} px` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Trim (no bleed)</dt>
              <dd className="font-mono font-semibold">
                {inches(geometry.trimWidthIn) && inches(geometry.trimHeightIn)
                  ? `${inches(geometry.trimWidthIn)}″ × ${inches(geometry.trimHeightIn)}″`
                  : "—"}
                {geometry.surfaceSqFt && (
                  <span className="ml-1 font-sans font-normal text-muted-foreground">
                    · {geometry.surfaceSqFt} sq ft
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Final physical size</dt>
              <dd className="font-mono font-semibold">
                {inches(geometry.printWidthIn) && inches(geometry.printHeightIn)
                  ? `${inches(geometry.printWidthIn)}″ × ${inches(geometry.printHeightIn)}″`
                  : "—"}
                {geometry.trimWidthIn && geometry.trimHeightIn && (
                  <span className="ml-1 font-sans font-normal text-muted-foreground">
                    (trim {inches(geometry.trimWidthIn)}″ × {inches(geometry.trimHeightIn)}″ + 5″ bleed)
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Effective DPI</dt>
              <dd
                className={cn(
                  "font-mono font-semibold",
                  effectiveDpi !== null && effectiveDpi < PRINT_TARGET_PPI && "text-amber-600 dark:text-amber-400",
                )}
              >
                {effectiveDpi === null ? "—" : `${effectiveDpi} PPI`}
                {targetWidthPx && (
                  <span className="ml-1 font-sans font-normal text-muted-foreground">
                    / {PRINT_TARGET_PPI} target
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Upscale status</dt>
              <dd className="font-mono font-semibold">
                {latestUpscale
                  ? `${Number(latestUpscale.metadata?.widthPx) || "?"} × ${Number(latestUpscale.metadata?.heightPx) || "?"} px`
                  : targetWidthPx && targetHeightPx
                    ? `target ${targetWidthPx} × ${targetHeightPx} px`
                    : "—"}
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={upscaling} onClick={() => void runUpscale()}>
              <Wand2 className="mr-1 h-4 w-4" />
              {upscaling ? "Upscaling — this takes a few minutes…" : "Run upscale"}
            </Button>
            {latestUpscale?.signedUrl && (
              <Button asChild size="sm" variant="ghost">
                <a href={latestUpscale.signedUrl} download={`${surfaceKey}-upscaled.png`}>
                  <Download className="mr-1 h-4 w-4" /> Download upscaled
                </a>
              </Button>
            )}
            <span className="text-[11px] text-muted-foreground">
              Runs the production enhancement. The source panel is never overwritten.
            </span>
          </div>
          {upscaleError && (
            <div className="mt-2">
              <Notice tone="error">{upscaleError}</Notice>
            </div>
          )}

          {/* ORIGINAL BESIDE ENHANCED. The point of running this by hand is to
              look at the result, so the two are shown together rather than the
              derivative replacing the panel above. */}
          {latestUpscale?.signedUrl && active.signedUrl && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Source panel
                </div>
                <img
                  src={active.signedUrl}
                  alt={`${surfaceKey} source panel`}
                  className="aspect-video w-full rounded border border-border bg-white object-contain"
                />
              </div>
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Upscaled derivative
                </div>
                <img
                  src={latestUpscale.signedUrl}
                  alt={`${surfaceKey} upscaled panel`}
                  className="aspect-video w-full rounded border border-border bg-white object-contain"
                />
              </div>
            </div>
          )}

          {/* Enhancement history. Every derivative says which artifact it was
              made from and by what factor, so a stale one is readable as stale
              rather than merely older. */}
          {upscaled.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-border pt-2">
              {upscaled.map((item, index) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                  <Badge variant={index === 0 ? "default" : "outline"}>
                    {index === 0 ? "newest" : "superseded"}
                  </Badge>
                  <span className="font-mono text-muted-foreground">
                    {sourcePixelWidth(item) ?? "?"}px → {Number(item.metadata?.widthPx) || "?"}px
                  </span>
                  {item.metadata?.humanCorrected === true && (
                    <Badge variant="outline" className="border-amber-500/60 text-amber-600 dark:text-amber-400">
                      from corrected panel
                    </Badge>
                  )}
                  {item.metadata?.clampedByEngineCeiling === true && (
                    <span className="text-amber-600 dark:text-amber-400">clamped by engine ceiling</span>
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                    from {String(item.metadata?.sourcePanelHash || "").slice(0, 12)}
                  </span>
                  <SaveLink url={item.signedUrl} name={`${surfaceKey}-upscaled.png`} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* THE AUDITED CORRECTION. Not a producer: the file is one a designer
          corrected against the real vehicle template, and it is recorded against
          this exact surface and revision with a reason. The Call 9 panel is left
          byte-for-byte -- it stays downloadable above and stays what the
          correction is bound to -- and Call 12 enhances whichever artifact is
          active, so a corrected side reaches print through Topaz and the output
          build like any other, never around them. */}
      {correctionOpen && panel && (
        <div className="mt-3 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-xs text-muted-foreground">
            Upload the file you re-output against the real vehicle template. The original
            panel is kept and stays bound to this correction; the corrected file becomes
            the active production artwork for {SURFACE_LABEL[surfaceKey] || surfaceKey}.
          </p>
          <input
            type="file"
            accept="image/png,image/jpeg,application/pdf"
            className="block w-full text-xs file:mr-3 file:rounded file:border file:border-border file:bg-background file:px-2 file:py-1 file:text-xs"
            onChange={(event) => setCorrectionFile(event.target.files?.[0] || null)}
          />
          <Textarea
            value={correctionReason}
            onChange={(event) => setCorrectionReason(event.target.value)}
            placeholder="What did not fit on the template, and what you changed"
            rows={2}
          />
          {correctionError && <Notice tone="error">{correctionError}</Notice>}
          <Button
            size="sm"
            disabled={!correctionFile || correctionReason.trim().length < 8 || correcting}
            onClick={() => void submitCorrection()}
          >
            {correcting ? "Recording…" : "Record correction"}
          </Button>
        </div>
      )}

      {/* Correction history. Additive: correcting twice keeps both, newest
          active, and every entry says who, when and why. */}
      {corrections.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Correction history · {corrections.length}
          </div>
          <ul className="space-y-1">
            {corrections.map((correction, index) => (
              <li key={correction.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                <Badge variant={index === 0 ? "default" : "outline"}>
                  {index === 0 ? "active" : "superseded"}
                </Badge>
                <span className="text-muted-foreground">
                  {String(correction.metadata?.correctedAt || "")}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {String(correction.metadata?.reason || "")}
                </span>
                <SaveLink url={correction.signedUrl} name={`${surfaceKey}-corrected.png`} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function PanelProStudioBoard() {
  const { generationId = "" } = useParams();
  const [job, setJob] = useState<WorkflowStatus>();
  const [allViews, setViews] = useState<ApprovedGenerationView[]>([]);
  const [allArtifacts, setArtifacts] = useState<WorkflowArtifact[]>([]);
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
  // The deterministic panel QC verdict for the panels currently on screen.
  // Held here rather than in the QC card so the workflow header can reflect
  // it -- one answer about this job, not two.
  const [qcReport, setQcReport] = useState<PanelQcReport | null>(null);

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

  /**
   * THE SAME VERSION HISTORY REVISIONSTUDIO SHOWS.
   *
   * One reader, one numbering, one prompt store. A revision created in
   * RevisionStudio appears here because both surfaces call the same function --
   * not because anything is copied or synchronised.
   */
  const versionHistory = useMemo(
    () => designVersionsFrom({ generationId, job, revisions: atlasRevisions }),
    [generationId, job, atlasRevisions],
  );
  const selectedVersion = versionHistory.versions.length
    ? versionHistory.versions[Math.min(atlasVersion, versionHistory.versions.length - 1)]
    : null;

  /**
   * SELECTING A VERSION SWITCHES THE WHOLE WORKSPACE, AND NEVER MIXES TWO.
   *
   * Every panel records the master it was cut from and every proof records the
   * master it was conditioned on, so membership is a hash comparison rather
   * than a guess from timestamps or from whichever artifact is newest. Picking
   * V2 shows V2's proofs, V2's panels, V2's corrections, V2's enhancements and
   * V2's logos, and nothing from V1.
   *
   * An artifact carrying no master binding is not silently attributed to the
   * selected version -- it predates the binding or came from a Standard run.
   * Hiding it would empty the board for every such run, and labelling it V2
   * would be the version mixing this exists to stop, so it is shown alongside
   * and the surface card reports it as unbound.
   */
  const { views, artifacts } = useMemo(() => {
    const scoped = assetsForVersion(selectedVersion, allArtifacts, allViews);
    return {
      views: [...scoped.views, ...scoped.unboundViews],
      artifacts: [...scoped.artifacts, ...scoped.unboundArtifacts],
    };
  }, [selectedVersion, allArtifacts, allViews]);

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

  // Every correction for a side, newest first. Newest is the active production
  // artifact; the rest are kept so the history is readable rather than implied.
  const correctionsBySide = useMemo(() => {
    const rows = new Map<string, WorkflowArtifact[]>();
    for (const artifact of artifacts) {
      if (artifact.kind !== "corrected-panel") continue;
      const list = rows.get(artifact.surfaceKey) || [];
      list.push(artifact);
      rows.set(artifact.surfaceKey, list);
    }
    for (const list of rows.values()) {
      list.sort((left, right) =>
        String(right.metadata?.correctedAt || "").localeCompare(String(left.metadata?.correctedAt || "")));
    }
    return rows;
  }, [artifacts]);

  /**
   * Record a corrected panel and reload.
   *
   * The upload is keyed by the run's own revision, which is the only namespace
   * outside the run prefix the server admits a designer's file into. A run whose
   * revision the gateway has not reported cannot take a correction -- refusing
   * here is what stops the file landing somewhere the storage identity check
   * would later reject.
   */
  const correctPanel = useCallback(async (
    surfaceKey: GenieSurfaceKey,
    file: File,
    reason: string,
  ) => {
    if (!job?.revisionId) {
      throw new Error("This run has no reported revision, so a correction cannot be bound to it.");
    }
    await dpApi.uploadCorrectedPanel({
      generationId,
      revisionId: job.revisionId,
      surfaceKey,
      file,
      reason,
    });
    await load();
  }, [generationId, job?.revisionId, load]);

  /**
   * The dimension sheet, read off the panels rather than recomputed.
   *
   * Every number here is one the server stamped on the artifact when it cut the
   * panel. Deriving them again in the browser -- from the GENIE manifest, or
   * from the image, or from a vehicle table -- would produce a second set of
   * numbers that agrees with the first only by luck, and a designer checking a
   * template against the wrong one has no way to tell.
   */
  const dimensionSheet = useMemo(() => {
    const surfaces = PRODUCTION_SURFACES.map((side) => {
      const correction = (correctionsBySide.get(side) || [])[0];
      const active = correction || panelBySide.get(side);
      if (!active) return null;
      const source = panelBySide.get(side);
      const metadata = (source?.metadata || {}) as Record<string, unknown>;
      const trimWidth = inches(metadata.trimWidthIn ?? metadata.widthInches);
      const trimHeight = inches(metadata.trimHeightIn ?? metadata.heightInches);
      const printWidth = inches(metadata.printWidthIn);
      const printHeight = inches(metadata.printHeightIn);
      const sqft = Number(metadata.surfaceSqFt);
      return {
        surfaceKey: side,
        label: SURFACE_LABEL[side] || side,
        trim: trimWidth && trimHeight ? `${trimWidth}″ × ${trimHeight}″` : null,
        print: printWidth && printHeight ? `${printWidth}″ × ${printHeight}″` : null,
        surfaceSqFt: Number.isFinite(sqft) && sqft > 0 ? Math.round(sqft * 100) / 100 : null,
        bleedInches: Number(metadata.bleedInches) || null,
        humanCorrected: Boolean(correction),
        contentHash: active.contentHash,
        sourceMasterHash: typeof metadata.sourceMasterHash === "string" ? metadata.sourceMasterHash : null,
      };
    }).filter(Boolean) as Array<Record<string, unknown> & { surfaceKey: string; trim: string | null; print: string | null; surfaceSqFt: number | null; humanCorrected: boolean; contentHash: string }>;
    const document = {
      contract: "designpro.dimension-sheet.v1",
      generationId,
      designId: job?.designId || null,
      orderNumber: job?.orderNumber || null,
      revision: job?.revision ?? null,
      surfaces,
    };
    return {
      surfaces,
      href: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(document, null, 2))}`,
    };
  }, [correctionsBySide, panelBySide, generationId, job?.designId, job?.orderNumber, job?.revision]);

  /**
   * The complete design-team record for the selected immutable A.T.L.A.S.
   * version. The UI renders the fields reviewers use most and makes this exact
   * object downloadable for a forensic/QC handoff. Nothing is recomputed here:
   * every value came from the canonical status, revision, proof or panel row.
   */
  const forensicRecord = useMemo(() => {
    if (!selectedVersion) return null;
    const selected = selectedVersion.revision;
    return {
      contract: "designpro.panelpro-forensic-record.v1",
      generationId,
      designId: job?.designId || null,
      orderNumber: job?.orderNumber || null,
      runRevisionId: job?.revisionId || null,
      runRevision: job?.revision ?? null,
      state: job?.state || null,
      currentStage: job?.currentStage || null,
      createdAt: job?.createdAt || null,
      updatedAt: job?.updatedAt || null,
      vehicle: job?.vehicle || null,
      prompts: {
        originalBrief: job?.brief || null,
        selectedVersionPrompt: selectedVersion.prompt,
        selectedVersionPromptKind: selectedVersion.promptKind,
        promptContractVersion: selected.promptVersion,
        promptHash: selected.provenance?.promptHash || null,
        history: versionHistory.versions.map((version) => ({
          version: version.version,
          revisionId: version.revisionId,
          parentRevisionId: version.parentRevisionId,
          kind: version.promptKind,
          prompt: version.prompt,
          createdAt: version.createdAt,
          masterContentHash: version.masterContentHash,
        })),
      },
      atlas: selected,
      proofs: views.map((view) => ({
        id: view.id,
        surfaceKey: view.surfaceKey,
        sourceViewType: view.sourceViewType,
        contentHash: view.contentHash,
        byteSize: view.byteSize,
        contentType: view.contentType,
        atlasBinding: view.atlasBinding,
      })),
      panels: PRODUCTION_SURFACES.map((surfaceKey) => {
        const panel = panelBySide.get(surfaceKey);
        return panel ? {
          id: panel.id,
          surfaceKey,
          contentHash: panel.contentHash,
          byteSize: panel.byteSize,
          metadata: panel.metadata,
        } : { surfaceKey, missing: true };
      }),
    };
  }, [generationId, job, panelBySide, selectedVersion, versionHistory.versions, views]);
  const forensicRecordHref = forensicRecord
    ? `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(forensicRecord, null, 2))}`
    : "";

  const logos = useMemo(() => artifacts.filter((a) => a.kind === "logo"), [artifacts]);
  // Every enhanced derivative for a side, newest first. A side can carry more
  // than one: correcting a panel and enhancing again produces a second, and
  // both stay readable so a stale enhancement is visible as stale rather than
  // quietly replaced.
  const upscaledBySide = useMemo(() => {
    const rows = new Map<string, WorkflowArtifact[]>();
    for (const artifact of artifacts) {
      if (artifact.kind !== "upscaled-panel") continue;
      const list = rows.get(artifact.surfaceKey) || [];
      list.push(artifact);
      rows.set(artifact.surfaceKey, list);
    }
    return rows;
  }, [artifacts]);

  /**
   * RUN THE REAL UPSCALE ON ONE SIDE.
   *
   * The gateway hands this to the runtime, which reads the side's ACTIVE
   * artifact -- the newest human correction when there is one, the branded Call
   * 9 panel otherwise -- hash-verifies it, and runs the same Topaz enhancement
   * Call 12 runs on all six. It writes a NEW artifact; nothing is overwritten.
   *
   * It is slow on purpose: a print-geometry enhancement of a long side takes
   * minutes, and the button says so rather than appearing to hang.
   */
  const runUpscale = useCallback(async (surfaceKey: GenieSurfaceKey) => {
    try {
      await dpApi.runPanelUpscale(generationId, surfaceKey);
      await load();
    } catch (cause) {
      // A LOST CONNECTION IS NOT A LOST ENHANCEMENT.
      //
      // The runtime holds the request open for the whole Topaz call, and a long
      // side can outlast the proxy's response window. The work does not stop
      // when the socket does: the derivative is still written, hashed and bound
      // to its source. Reporting this as a failure would send the operator to
      // press the button again on an enhancement that already succeeded, so the
      // board reloads first and says what actually happened.
      await load().catch(() => {});
      const code = cause instanceof ApiError ? cause.code : "";
      if (cause instanceof ApiError && (cause.status === 504 || cause.status === 503 || /timeout|unavailable/i.test(code))) {
        throw new Error(
          "The connection closed before the enhancement reported back. It is most likely still running on the server — reload in a few minutes and check the enhancement history before running it again.",
        );
      }
      throw cause;
    }
  }, [generationId, load]);
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
      {/* DESIGN → REVISE → PANELS → QC → WRAPBOX, carrying this job. */}
      <JobWorkflowHeader
        generationId={generationId}
        current="panels"
        qcPassed={Boolean(qcReport?.passed)}
        className="-mx-4 -mt-8 mb-2 md:-mx-6"
      />
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

      {/* THE PARALLEL CONSUMER OF THE SAME LINEAGE.
          RULE 0.21: RevisionStudioIQ and PanelPro Studio are two consumers of
          one server-owned lineage, never two workflows. The board validates and
          releases the panels; the studio is where the design is revised. This
          is the route between them, on the same generation id, so a reviewer
          who finds a problem here can reach the surface that fixes it without
          knowing a URL. */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>Same design, revision workspace:</span>
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to={`/revision-studio?id=${encodeURIComponent(generationId)}`}>
            Open in RevisionStudioIQ
          </Link>
        </Button>
      </div>

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

      {selectedVersion && (() => {
        const selected = selectedVersion.revision;
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
              <span>{selected.master.widthPx}×{selected.master.heightPx} px</span>
              <span>{Math.round(selected.master.effectivePpi * 10) / 10} effective PPI</span>
              <span>{selected.promptVersion}</span>
              <ContentHash value={selected.master.contentHash || ""} chars={14} />
            </div>

            {/* THE DESIGN TEAM'S FORENSIC / QC RECORD. The server already
                persists this evidence on the immutable revision; hiding it in
                JSON made the operator guess whether a master passed, which
                prompt contract made it, and whether 4K was actually delivered.
                Show the high-signal fields here and preserve the entire exact
                record as a downloadable JSON manifest. */}
            <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    Vehicle, prompt and A.T.L.A.S. QC record
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Canonical metadata for this exact GenerationID and revision.
                  </p>
                </div>
                {forensicRecordHref && (
                  <Button asChild size="sm" variant="outline">
                    <a href={forensicRecordHref} download={`${job?.designId || generationId}-atlas-forensic-record.json`}>
                      <Download className="mr-1 h-4 w-4" /> Download record
                    </a>
                  </Button>
                )}
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <div><dt className="text-muted-foreground">Vehicle</dt><dd className="font-semibold">{[job?.vehicle?.year, job?.vehicle?.make, job?.vehicle?.model].filter(Boolean).join(" ") || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Vehicle type</dt><dd className="font-semibold">{job?.vehicle?.type || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Pipeline</dt><dd className="font-mono text-[11px]">{selected.provenance?.pipelineMode || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Authoring model</dt><dd className="font-mono text-[11px]">{selected.model || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Prompt contract</dt><dd className="font-mono text-[11px]">{selected.promptVersion || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Prompt hash</dt><dd>{selected.provenance?.promptHash ? <ContentHash value={selected.provenance.promptHash} chars={14} /> : "—"}</dd></div>
                <div><dt className="text-muted-foreground">Master QC</dt><dd className={selected.qc?.masterQcPassed === true ? "font-semibold text-emerald-600 dark:text-emerald-400" : "font-semibold text-destructive"}>{selected.qc?.masterQcPassed === true ? "Passed" : selected.qc?.masterQcPassed === false ? "Failed" : "—"}</dd></div>
                <div><dt className="text-muted-foreground">QC confidence</dt><dd className="font-semibold">{selected.qc?.masterQcConfidence == null ? "—" : selected.qc.masterQcConfidence}</dd></div>
                <div><dt className="text-muted-foreground">QC model</dt><dd className="font-mono text-[11px]">{selected.qc?.masterQcModel || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Authoring attempts</dt><dd className="font-semibold">{selected.qc?.masterAuthoringAttempts ?? "—"}</dd></div>
                <div><dt className="text-muted-foreground">Native 4K</dt><dd className="font-semibold">{selected.provenance?.nativelyFourK == null ? "—" : selected.provenance.nativelyFourK ? "Yes" : "No"}</dd></div>
                <div><dt className="text-muted-foreground">Delivered pixels</dt><dd className="font-semibold">{selected.provenance?.deliveredWidthPx && selected.provenance?.deliveredHeightPx ? `${selected.provenance.deliveredWidthPx}×${selected.provenance.deliveredHeightPx}` : "—"}</dd></div>
                <div><dt className="text-muted-foreground">Panels at Call 1</dt><dd className="font-semibold">{selected.callOnePanels.length}/6</dd></div>
                <div><dt className="text-muted-foreground">Proofs saved</dt><dd className="font-semibold">{views.length}/7</dd></div>
                <div><dt className="text-muted-foreground">Cut-out repairs</dt><dd className="font-semibold">{selected.qc?.masterCutoutSurfaces?.length ? selected.qc.masterCutoutSurfaces.join(", ") : "None reported"}</dd></div>
              </dl>

              <details className="mt-3 rounded border border-border bg-background p-2 text-xs">
                <summary className="cursor-pointer font-semibold">View complete immutable QC and provenance metadata</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
                  {JSON.stringify({ qc: selected.qc || null, provenance: selected.provenance || null }, null, 2)}
                </pre>
              </details>
            </div>

            {/* THE VERSION'S OWN RECORD. Order number, Design ID, generation and
                the exact timestamp this version was authored -- so a version is
                identifiable off the page, in an email, on a shop floor, and not
                only by which thumbnail is highlighted. */}
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Version</dt>
                <dd className="font-semibold">V{selectedVersion.version}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Design Order</dt>
                <dd className="font-semibold">{selectedVersion.orderNumber || "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Design ID</dt>
                <dd className="font-semibold">{selectedVersion.designId || "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Generation</dt>
                <dd className="font-mono text-[11px]">{selectedVersion.generationId}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">A.T.L.A.S. revision</dt>
                <dd className="font-mono text-[11px]">{selectedVersion.revisionId}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Authored</dt>
                <dd className="font-semibold">{exactTimestamp(selectedVersion.createdAt)}</dd>
              </div>
            </dl>

            {/* THE PROMPT, VERBATIM. V1 carries the customer's original brief;
                a later version carries the change that was asked for. Both are
                shown as typed -- a paraphrase here is how a design gets rebuilt
                against words nobody said. */}
            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {selectedVersion.promptKind === "original-brief"
                  ? `V${selectedVersion.version} · original brief`
                  : `V${selectedVersion.version} · revision asked for`}
              </div>
              <p className="whitespace-pre-wrap text-xs">
                {selectedVersion.prompt || (
                  <span className="text-muted-foreground">
                    No prompt was recorded for this version.
                  </span>
                )}
              </p>
            </div>

            {/* VERSION HISTORY — THE SAME ONE REVISIONSTUDIO SHOWS.
                Chronological, oldest first, every version kept: V1 is never
                replaced when V2 is made. Each entry carries the prompt that
                produced it verbatim and the exact moment it was authored, and
                selecting one switches this whole workspace -- proofs, panels,
                corrections, enhancements, logos -- to that revision's assets.
                Nothing is ever shown from two versions at once. */}
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Version history · {versionHistory.versions.length}
              </div>
              <ol className="space-y-1.5">
                {versionHistory.versions.map((entry) => {
                  const active = entry.revisionId === selectedVersion.revisionId;
                  return (
                    <li key={entry.revisionId}>
                      <button
                        type="button"
                        onClick={() => setAtlasVersion(entry.version - 1)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-lg border p-2 text-left transition",
                          active
                            ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                            : "border-border hover:border-muted-foreground",
                        )}
                      >
                        {entry.masterUrl ? (
                          <img
                            src={entry.masterUrl}
                            alt={`V${entry.version}`}
                            className="h-14 w-14 shrink-0 rounded bg-white object-contain"
                          />
                        ) : (
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                            <ImageOff className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={active ? "default" : "outline"}>V{entry.version}</Badge>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {exactTimestamp(entry.createdAt)}
                            </span>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {entry.promptKind === "original-brief" ? "original brief" : "revision"}
                            </span>
                          </div>
                          {/* Verbatim. A paraphrase here is how a design gets
                              rebuilt against words nobody said. */}
                          <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-foreground">
                            {entry.prompt || (
                              <span className="text-muted-foreground">No prompt recorded for this version.</span>
                            )}
                          </p>
                          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                            master {entry.masterContentHash.slice(0, 14)}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* BEFORE → AFTER, for this run.
                The master on the left, the seven proofs it produced on the
                right, and per proof the evidence that it was actually rendered
                FROM that master. Proofs drifting from the master is the failure
                this board exists to make visible: the runtime already refuses to
                render a proof whose conditioning bytes do not hash to the master
                zone, so a mismatch here means the proof belongs to a different
                version -- read the version strip above. */}
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                This master → its {views.length} proof{views.length === 1 ? "" : "s"}
              </div>
              {views.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No proofs are saved for this run yet.
                </p>
              ) : (
                <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr))]">
                  {views.map((view) => {
                    const binding = view.atlasBinding;
                    // Only a real disagreement is called out. A Standard run has
                    // no master, and an older proof that predates the binding
                    // carries no hash -- neither is a drifted proof, so neither
                    // is reported as one.
                    // The master identity lives on the revision's `master`
                    // object, not on the revision itself. Reading it off the
                    // wrong level made this comparison undefined === undefined
                    // -- always "unknown", never a match and never a drift --
                    // so the check that proves a proof belongs to the selected
                    // version silently did nothing.
                    const known = Boolean(binding?.masterContentHash && selected.master.contentHash);
                    const matches = known
                      && binding!.masterContentHash === selected.master.contentHash;
                    return (
                      <div key={view.id} className="rounded-lg border border-border p-1.5">
                        <a href={view.signedUrl} target="_blank" rel="noreferrer">
                          <img
                            src={view.signedUrl}
                            alt={SURFACE_LABEL[view.surfaceKey] || view.surfaceKey}
                            className="aspect-[4/3] w-full rounded bg-white object-contain"
                          />
                        </a>
                        <div className="mt-1 truncate text-[11px] font-semibold">
                          {SURFACE_LABEL[view.surfaceKey] || view.surfaceKey}
                        </div>
                        <div
                          className={cn(
                            "mt-0.5 text-[10px] font-semibold",
                            !known
                              ? "text-muted-foreground"
                              : matches
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-destructive",
                          )}
                        >
                          {!known
                            ? "no master binding"
                            : matches
                              ? (binding!.deterministicMirror
                                ? "from this master · mirrored"
                                : binding!.anchoredToDriver
                                  ? "from this master · anchored"
                                  : "from this master · driver")
                              : "DIFFERENT MASTER"}
                        </div>
                      </div>
                    );
                  })}
                </div>
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
              corrections={correctionsBySide.get(side) || EMPTY_ARTIFACTS}
              upscaled={upscaledBySide.get(side) || EMPTY_ARTIFACTS}
              approved={approvedSides.has(side)}
              onUpscale={runUpscale}
              onToggle={(next) => toggleSide(side, next)}
              onCorrect={correctPanel}
            />
          ))}
        </div>
      </Panel>

      {/* THE METADATA / DIMENSION SHEET, NOT HIDDEN INSIDE THE ZIP.
          The ZIP carries this as designpro-genie-dimension-manifest.json, which
          is the right place for it at delivery -- but a designer validating a
          panel against a template needs the numbers now, and every one of them
          is already stamped on the panel artifact the server produced. This
          renders exactly those values and serializes exactly those values; it
          computes nothing, so the sheet cannot drift from the panels. */}
      {panelBySide.size > 0 && (
        <Panel
          eyebrow="Metadata"
          title="Dimension sheet"
          description="Per surface, as the server stamped it on the panel: trim, print with the 5″ bleed, square footage, and the content hash of the artwork itself."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-4">Surface</th>
                  <th className="pb-2 pr-4">Trim</th>
                  <th className="pb-2 pr-4">Print (+5″ bleed)</th>
                  <th className="pb-2 pr-4">Sq ft</th>
                  <th className="pb-2 pr-4">Active artwork</th>
                  <th className="pb-2">Content hash</th>
                </tr>
              </thead>
              <tbody>
                {PRODUCTION_SURFACES.map((side) => {
                  const row = dimensionSheet.surfaces.find((item) => item.surfaceKey === side);
                  return (
                    <tr key={side} className="border-t border-border">
                      <td className="py-1.5 pr-4 font-semibold">{SURFACE_LABEL[side] || side}</td>
                      <td className="py-1.5 pr-4">{row?.trim || "—"}</td>
                      <td className="py-1.5 pr-4">{row?.print || "—"}</td>
                      <td className="py-1.5 pr-4">{row?.surfaceSqFt ?? "—"}</td>
                      <td className="py-1.5 pr-4">
                        {row?.humanCorrected ? "human corrected" : row ? "Call 9 panel" : "—"}
                      </td>
                      <td className="py-1.5 font-mono text-[10px]">
                        {row?.contentHash ? row.contentHash.slice(0, 16) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <a href={dimensionSheet.href} download={`${job?.designId || "design"}-dimension-sheet.json`}>
              <Download className="mr-1 h-4 w-4" /> Download dimension sheet
            </a>
          </Button>
        </Panel>
      )}

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
              const artifact = upscaledBySide.get(side)![0];
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

      {/* FULL PRODUCTION QC, over the exact panels shown above.
          It sits BEFORE the human preflight gate deliberately: the machine
          checks are what a designer should have in hand while ticking the six
          attestations, not a second opinion offered afterwards. A failure keeps
          the owner here and names the panel; a pass reveals Create WrapBox. */}
      <FullQcPanel
        generationId={generationId}
        revision={atlasRevisions[atlasVersion] || atlasRevisions[0] || null}
        hasProductionProof={allArtifacts.some((artifact) => artifact.kind === "flat-proof")}
        onReport={setQcReport}
      />

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
