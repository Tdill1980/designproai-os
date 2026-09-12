// Before and after, on one picture.
//
// Owner, 2026-09-12: "before and after ... could be a smaller before in corner
// or a side by side on desktop and slider on mobile?" — and earlier, on the
// living-room photo: "Before and afters will speak volumes."
//
// ONE INTERACTION, NOT THREE. A drag-to-reveal slider is the same gesture with
// a mouse and with a thumb, so it needs no breakpoint split, no second layout
// to keep in sync, and no third one after that. It is also the pattern a
// customer has already used in every remodelling app they have ever opened.
//
// The two alternatives were considered and lost on their merits, not on effort:
//   side by side on desktop — the wall pane ALREADY sits in a two-column grid
//     beside the flat pane at xl, so a split inside it makes each picture a
//     quarter of the screen. Too small to judge a wall by.
//   a small before in the corner — a thumbnail is too small to judge anything,
//     and it covers part of the after to show it.
//
// WHAT "AFTER" IS ALLOWED TO BE. The deterministic composite, never the AI
// view. A before/after is the most persuasive thing WallPro produces and the
// most likely to be screenshotted, sent to a spouse and used to decide; making
// it out of a freehand repaint would spread the exact problem the AI view was
// just taken off the customer path for.
//
// Pure: the geometry only, so it is testable without a browser.

export const COMPARE_MIN = 0;
export const COMPARE_MAX = 100;
/** Arrow-key step, so the handle is usable without a pointer at all. */
export const COMPARE_STEP = 2;

/** Snap a reveal percentage into 0..100. */
export function clampReveal(percent: number): number {
  if (!Number.isFinite(percent)) return 50;
  return Math.min(COMPARE_MAX, Math.max(COMPARE_MIN, percent));
}

/**
 * Where the handle lands for a pointer at `clientX` over an element whose box
 * is `rect`. Returns a percentage from the element's left edge.
 *
 * A zero-width box would divide by zero — that happens for one frame while the
 * image is still laying out, and returning the midpoint keeps the handle where
 * it was rather than snapping it to an edge.
 */
export function revealFromPointer(clientX: number, rect: { left: number; width: number }): number {
  if (!Number.isFinite(rect.width) || rect.width <= 0) return 50;
  return clampReveal(((clientX - rect.left) / rect.width) * 100);
}

/** What the handle announces to a screen reader at this position. */
export function compareAriaLabel(percent: number): string {
  const pct = Math.round(clampReveal(percent));
  return `Before and after: showing ${pct}% of your original wall, ${100 - pct}% of the design`;
}

/**
 * The side-by-side canvas for the shareable export, in pixels.
 *
 * The two photographs are the same wall from the same camera, so they share a
 * size; the export is that size doubled across, plus a divider. Height is the
 * shorter of the two so neither is stretched — they should never differ, and
 * letterboxing one would be a lie about framing.
 */
export function compareExportSize(
  before: { width: number; height: number },
  after: { width: number; height: number },
  divider = 8,
): { width: number; height: number; paneWidth: number; divider: number } | null {
  const height = Math.min(before.height, after.height);
  const paneWidth = Math.min(before.width, after.width);
  if (!(height > 0) || !(paneWidth > 0)) return null;
  return { width: paneWidth * 2 + divider, height, paneWidth, divider };
}
