import { describe, expect, it } from 'vitest';
import {
  WPW_WALL_WRAP_URL, WPW_WALL_WRAP_WOO_ID, wpwWallWrapBuy,
} from '../wpw-wall-product';

describe('buying the wall wrap from WePrintWraps', () => {
  // THE ASSERTION THAT MATTERS. A guessed WooCommerce id silently adds SOMEBODY
  // ELSE'S product to a real customer's cart, and a wrong cart looks like it
  // worked -- worse than no button. Every other WPW SKU in the catalog has a
  // recorded id (avery-1105 is 79, contour cut 108, custom wrap design 234);
  // the wall SKU's was never recorded, so it stays null until confirmed against
  // the live store. This test fails the day someone fills it in from memory
  // without also updating the expectation, which is the point.
  it('refuses to invent a WooCommerce product id', () => {
    expect(WPW_WALL_WRAP_WOO_ID).toBeNull();
  });

  it('sends the customer to the real product page while the id is unknown', () => {
    const buy = wpwWallWrapBuy(94.67)!;
    expect(buy.mode).toBe('product');
    expect(buy.url).toBe(WPW_WALL_WRAP_URL);
    // It must SAY what the button does. A control that quietly does something
    // smaller than it looks is how trust is lost.
    expect(buy.note).toMatch(/95 sq ft/);
  });

  // WooCommerce quantities are whole units. A wall short of film is a reprint;
  // a fraction of a square foot over is a few cents in the shop's favour.
  it('rounds the square footage UP, never down', () => {
    expect(wpwWallWrapBuy(94.67)!.sqFt).toBe(95);
    expect(wpwWallWrapBuy(94.01)!.sqFt).toBe(95);
    expect(wpwWallWrapBuy(94)!.sqFt).toBe(94);
  });

  it('has nothing to sell without a measured wall', () => {
    expect(wpwWallWrapBuy(0)).toBeNull();
    expect(wpwWallWrapBuy(-5)).toBeNull();
    expect(wpwWallWrapBuy(Number.NaN)).toBeNull();
  });

  it('names the footage on the button so the number is never a surprise', () => {
    expect(wpwWallWrapBuy(94.67)!.label).toMatch(/95 sq ft/);
  });
});
