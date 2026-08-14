/**
 * ProvenanceFilter — "I dont see jacksons cards add a sort by team member,
 * tonights 12????" (owner, 2026-08-07).
 *
 * Every one of those three questions was answerable from data the board already
 * loaded and never showed. A render carries `blueprint.source`; a post carries
 * `created_by`; a shot-list item names the person responsible and points at the
 * render it produced. The board rendered none of it, so "Jackson's cards" and
 * "tonight's batch" and "the music videos" were things you found by scrolling
 * and recognising thumbnails.
 *
 * One click each now:
 *
 *     Shot list (3)          ← Jackson's, and the chip says his name
 *     Idea approve (15)      ← tonight's batch
 *     Capcut energyflow (40) ← the music videos
 *
 * ── THE OPTIONS ARE THE DATA ────────────────────────────────────────────────
 * Chips are counted off the cards in front of the operator (see
 * `provenanceOptions` / `personOptions`), never declared in this file. A new
 * pipeline gets a chip the first time it makes something — nobody has to
 * remember to add it, and no chip can quietly stop matching. The raw stored key
 * rides on the tooltip so what is being matched is always checkable.
 *
 * Same colour formula as every other control on this board — tinted when idle,
 * SOLID with white text when it is the view you are in (ColorPill,
 * AttentionRibbon, SET_STATE_META). No new palette. Light theme, like the rest
 * of the admin surface.
 */

import { cn } from "@/lib/utils";
import { Users, Wrench, Clapperboard } from "lucide-react";
import {
  provenanceLine,
  showLine,
  type PersonOption,
  type ProvenanceOption,
  type ShowOption,
} from "./boardProvenance";

function Chip({ label, count, color, active, title, onClick }: {
  label: string; count: number; color: string; active: boolean;
  title?: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-all",
        "hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
      )}
      style={active
        ? { backgroundColor: color, borderColor: color, color: "#fff" }
        : { backgroundColor: `${color}1a`, borderColor: `${color}4d`, color }}
    >
      <span className="truncate max-w-[12rem]">{label}</span>
      <span className="tabular-nums opacity-80">{count.toLocaleString()}</span>
    </button>
  );
}

export interface ProvenanceFilterProps {
  options: ProvenanceOption[];
  people: PersonOption[];
  /** Selected `blueprint.source` / `created_by`, or null for all. */
  maker: string | null;
  onMaker: (key: string | null) => void;
  /** Selected team key, or null for all. */
  person: string | null;
  onPerson: (key: string | null) => void;
  /** Shows counted off these cards. Empty row is hidden, not faked. */
  shows?: ShowOption[];
  /** Cards recording no show — printed, never a chip. */
  unshown?: number;
  /** Selected `blueprint.show_format`, or null for all. */
  show?: string | null;
  onShow?: (key: string | null) => void;
}

export default function ProvenanceFilter({
  options, people, maker, onMaker, person, onPerson,
  shows = [], unshown = 0, show = null, onShow,
}: ProvenanceFilterProps) {
  // Nothing recorded on any card here. Say so rather than painting an empty
  // row: a filter bar with no chips reads as a broken query, and this board has
  // been mistaken for broken often enough.
  if (!options.length && !people.length && !shows.length) {
    return (
      <p className="mb-3 text-[11px] text-slate-500">{provenanceLine(options, people)}</p>
    );
  }

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
      {/* WHICH SHOW. First, because it is the question that was asked out loud
          — "add a button tag for BTI and I can click and review". A show is a
          body of work; who made it and on what pipeline are details under it. */}
      {shows.length > 0 && onShow && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Clapperboard className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="mr-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
            Show
          </span>
          <Chip
            label="Every show"
            count={shows.reduce((n, x) => n + x.count, 0) + unshown}
            color="#0f172a"
            active={show === null}
            title="Every piece, tagged with a show or not"
            onClick={() => onShow(null)}
          />
          {shows.map((x) => (
            <Chip
              key={x.key}
              label={x.label}
              count={x.count}
              color="#0891B2"
              active={show === x.key}
              title={`Cuts whose blueprint records show_format “${x.key}”`}
              onClick={() => onShow(show === x.key ? null : x.key)}
            />
          ))}
          <span className="ml-1 text-[10px] text-slate-500">{showLine(shows, unshown)}</span>
        </div>
      )}

      {people.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="mr-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
            Person
          </span>
          <Chip
            label="Anyone"
            count={people.reduce((n, p) => n + p.count, 0)}
            color="#0f172a"
            active={person === null}
            title="Every piece, whoever is behind it"
            onClick={() => onPerson(null)}
          />
          {people.map((p) => (
            <Chip
              key={p.key}
              label={p.label}
              count={p.count}
              color={p.color}
              active={person === p.key}
              title={`Pieces whose row names ${p.label} — a shot list's responsible person, a task's assignee, or a created_by on the roster`}
              onClick={() => onPerson(person === p.key ? null : p.key)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Wrench className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="mr-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
          Made by
        </span>
        <Chip
          label="Everything"
          count={options.reduce((n, o) => n + o.count, 0)}
          color="#0f172a"
          active={maker === null}
          title="Every pipeline"
          onClick={() => onMaker(null)}
        />
        {options.map((o) => (
          <Chip
            key={o.key}
            label={o.label}
            count={o.count}
            color="#4F46E5"
            active={maker === o.key}
            title={`Stored as “${o.key}” — blueprint.source on a render, created_by on a post`}
            onClick={() => onMaker(maker === o.key ? null : o.key)}
          />
        ))}
      </div>

      <p className="mt-2 text-[10px] text-slate-500">{provenanceLine(options, people)}</p>
    </div>
  );
}
