/**
 * WHAT CUT GRAPHICS COST — one table, every surface that quotes them.
 *
 * Owner, 2026-09-16: "wire the entire set."
 *
 * These rates lived as a `const RATES` inside PricingEstimator.tsx, which was
 * fine while exactly one component quoted them. The moment a FAQ page states a
 * price, a literal in a component is a second source of truth, and the one that
 * goes stale is always the marketing copy — nobody re-reads an FAQ when a
 * material rate moves.
 *
 * So the table moves here and the estimator imports it. Same numbers, same
 * behaviour; what changes is that there is now one place to edit them.
 *
 * WHY THESE TWO MATERIALS. They are the rows seeded by
 * 20260911210000_graphicspro_cut_contour.sql into shop_pricing_config, which is
 * what the production pipeline actually prices a job against. A shop with its
 * own row overrides them per-shop at quote time; this table is the default
 * every shop starts from, which is exactly what an FAQ should be quoting.
 */

export type GraphicsMaterialKey = 'avery' | '3m';

export type GraphicsMaterial = {
  /** What the customer sees on the quote. */
  label: string;
  /** Dollars per square foot of cut vinyl. */
  rate: number;
  /** Why a shop picks this one. Never marketing — the actual difference. */
  note: string;
};

export const GRAPHICS_MATERIALS: Record<GraphicsMaterialKey, GraphicsMaterial> = {
  avery: {
    label: 'Avery Cut Contour',
    rate: 6.32,
    note: 'The default. Cast vinyl, cuts and weeds cleanly, the everyday choice for shop work.',
  },
  '3m': {
    label: '3M Cut Contour',
    rate: 6.92,
    note: 'Specified by name on fleet and franchise jobs where the brand standard names 3M.',
  },
};

/** Lamination, per square foot, on top of the material rate. */
export const GRAPHICS_LAMINATION_PER_SQFT = 1.5;

/** `$6.32` */
export const graphicsRate = (key: GraphicsMaterialKey) => GRAPHICS_MATERIALS[key].rate;
