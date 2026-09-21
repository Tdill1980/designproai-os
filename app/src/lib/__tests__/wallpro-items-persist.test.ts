/**
 * One-touch masking must survive reopening the project.
 *
 * Measured 2026-09-21: `setItems` was reachable only from a detection result or
 * from a tap on items that already existed, `detectInBackground` runs only on a
 * fresh photo upload or a new accent zone, and the project config had no items
 * key. So a reopened project restored the flattened masks and nothing on the
 * photo was tappable — the feature worked exactly once per photograph.
 */
import { describe, it, expect } from 'vitest';
import { toWallItems, toggleItem, serializeWallItems, parseWallItems, WALL_ITEMS_CONTRACT } from '../wallpro-items';
import type { DetectedMask } from '../wallpro-masks';

const MASKS: DetectedMask[] = [
  { label: 'sofa', box: { x0: 0.1, y0: 0.6, x1: 0.5, y1: 0.9 }, png: 'data:image/png;base64,AAA', class: 'movable' },
  { label: 'window', box: { x0: 0.6, y0: 0.2, x1: 0.9, y1: 0.7 }, png: 'data:image/png;base64,BBB', class: 'fixed' },
];
const round = (items = toWallItems(MASKS)) => parseWallItems(JSON.parse(serializeWallItems(items)));

describe('wall item round trip', () => {
  it('brings every item back intact', () => {
    expect(round()).toEqual(toWallItems(MASKS));
  });

  it("keeps the customer's tap, not the detector's answer", () => {
    // This is the defect in one assertion: without persistence a reopen hands
    // back `detected`, silently undoing the correction.
    const tapped = toggleItem(toWallItems(MASKS), toWallItems(MASKS)[0].id);
    const back = round(tapped);
    expect(back[0].applied).toBe('fixed');
    expect(back[0].detected).toBe('movable');
    expect(back[0].applied).not.toBe(back[0].detected);
  });

  it('keeps the mask pixels a tap re-rasterises from', () => {
    expect(round()[0].png).toBe('data:image/png;base64,AAA');
  });
});

describe('parseWallItems is defensive', () => {
  it('degrades to nothing tappable rather than throwing', () => {
    for (const bad of [null, undefined, 0, 'x', [], {}, { items: [] }, { contract: 'other', items: [1] }]) {
      expect(parseWallItems(bad)).toEqual([]);
    }
  });

  it('refuses a payload without the contract', () => {
    expect(parseWallItems({ items: toWallItems(MASKS) })).toEqual([]);
  });

  it('drops an item with no mask pixels — it could be shown but never re-applied', () => {
    const items = toWallItems(MASKS).map((i, n) => (n === 0 ? { ...i, png: '' } : i));
    const back = parseWallItems({ contract: WALL_ITEMS_CONTRACT, items });
    expect(back).toHaveLength(1);
    expect(back[0].label).toBe('window');
  });

  it('drops malformed rows without losing the good ones', () => {
    const items = [...toWallItems(MASKS), null, 'nope', { id: 'x' }, { ...toWallItems(MASKS)[0], box: { x0: 'a' } }];
    expect(parseWallItems({ contract: WALL_ITEMS_CONTRACT, items })).toHaveLength(2);
  });

  it('refuses a duplicate id — two rows for one mark is one paste too many', () => {
    const one = toWallItems(MASKS)[0];
    expect(parseWallItems({ contract: WALL_ITEMS_CONTRACT, items: [one, one] })).toHaveLength(1);
  });

  it('refuses an unknown class rather than guessing', () => {
    const bad = { ...toWallItems(MASKS)[0], applied: 'maybe' };
    expect(parseWallItems({ contract: WALL_ITEMS_CONTRACT, items: [bad] })).toEqual([]);
  });
});
