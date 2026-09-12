import { describe, expect, it } from 'vitest';
import { clampReveal, compareAriaLabel, compareExportSize, revealFromPointer } from '../wallpro-compare';

describe('the reveal handle', () => {
  it('stays inside the picture', () => {
    expect(clampReveal(-40)).toBe(0);
    expect(clampReveal(140)).toBe(100);
    expect(clampReveal(37)).toBe(37);
  });

  it('recovers from a value that is not a number', () => {
    expect(clampReveal(Number.NaN)).toBe(50);
  });

  it('tracks the pointer across the box', () => {
    const rect = { left: 100, width: 400 };
    expect(revealFromPointer(100, rect)).toBe(0);
    expect(revealFromPointer(300, rect)).toBe(50);
    expect(revealFromPointer(500, rect)).toBe(100);
    // A drag that leaves the element does not run the handle off the end.
    expect(revealFromPointer(20, rect)).toBe(0);
    expect(revealFromPointer(900, rect)).toBe(100);
  });

  // One frame during layout has a zero-width box; snapping the handle to an
  // edge there would make the picture jump as it settles.
  it('holds the midpoint while the box has no width yet', () => {
    expect(revealFromPointer(300, { left: 0, width: 0 })).toBe(50);
  });

  it('says what it is showing, for a screen reader', () => {
    expect(compareAriaLabel(30)).toBe('Before and after: showing 30% of your original wall, 70% of the design');
  });
});

describe('the shareable export', () => {
  it('is the two pictures side by side with the divider between them', () => {
    const size = compareExportSize({ width: 1200, height: 900 }, { width: 1200, height: 900 }, 8)!;
    expect(size).toEqual({ width: 2408, height: 900, paneWidth: 1200, divider: 8 });
  });

  // The two are the same wall from the same camera, so they should already
  // agree; taking the smaller of each never stretches or letterboxes one,
  // which would misreport the framing of a photo someone is about to send on.
  it('never stretches a mismatched pair', () => {
    const size = compareExportSize({ width: 1200, height: 900 }, { width: 1000, height: 800 }, 8)!;
    expect(size.paneWidth).toBe(1000);
    expect(size.height).toBe(800);
  });

  it('refuses a pair that has no size yet', () => {
    expect(compareExportSize({ width: 0, height: 900 }, { width: 1200, height: 900 })).toBeNull();
    expect(compareExportSize({ width: 1200, height: 0 }, { width: 1200, height: 900 })).toBeNull();
  });
});
