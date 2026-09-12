import { describe, expect, it } from 'vitest';
import { autoRepeatWidthIn, autoWallScale, patternSizeLabel, stepPatternSize } from '../wallpro-scale';

describe('Bigger / Smaller on a finished design', () => {
  it('steps the same master along the ladder, up to the whole wall and back, without leaving the wall', () => {
    const wall = 142;
    expect(stepPatternSize({ placement: 'repeat', repeatWidthIn: 36 }, wall, 'bigger')).toEqual({ placement: 'repeat', repeatWidthIn: 42 });
    expect(stepPatternSize({ placement: 'repeat', repeatWidthIn: 36 }, wall, 'smaller')).toEqual({ placement: 'repeat', repeatWidthIn: 30 });
    // 60 is the widest tile that still repeats twice on 142 (72 would not); one more step is the whole wall.
    expect(stepPatternSize({ placement: 'repeat', repeatWidthIn: 48 }, wall, 'bigger')).toEqual({ placement: 'repeat', repeatWidthIn: 60 });
    expect(stepPatternSize({ placement: 'repeat', repeatWidthIn: 60 }, wall, 'bigger')).toEqual({ placement: 'cover', repeatWidthIn: 60 });
    expect(stepPatternSize({ placement: 'cover', repeatWidthIn: 36 }, wall, 'smaller')).toEqual({ placement: 'repeat', repeatWidthIn: 60 });
    expect(stepPatternSize({ placement: 'cover', repeatWidthIn: 36 }, wall, 'bigger')).toBeNull();
    expect(stepPatternSize({ placement: 'repeat', repeatWidthIn: 12 }, wall, 'smaller')).toBeNull();
    // An off-ladder width (a hand value from before) snaps to the ladder on either step.
    expect(stepPatternSize({ placement: 'repeat', repeatWidthIn: 33 }, wall, 'bigger')).toEqual({ placement: 'repeat', repeatWidthIn: 36 });
    expect(stepPatternSize({ placement: 'repeat', repeatWidthIn: 33 }, wall, 'smaller')).toEqual({ placement: 'repeat', repeatWidthIn: 30 });
    expect(patternSizeLabel({ placement: 'repeat', repeatWidthIn: 36 }, wall)).toBe('36″ tile · 4 across');
    expect(patternSizeLabel({ placement: 'cover', repeatWidthIn: 36 }, wall)).toBe('Whole wall, one piece');
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
