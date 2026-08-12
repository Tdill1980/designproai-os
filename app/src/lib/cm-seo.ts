/**
 * cm-seo.ts — CreatorMarket SEO taxonomy + URL helpers (single source of truth).
 *
 * Turns the marketplace into programmatic, indexable landing pages:
 *   • TRADE categories  (commercial verticals — HVAC, plumbing, food truck…)
 *     from CM_TRADES, matched on marketplace_listings.trade_category.
 *   • STYLE categories  ("restyle types" — racing, stealth, carbon fiber,
 *     chrome, exotic, color-change, camo), matched on title keywords.
 *
 * Every category gets a clean URL (`/creatormarket/hvac-wraps`), a unique
 * H1/title/description, and feeds the dynamic sitemap. Individual designs get
 * `/creatormarket/design/<slug>-<uuid>`.
 *
 * Shared by the client pages (CreatorMarketTrade / CreatorMarketDesign), the
 * dynamic sitemap (api/sitemap-creatormarket.js), and the crawler HTML endpoint
 * (api/og/creatormarket.js) — keep those in sync when this changes.
 */
import { CM_TRADES } from "@/lib/cm-trade-options";

export type CmCategoryKind = "trade" | "style";

export interface CmCategory {
  kind: CmCategoryKind;
  /** URL slug, e.g. "hvac-wraps" / "carbon-fiber-wraps". */
  urlSlug: string;
  /** Human label, e.g. "HVAC" / "Carbon Fiber". */
  label: string;
  /** trade_category value (trade kind only). */
  tradeCategory?: string;
  /** Title keywords matched against the listing title (style kind only). */
  matchKeywords?: string[];
  h1: string;
  metaTitle: string;
  metaDescription: string;
  intro: string;
}

/** kebab-case a label into a URL-safe token (drops punctuation, "&" → "and"). */
export function kebab(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── STYLE ("restyle") categories — aesthetic wrap types, matched by title
// keyword (there is no dedicated style column yet; a future style tag on the
// row would make these exact). Ordered by search demand. ──
const STYLE_DEFS: Array<{
  slug: string; label: string; keywords: string[]; blurb: string;
}> = [
  { slug: "racing-wraps", label: "Racing & Motorsport", keywords: ["racing", "race", "motorsport", "rally", "livery", "gt3", "track"],
    blurb: "Bold racing liveries and motorsport-inspired wrap designs — stripes, numbers, sponsor layouts, and track-ready graphics." },
  { slug: "exotic-luxury-wraps", label: "Exotic & Luxury", keywords: ["exotic", "luxury", "supercar", "lamborghini", "ferrari", "mclaren", "mclaren", "porsche"],
    blurb: "Supercar-grade exotic and luxury wrap designs — refined palettes, premium finishes, and showpiece graphics." },
  { slug: "stealth-matte-wraps", label: "Stealth & Matte", keywords: ["stealth", "matte", "murdered", "satin", "blackout", "black out"],
    blurb: "Murdered-out stealth and matte wrap designs — satin blacks, blackout accents, and understated aggressive looks." },
  { slug: "carbon-fiber-wraps", label: "Carbon Fiber", keywords: ["carbon"],
    blurb: "Carbon fiber texture wrap designs — real-weave patterns, gloss and matte carbon, and accent applications." },
  { slug: "chrome-metallic-wraps", label: "Chrome & Metallic", keywords: ["chrome", "metallic", "mirror", "conform chrome"],
    blurb: "Mirror-chrome and metallic wrap designs — high-shine finishes, color-shift chromes, and metallic flake looks." },
  { slug: "color-change-wraps", label: "Color Change", keywords: ["color change", "colour change", "colorshift", "color shift", "flip"],
    blurb: "Full color-change wrap designs — solid gloss, satin, and color-shift finishes to transform any vehicle." },
  { slug: "camo-wraps", label: "Camo & Camouflage", keywords: ["camo", "camouflage", "kryptek", "multicam"],
    blurb: "Camo and camouflage wrap designs — woodland, digital, arctic, and custom pattern layouts." },
];

const TRADE_VEHICLE_HINT: Record<string, string> = {
  hvac: "service van", plumbing: "work van", food_truck: "food truck",
  roofing: "work truck", landscaping: "truck", electrician: "service van",
};

function tradeCategory(slug: string, label: string): CmCategory {
  const vehicleHint = TRADE_VEHICLE_HINT[slug] || "vehicle";
  return {
    kind: "trade",
    urlSlug: `${kebab(label)}-wraps`,
    label,
    tradeCategory: slug,
    h1: `${label} Vehicle Wrap Designs`,
    metaTitle: `${label} Wrap Designs — Print-Ready ${label} Vehicle Wraps | CreatorMarket`,
    metaDescription:
      `Browse print-ready ${label} ${vehicleHint} wrap designs. Editable business name, logo, phone, website & colors — sized to your exact vehicle and delivered in 48 hours. $350 per wrap.`,
    intro:
      `Professional ${label.toLowerCase()} vehicle wrap designs, ready to customize and print. ` +
      `Every design is fully editable — swap in your business name, logo, phone, website, and brand colors — ` +
      `then we size the print-ready files to your exact year, make, and model and deliver them in 48 hours.`,
  };
}

function styleCategory(def: typeof STYLE_DEFS[number]): CmCategory {
  return {
    kind: "style",
    urlSlug: def.slug,
    label: def.label,
    matchKeywords: def.keywords,
    h1: `${def.label} Wrap Designs`,
    metaTitle: `${def.label} Wrap Designs — Print-Ready Vehicle Wraps | CreatorMarket`,
    metaDescription:
      `${def.blurb} Print-ready files sized to your exact vehicle, delivered in 48 hours. $350 per wrap.`,
    intro: def.blurb,
  };
}

/** All CreatorMarket category landing pages (trades + restyle styles). */
export const CM_CATEGORIES: CmCategory[] = [
  ...CM_TRADES.filter((t) => t.slug !== "general").map((t) => tradeCategory(t.slug, t.label)),
  ...STYLE_DEFS.map(styleCategory),
];

const BY_SLUG = new Map(CM_CATEGORIES.map((c) => [c.urlSlug, c]));

export function categoryFromUrlSlug(slug: string | undefined | null): CmCategory | null {
  if (!slug) return null;
  return BY_SLUG.get(String(slug).toLowerCase()) || null;
}

export const CM_TRADE_CATEGORIES = CM_CATEGORIES.filter((c) => c.kind === "trade");
export const CM_STYLE_CATEGORIES = CM_CATEGORIES.filter((c) => c.kind === "style");

// ── Individual design URLs ──────────────────────────────────────────────────
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Build the canonical design URL path from a listing-like row. */
export function designPath(listing: {
  id: string; industry_title?: string | null; title?: string | null;
  vehicle_year?: string | null; vehicle_make?: string | null; vehicle_model?: string | null;
}): string {
  const name = listing.industry_title || listing.title || "wrap-design";
  const vehicle = [listing.vehicle_year, listing.vehicle_make, listing.vehicle_model].filter(Boolean).join(" ");
  const slug = kebab([name, vehicle].filter(Boolean).join(" ")).slice(0, 80).replace(/-+$/g, "");
  return `/creatormarket/design/${slug ? slug + "-" : ""}${listing.id}`;
}

/** Extract the listing UUID from a `/creatormarket/design/:slugId` param. */
export function designIdFromParam(slugId: string | undefined | null): string | null {
  if (!slugId) return null;
  const m = String(slugId).match(UUID_RE);
  return m ? m[1] : null;
}

// ── Backfill helpers (shared by the client + the backfill script) ───────────
// Keyword → trade slug, for inferring a missing trade_category from the
// title/industry_title. Deterministic, no AI. First match wins (ordered most
// specific → generic). Mirrors CM_TRADES slugs.
const TRADE_KEYWORDS: Array<[string, string[]]> = [
  ["hvac", ["hvac", "heating", "air conditioning", "furnace", "ac repair", "cooling", "mini-split", "mini split"]],
  ["plumbing", ["plumb", "drain", "sewer", "rooter", "leak", "water heater"]],
  ["electrician", ["electric", "electrical", "wiring", "panel upgrade"]],
  ["roofing", ["roof", "shingle", "gutter"]],
  ["landscaping", ["landscap", "lawn", "mowing", "hardscape", "irrigation"]],
  ["dental", ["dental", "dentist", "orthodont", "invisalign"]],
  ["home_health", ["home health", "caregiver", "hospice", "in-home care", "medicare"]],
  ["pool", ["pool", "spa service", "hot tub"]],
  ["spa_beauty", ["med-spa", "medspa", "beauty", "botox", "lash", "facial", "salon"]],
  ["cleaning", ["cleaning", "janitorial", "maid"]],
  ["food_truck", ["food truck", "taco", "bbq", "kitchen on wheels"]],
  ["pest_control", ["pest", "exterminat", "termite", "bug"]],
  ["auto_service", ["auto repair", "mechanic", "ase certified", "oil change", "brake"]],
  ["construction", ["construction", "general contractor", "builder", "remodel"]],
  ["towing", ["tow", "wrecker", "recovery", "roadside"]],
  ["mobile_detail", ["detail", "ceramic coat", "paint correction", "ppf"]],
  ["junk_removal", ["junk removal", "hauling", "dumpster"]],
  ["moving", ["moving", "movers", "relocation"]],
  ["tree_service", ["tree service", "arborist", "stump", "tree removal"]],
  ["pet_grooming", ["pet groom", "dog groom", "grooming"]],
  ["restoration", ["restoration", "water damage", "fire damage", "mold", "iicrc"]],
  ["solar", ["solar", "photovoltaic", "pv install"]],
  ["painting", ["painting", "painter", "repaint"]],
  ["window_cleaning", ["window cleaning", "pressure wash", "soft wash", "power wash"]],
  ["handyman", ["handyman", "home repair"]],
  ["locksmith", ["locksmith", "lockout", "rekey"]],
  ["fitness", ["fitness", "personal train", "gym", "crossfit"]],
  ["flooring", ["flooring", "hardwood floor", "lvp", "tile install"]],
  ["catering", ["catering", "caterer"]],
  ["photography", ["photograph", "photographer"]],
  ["real_estate", ["real estate", "realtor", "broker", "mls"]],
  ["wraps", ["wrap installer", "color change", "vinyl wrap", "window tint"]],
];

interface ListingSeoLike {
  industry_title?: string | null;
  title?: string | null;
  trade_category?: string | null;
  vehicle_year?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
}

const TRADE_LABEL: Record<string, string> = Object.fromEntries(
  CM_TRADES.map((t) => [t.slug, t.label]),
);

/** Infer a trade_category from the title when the column is empty. null = no confident match. */
export function inferTradeCategory(l: ListingSeoLike): string | null {
  if (l.trade_category) return l.trade_category;
  const hay = `${l.industry_title || ""} ${l.title || ""}`.toLowerCase();
  for (const [slug, kws] of TRADE_KEYWORDS) {
    if (kws.some((k) => hay.includes(k))) return slug;
  }
  return null;
}

/** Deterministic, unique-per-listing SEO description (no AI). */
export function buildSeoDescription(l: ListingSeoLike): string {
  const title = (l.industry_title || l.title || "Custom vehicle wrap design").trim();
  const vehicle = [l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(" ").trim();
  const isTrade = !!TRADE_LABEL[l.trade_category || ""];
  const lead = `${title}${vehicle ? ` — shown on a ${vehicle}` : ""}. A print-ready vehicle wrap design`;
  const editable = isTrade
    ? ", fully editable — swap in your business name, logo, phone, website, and brand colors"
    : "";
  return `${lead}${editable}. We size the print-ready production files to your exact year, make, and model and deliver them in 48 hours. $350 per wrap.`;
}
