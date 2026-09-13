import { describe, expect, it } from 'vitest';
import { DEFAULT_WALL_PRINT, wallBilling } from '../wallpro-print-plan';
import { WALLPRO_PRINT_WIDTH } from '../wallpro-geometry';
import {
  WALL_DESIGN_FEE_CENTS, WPW_WALL_FILM_RATE_PER_SQFT, payeeForLine, wallQuote,
} from '../wallpro-pricing';

// The owner's own wall: 142 × 96 on the 54" roll with 1" bleed.
const billing = wallBilling(142, 96, DEFAULT_WALL_PRINT, WALLPRO_PRINT_WIDTH)!;

describe('the film is priced at the WePrintWraps rate', () => {
  it('is $3.25 a square foot', () => {
    expect(WPW_WALL_FILM_RATE_PER_SQFT).toBe(3.25);
  });

  // THE NUMBER THAT WOULD SURFACE AFTER THE CUSTOMER AGREED A PRICE. The spec
  // bills every panel at the full 54" roll regardless of printed width, so a
  // 142" wall is charged for 162" of roll. Quoting the wall's own area
  // (94.67 sq ft, $307.67) understates this by about $50.
  it('charges the BILLED square footage, not the wall area', () => {
    const quote = wallQuote('design-and-print', billing)!;
    expect(quote.filmSqFt).toBe(billing.billedSqFt);
    expect(quote.filmSqFt).toBeGreaterThan(billing.wallSqFt);
    expect(quote.filmBasis).toMatch(/every panel billed at the full roll width/);
  });

  it('multiplies the rate by that footage exactly', () => {
    const quote = wallQuote('design-and-print', billing)!;
    const film = quote.lines.find(l => l.label === 'Wall wrap film, printed')!;
    expect(film.cents).toBe(Math.round(billing.billedSqFt * 3.25 * 100));
    expect(film.detail).toMatch(/\$3\.25\/sq ft/);
  });

  it('takes a per-shop rate when one is given', () => {
    const quote = wallQuote('design-and-print', billing, { ratePerSqFt: 4.10 })!;
    const film = quote.lines.find(l => l.label === 'Wall wrap film, printed')!;
    expect(film.cents).toBe(Math.round(billing.billedSqFt * 4.10 * 100));
    expect(quote.ratePerSqFt).toBe(4.10);
  });
});

describe('the three purchase paths', () => {
  it('design + print bills both lines', () => {
    const quote = wallQuote('design-and-print', billing)!;
    expect(quote.lines.map(l => l.label)).toEqual(['Wall design', 'Wall wrap film, printed']);
    expect(quote.totalCents).toBe(quote.lines[0].cents + quote.lines[1].cents);
  });

  // The design-only buyer still gets print-ready files -- that is the whole
  // "they are paying for the design" claim -- so the line says so.
  it('design only bills the design and names the files', () => {
    const quote = wallQuote('design-only', billing)!;
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0].cents).toBe(WALL_DESIGN_FEE_CENTS);
    expect(quote.lines[0].detail).toMatch(/print-ready files/i);
    expect(quote.lines[0].detail).toMatch(/human-checked/i);
  });

  it('print only bills no design fee at all', () => {
    const quote = wallQuote('print-only', billing)!;
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0].label).toBe('Wall wrap film, printed');
    expect(quote.totalCents).toBe(Math.round(billing.billedSqFt * 3.25 * 100));
  });

  // A design-only quote needs no wall measured yet; anything involving film
  // does, and inventing a number there would be a made-up price.
  it('refuses to price film without real geometry', () => {
    expect(wallQuote('design-and-print', null)).toBeNull();
    expect(wallQuote('print-only', null)).toBeNull();
    expect(wallQuote('design-only', null)).not.toBeNull();
  });
});

describe('the split', () => {
  // "a split stripe Wallpro to Handel the design" -- the design and the film
  // have different payees, and a quote that cannot say so will be implemented
  // as one payment by whoever wires checkout next.
  it('sends the design to DesignProAI and the film to WePrintWraps', () => {
    expect(payeeForLine('Wall design')).toBe('designpro');
    expect(payeeForLine('Wall wrap film, printed')).toBe('weprintwraps');
  });
});
