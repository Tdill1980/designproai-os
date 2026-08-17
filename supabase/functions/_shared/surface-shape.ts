/**
 * surface-shape — the CROP each social surface needs, and how few cuts buy them.
 *
 * Owner, 2026-08-07: "If we click approve content director idea it should
 * automatically create a job to build… The crop plus edit unique to social
 * channel."
 *
 * ── WHAT WAS MISSING ───────────────────────────────────────────────────────
 * `actionIdeaApprove` found footage and ATTACHED it. It never queued a build.
 * Measured on production over every row that action has produced:
 *
 *     59 rows from idea_approve
 *      0 with a build job          ← approve has never once queued a render
 *     37 carrying a finished cut   (whatever shape it happened to be)
 *     18 carrying a RAW clip       (unedited source, attached as if it were content)
 *      7 surfaces per idea sharing 1–2 distinct files
 *
 * So a 9:16 reel, a 16:9 X post and a 4:5 carousel were all handed the same
 * file. One of those three is right by luck and the other two are letterboxed
 * or cropped by the platform, badly, at upload time.
 *
 * ── THE ECONOMY: SHAPES, NOT SURFACES ──────────────────────────────────────
 * Queueing one render per surface would be seven renders per idea. It would
 * also be waste: what actually differs between an Instagram reel and a YouTube
 * Short is nothing — both are 9:16 from the same source. The CROP is the
 * per-channel work, so cuts are grouped by SHAPE and surfaces sharing a shape
 * share a file. Seven surfaces collapse to three renders (9:16, 4:5, 16:9),
 * and each surface still gets a file that is correct for it.
 *
 * Measured at p90 render time (5.6 min) this is ~17 min of worker time per
 * approved idea rather than ~39.
 *
 * ── THE ASPECTS ARE THE RENDERER'S, NOT NEW ONES ───────────────────────────
 * Every aspect below is one `worker/video-renderer`'s `ASPECT_DIMS` already
 * knows, and every `format` is one its `FORMAT_ASPECT` already maps to that
 * aspect. Inventing a fourth shape here would render at the fallback and be
 * wrong in a way nothing downstream could fix — the pixels are baked.
 * `tests/surface-shape.test.ts` pins this file to the renderer's own tables.
 */

/** A shape one or more surfaces share. `format` is what the renderer reads. */
export interface SurfaceShape {
  aspect: "9:16" | "16:9" | "4:5" | "1:1";
  /** A `FORMAT_ASPECT` key in the renderer, so the format implies the aspect. */
  format: string;
}

/**
 * Surface → the shape it needs.
 *
 * Keyed by `platform:post_type` because one platform wears several shapes: an
 * Instagram REEL is 9:16 and an Instagram FEED post is 4:5, and handing the
 * feed a vertical file wastes two thirds of the frame.
 */
export const SURFACE_SHAPE: Record<string, SurfaceShape> = {
  "instagram:reel": { aspect: "9:16", format: "reel" },
  "instagram:feed": { aspect: "4:5", format: "carousel" },
  "instagram:story": { aspect: "9:16", format: "story" },
  "facebook:feed": { aspect: "4:5", format: "carousel" },
  "youtube:short": { aspect: "9:16", format: "short" },
  "youtube:longform": { aspect: "16:9", format: "longform" },
  // X and LinkedIn are landscape-first surfaces in the feed. A vertical file
  // posts as a tall sliver with bars either side.
  "x:thread": { aspect: "16:9", format: "landscape" },
  "x:post": { aspect: "16:9", format: "landscape" },
  "linkedin:post": { aspect: "16:9", format: "landscape" },
  // Threads mirrors Instagram's feed shape.
  "threads:post": { aspect: "4:5", format: "carousel" },
};

/**
 * Surfaces with NO video shape, and why — not an oversight.
 *
 * `substack:newsletter` is an email. A render would produce a file nothing in
 * the newsletter path can embed, and it would be billed like any other cut.
 */
export const NO_VIDEO_SURFACES = new Set(["substack:newsletter"]);

export function surfaceKey(platform: string, postType: string): string {
  return `${String(platform || "").trim().toLowerCase()}:${String(postType || "").trim().toLowerCase()}`;
}

/** The shape a surface needs, or null when it takes no video. */
export function shapeFor(platform: string, postType: string): SurfaceShape | null {
  const key = surfaceKey(platform, postType);
  if (NO_VIDEO_SURFACES.has(key)) return null;
  return SURFACE_SHAPE[key] || null;
}

export interface PlannedCut {
  aspect: SurfaceShape["aspect"];
  format: string;
  /** The `platform:post_type` keys this one file serves. */
  surfaces: string[];
}

/**
 * The DISTINCT cuts a set of surfaces needs.
 *
 * Deterministic order (by aspect name) so the same idea plans the same cuts on
 * every call — a build keyed on this must be idempotent, and a set iteration
 * order that wandered would mint duplicate jobs.
 *
 * A surface with no known shape is DROPPED, not guessed at. Guessing would
 * bake the wrong crop, and baked pixels cannot be corrected downstream.
 */
export function planCuts(surfaces: Array<{ platform: string; post_type: string }>): PlannedCut[] {
  const byAspect = new Map<string, PlannedCut>();
  for (const s of surfaces || []) {
    const shape = shapeFor(s.platform, s.post_type);
    if (!shape) continue;
    const existing = byAspect.get(shape.aspect);
    if (existing) {
      existing.surfaces.push(surfaceKey(s.platform, s.post_type));
    } else {
      byAspect.set(shape.aspect, {
        aspect: shape.aspect,
        format: shape.format,
        surfaces: [surfaceKey(s.platform, s.post_type)],
      });
    }
  }
  return [...byAspect.values()].sort((a, b) => a.aspect.localeCompare(b.aspect));
}

/**
 * A stable key for one idea's cut at one shape.
 *
 * The pre-spend fence: a render costs money and worker minutes, so re-approving
 * an idea must find the existing job instead of buying a second identical one.
 * Same shape as the guards in `marketing-agent` (`already_scored`) and
 * `designs.js` (`already_designed`).
 */
export function cutSourceRef(ideaId: string, aspect: string): string {
  return `idea_cut_${ideaId}_${aspect.replace(":", "x")}`;
}
