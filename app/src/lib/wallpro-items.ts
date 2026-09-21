/**
 * THE DETECTED ITEMS, KEPT AS ITEMS.
 *
 * Owner, 2026-09-17, writing what she would say on camera: "Items that are in
 * front of wall will get removed automatically. If I want them back on wall I
 * simply click on each item and WallPro masks each item with one click."
 *
 * The first half was already true. The second was not, and the reason was a
 * throw-away rather than a missing capability: `detect-wall-openings` returns a
 * LIST of objects — each with its own label, its own bounding box, its own
 * pixel-accurate mask and a `fixed` / `movable` class — and the page immediately
 * rasterised that list into two composite PNGs and dropped it. From that moment
 * there was no "the sofa" to click; there was one protected blob and one
 * removable blob. Correcting a single wrong item meant clearing every detected
 * area and re-drawing it by hand: two taps for a rectangle, or a traced polygon
 * plus Finish mask.
 *
 * So the list survives, and a click flips one item between the two piles. The
 * composites are then rebuilt FROM the list, which keeps exactly one source of
 * truth: what is protected is whatever is currently classed `fixed`, never a
 * blob that has drifted from the items it was made of.
 *
 * `DetectedMask` already carries everything except identity and an override, so
 * an item is that type plus an id and the class the customer chose. The
 * detector's own answer stays on the row as `detected`, which is what makes
 * "Reset to what we detected" possible and what tells the page whether a
 * customer has actually overridden anything.
 */
import type { DetectedMask, OcclusionClass } from './wallpro-masks';

export type WallItem = DetectedMask & {
  /** Stable within one detection pass; the list is rebuilt on every re-detect. */
  id: string;
  /** What the detector said, kept so an override is distinguishable and reversible. */
  detected: OcclusionClass;
  /** What applies now: the detector's answer until the customer clicks. */
  applied: OcclusionClass;
};

/**
 * Anything other than a clean "movable" is protected — the same defaulting the
 * edge handler already applies, restated here because this module decides what
 * is painted through and must not be more destructive than the detector.
 * Protecting something that should have been removed is a cosmetic miss;
 * painting over something the customer wanted kept is their sofa erased.
 */
const classOf = (mask: DetectedMask): OcclusionClass => (mask.class === 'movable' ? 'movable' : 'fixed');

export function toWallItems(masks: DetectedMask[]): WallItem[] {
  return masks.map((mask, index) => {
    const detected = classOf(mask);
    return { ...mask, id: `item-${index}-${mask.label || 'area'}`, detected, applied: detected };
  });
}

/** One click: kept ⇄ painted through. Nothing else about the item changes. */
export function toggleItem(items: WallItem[], id: string): WallItem[] {
  return items.map(item => (
    item.id === id ? { ...item, applied: item.applied === 'fixed' ? 'movable' : 'fixed' } : item
  ));
}

export function resetItems(items: WallItem[]): WallItem[] {
  return items.map(item => ({ ...item, applied: item.detected }));
}

export function hasOverride(items: WallItem[]): boolean {
  return items.some(item => item.applied !== item.detected);
}

/**
 * The two piles the rasteriser takes, derived from `applied` and nothing else.
 * This replaces splitDetectedMasks at the call site that owns items — that
 * helper reads `class`, which is the DETECTOR's answer and therefore ignores
 * every click the customer has made.
 */
export function splitItems(items: WallItem[]): { fixed: WallItem[]; movable: WallItem[] } {
  const fixed: WallItem[] = [], movable: WallItem[] = [];
  for (const item of items) (item.applied === 'movable' ? movable : fixed).push(item);
  return { fixed, movable };
}

/**
 * Which item a tap belongs to: the SMALLEST box containing the point.
 *
 * Items overlap constantly in a real room — a cushion sits inside a sofa, a
 * drape inside a window surround — and the smallest containing box is the one
 * the customer meant, because the big one is reachable everywhere else along
 * its own edges. Picking the first match instead would make a large item
 * swallow every small item drawn on top of it.
 *
 * Boxes are normalized 0..1 in photo coordinates, the same space the corners
 * and hand-drawn masks use.
 */
export function itemAt(items: WallItem[], x: number, y: number): WallItem | null {
  let best: WallItem | null = null, bestArea = Infinity;
  for (const item of items) {
    const { x0, y0, x1, y1 } = item.box;
    if (x < Math.min(x0, x1) || x > Math.max(x0, x1) || y < Math.min(y0, y1) || y > Math.max(y0, y1)) continue;
    const area = Math.abs(x1 - x0) * Math.abs(y1 - y0);
    if (area < bestArea) { best = item; bestArea = area; }
  }
  return best;
}

/** "kept 3 · painted through 2", for the one line above the photo. */
export function itemSummary(items: WallItem[]): { kept: number; through: number } {
  const { fixed, movable } = splitItems(items);
  return { kept: fixed.length, through: movable.length };
}

/* ── Persistence ───────────────────────────────────────────────────────────
 *
 * ONE-TOUCH MASKING SURVIVED ONLY THE SESSION THAT DETECTED IT (owner,
 * 2026-09-21, asked whether one-touch masking works).
 *
 * Measured: `setItems` was called from exactly two places — the detection
 * result, and a customer's own tap re-toggling items that already existed —
 * and `detectInBackground` runs only on a FRESH photo upload or when an accent
 * zone is added. Reopening a saved project runs neither, and the project config
 * had no `items` key at all. So the composites came back as flattened rasters,
 * the design still respected them, and NOTHING on the photo was tappable. The
 * feature worked exactly once per photograph.
 *
 * WHY A FILE AND NOT THE CONFIG. Every item carries `png` — a data URL of its
 * own pixel-accurate mask — and that is what a tap needs to rebuild the two
 * composites. Inlining those in `wallpro_projects.config` would write hundreds
 * of kilobytes of jsonb on every save, and the page saves on every pattern-size
 * commit. So the list goes to storage like the masks already do and the config
 * carries a path, which is written once per detection or tap rather than once
 * per slider release.
 *
 * The parse is defensive because the file is read back as `any`: a truncated or
 * hand-edited list must degrade to "nothing tappable", which is today's
 * behaviour, never to a crash on a customer's restored project.
 */
export const WALL_ITEMS_CONTRACT = 'wallpro.items.v1';

export function serializeWallItems(items: WallItem[]): string {
  return JSON.stringify({ contract: WALL_ITEMS_CONTRACT, items });
}

const isBox = (b: unknown): b is WallItem['box'] => {
  if (!b || typeof b !== 'object') return false;
  const v = b as Record<string, unknown>;
  return ['x0', 'y0', 'x1', 'y1'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k] as number));
};
const isClass = (c: unknown): c is OcclusionClass => c === 'fixed' || c === 'movable';

/** Every row that is not a complete, usable item is dropped, not repaired. */
export function parseWallItems(payload: unknown): WallItem[] {
  const body = payload as { contract?: unknown; items?: unknown } | null;
  if (!body || typeof body !== 'object') return [];
  if (body.contract !== WALL_ITEMS_CONTRACT) return [];
  if (!Array.isArray(body.items)) return [];
  const seen = new Set<string>();
  const out: WallItem[] = [];
  for (const row of body.items) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    // `png` is what a tap re-rasterises from; an item without it can be shown
    // but never correctly re-applied, so it is not an item.
    if (typeof r.id !== 'string' || !r.id || typeof r.png !== 'string' || !r.png) continue;
    if (typeof r.label !== 'string' || !isBox(r.box)) continue;
    if (!isClass(r.detected) || !isClass(r.applied)) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id, label: r.label, box: r.box, png: r.png,
      class: isClass(r.class) ? r.class : r.detected,
      detected: r.detected, applied: r.applied,
    });
  }
  return out;
}

/* ── What the customer is asked to do ──────────────────────────────────────
 *
 * Owner, 2026-09-21: "No hand drawing I need one touch masks object if its not
 * coded that way then fix it and make sure app is clear on what user does."
 *
 * The capability was coded; the INSTRUCTIONS were not. Step one said "use the
 * mask tools on the photo for windows, drapes and furniture", the mask panel
 * said "mask the window and each drape", and marking the fourth corner opened
 * the drawing tools. So the app led with tracing polygons by hand and mentioned
 * tapping an object as an aside — which is how a customer ends up with three
 * rectangles labelled "Protected 1, 2, 3" and no idea the objects were already
 * found for her.
 *
 * One state machine decides the wording everywhere, so the page cannot say two
 * different things about the same moment. Drawing is never the headline; it is
 * offered only when detection has actually come back empty, which is the one
 * case where there is nothing to tap.
 */
export type WallMaskStage = 'detecting' | 'tap' | 'empty' | 'unavailable';

export type WallMaskGuidance = {
  stage: WallMaskStage;
  /** The one sentence telling the customer what to do now. */
  headline: string;
  /** Whether to offer hand-drawing at all. */
  offerDrawing: boolean;
};

export function wallMaskGuidance(input: {
  detecting: boolean;
  items: WallItem[];
  /** Areas the customer drew themselves, which are never taken away. */
  drawnCount: number;
  /** False when detection could not run at all (signed out, offline, refused). */
  available?: boolean;
}): WallMaskGuidance {
  const { detecting, items, drawnCount, available = true } = input;
  const drawn = drawnCount > 0 ? ` ${drawnCount} area${drawnCount === 1 ? '' : 's'} you marked by hand ${drawnCount === 1 ? 'is' : 'are'} kept too.` : '';

  if (detecting) {
    return {
      stage: 'detecting',
      headline: 'Finding the things on your wall — windows, drapes, shelves, furniture. A moment.',
      offerDrawing: false,
    };
  }
  if (items.length > 0) {
    const { kept, through } = itemSummary(items);
    return {
      stage: 'tap',
      // The verb first, and the thing it acts on named: a customer who reads
      // only the first four words still knows what to do.
      headline: `Tap anything on the photo to keep it or paint through it. Keeping ${kept}, painting through ${through}.${drawn}`,
      offerDrawing: false,
    };
  }
  if (!available) {
    return {
      stage: 'unavailable',
      headline: `We could not check this photo for things to keep. Mark anything that must stay exactly as photographed.${drawn}`,
      offerDrawing: true,
    };
  }
  return {
    stage: 'empty',
    headline: `Nothing on this wall needs keeping — the design covers it all. Mark anything we missed.${drawn}`,
    offerDrawing: true,
  };
}
