/**
 * uploadProgress — an upload's stages, and whether it is HONESTLY done.
 *
 * Owner relaying an admin, 2026-08-07: "on the cards that he uploads to there's
 * no progress bar, no indication that it's done."
 *
 * What the Brand Board upload actually did: flipped one `busy` boolean, put the
 * word "Uploading…" on a button, and — on success — closed the dialog and fired
 * a toast. A three-file upload therefore looked identical at 5% and at 95%, and
 * the only evidence it had finished was a notification that may already have
 * gone. On a slow connection the honest reading of that screen was "I don't
 * know if anything is happening", which is exactly the state a progress bar
 * exists to remove.
 *
 * ── THIS IS `queuedWork`, NOT A SECOND PROGRESS MODEL ──────────────────────
 * Every function here is built on `progressFor` / `summarizeQueue` /
 * `statusLabel`, and an `UploadStage` IS a `QueuedJob`. That is deliberate: the
 * temptation with an upload is to animate the bar off the clock or off bytes we
 * are guessing at, and `queuedWork` already refuses to, structurally — it takes
 * no clock and this module imports no date either.
 *
 * Supabase's storage client reports no byte progress, so PER-FILE completion is
 * the finest granularity that is actually true. Three files means four honest
 * steps (three uploads plus the row that makes them a card), and the bar moves
 * when one of them really lands. A file that takes ninety seconds leaves the
 * bar still — and that stillness is the signal, not a defect.
 *
 * ── DONE MEANS EVERY STAGE FINISHED ────────────────────────────────────────
 * `uploadDoneness` returns `done` only when every stage `isDone`. A stage whose
 * status this build has never seen is not done — `queuedWork` reads an unknown
 * status as queued, and that inheritance is the whole point: a new status
 * string introduced upstream can make this panel say "still going", never
 * "finished". Erring toward unfinished leaves the operator looking at it; the
 * other error tells them their work is safe when it may not be.
 *
 * Pure by design: no network, no storage client, no clock.
 * Locked by `tests/upload-progress.test.ts`.
 */

import {
  isDone, isFailed, isRunning, progressFor, statusLabel, summarizeQueue,
  type QueuedJob,
} from "./queuedWork";

/** The four statuses this module WRITES. It reads anything (see the header). */
export type UploadStageStatus = "queued" | "running" | "complete" | "failed";

export interface UploadStage extends QueuedJob {
  id: string;
  label: string;
  status: string;
  /** Why it failed, verbatim from the client. Never invented, never guessed. */
  detail?: string | null;
}

/** The id of the final stage — the row that turns files into a board card. */
export const SAVE_STAGE_ID = "save-card";

/**
 * The stages one upload will move through, all `queued`.
 *
 * The SAVE stage is listed even though it is fast, because it is the step that
 * can fail on its own (RLS, a bad status, a dropped connection) after every
 * byte has landed. Hiding it would let "all files uploaded" read as "it's on
 * the board" when the card does not exist.
 */
export function buildUploadStages(fileNames: string[] | null | undefined): UploadStage[] {
  const files = (fileNames || []).map((n) => String(n ?? "").trim()).filter(Boolean);
  const stages: UploadStage[] = files.map((name, i) => ({
    id: `file:${i}:${name}`,
    label: name,
    status: "queued" as const,
    kind: "creative" as const,
  }));
  stages.push({
    id: SAVE_STAGE_ID,
    // Says what it produces, not what it calls. "Insert row" means nothing to
    // the person watching; "the card" is the thing they came here to make.
    label: files.length ? "Put the card on the board" : "Save the card",
    status: "queued",
    kind: "creative",
  });
  return stages;
}

/**
 * Set one stage's status. Returns a NEW array — nothing is mutated, so React
 * state updates cannot silently share a stage object between renders.
 *
 * An id that matches nothing is returned unchanged rather than appended: a
 * typo'd id must not invent a stage that then counts toward "done".
 */
export function setStageStatus(
  stages: UploadStage[] | null | undefined,
  id: string,
  status: UploadStageStatus,
  detail?: string | null,
): UploadStage[] {
  return (stages || []).map((s) =>
    s.id === id ? { ...s, status, detail: detail ?? null } : s,
  );
}

export type UploadState = "idle" | "working" | "done" | "failed";

export interface UploadDoneness {
  state: UploadState;
  /** 0..100, straight from `summarizeQueue` — status only, never a clock. */
  percent: number;
  /** One sentence a human can act on. Always names counts, never adjectives. */
  line: string;
  /** The stage that failed, when one did. */
  failed: UploadStage | null;
}

/**
 * Where this upload stands, in one object.
 *
 * The ordering of the checks matters: FAILURE is read before completion, so an
 * upload with two finished files and one dead one can never report "done".
 * `queuedWork` gives a failed job a full bar on purpose (it is finished, just
 * badly), which means percent alone cannot distinguish the two — the state
 * does, and the UI colours it red.
 */
export function uploadDoneness(stages: UploadStage[] | null | undefined): UploadDoneness {
  const list = (stages || []).filter(Boolean);
  if (!list.length) {
    return { state: "idle", percent: 0, line: "Nothing uploading yet.", failed: null };
  }

  const { total, done, failed: failedCount, percent } = summarizeQueue(list);
  const failed = list.find(isFailed) || null;

  if (failed) {
    const detail = failed.detail ? ` — ${failed.detail}` : "";
    const remaining = total - done - failedCount;
    return {
      state: "failed",
      percent,
      // Names what did NOT run. A failure that only reports itself leaves the
      // operator to work out whether the rest went through.
      line: `Stopped on “${failed.label}”${detail}. ${done} of ${total} step${total === 1 ? "" : "s"} finished`
        + (remaining > 0 ? `; ${remaining} never started.` : "."),
      failed,
    };
  }

  if (done === total) {
    const files = total - 1; // every stage but the save stage is a file
    return {
      state: "done",
      percent: 100,
      line: files > 0
        ? `Done — ${files} file${files === 1 ? "" : "s"} uploaded and the card is on the board.`
        : "Done — the card is on the board.",
      failed: null,
    };
  }

  const active = list.find((s) => isRunning(s) && !isQueuedOnly(s));
  return {
    state: "working",
    percent,
    line: active
      ? `${done} of ${total} done · ${active.label}`
      : `${done} of ${total} done · waiting to start`,
    failed: null,
  };
}

/** A stage nothing has picked up yet — `progressFor` puts it at 5, not 50. */
function isQueuedOnly(stage: UploadStage): boolean {
  return progressFor(stage) < 50;
}

/**
 * The label for one stage row.
 *
 * Delegates to `queuedWork.statusLabel`, which prints an unrecognised status
 * as `Queued (<raw>)` rather than flattening it — so a word this build has
 * never seen reaches the operator instead of being quietly normalised away.
 */
export function stageStatusLabel(stage: UploadStage | null | undefined): string {
  return statusLabel(stage);
}

/** Re-exported so a caller never has to reach past this module for the basics. */
export { progressFor, isDone, isFailed };
