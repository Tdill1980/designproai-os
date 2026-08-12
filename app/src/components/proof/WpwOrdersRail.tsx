/**
 * WpwOrdersRail
 *
 * Lists WePrintWraps design orders from the last 30 days — plus any older
 * order still in an open design status so stale jobs stay reachable — via the
 * `wpw-orders-read` edge function (the safe, cached Woo-REST bridge).
 * Clicking an order opens the rich order viewer (WpwOrderDetailModal) so
 * the designer can read the brief, download the customer's artwork, print
 * the work order, and claim / assign the job — all without leaving the
 * order. Orders that already have a linked proof show an approval-status
 * badge.
 *
 * Data note: `wpw-orders-read` returns raw `wpw_orders` rows. The Woo
 * order id is the row's `id` (NOT a `woo_order_id` column), and the real
 * order date is `date_created` (NOT `created_at`, which is the cache
 * insert time). Filter + linkage logic below keys off those real fields.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WpwOrderDetailModal } from "@/components/dashboard/WpwOrderDetailModal";
import { WpwOrderProofActions } from "@/components/proof/WpwOrderProofActions";
import { useShopTeam } from "@/hooks/useShopTeam";
import type { WpwOrder } from "@/hooks/useWpwOrders";
import { extractBriefAndUploads } from "@/lib/wpw-order-extract";
import {
  ShoppingBag, Loader2, ArrowRight, CalendarDays, CheckCircle2, Send, Eye,
  XCircle, RotateCw, AlertTriangle, Clock, LifeBuoy, UserCheck, UserX,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WpwOrdersRailProps {
  /**
   * Called after the user opens an order in the approval workbench so the
   * parent ApproveProPage can pull the proof row into its list + select it.
   */
  onProofLinked?: (proofId: string) => void;
}

type ProofStatus =
  | "draft" | "sent" | "viewed" | "revising" | "approved" | "declined"
  | "revoked" | "expired" | "delivery_failed" | "escalated_shop" | "escalated_support";

interface LinkedProof {
  id: string;
  status: ProofStatus;
  updated_at: string;
  assigned_to: string | null;
  metadata: Record<string, any> | null;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// Design jobs in any of these statuses are still OPEN — the customer is
// owed a proof or the job is mid-flight. They must never drop off the rail
// just because they're older than the 30-day window, or a real job (e.g. an
// April order still "in-design") becomes unreachable: there's no other way
// into a WPW order from ApprovePro. Closed states (completed/cancelled/
// refunded/failed) correctly age out after 30 days.
const OPEN_DESIGN_STATUSES = new Set([
  "in-design",
  "design-complete",
  "waiting-on-email",
  "dropbox-link-sent",
  "file-error",
  "missing-file",
  "reprint",
  "add-on",
  "pending",
]);

const STATUS_BADGE: Record<ProofStatus, { label: string; color: string; icon: typeof Send }> = {
  draft:             { label: "Draft",       color: "bg-gray-100 text-gray-600 border-gray-200", icon: Send },
  sent:              { label: "Sent",        color: "bg-blue-100 text-blue-700 border-blue-200", icon: Send },
  viewed:            { label: "Viewed",      color: "bg-blue-100 text-blue-700 border-blue-200", icon: Eye },
  revising:          { label: "Revising",    color: "bg-purple-100 text-purple-700 border-purple-200", icon: RotateCw },
  approved:          { label: "Approved",    color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 },
  declined:          { label: "Declined",    color: "bg-red-100 text-red-700 border-red-200", icon: XCircle },
  revoked:           { label: "Revoked",     color: "bg-zinc-100 text-gray-400 border-gray-200", icon: XCircle },
  expired:           { label: "Expired",     color: "bg-zinc-100 text-gray-400 border-gray-200", icon: Clock },
  delivery_failed:   { label: "Email failed", color: "bg-red-100 text-red-700 border-red-200", icon: AlertTriangle },
  escalated_shop:    { label: "Shop revising", color: "bg-amber-100 text-amber-700 border-amber-200", icon: RotateCw },
  escalated_support: { label: "Support",     color: "bg-amber-100 text-amber-700 border-amber-200", icon: LifeBuoy },
};

// Mirror approvepro-sync-wpw's design-order classifier EXACTLY so the rail
// agrees with the proofs the sync actually creates: keep real design work,
// drop pure-production line items (printed film, contour-cut wrap film,
// lamination, vinyl rolls/sheets, transfer tape). The whitelist requires an
// actual design keyword — "wrap"/"panel" are NOT included because product
// names like "Avery Contour-Cut Wrap Film" are materials, not design jobs.
function isLikelyDesignOrder(o: WpwOrder): boolean {
  const items = o.wpw_order_items || [];
  if (items.length === 0) return false;
  return items.some((it) => {
    const n = (it.name || "").toLowerCase();
    if (
      n.startsWith("printed") ||
      n.includes("uv lamination") ||
      n.includes("vinyl roll") ||
      n.includes("ink ") ||
      n.includes("roll of ") ||
      n.includes("wrap film") ||
      n.includes("contour-cut") ||
      n.includes("contour cut") ||
      n.includes("window vinyl") ||
      n.includes("transfer tape") ||
      n.includes("laminate")
    ) return false;
    return (
      n.includes("design") ||
      n.includes("file output") ||
      n.includes("hourly") ||
      n.includes("proof") ||
      n.includes("graphic") ||
      n.includes("logo")
    );
  });
}

const shortDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export const WpwOrdersRail = ({ onProofLinked }: WpwOrdersRailProps = {}) => {
  const [, setSearchParams] = useSearchParams();
  const { lookup } = useShopTeam();
  const [orders, setOrders] = useState<WpwOrder[] | null>(null);
  const [proofsByWoo, setProofsByWoo] = useState<Record<number, LinkedProof>>({});
  const [loading, setLoading] = useState(true);
  const [detailOrder, setDetailOrder] = useState<WpwOrder | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Step 1 — load the orders. This is the ONLY thing the spinner waits
      // on. We deliberately do NOT couple it to supabase.auth.getUser():
      // getUser() does a network round-trip behind a cross-tab Web Lock and
      // can hang indefinitely when several app tabs are open, which would
      // leave "Checking WPW orders…" spinning forever. Auth is resolved
      // separately below as a best-effort enrichment step.
      let recent: WpwOrder[] = [];
      try {
        const { data: ordersData, error: ordersErr } =
          await supabase.functions.invoke("wpw-orders-read", { body: {} });
        if (!ordersErr) {
          const raw = (ordersData?.orders || ordersData || []) as WpwOrder[];
          const cutoff = Date.now() - THIRTY_DAYS_MS;
          recent = raw
            // Keep an order if it's recent OR still in an open design status,
            // so stale-but-unfinished jobs stay reachable (an April order that
            // still needs a proof must not disappear after 30 days).
            .filter((o) => {
              const recentEnough =
                o.date_created && new Date(o.date_created).getTime() >= cutoff;
              const stillOpen = OPEN_DESIGN_STATUSES.has(
                (o.status || "").toLowerCase(),
              );
              return recentEnough || stillOpen;
            })
            .filter(isLikelyDesignOrder)
            // Newest → oldest by the real order date.
            .sort((a, b) => new Date(b.date_created || 0).getTime() - new Date(a.date_created || 0).getTime())
            .slice(0, 200);
        }
      } catch {
        recent = [];
      }

      if (cancelled) return;
      setOrders(recent);
      setLoading(false);

      // Step 2 — best-effort: pull any proofs the shop has already linked to
      // these WPW orders so the rail can show approval-status badges. Read
      // the cached session (local, no network, no lock) instead of getUser()
      // so this can never block. A short timeout guards against any stall.
      if (recent.length === 0) return;
      try {
        const sessionRes = await Promise.race([
          supabase.auth.getSession(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);
        const user = (sessionRes as any)?.data?.session?.user ?? null;
        if (!user || cancelled) return;

        const wooIds = recent.map((o) => o.id).filter(Boolean);
        const proofCutoff = new Date(Date.now() - NINETY_DAYS_MS).toISOString();
        const { data: proofs } = await supabase
          .from("proof_approvals" as any)
          .select("id, status, updated_at, assigned_to, metadata")
          .eq("shop_id", user.id)
          .gte("updated_at", proofCutoff)
          .order("updated_at", { ascending: false });

        if (cancelled) return;
        const map: Record<number, LinkedProof> = {};
        (proofs as any[] | null)?.forEach((p) => {
          const wooId = Number(p?.metadata?.wpw_woo_order_id);
          if (Number.isFinite(wooId) && wooIds.includes(wooId) && !map[wooId]) {
            map[wooId] = p as LinkedProof;
          }
        });
        setProofsByWoo(map);
      } catch {
        // Badges are optional — never let this affect the rail.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Representative artwork = ONLY the customer's file uploaded to THIS order
  // (from line-item meta). Never the generic WooCommerce product photo
  // (it.image_url) — that's the same catalog image for every order. If the
  // customer uploaded nothing, return null so a "no artwork" placeholder shows.
  const firstItemImage = (o: WpwOrder): string | null => {
    try {
      const { uploads } = extractBriefAndUploads(o, o.wpw_order_items || []);
      if (uploads && uploads.length > 0) return uploads[0];
    } catch {
      /* ignore */
    }
    return null;
  };

  const firstItemName = (o: WpwOrder): string => {
    const items = o.wpw_order_items || [];
    if (items.length === 0) return "WPW Order";
    const primary = items[0]?.name || "WPW Order";
    return items.length > 1 ? `${primary} +${items.length - 1}` : primary;
  };

  const linkedSummary = useMemo(() => {
    const total = Object.keys(proofsByWoo).length;
    if (total === 0) return null;
    const approved = Object.values(proofsByWoo).filter((p) => p.status === "approved").length;
    return { total, approved };
  }, [proofsByWoo]);

  if (loading) {
    return (
      <Card className="p-3 flex items-center gap-2 text-xs text-muted-foreground border-dashed">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking WPW orders…
      </Card>
    );
  }
  if (!orders || orders.length === 0) return null;

  return (
    <>
      <Card className="p-3 space-y-2 border-purple-200 bg-gradient-to-br from-purple-50/60 to-blue-50/60">
        <div className="flex items-center gap-1.5 flex-wrap">
          <ShoppingBag className="w-3.5 h-3.5 text-purple-700" />
          <h3 className="text-xs font-bold text-purple-900 uppercase tracking-wider">
            WPW Orders
          </h3>
          <Badge variant="outline" className="text-[9px] h-4 px-1 bg-white/70 border-purple-200 text-purple-700">
            <CalendarDays className="w-2.5 h-2.5 mr-0.5" />
            Open + last 30 days
          </Badge>
          <Badge variant="outline" className="text-[9px] h-4 px-1 bg-white/70 border-purple-200 text-purple-700">
            {orders.length}
          </Badge>
          {linkedSummary && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 bg-white/70 border-purple-200 text-purple-700">
              {linkedSummary.approved}/{linkedSummary.total} approved
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-purple-900/70">
          Tap an order to view the job, download artwork, print the work order, or
          claim it for yourself.
        </p>

        <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
          {orders.map((o) => {
            const thumb = firstItemImage(o);
            const linked = proofsByWoo[o.id];
            const cfg = linked ? STATUS_BADGE[linked.status] : null;
            const Icon = cfg?.icon;
            const assignee = linked?.assigned_to ? lookup(linked.assigned_to) : null;
            const placed = shortDate(o.date_created);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setDetailOrder(o)}
                className={cn(
                  "w-full text-left rounded-lg border bg-white",
                  "hover:shadow-sm transition-all p-3",
                  linked
                    ? "border-purple-300 hover:border-purple-500"
                    : "border-purple-200 hover:border-purple-400",
                )}
              >
                <div className="flex gap-3 items-center">
                  <div className="w-14 h-14 rounded-md bg-zinc-100 overflow-hidden shrink-0 flex items-center justify-center border border-zinc-200">
                    {thumb ? (
                      <img src={thumb} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <ShoppingBag className="w-6 h-6 text-zinc-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[15px] font-extrabold text-zinc-900">
                        #{o.order_number || o.id}
                      </span>
                      {cfg && Icon && (
                        <Badge variant="outline" className={cn("text-[9px] h-4 px-1 shrink-0", cfg.color)}>
                          <Icon className="w-2.5 h-2.5 mr-0.5" />
                          {cfg.label}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[13px] font-semibold text-zinc-900 truncate leading-tight">
                      {firstItemName(o)}
                    </p>
                    <p className="text-[12px] text-zinc-700 truncate">
                      {o.customer_name || o.customer_email || "—"}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {placed && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600">
                          <CalendarDays className="w-3 h-3" />
                          {placed}
                        </span>
                      )}
                      {assignee ? (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0 bg-blue-50 border-blue-200 text-blue-700">
                          <UserCheck className="w-2.5 h-2.5 mr-0.5" />
                          {assignee.displayName}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0 bg-amber-50 border-amber-200 text-amber-700">
                          <UserX className="w-2.5 h-2.5 mr-0.5" />
                          Unassigned
                        </Badge>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-purple-500 shrink-0" />
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <WpwOrderDetailModal
        orderId={detailOrder?.id ?? null}
        initialOrder={detailOrder}
        onClose={() => setDetailOrder(null)}
        staffActions
        actionsExtra={
          detailOrder && (
            <WpwOrderProofActions
              wooOrderId={detailOrder.id}
              onOpenWorkbench={(proofId) => {
                setSearchParams({ id: proofId }, { replace: true });
                onProofLinked?.(proofId);
                setDetailOrder(null);
              }}
            />
          )
        }
      />
    </>
  );
};
