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
 * measures on the vehicle, and what its effective density is. And it states the
 * panel-QC verdict the server recorded: which required elements this surface
 * carries whole, and which ones the cut severed, naming the element and the
 * edges it runs off.
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

  // ── THE PANEL VERDICT FIRST ───────────────────────────────────────────────
  //
  // The first cut of this function returned "structurally clean" from two
  // signals -- sufficient PPI and no recorded cut-out repair -- neither of which
  // knows whether the customer's wordmark, URL or mascot actually survived the
  // cut. That is the same overclaim as `Print panels 6/6`: it reports on the
  // FILE and calls it a verdict on the ARTWORK. Arctic Air's rear panel had
  // perfect structure and read `ticAir.com`.
  if (qc?.panelQcUnavailable) {
    // "We could not look" must never render as "we looked and it was fine".
    return {
      tone: "warn",
      label: "not panel-checked",
      reason: `the element locator was unavailable (${qc.panelQcUnavailable}) — no surface on this revision has been checked for severed lettering or marks`,
    };
  }
  if (!qc?.panelQcContract) {
    // A revision authored before panel QC existed was never checked. Saying so
    // is honest; calling it clean is not.
    return {
      tone: "warn",
      label: "not panel-checked",
      reason: "authored before per-surface panel QC ran — its lettering and marks were never proved to sit inside this surface",
    };
  }

  const surface = (qc.panelQcSurfaces || []).find((entry) => entry?.surfaceKey === panel.surfaceKey);
  const severed = (surface?.findings || []).filter((finding) => finding?.code === "atlas_panel_element_severed");
  if (severed.length > 0) {
    return {
      tone: "fail",
      label: severed.length === 1 ? "element cut off" : `${severed.length} elements cut off`,
      reason: severed
        .map((finding) => `${finding.element || "an element"} runs off the ${(finding.edges || []).join(" and ") || "panel"} edge`)
        .join("; "),
    };
  }
  const inBleed = (surface?.findings || []).filter((finding) => finding?.code === "atlas_panel_element_in_bleed");
  if (inBleed.length > 0) {
    return {
      tone: "warn",
      label: "element in the bleed",
      reason: inBleed.map((finding) => finding.detail).filter(Boolean).join("; "),
    };
  }
  const wrongShape = (surface?.findings || []).find(
    (finding) => finding?.code === "atlas_panel_orientation_mismatch" || finding?.code === "atlas_panel_print_aspect_mismatch",
  );
  if (wrongShape) {
    return { tone: "fail", label: "wrong shape for this surface", reason: wrongShape.detail };
  }

  // ── STRUCTURE ─────────────────────────────────────────────────────────────
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

  const intact = surface?.elementsIntact || [];
  return {
    tone: "ok",
    label: intact.length > 0 ? "elements intact" : "ground only — clean",
    reason: intact.length > 0
      ? `${intact.join(", ")} print${intact.length === 1 ? "s" : ""} whole on this panel`
      : "this surface carries the design's ground; no lettering or mark was placed on it, and nothing is cut",
  };
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
  const surface = (revision?.qc?.panelQcSurfaces || []).find((entry) => entry?.surfaceKey === surfaceKey);
  const intact = surface?.elementsIntact || [];
  const cut = (surface?.findings || []).filter((finding) => finding?.code === "atlas_panel_element_severed");

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

      {intact.length > 0 && (
        <div className="border-t border-border px-3 py-2 text-[11px]">
          <p className="font-semibold text-foreground">Carried whole on this panel</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {intact.map((label) => <li key={label}>{label}</li>)}
          </ul>
        </div>
      )}

      {cut.length > 0 && (
        <div className="border-t border-border px-3 py-2 text-[11px] text-red-700 dark:text-red-300">
          <p className="font-semibold">Cut by the panel boundary</p>
          <ul className="mt-1 space-y-0.5">
            {cut.map((finding, index) => (
              <li key={`${finding.element}-${index}`}>
                {finding.element} — runs off the {(finding.edges || []).join(" and ") || "panel"} edge
                {(finding.acrossSurfaces?.length ?? 0) > 1 && (
                  <span className="opacity-80"> (also lands on {finding.acrossSurfaces!.filter((s) => s !== surfaceKey).join(", ")})</span>
                )}
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
  const failing = revision?.qc?.panelQcFailingSurfaces || [];
  const unavailable = revision?.qc?.panelQcUnavailable;

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

      {unavailable && (
        <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
          <span className="font-semibold">These panels were not checked for severed elements.</span>{" "}
          The element locator was unavailable ({unavailable}). Nothing above is reported as passing on the
          strength of a check that did not run.
        </p>
      )}

      {failing.length > 0 && (
        <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-800 dark:text-red-200">
          <span className="font-semibold">
            {failing.length} of 6 surfaces carry an element the cut severed: {failing.join(", ")}.
          </span>{" "}
          The remaining panels carry their elements whole and are not to be re-authored.
        </p>
      )}

    </section>
  );
}

export default SixPanelBoard;
