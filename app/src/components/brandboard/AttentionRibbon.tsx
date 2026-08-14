/**
 * AttentionRibbon — the first thing on the Brand Board, and the answer to the
 * only two questions anyone opens it with.
 *
 *     WHAT NEEDS ME          ← left of the divider, a human is the next mover
 *     WHAT IS HAPPENING      ← right of the divider, a machine or a clock is
 *     WITHOUT ME
 *
 * The board already had every one of these numbers; none of them was legible.
 * "Needs you" did not exist as a concept — drafts, scheduled posts, queued
 * renders and finished cuts shared one grid of identical tiles. "Building" was a
 * collapsed pill sitting in the middle of the brand chips. "Stuck" existed
 * nowhere at all, which is how twelve failed renders and thirteen refused cuts
 * stayed invisible (see boardAttention.ts for the measurements).
 *
 * ── WHY A DIVIDER AND NOT SIX MORE CHIPS ────────────────────────────────────
 * The two questions have different answers and demand different behaviour. The
 * left half is a WORKLIST — the operator is meant to click it, drain it, and
 * watch it reach zero. The right half is a STATUS — clicking it is a detour and
 * a zero there is not an achievement. Rendering all five as one row of pills
 * (which is what this board did with every other control) makes them look like
 * five equivalent filters and buries the distinction that matters most.
 *
 * ── THE COUNTS RECONCILE, ON PURPOSE ────────────────────────────────────────
 * `laneOf` puts every card in exactly one lane, so these five numbers sum to the
 * board's card count. A header whose numbers do not add up is how this board
 * earned its reputation for hiding work, and an operator who has to wonder
 * whether a piece fell between two lanes is back to scrolling the grid.
 *
 * Colour formula is the board's existing one — tinted fill + tinted border +
 * colour as text when idle, SOLID with white text when selected (see ColorPill,
 * SET_STATE_META). No new palette.
 */

import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowRight, Clock, Loader2, Send, UserCheck, Zap } from "lucide-react";
import {
  BOARD_LANES, DIRECTOR_LANES, LANE_BY_KEY, type Lane, type LaneCounts,
  attentionLine, handoffLine,
} from "./boardAttention";

const LANE_ICON: Record<Lane, React.ComponentType<{ className?: string }>> = {
  needs_you: UserCheck,
  stuck: AlertTriangle,
  building: Loader2,
  scheduled: Clock,
  shipped: Send,
};

function LaneTile({ lane, count, active, onClick }: {
  lane: (typeof BOARD_LANES)[number]; count: number; active: boolean; onClick: () => void;
}) {
  const Icon = LANE_ICON[lane.key];
  const zero = count === 0;
  // A zero lane stays visible but recedes: "nothing stuck" is information worth
  // showing, and hiding the tile would make its reappearance easy to miss.
  const style = active
    ? { backgroundColor: lane.color, borderColor: lane.color, color: "#fff" }
    : {
        backgroundColor: `${lane.color}${zero ? "0d" : "1a"}`,
        borderColor: `${lane.color}${zero ? "1f" : "4d"}`,
        color: lane.color,
      };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`${lane.label} — ${lane.blurb}${active ? " (showing; click to clear)" : " (click to show only these)"}`}
      className={cn(
        "flex-1 rounded-xl border p-3 text-left transition-all min-w-[9.5rem]",
        "hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
        zero && !active && "opacity-60",
      )}
      style={style}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", lane.key === "building" && count > 0 && "animate-spin")} />
        <span className="text-[11px] font-bold uppercase tracking-wide">{lane.label}</span>
      </div>
      <div className="mt-1 text-2xl font-extrabold leading-none tabular-nums">
        {count.toLocaleString()}
      </div>
      <p className={cn("mt-1 text-[10px] leading-tight", active ? "text-white/85" : "opacity-75")}>
        {lane.blurb}
      </p>
    </button>
  );
}

export interface AttentionRibbonProps {
  counts: LaneCounts;
  /** The lane currently filtering the board, or null for everything. */
  active: Lane | null;
  onSelect: (lane: Lane | null) => void;
  /** The publishing sentence, already resolved. null = nothing to say. */
  publishNote?: string | null;
  /** Whether the publish note is a hard block (red) or a caveat (amber). */
  publishBlocked?: boolean;
}

export default function AttentionRibbon({
  counts, active, onSelect, publishNote, publishBlocked,
}: AttentionRibbonProps) {
  // BOARD lanes only. Stuck and Waiting are Content Director's work, and a tile
  // here is an invitation to work them here — which is exactly how this gallery
  // grew a backlog. They appear below as a handoff, with the counts intact.
  const yours = BOARD_LANES.filter((l) => l.group === "yours");
  const running = BOARD_LANES.filter((l) => l.group === "running");
  const toggle = (k: Lane) => onSelect(active === k ? null : k);
  const handoff = handoffLine(counts);

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Zap className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-bold text-slate-900">{attentionLine(counts)}</span>
        {active && (
          <button
            onClick={() => onSelect(null)}
            className="ml-auto rounded-full border border-slate-300 px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:border-slate-500 hover:text-slate-900"
          >
            Showing {LANE_BY_KEY[active]?.label} only — clear
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
        {/* YOURS — a worklist. Meant to be clicked and drained. */}
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="h-3 w-1 rounded-full bg-amber-500" />
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              Needs you
            </span>
            {/* The board's own backlog, which no longer includes Stuck — that
                number belongs to the page that can act on it. Counting it here
                would put a queue you cannot drain from this screen into the
                one figure the ribbon exists to make trustworthy. */}
            <Badge variant="secondary" className="h-4 px-1.5 text-[9px] tabular-nums">
              {counts.needs_you.toLocaleString()}
            </Badge>
          </div>
          <div className="flex gap-2">
            {yours.map((l) => (
              <LaneTile key={l.key} lane={l} count={counts[l.key]} active={active === l.key} onClick={() => toggle(l.key)} />
            ))}
          </div>
        </div>

        {/* The divider IS the idea. Two questions, two answers. */}
        <div className="hidden w-px shrink-0 bg-slate-200 lg:block" />

        {/* RUNNING — a status. A zero here is not an achievement. */}
        <div className="min-w-0 flex-[1.4]">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="h-3 w-1 rounded-full bg-indigo-500" />
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              Happening without you
            </span>
          </div>
          <div className="flex gap-2">
            {running.map((l) => (
              <LaneTile key={l.key} lane={l} count={counts[l.key]} active={active === l.key} onClick={() => toggle(l.key)} />
            ))}
          </div>
        </div>
      </div>

      {/* THE HANDOFF — what this board is NOT showing, and where it is worked.
          Owner, 2026-08-10: "the board shows the 88 real cuts, full stop, and
          everything refused or pending goes to Content Director." Stated rather
          than silently dropped: work that vanishes from a view without a
          sentence is the disappearing act this board keeps being accused of.
          A LINK, not a tile — you go there to act; the counts stay here so the
          board still tells you the size of the pile. */}
      {handoff && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="text-[11px] font-semibold text-slate-700">{handoff}</span>
          <Link
            to="/admin/content-director"
            className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[10px] font-bold text-white hover:bg-slate-700"
          >
            Open Content Director
          </Link>
          {/* A failed render has no home in the Director's queue — it is not an
              idea and it is not a post awaiting approval. Twelve dead renders
              visible on no page at all is the hole the Stuck lane was built to
              close, so looking at them from here stays possible. Looking, not
              working: no Assist, no reasons list, nothing to drain. */}
          {DIRECTOR_LANES.map((l) => (counts[l.key] ? (
            <button
              key={l.key}
              onClick={() => onSelect(active === l.key ? null : l.key)}
              aria-pressed={active === l.key}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-bold transition",
                active === l.key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-500 hover:border-slate-500 hover:text-slate-900",
              )}
              title={`${l.label} — ${l.blurb}`}
            >
              {active === l.key ? `Hide ${l.label.toLowerCase()}` : `Look at ${l.label.toLowerCase()}`}
            </button>
          ) : null))}
        </div>
      )}

      {/* PUBLISHING REALITY. Sits under the lanes because it qualifies all of
          them: "Scheduled 48" is a lie of omission if nothing can ship. Zero of
          358 posts have ever published and there is no social connection at all
          — measured, not assumed. See publishReality(). */}
      {publishNote && (
        <div
          className={cn(
            "mt-3 flex items-start gap-2 rounded-lg border p-2.5",
            publishBlocked
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-amber-200 bg-amber-50 text-amber-900",
          )}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p className="text-[11px] font-semibold leading-snug">{publishNote}</p>
        </div>
      )}
    </div>
  );
}
