/**
 * DesignAssetsPanel — white-UI (ApprovePro / ProductionFlow style) workbench for
 * a DesignPro generation. 3-column layout:
 *   LEFT   — Source & History (original prompt + version chips)
 *   CENTER — Design (Artboard Proof tab + 3D Designs tab)
 *   RIGHT  — Separated Files tab (clean background + lifted layers, downloadable)
 *            + Golden Assets tab (the exact active Entice Pack artifacts)
 *
 * Asset reads are exact-pack scoped. The only production action is submitting or
 * resuming the durable server workflow; this component never conducts stages.
 * Style: white surface, gray-900/600/500 text, #3b82f6 -> #ec4899 gradient accent.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Layers, Boxes, Download, History, GitCommit, Ruler, Loader2 } from "lucide-react";
import { getVersionCommits, type VersionCommit } from "@/lib/revision-commits";
import {
  getEnticeRevisionStatus,
  resumeEnticeRevision,
  saveEnticeRevision,
} from "@/lib/designpro-file-output";

interface OverlayPng {
  id?: string;
  url: string;
  kind?: string;
  role?: string;
}

// ── Real-asset compose (Map First, Flatten Last) ──────────────────────────────
// For KNOWN graphics (flags, logos, eagles) the AI image model can't be trusted
// with the print pixels (it can't count 13 stripes / 50 stars and bakes studio
// light into the whites). composeMode routes each side through the deterministic
// composeflat step instead: composite the EXACT supplied clean assets onto a flat
// artboard at true GENIE dims — zero AI on the print pixels.
interface ComposeOverlay { url: string; xPct: number; yPct: number; wPct: number }
interface ComposeSide { background: string; fit: "fill" | "tile"; overlays: ComposeOverlay[] }

interface DGARow {
  id: string;
  generation_id: string;
  background_url: string | null;
  overlay_pngs: OverlayPng[] | null;
  proof_2d_url: string | null;
  proof_3d_url: string | null;
  view_urls: Record<string, string> | null;
}

interface PFARow {
  id: string;
  side: string;
  version: string;
  dimensions_inches: { width?: number; height?: number } | null;
  background_url: string | null;
  branding_url: string | null;
  depth_mask_url: string | null;
  final_pack_url: string | null;
}

const CHECKER =
  "[background-image:linear-gradient(45deg,#e5e7eb_25%,transparent_25%),linear-gradient(-45deg,#e5e7eb_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e5e7eb_75%),linear-gradient(-45deg,transparent_75%,#e5e7eb_75%)] [background-size:16px_16px] [background-position:0_0,0_8px,8px_-8px,-8px_0]";

const downloadHref = (url: string) => `${url}${url.includes("?") ? "&" : "?"}download`;

const SAVED_VIEW_ALIASES: Record<string, string[]> = {
  "DRIVER SIDE": ["side", "driver", "driver-side", "driver_side"],
  "PASSENGER SIDE": ["passenger", "passenger-side", "passenger_side"],
  HOOD: ["hood", "hood-detail", "hood_detail"],
  ROOF: ["roof"],
  FRONT: ["front"],
  REAR: ["rear"],
};

function savedSurfaceOptions(
  adminNotes: unknown,
  renderUrls: Record<string, string>,
  vehicleType: unknown,
): Record<string, unknown> | null {
  let notes: Record<string, any> = {};
  try {
    notes =
      typeof adminNotes === "string"
        ? JSON.parse(adminNotes)
        : adminNotes && typeof adminNotes === "object" && !Array.isArray(adminNotes)
          ? (adminNotes as Record<string, any>)
          : {};
  } catch {
    notes = {};
  }
  const persisted =
    notes.surface_options &&
    typeof notes.surface_options === "object" &&
    !Array.isArray(notes.surface_options)
      ? notes.surface_options
      : notes.production_options &&
          typeof notes.production_options === "object" &&
          !Array.isArray(notes.production_options)
        ? notes.production_options
        : null;
  if (
    persisted &&
    Array.isArray(persisted.expectedPanelSides) &&
    persisted.expectedPanelSides.length > 0
  ) {
    return persisted;
  }

  // Compatibility is fail-closed: only a complete recognized legacy view set
  // can mint a missing manifest. Partial or ambiguous jobs stay blocked.
  const keys = new Set(
    Object.keys(renderUrls).map((key) =>
      key.trim().toLowerCase().replace(/\s+/g, "-"),
    ),
  );
  const hasSurface = (side: string) =>
    (SAVED_VIEW_ALIASES[side] || []).some((key) => keys.has(key));
  const trailer =
    String(vehicleType || "").trim().toLowerCase() === "trailer";
  const expectedPanelSides = trailer
    ? ["DRIVER SIDE", "PASSENGER SIDE", "FRONT", "REAR"]
    : ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR"];
  if (!expectedPanelSides.every(hasSurface)) return null;

  return {
    productType: "vehicle_wrap",
    coverage: "legacy_complete_saved_views",
    expectedPanelSides,
    addHood: expectedPanelSides.includes("HOOD"),
    addRoof: expectedPanelSides.includes("ROOF"),
    addFrontBumper: expectedPanelSides.includes("FRONT"),
    addRearBumper: expectedPanelSides.includes("REAR"),
    manifestSource: "complete_saved_view_set",
  };
}

function Card({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white border border-gray-200 shadow-md overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-gray-100">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shadow-sm shrink-0 text-white">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-900 leading-none">{title}</h3>
          {subtitle && <p className="mt-1 text-[11px] text-gray-500 truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function AssetTile({ url, label, transparent }: { url: string; label: string; transparent?: boolean }) {
  return (
    <div className="group rounded-xl border border-gray-200 overflow-hidden hover:border-[#3b82f6] transition-colors">
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <div className={`aspect-video flex items-center justify-center ${transparent ? CHECKER : "bg-gray-50"}`}>
          <img src={url} alt={label} className="max-h-full max-w-full object-contain" loading="lazy" />
        </div>
      </a>
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white border-t border-gray-100">
        <p className="text-[11px] font-medium text-gray-600 truncate group-hover:text-gray-900">{label}</p>
        <a
          href={downloadHref(url)}
          download
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[#3b82f6] hover:text-[#ec4899]"
          title={`Download ${label}`}
        >
          <Download className="w-3 h-3" />
          Download
        </a>
      </div>
    </div>
  );
}

const tabTrigger =
  "rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 data-[state=active]:text-white data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#3b82f6] data-[state=active]:to-[#ec4899]";

// Build a 3-zone production template SVG (Zone 1 bleed / Zone 2 trim / Zone 3
// safe) at the panel's true dimensions. Vector → perfect text, scales cleanly.
// trimW/trimH in inches; bleed + safe insets in inches.
function buildZoneSVG(side: string, trimW: number, trimH: number, bleed = 3, safe = 2): string {
  const S = 10;                                   // px per inch in SVG space
  const cW = trimW + 2 * bleed, cH = trimH + 2 * bleed;       // canvas (with bleed)
  const W = Math.round(cW * S), H = Math.round(cH * S);
  const bPx = bleed * S, sPx = (bleed + safe) * S;
  const trimWp = trimW * S, trimHp = trimH * S;
  const safeWp = Math.max(0, (trimW - 2 * safe) * S), safeHp = Math.max(0, (trimH - 2 * safe) * S);
  const f = Math.max(11, Math.round(H * 0.035));   // base font
  const fs = Math.round(f * 0.8);
  const num = (n: number) => (Math.round(n * 10) / 10).toString();
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <!-- ZONE 1: total canvas + bleed -->
  <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#e74c3c" stroke-width="${Math.max(3, S * 0.5)}"/>
  <text x="${S * 1}" y="${f * 1.2}" font-family="Arial, sans-serif" font-size="${f}" font-weight="bold" fill="#e74c3c">${side} — ZONE 1: TOTAL CANVAS (incl. ${num(bleed)}" bleed) · ${num(cW)}" × ${num(cH)}"</text>
  <!-- ZONE 2: physical trim panel -->
  <rect x="${bPx}" y="${bPx}" width="${trimWp}" height="${trimHp}" fill="none" stroke="#333333" stroke-width="${Math.max(2, S * 0.35)}" stroke-dasharray="${S * 2},${S}"/>
  <text x="${W / 2}" y="${H / 2}" font-family="Arial, sans-serif" font-size="${f}" font-weight="bold" fill="#333333" text-anchor="middle">ZONE 2: PHYSICAL PANEL (TRIM) · ${num(trimW)}" × ${num(trimH)}"</text>
  <!-- ZONE 3: safe live area -->
  <rect x="${sPx}" y="${sPx}" width="${safeWp}" height="${safeHp}" fill="none" stroke="#27ae60" stroke-width="${Math.max(2, S * 0.3)}" stroke-dasharray="${S * 0.6},${S * 0.6}"/>
  <text x="${W / 2}" y="${sPx + f * 1.4}" font-family="Arial, sans-serif" font-size="${fs}" font-weight="bold" fill="#27ae60" text-anchor="middle">ZONE 3: SAFE LIVE AREA · ${num(trimW - 2 * safe)}" × ${num(trimH - 2 * safe)}" (keep vital art inside)</text>
  <!-- bleed indicator -->
  <path d="M0,${H / 2} L${bPx},${H / 2}" stroke="#e74c3c" stroke-width="2"/>
  <text x="${bPx + 4}" y="${H / 2 - 4}" font-family="Arial, sans-serif" font-size="${fs}" fill="#e74c3c">${num(bleed)}" bleed</text>
</svg>`;
}

// Upload a local file (e.g. a Gemini-made flat asset) → ingest → stable URL.
function UploadBtn({ onPick, disabled, label = "Upload" }: { onPick: (f: File) => void; disabled?: boolean; label?: string }) {
  return (
    <label
      className={`shrink-0 cursor-pointer rounded-lg px-2 py-1.5 text-xs font-semibold border bg-white text-gray-700 border-gray-300 hover:border-[#3b82f6] ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      title="Upload a clean flat asset (PNG) from your computer"
    >
      {label}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = ""; }}
      />
    </label>
  );
}

export function DesignAssetsPanel({ generationId, autoBuild = false, fallbackVehicle }: { generationId: string; autoBuild?: boolean; fallbackVehicle?: { make?: string; model?: string; year?: string; vehicleType?: string } }) {
  const qc = useQueryClient();
  const [building, setBuilding] = useState(false);
  const [buildMsg, setBuildMsg] = useState<string | null>(null);
  const [maskOn, setMaskOn] = useState(false); // Toggle Mask Overlay — GENIE blueprint at 50% for alignment QC
  const [composeMode, setComposeMode] = useState(false); // Real-asset compose for known graphics (flags/logos) — composeflat, no AI on print pixels
  const [composeMap, setComposeMap] = useState<Record<string, ComposeSide>>({});
  const [composeEditor, setComposeEditor] = useState(false); // show the per-side asset editor
  const [tracing, setTracing] = useState(false); // generating transparent alignment line-traces
  const [traces, setTraces] = useState<Array<{ side: string; url?: string; error?: string }>>([]);
  const [traceSource, setTraceSource] = useState<"panels" | "3d" | "proof" | "artboard" | "template">("proof"); // default = flat 2D (no vehicle; traces/overlays the wrap design 1:1)
  const [uploading, setUploading] = useState(false); // uploading a Gemini-made asset into the vault

  // CANONICAL ID — a design's assets (artboard / 2D proof / production-flow
  // layers / separated PNGs) are keyed to its DesignIQ generation id, but this
  // page is often opened with the color_visualizations RENDER id (which holds
  // the VIEWS). Resolve the linked generation id from the render's admin_notes
  // so every asset query AND the build hit the record that actually has the
  // assets — this is what stops the empty "No assets found" page and the
  // panel-artboard-generator 400 (empty inputs). Falls back to the passed id.
  const { data: resolvedGid } = useQuery({
    queryKey: ["design-assets-canonical-id", generationId],
    enabled: !!generationId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("color_visualizations")
        .select("admin_notes")
        .eq("id", generationId)
        .maybeSingle();
      try {
        const n = data?.admin_notes ? (typeof data.admin_notes === "string" ? JSON.parse(data.admin_notes) : data.admin_notes) : {};
        if (n?.designiq_generation_id) return String(n.designiq_generation_id);
      } catch { /* not linked */ }
      return generationId;
    },
  });
  const gid = resolvedGid || generationId;

  const { data: dga, isLoading: dgaLoading } = useQuery({
    queryKey: ["design_generation_assets", gid],
    enabled: !!gid,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("design_generation_assets")
        .select("id, generation_id, background_url, overlay_pngs, proof_2d_url, proof_3d_url, view_urls")
        .eq("generation_id", gid)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as DGARow) || null;
    },
  });

  const { data: gen } = useQuery({
    queryKey: ["designiq_generations_assets", gid],
    enabled: !!gid,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("designiq_generations")
        .select("id, company_name, render_urls, master_artboard_url, flat_proof_url, hero_render_url, raw_prompt, enhanced_prompt, created_at, vehicle_make, vehicle_model, vehicle_year, finish")
        .eq("id", gid)
        .maybeSingle();
      if (error) throw error;
      return data as {
        company_name?: string;
        render_urls?: Record<string, string>;
        master_artboard_url?: string;
        flat_proof_url?: string;
        hero_render_url?: string;
        raw_prompt?: string;
        enhanced_prompt?: string;
        created_at?: string;
        vehicle_make?: string;
        vehicle_model?: string;
        vehicle_year?: string | number;
        finish?: string;
      } | null;
    },
  });

  const { data: versions = [] } = useQuery({
    queryKey: ["design_generation_assets_versions", gid],
    enabled: !!gid,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("design_generation_assets")
        .select("id, iteration_index, is_current, created_at, source_prompt")
        .eq("generation_id", gid)
        .order("iteration_index", { ascending: true });
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        iteration_index: number | null;
        is_current: boolean | null;
        created_at: string;
        source_prompt: string | null;
      }>;
    },
  });

  // ApprovePro / RecreatePro designs live in color_visualizations (not
  // designiq_generations). Their master artboard + views are saved in
  // render_urls (render_urls.master_artboard). Read it so the artboard and 3D
  // views show for those designs too — full parity with DesignProAI.
  const { data: cv } = useQuery({
    queryKey: ["color_visualizations_assets", generationId],
    enabled: !!generationId,
    queryFn: async () => {
      // Direct match: the page was opened on a color_visualizations id.
      // (id selected so the build can persist the proof+artboard pair back.)
      const { data: direct } = await (supabase as any)
        .from("color_visualizations")
        .select("id, render_urls, vehicle_make, vehicle_model, vehicle_year, vehicle_type, admin_notes, updated_at")
        .eq("id", generationId)
        .maybeSingle();
      if (direct) return direct as any;
      // CANONICAL-ID LINKAGE: the page was opened on a designiq_generations id
      // (e.g. Revision Studio's asset workbench), but the 3D views + 2D proof live
      // on a LINKED color_visualizations row that back-links to this gen id via
      // admin_notes.designiq_generation_id. Without following that link the page
      // otherwise shows "0 views". admin_notes is TEXT (JSON string), so
      // match it with ilike (a UUID is unique enough to be safe).
      const { data: linked } = await (supabase as any)
        .from("color_visualizations")
        .select("id, render_urls, vehicle_make, vehicle_model, vehicle_year, vehicle_type, admin_notes, created_at, updated_at")
        .ilike("admin_notes", `%designiq_generation_id%${generationId}%`)
        .order("created_at", { ascending: false })
        .limit(1);
      return ((linked && linked[0]) || null) as any;
    },
  });

  // The server owns the Entice Pack workflow. Status is resolved from the saved
  // visualization so a reload can rediscover the durable run without relying on
  // browser storage or a browser-held workflow id.
  const {
    data: enticeStatus,
    error: enticeStatusError,
    refetch: refetchEnticeStatus,
  } = useQuery({
    queryKey: ["designpro-entice-pack-status", cv?.id],
    enabled: !!cv?.id,
    queryFn: () => getEnticeRevisionStatus({ visualizationId: String(cv.id) }),
    retry: false,
    refetchInterval: (query) => {
      const status = String(
        (query.state.data as any)?.workflowRun?.workflow_status || "",
      );
      return ["queued", "running"].includes(status) ? 2500 : false;
    },
  });
  const latestEnticePack = (enticeStatus as any)?.enticePack || null;
  const workflowRun = (enticeStatus as any)?.workflowRun || null;
  const workflowStatus = String(workflowRun?.workflow_status || "");
  const { data: latestFrozenRevision } = useQuery({
    queryKey: ["designpro-entice-pack-revision", latestEnticePack?.revision_id],
    enabled: !!latestEnticePack?.revision_id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("design_version_commits")
        .select("id, revision_snapshot")
        .eq("id", latestEnticePack.revision_id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  // While a replacement revision is building, the previous verified pack
  // remains active. Resolve that pointer explicitly so proof, panels, and logos
  // can never be mixed across revisions.
  const activePack =
    (enticeStatus as any)?.activeEnticePack ||
    (latestEnticePack?.status === "active" ? latestEnticePack : null);
  const activePackId = String(activePack?.id || "");

  // Production files are always selected by the exact active Entice Pack id.
  // Never query "latest" rows by generation id; that can combine superseded and
  // currently-building revisions.
  const { data: panels = [] } = useQuery({
    queryKey: ["production_flow_assets", activePackId],
    enabled: !!activePackId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_flow_assets")
        .select(
          "id, side, version, dimensions_inches, background_url, branding_url, depth_mask_url, final_pack_url",
        )
        .eq("entice_pack_id", activePackId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as PFARow[];
    },
  });
  const perSide = panels.map((panel) => ({
    side: panel.side,
    cleanUrl: panel.background_url || panel.final_pack_url || undefined,
    brandedUrl: panel.branding_url || panel.final_pack_url || undefined,
    widthIn: panel.dimensions_inches?.width,
    heightIn: panel.dimensions_inches?.height,
  }));

  // Revision Studio (Option B) shared timeline — keyed by generationId, the same
  // job_id production_flow_assets uses. This is the SAME data RevisionStudioIQ and
  // the DesignPro generate flow read/write via @/lib/revision-commits.
  const { data: commits = [] } = useQuery<VersionCommit[]>({
    queryKey: ["design_version_commits", gid],
    enabled: !!gid,
    queryFn: () => getVersionCommits(gid),
  });

  const activeLogoArtifacts: OverlayPng[] = Array.isArray(activePack?.logo_artifacts)
    ? activePack.logo_artifacts
        .filter((artifact: any) => typeof artifact?.url === "string" && artifact.url)
        .map((artifact: any, index: number) => ({
          id: String(artifact.id || artifact.sha256 || index),
          url: String(artifact.url),
          kind: artifact.kind ? String(artifact.kind) : undefined,
          role: artifact.role || artifact.label
            ? String(artifact.role || artifact.label)
            : undefined,
        }))
    : [];
  const overlays = activePackId
    ? activeLogoArtifacts
    : Array.isArray(dga?.overlay_pngs)
      ? dga!.overlay_pngs
      : [];
  // color_visualizations.render_urls holds an ApprovePro design's views (and the
  // master_artboard key) — strip master_artboard so it isn't shown as a view.
  const cvViews = cv?.render_urls && typeof cv.render_urls === "object"
    ? Object.fromEntries(Object.entries(cv.render_urls).filter(([k]) => k !== "master_artboard"))
    : null;
  // An EMPTY render_urls object ({}) must not shadow a source that actually has
  // views — a client-side reset mid-generation leaves gen.render_urls as {} while
  // the linked color_visualizations row holds the real views, and the old
  // truthy-object check made this page show "0 views" with nothing to slice.
  const withViews = (o: unknown) =>
    o && typeof o === "object" && Object.keys(o as object).length ? (o as Record<string, string>) : null;
  const views3d = withViews(gen?.render_urls) || withViews(dga?.view_urls) || withViews(cvViews) || {};
  const viewEntries = Object.entries(views3d || {});
  // Legacy designs may cache the 2D proof in admin_notes.flat_proof_url. It is a
  // display fallback only until an immutable active Entice Pack exists.
  const cvFlatProof = (() => {
    if (!cv?.admin_notes) return null;
    try { return (JSON.parse(cv.admin_notes)?.flat_proof_url as string) || null; } catch { return null; }
  })();
  const activeProof =
    activePack?.proof_artifact && typeof activePack.proof_artifact === "object"
      ? activePack.proof_artifact
      : null;
  // Once an active Entice Pack exists, every displayed production artifact must
  // come from that exact immutable pack. Legacy fallbacks are used only before a
  // server pack has ever been activated.
  const twoDProof = activePackId
    ? (activeProof?.url as string) || null
    : cvFlatProof || gen?.flat_proof_url || dga?.proof_2d_url || null;
  const flatArtboard = activePackId
    ? ((activeProof?.brandedArtboardUrl ||
        activeProof?.cleanArtboardUrl) as string) || null
    : gen?.master_artboard_url || cv?.render_urls?.master_artboard || null;
  const separatedBackground = activePackId
    ? (activeProof?.cleanArtboardUrl as string) || null
    : dga?.background_url || null;
  const hasAnything = !!(dga || gen || cv || activePack || panels.length);

  const BUILD_SIDES = ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR"];

  // Atomically save the exact visible source state and enqueue the durable
  // server workflow. This is the same canonical revision contract used by
  // Revision Studio: one immutable revision, one idempotent run, no browser
  // conductor and no legacy acceptance-time URL fingerprint sweep.
  const buildAssets = async () => {
    if (composeMode) {
      setBuildMsg(
        "Cannot submit unsaved Real-Asset edits: save this asset map into the revision contract first. The server will not silently ignore browser-only panel inputs.",
      );
      return;
    }
    const visualizationId = String(cv?.id || "");
    const expectedUpdatedAt = String(cv?.updated_at || "");
    if (!visualizationId || !expectedUpdatedAt) {
      setBuildMsg(
        "Cannot build: save this design in Revision Studio first so it has a visualization ID and saved revision timestamp.",
      );
      return;
    }

    setBuilding(true);
    setBuildMsg("Submitting the saved revision to the server workflow…");
    try {
      const frozenSavedAt = String(
        latestFrozenRevision?.revision_snapshot?.savedAt || "",
      );
      const observedRunMatchesSavedRevision =
        !!workflowRun?.id &&
        (!frozenSavedAt ||
          Date.parse(frozenSavedAt) === Date.parse(expectedUpdatedAt));
      let idempotent = false;
      let acceptedRun: any;
      // A failed workflow remains immutable for audit. It may contain completed
      // checkpoints from an obsolete producer, so resuming it can inherit
      // contaminated panels. Retry therefore saves the same frozen pixels as a
      // replacement immutable revision and starts a clean checkpoint chain.
      if (observedRunMatchesSavedRevision && workflowStatus !== "failed") {
        if (workflowStatus === "cancelled") {
          throw new Error(
            "This frozen revision was cancelled. Save a new Revision Studio version before rebuilding.",
          );
        }
        const resumed = await resumeEnticeRevision(workflowRun.id, false);
        acceptedRun = resumed?.workflowRun || workflowRun;
        idempotent = true;
      } else {
        const revisionRenderUrls = Object.fromEntries(
          Object.entries({
            ...(cv?.render_urls &&
            typeof cv.render_urls === "object" &&
            !Array.isArray(cv.render_urls)
              ? cv.render_urls
              : {}),
            ...views3d,
          }).filter(
            ([key, url]) =>
              !!key && typeof url === "string" && url.trim().length > 0,
          ),
        );
        if (!Object.keys(revisionRenderUrls).length) {
          throw new Error(
            "Cannot build: this saved revision contains no source views.",
          );
        }
        const surfaceOptions = savedSurfaceOptions(
          cv?.admin_notes,
          revisionRenderUrls,
          cv?.vehicle_type || fallbackVehicle?.vehicleType,
        );
        if (!surfaceOptions) {
          throw new Error(
            "Cannot build: this saved revision has no complete production-surface manifest.",
          );
        }
        const saved = await saveEnticeRevision({
          visualizationId,
          expectedUpdatedAt,
          renderUrls: revisionRenderUrls,
          adminNotesPatch: {
            surface_options: surfaceOptions,
          },
          generationId: gid,
          trigger: "revision_saved",
          change: {
            type: "revision",
            prompt: "Build or verify the saved Design Assets revision",
            viewKeys: Object.keys(views3d).sort(),
          },
          vehicleType:
            String(cv?.vehicle_type || fallbackVehicle?.vehicleType || "") ||
            null,
          finishType: String(gen?.finish || "") || null,
        });
        acceptedRun = saved.workflowRun;
        idempotent = saved.idempotent;
      }
      if (String(acceptedRun?.workflow_status || "") === "cancelled") {
        throw new Error(
          "This frozen revision was cancelled. Save a new Revision Studio version before rebuilding.",
        );
      }
      if (String(acceptedRun?.workflow_status || "") === "failed") {
        throw new Error(
          "The replacement server workflow failed before acceptance. Refresh and retry to create a clean immutable revision.",
        );
      }
      const status = String(acceptedRun?.workflow_status || "queued");
      setBuildMsg(
        `Server workflow ${idempotent ? "reused" : "accepted"} · ${status}. You can close this tab; processing will continue.`,
      );
      await refetchEnticeStatus();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["designpro-active-entice-pack"] }),
        qc.invalidateQueries({ queryKey: ["production_flow_assets"] }),
        qc.invalidateQueries({ queryKey: ["design_generation_assets", gid] }),
        qc.invalidateQueries({
          queryKey: ["color_visualizations_assets", generationId],
        }),
      ]);
    } catch (error: any) {
      setBuildMsg(`Server workflow request failed: ${error?.message || "unknown error"}`);
    } finally {
      setBuilding(false);
    }
  };

  // ── Real-asset compose controls (composeMode) ────────────────────────────────
  // Seed the per-side asset map from the design's existing layers when the mode is
  // first enabled; the team then swaps in the REAL clean graphics (flag, eagle,
  // logo) and per-side placement. Driver-side seeds with the lifted overlays;
  // PASSENGER is produced by mirroring the driver (no map row needed).
  const toggleCompose = () => {
    setComposeMode((on) => {
      const next = !on;
      if (next) {
        if (Object.keys(composeMap).length === 0) {
          const bg = flatArtboard || separatedBackground || twoDProof || "";
          const ovs: ComposeOverlay[] = (overlays || []).filter((o) => o.url).map((o) => ({ url: o.url, xPct: 50, yPct: 50, wPct: 30 }));
          const seed: Record<string, ComposeSide> = {};
          for (const s of BUILD_SIDES) seed[s] = { background: bg, fit: "fill", overlays: s === "DRIVER SIDE" ? ovs : [] };
          setComposeMap(seed);
        }
        setComposeEditor(true);
      }
      return next;
    });
  };
  // Ingest a local file into the asset vault and return its stable URL.
  const uploadAsset = async (file: File): Promise<string | null> => {
    const dataB64: string = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const { data, error } = await supabase.functions.invoke("panel-artboard-generator", {
      body: { step: "ingest", jobId: gid, name: file.name.replace(/\.[^.]+$/, ""), mime: file.type || "image/png", dataB64 },
    });
    if (error || !(data as any)?.url) return null;
    return (data as any).url as string;
  };
  const handleUpload = async (file: File, set: (url: string) => void) => {
    setUploading(true);
    setBuildMsg(`Uploading ${file.name}…`);
    try {
      const url = await uploadAsset(file);
      if (url) { set(url); setBuildMsg("✓ Asset uploaded — it's in the panel now."); setTimeout(() => setBuildMsg(null), 4000); }
      else setBuildMsg("Upload failed — try again.");
    } catch (e: any) { setBuildMsg(`Upload failed: ${e?.message || "unknown"}`); }
    finally { setUploading(false); }
  };

  const blankSide = (): ComposeSide => ({ background: "", fit: "fill", overlays: [] });
  const setSideBg = (side: string, background: string) =>
    setComposeMap((m) => ({ ...m, [side]: { ...(m[side] || blankSide()), background } }));
  const setSideFit = (side: string, fit: "fill" | "tile") =>
    setComposeMap((m) => ({ ...m, [side]: { ...(m[side] || blankSide()), fit } }));
  const addOverlay = (side: string) =>
    setComposeMap((m) => {
      const cur = m[side] || blankSide();
      return { ...m, [side]: { ...cur, overlays: [...(cur.overlays || []), { url: "", xPct: 50, yPct: 50, wPct: 30 }] } };
    });
  const setOverlay = (side: string, i: number, patch: Partial<ComposeOverlay>) =>
    setComposeMap((m) => {
      const cur = m[side] || blankSide();
      const ovs = [...(cur.overlays || [])];
      ovs[i] = { ...ovs[i], ...patch };
      return { ...m, [side]: { ...cur, overlays: ovs } };
    });
  const removeOverlay = (side: string, i: number) =>
    setComposeMap((m) => {
      const cur = m[side] || blankSide();
      return { ...m, [side]: { ...cur, overlays: (cur.overlays || []).filter((_, j) => j !== i) } };
    });

  // ── Line-trace (selectable source) ───────────────────────────────────────────
  // Edge-trace a chosen source into TRANSPARENT cyan line-art (the design's
  // contours). The source is the user's call:
  //   • "3d"       — the HIGH-FIDELITY approved render(s). A look-at reference of
  //                  exactly what the customer approved (perspective — not a 1:1
  //                  flat overlay). One trace per 3D view.
  //   • "proof"    — the FLAT 2D proof: a 1:1 alignment overlay for flat artwork.
  //   • "artboard" — the flat master artboard, same 1:1 overlay use.
  // Pure Sobel, no AI; the engine traces whatever URL it's handed.
  const genTraces = async () => {
    // ── ZONE TEMPLATE — 3-zone production blueprint SVG per side ──────────────
    // Bleed (Zone 1) / trim (Zone 2) / safe area (Zone 3) at the TRUE GENIE dims,
    // with labels. Generated client-side as vector SVG (perfect text). Resolves the
    // SAME panelizer-step-validate dims the panels build at.
    if (traceSource === "template") {
      const make = gen?.vehicle_make || cv?.vehicle_make || fallbackVehicle?.make || "";
      const model = gen?.vehicle_model || cv?.vehicle_model || fallbackVehicle?.model || "";
      const year = String(gen?.vehicle_year || cv?.vehicle_year || fallbackVehicle?.year || "2024");
      if (!make || !model) { setBuildMsg("Job is missing make/model — can't size the template."); return; }
      setTracing(true);
      setTraces([]);
      setBuildMsg("Resolving GENIE panel sizes for the zone template…");
      try {
        const { data: vd } = await supabase.functions.invoke("panelizer-step-validate", {
          body: { vehicleMake: make, vehicleModel: model, vehicleYear: year, sideSize: "medium", addHood: true, addRear: true, addFrontBumper: true, addRoof: true },
        });
        const vPanels: any[] = Array.isArray((vd as any)?.panels) ? (vd as any).panels : [];
        const findP = (re: RegExp) => vPanels.find((p) => re.test(`${p.panelKey || ""} ${p.label || ""}`.toLowerCase()));
        const sideP = findP(/driver|(^|[^a-z])side/), hoodP = findP(/hood/), roofP = findP(/roof|top/), rearP = findP(/rear|back/);
        const dimsFor: Record<string, [number, number] | null> = {
          "DRIVER SIDE": sideP?.widthInches ? [sideP.widthInches, sideP.heightInches] : null,
          "PASSENGER SIDE": sideP?.widthInches ? [sideP.widthInches, sideP.heightInches] : null,
          "HOOD": hoodP?.widthInches ? [hoodP.widthInches, hoodP.heightInches] : null,
          "ROOF": roofP?.widthInches ? [roofP.widthInches, roofP.heightInches] : null,
          "FRONT": rearP?.widthInches ? [rearP.widthInches, rearP.heightInches] : null,
          "REAR": rearP?.widthInches ? [rearP.widthInches, rearP.heightInches] : null,
        };
        const out: Array<{ side: string; url?: string; error?: string }> = [];
        for (const side of BUILD_SIDES) {
          const d = dimsFor[side];
          if (!d) { out.push({ side, error: "no GENIE dimension" }); setTraces([...out]); continue; }
          const svg = buildZoneSVG(side, d[0], d[1], 3, 2);
          const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
          out.push({ side, url });
          setTraces([...out]);
        }
        setBuildMsg(`✓ ${out.filter((o) => o.url).length}/${BUILD_SIDES.length} zone templates ready (bleed · trim · safe) — download below.`);
        setTimeout(() => setBuildMsg(null), 8000);
      } catch (e: any) {
        setBuildMsg(`Template failed: ${e?.message || "unknown"}`);
      } finally {
        setTracing(false);
      }
      return;
    }
    const sources: Array<{ side: string; url: string }> = [];
    if (traceSource === "panels") {
      // Trace the ACTUAL built panels (what prints) — so trace == art == print,
      // guaranteed to register. Prefer the freshly-built perSide results; else the
      // saved production_flow_assets backgrounds.
      const built = perSide.filter((p) => p.cleanUrl).map((p) => ({ side: p.side, url: p.cleanUrl as string }));
      if (built.length) sources.push(...built);
      else for (const p of panels) if (p.background_url) sources.push({ side: p.side, url: p.background_url });
    } else if (traceSource === "3d") {
      // Trace the straight-on SIDE VIEW of the design (the profile) — not the
      // angled hero / front / rear / hood / roof views.
      const entries = viewEntries.filter(([, u]) => typeof u === "string" && u) as Array<[string, string]>;
      const pick =
        entries.find(([k]) => /(driver|(^|[^a-z])side|profile|left)/i.test(k) && !/passenger|right|front|rear|back|hood|roof|hero|angle|quarter|34|three/i.test(k))
        || entries.find(([k]) => /side|profile/i.test(k))
        || entries[0];
      if (pick) sources.push({ side: "SIDE VIEW", url: pick[1] });
    } else if (traceSource === "proof") {
      // TRACE THE DESIGN ONLY — NEVER THE VEHICLE. The 2D production proof is a
      // labeled multi-view TRUCK sheet; tracing it traces the truck body (glass,
      // wheels, bumpers) instead of the flat wrap design — the "it traced the
      // vehicle, no rectangle" bug. So the trace source is ONLY the flat wrap
      // artwork (clean artboard / clean background). If none exists we bail with
      // guidance — we do NOT fall back to the truck proof.
      const flat = flatArtboard || separatedBackground || null;
      if (flat) sources.push({ side: "DESIGN (2D)", url: flat });
    } else {
      const a = flatArtboard || separatedBackground || null;
      if (a) sources.push({ side: "ARTBOARD", url: a });
    }
    if (!sources.length) {
      setBuildMsg(
        traceSource === "panels" ? "No built panels yet — build the panels first, then trace them."
          : traceSource === "3d" ? "No 3D views to trace yet — generate the views first."
            : traceSource === "proof" ? "No flat 2D design to trace yet — generate the 2D proof / clean artboard first." : "No flat artboard to trace yet."
      );
      return;
    }
    setTracing(true);
    setTraces([]);
    try {
      const out: Array<{ side: string; url?: string; error?: string }> = [];
      for (const s of sources) {
        setBuildMsg(`Edge-tracing ${s.side} (${traceSource === "panels" ? "the built panel — exact print" : traceSource === "3d" ? "high-fidelity 3D reference" : "flat 1:1 overlay"})…`);
        try {
          const { data: tr, error: te } = await supabase.functions.invoke("panel-artboard-generator", {
            // fullPanel: trace the WHOLE panel (rectangle boundary + interior
            // artwork), not just the auto-cropped center graphic.
            body: { step: "linetrace", side: s.side, jobId: gid, sourceUrl: s.url, thickness: 2, fullPanel: true },
          });
          if (te || !(tr as any)?.success || !(tr as any)?.url) out.push({ side: s.side, error: (tr as any)?.error || te?.message || "trace failed" });
          else out.push({ side: s.side, url: (tr as any).url });
        } catch (e: any) { out.push({ side: s.side, error: e?.message || "trace failed" }); }
        setTraces([...out]);
      }
      const ok = out.filter((o) => o.url).length;
      setBuildMsg(`✓ ${ok}/${sources.length} ${traceSource === "panels" ? "built-panel" : traceSource === "3d" ? "3D" : "flat"} trace${sources.length > 1 ? "s" : ""} ready — transparent overlay, download below.`);
      setTimeout(() => setBuildMsg(null), 8000);
    } catch (e: any) {
      setBuildMsg(`Trace failed: ${e?.message || "unknown"}`);
    } finally {
      setTracing(false);
    }
  };

  const versionList = versions.length
    ? versions
    : [{ id: "v1", iteration_index: 1, is_current: true, created_at: gen?.created_at || "", source_prompt: null }];
  const stages = Array.isArray((enticeStatus as any)?.stages)
    ? (enticeStatus as any).stages
    : [];
  const currentStage =
    stages.find((stage: any) =>
      ["running", "failed", "waiting"].includes(String(stage?.status || "")),
    ) ||
    [...stages].reverse().find((stage: any) => stage?.status === "completed") ||
    null;
  const buildButtonLabel = building
    ? "Submitting…"
    : composeMode
      ? "Save Map Required"
      : workflowStatus === "failed"
        ? "Retry Server Build"
        : activePackId
          ? "Verify / Rebuild"
          : "Build on Server";

  return (
    <div className="space-y-5">
      {/* Branded hero header */}
      <div className="rounded-2xl bg-white border border-gray-200 shadow-md overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
        <div className="flex items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shadow-md shrink-0">
              <Boxes className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                DesignPanelPro<span className="align-top text-[8px]">™</span> Admin
              </div>
              <h1 className="text-2xl font-extrabold text-gray-900 truncate leading-tight">
                {gen?.company_name || "Design Assets"}
              </h1>
              <p className="mt-0.5 text-[11px] text-gray-500">
                Gen {generationId.slice(0, 8)} · every layer + production file
              </p>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-3">
            <span className="inline-flex items-center text-[11px] font-bold px-3 py-1.5 rounded-full bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white shadow-sm">
              {viewEntries.length} views · {overlays.length} layers
            </span>
            {workflowStatus && (
              <span className="inline-flex items-center text-[11px] font-semibold px-3 py-1.5 rounded-full border border-gray-200 bg-gray-50 text-gray-700">
                Server · {workflowStatus.replace(/_/g, " ")}
                {currentStage?.stage_key
                  ? ` · ${String(currentStage.stage_key).replace(/\./g, " ")}`
                  : ""}
              </span>
            )}
            <div className="inline-flex items-center rounded-lg border border-gray-300 shadow-sm overflow-hidden">
              <button
                onClick={genTraces}
                disabled={tracing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold disabled:opacity-50 bg-white text-gray-900 hover:bg-gray-50"
                title="Edge-trace the selected source into a TRANSPARENT cyan line drawing of the design — drop it over your artwork to verify it lines up. 3D = high-fidelity approved reference; Proof/Artboard = flat 1:1 overlay."
              >
                {tracing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ruler className="w-3.5 h-3.5" />}
                {tracing ? "Tracing…" : "Trace"}
              </button>
              <select
                value={traceSource}
                onChange={(e) => setTraceSource(e.target.value as "panels" | "3d" | "proof" | "artboard" | "template")}
                disabled={tracing}
                className="border-l border-gray-300 bg-white px-1.5 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none disabled:opacity-50"
                title="What to trace — Built panels = trace exactly what prints (guaranteed to register); 3D/proof/artboard edge-trace the design; Zone template = bleed/trim/safe blueprint SVG"
              >
                <option value="panels">Built panels</option>
                <option value="3d">3D</option>
                <option value="proof">2D proof</option>
                <option value="artboard">Artboard</option>
                <option value="template">Zone template</option>
              </select>
            </div>
            <button
              onClick={toggleCompose}
              disabled={building}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 shadow-sm border ${composeMode ? "bg-[#ec4899] text-white border-transparent" : "bg-white text-gray-900 border-gray-300 hover:border-[#3b82f6]"}`}
              title="Known graphics (flags/logos): composite the EXACT clean assets at true size — zero AI on the print pixels (guaranteed clean whites + exact stripes/stars)."
            >
              <Boxes className="w-3.5 h-3.5" />
              {composeMode ? "✓ Real-Asset Mode" : "Real-Asset Mode"}
            </button>
            <button
              onClick={buildAssets}
              disabled={building}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-[#3b82f6] to-[#ec4899] disabled:opacity-50 shadow-sm"
              title={composeMode
                ? "Browser-only asset-map edits cannot be submitted until they are persisted in the revision contract."
                : "Submit the saved visualization to the durable DesignPro Entice Pack workflow. The server builds and verifies proof, panels, and logos."}
            >
              {building ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
              {buildButtonLabel}
            </button>
          </div>
        </div>
        {buildMsg && (
          <div className="px-6 pb-3 flex items-center gap-2 text-[11px] text-gray-600">
            {building && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#3b82f6] shrink-0" />}
            <span>{buildMsg}</span>
          </div>
        )}
        {!buildMsg && autoBuild && (
          <div className={`px-6 pb-3 text-[11px] ${!workflowRun && enticeStatusError ? "text-amber-700" : "text-gray-600"}`}>
            {!workflowRun && enticeStatusError
              ? "No durable Entice Pack run exists for this saved visualization yet. "
              : "This link observes server workflow state; it does not start a browser producer. "}
            Use <span className="font-semibold">Build on Server</span>; an accepted run continues after this tab closes.
          </div>
        )}
      </div>

      {/* Real-Asset Mode editor — per-side clean assets composited deterministically */}
      {composeMode && (
        <div className="rounded-2xl bg-white border border-[#ec4899]/40 shadow-md overflow-hidden">
          <button
            type="button"
            onClick={() => setComposeEditor((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left"
          >
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900">Real-Asset Compose — known graphics (flags · logos · eagles)</p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                Paste the EXACT clean asset URLs per side. Background fills the panel; overlays drop on top at % position/size. PASSENGER auto-mirrors the driver — leave it blank. Zero AI touches the print pixels.
              </p>
            </div>
            <span className="shrink-0 text-xs font-semibold text-[#ec4899]">{composeEditor ? "Hide" : "Edit assets"}</span>
          </button>
          {composeEditor && (
            <div className="px-6 pb-6 space-y-4">
              {BUILD_SIDES.map((side) => {
                const spec = composeMap[side] || blankSide();
                const mirrored = side === "PASSENGER SIDE";
                return (
                  <div key={side} className={`rounded-xl border p-4 ${mirrored ? "border-dashed border-gray-200 bg-gray-50" : "border-gray-200"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-gray-900 capitalize">{side.toLowerCase()}</p>
                      {mirrored && <span className="text-[10px] font-semibold text-gray-500">auto-mirror of driver — no assets needed</span>}
                    </div>
                    {!mirrored && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <input
                            value={spec.background}
                            onChange={(e) => setSideBg(side, e.target.value)}
                            placeholder="Background asset URL — or click ‘US flag’ for the drawn canonical flag"
                            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-900 focus:border-[#3b82f6] focus:outline-none"
                          />
                          <UploadBtn disabled={uploading} onPick={(f) => handleUpload(f, (url) => setSideBg(side, url))} />
                          <button
                            type="button"
                            onClick={() => setSideBg(side, "us-flag")}
                            title="Use the mathematically-correct flat US flag (drawn, never AI — exact 13 stripes, 50 stars)"
                            className={`shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold border ${spec.background === "us-flag" ? "bg-[#3b82f6] text-white border-transparent" : "bg-white text-gray-700 border-gray-300 hover:border-[#3b82f6]"}`}
                          >
                            US flag
                          </button>
                          <select
                            value={spec.fit}
                            onChange={(e) => setSideFit(side, e.target.value as "fill" | "tile")}
                            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:border-[#3b82f6] focus:outline-none"
                          >
                            <option value="fill">fill</option>
                            <option value="tile">tile</option>
                          </select>
                        </div>
                        {(spec.overlays || []).map((o, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              value={o.url}
                              onChange={(e) => setOverlay(side, i, { url: e.target.value })}
                              placeholder="Overlay PNG URL (eagle, logo)"
                              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-900 focus:border-[#3b82f6] focus:outline-none"
                            />
                            <UploadBtn disabled={uploading} onPick={(file) => handleUpload(file, (url) => setOverlay(side, i, { url }))} />
                            {(["xPct", "yPct", "wPct"] as const).map((f) => (
                              <input
                                key={f}
                                type="number"
                                value={o[f]}
                                onChange={(e) => setOverlay(side, i, { [f]: Number(e.target.value) } as any)}
                                title={f === "xPct" ? "center X %" : f === "yPct" ? "center Y %" : "width %"}
                                className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:border-[#3b82f6] focus:outline-none"
                              />
                            ))}
                            <button
                              type="button"
                              onClick={() => removeOverlay(side, i)}
                              className="shrink-0 rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-semibold text-gray-600 hover:border-red-400 hover:text-red-600"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addOverlay(side)}
                          className="text-[11px] font-semibold text-[#3b82f6] hover:text-[#ec4899]"
                        >
                          + Add overlay
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="text-[11px] text-gray-500">
                x/y = overlay center as % of the panel · w = overlay width as % of panel width · panels build at true GENIE dims + 4″ bleed, 150 PPI.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Alignment line-traces — transparent vector blueprints (top layer overlay) */}
      {traces.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-200 shadow-md p-5 space-y-3">
          <div>
            <p className="text-sm font-bold text-gray-900">{traceSource === "template" ? "Zone templates" : "Design trace"} ({traces.filter((t) => t.url).length}/{traces.length})</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {traceSource === "template"
                ? "3-zone production blueprint (SVG) at true GENIE dims: red = total canvas + bleed (Zone 1), dashed = physical trim panel (Zone 2), green = safe live area (Zone 3). Place over your flat artwork."
                : traceSource === "panels"
                  ? "Cyan line-art edge-traced from the ACTUAL built panels — this is a trace of exactly what prints, so it registers over the panel art 1:1 (no drift between trace and artwork)."
                  : traceSource === "3d"
                    ? "Cyan line-art edge-traced from the high-fidelity approved 3D render(s) — a reference of exactly what the customer approved (perspective, not a 1:1 flat overlay)."
                    : "Cyan line-art edge-traced from the flat design — drop it as the TOP layer over your flat artwork; because both are flat it lines up 1:1 to verify placement."}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {traces.map((t) => (
              <div key={t.side} className="rounded-xl border border-gray-200 overflow-hidden">
                <p className="px-3 py-2 text-xs font-bold text-gray-900 capitalize border-b border-gray-100">{t.side.toLowerCase()}{t.error ? ` — ${t.error}` : ""}</p>
                {t.url ? (
                  <a href={t.url} target="_blank" rel="noreferrer" download={`${t.side.toLowerCase().replace(/\s+/g, "-")}-${traceSource === "template" ? "template.svg" : "trace.png"}`} className="block">
                    <div className={`aspect-video flex items-center justify-center ${traceSource === "template" ? "bg-white" : CHECKER}`}>
                      <img src={t.url} alt={`${t.side} ${traceSource === "template" ? "template" : "trace"}`} className="max-h-full max-w-full object-contain" loading="lazy" />
                    </div>
                    <span className="flex items-center gap-1 px-3 py-2 text-[11px] font-semibold text-[#3b82f6] border-t border-gray-100">
                      <Download className="w-3 h-3" /> Download {traceSource === "template" ? "template" : "trace"}
                    </span>
                  </a>
                ) : (
                  <div className="aspect-video flex items-center justify-center text-[11px] text-gray-400">—</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Exact active-pack panels — background + transparent overlay */}
      {perSide.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-200 shadow-md p-5 space-y-3">
          <p className="text-sm font-bold text-gray-900">Per-side print elements ({perSide.filter((p) => p.cleanUrl).length}/{perSide.length || 6}) — background + transparent overlay</p>
          <div className="space-y-3">
            {perSide.map((p) => (
              <div key={p.side} className="rounded-xl border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-bold text-gray-900 capitalize">{p.side.toLowerCase()}{p.error ? ` — ${p.error}` : ""}</p>
                  {/* True per-panel print resolution from the deterministic slicer
                      (effectiveDpi), not a hardcoded fallback. Shown to operators
                      so they can verify the panel meets the print-DPI target. */}
                  {p.cleanUrl && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${(p.dpi ?? 0) >= 150 ? "bg-green-50 text-green-700" : p.dpi ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}
                      title={p.pixelWidth && p.pixelHeight ? `${p.pixelWidth}×${p.pixelHeight}px${p.widthIn && p.heightIn ? ` · ${p.widthIn}×${p.heightIn}in (+2″ bleed)` : ""}` : "resolution pending"}
                    >
                      {p.dpi ? `${p.dpi} DPI` : "DPI —"}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[{ t: "Background (at size)", u: p.cleanUrl, tr: false }, { t: "Transparent overlay", u: p.brandedUrl, tr: true }].map((c) => (
                    <div key={c.t}>
                      <p className="text-[11px] text-gray-500 mb-1">{c.t}</p>
                      {c.u ? (
                        <a href={c.u} target="_blank" rel="noreferrer" className="block rounded-lg border border-gray-200 overflow-hidden">
                          <img src={c.u} alt={`${p.side} ${c.t}`} className={`w-full aspect-video object-contain ${c.tr ? CHECKER : "bg-gray-50"}`} />
                          <span className="block px-2 py-1 text-[11px] font-semibold text-[#3b82f6]">Download</span>
                        </a>
                      ) : (
                        <div className="rounded-lg border border-dashed border-gray-200 aspect-video flex items-center justify-center text-[11px] text-gray-400">—</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {dgaLoading && <p className="text-sm text-gray-500 px-1">Loading assets…</p>}

      {!dgaLoading && !hasAnything && (
        <div className="rounded-2xl bg-white border border-gray-200 shadow-md p-6 text-center">
          <p className="text-sm text-gray-600">No assets found for this design yet.</p>
        </div>
      )}

      {hasAnything && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT — Source & History */}
          <div className="lg:col-span-3 space-y-5">
            <Card icon={<History className="w-4 h-4" />} title="Source & History" subtitle="Original prompt + versions">
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 mb-1">Original prompt</p>
                  <p className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-3 whitespace-pre-wrap">
                    {gen?.raw_prompt || gen?.enhanced_prompt || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 mb-2">Versions</p>
                  <div className="flex flex-wrap gap-2">
                    {versionList.map((v, i) => (
                      <span
                        key={v.id}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border ${
                          v.is_current
                            ? "border-transparent text-white bg-gradient-to-r from-[#3b82f6] to-[#ec4899]"
                            : "border-gray-200 text-gray-600 bg-white"
                        }`}
                      >
                        v{v.iteration_index ?? i + 1}
                        {v.created_at && <span className="font-normal opacity-80">· {new Date(v.created_at).toLocaleDateString()}</span>}
                        {v.is_current && <span className="font-normal">· current</span>}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Revision Studio commit timeline — the shared source-of-truth
                    version history (master artboard per version). */}
                {commits.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                      <GitCommit className="w-3 h-3" /> Revision Studio ({commits.length})
                    </p>
                    <div className="space-y-1.5">
                      {[...commits]
                        .sort((a, b) => b.version_number - a.version_number)
                        .map((c) => (
                          <div
                            key={c.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5"
                          >
                            <span className="text-[11px] font-semibold text-gray-700">
                              v{c.version_number}
                              <span className="ml-1.5 font-normal text-gray-500">{c.change_type}</span>
                            </span>
                            {c.master_artboard_url && (
                              <a
                                href={c.master_artboard_url}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 text-[10px] font-semibold text-[#3b82f6] hover:text-[#ec4899]"
                              >
                                Master artboard ↗
                              </a>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* CENTER — Design (Artboard Proof + 3D Designs) */}
          <div className="lg:col-span-6 space-y-5">
            <Tabs defaultValue="artboard" className="w-full">
              <TabsList className="bg-white border border-gray-200 rounded-xl p-1 h-auto gap-1">
                <TabsTrigger value="artboard" className={tabTrigger}>
                  Artboard Proof
                </TabsTrigger>
                <TabsTrigger value="threed" className={tabTrigger}>
                  3D Designs ({viewEntries.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="artboard" className="mt-4">
                <div className="rounded-2xl bg-white border border-gray-200 shadow-md p-5">
                  {flatArtboard ? (
                    <div className="space-y-3">
                      <div className="relative">
                        <a href={flatArtboard} target="_blank" rel="noreferrer" className="block">
                          <img src={flatArtboard} alt="Flat artboard proof" className="w-full rounded-xl border border-gray-200 bg-gray-50" />
                        </a>
                        {/* Toggle Mask Overlay — drop the GENIE-dimensioned 2D blueprint
                            (true vehicle bounds: wheels, body lines) on top at 50% so you
                            can instantly see if the artwork lines up or is warped. */}
                        {twoDProof && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); setMaskOn((v) => !v); }}
                              className={`absolute top-2 right-2 z-10 rounded-lg px-3 py-1.5 text-xs font-bold shadow-md transition-colors ${maskOn ? "bg-[#ec4899] text-white" : "bg-white/90 text-gray-900 border border-gray-300 hover:border-[#3b82f6]"}`}
                            >
                              {maskOn ? "✓ Mask Overlay ON" : "Toggle Mask Overlay"}
                            </button>
                            {maskOn && (
                              <img
                                src={twoDProof}
                                alt="GENIE blueprint mask"
                                className="pointer-events-none absolute inset-0 w-full h-full object-contain rounded-xl opacity-50 mix-blend-multiply"
                              />
                            )}
                          </>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-500">Flat 2D artboard — the saved source RecreatePro recreates off.{twoDProof ? " Toggle the mask to overlay the GENIE vehicle blueprint and check wheel/stripe alignment." : ""}</p>
                        <a href={downloadHref(flatArtboard)} download className="inline-flex items-center gap-1 text-xs font-semibold text-[#3b82f6] hover:text-[#ec4899]">
                          <Download className="w-3.5 h-3.5" />
                          Download
                        </a>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 text-center py-10">No flat artboard saved for this design yet.</p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="threed" className="mt-4">
                <div className="rounded-2xl bg-white border border-gray-200 shadow-md p-5">
                  {viewEntries.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-10">No 3D views yet — run Generate All Views.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {viewEntries.map(([k, url]) => (
                        <AssetTile key={k} url={url as string} label={String(k).replace(/[_-]/g, " ")} />
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* RIGHT — Separated Files + Golden Assets */}
          <div className="lg:col-span-3 space-y-5">
            <Tabs defaultValue="files" className="w-full">
              <TabsList className="bg-white border border-gray-200 rounded-xl p-1 h-auto gap-1">
                <TabsTrigger value="files" className={tabTrigger}>
                  Separated Files
                </TabsTrigger>
                <TabsTrigger value="golden" className={tabTrigger}>
                  Golden Assets
                </TabsTrigger>
              </TabsList>

              {/* Separated files — clean background + lifted layers */}
              <TabsContent value="files" className="mt-4 space-y-4">
                <div className="rounded-2xl bg-white border border-gray-200 shadow-md p-5 space-y-4">
                  {separatedBackground && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 mb-2">Clean Background (Layer 1)</p>
                      <AssetTile url={separatedBackground} label="Clean background (stripped)" />
                    </div>
                  )}

                  {/* Exact active Entice Pack elements: each side's clean background
                      at size plus its transparent overlay. */}
                  {panels.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 mb-2">Design Elements — separated ({panels.length} sides)</p>
                      <div className="space-y-3">
                        {panels.map((p) => (
                          <div key={`el-${p.id}`} className="rounded-xl border border-gray-200 p-3">
                            <p className="text-xs font-bold text-gray-900 mb-2 capitalize">{p.side}</p>
                            <div className="grid grid-cols-2 gap-3">
                              {p.background_url && <AssetTile url={p.background_url} label="Background (at size)" />}
                              {p.branding_url && <AssetTile url={p.branding_url} label="Transparent overlay" transparent />}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-2">Lifted Layers ({overlays.length})</p>
                    {overlays.length === 0 ? (
                      <p className="text-sm text-gray-500">No lifted layers on this design.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        {overlays.map((o, i) => (
                          <AssetTile key={o.id || i} url={o.url} label={o.role || o.kind || `Layer ${i + 1}`} transparent />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-gray-100 pt-4">
                    <p className="text-[11px] text-gray-500">
                      Per-side proof, panel, and logo artifacts are produced and verified by the <span className="font-semibold text-gray-700">server Entice Pack workflow</span>. This page only submits, retries, observes, edits, and downloads.
                    </p>
                  </div>
                </div>
              </TabsContent>

              {/* Golden assets — per-side production panels (created at Order Production Pack) */}
              <TabsContent value="golden" className="mt-4">
                <div className="rounded-2xl bg-white border border-gray-200 shadow-md p-5 space-y-4">
                  {twoDProof && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 mb-2">2D Production Proof — source for the per-side panels</p>
                      <AssetTile url={twoDProof} label="2D Production Proof" />
                    </div>
                  )}
                  {panels.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No verified active Entice Pack panels exist for this design yet. Use <span className="font-semibold text-gray-700">Build on Server</span> and follow the durable workflow status above.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {panels.map((p) => (
                        <div key={p.id} className="rounded-xl border border-gray-200 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-gray-900 capitalize">{p.side}</span>
                            <span className="text-[10px] text-gray-500">
                              {p.version}
                              {p.dimensions_inches?.width ? ` · ${p.dimensions_inches.width}" × ${p.dimensions_inches.height}"` : ""}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {p.final_pack_url && <AssetTile url={p.final_pack_url} label="Final pack" />}
                            {p.background_url && <AssetTile url={p.background_url} label="Background" />}
                            {p.branding_url && <AssetTile url={p.branding_url} label="Branding" transparent />}
                            {p.depth_mask_url && <AssetTile url={p.depth_mask_url} label="Depth" transparent />}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}
    </div>
  );
}

export default DesignAssetsPanel;
