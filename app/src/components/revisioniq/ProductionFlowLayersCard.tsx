/**
 * ProductionFlowLayersCard — RevisionStudio (dark UI) surface for the SEPARATED
 * production layers that `production-flow-engine` already authored per side into
 * `production_flow_assets`:
 *   • background_url   — the clean/blank print background (logos + text removed)
 *   • branding_url     — the complete branded panel composite
 *   • depth_mask_url   — a transparent depth/shadow map
 *   • final_pack_url   — the flattened print pack
 *
 * Surfacing them HERE lets the design team make FAST edits: instead of
 * regenerating the whole render, they grab the transparent branding/design-element
 * overlay and drop it straight onto the LayerLift canvas as an editable layer
 * (onAddOverlayLayer), or download any separated element.
 *
 * Read-only on production_flow_assets (SELECT allowed to authenticated by the
 * table's RLS policy). Renders nothing when a generation has no rows yet, so it
 * is always additive and never blocks the page.
 *
 * Dark theme to match RevisionStudioIQ (zinc surfaces, blue accent).
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layers, Download, MousePointerClick, Loader2, Hammer, X, Check, ShoppingBag, Wand2, FileText, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  getEnticeRevisionStatus,
  resumeEnticeRevision,
  submitEnticeRevision,
  submitProductionPack,
} from "@/lib/designpro-file-output";
import {
  getProductionPanelPackState,
  type ProductionFlowAssetRow,
} from "@/lib/productionFlowAssetState";
import type { ProductionLayersSource } from "@/lib/designpro-production-layers";

// ── GRAPHICS PACK LIFT — DISABLED (Trish, 2026-07-22) ───────────────────────
// The per-side "Lift branding" button (panel-artboard-generator step:"liftoverlays")
// AI-erases baked-in branding to derive a "clean" panel and OVERWRITES the good
// panel at production_flow_assets.background_url. Its gates verify the design
// OUTSIDE the branding boxes and the round-trip WITH overlays layered back — but
// NOT whether the clean panel is smear-free UNDERNEATH the logo. Moving/removing
// the logo then exposes a permanent smear (observed live on the 3D proof in
// RevisionStudio). It must never be able to corrupt a good vault panel.
// The worker /lift-overlays + edge step stay in place; only this operator trigger
// is gated off. The Graphics/Font Pack will be rebuilt from CLEAN sources
// (LogoPro vector + cut path / uploads / never-baked separate layers), not this
// destructive lift. Flip to true only after that clean-source rebuild replaces it.
const GRAPHICS_PACK_LIFT_ENABLED = false;

type PFARow = ProductionFlowAssetRow;

interface Props {
  /**
   * The id of the design on screen — usually the `color_visualizations` RENDER
   * id (which holds the views), but a DesignIQ generation id is also accepted.
   * The card resolves the CANONICAL id internally (PR #2768 pattern) and queries
   * production_flow_assets for BOTH ids, so it finds the separated layers whether
   * the build keyed them to the render id or the linked generation id.
   */
  generationId?: string | null;
  /**
   * Fast-edit hook: drop the transparent branding/design overlay onto the
   * LayerLift canvas as an editable layer. When omitted, only download is shown.
   */
  onAddOverlayLayer?: (url: string, name: string) => void;
  /**
   * WHERE THE LAYERS COME FROM.
   *
   * Omitted, the card resolves everything itself against the tables it was
   * written for -- unchanged behaviour, so nothing that mounts it today moves.
   *
   * Supplied, it consumes what the standalone runtime published through dpApi
   * instead: the same rows, the same pack identity, the same approved views.
   * That is the whole seam. The presentation below -- six branded panels beside
   * their own 3D views, the clean set, the separated logos, the two purchase
   * actions -- is identical either way, because the rows are.
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
  // An injected source answers for itself; the resolvers below stay switched
  // off rather than racing it for the same four answers.
  const injected = source || null;
  const queryClient = useQueryClient();
  const [building, setBuilding] = useState(false);
  const [ordering, setOrdering] = useState(false);
  // Fit-to-screen preview lightbox target ({url,label}) or null when closed.
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);

  // Resolve both immutable identities. Revision Studio normally passes the
  // color_visualizations id; callers that still pass the canonical DesignIQ id
  // are recovered through the latest server-authored Entice Pack.
  const { data: resolvedQuery, isLoading: resolvingQuery } = useQuery({
    queryKey: ["production_flow_assets_canonical_id", generationId],
    enabled: !!generationId && !injected,
    queryFn: async () => {
      const { data: direct, error: directError } = await (supabase as any)
        .from("color_visualizations")
        .select("id, admin_notes, updated_at")
        .eq("id", generationId)
        .maybeSingle();
      if (directError) throw directError;

      let canonical = generationId as string;
      let visualizationId = direct?.id ? String(direct.id) : "";
      let expectedUpdatedAt = direct?.updated_at ? String(direct.updated_at) : "";
      let notesSource = direct?.admin_notes;

      try {
        const notes = notesSource
          ? (typeof notesSource === "string" ? JSON.parse(notesSource) : notesSource)
          : {};
        if (notes?.designiq_generation_id) canonical = String(notes.designiq_generation_id);
      } catch { /* not linked */ }

      // FIRST-BUILD RECOVERY — resolve through the design's OWN back-link
      // before falling back to its Entice Pack.
      //
      // When this card is handed a canonical DesignIQ generation id, the direct
      // lookup above misses (that id is not a color_visualizations row) and the
      // ONLY other recovery path was the pack lookup below — which by
      // definition does not exist yet on a design's FIRST build. So
      // `visualizationId` stayed "", the status query (its `enabled` flag) never
      // ran, the button rendered its "Build production previews" label, and
      // handleBuild's identity guard refused the click before any request left
      // the browser. Chicken-and-egg: you could not create the first pack
      // because resolving needed a pack.
      //
      // Live 2026-08-02: after the pack.verify fix deployed, a rerun on the Urus
      // produced ZERO `designpro-file-output-api` requests in a 49-minute edge
      // log window — no submit, and no status call either, which is the
      // fingerprint of an empty visualizationId. That job carries SEVEN
      // designiq_generations rows and only one of them (`4fa058c2`) had a pack;
      // the other six dead-ended here.
      //
      // `admin_notes` is TEXT, not jsonb, so PostgREST cannot filter it with
      // `->>`. Narrow with a plain text match on the id, then CONFIRM the parsed
      // back-link equals it — the filter finds the row, the parse is what makes
      // the match exact. A near-miss (the id appearing elsewhere in the notes)
      // is rejected rather than trusted.
      if (!visualizationId) {
        const { data: linkedRenders, error: linkedRenderError } = await (supabase as any)
          .from("color_visualizations")
          .select("id, admin_notes, updated_at")
          .ilike("admin_notes", `%${generationId}%`)
          .order("created_at", { ascending: false })
          .limit(5);
        if (linkedRenderError) throw linkedRenderError;
        for (const row of (linkedRenders || [])) {
          let linkedId = "";
          try {
            const notes = typeof row?.admin_notes === "string"
              ? JSON.parse(row.admin_notes)
              : row?.admin_notes || {};
            linkedId = typeof notes?.designiq_generation_id === "string"
              ? notes.designiq_generation_id
              : "";
          } catch { /* unparseable notes are not a link */ }
          if (linkedId === generationId && row?.id && row?.updated_at) {
            visualizationId = String(row.id);
            expectedUpdatedAt = String(row.updated_at);
            break;
          }
        }
      }

      if (!visualizationId) {
        const { data: linkedPack, error: linkedPackError } = await (supabase as any)
          .from("designpro_entice_packs")
          .select("designiq_generation_id, source_visualization_id")
          .eq("designiq_generation_id", generationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (linkedPackError) throw linkedPackError;
        if (linkedPack) {
          canonical = String(linkedPack.designiq_generation_id);
          visualizationId = String(linkedPack.source_visualization_id);
          const { data: source, error: sourceError } = await (supabase as any)
            .from("color_visualizations")
            .select("updated_at")
            .eq("id", visualizationId)
            .maybeSingle();
          if (sourceError) throw sourceError;
          expectedUpdatedAt = source?.updated_at ? String(source.updated_at) : "";
        }
      }

      return { canonical, visualizationId, expectedUpdatedAt };
    },
  });

  // An injected source already knows which design this is, so there is nothing
  // to recover. visualizationId stays empty deliberately: it addresses a table
  // this path does not read, and the status query below is gated on it.
  const resolved = injected
    ? { canonical: injected.canonicalId, visualizationId: "", expectedUpdatedAt: "" }
    : resolvedQuery;
  const resolving = injected ? false : resolvingQuery;

  // Status is read through the public workflow facade, not reconstructed from
  // mutable browser state. visualizationId lookup lets a reload rediscover the
  // durable run without sessionStorage.
  const { data: enticeStatus = null, isLoading: enticeStatusLoading } = useQuery({
    queryKey: ["designpro_entice_status", resolved?.visualizationId],
    enabled: !!resolved?.visualizationId && !injected,
    queryFn: async () => {
      try {
        return await getEnticeRevisionStatus({
          visualizationId: resolved!.visualizationId,
        });
      } catch (error: any) {
        if (/not found/i.test(String(error?.message || ""))) return null;
        throw error;
      }
    },
    refetchOnMount: "always",
    retry: false,
    refetchInterval: (query) => {
      const status: any = query.state.data;
      const workflowStatus = String(status?.workflowRun?.workflow_status || "");
      return status?.enticePack?.status === "building"
        || ["queued", "running"].includes(workflowStatus)
        ? 3_000
        : false;
    },
  });

  const latestWorkflowStatus = String((enticeStatus as any)?.workflowRun?.workflow_status || "");
  const latestPackStatus = String((enticeStatus as any)?.enticePack?.status || "");
  const isEnticeUpdating =
    latestPackStatus === "building"
    || ["queued", "running"].includes(latestWorkflowStatus);
  const failedStage = Array.isArray((enticeStatus as any)?.stages)
    ? [...(enticeStatus as any).stages].reverse().find((stage: any) => stage?.status === "failed")
    : null;

  // The active pointer is the only pack displayed. A newer building/failed
  // revision never leaks half-updated proof, panel, or logo assets into this card.
  const activePack = injected ? injected.activePack : ((enticeStatus as any)?.activeEnticePack || null);
  const activePackLoading = enticeStatusLoading;

  const activeProofUrl = String((activePack as any)?.proof_artifact?.url || "");
  const expectedSurfaceCount = Array.isArray((activePack as any)?.surface_manifest?.surfaces)
    ? (activePack as any).surface_manifest.surfaces.length
    : 0;
  // PANELS ARE READ BY DESIGN ID. The pack pointer LABELS them; it does not
  // decide whether they exist.
  //
  // This query used to be `enabled: !!activePack?.id` plus four exact-match
  // filters against that pack. `pack.activate` is the LAST of eight stages, so
  // until it succeeded there was no pointer, the query never ran, and the card
  // rendered "No verified active Entice Pack… legacy and incomplete panels
  // remain hidden" — while finished panels sat in the vault. Panel output fell
  // to ~0/day the same day that gate landed. Six correct panels the customer
  // cannot see are worth exactly as much as no panels.
  //
  // `getProductionPanelPackState` was already the real safety mechanism and it
  // needs no pack id: it selects ONE complete source-hashed pack out of whatever
  // rows it is given, rejecting mixed revisions, mixed source hashes and
  // incomplete side sets on the row data itself. So the pack identity is applied
  // BELOW as a label (verified vs preview) and as the gate on the paid order
  // button — which stays exactly as strict as it was.
  const { data: rowsQuery = [], isLoading: rowsLoadingQuery } = useQuery({
    queryKey: ["production_flow_assets", "by-design", resolved?.canonical],
    enabled: !!resolved?.canonical && !injected,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_flow_assets")
        .select("id, job_id, side, version, revision_id, entice_pack_id, designiq_generation_id, dimension_manifest_id, manifest_hash, source_contract_hash, artifact_hash, dimensions_inches, background_url, branding_url, depth_mask_url, final_pack_url, meta_metrics, created_at")
        .eq("designiq_generation_id", resolved!.canonical)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as PFARow[];
    },
    refetchOnMount: "always",
    refetchInterval: (query) =>
      expectedSurfaceCount > 0
      && ((query.state.data || []) as PFARow[]).length < expectedSurfaceCount
        ? 3_000
        : false,
  });

  const rows = injected ? (injected.rows as PFARow[]) : rowsQuery;
  const rowsLoading = injected ? false : rowsLoadingQuery;

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

  // Comparison thumbnails come from the exact frozen revision that produced the
  // panels ON SCREEN — not from the activated pack, which may not exist yet.
  // Without this the "[Print-ready panel] | [Your approved design]" pair loses
  // its right-hand side for every preview pack.
  const displayRevisionId = String(
    latestBySide[0]?.revision_id || (activePack as any)?.revision_id || "",
  );
  const { data: designViewsQuery = {} } = useQuery({
    queryKey: ["production_flow_design_views", displayRevisionId],
    enabled: !!displayRevisionId && !injected,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("design_version_commits")
        .select("revision_snapshot")
        .eq("id", displayRevisionId)
        .maybeSingle();
      if (error) throw error;
      const snapshot = data?.revision_snapshot && typeof data.revision_snapshot === "object"
        ? data.revision_snapshot
        : {};
      const views = snapshot.renderUrls && typeof snapshot.renderUrls === "object"
        ? snapshot.renderUrls
        : {};
      return views as Record<string, string>;
    },
  });

  const designViews = injected ? injected.designViews : designViewsQuery;

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

  // Manual build/retry only submits or resumes the durable server workflow.
  // There is intentionally no mount effect and no browser proof/panel producer.
  const handleBuild = async () => {
    if (
      !resolved?.visualizationId
      || !resolved?.canonical
      || !resolved?.expectedUpdatedAt
      || building
    ) {
      if (!building) {
        toast({
          title: "Revision identity unavailable",
          description: "Save the design once, then retry the server build.",
          variant: "destructive",
        });
      }
      return;
    }
    setBuilding(true);
    try {
      // OPTIMISTIC-CONCURRENCY FIX (2026-07-30). `resolved.expectedUpdatedAt`
      // comes from a cached useQuery result. Generating a design writes to this
      // same color_visualizations row many times (a live Urus run produced 16
      // designiq rows and rewrote render_urls), so by the time the user clicks
      // Build the cached timestamp is stale. save_and_enqueue_designpro_revision
      // compares it with FOR UPDATE and raises revision_source_changed, so no
      // entice pack is ever created — while the UI polls status for that
      // never-created pack and 404s indefinitely behind the "Building
      // Production Proof on Server" spinner. Live 2026-07-30: ~20x 404, then
      // 503, then 409, zero designpro_entice_packs rows, zero
      // workflow_stage_runs rows, and generate-2d-proof never invoked.
      //
      // Read the row's CURRENT updated_at immediately before submitting. This
      // does not weaken the concurrency guard — the RPC still takes the row
      // FOR UPDATE and re-checks — it just stops us sending a value we already
      // know is out of date.
      const { data: fresh, error: freshError } = await (supabase as any)
        .from("color_visualizations")
        .select("updated_at")
        .eq("id", resolved.visualizationId)
        .maybeSingle();
      if (freshError) throw freshError;
      const expectedUpdatedAt = fresh?.updated_at
        ? String(fresh.updated_at)
        : resolved.expectedUpdatedAt;

      const accepted = await submitEnticeRevision({
        visualizationId: resolved.visualizationId,
        expectedUpdatedAt,
        generationId: resolved.canonical,
        trigger: (enticeStatus as any)?.workflowRun
          ? "revision_saved"
          : "initial_generation",
        change: {
          type: (enticeStatus as any)?.workflowRun ? "revision" : "generate",
        },
        idempotencyKey:
          `layers-card:${resolved.visualizationId}:${expectedUpdatedAt}`,
      });
      const acceptedStatus = String((accepted.workflowRun as any)?.workflow_status || "");
      if (acceptedStatus === "failed") {
        await resumeEnticeRevision(accepted.workflowRun.id, true);
      }
      toast({
        title: accepted.idempotent
          ? "Server workflow already recorded"
          : "Production previews accepted",
        description: acceptedStatus === "failed"
          ? "The failed workflow was safely reopened from its last verified stage."
          : "GENIE is building the proof, panels, and logo pack on the server.",
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["designpro_entice_status", resolved.visualizationId],
        }),
        queryClient.invalidateQueries({
          queryKey: [
            "designpro_active_entice_pack",
            resolved.canonical,
            resolved.visualizationId,
          ],
        }),
        queryClient.invalidateQueries({ queryKey: ["production_flow_assets"] }),
      ]);
    } catch (error: any) {
      toast({
        title: "Server build could not start",
        description: String(error?.message || error).slice(0, 220),
        variant: "destructive",
      });
    } finally {
      setBuilding(false);
    }
  };

  // Paid promotion pins the exact active Entice Pack. The card will not create a
  // browser-side order/job identity or rerun Entice generation as a side effect.
  //
  // An injected source brings its own checkout. Same gate, same eligibility --
  // only the action behind the button changes, from the legacy job promotion to
  // the standalone purchase the entitlement is recorded against.
  const orderProductionPack = injected
    ? (injected.onOrderProductionPack && isVerifiedPack && packState.productionEligible
      ? async () => {
        if (ordering) return;
        setOrdering(true);
        try {
          await injected.onOrderProductionPack!();
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
      : undefined)
    : activePack && isVerifiedPack && packState.productionEligible
    ? async () => {
      if (ordering) return;
      setOrdering(true);
      try {
        const { data: panelizerJob, error: panelizerError } = await (supabase as any)
          .from("panelizer_jobs")
          .select("id, generation_id")
          .eq("generation_id", (activePack as any).designiq_generation_id)
          .eq("job_type", "production_pack")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (panelizerError) throw panelizerError;
        if (!panelizerJob?.id) {
          throw new Error(
            "No tenant-owned Production Pack request is attached to this design. Complete Production Pack checkout, then retry.",
          );
        }
        const accepted = await submitProductionPack({
          jobId: String(panelizerJob.id),
          generationId: String((activePack as any).designiq_generation_id),
          enticePackId: String((activePack as any).id),
          idempotencyKey:
            `layers-order:${panelizerJob.id}:${(activePack as any).id}`,
        });
        toast({
          title: accepted.idempotent
            ? "Production Pack already queued"
            : "Production Pack accepted",
          description: "The exact active revision is continuing on the server.",
        });
      } catch (error: any) {
        const needsCheckout = error?.code === "pack_required";
        toast({
          title: needsCheckout
            ? "Production Pack checkout required"
            : "Production Pack could not start",
          description: String(error?.message || error).slice(0, 220),
          variant: "destructive",
        });
      } finally {
        setOrdering(false);
      }
    }
    : undefined;

  const handleRetryServerBuild = async () => {
    if (latestWorkflowStatus === "completed" && activePack) {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["designpro_entice_status", resolved?.visualizationId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["production_flow_assets", "active-entice-pack", (activePack as any).id],
        }),
      ]);
      toast({
        title: "Server pack is current",
        description: "The active verified revision was refreshed without regenerating it.",
      });
      return;
    }
    if (!latestWorkflowStatus) {
      await handleBuild();
      return;
    }
    if (!["failed", "cancelled"].includes(latestWorkflowStatus)) return;
    const runId = String((enticeStatus as any)?.workflowRun?.id || "");
    const failedRevisionId = String((enticeStatus as any)?.enticePack?.revision_id || "");
    if (
      !runId
      || !failedRevisionId
      || !resolved?.expectedUpdatedAt
      || latestWorkflowStatus === "cancelled"
    ) {
      toast({
        title: "Workflow cannot be resumed",
        description: latestWorkflowStatus === "cancelled"
          ? "Save a new revision to create a new server workflow."
          : "The durable workflow identity is missing.",
        variant: "destructive",
      });
      return;
    }
    if (failedRevisionId && resolved?.expectedUpdatedAt) {
      const { data: failedRevision, error: failedRevisionError } = await (supabase as any)
        .from("design_version_commits")
        .select("revision_snapshot")
        .eq("id", failedRevisionId)
        .maybeSingle();
      if (failedRevisionError) {
        toast({
          title: "Retry identity could not be verified",
          description: failedRevisionError.message,
          variant: "destructive",
        });
        return;
      }
      const frozenSavedAt = String(
        failedRevision?.revision_snapshot?.savedAt
        || failedRevision?.revision_snapshot?.saved_at
        || "",
      );
      if (!frozenSavedAt || !Number.isFinite(Date.parse(frozenSavedAt))) {
        toast({
          title: "Retry identity is incomplete",
          description: "Save the revision again so the server can freeze its exact pixels.",
          variant: "destructive",
        });
        return;
      }
      if (
        Date.parse(frozenSavedAt) !== Date.parse(resolved.expectedUpdatedAt)
      ) {
        // The canvas changed after the failed run. Freeze a new immutable
        // revision instead of resuming and activating stale pixels.
        await handleBuild();
        return;
      }
    }
    setBuilding(true);
    try {
      await resumeEnticeRevision(runId, true);
      toast({
        title: "Server workflow resumed",
        description: "Processing continues from the last verified stage.",
      });
      await queryClient.invalidateQueries({
        queryKey: ["designpro_entice_status", resolved?.visualizationId],
      });
    } catch (error: any) {
      toast({
        title: "Retry failed",
        description: String(error?.message || error).slice(0, 220),
        variant: "destructive",
      });
    } finally {
      setBuilding(false);
    }
  };

  // GRAPHICS PACK — DesignPro-only surface (docs/SCOPE_DETERMINISTIC_OVERLAY_LIFT.md).
  // The lift button shows ONLY when the design has a designiq_generations row,
  // which structurally excludes RecreatePro and GraphicsPro jobs (viz-keyed only).
  const { data: isDesignProJob = false } = useQuery({
    queryKey: ["designiq_exists", resolved?.canonical],
    enabled: !!resolved?.canonical,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("designiq_generations").select("id").eq("id", resolved!.canonical).maybeSingle();
      return !!data;
    },
  });
  const [lifting, setLifting] = useState<string | null>(null);
  // Why the Logo Pack add-on is unavailable, revealed on request rather than
  // shown as a standing warning beside print-ready files.
  const [logoPackNotice, setLogoPackNotice] = useState(false);
  const [orderingLogoPack, setOrderingLogoPack] = useState(false);
  // $29 Logo Pack checkout (owner's separate-purchase model). The webhook
  // fulfills by the canonical DesignIQ generation id, so that exact id — never
  // a render id — goes into the session metadata.
  const handleOrderLogoPack = async () => {
    const canonical = resolved?.canonical;
    if (!canonical || orderingLogoPack) return;
    setOrderingLogoPack(true);
    // The standalone path never reaches the RestylePro edge function; its
    // checkout is the gateway route, and the entitlement it records is the
    // Logo Pack's own -- separate from the Production Pack, so buying one can
    // never authorize the other's fulfillment.
    if (injected) {
      try {
        if (!injected.onOrderLogoPack) throw new Error("Logo Pack checkout is not available");
        await injected.onOrderLogoPack();
      } catch (e) {
        toast({
          title: "Logo Pack checkout failed",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
        setOrderingLogoPack(false);
      }
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("create-single-use-checkout", {
        body: {
          tool: "logo_pack",
          generation_id: canonical,
          return_path: window.location.pathname,
        },
      });
      if (error || !data?.url) throw new Error(error?.message || "Checkout could not be created");
      window.location.href = String(data.url);
    } catch (e) {
      toast({
        title: "Logo Pack checkout failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setOrderingLogoPack(false);
    }
  };

  // CUT-READY LOGO FILES — the lifted logos in the Logo Pack are transparent
  // raster PNGs, not cut contours. cutpath-element-extract (VTracer WASM →
  // Bézier SVG + EPS) is the sanctioned producer; this reads any pack already
  // built for this design so a reload can re-offer the download.
  const [cutting, setCutting] = useState(false);
  const { data: cutFiles = null } = useQuery({
    queryKey: ["logo_pack_cutfiles", resolved?.visualizationId],
    enabled: !!resolved?.visualizationId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("color_visualizations")
        .select("admin_notes")
        .eq("id", resolved!.visualizationId)
        .maybeSingle();
      let notes: Record<string, any> = {};
      try {
        notes = typeof data?.admin_notes === "string" ? JSON.parse(data.admin_notes) : (data?.admin_notes || {});
      } catch { notes = {}; }
      const cf = notes?.logo_pack_cutfiles;
      return cf && typeof cf.zip_url === "string" ? (cf as { zip_url: string; count?: number; generated_at?: string }) : null;
    },
  });

  const handleLift = async (side: string) => {
    if (!GRAPHICS_PACK_LIFT_ENABLED) return; // disabled — see rationale at top of file
    const gid = (resolved?.canonical || generationId) as string;
    if (!gid || lifting) return;
    setLifting(side);
    try {
      const { data } = await (supabase as any).functions.invoke("panel-artboard-generator", {
        body: { step: "liftoverlays", generationId: gid, side },
      });
      if (data?.success && Number(data?.lifted) > 0) {
        toast({
          title: `${side}: ${data.lifted} branding layer${data.lifted === 1 ? "" : "s"} lifted`,
          description: `Clean panel + editable layers saved (round-trip diff ${data.qc?.roundTripDiff ?? "—"}).`,
        });
        await queryClient.invalidateQueries({ queryKey: ["production_flow_assets"] });
      } else if (data?.success) {
        toast({ title: `${side}: nothing to lift`, description: data?.reason || "no branding elements detected" });
      } else {
        // HONEST FLAG — a failed gate persists nothing; show exactly why.
        toast({ title: `${side}: lift failed`, description: data?.error || "unknown error", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: `${side}: lift failed`, description: String(e?.message || e).slice(0, 160), variant: "destructive" });
    } finally {
      setLifting(null);
    }
  };

  // Route the Logo Pack through cutpath-element-extract to produce REAL cut
  // files: a VTracer Bézier SVG + PostScript EPS contour per logo, plus the
  // alpha-preserved raster, all zipped. The lifted PNGs alone are not cut
  // contours — this is the producer that makes them plotter-ready. The result
  // is persisted onto this render row's admin_notes (a direct client write, per
  // the edge-function-cap pattern already used for logo_pack itself).
  const handleCutLogoPack = async () => {
    if (cutting) return;
    if (!logoPack.length) return;
    const vizId = resolved?.visualizationId;
    setCutting(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("cutpath-element-extract", {
        body: {
          owner_id: vizId || undefined,
          elements: logoPack.map((l) => ({ url: l.url, label: l.label })),
        },
      });
      if (error) throw error;
      if (!data?.success || !data?.zip_url) {
        throw new Error(data?.error || "no cut files produced");
      }
      const record = {
        zip_url: String(data.zip_url),
        count: Number(data.vector_ok || 0),
        generated_at: new Date().toISOString(),
      };
      // Persist onto the render row so a reload re-offers the download.
      if (vizId) {
        try {
          const { data: cur } = await (supabase as any)
            .from("color_visualizations").select("admin_notes").eq("id", vizId).maybeSingle();
          let notes: Record<string, any> = {};
          try { notes = typeof cur?.admin_notes === "string" ? JSON.parse(cur.admin_notes) : (cur?.admin_notes || {}); } catch { notes = {}; }
          notes.logo_pack_cutfiles = record;
          await (supabase as any).from("color_visualizations").update({ admin_notes: JSON.stringify(notes) }).eq("id", vizId);
        } catch { /* non-fatal — the zip still downloads below */ }
      }
      await queryClient.invalidateQueries({ queryKey: ["logo_pack_cutfiles", vizId] });
      toast({
        title: `${record.count} cut file${record.count === 1 ? "" : "s"} ready`,
        description: "Vector SVG + EPS contour and raster per logo — downloading now.",
      });
      window.open(record.zip_url, "_blank", "noopener");
    } catch (e: any) {
      toast({ title: "Cut files failed", description: String(e?.message || e).slice(0, 160), variant: "destructive" });
    } finally {
      setCutting(false);
    }
  };

  if (
    !generationId
    || resolving
    || activePackLoading
    || rowsLoading
  ) return null;

  // Empty state — legacy/incomplete rows stay quarantined. The only action here
  // submits/resumes the server workflow; opening the card never starts work.
  if (latestBySide.length === 0) {
    return (
      <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3", className)}>
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-bold text-zinc-200">Production Layers</span>
        </div>
        <p className="text-[11px] text-amber-300 leading-snug">
          {isEnticeUpdating
            ? "Updating production previews on the server. The active pack will switch only after the proof, every required panel, and the logo pack verify together."
            : latestWorkflowStatus === "failed"
              ? `The server build stopped at ${failedStage?.stage_key || "an unknown stage"}: ${failedStage?.error_message || "structured failure recorded"}.`
              : "No complete panel set exists for this design yet. Panels appear here as soon as the server finishes building them — they no longer wait on final pack activation."}
        </p>
        <button
          type="button"
          onClick={handleRetryServerBuild}
          disabled={building || isEnticeUpdating}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-fuchsia-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {building || isEnticeUpdating
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Server workflow running…</>
            : latestWorkflowStatus === "failed"
              ? <><Hammer className="w-4 h-4" /> Retry from verified stage</>
              : <><Hammer className="w-4 h-4" /> Build production previews</>}
        </button>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3", className)}>
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-bold text-zinc-200">
          {printReady ? "Print Ready Files" : isVerifiedPack ? "Panel previews — production blocked" : "Panel previews — awaiting verification"}
        </span>
        <button
          type="button"
          onClick={handleRetryServerBuild}
          disabled={building || isEnticeUpdating}
          className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-blue-400 hover:text-blue-300 disabled:opacity-60"
          title="Submit or retry the server-owned Entice Pack workflow"
        >
          {building || isEnticeUpdating
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Updating…</>
            : latestWorkflowStatus === "failed"
              ? <><Hammer className="w-3 h-3" /> Retry</>
              : <><Hammer className="w-3 h-3" /> Check server pack</>}
        </button>
        <span className="text-[10px] text-zinc-500">{latestBySide.length} side{latestBySide.length === 1 ? "" : "s"}</span>
      </div>
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
        Active revision only — every side, proof, and logo is pinned to Entice Pack {(activePack as any).id.slice(0, 8)}.
      </p>
      {isEnticeUpdating && (
        <p className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2.5 py-2 text-[11px] font-semibold text-blue-200">
          Updating production previews… This verified revision remains available until the new pack passes and the active pointer switches atomically.
        </p>
      )}
      {latestWorkflowStatus === "failed" && (
        <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] font-semibold text-rose-200">
          New revision failed at {failedStage?.stage_key || "an unknown stage"}: {failedStage?.error_message || "structured failure recorded"}. The verified pack shown below was not replaced.
        </p>
      )}
      {!printReady && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] font-semibold text-amber-300">
          Preview only — the panels themselves are not production eligible. Downloads and paid production are blocked.
        </p>
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
          const panelLabel = printReady
            ? "Print ready · QC passed"
            : "Preview only · production blocked";
          const di: any = p.dimensions_inches || {};
          const w = di.w ?? di.width;
          const h = di.h ?? di.height;
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
                  {GRAPHICS_PACK_LIFT_ENABLED && isDesignProJob && (
                    <button
                      type="button"
                      onClick={() => handleLift(p.side)}
                      disabled={!!lifting}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-fuchsia-400 hover:text-fuchsia-300 disabled:opacity-50"
                      title="Graphics Pack: lift the branding off this panel into editable layers over a clean background"
                    >
                      {lifting === p.side
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Lifting…</>
                        : <><Wand2 className="w-3 h-3" /> Lift branding</>}
                    </button>
                  )}
                  <span className="text-[10px] text-zinc-500">
                    {p.version}
                    {w && h ? ` · ${w}″ × ${h}″` : ""}
                  </span>
                </span>
              </div>
              <div className={cn("grid gap-2", cols)}>
                {panelUrl && (
                  <Thumb
                    url={panelUrl}
                    label={panelLabel}
                    downloadable={printReady}
                    onOpen={() => setPreview({ url: panelUrl, label: `${p.side} — ${panelLabel}` })}
                  />
                )}
                {showApproved && <Thumb url={brandedView} label="Your approved design" onOpen={() => setPreview({ url: brandedView, label: `${p.side} — your approved design` })} />}
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
          <div className="flex items-center gap-2">
            {cutFiles?.zip_url ? (
              <a
                href={cutFiles.zip_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20"
                title="Vector SVG + EPS contour and raster per logo, ready for the plotter"
              >
                <Download className="w-3 h-3" /> Download cut files (SVG · EPS)
              </a>
            ) : (
              <button
                type="button"
                onClick={handleCutLogoPack}
                disabled={cutting}
                className="inline-flex items-center gap-1.5 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-50"
                title="Trace each logo into a plotter-ready Bézier cut path (SVG + EPS)"
              >
                {cutting
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Tracing cut paths…</>
                  : <><Scissors className="w-3 h-3" /> Make cut-ready files</>}
              </button>
            )}
          </div>
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
            <span className="font-bold">Working-resolution previews.</span> These panels show the exact design, dimensions and layout for approval. When you purchase the Production Pack, every panel is processed to <span className="font-semibold">full print resolution</span> and the complete pack is saved to <span className="font-semibold">WrapBox</span> to download — track processing on the <span className="font-semibold">GENIE Universal Panelizer</span> page.
          </p>
        </div>
      )}
      {preview && (
        <PreviewModal
          url={preview.url}
          label={preview.label}
          onClose={() => setPreview(null)}
          onOrder={printReady ? orderProductionPack : undefined}
        />
      )}
    </div>
  );
}

export default ProductionFlowLayersCard;
