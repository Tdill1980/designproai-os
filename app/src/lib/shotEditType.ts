/**
 * shotEditType — which cut to make, with no I/O.
 *
 * Split out of `shotList.ts` for the same reason `kickMessages.ts` and
 * `castTreatments.ts` were split from their hosts: importing the Supabase
 * client pulls in `localStorage`, which does not exist in the node test
 * environment. The rule stays unit-testable; the database work stays next to
 * the client.
 */

export type EditType =
  | "reel" | "story" | "short_form_ad" | "podcast_clip" | "interview_clip"
  | "behind_the_scenes" | "long_form_segment" | "broll" | "carousel_assets"
  | "static_ad";

/**
 * The edit type to cut when nobody chose one.
 *
 * Measured 2026-08-05: `edit_type` is unset on all 102 shots, so this fallback
 * IS the common path, not an edge case — which is exactly why it is
 * conservative. Only the platform genuinely implies a shape. Everything else
 * becomes a vertical reel: it is what this footage is shot for, and it is the
 * cheapest thing to be wrong about, because a reel is reviewable in the Cut
 * Editor and re-cuttable into any other format from there.
 *
 * It never invents a format from a vague hint. A wrong guess costs a render
 * and, worse, teaches people the automation can't be trusted.
 */
export function inferEditType(platform?: string | null, contentType?: string | null): EditType {
  const p = String(platform || "").toLowerCase();
  const c = String(contentType || "").toLowerCase();
  // A YouTube SHORT is vertical — only long-form YouTube is 16:9.
  if (p.includes("youtube") && !p.includes("short")) return "long_form_segment";
  if (p.includes("story")) return "story";
  if (c.includes("interview")) return "interview_clip";
  if (c.includes("broll") || c.includes("b-roll")) return "broll";
  return "reel";
}
