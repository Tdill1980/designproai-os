/**
 * The app must say what the customer DOES, and it is one tap, not a pencil.
 *
 * Owner, 2026-09-21: "No hand drawing I need one touch masks object if its not
 * coded that way then fix it and make sure app is clear on what user does."
 *
 * The capability was coded; the instructions were not. Step one said "use the
 * mask tools on the photo for windows, drapes and furniture", the mask panel
 * said "mask the window and each drape", and marking the fourth corner opened
 * the drawing tools — so a customer ended up with three rectangles labelled
 * "Protected 1, 2, 3" while the objects sat already found and already tappable.
 */
import { describe, it, expect } from 'vitest';
import { wallMaskGuidance, toWallItems, toggleItem } from '../wallpro-items';
import type { DetectedMask } from '../wallpro-masks';

const MASKS: DetectedMask[] = [
  { label: 'curtain', box: { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.8 }, png: 'data:image/png;base64,A', class: 'fixed' },
  { label: 'exercise bike', box: { x0: 0.5, y0: 0.5, x1: 0.9, y1: 0.9 }, png: 'data:image/png;base64,B', class: 'movable' },
];
const items = toWallItems(MASKS);
const guide = (o: Partial<Parameters<typeof wallMaskGuidance>[0]> = {}) =>
  wallMaskGuidance({ detecting: false, items: [], drawnCount: 0, ...o });

describe('with items found, tapping is the instruction', () => {
  const g = guide({ items });

  it('leads with the verb and the thing it acts on', () => {
    expect(g.stage).toBe('tap');
    expect(g.headline.toLowerCase().startsWith('tap anything on the photo')).toBe(true);
  });

  it('never offers the pencil when there is something to tap', () => {
    expect(g.offerDrawing).toBe(false);
  });

  it('says nothing about masking, drawing or tracing', () => {
    expect(g.headline.toLowerCase()).not.toMatch(/draw|trace|mask tool|pencil/);
  });

  it('counts what is kept and what is painted through', () => {
    expect(g.headline).toContain('Keeping 1');
    expect(g.headline).toContain('painting through 1');
  });

  it("follows the customer's tap, not the detector", () => {
    const flipped = toggleItem(items, items[1].id);
    expect(guide({ items: flipped }).headline).toContain('Keeping 2');
  });
});

describe('the pencil is offered only when there is nothing to tap', () => {
  it('offers it when detection came back empty', () => {
    const g = guide();
    expect(g.stage).toBe('empty');
    expect(g.offerDrawing).toBe(true);
    expect(g.headline).toMatch(/missed/i);
  });

  it('offers it when detection could not run at all', () => {
    const g = guide({ available: false });
    expect(g.stage).toBe('unavailable');
    expect(g.offerDrawing).toBe(true);
    expect(g.headline).toMatch(/could not check/i);
  });

  it('never offers it while detection is still running', () => {
    const g = guide({ detecting: true });
    expect(g.stage).toBe('detecting');
    expect(g.offerDrawing).toBe(false);
  });

  it('tells the customer what the wait is for', () => {
    expect(guide({ detecting: true }).headline).toMatch(/finding the things on your wall/i);
  });
});

describe("hand-drawn areas are acknowledged, never taken away", () => {
  it('counts them alongside the tapped items', () => {
    expect(guide({ items, drawnCount: 2 }).headline).toContain('2 areas you marked by hand');
  });

  it('counts one correctly', () => {
    expect(guide({ items, drawnCount: 1 }).headline).toContain('1 area you marked by hand is kept');
  });

  it('says nothing about them when there are none', () => {
    expect(guide({ items }).headline).not.toMatch(/by hand/);
  });
});

describe('every stage gives an instruction', () => {
  it('is never empty and never silent', () => {
    for (const o of [{}, { items }, { detecting: true }, { available: false }, { items, drawnCount: 3 }]) {
      const g = guide(o);
      expect(g.headline.length).toBeGreaterThan(20);
      expect(g.headline.trim()).toBe(g.headline);
    }
  });
});
