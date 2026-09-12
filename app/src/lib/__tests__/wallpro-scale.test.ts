import { describe, expect, it } from 'vitest';
import { autoMatchRepeatWidthIn, autoRepeatWidthIn, autoWallScale, clampPatternScale, maxPrintSafeScale, patternBaseWidthIn, patternDrawnWidthIn, patternPpi, patternScaleLabel, patternScaleWord, patternSizeAtScale, flatPaneView } from '../wallpro-scale';

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
  it('sizes a decorative repeat at the measured baseline and a fine material at its own', () => {
    // A decorative pattern repeats about twice across, the same measured
    // baseline a matched design gets (owner, 2026-09-12: "pattern way too
    // small" on a generated botanical at four across).
    expect(autoRepeatWidthIn(96)).toBe(48);
    expect(autoRepeatWidthIn(142)).toBe(72);
    expect(autoRepeatWidthIn(240)).toBe(96);
    expect(autoRepeatWidthIn(142, 'blush botanical florals')).toBe(72);
    // A slat, a plank, a tile or a weave really is a few inches wide.
    expect(autoRepeatWidthIn(142, 'white oak slat wall')).toBe(36);
    expect(autoRepeatWidthIn(142, 'natural grasscloth texture')).toBe(36);
    expect(autoRepeatWidthIn(96, 'herringbone')).toBe(24);
    expect(autoRepeatWidthIn(NaN)).toBe(72);
    expect(autoRepeatWidthIn(NaN, 'linen')).toBe(24);
  });
  it('reads the brief: patterns repeat, murals cover, and a matched design is a covering', () => {
    expect(autoWallScale({ intent: 'prompt', prompt: 'Blush florals with sage leaves', wallWidthIn: 142 })).toMatchObject({ placement: 'repeat', repeatWidthIn: 72 });
    expect(autoWallScale({ intent: 'prompt', prompt: 'A mountain landscape mural at sunset', wallWidthIn: 142 })).toMatchObject({ placement: 'cover' });
    expect(autoWallScale({ intent: 'prompt', prompt: 'Our logo and the words Welcome Home', wallWidthIn: 60 })).toMatchObject({ placement: 'cover' });
    expect(autoWallScale({ intent: 'wall', prompt: '', wallWidthIn: 120 })).toMatchObject({ placement: 'repeat', repeatWidthIn: 60 });
  });
  it('a matched design repeats about twice across the wall, the size it is actually hung at', () => {
    // Measured off the owner's installed wall, 2026-09-12: against a 74-inch
    // sofa the blooms print about 10 inches, putting that design's repeat at
    // 74-87 inches on her 142-inch wall. Four across (36") was half size; one
    // across (142") was double. Two across is 72.
    expect(autoMatchRepeatWidthIn(142)).toBe(72);
    expect(autoMatchRepeatWidthIn(96)).toBe(48);
    expect(autoMatchRepeatWidthIn(120)).toBe(60);
    expect(autoMatchRepeatWidthIn(240)).toBe(96);  // clamped: never over 8 ft
    expect(autoMatchRepeatWidthIn(60)).toBe(48);   // clamped: never under 4 ft
    expect(autoMatchRepeatWidthIn(NaN)).toBe(72);
    // The slider reaches the rest of the measured band from that baseline.
    expect(patternSizeAtScale({ placement: 'repeat', repeatWidthIn: 72 }, wall, 110)).toEqual({ placement: 'repeat', repeatWidthIn: 79.2 });

    const match = (prompt: string) => autoWallScale({ intent: 'match', prompt, wallWidthIn: 142 });
    expect(match('')).toMatchObject({ placement: 'repeat', repeatWidthIn: 72 });
    // Naming the material describes the reference; it never re-scales it.
    expect(match('Make the wall wrap like this slatted wall')).toMatchObject({ placement: 'repeat', repeatWidthIn: 72 });
    expect(match('tropical floral with monstera leaves')).toMatchObject({ placement: 'repeat', repeatWidthIn: 72 });
    expect(match('make it a seamless tile')).toMatchObject({ placement: 'repeat', repeatWidthIn: 72 });
    expect(match('stone feature wall').reason).toMatch(/sets the scale/);
    // A brief that asks for one scene is the one thing that makes it a mural.
    expect(match('keep this as one mural scene')).toMatchObject({ placement: 'cover' });
    // And an explicit choice still wins over everything.
    expect(autoWallScale({ intent: 'match', prompt: 'one mural scene', wallWidthIn: 142, chosen: 'repeat' })).toMatchObject({ placement: 'repeat', repeatWidthIn: 72 });
  });
  it('with no clue, a wall wider than 8 ft repeats and a smaller one is a mural; a choice always wins', () => {
    expect(autoWallScale({ intent: 'prompt', prompt: 'something calm', wallWidthIn: 142 })).toMatchObject({ placement: 'repeat' });
    expect(autoWallScale({ intent: 'prompt', prompt: 'something calm', wallWidthIn: 80 })).toMatchObject({ placement: 'cover' });
    expect(autoWallScale({ intent: 'prompt', prompt: 'Blush florals', wallWidthIn: 142, chosen: 'cover' })).toMatchObject({ placement: 'cover' });
    expect(autoWallScale({ intent: 'prompt', prompt: 'A mural', wallWidthIn: 80, chosen: 'repeat' })).toMatchObject({ placement: 'repeat', repeatWidthIn: 48 });
    expect(autoWallScale({ intent: 'prompt', prompt: 'Blush florals', wallWidthIn: 142 }).reason).toMatch(/real size/);
  });
});

describe('the flat pane never shows a bare tile as the design', () => {
  // THE REGRESSION. Owner, 2026-09-12, on a matched design: "why does it keep
  // generating the pattern I uploaded to match with much smaller pattern".
  // Nothing generated small -- the pane was showing ONE 60" tile, half of her
  // 120" wall, beside a reference photo of a whole wall. This is the first
  // paint after a generation: no exact canvas yet, slider untouched.
  it('draws at wall scale on the first paint, before the exact canvas exists', () => {
    expect(flatPaneView({ maskActive: false, settling: false, hasCanvas: false, hasCssTile: true })).toBe('css');
  });

  it('uses the exact canvas once it is ready', () => {
    expect(flatPaneView({ maskActive: false, settling: false, hasCanvas: true, hasCssTile: true })).toBe('canvas');
  });

  // Every slider move re-rendered the canvas, and each move dropped back to
  // the bare tile -- which is what made "too small" look confirmed each time.
  it('stays at wall scale while the slider is moving', () => {
    expect(flatPaneView({ maskActive: false, settling: true, hasCanvas: true, hasCssTile: true })).toBe('css');
  });

  // The one legitimate use of the bare tile: mask coordinates belong to it.
  it('shows the bare tile while a refinement mask is open, whatever else is true', () => {
    expect(flatPaneView({ maskActive: true, settling: false, hasCanvas: true, hasCssTile: true })).toBe('tile');
    expect(flatPaneView({ maskActive: true, settling: true, hasCanvas: false, hasCssTile: false })).toBe('tile');
  });

  it('falls back to the tile only when the wall geometry is unknown', () => {
    expect(flatPaneView({ maskActive: false, settling: false, hasCanvas: false, hasCssTile: false })).toBe('tile');
  });
});
