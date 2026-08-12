/**
 * boardAttention — the Brand Board answering the only two questions an operator
 * actually opens it with:
 *
 *     "WHAT NEEDS ME, and WHAT IS HAPPENING WITHOUT ME?"
 *
 * Owner, 2026-08-07, asked whether the UI/UX was done. It was not. Specific bugs
 * had been fixed — the approver lockout, the duplicate tiles, a progress bar,
 * per-row edit links — but nobody had designed the screen, and the screen's
 * organising idea was still a TAXONOMY (type / template / brand / calendar).
 *
 * A taxonomy cannot answer either question. "Reels (48)" tells you nothing about
 * whether any of them are waiting on you, and the board's default lane — Finished
 * Work — mixes a draft nobody has looked at, a post scheduled for August, a cut
 * the editor brain REFUSED, and a piece that already shipped into one flat grid
 * of identical tiles. Measured against production the same day:
 *
 *     agent_social_posts   358 rows — 285 draft · 48 scheduled · 20 pending
 *                                     · 2 approved · 2 rejected · 1 completed
 *     video_render_jobs    118 complete · 12 failed · 0 in flight
 *     ever published       0
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * Every piece lands in exactly ONE lane, and the lanes are grouped by WHO acts
 * next — not by what the piece is. Two groups, because there are two questions:
 *
 *   YOURS   — needs_you, stuck        a human is the next mover
 *   RUNNING — building, scheduled, shipped   the machine or the clock is
 *
 * A piece is never in two lanes and never in none, so the lane counts sum to the
 * board and an operator can trust them to add up. That is deliberate: a header
 * whose numbers do not reconcile is how this board earned its reputation for
 * hiding work.
 *
 * ── STUCK IS A LANE BECAUSE IT WAS NOWHERE ──────────────────────────────────
 * Measured 2026-08-07, and this is the hole the redesign exists to close:
 *
 *   - 12 render jobs are `failed`. A failed job has no thumbnail and no file, so
 *     `isFinishedWork` correctly excludes it from Finished Work — and the Queued
 *     Work pill filters `failed` out too. Twelve dead renders, spanning
 *     2026-07-22 to 2026-08-07, appear in NO lane on this board.
 *   - 13 cuts carry `editor_brain_status: "mismatch"`. The editor brain refused
 *     them before any model spend — "the footage does not support the requested
 *     angle" — and the pipeline rendered a ONE-CLIP STUB anyway, on purpose, so
 *     a human could decide whether the idea or the footage was wrong. On the
 *     board that stub is a tile identical to a real edit.
 *   - 45 of 48 scheduled posts are past their date, the oldest by four months.
 *
 * None of that was visible. All of it is somebody's problem, so all of it is
 * STUCK, and the lane says which of the three it is.
 *
 * WIDENED 2026-08-07, owner looking at the board: "Brand Board shows no real
 * content. All AI slop." The `mismatch`/`no_beats` test above caught only one
 * of the three ways this pipeline ships a failure as a picture — frame grabs
 * (`blueprint.kind = 'static_post'`, 49 of 140 completed renders) and one-clip
 * stubs (`edit_kind = 'stub'`, 42) went on sitting in Finished Work. Their
 * union is 52 renders plus 45 posts, so roughly two thirds of the tiles were
 * the system reporting a failure. `machineFailure` is now its own lane input;
 * the classification lives in `boardProvenance.ts` beside its measurements.
 *
 * Pure by design: no React, no database, no network. The clock is passed IN
 * (`now`) rather than read, so past-due is testable and cannot drift.
 * Locked by `tests/board-attention.test.ts`.
 */

import { BRANDS } from "@/lib/contentDoctrine";

// ─── Lanes ───────────────────────────────────────────────────────────────────

export type Lane = "needs_you" | "stuck" | "building" | "scheduled" | "shipped";

/** Which question a lane answers. Drives the two groups in the ribbon. */
export type LaneGroup = "yours" | "running";

/**
 * WHICH PAGE OWNS A LANE — the board/queue split.
 *
 * Owner, 2026-08-10, looking at the Brand Board: "Brand Board = finished work
 * you can look at and use. Content Director = the queue of ideas waiting on
 * your approval. What you're seeing is the board doing Content Director's job
 * — 174 stuck pieces, 12 waiting on a human, Assist buttons. That's a work
 * queue wearing the gallery's clothes."
 *
 * The lanes themselves were right and the measurements behind them stand: the
 * 174 really are not edits, and putting them somewhere was the fix to the
 * "all AI slop" problem. What was wrong is that they were put in their own
 * lanes ON THE BOARD, so the gallery grew a backlog instead of shedding one.
 * `StuckReasons` and `AssistLane` rendered on the default Finished Work view,
 * which is the screen opened to look at work.
 *
 * `laneOf` is unchanged — every piece still lands in exactly one lane and the
 * counts still reconcile. This adds only WHERE each lane is worked:
 *
 *   board     you look at it        needs_you · building · shipped
 *   director  you act on it         stuck · scheduled
 *
 * `contentOsRouting.ts` already draws the same boundary for a single card
 * (ideas → Director, made work → Board). This is that boundary stated for a
 * LANE, so the ribbon and the routing rule cannot disagree about which page a
 * pile of work belongs to.
 *
 * The board keeps a way to LOOK at the director lanes — a failed render has no
 * home in the Director's queue, and twelve dead renders visible nowhere is the
 * exact hole the Stuck lane was built to close. It is a link, not a tile: you
 * go and look, you do not work there.
 */
export type LaneSurface = "board" | "director";

export interface LaneMeta {
  key: Lane;
  group: LaneGroup;
  /** The page that OWNS this lane — where a human acts on it. */
  surface: LaneSurface;
  label: string;
  /** The colour, used by the same tint/solid formula as every other control. */
  color: string;
  /** One sentence, shown under the count. Says what the number MEANS. */
  blurb: string;
}

/**
 * The five lanes, in reading order.
 *
 * Colour carries meaning and nothing else: amber = a human is blocked, red =
 * something broke, indigo = a machine is working, slate = a clock is,
 * emerald = it left the building. No gradients, no second palette — same
 * vocabulary as ColorPill and SET_STATE_META.
 */
export const LANES: LaneMeta[] = [
  {
    key: "needs_you",
    group: "yours",
    // Finished artwork, on the page for looking at finished artwork. This is
    // the one lane a human drains BY LOOKING, so it stays on the board.
    surface: "board",
    label: "Needs you",
    color: "#D97706",
    blurb: "Finished artwork waiting on a yes or no. Nothing moves until you look.",
  },
  {
    key: "stuck",
    group: "yours",
    // Worked in the Director. Every move that unsticks one of these — pin a
    // clip that has beats, re-date a past-due post, drop the idea — is a queue
    // action, and none of them is "look at the artwork", because there is no
    // artwork worth looking at. That is what being in this lane MEANS.
    surface: "director",
    label: "Stuck",
    color: "#DC2626",
    blurb: "Failed renders, frame grabs and one-clip stubs, refused cuts, and posts past their date.",
  },
  {
    key: "building",
    group: "running",
    surface: "board",
    label: "Building",
    color: "#4F46E5",
    blurb: "A worker has it. No action needed — and no action will help.",
  },
  {
    key: "scheduled",
    // Already the Director's, in practice. A piece with copy and no artwork IS
    // the Director's idea queue, and a post sitting on a future date is in its
    // outbound queue. The board was showing a tile for work it did not own.
    surface: "director",
    // Named "Waiting", not "Scheduled", because it holds two different waits and
    // labelling it for only one of them would misreport the other: a piece
    // approved and sitting on a future date, AND a piece someone wrote copy for
    // whose artwork was never made. Neither is anyone's next action right now;
    // both are honestly "waiting". Calling the lane Scheduled would imply a date
    // exists for every card in it, and for most of them none does.
    group: "running",
    label: "Waiting",
    color: "#64748B",
    blurb: "On a future date, or written with no artwork made yet.",
  },
  {
    key: "shipped",
    group: "running",
    surface: "board",
    label: "Shipped",
    color: "#059669",
    blurb: "Actually left the building.",
  },
];

export const LANE_BY_KEY: Record<Lane, LaneMeta> = LANES.reduce(
  (acc, l) => { acc[l.key] = l; return acc; },
  {} as Record<Lane, LaneMeta>,
);

/** The lanes the Brand Board shows as tiles. Derived, never a second list. */
export const BOARD_LANES: LaneMeta[] = LANES.filter((l) => l.surface === "board");
/** The lanes Content Director owns — the board hands these over. */
export const DIRECTOR_LANES: LaneMeta[] = LANES.filter((l) => l.surface === "director");

/**
 * The handoff sentence: what the board is NOT showing you, and where it went.
 *
 * Printed even when both counts are zero would be noise; printed only when
 * non-zero, it is the receipt. The board must never simply drop this work from
 * view without saying so — a lane that quietly got smaller is the disappearing
 * act this board keeps being accused of.
 */
export function handoffLine(counts: LaneCounts): string | null {
  const bits: string[] = [];
  if (counts.stuck) bits.push(`${counts.stuck.toLocaleString()} stuck`);
  if (counts.scheduled) bits.push(`${counts.scheduled.toLocaleString()} waiting`);
  if (!bits.length) return null;
  return `${bits.join(" · ")} — worked in Content Director, not here.`;
}

// ─── What the lane rule reads ────────────────────────────────────────────────

/**
 * The minimum a card must expose to be filed. Deliberately structural, not the
 * board's `BoardCard` — this module must not import the page it serves.
 */
export interface AttentionCandidate {
  source?: string | null;
  status?: string | null;
  /** Scheduled/publish date, ISO. */
  date?: string | null;
  /** Does this card have something to look at or play? */
  hasMedia?: boolean;
  /** True when a render is in flight or a creative is composing. */
  building?: boolean;
  /** The editor brain's verdict for the cut behind this card, when there is one. */
  brainStatus?: string | null;
  /**
   * Is this card a MACHINE FAILURE wearing a thumbnail — a frame grab, a
   * one-clip stub, a refused cut? Decided by `boardProvenance.machineFailure`
   * from stored blueprint facts, never from the picture.
   *
   * `brainStatus` above already caught one of the three. It was not enough:
   * measured 2026-08-07, the refusals are 42 of 140 completed renders but the
   * union with frame grabs and stubs is 52 — plus 45 posts carrying a stub
   * creative. The other two kinds sat in Finished Work looking like work.
   */
  machineFailure?: boolean;
}

const SHIPPED = new Set(["posted", "published", "live", "sent", "completed", "complete", "delivered"]);
const APPROVED = new Set(["approved", "scheduled", "ready", "queued_to_post"]);
/** Statuses that mean a human has already said no. Not stuck — decided. */
const DECIDED_NO = new Set(["rejected", "declined", "archived", "cancelled", "canceled"]);
const FAILED = new Set(["failed", "error", "errored", "dead"]);

function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * Did the editor brain refuse this cut?
 *
 * `mismatch` is the refusal verdict `editor-brain` writes when the footage does
 * not carry the requested angle. `no_beats` means it found nothing to cut on.
 * Both produce a ONE-CLIP STUB that renders and looks finished, which is exactly
 * why they have to be named — the stub is indistinguishable from an edit on a
 * grid of thumbnails.
 */
export function brainRefused(status: unknown): boolean {
  const s = norm(status);
  return s === "mismatch" || s === "no_beats";
}

/** Is this scheduled date in the past? A scheduled post that never went is stuck. */
export function isPastDue(date: string | null | undefined, now: Date): boolean {
  if (!date) return false;
  const t = Date.parse(String(date));
  if (Number.isNaN(t)) return false;
  return t < now.getTime();
}

/**
 * The one lane this card belongs to.
 *
 * Order matters and encodes the priority: a thing that BROKE outranks a thing
 * that is merely waiting, and anything a human must touch outranks anything a
 * machine is already handling. Reordering these branches changes the product.
 */
export function laneOf(card: AttentionCandidate | null | undefined, now: Date): Lane {
  if (!card) return "needs_you";
  const status = norm(card.status);

  // BROKE — nothing downstream matters until this is dealt with.
  if (FAILED.has(status)) return "stuck";
  // A refused cut rendered a stub. It looks finished and is not.
  if (brainRefused(card.brainStatus)) return "stuck";
  // Same reasoning, wider net: a frame grab and a one-clip stub are equally
  // finished-looking and equally not an edit. The board shipped ~97 of them as
  // Finished Work, which is what "all AI slop" was.
  if (card.machineFailure) return "stuck";

  // IN FLIGHT — a worker has it. Checked before the status buckets because a
  // composing post still carries its old `draft` status while genuinely being
  // built, and showing it as "needs you" is what makes somebody press the
  // button twice and buy a second render.
  if (card.building) return "building";

  if (SHIPPED.has(status)) return "shipped";

  // A human already decided no. Not waiting on anyone.
  if (DECIDED_NO.has(status)) return "shipped";

  if (APPROVED.has(status)) {
    // Approved, dated, and the date has passed — it should have gone and did
    // not. That is the single most expensive silence on this board.
    return isPastDue(card.date, now) ? "stuck" : "scheduled";
  }

  // Everything else is a draft or pending piece, and the split is ARTWORK.
  //
  // With artwork there is something to look at, so it is genuinely the
  // operator's queue. Without artwork nothing can be reviewed yet — the copy
  // exists and the creative was never made — so it waits. Folding those into
  // "needs you" would put 135 unreviewable rows into the one number the whole
  // ribbon exists to make trustworthy, and an inbox that cannot be drained is
  // an inbox nobody opens.
  return card.hasMedia ? "needs_you" : "scheduled";
}

export type LaneCounts = Record<Lane, number>;

export function emptyLaneCounts(): LaneCounts {
  return { needs_you: 0, stuck: 0, building: 0, scheduled: 0, shipped: 0 };
}

/** Count each lane across a card list. Every card lands in exactly one. */
export function countLanes(
  cards: AttentionCandidate[] | null | undefined,
  now: Date,
): LaneCounts {
  const counts = emptyLaneCounts();
  for (const c of cards || []) counts[laneOf(c, now)] += 1;
  return counts;
}

/**
 * The sentence over the ribbon. Leads with the human's own backlog because that
 * is the half they can act on, and states the machine's half second.
 *
 * Never "all clear" when something is stuck — a summary that reads healthy while
 * twelve renders are dead is the failure this board keeps repeating.
 */
export function attentionLine(counts: LaneCounts): string {
  const yours = counts.needs_you + counts.stuck;
  const running = counts.building + counts.scheduled;
  if (!yours && !running && !counts.shipped) return "Nothing has loaded yet.";
  const parts: string[] = [];
  if (counts.needs_you) parts.push(`${counts.needs_you.toLocaleString()} waiting on you`);
  if (counts.stuck) parts.push(`${counts.stuck.toLocaleString()} stuck`);
  if (!parts.length) parts.push("Nothing is waiting on you");
  const tail = counts.building
    ? `${counts.building.toLocaleString()} building`
    : running
      ? `${counts.scheduled.toLocaleString()} scheduled, nothing building`
      : "nothing running";
  return `${parts.join(" · ")} — ${tail}.`;
}

// ─── Can anything actually publish? ──────────────────────────────────────────

/**
 * The platforms `content-deploy` can genuinely dispatch to, read off its own
 * branch list (`deployPost`): facebook, instagram, wraptv_site, wrapfeed,
 * youtube. Anything else on a post is a destination with no publisher.
 */
export const DEPLOYABLE_PLATFORMS = new Set([
  "facebook", "instagram", "wraptv_site", "wrapfeed", "youtube",
]);

/**
 * Facebook and Instagram both dispatch through ONE stored Meta connection —
 * `tenant_site_connections` where `platform = 'meta_facebook'` and
 * `is_active`. Without that row `content-deploy` throws before it reaches the
 * API, so every Instagram and Facebook piece on the board is unpublishable no
 * matter how many humans approve it.
 */
export const META_CONNECTION_PLATFORM = "meta_facebook";

export interface PublishReality {
  /** True only when a Meta connection was actually seen. */
  metaConnected: boolean;
  /** null = we could not read the table at all, which is NOT "not connected". */
  known: boolean;
  /** Pieces sitting behind the missing connection. */
  blockedPieces: number;
  /** Scheduled pieces whose date has passed. */
  pastDue: number;
  /** Has anything, ever, actually gone out? */
  everPublished: number;
}

/**
 * One paragraph stating whether this board's output can leave the building.
 *
 * Measured 2026-08-07: ZERO of 358 posts have ever published, and the only rows
 * in `tenant_site_connections` are Google properties and WordPress — there is no
 * social destination configured at all. A board that shows "48 scheduled" beside
 * that fact, and never mentions it, is misleading in the most expensive
 * direction: the owner waits on content that could never ship.
 *
 * `known: false` prints a DIFFERENT sentence. Same discipline as
 * `brandBoardPieces`' Canva case — if the read failed we say we could not check,
 * because asserting "not connected" on a failed read would be a confident
 * falsehood the operator has no way to catch.
 */
export function publishReality(r: PublishReality): string | null {
  if (!r.known) {
    return "Could not check whether a social connection exists, so nothing here should be read as ready to ship.";
  }
  if (r.metaConnected) {
    if (r.everPublished > 0) return null;
    return `A Meta connection is active, but nothing has ever published from this board${
      r.pastDue ? ` and ${r.pastDue.toLocaleString()} scheduled ${r.pastDue === 1 ? "post is" : "posts are"} past due` : ""
    }. Approving more will not change that on its own.`;
  }
  const bits = [
    "Nothing on this board can publish to Instagram or Facebook — no Meta connection is set up",
  ];
  if (r.blockedPieces) {
    bits.push(
      `${r.blockedPieces.toLocaleString()} piece${r.blockedPieces === 1 ? "" : "s"} ${
        r.blockedPieces === 1 ? "is" : "are"
      } queued behind it`,
    );
  }
  if (r.pastDue) {
    bits.push(`${r.pastDue.toLocaleString()} scheduled ${r.pastDue === 1 ? "post is" : "posts are"} already past due`);
  }
  if (r.everPublished === 0) bits.push("nothing has ever published");
  return `${bits.join(", ")}. Connect one in Admin → SEO → Connections.`;
}

// ─── Why does this piece exist? ──────────────────────────────────────────────

/**
 * The interest a piece serves, matched DETERMINISTICALLY against the brand's
 * own doctrine (`contentDoctrine.BRANDS[*].interests`).
 *
 * Owner's standing complaint about this whole system is that they cannot tell
 * whether what it made is any good. "Hook 9/10, matches 'what actually causes
 * print failures'" is reviewable; a bare thumbnail is not.
 *
 * The rule is copied deliberately from `assetContentType.ts`, which is the
 * house pattern for this exact problem: keyword-deterministic, and it RETURNS
 * THE MATCHED SIGNAL so a human can see the reasoning and overrule it. No
 * model, no embedding, no similarity score anyone has to trust. No match
 * returns null and the card says nothing rather than inventing a rationale —
 * a fabricated "why" is worse than no "why", because it is unfalsifiable at a
 * glance.
 */
export interface InterestMatch {
  /** The brand interest, verbatim from contentDoctrine. */
  interest: string;
  /** The words that actually matched, so the claim is checkable. */
  signal: string[];
}

const STOPWORDS = new Set([
  "and", "the", "that", "what", "why", "how", "for", "from", "with", "into",
  "more", "less", "than", "this", "they", "them", "your", "you", "our", "its",
  "are", "was", "were", "been", "being", "have", "has", "had", "not", "but",
  "actually", "makes", "make", "made",
]);

function contentWords(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * Best-matching brand interest for a piece's copy, or null.
 *
 * Threshold: TWO distinct content words shared with the interest phrase, or ONE
 * word of EIGHT-plus characters.
 *
 * The single-word cutoff is the part that needed tuning and the number is not
 * arbitrary. At six characters "design" qualifies on its own, and "a nice
 * design" then reads as evidence for the interest "design to print file" — which
 * would file half of DesignProAI's board under one interest and make the badge
 * mean nothing. The words worth trusting alone are the specific ones the trade
 * actually uses — "turnaround", "laminate", "visualisation" — and they are all
 * eight or more. The medium-length generics that cause the false positives —
 * design, print, craft, pricing — are all seven or fewer. Eight is where those
 * two sets separate, and a single word below it must bring a friend.
 *
 * Ties break toward the interest that matched more words, then toward doctrine
 * order, so the answer is stable across renders.
 */
const LONE_WORD_MIN = 8;

export function matchBrandInterest(text: string, brand: string): InterestMatch | null {
  const interests = BRANDS[String(brand || "").toLowerCase()]?.interests;
  if (!interests?.length) return null;
  const words = new Set(contentWords(text));
  if (!words.size) return null;

  let best: InterestMatch | null = null;
  for (const interest of interests) {
    const signal = contentWords(interest).filter((w) => words.has(w));
    const strong = signal.length >= 2 || signal.some((w) => w.length >= LONE_WORD_MIN);
    if (!strong) continue;
    if (!best || signal.length > best.signal.length) best = { interest, signal };
  }
  return best;
}

/**
 * The viral signal behind a cut: the best-scoring moment in the footage it was
 * built from.
 *
 * IT IS A CLAIM ABOUT THE FOOTAGE, NOT ABOUT THE CUT, and the UI must say so.
 * The join that produces it is `blueprint.scenes[].clipUrl` →
 * `media_sources.storage_url` → `content_moments.source_id`, which resolves for
 * 80 of the 130 jobs that have scenes (measured 2026-08-07). Whether the cut
 * actually USED the high-scoring moment is not recorded anywhere, so it is not
 * asserted — "the footage behind this carries a 9/10 hook" is true and useful;
 * "this is a 9/10 cut" would be neither.
 *
 * The other 50 jobs get null and the card shows nothing.
 */
export interface FootageSignal {
  hook: number | null;
  soundbite: number | null;
  broll: number | null;
  /** The strongest quote in that footage, when there is one. */
  quote: string | null;
}

/** Highest of a numeric field across moments, ignoring nulls. */
function bestOf(rows: Array<Record<string, unknown>>, field: string): number | null {
  let best: number | null = null;
  for (const r of rows) {
    const v = r?.[field];
    if (typeof v !== "number" || Number.isNaN(v)) continue;
    if (best === null || v > best) best = v;
  }
  return best;
}

export function summarizeFootage(
  moments: Array<Record<string, unknown>> | null | undefined,
): FootageSignal | null {
  const rows = (moments || []).filter(Boolean);
  if (!rows.length) return null;
  const hook = bestOf(rows, "hook_score");
  const soundbite = bestOf(rows, "soundbite_score");
  const broll = bestOf(rows, "broll_score");
  if (hook === null && soundbite === null && broll === null) return null;

  // The quote from the highest-hook moment — the thing a reviewer would
  // actually read to judge whether the angle is worth anything.
  let quote: string | null = null;
  let top = -1;
  for (const r of rows) {
    const h = typeof r.hook_score === "number" ? r.hook_score : -1;
    const q = typeof r.verbatim_quote === "string" ? r.verbatim_quote.trim() : "";
    if (q && h > top) { top = h; quote = q; }
  }
  return { hook, soundbite, broll, quote };
}

/** A score's colour band. 9+ is the only thing worth calling out as strong. */
export function scoreTone(score: number | null | undefined): "strong" | "ok" | "weak" | "none" {
  if (typeof score !== "number") return "none";
  if (score >= 9) return "strong";
  if (score >= 7) return "ok";
  return "weak";
}
