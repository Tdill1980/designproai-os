import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * THE TOOL'S MASTHEAD SURVIVES AN EMPTY SHOWCASE.
 *
 * Owner, 2026-09-22, holding a screenshot of the band beside the live page:
 * "Wpw wallpro should look like this." The live tool opened on a bare
 * "1. Upload your wall" with no headline, no sentence saying what it does, and
 * no link to the case study or the prices. It looked unfinished, which is the
 * worst thing a partner demo can look like.
 *
 * ── HOW IT DISAPPEARED, WHICH IS THE WHOLE POINT OF THIS FILE ─────────────
 *
 * Nobody deleted it. The section was gated on `bandProofs.length > 0` — one
 * condition covering two unrelated things: a before/after SLIDER, which
 * genuinely needs a photograph, and the page's own MASTHEAD, which does not.
 *
 * Then the proof list emptied from both ends, for two good reasons that had
 * nothing to do with each other and were taken three days apart:
 *
 *   2026-09-18  the owner's own home came out ("remove my photo ... just show
 *               the others") — TWO entries, the spa pair and the slat pair
 *               being the same room photographed two ways;
 *   2026-09-21  the gym pair came out when its generated "after" was found to
 *               have written a real company's trademark into the artwork.
 *
 * WALL_PROOFS hit zero. `WallProHeroProof` rendered null exactly as its own
 * contract says it should ("SHOWS NOTHING WHEN IT HAS NOTHING"), and the gate
 * took the headline, the description and both links down with it. Every test
 * in the suite stayed green, because no test had ever asserted that the tool
 * says what it is.
 *
 * ── WHAT IS LOCKED, AND WHY IT IS READ OFF THE SOURCE ─────────────────────
 *
 * That the masthead's condition is the customer's own progress and NOTHING
 * else. A showcase is allowed to be empty — it is empty on purpose, and this
 * repository would rather ship a short honest list than a padded one — but an
 * empty showcase may never silence the page.
 *
 * Read from source rather than rendered: the defect is a JSX condition
 * upstream of everything, and a render test would have to mount the whole tool
 * (Supabase, storage, canvas, the generator) to reach it. The condition itself
 * is the thing that broke and the thing worth pinning.
 */
const page = readFileSync(fileURLToPath(new URL('../../pages/WallPro.tsx', import.meta.url)), 'utf8');

/** The masthead's opening condition, as written. */
const gate = () => page.match(/\{!photo && !artwork && \(\n\s*<section className=\{?`?mx-auto mt-5 grid/);

describe('the WallPro masthead', () => {
  it('renders on the customer\'s progress alone, never on whether a showcase has photos', () => {
    // The pre-fix line was `{!photo && !artwork && bandProofs.length > 0 && (`.
    // Verified to fail against it: this match requires the condition to CLOSE
    // straight after !artwork.
    expect(gate(), 'the masthead section must open on `!photo && !artwork` only').not.toBeNull();
    expect(page).not.toContain('!photo && !artwork && bandProofs.length > 0');
  });

  it('still says what the tool is, and still links to the proof and the prices', () => {
    expect(page).toContain('On-demand wall wrap');
    expect(page).toContain('See a real wall, bare to installed');
    expect(page).toContain('Prices &amp; questions');
  });

  it('keeps the partner sentence on the partner brand and off DesignProAI', () => {
    // One component, two true sentences. A DesignProAI visitor must not be
    // promised a printer this page does not sell.
    expect(page).toContain('Designed in WallPro, printed by WePrintWraps');
    expect(page).toMatch(/theme\.showPrintOffer\s*\n?\s*\?\s*<>Designed in WallPro, printed by WePrintWraps/);
  });

  it('sends each brand to its OWN case study and FAQ', () => {
    expect(page).toContain("theme.showPrintOffer ? '/wall-wrap/how-it-works' : '/printpro/wallpro/how-it-works'");
    expect(page).toContain("theme.showPrintOffer ? '/wall-wrap/faq' : '/printpro/wallpro/faq'");
  });

  it('drops to one column when there is no proof to sit beside the copy', () => {
    // Two columns with an empty second one is a masthead stranded in a 26rem
    // gutter. The grid template is therefore conditional where the SECTION is
    // not -- which is the whole separation this fix makes.
    expect(page).toMatch(/bandProofs\.length > 0 \? 'lg:grid-cols-\[minmax\(0,26rem\)_minmax\(0,1fr\)\]' : ''/);
  });

  it('mounts the slider unconditionally inside the section, trusting its own empty contract', () => {
    // WallProHeroProof returns null on an empty list by design. Re-checking the
    // length at the mount site is the duplicate condition that caused this.
    expect(page).toContain('<WallProHeroProof proofs={bandProofs} />');
    expect(page).not.toContain('bandProofs.length === 0 && <WallProHeroProof');
  });

  it('clears itself the moment the customer has a wall or artwork on screen', () => {
    // Unchanged behaviour, pinned because it is the other half of the
    // condition and a future edit to this line must not lose it: someone with
    // their own room on screen does not need to be told what the tool is.
    expect(page).toMatch(/!photo && !artwork/);
  });
});
