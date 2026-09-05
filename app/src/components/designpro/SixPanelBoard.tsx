/**
 * THE SIX PANELS, INDIVIDUALLY, WITH THE NUMBERS THAT DECIDE THEM.
 *
 * WHAT THIS REPLACES. `Print panels 6/6` counted FILES. Arctic Air
 * `63e6629a` cut six files and every one of them was unusable -- `Www.Arct` on
 * the hood, `ticAir.com` on the rear, a bare ice field on the front -- and the
 * board said 6/6 because six objects existed. A reviewer could not see a panel
 * without downloading it, so nobody looked, and a green count stood in for six
 * compositions nobody had inspected.
 *
 * So this shows each panel as an IMAGE, next to the four things that decide
 * whether it can print: which surface it is, which way up it is, what it
 * measures on the vehicle, and what its effective density is. And it states its
 * composition: which elements were placed inside it, the exact string that
 * printed, and -- when a surface was left bare -- the measurement that decided
 * that, rather than silence.
 *
 * IT NEVER SYNTHESIZES. RULE 0.27 §3: "neither UI may synthesize its own
 * representation of a missing canonical artifact." A panel with no signed URL
 * renders its geometry and says the image is still arriving. A panel that does
 * not exist is reported missing. Nothing here crops, mirrors, or draws a
 * substitute.
 *
 * IT SURVIVES A LATER FAILURE. A run that cut six panels and then died before
 * its first 3D proof -- exactly Arctic Air `586abc83`, `Print panels 6/6` and
 * `3D proofs 0/7` -- still has six pieces of finished artwork worth looking at.
 * The `failedStage` banner names the stage that actually failed and leaves the
 * artwork on screen, instead of replacing the whole surface with an error.
 */
import type { FlatAtlasCallOnePanel, FlatAtlasRevision } from "@/lib/designpro-api";

const SURFACE_ORDER: FlatAtlasCallOnePanel["surfaceKey"][] = [
  "driver", "passenger", "hood", "roof", "front", "rear",
];

const SURFACE_LABEL: Record<string, string> = {
  driver: "Driver side",
  passenger: "Passenger side",
  hood: "Hood",
  roof: "Roof",
  front: "Front",
  rear: "Rear",
};

/** The print target every panel is measured against. */
const TARGET_PRINT_PPI = 150;

const shortHash = (hash?: string | null) => (hash ? String(hash).slice(0, 12) : "—");

/**
 * Which way up the panel prints. Landscape and portrait are not cosmetic: a
 * flank delivered portrait is a flank that will not fit the vehicle, and the
 * ratio is the cheapest place to notice.
 */
function orientationOf(panel: FlatAtlasCallOnePanel): string {
  if (panel.pixelWidth === panel.pixelHeight) return "square";
  return panel.pixelWidth > panel.pixelHeight ? "landscape" : "portrait";
}

type PanelState = {
  tone: "ok" | "warn" | "fail";
  label: string;
  reason?: string;
};

/**
 * The panel's own verdict, from what the server actually recorded. Deliberately
 * NOT a pass/fail invented in the browser: every branch below cites a field the
 * runtime persisted.
 */
export function panelState(
  panel: FlatAtlasCallOnePanel,
  revision: FlatAtlasRevision | null | undefined,
): PanelState {
  const qc = revision?.qc;
  if ((qc?.masterCutoutSurfaces || []).includes(panel.surfaceKey)) {
    const finding = (qc?.cutoutFillApplied || []).find((f) => f?.surfaceKey === panel.surfaceKey);
    return {
      tone: "warn",
      label: "repaired — human QC required",
      reason: finding
        ? `${finding.pixels?.toLocaleString()} px closed across ${finding.components} component${finding.components === 1 ? "" : "s"} (${((finding.zoneFraction || 0) * 100).toFixed(2)}% of the surface)`
        : "the sheet arrived holed on this surface and was repaired deterministically",
    };
  }
  if (panel.effectivePpi < TARGET_PRINT_PPI) {
    return {
      tone: "warn",
      label: "below print density",
      reason: `${panel.effectivePpi} PPI against a ${TARGET_PRINT_PPI} PPI target — upscaling is required before any production export`,
    };
  }
  return { tone: "ok", label: "structurally clean" };
}

const TONE_CLASS: Record<PanelState["tone"], string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  fail: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
};

function PanelCard({
  surfaceKey, panel, revision,
}: {
  surfaceKey: FlatAtlasCallOnePanel["surfaceKey"];
  panel?: FlatAtlasCallOnePanel;
  revision?: FlatAtlasRevision | null;
}) {
  const label = SURFACE_LABEL[surfaceKey] || surfaceKey;
  if (!panel) {
    // REPORTED MISSING, NEVER SYNTHESIZED.
    return (
      <article className="overflow-hidden rounded-xl border border-dashed border-border bg-muted/20">
        <div className="border-b border-border px-3 py-2 text-sm font-semibold">{label}</div>
        <div className="flex aspect-[3/2] items-center justify-center px-4 text-center text-xs text-muted-foreground">
          No panel was cut for this surface.
        </div>
      </article>
    );
  }

  const state = panelState(panel, revision);
  const placements = (revision?.qc?.elementPlacements || []).filter((p) => p?.surfaceKey === surfaceKey);
  const skipped = (revision?.qc?.elementPlacementsSkipped || []).filter((p) => p?.surfaceKey === surfaceKey);
  const printed = (revision?.qc?.composeReceipt?.elements || [])
    .filter((e) => e?.surfaceKey === surfaceKey && typeof e.string === "string" && e.string.length > 0);

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{orientationOf(panel)}</span>
      </div>

      {panel.signedUrl ? (
        <a href={panel.signedUrl} target="_blank" rel="noreferrer" className="block bg-white">
          <img
            src={panel.signedUrl}
            alt={`${label} print panel`}
            loading="lazy"
            className="h-40 w-full object-contain"
          />
        </a>
      ) : (
        <div className="flex h-40 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          Stored and hash-locked; the preview is not signed yet.
        </div>
      )}

      <dl className="space-y-1 px-3 py-2 text-[11px] text-muted-foreground">
        <div className="flex justify-between gap-2">
          <dt>Trim</dt>
          <dd className="font-medium text-foreground">{panel.trimWidthIn}″ × {panel.trimHeightIn}″</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Print · {panel.bleedInches}″ bleed</dt>
          <dd>{panel.printWidthIn}″ × {panel.printHeightIn}″ · {panel.surfaceSqFt} sq ft</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Effective density</dt>
          <dd>{panel.effectivePpi} PPI · {panel.pixelWidth}×{panel.pixelHeight} px</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>From master</dt>
          <dd className="font-mono">{shortHash(panel.sourceMasterHash)}</dd>
        </div>
      </dl>

      {(placements.length > 0 || printed.length > 0) && (
        <div className="border-t border-border px-3 py-2 text-[11px]">
          <p className="font-semibold text-foreground">Composed onto this panel</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {placements.map((placement) => {
              const text = printed.find((e) => e.elementId === placement.elementId)?.string;
              return (
                <li key={placement.elementId} className="flex justify-between gap-2">
                  <span>
                    {placement.kind}
                    {text ? <span className="font-mono text-foreground"> “{text}”</span> : null}
                  </span>
                  {placement.rectIn && (
                    <span className="shrink-0 tabular-nums">
                      {placement.rectIn.w}″ × {placement.rectIn.h}″ @ {placement.rectIn.x},{placement.rectIn.y}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {skipped.length > 0 && (
        <div className="border-t border-border px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          <p className="font-semibold">Left off this panel</p>
          <ul className="mt-1 space-y-0.5">
            {skipped.map((entry) => (
              <li key={entry.elementId}>
                {entry.kind} — {entry.reason === "below_minimum_legible_height"
                  ? `would print ${entry.heightIn}″ tall; ${entry.minHeightIn}″ is the legible minimum`
                  : entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={`border-t px-3 py-2 text-[11px] ${TONE_CLASS[state.tone]}`}>
        <span className="font-semibold uppercase tracking-wide">{state.label}</span>
        {state.reason && <p className="mt-0.5 opacity-90">{state.reason}</p>}
      </div>
    </article>
  );
}

/**
 * @param failedStage  the stage that ACTUALLY failed, when one did. Named so a
 *   later failure reads as "the proofs never started" rather than as "the
 *   design is gone" -- the artwork below it is real either way.
 */
export function SixPanelBoard({
  revision,
  failedStage,
  className,
}: {
  revision?: FlatAtlasRevision | null;
  failedStage?: string | null;
  className?: string;
}) {
  const panels = revision?.callOnePanels || [];
  const byKey = new Map(panels.map((panel) => [panel.surfaceKey, panel]));
  const present = SURFACE_ORDER.filter((key) => byKey.has(key)).length;
  const clean = SURFACE_ORDER
    .map((key) => byKey.get(key))
    .filter((panel): panel is FlatAtlasCallOnePanel => Boolean(panel))
    .filter((panel) => panelState(panel, revision).tone === "ok").length;
  const receipt = revision?.qc?.elementsReceipt;

  return (
    <section className={className}>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Print panels</h3>
          <p className="text-xs text-muted-foreground">
            Deterministically cut from the accepted master at GENIE dimensions plus the physical bleed.
          </p>
        </div>
        {/* THE COUNT MEANS WHAT IT SAYS. Files present AND panels that passed
            their gates, stated separately, because they are different numbers
            and conflating them is what let 6/6 mean nothing. */}
        <p className="text-xs">
          <span className="font-semibold text-foreground">{present}/6 cut</span>
          <span className="text-muted-foreground"> · {clean}/{present || 6} passed their gates</span>
        </p>
      </header>

      {failedStage && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <span className="font-semibold">This run stopped at {failedStage}.</span>{" "}
          The artwork below was completed before it stopped and stays downloadable.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SURFACE_ORDER.map((key) => (
          <PanelCard key={key} surfaceKey={key} panel={byKey.get(key)} revision={revision} />
        ))}
      </div>

      {(receipt?.unresolved?.length ?? 0) > 0 && (
        <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
          <span className="font-semibold">Some elements were not resolved:</span>{" "}
          {receipt?.unresolved?.map((entry) => entry.reason).filter(Boolean).join("; ")}. The ground and
          the lettering were composed without them.
        </p>
      )}

      {receipt?.canonicalStrings && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Typeset from the frozen request, outlined from a pinned font file
          {receipt.fontSha256 ? <span className="font-mono"> ({receipt.fontSha256.slice(0, 12)})</span> : null}:{" "}
          {[receipt.canonicalStrings.wordmark, receipt.canonicalStrings.contact, receipt.canonicalStrings.tagline]
            .filter(Boolean)
            .map((value) => `“${value}”`)
            .join(" · ") || "no customer copy was supplied"}
        </p>
      )}
    </section>
  );
}

export default SixPanelBoard;
