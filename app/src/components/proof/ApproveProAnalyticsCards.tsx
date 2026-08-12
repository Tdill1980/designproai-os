/**
 * ApproveProAnalyticsCards — the gamified analytics row at the TOP of ApprovePro.
 * Computed live from the loaded order rows (the last ~90 days of WPW design
 * orders), so nothing is stale and the numbers are REAL:
 *   • Approved — order placed vs awaiting pay (nested, magenta)
 *   • Paid $ converted — real wpw_orders revenue with rolling-window tags
 *   • Design orders in (pipeline) · Missing info (needs invite)
 *   • A.C.E designs sent · A.C.E vs Designer
 *   • Customers + repeat (nested)
 * Plus the "Gold Star" celebration when an approval + paid order just landed.
 *
 * Colors are category-coded: magenta = approvals, emerald = money, blue =
 * A.C.E/design, amber = pipeline/needs-action, violet = customers.
 */

import { useMemo, useState } from "react";
import { Sparkles, DollarSign, Trophy, Users, Clock, Star, Bot, Wand2, BarChart3, ChevronDown, CheckCircle2, Inbox, MailQuestion } from "lucide-react";
import { classifyIntake } from "@/lib/approvepro-brief";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  status: string;
  customer_email: string;
  customer_name?: string | null;
  design_name?: string | null;
  sent_at?: string | null;
  signed_at?: string | null;
  created_at?: string | null;
  assigned_to?: string | null;
  metadata?: Record<string, any> | null;
}

export interface Revenue { total: number; windows: { d: number; sum: number; orders: number }[] }

interface Props {
  rows: Row[] | null | undefined;
  /** Real design-order revenue (from wpw_orders) for the Paid/Converted card. */
  revenue?: Revenue | null;
  /** Resolve an order's paid total (from WPW metadata). */
  getOrderTotal: (r: Row) => number | null;
  /** Resolve an assignee id → display name. */
  resolveAssignee: (id: string | null | undefined) => string | null;
  /** Click a card to drill the order list to its matching orders. */
  onDrill?: (key: string, label: string) => void;
}

const APPROVED = "approved";
const TERMINAL = new Set(["approved", "declined", "revoked", "expired"]);

function aceLed(r: Row): boolean {
  return r.metadata?.autogen_status === "done" && !r.assigned_to;
}
// The order's true intake date (stamped by dedupeByOrder), else created/sent.
function orderDate(r: Row): number {
  const d = (r as any).__order_date || r.created_at || r.sent_at || null;
  const t = d ? new Date(d).getTime() : 0;
  return isNaN(t) ? 0 : t;
}

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function ApproveProAnalyticsCards({ rows, revenue, getOrderTotal, resolveAssignee, onDrill }: Props) {
  const m = useMemo(() => {
    const all = rows || [];
    const approved = all.filter((r) => r.status === APPROVED);
    const approvedReady = approved.filter((r) => r.metadata?.order_intent === "ready").length;
    const approvedLater = approved.length - approvedReady;

    const paidTotal = approved.reduce((sum, r) => sum + (getOrderTotal(r) || 0), 0);
    const aceWins = approved.filter(aceLed).length;
    const designerWins = approved.length - aceWins;

    // Pipeline: live (non-terminal) orders, and how many still need a brief.
    const live = all.filter((r) => !TERMINAL.has(r.status));
    const missingInfo = live.filter((r) => r.status === "draft" && !classifyIntake(r.metadata).hasBrief).length;

    // Customers + repeat (emails on >1 order).
    const byEmail = new Map<string, number>();
    for (const r of all) {
      const e = (r.customer_email || "").toLowerCase().trim();
      if (e) byEmail.set(e, (byEmail.get(e) || 0) + 1);
    }
    const customers = byEmail.size;
    const repeat = [...byEmail.values()].filter((n) => n > 1).length;

    // Avg time-to-approve (hours).
    const times: number[] = [];
    for (const r of approved) {
      if (r.sent_at && r.signed_at) {
        const h = (new Date(r.signed_at).getTime() - new Date(r.sent_at).getTime()) / 3_600_000;
        if (h >= 0 && h < 24 * 60) times.push(h);
      }
    }
    const avgHours = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;

    const celebrate = approved
      .filter((r) => (getOrderTotal(r) || 0) > 0 && r.signed_at)
      .sort((a, b) => new Date(b.signed_at!).getTime() - new Date(a.signed_at!).getTime())[0] || null;

    // A.C.E designs sent.
    const now = Date.now();
    const aceRows = all.filter((r) => r.metadata?.autogen_status === "done" && r.sent_at);
    const inLast = (iso: string | null | undefined, days: number) =>
      !!iso && (now - new Date(iso).getTime()) <= days * 86_400_000;
    const aceSent = {
      day: aceRows.filter((r) => inLast(r.sent_at, 1)).length,
      week: aceRows.filter((r) => inLast(r.sent_at, 7)).length,
      month: aceRows.filter((r) => inLast(r.sent_at, 30)).length,
    };

    return {
      total: all.length, live: live.length, missingInfo,
      approved: approved.length, approvedReady, approvedLater, paidTotal,
      aceWins, designerWins, customers, repeat, avgHours, celebrate, aceSent,
    };
  }, [rows, getOrderTotal]);

  const fmtTime = (h: number | null) => h == null ? "—" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;

  const celebHuman = m.celebrate ? resolveAssignee(m.celebrate.assigned_to) : null;
  const [open, setOpen] = useState(true);
  const rev90 = revenue?.windows.find((w) => w.d === 90)?.sum ?? revenue?.total ?? 0;

  return (
    <div className="space-y-2">
      {/* ApprovePro™ Live Stats — collapsible branded header */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 rounded-xl px-3 py-1.5 text-white shadow-sm hover:brightness-110 transition"
        style={{ background: G.magenta }}
      >
        <BarChart3 className="w-4 h-4 shrink-0" />
        <span className="text-[14px] font-extrabold leading-none">Approve<span>Pro</span>™</span>
        <span className="text-[12px] font-semibold text-white/85">Live Stats</span>
        <span className="text-[12px] text-white/90 truncate ml-1">· {m.total} orders · {fmtMoney(rev90)} (90d) · {m.missingInfo} missing info</span>
        <ChevronDown className={`w-4 h-4 ml-auto shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>

      {open && (
      <div className="space-y-2">
      {/* Gold-Star celebration */}
      {m.celebrate && (
        <div className="rounded-xl px-4 py-2.5 flex items-center gap-3 text-white shadow-sm" style={{ background: G.emerald }}>
          <Trophy className="w-6 h-6 shrink-0 drop-shadow" />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-extrabold leading-tight">
              ⭐ Gold star — good job {celebHuman ? `${celebHuman} & Ace` : "Ace"}!
            </div>
            <div className="text-[13px] text-white/90 truncate">
              {m.celebrate.customer_name || m.celebrate.customer_email} just approved {m.celebrate.design_name || "their design"} — {fmtMoney(getOrderTotal(m.celebrate) || 0)} order landed.
            </div>
          </div>
          <Star className="w-5 h-5 shrink-0 fill-white" />
        </div>
      )}

      {/* Cards — category-colored. Duplicate-ish metrics NEST (Approved,
          Customers). Paid/Converted shows REAL revenue with window tags. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        {/* Approved — magenta, bigger label, nested order-placed vs awaiting-pay */}
        <NestCard
          icon={CheckCircle2} gradient={G.magenta} label="Approved" bigLabel big={String(m.approved)}
          rows={[
            { k: "approved_ready", label: "order placed", v: m.approvedReady },
            { k: "approved_later", label: "awaiting pay", v: m.approvedLater },
          ]}
          onDrill={onDrill}
        />
        {/* Paid / converted — REAL revenue + rolling-window tags on the card */}
        <RevenueCard revenue={revenue} fallback={m.paidTotal} onDrill={onDrill} />
        <Card icon={Inbox} gradient={G.blue} label="Design orders" value={String(m.total)} sub={`${m.live} in progress`} />
        <Card icon={MailQuestion} gradient={G.amber} label="Missing info" value={String(m.missingInfo)} sub="need welcome + portal invite" drill={{ key: "missing_info", label: "Missing info — needs portal invite" }} onDrill={onDrill} />
        <Card icon={Wand2} gradient={G.blue} label="A.C.E designs sent" value={String(m.aceSent.month)} sub={`${m.aceSent.day} today · ${m.aceSent.week} this week`} drill={{ key: "ace_sent", label: "A.C.E designs sent" }} onDrill={onDrill} />
        {/* Customers — nested: distinct + repeat + avg approve */}
        <NestCard
          icon={Users} gradient={G.violet} label="Customers" big={String(m.customers)}
          rows={[
            { label: "repeat 2+", v: m.repeat },
            { label: "avg approve", v: fmtTime(m.avgHours) },
          ]}
          extra={`A.C.E ${m.aceWins} : ${m.designerWins} designer`}
        />
      </div>
      </div>
      )}
    </div>
  );
}

// Category gradients.
const G = {
  blue: "linear-gradient(135deg,#0066cc,#00a8e8)",
  magenta: "linear-gradient(135deg,#3b82f6,#ec4899)",
  emerald: "linear-gradient(135deg,#059669,#10b981)",
  amber: "linear-gradient(135deg,#d97706,#f59e0b)",
  violet: "linear-gradient(135deg,#7c3aed,#a855f7)",
  slate: "linear-gradient(135deg,#475569,#64748b)",
};

function Card({ icon: Icon, gradient, label, value, sub, drill, onDrill }: {
  icon: typeof Sparkles; gradient: string; label: string; value: string; sub: string;
  drill?: { key: string; label: string }; onDrill?: (key: string, label: string) => void;
}) {
  const clickable = !!(drill && onDrill);
  return (
    <button
      type="button"
      disabled={!clickable}
      title={sub}
      onClick={clickable ? () => onDrill!(drill!.key, drill!.label) : undefined}
      style={{ background: gradient }}
      className={`text-left rounded-xl px-3 py-2 shadow-sm text-white flex flex-col justify-between min-h-[68px] transition-all ${clickable ? "hover:brightness-110 hover:shadow-md cursor-pointer" : "cursor-default"}`}
    >
      <div className="flex items-center justify-between">
        <Icon className="w-4 h-4 text-white/90" />
        {clickable && <span className="text-white/70 text-[12px] leading-none">›</span>}
      </div>
      <div>
        <div className="text-xl font-extrabold text-white leading-none">{value}</div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-white/90 leading-tight mt-1">{label}</div>
        <div className="text-[11px] text-white/80 leading-tight truncate">{sub}</div>
      </div>
    </button>
  );
}

// Paid / converted — REAL wpw_orders revenue, with rolling-window tag buttons
// living on the card (the separate strip is gone). Tap a window to retitle it.
function RevenueCard({ revenue, fallback, onDrill }: {
  revenue?: Revenue | null; fallback: number; onDrill?: (key: string, label: string) => void;
}) {
  const [win, setWin] = useState(90);
  const windows = revenue?.windows || [];
  const cur = windows.find((w) => w.d === win);
  const value = cur ? cur.sum : (revenue?.total ?? fallback);
  const label = win === 1 ? "today" : `last ${win} days`;
  return (
    <div style={{ background: G.emerald }} className="rounded-xl px-3 py-2 shadow-sm text-white flex flex-col justify-between min-h-[68px]"
      title="Paid value of the design jobs in this queue — Design Setup/File Output fees, Hourly Design, and Custom Wrap Design orders.">
      <div className="flex items-center justify-between">
        <DollarSign className="w-4 h-4 text-white/90" />
        <span className="text-[10px] font-bold uppercase tracking-wide text-white/85">Design revenue</span>
      </div>
      <div>
        <div className="text-xl font-extrabold text-white leading-none">{fmtMoney(value)}</div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-white/90 leading-tight mt-0.5">paid · {label}</div>
        <div className="flex gap-1 mt-1.5">
          {[1, 7, 30, 90].map((d) => (
            <button key={d} type="button" onClick={() => setWin(d)}
              className={cn(
                "flex-1 rounded text-[10px] font-bold py-0.5 transition-colors",
                win === d ? "bg-white/30 text-white" : "bg-white/12 text-white/80 hover:bg-white/20",
              )}>
              {d === 1 ? "1d" : `${d}d`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Nested card: one headline number + up to two small drillable sub-stats.
function NestCard({ icon: Icon, gradient, label, bigLabel, big, rows, extra, onDrill }: {
  icon: typeof Sparkles; gradient: string; label: string; bigLabel?: boolean; big: string;
  rows: { k?: string; label: string; v: number | string }[];
  extra?: string;
  onDrill?: (key: string, label: string) => void;
}) {
  return (
    <div style={{ background: gradient }} className="rounded-xl px-3 py-2 shadow-sm text-white flex flex-col justify-between min-h-[68px]">
      <div className="flex items-center justify-between">
        <Icon className="w-4 h-4 text-white/90" />
        <span className={cn("font-extrabold uppercase tracking-wide text-white", bigLabel ? "text-[14px]" : "text-[11px] text-white/90")}>{label}</span>
      </div>
      <div>
        <div className="flex items-end justify-between gap-1.5">
          <div className="text-xl font-extrabold text-white leading-none">{big}</div>
          <div className="flex-1 grid grid-cols-2 gap-1">
            {rows.map((r, i) => {
              const clickable = !!(r.k && onDrill);
              const body = (
                <>
                  <div className="text-[14px] font-bold text-white leading-none">{r.v}</div>
                  <div className="text-[9px] uppercase tracking-wide text-white/80 leading-tight">{r.label}</div>
                </>
              );
              return clickable ? (
                <button key={i} type="button" onClick={() => onDrill!(r.k!, `${label} · ${r.label}`)} title={r.label}
                  className="text-right rounded bg-white/15 hover:bg-white/25 px-1 py-0.5 transition-colors">{body}</button>
              ) : (
                <div key={i} className="text-right rounded bg-white/10 px-1 py-0.5">{body}</div>
              );
            })}
          </div>
        </div>
        {extra && <div className="text-[10px] text-white/80 leading-tight mt-1 truncate">{extra}</div>}
      </div>
    </div>
  );
}
