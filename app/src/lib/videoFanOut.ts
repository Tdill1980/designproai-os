/**
 * videoFanOut — one finished cut becomes the four pieces the owner named.
 *
 * Owner, 2026-08-06: "Canva templates, reels, longform, shorts" — answering
 * "is it still using engine spine to make diff pieces of content per video?"
 *
 * It was not. Measured the same day: `content_narratives` 0 rows,
 * `content_artifacts` 0 rows, and zero narratives ever created from a shot. A
 * render finished, landed on the Brand Board, and stopped there. This is the
 * planner that turns one finished cut into four.
 *
 * ── WHY A PLANNER AND NOT JUST FOUR RENDER CALLS ───────────────────────────
 * Because three of the four usually cost NOTHING, and the difference has to be
 * visible before the button is pressed. A 9:16 cut already IS the reel and
 * already IS the Short — the same file, sent two places. Re-rendering it would
 * spend a render to produce a byte-identical result. After a $500 bill nobody
 * could explain, a fan-out that silently quadruples render spend is not
 * acceptable, so every piece declares `method` up front:
 *
 *   reuse   — the finished file, as it is. Zero cost.
 *   render  — a real reformat job. Costs one render.
 *   canva   — autofilled from the brand's Canva template. Costs no render.
 *   blocked — cannot be made, and says exactly what would unblock it.
 *
 * ── THE CROP IS NOT FREE, AND IT SAYS SO ───────────────────────────────────
 * The worker scales-to-fill and CENTER-CROPS, so 16:9 → 9:16 throws away the
 * left and right of frame. On a centred subject that is fine; on a two-shot it
 * cuts somebody out of the picture. There is no subject tracking here, and
 * pretending otherwise would ship silently bad verticals — so a lossy reformat
 * carries a `warning` the human reads before approving.
 *
 * Pure by design: no database, no network, no clock. The I/O half lives in
 * `videoFanOutRun.ts`. Locked by `tests/video-fan-out.test.ts`.
 */

/** The four pieces one video produces. */
export type VideoFormatKey = "longform" | "reel" | "short" | "canva_graphic";

export type FanOutMethod = "reuse" | "render" | "canva" | "blocked";

/**
 * The longest a vertical piece may be and still be a Short/Reel.
 *
 * YouTube Shorts and Instagram Reels both cap at three minutes. A longer
 * vertical is not "a Short that needs approving" — it is a different edit, and
 * saying so is the difference between a plan and a wish.
 */
export const SHORT_MAX_SECONDS = 180;

export interface SourceCut {
  /** "16:9" | "9:16" | "1:1" | "4:5" — whatever the render actually produced. */
  aspectRatio?: string | null;
  durationSeconds?: number | null;
  title?: string | null;
  brand?: string | null;
  /** The finished file. Without it there is nothing to fan out. */
  finalUrl?: string | null;
  /** A poster frame — the still a Canva graphic is built around. */
  posterUrl?: string | null;
}

export interface FanOutOptions {
  /** True only when `brand_canva_templates` has a row for this brand. */
  canvaMapped?: boolean;
}

export interface PlannedPiece {
  key: VideoFormatKey;
  label: string;
  /** The channel job this piece does — same vocabulary as the narrative spine. */
  role: string;
  /** Which `ARTIFACT_KINDS` entry it becomes on the narrative. */
  artifactKind: string;
  method: FanOutMethod;
  aspectRatio: "16:9" | "9:16" | "4:5" | null;
  /** Set when `method === "blocked"` — why, and what would unblock it. */
  blocked?: string;
  /** Read this before approving: what the reformat costs in frame or length. */
  warning?: string;
}

function norm(aspect: string | null | undefined): string {
  return String(aspect || "").trim();
}

/**
 * What one finished cut can become.
 *
 * Always returns all four, in a fixed order, including the ones that cannot be
 * made. A piece missing from the list would read as "not applicable"; a piece
 * present and `blocked` reads as "here is what is stopping it" — the same
 * honest-gap rule the rest of the spine follows.
 */
export function planVideoDeliverables(cut: SourceCut, opts: FanOutOptions = {}): PlannedPiece[] {
  const from = norm(cut.aspectRatio);
  const seconds = Number(cut.durationSeconds) || 0;
  const hasFile = !!String(cut.finalUrl || "").trim();
  const isVertical = from === "9:16";
  const isWide = from === "16:9";
  const tooLongForShort = seconds > SHORT_MAX_SECONDS;

  // Nothing else in here is true without a file. Say it once, per piece,
  // rather than planning four jobs against a render that never finished.
  const noFile = "This cut has no finished file yet — nothing to fan out.";

  const longform: PlannedPiece = {
    key: "longform",
    label: "Longform (16:9)",
    role: "The full walkthrough on YouTube — the anchor everything else is cut from.",
    artifactKind: "youtube",
    method: !hasFile ? "blocked" : isWide ? "reuse" : "render",
    aspectRatio: "16:9",
    ...(!hasFile ? { blocked: noFile } : {}),
    ...(hasFile && !isWide
      ? {
          warning: from === "9:16"
            ? "Vertical source — the top and bottom of frame are cropped to make 16:9. Check anything near the edges."
            : `Source is ${from || "an unknown shape"} — it is scaled to fill 16:9 and cropped.`,
        }
      : {}),
  };

  const reel: PlannedPiece = {
    key: "reel",
    label: "Reel (9:16)",
    role: "Stops the scroll on Instagram — one idea, the sharpest one, in the first second.",
    artifactKind: "reel",
    method: !hasFile ? "blocked" : isVertical && !tooLongForShort ? "reuse" : "render",
    aspectRatio: "9:16",
    ...(!hasFile ? { blocked: noFile } : {}),
    ...(hasFile && isWide
      ? { warning: "Landscape source — the left and right of frame are cropped. Check anyone standing off-centre." }
      : {}),
    ...(hasFile && tooLongForShort
      ? {
          warning: `${Math.round(seconds)}s is over the ${SHORT_MAX_SECONDS}s Reel limit — this needs a trim, not just a reframe. Cut it in the Cut Editor first.`,
        }
      : {}),
  };

  const short: PlannedPiece = {
    key: "short",
    label: "YouTube Short (9:16)",
    // A Short is not a duplicate of the reel — it is the same file doing a
    // different job on a different surface, which is why it is its own
    // artifact rather than a second copy of `reel`.
    role: "YouTube's discovery surface — the same vertical, working where search and the feed overlap.",
    artifactKind: "youtube_short",
    method: !hasFile
      ? "blocked"
      : tooLongForShort
        ? "blocked"
        : isVertical
          ? "reuse"
          : "render",
    aspectRatio: "9:16",
    ...(!hasFile
      ? { blocked: noFile }
      : tooLongForShort
        ? {
            blocked: `${Math.round(seconds)}s is over YouTube's ${SHORT_MAX_SECONDS}s Shorts limit. Reformatting cannot shorten it — cut a Short in the Cut Editor.`,
          }
        : {}),
    ...(hasFile && !tooLongForShort && isWide
      ? { warning: "Landscape source — the left and right of frame are cropped." }
      : {}),
  };

  const canvaBlocked = !hasFile
    ? noFile
    : !opts.canvaMapped
      ? `No Canva brand template is mapped for ${cut.brand || "this brand"} — map one in Marketing Agent → Canva Brand Templates, then this makes a real on-brand graphic instead of a stock one.`
      : !String(cut.posterUrl || "").trim()
        ? "This cut has no poster frame yet — a graphic needs a still to build around."
        : null;

  const canva: PlannedPiece = {
    key: "canva_graphic",
    label: "Canva graphic (feed post)",
    role: "The static proof shot in the brand's real fonts, colours and logo — the piece the video cannot be.",
    artifactKind: "instagram",
    method: canvaBlocked ? "blocked" : "canva",
    aspectRatio: "4:5",
    ...(canvaBlocked ? { blocked: canvaBlocked } : {}),
  };

  return [longform, reel, short, canva];
}

/** How many real renders pressing this actually spends. */
export function renderCost(pieces: PlannedPiece[]): number {
  return (pieces || []).filter((p) => p.method === "render").length;
}

/**
 * One line for the button, said plainly.
 *
 * Leads with the cost, because that is the thing a human needs before pressing
 * and the thing that was invisible when the bill arrived.
 */
export function fanOutSummary(pieces: PlannedPiece[]): string {
  const list = pieces || [];
  const renders = renderCost(list);
  const reused = list.filter((p) => p.method === "reuse").length;
  const canva = list.filter((p) => p.method === "canva").length;
  const blocked = list.filter((p) => p.method === "blocked").length;

  const parts: string[] = [];
  parts.push(renders === 0 ? "No new renders" : renders === 1 ? "1 new render" : `${renders} new renders`);
  if (reused) parts.push(`${reused} from the finished file`);
  if (canva) parts.push(`${canva} from Canva`);
  if (blocked) parts.push(`${blocked} blocked`);
  return parts.join(" · ");
}
