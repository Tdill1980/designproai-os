import { describe, expect, it } from 'vitest';
import {
  toWallItems, addWallItem, applyItemClass, toggleItem, resetItems, hasOverride, splitItems, itemAt, itemSummary,
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

describe('one tap adds one item', () => {
  const mask = (x0: number, y0: number, x1: number, y1: number, label = 'thing', cls: 'fixed' | 'movable' = 'fixed') =>
    ({ label, box: { x0, y0, x1, y1 }, png: 'data:image/png;base64,AAA', class: cls });

  it('appends to the same list the bulk pass filled, with an id that cannot collide', () => {
    // The bulk pass rebuilds `item-<index>-<label>` from zero on every
    // re-detect, so a tap that reused that shape could be silently replaced.
    const bulk = toWallItems([mask(0, 0, 0.2, 0.2, 'window')]);
    const next = addWallItem(bulk, mask(0.6, 0.6, 0.9, 0.9, 'treadmill'));
    expect(next).toHaveLength(2);
    expect(next[1].label).toBe('treadmill');
    expect(next[1].id).toBe('tap-1');
    expect(next[1].id).not.toEqual(bulk[0].id);
    expect(addWallItem(next, mask(0.1, 0.7, 0.3, 0.9, 'lamp'))[2].id).toBe('tap-2');
  });

  it('replaces a near-duplicate rather than stacking one on top of it', () => {
    // Tapping the same sofa twice is what a person does when the first outline
    // looked wrong. Two overlapping sofas would put two chips on the photo and
    // make toggling one appear to do nothing, because the other still covers
    // those pixels.
    const once = addWallItem([], mask(0.3, 0.3, 0.7, 0.7, 'sofa'));
    const twice = addWallItem(once, mask(0.31, 0.32, 0.69, 0.68, 'sectional sofa'));
    expect(twice).toHaveLength(1);
    expect(twice[0].label).toBe('sectional sofa');
    expect(twice[0].id).toBe(once[0].id);
  });

  it('a re-tap keeps the class the customer chose, and never silently undoes it', () => {
    const kept = addWallItem([], mask(0.3, 0.3, 0.7, 0.7, 'bike'));
    const through = toggleItem(kept, kept[0].id);
    expect(through[0].applied).toBe('movable');
    const retapped = addWallItem(through, mask(0.31, 0.31, 0.69, 0.69, 'exercise bike'));
    expect(retapped[0].applied).toBe('movable');
    expect(retapped[0].label).toBe('exercise bike');
  });

  it('a different object nearby is its own item, not a replacement', () => {
    const a = addWallItem([], mask(0.1, 0.1, 0.3, 0.3, 'left frame'));
    const b = addWallItem(a, mask(0.5, 0.1, 0.7, 0.3, 'right frame'));
    expect(b).toHaveLength(2);
  });

  it('defaults anything that is not a clean "movable" to protected, like the rest of this module', () => {
    expect(addWallItem([], mask(0, 0, 1, 1, 'x', 'movable'))[0].applied).toBe('movable');
    expect(addWallItem([], { ...mask(0, 0, 1, 1), class: 'wobbly' as never })[0].applied).toBe('fixed');
  });
});

describe('tap to remove is the same gesture, other way up', () => {
  const mask = (x0: number, y0: number, x1: number, y1: number, label = 'thing') =>
    ({ label, box: { x0, y0, x1, y1 }, png: 'data:image/png;base64,AAA', class: 'fixed' as const });

  it('SETS the class rather than flipping it, and is idempotent', () => {
    // Owner, 2026-09-24: "could we tap to remove it". In a mode she has already
    // said which side she wants: a flip would remove the first thing she taps
    // and re-protect the second, and tapping something already removed would
    // silently undo her.
    const one = addWallItem([], mask(0.2, 0.2, 0.5, 0.5, 'bike'));
    const gone = applyItemClass(one, one[0].id, 'movable');
    expect(gone[0].applied).toBe('movable');
    expect(applyItemClass(gone, gone[0].id, 'movable')[0].applied).toBe('movable');
    expect(applyItemClass(gone, gone[0].id, 'fixed')[0].applied).toBe('fixed');
    // ...and it touches nothing else about the item, or its neighbours.
    expect(gone[0].label).toBe('bike');
    expect(gone[0].detected).toBe('fixed');
  });

  it('an explicit instruction overrides the kept class; a plain re-tap does not', () => {
    // The replace rule exists to protect a decision she MADE, never to
    // overrule one she is making right now.
    const kept = addWallItem([], mask(0.3, 0.3, 0.7, 0.7, 'sofa'));
    expect(addWallItem(kept, mask(0.31, 0.31, 0.69, 0.69, 'sofa'))[0].applied).toBe('fixed');
    expect(addWallItem(kept, mask(0.31, 0.31, 0.69, 0.69, 'sofa'), 'movable')[0].applied).toBe('movable');
    // A brand-new item takes the instruction too.
    expect(addWallItem(kept, mask(0.01, 0.01, 0.1, 0.1, 'vent'), 'movable')[1].applied).toBe('movable');
  });
});
