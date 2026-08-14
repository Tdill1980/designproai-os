import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Layers, ChevronRight, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getActiveUser } from "@/lib/auth-session";

interface PanelizerJobRow {
  id: string;
  order_number: string | null;
  status: string | null;
  approved_render_url: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  concept_json: {
    design_name?: string | null;
    finish?: string | null;
    qc_side_panels?: Record<string, { approved?: boolean }> | null;
  } | null;
  created_at: string;
}

// Reduces the qc_side_panels map to "X/Y" so the dashboard chip mirrors the
// approval state shown in QC Artboard. Total counts every saved side; approved
// counts only the ones a designer confirmed with "Is this correct?".
function approvedSideTally(job: PanelizerJobRow): { approved: number; total: number } {
  const panels = job.concept_json?.qc_side_panels;
  if (!panels || typeof panels !== "object") return { approved: 0, total: 0 };
  const entries = Object.values(panels);
  return {
    total: entries.length,
    approved: entries.filter((p) => p?.approved).length,
  };
}

const VISIBLE_COUNT = 5;

const STATUS_TONE: Record<string, string> = {
  ready: "bg-emerald-500/15 border-emerald-400/40 text-emerald-200",
  failed: "bg-rose-500/15 border-rose-400/40 text-rose-200",
  awaiting_input: "bg-amber-500/15 border-amber-400/40 text-amber-200",
  pending_qc: "bg-blue-500/15 border-blue-400/40 text-blue-200",
  admin_qc: "bg-blue-500/15 border-blue-400/40 text-blue-200",
};

function formatStatus(status: string | null): string {
  if (!status) return "Queued";
  if (status === "ready") return "Ready for Print";
  if (status === "pending_qc" || status === "admin_qc") return "Admin QC Review";
  if (status === "awaiting_input") return "Input Needed";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusClass(status: string | null): string {
  if (!status) return "bg-white/5 border-white/10 text-white/70";
  return STATUS_TONE[status] || "bg-white/5 border-white/10 text-white/70";
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function MyProductionPacksCard() {
  const navigate = useNavigate();

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["my-panelizer-jobs"],
    queryFn: async () => {
      const user = await getActiveUser();
      if (!user) return [] as PanelizerJobRow[];
      const { data, error } = await (supabase as any)
        .from("panelizer_jobs")
        .select(
          "id, order_number, status, approved_render_url, vehicle_year, vehicle_make, vehicle_model, concept_json, created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return [] as PanelizerJobRow[];
      return (data ?? []) as PanelizerJobRow[];
    },
    refetchInterval: 30_000,
  });

  const visible = useMemo(() => jobs.slice(0, VISIBLE_COUNT), [jobs]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-fuchsia-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
            <Layers className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-foreground text-base leading-tight">
              My Production Packs
            </h3>
            <p className="text-xs text-muted-foreground">
              Universal Panelizer &middot; track your packs in production
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-cyan-400 hover:text-cyan-300 -mr-2"
          onClick={() => navigate("/productionflow")}
        >
          Open <ChevronRight className="w-4 h-4 ml-0.5" />
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 bg-muted/30 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="py-8 text-center">
          <Package className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No production packs yet.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Order a Production Pack from any render and it&rsquo;ll appear here
            so you can track every stage.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((j) => {
            const vehicle = [j.vehicle_year, j.vehicle_make, j.vehicle_model]
              .filter(Boolean)
              .join(" ");
            const designName =
              j.concept_json?.design_name || vehicle || "(untitled)";
            const orderLabel = j.order_number ? `#${j.order_number}` : null;
            return (
              <button
                key={j.id}
                type="button"
                onClick={() => navigate(`/productionflow/${j.id}`)}
                className="w-full flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="shrink-0 w-10 h-10 rounded-md overflow-hidden bg-black/40 border border-white/10">
                  {j.approved_render_url ? (
                    <img
                      src={j.approved_render_url}
                      alt={designName}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Layers className="w-4 h-4 text-white/30" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    {orderLabel && (
                      <span className="text-sm font-semibold text-foreground truncate">
                        {orderLabel}
                      </span>
                    )}
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 ${statusClass(j.status)}`}
                    >
                      {formatStatus(j.status)}
                    </Badge>
                    {(() => {
                      const { approved, total } = approvedSideTally(j);
                      if (total === 0) return null;
                      const complete = approved === total;
                      return (
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${complete ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-200" : "bg-cyan-500/15 border-cyan-400/40 text-cyan-200"}`}
                          title={complete ? "Every saved side is designer-approved" : "Some sides still need designer approval"}
                        >
                          {approved}/{total} sides {complete ? "✓" : "approved"}
                        </Badge>
                      );
                    })()}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 truncate">
                    <span className="truncate">{designName}</span>
                    {vehicle && designName !== vehicle && (
                      <>
                        <span>&middot;</span>
                        <span className="truncate">{vehicle}</span>
                      </>
                    )}
                    <span>&middot;</span>
                    <span>{relativeTime(j.created_at)}</span>
                  </div>
                </div>
                <ChevronRight className="shrink-0 w-4 h-4 text-white/30" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
