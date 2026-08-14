/**
 * WPW (WePrintWraps) product catalog — WooCommerce product IDs + pricing.
 *
 * WPW is the wholesale print partner that powers PrintPro.
 * - WPW internal team sees "WPW" branding
 * - All other shops see "PrintPro" branding
 *
 * Each entry maps to a real WooCommerce product on weprintwraps.com
 */

export interface WpwSeedProduct {
  name: string;
  description: string;
  woo_product_id: number;
  woo_product_url: string;
  price: number;
  cost: number;
  price_unit: "each" | "sqft" | "yard" | "linear_foot" | "roll";
  category: string;
  sort_order: number;
  metadata: Record<string, unknown>;
}

export const WPW_PRODUCT_CATEGORIES = [
  { id: "print_film", label: "Printed Wrap Film" },
  { id: "contour_cut", label: "Contour-Cut Vinyl" },
  { id: "fade_wrap", label: "Pre-Designed Fade Wraps" },
  { id: "design_service", label: "Design Services" },
  { id: "accessories", label: "Accessories & Sample Books" },
  { id: "wbty", label: "Wrap By The Yard" },
  { id: "production_pack", label: "Production Packs" },
  { id: "window_vinyl", label: "Window Vinyl" },
] as const;

export const WPW_SEED_PRODUCTS: WpwSeedProduct[] = [
  // ── Printed Wrap Film ─────────────────────────────────
  {
    name: "Printed Wrap Film with UV Lamination (Avery Brand Film)",
    description: "Avery 1105EZRS with DOL1360Z lamination. Printed, laminated, paneled and ready to install.",
    woo_product_id: 79,
    woo_product_url: "https://weprintwraps.com/our-products/avery-1105egrs-with-doz13607-lamination/",
    price: 5.27,
    cost: 0,
    price_unit: "sqft",
    category: "print_film",
    sort_order: 1,
    metadata: { film_brand: "Avery Dennison", lamination: "UV", turnaround: "1-2 business days" },
  },
  {
    name: "3M IJ180 Printed Wrap Film | Wholesale Vehicle Wraps",
    description: "3M IJ180 printed wrap film. Professional grade, paneled and ready to install.",
    woo_product_id: 72,
    woo_product_url: "https://weprintwraps.com/our-products/3m-ij180-printed-wrap-film/",
    price: 5.27,
    cost: 0,
    price_unit: "sqft",
    category: "print_film",
    sort_order: 2,
    metadata: { film_brand: "3M", series: "IJ180", turnaround: "1-2 business days" },
  },

  // ── Contour-Cut Vinyl ─────────────────────────────────
  {
    name: "3M IJ180 Contour-Cut Wrap Film – Weeded & Masked, Install-Ready",
    description: "3M IJ180 contour-cut vinyl graphics. Weeded, masked, and ready to install.",
    woo_product_id: 19420,
    woo_product_url: "https://weprintwraps.com/our-products/3m-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/",
    price: 6.92,
    cost: 0,
    price_unit: "sqft",
    category: "contour_cut",
    sort_order: 10,
    metadata: { film_brand: "3M", max_width: "54in", max_artwork: "50in" },
  },
  {
    name: "Avery Contour-Cut Wrap Film – Weeded & Masked, Install-Ready",
    description: "Avery contour-cut vinyl graphics. Weeded, masked, and ready to install.",
    woo_product_id: 108,
    woo_product_url: "https://weprintwraps.com/our-products/avery-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/",
    price: 6.32,
    cost: 0,
    price_unit: "sqft",
    category: "contour_cut",
    sort_order: 11,
    metadata: { film_brand: "Avery Dennison", max_width: "54in", max_artwork: "50in" },
  },

  // ── Fade Wraps ────────────────────────────────────────
  {
    name: "Custom Fade Wrap Printing | Avery Film",
    description: "Custom pre-designed fade wraps on Avery film. Starting at $600 for 2 sides.",
    woo_product_id: 58391,
    woo_product_url: "https://weprintwraps.com/our-products/pre-designed-fade-wraps/",
    price: 600,
    cost: 0,
    price_unit: "each",
    category: "fade_wrap",
    sort_order: 20,
    metadata: { starting_price: true, sides: 2, film_brand: "Avery Dennison" },
  },

  // ── Design Services ───────────────────────────────────
  {
    name: "Custom Vehicle Wrap Design",
    description: "Full custom vehicle wrap design service.",
    woo_product_id: 234,
    woo_product_url: "https://weprintwraps.com/our-products/custom-wrap-design/",
    price: 500,
    cost: 0,
    price_unit: "each",
    category: "design_service",
    sort_order: 30,
    metadata: {},
  },
  {
    name: "Design Setup / File Output",
    description: "Design setup and file output service.",
    woo_product_id: 58160,
    woo_product_url: "https://weprintwraps.com/our-products/design-setupfile-output/",
    price: 500,
    cost: 0,
    price_unit: "each",
    category: "design_service",
    sort_order: 31,
    metadata: { draft: true },
  },

  // ── Window Vinyl ──────────────────────────────────────
  {
    name: "Perforated Window Vinyl 50/50 Unlaminated 54\" Roll",
    description: "Perforated see-through window vinyl. Max print 53.5\". Unlaminated.",
    woo_product_id: 80,
    woo_product_url: "https://weprintwraps.com/our-products/perforated-window-vinyl-5050-unlaminated/",
    price: 5.95,
    cost: 0,
    price_unit: "sqft",
    category: "window_vinyl",
    sort_order: 40,
    metadata: { roll_width: "54in", max_print: "53.5in", type: "50/50 perforated" },
  },

  // ── Accessories & Sample Books ────────────────────────
  {
    name: "Pantone Color Chart 30\" x 52\"",
    description: "Full Pantone color chart for color matching. 30\" x 52\".",
    woo_product_id: 15192,
    woo_product_url: "https://weprintwraps.com/our-products/pantone-color-chart-30-x-52/",
    price: 42,
    cost: 0,
    price_unit: "each",
    category: "accessories",
    sort_order: 50,
    metadata: { dimensions: "30x52in" },
  },
  {
    name: "Camo & Carbon Sample Book",
    description: "Physical swatch book for Camo & Carbon wrap patterns.",
    woo_product_id: 475,
    woo_product_url: "https://weprintwraps.com/our-products/camo-carbon-wrap-by-the-yard/",
    price: 26.50,
    cost: 0,
    price_unit: "each",
    category: "accessories",
    sort_order: 51,
    metadata: { collection: "Camo & Carbon" },
  },
  {
    name: "Marble & Metals Swatch Book",
    description: "Physical swatch book for Marble & Metals wrap patterns.",
    woo_product_id: 39628,
    woo_product_url: "https://weprintwraps.com/our-products/wrap-by-the-yard-metal-marble/",
    price: 26.50,
    cost: 0,
    price_unit: "each",
    category: "accessories",
    sort_order: 52,
    metadata: { collection: "Metal & Marble" },
  },
  {
    name: "Wicked & Wild Swatch Book",
    description: "Physical swatch book for Wicked & Wild wrap patterns.",
    woo_product_id: 4179,
    woo_product_url: "https://weprintwraps.com/our-products/wrap-by-the-yard-wicked-wild-wrap-prints/",
    price: 26.50,
    cost: 0,
    price_unit: "each",
    category: "accessories",
    sort_order: 53,
    metadata: { collection: "Wicked & Wild" },
  },

  // ── Wrap By The Yard ──────────────────────────────────
  {
    name: "Wrap By The Yard — Camo & Carbon",
    description: "Pre-designed Camo & Carbon pattern wrap. Sold by the yard.",
    woo_product_id: 1726,
    woo_product_url: "https://weprintwraps.com/our-products/camo-carbon-wrap-by-the-yard/",
    price: 95.50,
    cost: 0,
    price_unit: "yard",
    category: "wbty",
    sort_order: 60,
    metadata: { collection: "Camo & Carbon" },
  },
  {
    name: "Wrap By The Yard — Metal & Marble",
    description: "Pre-designed Metal & Marble pattern wrap. Sold by the yard.",
    woo_product_id: 39698,
    woo_product_url: "https://weprintwraps.com/our-products/wrap-by-the-yard-metal-marble/",
    price: 95.50,
    cost: 0,
    price_unit: "yard",
    category: "wbty",
    sort_order: 61,
    metadata: { collection: "Metal & Marble" },
  },
  {
    name: "Wrap By The Yard — Wicked & Wild",
    description: "Pre-designed Wicked & Wild pattern wrap. Sold by the yard.",
    woo_product_id: 4179,
    woo_product_url: "https://weprintwraps.com/our-products/wrap-by-the-yard-wicked-wild-wrap-prints/",
    price: 95.50,
    cost: 0,
    price_unit: "yard",
    category: "wbty",
    sort_order: 62,
    metadata: { collection: "Wicked & Wild" },
  },
  {
    name: "Wrap By The Yard — Bape Camo",
    description: "Pre-designed Bape Camo pattern wrap. Sold by the yard.",
    woo_product_id: 42809,
    woo_product_url: "https://weprintwraps.com/our-products/wrap-by-the-yard-bape-camo/",
    price: 95.50,
    cost: 0,
    price_unit: "yard",
    category: "wbty",
    sort_order: 63,
    metadata: { collection: "Bape Camo" },
  },
  {
    name: "Wrap By The Yard — Modern & Trippy",
    description: "Pre-designed Modern & Trippy pattern wrap. Sold by the yard.",
    woo_product_id: 52489,
    woo_product_url: "https://weprintwraps.com/our-products/wrap-by-the-yard-modern-trippy/",
    price: 95.50,
    cost: 0,
    price_unit: "yard",
    category: "wbty",
    sort_order: 64,
    metadata: { collection: "Modern & Trippy" },
  },

  // ── DesignPanelPro Production Packs ───────────────────
  {
    name: "DesignPanelPro\u2122 \u2013 Small Print Production Pack",
    description: "Small print production pack for DesignPanelPro designs.",
    woo_product_id: 69664,
    woo_product_url: "https://weprintwraps.com/",
    price: 0,
    cost: 0,
    price_unit: "each",
    category: "production_pack",
    sort_order: 80,
    metadata: { size: "small" },
  },
  {
    name: "DesignPanelPro\u2122 \u2013 Medium Print Production Pack",
    description: "Medium print production pack for DesignPanelPro designs.",
    woo_product_id: 69671,
    woo_product_url: "https://weprintwraps.com/",
    price: 0,
    cost: 0,
    price_unit: "each",
    category: "production_pack",
    sort_order: 81,
    metadata: { size: "medium" },
  },
  {
    name: "DesignPanelPro\u2122 \u2013 Large Print Production Pack",
    description: "Large print production pack for DesignPanelPro designs.",
    woo_product_id: 69680,
    woo_product_url: "https://weprintwraps.com/",
    price: 0,
    cost: 0,
    price_unit: "each",
    category: "production_pack",
    sort_order: 82,
    metadata: { size: "large" },
  },
  {
    name: "DesignPanelPro\u2122 \u2013 XLarge Print Production Pack",
    description: "XLarge print production pack for DesignPanelPro designs.",
    woo_product_id: 69686,
    woo_product_url: "https://weprintwraps.com/",
    price: 0,
    cost: 0,
    price_unit: "each",
    category: "production_pack",
    sort_order: 83,
    metadata: { size: "xlarge" },
  },
];
