import { describe, expect, it } from 'vitest';
import { designProofBrand, patternProofViews } from '../patternpro-proof';
import { wallDetailCrop } from '../wallpro-proof';
import { UNIT_WALL, insidePolygon } from '../wallpro-geometry';

describe('one proof system, explicit application and tenant', () => {
  it.each(['patternpro', 'wallpro'] as const)('brands %s independently of the OS', tool => {
    const name = tool === 'wallpro' ? 'WallPro' : 'PatternPro';
    expect(designProofBrand('weprintwraps', tool)).toEqual({ title: `WPW × ${name}`, footer: '® DesignProAI Software for WePrintWraps' });
    expect(designProofBrand('designpro', tool)).toEqual({ title: name, footer: '® DesignProAI Software' });
  });
  it('keeps real canonical angles and never re-labels a hero or hood as roof or close-up', () => {
    expect(patternProofViews('driver.jpg', { hood_detail: 'hood.jpg', roof: 'roof.jpg', 'close-up': 'detail.jpg' }))
      .toEqual([{ type: 'side', label: 'Driver Side', url: 'driver.jpg' }, { type: 'hood_detail', label: 'Hood', url: 'hood.jpg' },
        { type: 'close-up', label: 'Close-Up', url: 'detail.jpg' }, { type: 'roof', label: 'Roof', url: 'roof.jpg' }]);
    expect(patternProofViews('driver.jpg', null)).toHaveLength(1);
  });
  it('accepts the historic closeup key without duplicating the hood', () => {
    expect(patternProofViews(null, { closeup: 'legacy-detail.jpg', hood_detail: 'hood.jpg' }).find(v => v.type === 'close-up')?.url).toBe('legacy-detail.jpg');
  });
});

describe('WallPro close-up from existing geometry', () => {
  it('crops the left detail in native photo pixels without upscaling', () => {
    expect(wallDetailCrop(UNIT_WALL, 1000, 1000)).toEqual({ x: 80, y: 180, width: 450, height: 640 });
  });
  it('follows a marked perspective wall rather than the photo frame', () => {
    const corners = [{ x: .4, y: .3 }, { x: .9, y: .1 }, { x: .8, y: .9 }, { x: .4, y: .8 }];
    const crop = wallDetailCrop(corners, 1600, 900);
    expect(crop.x).toBeGreaterThanOrEqual(640);
    expect(crop.x + crop.width).toBeLessThan(1440);
    expect(crop.y).toBeGreaterThan(90);
    expect(crop.y + crop.height).toBeLessThan(810);
    expect(insidePolygon({ x: (crop.x + crop.width / 2) / 1600, y: (crop.y + crop.height / 2) / 900 }, corners)).toBe(true);
  });
  it('requires usable corners and a completed image', () => {
    expect(() => wallDetailCrop([], 1000, 1000)).toThrow();
    expect(() => wallDetailCrop(UNIT_WALL, 0, 1000)).toThrow();
    expect(() => wallDetailCrop([...UNIT_WALL].reverse(), 1000, 1000)).toThrow();
  });
});
