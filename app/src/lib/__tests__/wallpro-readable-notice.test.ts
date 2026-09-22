/**
 * THREE DEFECTS IN ONE PHONE SCREENSHOT (owner, 2026-09-22).
 *
 * She photographed WallPro on iOS at 9:02 and the picture carries all three:
 *
 *  1. A notice card with NO READABLE TEXT IN IT. Light-on-light.
 *  2. That unreadable notice saying "Corners set…" directly above a card
 *     saying "Mark your wall to see the design on it".
 *  3. The card telling her to use "Change what we keep" — a control that was
 *     deleted from this page a day earlier.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const page = readFileSync(fileURLToPath(new URL('../../pages/WallPro.tsx', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8');

/**
 * ONE COMPONENT SERVES TWO BRANDS, SO A HARDCODED COLOUR IS HALF-BROKEN BY
 * CONSTRUCTION.
 *
 * `bg-sky-50` is near-white and the element declared no text colour, so it took
 * the page's inherited ink. On WePrintWraps that ink is near-black and the
 * notice read perfectly — which is why this shipped. On DesignProAI
 * `--wall-ink` is 98% lightness: white text on a white card, every notice the
 * page writes, invisible.
 */
describe('the notice is legible on both themes', () => {
  it('states its own colour instead of inheriting one', () => {
    const notice = page.indexOf('{notice && <p role="status"');
    expect(notice).toBeGreaterThan(-1);
    const el = page.slice(notice, notice + 260);
    expect(el).toContain('wall-ink');
  });

  it('does not paint a near-white Tailwind fill under theme-coloured text', () => {
    const notice = page.indexOf('{notice && <p role="status"');
    const el = page.slice(notice, notice + 260);
    expect(el).not.toContain('bg-sky-50');
    expect(el).toContain('wall-card');
  });

  it('and the two themes really do disagree about ink, which is the whole point', () => {
    // If they ever agreed, the defect above would be unreachable and this lock
    // would be testing nothing. Pin that they differ.
    expect(css).toContain('--wall-ink: 222 47% 11%');
    expect(css).toContain('--wall-ink: 210 40% 98%');
  });

  it('the error banner keeps its own explicit colour, unchanged', () => {
    // It was always correct -- `bg-red-50 text-red-800` states both halves --
    // and is asserted here so a later sweep of "remove Tailwind colours" does
    // not turn a readable alert into the defect this file exists for.
    expect(page).toContain('bg-red-50 p-4 text-sm text-red-800');
  });
});

/**
 * A FROZEN SENTENCE CANNOT BE ALLOWED TO OUTLIVE THE STATE IT DESCRIBES.
 *
 * The card is derived — it re-reads `wallLocated` every render and is always
 * right. The notice is written once. So any path that later invalidates the
 * corners leaves a claim about them stranded on screen, and the customer is
 * told both that her wall is set and that she must set it.
 */
describe('the notice cannot contradict the card', () => {
  it('drops a corner claim when the wall stops being located', () => {
    expect(page).toContain('const wasLocated = useRef(wallLocated);');
    expect(page).toContain('if (wasLocated.current && !wallLocated) setNotice(\'\');');
  });

  it('clears on the FALSE edge only, so the fourth tap still gets to speak', () => {
    // `markPoint` writes "Corners set…" in the same tick that flips
    // `wallLocated` true. Clearing on the true edge would delete it.
    const guard = page.indexOf('if (wasLocated.current && !wallLocated)');
    const block = page.slice(guard - 40, guard + 160);
    expect(block).not.toMatch(/if \(!wasLocated\.current && wallLocated\)/);
    expect(block).toContain('wasLocated.current = wallLocated;');
  });

  it('keeps the card derived rather than answering from the same frozen string', () => {
    expect(page).toContain('{photo && !wallLocated && (');
  });
});

/**
 * THE SECOND DEAD CONTROL FOUND IN ONE DAY.
 *
 * "Change what we keep" was the collapsed link hiding the masking tools. The
 * UX pass that promoted those tools into the open deleted it — and this
 * sentence, the one place the page answers "how do I mask the closet?", kept
 * sending her to find it. Same shape as `wallpro-print-export` telling
 * customers to "Choose Mirror repeat or Blended repeat" with no such control
 * anywhere in the app.
 */
describe('the card names controls that exist', () => {
  it('does not send the customer to the deleted link', () => {
    // Comments stripped: the UX-pass comment that RECORDS deleting this link
    // names it, and convicting the record would force the record to be
    // deleted. Same reasoning as the seam-ladder lock written the same hour.
    const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('Change what we keep');
    expect(page).toContain('Change what we keep'); // the record survives
  });

  it('names the button in the words printed on it', () => {
    expect(page).toContain('A closet opening, a doorway or a window inside the wall');
    const answer = page.indexOf('A closet opening, a doorway or a window inside the wall');
    const sentence = page.slice(answer, answer + 400);
    expect(sentence).toContain('Mask a closet,');
    expect(sentence).toMatch(/door or window<\/strong>/);
    // And it states the two-tap interaction, because a button that looks like
    // it did nothing after one tap is what she reported the day before.
    expect(sentence).toContain('two opposite');
  });

  it('that button is really on the page, spelled the same way', () => {
    expect(page).toContain('>Mask a closet, door or window</Button>');
  });
});
