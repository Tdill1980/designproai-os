/**
 * ApproveProCard
 *
 * Dashboard card showing:
 *   1. ApprovePro proof stats (drafts / awaiting / revising / approved)
 *   2. WePrintWraps order pipeline (in design / complete / production)
 *   3. Recent design jobs list — the 6 most-recent active proofs the
 *      shop owns. Click any row to jump straight into /approvepro.
 *   4. Recent customer activity — the last 5 approved/declined proofs
 *      within the past 48 hours, so the team sees what the customer
 *      just did at a glance.
 *
 * Per-shop scoped via shop_id / woo_customer_id so each shop sees only
 * their own data.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getActiveUser } from "@/lib/auth-session";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardSignature,
  Clock,
  RotateCw,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Package,
  Printer,
  Send,
  Eye,
  AlertTriangle,
  UserPlus,
  UserCheck,
  Search,
} from "lucide-react";
import { useShopTeam } from "@/hooks/useShopTeam";
import { AssigneeAvatar } from "@/components/proof/AssigneeAvatar";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface RecentProof {
  id: string;
  design_name: string | null;
  customer_name: string | null;
  customer_email: string;
  status: string;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  metadata: Record<string, any> | null;
  updated_at: string;
  assigned_to: string | null;
  assigned_at: string | null;
}

interface TeamJob {
  id: string;
  orderNum: string | null;
  designName: string | null;
  status: string;
  assignedAt: string | null;
}

interface TeamLoadEntry {
  userId: string | null; // null = unassigned bucket
  count: number;
  jobs: TeamJob[];
}

interface DashboardSummary {
  proofDraft: number;
  proofAwaiting: number;
  proofRevising: number;
  proofApprovedMonth: number;
  proofDeclinedMonth: number;
  proofUnassignedActive: number;
  proofMineActive: number;
  wpwInDesign: number;
  wpwDesignComplete: number;
  wpwInProduction: number;
  wpwCompletedMonth: number;
  wpwTotalOrders: number;
  recent: RecentProof[];
  recentActivity: RecentProof[];
  teamLoad: TeamLoadEntry[];
}

const ACTIVE_STATUSES = [
  "draft", "sent", "viewed", "revising",
  "delivery_failed", "escalated_shop", "escalated_support",
];

async function fetchSummary(): Promise<DashboardSummary | null> {
  const user = await getActiveUser();
  if (!user) return null;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthStartIso = monthStart.toISOString();

  const db = supabase as any;

  // Team-scoped — RLS widens "where shop_id IN proof_team_shop_ids(uid)"
  // so every teammate sees the whole team's queue, not just their own.
  const { data: proofs } = await db
    .from("proof_approvals")
    .select("id, design_name, customer_name, customer_email, status, vehicle_year, vehicle_make, vehicle_model, metadata, created_at, updated_at, sent_at, signed_at, assigned_to, assigned_at")
    .order("updated_at", { ascending: false })
    .limit(500);

  const rowsAll = (proofs || []) as Array<{
    id: string;
    design_name: string | null;
    customer_name: string | null;
    customer_email: string;
    status: string;
    vehicle_year: string | null;
    vehicle_make: string | null;
    vehicle_model: string | null;
    metadata: Record<string, any> | null;
    created_at: string;
    updated_at: string;
    sent_at: string | null;
    signed_at: string | null;
    assigned_to: string | null;
    assigned_at: string | null;
  }>;

  // The whole team sees the whole queue here — full transparency into who
  // has what. Per-person scoping lives in the "Mine" tile, not the list.
  const rows = rowsAll;

  const proofDraft = rows.filter((r) => r.status === "draft").length;
  const proofAwaiting = rows.filter((r) => r.status === "sent" || r.status === "viewed").length;
  const proofRevising = rows.filter((r) =>
    ["revising", "escalated_shop", "escalated_support"].includes(r.status),
  ).length;
  const proofApprovedMonth = rows.filter(
    (r) => r.status === "approved" && (r.signed_at || r.created_at) >= monthStartIso,
  ).length;
  const proofDeclinedMonth = rows.filter(
    (r) => r.status === "declined" && (r.signed_at || r.created_at) >= monthStartIso,
  ).length;

  // Assignment counts — "active" here means status that needs designer
  // attention (anything not final). Drives the Unassigned / Mine tiles.
  const isActive = (s: string) => ACTIVE_STATUSES.includes(s);
  const proofUnassignedActive = rows.filter((r) => isActive(r.status) && r.assigned_to == null).length;
  const proofMineActive = rows.filter((r) => isActive(r.status) && r.assigned_to === user.id).length;

  // Per-person workload: how many ACTIVE jobs each teammate owns, with the
  // underlying job list so the card can show the count at a glance and the
  // order numbers + assigned dates on hover. Unassigned jobs bucket under
  // userId=null.
  const loadMap = new Map<string | null, TeamJob[]>();
  for (const r of rows) {
    if (!isActive(r.status)) continue;
    const key = r.assigned_to ?? null;
    const job: TeamJob = {
      id: r.id,
      orderNum:
        r.metadata?.wpw_order_number ||
        r.metadata?.wpw_woo_order_id ||
        r.metadata?.woo_order_number ||
        null,
      designName: r.design_name,
      status: r.status,
      assignedAt: r.assigned_at ?? null,
    };
    const arr = loadMap.get(key) || [];
    arr.push(job);
    loadMap.set(key, arr);
  }
  const teamLoad: TeamLoadEntry[] = Array.from(loadMap.entries())
    .map(([userId, jobs]) => ({
      userId,
      count: jobs.length,
      jobs: jobs.sort((a, b) =>
        (b.assignedAt || "").localeCompare(a.assignedAt || ""),
      ),
    }))
    // Assigned people first (by count desc), unassigned bucket last.
    .sort((a, b) => {
      if (a.userId === null) return 1;
      if (b.userId === null) return -1;
      return b.count - a.count;
    });

  const recent: RecentProof[] = rows
    .filter((r) => ACTIVE_STATUSES.includes(r.status))
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      design_name: r.design_name,
      customer_name: r.customer_name,
      customer_email: r.customer_email,
      status: r.status,
      vehicle_year: r.vehicle_year,
      vehicle_make: r.vehicle_make,
      vehicle_model: r.vehicle_model,
      metadata: r.metadata,
      updated_at: r.updated_at,
      assigned_to: r.assigned_to,
      assigned_at: r.assigned_at,
    }));

  // Recent customer activity — last 5 approved/declined within the past 48h.
  // signed_at is set on approval; declines keep updated_at fresh. Falling back
  // to updated_at covers both paths.
  const activityCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const recentActivity: RecentProof[] = rows
    .filter((r) =>
      (r.status === "approved" || r.status === "declined") &&
      (r.signed_at || r.updated_at) >= activityCutoff
    )
    .sort((a, b) =>
      (b.signed_at || b.updated_at).localeCompare(a.signed_at || a.updated_at)
    )
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      design_name: r.design_name,
      customer_name: r.customer_name,
      customer_email: r.customer_email,
      status: r.status,
      vehicle_year: r.vehicle_year,
      vehicle_make: r.vehicle_make,
      vehicle_model: r.vehicle_model,
      metadata: r.metadata,
      updated_at: r.signed_at || r.updated_at,
      assigned_to: r.assigned_to,
    }));

  const { data: subRow } = await db
    .from("user_subscriptions")
    .select("woo_customer_id")
    .eq("user_id", user.id)
    .not("woo_customer_id", "is", null)
    .maybeSingle();

  let wpwInDesign = 0, wpwDesignComplete = 0, wpwInProduction = 0,
      wpwCompletedMonth = 0, wpwTotalOrders = 0;

  if (subRow?.woo_customer_id) {
    const wcId = subRow.woo_customer_id;
    const [
      { count: inDesign },
      { count: designComplete },
      { count: inProduction },
      { count: completedMonth },
      { count: totalOrders },
    ] = await Promise.all([
      db.from("wpw_orders").select("id", { count: "exact", head: true })
        .eq("woo_customer_id", wcId).eq("status", "in-design"),
      db.from("wpw_orders").select("id", { count: "exact", head: true })
        .eq("woo_customer_id", wcId).eq("status", "design-complete"),
      db.from("wpw_orders").select("id", { count: "exact", head: true })
        .eq("woo_customer_id", wcId).eq("status", "print-production"),
      db.from("wpw_orders").select("id", { count: "exact", head: true })
        .eq("woo_customer_id", wcId).eq("status", "completed").gte("date_created", monthStartIso),
      db.from("wpw_orders").select("id", { count: "exact", head: true })
        .eq("woo_customer_id", wcId),
    ]);
    wpwInDesign = inDesign || 0;
    wpwDesignComplete = designComplete || 0;
    wpwInProduction = inProduction || 0;
    wpwCompletedMonth = completedMonth || 0;
    wpwTotalOrders = totalOrders || 0;
  }

  return {
    proofDraft,
    proofAwaiting,
    proofRevising,
    proofApprovedMonth,
    proofDeclinedMonth,
    proofUnassignedActive,
    proofMineActive,
    wpwInDesign,
    wpwDesignComplete,
    wpwInProduction,
    wpwCompletedMonth,
    wpwTotalOrders,
    recent,
    recentActivity,
    teamLoad,
  };
}

// Short "May 21" style date for the assigned-on stamp.
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const STATUS_BADGE: Record<string, { label: string; color: string; icon: typeof Send }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-700 border-gray-300", icon: ClipboardSignature },
  sent: { label: "Sent", color: "bg-blue-100 text-blue-700 border-blue-200", icon: Send },
  viewed: { label: "Viewed", color: "bg-blue-100 text-blue-700 border-blue-200", icon: Eye },
  revising: { label: "Revising", color: "bg-purple-100 text-purple-700 border-purple-200", icon: RotateCw },
  delivery_failed: { label: "Email failed", color: "bg-red-100 text-red-700 border-red-200", icon: AlertTriangle },
  escalated_shop: { label: "Shop revising", color: "bg-amber-100 text-amber-700 border-amber-200", icon: RotateCw },
  escalated_support: { label: "Support", color: "bg-amber-100 text-amber-700 border-amber-200", icon: RotateCw },
  approved: { label: "Approved", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 },
  declined: { label: "Declined", color: "bg-red-100 text-red-700 border-red-200", icon: AlertTriangle },
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

export const ApproveProCard = () => {
  const navigate = useNavigate();
  const team = useShopTeam();
  const [orderQuery, setOrderQuery] = useState("");

  const submitOrderSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = orderQuery.trim();
    navigate(q ? `/orders?q=${encodeURIComponent(q)}` : "/orders");
  };
  const { data, isLoading } = useQuery({
    queryKey: ["approvepro_dashboard_summary"],
    queryFn: fetchSummary,
    // Tight polling so the pulse animation fires within ~15s of a customer
    // approving / declining / requesting a revision.
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const s = data || {
    proofDraft: 0, proofAwaiting: 0, proofRevising: 0,
    proofApprovedMonth: 0, proofDeclinedMonth: 0,
    proofUnassignedActive: 0, proofMineActive: 0,
    wpwInDesign: 0, wpwDesignComplete: 0, wpwInProduction: 0,
    wpwCompletedMonth: 0, wpwTotalOrders: 0,
    recent: [] as RecentProof[],
    recentActivity: [] as RecentProof[],
    teamLoad: [] as TeamLoadEntry[],
  };

  // Pulse the whole card when a customer has approved / declined / requested
  // a revision within the last hour. Drives the "blink when the customer
  // responds" notification on the home dashboard.
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const hasFreshActivity = s.recentActivity.some(
    (r) => new Date(r.updated_at).getTime() >= oneHourAgo
  ) || s.proofRevising > 0;

  return (
    <Card className={cn(
      "relative overflow-hidden border-gray-200 bg-white text-gray-900",
      hasFreshActivity && "ring-2 ring-pink-400/60 shadow-[0_0_24px_rgba(236,72,153,0.35)]"
    )}>
      {hasFreshActivity && (
        <span className="absolute top-2 right-2 z-10 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pink-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-pink-500" />
        </span>
      )}
      {/* Brand accent hairline — blue → magenta, the ApprovePro signature. */}
      <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shadow-sm shrink-0">
              <ClipboardSignature className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base leading-none">
                <span className="text-gray-900">Approve</span>
                <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
                <span className="text-gray-400 text-[10px] ml-0.5 align-top">&trade;</span>
              </h3>
              <p className="text-[11px] text-gray-500 mt-1">
                Design jobs awaiting approval
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-600 border-blue-200">
            Live
          </Badge>
        </div>

        {/* Quick job-number search — jump straight to the order in /orders. */}
        <form onSubmit={submitOrderSearch} className="relative">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
          <input
            value={orderQuery}
            onChange={(e) => setOrderQuery(e.target.value)}
            placeholder="Search a job / order number…"
            inputMode="numeric"
            className="w-full pl-8 pr-3 h-9 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30"
          />
        </form>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            {/* Team-first stat grid — Mine + Unassigned lead so designers
                see "what's on me" and "what's free for the taking" at a
                glance, before the status breakdown. 2 cols on phones so
                the tiles don't crush; 3 cols from tablet up. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <StatCell icon={UserCheck} label="Mine" value={s.proofMineActive} tone="blue" />
              <StatCell icon={UserPlus} label="Unassigned" value={s.proofUnassignedActive} tone="orange" pulse={s.proofUnassignedActive > 0} />
              <StatCell icon={Clock} label="Awaiting client" value={s.proofAwaiting} tone="gray" />
              <StatCell icon={ClipboardSignature} label="Drafts" value={s.proofDraft} tone="gray" />
              <StatCell icon={RotateCw} label="Revising" value={s.proofRevising} tone="purple" pulse={s.proofRevising > 0} />
              <StatCell icon={CheckCircle2} label="Approved (mo)" value={s.proofApprovedMonth} tone="green" />
            </div>

            {/* Team workload — one chip per person showing how many active
                jobs they own. Hover a chip to see the order numbers + the
                date each was assigned. Click to open the queue. */}
            {s.teamLoad.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Team workload — who has what
                </p>
                <TooltipProvider delayDuration={120}>
                  <div className="flex flex-wrap gap-1.5">
                    {s.teamLoad.map((entry) => {
                      const member = entry.userId ? team.lookup(entry.userId) : null;
                      const isUnassigned = entry.userId === null;
                      const name = isUnassigned
                        ? "Unassigned"
                        : member?.displayName ?? "Teammate";
                      return (
                        <Tooltip key={entry.userId ?? "unassigned"}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => navigate("/approvepro")}
                              className={cn(
                                "flex items-center gap-1.5 rounded-full border px-2 py-1 transition-colors",
                                isUnassigned
                                  ? "border-orange-200 bg-orange-50 hover:bg-orange-100"
                                  : "border-gray-200 bg-gray-50 hover:bg-gray-100",
                              )}
                            >
                              {!isUnassigned && (
                                <AssigneeAvatar member={member} size="xs" className="shrink-0" />
                              )}
                              <span className={cn(
                                "text-[11px] font-semibold",
                                isUnassigned ? "text-orange-700" : "text-gray-900",
                              )}>
                                {name}
                              </span>
                              <span className={cn(
                                "text-[10px] font-bold tabular-nums rounded-full px-1.5 min-w-[18px] text-center",
                                isUnassigned
                                  ? "bg-orange-500 text-white"
                                  : "bg-blue-600 text-white",
                              )}>
                                {entry.count}
                              </span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[280px] bg-white text-gray-900 border-gray-200">
                            <p className="text-[11px] font-semibold mb-1">
                              {name} · {entry.count} active job{entry.count === 1 ? "" : "s"}
                            </p>
                            <div className="space-y-0.5">
                              {entry.jobs.map((j) => (
                                <div key={j.id} className="flex items-center gap-2 text-[11px]">
                                  <span className="font-mono font-semibold text-purple-700 shrink-0">
                                    #{j.orderNum ?? "—"}
                                  </span>
                                  <span className="truncate flex-1 text-gray-700">
                                    {j.designName || "Untitled"}
                                  </span>
                                  {shortDate(j.assignedAt) && (
                                    <span className="text-[10px] text-gray-500 shrink-0">
                                      {shortDate(j.assignedAt)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </TooltipProvider>
              </div>
            )}

            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Recent design jobs
              </p>
              {s.recent.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/60 p-3 text-center">
                  <p className="text-xs text-gray-500">
                    No active jobs. Open ApprovePro to send a proof or sync WPW orders.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {s.recent.map((r) => {
                    const cfg = STATUS_BADGE[r.status] || STATUS_BADGE.draft;
                    const Icon = cfg.icon;
                    const orderNum = r.metadata?.wpw_order_number || r.metadata?.wpw_woo_order_id;
                    const vehicle = [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ");
                    const assignee = team.lookup(r.assigned_to);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => navigate(`/approvepro?id=${r.id}`)}
                        className="w-full text-left rounded-md border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors p-2"
                      >
                        <div className="flex items-center gap-2">
                          <AssigneeAvatar member={assignee} size="xs" className="shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-[12px] font-semibold truncate">
                                {r.design_name || "Untitled"}
                              </p>
                              {orderNum && (
                                <span className="text-[9px] text-gray-500 font-mono shrink-0">
                                  #{orderNum}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-gray-500 truncate">
                              {r.customer_name || r.customer_email}
                              {vehicle && ` · ${vehicle}`}
                            </p>
                            <p className="text-[10px] truncate">
                              {assignee ? (
                                <span className="text-blue-700 font-medium">{assignee.displayName}</span>
                              ) : (
                                <span className="text-orange-600 font-medium">Unassigned</span>
                              )}
                              {assignee && shortDate(r.assigned_at) && (
                                <span className="text-gray-500"> · assigned {shortDate(r.assigned_at)}</span>
                              )}
                            </p>
                          </div>
                          <Badge variant="outline" className={cn("text-[9px] h-4 px-1 shrink-0", cfg.color)}>
                            <Icon className="w-2.5 h-2.5 mr-0.5" />
                            {cfg.label}
                          </Badge>
                          <span className="text-[10px] text-gray-500 shrink-0 tabular-nums">
                            {relativeTime(r.updated_at)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {s.recentActivity.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  Recent customer activity
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-pink-500 animate-ping" />
                </p>
                <div className="space-y-1.5">
                  {s.recentActivity.map((r) => {
                    const cfg = STATUS_BADGE[r.status] || STATUS_BADGE.draft;
                    const Icon = cfg.icon;
                    const orderNum = r.metadata?.wpw_order_number || r.metadata?.wpw_woo_order_id;
                    const vehicle = [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ");
                    const isFresh = new Date(r.updated_at).getTime() >= oneHourAgo;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => navigate(`/approvepro?id=${r.id}`)}
                        className={cn(
                          "w-full text-left rounded-md border bg-gray-50 hover:bg-gray-100 transition-colors p-2",
                          isFresh
                            ? "border-pink-400/70 ring-1 ring-pink-400/40 shadow-[0_0_12px_rgba(236,72,153,0.25)]"
                            : "border-gray-200"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-[12px] font-semibold truncate">
                                {r.design_name || "Untitled"}
                              </p>
                              {orderNum && (
                                <span className="text-[9px] text-gray-500 font-mono shrink-0">
                                  #{orderNum}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-gray-500 truncate">
                              {r.customer_name || r.customer_email}
                              {vehicle && ` · ${vehicle}`}
                            </p>
                          </div>
                          <Badge variant="outline" className={cn("text-[9px] h-4 px-1 shrink-0", cfg.color)}>
                            <Icon className="w-2.5 h-2.5 mr-0.5" />
                            {cfg.label}
                          </Badge>
                          <span className="text-[10px] text-gray-500 shrink-0 tabular-nums">
                            {relativeTime(r.updated_at)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {s.wpwTotalOrders > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  WePrintWraps orders ({s.wpwTotalOrders} total)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <StatCell icon={Package} label="In design" value={s.wpwInDesign} tone="blue" />
                  <StatCell icon={CheckCircle2} label="Design done" value={s.wpwDesignComplete} tone="green" />
                  <StatCell icon={Printer} label="In production" value={s.wpwInProduction} tone="purple" />
                  <StatCell icon={CheckCircle2} label="Completed (mo)" value={s.wpwCompletedMonth} tone="green" />
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex items-center gap-3 text-xs text-gray-500 pt-1">
          <Link to="/approvepro" className="flex items-center gap-1 hover:text-blue-600 transition-colors">
            Open ApprovePro <ArrowRight className="w-3 h-3" />
          </Link>
          <span className="text-gray-300">|</span>
          <Link to="/orders" className="flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-700 transition-colors">
            View &amp; search all orders <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </Card>
  );
};

interface StatCellProps {
  icon: typeof Clock;
  label: string;
  value: number;
  tone: "blue" | "purple" | "green" | "red" | "gray" | "orange";
  pulse?: boolean;
}

const TONE: Record<StatCellProps["tone"], string> = {
  blue: "text-blue-600",
  purple: "text-purple-600",
  green: "text-green-600",
  red: "text-red-600",
  gray: "text-gray-600",
  orange: "text-orange-600",
};

const StatCell = ({ icon: Icon, label, value, tone, pulse }: StatCellProps) => {
  const pulseColor = tone === "orange" ? "bg-orange-400" : "bg-purple-400";
  const pulseColorSolid = tone === "orange" ? "bg-orange-500" : "bg-purple-500";
  const pulseBorder = tone === "orange" ? "border-orange-400/70 ring-1 ring-orange-400/40" : "border-purple-400/70 ring-1 ring-purple-400/40";
  return (
  <div className={cn(
    "rounded-md bg-gray-50 backdrop-blur border p-3 relative",
    pulse ? pulseBorder : "border-gray-200"
  )}>
    {pulse && (
      <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", pulseColor)} />
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", pulseColorSolid)} />
      </span>
    )}
    <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
      <Icon className={`w-3 h-3 ${TONE[tone]}`} />
      {label}
    </div>
    <div className={`text-2xl font-bold mt-1 tabular-nums ${TONE[tone]}`}>
      {value}
    </div>
  </div>
  );
};
