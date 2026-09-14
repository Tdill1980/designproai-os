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

describe('the cart, now that the store and the page agree', () => {
  // The store was configured correctly ALL ALONG. The catalog said
  // unit:"linear_foot" and that was simply wrong -- product 70093's order
  // history realizes exactly $3.25 per SQUARE foot (18 sq ft -> $58.50,
  // 38.25 -> $124.31, 14.25 -> $46.31). The wrong metadata was making this
  // gate refuse a store that matched. Now they agree and the cart opens.
  it('matches the live store: $3.25 per square foot', () => {
    expect(WPW_WALL_WRAP_PRODUCT!.unit).toBe('sqft');
    expect(WPW_WALL_WRAP_PRODUCT!.price).toBe(3.25);
    expect(WPW_WALL_FILM_RATE_PER_SQFT).toBe(3.25);
    expect(storeMatchesLaunchPricing()).toBe(true);
  });

  it('opens a one-click cart now that the unit and rate agree', () => {
    const buy = wpwWallWrapBuy(94.67)!;
    expect(buy.mode).toBe('cart');
    expect(buy.url).toContain('add-to-cart=70093');
    expect(buy.url).toContain('quantity=95');
    // Nothing to caveat when the button does exactly what it says.
    expect(buy.note).toBeNull();
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
