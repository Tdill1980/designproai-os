/**
 * Product image carousel slots.
 *
 * Each "new WPW product" page shows a 3-image carousel above the fold.
 * Images are admin-uploadable at /admin/product-images and stored as
 * homepage_showcase rows keyed `product-carousel:<slug>:<n>` (n = 1..3),
 * reusing the same storage + table the WPW founder assets use — no new
 * table required.
 *
 * To add a product page to the carousel system, add an entry here, drop
 * <ProductImageCarousel slug="..." /> above the page's scroll content,
 * and the admin uploader picks it up automatically.
 */

export const CAROUSEL_SLOT_COUNT = 3;

export interface ProductPageDef {
  /** Stable slug used in the homepage_showcase row name. */
  slug: string;
  /** Human label shown in the admin uploader. */
  label: string;
  /** Live page path, for the admin "preview" link. */
  path: string;
}

// The new DesignProAI product pages sold through WePrintWraps.
export const PRODUCT_PAGES: ProductPageDef[] = [
  { slug: "custom-wrap-design", label: "Custom Wrap Design — $25", path: "/try-design" },
  { slug: "tier-starter", label: "Starter — $300/mo", path: "/pricing" },
  { slug: "tier-designpro-lite", label: "DesignPro Lite — $449/mo", path: "/pricing" },
  { slug: "tier-designpro-studio", label: "DesignPro Studio — $649/mo", path: "/pricing" },
  { slug: "tier-designpro-plus", label: "DesignPro Plus — $945/mo", path: "/pricing" },
  { slug: "production-pack", label: "Production Pack — $299", path: "/pricing" },
];

/** homepage_showcase row name for a given product slug + slot index (1-based). */
export function carouselRowName(slug: string, index: number): string {
  return `product-carousel:${slug}:${index}`;
}

/** All row names for a product, in display order. */
export function carouselRowNames(slug: string): string[] {
  return Array.from({ length: CAROUSEL_SLOT_COUNT }, (_, i) => carouselRowName(slug, i + 1));
}
