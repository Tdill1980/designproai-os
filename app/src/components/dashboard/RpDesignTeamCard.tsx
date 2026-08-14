/**
 * RpDesignTeamCard — Internal ops queue for the DesignProAI design
 * team (Trish, Carley, anyone with the `admin` or `designer` role).
 *
 * One compact dashboard card that gives the team an at-a-glance view
 * of three live queues. Toggle between them with the tabs at the top:
 *
 *   1. Revisions  — proofs with status 'pending' / 'revision_requested'
 *                   that need a designer's eyes. Pulled from the
 *                   `proofs` table (ApprovePro + DesignPanelPro share
 *                   this table via tool_name).
 *
 *   2. CM Orders  — paid CreatorMarket purchases waiting to be
 *                   delivered. Pulled from `marketplace_listings`
 *                   where status moved past 'listed' (sold / paid).
 *                   Highlights "Customize Name & Buy" jobs with a
 *                   pencil pill so the team knows to do the name
 *                   swap before fulfilling.
 *
 *   3. Pack Queue — production_packs currently being produced
 *                   (payment_status = 'pending' = in-flight). Each
 *                   row shows the elapsed time since purchase, an
 *                   SLA-based "time left" countdown (Studio = 48h,
 *                   Plus = 24h), and the wrapbox_status so we can
 *                   see at a glance which packs have already been
 *                   pushed to the customer's WrapBox.
 *
 * Mounted on the dashboard ABOVE the pillar row but gated on admin /
 * designer role so customers never see it.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  PencilLine,
  ShoppingBag,
  Package,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Tab = "revisions" | "cm_orders" | "pack_queue";

const TABS: { key: Tab; label: string; icon: typeof PencilLine }[] = [
  { key: "revisions", label: "Revisions", icon: PencilLine },
  { key: "cm_orders", label: "CM Orders", icon: ShoppingBag },
  { key: "pack_queue", label: "Pack Queue", icon: Package },
];

interface ProofRow {
  id: string;
  tool_name: string | null;
  customer_name: string | null;
  customer_notes: string | null;
  status: string | null;
  created_at: string;
  film_or_design_name: string | null;
}

interface CmOrderRow {
  id: string;
  title: string | null;
  thumbnail_url: string | null;
  price: number | null;
  design_style: string | null;
  buyer_user_id: string | null;
  sold_at: string | null;
  status: string | null;
  purchase_mode: string | null;
  trade_category: string | null;
}

interface PackRow {
  id: string;
  design_name: string | null;
  thumbnail_url: string | null;
  payment_status: string | null;
  wrapbox_status: string | null;
  wrapbox_pushed_at: string | null;
  created_at: string;
  vehicle_info: { year?: string; make?: string; model?: string } | null;
}

const PACK_SLA_HOURS = 48; // Default Studio SLA. Plus is 24h but we
                           // don't currently flag Plus-vs-Studio on
                           // the production_packs row.

function relativeTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function timeLeft(createdAt: string | null | undefined, slaHours: number) {
  if (!createdAt) return { label: "—", late: false, warn: false };
  const due = Date.parse(createdAt) + slaHours * 3600_000;
  const ms = due - Date.now();
  if (ms < 0) {
    const h = Math.round(-ms / 3600_000);
    return { label: `${h}h late`, late: true, warn: false };
  }
  const h = Math.round(ms / 3600_000);
  return {
    label: h < 1 ? "<1h left" : `${h}h left`,
    late: false,
    warn: h < 8,
  };
}

interface Props {
  className?: string;
}

export function RpDesignTeamCard({ className }: Props) {
  const [tab, setTab] = useState<Tab>("revisions");

  // Revisions — backfilled to ALL proofs from the last 7 days so the
  // team sees the full ApprovePro activity stream (Trish: "backfill
  // with current ApprovePro notifications to design team for last
  // week"), not just open revision requests. Status badge on each
  // row distinguishes pending / approved / revising / declined etc.
  const { data: proofs = [] } = useQuery({
    queryKey: ["rp-team-proofs"],
    queryFn: async () => {
      const db = supabase as never as { from: (t: string) => any };
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const { data, error } = await db
        .from("proofs")
        .select("id, tool_name, customer_name, customer_notes, status, created_at, film_or_design_name")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return [] as ProofRow[];
      return (data ?? []) as ProofRow[];
    },
    refetchInterval: 30_000,
  });

  // CreatorMarket orders — anything not in the default 'listed' state
  // and with a buyer attached. Captures both 'sold' and any future
  // intermediate state ('in_production', 'shipped', etc.).
  const { data: cmOrders = [] } = useQuery({
    queryKey: ["rp-team-cm-orders"],
    queryFn: async () => {
      const db = supabase as never as { from: (t: string) => any };
      const { data, error } = await db
        .from("marketplace_listings")
        .select("id, title, thumbnail_url, price, design_style, buyer_user_id, sold_at, status, purchase_mode, trade_category")
        .not("buyer_user_id", "is", null)
        .order("sold_at", { ascending: false, nullsFirst: false })
        .limit(8);
      if (error) return [] as CmOrderRow[];
      return (data ?? []) as CmOrderRow[];
    },
    refetchInterval: 30_000,
  });

  // Pack queue — paid + in-flight production packs. 'pending' is the
  // state immediately after Stripe webhook credits the user; 'included'
  // covers packs bundled with Studio/Plus subscription.
  const { data: packs = [] } = useQuery({
    queryKey: ["rp-team-packs"],
    queryFn: async () => {
      const db = supabase as never as { from: (t: string) => any };
      const { data, error } = await db
        .from("production_packs")
        .select("id, design_name, thumbnail_url, payment_status, wrapbox_status, wrapbox_pushed_at, created_at, vehicle_info")
        .in("payment_status", ["pending", "included", "paid"])
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) return [] as PackRow[];
      return (data ?? []) as PackRow[];
    },
    refetchInterval: 30_000,
  });

  const counts = useMemo(
    () => ({
      revisions: proofs.length,
      cm_orders: cmOrders.length,
      pack_queue: packs.length,
    }),
    [proofs, cmOrders, packs],
  );

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-fuchsia-500/30 bg-rp-surface p-4 sm:p-5",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-fuchsia-500/30 to-cyan-500/30 border border-fuchsia-400/30 flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-fuchsia-200" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-fuchsia-300">
              RP Design Team
            </div>
            <div className="text-[11px] text-white/55">
              Internal — Trish · Carley · admin only
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-3 rounded-lg bg-black/30 border border-white/5 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const n = counts[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold transition",
                tab === t.key
                  ? "bg-white/10 text-white"
                  : "text-white/55 hover:text-white/85",
              )}
            >
              <Icon className="w-3 h-3" />
              <span>{t.label}</span>
              {n > 0 && (
                <span className="text-[9px] font-bold px-1 rounded-sm bg-fuchsia-500/30 border border-fuchsia-400/40 text-fuchsia-100">
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
        {tab === "revisions" && (proofs.length === 0 ? (
          <EmptyState label="No ApprovePro proofs in the last 7 days." />
        ) : proofs.map((p) => {
          const statusBadge = renderStatusBadge(p.status);
          return (
            <RowShell
              key={p.id}
              thumb={null}
              title={p.customer_name || "(unnamed)"}
              subtitle={`${p.tool_name || "Proof"} · ${p.film_or_design_name || ""}`.trim()}
              note={p.customer_notes?.slice(0, 80)}
              badge={statusBadge}
              pillRight={relativeTime(p.created_at)}
              href={`/admin/proof-detail/${p.id}`}
            />
          );
        }))}

        {tab === "cm_orders" && (cmOrders.length === 0 ? (
          <EmptyState label="No CreatorMarket orders waiting." />
        ) : cmOrders.map((o) => {
          // Bundled wrap-ship orders need a louder flag so the team
          // knows to fulfill BOTH design + printed wrap (and follow
          // up on the wrap-quote invoice).
          const isBundle = o.purchase_mode === "design_plus_wrap";
          const badge = isBundle
            ? { label: "+ Wrap Ship", tone: "emerald" as const }
            : o.design_style === "branded"
              ? { label: "Name swap", tone: "amber" as const }
              : undefined;
          const tradeNote = o.trade_category
            ? ` · ${o.trade_category.replace(/_/g, " ")}`
            : "";
          return (
            <RowShell
              key={o.id}
              thumb={o.thumbnail_url}
              title={o.title || "(untitled listing)"}
              subtitle={`$${o.price ?? "?"} · ${o.status || "listed"}${tradeNote}`}
              badge={badge}
              pillRight={relativeTime(o.sold_at || null)}
              href={`/admin/creatormarket-manager`}
            />
          );
        }))}

        {tab === "pack_queue" && (packs.length === 0 ? (
          <EmptyState label="No production packs in flight." />
        ) : packs.map((pk) => {
          const sla = timeLeft(pk.created_at, PACK_SLA_HOURS);
          const inWrapBox = !!pk.wrapbox_pushed_at;
          const vehicle = [
            pk.vehicle_info?.year,
            pk.vehicle_info?.make,
            pk.vehicle_info?.model,
          ].filter(Boolean).join(" ") || "—";
          return (
            <RowShell
              key={pk.id}
              thumb={pk.thumbnail_url}
              title={pk.design_name || vehicle}
              subtitle={`${vehicle} · ${pk.payment_status}`}
              badge={
                inWrapBox
                  ? { label: "In WrapBox", tone: "emerald" }
                  : { label: pk.wrapbox_status || "Queued", tone: "blue" }
              }
              pillRight={sla.label}
              pillTone={sla.late ? "rose" : sla.warn ? "amber" : "white"}
              href={`/admin/production`}
            />
          );
        }))}
      </div>
    </div>
  );
}

// Status → badge mapping for the ApprovePro Revisions tab. Keeps the
// expanded 7-day proof list scannable.
function renderStatusBadge(status: string | null): RowProps["badge"] {
  if (!status) return undefined;
  const s = status.toLowerCase();
  if (s.includes("approved") || s === "signed") {
    return { label: "Approved", tone: "emerald" };
  }
  if (s.includes("revis") || s.includes("changes") || s === "needs_revision") {
    return { label: "Revising", tone: "amber" };
  }
  if (s === "declined" || s === "rejected") {
    return { label: "Declined", tone: "rose" };
  }
  if (s === "pending" || s === "sent") {
    return { label: "Pending", tone: "blue" };
  }
  return { label: status, tone: "blue" };
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-4 rounded-lg bg-white/[0.02] border border-white/5 text-[12px] text-white/45">
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300/60 shrink-0" />
      {label}
    </div>
  );
}

interface RowProps {
  thumb: string | null | undefined;
  title: string;
  subtitle: string;
  note?: string;
  badge?: { label: string; tone: "amber" | "emerald" | "blue" | "rose" };
  pillRight: string;
  pillTone?: "white" | "amber" | "rose";
  href: string;
}

function RowShell({
  thumb,
  title,
  subtitle,
  note,
  badge,
  pillRight,
  pillTone = "white",
  href,
}: RowProps) {
  const toneStyles =
    pillTone === "rose"
      ? "bg-rose-500/15 border-rose-400/40 text-rose-200"
      : pillTone === "amber"
      ? "bg-amber-500/15 border-amber-400/40 text-amber-200"
      : "bg-white/5 border-white/10 text-white/70";

  const badgeStyles = badge
    ? badge.tone === "amber"
      ? "bg-amber-500/20 border-amber-400/40 text-amber-200"
      : badge.tone === "emerald"
      ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-200"
      : badge.tone === "rose"
      ? "bg-rose-500/20 border-rose-400/40 text-rose-200"
      : "bg-blue-500/20 border-blue-400/40 text-blue-200"
    : "";

  return (
    <Link
      to={href}
      className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.04] transition-colors"
    >
      <div className="shrink-0 w-9 h-9 rounded-md overflow-hidden bg-black/40 border border-white/10">
        {thumb ? (
          <img src={thumb} alt={title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Clock className="w-3.5 h-3.5 text-white/30" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-white truncate flex items-center gap-1.5">
          {title}
          {badge && (
            <span className={cn("text-[9px] font-bold px-1 py-px rounded border", badgeStyles)}>
              {badge.label}
            </span>
          )}
        </div>
        <div className="text-[10px] text-white/45 truncate">
          {subtitle}
        </div>
        {note && (
          <div className="text-[10px] text-white/40 truncate italic mt-0.5">
            “{note}”
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1">
        <span
          className={cn(
            "text-[10px] font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap",
            toneStyles,
          )}
        >
          {pillRight}
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-white/30 group-hover:text-white/55" />
      </div>
    </Link>
  );
}
