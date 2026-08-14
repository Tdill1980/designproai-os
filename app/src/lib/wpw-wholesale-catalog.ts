/**
 * WPW wholesale catalog — single source of truth for the curated price
 * lists shown in the WpwShoppingButtons hover dropdowns and the Shop
 * Pricing admin page.
 *
 * These are the wholesale rates the shop owner pays. The shop owner
 * marks up for their own customers via the Shop Pricing admin
 * (/admin/shop-pricing) where they can add custom products and set
 * per-product or global margins.
 *
 * Full catalog with SKU details lives in src/lib/quote-product-catalog.ts.
 */

export interface WholesaleRow {
  /** Stable identifier — used as keys + future DB FK. */
  id: string;
  /** Display name shown in dropdowns and admin. */
  name: string;
  /** Wholesale price string (formatted with units). Source of truth. */
  wpw: string;
  /** Numeric base for margin math. Units depend on `unit`. */
  baseUnitPrice: number;
  /** Pricing unit label. */
  unit: "sqft" | "yard" | "lin.ft" | "design" | "panel" | "order" | "each" | "vehicle";
}

export const PRINT_PRODUCTS: WholesaleRow[] = [
  { id: "avery-1105",       name: "Avery 1105 Cast Vinyl",          wpw: "$5.27/sqft",   baseUnitPrice: 5.27, unit: "sqft" },
  { id: "3m-ij180",         name: "3M IJ180 Cast Vinyl",            wpw: "$5.27/sqft",   baseUnitPrice: 5.27, unit: "sqft" },
  { id: "cut-contour-avery",name: "Cut Contour (Avery 1105)",       wpw: "$6.32/sqft",   baseUnitPrice: 6.32, unit: "sqft" },
  { id: "cut-contour-3m",   name: "Cut Contour (3M IJ180)",         wpw: "$6.92/sqft",   baseUnitPrice: 6.92, unit: "sqft" },
  { id: "fadewraps",        name: "FadeWraps Custom Design",        wpw: "$600/design",  baseUnitPrice: 600,  unit: "design" },
  { id: "wallpro-mpi-2610", name: "WallPro (Avery HP MPI 2610)",    wpw: "$3.25/lin.ft", baseUnitPrice: 3.25, unit: "lin.ft" },
  { id: "color-gloss",      name: "Color Change — Gloss",           wpw: "$28/yard",     baseUnitPrice: 28,   unit: "yard" },
  { id: "color-satin-matte",name: "Color Change — Satin/Matte",     wpw: "$30/yard",     baseUnitPrice: 30,   unit: "yard" },
  { id: "color-metallic",   name: "Color Change — Metallic",        wpw: "$38/yard",     baseUnitPrice: 38,   unit: "yard" },
  { id: "color-chrome",     name: "Color Change — Chrome",          wpw: "$65/yard",     baseUnitPrice: 65,   unit: "yard" },
  { id: "restylelibrary",   name: "RestyleLibrary Pre-Built Panel", wpw: "$95/panel",    baseUnitPrice: 95,   unit: "panel" },
];

export const DESIGN_SERVICES: WholesaleRow[] = [
  { id: "production-pack",  name: "Production Pack (print-ready files, 48hr)", wpw: "$299/order", baseUnitPrice: 299, unit: "order" },
  { id: "custom-wrap",      name: "Custom Wrap Design (from scratch)",         wpw: "$500",       baseUnitPrice: 500, unit: "each" },
  { id: "design-revision",  name: "Design Revision (per round)",               wpw: "$150",       baseUnitPrice: 150, unit: "each" },
  { id: "logo-graphics",    name: "Logo + Graphics Design",                    wpw: "$500",       baseUnitPrice: 500, unit: "each" },
  { id: "fleet-design",     name: "Fleet Wrap Design (per vehicle)",           wpw: "$750",       baseUnitPrice: 750, unit: "vehicle" },
];

/** Format a numeric customer price with the same unit as the wholesale row. */
export const formatPriceWithUnit = (price: number, unit: WholesaleRow["unit"]): string => {
  const rounded = Number.isInteger(price) ? price : Number(price.toFixed(2));
  if (unit === "each") return `$${rounded.toLocaleString("en-US")}`;
  return `$${rounded.toLocaleString("en-US")}/${unit}`;
};
