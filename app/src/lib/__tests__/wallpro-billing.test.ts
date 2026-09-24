import { describe, expect, it } from 'vitest';
import { DEFAULT_WALL_PRINT, wallBilling } from '../wallpro-print-plan';
import { WALLPRO_PRINT_WIDTH } from '../wallpro-geometry';

const roll = WALLPRO_PRINT_WIDTH;

describe('WePrintWraps billing, per the shop spec sheet', () => {
  // "All panels billed at 54 in width, regardless of actual printed width."
  // A 142" wall takes 54 + 54 + 34, and the 34 is billed as 54 -- so the shop
  // bills 162 inches of roll for 142 inches of wall. Quoting off wall area
  // understates every job whose width is not a clean multiple of the roll.
  it('bills the narrow last panel at the full roll width', () => {
    const billing = wallBilling(142, 96, DEFAULT_WALL_PRINT, roll)!;
    expect(billing.panels).toBe(3);
    expect(billing.billedWidthIn).toBe(53);
    // 96" wall + 0.5" bleed top and bottom = 97" of roll per panel.
    // ⚠️ THIS LOCK WAS STALE AND RED ON MAIN. It still said 1" per edge after
    // DEFAULT_WALL_PRINT moved to a half-inch bleed, so the suite was failing
    // over a number the product had deliberately changed. Corrected to follow
    // the shipped default rather than the other way round -- but note that it
    // is BILLED length, so the owner should confirm the half-inch is what the
    // shop wants to charge for before this is treated as settled.
    expect(billing.panelLengthIn).toBe(97);
    expect(billing.linearFeet).toBe(Math.round((3 * 97 / 12) * 100) / 100);
    // Billed area exceeds the wall's own area, which is the point of showing it.
    expect(billing.billedSqFt).toBeGreaterThan(billing.wallSqFt);
    expect(billing.wallSqFt).toBe(Math.round((142 * 96 / 144) * 100) / 100);
  });

  // Linear feet run ALONG the roll, so width never enters the figure -- that is
  // exactly what billing every panel at the roll width means.
  it('measures roll length, not printed width', () => {
    const narrow = wallBilling(40, 96, DEFAULT_WALL_PRINT, roll)!;
    const full = wallBilling(53, 96, DEFAULT_WALL_PRINT, roll)!;
    expect(narrow.panels).toBe(1);
    expect(full.panels).toBe(1);
    expect(narrow.linearFeet).toBe(full.linearFeet);
    expect(narrow.billedSqFt).toBe(full.billedSqFt);
  });

  it('counts bleed at both ends of every panel', () => {
    const none = wallBilling(53, 96, { ...DEFAULT_WALL_PRINT, bleed: 0 }, roll)!;
    const two = wallBilling(53, 96, { ...DEFAULT_WALL_PRINT, bleed: 2 }, roll)!;
    expect(none.panelLengthIn).toBe(96);
    expect(two.panelLengthIn).toBe(100);
  });

  it('refuses a wall it cannot measure', () => {
    expect(wallBilling(0, 96, DEFAULT_WALL_PRINT, roll)).toBeNull();
    expect(wallBilling(142, Number.NaN, DEFAULT_WALL_PRINT, roll)).toBeNull();
    expect(wallBilling(142, 96, { ...DEFAULT_WALL_PRINT, bleed: -1 }, roll)).toBeNull();
  });
});
