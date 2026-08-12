/**
 * PillarRecentActivityList — last-7-days quote + WPW order feed.
 *
 * Merges two sources, sorted newest first:
 *   - public.quotes (internal QuickQuote, last 7d)
 *   - wpw_orders    (any status, last 7d)
 *
 * Each row is clickable:
 *   - Quote → /quotes?id=<id>  (auto-opens the view modal)
 *   - Order → weprintwraps.com/my-account/view-order/<id>/
 *
 * Sits above PillarPastJobsList in the Profit pillar so reps can see
 * fresh activity without losing the reorder workflow.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronDown, ChevronUp, FileText, ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { WpwOrderDetailModal } from "./WpwOrderDetailModal";

const COLLAPSED_COUNT = 4;
const WINDOW_DAYS = 7;
const PER_SOURCE_LIMIT = 15;

type ActivityKind = "quote" | "order";

interface ActivityRow {
  kind: ActivityKind;
  id: string | number;
  number: string;
  customerName: string | null;
  total: number | null;
  createdAt: string;
}

const useRecentActivity = () => {
  return useQuery<ActivityRow[]>({
    queryKey: ["pillar-recent-activity", WINDOW_DAYS],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return [];

      const sinceIso = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const db = supabase as never as { from: (t: string) => any };

      const [quotesRes, ordersRes] = await Promise.all([
        db
          .from("quotes")
          .select("id, quote_number, created_at, customer_total, customers ( name )")
          .not("quote_number", "like", "DEMO-%")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE_LIMIT),
        db
          .from("wpw_orders")
          .select("id, order_number, customer_name, total, date_created")
          .gte("date_created", sinceIso)
          .order("date_created", { ascending: false })
          .limit(PER_SOURCE_LIMIT),
      ]);

      const quotes: ActivityRow[] = ((quotesRes?.data as any[]) || []).map((r) => ({
        kind: "quote",
        id: r.id,
        number: r.quote_number || "—",
        customerName: r.customers?.name || null,
        total: r.customer_total ?? null,
        createdAt: r.created_at,
      }));

      const orders: ActivityRow[] = ((ordersRes?.data as any[]) || []).map((r) => ({
        kind: "order",
        id: r.id,
        number: String(r.order_number || r.id),
        customerName: r.customer_name || null,
        total: typeof r.total === "number" ? r.total : null,
        createdAt: r.date_created,
      }));

      return [...quotes, ...orders].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
};

const formatRelative = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / (60 * 1000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

const currency = (n: number | null): string => {
  if (n == null) return "—";
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

export const PillarRecentActivityList = () => {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useRecentActivity();
  const [expanded, setExpanded] = useState(false);
  const [viewingOrderId, setViewingOrderId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-1 mt-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-9 rounded-md bg-rp-elevated animate-pulse" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) return null;

  const hasMore = rows.length > COLLAPSED_COUNT;
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);
  const hiddenCount = rows.length - COLLAPSED_COUNT;

  const open = (row: ActivityRow) => {
    if (row.kind === "quote") {
      navigate(`/quotes?id=${row.id}`);
    } else {
      setViewingOrderId(Number(row.id));
    }
  };

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Activity className="w-3 h-3 text-white/40" />
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/40">
          Recent Activity · Last {WINDOW_DAYS}d
        </span>
        <span className="text-[9px] font-bold text-cyan-400">{rows.length}</span>
      </div>
      <div className="space-y-1">
        {visible.map((r) => {
          const isQuote = r.kind === "quote";
          const Icon = isQuote ? FileText : ShoppingBag;
          return (
            <div
              key={`${r.kind}-${r.id}`}
              role="button"
              tabIndex={0}
              onClick={() => open(r)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  open(r);
                }
              }}
              title={isQuote ? `Open quote #${r.number}` : `Open order #${r.number} on WePrintWraps`}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-[#1c1c1e] border border-[#3a3a3c] hover:border-cyan-500/40 hover:bg-[#222224] transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
            >
              <span
                className={cn(
                  "flex items-center gap-1 text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0",
                  isQuote
                    ? "text-[#60A5FA] border-[#60A5FA]/30 bg-[#60A5FA]/10"
                    : "text-fuchsia-300 border-fuchsia-500/30 bg-fuchsia-500/10"
                )}
              >
                <Icon className="w-2.5 h-2.5" />
                {isQuote ? "Quote" : "Order"}
              </span>
              <span className="text-[10px] font-mono font-bold text-white/80 shrink-0">
                #{r.number}
              </span>
              <span className="text-[10px] text-white/70 truncate flex-1">
                {r.customerName || "—"}
              </span>
              <span className="text-[10px] font-bold text-white/80 shrink-0">
                {currency(r.total)}
              </span>
              <span className="text-[10px] text-white/30 shrink-0">
                {formatRelative(r.createdAt)}
              </span>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-1.5 text-[10px] font-semibold text-cyan-400 hover:text-cyan-300 transition-colors bg-transparent border-none cursor-pointer w-full justify-center py-1 rounded-md hover:bg-white/5"
        >
          {expanded ? (
            <><ChevronUp className="w-3 h-3" /> Show less</>
          ) : (
            <><ChevronDown className="w-3 h-3" /> Show all {hiddenCount} more</>
          )}
        </button>
      )}
      <WpwOrderDetailModal orderId={viewingOrderId} onClose={() => setViewingOrderId(null)} />
    </div>
  );
};
