/**
 * JobsListTabs — full-width Jobs panel for the dashboard with tabs for
 * Active / Past / All. Each row shows the real customer total (revenue),
 * the WPW order cost, and the per-job profit + margin. Past jobs include
 * a one-click Reorder button. Additive — does NOT replace any existing
 * dashboard surface.
 *
 * Data:
 *   useJobsWithProfit(stage) joins wpw_orders → customer_quotes via
 *   quote_id. Rows without a linked quote get an "est." badge and the
 *   revenue is computed from cost × shop markup percentage.
 */

import { useMemo, useState } from "react";
import { Briefcase, Repeat2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useJobsWithProfit,
  summarizeJobs,
  type JobRow,
  type JobStage,
} from "@/hooks/useJobsWithProfit";
import { useReorderWpw, wpwStatusClass, wpwStatusLabel } from "@/hooks/useWpwOrders";
import { WpwOrderDetailModal } from "./WpwOrderDetailModal";

const TABS: { id: JobStage; label: string; description: string }[] = [
  { id: "active", label: "Active", description: "Jobs in progress" },
  { id: "past", label: "Past", description: "Completed + shipped" },
  { id: "all", label: "All", description: "Everything" },
];

type RangeOption = { value: number | null; label: string };
const RANGE_OPTIONS: RangeOption[] = [
  { value: 1, label: "Today" },
  { value: 7, label: "7D" },
  { value: 14, label: "14D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
  { value: null, label: "All" },
];

const currency = (n: number): string => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n)}`;
  }
};

const formatRelative = (iso: string | null): string => {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
};

interface JobRowItemProps {
  job: JobRow;
  onView: (orderId: number) => void;
}

function JobRowItem({ job, onView }: JobRowItemProps) {
  const reorder = useReorderWpw();
  const isPast = job.status === "completed" || job.status === "shipped";
  const dateIso = job.date_completed || job.date_created;
  const profitColor = job.profit > 0 ? "text-emerald-400" : job.profit < 0 ? "text-rose-400" : "text-white/60";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onView(job.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onView(job.id);
        }
      }}
      title={`View order #${job.order_number}`}
      className="grid grid-cols-[auto,1fr,auto] sm:grid-cols-[auto,1fr,auto,auto,auto,auto] gap-2 items-center px-3 py-2.5 rounded-lg bg-[#1c1c1e] border border-[#3a3a3c] hover:border-cyan-500/40 hover:bg-[#222224] transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
    >
      {/* Order # + date + status */}
      <div className="flex items-center gap-2 min-w-0 col-span-2 sm:col-span-1">
        <span className="text-[11px] font-mono font-bold text-[#60A5FA] shrink-0">
          #{job.order_number}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-white truncate">
            {job.customer_name || "—"}
          </span>
          <Badge
            className={cn(
              wpwStatusClass(job.status),
              "text-[8px] font-bold uppercase tracking-wider px-1.5 py-0",
            )}
          >
            {wpwStatusLabel(job.status)}
          </Badge>
        </div>
        <span className="text-[10px] text-white/40">{formatRelative(dateIso)}</span>
      </div>

      {/* Revenue */}
      <div className="text-right shrink-0">
        <div className="flex items-center justify-end gap-1">
          <span className="text-[11px] font-bold text-white">{currency(job.revenue)}</span>
          {job.revenueSource === "estimated" && (
            <span
              title="Estimated from your shop markup — link a quote for the actual amount"
              className="text-[8px] font-bold uppercase tracking-wider px-1 py-0 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30"
            >
              est
            </span>
          )}
        </div>
        <div className="text-[8px] text-white/30 uppercase tracking-wider">Revenue</div>
      </div>

      {/* Cost */}
      <div className="text-right shrink-0 hidden sm:block">
        <div className="text-[11px] font-semibold text-white/70">{currency(job.cost)}</div>
        <div className="text-[8px] text-white/30 uppercase tracking-wider">Cost</div>
      </div>

      {/* Profit */}
      <div className="text-right shrink-0 hidden sm:block">
        <div className={cn("text-[11px] font-bold", profitColor)}>
          {currency(job.profit)}
        </div>
        <div className="text-[8px] text-white/30 uppercase tracking-wider">
          {job.margin}% margin
        </div>
      </div>

      {/* Action */}
      <div className="shrink-0 col-span-3 sm:col-span-1 flex justify-end" onClick={(e) => e.stopPropagation()}>
        {isPast && (
          <button
            type="button"
            disabled={reorder.isPending}
            onClick={(e) => {
              e.stopPropagation();
              reorder.mutate(job.id);
            }}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-400 transition disabled:opacity-50"
          >
            <Repeat2 className="w-2.5 h-2.5" />
            {reorder.isPending && reorder.variables === job.id ? "…" : "Reorder"}
          </button>
        )}
      </div>
    </div>
  );
}

export function JobsListTabs() {
  const [tab, setTab] = useState<JobStage>("active");
  const [days, setDays] = useState<number | null>(30);
  const [viewingOrderId, setViewingOrderId] = useState<number | null>(null);
  const { data: jobs = [], isLoading } = useJobsWithProfit(tab, days);

  const summary = useMemo(() => summarizeJobs(jobs), [jobs]);

  return (
    <section
      aria-label="Jobs"
      className="rounded-2xl border border-[#48484a] bg-rp-surface overflow-hidden"
    >
      <div className="h-[3px] bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-orange-400" />
      <div className="p-4 sm:p-5">
        {/* Header row */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-cyan-400" />
            <span className="text-[10px] uppercase tracking-[0.15em] text-white/70 font-semibold">
              Jobs · Revenue · Cost · Profit
            </span>
          </div>
          {/* Aggregate summary */}
          <div className="flex items-center gap-3 sm:gap-4 text-right">
            <div>
              <div className="text-[8px] uppercase tracking-wider text-white/40 font-bold">Revenue</div>
              <div className="text-sm font-bold text-white">{currency(summary.revenue)}</div>
            </div>
            <div className="hidden sm:block">
              <div className="text-[8px] uppercase tracking-wider text-white/40 font-bold">Cost</div>
              <div className="text-sm font-bold text-white/70">{currency(summary.cost)}</div>
            </div>
            <div>
              <div className="text-[8px] uppercase tracking-wider text-white/40 font-bold flex items-center gap-1 justify-end">
                <TrendingUp className="w-2.5 h-2.5" />
                Profit
              </div>
              <div className="text-sm font-bold text-emerald-400">
                {currency(summary.profit)}{" "}
                <span className="text-[10px] text-emerald-400/60">{summary.margin}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs + Range pills */}
        <div className="flex items-center gap-2 mb-3 border-b border-[#3a3a3c] flex-wrap">
          <div className="flex items-center gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition relative",
                  tab === t.id
                    ? "text-white"
                    : "text-white/40 hover:text-white/70",
                )}
              >
                {t.label}
                {tab === t.id && (
                  <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-orange-400 rounded-t" />
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-0.5 ml-auto bg-[#1c1c1e] rounded-lg p-0.5 border border-[#3a3a3c] mb-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setDays(opt.value)}
                className={cn(
                  "px-2 py-1 text-[9px] font-bold uppercase tracking-wider rounded-md transition",
                  days === opt.value
                    ? "bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-white"
                    : "text-white/40 hover:text-white/70",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {summary.estimatedCount > 0 && (
            <Badge
              variant="outline"
              className="border-amber-500/30 text-amber-300 bg-amber-500/5 text-[9px] uppercase tracking-wider mb-1"
              title="Some rows use estimated revenue from your shop markup. Hook QuoteTool into your flow to capture actuals."
            >
              {summary.estimatedCount} estimated
            </Badge>
          )}
        </div>

        {/* Rows */}
        {isLoading ? (
          <div className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-rp-elevated animate-pulse" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-8">
            <Briefcase className="w-8 h-8 text-white/20 mx-auto mb-2" />
            <p className="text-[11px] text-white/40">
              No {tab === "all" ? "" : tab + " "}jobs to show.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {jobs.map((j) => (
              <JobRowItem key={j.id} job={j} onView={setViewingOrderId} />
            ))}
          </div>
        )}

        {/* Empty-state callout */}
        {!isLoading && jobs.length > 0 && summary.actualCount === 0 && (
          <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-200/80">
            All revenue is estimated using your shop markup. Quote your next customer through QuickQuote to capture real numbers automatically.
          </div>
        )}
      </div>
      <WpwOrderDetailModal orderId={viewingOrderId} onClose={() => setViewingOrderId(null)} />
    </section>
  );
}
