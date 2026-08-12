/**
 * pieceReview — the HUMAN verdict on one finished piece.
 *
 * Owner's ask on the Brand Board: per piece, approve or decline it, and rate it
 * 1 to 10 — "10 = winner, 1 = not".
 *
 * That is a taste judgement, made by the person who knows the brand, on work
 * that already exists. It is deliberately a different thing from the audience's
 * verdict, and keeping those two apart is most of why this module exists.
 *
 * ── TWO KINDS OF "WINNER", BOTH RECORDED, NEVER CONFLATED ───────────────────
 * `contentDoctrine.promotionVerdict` already answers "should we pay to
 * distribute this?" — and it answers it from MEASURED VIEWS against the brand's
 * own median, refusing to guess when there are no metrics. That is the
 * AUDIENCE's winner: proof, bought for free, that the creative works.
 *
 * `isWinner` here is the HUMAN's winner: someone looked at the piece before it
 * ever ran and said this is the one. It is a prediction, not evidence.
 *
 * They must never overwrite each other. A 10 from the owner does not make a
 * piece eligible for the ad schedule — the ladder in the doctrine is organic
 * first, always, and letting a rating jump that queue is precisely how ad
 * budgets get spent on creative nobody chose to watch. Equally, a piece the
 * audience loved is not retroactively "approved"; a human still signs it off.
 *
 * So: two signals, two homes. The rating lives in `generation_meta.piece_review`
 * and gates what gets MADE and PUSHED; the promotion verdict lives on the
 * metrics and gates what gets PAID FOR. When both agree you have a real winner,
 * and the only way to ever learn that is to keep them separate long enough to
 * compare them.
 *
 * ── WHY 8 ───────────────────────────────────────────────────────────────────
 * On a 1–10 scale people cluster at 7 — 7 is "fine, ship it". A threshold at 7
 * would mark most of the catalogue a winner and the word would stop meaning
 * anything, which is the same way a gate that fires on everything becomes an
 * outage rather than a standard. 8 is the first number a reviewer has to
 * actually choose. It leaves 8/9/10 as a real shortlist and keeps the signal
 * scarce enough to be worth acting on.
 *
 * ── AN UNRATED PIECE IS UNRATED ─────────────────────────────────────────────
 * `clampRating` returns null for anything that is not a real number. It never
 * falls back to 5, or to any midpoint. A fabricated 5 is indistinguishable from
 * a considered 5 the moment it is stored, and once a few hundred of them are in
 * the table the average rating per brand — the number that decides what we make
 * more of — is measuring nothing but the default. Honest gaps over invented
 * data: `rated` counts only pieces a human actually scored, and `averageRating`
 * is null rather than 0 when nobody has.
 *
 * Pure by design: no database, no network, and the clock is a parameter.
 */

/** 1 = not a winner. 10 = winner. The owner's scale, verbatim. */
export const RATING_MIN = 1;
export const RATING_MAX = 10;

/**
 * The rating at or above which a human has called it a winner.
 *
 * See the header for why 8 and not 7. This is the HUMAN signal — it is not, and
 * must not become, an input to `promotionVerdict`.
 */
export const WINNER_RATING = 8;

/**
 * `pending` is a real, distinct state — not a soft "no".
 *
 * A piece nobody has looked at yet and a piece someone declined need different
 * actions from the operator, and collapsing them would make the review queue
 * unable to say how much work is left.
 */
export type PieceVerdict = "approved" | "declined" | "pending";

export const VERDICTS: PieceVerdict[] = ["approved", "declined", "pending"];

export interface PieceReview {
  verdict: PieceVerdict;
  /** null when unrated. Never a default — see the header. */
  rating: number | null;
  reviewedBy: string | null;
  /** ISO timestamp, or null when this piece has never been reviewed. */
  reviewedAt: string | null;
  note: string | null;
}

/** The key inside `generation_meta` that holds all of this. */
export const REVIEW_META_KEY = "piece_review";

/** What a never-reviewed piece looks like. Nothing invented, nothing implied. */
export const EMPTY_REVIEW: PieceReview = {
  verdict: "pending",
  rating: null,
  reviewedBy: null,
  reviewedAt: null,
  note: null,
};

/**
 * Coerce whatever the UI handed us into a real rating, or null.
 *
 * Out-of-range numbers are CLAMPED rather than rejected — a slider that
 * overshoots to 11 clearly means 10, and dropping it would lose a real human
 * judgement over an off-by-one. Non-numbers are a different case entirely:
 * "", null, undefined, NaN and "good" carry no judgement at all, and the only
 * truthful answer is that the piece is unrated.
 *
 * There is no midpoint fallback anywhere in this function, on purpose.
 */
export function clampRating(n: unknown): number | null {
  if (typeof n === "number") {
    if (!Number.isFinite(n)) return null; // NaN / Infinity carry no judgement
    return Math.min(RATING_MAX, Math.max(RATING_MIN, Math.round(n)));
  }
  // Only a string is worth coercing — that is what a form input hands over.
  // Everything else (boolean, object, array, null, undefined) goes through
  // `Number()` as a surprise: Number(true) is 1, Number([]) is 0, and both
  // would clamp up to a confident 1 — "definitely not a winner" — from input
  // that said nothing at all. That is the fabricated-default failure this
  // function exists to prevent, arriving through the back door.
  if (typeof n !== "string") return null;
  const trimmed = n.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  return Math.min(RATING_MAX, Math.max(RATING_MIN, Math.round(num)));
}

/** A verdict we recognise, or `pending`. Garbage never reads as approved. */
export function normalizeVerdict(v: unknown): PieceVerdict {
  const s = String(v ?? "").trim().toLowerCase();
  return (VERDICTS as string[]).includes(s) ? (s as PieceVerdict) : "pending";
}

export interface ReviewInput {
  verdict?: PieceVerdict | string | null;
  rating?: unknown;
  reviewedBy?: string | null;
  note?: string | null;
}

/**
 * Build the `generation_meta` patch for a review.
 *
 * MERGES, never clobbers. `generation_meta` is a shared free-form bag —
 * `pillar`, `pending_render_job_id` and `doctrine_override` all live in it, and
 * `pending_render_job_id` in particular is how a queued render finds its way
 * back to the post it belongs to. Writing `{ piece_review: … }` flat would
 * orphan an in-flight render every time somebody rated a piece, and the damage
 * would only surface minutes later when the render landed nowhere. So the
 * existing bag is spread first and only our one key is replaced.
 *
 * `now` is a parameter rather than a `new Date()` call so the patch is
 * reproducible in a test and the module stays clock-free.
 */
export function buildReviewPatch(
  existingMeta: Record<string, unknown> | null | undefined,
  review: ReviewInput | null | undefined,
  now: string = new Date().toISOString(),
): { generation_meta: Record<string, unknown> } {
  const base =
    existingMeta && typeof existingMeta === "object" && !Array.isArray(existingMeta)
      ? (existingMeta as Record<string, unknown>)
      : {};

  const entry: PieceReview = {
    verdict: normalizeVerdict(review?.verdict),
    rating: clampRating(review?.rating),
    reviewedBy: review?.reviewedBy ? String(review.reviewedBy) : null,
    reviewedAt: now,
    note: review?.note ? String(review.note).trim() || null : null,
  };

  return {
    generation_meta: {
      ...base,
      [REVIEW_META_KEY]: entry,
    },
  };
}

/**
 * Read a review back out of a metadata bag.
 *
 * Tolerant of everything, because `generation_meta` is untyped jsonb written by
 * several producers over two years: missing, null, a string, an array, a
 * half-written object. Any of those means "not reviewed", which is honest — the
 * alternative is a page that throws on one bad row and shows the operator
 * nothing at all.
 */
export function readReview(meta: unknown): PieceReview {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return { ...EMPTY_REVIEW };
  const raw = (meta as Record<string, unknown>)[REVIEW_META_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_REVIEW };

  const r = raw as Record<string, unknown>;
  return {
    verdict: normalizeVerdict(r.verdict),
    rating: clampRating(r.rating),
    reviewedBy: typeof r.reviewedBy === "string" && r.reviewedBy ? r.reviewedBy : null,
    reviewedAt: typeof r.reviewedAt === "string" && r.reviewedAt ? r.reviewedAt : null,
    note: typeof r.note === "string" && r.note.trim() ? r.note.trim() : null,
  };
}

/** Has anyone actually looked at this piece? */
export function isReviewed(review: PieceReview | null | undefined): boolean {
  return !!review && review.verdict !== "pending";
}

/**
 * The HUMAN winner call: rated 8 or higher.
 *
 * A declined piece is never a winner regardless of its score — a 9 with a
 * "declined" verdict means someone saw a reason not to run it that the number
 * does not capture, and the verdict is the later, more considered signal.
 *
 * This does NOT authorise paid promotion. That decision belongs to
 * `promotionVerdict` in `@/lib/contentDoctrine` and is made from real view
 * counts; see this file's header.
 */
export function isWinner(review: PieceReview | null | undefined): boolean {
  if (!review) return false;
  if (review.verdict === "declined") return false;
  return typeof review.rating === "number" && review.rating >= WINNER_RATING;
}

export interface ReviewSummary {
  approved: number;
  declined: number;
  pending: number;
  /** How many pieces carry a real score. Never inflated by unrated ones. */
  rated: number;
  /** Mean of the rated pieces only, or null when none are rated. */
  averageRating: number | null;
}

/**
 * Roll a list of reviews into the board's counters.
 *
 * `averageRating` divides by `rated`, not by the list length. Counting unrated
 * pieces as zeros would drag every brand's average toward nothing and make the
 * number a measure of review coverage rather than of quality — two different
 * facts, and both are needed separately.
 */
export function reviewSummary(
  reviews: Array<PieceReview | null | undefined> | null | undefined,
): ReviewSummary {
  const out: ReviewSummary = { approved: 0, declined: 0, pending: 0, rated: 0, averageRating: null };
  let sum = 0;

  for (const r of reviews || []) {
    if (!r) {
      // A null entry is a piece with no review, which is exactly `pending`.
      out.pending += 1;
      continue;
    }
    if (r.verdict === "approved") out.approved += 1;
    else if (r.verdict === "declined") out.declined += 1;
    else out.pending += 1;

    if (typeof r.rating === "number") {
      out.rated += 1;
      sum += r.rating;
    }
  }

  if (out.rated > 0) out.averageRating = Math.round((sum / out.rated) * 10) / 10;
  return out;
}
