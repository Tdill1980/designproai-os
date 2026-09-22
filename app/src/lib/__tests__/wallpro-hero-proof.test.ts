import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * THE BAND MUST FILL ITS TRACK.
 *
 * Owner, 2026-09-16, looking at the live DesignProAI page: "This is missing
 * images." Nothing was missing. Every photograph loaded (measured in a real
 * browser: naturalWidth 1400, rendered 206px tall) and the band was 34 PIXELS
 * WIDE on a 430px phone -- a sliver that reads as a thin vertical line.
 *
 * The cause is a CSS rule with no runtime error to report it. The band's root
 * carries `mx-auto`, which sets both inline margins to auto. On an ordinary
 * block that centres a capped box. As a GRID ITEM -- which it became when the
 * hero put the copy and the band in one grid -- auto inline margins suppress
 * the stretch that would otherwise size it to its track, and the box falls
 * back to shrink-to-fit. Its photographs are absolutely positioned, so there
 * is no intrinsic width to shrink to, and it collapses to its own padding.
 *
 * `w-full` is the fix: a definite width leaves the auto margins no free space
 * to absorb. This test reads the source because the defect is pure layout --
 * jsdom performs no grid sizing, so a render test would pass on the broken
 * markup, and only a real browser or this assertion can convict it.
 */
const source = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the hero proof band', () => {
  const band = source('../../components/wallpro/WallProHeroProof.tsx');

  /**
   * The root is now a ternary: the band keeps its centred, capped, definite
   * width, and the landing hero mounts the SAME slider as an absolute fill
   * (owner, 2026-09-17: the before/after "both need to be in hero"). The lock
   * follows the BAND branch — what it guards is unchanged and still the thing
   * that broke live, so it is re-pointed rather than relaxed.
   */
  const bandRoot = () => band.match(/'mx-auto mt-4[^']*'/);

  it('gives its root a definite width, so auto margins cannot collapse it in a grid', () => {
    const root = bandRoot();
    expect(root, 'the band root class list moved; re-point this lock').not.toBeNull();
    expect(root![0]).toContain('w-full');
  });

  it('is still capped and centred when it stands alone', () => {
    const root = bandRoot()![0];
    expect(root).toContain('mx-auto');
    expect(root).toContain('max-w-6xl');
  });

  it('the fill variant drops the cap and the centring, which are band-only', () => {
    // A hero panel owns its own shape. Leaving `max-w-6xl` or `mx-auto` on the
    // fill branch would letterbox the slider inside a box that is already the
    // right shape — the same class of defect, pointed the other way.
    const fillRoot = band.match(/fill \? '([^']*)' : 'mx-auto mt-4/);
    expect(fillRoot, 'the fill branch moved; re-point this lock').not.toBeNull();
    expect(fillRoot![1]).toContain('absolute');
    expect(fillRoot![1]).not.toContain('max-w-6xl');
    expect(fillRoot![1]).not.toContain('mx-auto');
  });

  it('is placed in the hero grid, which is why the width matters', () => {
    const page = source('../../pages/WallPro.tsx');
    // The band sits in the same grid as the headline copy. If this ever stops
    // being true the lock above is merely harmless rather than load-bearing.
    //
    // The COPY TRACK'S WIDTH IS NOT THE CONTRACT. It was pinned at a literal
    // 26rem and widened to 30rem on 2026-09-22 when the masthead became a full
    // hero with a three-line headline -- a legitimate layout change that failed
    // a test about something else entirely. What matters here is the SHAPE: a
    // capped copy column beside a 1fr track the band has to stretch into.
    expect(page).toMatch(/grid[^\n]*lg:grid-cols-\[minmax\(0,\d+rem\)_minmax\(0,1fr\)\]/);
    expect(page).toContain('<WallProHeroProof proofs={bandProofs} />');
  });
});
