/**
 * LiftedAssetsCards — two white-UI cards that surface the saved LayerLift assets
 * for a design:
 *   1. CLEAN BACKGROUND  — the stripped Layer-1 background (no logo/text baked in)
 *   2. DESIGN PNGs       — the lifted transparent element overlays (logo / text /
 *                          design graphics), each downloadable on a checker bg
 *
 * Produced by the in-house `layerlift-engine` + `designpro-clean-views` and
 * persisted to `design_generation_assets` (background_url + overlay_pngs). Drop
 * this anywhere a generationId is known (ApprovePro, QC Production Flow, the
 * Design Assets page). It can also take the data directly (backgroundUrl /
 * overlays) when the parent already loaded the row — no extra query.
 *
 * Read-only (SELECT on design_generation_assets). White surface, gray-900/600/500
 * text, #3b82f6 -> #ec4899 gradient accent — matches DesignAssetsPanel.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ImageIcon, Layers, Download } from "lucide-react";

interface OverlayLike {
  id?: string;
  url?: string;
  transparent_png_url?: string;
  kind?: string;
  role?: string;
  element_label?: string;
  element_type?: string;
}

interface LiftedAssetsCardsProps {
  /** When provided (and no direct data), self-fetches the latest saved row. */
  generationId?: string;
  /** Direct background URL (skip the query). `null` = explicitly none. */
  backgroundUrl?: string | null;
  /** Direct overlay list (skip the query). */
  overlays?: OverlayLike[] | null;
  className?: string;
}

const CHECKER =
  "[background-image:linear-gradient(45deg,#e5e7eb_25%,transparent_25%),linear-gradient(-45deg,#e5e7eb_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e5e7eb_75%),linear-gradient(-45deg,transparent_75%,#e5e7eb_75%)] [background-size:16px_16px] [background-position:0_0,0_8px,8px_-8px,-8px_0]";

const downloadHref = (url: string) => `${url}${url.includes("?") ? "&" : "?"}download`;

const overlayUrl = (o: OverlayLike) => o.url || o.transparent_png_url || "";
const overlayLabel = (o: OverlayLike, i: number) =>
  o.role || o.kind || o.element_label || o.element_type || `Layer ${i + 1}`;

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
        <p className="text-[11px] font-medium text-gray-600 truncate group-hover:text-gray-900 capitalize">{label}</p>
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

export function LiftedAssetsCards({
  generationId,
  backgroundUrl,
  overlays,
  className,
}: LiftedAssetsCardsProps) {
  const needFetch = !!generationId && backgroundUrl === undefined && overlays === undefined;

  const { data: row, isLoading } = useQuery({
    queryKey: ["lifted_assets", generationId],
    enabled: needFetch,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("design_generation_assets")
        .select("background_url, overlay_pngs")
        .eq("generation_id", generationId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as { background_url: string | null; overlay_pngs: OverlayLike[] | null }) || null;
    },
  });

  const bg = backgroundUrl !== undefined ? backgroundUrl : row?.background_url ?? null;
  const rawOverlays = overlays !== undefined ? overlays : row?.overlay_pngs ?? [];
  const cleanOverlays = (Array.isArray(rawOverlays) ? rawOverlays : []).filter((o) => !!overlayUrl(o));

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4 ${className || ""}`}>
      {/* CARD 1 — Clean Background */}
      <Card icon={<ImageIcon className="w-4 h-4" />} title="Clean Background" subtitle="Layer 1 — logo/text stripped">
        {bg ? (
          <AssetTile url={bg} label="Clean background" />
        ) : (
          <p className="text-sm text-gray-500 text-center py-8">
            {isLoading ? "Loading background…" : "No clean background saved yet."}
          </p>
        )}
      </Card>

      {/* CARD 2 — Design PNGs (lifted transparent overlays) */}
      <Card
        icon={<Layers className="w-4 h-4" />}
        title="Design PNGs"
        subtitle={`${cleanOverlays.length} transparent layer${cleanOverlays.length === 1 ? "" : "s"}`}
      >
        {cleanOverlays.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">
            {isLoading ? "Loading layers…" : "No lifted design PNGs yet."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {cleanOverlays.map((o, i) => (
              <AssetTile key={o.id || i} url={overlayUrl(o)} label={overlayLabel(o, i)} transparent />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default LiftedAssetsCards;
