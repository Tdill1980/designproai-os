/**
 * EditorBrainPanel — "show editor brain".
 *
 * Owner, 2026-08-06, verbatim: "show editor brain" — said while describing an
 * editor that "acts as a real editor and edits viral hooks, docu style — edits
 * bad parts out", "recuts based on social content type", "finds viral hooks
 * educational tips makes a relevant video". Then, the same day: "Also create ui
 * for these so we can see progress bar what its doing", and "WrapTV Behind the
 * Brand docu style, Behind shop doors mtv cribs style edits".
 *
 * So the panel has three jobs, top to bottom:
 *
 *   1. WHAT IT IS DOING RIGHT NOW — the stage strip and the progress bar.
 *   2. WHICH SHOW AND WHICH EDITOR — the decision, and why, before the cut.
 *   3. WHAT IT DECIDED AND WHY — the reasoning, once the cut lands.
 *
 * ── WHY THIS SCREEN EXISTS ──────────────────────────────────────────────────
 * An automated cut is currently a black box. A finished video appears, and the
 * only way to judge it is to watch the whole thing and guess at intent. That is
 * why "none of the system is showing" keeps coming back as a complaint: work
 * happens and is invisible, so it reads as work that never happened.
 *
 * This panel makes the edit ARGUABLE. A human can see that the editor opened on
 * beat 4 because it is the transformation, cut eleven seconds of filler, and put
 * the tutorial steps back into order — and disagree with any one of those.
 * Disagreeing is the point. A decision nobody can see is a decision nobody can
 * check.
 *
 * ── THE PROGRESS BAR DOES NOT LIE ───────────────────────────────────────────
 * All progress here comes from `queuedWork`'s `progressFor` / `summarizeQueue`,
 * which take no clock and derive nothing from elapsed time. That is a deliberate
 * decision recorded in that module: a bar animated off a timer keeps creeping on
 * a job whose worker died twenty minutes ago, and the operator sits watching it
 * because a moving bar reads as "working". Here the bar has discrete positions
 * and moves ONLY when a stage's real status changes. A stalled cut looks
 * stalled, and that stillness is the signal.
 *
 * A stage this build has never heard of renders as UNKNOWN, never as complete —
 * and when the current stage is unknown, no other stage is marked complete
 * either, because nothing in the payload can say which ones actually ran.
 *
 * ── THE OVERRIDES ARE THE MOST IMPORTANT THING HERE ─────────────────────────
 * The architecture is "The AI selects and orders; CODE enforces craft"
 * (CLAUDE.md, verbatim). When the AI proposed something that violated a craft
 * lock — a trim inside speech, a shot under the flash-frame floor, a removal
 * that would have changed what someone said — the code overrode it. Those
 * overrides are rendered showing BOTH sides: what the AI wanted, and what was
 * enforced instead.
 *
 * A silently-corrected AI looks like an AI that never makes mistakes, and then
 * nobody checks it. Showing the correction is what keeps the lock honest, and
 * it is the only way anyone will ever notice the day a lock stops firing.
 *
 * REFUSALS are shown for the same reason and matter even more: a proposed
 * removal that was refused for crossing a negation ("we do NOT recommend that")
 * or a hedge is the guard between an edit and a customer being misquoted.
 *
 * ── AND THE SHOW REFUSAL ────────────────────────────────────────────────────
 * `formatFits` can say "this footage cannot honestly be cut as Behind the Brand
 * — it has no speech; cut it as Behind Shop Doors instead". That sentence is
 * shown prominently, because the alternative is a montage shipping with a
 * documentary's title on it and nobody able to see that the interview was never
 * shot.
 *
 * ── HONEST EMPTY STATES ─────────────────────────────────────────────────────
 * Every "nothing here" on this panel is a SENTENCE that names its own cause and
 * its own next step — never a blank area, never a bare spinner. Four different
 * situations get four different messages, because they have four different
 * fixes: no cut has been made yet · a cut exists but the brain was never run ·
 * the brain ran and answered about a different cut · the brain failed. Folding
 * those into one "No data" is the failure mode this codebase keeps writing down
 * and then repeating (see `sourceFootage.ts`, which reports its denominator so
 * the answer can be argued with).
 *
 * ── THE PAYLOAD IS NOT OURS ─────────────────────────────────────────────────
 * `supabase/functions/editor-brain/` is built by a concurrent session and its
 * exact response schema is not settled. So the interfaces below describe what
 * this panel CONSUMES, every field is optional, and nothing here imports from
 * the edge function. A missing field renders as honest text; it never throws and
 * never renders a blank. That tolerance is what makes reconciling the two cheap
 * when both land.
 *
 * Pure helpers (formatting, ordering, the source-vs-final diff, duration
 * accounting, the stage strip, empty-state selection) are exported and locked by
 * `tests/editor-brain-panel.test.ts`. They contain no clock, no randomness and
 * no network — the same report must always read the same way.
 *
 * White UI standard (`docs/WHITE_UI_STANDARD.md`): white surface, explicit
 * grays, blue→magenta gradient as an ACCENT only. Chips follow the ecosystem
 * colour formula — tinted when idle, SOLID in their own colour with white text
 * when active — the same rule `ChannelAngleCard` documents.
 */

import { useMemo, useState } from "react";
import {
  Scissors, ArrowUpDown, Check, Play, Pause, ShieldAlert, Ban,
  AlertTriangle, Brain, Quote, Loader2, Clapperboard, Music,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { channelMeta, tint } from "@/lib/content-tags";
import { CHANNELS, type ChannelKey } from "@/lib/contentDoctrine";
import {
  progressFor, summarizeQueue, queueLabel, statusLabel, isDone, isFailed,
  type QueuedJob,
} from "@/lib/queuedWork";
import {
  showFormat, formatsForBrand, formatFits, FORMAT_PACE,
  type ShowFormat, type EditorKind, type FormatFit,
} from "@/lib/showFormats";

// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS PANEL CONSUMES
//
// Deliberately structural, not nominal, and every field optional. The edge
// function is being written elsewhere; this is the shape the panel reads, and
// anything it does not recognise degrades to a sentence rather than a crash.
// ═══════════════════════════════════════════════════════════════════════════

/** What the editor DID with a beat. Unknown strings are rendered honestly. */
export type EditorBrainAction =
  | "led_with" | "kept" | "moved" | "held" | "cut" | (string & {});

/** Why a piece of footage was removed. Unknown kinds are prettified, not hidden. */
export type RemovalKind =
  | "filler" | "false_start" | "stutter" | "dead_air" | "repeat" | "tail_off"
  | (string & {});

/** One decision the editor made about one beat. */
export interface EditorBrainDecision {
  id?: string | number;
  /** A human name for the beat — a shot description, a slug, a speaker. */
  label?: string | null;
  /** What the editor did. */
  action?: EditorBrainAction | null;
  /** The narrative job it assigned: hook / setup / escalation / turn / proof / payoff. */
  role?: string | null;
  /** WHY, in the editor's own words. */
  because?: string | null;
  /** EVIDENCE — a line from the transcript. */
  quote?: string | null;
  /** EVIDENCE — a described frame, when there is no speech. */
  frame?: string | null;
  /** Bounds in the SOURCE clip, seconds. */
  sourceStart?: number | null;
  sourceEnd?: number | null;
  /** Bounds in the FINISHED video, seconds. Absent for a removal. */
  outStart?: number | null;
  outEnd?: number | null;
  /** Position in the source, and in the final cut. Either may be absent. */
  sourceIndex?: number | null;
  finalIndex?: number | null;
  /** For a removal: what kind of bad take it was, and how long it ran. */
  removalKind?: RemovalKind | null;
  removedSeconds?: number | null;
  /** For a removal: the text or description of what was taken out. */
  removed?: string | null;
}

/**
 * A craft lock firing: the AI proposed something, the CODE enforced otherwise.
 *
 * Both halves are required reading, which is why both are rendered.
 */
export interface EditorBrainOverride {
  id?: string | number;
  /** Which lock fired — speech / flash_frame / meaning / anything new. */
  lock?: string | null;
  /** What the AI wanted. */
  proposed?: string | null;
  /** What the code did instead. */
  enforced?: string | null;
  /** Why the lock exists, in plain language. */
  because?: string | null;
  /** Optional numbers behind the two sides, seconds. */
  proposedStart?: number | null;
  proposedEnd?: number | null;
  enforcedStart?: number | null;
  enforcedEnd?: number | null;
  /** The beat this override applies to, when known. */
  decisionId?: string | number | null;
  label?: string | null;
}

/**
 * A proposed removal that was REFUSED because taking it out would have changed
 * what somebody said.
 */
export interface EditorBrainRefusal {
  id?: string | number;
  /** What the AI wanted to remove. */
  proposed?: string | null;
  /** The line it sits inside. */
  quote?: string | null;
  /** The guard that refused — negation / hedge / anything new. */
  guard?: string | null;
  /** The exact token that tripped the guard ("not", "unless", "usually"). */
  trigger?: string | null;
  because?: string | null;
  label?: string | null;
}

/** One stage of the run, as the pipeline reports it. */
export interface EditorBrainStageReport {
  /** Stage key — `parse`, `hooks`, `bad_takes`, `order`, `pace`, `captions`, `render`. */
  key?: string | null;
  /** Raw status: queued / running / complete / failed, in any case. */
  status?: string | null;
  /** Anything the stage wants to say. Shown verbatim. */
  note?: string | null;
}

/** Where the run has got to. NEVER a timestamp — see the header. */
export interface EditorBrainProgress {
  /** The stage currently being worked, when the pipeline reports only one. */
  stage?: string | null;
  /** The run's overall status. */
  status?: string | null;
  /** Per-stage statuses, when the pipeline reports them all. Preferred. */
  stages?: EditorBrainStageReport[] | null;
  /** Anything the run wants to say — an error, a note. Shown verbatim. */
  message?: string | null;
}

/** The brain's answer about one cut. */
export interface EditorBrainReport {
  /**
   * "ok" — real reasoning follows.
   * "mismatch" — it answered, but about a different cut.
   * "failed" — the read broke; this is NOT "an edit with no reasoning".
   */
  status?: "ok" | "mismatch" | "failed" | (string & {}) | null;
  /** Which cut this is about — used to spot a mismatch. */
  cutId?: string | number | null;
  /** The content type this cut was recut for: install / documentary / ugc / … */
  contentType?: string | null;
  /** The channel it was built for. */
  channel?: ChannelKey | string | null;
  brand?: string | null;
  /** The named show — a key from `showFormats.ts` (`behind_the_brand`, …). */
  showFormat?: string | null;
  /**
   * What the PARSE actually found in the footage — the real signals, e.g.
   * `["speech", "a person on camera"]`. Fed to `formatFits`, so an empty or
   * missing list produces a refusal rather than a silent pass.
   */
  footageHas?: string[] | null;
  /** Which editor actually cut it, when the run reports it directly. */
  editor?: EditorKind | string | null;
  progress?: EditorBrainProgress | null;
  decisions?: EditorBrainDecision[] | null;
  overrides?: EditorBrainOverride[] | null;
  refusals?: EditorBrainRefusal[] | null;
  /** Total seconds removed, as the brain reports it. Reconciled below. */
  removedSeconds?: number | null;
  sourceDurationSeconds?: number | null;
  finalDurationSeconds?: number | null;
  /** Plain-language detail for a mismatch. */
  message?: string | null;
  /** The failure, when status is "failed". */
  error?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PURE HELPERS — no clock, no randomness, no network. Locked by tests.
// ═══════════════════════════════════════════════════════════════════════════

/** A finite number, or null. Strings that look like numbers are accepted. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Turn `false_start` / `dead-air` into `False start`. Never returns "". */
export function prettyLabel(s?: string | null): string {
  const raw = String(s ?? "").trim();
  if (!raw) return "";
  const words = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `0:04.2`. Missing/NaN is an em dash, never `0:00.0`. */
export function formatTimecode(seconds?: unknown): string {
  const n = num(seconds);
  if (n === null || n < 0) return "—";
  const m = Math.floor(n / 60);
  const s = n - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

/** `11.0s` / `1m 5.0s`. Missing is an em dash. */
export function formatDuration(seconds?: unknown): string {
  const n = num(seconds);
  if (n === null || n < 0) return "—";
  if (n < 60) return `${n.toFixed(1)}s`;
  const m = Math.floor(n / 60);
  return `${m}m ${(n - m * 60).toFixed(1)}s`;
}

/** `0:04.2 → 0:09.8`, or an em dash when neither bound is known. */
export function formatRange(start?: unknown, end?: unknown): string {
  const a = num(start);
  const b = num(end);
  if (a === null && b === null) return "—";
  return `${formatTimecode(a)} → ${formatTimecode(b)}`;
}

// ─── The stage strip: "what its doing" ───────────────────────────────────────

/**
 * The stages of a cut, in the order they run — the owner's own list.
 *
 * `doing` is what the stage is actually doing, in plain language, because
 * "STAGE_3" on a progress bar tells nobody anything.
 */
export const EDITOR_STAGES: ReadonlyArray<{ key: string; label: string; doing: string }> = [
  {
    key: "parse",
    label: "Parsing the asset",
    doing: "Transcribing the audio and scoring the frames. Everything downstream reads this parse, so a thin parse is a thin edit.",
  },
  {
    key: "hooks",
    label: "Finding hooks",
    doing: "Reading the transcript for the line that earns the first second, and the educational beats worth keeping.",
  },
  {
    key: "bad_takes",
    label: "Removing bad takes",
    doing: "Cutting filler, false starts, stutters, dead air, repeated takes and tail-offs — never inside a sentence.",
  },
  {
    key: "order",
    label: "Ordering",
    doing: "Rearranging beats by narrative function rather than by when the camera happened to record them.",
  },
  {
    key: "pace",
    label: "Pacing",
    doing: "Setting shot lengths for retention — short at the open, longer once the viewer has committed.",
  },
  {
    key: "captions",
    label: "Building captions",
    doing: "Timing captions against the OUTPUT clock, not the source clock, so they land on the shot they belong to.",
  },
  {
    key: "render",
    label: "Rendering",
    doing: "Handing the edit decision list to the renderer and writing the file.",
  },
];

const STAGE_BY_KEY = new Map(EDITOR_STAGES.map((s) => [s.key, s]));

/** Aliases seen in the wild. Anything unmatched stays itself and reads UNKNOWN. */
const STAGE_ALIASES: Record<string, string> = {
  parsing: "parse", parse_asset: "parse", transcribe: "parse", transcript: "parse",
  hook: "hooks", find_hooks: "hooks", hook_find: "hooks",
  badtakes: "bad_takes", bad_take: "bad_takes", clean: "bad_takes", trim: "bad_takes",
  ordering: "order", arrange: "order", rearrange: "order",
  pacing: "pace", timing: "pace",
  caption: "captions", subtitles: "captions",
  rendering: "render", encode: "render", export: "render",
};

/** Normalise a reported stage key. Unrecognised keys come back unchanged. */
export function normalizeStageKey(key?: string | null): string {
  const k = String(key ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return STAGE_ALIASES[k] ?? k;
}

export type StageState = "queued" | "running" | "complete" | "failed" | "unknown";

/** Map a raw status string onto the five states, reusing `queuedWork`. */
export function stageStateFor(status?: string | null): StageState {
  const raw = String(status ?? "").trim();
  if (!raw) return "unknown";
  const job: QueuedJob = { id: "s", status: raw };
  if (isFailed(job)) return "failed";
  if (isDone(job)) return "complete";
  // `progressFor` returns 50 for exactly the statuses that mean "a worker has
  // it". Anything else is queued — or, when the word is one this build has
  // never seen, honestly unknown rather than silently queued.
  if (progressFor(job) === 50) return "running";
  return raw.toLowerCase() === "queued" || raw.toLowerCase() === "pending" ? "queued" : "unknown";
}

export interface StageRow {
  key: string;
  label: string;
  doing: string;
  state: StageState;
  /** Human wording for the state. */
  stateText: string;
  /** 0..100 from `progressFor` — status only, never a clock. */
  percent: number;
  /** FALSE when this build has never heard of the stage. */
  known: boolean;
  /** Anything the stage itself said. */
  note: string;
}

export interface StageStrip {
  rows: StageRow[];
  /** 0..100, the mean of the rows via `summarizeQueue`. Cannot drift upward. */
  percent: number;
  failed: boolean;
  running: boolean;
  /** The stage currently being worked, normalised. */
  currentKey: string | null;
  /** TRUE when the current stage is a word this build does not model. */
  unknownStage: boolean;
  /** One sentence naming where the run is. Always set. */
  headline: string;
  /** FALSE when the payload carried nothing to build a strip from. */
  reported: boolean;
}

const STATE_TEXT: Record<StageState, string> = {
  queued: "Queued",
  running: "Running",
  complete: "Complete",
  failed: "Failed",
  unknown: "Unknown",
};

/** The progress value a row contributes. Unknown counts as queued, never done. */
function percentForState(state: StageState): number {
  // Routed through `progressFor` on purpose, so this file can never invent a
  // fifth position the queue module does not have.
  if (state === "complete") return progressFor({ id: "s", status: "complete" });
  if (state === "failed") return progressFor({ id: "s", status: "failed" });
  if (state === "running") return progressFor({ id: "s", status: "running" });
  return progressFor({ id: "s", status: "queued" });
}

function stageRow(key: string, state: StageState, note = ""): StageRow {
  const known = STAGE_BY_KEY.has(key);
  const meta = STAGE_BY_KEY.get(key);
  return {
    key,
    label: meta?.label ?? (key ? prettyLabel(key) : "Unnamed stage"),
    doing:
      meta?.doing ??
      "This build has never heard of this stage, so it is shown as unknown rather than folded into one it might not be.",
    state,
    stateText: STATE_TEXT[state],
    percent: percentForState(state),
    known,
    note: String(note ?? "").trim(),
  };
}

/**
 * Build the stage strip — WHAT IT IS DOING, honestly.
 *
 * Two modes, both derived from reported status alone:
 *
 * EXPLICIT — the pipeline reported a status per stage. Used as given. Any
 *   canonical stage it did NOT mention is `unknown`, not `complete`.
 * DERIVED — the pipeline reported only a current stage plus an overall status.
 *   Stages before it are complete, it carries the overall status, stages after
 *   are queued. Ordering is reported data, not a clock, so this is honest.
 *   BUT if the current stage is a word this build does not model, we cannot say
 *   which stages ran — so NOTHING is marked complete and the strip says why.
 */
export function buildStageStrip(progress?: EditorBrainProgress | null): StageStrip {
  const p = progress ?? null;
  const explicit = (Array.isArray(p?.stages) ? p!.stages! : []).filter(Boolean);
  const currentRaw = String(p?.stage ?? "").trim();
  const currentKey = currentRaw ? normalizeStageKey(currentRaw) : null;
  const overall = String(p?.status ?? "").trim();
  const message = String(p?.message ?? "").trim();
  const reported = Boolean(explicit.length || currentRaw || overall);

  let rows: StageRow[];

  if (explicit.length) {
    const seen = new Map<string, StageRow>();
    const extra: StageRow[] = [];
    for (const s of explicit) {
      const k = normalizeStageKey(s?.key);
      const row = stageRow(k || "", stageStateFor(s?.status), s?.note ?? "");
      if (row.known) seen.set(k, row);
      else extra.push(row);
    }
    // Canonical order first; a canonical stage nobody mentioned is UNKNOWN.
    rows = EDITOR_STAGES.map((s) => seen.get(s.key) ?? stageRow(s.key, "unknown"));
    rows = rows.concat(extra);
  } else if (currentKey && STAGE_BY_KEY.has(currentKey)) {
    const at = EDITOR_STAGES.findIndex((s) => s.key === currentKey);
    const currentState = overall ? stageStateFor(overall) : "running";
    rows = EDITOR_STAGES.map((s, i) =>
      stageRow(s.key, i < at ? "complete" : i === at ? currentState : "queued"),
    );
  } else if (currentKey) {
    // UNKNOWN CURRENT STAGE. Nothing may be claimed complete.
    rows = EDITOR_STAGES.map((s) => stageRow(s.key, "unknown"));
    rows.push(stageRow(currentKey, overall ? stageStateFor(overall) : "unknown"));
  } else if (overall) {
    // A run-level status with NO stage named. Only "complete" can be spread
    // across every stage, because that is the one state that implies all of
    // them finished. A failure with no stage tells us nothing about which
    // stages ran, so they are all unknown and the headline says the run failed.
    const st = stageStateFor(overall);
    rows = EDITOR_STAGES.map((s) =>
      stageRow(s.key, st === "complete" ? "complete" : st === "queued" ? "queued" : "unknown"),
    );
  } else {
    rows = EDITOR_STAGES.map((s) => stageRow(s.key, "unknown"));
  }

  const failed = rows.some((r) => r.state === "failed") || stageStateFor(overall) === "failed";
  const running = rows.some((r) => r.state === "running");
  const unknownStage = Boolean(currentKey) && !STAGE_BY_KEY.has(currentKey!);
  const done = rows.filter((r) => r.state === "complete").length;

  // Percent comes from `summarizeQueue` — the same honest mean the Brand Board
  // queue uses, so this bar cannot behave differently from that one.
  const percent = summarizeQueue(rows.map((r) => ({ id: r.key, status: r.state }))).percent;

  const currentRow = currentKey ? rows.find((r) => r.key === currentKey) : rows.find((r) => r.state === "running");

  let headline: string;
  if (!reported) {
    headline = "No run has been reported for this cut, so there is no progress to show.";
  } else if (failed) {
    const at = rows.find((r) => r.state === "failed");
    headline = `Stopped at "${at?.label ?? currentRow?.label ?? "an unnamed stage"}" — that stage failed.${
      message ? ` It reported: ${message}.` : ""
    } Nothing further will run until it is fixed.`;
  } else if (unknownStage) {
    headline = `The run reported a stage this build has never heard of ("${currentRaw}"). No stage is marked complete, because nothing here can say which ones actually ran.`;
  } else if (rows.length && rows.every((r) => r.state === "complete")) {
    headline = `All ${rows.length} stages complete — the cut has landed and its reasoning is below.`;
  } else if (running && currentRow) {
    headline = `${currentRow.label} — ${currentRow.doing} (${done} of ${rows.length} stages complete.)`;
  } else if (rows.every((r) => r.state === "unknown")) {
    headline = "A run was reported but no stage status came with it, so how far along it is cannot be shown.";
  } else {
    headline = `Queued — ${done} of ${rows.length} stages complete, and nothing has picked up the next one yet.`;
  }

  return { rows, percent, failed, running, currentKey, unknownStage, headline, reported };
}

// ─── The show, and which editor cut it ───────────────────────────────────────

export const EDITOR_META: Record<EditorKind, { label: string; color: string; cuts: string }> = {
  intelligence: {
    label: "Intelligence editor",
    color: "#3B82F6",
    cuts: "Cuts on CONTENT — finds the hook, reorders by narrative function, edits the bad parts out, and protects speech absolutely.",
  },
  music: {
    label: "Music editor",
    color: "#EC4899",
    cuts: "Cuts on the BEAT — phrase boundaries, action on the accent, the reveal held on the drop. No dialogue to protect, which is why it may cut this fast.",
  },
};

export function editorMeta(kind?: string | null): { label: string; color: string; cuts: string } | null {
  const k = String(kind ?? "").trim().toLowerCase();
  return (EDITOR_META as Record<string, { label: string; color: string; cuts: string }>)[k] ?? null;
}

export interface ShowChoice {
  /** TRUE when the report named a show this build knows. */
  known: boolean;
  format: ShowFormat | null;
  label: string;
  reference: string;
  editor: EditorKind | null;
  editorLabel: string;
  /** WHY this editor, in one line a human can disagree with. */
  because: string;
  structure: string[];
  pace: { minShot: number; typicalShot: number } | null;
  /** The `formatFits` verdict, when the parse reported what it found. */
  fit: FormatFit | null;
  /** Other shows this brand has, for the "cut it as X instead" answer. */
  alternatives: ShowFormat[];
  /** A sentence, always set — including when nothing was recorded. */
  message: string;
}

/**
 * Which show this is, which editor cut it, and whether the footage can honestly
 * carry it.
 *
 * `formatFits` is called with what the PARSE found, and a missing/empty
 * `footageHas` deliberately produces a refusal rather than a pass: a silent
 * downgrade — a documentary title over a montage because the interview was
 * never shot — is the exact failure `showFormats.ts` exists to prevent.
 */
export function describeShow(report?: EditorBrainReport | null): ShowChoice {
  const key = String(report?.showFormat ?? "").trim();
  const fmt = showFormat(key);
  const alternatives = formatsForBrand(report?.brand).filter((f) => f.key !== fmt?.key);

  if (!fmt) {
    // The run may still have named an editor even with no show. Say what is
    // known and what is not, rather than one blank line.
    const em = editorMeta(report?.editor);
    return {
      known: false,
      format: null,
      label: key ? `Unknown show "${key}"` : "No show format recorded",
      reference: "",
      editor: em ? (String(report?.editor).toLowerCase() as EditorKind) : null,
      editorLabel: em?.label ?? "Editor not recorded",
      because: em?.cuts ?? "",
      structure: [],
      pace: null,
      fit: null,
      alternatives,
      message: key
        ? `This cut names a show ("${key}") that is not in showFormats.ts, so which editor should have cut it cannot be checked. Add it there, or fix the key.`
        : `No show format was recorded for this cut, so nothing wrote down which editor was correct or why.${
            alternatives.length
              ? ` This brand has: ${alternatives.map((f) => f.label).join(", ")}.`
              : " This brand has no shows defined in showFormats.ts."
          }`,
    };
  }

  const has = Array.isArray(report?.footageHas) ? report!.footageHas!.filter(Boolean) : [];
  const fit = formatFits(fmt, has);
  const em = EDITOR_META[fmt.editor];

  return {
    known: true,
    format: fmt,
    label: fmt.label,
    reference: fmt.reference,
    editor: fmt.editor,
    editorLabel: em.label,
    because: fmt.because,
    structure: fmt.structure,
    pace: FORMAT_PACE[fmt.editor],
    fit,
    alternatives,
    message: fit.message,
  };
}

// ─── Roles, actions, evidence ────────────────────────────────────────────────

/** The editorial roles, with the colour each reads in across the panel. */
export const ROLE_META: Record<string, { label: string; color: string }> = {
  hook: { label: "Hook", color: "#EC4899" },
  setup: { label: "Setup", color: "#64748B" },
  escalation: { label: "Escalation", color: "#F59E0B" },
  turn: { label: "Turn", color: "#8B5CF6" },
  proof: { label: "Proof", color: "#0EA5E9" },
  payoff: { label: "Payoff", color: "#10B981" },
  b_roll: { label: "B-roll", color: "#94A3B8" },
  unclassified: { label: "Unclassified", color: "#94A3B8" },
};

/** Never guesses a role. An unknown string is shown as itself, in neutral gray. */
export function roleMeta(role?: string | null): { label: string; color: string } {
  const k = String(role ?? "").trim().toLowerCase();
  if (ROLE_META[k]) return ROLE_META[k];
  if (k) return { label: prettyLabel(k), color: "#64748B" };
  return { label: "No role recorded", color: "#94A3B8" };
}

/** What the editor did, with its colour and the verb the row leads with. */
export const ACTION_META: Record<string, { label: string; verb: string; color: string }> = {
  led_with: { label: "Led with", verb: "Led with", color: "#EC4899" },
  kept: { label: "Kept", verb: "Kept", color: "#10B981" },
  moved: { label: "Moved", verb: "Moved", color: "#8B5CF6" },
  held: { label: "Held on", verb: "Held on", color: "#0EA5E9" },
  cut: { label: "Cut", verb: "Cut", color: "#F59E0B" },
};

export function actionMeta(action?: string | null): { label: string; verb: string; color: string } {
  const k = String(action ?? "").trim().toLowerCase();
  if (ACTION_META[k]) return ACTION_META[k];
  if (k) return { label: prettyLabel(k), verb: prettyLabel(k), color: "#64748B" };
  // Honest gap: the editor did SOMETHING to this beat and did not say what.
  return { label: "Unrecorded", verb: "Did something it did not record", color: "#94A3B8" };
}

/** The action strings that mean "this is not in the finished video". */
const REMOVAL_ACTIONS = new Set(["cut", "removed", "dropped", "deleted"]);

/** Is this decision a removal? Reads the action, then falls back to evidence. */
export function isRemoval(d?: EditorBrainDecision | null): boolean {
  if (!d) return false;
  const a = String(d.action ?? "").trim().toLowerCase();
  if (REMOVAL_ACTIONS.has(a)) return true;
  if (a) return false;
  // No action recorded — a removal kind or a removed duration still says so.
  return Boolean(String(d.removalKind ?? "").trim()) || num(d.removedSeconds) !== null;
}

export const REMOVAL_KIND_LABEL: Record<string, string> = {
  filler: "Filler",
  false_start: "False start",
  stutter: "Stutter",
  dead_air: "Dead air",
  repeat: "Repeated take",
  tail_off: "Tail-off",
};

/** Names the kind of bad take, or says it was not recorded. Never invents one. */
export function describeRemovalKind(kind?: string | null): string {
  const k = String(kind ?? "").trim().toLowerCase();
  if (REMOVAL_KIND_LABEL[k]) return REMOVAL_KIND_LABEL[k];
  if (k) return prettyLabel(k);
  return "Kind not recorded";
}

/**
 * The evidence from the footage that supports a decision.
 *
 * A quote beats a described frame beats a bare timecode beats an honest
 * admission that nothing was recorded. It never returns an empty string,
 * because an empty string renders as a blank area — the exact thing this panel
 * exists to stop.
 */
export function describeEvidence(d?: EditorBrainDecision | null): {
  kind: "quote" | "frame" | "timecode" | "none";
  text: string;
} {
  const quote = String(d?.quote ?? "").trim();
  if (quote) return { kind: "quote", text: quote };
  const frame = String(d?.frame ?? "").trim();
  if (frame) return { kind: "frame", text: frame };
  const a = num(d?.sourceStart);
  const b = num(d?.sourceEnd);
  if (a !== null || b !== null) {
    return {
      kind: "timecode",
      text: `No quote or frame recorded — this beat runs ${formatRange(a, b)} in the source.`,
    };
  }
  return {
    kind: "none",
    text: "No evidence recorded for this decision. The editor moved it without saying what it saw.",
  };
}

// ─── Source order vs final order ─────────────────────────────────────────────

/** Where a beat ended up relative to where it was shot. */
export type Movement = "earlier" | "later" | "unmoved" | "removed" | "unknown";

export interface OrderRow {
  key: string;
  label: string;
  /** 1-based position in the SOURCE footage. */
  sourceNo: number;
  /** 1-based position in the FINAL cut, or null when it was removed. */
  finalNo: number | null;
  /** sourceNo − finalNo. Positive = it plays earlier than it was shot. */
  delta: number | null;
  movement: Movement;
  /** A sentence, always. */
  note: string;
  decision: EditorBrainDecision;
}

export interface OrderDiff {
  /** Every decision, in SOURCE order. */
  rows: OrderRow[];
  /** The rows that survive, in FINAL order. */
  final: OrderRow[];
  kept: number;
  removed: number;
  moved: number;
  /**
   * FALSE when the payload carries no positional information at all — in which
   * case no rearrangement is claimed, rather than one being invented from
   * array order.
   */
  orderKnown: boolean;
  /** The shape of the whole cut, in one sentence. */
  summary: string;
}

function decisionKey(d: EditorBrainDecision, i: number): string {
  const id = d?.id;
  return id === null || id === undefined || id === "" ? `i${i}` : `id${String(id)}`;
}

function decisionLabel(d: EditorBrainDecision, i: number): string {
  const l = String(d?.label ?? "").trim();
  if (l) return l;
  const q = String(d?.quote ?? "").trim();
  if (q) return q.length > 48 ? `${q.slice(0, 45)}…` : q;
  const f = String(d?.frame ?? "").trim();
  if (f) return f.length > 48 ? `${f.slice(0, 45)}…` : f;
  return `Beat ${i + 1}`;
}

/**
 * SOURCE ORDER vs FINAL ORDER — the single most useful thing on the panel.
 *
 * Rearrangement is completely invisible in a finished video: the viewer has no
 * idea that the shot which opens it was recorded eleven minutes in. This makes
 * it visible, and it is deliberately conservative — if the payload does not
 * carry enough positional information to KNOW something moved, it says so
 * rather than inferring movement from the order the array happened to arrive
 * in. A fake "moved 3 earlier" is worse than no claim at all.
 */
export function buildOrderDiff(decisions?: EditorBrainDecision[] | null): OrderDiff {
  const list = (Array.isArray(decisions) ? decisions : []).filter(Boolean) as EditorBrainDecision[];
  if (!list.length) {
    return {
      rows: [], final: [], kept: 0, removed: 0, moved: 0, orderKnown: false,
      summary: "No decisions were recorded, so the shape of this cut cannot be shown.",
    };
  }

  const sourceOrderKnown = list.some((d) => num(d.sourceIndex) !== null || num(d.sourceStart) !== null);

  // SOURCE ORDER: an explicit index wins, then the source timecode, then the
  // position in the array — with the array position as the stable tie-break, so
  // the same report always reads the same way.
  const withSource = list.map((d, i) => ({
    d, i,
    sortKey: num(d.sourceIndex) ?? num(d.sourceStart) ?? i,
  }));
  const sourceSorted = [...withSource].sort((a, b) => a.sortKey - b.sortKey || a.i - b.i);
  const sourceNoByIndex = new Map<number, number>();
  sourceSorted.forEach((e, n) => sourceNoByIndex.set(e.i, n + 1));

  // FINAL ORDER: only the beats that survived.
  const survivors = withSource.filter((e) => !isRemoval(e.d));
  const finalOrderKnown = survivors.some((e) => num(e.d.finalIndex) !== null || num(e.d.outStart) !== null);
  const finalSorted = [...survivors].sort((a, b) => {
    const ka = num(a.d.finalIndex) ?? num(a.d.outStart) ?? a.i;
    const kb = num(b.d.finalIndex) ?? num(b.d.outStart) ?? b.i;
    return ka - kb || a.i - b.i;
  });
  const finalNoByIndex = new Map<number, number>();
  finalSorted.forEach((e, n) => finalNoByIndex.set(e.i, n + 1));

  const orderKnown = sourceOrderKnown && finalOrderKnown;

  const rows: OrderRow[] = sourceSorted.map((e) => {
    const sourceNo = sourceNoByIndex.get(e.i)!;
    const removed = isRemoval(e.d);
    const finalNo = removed ? null : finalNoByIndex.get(e.i) ?? null;
    let movement: Movement;
    let delta: number | null = null;
    let note: string;

    if (removed) {
      movement = "removed";
      note = `Source #${sourceNo} → cut. Not in the final video.`;
    } else if (!orderKnown || finalNo === null) {
      movement = "unknown";
      note = `Source #${sourceNo} → in the final cut, but its position was not recorded.`;
    } else {
      delta = sourceNo - finalNo;
      if (delta > 0) {
        movement = "earlier";
        note = `Source #${sourceNo} → final #${finalNo} (${delta} earlier).`;
      } else if (delta < 0) {
        movement = "later";
        note = `Source #${sourceNo} → final #${finalNo} (${-delta} later).`;
      } else {
        movement = "unmoved";
        note = `Source #${sourceNo} → final #${finalNo} (in place).`;
      }
    }

    return {
      key: decisionKey(e.d, e.i),
      label: decisionLabel(e.d, e.i),
      sourceNo, finalNo, delta, movement, note, decision: e.d,
    };
  });

  const byKeyRow = new Map(rows.map((r) => [r.key, r]));
  const final = finalSorted
    .map((e) => byKeyRow.get(decisionKey(e.d, e.i)))
    .filter(Boolean) as OrderRow[];

  const kept = rows.filter((r) => r.movement !== "removed").length;
  const removed = rows.length - kept;
  const moved = rows.filter((r) => r.movement === "earlier" || r.movement === "later").length;

  let summary: string;
  if (!orderKnown) {
    summary = `${rows.length} decision${rows.length === 1 ? "" : "s"} recorded, but source and final positions were not — no rearrangement can be shown, and none is claimed.`;
  } else if (moved === 0) {
    summary = `${kept} beat${kept === 1 ? "" : "s"} kept in source order${removed ? `, ${removed} cut` : ""}. Nothing was rearranged — this is an assembly, not a recut.`;
  } else {
    summary = `${moved} of ${kept} beat${kept === 1 ? "" : "s"} were moved out of source order${removed ? `, and ${removed} cut` : ""}. The finished video does not play in the order it was shot.`;
  }

  return { rows, final, kept, removed, moved, orderKnown, summary };
}

// ─── Removal accounting ──────────────────────────────────────────────────────

export interface RemovalLine {
  key: string;
  label: string;
  kind: string;
  seconds: number | null;
  /** The text/description of what came out, or an honest note. */
  removed: string;
  because: string;
  range: string;
}

export interface RemovalAccounting {
  lines: RemovalLine[];
  /** Sum of the per-removal durations that were actually recorded. */
  summedSeconds: number;
  /** How many removals carried no duration at all. */
  unmeasured: number;
  /** What the brain SAYS the total is, when it says. */
  reportedSeconds: number | null;
  /** True when the parts add up to the reported whole (to 0.05s). */
  reconciles: boolean;
  /** A sentence naming the total AND whether it can be trusted. */
  note: string;
}

/**
 * Duration accounting — and the arithmetic is checked, not trusted.
 *
 * "11 seconds removed" is the headline number on this panel, so it gets
 * reconciled against the removals it is supposed to be the sum of. When they
 * disagree the panel says so, because a total that does not match its parts
 * means one of the two is wrong and a human needs to know which claim to
 * believe.
 */
export function reconcileRemovals(report?: EditorBrainReport | null): RemovalAccounting {
  const list = (Array.isArray(report?.decisions) ? report!.decisions! : []).filter(Boolean);
  const removals = list.filter((d) => isRemoval(d));

  const lines: RemovalLine[] = removals.map((d, i) => {
    const explicit = num(d.removedSeconds);
    const a = num(d.sourceStart);
    const b = num(d.sourceEnd);
    const derived = a !== null && b !== null && b > a ? b - a : null;
    const removedText = String(d.removed ?? "").trim() || String(d.quote ?? "").trim();
    return {
      key: decisionKey(d, i),
      label: decisionLabel(d, i),
      kind: describeRemovalKind(d.removalKind),
      seconds: explicit ?? derived,
      removed: removedText || "What came out was not recorded — only that something did.",
      because: String(d.because ?? "").trim() || "No reason recorded for this removal.",
      range: formatRange(a, b),
    };
  });

  const measured = lines.filter((l) => l.seconds !== null);
  const summedSeconds = Math.round(measured.reduce((n, l) => n + (l.seconds as number), 0) * 100) / 100;
  const unmeasured = lines.length - measured.length;
  const reportedSeconds = num(report?.removedSeconds);
  const reconciles = reportedSeconds !== null && Math.abs(reportedSeconds - summedSeconds) <= 0.05;

  let note: string;
  if (!lines.length) {
    note = "Nothing was cut from this edit — every beat in the source is in the finished video.";
  } else if (reportedSeconds === null) {
    note = unmeasured
      ? `${formatDuration(summedSeconds)} removed across ${measured.length} of ${lines.length} removals; ${unmeasured} carried no duration, so the real total is higher than this.`
      : `${formatDuration(summedSeconds)} removed across ${lines.length} removal${lines.length === 1 ? "" : "s"}. No total was reported, so this is summed from the parts.`;
  } else if (reconciles) {
    note = `${formatDuration(reportedSeconds)} removed across ${lines.length} removal${lines.length === 1 ? "" : "s"} — the parts add up to the reported total.`;
  } else {
    note = `The ${lines.length} removals add up to ${formatDuration(summedSeconds)}, but the brain reported ${formatDuration(reportedSeconds)}. Those disagree — one of the two numbers is wrong.`;
  }

  return { lines, summedSeconds, unmeasured, reportedSeconds, reconciles, note };
}

// ─── The four empty states ───────────────────────────────────────────────────

/** Which "nothing to show" this is. `ok` means there IS something to show. */
/**
 * `refused` was added 2026-08-07 and it fixes a message that was actively false.
 *
 * The brain records its verdict on the render row
 * (`blueprint.editor_brain_status`), and for `no_beats` it stores that verdict
 * with a NULL `editor_brain` object. This panel saw the null, fell through to
 * `not_run`, and told the operator "the editor brain has never been run on it —
 * the edit was made without recording a single reason". Measured against
 * production the same day, that sentence was wrong on 20 render jobs: the brain
 * ran, found nothing to cut on, and said so.
 *
 * It matters because the NEXT STEP is opposite. "Never run" means run it. A
 * refusal means the brain already answered — "this footage cannot carry this
 * idea" — so you reshoot or change the angle, and re-running it will simply
 * refuse again. Sending someone to press a button that cannot help is the exact
 * failure this panel's state split exists to avoid; it just had one state too
 * few.
 */
export type EditorBrainState = "ok" | "no_cut" | "not_run" | "refused" | "mismatch" | "failed";

export interface EditorBrainEmpty {
  state: Exclude<EditorBrainState, "ok">;
  title: string;
  /** A sentence naming the cause AND the next step. Never "No data". */
  message: string;
}

export interface EmptyStateInput {
  /** Has a cut actually been made? */
  hasCut?: boolean;
  report?: EditorBrainReport | null;
  /** The cut currently on screen, for spotting a mismatched answer. */
  cutId?: string | number | null;
  /**
   * Is a run in flight right now? Only refines the `no_cut` wording — telling
   * someone to "make a cut first" while one is rendering is bad advice.
   */
  inFlight?: boolean;
  /**
   * The verdict stored on the render row (`blueprint.editor_brain_status`),
   * when there is one.
   *
   * ADDITIVE, and deliberately separate from `report`: the brain can record a
   * verdict WITHOUT a reasoning object — `no_beats` stores a null
   * `editor_brain` — and in that case the row is the only surviving evidence
   * that it ran at all. Nothing this panel already reads changed.
   */
  storedVerdict?: string | null;
  /** The pipeline's own sentence explaining the stub, printed verbatim. */
  stubReason?: string | null;
}

/** The two verdicts that mean the brain ran and declined to build an edit. */
function isRefusalVerdict(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "mismatch" || s === "no_beats";
}

/**
 * The four empty states, kept apart on purpose.
 *
 * "No cut yet" is a scheduling problem, "never run" is a wiring problem,
 * "mismatch" is a correctness problem and "failed" is an outage. They have four
 * different next steps, and collapsing them into one message is the failure
 * mode this panel was written to avoid. Returns null when there is real
 * reasoning to render.
 */
export function emptyStateFor(input?: EmptyStateInput | null): EditorBrainEmpty | null {
  const report = input?.report ?? null;
  const status = String(report?.status ?? "").trim().toLowerCase();

  // FAILED first: a broken read must never be reported as "no cut" or "no
  // reasoning", because both of those send someone off to fix the wrong thing.
  if (status === "failed" || status === "error") {
    const detail = String(report?.error ?? report?.message ?? "").trim();
    return {
      state: "failed",
      title: "The editor brain failed",
      message: `The editor brain failed, so this cut is unexplained — that is a broken read, not an edit made without reasoning. ${
        detail ? `It reported: ${detail}. ` : "It reported no error text, which is its own bug. "
      }Fix the error and run it again.`,
    };
  }

  if (!input?.hasCut) {
    return {
      state: "no_cut",
      title: input?.inFlight ? "The cut is still being made" : "No cut has been made yet",
      message: input?.inFlight
        ? "No cut has landed yet — the run above is still working, and the editor's reasoning appears here the moment it finishes. Watch the stage strip; if it stops moving, the run has stalled."
        : "No cut has been made yet, so there are no edit decisions to show. Make a cut first — the brain explains an edit, it does not make one.",
    };
  }

  // REFUSED before NOT_RUN. The row's stored verdict is checked first because a
  // refusal is precisely the case where the reasoning object is absent, so the
  // `not_run` test below would otherwise catch it and print the opposite of the
  // truth. See the EditorBrainState doc comment.
  if (isRefusalVerdict(input?.storedVerdict)) {
    const noBeats = String(input?.storedVerdict).trim().toLowerCase() === "no_beats";
    const detail = String(input?.stubReason ?? "").trim();
    return {
      state: "refused",
      title: noBeats
        ? "The brain found nothing to cut on"
        : "The brain refused this angle",
      message: `${
        noBeats
          ? "The editor brain ran and found no usable beats in this footage, so no edit was built from it."
          : "The editor brain ran and refused: the footage does not carry the angle this idea asks for. It flagged that before any model spend."
      } What rendered is a ONE-CLIP STUB, not an edit — it exists so a human can decide which half is wrong. ${
        detail ? `It recorded: ${detail} ` : ""
      }Re-running the brain will refuse again; either reshoot for this angle or change the angle to what this footage shows.`,
    };
  }

  if (!report || (!report.decisions && !report.overrides && !report.refusals && !status)) {
    return {
      state: "not_run",
      title: "The brain was never run on this cut",
      message:
        "This cut exists, but the editor brain has never been run on it — the edit was made without recording a single reason for any of it. Run the brain on this cut to get its reasoning.",
    };
  }

  const wantId = input?.cutId;
  const gotId = report.cutId;
  const idMismatch =
    wantId !== null && wantId !== undefined && wantId !== "" &&
    gotId !== null && gotId !== undefined && gotId !== "" &&
    String(wantId) !== String(gotId);

  const noDecisions = !(Array.isArray(report.decisions) && report.decisions.length);

  if (status === "mismatch" || idMismatch || noDecisions) {
    const detail = String(report.message ?? "").trim();
    const cause = idMismatch
      ? `It answered about cut ${String(gotId)}, and this is cut ${String(wantId)}.`
      : noDecisions
        ? "It returned an answer with no decisions in it, so there is nothing here that corresponds to this edit."
        : "It reported that its answer does not correspond to this edit.";
    return {
      state: "mismatch",
      title: "The brain answered about a different cut",
      message: `The editor brain ran, but what it returned does not match this cut. ${cause} ${
        detail ? `It said: ${detail}. ` : ""
      }Re-run it against this cut before trusting anything it says.`,
    };
  }

  return null;
}

/** The facts across the top of the panel. Every value is a sentence-safe string. */
export interface CutFact {
  label: string;
  value: string;
}

export function cutFacts(
  report?: EditorBrainReport | null,
  diff?: OrderDiff | null,
  accounting?: RemovalAccounting | null,
): CutFact[] {
  const d = diff ?? buildOrderDiff(report?.decisions);
  const a = accounting ?? reconcileRemovals(report);
  const total = a.reportedSeconds ?? (a.lines.length ? a.summedSeconds : null);
  return [
    { label: "Decisions", value: d.rows.length ? String(d.rows.length) : "None recorded" },
    { label: "Kept", value: d.rows.length ? String(d.kept) : "—" },
    { label: "Moved", value: d.orderKnown ? String(d.moved) : "Not recorded" },
    { label: "Time removed", value: total === null ? "Not recorded" : formatDuration(total) },
    {
      label: "Final length",
      value: num(report?.finalDurationSeconds) === null ? "Not recorded" : formatDuration(report?.finalDurationSeconds),
    },
  ];
}

/** The channel this cut was built for — label + the colour it reads in. */
export function channelFor(channel?: string | null): { label: string; color: string; known: boolean } {
  const k = String(channel ?? "").trim().toLowerCase();
  if (!k) return { label: "Channel not recorded", color: "#94A3B8", known: false };
  // Shorts share YouTube's colour in the ecosystem palette, same as ChannelAngleCard.
  const paletteKey = k === "youtube_short" ? "youtube" : k;
  const meta = channelMeta(paletteKey);
  const label = (CHANNELS as Record<string, { label: string }>)[k]?.label ?? meta.label;
  return { label, color: meta.color, known: true };
}

/** An override, rendered as two halves plus the reason the lock exists. */
export function describeOverride(o?: EditorBrainOverride | null): {
  lock: string;
  proposed: string;
  enforced: string;
  because: string;
} {
  const lockRaw = String(o?.lock ?? "").trim();
  const proposedRange = formatRange(o?.proposedStart, o?.proposedEnd);
  const enforcedRange = formatRange(o?.enforcedStart, o?.enforcedEnd);
  const proposed = String(o?.proposed ?? "").trim();
  const enforced = String(o?.enforced ?? "").trim();
  return {
    lock: lockRaw ? prettyLabel(lockRaw) : "Lock not named",
    proposed:
      proposed ||
      (proposedRange !== "—"
        ? `Proposed ${proposedRange}`
        : "What the AI proposed was not recorded — only that it was overridden."),
    enforced:
      enforced ||
      (enforcedRange !== "—"
        ? `Enforced ${enforcedRange}`
        : "What the code enforced instead was not recorded."),
    because:
      String(o?.because ?? "").trim() ||
      "No reason recorded for this override. A lock that fires without saying why cannot be checked.",
  };
}

/** A refusal, rendered so the misquote it prevented is legible. */
export function describeRefusal(r?: EditorBrainRefusal | null): {
  guard: string;
  proposed: string;
  quote: string;
  because: string;
} {
  const guardRaw = String(r?.guard ?? "").trim();
  const trigger = String(r?.trigger ?? "").trim();
  return {
    guard: guardRaw ? prettyLabel(guardRaw) : "Guard not named",
    proposed:
      String(r?.proposed ?? "").trim() ||
      "What the AI wanted to remove was not recorded — only that it was refused.",
    quote: String(r?.quote ?? "").trim() || "The line it sits inside was not recorded.",
    because:
      String(r?.because ?? "").trim() ||
      (trigger
        ? `Removing it would have crossed "${trigger}" and changed what was actually said.`
        : "No reason recorded for this refusal."),
  };
}

/** The action filters across the decision list, in the order they read. */
export const ACTION_FILTERS = ["all", "led_with", "kept", "moved", "cut"] as const;
export type ActionFilter = (typeof ACTION_FILTERS)[number];

export const FILTER_META: Record<ActionFilter, { label: string; color: string }> = {
  all: { label: "Everything", color: "#3B82F6" },
  led_with: { label: "Led with", color: "#EC4899" },
  kept: { label: "Kept", color: "#10B981" },
  moved: { label: "Moved", color: "#8B5CF6" },
  cut: { label: "Cut", color: "#F59E0B" },
};

/** Filter the ordered rows. `moved` reads the diff, not the action string. */
export function filterRows(rows: OrderRow[], filter: ActionFilter): OrderRow[] {
  const list = Array.isArray(rows) ? rows : [];
  if (filter === "all") return list;
  if (filter === "cut") return list.filter((r) => r.movement === "removed");
  if (filter === "moved") return list.filter((r) => r.movement === "earlier" || r.movement === "later");
  return list.filter((r) => String(r.decision?.action ?? "").trim().toLowerCase() === filter);
}

// ═══════════════════════════════════════════════════════════════════════════
// THE PANEL
// ═══════════════════════════════════════════════════════════════════════════

export interface EditorBrainPanelProps {
  /** The brain's answer. Absent/partial is expected and handled. */
  report?: EditorBrainReport | null;
  /** Does a cut exist at all? Drives the first of the empty states. */
  hasCut?: boolean;
  /** The cut on screen, so an answer about a different one is caught. */
  cutId?: string | number | null;
  /**
   * The verdict stored on the render row, when there is one. Additive: it lets
   * the panel tell "the brain refused" apart from "the brain never ran", which
   * are opposite next steps and were previously reported as the same one.
   */
  storedVerdict?: string | null;
  /** The pipeline's own explanation of a refusal stub, printed verbatim. */
  stubReason?: string | null;
  /**
   * The render jobs behind this cut, if any — summarised with `queueLabel` so
   * this panel and the Brand Board queue can never disagree about a job's state.
   */
  jobs?: QueuedJob[] | null;
  /** True while the brain is running. Still shows a sentence, never a bare spinner. */
  loading?: boolean;
  /** Wire a re-run where one is possible. Omitted = no button, no false promise. */
  onRunBrain?: () => void;
  className?: string;
}

const ACTION_ICON: Record<string, typeof Check> = {
  led_with: Play,
  kept: Check,
  moved: ArrowUpDown,
  held: Pause,
  cut: Scissors,
};

const STATE_STYLE: Record<StageState, string> = {
  complete: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  running: "bg-blue-50 text-blue-800 ring-blue-200",
  failed: "bg-red-50 text-red-800 ring-red-300",
  queued: "bg-gray-50 text-gray-500 ring-gray-200",
  unknown: "bg-amber-50 text-amber-800 ring-amber-200",
};

function Chip({
  color, active, children, onClick, title,
}: {
  color: string;
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  // THE ECOSYSTEM COLOUR FORMULA — tinted when idle, SOLID in its own colour
  // with white text when active. Not a gradient: a gradient here would make
  // "moved" and "cut" indistinguishable at a glance and break the one visual
  // language the rest of the hub speaks (see ChannelAngleCard).
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all",
        active ? "border-transparent text-white shadow-sm" : "",
        onClick ? "hover:shadow-sm" : "",
      )}
      style={
        active
          ? { backgroundColor: color }
          : { backgroundColor: tint(color), borderColor: tint(color, 0.4), color }
      }
    >
      {children}
    </Tag>
  );
}

export default function EditorBrainPanel({
  report, hasCut, cutId, jobs, loading, onRunBrain, className,
  storedVerdict, stubReason,
}: EditorBrainPanelProps) {
  const [filter, setFilter] = useState<ActionFilter>("all");

  const strip = useMemo(() => buildStageStrip(report?.progress), [report]);
  const show = useMemo(() => describeShow(report), [report]);
  const diff = useMemo(() => buildOrderDiff(report?.decisions), [report]);
  const accounting = useMemo(() => reconcileRemovals(report), [report]);
  const empty = useMemo(
    () => emptyStateFor({ hasCut, report, cutId, inFlight: strip.running, storedVerdict, stubReason }),
    [hasCut, report, cutId, strip.running, storedVerdict, stubReason],
  );
  const facts = useMemo(() => cutFacts(report, diff, accounting), [report, diff, accounting]);

  const channel = channelFor(report?.channel);
  const contentType = String(report?.contentType ?? "").trim();
  const overrides = (Array.isArray(report?.overrides) ? report!.overrides! : []).filter(Boolean);
  const refusals = (Array.isArray(report?.refusals) ? report!.refusals! : []).filter(Boolean);
  const shown = filterRows(diff.rows, filter);
  const jobList = (Array.isArray(jobs) ? jobs : []).filter(Boolean);

  return (
    <div className={cn("overflow-hidden rounded-xl border border-gray-200 bg-white", className)}>
      {/* Brand hairline — the gradient as an accent, never as a fill. */}
      <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />

      <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#ec4899] shadow-sm">
          <Brain className="h-4 w-4 text-white" />
        </div>
        <h3 className="font-bold leading-none">
          <span className="text-gray-900">Editor </span>
          <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Brain</span>
        </h3>
        <span className="text-[11px] text-gray-500">what it is doing, and what it decided</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* The channel this cut was RECUT FOR — solid in its own colour,
              because it is the active channel, not one of a set to choose from. */}
          <Chip color={channel.color} active={channel.known} title="The channel this cut was built for">
            {channel.label}
          </Chip>
          {contentType ? (
            <Chip color="#64748B" title="The content type this cut was built for">
              {prettyLabel(contentType)}
            </Chip>
          ) : (
            <span className="text-[11px] text-gray-500">Content type not recorded</span>
          )}
        </div>
      </div>

      {/* ══ 1. WHAT IT IS DOING RIGHT NOW ═══════════════════════════════════ */}
      <div className="px-3 pt-2">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Run progress</p>
            {strip.running && <Loader2 className="h-3 w-3 animate-spin text-blue-600" />}
            <span className="ml-auto text-[11px] font-bold text-gray-900">
              {strip.reported ? `${strip.percent}%` : "—"}
            </span>
          </div>

          {/* THE BAR. Discrete positions from `progressFor` only — no clock, no
              easing. If it is not moving, work is not landing, and that is the
              signal. Red the moment a stage fails, so failure never reads as
              "still going". */}
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className={cn(
                "h-full rounded-full",
                strip.failed ? "bg-red-500" : strip.reported ? "bg-blue-500" : "bg-gray-300",
              )}
              style={{ width: `${strip.reported ? strip.percent : 0}%` }}
            />
          </div>

          <p
            className={cn(
              "mt-1.5 text-[12px] leading-snug",
              strip.failed ? "font-semibold text-red-700" : "text-gray-700",
            )}
          >
            {strip.headline}
          </p>

          {strip.reported && (
            <div className="mt-2 flex flex-wrap gap-1">
              {strip.rows.map((s) => (
                <span
                  key={s.key}
                  title={`${s.doing}${s.note ? ` — ${s.note}` : ""}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1",
                    STATE_STYLE[s.state],
                    !s.known && "italic",
                  )}
                >
                  {s.state === "complete" && <Check className="h-3 w-3" />}
                  {s.state === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                  {s.state === "failed" && <AlertTriangle className="h-3 w-3" />}
                  {s.label}
                  <span className="opacity-70">{s.stateText}</span>
                </span>
              ))}
            </div>
          )}

          {strip.running && (
            <p className="mt-1.5 text-[10px] leading-snug text-gray-500">
              This bar only moves when a stage's status actually changes — it is never advanced on a
              timer. If it stops, the work has stopped.
            </p>
          )}

          {jobList.length > 0 && (
            <p className="mt-1.5 text-[11px] text-gray-600">
              <span className="font-semibold text-gray-900">Render queue:</span> {queueLabel(jobList)}
              {jobList.some((j) => isFailed(j)) && (
                <span className="ml-1 font-semibold text-red-700">
                  — a job failed; the cut will not land until it is re-run.
                </span>
              )}
              {jobList.length === 1 && (
                <span className="ml-1 text-gray-500">({statusLabel(jobList[0])})</span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* ══ 2. WHICH SHOW, AND WHICH EDITOR CUT IT ═════════════════════════ */}
      <div className="px-3 pt-2">
        <div
          className={cn(
            "rounded-lg border p-2.5",
            show.fit && !show.fit.ok ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white",
          )}
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
            The show, and which editor cut it
          </p>

          {show.known && show.format ? (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-bold text-gray-900">{show.label}</span>
                <span className="text-[11px] text-gray-500">{show.reference}</span>
              </div>

              {/* The two editors. The one that cut it is SOLID in its own
                  colour; the other stays tinted. Same formula as the channel
                  row — never a gradient, or the two become one colour and the
                  decision this section exists to show disappears. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {(Object.keys(EDITOR_META) as EditorKind[]).map((k) => {
                  const m = EDITOR_META[k];
                  const on = show.editor === k;
                  const Icon = k === "music" ? Music : Clapperboard;
                  return (
                    <Chip key={k} color={m.color} active={on} title={m.cuts}>
                      <Icon className="h-3 w-3" />
                      {m.label}
                      {on && <span className="text-[9px] text-white/75">cut this</span>}
                    </Chip>
                  );
                })}
                {show.pace && (
                  <span className="text-[10px] text-gray-500">
                    shots ≥ {show.pace.minShot}s, typically {show.pace.typicalShot}s
                  </span>
                )}
              </div>

              <p className="mt-1.5 text-[11px] leading-snug text-gray-700">
                <span className="font-semibold text-gray-900">Why this editor:</span> {show.because}
              </p>

              {show.structure.length > 0 && (
                <ol className="mt-1.5 space-y-0.5">
                  {show.structure.map((s, i) => (
                    <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-gray-600">
                      <span className="font-bold text-gray-400">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ol>
              )}

              {/* THE REFUSAL. "It has no speech — cut it as Behind Shop Doors
                  instead" is the most useful sentence this section can print,
                  because the alternative is a montage shipping with a
                  documentary's title on it. */}
              {show.fit && (
                <p
                  className={cn(
                    "mt-2 flex gap-1 text-[11px] font-medium leading-snug",
                    show.fit.ok ? "text-emerald-800" : "text-amber-900",
                  )}
                >
                  {show.fit.ok ? (
                    <Check className="mt-0.5 h-3 w-3 shrink-0" />
                  ) : (
                    <Ban className="mt-0.5 h-3 w-3 shrink-0" />
                  )}
                  {show.fit.message}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mt-1 text-[12px] leading-snug text-gray-600">{show.message}</p>
              {show.alternatives.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {show.alternatives.map((f) => (
                    <Chip key={f.key} color={EDITOR_META[f.editor].color} title={f.because}>
                      {f.label} · {EDITOR_META[f.editor].label}
                    </Chip>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* LOADING is still a sentence. A bare spinner tells nobody what is being
          waited on or how long it is reasonable to wait. */}
      {loading && (
        <p className="px-3 pt-2 text-[12px] leading-snug text-gray-600">
          Reading the edit — the brain is re-deriving every decision from the cut and its transcript.
          Whatever is already recorded stays visible below while it runs.
        </p>
      )}

      {/* ══ 3. WHAT IT DECIDED, AND WHY ═══════════════════════════════════ */}
      {empty ? (
        <div className="px-3 pb-3 pt-2">
          <div
            className={cn(
              "rounded-lg border p-3",
              empty.state === "failed"
                ? "border-red-200 bg-red-50"
                // A refusal is a REAL ANSWER, not an absence, so it is coloured
                // like one — an operator scanning for "is there anything here"
                // must not read the brain's most useful output as empty state.
                : empty.state === "mismatch" || empty.state === "refused"
                  ? "border-amber-200 bg-amber-50"
                  : "border-gray-200 bg-gray-50",
            )}
          >
            <p className="flex items-center gap-1.5 text-[12px] font-bold text-gray-900">
              {empty.state === "failed" ? (
                <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
              ) : empty.state === "mismatch" || empty.state === "refused" ? (
                <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
              ) : (
                <Brain className="h-3.5 w-3.5 text-gray-400" />
              )}
              {empty.title}
            </p>
            <p className="mt-1 text-[12px] leading-snug text-gray-600">{empty.message}</p>
            {/* No "Run the editor brain" on a refusal. It already ran and it
                will refuse again — the fix is footage or angle, not a re-run,
                and offering the button would send someone to press the one
                thing that cannot help. */}
            {onRunBrain && empty.state !== "no_cut" && empty.state !== "refused" && (
              <Button
                size="sm"
                onClick={onRunBrain}
                className="mt-2 h-7 border-0 bg-gray-900 px-2.5 text-[11px] text-white hover:bg-gray-800"
              >
                Run the editor brain
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="px-3 pb-3 pt-2">
          {/* ── THE SHAPE OF THE WHOLE CUT ───────────────────────────────── */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">The shape of this cut</p>
            <p className="mt-1 text-[12px] font-semibold leading-snug text-gray-900">{diff.summary}</p>

            {/* SOURCE ORDER vs FINAL ORDER. Two rails; each chip on the final
                rail carries the SOURCE number it came from, so a rearrangement
                reads at a glance as "4 · 1 · 7 · 2". */}
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="w-12 shrink-0 text-[10px] font-bold uppercase text-gray-400">Shot</span>
                {diff.rows.map((r) => (
                  <span
                    key={`src-${r.key}`}
                    title={`${r.label} — ${r.note}`}
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold",
                      r.movement === "removed"
                        ? "bg-amber-100 text-amber-800 line-through"
                        : "bg-white text-gray-700 ring-1 ring-gray-200",
                    )}
                  >
                    {r.sourceNo}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="w-12 shrink-0 text-[10px] font-bold uppercase text-gray-400">Final</span>
                {diff.final.length ? (
                  diff.final.map((r) => {
                    const c = roleMeta(r.decision?.role).color;
                    return (
                      <span
                        key={`fin-${r.key}`}
                        title={`${r.label} — ${r.note}`}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
                        style={{ backgroundColor: tint(c, 0.18), color: c }}
                      >
                        {r.sourceNo}
                      </span>
                    );
                  })
                ) : (
                  <span className="text-[11px] text-gray-500">
                    Nothing survives into the final cut — every recorded beat was removed.
                  </span>
                )}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {facts.map((f) => (
                <span key={f.label} className="text-[11px] text-gray-600">
                  <span className="font-semibold text-gray-900">{f.value}</span> {f.label.toLowerCase()}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-gray-600">{accounting.note}</p>
            {!accounting.reconciles && accounting.reportedSeconds !== null && (
              <p className="mt-1 flex gap-1 text-[11px] font-medium text-amber-800">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                The reported total and the removals do not agree — do not quote either number until they do.
              </p>
            )}
          </div>

          {/* ── OVERRIDES: what the AI wanted vs what the code enforced ───── */}
          <div className="mt-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
              Craft overrides — the AI proposed, the code enforced
            </p>
            {overrides.length ? (
              <div className="mt-1.5 space-y-1.5">
                {overrides.map((o, i) => {
                  const d = describeOverride(o);
                  return (
                    <div key={`ov-${String(o.id ?? i)}`} className="rounded-lg border border-violet-200 bg-violet-50 p-2.5">
                      <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-violet-700" />
                        <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                          {d.lock}
                        </span>
                        {o.label && <span className="font-semibold text-gray-900">{o.label}</span>}
                      </p>
                      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                        <div className="rounded border border-gray-200 bg-white p-1.5">
                          <p className="text-[9px] font-bold uppercase tracking-wide text-gray-400">The AI wanted</p>
                          <p className="mt-0.5 text-[11px] leading-snug text-gray-700">{d.proposed}</p>
                        </div>
                        <div className="rounded border border-emerald-200 bg-white p-1.5">
                          <p className="text-[9px] font-bold uppercase tracking-wide text-emerald-700">Code enforced</p>
                          <p className="mt-0.5 text-[11px] leading-snug text-gray-900">{d.enforced}</p>
                        </div>
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-gray-600">{d.because}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1 text-[11px] leading-snug text-gray-600">
                No craft lock fired on this cut — every edit the AI proposed was already legal.
                That is a real result, not a missing section: if overrides never appear across many
                cuts, suspect the locks are not running rather than that the AI is perfect.
              </p>
            )}
          </div>

          {/* ── REFUSALS ─────────────────────────────────────────────────── */}
          <div className="mt-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
              Refused removals — cutting these would have changed the meaning
            </p>
            {refusals.length ? (
              <div className="mt-1.5 space-y-1.5">
                {refusals.map((r, i) => {
                  const d = describeRefusal(r);
                  return (
                    <div key={`rf-${String(r.id ?? i)}`} className="rounded-lg border border-red-200 bg-red-50 p-2.5">
                      <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <Ban className="h-3.5 w-3.5 shrink-0 text-red-600" />
                        <span className="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                          {d.guard}
                        </span>
                        {r.label && <span className="font-semibold text-gray-900">{r.label}</span>}
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-gray-700">
                        <span className="font-semibold text-gray-900">Wanted to cut:</span> {d.proposed}
                      </p>
                      <p className="mt-1 flex gap-1 text-[11px] italic leading-snug text-gray-700">
                        <Quote className="mt-0.5 h-3 w-3 shrink-0 text-gray-400" />
                        {d.quote}
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-gray-600">{d.because}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1 text-[11px] leading-snug text-gray-600">
                No removal was refused on this cut — nothing the AI proposed cutting crossed a negation
                or a hedge. Nobody was at risk of being misquoted here.
              </p>
            )}
          </div>

          {/* ── THE DECISIONS ────────────────────────────────────────────── */}
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {ACTION_FILTERS.map((f) => {
                const meta = FILTER_META[f];
                const n = filterRows(diff.rows, f).length;
                return (
                  <Chip key={f} color={meta.color} active={filter === f} onClick={() => setFilter(f)}>
                    {meta.label}
                    <span className={filter === f ? "text-white/75" : "opacity-60"}>{n}</span>
                  </Chip>
                );
              })}
            </div>

            {shown.length ? (
              <ol className="mt-2 space-y-1.5">
                {shown.map((row) => {
                  const d = row.decision;
                  const act = actionMeta(d?.action);
                  const role = roleMeta(d?.role);
                  const Icon = ACTION_ICON[String(d?.action ?? "").toLowerCase()] ?? Check;
                  const ev = describeEvidence(d);
                  const removal = row.movement === "removed";
                  const seconds =
                    num(d?.removedSeconds) ??
                    (num(d?.sourceStart) !== null && num(d?.sourceEnd) !== null
                      ? (num(d?.sourceEnd) as number) - (num(d?.sourceStart) as number)
                      : null);
                  return (
                    <li
                      key={row.key}
                      className={cn(
                        "rounded-lg border p-2.5",
                        removal ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
                          style={{ backgroundColor: act.color }}
                        >
                          <Icon className="h-3 w-3" />
                          {act.label}
                        </span>
                        <Chip color={role.color}>{role.label}</Chip>
                        <span className="text-[12px] font-semibold text-gray-900">{row.label}</span>
                        <span className="ml-auto text-[10px] font-medium text-gray-500">{row.note}</span>
                      </div>

                      {/* WHY, in the editor's own words. */}
                      <p className="mt-1 text-[11px] leading-snug text-gray-700">
                        {String(d?.because ?? "").trim() ||
                          "The editor recorded no reason for this decision — it cannot be argued with as written."}
                      </p>

                      {/* THE EVIDENCE from the footage. */}
                      <p
                        className={cn(
                          "mt-1 flex gap-1 text-[11px] leading-snug",
                          ev.kind === "quote" ? "italic text-gray-700" : "text-gray-500",
                        )}
                      >
                        <Quote className="mt-0.5 h-3 w-3 shrink-0 text-gray-400" />
                        {ev.kind === "quote" ? `"${ev.text}"` : ev.text}
                      </p>

                      {removal && (
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-amber-900">
                          <Scissors className="h-3 w-3 shrink-0" />
                          <span className="font-semibold">{describeRemovalKind(d?.removalKind)}</span>
                          <span>·</span>
                          <span>{seconds === null ? "duration not recorded" : formatDuration(seconds)}</span>
                          <span>·</span>
                          <span>{formatRange(d?.sourceStart, d?.sourceEnd)}</span>
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-2 text-[11px] leading-snug text-gray-600">
                {diff.rows.length
                  ? `No decision on this cut is "${FILTER_META[filter].label.toLowerCase()}" — the editor recorded ${diff.rows.length} decision${diff.rows.length === 1 ? "" : "s"}, none of that kind.`
                  : "No decisions were recorded for this cut."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
