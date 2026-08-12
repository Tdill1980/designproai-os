/**
 * brandBoardFinished — which Brand Board cards are FINISHED WORK.
 *
 * Owner, 2026-08-05: "THE FUCKING BRAND BOARD DOESN'T SHOW ANY NEW COMPLETED
 * CONTENT, SAME HANDFUL OF STALE COMPLETED CONTENT."
 *
 * Measured against production the same day. Cards created in the last 7 days:
 *
 *     content_hooks        505      ← ideas
 *     slack_agent_tasks     98      ← to-do items
 *     agent_social_posts    58      ← drafts, no artwork
 *     video_render_jobs      9      ← ACTUAL FINISHED WORK
 *     blog / concepts / templates   0
 *
 * Nine finished pieces out of 670 new cards — **1.3%** — and the board had no
 * view that isolated them. All four tabs (Type, Template, Brand, Calendar)
 * mix hooks, tasks and templates in with produced artwork, so finished work is
 * buried under a 505-card pile of ideas. Opening the board to review designs
 * showed the same few pieces that happened to be visible last time. The
 * content was never missing; there was nowhere to see it.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * Finished work is something a human can LOOK AT and approve. Two conditions,
 * both required:
 *
 *   1. it came from a table that holds produced artifacts, not ideas or admin
 *   2. it has real MEDIA — a poster still, or a video file
 *
 * A hook is not finished work no matter how good it is. A draft caption with
 * no artwork is not finished work — that is exactly the "blank card" the board
 * used to be full of. Locked by `tests/brand-board-finished.test.ts`.
 *
 * ── VIDEO COUNTS. IT DID NOT, AND THAT HID MOST OF THE OUTPUT ──────────────
 * Owner, 2026-08-06, on the Brand Board: none of the content is showing.
 *
 * This rule used to require an IMAGE — `hasVisual` disqualified any `.mp4`
 * outright — because an unpostered `<video>` paints a blank rectangle and the
 * board had been full of those. Correct diagnosis, wrong cut. Video is most of
 * what this system MAKES, so "must be a still" silently excluded the majority
 * of the output. Measured against production the same day, over 30 days of
 * `agent_social_posts`: 160 posts, 82 of them video-only. 51 of those 82 were
 * rescued by the poster join added on 2026-08-05 — and 33 finished videos
 * still could not appear on the tab the board OPENS to.
 *
 * So the test is now "is there something to play or look at", not "is there a
 * still". A poster-less video is finished work; it renders as a labelled video
 * placeholder, never as an `<img src="…mp4">` — that broken tag was the actual
 * cause of the blank cards, not the absence of a still. `posterFor` is what
 * the card must use to decide which of the two to draw.
 *
 * Cards with NO media at all are still excluded, unchanged: a draft caption
 * with no artwork remains an idea, and that half of the original rule was
 * right.
 *
 * This also moves those pieces across the Director/Board boundary, which is
 * the intended direction — `contentOsRouting` sends anything the board will
 * display to the board, and a rendered video is made content, not an idea.
 */

/**
 * Tables whose rows are IDEAS, TASKS or TEMPLATES — never a finished piece.
 *
 * Deliberately a denylist, not an allowlist: a new artifact table added later
 * should show up as finished work by default, whereas a new idea table that
 * silently flooded this view would recreate the exact bug.
 */
export const IDEA_SOURCES = new Set([
  "content_hooks",            // 505 in one week — the flood
  "slack_agent_tasks",        // to-do cards for humans
  "marketing_standing_tasks", // recurring chores
  "social_templates",         // a shell to fill, not a piece
  "email_templates",
  "content_concepts",         // an angle, not an artifact
  "seo_pages",                // site inventory
  "agent_content_calendar",   // a slot, and it mirrors real rows anyway
]);

export interface FinishedCandidate {
  source?: string | null;
  thumb?: string | null;
  mediaUrl?: string | null;
  mediaUrls?: string[] | null;
}

const REAL_URL = /^(https?:|data:|blob:|\/)/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v|avi)($|\?)/i;
const AV_EXT = /\.(mp4|mov|webm|m4v|avi|mp3|wav|m4a)($|\?)/i;

/** Every media url on a card, in the order a poster should be looked for. */
function mediaOf(card: FinishedCandidate): string[] {
  return [card.thumb, card.mediaUrl, ...(card.mediaUrls || [])]
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean);
}

/**
 * The still this card can actually paint, or null if it has none.
 *
 * The card MUST branch on this rather than on `card.thumb`: handing an `.mp4`
 * to an `<img>` paints nothing while still downloading the whole file — live
 * examples on this board are 23 MB and 38 MB. That broken tag was the real
 * cause of the blank cards.
 */
export function posterFor(card: FinishedCandidate | null | undefined): string | null {
  if (!card) return null;
  return mediaOf(card).find((u) => isImageUrl(u)) || null;
}

/** Is there a playable video file on this card? */
export function hasPlayableVideo(card: FinishedCandidate | null | undefined): boolean {
  if (!card) return false;
  return mediaOf(card).some((u) => REAL_URL.test(u) && VIDEO_EXT.test(u));
}

/**
 * Is there an actual asset behind this card — something to look at OR play?
 *
 * Not "is there a still". Requiring a still excluded 33 finished videos from
 * the board's default tab; see the header. A poster-less video is finished
 * work that renders as a labelled placeholder.
 */
export function hasVisual(card: FinishedCandidate | null | undefined): boolean {
  if (!card) return false;
  return !!posterFor(card) || hasPlayableVideo(card);
}

/** A real, displayable still — not a video, not a stub, not an empty string. */
export function isImageUrl(u: string | null | undefined): boolean {
  const s = String(u || "").trim();
  if (!s || !REAL_URL.test(s)) return false;
  if (AV_EXT.test(s)) return false;
  // Storage render/transform endpoints and signed URLs have no extension but
  // are images; an explicit video extension is the only hard exclusion.
  return true;
}

/**
 * Finished = a produced artifact with something to look at.
 *
 * This is what the review board is FOR. It is not a status check: a completed
 * render sitting in `draft` is still finished work someone has to approve, and
 * a post marked `approved` with no artwork is not something anyone can review.
 */
export function isFinishedWork(card: FinishedCandidate | null | undefined): boolean {
  if (!card) return false;
  if (IDEA_SOURCES.has(String(card.source || ""))) return false;
  return hasVisual(card);
}

export interface FinishedSplit<T> {
  finished: T[];
  /** Everything else, so the count can be stated instead of quietly dropped. */
  rest: T[];
}

/** Split a card list without reordering either half. */
export function splitFinished<T extends FinishedCandidate>(cards: T[] | null | undefined): FinishedSplit<T> {
  const finished: T[] = [];
  const rest: T[] = [];
  for (const c of cards || []) (isFinishedWork(c) ? finished : rest).push(c);
  return { finished, rest };
}

/**
 * Why the view is empty — never a bare "nothing here".
 *
 * An empty board that says nothing is indistinguishable from a broken one,
 * which is how twelve days of a dead parser went unnoticed.
 */
export function emptyFinishedReason(total: number, ideas: number): string {
  if (total === 0) return "Nothing has loaded yet.";
  if (ideas > 0) {
    return `No finished pieces yet — ${ideas.toLocaleString()} of the ${total.toLocaleString()} cards here are hooks, tasks or templates. Finished work appears once something is actually rendered or designed.`;
  }
  return `None of the ${total.toLocaleString()} cards here have artwork yet.`;
}
