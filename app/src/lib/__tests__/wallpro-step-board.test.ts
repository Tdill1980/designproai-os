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
import { activeStepId, WALL_OUTCOMES, type BoardStep } from '../../components/wallpro/WallProStepBoard';
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

describe('the closing strip states outcomes the repo can point at', () => {
  it('names the four', () => {
    expect([...WALL_OUTCOMES]).toEqual([
      'Auto-scaled to your wall',
      'Panelized to the press width',
      'Bleed & overlap included',
      'Download print-ready files',
    ]);
  });

  it('shows before the work starts and steps aside once a design exists', () => {
    expect(page).toContain('{!artwork && <WallProOutcomes />}');
  });
});
