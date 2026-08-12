/**
 * contentOsRouting — WHICH SURFACE OWNS A PIECE OF CONTENT.
 *
 * Owner, 2026-08-05: "Content director should show ideas for approval and the
 * actual ai created content is supposed to be on brand board for approval or
 * edits. Fix that wire as Operating System."
 *
 * Both pages read `agent_social_posts`, and neither had a boundary, so a
 * finished render appeared in BOTH — a giant video player wedged into the
 * Director's idea queue (which is what "impossible to see, stretched and
 * distorted" was looking at) and the same piece again on the Brand Board. Two
 * approve buttons for one post, on two pages, with different meanings.
 *
 * ── THE BOUNDARY ────────────────────────────────────────────────────────────
 *
 *   Content Director  →  IDEAS.  A hook, a concept, a caption with no artwork.
 *                        You approve the IDEA and the content gets made.
 *   Brand Board       →  MADE.   Produced artwork you can look at.
 *                        You approve or EDIT the actual piece.
 *
 * One rule decides, and both surfaces import it, so they can never disagree
 * about who owns a card.
 *
 * ── THE RULE IS "THE BOARD WILL SHOW IT", NOT "HAS ANY MEDIA" ──────────────
 *
 * Routing reuses the board's own `isFinishedWork`, so a piece moves only if
 * the board will really display it. Anything else stays in the Director.
 * Nothing falls between the two pages — that invariant is the whole point, and
 * it holds no matter how the board's rule changes, because there is only one
 * rule and both surfaces import it.
 *
 * What the rule COUNTS changed on 2026-08-06. It used to require a still, so a
 * poster-less render stayed in the Director; now a playable video is finished
 * work and such a piece routes to the Board. That is the intended direction —
 * a rendered video is made content, and the boundary above says made content
 * is approved on the Board. See `brandBoardFinished`'s header for the
 * measurement behind it (33 finished videos the board could not show).
 *
 * Locked by `tests/content-os-routing.test.ts`.
 */

import { isFinishedWork, isImageUrl, type FinishedCandidate } from "./brandBoardFinished";
import { hasOpenVideoEditTicket } from "./videoEditTicket";

/** The Director's own queue shape, narrowed to what routing needs. */
export interface RoutableCard {
  media_urls?: string[] | null;
  /** Open production brief. It stays in the Director until the edit completes. */
  generation_meta?: Record<string, unknown> | null;
  /** Poster joined from the render — what makes a video card reviewable. */
  thumbnail_url?: string | null;
  /** Social post or email campaign. */
  kind?: string | null;
  /**
   * An email campaign's artwork IS its HTML (`agent_email_campaigns.body_html`).
   *
   * This field, and the branch that reads it, exist because the comment here
   * used to say "email has no artwork to route" — so every email campaign
   * failed the media test and the Brand Board simply showed all of them.
   * Measured 2026-08-10: of 194 campaigns carrying body_html, TEN had a layout
   * and 184 were a bare copy fragment. All 194 sat on the approval board, where
   * 184 of them could not be design-approved because there was no design.
   */
  body_html?: string | null;
}

export type ContentSurface = "director" | "brand-board";

/** Which table a Director card lives in — the Brand Board keys cards by it. */
export function sourceTableFor(card: RoutableCard): string {
  return card.kind === "email_campaign" ? "agent_email_campaigns" : "agent_social_posts";
}

/**
 * Is this a MADE piece the Brand Board will actually display?
 *
 * `source` is forced to the post table rather than passed through: the Director
 * only ever holds posts and campaigns, never hooks or tasks, so the idea-source
 * denylist has nothing to reject here — the visual is the whole test.
 */
/**
 * Does this email HTML carry a real LAYOUT, or is it a copy fragment?
 *
 * A `<table>` is the signal, and it is a reliable one in this direction:
 * Outlook renders with Word's engine, which ignores flexbox and grid, so every
 * email a human or an ESP builds is table-based — Klaviyo's masters included.
 * A copy fragment (`<h2>…</h2><p>…</p>`, or raw text) never has one.
 *
 * This is the email equivalent of "has a thumbnail": the cheap, honest test for
 * whether there is anything to LOOK at.
 */
export function hasEmailDesign(html: string | null | undefined): boolean {
  return /<table\b/i.test(String(html || ""));
}

export function isMadeContent(card: RoutableCard | null | undefined): boolean {
  if (!card) return false;
  // AN EMAIL IS MADE WHEN IT HAS A DESIGN, not when it has a picture. It never
  // has media_urls or a thumbnail, so without this it can only ever fail the
  // visual test below — which is why copy-only campaigns reached the board.
  if (hasEmailDesign(card.body_html)) return true;
  // A source or work-in-progress output does not make an EDIT TICKET a
  // finished post. Keep the actual ticket on its card in Content Director;
  // state=complete releases the produced piece to the Brand Board boundary.
  if (hasOpenVideoEditTicket(card.generation_meta)) return false;
  const candidate: FinishedCandidate = {
    source: sourceTableFor(card),
    thumb: card.thumbnail_url ?? null,
    mediaUrls: card.media_urls ?? null,
  };
  return isFinishedWork(candidate);
}

/**
 * The still to show for a made piece — the FIRST url that is actually an image.
 *
 * Not `thumbnail_url || media_urls[0]`: a post can carry its poster second (an
 * .mp4 first), and that shortcut hands an .mp4 to an <img>, which paints
 * nothing. Routing already guarantees one of these is an image, so this always
 * finds it. Returns null for a card that isn't made.
 */
export function posterFor(card: RoutableCard | null | undefined): string | null {
  if (!card) return null;
  const candidates = [card.thumbnail_url, ...(card.media_urls || [])];
  for (const u of candidates) {
    const s = String(u || "").trim();
    if (isImageUrl(s)) return s;
  }
  return null;
}

/** The one routing decision. Every card resolves to exactly one surface. */
export function surfaceFor(card: RoutableCard | null | undefined): ContentSurface {
  return isMadeContent(card) ? "brand-board" : "director";
}

export interface SurfaceSplit<T> {
  /** Ideas — copy awaiting approval, and the content gets made from them. */
  ideas: T[];
  /** Made pieces — they belong to the Brand Board for approval or edits. */
  made: T[];
}

/** Split a Director queue without reordering either half. */
export function splitBySurface<T extends RoutableCard>(cards: T[] | null | undefined): SurfaceSplit<T> {
  const ideas: T[] = [];
  const made: T[] = [];
  for (const c of cards || []) (isMadeContent(c) ? made : ideas).push(c);
  return { ideas, made };
}

/**
 * Deep link to one card on the Brand Board.
 *
 * The handoff is only real if it lands on the PIECE. Sending someone to a board
 * of hundreds of cards to go find the one they just clicked is the same dead
 * end as `?post=` was before the Director learned to scroll to it.
 */
export function brandBoardLinkFor(card: RoutableCard & { id: string }): string {
  return `/admin/brand-board?card=${encodeURIComponent(`${sourceTableFor(card)}:${card.id}`)}`;
}

/** Parse that link back — `<source>:<id>`, tolerant of ids containing colons. */
export function parseBrandBoardCardParam(
  param: string | null | undefined,
): { source: string; id: string } | null {
  const raw = String(param || "").trim();
  if (!raw) return null;
  const cut = raw.indexOf(":");
  if (cut <= 0 || cut === raw.length - 1) return null;
  return { source: raw.slice(0, cut), id: raw.slice(cut + 1) };
}
