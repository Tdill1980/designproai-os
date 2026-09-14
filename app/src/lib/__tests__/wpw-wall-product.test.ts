import { describe, expect, it } from 'vitest';
import {
  WPW_WALL_WRAP_PRODUCT, WPW_WALL_WRAP_URL, WPW_WALL_WRAP_WOO_ID,
  storeMatchesLaunchPricing, wpwWallWrapBuy,
} from '../wpw-wall-product';
import { WPW_WALL_FILM_RATE_PER_SQFT } from '../wallpro-pricing';

describe('the wall wrap SKU comes from the live-synced catalog', () => {
  it('resolves the WooCommerce product, id and all', () => {
    expect(WPW_WALL_WRAP_PRODUCT).not.toBeNull();
    expect(WPW_WALL_WRAP_WOO_ID).toBe(70093);
    expect(WPW_WALL_WRAP_URL).toContain('wall-wrap-printed-vinyl');
  });

  // Not re-typed here: WPW_CATALOG is the file reconciled against the live
  // Store API, so a re-sync updates this automatically rather than leaving a
  // stale number in a second place.
  it('takes the id from the catalog rather than a literal', () => {
    expect(WPW_WALL_WRAP_WOO_ID).toBe(WPW_WALL_WRAP_PRODUCT!.wooProductId);
  });
});

describe('the cart is gated on the store agreeing with the page', () => {
  // THE ASSERTION THAT MATTERS. The live Woo product is $3.25 per LINEAR FOOT;
  // the launch price is $3.50 per SQUARE FOOT. Handing WooCommerce a
  // square-footage quantity against a linear-foot price charges the wrong
  // number for the wrong unit -- on a 142 x 96 wall the page quotes $331.35 and
  // the cart would take $308.75. Quoted one number, charged another, and it
  // LOOKS like it worked.
  //
  // This test documents the live store's real configuration. When the Woo
  // product is changed to $3.50/sq ft and WPW_CATALOG is re-synced, this test
  // fails and is updated to expect the cart path -- which is exactly the
  // prompt to check the button now does what it says.
  it('knows the store is still priced per linear foot', () => {
    expect(WPW_WALL_WRAP_PRODUCT!.unit).toBe('linear_foot');
    expect(WPW_WALL_WRAP_PRODUCT!.price).toBe(3.25);
    expect(WPW_WALL_FILM_RATE_PER_SQFT).toBe(3.5);
    expect(storeMatchesLaunchPricing()).toBe(false);
  });

  it('refuses the one-click cart while the unit or rate disagree', () => {
    const buy = wpwWallWrapBuy(94.67)!;
    expect(buy.mode).toBe('product');
    expect(buy.url).toBe(WPW_WALL_WRAP_URL);
    // It must SAY what the button does.
    expect(buy.note).toMatch(/95 sq ft/);
  });
});

describe('the footage it would order', () => {
  // WooCommerce quantities are whole units. A wall short of film is a reprint;
  // a fraction of a square foot over is a few cents in the shop's favour.
  it('rounds UP, never down', () => {
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
