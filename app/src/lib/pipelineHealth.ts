/**
 * pipelineHealth — is the content system actually producing anything?
 *
 * Owner, 2026-08-05: "I have zero control. Nothing works consistently."
 *
 * The diagnosis is not that things break. It is that they break SILENTLY.
 * Every failure found today reported nothing at all:
 *
 *   - the media-parser died on one file and retried it 110 times over 12 days
 *   - the Content Director showed July 15 drafts and printed its query LIMIT
 *     as if it were the inventory
 *   - the Brand Board fed an mp4 to an <img>, which paints nothing
 *   - the clip picker offered 9% of the library, and a short list looks
 *     exactly like a small library
 *
 * Two pages are already called "Health" (`/admin/health`,
 * `/admin/system-health`) and NEITHER references video_parse_jobs,
 * video_render_jobs or media_sources. Nothing watched the things that make
 * content.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A producer is judged on OUTPUT, not on whether it answers a ping. A worker
 * that is up, claiming jobs and completing none is exactly what happened here,
 * and a health check that asked "are you alive?" would have said yes for
 * twelve days. So every signal below asks: WHEN DID THIS LAST PRODUCE
 * SOMETHING REAL? Locked by `tests/pipeline-health.test.ts`.
 */

export type HealthLevel = "ok" | "warn" | "down";

export interface HealthSignal {
  key: string;
  label: string;
  /** What this actually measures, in plain words. */
  measures: string;
  /** Hours since the last real output. Null = never produced anything. */
  hoursSinceOutput: number | null;
  /** Above this many hours it is a warning. */
  warnAfterHours: number;
  /** Above this many hours it is down. */
  downAfterHours: number;
  /** Work waiting to be done, where the producer has a queue. */
  queued?: number;
  /** Jobs stuck mid-flight — claimed but never finished. */
  stuck?: number;
  /** What to do about it, when it is not ok. */
  remedy?: string;
}

export interface HealthVerdict {
  level: HealthLevel;
  /** One line stating the actual state, with the number in it. */
  summary: string;
}

function human(hours: number | null): string {
  if (hours == null) return "never";
  if (hours < 1) return "under an hour ago";
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * Judge one signal.
 *
 * A producer with NOTHING queued and no recent output is idle, not broken —
 * calling that "down" would cry wolf every quiet weekend and train everyone to
 * ignore the board. It only escalates when there is work waiting, or when
 * something is stuck mid-flight.
 */
export function judge(signal: HealthSignal): HealthVerdict {
  const waiting = signal.queued ?? 0;
  const stuck = signal.stuck ?? 0;
  const since = signal.hoursSinceOutput;

  if (stuck > 0) {
    return {
      level: "down",
      summary: `${stuck} job${stuck === 1 ? "" : "s"} stuck mid-flight — claimed but never finished. Last output ${human(since)}.`,
    };
  }

  // Work waiting and nothing coming out is the real failure mode: it is
  // exactly what 12 days of a crashlooping parser looked like.
  if (waiting > 0 && (since == null || since >= signal.downAfterHours)) {
    return {
      level: "down",
      summary: `${waiting} job${waiting === 1 ? "" : "s"} waiting and nothing produced since ${human(since)}.`,
    };
  }

  if (waiting > 0 && since != null && since >= signal.warnAfterHours) {
    return {
      level: "warn",
      summary: `${waiting} waiting, last output ${human(since)}.`,
    };
  }

  if (since == null) {
    return { level: "warn", summary: "Has never produced anything." };
  }

  if (since >= signal.downAfterHours) {
    return { level: "warn", summary: `Quiet — nothing produced since ${human(since)}, but nothing is waiting either.` };
  }

  if (since >= signal.warnAfterHours) {
    return { level: "warn", summary: `Last output ${human(since)}.` };
  }

  return {
    level: "ok",
    summary: waiting > 0
      ? `Working — ${waiting} in the queue, last output ${human(since)}.`
      : `Healthy — last output ${human(since)}.`,
  };
}

/** Worst level across all signals — what the header badge shows. */
export function overall(signals: HealthSignal[]): HealthLevel {
  const levels = (signals || []).map((s) => judge(s).level);
  if (levels.includes("down")) return "down";
  if (levels.includes("warn")) return "warn";
  return "ok";
}

export function hoursSince(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now.getTime() - t) / 36e5);
}

export const LEVEL_STYLE: Record<HealthLevel, { label: string; chip: string; dot: string }> = {
  ok: { label: "Running", chip: "bg-emerald-50 text-emerald-700 border-emerald-300", dot: "bg-emerald-500" },
  warn: { label: "Attention", chip: "bg-amber-50 text-amber-800 border-amber-300", dot: "bg-amber-500" },
  down: { label: "Not producing", chip: "bg-red-50 text-red-700 border-red-300", dot: "bg-red-500" },
};
