/**
 * THE WHOLE JOB IN ONE ROW, AND ONE NUMBERING SYSTEM FOR IT.
 *
 * Owner, 2026-09-22, with a tool-page mockup: "It should be like this." Four
 * cards across — Upload your wall · Select wall area · Describe your design ·
 * Generate & preview — with the flow visible before any of it is done.
 *
 * ── WHY THE NUMBERING IS HERS AND NOT THE PAGE'S ──────────────────────────
 *
 * The page ran 1 Upload · 2 Choose your design · 3 Configure · 4 Preview, and
 * marking the wall was NOT A STEP AT ALL: it lived unlabelled inside step 1's
 * photo block, below the fold on a phone. That is why "it did not allow me or
 * instruct me to pin corners", "how do you mask the closet" and "it's still
 * making me scroll down" are the same report three times. Making it step 2 is
 * the owner answering her own complaint.
 *
 * ── TWO RULINGS ASKED FOR DIRECTLY, BECAUSE GUESSING WOULD HAVE MOVED MONEY ─
 *
 * 1. The five priced entry paths live UNDER the brief as "More ways to start",
 *    each keeping its own price on its own row. The 2026-09-13 launch rule is
 *    that the price rides the choice and never a checkout, so the picker is
 *    demoted, never hidden.
 * 2. The board OPENS a step; it is not the step. A photo editor at a quarter
 *    of the screen cannot be tapped on a phone, which is the exact failure
 *    this whole pass exists to fix.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { activeStepId, type BoardStep } from '../../components/wallpro/WallProStepBoard';
import { WALL_STYLE_CHIPS, appendStyleChip } from '../wallpro-scale';

const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const page = source('../../pages/WallPro.tsx');
const board = source('../../components/wallpro/WallProStepBoard.tsx');

const step = (id: string, done: boolean): BoardStep =>
  ({ id, n: 1, label: id, icon: (() => null) as any, detail: '', done });

describe('the board reports where the job actually is', () => {
  it('the active step is the first one not done', () => {
    expect(activeStepId([step('a', true), step('b', false), step('c', false)])).toBe('b');
    expect(activeStepId([step('a', true), step('b', true)])).toBeNull();
  });

  it('a step the customer skipped is still the active one, not the last', () => {
    // Corners can be left unmarked while a design is generated -- print files
    // never wait for them -- so "done" is not monotonic and the FIRST gap is
    // the honest answer.
    expect(activeStepId([step('upload', true), step('area', false), step('describe', true), step('generate', true)])).toBe('area');
  });
});

describe('the page mounts the owner\'s four steps, numbered once', () => {
  it('carries the four cards above everything else', () => {
    expect(page).toContain('<WallProStepBoard steps={boardSteps}');
    const boardAt = page.indexOf('<WallProStepBoard steps={boardSteps}');
    const step1 = page.indexOf('<section id="upload-wall"');
    expect(boardAt).toBeGreaterThan(-1);
    expect(boardAt).toBeLessThan(step1);
  });

  it('numbers them the way the mockup does, with no second system', () => {
    expect(page).toContain('<StepHeading n={1} icon={Upload}>Upload your wall</StepHeading>');
    expect(page).toContain('<StepHeading n={2} icon={Ruler}>Select wall area</StepHeading>');
    expect(page).toContain('<StepHeading n={3} icon={Settings2}>Describe your design</StepHeading>');
    expect(page).toContain('<StepHeading n={4} icon={ImageIcon}>Generate &amp; preview</StepHeading>');
    // Exactly one heading per number: the old inner "3" became a sub-heading.
    for (const n of [1, 2, 3, 4]) {
      expect((page.match(new RegExp(`<StepHeading n=\\{${n}\\}`, 'g')) ?? []).length).toBe(1);
    }
  });

  it('gives step 2 a real anchor, so the board can open the thing it names', () => {
    expect(page).toContain('id="select-wall-area"');
    expect(page).toContain("{ id: 'select-wall-area', n: 2, label: 'Select wall area'");
  });

  it('each card does the work rather than naming another button', () => {
    // The lesson "tap Re-mark wall corners" already taught: an instruction to
    // find a third control is not an action.
    expect(page).toContain("onClick: () => uploadInputs.current.photo?.click()");
    expect(page).toContain("setMarking('wall'); setExcludeDraft([]); setView('before'); focusPhoto();");
    expect(page).toContain('onClick: () => void generate(), disabled: generateDisabled');
  });
});

describe('the board opens the step; it is not the step', () => {
  it('holds state and one action, never a photo editor', () => {
    expect(board).not.toContain('WallPhotoEditor');
    expect(board).not.toContain('<textarea');
    expect(board).toContain('onOpen');
  });

  it('stays ONE row on a phone instead of re-stacking into the scroll it removes', () => {
    expect(board).toContain('snap-x snap-mandatory');
    expect(board).toContain('overflow-x-auto');
    expect(board).toContain('lg:grid-cols-4');
  });

  it('marks the active card for a screen reader too, not only with a ring', () => {
    expect(board).toContain("aria-current={isActive ? 'step' : undefined}");
  });
});

describe('the priced paths are demoted, never hidden', () => {
  it('sits under the brief as a disclosure', () => {
    // The EXACT summary, not the phrase: step 3's card on the board also says
    // "More ways to start are under it", and it sits higher in the file, so a
    // loose indexOf measured the card against the section and failed honestly.
    const summary = 'More ways to start &mdash; and what each costs';
    expect(page).toContain(summary);
    const heading = page.indexOf('<StepHeading n={3} icon={Settings2}>Describe your design');
    const more = page.indexOf(summary);
    expect(heading).toBeGreaterThan(-1);
    expect(more).toBeGreaterThan(heading);
  });

  it('every path still carries its own price on its own row', () => {
    // The 2026-09-13 launch rule: the price rides the choice, never a checkout.
    expect(page).toContain('{formatMoney(WALL_DESIGN_SKUS[option.mode].cents)}');
    for (const mode of ['library', 'match', 'wall', 'ai', 'upload']) {
      expect(page).toContain(`mode: '${mode}'`);
    }
  });

  it('opens itself whenever the customer is already on a non-default path', () => {
    // A restored project must never bury the mode it is actually in.
    expect(page).toContain("open={designMode !== 'ai'}");
  });
});

describe('the style chips help the brief instead of spending it', () => {
  it('are the mockup\'s seven words', () => {
    expect([...WALL_STYLE_CHIPS]).toEqual(['Modern', 'Floral', 'Wood', 'Abstract', 'Marble', 'Concrete', 'Custom']);
  });

  it('APPEND, because the customer\'s own words are the scarcest input on the page', () => {
    // Measured in the two-persona rule: 44 characters of brief against 3,342
    // of persona. A chip that overwrote the brief would spend the only thing
    // the design actually depends on.
    expect(appendStyleChip('', 'Floral')).toBe('Floral');
    expect(appendStyleChip('oversized blue botanicals', 'Floral')).toBe('oversized blue botanicals, floral');
    expect(appendStyleChip('warm ivory ground.', 'Wood')).toBe('warm ivory ground. wood');
  });

  it('tapping the same chip twice is a no-op, not a stutter', () => {
    expect(appendStyleChip('soft floral pattern', 'Floral')).toBe('soft floral pattern');
    expect(appendStyleChip('Marble', 'Marble')).toBe('Marble');
    // ...and a word merely CONTAINING the chip is not a match.
    expect(appendStyleChip('woodland scene', 'Wood')).toBe('woodland scene, wood');
  });

  it('Custom adds nothing, because it means "I will describe it myself"', () => {
    expect(appendStyleChip('a calm room', 'Custom')).toBe('a calm room');
    expect(appendStyleChip('', 'Custom')).toBe('');
  });

  it('is wired to the brief and clears a stale design, like typing does', () => {
    expect(page).toContain('setPrompt(appendStyleChip(prompt, chip)); setArtwork(null);');
  });
});

describe('the empty-state proof shows the real five-step magic', () => {
  it('uses the dedicated magic component before the workspace', () => {
    expect(page).toContain('<WallProMagic />');
    const magic = page.indexOf('<WallProMagic />');
    const workspace = page.indexOf('<section id="upload-wall"');
    expect(magic).toBeGreaterThan(-1);
    expect(workspace).toBeGreaterThan(magic);
    // Owner, 2026-09-24: the separate "Start Your Wall Wrap" heading is gone.
    expect(page).not.toContain('>Start Your Wall Wrap</h2>');
  });

  it('keeps the working board only after the customer starts', () => {
    expect(page).toContain('{(photo || artwork) && <div className="hidden sm:block">');
    expect(page).toContain('<WallProStepBoard steps={boardSteps}');
  });
});

/**
 * EVERYTHING THE CUSTOMER SUPPLIES IS ONE BLOCK.
 *
 * Owner, 2026-09-22, with a demo session imminent: "The upload style reference
 * should be right next to upload wall / And the text prompt".
 *
 * They were three screens apart — the wall upload in step 1, the style
 * reference and the brief buried inside step 3's conditional tree BELOW the
 * priced picker — so showing the tool meant scrolling to hunt for two of the
 * three things a customer actually provides.
 *
 * MOVED, NEVER COPIED. Two textareas writing one `prompt` is the same drift
 * this page has already paid for with two numbering systems and two homes for
 * the photo's controls.
 */
describe('the three inputs sit together', () => {
  it('keeps exactly ONE brief, and it is in step 1', () => {
    expect((page.match(/value=\{prompt\}/g) ?? []).length).toBe(1);
    const step1 = page.indexOf('<section id="upload-wall"');
    const step3 = page.indexOf('<section id="choose-design"');
    const brief = page.indexOf('value={prompt}');
    expect(brief).toBeGreaterThan(step1);
    expect(brief).toBeLessThan(step3);
  });

  it('puts the style reference beside the wall upload, not below the picker', () => {
    const wall = page.indexOf("uploadControl('photo'");
    const ref = page.indexOf("uploadControl('reference'");
    const step3 = page.indexOf('<section id="choose-design"');
    expect(ref).toBeGreaterThan(wall);
    expect(ref).toBeLessThan(step3);
    // Side by side on anything wider than a phone, stacked on one.
    //
    // ⚠️ THE RATIO IS NOT 1:1 ANY MORE, AND THE LOCK PINNED THE RATIO RATHER
    // THAN THE RULE (owner, 2026-09-24: "upload is waisting ui space"). The
    // wall photo is REQUIRED and the other tile says "optional" on its face,
    // so equal width was the layout claiming they are equal choices. What this
    // case is actually for — the reference sits with the wall upload instead
    // of being buried under the priced picker — is asserted above.
    expect(page).toMatch(/grid gap-3 sm:grid-cols-3/);
    expect(page).toContain('sm:col-span-2');
  });

  /**
   * ONCE YOU HAVE UPLOADED, THE UPLOAD STOPS TAKING THE FOLD (owner, Trish
   * 2026-09-24: "upload is waisting ui space").
   *
   * Two equal tiles plus two helper paragraphs is a full block of screen, and
   * it stayed that size forever — including after the photo was chosen, when
   * both tiles are instructions for a thing already done and the only screen
   * that matters is the wall itself, one section below. On a phone that was
   * the whole fold, which is the same complaint as "I have to scroll to find
   * my photo" arriving from the other direction.
   */
  it('collapses to one line with a thumbnail once a photo exists', () => {
    expect(page).toContain('{photo ? (');
    expect(page).toContain('Wall photo added');
    expect(page).toMatch(/alt="Your wall photo"/);
  });

  it('still offers Replace and Add — nothing is removed, only shrunk', () => {
    // The collapsed row is a LINK to the same picker, not a different control.
    expect(page).toContain("onClick={() => uploadInputs.current.photo?.click()}>Replace<");
    expect(page).toMatch(/uploadInputs\.current\.reference\?\.click\(\)}>\{reference \? 'Replace' : 'Add'\}/);
  });

  it('keeps both file inputs mounted, or the links open nothing', () => {
    // `uploadControl` owns the <input> and the ref that the links call
    // `.click()` on, so the collapsed state has to render both controls even
    // though their tiles are hidden. Dropping them would leave two links
    // pointing at a null ref — a control that silently does nothing, which is
    // the exact defect class this page has already shipped twice.
    expect(page).toContain('<span className="hidden">{uploadControl(\'photo\'');
  });

  it('the chips travel with the brief rather than staying behind', () => {
    const brief = page.indexOf('value={prompt}');
    const chips = page.indexOf('WALL_STYLE_CHIPS.map');
    expect(chips).toBeGreaterThan(brief);
    expect(chips - brief).toBeLessThan(2000);
  });

  it('the reference hint still tells the truth about which path is active', () => {
    // On `match` the upload IS the design and is recreated faithfully; on every
    // other path it is inspiration only. One control, two honest sentences.
    //
    // ⚠️ THIS USED TO PIN THE PROSE VERBATIM, and it convicted a pure
    // shortening (owner, 2026-09-23: "a ton of unnecessary text it's hard to
    // even understand"). A lock that restates the text it guards turns every
    // edit into a lock edit and teaches nothing — the same shape CLAUDE.md
    // records taking Call 1 down. What matters is that the hint still BRANCHES
    // on the active path and still says the two load-bearing things: on match
    // the upload becomes a print-ready master, otherwise it is optional.
    expect(page).toContain("{intent === 'match'");
    expect(page).toMatch(/print-ready 4K master/);
    expect(page).toMatch(/Optional\. Your description alone is enough/);
  });

  it('the refine panel keeps its own reference control, which is a different thing', () => {
    // Post-generation "Add a reference image" belongs to Refine, not to step 1.
    expect(page).toContain("uploadControl('reference', reference ? 'Replace reference image'");
  });
});

/**
 * THE BOARD IS DESKTOP FURNITURE, AND THE PHONE ALREADY HAD A RAIL.
 *
 * Owner, 2026-09-22, from a phone, on the pass that shipped it: "Terrible UI
 * on mobile".
 *
 * The board was built to snap-scroll below `sm` so four cards would stay ONE
 * row. On a real phone that is a carousel of half-cut cards you swipe through
 * — and it is the THIRD progress indicator on one screen, under the sticky
 * step chips and directly above the very sections it summarises. An overview
 * is only an overview when it can be seen at once; when it has to be swiped,
 * it is one more thing to get through.
 *
 * So the sticky `WallProStepStrip` is the phone's progress indicator, which is
 * what it was always for, and the board appears from `sm` up where four cards
 * genuinely fit side by side. The carousel classes stay for the `sm`–`lg`
 * band, where two columns still scroll.
 */
describe('the board does not crowd a phone', () => {
  it('is hidden below sm, where the sticky strip already reports progress', () => {
    expect(page).toContain('<div className="hidden sm:block">');
    const wrapper = page.indexOf('<div className="hidden sm:block">');
    const mount = page.indexOf('<WallProStepBoard steps={boardSteps}');
    expect(wrapper).toBeGreaterThan(-1);
    expect(wrapper).toBeLessThan(mount);
  });

  it('the strip is still mounted on a phone, so progress is never unreported', () => {
    expect(page).toContain('<WallProStepStrip steps={wallSteps}');
    expect(page).not.toMatch(/<WallProStepStrip[^>]*className="hidden/);
  });
});

/**
 * A TICK THE PAGE AWARDS ITSELF IS A RECEIPT THAT LIES.
 *
 * The owner's phone screenshot carried three green chips — Your wall, Your
 * design, Preview — over a wall she had never marked and a design that had
 * never reached her photo.
 *
 * `width` and `height` DEFAULT to 120 x 96, so `width > 0 && height > 0` was
 * true before she touched anything: the chip certified a default. And
 * "Preview" claimed done at a flat master, while the whole point of uploading
 * a room photo is seeing the design in it.
 */
describe('progress is reported, not awarded', () => {
  it('"Your wall" needs a real photo, not the default dimensions', () => {
    expect(page).toContain("{ id: 'upload-wall', label: 'Your wall', done: !!photo && width > 0 && height > 0,");
  });

  it('"Preview" is not finished at a flat master when a photo exists', () => {
    expect(page).toContain("{ id: 'wall-preview', label: 'Preview', done: !!artwork && (!photo || wallLocated),");
    // ...and it says what is missing rather than only withholding the tick.
    expect(page).toContain('Mark the wall to see it in the room');
  });

  it('the board card agrees with the chip, rather than ticking on its own rule', () => {
    expect(page).toContain("label: 'Generate & preview', icon: ImageIcon, done: !!artwork && (!photo || wallLocated)");
  });

  it('a wall with no photo can still finish — print files never wait for corners', () => {
    // `!photo ||` is the whole reason this is not simply `wallLocated`: a
    // customer who only typed wall inches gets a flat master and is done.
    expect(page).toContain('(!photo || wallLocated)');
  });
});
