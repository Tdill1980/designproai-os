/**
 * PillarPastJobsList — compact "completed past jobs" list with one-click
 * reorder, designed to slot into the Profit pillar hero card.
 *
 * Surfaces wpw_orders with status in (completed, shipped) so a WPW shop
 * can reorder a previous job in one tap. Each row shows order number,
 * customer name, total, relative date, and a Reorder button that fires
 * useReorderWpw — which clones the line items into a new pending Woo
 * order and opens the customer-facing pay URL.
 *
 * Read-only for non-WPW tenants and for WPW tenants with no past jobs
 * (component returns null).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Repeat2, ChevronDown, ChevronUp, FileImage } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { wpwStatusClass, wpwStatusLabel } from "@/hooks/useWpwOrders";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { WpwOrderDetailModal } from "./WpwOrderDetailModal";

const COMPLETED_STATUSES = ["completed", "shipped"];
const COLLAPSED_COUNT = 3;

interface PastJobItem {
  id: number;
  name: string | null;
  quantity: number;
  image_url: string | null;
}

interface PastJobRow {
  id: number;
  order_number: string;
  status: string;
  customer_name: string | null;
  total: number;
  date_completed: string | null;
  date_created: string;
  wpw_order_items?: PastJobItem[];
}

const usePastJobs = () => {
  return useQuery<PastJobRow[]>({
    queryKey: ["pillar-wpw-past-jobs"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return [];

      const { data, error } = await (supabase as any)
        .from("wpw_orders")
        .select(
          "id, order_number, status, customer_name, total, date_completed, date_created, wpw_order_items(id, name, quantity, image_url)",
        )
        .in("status", COMPLETED_STATUSES)
        .order("date_completed", { ascending: false, nullsFirst: false })
        .limit(25);

      if (error) return [];
      return (data || []) as PastJobRow[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
};

const formatRelative = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
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

export const PillarPastJobsList = () => {
  const { data: orders = [], isLoading } = usePastJobs();
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

  if (orders.length === 0) return null;

  const hasMore = orders.length > COLLAPSED_COUNT;
  const visible = expanded ? orders : orders.slice(0, COLLAPSED_COUNT);
  const hiddenCount = orders.length - COLLAPSED_COUNT;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <History className="w-3 h-3 text-white/40" />
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/40">
          Past Jobs · One-Click Reorder
        </span>
        <span className="text-[9px] font-bold text-cyan-400">{orders.length}</span>
      </div>
      <div className="space-y-1">
        {visible.map((o) => {
          const dateIso = o.date_completed || o.date_created;
          const items = o.wpw_order_items || [];
          return (
            <HoverCard key={o.id} openDelay={150} closeDelay={100}>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  onClick={() => setViewingOrderId(o.id)}
                  title={`View order #${o.order_number}`}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md bg-[#1c1c1e] border border-[#3a3a3c] hover:border-cyan-500/60 hover:bg-[#222224] transition cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
                >
                  <span className="text-[10px] font-mono font-bold text-[#60A5FA] shrink-0">
                    #{o.order_number}
                  </span>
                  <span className="text-[10px] text-white/70 truncate flex-1">
                    {o.customer_name || "—"}
                  </span>
                  <span className="text-[10px] font-bold text-white/80 shrink-0">
                    {currency(o.total)}
                  </span>
                  <span className="text-[10px] text-white/30 shrink-0 hidden sm:inline">
                    {formatRelative(dateIso)}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setViewingOrderId(o.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        setViewingOrderId(o.id);
                      }
                    }}
                    title="Open order to review and reorder"
                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-400 transition shrink-0"
                  >
                    <Repeat2 className="w-2.5 h-2.5" />
                    Reorder
                  </span>
                </button>
              </HoverCardTrigger>
              <HoverCardContent
                align="start"
                className="w-80 bg-[#0d0d0e] border-[#2a2a2a] text-white p-3"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono font-bold text-[#60A5FA] shrink-0">
                      #{o.order_number}
                    </span>
                    <Badge
                      className={cn(
                        wpwStatusClass(o.status),
                        "text-[9px] font-bold uppercase tracking-wider",
                      )}
                    >
                      {wpwStatusLabel(o.status)}
                    </Badge>
                  </div>
                  <span className="text-xs font-bold text-white shrink-0">
                    {currency(o.total)}
                  </span>
                </div>
                <p className="text-[10px] text-white/50 mb-2">
                  {o.customer_name || "—"} · {formatRelative(dateIso)}
                </p>
                {items.length > 0 ? (
                  <div className="space-y-1">
                    {items.slice(0, 4).map((it) => (
                      <div
                        key={it.id}
                        className="flex items-center gap-2 p-1.5 rounded bg-[#1a1a1a] border border-[#2a2a2a]"
                      >
                        {it.image_url ? (
                          <img
                            src={it.image_url}
                            alt=""
                            loading="lazy"
                            className="w-8 h-8 rounded object-cover border border-[#2a2a2a] shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded bg-gradient-to-br from-[#3B82F6]/20 to-[#D946EF]/20 flex items-center justify-center shrink-0">
                            <FileImage className="w-3.5 h-3.5 text-[#D946EF]" />
                          </div>
                        )}
                        <span className="flex-1 text-[11px] text-white/85 truncate">
                          {it.name || "Item"}
                        </span>
                        {it.quantity > 1 && (
                          <span className="text-[10px] text-white/40 shrink-0">
                            ×{it.quantity}
                          </span>
                        )}
                      </div>
                    ))}
                    {items.length > 4 && (
                      <p className="text-[10px] text-white/40 text-center pt-1">
                        + {items.length - 4} more
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-white/40 italic">
                    No item details
                  </p>
                )}
                <p className="text-[10px] text-white/40 mt-2 pt-2 border-t border-[#2a2a2a]">
                  Click to review and reorder
                </p>
              </HoverCardContent>
            </HoverCard>
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
