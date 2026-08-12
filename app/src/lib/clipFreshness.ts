/**
 * clipFreshness — stop cutting the same footage over and over.
 *
 * Measured on 2026-08-05: of 405 raw videos in the library, **322 have never
 * appeared in a single render**. Only 83 have ever been used. The cuts were
 * not short of material — the material was never reachable, and nothing ever
 * showed which clips had already been spent.
 *
 * Every render records exactly what it used: `video_render_jobs.blueprint`
 * carries `scenes[].clipUrl`. That is a complete usage history nobody was
 * reading. This turns it into the thing the picker needs — which clips are
 * FRESH, which are worn out, and how worn.
 *
 * Pure and I/O-free so the ranking is testable without a database.
 */

/** A render's blueprint, as far as this module cares. */
export interface RenderBlueprintRow {
  blueprint?: { scenes?: Array<{ clipUrl?: string | null }> } | null;
  created_at?: string | null;
}

export interface ClipUsage {
  /** How many renders have used this clip. */
  count: number;
  /** ISO date of the most recent render that used it, when known. */
  lastUsed: string | null;
}

/**
 * Build url → usage from render rows.
 *
 * A clip used twice IN ONE render counts once for that render: repeating a
 * clip inside a cut is an editing choice, not evidence the clip is worn out
 * across the catalogue.
 */
export function buildUsageMap(rows: RenderBlueprintRow[] | null | undefined): Map<string, ClipUsage> {
  const map = new Map<string, ClipUsage>();
  for (const row of rows || []) {
    const scenes = row?.blueprint?.scenes;
    if (!Array.isArray(scenes)) continue;
    const seenInThisRender = new Set<string>();
    for (const scene of scenes) {
      const url = typeof scene?.clipUrl === "string" ? scene.clipUrl.trim() : "";
      if (!url || seenInThisRender.has(url)) continue;
      seenInThisRender.add(url);
      const prev = map.get(url);
      const when = row.created_at || null;
      map.set(url, {
        count: (prev?.count ?? 0) + 1,
        lastUsed: !prev?.lastUsed || (when && when > prev.lastUsed) ? when : prev.lastUsed,
      });
    }
  }
  return map;
}

export function usageFor(usage: Map<string, ClipUsage>, url: string | null | undefined): ClipUsage {
  if (!url) return { count: 0, lastUsed: null };
  return usage.get(url) || { count: 0, lastUsed: null };
}

export function isFresh(usage: Map<string, ClipUsage>, url: string | null | undefined): boolean {
  return usageFor(usage, url).count === 0;
}

export interface RankableClip {
  id: string;
  url: string;
}

/**
 * Order clips so UNUSED footage comes first, then least-used, then
 * least-recently-used.
 *
 * The old order was newest-first, which is precisely why the same clips kept
 * being chosen: the freshest UPLOAD is not the freshest FOOTAGE, and whatever
 * sat at the top of the list got picked again next time.
 *
 * Stable within a tier — the incoming order (newest-first) is preserved for
 * clips of equal wear, so this reorders without shuffling anything randomly.
 * A random shuffle would make the picker non-reproducible, which is worse for
 * someone trying to find a specific clip.
 */
export function rankByFreshness<T extends RankableClip>(
  clips: T[],
  usage: Map<string, ClipUsage>,
): T[] {
  return clips
    .map((c, i) => ({ c, i, u: usageFor(usage, c.url) }))
    .sort((a, b) => {
      if (a.u.count !== b.u.count) return a.u.count - b.u.count;
      // Both used the same number of times: the one used longer ago first.
      const al = a.u.lastUsed || "";
      const bl = b.u.lastUsed || "";
      if (al !== bl) return al < bl ? -1 : 1;
      return a.i - b.i; // stable
    })
    .map((x) => x.c);
}

export interface FreshnessSummary {
  total: number;
  fresh: number;
  used: number;
  /** Share of the pool never cut, 0–100. */
  freshPercent: number;
}

export function summarise<T extends RankableClip>(
  clips: T[],
  usage: Map<string, ClipUsage>,
): FreshnessSummary {
  const total = clips.length;
  const fresh = clips.filter((c) => isFresh(usage, c.url)).length;
  return {
    total,
    fresh,
    used: total - fresh,
    freshPercent: total ? Math.round((fresh / total) * 100) : 0,
  };
}

/** Short human label for a clip's wear, or null when it is untouched. */
export function usageLabel(u: ClipUsage): string | null {
  if (!u.count) return null;
  return u.count === 1 ? "used once" : `used ${u.count}×`;
}
