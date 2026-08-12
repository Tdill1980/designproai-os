/**
 * Shop service price defaults — Phase 8a.
 *
 * Catalog of every shop-side service the QuickQuote estimator can
 * line-item. Each entry is the BASELINE the shop sees as a starting
 * point on /admin/shop-pricing. Until the shop opts in (clicks
 * "Use catalog default" or types their own price), the row doesn't
 * exist in `shop_service_prices` and the estimator falls back to the
 * default below.
 *
 * Service keys mirror precision_modifications.key for the visual-edit
 * upsells (chrome_delete, carbon_fiber_roof, ...) so the precision-mod
 * buttons can join shop pricing → modification by the same key. Color
 * change finishes use the parallel `color_change_<finish>` form;
 * tint uses `tint_per_window` / `tint_full_set`.
 *
 * Categories drive the section grouping on /admin/shop-pricing.
 */

export type ServiceCategory = "color_change" | "tint" | "upsell";

export type ServiceUnit =
  | "each"
  | "yard"
  | "sqft"
  | "linear_foot"
  | "hour"
  | "window";

export interface ServiceDefault {
  service_key: string;
  label: string;
  description?: string;
  category: ServiceCategory;
  default_price: number;
  default_unit: ServiceUnit;
}

export const SERVICE_DEFAULTS: ServiceDefault[] = [
  // ── Color change vinyl (per yard, by finish) ─────────────────────
  {
    service_key: "color_change_gloss",
    label: "Color Change — Gloss",
    description: "Solid-color gloss vinyl, 60\" roll",
    category: "color_change",
    default_price: 28,
    default_unit: "yard",
  },
  {
    service_key: "color_change_satin",
    label: "Color Change — Satin",
    description: "Satin finish vinyl",
    category: "color_change",
    default_price: 30,
    default_unit: "yard",
  },
  {
    service_key: "color_change_matte",
    label: "Color Change — Matte",
    description: "Matte finish vinyl",
    category: "color_change",
    default_price: 30,
    default_unit: "yard",
  },
  {
    service_key: "color_change_metallic",
    label: "Color Change — Metallic",
    description: "Metallic finish vinyl",
    category: "color_change",
    default_price: 38,
    default_unit: "yard",
  },
  {
    service_key: "color_change_brushed",
    label: "Color Change — Brushed",
    description: "Brushed metal finish vinyl",
    category: "color_change",
    default_price: 35,
    default_unit: "yard",
  },
  {
    service_key: "color_change_carbon",
    label: "Color Change — Carbon Fiber",
    description: "Carbon fiber pattern vinyl",
    category: "color_change",
    default_price: 32,
    default_unit: "yard",
  },
  {
    service_key: "color_change_textured",
    label: "Color Change — Textured",
    description: "Textured finish vinyl",
    category: "color_change",
    default_price: 34,
    default_unit: "yard",
  },
  {
    service_key: "color_change_color_flip",
    label: "Color Change — Color Flip",
    description: "Color-flip / chameleon vinyl",
    category: "color_change",
    default_price: 55,
    default_unit: "yard",
  },
  {
    service_key: "color_change_chrome",
    label: "Color Change — Chrome",
    description: "Chrome finish vinyl",
    category: "color_change",
    default_price: 65,
    default_unit: "yard",
  },

  // ── Window tint ──────────────────────────────────────────────────
  {
    service_key: "tint_per_window",
    label: "Window Tint — per window",
    description: "Single-window tint install",
    category: "tint",
    default_price: 45,
    default_unit: "window",
  },
  {
    service_key: "tint_full_set",
    label: "Window Tint — full set",
    description: "Whole-vehicle tint (excludes windshield)",
    category: "tint",
    default_price: 250,
    default_unit: "each",
  },

  // ── Upsells / shop services ──────────────────────────────────────
  // Keys match precision_modifications.key so the precision-mod
  // buttons can join shop pricing by service_key.
  {
    service_key: "chrome_delete",
    label: "Chrome Delete",
    description: "Blackout all chrome trim",
    category: "upsell",
    default_price: 300,
    default_unit: "each",
  },
  {
    service_key: "carbon_fiber_roof",
    label: "Carbon Fiber Roof",
    description: "Glossy black carbon weave roof panel",
    category: "upsell",
    default_price: 400,
    default_unit: "each",
  },
  {
    service_key: "carbon_fiber_hood",
    label: "Carbon Fiber Hood",
    description: "Glossy black carbon weave hood",
    category: "upsell",
    default_price: 350,
    default_unit: "each",
  },
  {
    service_key: "racing_stripe_black",
    label: "Black Racing Stripe",
    description: "Twin glossy black stripes down center",
    category: "upsell",
    default_price: 200,
    default_unit: "each",
  },
  {
    service_key: "roof_wrap_black",
    label: "Roof Wrap (Black)",
    description: "Solid satin black roof panel",
    category: "upsell",
    default_price: 350,
    default_unit: "each",
  },
  {
    service_key: "ppf_full_front",
    label: "PPF Clear Bra (Front)",
    description: "Hood + bumper + fenders + mirror caps",
    category: "upsell",
    default_price: 1800,
    default_unit: "each",
  },
  {
    service_key: "ppf_hood",
    label: "PPF Hood Only",
    description: "Clear bra protection on the hood only",
    category: "upsell",
    default_price: 450,
    default_unit: "each",
  },
  {
    service_key: "window_tint_dark",
    label: "Window Tint (20% VLT)",
    description: "Dark tint on side + rear windows",
    category: "upsell",
    default_price: 250,
    default_unit: "each",
  },
  {
    service_key: "accent_wrap",
    label: "Accent Wrap",
    description: "Mirror caps, spoiler, pillars",
    category: "upsell",
    default_price: 250,
    default_unit: "each",
  },
  {
    service_key: "partial_wrap",
    label: "Partial Wrap",
    description: "Hood, fenders, or custom coverage",
    category: "upsell",
    default_price: 800,
    default_unit: "each",
  },
  {
    service_key: "commercial_lettering",
    label: "Commercial Lettering",
    description: "Business name + DOT numbers + logos",
    category: "upsell",
    default_price: 500,
    default_unit: "each",
  },
];

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  color_change: "Color change vinyl",
  tint: "Window tint",
  upsell: "Upsells & shop services",
};

export const SERVICE_CATEGORY_DESCRIPTIONS: Record<ServiceCategory, string> = {
  color_change: "Per-yard pricing for solid color-change vinyl by finish.",
  tint: "Per-window or full-set tint pricing.",
  upsell:
    "Shop services that stack on top of a base wrap — chrome delete, carbon fiber accents, racing stripes, PPF, etc.",
};

export const SERVICE_UNIT_LABELS: Record<ServiceUnit, string> = {
  each: "each",
  yard: "yard",
  sqft: "sq ft",
  linear_foot: "linear ft",
  hour: "hour",
  window: "window",
};

export function findServiceDefault(key: string): ServiceDefault | undefined {
  return SERVICE_DEFAULTS.find((d) => d.service_key === key);
}
