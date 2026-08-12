/**
 * wpwProducts — canonical WePrintWraps product catalog (WooCommerce IDs).
 * Source of truth for the WPW product library shown under the WePrintWraps
 * brand and for any tool that needs to reference/link a real product.
 * Prices are the current published prices; keep IDs stable.
 */

export type WpwProduct = {
  id: number;
  title: string;
  category: WpwCategory;
  price?: string;
  unit?: string;
};

export type WpwCategory =
  | "Printed Film"
  | "Wrap By The Yard"
  | "Swatch Books"
  | "Window"
  | "Design Services"
  | "Production Packs"
  | "Wall";

// Category → signature color (WePrintWraps cyan family + accents) for chips.
export const WPW_CATEGORY_COLORS: Record<WpwCategory, string> = {
  "Printed Film": "#06B6D4",
  "Wrap By The Yard": "#7C3AED",
  "Swatch Books": "#0EA5E9",
  Window: "#0891B2",
  "Design Services": "#EC4899",
  "Production Packs": "#F59E0B",
  Wall: "#10B981",
};

export const WPW_PRODUCTS: WpwProduct[] = [
  // ── Printed wrap film ──
  { id: 72, title: "3M IJ180 Printed Wrap Film (Wholesale Vehicle Wraps)", category: "Printed Film" },
  { id: 19420, title: "3M IJ180 Contour-Cut Wrap Film — Weeded & Masked, Install-Ready", category: "Printed Film", price: "$6.95", unit: "sq ft" },
  { id: 108, title: "Avery Contour-Cut Wrap Film — Weeded & Masked, Install-Ready", category: "Printed Film", price: "$6.32", unit: "sq ft" },
  { id: 79, title: "Printed Wrap Film with UV Lamination (Avery Brand Film)", category: "Printed Film", price: "$5.27", unit: "sq ft" },
  { id: 58391, title: "Custom Fade Wrap Printing | Avery Film", category: "Printed Film", price: "$600", unit: "2 sides" },

  // ── Window ──
  { id: 80, title: "Perforated Window Vinyl 50/50 Unlaminated 54\" Roll (Max Print 53.5\")", category: "Window", price: "$5.95", unit: "sq ft" },

  // ── Wrap By The Yard (parent products) ──
  { id: 1726, title: "Wrap By The Yard — Camo & Carbon", category: "Wrap By The Yard", price: "$95.50", unit: "yard" },
  { id: 39698, title: "Wrap By The Yard — Metal & Marble", category: "Wrap By The Yard", price: "$95.50", unit: "yard" },
  { id: 4181, title: "Wrap By The Yard — Wicked & Wild Wrap Prints 60\"", category: "Wrap By The Yard", price: "$95.50", unit: "yard" },
  { id: 42809, title: "Wrap By The Yard — Bape Camo", category: "Wrap By The Yard", price: "$95.50", unit: "yard" },
  { id: 52489, title: "Wrap By The Yard — Modern & Trippy", category: "Wrap By The Yard", price: "$95.50", unit: "yard" },

  // ── Swatch books & charts ──
  { id: 475, title: "Camo & Carbon Sample Book", category: "Swatch Books", price: "$26.50" },
  { id: 39628, title: "Marble & Metals Swatch Book", category: "Swatch Books", price: "$26.50" },
  { id: 4179, title: "Wicked & Wild Swatch Book", category: "Swatch Books", price: "$26.50" },
  { id: 15192, title: "Pantone Color Chart 30\" x 52\"", category: "Swatch Books", price: "$42" },

  // ── Design services ──
  { id: 234, title: "Custom Vehicle Wrap Design", category: "Design Services", price: "$975" },
  { id: 290, title: "Hourly Design (2 hour minimum)", category: "Design Services", price: "$90", unit: "hr" },
  { id: 289, title: "Design Set Up / File Output", category: "Design Services", price: "$199" },

  // ── Print production packs ──
  { id: 69664, title: "DesignPanelPro™ — Small Print Production Pack", category: "Production Packs" },
  { id: 69671, title: "DesignPanelPro™ — Medium Print Production Pack", category: "Production Packs" },
  { id: 69680, title: "DesignPanelPro™ — Large Print Production Pack", category: "Production Packs" },
  { id: 69686, title: "DesignPanelPro™ — XLarge Print Production Pack", category: "Production Packs" },

  // ── Wall ──
  { id: 70093, title: "WallWraps", category: "Wall" },
];

export const WPW_CATEGORY_ORDER: WpwCategory[] = [
  "Printed Film",
  "Wrap By The Yard",
  "Swatch Books",
  "Window",
  "Design Services",
  "Production Packs",
  "Wall",
];
