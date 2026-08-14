/**
 * Shared product-type classification for WPW order line items.
 *
 * Both the dashboard pillar mini-lists (PillarOrderList) and the full
 * /dashboard/my-orders page use these keyword sets to decide whether a
 * given order is a "design" job, a "print" job, or both. WPW's order
 * status ("processing", "completed", etc.) only describes workflow
 * stage — it doesn't tell us what kind of work the order is for.
 *
 * Matching is case-insensitive substring on `wpw_order_items.name`.
 */

export const DESIGN_PRODUCT_KEYWORDS = [
  "design",
  "graphic",
  "logo",
  "concept",
  "proof",
  "mockup",
  "artwork",
];

export const PRINT_PRODUCT_KEYWORDS = [
  "print",
  "wrap",
  "vinyl",
  "film",
  "decal",
  "lamination",
  "panel",
];

export type WpwOrderType = "all" | "design" | "print";

export const itemMatches = (
  items: { name: string | null }[] | undefined,
  keywords: string[],
): boolean => {
  if (!items || items.length === 0) return false;
  return items.some((it) => {
    const n = (it?.name || "").toLowerCase();
    return keywords.some((k) => n.includes(k));
  });
};

export const orderMatchesType = (
  items: { name: string | null }[] | undefined,
  type: WpwOrderType,
): boolean => {
  if (type === "all") return true;
  const keywords = type === "design" ? DESIGN_PRODUCT_KEYWORDS : PRINT_PRODUCT_KEYWORDS;
  return itemMatches(items, keywords);
};
