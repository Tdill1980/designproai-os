/**
 * boardCard — the PURE decisions behind putting a render on the Content Review
 * board. Separate from sendRenderToBoard.ts (which imports the Supabase client
 * and therefore can't be loaded in a unit test) so these rules are testable.
 */

/** The lane AdminApprovalBoard displays; the real target brand rides in metadata. */
export const BOARD_LANE = "weprintwraps";

export interface BoardTarget {
  platform: string;
  postType: string;
  channel: string;
}

/** 9:16 posts as an IG Reel; 16:9 is a YouTube upload; 1:1 is an IG feed post. */
export function targetFor(bp: any): BoardTarget {
  const ar = bp?.aspectRatio || "9:16";
  if (ar === "16:9") return { platform: "youtube", postType: "video", channel: "youtube" };
  if (ar === "1:1") return { platform: "instagram", postType: "feed", channel: "instagram_feed" };
  return { platform: "instagram", postType: "reel", channel: "instagram_reel" };
}

/**
 * A starting caption — never invented copy. The blueprint's own caption is the
 * truth. With only a title we say plainly that the caption still needs writing,
 * rather than filling the field with something the footage doesn't support.
 */
export function startingCaption(bp: any): string {
  const cap = typeof bp?.caption === "string" ? bp.caption.trim() : "";
  if (cap) return cap;
  const title = typeof bp?.title === "string" ? bp.title.trim() : "";
  return title ? `${title}\n\n(Caption not written yet — edit before approving.)` : "";
}

/** Human label for the attached file, so a card with two cuts is unambiguous. */
export function attachmentNameFor(bp: any): string {
  const fmt = bp?.aspectRatio === "16:9" ? "YouTube 16:9"
    : bp?.aspectRatio === "1:1" ? "Square 1:1"
    : "Reel 9:16";
  const dur = Number(bp?.totalDuration);
  return Number.isFinite(dur) && dur > 0 ? `${fmt} · ${Math.round(dur)}s` : fmt;
}

/** Idempotency key — one card per render, so re-sending refreshes, never stacks. */
export function renderGroupKey(jobId: string): string {
  return `render_${jobId}`;
}

/**
 * Why a render can't go to the board yet, or null when it can. An unfinished
 * render must never reach a human as "approve this".
 */
export function boardBlocker(job: { status?: string | null; final_url?: string | null }): string | null {
  if (!job?.final_url) return "That render has no file yet — wait for it to finish.";
  if (job.status && job.status !== "complete") return `That render is ${job.status}, not complete.`;
  return null;
}
