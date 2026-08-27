/**
 * PRODUCTION LAYERS — what the customer sees after Calls 8-11.
 *
 * Per side: the branded production panel from Call 9, the de-logoed QC
 * duplicate from Call 11 beside it, and the approved 3D view that panel was cut
 * against. Underneath, the logo assets Call 10 separated. The two purchases --
 * Production Pack and Logo Pack -- sit at the bottom, each authorizing only its
 * own fulfillment.
 *
 * The presentation is the original product component and has not changed. What
 * changed is that it no longer resolves any of this for itself.
 *
 * It used to. It walked color_visualizations for a canonical id, asked
 * designpro-file-output-api for the active Entice pack, read
 * production_flow_assets, and offered buttons that submitted, resumed and
 * lifted -- all of it the RestylePro production backend, reached from a
 * customer's own screen. That is removed rather than gated, because a gated
 * fallback is still a door, and a second authority for the same design is the
 * exact failure the standalone runtime exists to prevent. Every value now comes
 * from `source`, which designpro-production-layers builds out of what the
 * runtime already published.
 *
 * Nothing here starts work. Calls 8-12 run because Call 7 handed off; a
 * customer-side control that could kick or retry production would be a second
 * conductor of a pipeline that must have exactly one.
 *
 * Dark theme to match the surfaces it mounts on (zinc, blue accent).
 */

import { useState } from "react";
import { Layers, Download, MousePointerClick, Loader2, X, Check, ShoppingBag, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  getProductionPanelPackState,
  type ProductionFlowAssetRow,
} from "@/lib/productionFlowAssetState";
import type { ProductionLayersSource } from "@/lib/designpro-production-layers";


type PFARow = ProductionFlowAssetRow;

interface Props {
  /** The design on screen. Identity only -- nothing is resolved from it. */
  generationId?: string | null;
  /**
   * Fast-edit hook: drop the transparent branding/design overlay onto the
   * LayerLift canvas as an editable layer. When omitted, only download is shown.
   */
  onAddOverlayLayer?: (url: string, name: string) => void;
  /**
   * WHERE THE LAYERS COME FROM. Required: the rows, the pack identity, the
   * approved views and both checkouts, already resolved from what the runtime
   * published. Without it the card renders nothing, which is the honest state
   * for a design whose panels do not exist yet.
   */
  source?: ProductionLayersSource | null;
  className?: string;
}

const downloadHref = (url: string) => `${url}${url.includes("?") ? "&" : "?"}download`;

// Subtle checkerboard so transparent PNGs read as transparent on the dark UI.
const CHECKER =
  "[background-image:linear-gradient(45deg,#3f3f46_25%,transparent_25%),linear-gradient(-45deg,#3f3f46_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#3f3f46_75%),linear-gradient(-45deg,transparent_75%,#3f3f46_75%)] [background-size:14px_14px] [background-position:0_0,0_7px,7px_-7px,-7px_0]";

// Map a production side to the design's approved-render view key (render_urls).
// Used to show the customer's APPROVED BRANDED design next to the clean print
// panel, so a text-free print base never reads as "my design lost its branding".
const SIDE_TO_VIEW: Record<string, string> = {
  "DRIVER SIDE": "side",
  "PASSENGER SIDE": "passenger-side",
  "HOOD": "hood_detail",
  "ROOF": "roof",
  "FRONT": "front",
  "REAR": "rear",
};

function Thumb({
  url,
  label,
  transparent,
  downloadable = true,
  onEdit,
  onOpen,
}: {
  url: string;
  label: string;
  transparent?: boolean;
  downloadable?: boolean;
  onEdit?: () => void;
  onOpen?: () => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-700 overflow-hidden bg-zinc-950/40">
      {/* Open a FIT-TO-SCREEN preview instead of the raw working-resolution PNG in
          a browser tab — full-size the working-res panel reads as pixelated/stretched
          and doesn't frame it as a preview. The modal scales it to fit and shows the
          Production Pack upsell. */}
      <button type="button" onClick={onOpen} className="block w-full" title="Open a fit-to-screen preview">
        <div className={cn("aspect-video flex items-center justify-center", transparent ? CHECKER : "bg-zinc-800")}>
          <img src={url} alt={label} className="max-h-full max-w-full object-contain" loading="lazy" />
        </div>
      </button>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5 border-t border-zinc-800">
        <span className="text-[10px] font-medium text-zinc-400 truncate">{label}</span>
        <div className="flex items-center gap-2 shrink-0">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-400 hover:text-blue-300"
              title="Drop this transparent overlay onto the canvas as an editable layer"
            >
              <MousePointerClick className="w-3 h-3" /> Edit
            </button>
          )}
          {downloadable ? (
            <a
              href={downloadHref(url)}
              download
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 hover:text-emerald-300"
              title={`Download ${label}`}
            >
              <Download className="w-3 h-3" /> Save
            </a>
          ) : (
            <span className="text-[10px] font-semibold text-amber-400">Blocked</span>
          )}
        </div>
      </div>
    </div>
  );
}

// What the paid Production Pack delivers — shown on the preview so the customer
// understands the working-res preview converts to real print-ready files only
// with a purchase.
const PRODUCTION_PACK_INCLUDES = [
  "Real human designer quality check",
  "All 3D proofs",
  "2D production proof",
  "File Production Proof (dimensioned)",
  "QC stamp with DesignID (DID-XXXXXXXX)",
];

// Fit-to-screen preview lightbox with the purchase disclaimer + included list.
// Replaces opening the raw working-resolution PNG in a browser tab (which read as
// pixelated/stretched and never framed it as a preview).
function PreviewModal({ url, label, onClose, onOrder }: { url: string; label: string; onClose: () => void; onOrder?: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-md bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20"
      >
        <X className="h-4 w-4" /> Close
      </button>
      <div className="flex max-h-full w-full max-w-5xl flex-col items-center gap-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* object-contain + viewport caps = a clean, large image that always fits
            the screen, never a pixelated/stretched full-res dump. */}
        <div className="flex w-full items-center justify-center overflow-hidden rounded-lg bg-zinc-900">
          <img src={url} alt={label} className="max-h-[58vh] max-w-full object-contain" />
        </div>
        {/* Disclaimer + included list + Order CTA sit directly UNDER the image. */}
        <div className="w-full max-w-2xl rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-bold text-amber-100">
            Preview only — purchase the Production Pack for print-ready files.
          </p>
          <p className="mt-1 text-[12px] font-semibold text-amber-200/80">Your Production Pack includes:</p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {PRODUCTION_PACK_INCLUDES.map((item) => (
              <li key={item} className="flex items-center gap-2 text-[12.5px] text-amber-50">
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> {item}
              </li>
            ))}
          </ul>
          {onOrder && (
            <button
              type="button"
              onClick={onOrder}
              className="mt-3 w-full h-11 inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-fuchsia-600 text-white text-sm font-bold hover:brightness-110"
            >
              <ShoppingBag className="h-4 w-4" /> Order Production Pack
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProductionFlowLayersCard({ generationId, onAddOverlayLayer, source, className }: Props) {
  // Required, not preferred. There is no other way to fill this card, which is
  // the whole point: a fallback resolver would be a second authority for the
  // same design, reachable from the customer's screen.
  // `source` is legitimately null for a design with no standalone run, and the
  // guard below returns null for exactly that. But three hooks sit BETWEEN that
  // guard and the reads above it, so the guard cannot be hoisted without
  // changing the hook count between renders -- and every read here ran first.
  // Live 2026-08-27: opening any card in RevisionStudioIQ threw
  // "Cannot read properties of null (reading 'canonicalId')" and the whole
  // route fell to the error boundary, so no past design could be opened at all.
  // The reads are optional now; the guard still decides what renders.
  const injected = source;
  const [ordering, setOrdering] = useState(false);
  // Fit-to-screen preview lightbox target ({url,label}) or null when closed.
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);

  // EVERYTHING THIS CARD SHOWS COMES FROM THE INJECTED SOURCE.
  //
  // It used to resolve all of this itself: walk color_visualizations for a
  // canonical id, ask designpro-file-output-api for the active Entice pack,
  // then read production_flow_assets. That was the RestylePro production
  // backend, reached from the customer's own screen, and it is gone -- not
  // switched off behind a flag, not kept as a fallback. A fallback is a door,
  // and a door into a second authority for the same design is the failure this
  // system exists to make impossible.
  //
  // The runtime publishes the same four answers through dpApi, and
  // designpro-production-layers maps them into the rows below. The presentation
  // is unchanged, because the rows are.
  const resolved = { canonical: injected?.canonicalId, visualizationId: "", expectedUpdatedAt: "" };
  const resolving = false;
  const activePack = injected?.activePack;
  const activePackLoading = false;

  const activeProofUrl = String((activePack as any)?.proof_artifact?.url || "");
  const expectedSurfaceCount = Array.isArray((activePack as any)?.surface_manifest?.surfaces)
    ? (activePack as any).surface_manifest.surfaces.length
    : 0;

  const rows = (injected?.rows ?? []) as PFARow[];
  const rowsLoading = false;

  // Prefer the pack built from the CURRENT proof. If there isn't one yet, fall
  // back to the newest complete pack for this design and show it as a preview —
  // the same two-step `miniWrapKit` already uses. Falling back is what makes a
  // pack visible between panels.build and pack.activate.
  const packState = (() => {
    if (activeProofUrl) {
      const current = getProductionPanelPackState(rows, activeProofUrl);
      if (current.hasCompleteAtomicPack) return current;
    }
    return getProductionPanelPackState(rows);
  })();
  const latestBySide = packState.packRows;

  // VERIFIED means: this exact pack is the one the server activated. Anything
  // else on screen is an honest preview, labelled as such, and can never reach
  // the paid order path below.
  const isVerifiedPack =
    !!(activePack as any)?.id
    && latestBySide.length > 0
    && latestBySide.every(
      (row) =>
        String(row.entice_pack_id || "") === String((activePack as any).id)
        && String(row.version || "") === String((activePack as any).pack_version || ""),
    );

  // PRINT-READY is unchanged in strictness: the pack must be the activated one
  // AND every side must carry its own passing QC. Un-gating the DISPLAY must
  // never un-gate the deliverable — a preview is downloadable-blocked and
  // cannot reach Order Production Pack.
  const printReady = isVerifiedPack && packState.productionEligible;

  /**
   * THE PRODUCTION PACK CONVERSION SURFACE.
   *
   * `entice` is the pre-purchase half: the six surfaces A.T.L.A.S. Call 1 cut
   * from the accepted master, shown as a controlled preview. They are the
   * actual panels -- not a mock, not a regeneration -- at design-time geometry,
   * and they are the whole commercial argument: the design is already mapped
   * across the vehicle, and the Production Pack is what turns those approved
   * surfaces into print-ready files.
   *
   * Before this existed the card read the entice set as an UNVERIFIED PACK,
   * because "not the activated pack" was the only state it had. So it stamped
   * six real A.T.L.A.S. surfaces "production blocked", withheld the CTA, and
   * turned the conversion surface into a defect report. The distinction is not
   * verified-vs-unverified; it is before-purchase vs after.
   *
   * What stays withheld either way: the production-resolution asset. Preview
   * downloads are off, and the paid artifact is the same lineage -- the same
   * accepted master -- reached through purchase rather than a second producer.
   */
  const entice = injected?.stage === "entice";

  // Comparison thumbnails come from the exact frozen revision that produced the
  // panels ON SCREEN — not from the activated pack, which may not exist yet.
  // Without this the "[Your approved design] | [Print-ready panel]" pair loses
  // its left-hand side for every preview pack.
  const displayRevisionId = String(
    latestBySide[0]?.revision_id || (activePack as any)?.revision_id || "",
  );
  const designViews = injected?.designViews;

  // LOGO PACK — read only from the ONE selected atomic pack. Never union
  // admin_notes across order-family revisions: that was able to attach stale
  // logos/lettering from an older design to the current panels. `logo_pack` is
  // repeated on every row by the atomic saver, while `branding_overlays` contains
  // the side-specific cleanly separated elements. Combine and URL-dedupe only
  // within the selected source-hashed pack.
  const logoPack = (() => {
    const byUrl = new Map<string, { url: string; label: string }>();
    const add = (
      asset: { url?: string; label?: string; element_label?: string; side?: string } | null | undefined,
      fallbackSide?: string,
    ) => {
      const url = typeof asset?.url === "string" ? asset.url.trim() : "";
      if (!url || byUrl.has(url)) return;
      const label = String(
        asset?.label ||
        asset?.element_label ||
        [asset?.side || fallbackSide, "branding"].filter(Boolean).join(" ") ||
        "Logo",
      );
      byUrl.set(url, { url, label });
    };

    for (const asset of (Array.isArray((activePack as any)?.logo_artifacts)
      ? (activePack as any).logo_artifacts
      : [])) add(asset);
    const packMeta = latestBySide[0]?.meta_metrics;
    for (const asset of (Array.isArray(packMeta?.logo_pack) ? packMeta.logo_pack : [])) add(asset);
    for (const row of latestBySide) {
      const overlays = Array.isArray(row.meta_metrics?.branding_overlays)
        ? row.meta_metrics.branding_overlays
        : [];
      for (const asset of overlays) add(asset, row.side);
    }
    return Array.from(byUrl.values());
  })();

  // LOGO PACK GAP — the lift is an AI erase pass with a strict anti-smear gate.
  // On a design whose branding blends into the artwork (large, low-contrast, or
  // colour-matched) the gate correctly refuses rather than ship a smeared panel,
  // and the workflow records an honest gap instead of voiding the pack. Without
  // this the card simply vanished, which reads as "the feature is broken".
  // `separation_qc.pass === false` is written per side by save-production-panels.
  const logoPackGap = (() => {
    const reasons = new Set<string>();
    const sides: string[] = [];
    for (const row of latestBySide) {
      const qc = row.meta_metrics?.separation_qc as
        | { pass?: boolean; reason?: string }
        | undefined;
      if (qc && typeof qc === "object" && qc.pass === false) {
        sides.push(String(row.side || "").trim() || "panel");
        const reason = String(qc.reason || "").trim();
        if (reason) reasons.add(reason);
      }
    }
    return { sides, detail: Array.from(reasons).join(" · ") };
  })();

  /**
   * ORDER THE PRODUCTION PACK.
   *
   * The gate is unchanged -- a verified pack, production-eligible, or no button
   * at all. What is gone is the second implementation behind it: promoting a
   * panelizer_jobs row through designpro-file-output-api. The purchase is the
   * gateway's checkout, and the entitlement it records is the Production Pack's
   * own, so buying one product can never authorize the other's fulfillment.
   *
   * There is no Build or Retry control any more, and that is the point. Those
   * submitted and resumed the Entice workflow from the browser. Calls 8-12 run
   * because Call 7 handed off, not because someone clicked; a customer-side
   * button that can start or restart production work is a second conductor.
   */
  const orderProductionPack =
    injected?.onOrderProductionPack && (entice || (isVerifiedPack && packState.productionEligible))
      ? async () => {
        if (ordering) return;
        setOrdering(true);
        try {
          await injected!.onOrderProductionPack!();
        } catch (error: any) {
          toast({
            title: "Production Pack checkout could not start",
            description: String(error?.message || error).slice(0, 220),
            variant: "destructive",
          });
        } finally {
          setOrdering(false);
        }
      }
      : undefined;

  // THE GRAPHICS-PACK LIFT IS REMOVED, NOT DISABLED.
  //
  // It invoked panel-artboard-generator step:"liftoverlays" to AI-erase baked-in
  // branding and overwrite a good vault panel with the result -- a smear the
  // customer only discovers when they move the logo. It had been flag-gated off
  // for a month, which meant the wiring survived every review that read the
  // flag and stopped. Call 11's de-logoed duplicates are the answer to what it
  // was for, and they never touch the branded panel.

  // Why the Logo Pack add-on is unavailable, revealed on request rather than
  // shown as a standing warning beside print-ready files.
  const [logoPackNotice, setLogoPackNotice] = useState(false);
  const [orderingLogoPack, setOrderingLogoPack] = useState(false);
  // $29 Logo Pack checkout (owner's separate-purchase model). The webhook
  // fulfills by the canonical DesignIQ generation id, so that exact id — never
  // a render id — goes into the session metadata.
  const handleOrderLogoPack = async () => {
    if (orderingLogoPack) return;
    setOrderingLogoPack(true);
    try {
      if (!injected?.onOrderLogoPack) throw new Error("Logo Pack checkout is not available");
      await injected.onOrderLogoPack();
    } catch (e) {
      toast({
        title: "Logo Pack checkout failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setOrderingLogoPack(false);
    }
  };

  // CUT-READY LOGO FILES ARE NOT AVAILABLE ON THIS PATH YET.
  //
  // The old surface invoked cutpath-element-extract and then cached the result
  // by hand into color_visualizations.admin_notes. That is a legacy table this
  // system does not own, and writing a paid deliverable's location into it puts
  // the artifact outside the identity every other output is keyed by. Cut files
  // belong in the runtime's artifact store like every other deliverable; until
  // a stage produces them there, offering the button would promise a file no
  // one can reissue.

  if (
    !injected
    || !generationId
    || resolving
    || activePackLoading
    || rowsLoading
  ) return null;

  // Empty state. There is deliberately no action here: the panels arrive when
  // Calls 9-11 finish, and a button that could start or restart that work from
  // the customer's browser is the second conductor this card just stopped being.
  if (latestBySide.length === 0) {
    return (
      <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3", className)}>
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-bold text-zinc-200">Production Layers</span>
        </div>
        {/* Honest about WHICH nothing this is. A.T.L.A.S. cuts the six surfaces
            at Call 1, so a design whose master has been accepted has them
            already and never reaches here; reaching here means the design
            itself is still being made. Saying "not uploaded" would be both
            untrue and the wrong instruction -- nobody uploads these. */}
        <p className="text-[11px] text-amber-300 leading-snug">
          The six surfaces appear here as soon as the design is accepted — they
          are cut from that master by the server, never uploaded.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3", className)}>
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-bold text-zinc-200">
          {entice
            ? "Production Pack"
            : printReady
              ? "Print Ready Files"
              : isVerifiedPack ? "Panel previews — production blocked" : "Panel previews — awaiting verification"}
        </span>
        <span className="ml-auto text-[10px] text-zinc-500">{latestBySide.length} side{latestBySide.length === 1 ? "" : "s"}</span>
      </div>

      {/* THE CONVERSION MESSAGE. What the customer already has, and what the
          Production Pack adds to it. Every word of it is true of the panels
          above: those ARE their design's own surfaces, cut from the master they
          approved -- which is exactly why this argument works and why a mocked
          preview would have been both a lie and a weaker sell. */}
      {entice ? (
        <>
          <p className="text-[12px] leading-snug text-zinc-200">
            Your design is already mapped across the vehicle.{" "}
            <span className="font-semibold text-blue-300">
              Production Pack turns these approved surfaces into final print-ready production files.
            </span>
          </p>
          <p className="text-[11px] leading-snug text-zinc-400">
            Unlocked with the Production Pack: final production geometry from GENIE,
            the 5″ bleed on every edge, full-resolution upscale, and the print-ready
            output pack delivered to WrapBox.
          </p>
          {orderProductionPack && (
            <button
              type="button"
              onClick={orderProductionPack}
              disabled={ordering}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-fuchsia-600 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
            >
              {ordering
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Opening checkout…</>
                : <><ShoppingBag className="h-4 w-4" /> GET PRODUCTION PACK</>}
            </button>
          )}
        </>
      ) : (
        <>
          {printReady ? (
            <p className="text-[11px] text-zinc-300 leading-snug">
              Every side is verified and print-ready.{" "}
              <span className="font-semibold text-emerald-300">
                Click Order Production Pack
              </span>{" "}
              for the full-resolution print files.
            </p>
          ) : null}
          <p className="text-[11px] text-zinc-500 leading-snug">
            Active revision only — every side, proof, and logo is pinned to pack {String((activePack as any)?.id || "").slice(0, 8)}.
          </p>
          {!printReady && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] font-semibold text-amber-300">
              Preview only — the panels themselves are not production eligible. Downloads and paid production are blocked.
            </p>
          )}
        </>
      )}
      {activeProofUrl && (
        // The 2D proof is the source every panel below was extracted from, so it
        // belongs ABOVE them rather than behind a separate button — the panels
        // only make sense next to the sheet whose dimensions they carry.
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-sm font-bold text-zinc-200">2D Production Proof</span>
            <span className="text-[10px] text-zinc-500">source of every panel below</span>
            <a
              href={activeProofUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-[10px] font-semibold text-blue-400 hover:text-blue-300"
            >
              Open full size
            </a>
          </div>
          <button
            type="button"
            onClick={() => setPreview({ url: activeProofUrl, label: "2D Production Proof" })}
            className="block w-full overflow-hidden rounded-md border border-zinc-800 bg-white hover:border-blue-500/60"
            title="Click to enlarge"
          >
            <img
              src={activeProofUrl}
              alt="2D Production Proof"
              className="w-full object-contain max-h-72"
              loading="lazy"
            />
          </button>
        </div>
      )}
      <div className="space-y-3">
        {latestBySide.map((p) => {
          // ENTICE preview (Trish 2026-07-27): show the FULL branded panel here
          // (branding_url — the verified per-side extraction) plus the extracted
          // Logo Pack below as the
          // entice add-on. The blank/clean (background_url) variant does NOT
          // belong on this card at all — it lives on the PanelPro Studio board
          // with the full panels for production use. Showing it here was reading
          // as "the print-ready panel" when it was actually the secondary,
          // AI-edited blank asset (unreliable — half-erased vehicle, ghosting).
          const panelUrl = p.branding_url || p.background_url;
          // WHAT THIS PANEL IS, SAID PLAINLY.
          //
          // In the entice half it is the Production Pack panel for this
          // surface, shown at design-time geometry. Never "not uploaded" and
          // never "production blocked": A.T.L.A.S. has already produced this
          // design surface, and telling the customer otherwise is both untrue
          // and the opposite of the sale.
          const panelLabel = entice
            ? "Production Pack panel · preview"
            : printReady
              ? "Print ready · QC passed"
              : "Preview only · production blocked";
          const di: any = p.dimensions_inches || {};
          const w = di.w ?? di.width;
          const h = di.h ?? di.height;
          // TRIM vs PRINT. The panel image IS the print size -- the vehicle side
          // plus the physical bleed on every edge -- so the trim rectangle sits
          // inside it, inset by the bleed. Stating only one number leaves a
          // designer unable to tell which they are looking at, and the bleed is
          // exactly the part that gets cut away on the vehicle.
          const printW = di.print_w ?? 0;
          const printH = di.print_h ?? 0;
          const bleedIn = di.bleed ?? 0;
          const trimInsetPct = printW > 0 && printH > 0 && bleedIn > 0
            ? { x: (bleedIn / printW) * 100, y: (bleedIn / printH) * 100 }
            : null;
          const masterHash = String(p.meta_metrics?.source_master_hash || "");
          // Comparison-only reassurance thumb: the customer's approved 3D render
          // for this side, so the flat panel doesn't read as "wrong design".
          const brandedView = designViews[SIDE_TO_VIEW[p.side] || ""] || "";
          const showApproved = !!brandedView;
          const cols = panelUrl && showApproved ? "grid-cols-2" : "grid-cols-1";
          return (
            <div key={p.id} className="rounded-lg border border-zinc-800 p-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold capitalize text-zinc-300">{p.side}</span>
                <span className="inline-flex items-center gap-2">
                  {/* RestylePro's tile is the spec (owner, 2026-08-26): an
                      image and a short label. Trim/print/bleed arithmetic is
                      the production record and lives in PanelPro Studio. */}
                  <span className="text-[10px] text-zinc-500">{p.version}</span>
                </span>
              </div>
              {/* The lineage hash is deliberately not rendered here (owner,
                  2026-08-26): it is the production record, and PanelPro Studio
                  shows it beside everything else it binds. The binding itself
                  still travels with the artifacts. */}
              {/* REAL DESIGN PROOF ∥ PRINT PANEL — proof LEFT, panel RIGHT.
                  RULE 0.21 states the row in those words: "Left is that
                  surface's 3D proof. Right is the deterministic A.T.L.A.S.
                  extraction for that exact surfaceKey." This card had them the
                  other way round, which reads as the panel being the thing and
                  the render being a footnote. It is the reverse: the customer
                  approved the design on the vehicle, and the panel is what that
                  approval produced -- so the eye lands on what was approved and
                  then on what will print. Do not swap these back. */}
              <div className={cn("grid gap-2", cols)}>
                {showApproved && <Thumb url={brandedView} label="Your approved design" onOpen={() => setPreview({ url: brandedView, label: `${p.side} — your approved design` })} />}
                {panelUrl && (
                  <div className="relative">
                    <Thumb
                      url={panelUrl}
                      label={panelLabel}
                      downloadable={printReady}
                      onOpen={() => setPreview({ url: panelUrl, label: `${p.side} — ${panelLabel}` })}
                    />
                    {/* Where the bleed ends and the vehicle side begins. Drawn,
                        never cropped -- the panel must stay full-bleed. The
                        overlay travels with the panel, so it stays correct
                        whichever column the panel sits in. */}
                    {trimInsetPct && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 border border-dashed border-cyan-400/70"
                        style={{
                          left: `${trimInsetPct.x}%`,
                          right: `${trimInsetPct.x}%`,
                          top: `${trimInsetPct.y}%`,
                          bottom: `${trimInsetPct.y}%`,
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {logoPack.length > 0 && (
        <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-fuchsia-200">Logo Pack</span>
            <span className="text-[10px] text-zinc-500">value add · {logoPack.length} element{logoPack.length > 1 ? "s" : ""}</span>
            {/* The Logo Pack is a SEPARATE $29 purchase (owner's model,
                price set 2026-08-11) — this button was a dead "not available"
                toggle before; it now opens a real Stripe checkout whose
                payment lands in productionflow-stripe-webhook
                (product_type "logo_pack"). */}
            <button
              type="button"
              onClick={handleOrderLogoPack}
              disabled={orderingLogoPack || !resolved?.canonical}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-50"
            >
              {orderingLogoPack
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Opening checkout…</>
                : <><ShoppingBag className="w-3 h-3" /> Order Logo Pack · $29</>}
            </button>
          </div>
          <p className="text-[10px] text-zinc-400 leading-snug">
            The logos &amp; lettering lifted clean off your design — resize and place them anywhere. Available as a separate $29 add-on.
          </p>
          <div className="flex flex-wrap gap-2">
            {logoPack.map((l, i) => (
              <div key={l.url + i} className="w-20">
                <button
                  type="button"
                  onClick={() => onAddOverlayLayer?.(l.url, l.label)}
                  title="Drop onto the canvas as an editable layer"
                  className="block w-20 h-20 rounded-md border border-zinc-700 bg-zinc-950 overflow-hidden hover:border-fuchsia-400"
                >
                  <img src={l.url} alt={l.label} className="w-full h-full object-contain" loading="lazy" />
                </button>
                <a href={l.url} target="_blank" rel="noreferrer" className="mt-1 block text-center text-[9px] text-fuchsia-300 hover:underline truncate">{l.label}</a>
              </div>
            ))}
          </div>
        </div>
      )}
      {logoPack.length === 0 && logoPackGap.sides.length > 0 && (
        // The reason is NOT shown up front (owner 2026-07-30: "remove yellow
        // words about logo"). The Logo Pack is an optional add-on, so the
        // explanation belongs on the moment the customer asks for it, not as a
        // standing warning next to print-ready files.
        <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/40 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-zinc-300">Logo Pack</span>
            <span className="text-[10px] text-zinc-500">optional add-on</span>
            <button
              type="button"
              onClick={() => setLogoPackNotice((open) => !open)}
              className="ml-auto rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20"
            >
              Order Logo Pack
            </button>
          </div>
          {logoPackNotice && (
            <div
              // The engineering reason stays on hover for the team without
              // putting "outside-box diff 33.0 > 26" in front of a customer.
              title={logoPackGap.detail || undefined}
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 space-y-1"
            >
              <p className="text-[11px] font-semibold text-amber-200">
                Not available for this design
              </p>
              <p className="text-[10.5px] text-amber-100/80 leading-snug">
                The branding on this design can&apos;t be separated cleanly — its
                colours and contrast blend the logos into the artwork, and lifting
                them would smear the wrap.{" "}
                <span className="font-semibold">Your print files are not affected:</span>{" "}
                every panel above is complete and print-ready with the branding in
                place.
              </p>
              <div className="flex flex-wrap gap-1 pt-0.5">
                {logoPackGap.sides.map((side) => (
                  <span
                    key={side}
                    className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-200/80"
                  >
                    {side}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {latestBySide.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <p className="text-[10.5px] text-amber-200/90 leading-snug">
            <span className="font-bold">Working-resolution previews.</span> These are your design&apos;s own surfaces, cut from the master you approved — they show the exact design, dimensions and layout. When you purchase the Production Pack, every panel is resolved to <span className="font-semibold">final production geometry</span>, given its <span className="font-semibold">5″ bleed</span>, processed to <span className="font-semibold">full print resolution</span>, and the complete pack is saved to <span className="font-semibold">WrapBox</span> to download — track processing on the <span className="font-semibold">GENIE Universal Panelizer</span> page.
          </p>
        </div>
      )}
      {preview && (
        <PreviewModal
          url={preview.url}
          label={preview.label}
          onClose={() => setPreview(null)}
          onOrder={entice || printReady ? orderProductionPack : undefined}
        />
      )}
    </div>
  );
}

export default ProductionFlowLayersCard;
