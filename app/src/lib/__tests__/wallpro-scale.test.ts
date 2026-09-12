import { describe, expect, it } from 'vitest';
import { autoRepeatWidthIn, autoWallScale, clampPatternScale, maxPrintSafeScale, patternBaseWidthIn, patternDrawnWidthIn, patternPpi, patternScaleLabel, patternScaleWord, patternSizeAtScale } from '../wallpro-scale';

// A 142 x 96 wall and a square master.
const wall = { width: 142, height: 96, aspect: 1 };

describe('Pattern size: PatternPro\'s slider, the design not the panel', () => {
  it('a generated tile draws at a percentage of its generated width', () => {
    const tile = { placement: 'repeat' as const, repeatWidthIn: 36 };
    expect(patternSizeAtScale(tile, wall, 100)).toEqual({ placement: 'repeat', repeatWidthIn: 36 });
    expect(patternSizeAtScale(tile, wall, 50)).toEqual({ placement: 'repeat', repeatWidthIn: 18 });
    expect(patternSizeAtScale(tile, wall, 200)).toEqual({ placement: 'repeat', repeatWidthIn: 72 });
    expect(patternSizeAtScale(tile, wall, 300)).toEqual({ placement: 'repeat', repeatWidthIn: 108 });
    expect(patternSizeAtScale(tile, wall, 30)).toEqual({ placement: 'repeat', repeatWidthIn: 10.8 });
    expect(patternScaleLabel(tile, wall, 50)).toBe('50% · Micro · the design repeats every 18″');
    expect(patternScaleLabel(tile, wall, 100)).toBe('100% · Standard · as generated');
    expect(patternScaleLabel(tile, wall, 150)).toBe('150% · Large · the design repeats every 54″');
  });
  it('a mural is one swatch the size of the wall: smaller repeats it, bigger crops it', () => {
    const mural = { placement: 'cover' as const, repeatWidthIn: 36 };
    expect(patternBaseWidthIn(mural, wall)).toBe(142);
    expect(patternBaseWidthIn(mural, { width: 60, height: 96, aspect: 1 })).toBe(96); // covering a tall wall needs a wider swatch
    expect(patternSizeAtScale(mural, wall, 100)).toEqual({ placement: 'cover', repeatWidthIn: 36 });
    expect(patternSizeAtScale(mural, wall, 50)).toEqual({ placement: 'repeat', repeatWidthIn: 71 });
    expect(patternSizeAtScale(mural, wall, 200)).toEqual({ placement: 'repeat', repeatWidthIn: 284 });
    expect(patternScaleLabel(mural, wall, 100)).toBe('100% · Standard · as generated');
    expect(patternScaleLabel(mural, wall, 50)).toBe('50% · Micro · the design repeats every 71″');
    expect(patternScaleLabel(mural, wall, 200)).toBe('200% · Bold · one piece, 284″ wide, cropped to the wall');
  });
  it('reports the real resolution, which falls as the design grows and never touches print size', () => {
    const tile = { placement: 'repeat' as const, repeatWidthIn: 36 };
    const master = { width: 4096, height: 4096 };
    expect(patternDrawnWidthIn(tile, wall, 100)).toBe(36);
    expect(patternDrawnWidthIn(tile, wall, 200)).toBe(72);
    expect(Math.round(patternPpi(master, tile, wall, 100))).toBe(114);
    expect(Math.round(patternPpi(master, tile, wall, 50))).toBe(228);
    expect(Math.round(patternPpi(master, tile, wall, 200))).toBe(57);
    // A mural is drawn across the whole wall, so it is far coarser to start with.
    expect(Math.round(patternPpi(master, { placement: 'cover', repeatWidthIn: 36 }, wall, 100))).toBe(29);
    expect(patternPpi({ width: 0, height: 0 }, tile, wall, 100)).toBe(0);
  });
  it('names the largest size that still meets the print minimum, or none', () => {
    const tile = { placement: 'repeat' as const, repeatWidthIn: 36 };
    // 4096 px over 36 inches is 113.8 PPI at 100%: 150 PPI needs 70%.
    expect(maxPrintSafeScale({ width: 4096, height: 4096 }, tile, wall, 150)).toBe(70);
    expect(maxPrintSafeScale({ width: 4096, height: 4096 }, tile, wall, 72)).toBe(150);
    // A mural on this wall cannot reach 150 PPI at any size on the slider.
    expect(maxPrintSafeScale({ width: 4096, height: 4096 }, { placement: 'cover', repeatWidthIn: 36 }, wall, 150)).toBeNull();
  });
  it('the slider runs 30 to 300 on 10-percent steps and uses PatternPro\'s words', () => {
    expect(clampPatternScale(0)).toBe(30); expect(clampPatternScale(1000)).toBe(300); expect(clampPatternScale(87)).toBe(90); expect(clampPatternScale(NaN)).toBe(100);
    expect(['Micro', 'Small', 'Standard', 'Large', 'Bold', 'Extreme']).toEqual([50, 70, 100, 150, 220, 300].map(patternScaleWord));
  });
});

describe('WallPro scale brain', () => {
  it('sizes the repeat from the wall: about four across, on 6-inch steps, 18 to 48', () => {
    expect(autoRepeatWidthIn(96)).toBe(24);
    expect(autoRepeatWidthIn(142)).toBe(36);
    expect(autoRepeatWidthIn(240)).toBe(48);
    expect(autoRepeatWidthIn(400)).toBe(48);
    expect(autoRepeatWidthIn(40)).toBe(18);
    expect(autoRepeatWidthIn(NaN)).toBe(24);
  });
  it('reads the brief: patterns repeat, murals cover, and a matched design is a covering', () => {
    expect(autoWallScale({ intent: 'prompt', prompt: 'Blush florals with sage leaves', wallWidthIn: 142 })).toMatchObject({ placement: 'repeat', repeatWidthIn: 36 });
    expect(autoWallScale({ intent: 'prompt', prompt: 'A mountain landscape mural at sunset', wallWidthIn: 142 })).toMatchObject({ placement: 'cover' });
    expect(autoWallScale({ intent: 'prompt', prompt: 'Our logo and the words Welcome Home', wallWidthIn: 60 })).toMatchObject({ placement: 'cover' });
    expect(autoWallScale({ intent: 'match', prompt: 'keep this as one mural scene', wallWidthIn: 142 })).toMatchObject({ placement: 'cover' });
    expect(autoWallScale({ intent: 'wall', prompt: '', wallWidthIn: 120 })).toMatchObject({ placement: 'repeat', repeatWidthIn: 30 });
  });
  it('on a match the uploaded reference is the scale baseline, and naming the material does not shrink it', () => {
    // The defect this encodes: a matched tropical mural came back at a quarter
    // size because "floral" forced a 36-inch tile (owner, 2026-09-12).
    const match = (prompt: string) => autoWallScale({ intent: 'match', prompt, wallWidthIn: 142 });
    expect(match('')).toMatchObject({ placement: 'cover' });
    expect(match('Make the wall wrap like this slatted wall')).toMatchObject({ placement: 'cover' });
    expect(match('tropical floral with monstera leaves')).toMatchObject({ placement: 'cover' });
    expect(match('stone feature wall').reason).toMatch(/sets the scale/);
    // Only an explicit ask for a repeat overrides it.
    expect(match('turn it into a repeating pattern')).toMatchObject({ placement: 'repeat', repeatWidthIn: 36 });
    expect(match('make it a seamless tile')).toMatchObject({ placement: 'repeat' });
    // And an explicit choice still wins over everything.
    expect(autoWallScale({ intent: 'match', prompt: '', wallWidthIn: 142, chosen: 'repeat' })).toMatchObject({ placement: 'repeat' });
  });
  it('with no clue, a wall wider than 8 ft repeats and a smaller one is a mural; a choice always wins', () => {
    expect(autoWallScale({ intent: 'prompt', prompt: 'something calm', wallWidthIn: 142 })).toMatchObject({ placement: 'repeat' });
    expect(autoWallScale({ intent: 'prompt', prompt: 'something calm', wallWidthIn: 80 })).toMatchObject({ placement: 'cover' });
    expect(autoWallScale({ intent: 'prompt', prompt: 'Blush florals', wallWidthIn: 142, chosen: 'cover' })).toMatchObject({ placement: 'cover' });
    expect(autoWallScale({ intent: 'prompt', prompt: 'A mural', wallWidthIn: 80, chosen: 'repeat' })).toMatchObject({ placement: 'repeat', repeatWidthIn: 18 });
    expect(autoWallScale({ intent: 'prompt', prompt: 'Blush florals', wallWidthIn: 142 }).reason).toMatch(/real size/);
  });
});
