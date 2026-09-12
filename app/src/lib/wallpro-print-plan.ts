import { layoutMetrics, validWallSize, WALLPRO_PRINT_WIDTH, type WallLayout } from './wallpro-geometry';

export type WallPrintSettings = { bleed: number; overlap: number; minPpi: number };
export const DEFAULT_WALL_PRINT: WallPrintSettings = { bleed: 1, overlap: 0.5, minPpi: 150 };
export type PrintRect = { x: number; y: number; width: number; height: number };
export type WallPrintPanel = PrintRect & { number: number; overlapLeft: number };
export type WallPrintPlan = {
  wall: { width: number; height: number };
  settings: WallPrintSettings;
  bounds: PrintRect;
  panels: WallPrintPanel[];
};
const clean = (n: number) => Number(n.toFixed(6));

/** One wall coordinate system. Only the wall perimeter receives bleed; seams
 * duplicate real neighboring artwork. Every PDF's total width stays within
 * WALLPRO_PRINT_WIDTH. */
export function planWallPrint(width: number, height: number, settings: WallPrintSettings): WallPrintPlan {
  if (!validWallSize(width, height)) throw new Error('Enter a wall width and height between 1 and 2,400 inches.');
  if (![settings.bleed, settings.overlap, settings.minPpi].every(Number.isFinite)
    || settings.bleed < 0 || settings.bleed > 5 || settings.overlap < 0 || settings.overlap > 5
    || settings.minPpi < 72 || settings.minPpi > 600) {
    throw new Error('Use 0–5 inches of bleed and overlap, and a minimum resolution of 72–600 PPI.');
  }
  const { bleed, overlap } = settings;
  const bounds = { x: -bleed, y: -bleed, width: clean(width + 2 * bleed), height: clean(height + 2 * bleed) };
  const end = width + bleed;
  const panels: WallPrintPanel[] = [];
  for (let start = -bleed; start < end - 1e-7;) {
    const right = Math.min(start + WALLPRO_PRINT_WIDTH, end);
    panels.push({ number: panels.length + 1, x: clean(start), y: -bleed, width: clean(right - start), height: bounds.height, overlapLeft: panels.length ? overlap : 0 });
    if (right >= end - 1e-7) break;
    start = clean(right - overlap);
  }
  return { wall: { width, height }, settings: { ...settings }, bounds, panels };
}

export function wallPrintPreflight(layout: WallLayout, settings: WallPrintSettings, pixels: { width: number; height: number }) {
  if (![pixels.width, pixels.height].every(n => Number.isSafeInteger(n) && n > 0)
    || pixels.width * pixels.height > 60_000_000) throw new Error('Choose artwork with valid pixel dimensions, up to 60 megapixels.');
  const plan = planWallPrint(layout.width, layout.height, settings);
  const metrics = layoutMetrics(layout, pixels.width / pixels.height);
  const ppi = Math.min(pixels.width / metrics.artworkWidth, pixels.height / metrics.artworkHeight);
  const blockers: string[] = [];
  if (ppi + 1e-6 < settings.minPpi) {
    blockers.push(`Artwork provides ${ppi.toFixed(1)} PPI at this size; your minimum is ${settings.minPpi} PPI. Upload higher-resolution artwork${layout.mode === 'repeat' ? ' or reduce the pattern tile width' : ' or reduce the wall size'}.`);
  }
  if (layout.mode === 'repeat') {
    const placements = (Math.ceil(plan.bounds.width / metrics.artworkWidth) + 2) * (Math.ceil(plan.bounds.height / metrics.artworkHeight) + 2);
    if (placements > 20000) blockers.push('This wall needs more than 20,000 pattern placements. Increase the tile size or export a smaller wall section.');
  }
  return { plan, metrics, ppi, blockers, ready: blockers.length === 0,
    requiredPixels: { width: Math.ceil(metrics.artworkWidth * settings.minPpi), height: Math.ceil(metrics.artworkHeight * settings.minPpi) } };
}

export function intersectPrintRect(a: PrintRect, b: PrintRect): PrintRect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 1e-8 && height > 1e-8 ? { x, y, width, height } : null;
}

/**
 * WHAT WEPRINTWRAPS ACTUALLY BILLS (owner spec sheet, 2026-09-12: Avery HP MPI
 * 2610 wall vinyl, matte/luster, billed per linear foot, "all panels billed at
 * 54 in width, regardless of actual printed width").
 *
 * Square footage of the wall is NOT the bill, and the gap is not small. A 142
 * inch wall needs three panels — 54, 54 and 34 — but the narrow one is billed
 * at the full 54, so the shop bills 162 inches of roll width for 142 inches of
 * wall. Quoting off wall area understates every job whose width is not a clean
 * multiple of 54, which is nearly all of them.
 *
 * Linear feet run along the roll, so a panel's LENGTH is the wall height plus
 * its bleed. Width never enters the linear-foot figure — that is the whole
 * point of billing every panel at the roll width.
 */
export type WallBilling = {
  panels: number;
  /** Roll length consumed, in feet: what the price per linear foot multiplies. */
  linearFeet: number;
  /** Printed length of one panel, in inches (wall height plus bleed both ends). */
  panelLengthIn: number;
  /** Billed width per panel — the roll, not the printed width. */
  billedWidthIn: number;
  /** Billed area in square feet, at the billed width. */
  billedSqFt: number;
  /** The wall's own area, for the honest comparison. */
  wallSqFt: number;
};

export function wallBilling(
  width: number,
  height: number,
  settings: WallPrintSettings,
  rollWidthIn: number,
): WallBilling | null {
  if (![width, height, rollWidthIn].every(n => Number.isFinite(n) && n > 0)) return null;
  if (!Number.isFinite(settings.bleed) || settings.bleed < 0) return null;
  const panels = Math.ceil(width / rollWidthIn);
  const panelLengthIn = height + 2 * settings.bleed;
  const linearFeet = Math.round(((panels * panelLengthIn) / 12) * 100) / 100;
  return {
    panels,
    linearFeet,
    panelLengthIn: Math.round(panelLengthIn * 100) / 100,
    billedWidthIn: rollWidthIn,
    billedSqFt: Math.round(((panels * rollWidthIn * panelLengthIn) / 144) * 100) / 100,
    wallSqFt: Math.round(((width * height) / 144) * 100) / 100,
  };
}
