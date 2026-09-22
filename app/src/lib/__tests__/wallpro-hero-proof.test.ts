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

/**
 * THE THIRD STAGE: WHAT THE CUSTOMER HAS TO DO.
 *
 * Owner, 2026-09-22: "Add image before and after show one touch masking when
 * they click." Before and after answer "what do I get"; they say nothing about
 * the step a visitor actually stalls on, and that step — mark the wall, tap
 * what to keep — is the part of this product that sounds hardest and is
 * easiest. So the band gets a frame reached by a click.
 *
 * Three things are pinned, each for a defect it would otherwise re-introduce:
 * the control is a BUTTON (the box is already a drag surface, so a bare click
 * target over it fires on every attempt to drag the compare handle); the frame
 * carries its OWN caption (it makes a different claim from the photographs and
 * must say so itself); and the pair is OPTIONAL (every historical proof has
 * two stages and must keep working untouched).
 */
describe('the marking stage', () => {
  const band = source('../../components/wallpro/WallProHeroProof.tsx');
  const brand = source('../wallpro-brand.ts');

  it('is reached by a real button, never by a click on the drag surface', () => {
    expect(band).toContain('<button');
    expect(band).toContain('setMarking(v => !v)');
    expect(band).toContain('aria-pressed={marking}');
  });

  it('hides the compare handle and its range while the marking frame is up', () => {
    // Leaving the wipe control live over a third image lets the customer drag
    // a handle that reveals nothing, which reads as a broken slider.
    expect(band).toContain('{!marking && <div className="pointer-events-none absolute inset-y-0 w-0.5');
    expect(band).toContain('{!marking && <input');
  });

  it('labels the stage as itself, not as Before or After', () => {
    expect(band).toContain('Marking the wall');
    expect(band).toMatch(/marking\s*\n?\s*\?\s*<span[^>]*>Marking the wall/);
  });

  it('shows the marking frame\'s own caption, not the pair\'s', () => {
    expect(band).toContain('{mark && marking ? mark.caption : current.caption}');
  });

  it('stops the carousel and drops the frame when the example changes', () => {
    // A marking frame left up while the carousel advanced would show one
    // room's wall plan over another room's photograph.
    expect(band).toContain('useEffect(() => { setMarking(false); }, [index]);');
    expect(band).toContain('held || marking || reducedMotion');
  });

  it('is optional — a pair with no marking frame still renders two stages', () => {
    expect(brand).toContain('marking?: { src: string; alt: string; caption: string };');
    expect(band).toContain('const mark = current?.marking;');
    expect(band).toContain('{mark && marking && (');
  });

  it('prefetches the third frame, so the click does not appear to do nothing', () => {
    expect(band).toContain('p.marking?.src');
  });
});

/**
 * THE GYM PAIR IS BACK, WITHOUT THE MARK.
 *
 * It was withdrawn 2026-09-21 because the generated mural carried a real
 * company's wordmark, and WALL_PROOFS went empty (which then took the tool's
 * whole masthead down with it — a separate defect, fixed the same day). The
 * mark was measured at x 1207-1320, y 393-410 of the 1400x803 frame and
 * removed by blending between two clean anchor rows. The pair leads again.
 */
describe('the restored gym pair', () => {
  const brand = source('../wallpro-brand.ts');

  it('leads the band with a real file, not the retraction placeholder', () => {
    expect(brand).toContain("after: '/wallpro/proof-gym-after.jpg',");
    expect(brand).not.toMatch(/REPLACEMENT[_-]?REQUIRED/i);
  });

  it('records WHERE the mark was, so nobody has to find it twice', () => {
    // A comment that says "the trademark was removed" and not where is a
    // comment the next person cannot check.
    expect(brand).toMatch(/x 1207-1320, y 393-410/);
  });

  it('carries the marking frame that the third stage renders', () => {
    expect(brand).toContain("src: '/wallpro/proof-gym-mask.jpg',");
  });
});
