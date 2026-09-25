import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wallGenerationBlocker } from '../wallpro-geometry';

// ⚠️ RAW, DELIBERATELY. Stripping block comments from this file deletes working
// code -- it carries one comment opener inside a string literal, so the openers
// and closers do not balance and a non-greedy strip swallows whole spans. See
// wallpro-partial-save.test.ts, which measured it.
const page = readFileSync(fileURLToPath(new URL('../../pages/WallPro.tsx', import.meta.url)), 'utf8');

/**
 * THE MEASUREMENT IS THE REQUIREMENT; THE PHOTO NEVER WAS (owner, 2026-09-24:
 * "I need the enter wall size before upload ... Its not good ui upload first
 * because I keep forgetting to add the dimension").
 *
 * The generator has always agreed with her -- it reads width and height and
 * nothing else -- but step 1 asked for the optional input first and ticked
 * itself green on it, which is exactly what made the required one forgettable.
 */
describe('the wall is measured before it is photographed', () => {
  it('is what the generator actually requires', () => {
    expect(wallGenerationBlocker(false, [], 143, 96)).toBeNull();
    expect(wallGenerationBlocker(true, [], 0, 96)).toBeTruthy();
  });

  it('puts the dimensions above the upload on the page', () => {
    const dimensions = page.indexOf('Enter Dimensions (inches)');
    const upload = page.indexOf("uploadControl('photo', 'Upload Wall Photo'");
    expect(dimensions).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(-1);
    expect(dimensions, 'the measurement must be asked for first').toBeLessThan(upload);
  });

  // A step that ticks green on the optional input is the step lying about its
  // own outcome -- the same fault already corrected on step 4.
  it('ticks step 1 on the measurement, not on the photo', () => {
    expect(page).toContain("label: 'Measure your wall'");
    expect(page).toContain('done: dimensionsValid');
    expect(page).not.toContain("{ id: 'upload-wall', n: 1, label: 'Upload your wall', icon: Upload, done: !!photo");
  });

  it('says the photo is optional rather than leaving it implied', () => {
    expect(page).toMatch(/This is all a print file needs; the photo is optional\./);
  });
});

describe('a customer with no wall photo has a door', () => {
  it('offers the measurements-only path', () => {
    expect(page).toContain('No photo of the wall? Design from your measurements');
  });

  // It may not be a dead end that silently does nothing: without a measured
  // wall there is nothing to design against, so the control says which input
  // is missing instead of failing at the generate button.
  it('names the missing input instead of going nowhere', () => {
    expect(page).toContain('No photo of the wall? Enter the width and height above first.');
    expect(page).toContain('disabled={!!busy || !dimensionsValid}');
  });

  it('lands on the brief, which is the next thing it needs', () => {
    expect(page).toContain("onClick={() => jumpToStep('choose-design')}");
  });
});

describe('measuring your wallpaper never costs you the design', () => {
  // Owner, 2026-09-24, mid-demo: "Design no longer lands on my wall photo."
  // The repeat-width field shipped that afternoon ran `setArtwork(null)` on
  // EVERY keystroke, so typing one character threw the generated master away
  // and the design vanished off her room photo. It was never necessary: a
  // repeat width is a PLACEMENT parameter, and renderWallPreview and
  // planWallPrint both re-tile the same master from it, deterministically and
  // for free -- which is exactly what the pattern-size slider does.
  it('does not discard the artwork when the repeat width is typed', () => {
    expect(page).not.toContain('setMatchRepeat(e.target.value); setArtwork(null);');
  });

  it('re-tiles the master instead, live', () => {
    expect(page).toContain("if (stated) { setPlacement('repeat'); setRepeatWidth(stated); setPatternScale(100); }");
  });
});
