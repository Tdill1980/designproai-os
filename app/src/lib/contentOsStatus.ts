/**
 * contentOsStatus — the derivation behind "what is this system doing, and what
 * is stopping it?"
 *
 * ── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────
 * The owner's recurring complaint is "none of the system is showing", and an
 * admin's version of it on 2026-08-07 was "no progress bar, no indication that
 * it's done." Neither is a UI gripe. They are the accurate observation that
 * this system cannot report its own condition.
 *
 * Every defect found on 2026-08-07 was invisible until somebody queried the
 * database by hand:
 *
 *   · three passes configured and never executed — the workflow was green
 *   · 25 of 25 enrichment calls returned HTTP 401 — the workflow was green
 *   · every automatic creative was one burned JPG frame
 *   · content_type NULL on all 427 videos; visual_tags NULL on all 749 assets
 *   · weprintwraps: 82 clips, ZERO parsed sources, so every draft for that
 *     brand could only ever be a stub
 *   · 120 posts waiting for a creative, 18 of them under brand strings no
 *     asset carries (`wraptv` where the assets say `wraptvworld` — a typo)
 *   · 102 shot cards, 98 with a written brief, THREE with footage attached
 *
 * Every one of those is a number a screen could have shown. This module is the
 * arithmetic for that screen; `AdminContentOS.tsx` only renders what it decides.
 *
 * ── THE FOUR RULES THIS FILE IS BUILT ON ───────────────────────────────────
 *
 * 1. NEVER SHOW A NUMBER YOU DID NOT MEASURE. A count is a `Count`, which is
 *    either a measured value WITH the query that produced it, or an explicit
 *    unknown WITH the reason. There is no third case and no default of zero. A
 *    dashboard that guesses is worse than no dashboard, because it is believed.
 *
 * 2. NO CLOCK-DERIVED PROGRESS. `queuedWork.progressFor` is reused verbatim and
 *    is the ONLY source of any percentage on the screen. This file reads the
 *    current time NOWHERE — it constructs no date object and calls no clock
 *    function — deliberately, so the property is structural rather than a
 *    convention someone has to remember. Wall-clock time enters only as an
 *    explicit `nowMs` ARGUMENT, is used only to state the AGE of a measured
 *    timestamp, and never feeds a bar. `tests/content-os-status.test.ts` greps
 *    this source for the clock-reading forms and fails the build if any appear.
 *
 *    A stalled pass must LOOK stalled. That is the whole point: twelve days of a
 *    dead parser went unnoticed because nothing on screen ever said so.
 *
 * 3. AN HONEST DENOMINATOR, ALWAYS — the `sourceFootage.ts` standard ("Searched
 *    214 clips and none is about this"). A drop is only computed between two
 *    populations where one is genuinely a SUBSET of the other. Steps declare
 *    `of`, and `of: null` means "different population, no drop is computable" —
 *    the funnel says so instead of subtracting two unrelated numbers.
 *
 * 4. A BLOCKER NAMES ITS NEXT STEP. Every `Blocker` carries a `nextStep`, and
 *    the test asserts it is never empty. "weprintwraps is blocked" is a
 *    complaint; "82 clips, 0 parsed — run Parse Footage on weprintwraps" is a
 *    thing somebody can do.
 *
 * ── "RAN, NOTHING TO DO" vs "HASN'T RUN" ───────────────────────────────────
 * These two look identical from outside and mean opposite things. That
 * ambiguity is exactly how `tagLibrary.js` sat dead for weeks looking healthy.
 * `describePass` separates them structurally: a pass has RUN only if some row
 * carries its marker timestamp, and it is IDLE only if it has run AND its
 * backlog is measured at zero. A pass with a backlog it has not touched is
 * `stalled` once its own declared cadence has been missed several times over —
 * and the cadence is DATA read off the workflow, not a number invented here.
 *
 * ── THIS FILE DOES NOT DEFINE A STAGE VOCABULARY ───────────────────────────
 * A concurrent session owns `src/lib/contentStages.ts` (the stage model). The
 * keys here are MEASUREMENT keys named after the query that produces them
 * (`assets.parsed`, `cards.withFootage`), and the pass keys are the real
 * filenames in `worker/video-renderer/`. Nothing here competes with a stage
 * model, and `buildFunnel` takes its specs as an ARGUMENT so that model can
 * supply them the day it lands — see `FUNNEL` below for the seam.
 *
 * Pure by construction: no database, no network, no clock, no randomness.
 */

import { progressFor, summarizeQueue, type QueuedJob } from "./queuedWork";

// ═══════════════════════════════════════════════════════════════════════════
// A MEASURED NUMBER, OR AN HONEST UNKNOWN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One number on the screen, and the receipt for it.
 *
 * `value: null` is NOT zero and must never render as zero. It means the query
 * did not run, or ran and failed, and `unknownBecause` says which.
 */
export interface Count {
  value: number | null;
  /** The query this came from, close enough that someone can re-run it. */
  query: string;
  /** Why it is unknown. Set exactly when `value` is null. */
  unknownBecause?: string | null;
}

/** A measured number with its receipt. */
export function measured(value: number, query: string): Count {
  const n = Number(value);
  return {
    value: Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null,
    query,
    unknownBecause: Number.isFinite(n) ? null : "the value returned was not a finite number",
  };
}

/**
 * An explicit unknown.
 *
 * Used when a query errored, was skipped, or the column that would answer it
 * does not exist. The screen prints "Unknown" and the reason underneath it.
 */
export function unknown(query: string, because: string): Count {
  return { value: null, query, unknownBecause: because || "not measured" };
}

/** Is this number real? */
export function isKnown(c?: Count | null): boolean {
  return typeof c?.value === "number" && Number.isFinite(c.value);
}

/** `310`, or `Unknown` — NEVER `0` for a value that was not measured. */
export function formatCount(c?: Count | null): string {
  return isKnown(c) ? String(c!.value) : "Unknown";
}

/** The sentence under an unknown. Empty string when the number is real. */
export function unknownNote(c?: Count | null): string {
  if (isKnown(c)) return "";
  const why = String(c?.unknownBecause ?? "").trim();
  return why
    ? `Not measured — ${why}. Shown as unknown rather than zero, because zero is a claim.`
    : "Not measured, and no reason was recorded. Shown as unknown rather than zero.";
}

/** `74%`, or null when either side is unmeasured or the denominator is zero. */
export function percentOf(part?: Count | null, whole?: Count | null): number | null {
  if (!isKnown(part) || !isKnown(whole)) return null;
  const w = whole!.value as number;
  if (w <= 0) return null;
  return Math.round(((part!.value as number) / w) * 100);
}

// ═══════════════════════════════════════════════════════════════════════════
// IS IT ALIVE? — the passes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The maintenance passes, as `.github/workflows/render-videos.yml` actually
 * runs them, in the order that file runs them.
 *
 * `everyMinutes` is the workflow's own cron (every 5 minutes, as written in that
 * file) — DATA, copied from the schedule, not a guess about how often it
 * "should" run. `marker` is how a
 * human can verify the pass ran without trusting this screen: it names the
 * column or JSON key the pass stamps on the rows it touches.
 */
export interface PassSpec {
  key: string;
  label: string;
  /** What it does, in one line, in plain language. */
  does: string;
  /** The cron cadence of its executor, in minutes. From the workflow file. */
  everyMinutes: number;
  /** Where the evidence that it ran actually lives. */
  marker: string;
  /** Does this pass cost money per item? Changes what a backlog means. */
  spends: boolean;
}

export const PASSES: ReadonlyArray<PassSpec> = [
  {
    key: "spine",
    label: "Spine",
    does: "Joins each finished render to a narrative and records the artifacts it already is (16:9 longform, 9:16 Reel/Short — same file, no new render).",
    everyMinutes: 5,
    marker: "content_artifacts.produced_by = 'spine-cron'",
    spends: false,
  },
  {
    key: "reattach",
    label: "Reattach",
    does: "Puts a finished creative back on the Content Director post that asked for it. Without this a render completes and its idea stays empty forever.",
    everyMinutes: 5,
    marker: "content_artifacts.produced_by = 'reattach-cron'",
    spends: false,
  },
  {
    key: "promote",
    label: "Promote",
    does: "Moves an organic piece that already earned views onto the ad schedule as a pending_review candidate with budget 0. It cannot spend a cent on its own.",
    everyMinutes: 5,
    marker: "agent_ad_campaigns.created_at",
    spends: false,
  },
  {
    key: "classify",
    label: "Classify",
    does: "Puts raw library assets into the content taxonomy. Keyword-deterministic, no model call, free. Every picker that filters on content_type reads this.",
    everyMinutes: 5,
    marker: "agent_media_assets.classified_at",
    spends: false,
  },
  {
    key: "intelligence",
    label: "Enrich",
    does: "Assembles asset intelligence out of transcripts and content_moments already paid for. Free — it re-reads stored evidence, it does not analyse.",
    everyMinutes: 5,
    marker: "agent_media_assets.metadata->'asset_intelligence_pass'->>'at'",
    spends: false,
  },
  {
    key: "contentRunner",
    label: "Make creatives",
    does: "Finds footage for an idea that has no creative, runs the editor brain and enqueues a real render. This is the pass that commits.",
    everyMinutes: 5,
    marker: "agent_social_posts.generation_meta->>'pending_render_since'",
    spends: true,
  },
  {
    key: "tagLibrary",
    label: "Tag library",
    does: "Grabs frames from clips with no machine tags and asks vision what is in them. Runs LAST because it is the only pass that costs money per clip.",
    everyMinutes: 5,
    marker: "agent_media_assets.metadata->>'tag_library_at'",
    spends: true,
  },
];

const PASS_BY_KEY = new Map(PASSES.map((p) => [p.key, p]));

/** What was actually measured about one pass. Every field may be unknown. */
export interface PassEvidence {
  key: string;
  /** ISO timestamp of the most recent row this pass stamped. null = no stamp exists. */
  lastRunAt?: string | null;
  /** How many rows carry this pass's marker at all. */
  touched?: Count | null;
  /** How many rows are STILL eligible for it. 0 with a lastRunAt means idle. */
  backlog?: Count | null;
  /** Rows whose marker records a failure. */
  failed?: Count | null;
  /** The most recent failure text the rows carry, verbatim. */
  lastError?: string | null;
}

export type PassState =
  /** No row anywhere carries this pass's marker. It has never done anything. */
  | "never_ran"
  /** It ran, and there is genuinely nothing left for it to do. */
  | "idle"
  /** It ran recently and has work outstanding — normal. */
  | "working"
  /** It has a backlog and has not stamped a row in several of its own cycles. */
  | "stalled"
  /** It ran and recorded failures. */
  | "failing"
  /** Not enough was measured to say. Never folded into any of the above. */
  | "unknown";

export interface PassHealth {
  spec: PassSpec;
  state: PassState;
  /** Human wording for the state. */
  stateText: string;
  lastRunAt: string | null;
  /** Age of `lastRunAt` in ms, when a `nowMs` was supplied. */
  ageMs: number | null;
  /** "4 minutes ago" / "Unknown". Never a fabricated duration. */
  ageText: string;
  touched: Count;
  backlog: Count;
  failed: Count;
  lastError: string;
  /** One sentence that answers "is it alive?" — always set. */
  headline: string;
  /** What to do, when there is something to do. Empty when nothing is wrong. */
  nextStep: string;
}

const PASS_STATE_TEXT: Record<PassState, string> = {
  never_ran: "Never ran",
  idle: "Ran — nothing to do",
  working: "Working",
  stalled: "Stalled",
  failing: "Failing",
  unknown: "Unknown",
};

/**
 * How many missed cycles before a pass with outstanding work is called stalled.
 *
 * Six, not one: GitHub's scheduled runners drift and skip, and a screen that
 * cries stalled every time a 5-minute cron lands at 7 minutes trains people to
 * ignore it. Half an hour of silence on a pass that has work is not drift.
 */
export const STALL_AFTER_CYCLES = 6;

/** `4 minutes ago`, `2 days ago`. Pure — the caller supplies both ends. */
export function formatAge(ageMs: number | null): string {
  if (ageMs === null || !Number.isFinite(ageMs)) return "Unknown";
  if (ageMs < 0) return "In the future — a clock somewhere is wrong";
  const mins = Math.floor(ageMs / 60000);
  if (mins < 1) return "Less than a minute ago";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Age of an ISO timestamp against a SUPPLIED now.
 *
 * `Date.parse` is a pure string→number conversion; the current time is never
 * read here, it is passed in. That is what keeps this module clock-free and
 * every test deterministic.
 */
export function ageOf(iso?: string | null, nowMs?: number | null): number | null {
  const s = String(iso ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  if (nowMs === null || nowMs === undefined || !Number.isFinite(nowMs)) return null;
  return (nowMs as number) - t;
}

function asCount(c: Count | null | undefined, fallbackQuery: string, why: string): Count {
  return c ?? unknown(fallbackQuery, why);
}

/**
 * Is this pass alive, and if not, which kind of not-alive is it?
 *
 * The ordering of the branches is the argument:
 *
 *   FAILING first — recorded failures are the loudest fact and must never be
 *     hidden behind "working". The 401s sat on the rows the whole time.
 *   NEVER RAN next — no marker anywhere. This is a WIRING bug (a pass nothing
 *     executes), and it is the failure that hid for weeks.
 *   UNKNOWN before idle — an unmeasured backlog cannot be called "nothing to
 *     do". Saying idle here would be the dashboard guessing.
 *   IDLE only with a MEASURED zero backlog. "Ran, nothing to do" is a real,
 *     healthy state and it is worth being able to say.
 *   STALLED for outstanding work plus silence longer than its own cadence
 *     allows — and only when the age is actually known.
 */
export function describePass(spec: PassSpec, ev?: PassEvidence | null, nowMs?: number | null): PassHealth {
  const lastRunAt = String(ev?.lastRunAt ?? "").trim() || null;
  const touched = asCount(ev?.touched, spec.marker, "the marker count was not queried");
  const backlog = asCount(ev?.backlog, spec.marker, "the eligible-row count was not queried");
  const failed = asCount(ev?.failed, spec.marker, "the failure count was not queried");
  const lastError = String(ev?.lastError ?? "").trim();
  const ageMs = ageOf(lastRunAt, nowMs);
  const ageText = lastRunAt ? formatAge(ageMs) : "Never";

  const hasRun = Boolean(lastRunAt) || (isKnown(touched) && (touched.value as number) > 0);
  const failures = isKnown(failed) ? (failed.value as number) : 0;
  const stallMs = spec.everyMinutes * STALL_AFTER_CYCLES * 60000;
  const outstanding = isKnown(backlog) ? (backlog.value as number) : null;

  let state: PassState;
  if (failures > 0) state = "failing";
  else if (!hasRun) state = "never_ran";
  else if (outstanding === null) state = "unknown";
  else if (outstanding === 0) state = "idle";
  else if (ageMs !== null && ageMs > stallMs) state = "stalled";
  else state = "working";

  let headline: string;
  let nextStep = "";

  switch (state) {
    case "failing":
      headline =
        `${failed.value} row${failures === 1 ? "" : "s"} carry a recorded failure from this pass` +
        `${lastRunAt ? `, last stamped ${ageText.toLowerCase()}` : ""}. ` +
        (lastError
          ? `The most recent one says: ${lastError}`
          : "No error text was recorded on the rows, which is its own bug — a failure nobody can read is a failure nobody can fix.");
      nextStep = lastError
        ? `Read the error above and fix its cause, then let the pass retry — it re-reads eligible rows every ${spec.everyMinutes} minutes.`
        : `Make this pass record its error text on the row, then re-run it.`;
      break;
    case "never_ran":
      headline =
        `Nothing anywhere carries this pass's marker (${spec.marker}), so it has never done anything. ` +
        `A pass that is configured but not executed is indistinguishable from a pass that runs and finds nothing — this is the first one.`;
      nextStep =
        `Check it has a step in .github/workflows/render-videos.yml — the container in worker/video-renderer is NOT deployed, so the workflow is the only executor.`;
      break;
    case "unknown":
      headline =
        `It last stamped a row ${ageText.toLowerCase()}, but how much work is left for it was not measured — ` +
        `so "ran and finished" and "ran and skipped everything" cannot be told apart here.`;
      nextStep = `Measure the eligible-row count for this pass (${backlog.query}) so idle and stalled stop looking the same.`;
      break;
    case "idle":
      headline =
        `Ran ${ageText.toLowerCase()} and has nothing left to do — ${formatCount(backlog)} rows are eligible. ` +
        `This is the healthy version of silence, and it is a different fact from "has not run".`;
      break;
    case "stalled":
      headline =
        `${formatCount(backlog)} row${outstanding === 1 ? "" : "s"} are waiting and it has not stamped anything since ${ageText.toLowerCase()} — ` +
        `more than ${STALL_AFTER_CYCLES} of its own ${spec.everyMinutes}-minute cycles. It is not keeping up, or it is not running.`;
      nextStep =
        `Open the last "Render Videos" run in GitHub Actions and read this pass's step — continue-on-error is on, so a red step does not turn the workflow red.`;
      break;
    default:
      headline =
        `Ran ${ageText.toLowerCase()}, ${formatCount(backlog)} row${outstanding === 1 ? "" : "s"} still to work through` +
        (spec.spends ? " — and this one spends per item, so the backlog is a bill as well as a queue." : ".");
      break;
  }

  return {
    spec,
    state,
    stateText: PASS_STATE_TEXT[state],
    lastRunAt,
    ageMs,
    ageText,
    touched,
    backlog,
    failed,
    lastError,
    headline,
    nextStep,
  };
}

/** Every pass, in workflow order, described. Deterministic. */
export function describePasses(
  evidence: Record<string, PassEvidence> | null | undefined,
  nowMs?: number | null,
): PassHealth[] {
  const map = evidence || {};
  return PASSES.map((spec) => describePass(spec, map[spec.key] ?? null, nowMs));
}

/**
 * The one line above the pass list.
 *
 * Percentage comes from `summarizeQueue`, so this bar and the Brand Board's
 * queue bar can never disagree about what a state is worth. Unknown counts as
 * queued there, never as complete.
 */
export interface PassRollup {
  total: number;
  alive: number;
  neverRan: number;
  stalled: number;
  failing: number;
  unknown: number;
  /** 0..100, from `queuedWork.progressFor` only. Never a clock. */
  percent: number;
  headline: string;
}

/** Map a pass state onto the four honest job states `queuedWork` models. */
export function passAsJob(h: PassHealth): QueuedJob {
  const status =
    h.state === "idle" ? "complete"
      : h.state === "failing" || h.state === "stalled" ? "failed"
        : h.state === "working" ? "running"
          : "queued"; // never_ran and unknown are OUTSTANDING work, never done
  return { id: h.spec.key, status, label: h.spec.label };
}

export function rollupPasses(list: PassHealth[] | null | undefined): PassRollup {
  const rows = (list || []).filter(Boolean);
  const total = rows.length;
  const neverRan = rows.filter((r) => r.state === "never_ran").length;
  const stalled = rows.filter((r) => r.state === "stalled").length;
  const failing = rows.filter((r) => r.state === "failing").length;
  const unknownCount = rows.filter((r) => r.state === "unknown").length;
  const alive = rows.filter((r) => r.state === "idle" || r.state === "working").length;
  const percent = summarizeQueue(rows.map(passAsJob)).percent;

  let headline: string;
  if (!total) headline = "No passes were measured, so nothing here says whether the system is running at all.";
  else if (neverRan || stalled || failing) {
    const parts: string[] = [];
    if (neverRan) parts.push(`${neverRan} never ran`);
    if (stalled) parts.push(`${stalled} stalled`);
    if (failing) parts.push(`${failing} failing`);
    headline = `${alive} of ${total} passes are doing their job — ${parts.join(", ")}.`;
  } else if (unknownCount) {
    headline = `${alive} of ${total} passes are doing their job; ${unknownCount} could not be judged because their backlog was not measured.`;
  } else {
    headline = `All ${total} passes have run and none has work it is failing to get through.`;
  }

  return { total, alive, neverRan, stalled, failing, unknown: unknownCount, percent, headline };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE FUNNEL — with real counts and honest denominators
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One step of the funnel.
 *
 * `of` is the load-bearing field. It names the step this one is a genuine
 * SUBSET of, and a drop is computed ONLY across that relationship. `of: null`
 * starts a new population — shot cards are not a subset of library assets, and
 * subtracting one from the other would produce a confident, meaningless number.
 *
 * `group` exists only to lay the screen out. `query` is the receipt.
 */
export interface FunnelStepSpec {
  key: string;
  label: string;
  /** What the number means, in one line. */
  meaning: string;
  of: string | null;
  group: string;
}

/**
 * The default funnel — assets → parsed → classified → enriched → cards briefed
 * → cards with footage → cuts queued → cuts rendered → approved → published.
 *
 * Four populations, not one chain, because they genuinely are four. Pretending
 * otherwise is how a "94% drop" gets reported between two tables that never had
 * a row in common.
 *
 * THE SEAM: `buildFunnel` takes specs as an argument. When
 * `src/lib/contentStages.ts` lands with the shared stage model, pass its steps
 * in here instead of this constant — nothing else in this file changes, and no
 * competing vocabulary is defined in the meantime.
 */
export const FUNNEL: ReadonlyArray<FunnelStepSpec> = [
  {
    key: "assets.total", label: "Assets in the library", group: "Library",
    meaning: "Every row in agent_media_assets — the raw pool everything is cut from.",
    of: null,
  },
  {
    key: "assets.parsed", label: "Parsed", group: "Library",
    meaning: "Clips the parser has actually opened: transcript and moments exist, so matching has something to read.",
    of: "assets.total",
  },
  {
    key: "assets.classified", label: "Classified", group: "Library",
    meaning: "Rows carrying a content_type. Every picker that filters on the taxonomy filters on this.",
    of: "assets.total",
  },
  {
    key: "assets.enriched", label: "Enriched", group: "Library",
    meaning: "Rows carrying asset_intelligence — the facts the intelligence editor joins against instead of guessing from keywords.",
    of: "assets.parsed",
  },
  {
    key: "cards.total", label: "Shot cards", group: "Shot cards",
    meaning: "Rows in shot_list_items — the planned shots.",
    of: null,
  },
  {
    key: "cards.briefed", label: "With a written brief", group: "Shot cards",
    meaning: "Cards carrying a filming instruction, so somebody knows what to shoot.",
    of: "cards.total",
  },
  {
    key: "cards.withFootage", label: "With footage attached", group: "Shot cards",
    meaning: "Cards that actually have raw assets on them. A brief with no footage produces nothing.",
    of: "cards.briefed",
  },
  {
    key: "cuts.total", label: "Cuts requested", group: "Cuts",
    meaning: "Every row in video_render_jobs — a cut somebody or some pass asked for.",
    of: null,
  },
  {
    key: "cuts.queued", label: "Queued now", group: "Cuts",
    meaning: "Jobs waiting for a renderer right now.",
    of: "cuts.total",
  },
  {
    key: "cuts.rendered", label: "Rendered", group: "Cuts",
    meaning: "Jobs that produced a file.",
    of: "cuts.total",
  },
  {
    key: "posts.total", label: "Pieces", group: "Publishing",
    meaning: "Every row in agent_social_posts — ideas, drafts and scheduled pieces alike.",
    of: null,
  },
  {
    key: "posts.withCreative", label: "With a creative", group: "Publishing",
    meaning: "Pieces that have media on them. Without this a piece is a caption and nothing else.",
    of: "posts.total",
  },
  {
    key: "posts.approved", label: "Approved", group: "Publishing",
    meaning: "Pieces a human has approved or scheduled.",
    of: "posts.withCreative",
  },
  {
    key: "posts.published", label: "Published", group: "Publishing",
    meaning: "Pieces that actually left the building.",
    of: "posts.approved",
  },
];

export interface FunnelRow {
  spec: FunnelStepSpec;
  count: Count;
  /** The step this one is measured against, or null for a new population. */
  denominator: Count | null;
  denominatorLabel: string | null;
  /** How many were lost between the denominator and here. Null when uncomputable. */
  drop: number | null;
  /** Percentage that SURVIVED, 0..100. Null when uncomputable. */
  survivedPct: number | null;
  /** TRUE when this step reports MORE rows than the set it is supposedly inside. */
  anomaly: boolean;
  /** A sentence, always. Names the drop, or names why there isn't one. */
  note: string;
}

/**
 * The funnel, with every drop stated and every gap admitted.
 *
 * Three things it refuses to do:
 *   · compute a drop from an unmeasured number (says which side is missing)
 *   · compute a drop between populations that are not nested (`of: null`)
 *   · silently absorb a subset that is BIGGER than its superset — that is a
 *     broken query or a broken assumption, and it is called out rather than
 *     rendered as a tidy 0% drop.
 */
export function buildFunnel(
  counts: Record<string, Count> | null | undefined,
  specs: ReadonlyArray<FunnelStepSpec> = FUNNEL,
): FunnelRow[] {
  const map = counts || {};
  const byKey = new Map(specs.map((s) => [s.key, s]));

  return specs.map((spec) => {
    const count = map[spec.key] ?? unknown(`count of ${spec.key}`, "this step was not queried");
    const parentSpec = spec.of ? byKey.get(spec.of) ?? null : null;
    const denominator = spec.of ? map[spec.of] ?? null : null;
    const denominatorLabel = parentSpec?.label ?? null;

    let drop: number | null = null;
    let survivedPct: number | null = null;
    let anomaly = false;
    let note: string;

    if (!spec.of) {
      note = isKnown(count)
        ? `${formatCount(count)} — the start of its own population, so there is no drop to state here.`
        : `${unknownNote(count)} It starts its own population, so there is no drop here either way.`;
    } else if (!isKnown(count) && !isKnown(denominator)) {
      note = `Neither this step nor "${denominatorLabel ?? spec.of}" was measured, so no drop can be shown — and none is guessed.`;
    } else if (!isKnown(count)) {
      note = `"${denominatorLabel ?? spec.of}" is ${formatCount(denominator)}, but this step was not measured. ${unknownNote(count)}`;
    } else if (!isKnown(denominator)) {
      note = `${formatCount(count)} here, but "${denominatorLabel ?? spec.of}" was not measured, so the drop into this step is unknown.`;
    } else {
      const whole = denominator!.value as number;
      const part = count.value as number;
      if (part > whole) {
        anomaly = true;
        note =
          `${part} here against ${whole} in "${denominatorLabel ?? spec.of}" — this step reports MORE rows than the set it is supposed to sit inside. ` +
          `One of the two queries is wrong; no drop is shown, because any number here would be fiction.`;
      } else {
        drop = whole - part;
        survivedPct = percentOf(count, denominator!);
        note = drop === 0
          ? `${part} of ${whole} — nothing is lost at this step.`
          : `${part} of ${whole} — ${drop} lost here (${survivedPct}% carry through).`;
      }
    }

    return { spec, count, denominator, denominatorLabel, drop, survivedPct, anomaly, note };
  });
}

/**
 * Where the funnel actually breaks — the biggest measured drop.
 *
 * Only ever considers steps whose BOTH sides were measured, so an unmeasured
 * step can never be reported as the bottleneck. Ties break on funnel order so
 * the same data always names the same step.
 */
export function worstDrop(rows: FunnelRow[] | null | undefined): FunnelRow | null {
  let worst: FunnelRow | null = null;
  for (const r of rows || []) {
    if (r.anomaly || r.drop === null || r.survivedPct === null) continue;
    if (r.drop <= 0) continue;
    if (!worst || (r.survivedPct as number) < (worst.survivedPct as number)) worst = r;
  }
  return worst;
}

// ═══════════════════════════════════════════════════════════════════════════
// WHAT IS BLOCKED, AND WHY — one sentence each, with a next step
// ═══════════════════════════════════════════════════════════════════════════

export type Severity = "blocked" | "degraded" | "watch";

export interface Blocker {
  id: string;
  severity: Severity;
  /** What is stopped, in one sentence, WITH the denominator. */
  headline: string;
  /** What to do about it. Never empty — enforced by the tests. */
  nextStep: string;
  /** The measurement behind the claim, so it can be argued with. */
  evidence: string;
}

/** A brand's footage position — clips it owns vs clips the parser has opened. */
export interface BrandFootage {
  brand: string;
  clips: Count;
  parsed: Count;
}

/** A piece whose publish attempt failed, grouped by the reason it gave. */
export interface PublishBlock {
  platform: string;
  posts: number;
  /** The verbatim error the rows carry. */
  error: string;
}

/** A brand string that pieces carry and no asset does — usually a typo. */
export interface OrphanBrand {
  brand: string;
  posts: number;
}

export interface BlockerInput {
  passes?: PassHealth[] | null;
  brandFootage?: BrandFootage[] | null;
  /** Drafts with no creative that nothing is currently working on. */
  postsWaitingCreative?: Count | null;
  /** Drafts the runner searched for and could not match. */
  postsNeedingFootage?: Count | null;
  orphanBrands?: OrphanBrand[] | null;
  cards?: { total?: Count | null; briefed?: Count | null; withFootage?: Count | null } | null;
  publishBlocks?: PublishBlock[] | null;
}

const SEVERITY_RANK: Record<Severity, number> = { blocked: 0, degraded: 1, watch: 2 };

/**
 * Everything currently stopping work, each as one sentence naming its own
 * denominator and its own next step.
 *
 * Order is severity then a stable per-check order — the same input always
 * produces the same list in the same order, so this screen can be diffed
 * against yesterday's screenshot.
 *
 * Nothing is inferred from a missing measurement. An unmeasured input produces
 * NO blocker rather than a speculative one; the funnel is where "we did not
 * look" is reported, and a fabricated blocker sends someone to fix a thing that
 * may not be broken.
 */
export function findBlockers(input?: BlockerInput | null): Blocker[] {
  const out: Blocker[] = [];
  const i = input || {};

  // ── A brand whose library the parser has never opened ────────────────────
  // The worst kind of blocker: everything downstream still "works", it just
  // produces stubs, so nothing errors and nobody is told.
  for (const b of i.brandFootage || []) {
    if (!isKnown(b.clips) || !isKnown(b.parsed)) continue;
    const clips = b.clips.value as number;
    const parsed = b.parsed.value as number;
    if (clips <= 0) continue;
    if (parsed === 0) {
      out.push({
        id: `footage:${b.brand}`,
        severity: "blocked",
        headline: `${b.brand} has ${clips} clip${clips === 1 ? "" : "s"} and ZERO of them are parsed, so every draft for this brand can only ever be a stub — matching reads transcripts and moments, and this brand has neither.`,
        nextStep: `Run Parse Footage on ${b.brand} — queue its clips into video_parse_jobs and let media-parser transcribe them.`,
        evidence: `${b.clips.query} → ${clips}; ${b.parsed.query} → 0.`,
      });
    } else if (parsed < clips) {
      out.push({
        id: `footage:${b.brand}`,
        severity: "watch",
        headline: `${b.brand} has ${clips} clips and ${parsed} are parsed — the ${clips - parsed} unparsed ones are invisible to every matcher, which searches transcripts and tags.`,
        nextStep: `Run Parse Footage on ${b.brand} to pick up the remaining ${clips - parsed}.`,
        evidence: `${b.clips.query} → ${clips}; ${b.parsed.query} → ${parsed}.`,
      });
    }
  }

  // ── Publishing that cannot happen because nothing is connected ───────────
  for (const p of i.publishBlocks || []) {
    if (!p || !p.posts) continue;
    out.push({
      id: `publish:${p.platform}`,
      severity: "blocked",
      headline: `${p.posts} piece${p.posts === 1 ? "" : "s"} failed to publish to ${p.platform} for the same reason every time: ${p.error}`,
      nextStep: `Connect ${p.platform} in /admin/seo-connections — until an active connection exists, every publish attempt will fail identically.`,
      evidence: `agent_social_posts.publish_error grouped → ${p.posts} rows carrying this exact text.`,
    });
  }

  // ── Pieces under a brand string no asset carries (the `wraptv` typo) ─────
  for (const o of i.orphanBrands || []) {
    if (!o || !o.posts) continue;
    out.push({
      id: `orphan:${o.brand}`,
      severity: "blocked",
      headline: `${o.posts} piece${o.posts === 1 ? "" : "s"} are filed under brand "${o.brand}", and NO asset in the library carries that string — so footage matching for them searches an empty pool and will always come back empty.`,
      nextStep: `Decide whether "${o.brand}" is a typo for a real brand or a brand with no library yet, then either correct the string on those ${o.posts} rows or upload footage under it.`,
      evidence: `agent_social_posts.brand = '${o.brand}' → ${o.posts} rows; agent_media_assets.brand = '${o.brand}' → 0 rows.`,
    });
  }

  // ── Shot cards written but never shot ────────────────────────────────────
  const cards = i.cards || {};
  if (isKnown(cards.briefed) && isKnown(cards.withFootage)) {
    const briefed = cards.briefed!.value as number;
    const withFootage = cards.withFootage!.value as number;
    const missing = briefed - withFootage;
    if (missing > 0) {
      out.push({
        id: "cards:no-footage",
        severity: "degraded",
        headline: `${missing} of ${briefed} shot cards have a written brief and no footage attached — the shots were planned and never filmed, or were filmed and never linked back.`,
        nextStep: `Open the shot list and attach footage to those ${missing} cards, or close the ones that are no longer going to be shot.`,
        evidence: `${cards.briefed!.query} → ${briefed}; ${cards.withFootage!.query} → ${withFootage}.`,
      });
    }
  }

  // ── Drafts waiting on a creative ─────────────────────────────────────────
  const waiting = i.postsWaitingCreative;
  if (isKnown(waiting) && (waiting!.value as number) > 0) {
    const n = waiting!.value as number;
    out.push({
      id: "posts:waiting-creative",
      severity: "degraded",
      headline: `${n} draft${n === 1 ? "" : "s"} have no creative and nothing is currently making one for them.`,
      nextStep: `Let the "Make creatives" pass work through them — it is rate limited per cycle on purpose, so check its backlog above is falling. If it is not, that pass is the problem, not the drafts.`,
      evidence: `${waiting!.query} → ${n}.`,
    });
  }

  const gaps = i.postsNeedingFootage;
  if (isKnown(gaps) && (gaps!.value as number) > 0) {
    const n = gaps!.value as number;
    out.push({
      id: "posts:needs-footage",
      severity: "degraded",
      headline: `${n} draft${n === 1 ? "" : "s"} were searched against the library and matched nothing, so they are parked rather than retried every five minutes.`,
      nextStep: `Upload footage for those ideas, or rewrite the angle so it is about something the library actually contains — attaching media clears the park automatically.`,
      evidence: `${gaps!.query} → ${n}.`,
    });
  }

  // ── The passes themselves ────────────────────────────────────────────────
  for (const p of i.passes || []) {
    if (p.state === "never_ran" || p.state === "stalled" || p.state === "failing") {
      out.push({
        id: `pass:${p.spec.key}`,
        severity: p.state === "never_ran" ? "blocked" : p.state === "failing" ? "blocked" : "degraded",
        headline: `${p.spec.label}: ${p.headline}`,
        nextStep: p.nextStep || `Open the last "Render Videos" workflow run and read this pass's step.`,
        evidence: `Marker: ${p.spec.marker}. Last stamp: ${p.lastRunAt ?? "never"}.`,
      });
    }
  }

  return out.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return s !== 0 ? s : a.id.localeCompare(b.id);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// RECENT FAILURES — with their actual error text
// ═══════════════════════════════════════════════════════════════════════════

export interface FailureRow {
  /** Which table/queue this came from. */
  where: string;
  id?: string | null;
  brand?: string | null;
  /** The error text EXACTLY as the row carries it. Never rewritten. */
  error?: string | null;
  at?: string | null;
}

export interface FailureGroup {
  key: string;
  where: string;
  /** How many rows carry this same failure. */
  count: number;
  /** The most recent occurrence's ISO timestamp, when the rows carry one. */
  lastAt: string | null;
  /** The FULL error text of the most recent occurrence, verbatim. */
  error: string;
  /** A short one-line form for the row header — the full text is still shown. */
  summary: string;
  brands: string[];
}

/**
 * A stable grouping key for an error.
 *
 * ffmpeg dumps its whole build configuration into every failure, so eleven
 * identical crashes look like eleven different errors and the real pattern —
 * "the same thing broke eleven times" — is invisible. Grouping is done on a
 * normalised prefix; the FULL text of the most recent occurrence is kept and
 * shown, because the point of this section is that the 401s were on the rows
 * the whole time and nobody could read them.
 */
export function failureKey(error?: string | null): string {
  const raw = String(error ?? "").trim();
  if (!raw) return "(no error text recorded)";
  return raw
    .replace(/\s+/g, " ")
    // uuids, urls, hex-ish ids and bare numbers vary per occurrence and are not
    // the error. Order matters: the widest patterns first, so a uuid is not
    // shredded into a dozen <n>s before it is recognised as one thing.
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/https?:\/\/\S+/gi, "<url>")
    // A token mixing letters and digits is an id, a path fragment or a build
    // flag — never the sentence that says what broke.
    .replace(/\b(?=[0-9a-z]*[0-9])(?=[0-9a-z]*[a-z])[0-9a-z]{3,}\b/gi, "<id>")
    .replace(/\d+/g, "<n>")
    .slice(0, 120);
}

/** A readable one-liner. Never empty — an unrecorded error says so. */
export function failureSummary(error?: string | null): string {
  const raw = String(error ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "No error text was recorded on the row — a failure nobody can read.";
  return raw.length > 140 ? `${raw.slice(0, 137)}…` : raw;
}

/**
 * Group failures, newest first, most frequent first within a timestamp tie.
 *
 * Deterministic: identical input always produces an identically ordered list.
 */
export function groupFailures(rows: FailureRow[] | null | undefined, limit = 8): FailureGroup[] {
  const groups = new Map<string, FailureGroup & { _order: number }>();
  let order = 0;

  for (const r of rows || []) {
    if (!r) continue;
    const where = String(r.where ?? "").trim() || "unknown source";
    const key = `${where}::${failureKey(r.error)}`;
    const at = String(r.at ?? "").trim() || null;
    const errText = String(r.error ?? "").trim();
    const brand = String(r.brand ?? "").trim();
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        key, where, count: 1, lastAt: at,
        error: errText || "No error text was recorded on the row.",
        summary: failureSummary(errText),
        brands: brand ? [brand] : [],
        _order: order++,
      });
      continue;
    }

    existing.count += 1;
    if (brand && !existing.brands.includes(brand)) existing.brands.push(brand);
    // Keep the text of the MOST RECENT occurrence — the oldest copy of a
    // recurring error is the least useful one to read.
    const newer =
      at !== null &&
      (existing.lastAt === null || Date.parse(at) > Date.parse(existing.lastAt));
    if (newer) {
      existing.lastAt = at;
      if (errText) {
        existing.error = errText;
        existing.summary = failureSummary(errText);
      }
    }
  }

  return [...groups.values()]
    .sort((a, b) => {
      const ta = a.lastAt ? Date.parse(a.lastAt) : Number.NEGATIVE_INFINITY;
      const tb = b.lastAt ? Date.parse(b.lastAt) : Number.NEGATIVE_INFINITY;
      if (tb !== ta) return tb - ta;
      if (b.count !== a.count) return b.count - a.count;
      return a._order - b._order;
    })
    .slice(0, Math.max(0, limit))
    .map(({ _order, ...g }) => g);
}

// ═══════════════════════════════════════════════════════════════════════════
// THE EMPTY STATES — four causes, four next steps, never one "No data"
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Which "nothing here" this is.
 *
 * They are kept apart on purpose, following `EditorBrainPanel`'s pattern: these
 * have four different fixes, and collapsing them into one message is the exact
 * failure this whole screen exists to stop. `all_clear` is the fifth and it is
 * a REAL answer, not an empty state dressed up — "measured, and nothing is
 * wrong" is the sentence an operator most needs to be able to trust.
 */
export type EmptyKind = "unread" | "never_ran" | "idle" | "unmeasured" | "all_clear";

export interface EmptyState {
  kind: EmptyKind;
  title: string;
  /** Names the cause AND the next step. Never "No data". */
  message: string;
}

export interface EmptyStateContext {
  /** What this section is about, e.g. "blockers", "failures". */
  subject?: string;
  /** The read error, when the query itself failed. */
  error?: string | null;
  /** The query that would have answered it, for `unmeasured`. */
  query?: string | null;
  /** How many rows were actually searched — the honest denominator. */
  searched?: number | null;
}

export function emptyState(kind: EmptyKind, ctx?: EmptyStateContext | null): EmptyState {
  const subject = String(ctx?.subject ?? "").trim() || "this section";
  const searched = Number.isFinite(Number(ctx?.searched)) ? Number(ctx?.searched) : null;

  switch (kind) {
    case "unread":
      return {
        kind,
        title: "The read failed",
        message:
          `${subject} could not be read at all${ctx?.error ? ` — ${String(ctx.error).trim()}` : ""}. ` +
          `That is a broken query, NOT an empty system: nothing below this line is safe to believe. Fix the read and reload.`,
      };
    case "never_ran":
      return {
        kind,
        title: "It has never run",
        message:
          `Nothing has ever stamped a row for ${subject}, so it has done nothing — not "found nothing to do", nothing at all. ` +
          `Check it has a step in .github/workflows/render-videos.yml; the worker container is not deployed, so the workflow is the only executor.`,
      };
    case "idle":
      return {
        kind,
        title: "Ran, and there was nothing to do",
        message:
          `${subject} ran and found no work outstanding${searched === null ? "" : ` — it looked at ${searched} row${searched === 1 ? "" : "s"}`}. ` +
          `This is the healthy kind of empty, and it is a different fact from "has never run".`,
      };
    case "unmeasured":
      return {
        kind,
        title: "Not measured",
        message:
          `${subject} was not queried, so it is shown as unknown rather than zero — a zero here would be a claim nobody checked. ` +
          `${ctx?.query ? `Run: ${String(ctx.query).trim()}.` : "Add the query that would answer it."}`,
      };
    default:
      return {
        kind: "all_clear",
        title: "Nothing is blocked",
        message:
          `${subject} was measured${searched === null ? "" : ` across ${searched} row${searched === 1 ? "" : "s"}`} and nothing is currently stopping work. ` +
          `This is a measured answer, not an absence of information.`,
      };
  }
}

/**
 * Pick the empty state for the blockers section.
 *
 * "We could not look" and "we looked and it is fine" must never render the
 * same, which is why this takes the read state explicitly rather than
 * inferring it from an empty array.
 */
export function blockersEmptyState(
  blockers: Blocker[] | null | undefined,
  opts?: { readFailed?: boolean; error?: string | null; measuredChecks?: number | null },
): EmptyState | null {
  if ((blockers || []).length) return null;
  if (opts?.readFailed) {
    return emptyState("unread", { subject: "The blocker checks", error: opts?.error ?? null });
  }
  const checks = Number.isFinite(Number(opts?.measuredChecks)) ? Number(opts?.measuredChecks) : null;
  if (checks === 0) {
    return emptyState("unmeasured", {
      subject: "The blocker checks",
      query: "none of the blocker inputs were measured",
    });
  }
  return emptyState("all_clear", { subject: "The blocker checks", searched: checks });
}

// ═══════════════════════════════════════════════════════════════════════════
// THE ONE LINE AT THE TOP
// ═══════════════════════════════════════════════════════════════════════════

export interface SystemHeadline {
  /** 0..100, from `queuedWork.progressFor` via `rollupPasses`. Never a clock. */
  percent: number;
  /** The sentence. Always set. */
  text: string;
  tone: "blocked" | "degraded" | "ok" | "unknown";
}

/**
 * "What is this system doing, and what is stopping it?" — in one line.
 *
 * Leads with the blocker when there is one, because a green headline over a
 * blocked system is the thing that let all of this hide.
 */
export function systemHeadline(
  passes: PassHealth[] | null | undefined,
  blockers: Blocker[] | null | undefined,
  worst?: FunnelRow | null,
): SystemHeadline {
  const roll = rollupPasses(passes);
  const list = blockers || [];
  const blocked = list.filter((b) => b.severity === "blocked");
  const degraded = list.filter((b) => b.severity === "degraded");

  if (!roll.total) {
    return {
      percent: 0,
      tone: "unknown",
      text: "Nothing was measured, so this screen cannot say whether the system is running. That is the read failing, not the system being idle.",
    };
  }
  if (blocked.length) {
    return {
      percent: roll.percent,
      tone: "blocked",
      text: `${blocked.length} thing${blocked.length === 1 ? " is" : "s are"} blocked right now. First: ${blocked[0].headline}`,
    };
  }
  if (degraded.length) {
    return {
      percent: roll.percent,
      tone: "degraded",
      text: `Nothing is hard-blocked, but ${degraded.length} thing${degraded.length === 1 ? " is" : "s are"} degraded. First: ${degraded[0].headline}`,
    };
  }
  const bottleneck = worst
    ? ` The biggest measured drop is into "${worst.spec.label}": ${worst.note}`
    : "";
  return { percent: roll.percent, tone: "ok", text: `${roll.headline}${bottleneck}` };
}

/**
 * The bar's fill for one pass row.
 *
 * Deliberately a one-line wrapper over `queuedWork.progressFor` rather than its
 * own arithmetic: there must be exactly ONE place in this codebase that decides
 * how full a bar is, and it must be the one that takes no clock.
 */
export function passPercent(h: PassHealth): number {
  return progressFor(passAsJob(h));
}
