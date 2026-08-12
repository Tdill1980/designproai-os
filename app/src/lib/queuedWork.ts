/**
 * queuedWork — WHAT IS ACTUALLY IN FLIGHT, and how far along it honestly is.
 *
 * Owner's ask on the Brand Board: a "Queued work" button per brand, showing the
 * design and render jobs currently running, with a progress bar.
 *
 * The reason this is a module and not four lines inside the board: the progress
 * bar is the part that lies. Every version of this UI anyone builds by instinct
 * animates the bar off the clock — job started 90 seconds ago, a render takes
 * three minutes, so paint 50%. That bar keeps creeping on a job whose worker
 * died twenty minutes ago, and the operator sits watching it because a moving
 * bar reads as "working". This is the same failure the Brand Board already had
 * once in a different costume: a view that looked healthy while nothing was
 * happening behind it, and twelve days of a dead parser went unnoticed because
 * nothing on screen ever said so.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * PROGRESS IS DERIVED FROM STATUS AND NOTHING ELSE. No elapsed time, no
 * interpolation, no easing toward 99%. The bar has four honest positions,
 * because the database has four honest states — `queued`, `rendering`,
 * `complete`, `failed` (measured on `video_render_jobs`) — and a fifth position
 * would have to be invented.
 *
 * A bar that sits still at 50% for ten minutes is telling the truth: the job
 * has been picked up and we do not know more than that. That stillness is the
 * signal that something is wrong, and it is only a signal because we refused to
 * fake motion. `progressFor` therefore takes no clock and this module imports
 * no date — the honesty is structural, not a convention someone has to
 * remember.
 *
 * ── WHY `failed` IS 100 ─────────────────────────────────────────────────────
 * A failed job is FINISHED — nothing further will happen to it. Leaving its bar
 * part-filled implies work still to come and drags the queue average down
 * forever, so a brand with one dead job would never read as done. The bar shows
 * position, the status shows outcome; the UI colours failure red rather than
 * hiding it in a short bar.
 *
 * ── UNKNOWN MEANS QUEUED, NEVER COMPLETE ────────────────────────────────────
 * A missing, null or unrecognised status is treated as `queued`. Erring toward
 * "not started" leaves work visible in the queue where someone will chase it;
 * erring toward "complete" silently deletes it from the operator's view, which
 * is the worse failure and the one this whole surface exists to prevent.
 *
 * Pure by design: no database, no network, no clock.
 */

/** What kind of work this is — the three producers a brand can have in flight. */
export type QueuedKind = "render" | "creative" | "panel";

export interface QueuedJob {
  id: string;
  brand?: string | null;
  /** What a human should read on the row — never an id, never a raw status. */
  label?: string | null;
  /** Raw status straight from the row. Tolerated in any case, or missing. */
  status?: string | null;
  /** ISO timestamp, kept for SORTING and display only — never for progress. */
  createdAt?: string | null;
  kind?: QueuedKind | null;
}

/**
 * Statuses that mean the work is finished and succeeded.
 *
 * `video_render_jobs` writes `complete`; other producers in this codebase have
 * historically written `completed`, `done` or `ready` for the same thing, so
 * all four are accepted rather than one of them silently reading as `queued`.
 */
const DONE = new Set(["complete", "completed", "done", "ready", "succeeded", "success"]);

/** Statuses that mean the work is finished and did not succeed. */
const FAILED = new Set(["failed", "error", "errored", "cancelled", "canceled", "dead"]);

/**
 * Statuses that mean a worker has picked the job up.
 *
 * These get 50 — a single flat "in progress" position. Splitting them into 30 /
 * 60 / 80 would be inventing detail the row does not carry.
 */
const RUNNING = new Set(["rendering", "processing", "running", "in_progress", "active", "working"]);

/** Normalise for comparison without asserting anything about the value. */
function norm(status: string | null | undefined): string {
  return String(status ?? "").trim().toLowerCase();
}

/** Is this job still expected to move? */
export function isRunning(job: QueuedJob | null | undefined): boolean {
  const s = norm(job?.status);
  return !DONE.has(s) && !FAILED.has(s);
}

/** Did this job end badly? Failure is stated, never folded into "done". */
export function isFailed(job: QueuedJob | null | undefined): boolean {
  return FAILED.has(norm(job?.status));
}

/** Did this job end well? */
export function isDone(job: QueuedJob | null | undefined): boolean {
  return DONE.has(norm(job?.status));
}

/**
 * How full the bar is, 0..100 — from STATUS ONLY.
 *
 * Four positions, one per real state. Deliberately not a function of time: see
 * the header. If this ever gains a `now` parameter, the bar has started lying.
 *
 *   queued     5   — visible as "we have it", clearly not underway
 *   running   50   — a worker has it; we genuinely know nothing finer
 *   complete 100
 *   failed   100   — finished, just badly
 */
export function progressFor(job: QueuedJob | null | undefined): number {
  const s = norm(job?.status);
  if (DONE.has(s)) return 100;
  if (FAILED.has(s)) return 100;
  if (RUNNING.has(s)) return 50;
  // Everything else — `queued`, empty, null, or a status this build has never
  // heard of. Queued, never complete.
  return 5;
}

export interface QueueSummary {
  total: number;
  running: number;
  done: number;
  failed: number;
  /** Mean of progressFor across the queue. 0 for an empty queue, not 100. */
  percent: number;
}

/**
 * Roll a brand's queue into the numbers the button and bar need.
 *
 * `percent` is the plain mean of the per-job positions, which inherits their
 * honesty: it cannot drift upward on its own, and it only moves when a job's
 * status actually changes in the database.
 *
 * An empty queue is 0%, not 100%. "Nothing queued" and "everything finished"
 * are different facts and a full bar would state the second when only the first
 * is known.
 */
export function summarizeQueue(jobs: QueuedJob[] | null | undefined): QueueSummary {
  const list = (jobs || []).filter(Boolean);
  const total = list.length;
  if (!total) return { total: 0, running: 0, done: 0, failed: 0, percent: 0 };

  let running = 0;
  let done = 0;
  let failed = 0;
  let sum = 0;

  for (const job of list) {
    if (isFailed(job)) failed += 1;
    else if (isDone(job)) done += 1;
    else running += 1; // queued and in-flight both count as outstanding work
    sum += progressFor(job);
  }

  return { total, running, done, failed, percent: Math.round(sum / total) };
}

/**
 * The button's own label — the whole queue in one line.
 *
 * Empty says "Nothing queued" rather than "0 jobs": a zero reads as a broken
 * counter, and the operator needs to be able to tell an idle queue from a
 * failed fetch at a glance.
 *
 * Failures are always named. A queue that reports only its running count while
 * three jobs are dead is how a stalled brand goes a week without anyone
 * noticing.
 */
export function queueLabel(jobs: QueuedJob[] | null | undefined): string {
  const { total, running, failed, done } = summarizeQueue(jobs);
  if (!total) return "Nothing queued";

  const parts: string[] = [];
  if (running) parts.push(`${running} ${running === 1 ? "job" : "jobs"} running`);
  if (done) parts.push(`${done} done`);
  if (failed) parts.push(`${failed} failed`);
  // Every job is in exactly one bucket, so this cannot be empty once total > 0.
  return parts.join(" · ");
}

/** Human wording for one row's state. Unknown says so instead of guessing. */
export function statusLabel(job: QueuedJob | null | undefined): string {
  const s = norm(job?.status);
  if (DONE.has(s)) return "Complete";
  if (FAILED.has(s)) return "Failed";
  if (RUNNING.has(s)) return "Running";
  if (!s) return "Queued";
  // A status the UI does not model. Show the raw value rather than flattening
  // it to "Queued" — the operator can then report a word we have never seen.
  return s === "queued" ? "Queued" : `Queued (${s})`;
}
