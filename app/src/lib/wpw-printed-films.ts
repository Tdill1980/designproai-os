// BUYING PRINTED FILM WITHOUT DESIGNING ANYTHING.
//
// Owner, 2026-09-14, on what the WPW × WallPro page is:
//
//   "It's a hybrid page taking place of current wall product it is Wallpro x
//    wpw. Must have buttons so they can directly buy printed wrap film if they
//    don't need a new design and can order printed wrap film."
//
// That is the half the tool page was missing. It sold five ways to get a DESIGN
// and one cart button that only appeared after a wall had been measured — so a
// customer arriving with artwork already finished, which on a wrap printer's
// site is a large share of them, had nothing to click. This page replaces the
// wall product page, so it has to serve that buyer at least as well as the
// product page it removes.
//
// EVERY NUMBER HERE COMES FROM WPW_CATALOG, the file reconciled against the live
// WooCommerce Store API. Nothing is re-typed: a re-sync updates the rates and a
// changed id updates the cart link, rather than leaving a stale price on a page
// that takes money. The list below chooses WHICH products appear and in what
// order; it never states what they cost.
//
// ⚠️ THE UNIT GATE IS THE SAME ONE wpw-wall-product.ts EXPLAINS, AND FOR THE SAME
// REASON. `?add-to-cart=<id>&quantity=<n>` sends a NUMBER. If the product is
// priced per linear foot and we send square feet, the customer is charged for
// the wrong quantity of the wrong unit and it looks like it worked. So a film is
// only ever given a cart button when the catalog says it is sold by the square
// foot; anything else links to its product page and says so.

import { WPW_CATALOG, type WpwCatalogItem } from './wpw-catalog';

/**
 * The printed films a customer can order directly, in the order they appear.
 *
 * Wall film leads because this is the wall page — the product it replaces. The
 * rest follow because the owner asked for the WPW range on it: a shop that came
 * for a wall and also needs vehicle film should not have to go looking.
 */
const DIRECT_BUY_IDS: { wooProductId: number; use: string }[] = [
  { wooProductId: 70093, use: 'Interior and exterior walls' },
  { wooProductId: 79, use: 'Vehicle wraps — laminated' },
  { wooProductId: 72, use: 'Vehicle wraps — laminated' },
  { wooProductId: 108, use: 'Cut graphics, weeded and masked' },
  { wooProductId: 19420, use: 'Cut graphics, weeded and masked' },
  { wooProductId: 80, use: 'Window graphics — see out, not in' },
];

export type PrintedFilm = WpwCatalogItem & { use: string };

/** The films, resolved against the live-synced catalog. Unknown ids drop out. */
export const WPW_PRINTED_FILMS: PrintedFilm[] = DIRECT_BUY_IDS
  .map(({ wooProductId, use }) => {
    const item = WPW_CATALOG.find(c => c.wooProductId === wooProductId);
    return item ? { ...item, use } : null;
  })
  .filter((f): f is PrintedFilm => f !== null);

export type FilmOrder = {
  /** 'cart' adds it directly; 'product' opens the product page instead. */
  mode: 'cart' | 'product';
  url: string;
  /** Square feet being ordered, rounded UP. */
  sqFt: number;
  /** What this order costs at the film's list rate, in cents. Null if variable. */
  cents: number | null;
  label: string;
  /** The honest caveat, when there is one. Null on the cart path. */
  note: string | null;
};

/**
 * Where "order this film" should send the customer.
 *
 * Square footage rounds UP, for the reason the wall helper gives: WooCommerce
 * quantities are whole units, and a job short of film is a reprint while a
 * fraction of a foot over is pennies in the shop's favour.
 */
export function filmOrder(film: PrintedFilm, sqFt: number): FilmOrder | null {
  if (!Number.isFinite(sqFt) || sqFt <= 0) return null;
  const qty = Math.ceil(sqFt);
  const sellsBySquareFoot = film.unit === 'sqft' && typeof film.price === 'number';
  const cents = sellsBySquareFoot ? Math.round(film.price! * qty * 100) : null;

  if (sellsBySquareFoot) {
    return {
      mode: 'cart',
      url: `https://weprintwraps.com/cart/?add-to-cart=${film.wooProductId}&quantity=${qty}`,
      sqFt: qty,
      cents,
      label: `Add ${qty} sq ft`,
      note: null,
    };
  }

  // Priced per linear foot, per roll, or configured at checkout. Sending a
  // square-footage quantity would charge the wrong thing, so it does not get a
  // cart button at all.
  return {
    mode: 'product',
    url: film.permalink,
    sqFt: qty,
    cents: null,
    note: 'Priced on the product page — this film is not sold by the square foot.',
    label: 'Open product',
  };
}

/** `$312.00` */
export const money = (cents: number) => '$' + (cents / 100).toFixed(2);
