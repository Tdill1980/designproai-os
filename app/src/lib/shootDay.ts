/**
 * shootDay — "what are we actually filming today?"
 *
 * The Shot List holds 97 shots, 31 of them overdue. That is a backlog, not a
 * plan, and handing it to a crew is why the team is drowning: everything is
 * on the list, so nothing is today's job.
 *
 * This turns the board into a CALL SHEET — the handful of shots dated today,
 * grouped under the script whose words get spoken, so a camera operator opens
 * one short list and knows what to shoot and what to say.
 *
 * ── NO NEW CONCEPT ─────────────────────────────────────────────────────────
 * "On today's list" is `due_date` = today. Deliberately not a new column:
 * `due_date` is already the shoot date the Shot List sorts by, and marking a
 * shot for today already makes it self-advance to Uploaded when footage lands
 * (the dated-shot behaviour). A second "today" flag would drift from it within
 * a week.
 *
 * ── LOCAL DAYS, ANCHORED AT NOON ───────────────────────────────────────────
 * `due_date` is a timestamptz, so "today" has to be decided in the operator's
 * OWN timezone or a shoot slides a day. New marks are stamped at local NOON —
 * far enough from both midnights that no DST shift or UTC conversion can push
 * the date onto the wrong day. Locked by `tests/shoot-day.test.ts`.
 */

import type { ShotRow } from "./shotScriptLink";
import { resolveScript, isShot, needsScript } from "./shotScriptLink";

/** Local-calendar-day key (not UTC) — the only way days are compared here. */
export function localDayKey(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function isToday(value: string | Date | null | undefined, now = new Date()): boolean {
  const k = localDayKey(value);
  return !!k && k === localDayKey(now);
}

/** Dated before today and not finished — the backlog, kept out of today's list. */
export function isOverdue(value: string | Date | null | undefined, now = new Date()): boolean {
  const k = localDayKey(value);
  const today = localDayKey(now)!;
  return !!k && k < today;
}

/**
 * The timestamp written when someone puts a shot on today's list.
 * Local noon — see the header. Never `new Date()` at the current time, which
 * lands near midnight for late-night planning and reads as yesterday.
 */
export function todayStamp(now = new Date()): string {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

export interface CallSheetGroup {
  /** The script whose words are spoken. Null = shots with no script. */
  script: ShotRow | null;
  shots: ShotRow[];
}

export interface CallSheet {
  groups: CallSheetGroup[];
  total: number;
  /** Video shots on today's list with no script — they cannot be filmed well. */
  missingScript: ShotRow[];
  /** Shots that already have footage attached. */
  shot: number;
}

/**
 * Build today's call sheet: today's shots, grouped by the script they are
 * filmed from, scripted groups first so the crew reads words-then-shots.
 *
 * Only SHOTS appear — a MASTER SCRIPT row is not itself a thing you film,
 * so a script dated today never shows up as a task.
 */
export function buildCallSheet(rows: ShotRow[], now = new Date()): CallSheet {
  const all = rows || [];
  const scripts = all.filter((r) => !isShot(r));
  const todays = all.filter((r) => isShot(r) && isToday(r.due_date as string, now));

  const byScript = new Map<string, CallSheetGroup>();
  const unscripted: ShotRow[] = [];

  for (const shot of todays) {
    const { script } = resolveScript(shot, scripts);
    if (!script) { unscripted.push(shot); continue; }
    if (!byScript.has(script.id)) byScript.set(script.id, { script, shots: [] });
    byScript.get(script.id)!.shots.push(shot);
  }

  const groups: CallSheetGroup[] = [...byScript.values()];
  if (unscripted.length) groups.push({ script: null, shots: unscripted });

  return {
    groups,
    total: todays.length,
    // A photo needs no words; a video with no script is a crew standing around.
    missingScript: unscripted.filter((s) => needsScript(s)),
    shot: todays.filter((s) => (s.raw_asset_ids?.length ?? 0) > 0).length,
  };
}

/** Plain-text call sheet — for pasting into the crew's group chat. */
export function callSheetText(sheet: CallSheet, now = new Date()): string {
  const date = new Date(now).toLocaleDateString(undefined, {
    weekday: "long", month: "short", day: "numeric",
  });
  const lines = [`SHOOT LIST — ${date} (${sheet.total} shot${sheet.total === 1 ? "" : "s"})`, ""];
  for (const g of sheet.groups) {
    lines.push(g.script ? `— ${String(g.script.shot_title || "").trim()}` : "— No script");
    for (const s of g.shots) {
      const done = (s.raw_asset_ids?.length ?? 0) > 0 ? " ✓" : "";
      lines.push(`   • ${String(s.shot_title || "").trim()}${done}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
