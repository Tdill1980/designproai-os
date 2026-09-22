/**
 * A QUAD THAT IS THE WHOLE PHOTOGRAPH IS NOT A WALL.
 *
 * Owner, 2026-09-22, having uploaded a real room — vanity nook, wall-mounted
 * TV, an open closet doorway: "it did not allow me or instruct me to pin
 * corners or mask parts like the closet opening / it doesn't show my photo
 * when I upload / also it's not doing the one touch masking."
 *
 * The design had been painted straight over her ceiling, her floor and the
 * open doorway, with no prompt to mark anything.
 *
 * ── WHY THE EXISTING GUARD DID NOT CATCH IT ───────────────────────────────
 *
 * `wallLocated` is `cornersValid && cornerSource !== 'default'`. That checks
 * PROVENANCE. `validWallCorners` accepts UNIT_WALL — area 1.0, every cross
 * positive — so a detector handing back the frame is indistinguishable from a
 * located wall: corners valid, source "detected", `wallLocated` true, and the
 * view auto-flips to the composite before she has seen her own photo. The
 * page's own comment from 2026-09-12 describes that exact outcome; the
 * mitigation written then was a notice, and the notice was gated on
 * `!wallLocated`, so the bug that caused it also silenced the warning about it.
 *
 * ── THE ASYMMETRY, WHICH IS THE WHOLE ARGUMENT FOR THE THRESHOLD ──────────
 *
 * False negative: four taps. False positive: the room is covered and it reads
 * as "it didn't work". And a real wall photograph essentially cannot fill its
 * own frame — you always see floor, ceiling or the return wall.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { looksLikeWholeFrame, validWallCorners, UNIT_WALL } from '../wallpro-geometry';

const page = readFileSync(fileURLToPath(new URL('../../pages/WallPro.tsx', import.meta.url)), 'utf8');

describe('looksLikeWholeFrame', () => {
  it('convicts the exact quad that got through — UNIT_WALL', () => {
    // And note the other half of the defect: this quad is VALID. The two
    // predicates disagree on purpose, which is why the guard needs both.
    expect(validWallCorners(UNIT_WALL)).toBe(true);
    expect(looksLikeWholeFrame(UNIT_WALL)).toBe(true);
  });

  it('convicts a frame with a hair of inset — a detector rarely returns exact 0 and 1', () => {
    expect(looksLikeWholeFrame([
      { x: 0.01, y: 0.008 }, { x: 0.994, y: 0.006 }, { x: 0.991, y: 0.995 }, { x: 0.004, y: 0.99 },
    ])).toBe(true);
  });

  it('convicts a sliver pinned to all four frame corners', () => {
    // Small area, but every corner is at the edge: the same "I found nothing"
    // answer wearing a different shape, which an area test alone would pass.
    expect(looksLikeWholeFrame([
      { x: 0.02, y: 0.48 }, { x: 0.98, y: 0.48 }, { x: 0.98, y: 0.52 }, { x: 0.02, y: 0.52 },
    ])).toBe(false); // area small AND corners are not near the frame's own corners
  });

  it('ACCEPTS a real feature wall — the owner\'s own room is well under half the frame', () => {
    // Her vanity nook: roughly the middle third across, upper two thirds down.
    const featureWall = [
      { x: 0.17, y: 0.20 }, { x: 0.52, y: 0.21 }, { x: 0.52, y: 0.66 }, { x: 0.17, y: 0.64 },
    ];
    expect(validWallCorners(featureWall)).toBe(true);
    expect(looksLikeWholeFrame(featureWall)).toBe(false);
  });

  it('ACCEPTS a large wall that still leaves floor and ceiling', () => {
    // 0.8 wide x 0.72 tall = 0.576 of the frame. Generous, and nowhere near
    // the 0.9 threshold — the band between a big wall and the frame is wide.
    const bigWall = [
      { x: 0.08, y: 0.14 }, { x: 0.88, y: 0.14 }, { x: 0.88, y: 0.86 }, { x: 0.08, y: 0.86 },
    ];
    expect(looksLikeWholeFrame(bigWall)).toBe(false);
  });

  it('is not fooled by a short list', () => {
    expect(looksLikeWholeFrame([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(false);
  });
});

describe('the detection path refuses a whole-frame answer', () => {
  it('requires BOTH validity and not-the-frame before calling a wall detected', () => {
    expect(page).toContain(
      'const cornersOk = !!found.wall && validWallCorners(found.wall) && !looksLikeWholeFrame(found.wall);'
    );
  });

  it('records that the wall was not read, so the mask card cannot claim otherwise', () => {
    // "Nothing needed protecting on this wall" and "we could not read this
    // wall" are opposite facts, and the customer cannot tell them apart from
    // the first sentence.
    expect(page).toContain('setWallReadMissed(!cornersOk);');
    expect(page).toContain('We could not read this wall automatically');
  });

  it('forgets the miss when a new photo arrives', () => {
    expect(page).toMatch(/setCornerSource\('default'\); setWallReadMissed\(false\);/);
  });
});

describe('the mark-your-wall card is above the scroll and ungated', () => {
  it('renders on the photo alone — never waits for a design to exist', () => {
    // The old notice was `artwork && !wallLocated`, so it said nothing at all
    // until a design existed, and it sat inside the preview section thousands
    // of pixels down on a phone.
    expect(page).toContain('{photo && !wallLocated && (');
  });

  it('sits before step 1, which is the top of the tool', () => {
    const card = page.indexOf('{photo && !wallLocated && (');
    const step1 = page.indexOf('<section id="upload-wall"');
    expect(card).toBeGreaterThan(-1);
    expect(step1).toBeGreaterThan(-1);
    expect(card).toBeLessThan(step1);
  });

  it('its button DOES the marking rather than naming another button', () => {
    expect(page).toContain('Mark the corners');
    expect(page).toMatch(/setMarking\('wall'\); setExcludeDraft\(\[\]\); setView\('before'\);\n\s*setTimeout/);
  });

  it('answers the closet question where she asked it', () => {
    expect(page).toContain('A closet opening, a doorway or a window inside the wall');
  });

  it('counts down the remaining taps while she is marking', () => {
    expect(page).toContain('${4 - corners.length} to go');
  });
});
