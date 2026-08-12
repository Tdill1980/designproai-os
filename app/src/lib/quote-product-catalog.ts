/**
 * QuickQuote Product Catalog
 *
 * Powers the dashboard QuickQuote tool. The UI exposes THREE explicit
 * product-source dropdowns (not one mashed-together category picker):
 *
 *   • WePrintWraps.com  — direct WePrintWraps.com catalog pricing for
 *                          existing WPW customers. Film only — no
 *                          design or output-file surcharge is applied
 *                          here; design renders come from the
 *                          RestylePro tier bundle. Only shown to WPW
 *                          tenants (internal team + weprintwraps.com
 *                          customers).
 *   • Color Change      — solid-color change vinyl priced per linear
 *                          yard, finish-based. Visible to every tenant.
 *   • PrintPro          — the full weprintwraps.com catalog mirrored
 *                          into RestylePro. Design / output files are
 *                          INCLUDED with the tier (Starter 20 / Advanced
 *                          50 / Complete 200 renders per month).
 *                          Visible to every tenant.
 *
 * Non-WPW tenants see PrintPro + Color Change dropdowns and the
 * existing "Add Custom Line" button (Removal, Design, PPF, …) so they
 * can add arbitrary custom products. The categories below (avery,
 * threeM, wallpro) remain as data for back-compat and for the existing
 * `printpro` mirror but no longer surface as standalone dropdowns.
 */
import { FILM_COST_PER_YARD, WALL_FILM } from "@/lib/quick-quote";

export type QuoteCategory =
  | "avery"
  | "threeM"
  | "color_change"
  | "printpro"
  | "wallpro"
  | "services"
  | "wpw_design"
  | "rp_design";
export type PriceUnit = "yard" | "sqft" | "each" | "linear_foot" | "hour" | "window";

export interface QuoteProduct {
  id: string;
  name: string;
  /** Optional secondary line shown below the product name */
  subName?: string;
  category: QuoteCategory;
  /** Default price in USD per unit (0 = contact-for-pricing / variable) */
  price: number;
  unit: PriceUnit;
  /** WePrintWraps WooCommerce product id when this mirrors a WPW SKU */
  wooProductId?: number;
  wooProductUrl?: string;
  /**
   * When true, the product stays in the catalog (so findProductById and
   * already-saved quotes keep resolving it) but is filtered out of the
   * QuickQuote product pickers. Used to temporarily pull products that
   * depend on an unfinished pipeline (e.g. DesignPro production packs)
   * without deleting their data. Flip back to false to relist.
   */
  hidden?: boolean;
}

export interface QuoteCategoryMeta {
  id: QuoteCategory;
  label: string;
  short: string;
  description: string;
}

export const QUOTE_CATEGORIES: QuoteCategoryMeta[] = [
  {
    id: "avery",
    label: "Printed Wrap — Avery",
    short: "Avery Printed",
    description: "Avery Dennison printed wrap film, UV laminated",
  },
  {
    id: "threeM",
    label: "Printed Wrap — 3M",
    short: "3M Printed",
    description: "3M IJ180 premium printed wrap film",
  },
  {
    id: "color_change",
    label: "Color Change",
    short: "Color Change",
    description: "Solid-color change vinyl, priced per linear yard",
  },
  {
    id: "printpro",
    label: "PrintPro Catalog",
    short: "PrintPro",
    description: "Full weprintwraps.com catalog with live pricing",
  },
  {
    id: "wallpro",
    label: "WallPro — Wall Wrap Printing",
    short: "WallPro",
    description:
      "Avery HP MPI 2610 wall film — $3.25/lf, 54\" panels, install-ready",
  },
  {
    id: "services",
    label: "BookingPro — Install Services",
    short: "Services",
    description: "Bookable install jobs — quote + schedule in one step",
  },
  {
    id: "wpw_design",
    label: "WPW Design Products",
    short: "WPW Design",
    description: "WePrintWraps a-la-carte design SKUs the shop can resell",
  },
  {
    id: "rp_design",
    label: "RestylePro Design Products",
    short: "RP Design",
    description:
      "Design services bundled with the shop's RestylePro subscription — resell with markup",
  },
];

// ── Avery printed wrap products (mirrors weprintwraps.com) ─────────
export const AVERY_PRODUCTS: QuoteProduct[] = [
  {
    id: "avery-1105-uv",
    name: "Avery 1105 EZRS + UV Lam",
    subName: "Printed + laminated, install-ready",
    category: "avery",
    price: 5.27,
    unit: "sqft",
    wooProductId: 79,
    wooProductUrl:
      "https://weprintwraps.com/our-products/avery-1105egrs-with-doz13607-lamination/",
  },
  {
    id: "avery-contour",
    name: "Avery Contour-Cut",
    subName: "Weeded & masked, install-ready",
    category: "avery",
    price: 6.32,
    unit: "sqft",
    wooProductId: 108,
    wooProductUrl:
      "https://weprintwraps.com/our-products/avery-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/",
  },
  {
    id: "avery-fade",
    name: "Avery Custom Fade Wrap",
    subName: "Pre-designed fade, 2 sides",
    category: "avery",
    price: 600,
    unit: "each",
    wooProductId: 58391,
    wooProductUrl:
      "https://weprintwraps.com/our-products/pre-designed-fade-wraps/",
  },
];

// ── 3M printed wrap products (mirrors weprintwraps.com) ────────────
export const THREEM_PRODUCTS: QuoteProduct[] = [
  {
    id: "3m-ij180-printed",
    name: "3M IJ180 Printed",
    subName: "Premium printed wrap film",
    category: "threeM",
    price: 5.27,
    unit: "sqft",
    wooProductId: 72,
    wooProductUrl:
      "https://weprintwraps.com/our-products/3m-ij180-printed-wrap-film/",
  },
  {
    id: "3m-ij180-contour",
    name: "3M IJ180 Contour-Cut",
    subName: "Weeded & masked, install-ready",
    category: "threeM",
    price: 6.92,
    unit: "sqft",
    wooProductId: 19420,
    wooProductUrl:
      "https://weprintwraps.com/our-products/3m-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/",
  },
];

// ── Color change products (priced per linear yard, by finish) ──────
const FINISH_DEFS: { id: string; label: string; finishKey: string }[] = [
  { id: "cc-gloss", label: "Gloss", finishKey: "gloss" },
  { id: "cc-satin", label: "Satin", finishKey: "satin" },
  { id: "cc-matte", label: "Matte", finishKey: "matte" },
  { id: "cc-metallic", label: "Metallic", finishKey: "metallic" },
  { id: "cc-brushed", label: "Brushed", finishKey: "brushed" },
  { id: "cc-carbon", label: "Carbon Fiber", finishKey: "carbon" },
  { id: "cc-textured", label: "Textured", finishKey: "textured" },
  { id: "cc-color-flip", label: "Color Flip", finishKey: "color_flip" },
  { id: "cc-chrome", label: "Chrome", finishKey: "chrome" },
];

export const COLOR_CHANGE_PRODUCTS: QuoteProduct[] = FINISH_DEFS.map((f) => ({
  id: f.id,
  name: `Color Change — ${f.label}`,
  subName: `${f.label} finish`,
  category: "color_change",
  price: FILM_COST_PER_YARD[f.finishKey] ?? FILM_COST_PER_YARD.gloss,
  unit: "yard",
}));

// ── PrintPro catalog (mirrors weprintwraps.com 1:1) ────────────────
// Source of truth: src/pages/PrintProShop.tsx
export const PRINTPRO_PRODUCTS: QuoteProduct[] = [
  // Print films
  {
    id: "pp-avery-1105",
    name: "Avery 1105 EZRS + UV Lam",
    subName: "Printed wrap film",
    category: "printpro",
    price: 5.27,
    unit: "sqft",
    wooProductId: 79,
    wooProductUrl:
      "https://weprintwraps.com/our-products/avery-1105egrs-with-doz13607-lamination/",
  },
  {
    id: "pp-3m-ij180",
    name: "3M IJ180 Printed",
    subName: "Premium printed wrap film",
    category: "printpro",
    price: 5.27,
    unit: "sqft",
    wooProductId: 72,
    wooProductUrl:
      "https://weprintwraps.com/our-products/3m-ij180-printed-wrap-film/",
  },
  // Contour cut
  {
    id: "pp-avery-contour",
    name: "Avery Contour-Cut",
    subName: "Weeded & masked",
    category: "printpro",
    price: 6.32,
    unit: "sqft",
    wooProductId: 108,
    wooProductUrl:
      "https://weprintwraps.com/our-products/avery-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/",
  },
  {
    id: "pp-3m-contour",
    name: "3M IJ180 Contour-Cut",
    subName: "Weeded & masked",
    category: "printpro",
    price: 6.92,
    unit: "sqft",
    wooProductId: 19420,
    wooProductUrl:
      "https://weprintwraps.com/our-products/3m-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/",
  },
  // Specialty — FadeWrap kits (mirrors FadeWraps tool pricing tiers)
  {
    id: "pp-fadewrap-small",
    name: "FadeWrap Kit — Small",
    subName: "Compact cars · 2 sides · custom fade design",
    category: "printpro",
    price: 600,
    unit: "each",
    wooProductId: 58391,
    wooProductUrl:
      "https://weprintwraps.com/our-products/pre-designed-fade-wraps/",
  },
  {
    id: "pp-fadewrap-medium",
    name: "FadeWrap Kit — Medium",
    subName: "Sedans, mid-size SUVs · 2 sides",
    category: "printpro",
    price: 710,
    unit: "each",
    wooProductId: 58391,
    wooProductUrl:
      "https://weprintwraps.com/our-products/pre-designed-fade-wraps/",
  },
  {
    id: "pp-fadewrap-large",
    name: "FadeWrap Kit — Large",
    subName: "Trucks, full-size SUVs · 2 sides",
    category: "printpro",
    price: 825,
    unit: "each",
    wooProductId: 58391,
    wooProductUrl:
      "https://weprintwraps.com/our-products/pre-designed-fade-wraps/",
  },
  {
    id: "pp-fadewrap-xl",
    name: "FadeWrap Kit — XL",
    subName: "Vans, sprinters, box trucks · 2 sides",
    category: "printpro",
    price: 990,
    unit: "each",
    wooProductId: 58391,
    wooProductUrl:
      "https://weprintwraps.com/our-products/pre-designed-fade-wraps/",
  },
  {
    id: "pp-fadewrap-hood",
    name: "FadeWrap Add-on — Hood",
    subName: "Hood panel add-on for FadeWrap kit",
    category: "printpro",
    price: 160,
    unit: "each",
    wooProductId: 58391,
    wooProductUrl:
      "https://weprintwraps.com/our-products/pre-designed-fade-wraps/",
  },
  {
    id: "pp-fadewrap-front-bumper",
    name: "FadeWrap Add-on — Front Bumper",
    subName: "Front bumper panel add-on",
    category: "printpro",
    price: 200,
    unit: "each",
    wooProductId: 58391,
    wooProductUrl:
      "https://weprintwraps.com/our-products/pre-designed-fade-wraps/",
  },
  {
    id: "pp-fadewrap-rear-bumper",
    name: "FadeWrap Add-on — Rear Bumper",
    subName: "Rear bumper panel add-on",
    category: "printpro",
    price: 395,
    unit: "each",
    wooProductId: 58391,
    wooProductUrl:
      "https://weprintwraps.com/our-products/pre-designed-fade-wraps/",
  },
  {
    id: "pp-fadewrap-roof",
    name: "FadeWrap Add-on — Roof",
    subName: "Roof panel — small/medium/large sized to vehicle",
    category: "printpro",
    price: 225,
    unit: "each",
    wooProductId: 58391,
    wooProductUrl:
      "https://weprintwraps.com/our-products/pre-designed-fade-wraps/",
  },
  {
    id: "pp-perf-window",
    name: "Perforated Window Vinyl",
    subName: "50/50 see-through, unlaminated 54\" roll",
    category: "printpro",
    price: 5.95,
    unit: "sqft",
    wooProductId: 80,
    wooProductUrl:
      "https://weprintwraps.com/our-products/perforated-window-vinyl-5050-unlaminated/",
  },
  // Custom design service — variable price on WPW; $500 is the store base.
  {
    id: "pp-custom-design",
    name: "Custom Vehicle Wrap Design",
    subName: "Professional designer · variable, $500 base",
    category: "printpro",
    price: 500,
    unit: "each",
    wooProductId: 234,
    wooProductUrl: "https://weprintwraps.com/our-products/custom-wrap-design/",
  },
  // DesignPanelPro Print Production Packs — flat WPW price (matches live store).
  // HIDDEN from the QuickQuote pickers until the DesignPro output pipeline
  // ships. Data kept so saved quotes + cart links still resolve.
  {
    id: "pp-dp-small",
    name: "DesignPanelPro — Small Print Pack",
    subName: "Compact cars",
    category: "printpro",
    price: 119.99,
    unit: "each",
    hidden: true,
    wooProductId: 69664,
    wooProductUrl:
      "https://weprintwraps.com/our-products/designpanelpro-small-print-production-pack/",
  },
  {
    id: "pp-dp-medium",
    name: "DesignPanelPro — Medium Print Pack",
    subName: "Sedans, mid-size SUVs",
    category: "printpro",
    price: 119,
    unit: "each",
    hidden: true,
    wooProductId: 69671,
    wooProductUrl:
      "https://weprintwraps.com/our-products/designpanelpro-medium-print-production-pack/",
  },
  {
    id: "pp-dp-large",
    name: "DesignPanelPro — Large Print Pack",
    subName: "Trucks, full-size SUVs",
    category: "printpro",
    price: 119,
    unit: "each",
    hidden: true,
    wooProductId: 69680,
    wooProductUrl:
      "https://weprintwraps.com/our-products/designpanelpro-large-print-production-pack/",
  },
  {
    id: "pp-dp-xlarge",
    name: "DesignPanelPro — XLarge Print Pack",
    subName: "Vans, sprinters, box trucks",
    category: "printpro",
    price: 119,
    unit: "each",
    hidden: true,
    wooProductId: 69686,
    wooProductUrl:
      "https://weprintwraps.com/our-products/designpanelpro-xl-print-production-pack/",
  },
  {
    id: "pp-production-pack-299",
    name: "Production Pack — $299",
    subName: "Print-ready production files",
    category: "printpro",
    price: 299,
    unit: "each",
    hidden: true,
    wooProductId: 71964,
    wooProductUrl: "https://weprintwraps.com/our-products/production-pack-299/",
  },
  // Wrap By The Yard
  {
    id: "pp-wbty-bape",
    name: "WBTY — Bape Camo",
    subName: "Pre-designed pattern, by the yard",
    category: "printpro",
    price: 95.5,
    unit: "yard",
    wooProductId: 42809,
    wooProductUrl:
      "https://weprintwraps.com/our-products/wrap-by-the-yard-bape-camo/",
  },
  {
    id: "pp-wbty-camo-carbon",
    name: "WBTY — Camo & Carbon",
    subName: "Pre-designed pattern, by the yard",
    category: "printpro",
    price: 95.5,
    unit: "yard",
    wooProductId: 1726,
    wooProductUrl:
      "https://weprintwraps.com/our-products/camo-carbon-wrap-by-the-yard/",
  },
  {
    id: "pp-wbty-metal-marble",
    name: "WBTY — Metal & Marble",
    subName: "Pre-designed pattern, by the yard",
    category: "printpro",
    price: 95.5,
    unit: "yard",
    wooProductId: 39698,
    wooProductUrl:
      "https://weprintwraps.com/our-products/wrap-by-the-yard-metal-marble/",
  },
  {
    id: "pp-wbty-modern-trippy",
    name: "WBTY — Modern & Trippy",
    subName: "Pre-designed pattern, by the yard",
    category: "printpro",
    price: 95.5,
    unit: "yard",
    wooProductId: 52489,
    wooProductUrl:
      "https://weprintwraps.com/our-products/wrap-by-the-yard-modern-trippy/",
  },
  {
    id: "pp-wbty-wicked",
    name: "WBTY — Wicked & Wild",
    subName: "Pre-designed pattern, by the yard",
    category: "printpro",
    price: 95.5,
    unit: "yard",
    // Woo id 4181 is the WRAP. 4179 is the Wicked & Wild SWATCH BOOK (a
    // $26.25 sample) — pointing the wrap line at 4179 loaded the wrong
    // product in the WPW cart. See src/lib/wpw-catalog.ts.
    wooProductId: 4181,
    wooProductUrl:
      "https://weprintwraps.com/our-products/wrap-by-the-yard-wicked-wild-wrap-prints/",
  },
  // Accessories & sample books
  {
    id: "pp-sample-camo-carbon",
    name: "Camo & Carbon Sample Book",
    subName: "Physical swatch book",
    category: "printpro",
    price: 26.25,
    unit: "each",
    wooProductId: 475,
  },
  {
    id: "pp-sample-metal-marble",
    name: "Marble & Metals Swatch Book",
    subName: "Physical swatch book",
    category: "printpro",
    price: 26.25,
    unit: "each",
    wooProductId: 39628,
  },
  {
    id: "pp-sample-wicked",
    name: "Wicked & Wild Swatch Book",
    subName: "Physical swatch book",
    category: "printpro",
    price: 26.25,
    unit: "each",
    wooProductId: 4179,
  },
  {
    id: "pp-pantone-chart",
    name: "Pantone Color Chart",
    subName: "30\" × 52\" reference chart",
    category: "printpro",
    price: 42,
    unit: "each",
    wooProductId: 15192,
  },
];

// ── WallPro (Avery HP MPI 2610, 54" panels, per linear foot) ───────
// Mirrors https://weprintwraps.com/our-products/wall-wrap-printed-vinyl/.
// Renamed from "Wall Wrap Printing" to "WallPro" because the in-app
// page also offers prompt-based wall design generation.
export const WALLPRO_PRODUCTS: QuoteProduct[] = [
  {
    id: "wallpro-avery-2610",
    name: "WallPro — Avery HP MPI 2610 Wall Wrap",
    subName: `${WALL_FILM.finish} · ${WALL_FILM.panelWidthInches}" panels · matte/luster`,
    category: "wallpro",
    price: WALL_FILM.pricePerLinearFoot, // $3.25 / linear foot
    unit: "linear_foot",
    wooProductUrl:
      "https://weprintwraps.com/our-products/wall-wrap-printed-vinyl/",
  },
];

// ── BookingPro Install Services (flat-rate bookable jobs) ─────────
// Default catalog of simple jobs a shop can quote + book in one step.
// Shop owners customize pricing + duration in /admin/availability.
export const SERVICE_PRODUCTS: QuoteProduct[] = [
  { id: "svc-chrome-delete", name: "Chrome Delete", subName: "Blackout all chrome trim · ~4 hrs", category: "services", price: 300, unit: "each" },
  { id: "svc-roof-wrap", name: "Roof Wrap", subName: "Single panel roof color/finish · ~2 hrs", category: "services", price: 350, unit: "each" },
  { id: "svc-accent-wrap", name: "Accent Wrap", subName: "Mirror caps, spoiler, pillars · ~3 hrs", category: "services", price: 250, unit: "each" },
  { id: "svc-carbon-fiber", name: "Carbon Fiber Wrap", subName: "Interior or exterior carbon accents · ~3 hrs", category: "services", price: 400, unit: "each" },
  { id: "svc-color-change-full", name: "Full Color Change", subName: "Complete vehicle color change · 3-5 days", category: "services", price: 3500, unit: "each" },
  { id: "svc-partial-wrap", name: "Partial Wrap", subName: "Hood, fenders, or custom coverage · ~1 day", category: "services", price: 800, unit: "each" },
  { id: "svc-window-tint", name: "Window Tint", subName: "Full vehicle window tinting · ~2 hrs", category: "services", price: 250, unit: "each" },
  { id: "svc-ppf-full-front", name: "PPF Full Front", subName: "Hood, fenders, bumper, mirrors · ~1 day", category: "services", price: 1800, unit: "each" },
  { id: "svc-ppf-hood", name: "PPF Hood Only", subName: "Clear bra hood protection · ~2 hrs", category: "services", price: 450, unit: "each" },
  { id: "svc-commercial-lettering", name: "Commercial Lettering", subName: "Business name, DOT numbers, logos · ~3 hrs", category: "services", price: 500, unit: "each" },
  { id: "svc-fleet-graphics", name: "Fleet Graphics Package", subName: "Multi-vehicle branding · per vehicle", category: "services", price: 1200, unit: "each" },
  { id: "svc-design-consult", name: "Design Consultation", subName: "1-on-1 design session — concept to render · 1 hr", category: "services", price: 95, unit: "hour" },
  { id: "svc-design-hourly", name: "Design — Hourly", subName: "Hourly design work · 2-hr minimum", category: "services", price: 95, unit: "hour" },
  { id: "svc-restyle-consult", name: "Restyle Premium Consultation", subName: "High-end design, material selection, mock-ups · 2 hrs", category: "services", price: 250, unit: "hour" },
];

/**
 * WPW Design Products — the three WooCommerce design SKUs sold by
 * WePrintWraps. The shop adds these to a customer quote at WPW's
 * a-la-carte rate (the rate column below) and can mark up the price
 * in the line item before sending. Same WooIDs as `wpw-design-products.ts`
 * so the comparison card and the QuickQuote dropdown stay in sync.
 */
export const WPW_DESIGN_PRODUCTS: QuoteProduct[] = [
  {
    id: "wpw-design-hourly",
    name: "WPW Hourly Design",
    subName: "Hourly design work · 2-hr minimum ($180 floor)",
    category: "wpw_design",
    price: 90,
    unit: "hour",
    wooProductId: 290,
  },
  {
    id: "wpw-design-full-wrap",
    name: "WPW Custom Vehicle Wrap Design",
    subName: "Full vehicle wrap design · variable, $500 base · files stay with WPW",
    category: "wpw_design",
    price: 500,
    unit: "each",
    wooProductId: 234,
  },
  {
    id: "wpw-design-setup",
    name: "WPW Design Setup / File Output",
    subName: "Production-ready file output",
    category: "wpw_design",
    price: 190,
    unit: "each",
    wooProductId: 289,
  },
];

/**
 * RestylePro Design Products — design services the shop's RestylePro
 * subscription enables them to resell to their customer. Default
 * prices are starting points; the line item is fully editable in the
 * estimator, and shops can override per-product defaults from the
 * admin pricing page (future).
 */
export const RP_DESIGN_PRODUCTS: QuoteProduct[] = [
  {
    id: "rp-design-colorpro",
    name: "ColorPro Visualization",
    subName: "Photoreal color-change render of the customer's vehicle",
    category: "rp_design",
    price: 75,
    unit: "each",
  },
  {
    id: "rp-design-designpro-wrap",
    name: "DesignProAI Custom Wrap Design",
    subName: "AI design from prompt + you revise + real designer outputs files",
    category: "rp_design",
    price: 1250,
    unit: "each",
  },
  {
    id: "rp-design-graphicspro",
    name: "GraphicsPro Custom Graphics",
    subName: "Logos, accents, partial graphics designed on the vehicle",
    category: "rp_design",
    price: 350,
    unit: "each",
  },
  {
    id: "rp-design-patternpro",
    name: "PatternPro Pattern Wrap",
    subName: "Pattern / camo / texture wrap design",
    category: "rp_design",
    price: 850,
    unit: "each",
  },
  {
    id: "rp-design-fadewraps",
    name: "FadeWraps Gradient Design",
    subName: "Custom gradient / fade wrap with multiple stops",
    category: "rp_design",
    price: 650,
    unit: "each",
  },
  {
    id: "rp-design-revision",
    name: "Revision Round",
    subName: "Additional revision after included rounds",
    category: "rp_design",
    price: 75,
    unit: "each",
  },
  {
    id: "rp-design-production-pack",
    name: "Production Pack — Print-Ready Files",
    subName: "Real designer QC + vehicle-template print-ready output",
    category: "rp_design",
    price: 599,
    unit: "each",
    hidden: true,
  },
  {
    id: "rp-design-ai-render",
    name: "AI Render / Visualization",
    subName: "Single AI-generated render of the customer's vehicle",
    category: "rp_design",
    price: 50,
    unit: "each",
  },
  // ── Design upsells — visual modifications the shop designs and
  // installs alongside the base wrap / color change. Mirrors the
  // visual-upsell catalog in `shop-service-defaults.ts` so the
  // QuickQuote dropdown stays in sync with the precision-mod
  // buttons. Default prices below are catalog defaults; shops
  // override on /admin/shop-pricing.
  {
    id: "rp-design-chrome-delete",
    name: "Chrome Delete",
    subName: "Blackout all chrome trim",
    category: "rp_design",
    price: 300,
    unit: "each",
  },
  {
    id: "rp-design-carbon-roof",
    name: "Carbon Fiber Roof",
    subName: "Glossy black carbon weave roof panel",
    category: "rp_design",
    price: 400,
    unit: "each",
  },
  {
    id: "rp-design-carbon-hood",
    name: "Carbon Fiber Hood",
    subName: "Glossy black carbon weave hood",
    category: "rp_design",
    price: 350,
    unit: "each",
  },
  {
    id: "rp-design-racing-stripe",
    name: "Racing Stripe (Black)",
    subName: "Twin glossy black stripes down center",
    category: "rp_design",
    price: 200,
    unit: "each",
  },
  {
    id: "rp-design-roof-wrap",
    name: "Roof Wrap (Satin Black)",
    subName: "Solid satin black roof panel",
    category: "rp_design",
    price: 350,
    unit: "each",
  },
  {
    id: "rp-design-accent-wrap",
    name: "Accent Wrap",
    subName: "Mirror caps, spoiler, pillars",
    category: "rp_design",
    price: 250,
    unit: "each",
  },
];

export const PRODUCTS_BY_CATEGORY: Record<QuoteCategory, QuoteProduct[]> = {
  avery: AVERY_PRODUCTS,
  threeM: THREEM_PRODUCTS,
  color_change: COLOR_CHANGE_PRODUCTS,
  printpro: PRINTPRO_PRODUCTS,
  wallpro: WALLPRO_PRODUCTS,
  services: SERVICE_PRODUCTS,
  wpw_design: WPW_DESIGN_PRODUCTS,
  rp_design: RP_DESIGN_PRODUCTS,
};

/** Drops products flagged `hidden` — used by every quote picker surface. */
export function visibleProducts(list: QuoteProduct[]): QuoteProduct[] {
  return list.filter((p) => !p.hidden);
}

export function getProductsForCategory(cat: QuoteCategory): QuoteProduct[] {
  return visibleProducts(PRODUCTS_BY_CATEGORY[cat] ?? []);
}

/**
 * Top-level "source" dropdown the shop owner picks from in QuickQuote.
 * Kept distinct from QuoteCategory so that WPW and PrintPro can share
 * the same underlying product catalog (the weprintwraps.com mirror)
 * while presenting different value-framing copy in the UI:
 *
 *   • wpw          — direct WePrintWraps.com catalog pricing (film only,
 *                    no surcharge) for existing WPW customers
 *   • color_change — solid-color change vinyl, finish-based
 *   • printpro     — same WPW catalog, design + renders included with
 *                    RestylePro tier (the compelling upsell)
 */
export type QuoteSource = "wpw" | "color_change" | "printpro" | "services";

export function getProductsForSource(source: QuoteSource): QuoteProduct[] {
  if (source === "color_change") return visibleProducts(COLOR_CHANGE_PRODUCTS);
  if (source === "services") return visibleProducts(SERVICE_PRODUCTS);
  // Both "wpw" and "printpro" surface the weprintwraps catalog mirror.
  return visibleProducts(PRINTPRO_PRODUCTS);
}

/** Underlying catalog category a source maps to (for persistence). */
export function categoryForSource(source: QuoteSource): QuoteCategory {
  if (source === "color_change") return "color_change";
  if (source === "services") return "services";
  return "printpro";
}

export const DEFAULT_PRODUCT_BY_SOURCE: Record<QuoteSource, string> = {
  wpw: "pp-avery-1105",
  color_change: "cc-gloss",
  printpro: "pp-avery-1105",
  services: "svc-chrome-delete",
};

export function findProductById(id: string): QuoteProduct | undefined {
  for (const list of Object.values(PRODUCTS_BY_CATEGORY)) {
    const hit = list.find((p) => p.id === id);
    if (hit) return hit;
  }
  return undefined;
}

export function unitLabel(unit: PriceUnit): string {
  switch (unit) {
    case "yard":
      return "yds";
    case "sqft":
      return "sq ft";
    case "each":
      return "ea";
    case "linear_foot":
      return "linear ft";
    case "hour":
      return "hr";
    case "window":
      return "windows";
  }
}

export function unitShort(unit: PriceUnit): string {
  switch (unit) {
    case "yard":
      return "yd";
    case "sqft":
      return "sqft";
    case "each":
      return "ea";
    case "linear_foot":
      return "lf";
    case "hour":
      return "hr";
    case "window":
      return "win";
  }
}

/**
 * Default product picked when a category is first selected. Keeps the card
 * populated with a sensible line item without making the user drill in.
 */
export const DEFAULT_PRODUCT_BY_CATEGORY: Record<QuoteCategory, string> = {
  avery: "avery-1105-uv",
  threeM: "3m-ij180-printed",
  color_change: "cc-gloss",
  printpro: "pp-avery-1105",
  wallpro: "wallpro-avery-2610",
  services: "svc-chrome-delete",
};
