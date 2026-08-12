import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Package, Repeat2, ChevronRight, ExternalLink, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import {
  useMyWpwOrders,
  useReorderWpw,
  wpwStatusClass,
  wpwStatusLabel,
  type WpwOrder,
} from "@/hooks/useWpwOrders";

/**
 * PastOrdersCard — standalone dashboard tile showing the shop's most
 * recent completed/shipped WPW orders with one-click reorder.
 *
 * Sits alongside other dashboard cards. Hidden for non-WPW tenants.
 * "View all" links into the full /dashboard/my-orders page.
 */

const COMPLETED_STATUSES = new Set(["completed", "shipped"]);
const VISIBLE_COUNT = 4;

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const fmtRelative = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d < 1) return "today";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
};

export function PastOrdersCard() {
  const navigate = useNavigate();
  const isWpw = useIsWpwTenant();
  const { data, isLoading } = useMyWpwOrders();
  const reorder = useReorderWpw();

  const pastJobs = useMemo<WpwOrder[]>(() => {
    const orders = Array.isArray(data?.orders) ? data.orders : [];
    return orders
      .filter((o) => COMPLETED_STATUSES.has(String(o.status || "").toLowerCase()))
      .slice(0, VISIBLE_COUNT);
  }, [data]);

  if (!isWpw) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 flex items-center justify-center">
            <History className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h3 className="font-bold text-foreground text-base leading-tight">Past Orders</h3>
            <p className="text-xs text-muted-foreground">Your WPW order history &middot; one-click reorder</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-cyan-400 hover:text-cyan-300 -mr-2"
          onClick={() => navigate("/dashboard/my-orders")}
        >
          View all <ChevronRight className="w-4 h-4 ml-0.5" />
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 bg-muted/30 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : pastJobs.length === 0 ? (
        <div className="py-8 text-center">
          <Package className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No completed WPW orders yet.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Once a job ships, it&rsquo;ll appear here for one-click reorder.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {pastJobs.map((o) => (
            <div
              key={o.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold text-foreground truncate">
                    #{o.order_number || o.id}
                  </span>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${wpwStatusClass(o.status)}`}>
                    {wpwStatusLabel(o.status)}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  {o.customer_name && <span className="truncate">{o.customer_name}</span>}
                  <span>&middot;</span>
                  <span>{fmtMoney(Number(o.total) || 0)}</span>
                  <span>&middot;</span>
                  <span>{fmtRelative(o.date_created)}</span>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 text-xs h-8"
                disabled={reorder.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  reorder.mutate(o.id);
                }}
              >
                <Repeat2 className="w-3.5 h-3.5 mr-1" /> Reorder
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
