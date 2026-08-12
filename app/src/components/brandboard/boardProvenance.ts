/**
 * boardProvenance — "Brand Board shows no real content. All AI slop."
 *
 * Owner, 2026-08-07, looking at the board. She is right, and the proportion is
 * not close. Measured against production the same day over the 140 renders that
 * actually COMPLETED:
 *
 *     49  frame grabs   blueprint.kind = 'static_post'  — one still yanked out
 *                       of a video with text drawn on it. Never an edit.
 *     42  one-clip stubs   blueprint.edit_kind = 'stub' — one clip, start to
 *                       end, because there was nothing to cut on.
 *     42  refusals      editor_brain_status ∈ mismatch | no_beats — the editor
 *                       brain declined to build a cut and the pipeline rendered
 *                       the stub anyway so a human could judge it.
 *     88  everything else
 *
 * Those three overlap heavily (39 rows are all three at once), so the union is
 * 52 of 140 renders — plus 46 `agent_social_posts` carrying a stub creative,
 * 45 of them with media, i.e. 45 more tiles. Roughly two thirds of the tiles an
 * operator scrolls past are the system REPORTING A FAILURE, painted as a
 * thumbnail that is pixel-for-pixel indistinguishable from finished work.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A machine failure is not finished work and must not sit in a lane that
 * implies it is usable. It goes to STUCK, which already exists and already
 * means "somebody has to deal with this".
 *
 * NOTHING IS DELETED AND NOTHING IS HIDDEN. Lanes are presentation; the rows
 * are still there, still reachable, still awaiting whatever decision they were
 * awaiting (`brandBoardDedupe` explains at length why deleting to fix a view is
 * the wrong instinct on this board). And the REFUSAL IS THE USEFUL PART: the
 * pipeline wrote a sentence saying which clip has no beats and what to run to
 * fix it. That sentence tells the crew what to reshoot, so it is printed
 * verbatim — surfacing it is the point, hiding it would throw away the only
 * thing these 97 tiles are good for.
 *
 * ── PROVENANCE ──────────────────────────────────────────────────────────────
 * Owner, same session: "I dont see jacksons cards add a sort by team member,
 * tonights 12????"
 *
 * Both facts were already in the database and neither reached a tile.
 * `blueprint.source` on a render and `created_by` on a post say who or what
 * made it — measured over completed renders:
 *
 *     content_runner 48 · capcut_energyflow 40 (the music videos, every one
 *     with a music_url) · idea_approve 15 (tonight's batch, source_ref
 *     idea_cut_*) · auto_assemble 13 · ai 9 · human_edit 4 · manual 3 ·
 *     shot_list 3 · capcut_beatcut 2 · cribs_build 1 · (none) 2
 *
 * and on posts, `created_by`: idea_approve 113 · agent 88 · content-director 58
 * · bulk-ad-generator 35 · ai-agent-30day 30 · video_renderer_worker 25 · …
 *
 * "Jackson's cards" are the `shot_list` ones, and the person is REAL rather
 * than inferred: `shot_list_items.render_job_id` links 3 items to those exact 3
 * renders, and 92 of the 102 shot-list items carry
 * `responsible_person = "Jackson (camera)"`. So the board can name him from
 * data instead of guessing from a pipeline key.
 *
 * OPTIONS ARE DERIVED FROM THE CARDS, NEVER LISTED HERE. A new pipeline appears
 * as its own chip the first time it makes something — no code change, no
 * silently-missing filter. Labels are a pure humaniser for the same reason: a
 * label lookup table is a list, and a list goes stale. The raw key travels on
 * the chip's tooltip so what the filter is actually matching is checkable.
 *
 * Pure by design: no React, no database, no clock.
 * Locked by `tests/brand-board-provenance.test.ts`.
 */

import { brainRefused } from "./boardAttention";
import { TEAM_META, teamFor } from "@/lib/content-tags";

// ─── Machine failures ────────────────────────────────────────────────────────

/**
 * The three ways this pipeline ships a failure as a picture.
 *
 * In priority order, most-specific first. A refusal is the most informative —
 * it carries the pipeline's own sentence naming the clip and the fix — so it
 * wins the headline when a card is several of these at once, which 39 renders
 * are.
 */
export type FailureKind = "brain_refused" | "stub" | "frame_grab";

export const FAILURE_ORDER: FailureKind[] = ["brain_refused", "stub", "frame_grab"];

export interface FailureMeta {
  kind: FailureKind;
  /** Short label for a badge. */
  label: string;
  /** OUR description of what the kind means. Never attributed to the pipeline. */
  blurb: string;
}

export const FAILURE_META: Record<FailureKind, FailureMeta> = {
  brain_refused: {
    kind: "brain_refused",
    label: "Brain refused",
    blurb: "The editor brain would not build a cut from this footage. What rendered is a placeholder, not an edit.",
  },
  stub: {
    kind: "stub",
    label: "One-clip stub",
    blurb: "One clip, start to end. Nothing was cut, so there is no edit to review.",
  },
  frame_grab: {
    kind: "frame_grab",
    label: "Frame grab",
    blurb: "A single still pulled out of a video with text drawn over it. Not a piece of film.",
  },
};

export interface FailureCandidate {
  /** `blueprint.kind` — `static_post` is a frame grab. */
  renderKind?: string | null;
  /** `blueprint.edit_kind`, or a post's `creative_edit_kind`/`sourced_edit_kind`. */
  editKind?: string | null;
  /** `editor_brain_status` — `mismatch` / `no_beats` are refusals. */
  brainStatus?: string | null;
  /** `edit_stub_reason`. The pipeline's OWN sentence, printed verbatim. */
  stubReason?: string | null;
}

export interface MachineFailure {
  /** Every kind that applies, in FAILURE_ORDER. Cards are often several. */
  kinds: FailureKind[];
  /** The headline kind — the first of `kinds`. */
  primary: FailureKind;
  /** The pipeline's own explanation, verbatim, or null when it wrote none. */
  reason: string | null;
}

function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * Is this card a machine failure dressed as finished work? Null when it is not.
 *
 * Deliberately reads only stored facts. There is no heuristic here and no
 * scoring: a card is a frame grab because the blueprint says `static_post`, not
 * because something about the picture looked wrong. A guess would put real work
 * in the Stuck lane, which is the same crime as putting slop in Finished.
 */
export function machineFailure(card: FailureCandidate | null | undefined): MachineFailure | null {
  if (!card) return null;
  const kinds: FailureKind[] = [];
  if (brainRefused(card.brainStatus)) kinds.push("brain_refused");
  if (norm(card.editKind) === "stub") kinds.push("stub");
  if (norm(card.renderKind) === "static_post") kinds.push("frame_grab");
  if (!kinds.length) return null;

  const reason = typeof card.stubReason === "string" && card.stubReason.trim()
    ? card.stubReason.trim()
    : null;
  return { kinds, primary: kinds[0], reason };
}

export function isMachineFailure(card: FailureCandidate | null | undefined): boolean {
  return machineFailure(card) !== null;
}

/** e.g. "Frame grab · one-clip stub". The full truth, not just the headline. */
export function failureLabel(f: MachineFailure | null | undefined): string {
  if (!f?.kinds?.length) return "";
  const [head, ...rest] = f.kinds.map((k) => FAILURE_META[k].label);
  return [head, ...rest.map((r) => r.toLowerCase())].join(" · ");
}

export interface FailureReasonGroup {
  /** The pipeline's sentence, verbatim — or null when it wrote none. */
  reason: string | null;
  /** Our own description of the kind, used when there is no sentence. */
  blurb: string;
  kind: FailureKind;
  count: number;
}

/**
 * The distinct reasons behind a set of failed cards, commonest first.
 *
 * Three sentences cover all 43 stub renders in production (27 "never parsed",
 * 13 "footage does not carry the angle", 3 "no parsed beats"), so a per-tile
 * badge repeats the same paragraph forty times while a grouped list says the
 * same thing once and turns into a shoot list. Ties break on the reason text so
 * the order is stable between renders.
 */
export function failureReasons<T extends FailureCandidate>(
  cards: T[] | null | undefined,
): FailureReasonGroup[] {
  const by = new Map<string, FailureReasonGroup>();
  for (const c of cards || []) {
    const f = machineFailure(c);
    if (!f) continue;
    const key = `${f.primary}|${f.reason ?? ""}`;
    const hit = by.get(key);
    if (hit) { hit.count += 1; continue; }
    by.set(key, {
      reason: f.reason,
      blurb: FAILURE_META[f.primary].blurb,
      kind: f.primary,
      count: 1,
    });
  }
  return [...by.values()].sort(
    (a, b) => b.count - a.count || String(a.reason).localeCompare(String(b.reason)),
  );
}

// ─── Who or what made this ───────────────────────────────────────────────────

export interface ProvenanceCandidate {
  /** `blueprint.source` on a render, `created_by` on a post. Raw, as stored. */
  provenance?: string | null;
  /** A real named human, where the row records one. Never inferred. */
  person?: string | null;
}

/**
 * A raw key turned into something readable, WITHOUT a lookup table.
 *
 * `capcut_energyflow` → "Capcut energyflow", `content-director` → "Content
 * director". A map of pretty names would be a hardcoded list by another route,
 * and the first pipeline somebody adds would arrive on the board wearing its
 * raw key while every neighbour had a nice one — which reads as a bug and is
 * how a filter quietly stops covering the data. The raw key is kept on the chip
 * tooltip so the operator can always see what is being matched.
 */
export function humanizeKey(key: string): string {
  const s = String(key || "").trim();
  if (!s) return "";
  const words = s.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface ProvenanceOption {
  /** Match value, exactly as stored. */
  key: string;
  label: string;
  count: number;
}

/**
 * The filter's options, derived from the cards in front of the operator.
 *
 * Commonest first, then alphabetical, so the row is stable and the big batches
 * (the 40 music videos, tonight's approvals) sit where the eye lands. Cards
 * with no value are not an option — "unknown" is not a provenance, and a chip
 * that means "we did not record it" invites filtering by it and finding a pile
 * of unrelated work.
 */
export function provenanceOptions<T extends ProvenanceCandidate>(
  cards: T[] | null | undefined,
): ProvenanceOption[] {
  const counts = new Map<string, number>();
  for (const c of cards || []) {
    const k = String(c?.provenance || "").trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: humanizeKey(key), count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export interface PersonOption {
  /** `teamFor` key — the same identity the rest of the app colours people by. */
  key: string;
  label: string;
  color: string;
  count: number;
}

/**
 * The named humans behind these cards.
 *
 * Only rows that actually RECORD a person contribute: a shot-list item's
 * `responsible_person`, a task's assignee, or a `created_by` that resolves to
 * somebody on the roster (`TEAM_META` — the same list the Engine Room colours
 * by, so a person is one colour everywhere). A `created_by` of `idea_approve`
 * is a pipeline, not a person, and `teamFor` returning its own input as a
 * fallback label is exactly how a pipeline name would sneak into a people
 * filter — so an unrostered value is dropped rather than shown as a colleague
 * nobody has ever met.
 */
export function personOptions<T extends ProvenanceCandidate>(
  cards: T[] | null | undefined,
): PersonOption[] {
  const by = new Map<string, PersonOption>();
  for (const c of cards || []) {
    const raw = String(c?.person || "").trim();
    if (!raw) continue;
    const t = teamFor(raw);
    if (!TEAM_META.some((m) => m.key === t.key)) continue;
    const hit = by.get(t.key);
    if (hit) { hit.count += 1; continue; }
    by.set(t.key, { key: t.key, label: t.label, color: t.color, count: 1 });
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Does this card belong to that person chip? */
export function matchesPerson(card: ProvenanceCandidate | null | undefined, key: string): boolean {
  const raw = String(card?.person || "").trim();
  if (!raw || !key) return false;
  return teamFor(raw).key === key;
}

/**
 * The line above the filter row. States what is being matched, because a filter
 * whose meaning is a guess produces counts nobody trusts.
 */
export function provenanceLine(options: ProvenanceOption[], people: PersonOption[]): string {
  const total = options.reduce((n, o) => n + o.count, 0);
  if (!total && !people.length) {
    return "No card here records what made it — nothing to filter by yet.";
  }
  const bits = [
    `${options.length.toLocaleString()} maker${options.length === 1 ? "" : "s"} across ${total.toLocaleString()} piece${total === 1 ? "" : "s"}`,
  ];
  if (people.length) {
    bits.push(`${people.length.toLocaleString()} named ${people.length === 1 ? "person" : "people"}`);
  }
  return `${bits.join(" · ")} — read off each row, so a new pipeline appears here on its own.`;
}

// ── WHICH SHOW IS IT ────────────────────────────────────────────────────────
//
// "where are 75 scene cuts ? Those are Behind The Install Music Videos if yes
// than just add a button tag for BTI and I can click and review!" (owner,
// 2026-08-07).
//
// The field exists — `video_render_jobs.blueprint->>'show_format'`, the same
// key the detail dialog already reads. It simply never reached a chip, so the
// only way to find an episode was to recognise its thumbnail.
//
// NULL IS A REAL AND COMMON ANSWER (63 of 75 cuts carried no show at the time
// this shipped), and it deliberately gets no chip. A "No show" chip would
// invite filtering by it and finding a pile of unrelated work — the same
// reason `provenanceOptions` drops cards with no maker. What is unrecorded is
// said in the line under the row instead, where it cannot be mistaken for a
// show.

export interface ShowOption {
  /** Match value, exactly as stored — a `SHOW_FORMATS` key. */
  key: string;
  label: string;
  count: number;
}

/**
 * Shows counted off the cards in front of the operator, commonest first.
 *
 * Labels come from `SHOW_FORMATS` so a show is named the same here as in the
 * router and the editor. An unrecognised key is still shown — humanised —
 * rather than dropped: a cut tagged with a show this build does not know about
 * is a real thing somebody recorded, and hiding it would repeat the failure
 * this row exists to fix.
 */
export function showOptions<T extends { showFormat?: string | null }>(
  cards: T[] | null | undefined,
  labelFor: (key: string) => string,
): ShowOption[] {
  const counts = new Map<string, number>();
  for (const c of cards || []) {
    const k = String(c?.showFormat || "").trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: labelFor(key) || humanizeKey(key), count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** How many of these cards record no show at all. Printed, never a chip. */
export function unshownCount<T extends { showFormat?: string | null }>(
  cards: T[] | null | undefined,
): number {
  return (cards || []).filter((c) => !String(c?.showFormat || "").trim()).length;
}

/** The line under the show row. Says what is unrecorded rather than hiding it. */
export function showLine(options: ShowOption[], unshown: number): string {
  const total = options.reduce((n, o) => n + o.count, 0);
  if (!total) {
    return unshown
      ? `No piece here records which show it is — ${unshown.toLocaleString()} untagged.`
      : "Nothing here yet.";
  }
  const bits = [`${total.toLocaleString()} piece${total === 1 ? "" : "s"} across ${options.length} show${options.length === 1 ? "" : "s"}`];
  if (unshown) bits.push(`${unshown.toLocaleString()} record no show`);
  return `${bits.join(" · ")} — read off each cut's blueprint.`;
}
