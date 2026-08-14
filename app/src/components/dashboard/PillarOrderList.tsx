/**
 * PillarOrderList — compact WPW order mini-list for pillar hero cards.
 *
 * Shows recent WPW orders filtered by stage, collapsed to 4 rows by default
 * with a "Show all" toggle. Most recent orders appear first.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Package, Paintbrush, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DESIGN_PRODUCT_KEYWORDS,
  PRINT_PRODUCT_KEYWORDS,
  itemMatches,
} from "@/lib/wpw-order-types";
import { WpwOrderDetailModal } from "./WpwOrderDetailModal";

type Stage = "design" | "production";

const COLLAPSED_COUNT = 4;

const DESIGN_STATUSES = ["in-design", "design-complete", "processing", "on-hold"];
const PRODUCTION_STATUSES = ["print-production", "completed", "shipped", "reprint"];

// Status alone isn't enough — a "processing" order can be a print-only job
// that just hasn't been picked up by the press yet, and that should NOT
// land in the Design pillar. Each pillar pairs status filter with the
// shared product-name keyword set from @/lib/wpw-order-types.

const STATUS_COLORS: Record<string, string> = {
  "in-design": "text-cyan-400 border-cyan-500/30 bg-cyan-500/10",
  processing: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10",
  "on-hold": "text-amber-400 border-amber-500/30 bg-amber-500/10",
  "print-production": "text-purple-400 border-purple-500/30 bg-purple-500/10",
  "design-complete": "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  completed: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  shipped: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  reprint: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

const STATUS_LABELS: Record<string, string> = {
  "in-design": "In Design",
  "design-complete": "Design Done",
  processing: "In Progress",
  "on-hold": "On Hold",
  pending: "Pending",
  "print-production": "In Production",
  completed: "Completed",
  shipped: "Shipped",
  reprint: "Reprint",
};

interface OrderRow {
  id: number;
  order_number: string;
  status: string;
  customer_name: string | null;
  total: number;
  date_created: string;
  wpw_order_items?: { name: string | null }[];
}

interface StageResult {
  orders: OrderRow[];
  totalCount: number;
}

const useWpwOrdersByStage = (stage: Stage) => {
  const statuses = stage === "design" ? DESIGN_STATUSES : PRODUCTION_STATUSES;
  const keywords = stage === "design" ? DESIGN_PRODUCT_KEYWORDS : PRINT_PRODUCT_KEYWORDS;
  return useQuery<StageResult>({
    queryKey: ["pillar-wpw-orders", stage],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return { orders: [], totalCount: 0 };

      // Pull a wider window of candidate orders so we still have
      // COLLAPSED_COUNT-worth after filtering by product type.
      const { data, error } = await (supabase as any)
        .from("wpw_orders")
        .select("id, order_number, status, customer_name, total, date_created, wpw_order_items(name)")
        .in("status", statuses)
        .order("date_created", { ascending: false })
        .limit(100);

      if (error) return { orders: [], totalCount: 0 };

      const filtered = ((data || []) as OrderRow[]).filter((o) =>
        itemMatches(o.wpw_order_items, keywords)
      );

      return {
        orders: filtered.slice(0, 25),
        totalCount: filtered.length,
      };
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
};

const formatRelative = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return "now";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

interface PillarOrderListProps {
  stage: Stage;
}

export const PillarOrderList = ({ stage }: PillarOrderListProps) => {
  const { data, isLoading } = useWpwOrdersByStage(stage);
  const [expanded, setExpanded] = useState(false);
  const [viewingOrderId, setViewingOrderId] = useState<number | null>(null);
  const orders = data?.orders || [];
  const totalCount = data?.totalCount || 0;

  if (isLoading) return (
    <div className="space-y-1 mt-2">
      {[0, 1].map((i) => (
        <div key={i} className="h-8 rounded-md bg-rp-elevated animate-pulse" />
      ))}
    </div>
  );

  if (!orders || orders.length === 0) return null;

  const Icon = stage === "design" ? Paintbrush : Package;
  const label = stage === "design" ? "WPW Design Jobs" : "WPW Production";
  const hasMore = orders.length > COLLAPSED_COUNT;
  const visible = expanded ? orders : orders.slice(0, COLLAPSED_COUNT);
  const hiddenCount = orders.length - COLLAPSED_COUNT;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="w-3 h-3 text-white/40" />
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/40">
          {label}
        </span>
        <span className="text-[9px] font-bold text-cyan-400">{totalCount}</span>
      </div>
      <div className="space-y-1">
        {visible.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setViewingOrderId(o.id)}
            title={`View order #${o.order_number}`}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md bg-[#1c1c1e] border border-[#3a3a3c] hover:border-cyan-500/40 hover:bg-[#222224] transition cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          >
            <span className="text-[10px] font-mono font-bold text-[#60A5FA] shrink-0">
              #{o.order_number}
            </span>
            <span className="text-[10px] text-white/70 truncate flex-1">
              {o.customer_name || "—"}
            </span>
            <span
              className={cn(
                "text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0",
                STATUS_COLORS[o.status] || "text-white/50 border-[#48484a] bg-white/5"
              )}
            >
              {STATUS_LABELS[o.status] || o.status}
            </span>
            <span className="text-[10px] text-white/30 shrink-0">
              {formatRelative(o.date_created)}
            </span>
          </button>
        ))}
      </div>
      {hasMore && (
        <button
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
