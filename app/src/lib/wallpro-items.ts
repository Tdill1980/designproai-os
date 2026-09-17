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
