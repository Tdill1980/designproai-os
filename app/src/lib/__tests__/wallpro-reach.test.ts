/**
 * WHAT SHE JUST DID HAS TO BE ON SCREEN (owner, Trish 2026-09-23).
 *
 * "Fix ui and ux so that when I upload the photo I see it and I don't need to
 * scroll down to find my upload when I hit generate it doesn't show the
 * progress bar I have to scroll for it and I need to find the generate wall."
 *
 * Three measured causes, all of them layout, none of them her:
 *
 *  1. THE PHOTO RENDERS ~330 LINES BELOW THE UPLOAD BUTTON. The editor sits in
 *     the second column of a `lg:grid-cols-[400px_minmax(0,1fr)]`, and below
 *     `lg` that column stacks under the ENTIRE left column — upload, style
 *     reference, brief, chips, wall size, the design picker and the in-form
 *     Generate button. On a phone, choosing a photo looked like nothing
 *     happened.
 *  2. `focusPhoto` SCROLLED TO THE WRONG THING. It targeted `#wall-preview`,
 *     which is the step-4 HEADING — above the view tabs and the whole flat
 *     master pane — so even "Mark the corners" landed with the photo still off
 *     screen.
 *  3. PRESSING GENERATE MADE THE BUTTON VANISH. The fixed mobile bar rendered
 *     only when `!artwork && !busy`, and the single "Generating wall artwork…"
 *     line lives at the BOTTOM of step 4, below the editor and every mask
 *     control. The button disappeared and nothing took its place.
 *
 * These are source assertions on purpose: the failure is which element exists
 * and what a handler points at, and a jsdom render of a 2,600-line page with a
 * sticky header proves less about a phone than the wiring does.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PAGE = src('../../pages/WallPro.tsx');
/** Comments explain the bans by naming them; judge the code. */
const CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

describe('uploading a photo puts the photo on screen', () => {
  it('gives the editor its own anchor, clear of both sticky bars', () => {
    expect(CODE).toContain('id="wall-photo"');
    expect(CODE).toMatch(/id="wall-photo" style=\{\{ scrollMarginTop: stickyTop \+ 96 \}\}/);
  });

  it('scrolls there the moment a photo is accepted', () => {
    const upload = CODE.indexOf('setPhoto(asset)');
    expect(upload).toBeGreaterThan(0);
    // The call sits with the state change, not somewhere a later edit can drift
    // away from it.
    expect(CODE.slice(Math.max(0, upload - 200), upload)).toContain('focusPhoto()');
  });

  it('focusPhoto targets the picture and centres it, not the heading above it', () => {
    expect(CODE).toContain("getElementById('wall-photo')");
    expect(CODE).toMatch(/block: 'center'/);
  });

  it('still falls back to the section when the photo is not mounted', () => {
    // A signed-out or artwork-only state has no editor; scrolling nowhere would
    // be worse than scrolling to the section.
    expect(CODE).toMatch(/getElementById\('wall-photo'\) \?\? document\.getElementById\('wall-preview'\)/);
  });
});

describe('pressing Generate shows progress where the button was', () => {
  it('the fixed bar survives the press instead of vanishing', () => {
    // It used to be `!artwork && !busy`, so the tap removed its own button.
    expect(CODE).toContain('{(busy || !artwork) && <div className="fixed inset-x-0 bottom-16');
    expect(CODE).not.toContain('{!artwork && !busy && <div className="fixed inset-x-0 bottom-16');
  });

  it('renders the running state in the bar, announced', () => {
    const bar = CODE.slice(CODE.indexOf('{(busy || !artwork) && <div className="fixed inset-x-0 bottom-16'));
    const block = bar.slice(0, bar.indexOf('</div>}'));
    expect(block).toContain('role="status"');
    expect(block).toContain('aria-live="polite"');
    expect(block).toContain('animate-spin');
    expect(block).toContain('{busy}');
  });

  it('still offers the button, and its blocker, when nothing is running', () => {
    const bar = CODE.slice(CODE.indexOf('{(busy || !artwork) && <div className="fixed inset-x-0 bottom-16'));
    const block = bar.slice(0, bar.indexOf('</div>}'));
    expect(block).toContain('void generate()');
    expect(block).toContain('{generateLabel}');
    expect(block).toContain('{generationBlocker}');
  });
});

describe('the mask handles are sized for a thumb', () => {
  const EDITOR = src('../../components/wallpro/WallPhotoEditor.tsx');
  const EDITOR_CODE = EDITOR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

  // ⚠️ THESE THREE PINNED `<circle r=...>` AND HAD TO MOVE TO `<ellipse>`
  // (owner, 2026-09-24: "Fix the numbers look they are now distorted"). The
  // overlay's viewBox does NOT preserve aspect — that is what makes a
  // normalized point land in the right place — so one x-unit covers `aspect`
  // times as many pixels as one y-unit, and a `<circle>` rendered as a wide
  // ellipse. Every round mark now counter-scales its x-radius by `kx`.
  // The SIZE rule these locks exist for is unchanged; only the element is.
  it('takes the tap on a large invisible target, not on the drawn dot', () => {
    // r=".7" on a 100-unit viewBox is ~3px on a phone: the "finicky".
    expect(EDITOR_CODE).toContain('const HANDLE_TOUCH_R = 4;');
    expect(EDITOR_CODE).toMatch(/rx=\{HANDLE_TOUCH_R\*kx\} ry=\{HANDLE_TOUCH_R\} fill="transparent"/);
    expect(EDITOR_CODE).not.toMatch(/r="\.7" fill="white"/);
  });

  it('gives the wall corners the same target as the mask corners', () => {
    expect((EDITOR_CODE.match(/rx=\{HANDLE_TOUCH_R\*kx\}/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(EDITOR_CODE).not.toMatch(/r="\.85" fill=\{WALL_GLASS\.area\.handle\}/);
  });

  it('keeps the drawn dot small and out of the way of the tap', () => {
    expect(EDITOR_CODE).toMatch(/rx=\{1\.1\*kx\} ry=\{1\.1\}[^>]*className="pointer-events-none"/);
  });

  // THE ACTUAL FIX, ASSERTED AS A RULE: nothing round or lettered may be drawn
  // without undoing the stretch. A bare <circle> or an un-transformed <text>
  // in this overlay is the defect, whatever it is drawing.
  it('draws nothing round or lettered without undoing the viewBox stretch', () => {
    expect(EDITOR_CODE).toContain('const kx = 1 / aspect;');
    expect(EDITOR_CODE).toContain('preserveAspectRatio="none"');
    // No <circle> at all: every round mark is a counter-scaled ellipse.
    expect(EDITOR_CODE).not.toMatch(/<circle/);
    // Every <text> sits inside an unstretch() group.
    for (const match of EDITOR_CODE.matchAll(/<text\b/g)) {
      const before = EDITOR_CODE.slice(Math.max(0, match.index - 400), match.index);
      expect(before, 'a <text> is drawn without unstretch()').toContain('unstretch(');
    }
  });
});

describe('a mask can be resized and moved from the editor', () => {
  const EDITOR = src('../../components/wallpro/WallPhotoEditor.tsx');
  const EDITOR_CODE = EDITOR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

  it('routes a rectangle corner through the rectangle resize', () => {
    expect(EDITOR_CODE).toContain('isRectangularMask(mask) && resizeRectangularMask(mask, handle.vertex, next)');
  });

  it('falls back to the single vertex for a traced polygon', () => {
    expect(EDITOR_CODE).toContain('mask.map((q,j) => j === handle.vertex ? next : q)');
  });

  it('drags the whole mask by its body once selected', () => {
    expect(EDITOR_CODE).toContain("'wall' | 'mask' | 'body'");
    expect(EDITOR_CODE).toContain('translateMask(mask, next.x - from.x, next.y - from.y)');
    // The cast is gone: `startHandle` takes `React.PointerEvent<SVGElement>`
    // since the handles became ellipses (2026-09-24), which a polygon already
    // satisfies. What this line protects is that the mask BODY starts a
    // 'body' drag, not the element type it arrives on.
    expect(EDITOR_CODE).toContain("startHandle(e,{kind:'body',mask:i,vertex:-1})");
    expect(EDITOR_CODE).toContain('React.PointerEvent<SVGElement>');
  });

  it('clears the drag origin on every way a gesture can end', () => {
    // A stale origin makes the next drag jump by the distance between gestures.
    const ends = EDITOR_CODE.match(/bodyFrom\.current\s*=\s*null/g) || [];
    expect(ends.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * THE PHOTO STOPS EATING THE SCREEN, AND THE PAGE SAYS WHAT IT IS DOING
 * (owner, Trish 2026-09-24: "its displaying photo too large and now you cant
 * see your prompt or any words thst say design is generating. I know thee is a
 * progress bar but thats not the same we need the words and visible prompt"
 * ... "so they can resad the propt they submitted" ... "otherwiae your looking
 * sround wondering what happened").
 *
 * Two defects, one cause: everything that explains what is happening was
 * pushed off screen by the picture. The editor box had `w-full` and an
 * aspectRatio and NO CEILING, so a ~2:1 phone photo rendered as tall as the
 * column is wide.
 */
describe('the wall photo has a ceiling', () => {
  const EDITOR = src('../../components/wallpro/WallPhotoEditor.tsx');
  const EDITOR_CODE = EDITOR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('caps the height instead of filling the column', () => {
    expect(EDITOR_CODE).toContain("maxHeight:'min(70svh, 560px)'");
  });

  it('uses svh, because iOS vh counts chrome that is not there', () => {
    expect(EDITOR_CODE).not.toMatch(/maxHeight:'min\(70vh/);
  });

  it('letterboxes centred rather than cropping', () => {
    // aspect-ratio + max-height shrinks the WIDTH to match; mx-auto keeps the
    // narrower box centred in the column instead of hugging the left edge.
    expect(EDITOR_CODE).toContain('relative mx-auto w-full overflow-hidden');
    expect(EDITOR_CODE).toContain('aspectRatio:p.aspect');
  });
});

describe('a running design says so, in words, with the brief', () => {
  it('announces it in plain language rather than a stage log line', () => {
    expect(CODE).toContain("'Your design is generating…'");
    expect(CODE).toContain("'Your design is updating…'");
  });

  it('shows the brief they submitted, which is otherwise scrolled away', () => {
    const card = CODE.indexOf('{designBusy && <div role="status"');
    expect(card).toBeGreaterThan(-1);
    const block = CODE.slice(card, card + 900);
    expect(block).toContain('Your brief:');
    expect(block).toContain('{prompt.trim()}');
  });

  it('sits ABOVE the photo, where the eye already is', () => {
    expect(CODE.indexOf('{designBusy && <div role="status"')).toBeLessThan(CODE.indexOf('id="wall-photo"'));
  });

  it('is announced to a screen reader too, not only drawn', () => {
    const card = CODE.indexOf('{designBusy && <div role="status"');
    expect(CODE.slice(card, card + 120)).toContain('aria-live="polite"');
  });

  /**
   * ⚠️ THE SCOPE IS THE LOAD-BEARING PART. `busy` is the page's ONE status
   * string and carries every slow operation — "Opening image", "Saving
   * project", "Downloading artwork". Keyed on `busy` this card would announce
   * "Your design is generating" while she was saving a project, which is worse
   * than saying nothing at all.
   */
  it('never claims a design is running when something else is', () => {
    expect(CODE).toContain("const designBusy = busy === 'Generating wall artwork'");
    expect(CODE).toMatch(/: null;/);
    expect(CODE).not.toContain('{!!busy && <div role="status" aria-live="polite" className="mb-2 rounded-xl border-2');
  });

  /**
   * ⚠️ A STEPPED WIZARD WAS BUILT HERE AND REJECTED ("Not wizard"), and she
   * was right on the engineering as well as the taste: `busy` is ONE string
   * for the whole generation — consultant persona, designer and image are a
   * single edge call that reports nothing in between — so ticking sub-steps
   * would be a progress display telling a story the system cannot see.
   */
  it('invents no sub-steps the system cannot observe', () => {
    for (const invented of ['Writing your brief', 'Choosing a palette', 'Placing it on your photo']) {
      expect(CODE, invented).not.toContain(invented);
    }
  });
});
