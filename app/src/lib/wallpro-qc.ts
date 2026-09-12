// WallPanelPro Studio logic: did a generation take, and may this version print.
//
// Owner, 2026-09-12: "That's where I can instantly check if it took when they
// time out and it's where we do back end designer QC checks and release gate
// just like current vehicle wrap panelpro version."
//
// Two questions, kept apart because they fail apart:
//
//   OUTCOME  — what happened to the model call. Answered from the generation
//              row alone, which is the only record written by the server.
//   RELEASE  — whether the team has signed this version off for print.
//              Answered from the append-only QC log.
//
// Pure: no Supabase client, no React. The reads that fill it live in
// wallpro-api.ts and the board that renders it in WallPanelProStudio.tsx.

/** A generation row as the studio reads it. */
export type WallGenerationRow = {
  id: string;
  owner_id: string;
  state: 'working' | 'completed' | 'failed';
  artwork_path: string | null;
  design_name: string | null;
  error: string | null;
  input: Record<string, unknown>;
  charge_source: string | null;
  created_at: string;
  completed_at: string | null;
};

/**
 * What actually happened, in the words the team needs.
 *
 * `orphaned` is the whole reason this board exists. A wall design's version row
 * is written by the CUSTOMER'S BROWSER once generate-wall-design answers; when
 * the browser gives up first, the generation is `completed` on the server with
 * its artwork sitting in storage and NOTHING downstream. The customer sees a
 * timeout and believes the design failed. It did not: it is one recovery away.
 */
export type WallGenerationOutcome =
  | 'landed'      // completed, and the customer's project carries it
  | 'orphaned'    // completed with artwork, but no version row — recoverable
  | 'running'     // still working, inside the expected window
  | 'stalled'     // still working long past any plausible run
  | 'failed';     // the server recorded a failure; the credit was refunded

/**
 * The longest a real generation takes before "still working" stops being true.
 *
 * Measured from the customer path: up to ~20s of consultant enrichment and up
 * to ~100s of image generation, plus storage. Four minutes is comfortably past
 * the slowest honest run and well inside the 3-minute in-progress lock the
 * reservation RPC already enforces, so a row still `working` past it was
 * abandoned by whatever process owned it.
 */
export const WALL_GENERATION_STALL_MS = 4 * 60 * 1000;

export function generationOutcome(
  generation: Pick<WallGenerationRow, 'state' | 'artwork_path' | 'created_at'>,
  hasVersion: boolean,
  now: number = Date.now(),
): WallGenerationOutcome {
  if (generation.state === 'failed') return 'failed';
  if (generation.state === 'working') {
    const age = now - new Date(generation.created_at).getTime();
    return Number.isFinite(age) && age > WALL_GENERATION_STALL_MS ? 'stalled' : 'running';
  }
  // completed
  if (!generation.artwork_path) return 'failed';
  return hasVersion ? 'landed' : 'orphaned';
}

/** Only a completed generation whose artwork never reached the customer. */
export const isRecoverable = (outcome: WallGenerationOutcome) => outcome === 'orphaned';

export const OUTCOME_LABEL: Record<WallGenerationOutcome, string> = {
  landed: 'Delivered',
  orphaned: 'Took — customer never got it',
  running: 'Generating',
  stalled: 'Stalled',
  failed: 'Failed',
};

/**
 * One line saying what the customer is looking at right now. The board is read
 * while someone is on the phone saying "it timed out", so the answer has to be
 * the answer, not a status code.
 */
export const OUTCOME_MEANING: Record<WallGenerationOutcome, string> = {
  landed: 'The design is in their project and their versions list.',
  orphaned: 'The design generated and is stored, but their browser gave up before it was recorded. Recover it and it appears in their My wall designs.',
  running: 'The model is still working. Nothing is wrong yet.',
  stalled: 'It has been working far longer than any real run. Treat it as lost; their credit was not refunded, so refund it by hand if they were charged.',
  failed: 'The server recorded a failure and refunded the credit automatically.',
};

/* ── Designer QC and the release gate ───────────────────────────────────── */

/**
 * The checks a designer makes before a wall design is allowed to print.
 *
 * Wall-specific on purpose. The vehicle board checks template fit and openings
 * because a vehicle panel wraps compound curves; a wall is one flat rectangle,
 * so what goes wrong here is scale, seams, resolution and the customer's brief.
 */
export const WALL_QC_CHECKS: Array<[key: string, label: string, why: string]> = [
  ['brief', 'Matches the brief', 'Subject, colours and mood are the ones the customer asked for.'],
  ['scale', 'Motif scale is right for the wall', 'Measured against the wall inches, not the thumbnail. A bloom that prints three feet across is a reprint.'],
  ['seam', 'Repeat tiles cleanly', 'Repeating designs only: the tile meets itself with no visible seam or drift.'],
  ['resolution', 'Resolution holds at 150 PPI', 'The master carries enough real pixels across the wall, before Topaz invents any.'],
  ['artifacts', 'No generative artefacts', 'No garbled text, melted edges, duplicated hands, watermark ghosts or reference bleed.'],
  ['rights', 'Nothing we cannot print', 'No third-party logo, trademark or recognisable likeness the customer has not cleared.'],
];

export type WallQcReview = {
  id: string;
  version_id: string;
  project_id: string;
  reviewer_id: string;
  verdict: 'released' | 'hold';
  checks: Record<string, boolean>;
  notes: string | null;
  created_at: string;
};

/**
 * The current verdict for a version: the newest review, or null when nobody has
 * looked at it. Never inferred from the reviews before it — a hold entered after
 * a release is the live answer, which is the point of an append-only log.
 */
export function currentReview(reviews: WallQcReview[]): WallQcReview | null {
  let newest: WallQcReview | null = null;
  for (const review of reviews) {
    if (!newest || new Date(review.created_at).getTime() > new Date(newest.created_at).getTime()) newest = review;
  }
  return newest;
}

export type WallReleaseState = 'released' | 'held' | 'unreviewed';

export function releaseState(reviews: WallQcReview[]): WallReleaseState {
  const review = currentReview(reviews);
  if (!review) return 'unreviewed';
  return review.verdict === 'released' ? 'released' : 'held';
}

/**
 * Whether a reviewer may stamp "released" with the boxes they have ticked.
 *
 * Every check must be ticked, except the seam check on a design that does not
 * repeat — a mural has no tile, and forcing a tick for a thing that does not
 * exist teaches the team to tick boxes without looking, which is the only way a
 * QC gate actually fails. A hold never needs a tick; it needs a reason.
 */
export function requiredChecks(placement: string | null | undefined): string[] {
  return WALL_QC_CHECKS
    .filter(([key]) => key !== 'seam' || placement === 'repeat')
    .map(([key]) => key);
}

export function canRelease(checks: Record<string, boolean>, placement: string | null | undefined): boolean {
  return requiredChecks(placement).every((key) => checks[key] === true);
}

/** A hold has to say what is wrong, or the next person cannot act on it. */
export const canHold = (notes: string) => notes.trim().length >= 8;
