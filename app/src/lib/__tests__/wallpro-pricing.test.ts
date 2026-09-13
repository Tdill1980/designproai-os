import { describe, expect, it } from 'vitest';
import { DEFAULT_WALL_PRINT, wallBilling } from '../wallpro-print-plan';
import { WALLPRO_PRINT_WIDTH } from '../wallpro-geometry';
import {
  WALL_DESIGN_SKUS, WPW_WALL_FILM_RATE_PER_SQFT, payeeForLine, wallDesignFeeCents, wallQuote,
  type WallDesignMode,
} from '../wallpro-pricing';

// The owner's own wall: 142 × 96 on the 54" roll with 1" bleed.
const billing = wallBilling(142, 96, DEFAULT_WALL_PRINT, WALLPRO_PRINT_WIDTH)!;
const quoteFor = (mode: WallDesignMode) => wallQuote({ path: 'design-and-print', designMode: mode, billing })!;

describe('the launch price list', () => {
  // Owner, 2026-09-13, verbatim. Asserted as a list rather than one at a time so
  // a change to any price is a visible change to this block.
  it('is exactly what the owner set', () => {
    expect(Object.fromEntries(
      (Object.keys(WALL_DESIGN_SKUS) as WallDesignMode[]).map(m => [WALL_DESIGN_SKUS[m].label, wallDesignFeeCents(m)]),
    )).toEqual({
      'Ready-to-Print Design': 7900,
      'Describe a Design': 14900,
      'Match My Design': 14900,
      'Design for My Wall': 19900,
      'File Prep': 4900,
    });
    expect(WPW_WALL_FILM_RATE_PER_SQFT).toBe(3.5);
  });

  // The ladder is the product explaining itself: the catalog design already
  // exists, the room-read is the most work.
  it('prices the entry paths in the order of the work they take', () => {
    expect(wallDesignFeeCents('library')).toBeLessThan(wallDesignFeeCents('ai'));
    expect(wallDesignFeeCents('ai')).toBeLessThan(wallDesignFeeCents('wall'));
    expect(wallDesignFeeCents('upload')).toBeLessThan(wallDesignFeeCents('library'));
  });

  it('quotes the path the customer actually took', () => {
    expect(quoteFor('wall').lines[0]).toMatchObject({ label: 'Design for My Wall', cents: 19900 });
    expect(quoteFor('library').lines[0]).toMatchObject({ label: 'Ready-to-Print Design', cents: 7900 });
    expect(quoteFor('upload').lines[0]).toMatchObject({ label: 'File Prep', cents: 4900 });
  });

  // Every design SKU promises print-ready files checked by a person -- that is
  // the whole "you are paying for the design" claim, including on File Prep.
  it('promises print-ready files and a human check on every design line', () => {
    for (const mode of Object.keys(WALL_DESIGN_SKUS) as WallDesignMode[]) {
      expect(WALL_DESIGN_SKUS[mode].detail).toMatch(/human-checked/i);
    }
  });
});

describe('the film is priced at the WePrintWraps rate', () => {
  // SQUARE FEET ONLY. Owner, 2026-09-13: "all printed wrap is priced by the sq
  // ft only." The panel plan also computes a BILLED footage -- every panel at
  // the full 54" roll regardless of printed width -- and pricing off that would
  // charge 110.25 sq ft for a 94.67 sq ft wall. That overhead is the shop's to
  // absorb; quoting it at the customer is a price they cannot check with a tape
  // measure.
  it('charges the WALL area, never the billed roll footage', () => {
    const quote = quoteFor('ai');
    expect(quote.filmSqFt).toBe(billing.wallSqFt);
    expect(quote.filmSqFt).toBeLessThan(billing.billedSqFt);
    expect(quote.filmBasis).toMatch(/priced by the square foot/);
  });

  it('multiplies the rate by that footage exactly', () => {
    const film = quoteFor('ai').lines.find(l => l.label === 'Wall wrap film, printed')!;
    expect(film.cents).toBe(Math.round(billing.wallSqFt * 3.5 * 100));
    expect(film.detail).toMatch(/\$3\.50\/sq ft/);
  });

  it('takes a per-shop rate when one is given', () => {
    const quote = wallQuote({ path: 'design-and-print', designMode: 'ai', billing }, { ratePerSqFt: 4.10 })!;
    const film = quote.lines.find(l => l.label === 'Wall wrap film, printed')!;
    expect(film.cents).toBe(Math.round(billing.wallSqFt * 4.10 * 100));
    expect(quote.ratePerSqFt).toBe(4.10);
  });
});

describe('the three purchase paths', () => {
  it('design + print bills both lines', () => {
    const quote = quoteFor('match');
    expect(quote.lines.map(l => l.label)).toEqual(['Match My Design', 'Wall wrap film, printed']);
    expect(quote.totalCents).toBe(quote.lines[0].cents + quote.lines[1].cents);
  });

  // The design-only buyer still gets print-ready files -- that is the whole
  // "they are paying for the design" claim -- so the line says so.
  it('design only bills the design and names the files', () => {
    const quote = wallQuote({ path: 'design-only', designMode: 'ai', billing })!;
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0].cents).toBe(14900);
    expect(quote.lines[0].detail).toMatch(/print-ready files/i);
    expect(quote.lines[0].detail).toMatch(/human-checked/i);
  });

  it('print only bills no design fee at all', () => {
    const quote = wallQuote({ path: 'print-only', designMode: 'ai', billing })!;
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0].label).toBe('Wall wrap film, printed');
    expect(quote.totalCents).toBe(Math.round(billing.wallSqFt * 3.5 * 100));
  });

  // A design-only quote needs no wall measured yet; anything involving film
  // does, and inventing a number there would be a made-up price.
  it('refuses to price film without real geometry', () => {
    expect(wallQuote({ path: 'design-and-print', designMode: 'ai', billing: null })).toBeNull();
    expect(wallQuote({ path: 'print-only', designMode: 'ai', billing: null })).toBeNull();
    expect(wallQuote({ path: 'design-only', designMode: 'ai', billing: null })).not.toBeNull();
  });
});

describe('the split', () => {
  // "a split stripe Wallpro to Handel the design" -- the design and the film
  // have different payees, and a quote that cannot say so will be implemented
  // as one payment by whoever wires checkout next.
  it('sends every design SKU to DesignProAI and the film to WePrintWraps', () => {
    for (const mode of Object.keys(WALL_DESIGN_SKUS) as WallDesignMode[]) {
      expect(payeeForLine(WALL_DESIGN_SKUS[mode].label)).toBe('designpro');
    }
    expect(payeeForLine('Wall wrap film, printed')).toBe('weprintwraps');
  });
});
