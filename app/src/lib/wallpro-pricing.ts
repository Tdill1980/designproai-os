// What a wall wrap costs, and which of the three things the customer is buying.
//
// Owner, 2026-09-13, on the WePrintWraps commercial model: "we will offer
// Wallpro as a pay to play product on wpw ... it will provide pricing for film
// using wpw's own pricing system. So again it's important that it shows the
// $3.25 a sq ft Wallwrap and we come from authority the customer is paying for
// the design that includes print ready files ... or they can pay for design and
// print or just print no design."
//
// WALLPRO HAD NO PRICING AT ALL. wallpro-print-plan's `wallBilling()` worked out
// the panels, the linear feet and the billed square footage to the WePrintWraps
// spec -- and then stopped, one multiplication short of a number the customer
// could act on. A quote tool that will not quote is not a selling page.
//
// THREE PATHS, because the customer arrives wanting different things:
//   design-and-print  the whole job: the design, its print-ready files, printed
//   design-only       the design and its print-ready files; they print elsewhere
//   print-only        they already have artwork; WePrintWraps prints it
//
// The design fee and the film are separate lines on purpose. The design is what
// DesignProAI is paid for and what the 24-hour human QC covers; the film is
// WePrintWraps' own published rate. Showing them apart is what lets the same
// page sell all three paths without three different quotes -- and it is what
// makes "the design includes print-ready files" a visible fact rather than a
// claim.

import type { WallBilling } from './wallpro-print-plan';

/**
 * WePrintWraps' published wall-wrap film rate, per square foot.
 *
 * Owner-stated and repeated: "$3.25 a sq ft Wallwrap". It is a named constant
 * rather than a literal in a component so that when the shop's rate moves it
 * moves in exactly one place -- and so a reader can find what the number is
 * without reading JSX. A per-shop override belongs here too once shops exist
 * (see the multi-tenant spine), which is why every function below takes the
 * rate as an argument and only defaults to this.
 */
export const WPW_WALL_FILM_RATE_PER_SQFT = 3.25;

/** The design fee, in cents — the existing wallpro_custom_file SKU. */
export const WALL_DESIGN_FEE_CENTS = 14900;

export type WallPurchasePath = 'design-and-print' | 'design-only' | 'print-only';

export const PURCHASE_PATH_LABEL: Record<WallPurchasePath, string> = {
  'design-and-print': 'Design + print',
  'design-only': 'Design only — print-ready files',
  'print-only': 'Print only — I have artwork',
};

export type WallQuoteLine = { label: string; detail: string; cents: number };
export type WallQuote = {
  path: WallPurchasePath;
  lines: WallQuoteLine[];
  totalCents: number;
  /**
   * The square footage the film is charged on, and WHY it is that number.
   *
   * Stated on the quote because it is the figure a customer queries. The
   * WePrintWraps spec sheet bills every panel at the full 54-inch roll width
   * "regardless of actual printed width", so a 142-inch wall is charged for
   * three 54-inch panels -- 162 inches of roll for 142 inches of wall. Quoting
   * off the wall's own area would understate the invoice and the difference
   * would surface after the customer had already agreed a price.
   */
  filmSqFt: number;
  filmBasis: string;
  ratePerSqFt: number;
};

const money = (cents: number) => '$' + (cents / 100).toFixed(2);

/**
 * The quote for one path, from the SAME geometry that plans the panels.
 *
 * `wallBilling()` is the single source: its panel count, panel length and
 * billed width are what the press works to, so the price and the print plan can
 * never disagree. A quote computed from the wall inches separately would agree
 * with the panel plan only by luck.
 */
export function wallQuote(
  path: WallPurchasePath,
  billing: WallBilling | null,
  options: { ratePerSqFt?: number; designFeeCents?: number } = {},
): WallQuote | null {
  const ratePerSqFt = options.ratePerSqFt ?? WPW_WALL_FILM_RATE_PER_SQFT;
  const designFeeCents = options.designFeeCents ?? WALL_DESIGN_FEE_CENTS;
  // Every path except design-only needs real geometry to price the film.
  if (!billing && path !== 'design-only') return null;

  const filmSqFt = billing ? billing.billedSqFt : 0;
  const filmCents = Math.round(filmSqFt * ratePerSqFt * 100);
  const filmBasis = billing
    ? `${billing.panels} ${billing.panels === 1 ? 'panel' : 'panels'} × ${billing.billedWidthIn}″ roll × ${billing.panelLengthIn}″ — every panel billed at the full roll width`
    : '';

  const lines: WallQuoteLine[] = [];
  if (path !== 'print-only') {
    lines.push({
      label: 'Wall design',
      // The deliverable, not the activity. This is the "authority" line: they
      // are buying files a press can use, checked by a person.
      detail: 'Custom design, print-ready files, human-checked before release',
      cents: designFeeCents,
    });
  }
  if (path !== 'design-only') {
    lines.push({
      label: 'Wall wrap film, printed',
      detail: `${filmSqFt} sq ft at ${money(Math.round(ratePerSqFt * 100))}/sq ft`,
      cents: filmCents,
    });
  }

  return {
    path,
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.cents, 0),
    filmSqFt,
    filmBasis,
    ratePerSqFt,
  };
}

/** `$358.31` */
export const formatMoney = money;

/**
 * WHO IS PAID, PER LINE.
 *
 * The owner's model is a split: "a split stripe Wallpro to Handel the design"
 * while the film is priced and fulfilled by WePrintWraps. So a quote is not one
 * payment — the design line and the film line have different payees, and the
 * page has to be able to say so.
 *
 * This states the intent in one place so the checkout that implements it cannot
 * quietly conflate them. It does NOT move money: the split itself is a Stripe
 * Connect decision (who is the connected account, who is liable for refunds,
 * who appears on the statement) and that belongs to the owner, not to a
 * constant in a file.
 */
export type WallPayee = 'designpro' | 'weprintwraps';
export function payeeForLine(label: string): WallPayee {
  return label === 'Wall design' ? 'designpro' : 'weprintwraps';
}
