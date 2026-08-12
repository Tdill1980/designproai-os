/**
 * Customer-facing display helpers shared across CreatorMarket UI.
 *
 * Centralises the "what shows on the big card title" logic so the
 * unauth grid, the dashboard browse grid, the detail viewer, and the
 * 5-step BuyerPopup all stay in sync. The admin curator form writes
 * `industry_title` directly; everything else falls back to a derived
 * value from `trade_category` and `vehicle_make`.
 */

interface ListingLike {
  industry_title?: string | null;
  title?: string | null;
  trade_category?: string | null;
  vehicle_year?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  design_style?: string | null;
}

const TRADE_TITLES: Record<string, string> = {
  real_estate: "Real Estate Wrap Template",
  hvac: "HVAC Service Van Wrap",
  plumbing: "Plumbing Fleet Wrap Design",
  home_health: "Mobile Home Health Wrap",
  dental: "Mobile Dental Wrap",
  pool: "Pool & Spa Service Wrap",
  spa_beauty: "Mobile Spa & Beauty Wrap",
  landscaping: "Landscaping Truck Wrap",
  electrician: "Electrician Service Wrap",
  cleaning: "Mobile Cleaning Wrap",
  food_truck: "Food Truck Wrap Design",
  pest_control: "Pest Control Van Wrap",
  roofing: "Roofing Fleet Wrap",
  auto_service: "Auto Service Wrap Template",
  construction: "Construction Fleet Wrap",
  general: "Commercial Wrap Template",
};

/**
 * Pull the big customer-facing card title.
 *
 *  1. Admin-typed `industry_title` wins.
 *  2. Trade-category lookup ("HVAC Service Van Wrap").
 *  3. For non-commercial cards, fall back to the design name parsed
 *     from "Vehicle - Design" titles.
 *  4. Last resort: the raw `title` field or "Custom Wrap Design".
 */
export function getIndustryTitle(listing: ListingLike | null | undefined): string {
  if (!listing) return "Custom Wrap Design";
  const override = (listing.industry_title || "").trim();
  if (override) return override;

  const trade = (listing.trade_category || "").trim();
  if (trade && TRADE_TITLES[trade]) return TRADE_TITLES[trade];

  // "Vehicle - Design" → take the design half for the big title on
  // creative (non-commercial) cards.
  const raw = (listing.title || "").trim();
  if (raw.includes(" - ")) {
    const designName = raw.split(" - ").slice(1).join(" - ").trim();
    if (designName) return designName;
  }
  return raw || "Custom Wrap Design";
}

/**
 * Small "Shown on …" line under the industry title.
 */
export function getVehicleSubtitle(listing: ListingLike | null | undefined): string {
  if (!listing) return "";
  const vehicle = [listing.vehicle_year, listing.vehicle_make, listing.vehicle_model]
    .filter(Boolean)
    .join(" ")
    .trim();
  return vehicle ? `Shown on ${vehicle}` : "";
}

/**
 * Is this listing branded / commercial? Drives the "EDIT BUSINESS
 * INFO" badge, the branded-customization step in BuyerPopup, and the
 * "Replace logo / name / phone / colors" copy block.
 */
const BRANDED_KEYWORDS = [
  "commercial", "logo", "brand", "company", "business", "fleet",
  "llc", "inc", "corp", "plumber", "plumbing", "electrician", "electrical",
  "dentist", "dental", "hvac", "roofing", "roofer", "contractor",
  "landscaping", "lawn", "cleaning", "pest", "towing", "moving",
  "pizza", "restaurant", "bakery", "coffee", "catering", "food truck",
  "salon", "spa", "gym", "fitness", "realtor", "real estate",
  "auto repair", "mechanic", "locksmith", "painting", "security",
];

const COMMERCIAL_TRADES = new Set(Object.keys(TRADE_TITLES));

export function isCommercialListing(listing: ListingLike | null | undefined): boolean {
  if (!listing) return false;
  if (listing.design_style === "branded") return true;
  if (listing.trade_category && COMMERCIAL_TRADES.has(listing.trade_category)) return true;
  const title = (listing.title || "").toLowerCase();
  return BRANDED_KEYWORDS.some((kw) => title.includes(kw));
}

/**
 * The CreatorMarket "Customer-facing" copy promise. Used on cards,
 * the detail viewer, and the BuyerPopup confirmation step.
 */
export const PRINT_READY_PRICE = 350;
export const VEHICLE_RENDER_ADDON_PRICE = 75;
export const FILE_DELIVERY_HOURS = 48;
