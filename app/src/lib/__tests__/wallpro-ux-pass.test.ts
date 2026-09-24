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
    //
    // RE-POINTED 2026-09-22 at the ON-PHOTO overlay, which is now the first
    // match and the one the hand is actually next to. The block below the
    // photo keeps its own copy for desktop; what must never happen again is
    // an instruction with its controls somewhere else.
    const banner = page.indexOf('Tap ONE corner of the closet');
    expect(banner).toBeGreaterThan(-1);
    // The window is the overlay's own block, not a round number: Undo, the
    // mask/remove switch and the leave-control all live in one control row
    // directly under the instruction. It was 1800 until tap-to-remove added
    // that switch and pushed the leave-control to +2273 — a window that
    // measures "adjacent" has to be widened when something genuinely adjacent
    // is added, which is the honest version of this fix. If it ever needs
    // widening past a few thousand, the controls really HAVE drifted and that
    // is the defect this lock is for.
    const rest = page.slice(banner, banner + 3000);
    expect(rest).toMatch(/>Undo( point)?<\/Button>/);
    // The leave-control is spelled by MODE since tap-to-mask landed
    // (2026-09-24): a tap has nothing to cancel -- each one is a finished item
    // on the photo -- so the same button reads Done there. What this lock
    // protects is that a leave-control sits WITH the instruction, not which
    // word is printed on it.
    //
    // ⚠️ AND IT BROKE AGAIN THE SAME DAY, on `{marking === 'tap' ? ...}`
    // becoming `{tapMode ? ...}` when tap-to-remove arrived. A lock that pins
    // the whole expression re-breaks on every rewording of a thing it does not
    // care about, so it now asks only that the button says Cancel somewhere --
    // as a bare label or inside a conditional -- which is the actual rule.
    expect(rest).toMatch(/>(Cancel|\{[^}]*'Cancel'\})<\/Button>/);
  });

  it('says the wall comes first, because a mask before it cuts nothing', () => {
    expect(page).toContain('Mark the wall first');
    expect(page).toContain('there is nothing for a mask to cut out of');
  });
});

/**
 * THE INSTRUCTION IS ON THE PHOTO, AND THE PHOTO COMES TO YOU.
 *
 * Owner, 2026-09-22, on the pass an hour before: "It's still not mobile
 * friendly it's still making me scroll down and instruction doesn't pop up
 * bad ux."
 *
 * Both halves were true and both were mine. The instruction had been put in
 * the "Your wall photo" block, which is BELOW the image — so on a phone she
 * was looking at the photo she had to tap while the words telling her what to
 * tap were off screen. And every control that STARTS a marking mode also
 * lives below the photo, so pressing one left her looking at buttons with the
 * target scrolled away above.
 */
describe('marking works without scrolling', () => {
  const page = readFileSync(fileURLToPath(new URL('../../pages/WallPro.tsx', import.meta.url)), 'utf8');

  /**
   * ⚠️ THIS CASE USED TO PIN THE INSTRUCTION *ON TOP OF* THE PHOTO, AND THAT
   * WAS THE NEXT DEFECT (owner, 2026-09-22, from a phone: "there is a
   * transparent overlay that covers half of image I can't even point to
   * corners").
   *
   * `absolute inset-x-0 top-0` inside the image box covered the top quarter of
   * her wall -- which is exactly where taps ONE and TWO land, because the
   * instruction itself says "clockwise from the top left".
   * `pointer-events-none` let the tap through; it did not let her SEE the
   * corner she was aiming at, and `backdrop-blur` over a photograph is a
   * frosted pane across the target.
   *
   * ADJACENT, NOT ON TOP. The instruction sits directly ABOVE the image in the
   * same card. That still solves what the previous pass solved -- nothing to
   * scroll for, because `focusPhoto()` brings the pair into view together --
   * and it covers nothing.
   */
  it('puts the instruction directly above the image, never over it', () => {
    expect(page).toContain('{marking && (');
    const banner = page.indexOf('{marking && (');
    const editor = page.indexOf('<WallPhotoEditor');
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(editor);
    // Adjacent, in flow -- not positioned over the tap target.
    expect(page.slice(banner, editor)).toContain('className="mb-2"');
  });

  it('no longer floats anything over the photo while marking', () => {
    // The taps land on the photo; nothing may sit between the customer's eye
    // and the corner she is aiming at.
    const banner = page.indexOf('{marking && (');
    const editor = page.indexOf('<WallPhotoEditor');
    const block = page.slice(banner, editor);
    expect(block).not.toContain('absolute inset-x-0 top-0');
    expect(block).not.toContain('backdrop-blur');
    expect(block).not.toContain('pointer-events-none');
  });

  it('carries every marking mode, not just the rectangle', () => {
    const overlay = page.indexOf('{marking && (');
    const block = page.slice(overlay, overlay + 2200);
    expect(block).toContain("marking === 'wall'");
    expect(block).toContain("marking === 'rectangle'");
    expect(block).toContain('to go');
  });

  it('brings the photo into view from EVERY control that starts marking', () => {
    // One helper, SIX call sites: the card above step 1, the in-block
    // Mark/Re-mark, both masking buttons, step 2 on the owner's four-step
    // board (added 2026-09-22), and -- added 2026-09-23 -- THE UPLOAD ITSELF.
    //
    // The sixth is not a marking control, and it belongs here anyway. Owner:
    // "when I upload the photo I see it and I don't need to scroll down to
    // find my upload." The editor renders in the second grid column, which
    // stacks below the ENTIRE left column under `lg`, so on a phone choosing a
    // photo left her looking at the brief box with her wall ~330 lines further
    // down. Accepting a photo is exactly the moment the photo should be on
    // screen, so it earns the same helper every marking control uses.
    //
    // The count is asserted rather than a minimum ON PURPOSE: this lock exists
    // because controls that start a mode kept being added WITHOUT the scroll,
    // so a new one must fail here and be looked at, not slide under a `>= 4`.
    // It did its job on 2026-09-23 — the upload call above failed this line
    // and had to be justified rather than absorbed.
    //
    // SEVENTH AND EIGHTH, 2026-09-24: "Tap an item to mask it" and its
    // opposite, "Tap an item to remove it" (owner: "could we tap to remove
    // it"). Both are marking controls in the plainest sense — they turn the
    // photo into the thing you tap — so both take the helper like the other
    // six, and this line caught each one before it shipped without a scroll.
    // Exactly what an exact count is for, twice in one day.
    expect(page).toContain('const focusPhoto = () =>');
    expect((page.match(/focusPhoto\(\);/g) ?? []).length).toBe(8);
  });
});
