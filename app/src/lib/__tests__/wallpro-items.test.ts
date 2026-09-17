import { describe, expect, it } from 'vitest';
import {
  toWallItems, toggleItem, resetItems, hasOverride, splitItems, itemAt, itemSummary,
} from '../wallpro-items';
import type { DetectedMask } from '../wallpro-masks';

const mask = (
  label: string,
  klass?: 'fixed' | 'movable',
  box = { x0: 0, y0: 0, x1: 1, y1: 1 },
): DetectedMask => ({ label, box, png: 'data:image/png;base64,AA', ...(klass ? { class: klass } : {}) });

describe('the detected objects stay objects', () => {
  it('carries the detector’s answer as both detected and applied', () => {
    const [window, bike] = toWallItems([mask('window', 'fixed'), mask('exercise bike', 'movable')]);
    expect(window.detected).toBe('fixed');
    expect(window.applied).toBe('fixed');
    expect(bike.detected).toBe('movable');
    expect(bike.applied).toBe('movable');
  });

  it('defaults anything that is not cleanly movable to protected', () => {
    // Protecting something that should have been removed is a cosmetic miss;
    // painting over something the customer wanted kept is their sofa erased.
    const [unlabelled] = toWallItems([mask('mystery object')]);
    expect(unlabelled.detected).toBe('fixed');
  });

  it('gives every item a distinct id, including same-labelled ones', () => {
    const items = toWallItems([mask('drape'), mask('drape'), mask('drape')]);
    expect(new Set(items.map(i => i.id)).size).toBe(3);
  });
});

describe('one click flips one item', () => {
  it('turns a painted-through item into a kept one and back', () => {
    const items = toWallItems([mask('sofa', 'movable')]);
    const kept = toggleItem(items, items[0].id);
    expect(kept[0].applied).toBe('fixed');
    // and the detector's own answer is untouched, so it stays reversible
    expect(kept[0].detected).toBe('movable');
    expect(toggleItem(kept, items[0].id)[0].applied).toBe('movable');
  });

  it('touches no other item', () => {
    const items = toWallItems([mask('sofa', 'movable'), mask('window', 'fixed'), mask('lamp', 'movable')]);
    const next = toggleItem(items, items[0].id);
    expect(next[1].applied).toBe('fixed');
    expect(next[2].applied).toBe('movable');
  });

  it('is a no-op for an id that is not in the list', () => {
    const items = toWallItems([mask('sofa', 'movable')]);
    expect(toggleItem(items, 'nope')).toEqual(items);
  });
});

describe('the composites follow the customer, not the detector', () => {
  it('splits on APPLIED so a click actually moves the item between piles', () => {
    // This is the whole defect: splitDetectedMasks reads `class`, which is the
    // detector's answer, so it would ignore every click.
    const items = toWallItems([mask('sofa', 'movable'), mask('window', 'fixed')]);
    const clicked = toggleItem(items, items[0].id);
    const { fixed, movable } = splitItems(clicked);
    expect(fixed.map(i => i.label).sort()).toEqual(['sofa', 'window']);
    expect(movable).toEqual([]);
  });

  it('counts what the customer will read above the photo', () => {
    const items = toWallItems([mask('window', 'fixed'), mask('bike', 'movable'), mask('sofa', 'movable')]);
    expect(itemSummary(items)).toEqual({ kept: 1, through: 2 });
    expect(itemSummary(toggleItem(items, items[1].id))).toEqual({ kept: 2, through: 1 });
  });
});

describe('an override is visible and reversible', () => {
  it('reports no override until something is clicked', () => {
    const items = toWallItems([mask('sofa', 'movable'), mask('window', 'fixed')]);
    expect(hasOverride(items)).toBe(false);
    expect(hasOverride(toggleItem(items, items[0].id))).toBe(true);
  });

  it('resets every item to what was detected', () => {
    const items = toWallItems([mask('sofa', 'movable'), mask('window', 'fixed')]);
    const messed = toggleItem(toggleItem(items, items[0].id), items[1].id);
    expect(hasOverride(messed)).toBe(true);
    const back = resetItems(messed);
    expect(hasOverride(back)).toBe(false);
    expect(back.map(i => i.applied)).toEqual(['movable', 'fixed']);
  });
});

describe('a tap resolves to the item the customer meant', () => {
  const sofa = mask('sofa', 'movable', { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 });
  const cushion = mask('cushion', 'fixed', { x0: 0.4, y0: 0.4, x1: 0.5, y1: 0.5 });

  it('picks the SMALLEST box containing the point, not the first', () => {
    // Items overlap constantly in a real room. Taking the first match would let
    // a sofa swallow every cushion drawn on top of it.
    const items = toWallItems([sofa, cushion]);
    expect(itemAt(items, 0.45, 0.45)?.label).toBe('cushion');
    // and the big item is still reachable everywhere the small one is not
    expect(itemAt(items, 0.15, 0.15)?.label).toBe('sofa');
  });

  it('returns null outside every box', () => {
    expect(itemAt(toWallItems([sofa]), 0.01, 0.01)).toBeNull();
    expect(itemAt([], 0.5, 0.5)).toBeNull();
  });

  it('handles a box given with its corners in either order', () => {
    const flipped = mask('drape', 'fixed', { x0: 0.8, y0: 0.8, x1: 0.2, y1: 0.2 });
    expect(itemAt(toWallItems([flipped]), 0.5, 0.5)?.label).toBe('drape');
  });
});
