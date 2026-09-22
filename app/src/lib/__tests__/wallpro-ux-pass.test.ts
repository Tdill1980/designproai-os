/**
 * THE THREE THINGS THAT MADE THE TOOL CONFUSING, MEASURED THEN FIXED.
 *
 * Owner, 2026-09-22: "It's currently confusing and has bad ux." That is not a
 * bug report, so it was answered with measurements rather than opinions:
 *
 *  A. NO PROGRESS INDICATION ON HER BRAND, AT HER WIDTH. The step rail was
 *     mounted as `{theme.showPrintOffer && <WallProSidebar/>}` -- true only for
 *     WePrintWraps -- and its root is `hidden ... lg:block`. So DesignProAI had
 *     none at any width, and a phone had none on either brand, on a page this
 *     repo's own comments describe as four thousand pixels long.
 *
 *  B. TWO NUMBERING SYSTEMS ON ONE SCREEN. Steps run 1-4; the preview panes
 *     ALSO read "1 ·" and "2 ·" -- and those two live inside step 4. Her
 *     screenshot shows "2 · IMPOSED ON YOUR WALL", which reads as step 2, and
 *     step 2 is "Choose your design".
 *
 *  C. THE PHOTO'S CONTROLS IN THREE PLACES. Corners and masking were split
 *     across a card above step 1, a "Change what we keep" text link buried in
 *     a paragraph, and the buttons that link revealed -- so "how do I mask
 *     closet?" had no visible answer anywhere on the page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const page = source('../../pages/WallPro.tsx');
const rail = source('../../components/wallpro/WallProSidebar.tsx');

describe('A — the page always says where you are', () => {
  it('mounts the vertical rail on the CHROME, not the brand', () => {
    // `theme.showPrintOffer &&` was the old gate and it is the wrong question.
    // The real constraint is that on DesignProAI this page sits inside the OS
    // AppShell, which already owns a rail; a second one is the double-sidebar
    // defect fixed on ShopFlow the same day.
    expect(page).toContain('{!insideOsShell && <WallProSidebar');
    expect(page).not.toContain('{theme.showPrintOffer && <WallProSidebar');
  });

  it('shows the strip at every width inside the shell, and below lg outside it', () => {
    expect(page).toContain("className={insideOsShell ? '' : 'lg:hidden'}");
    expect(page).toContain('<WallProStepStrip steps={wallSteps}');
  });

  it('feeds the rail and the strip from ONE steps array', () => {
    // Two lists of the page's own progress drift the first time a step moves.
    const uses = page.match(/steps=\{wallSteps\}/g) ?? [];
    expect(uses.length).toBe(2);
  });

  it('stacks the strip BELOW the header rather than under it', () => {
    // Two sticky elements at the same offset overlap; they do not stack. The
    // header's height is measured, because it is one row on a phone and two
    // with a tagline on desktop.
    expect(page).toContain("useElementHeight('wallpro-header')");
    expect(page).toContain('top={stickyTop + headerHeight}');
  });

  it('scrolls the chips instead of wrapping them to three lines on a phone', () => {
    expect(rail).toContain('export function WallProStepStrip');
    expect(rail).toContain('overflow-x-auto');
  });
});

describe('B — one numbering system', () => {
  it('the preview panes carry no number', () => {
    expect(page).not.toMatch(/wall-muted">1 · \{/);
    expect(page).not.toMatch(/wall-muted">2 · \{/);
  });

  it('the STEPS still do, because they are a sequence', () => {
    for (const n of [1, 2, 3, 4]) expect(page).toContain(`<StepHeading n={${n}}`);
  });
});

describe('C — one home for the photo\'s own work', () => {
  it('gives the block a title, so it is findable', () => {
    expect(page).toContain('Your wall photo');
    expect(page).toContain('Wall area:');
    expect(page).toContain('What we keep:');
  });

  it('puts the closet question\'s answer in the open, not behind a link', () => {
    // This is the control the owner could not find. It must not be inside the
    // `showMaskTools` panel.
    expect(page).toContain('Mask a closet, door or window');
    const button = page.indexOf('Mask a closet, door or window');
    const moreOptions = page.indexOf('{showMaskTools && <>');
    expect(button).toBeGreaterThan(-1);
    expect(moreOptions).toBeGreaterThan(-1);
    expect(button).toBeLessThan(moreOptions);
  });

  it('states the wall-area state in words rather than leaving it to the picture', () => {
    expect(page).toContain('not set — the design cannot be placed on the photo yet');
    expect(page).toMatch(/corner\$\{4 - corners\.length === 1 \? '' : 's'\} to go/);
  });

  it('keeps exactly one prompt to mark the corners', () => {
    // The amber notice said the same thing as the card above step 1, in a
    // second place, worded as an instruction to find a third control.
    expect(page).not.toContain('Tap "Re-mark wall corners", then tap the four corners');
  });

  it('does not leave the promoted buttons duplicated in More options', () => {
    expect((page.match(/Protect a busy area<\/Button>/g) ?? []).length).toBe(1);
    expect(page).not.toContain('Mask window / drapes');
  });
});

/**
 * AN INTERACTION THE CUSTOMER CANNOT GUESS DOES NOT WORK.
 *
 * Owner, 2026-09-22, on the shipped block: "How do you mask the closet? It's
 * not masking." The button was visible — that part of the previous pass
 * worked — and pressing it set `marking: 'rectangle'` and said NOTHING, while
 * WallPhotoEditor expects TWO taps: one corner, then the opposite one. So the
 * first tap looked like it had done nothing, and two taps close together
 * produced a small box nowhere near the closet.
 *
 * The second half is ordering: a mask only means something once the design is
 * placed inside the wall quad, and the page never said the wall comes first.
 */
describe('masking tells you what to do while you are doing it', () => {
  const page = readFileSync(fileURLToPath(new URL('../../pages/WallPro.tsx', import.meta.url)), 'utf8');

  it('names the two taps a rectangle mask actually needs', () => {
    expect(page).toContain('Tap ONE corner of the closet, door or window on the photo.');
    expect(page).toContain('Now tap the OPPOSITE corner');
  });

  it('advances the instruction after the first tap instead of repeating itself', () => {
    expect(page).toMatch(/excludeDraft\.length === 0\n?\s*\? 'Tap ONE corner/);
  });

  it('counts the points a freehand outline still needs', () => {
    expect(page).toMatch(/\$\{3 - excludeDraft\.length\} more point/);
  });

  it('offers Undo and Cancel where the instruction is, not in a hidden panel', () => {
    // Searched FORWARD from the banner: the page has an unrelated Cancel
    // earlier (the history panel), and indexOf would find that one first and
    // make this assertion accidentally meaningless.
    const banner = page.indexOf('Tap ONE corner of the closet');
    expect(banner).toBeGreaterThan(-1);
    const rest = page.slice(banner, banner + 1800);
    expect(rest).toContain('>Undo point</Button>');
    expect(rest).toContain('>Cancel</Button>');
  });

  it('says the wall comes first, because a mask before it cuts nothing', () => {
    expect(page).toContain('Mark the wall first');
    expect(page).toContain('there is nothing for a mask to cut out of');
  });
});
