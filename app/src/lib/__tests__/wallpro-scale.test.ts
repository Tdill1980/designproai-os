import { describe, expect, it } from 'vitest';
import { autoRepeatWidthIn, autoWallScale, patternScaleLabel, patternSizeAtScale, stepPatternScale } from '../wallpro-scale';

describe('Pattern scale: the motifs, not the panel', () => {
  it('scales a generated tile so the motifs print at a percentage of their generated size', () => {
    const tile = { placement: 'repeat' as const, repeatWidthIn: 36 };
    expect(patternSizeAtScale(tile, 142, 100)).toEqual({ placement: 'repeat', repeatWidthIn: 36 });
    expect(patternSizeAtScale(tile, 142, 50)).toEqual({ placement: 'repeat', repeatWidthIn: 18 });
    expect(patternSizeAtScale(tile, 142, 200)).toEqual({ placement: 'repeat', repeatWidthIn: 72 });
    expect(patternSizeAtScale(tile, 142, 33)).toEqual({ placement: 'repeat', repeatWidthIn: 11.9 });
    expect(patternScaleLabel(tile, 142, 50)).toBe('50% · motifs 50% size · 18″ repeat, 8 across');
    expect(patternScaleLabel(tile, 142, 100)).toBe('100% · motifs as generated · 36″ repeat, 4 across');
  });
  it('a mural shrinks by repeating itself and cannot grow past the wall', () => {
    const mural = { placement: 'cover' as const, repeatWidthIn: 36 };
    expect(patternSizeAtScale(mural, 142, 100)).toEqual({ placement: 'cover', repeatWidthIn: 36 });
    expect(patternSizeAtScale(mural, 142, 150)).toEqual({ placement: 'cover', repeatWidthIn: 36 });
    expect(patternSizeAtScale(mural, 142, 50)).toEqual({ placement: 'repeat', repeatWidthIn: 71 });
    expect(patternScaleLabel(mural, 142, 100)).toBe('100% · motifs as generated · one piece across the wall');
    expect(patternScaleLabel(mural, 142, 50)).toBe('50% · motifs 50% size · 71″ repeat, 2 across');
  });
  it('steps through fixed percentages and stops at the ends', () => {
    expect(stepPatternScale(100, 'smaller')).toBe(80); expect(stepPatternScale(100, 'bigger')).toBe(125);
    expect(stepPatternScale(25, 'smaller')).toBeNull(); expect(stepPatternScale(200, 'bigger')).toBeNull();
    expect(stepPatternScale(90, 'bigger')).toBe(100); expect(stepPatternScale(90, 'smaller')).toBe(80);
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
    expect(autoWallScale({ intent: 'match', prompt: 'Make the wall wrap like this slatted wall', wallWidthIn: 142 })).toMatchObject({ placement: 'repeat', repeatWidthIn: 36 });
    expect(autoWallScale({ intent: 'match', prompt: 'keep this as one mural scene', wallWidthIn: 142 })).toMatchObject({ placement: 'cover' });
    expect(autoWallScale({ intent: 'wall', prompt: '', wallWidthIn: 120 })).toMatchObject({ placement: 'repeat', repeatWidthIn: 30 });
  });
  it('with no clue, a wall wider than 8 ft repeats and a smaller one is a mural; a choice always wins', () => {
    expect(autoWallScale({ intent: 'prompt', prompt: 'something calm', wallWidthIn: 142 })).toMatchObject({ placement: 'repeat' });
    expect(autoWallScale({ intent: 'prompt', prompt: 'something calm', wallWidthIn: 80 })).toMatchObject({ placement: 'cover' });
    expect(autoWallScale({ intent: 'prompt', prompt: 'Blush florals', wallWidthIn: 142, chosen: 'cover' })).toMatchObject({ placement: 'cover' });
    expect(autoWallScale({ intent: 'prompt', prompt: 'A mural', wallWidthIn: 80, chosen: 'repeat' })).toMatchObject({ placement: 'repeat', repeatWidthIn: 18 });
    expect(autoWallScale({ intent: 'prompt', prompt: 'Blush florals', wallWidthIn: 142 }).reason).toMatch(/real size/);
  });
});
