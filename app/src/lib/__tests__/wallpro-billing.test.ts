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
    expect(billing.billedWidthIn).toBe(54);
    // 96" wall + 1" bleed top and bottom = 98" of roll per panel.
    expect(billing.panelLengthIn).toBe(98);
    expect(billing.linearFeet).toBe(Math.round((3 * 98 / 12) * 100) / 100);
    // Billed area exceeds the wall's own area, which is the point of showing it.
    expect(billing.billedSqFt).toBeGreaterThan(billing.wallSqFt);
    expect(billing.wallSqFt).toBe(Math.round((142 * 96 / 144) * 100) / 100);
  });

  // Linear feet run ALONG the roll, so width never enters the figure -- that is
  // exactly what billing every panel at the roll width means.
  it('measures roll length, not printed width', () => {
    const narrow = wallBilling(40, 96, DEFAULT_WALL_PRINT, roll)!;
    const full = wallBilling(54, 96, DEFAULT_WALL_PRINT, roll)!;
    expect(narrow.panels).toBe(1);
    expect(full.panels).toBe(1);
    expect(narrow.linearFeet).toBe(full.linearFeet);
    expect(narrow.billedSqFt).toBe(full.billedSqFt);
  });

  it('counts bleed at both ends of every panel', () => {
    const none = wallBilling(54, 96, { ...DEFAULT_WALL_PRINT, bleed: 0 }, roll)!;
    const two = wallBilling(54, 96, { ...DEFAULT_WALL_PRINT, bleed: 2 }, roll)!;
    expect(none.panelLengthIn).toBe(96);
    expect(two.panelLengthIn).toBe(100);
  });

  it('refuses a wall it cannot measure', () => {
    expect(wallBilling(0, 96, DEFAULT_WALL_PRINT, roll)).toBeNull();
    expect(wallBilling(142, Number.NaN, DEFAULT_WALL_PRINT, roll)).toBeNull();
    expect(wallBilling(142, 96, { ...DEFAULT_WALL_PRINT, bleed: -1 }, roll)).toBeNull();
  });
});
