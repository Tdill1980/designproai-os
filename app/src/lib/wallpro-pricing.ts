// What a wall wrap costs, and which of the things the customer is buying.
//
// LAUNCH PRICE LIST (owner, 2026-09-13, verbatim):
//
//   Ready-to-Print Design   $79
//   Describe a Design       $149
//   Match My Design         $149
//   Design for My Wall      $199
//   File Prep               $49
//   Print                   $3.50/sq ft
//
// THE LIST IS THE ENTRY PATHS, PRICED. That is not a coincidence and it is why
// this file is shaped the way it is: WallPro already routes every customer down
// one of five `designMode` paths, and the owner priced each one. So the design
// fee is NOT one constant -- it is a property of the path the customer took, and
// the page can quote it the moment they pick, before a pixel is generated.
//
//   library  Pick a design         $79   the catalog design, panelized to their wall
//   ai       Describe a design     $149  generated from their words
//   match    Match my design       $149  their reference recreated print-ready
//   wall     Design for my wall    $199  the designer reads their room photo
//   upload   Use my print-ready file $49 file prep only, no design
//
// $199 for `wall` is the most expensive because it is the most work: the
// consultant persona reads the room and writes the brief. $79 for the catalog is
// the cheapest because the design already exists. That ladder is the product
// telling the customer what they are paying for.
//
// PRINT IS PRICED BY THE SQUARE FOOT AND NOTHING ELSE. Owner, same message:
// "all printed wrap is priced by the sq ft only."
//
// The design fee and the film stay separate lines on purpose. The design is what
// DesignProAI is paid for and what the 24-hour human QC covers; the film is
// WePrintWraps' own rate. Showing them apart is what lets one page sell design
// alone, print alone, or both -- and it is what makes "the design includes
// print-ready files" a visible fact rather than a claim.

import type { WallBilling } from './wallpro-print-plan';

/**
 * WePrintWraps' wall-wrap film rate, per square foot.
 *
 * A named constant rather than a literal in JSX so the shop's rate moves in one
 * place, and so a reader can find what the number is without reading a
 * component. A per-shop override belongs here too once shops exist (the
 * multi-tenant spine), which is why every function below takes the rate as an
 * argument and only defaults to this.
 */
// THE LIVE RETAIL RATE, measured not assumed. Owner, 2026-09-14: the page
// "must be same price as current retail page". Product 70093's order history
// realizes exactly $3.25 per SQUARE foot, so that is the number every surface
// quotes. Raising it to $3.50 is a pricing decision that must change the Woo
// product first -- change both together or the page and the till disagree.
export const WPW_WALL_FILM_RATE_PER_SQFT = 3.25;

/**
 * The five ways in to a wall design — WallPro's own `designMode` values.
 *
 * Kept identical to the page's union rather than re-spelled, so a new entry path
 * cannot be added without deciding what it costs.
 */
export type WallDesignMode = 'library' | 'ai' | 'match' | 'wall' | 'upload';

/**
 * The Stripe product each path checks out as.
 *
 * These four strings are the gateway's own `WALLPRO_PURCHASE_PRODUCTS` keys and
 * the CHECK constraint on `wallpro_purchase_entitlements.product_type`. Naming
 * them here rather than choosing a SKU at the checkout call site is what keeps
 * the price the customer was quoted and the price Stripe charges the same
 * number: the gateway is the authority on the amount, this table is the
 * authority on which product a path buys, and a test asserts they agree.
 */
export type WallProSku =
  | 'wallpro_catalog_file' | 'wallpro_custom_file' | 'wallpro_room_design_file' | 'wallpro_file_prep';

export type WallDesignSku = {
  /** What the customer chose, in the owner's own words from the price list. */
  label: string;
  cents: number;
  /** What they get for it. The deliverable, never the activity. */
  detail: string;
  /** The gateway product this path checks out as. */
  sku: WallProSku;
};

/** The launch price list, exactly as the owner set it. */
export const WALL_DESIGN_SKUS: Record<WallDesignMode, WallDesignSku> = {
  library: {
    label: 'Ready-to-Print Design',
    cents: 7900,
    detail: 'A catalog design, scaled and panelized to your wall, print-ready files, human-checked before release',
    sku: 'wallpro_catalog_file',
  },
  ai: {
    label: 'Describe a Design',
    cents: 14900,
    detail: 'Designed from your description, print-ready files, human-checked before release',
    sku: 'wallpro_custom_file',
  },
  // Describe and Match are the same price and the same gateway product: both
  // are one custom design, arrived at from a sentence or from a picture.
  match: {
    label: 'Match My Design',
    cents: 14900,
    detail: 'Your design recreated at print resolution, print-ready files, human-checked before release',
    sku: 'wallpro_custom_file',
  },
  wall: {
    label: 'Design for My Wall',
    cents: 19900,
    detail: 'A designer reads your room and designs for it, print-ready files, human-checked before release',
    sku: 'wallpro_room_design_file',
  },
  upload: {
    label: 'File Prep',
    cents: 4900,
    detail: 'Your own artwork prepared for print: scaled, bled, panelized to the roll, human-checked before release',
    sku: 'wallpro_file_prep',
  },
};

/** The gateway product one entry path checks out as. */
export const wallProSkuFor = (mode: WallDesignMode): WallProSku => WALL_DESIGN_SKUS[mode].sku;

/** The design fee for one entry path, in cents. */
export const wallDesignFeeCents = (mode: WallDesignMode) => WALL_DESIGN_SKUS[mode].cents;

export type WallPurchasePath = 'design-and-print' | 'design-only' | 'print-only';

export const PURCHASE_PATH_LABEL: Record<WallPurchasePath, string> = {
  'design-and-print': 'Design + print',
  'design-only': 'Design only — print-ready files',
  'print-only': 'Print only — I have artwork',
};

export type WallQuoteLine = { label: string; detail: string; cents: number };
export type WallQuote = {
  path: WallPurchasePath;
  designMode: WallDesignMode;
  lines: WallQuoteLine[];
  totalCents: number;
  /**
   * The square footage the film is charged on: the WALL'S OWN AREA.
   *
   * Owner, 2026-09-13: "all printed wrap is priced by the sq ft only." Stated on
   * the quote anyway, because a number a customer can reproduce with a tape
   * measure is the one they trust. The roll-width overhead the panel plan
   * carries is the shop's to absorb, not a line on the customer's invoice.
   */
  filmSqFt: number;
  filmBasis: string;
  ratePerSqFt: number;
};

const money = (cents: number) => '$' + (cents / 100).toFixed(2);

/**
 * The quote for one path, from the SAME geometry that plans the panels.
 *
 * `wallBilling()` is the single source: its panel count and panel length are
 * what the press works to, so the price and the print plan can never disagree. A
 * quote computed from the wall inches separately would agree only by luck.
 */
export function wallQuote(
  input: { path: WallPurchasePath; designMode: WallDesignMode; billing: WallBilling | null },
  options: { ratePerSqFt?: number; designFeeCents?: number } = {},
): WallQuote | null {
  const { path, designMode, billing } = input;
  const ratePerSqFt = options.ratePerSqFt ?? WPW_WALL_FILM_RATE_PER_SQFT;
  const designFeeCents = options.designFeeCents ?? wallDesignFeeCents(designMode);
  // Every path except design-only needs real geometry to price the film.
  if (!billing && path !== 'design-only') return null;

  // SQUARE FEET, AND NOTHING ELSE. Owner, 2026-09-13: "all printed wrap is
  // priced by the sq ft only."
  //
  // This corrects what I built first. wallBilling() also computes a BILLED
  // footage -- every panel charged at the full 54" roll regardless of printed
  // width, which is how the spec sheet describes the press billing internally.
  // I priced the customer off that, which on a 142 x 96 wall would have charged
  // 110.25 sq ft for a 94.67 sq ft wall: roll overhead passed through as if it
  // were coverage. It is not how the shop prices printed wrap, and it is not
  // what a customer can check with a tape measure. The wall's own area is both.
  const filmSqFt = billing ? billing.wallSqFt : 0;
  const filmCents = Math.round(filmSqFt * ratePerSqFt * 100);
  const filmBasis = billing
    ? `${billing.wallSqFt} sq ft of wall — printed wrap is priced by the square foot`
    : '';

  const sku = WALL_DESIGN_SKUS[designMode];
  const lines: WallQuoteLine[] = [];
  if (path !== 'print-only') {
    lines.push({ label: sku.label, detail: sku.detail, cents: designFeeCents });
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
    designMode,
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.cents, 0),
    filmSqFt,
    filmBasis,
    ratePerSqFt,
  };
}

/** `$331.35` */
export const formatMoney = money;

/**
 * WHO IS PAID, PER LINE.
 *
 * The owner's model is a split: "a split stripe Wallpro to Handel the design"
 * while the film is priced and fulfilled by WePrintWraps. So a quote is not one
 * payment — the design line and the film line have different payees, and the
 * page has to be able to say so.
 *
 * Keyed on the line's SKU label rather than on a string literal, so adding a
 * sixth design path cannot silently route its money to the printer.
 *
 * This states the intent in one place so the checkout that implements it cannot
 * quietly conflate them. It does NOT move money: the split itself is a Stripe
 * Connect decision (who is the connected account, who is liable for refunds, who
 * appears on the statement) and that belongs to the owner, not to a constant in
 * a file.
 */
export type WallPayee = 'designpro' | 'weprintwraps';
const DESIGN_LABELS = new Set(Object.values(WALL_DESIGN_SKUS).map(s => s.label));
export function payeeForLine(label: string): WallPayee {
  return DESIGN_LABELS.has(label) ? 'designpro' : 'weprintwraps';
}
