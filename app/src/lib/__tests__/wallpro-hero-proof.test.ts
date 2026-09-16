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

  it('gives its root a definite width, so auto margins cannot collapse it in a grid', () => {
    const root = band.match(/className="mx-auto mt-4[^"]*"/);
    expect(root, 'the band root class list moved; re-point this lock').not.toBeNull();
    expect(root![0]).toContain('w-full');
  });

  it('is still capped and centred when it stands alone', () => {
    const root = band.match(/className="mx-auto mt-4[^"]*"/)![0];
    expect(root).toContain('mx-auto');
    expect(root).toContain('max-w-6xl');
  });

  it('is placed in the hero grid, which is why the width matters', () => {
    const page = source('../../pages/WallPro.tsx');
    // The band sits in the same grid as the headline copy. If this ever stops
    // being true the lock above is merely harmless rather than load-bearing.
    expect(page).toMatch(/grid[^\n]*lg:grid-cols-\[minmax\(0,26rem\)_minmax\(0,1fr\)\]/);
    expect(page).toContain('<WallProHeroProof proofs={bandProofs} />');
  });
});
