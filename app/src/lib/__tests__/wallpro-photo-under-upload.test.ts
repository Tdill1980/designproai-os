/**
 * THE PHOTO IS WHERE YOU UPLOADED IT (owner, Trish 2026-09-23).
 *
 * "You never fixed still disjointed upload should show image uploaded and
 * allow me to mark corners and mask and easily move mask adjust it."
 *
 * Her screenshot is the whole diagnosis: step 1 "Upload your wall" rendered
 * TWO EMPTY DASHED BOXES and no picture, while the photo, its corners and its
 * masks lived under a separate heading far below. The wall she was standing in
 * front of was somewhere else on the page from the button she uploaded it with.
 *
 * THE CAUSE WAS GRID ORDER, NOT A MISSING CONTROL. `WallPhotoEditor` rendered
 * inside STEP 4, which is the second child of
 * `lg:grid-cols-[400px_minmax(0,1fr)]`. Below `lg` that child stacks under the
 * ENTIRE left column — upload, style reference, brief, chips, wall size, the
 * priced design picker and the in-form Generate button — so on a phone the
 * editor was ~330 lines beneath the upload. Step 2 was two detect buttons and
 * a sentence about a photo the customer could not see.
 *
 * ⚠️ AND THE PREVIOUS PASS ANSWERED IT WITH A SCROLL, WHICH SHE REJECTED
 * TWICE. `focusPhoto()` on upload moved the viewport to the editor; it left
 * the editor where it was. The fix for "I have to scroll to find my photo" is
 * never a better scroll — it is putting the photo under the upload. The scroll
 * helper stays (it is still right for a control that STARTS a marking mode),
 * but it is no longer carrying the structure.
 *
 * So the page is FOUR grid children in reading order — 1 upload · 2 the photo
 * and everything done to it · 3 the design · 4 the result — placed explicitly
 * with `lg:col-start` / `lg:row-start` so the desktop keeps form-left and
 * visuals-right. Below `lg` the DOM order IS the order.
 *
 * These are source assertions because the failure is WHICH ELEMENT COMES
 * FIRST. A jsdom render of a 2,600-line page proves nothing about a phone's
 * stacking order; the DOM sequence and the grid placement do.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(fileURLToPath(new URL('../../pages/WallPro.tsx', import.meta.url)), 'utf8');
/** Comments name the defect by quoting it; judge the code. */
const CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const at = (needle: string) => {
  const i = CODE.indexOf(needle);
  expect(i, `not found in WallPro.tsx: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe('a phone reads the page in the order the steps are numbered', () => {
  /**
   * ⚠️ THIS CASE WAS ONCE "BEFORE STEP 3", AND THAT WAS TOO WEAK — SHE
   * REPORTED IT A THIRD TIME (owner, 2026-09-23: "when you upload you have to
   * scroll down to find it").
   *
   * Moving the photo out of step 4 and in front of step 3 closed a 330-line
   * gap and left a real one: step 1 still carried the style reference, the
   * brief, the style chips, the wall size and the film price, so the photo was
   * five controls below the button that produced it. "Before step 3" was
   * satisfied the whole time. So the assertion is now the thing she actually
   * asked for — the photo is between the UPLOAD CONTROL and the BRIEF.
   */
  it('puts the photo directly under the upload control, above the brief', () => {
    const upload = at("uploadControl('photo'");
    const photoSection = at('id="select-wall-area"');
    const editor = at('<WallPhotoEditor');
    const brief = at('min-h-28');           // the brief textarea
    const describe3 = at('<StepHeading n={3} icon={Settings2}>');
    expect(upload, 'the photo block must follow the upload control').toBeLessThan(photoSection);
    expect(photoSection).toBeLessThan(editor);
    expect(editor, 'nothing may sit between the upload and its own photo').toBeLessThan(brief);
    expect(brief).toBeLessThan(describe3);
  });

  it('keeps the photo and the upload inside ONE section, not two cards apart', () => {
    // The 09-22 grouping ruling: wall upload, style reference and the prompt
    // are one block. The photo is not a fourth input — it is what the first
    // upload produced — so it belongs in the same card, not after it.
    const section = at('<section id="upload-wall"');
    const editor = at('<WallPhotoEditor');
    const closes = CODE.indexOf('</section>', editor);
    expect(section).toBeLessThan(editor);
    expect(closes).toBeGreaterThan(-1);
  });

  it('keeps the result last, after the design it is a result of', () => {
    expect(at('<StepHeading n={2} icon={Ruler}>')).toBeLessThan(at('<StepHeading n={3} icon={Settings2}>'));
    expect(at('<StepHeading n={3} icon={Settings2}>')).toBeLessThan(at('<StepHeading n={4} icon={ImageIcon}>'));
    // Step 4 is the result section, so its heading opens `#wall-preview`.
    expect(at('id="wall-preview"')).toBeLessThan(at('<StepHeading n={4} icon={ImageIcon}>'));
  });

  it('marks corners and masks in that same section, not in a third place', () => {
    // "allow me to mark corners and mask" — both controls must be reachable
    // without leaving the block the photo is in.
    const photoSection = at('id="select-wall-area"');
    const describe3 = at('<StepHeading n={3} icon={Settings2}>');
    // The ELEMENTS, not the phrases: "Mask a closet, door or window" and
    // "Protect a busy area" are also quoted inside two `setNotice` strings
    // ~1,300 lines higher, and an indexOf of the words finds those first and
    // fails honestly against prose that is not a control at all.
    for (const control of [
      'Mask a closet, door or window</Button>',
      'Protect a busy area</Button>',
      '>Your wall photo</h3>',
    ]) {
      const i = at(control);
      expect(i, control).toBeGreaterThan(photoSection);
      expect(i, control).toBeLessThan(describe3);
    }
  });

  it('mounts exactly one editor — two would be two sets of corners', () => {
    expect((CODE.match(/<WallPhotoEditor/g) ?? []).length).toBe(1);
  });
});

describe('the desktop keeps form on the left and the wall on the right', () => {
  it('places all four cells explicitly instead of trusting auto-flow', () => {
    // Auto-flow with four children would put the photo on row 1 col 2 and the
    // result on row 2 col 2 — which is what is wanted — but only while every
    // child stays in this order. The placement is written down so a fifth
    // child cannot silently re-flow the page.
    for (const placement of [
      'lg:col-span-2 lg:row-start-1',    // the prompt card, the board, the outcomes
      'lg:col-span-2 lg:row-start-2',    // 1 · upload AND 2 · the photo, full width
      'lg:col-start-1 lg:row-start-3',   // 3 · the design
      'lg:col-start-2 lg:row-start-3',   // 4 · the result
    ]) expect(CODE).toContain(placement);
  });

  it('never re-wraps the photo in a fieldset that greys out mid-generation', () => {
    // `<fieldset disabled>` is how the surrounding form gets its disable for
    // free, and free is exactly the problem: it reaches the SVG corner handles
    // too, so pressing Generate would stop her nudging the corner the render
    // is waiting on. The three controls that lost the fieldset carry their own.
    expect(CODE).toContain("<textarea className={inputClass + ' min-h-28'} disabled={!!busy}");
    // THREE since 2026-09-24: wall width, wall height, and the repeat width a
    // customer measures off the wallpaper she is matching. The two counts must
    // stay EQUAL -- that equality is the actual rule (every measured field
    // disables itself), and the literal numbers are only how it is read.
    expect((CODE.match(/type="number" min="1" max="2400"/g) ?? []).length).toBe(3);
    expect((CODE.match(/disabled=\{!!busy\} type="number" min="1" max="2400"/g) ?? []).length).toBe(3);
  });

  it('still has the two-column grid it had before', () => {
    expect(CODE).toContain('lg:grid-cols-[400px_minmax(0,1fr)]');
  });
});

describe('the wall does not grey out while a design renders', () => {
  it('leaves the photo section outside the disabled fieldset', () => {
    // Every control in the block carries its own `disabled={!!busy}`. Wrapping
    // the section in `<fieldset disabled>` would additionally kill the SVG
    // handles, so a customer who pressed Generate could no longer nudge a
    // corner while she waited — and the corner is the thing the render is
    // waiting on being right.
    const photoSection = at('id="select-wall-area"');
    const before = CODE.slice(0, photoSection);
    const opens = (before.match(/<fieldset/g) ?? []).length;
    const closes = (before.match(/<\/fieldset>/g) ?? []).length;
    expect(opens, 'the photo section is inside an open <fieldset>').toBe(closes);
  });
});
