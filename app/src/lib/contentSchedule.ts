/**
 * contentSchedule — THE TWO WAYS A PIECE GETS A DATE, and the guard rails on both.
 *
 * Owner, 2026-08-06: "we can click schedule now, if we click schedule we can
 * either pick an exact date and time and it will show up there on the content
 * calendar per social media platform, or we can click allow AI to schedule and
 * it's going to find a spot for it and it's going to place it."
 *
 * Two modes, one button. That is the whole product surface, and it maps exactly
 * onto a contract the server already honours: `marketing-agent director_approve`
 * schedules to `scheduled_date` when you pass one, and calls `proposeSlot()`
 * against the weekly programming grid when you don't. So this module deliberately
 * does NOT decide when anything publishes. Picking a slot is the server's job and
 * it must stay the server's job — the grid has to reason about what is already
 * taken across every brand and platform, and a browser cannot see that. A second
 * scheduler in the client would be a second opinion, and two schedulers that
 * disagree is how a channel ends up with three posts at 9am and nothing all week.
 *
 * What this module IS:
 *   1. The VALIDATION the browser owes the operator BEFORE the call goes out, so
 *      an impossible schedule is caught while it is still a form field and not
 *      after it has already published.
 *   2. The SENTENCE shown next to the button, so the operator knows what pressing
 *      it will do — the difference between "Publishes Thu 14 Aug, 9:00 am" and
 *      "the grid will find a spot" is the entire choice they are making.
 *   3. One thin invoke wrapper that speaks the server's error vocabulary, notably
 *      the 422 doctrine gate, which must arrive at the UI as an OFFER TO OVERRIDE
 *      rather than as a dead end.
 *
 * ── THE FAILURE THIS EXISTS TO PREVENT ─────────────────────────────────────
 * A date in the past is not "a schedule that already elapsed". `content-deploy`
 * sweeps every 5 minutes for `status IN ('approved','scheduled') AND
 * scheduled_date <= now()`, so a past `scheduled_date` is IMMEDIATELY DUE and the
 * post goes live within five minutes. Fat-finger the year, or open the picker on
 * a stale default, and pressing "Schedule" publishes instantly — the exact
 * opposite of what the word means. The server cannot rescue this either: it takes
 * an explicit `scheduled_date` at face value, precisely because an operator is
 * sometimes entitled to say "go now". So the guard has to live where the human
 * is, and it has to BLOCK rather than warn.
 *
 * Validation and description are PURE — no network, no database, and no clock
 * except the one handed in. `now` is a parameter, never `Date.now()` at the point
 * of decision, so the rules can be tested against fixed instants instead of
 * against whatever day the CI box thinks it is.
 */

import { supabase } from "@/integrations/supabase/client";
import { CHANNELS, type ChannelKey } from "@/lib/contentDoctrine";

// ─── The request ─────────────────────────────────────────────────────────────

/**
 * "exact" = the human picked the moment. "ai" = the weekly programming grid
 * picks it, server-side, from the first slot that is free for this brand and
 * platform.
 */
export type ScheduleMode = "exact" | "ai";

export interface ScheduleRequest {
  postId: string;
  mode: ScheduleMode;
  /**
   * The chosen moment, in exact mode. Accepts whatever a `datetime-local` input
   * produces ("2026-08-14T09:00", parsed in the operator's own timezone) as well
   * as a full ISO string — both are what real callers actually have in hand.
   */
  when?: string | null;
  /**
   * An explicit human override of the doctrine gate. Never set by this module;
   * it may only ever arrive from a person who read the reasons and chose anyway.
   */
  force?: boolean;
}

export interface ScheduleValidation {
  /** False means DO NOT send. Every reason is something the human must fix. */
  ok: boolean;
  /** Blocking problems, in plain language. */
  reasons: string[];
  /** Worth saying out loud, but never a reason to stop. */
  warnings: string[];
}

// ─── How far out is "surely a typo" ──────────────────────────────────────────

/**
 * A year and a day. Beyond this, a date is far more likely to be a mistyped year
 * than a plan — but scheduling a launch eleven months out is a legitimate thing
 * to want, so this can only ever raise an eyebrow, never a hand.
 */
export const FAR_FUTURE_DAYS = 366;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse a picked moment, returning null for anything unreadable.
 *
 * Deliberately permissive about FORMAT and strict about RESULT: the caller may
 * hand us a datetime-local value, an ISO string, or whatever a paste produced,
 * and the only thing that matters is whether it resolves to a real instant.
 */
function parseWhen(when: string | null | undefined): Date | null {
  const raw = String(when ?? "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Judge a schedule request before it is sent.
 *
 * Pure. `now` is injected so the rules are testable against a fixed instant —
 * a clock-dependent test of a scheduling rule is a test that passes until the
 * day it doesn't.
 */
export function validateSchedule(
  req: ScheduleRequest | null | undefined,
  now: Date = new Date(),
): ScheduleValidation {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!req) {
    return { ok: false, reasons: ["Nothing to schedule."], warnings };
  }

  // RULE 0 — THERE HAS TO BE A POST.
  // Without an id the server answers 400 and the operator sees a generic
  // failure for what is really a wiring bug. Naming it here keeps the mistake
  // legible instead of turning it into a mystery.
  if (!String(req.postId || "").trim()) {
    reasons.push("No post selected — there is nothing to put on the calendar.");
  }

  const picked = parseWhen(req.when);

  if (req.mode === "exact") {
    // RULE 1 — EXACT MEANS EXACT.
    // "Pick a date and time" is the entire promise of this mode. Sending it with
    // no date does not fail — it silently becomes AI mode server-side, because
    // director_approve falls through to proposeSlot() when scheduled_date is
    // absent. The operator would get a slot they never chose and no error to
    // explain it, which is worse than a refusal.
    if (!String(req.when ?? "").trim()) {
      reasons.push("Pick a date and time, or switch to letting the programming grid choose.");
    } else if (!picked) {
      // RULE 2 — AN UNREADABLE DATE IS NOT A DATE.
      // `new Date("14/08/2026")` is Invalid Date, and an invalid date sent as
      // scheduled_date writes garbage into the row rather than failing loudly.
      // Catch it while it is still a string in a form field.
      reasons.push(`"${req.when}" isn't a date the calendar can read — use the picker.`);
    } else {
      const ms = picked.getTime();
      const nowMs = now.getTime();

      // RULE 3 — THE PAST PUBLISHES IMMEDIATELY. THIS IS THE IMPORTANT ONE.
      // content-deploy's cron sweeps every 5 minutes for approved/scheduled rows
      // with scheduled_date <= now(), so a past date is not "already missed" —
      // it is DUE, and the post goes out within 5 minutes. Picking yesterday by
      // accident means posting instantly, which is the opposite of scheduling.
      // A moment equal to `now` is treated the same, because by the time the
      // request lands it is already in the past.
      if (ms <= nowMs) {
        reasons.push(
          `${humanWhen(picked)} is in the past. A past date is immediately due — ` +
            `content-deploy's 5-minute sweep would publish this straight away, not schedule it. ` +
            `Pick a future time, or post it now on purpose.`,
        );
      } else if (ms - nowMs > FAR_FUTURE_DAYS * MS_PER_DAY) {
        // RULE 4 — A YEAR OUT IS LEGAL, AND USUALLY A TYPO.
        // Almost always a mistyped year (2027 for 2026). But scheduling a real
        // launch that far ahead is a legitimate thing to do, and blocking a
        // legal action because it is unusual teaches people to distrust the
        // form. Say it, don't stop it.
        warnings.push(
          `${humanWhen(picked)} is more than a year out — worth double-checking the year.`,
        );
      }
    }
  } else {
    // RULE 5 — IN AI MODE THE DATE IS IGNORED, SO SAY SO.
    // The server only reads scheduled_date when we send it, and AI mode
    // deliberately doesn't. If the operator filled the picker and then switched
    // modes, their date silently evaporates — and they will believe it was
    // honoured until the post turns up somewhere else entirely.
    if (String(req.when ?? "").trim()) {
      warnings.push(
        "The date you picked will be ignored — the programming grid chooses the slot in this mode.",
      );
    }
  }

  return { ok: reasons.length === 0, reasons, warnings };
}

// ─── The sentence next to the button ─────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "Thu 14 Aug, 9:00 am", in the operator's OWN timezone.
 *
 * Local, not UTC, on purpose: the person picked this moment on their own clock,
 * and reading a UTC time back to them is how somebody schedules a post for 2am
 * while believing they chose 7pm. Hand-formatted rather than `toLocaleString`
 * so the output cannot shift with the runtime's ICU data.
 */
function humanWhen(d: Date): string {
  const h24 = d.getHours();
  const hour = h24 % 12 === 0 ? 12 : h24 % 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const suffix = h24 < 12 ? "am" : "pm";
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}, ${hour}:${minutes} ${suffix}`;
}

/**
 * One plain sentence describing what pressing the button will do.
 *
 * This is the confirmation step. The two modes do genuinely different things,
 * and a button that reads "Schedule" in both cases tells the operator nothing —
 * the sentence is what makes the choice visible before it is made.
 */
export function describeSchedule(
  req: ScheduleRequest | null | undefined,
  now: Date = new Date(),
): string {
  if (!req) return "Nothing selected.";

  if (req.mode === "ai") {
    return "The programming grid picks the next free slot for this channel.";
  }

  const picked = parseWhen(req.when);
  if (!String(req.when ?? "").trim()) return "No date picked yet.";
  if (!picked) return `"${req.when}" isn't a date the calendar can read.`;
  if (picked.getTime() <= now.getTime()) {
    // Never describe a past date as a schedule — describe what would actually
    // happen, which is publication on the next sweep.
    return `${humanWhen(picked)} has already passed — this would publish within 5 minutes, not wait.`;
  }
  return `Publishes ${humanWhen(picked)}.`;
}

// ─── Which channels can actually be posted to ────────────────────────────────

export interface ChannelScheduleNote {
  ok: boolean;
  note?: string;
}

/**
 * Can this channel be scheduled, and what will actually happen when the time
 * comes?
 *
 * Scheduling and PUBLISHING are separate capabilities, and conflating them is a
 * live trap: only five channels have a publisher in `content-deploy`. The rest
 * can still be scheduled — that is genuinely useful, it puts the piece on the
 * calendar on the right day so a human knows to post it — but nothing will fire
 * on its own. Nobody should press Schedule on TikTok believing it will auto-post,
 * so the note says it plainly rather than leaving the absence to be discovered.
 */
export function canSchedule(channelKey: ChannelKey | string | null | undefined): ChannelScheduleNote {
  const rule = CHANNELS[String(channelKey || "") as ChannelKey];
  if (!rule) {
    return {
      ok: false,
      note: `"${channelKey}" isn't a channel the content OS knows about — it has no calendar column and no publisher.`,
    };
  }
  if (!rule.canAutoPublish) {
    return {
      ok: true,
      note: `${rule.label} has no publisher yet — scheduling puts it on the calendar as a reminder, and a human still posts it by hand.`,
    };
  }
  return { ok: true, note: `${rule.label} publishes automatically at the scheduled time.` };
}

// ─── The call ────────────────────────────────────────────────────────────────

export interface ScheduleResult {
  ok: boolean;
  /** The moment the server settled on — its answer, not our request. */
  scheduledDate?: string | null;
  /** The programming slot's label, when the grid chose ("Thu 9am · Demo · IG"). */
  slotLabel?: string | null;
  error?: string;
  /**
   * Present only for a 422 doctrine violation. The UI turns these into an
   * explicit "approve anyway" affordance; anything else is a plain failure.
   */
  doctrineReasons?: string[];
}

/** The server's own name for the doctrine gate's refusal. */
export const DOCTRINE_VIOLATION = "doctrine_violation";

/**
 * Pull a JSON body out of whatever supabase-js handed back.
 *
 * supabase-js turns any non-2xx into a FunctionsHttpError whose `message` is the
 * useless "non-2xx status code" and whose real body hides on `error.context`.
 * Some versions also surface the parsed body in `data`. Both are checked,
 * because a doctrine 422 that arrives as "Edge Function returned a non-2xx
 * status code" is indistinguishable from a crash, and the operator loses the
 * one thing that would let them act: the reasons.
 */
async function readErrorBody(error: unknown, data: unknown): Promise<Record<string, unknown> | null> {
  const fromData = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (fromData?.error) return fromData;
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body && typeof body === "object") return body as Record<string, unknown>;
    } catch {
      // Body already consumed, or not JSON. Fall through to the generic message.
    }
  }
  return fromData;
}

/**
 * Schedule one post through `marketing-agent director_approve`.
 *
 * Exact mode sends `scheduled_date` and the server honours it verbatim; AI mode
 * omits it and the server proposes a programming slot. That asymmetry is the
 * whole reason both modes can share one action — there is no second endpoint and
 * no second scheduler to keep in sync.
 *
 * Never throws for an expected outcome. A scheduling button that can throw makes
 * every call site responsible for its own try/catch, and one that forgets shows
 * a blank screen instead of a reason.
 */
export async function schedulePost(req: ScheduleRequest): Promise<ScheduleResult> {
  // Validate here as well as in the UI. This function is the only thing between
  // a caller and a live publish, so it cannot assume anyone checked first — and
  // an unchecked past date publishes within 5 minutes.
  const verdict = validateSchedule(req);
  if (!verdict.ok) return { ok: false, error: verdict.reasons.join(" ") };

  try {
    const { data, error } = await supabase.functions.invoke("marketing-agent", {
      body: {
        action: "director_approve",
        post_id: req.postId,
        ...(req.mode === "exact" ? { scheduled_date: new Date(String(req.when)).toISOString() } : {}),
        ...(req.force ? { force: true } : {}),
      },
    });

    const body = await readErrorBody(error, data);

    // The doctrine gate. Surfaced as its own outcome — with the reasons intact —
    // so the UI can offer a deliberate override. Never retried with force here:
    // an override is a decision a person makes after reading why, and a client
    // that auto-forces would quietly delete the gate.
    if (body?.error === DOCTRINE_VIOLATION) {
      return {
        ok: false,
        error: DOCTRINE_VIOLATION,
        doctrineReasons: Array.isArray(body.reasons) ? body.reasons.map(String) : [],
      };
    }

    if (error) {
      const detail = body?.error ? String(body.error) : "";
      return { ok: false, error: detail || (error as { message?: string }).message || "Scheduling failed." };
    }
    if (body?.error) return { ok: false, error: String(body.error) };

    const row = (data || {}) as Record<string, unknown>;
    return {
      ok: true,
      scheduledDate: (row.scheduled_date as string) ?? null,
      slotLabel: (row.slot as string) ?? null,
    };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e || "Scheduling failed.") };
  }
}
