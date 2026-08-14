import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Layers, RefreshCw, Lock, Download } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * QCProductionFlowContainer — design-team audit view for the Track-2 layer
 * separation written by production-flow-engine into production_flow_assets.
 *
 * For each vehicle side it shows the version history (v1, v2, …) and stacks
 * the three isolated layers exactly as production does:
 *   background (z10)  →  branding overlay (z20)  →  depth map (z30, multiply)
 *
 * Per-track controls trigger the v1→v2 "regenerate one track, freeze the rest"
 * flow: regenerating only the background keeps the branding + depth frozen,
 * protecting the Golden Design from AI drift.
 *
 * White UI (matches the ProductionFlow page). Reads via the auth client; the
 * production_flow_assets RLS policy allows authenticated SELECT.
 */

type Track = "background" | "branding" | "depth";

interface AssetRow {
  id: string;
  job_id: string;
  side: string;
  version: string;
  dimensions_inches: { width: number; height: number } | null;
  background_url: string;
  branding_url: string;
  depth_mask_url: string;
  final_pack_url: string;
  is_passenger_flipped: boolean;
  meta_metrics: Record<string, any> | null;
  created_at: string;
}

interface Props {
  jobId: string;
  /** make/model/year + brief, needed to trigger regeneration from this page. */
  vehicle?: { year?: number | string; make?: string; model?: string };
  designPrompt?: string;
}

const SIDE_ORDER = ["driver", "passenger", "hood", "rear", "roof"];

export function QCProductionFlowContainer({ jobId, vehicle, designPrompt }: Props) {
  const queryClient = useQueryClient();
  const [selectedSide, setSelectedSide] = useState<string | null>(null);
  const [busyTrack, setBusyTrack] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["production_flow_assets", jobId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_flow_assets")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as AssetRow[];
    },
    enabled: !!jobId,
    // Layers are authored in the background after a recreation/pack run, so
    // poll until at least one row lands, then stop.
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? false : 10_000),
  });

  const sides = useMemo(() => {
    const present = Array.from(new Set(rows.map((r) => r.side)));
    return present.sort((a, b) => SIDE_ORDER.indexOf(a) - SIDE_ORDER.indexOf(b));
  }, [rows]);

  const activeSide = selectedSide && sides.includes(selectedSide) ? selectedSide : sides[0] || null;
  const sideVersions = useMemo(
    () => rows.filter((r) => r.side === activeSide), // already newest-first
    [rows, activeSide],
  );
  const latest = sideVersions[0] || null;

  const canRegenerate = !!(vehicle?.make && vehicle?.model && vehicle?.year && designPrompt && activeSide);

  const regenerate = async (track: Track) => {
    if (!canRegenerate || !activeSide) {
      toast.error("Need vehicle make/model/year + a design brief to regenerate.");
      return;
    }
    setBusyTrack(track);
    try {
      const { error } = await supabase.functions.invoke("production-flow-engine", {
        body: {
          jobId,
          make: vehicle!.make,
          model: vehicle!.model,
          year: vehicle!.year,
          side: activeSide,
          designPrompt,
          regenerate: [track],
        },
      });
      if (error) throw error;
      toast.success(
        track === "background"
          ? "Background regenerated — branding + depth frozen from the prior version."
          : `${track[0].toUpperCase() + track.slice(1)} layer regenerated.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["production_flow_assets", jobId] });
    } catch (e: any) {
      toast.error(e?.message || "Regeneration failed");
    } finally {
      setBusyTrack(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading production layers…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
        <Layers className="w-5 h-5 mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-500">
          No separated production layers yet. They're authored by the ProductionFlow engine when a
          pack is generated.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between border-b border-gray-100 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-blue-600" />
          <div>
            <h3 className="text-base font-bold text-gray-900">Production Layers</h3>
            <p className="text-xs text-gray-500">
              Separated background / branding / depth · version-tracked per side
            </p>
          </div>
        </div>
        {/* Side switcher */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {sides.map((side) => (
            <button
              key={side}
              onClick={() => setSelectedSide(side)}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold uppercase tracking-wide rounded-md transition-colors",
                side === activeSide ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900",
              )}
            >
              {side}
            </button>
          ))}
        </div>
      </div>

      {latest && (
        <>
          {/* Stacked preview of the latest version */}
          <div className="grid md:grid-cols-[minmax(0,1fr)_320px] gap-6">
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {activeSide} · {latest.version}
                {latest.dimensions_inches &&
                  ` · ${latest.dimensions_inches.width}″ × ${latest.dimensions_inches.height}″`}
              </div>
              {/* z-stacked layers: bg → branding → depth(multiply) */}
              <div
                className="relative w-full rounded-lg overflow-hidden border border-gray-200 bg-[length:16px_16px]"
                style={{
                  backgroundImage:
                    "linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)",
                  backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
                  aspectRatio: latest.dimensions_inches
                    ? `${latest.dimensions_inches.width} / ${latest.dimensions_inches.height}`
                    : "16 / 9",
                }}
              >
                <img src={latest.background_url} alt="background" className="absolute inset-0 w-full h-full object-contain z-10" />
                <img src={latest.branding_url} alt="branding" className="absolute inset-0 w-full h-full object-contain z-20" />
                <img
                  src={latest.depth_mask_url}
                  alt="depth"
                  className="absolute inset-0 w-full h-full object-contain z-30"
                  style={{ mixBlendMode: "multiply" }}
                />
              </div>
            </div>

            {/* Per-track regenerate / freeze controls */}
            <div className="space-y-3">
              <TrackControl
                label="Background"
                hint="Texture / pattern only"
                url={latest.background_url}
                action="regenerate"
                busy={busyTrack === "background"}
                disabled={!canRegenerate || !!busyTrack}
                onClick={() => regenerate("background")}
              />
              <TrackControl
                label="Branding"
                hint="Logos / type — frozen on bg-only revisions"
                url={latest.branding_url}
                action="regenerate"
                busy={busyTrack === "branding"}
                disabled={!canRegenerate || !!busyTrack}
                onClick={() => regenerate("branding")}
              />
              <TrackControl
                label="Depth / contour"
                hint="Grayscale shadow map"
                url={latest.depth_mask_url}
                action="regenerate"
                busy={busyTrack === "depth"}
                disabled={!canRegenerate || !!busyTrack}
                onClick={() => regenerate("depth")}
              />
              <a
                href={latest.final_pack_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full h-9 rounded-md border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                <Download className="w-3.5 h-3.5" /> Flat print pack (bg + branding)
              </a>
              {!canRegenerate && (
                <p className="text-[11px] text-gray-400 leading-snug">
                  Regenerate needs vehicle make/model/year + a design brief from the job.
                </p>
              )}
            </div>
          </div>

          {/* Version history */}
          {sideVersions.length > 1 && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Version history
              </div>
              <div className="flex flex-wrap gap-2">
                {sideVersions.map((v) => {
                  const tracks: string[] = v.meta_metrics?.regenerated_tracks || [];
                  const frozen = v.meta_metrics?.frozen_from;
                  return (
                    <div
                      key={v.id}
                      className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5"
                    >
                      <span className="text-xs font-bold text-blue-700">{v.version}</span>
                      <span className="text-[10px] text-gray-500">
                        {new Date(v.created_at).toLocaleDateString()}
                      </span>
                      {frozen && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
                          <Lock className="w-3 h-3" /> from {frozen}
                        </span>
                      )}
                      {tracks.length > 0 && tracks.length < 3 && (
                        <span className="text-[10px] text-emerald-600 font-medium">
                          {tracks.join(", ")} only
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TrackControl({
  label,
  hint,
  url,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  url: string;
  action: "regenerate";
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 p-2.5">
      <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
        <img
          src={url}
          alt={label}
          className="w-12 h-12 rounded object-cover border border-gray-200 bg-gray-50"
        />
      </a>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-gray-900">{label}</div>
        <div className="text-[10px] text-gray-500 truncate">{hint}</div>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-semibold transition-colors",
          disabled
            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
            : "bg-blue-600 text-white hover:bg-blue-700",
        )}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        Regen
      </button>
    </div>
  );
}

export default QCProductionFlowContainer;
