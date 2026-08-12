import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PanelizerProgressDiagram } from "@/components/production/PanelizerProgressDiagram";
import type { PackPanel } from "@/lib/panelizer-config";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package } from "lucide-react";
import { format } from "date-fns";

/**
 * GENIE Universal Panelizer — the CUSTOMER-FACING build progress card.
 *
 * Starts the moment a production pack is bought: stripe-webhook opens the
 * panelizer_job and activate-print-worker kicks the Railway worker per side.
 * The worker stamps concept_json.print_worker.panels[panelKey] as each side's
 * print files land and .zip when the pack is assembled — this card polls the
 * customer's OWN job rows (RLS: panelizer_jobs_shop_select) and lights the
 * PanelizerProgressDiagram zone by zone. "When All Panels Glow, It's a Go."
 *
 * Read-only: it never kicks or re-slices anything — the sanctioned chain is
 * the only producer; this is its window.
 */

// Railway worker panelKey → GENIE diagram zone (VIEW_DEFS.sideKey names).
const KEY_TO_ZONE: Record<string, { id: string; label: string }> = {
  driver_side: { id: "driver-side", label: "Driver Side" },
  passenger_side: { id: "passenger-side", label: "Passenger Side" },
  hood: { id: "hood", label: "Hood" },
  roof: { id: "roof", label: "Roof" },
  front: { id: "front-bumper", label: "Front" },
  rear: { id: "rear", label: "Rear" },
};
const DEFAULT_KEYS = Object.keys(KEY_TO_ZONE);

interface PanelStamp {
  width_in?: number;
  height_in?: number;
  completed_at?: string;
}

interface GenieJob {
  id: string;
  order_number: string | null;
  status: string | null;
  created_at: string;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  activated: string[];
  panelStamps: Record<string, PanelStamp>;
  zipUrl: string | null;
  zipFileCount: number | null;
  /** AI check — the golden-job-regression stamp activate-print-worker records. */
  aiCheck: { pass: boolean; summary?: string } | null;
}

function parseJob(row: any): GenieJob {
  const pw = row?.concept_json?.print_worker || {};
  const activated: string[] = Array.isArray(pw.activated) && pw.activated.length
    ? pw.activated.filter((k: string) => KEY_TO_ZONE[k])
    : DEFAULT_KEYS;
  return {
    id: row.id,
    order_number: row.order_number || null,
    status: row.status || null,
    created_at: row.created_at,
    vehicle_year: row.vehicle_year ?? null,
    vehicle_make: row.vehicle_make ?? null,
    vehicle_model: row.vehicle_model ?? null,
    activated,
    panelStamps: (pw.panels || {}) as Record<string, PanelStamp>,
    zipUrl: pw.zip?.url || null,
    zipFileCount: pw.zip?.file_count ?? null,
    aiCheck: pw.validation && typeof pw.validation.pass === "boolean"
      ? { pass: pw.validation.pass, summary: pw.validation.summary }
      : null,
  };
}

// "ready" = designer validated + shipped from the QC page; "delivered" = landed
// in the customer's WrapBox via deploy-to-wrapbox. Both are terminal.
function jobDelivered(j: GenieJob): boolean {
  return j.status === "delivered" || j.status === "ready";
}

function jobInFlight(j: GenieJob): boolean {
  if (jobDelivered(j)) return false;
  const done = j.activated.every((k) => j.panelStamps[k]);
  return !(done && j.zipUrl);
}

// The TWO-PART CHECK strip: AI checks, then a human validates. Rendered as
// four sequential stages so the client sees exactly where their pack is.
function StageStrip({ job, completedCount, allDone }: { job: GenieJob; completedCount: number; allDone: boolean }) {
  const delivered = jobDelivered(job);
  const stages: Array<{ label: string; state: "done" | "active" | "flagged" | "pending" }> = [
    {
      label: `Panels ${completedCount}/${job.activated.length}`,
      state: completedCount >= job.activated.length ? "done" : "active",
    },
    {
      label: job.aiCheck ? (job.aiCheck.pass ? "AI checks passed" : "AI check flagged") : "AI check",
      state: job.aiCheck ? (job.aiCheck.pass ? "done" : "flagged") : "pending",
    },
    {
      label: "Designer validation",
      state: delivered ? "done" : allDone ? "active" : "pending",
    },
    { label: "Delivered", state: delivered ? "done" : "pending" },
  ];
  const cls: Record<string, string> = {
    done: "bg-emerald-50 border-emerald-300 text-emerald-700",
    active: "bg-blue-50 border-blue-300 text-blue-700 animate-pulse",
    flagged: "bg-amber-50 border-amber-300 text-amber-700",
    pending: "bg-gray-50 border-gray-200 text-gray-400",
  };
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {stages.map((s, i) => (
        <span key={s.label} className="flex items-center gap-1">
          {i > 0 && <span className="text-gray-300 text-[10px]">→</span>}
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${cls[s.state]}`}>
            {s.state === "done" ? "✓ " : ""}{s.label}
          </span>
        </span>
      ))}
    </div>
  );
}

export function GenieUniversalPanelizerCard({ jobId }: { jobId?: string | null } = {}) {
  const { data: jobs } = useQuery({
    queryKey: ["genie-panelizer-progress", jobId ?? "mine"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [] as GenieJob[];
      // RLS scopes this to the customer's own jobs. A specific jobId (the
      // ProductionFlow page) pins the card to that one build.
      let q = (supabase as any)
        .from("panelizer_jobs")
        .select("id, order_number, status, created_at, vehicle_year, vehicle_make, vehicle_model, concept_json")
        .order("created_at", { ascending: false });
      q = jobId ? q.eq("id", jobId).limit(1) : q.eq("job_type", "production_pack").limit(5);
      const { data, error } = await q;
      if (error) {
        console.warn("[GENIE panelizer] job fetch failed:", error.message);
        return [] as GenieJob[];
      }
      return ((data || []) as any[]).map(parseJob);
    },
    // Live progress while a build is running; settle down once everything is done.
    refetchInterval: (query) =>
      (query.state.data || []).some(jobInFlight) ? 10_000 : false,
  });

  // Pinned to one job → always show it. Otherwise show builds from the last
  // 14 days plus anything still in flight.
  const visible = (jobs || []).filter((j) => {
    if (jobId) return true;
    const ageDays = (Date.now() - new Date(j.created_at).getTime()) / 86_400_000;
    return jobInFlight(j) || ageDays <= 14;
  });
  if (!visible.length) return null;

  return (
    <div className="space-y-3">
      {visible.map((job) => {
        // Sort completed zones first — the diagram lights zones by index, and
        // sides finish in whatever order the worker lands them.
        const ordered = [...job.activated].sort(
          (a, b) => Number(!!job.panelStamps[b]) - Number(!!job.panelStamps[a]),
        );
        const panels: PackPanel[] = ordered.map((k) => {
          const stamp = job.panelStamps[k];
          return {
            id: KEY_TO_ZONE[k].id,
            label: KEY_TO_ZONE[k].label,
            widthInches: Math.round(Number(stamp?.width_in) || 0),
            heightInches: Math.round(Number(stamp?.height_in) || 0),
            mirrored: false,
          };
        });
        const completedCount = ordered.filter((k) => job.panelStamps[k]).length;
        const allDone = completedCount >= job.activated.length && !!job.zipUrl;
        const delivered = jobDelivered(job);
        const status: "pending" | "processing" | "complete" =
          allDone || delivered ? "complete" : "processing";
        const vehicle = [job.vehicle_year, job.vehicle_make, job.vehicle_model]
          .filter(Boolean).join(" ");

        return (
          <Card key={job.id} className="border-blue-200 bg-white">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    Production Pack Build{vehicle ? ` — ${vehicle}` : ""}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {job.order_number || job.id.slice(0, 8)} · started{" "}
                    {format(new Date(job.created_at), "MMM d, h:mm a")}
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-gray-600">
                  {completedCount}/{job.activated.length} panels
                </span>
              </div>

              <PanelizerProgressDiagram
                panels={panels}
                completedCount={completedCount}
                totalCount={job.activated.length}
                status={status}
              />

              <StageStrip job={job} completedCount={completedCount} allDone={allDone} />

              {delivered ? (
                <p className="text-[11px] text-emerald-600 font-medium">
                  Delivered — your files are in WrapBox below.
                </p>
              ) : allDone ? (
                <p className="text-[11px] text-gray-600">
                  All panels printed to production resolution — final quality check in
                  progress. Your pack lands in WrapBox the moment it's approved.
                </p>
              ) : (
                <p className="text-[11px] text-gray-600">
                  GENIE is producing each panel at true print size (1500-DPI CMYK + 5″
                  bleed). This can take a few minutes per side — no need to stay on
                  this page.
                </p>
              )}

              {delivered && job.zipUrl && (
                <Button
                  size="sm"
                  className="w-full gap-1.5 text-xs bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 text-white"
                  asChild
                >
                  <a href={job.zipUrl} target="_blank" rel="noopener noreferrer" download>
                    <Package className="w-3.5 h-3.5" />
                    Download Production Pack (ZIP
                    {job.zipFileCount ? ` · ${job.zipFileCount} files` : ""})
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default GenieUniversalPanelizerCard;
