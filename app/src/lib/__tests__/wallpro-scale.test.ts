import { describe, expect, it } from 'vitest';
import { autoRepeatWidthIn, autoWallScale } from '../wallpro-scale';

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
