import { useUserTier } from "./useUserTier";

/**
 * Canonical tier hierarchy — DB slugs kept stable so existing
 * user_subscriptions rows keep working. Only display labels, prices,
 * and tool mappings change. No migration required.
 *
 *   free       — $0, try mode (paid renders @ $30 / token after free grant)
 *   starter    — "Starter"          $350/mo, 50 renders, $30 overage
 *   advanced   — "DesignPro Lite"   $499/mo, 75 renders, $20 overage, +MyVehiclePro
 *   complete   — "DesignPro Studio" $699/mo, 150 renders, $20 overage, +human designer
 *   agency     — custom per customer / internal admin/tester, hidden from customer UI
 *
 * DesignPro Plus is a separate Stripe product that customers map to
 * the `complete` slug with a different stripe price ID — see
 * DESIGNPRO_PLUS_PRICING below.
 *
 * The Agency tier still exists as a DB slug for admin / tester role
 * bypass, but it's labeled "Admin" internally so customers never see it.
 *
 * Render caps are SHARED across the entire suite. Internally renders
 * are spent as TOKENS — 1 token = 1 render OR 1 revision (both burn
 * the same compute, both count). The Generate counter increments per
 * click regardless of which tool fires it. Overage / top-up pricing
 * is tier-tiered to reward subscription:
 *   Free / Starter   $30 / token   (entry rate, protects against arbitrage)
 *   Lite / Studio    $20 / token   (paying-tier perk)
 *   Plus             $15 / token   (top-tier reward, ~40% off retail)
 * Published retail value of one token = $25.
 */
export const TIER_HIERARCHY = ["free", "starter", "advanced", "complete", "agency"] as const;
export type Tier = (typeof TIER_HIERARCHY)[number];

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  starter: "Starter",
  advanced: "DesignPro Lite",
  complete: "DesignPro Studio",
  agency: "Admin",
};

/**
 * Pricing metadata. Every upgrade prompt, pricing card, and tier badge
 * reads from this single source of truth so a price change touches
 * exactly one file.
 */
export interface TierPricing {
  price: number;           // USD / month, 0 for free
  priceLabel: string;      // "$199/mo", "$0", "Contact"
  renderCount: number;     // 0 = try, Infinity = unlimited
  renderLabel: string;     // "50 renders / month", "Unlimited renders"
  overage: number;         // $ per extra render, 0 if not applicable
  overageLabel: string;    // "$10 / extra render", ""
  target: string;          // Customer persona
  tagline: string;         // Marketing line
  hidden?: boolean;        // Skip on customer-facing pricing surfaces
}

export const TIER_PRICING: Record<Tier, TierPricing> = {
  free: {
    price: 0,
    priceLabel: "$0",
    renderCount: 0,
    renderLabel: "Try mode — pay-as-you-go tokens at $30 each",
    overage: 30,
    overageLabel: "$30 / token (1 token = 1 render or revision)",
    target: "Curious visitors and WPW customers",
    tagline: "Try every tool in preview mode. Grab a $250 custom design, or subscribe to a DesignPro plan. Pay-as-you-go renders at $30/token — 1 token = 1 render or revision in any tool.",
    hidden: true,
  },
  starter: {
    price: 350,
    priceLabel: "$350/mo",
    renderCount: 50,
    renderLabel: "50 tokens / month — shared across every tool, 1 token = 1 render or revision",
    overage: 30,
    overageLabel: "$30 / extra token (render or revision)",
    target: "Best for solo operators, mobile installers, and 1-2 person shops",
    tagline:
      "Best for solo operators, mobile installers, and 1-2 person shops. Includes ColorPro, PatternPro, RestyleLibrary, and FadeWraps. 50 tokens / month — one shared pool across every tool, where 1 token = 1 render or 1 revision (both burn the same compute). Each token = $25 retail value ($1,250 bundled in). $30 per extra token after cap. Does NOT include MyVehiclePro — upgrade to DesignPro Lite for the photo-based sales-floor demo tool.",
  },
  advanced: {
    price: 499,
    priceLabel: "$499/mo",
    renderCount: 75,
    renderLabel: "75 tokens / month — shared across every tool, 1 token = 1 render or revision",
    overage: 20,
    overageLabel: "$20 / extra token (paying-tier discount)",
    target: "Best for brick-and-mortar shops doing customer demos with photos",
    tagline:
      "Best for brick-and-mortar restyle, wrap, tint, and body shops. Everything in Starter plus MyVehiclePro, ApprovePro, PrintPro, ProductionFlow, RevisionStudioIQ, WrapBox, and MightyMail retargeting. 75 tokens / month — one shared pool across every tool, where 1 token = 1 render or 1 revision. Each token = $25 retail value ($1,875 bundled in). Paying-tier discount: $20 per extra token after cap (save $10/token vs Free + Starter).",
  },
  complete: {
    price: 699,
    priceLabel: "$699/mo",
    renderCount: 150,
    renderLabel: "150 tokens / month — shared across every tool, 1 token = 1 render or revision",
    overage: 20,
    overageLabel: "$20 / extra token (paying-tier discount)",
    target: "Best for working wrap shops ready to scale with a real human designer",
    tagline:
      "Best for working wrap shops ready to scale with a real human graphic designer. Everything in DesignPro Lite plus the human-designer Design OS — every file output in 48 hours. Includes DesignProAI, GraphicsPro, RecreatePro, and CreatorMarket publisher access (list and sell your wraps to every RestylePro shop, keep 60% of every sale). 150 tokens / month — one shared pool across every tool, where 1 token = 1 render or 1 revision. Each token = $25 retail value ($3,750 bundled in). Paying-tier discount: $20 per extra token after cap (save $10/token vs Free + Starter). Production Packs sold separately at the $249 subscriber rate (save $50 vs $299 retail).",
  },
  agency: {
    // Hidden from customer UI — admin / tester bypass only
    price: 0,
    priceLabel: "Internal",
    renderCount: Infinity,
    renderLabel: "Unlimited",
    overage: 0,
    overageLabel: "",
    target: "Admin / tester access",
    tagline: "Internal unlimited access for admin and tester accounts.",
    hidden: true,
  },
};

/**
 * DesignPro Plus — premium variant of the `complete` DesignPro Studio
 * tier. Same human-designer service with priority 24-hr turnaround,
 * larger render allowance (300/mo cap, NOT unlimited — a hard cap
 * protects margin against runaway Gemini cost). Production Packs are
 * always sold separately — Plus subscribers get the best discount
 * ($199 each vs $249 for Studio and $299 retail).
 *
 * No new DB slug — customers who subscribe to Plus still use the
 * `complete` slug, paired with a different Stripe price ID at signup.
 */
export const DESIGNPRO_PLUS_PRICING: TierPricing = {
  price: 995,
  priceLabel: "$995/mo",
  renderCount: 300,
  renderLabel: "300 tokens / month — shared across every tool, 1 token = 1 render or revision",
  overage: 15,
  overageLabel: "$15 / extra token (top-tier reward, ~40% off retail)",
  target: "Best for high-volume shops with priority needs",
  tagline:
    "Best for high-volume sign companies, graphic shops, and wrap + restyle shops with priority needs. Everything in DesignPro Studio — real human graphic designer, GraphicsPro, ProductionFlow, RecreatePro, CreatorMarket publishing — plus 24-hour priority turnaround. 300 tokens / month — one shared pool across every tool, where 1 token = 1 render or 1 revision. Each token = $25 retail value ($7,500 bundled in). Top-tier reward: $15 per extra token after cap (save $15/token vs Free + Starter, ~40% off retail). Production Packs sold separately at the $199 subscriber rate (save $100 vs $299 retail — the best discount of any plan).",
};

/**
 * Minimum tier required to use each tool.
 * Free users can still OPEN every tool (try-it mode) — rendering is
 * blocked at generation time by useSubscriptionLimits.checkCanGenerate().
 * Paid users below the required tier see a locked card on the dashboard.
 *
 * Tier targeting:
 *   Starter   → ColorPro, MyVehiclePro (mode), PatternPro,
 *               RestyleLibrary, FadeWraps, Gallery, CreatorMarket,
 *               QuickQuote (50 renders shared, $10 overage)
 *   Pro       → + ApprovePro, PrintPro, ProductionFlow,
 *               RevisionStudioIQ, WrapBox, MightyMail
 *   DesignPro → + DesignPro, GraphicsPro (anchor creative tier)
 */
export const TOOL_TIER_REQUIREMENTS: Record<string, Tier> = {
  // Starter ($199) — five featured render tools + browsing + quote entry
  colorpro: "starter",
  patternpro: "starter",
  fadewraps: "starter",
  restylelibrary: "starter",
  gallery: "starter",
  creatormarket: "starter",
  quickquote: "starter",
  seopro: "starter",
  // (MyVehiclePro is a mode inside ColorPro/FadeWraps/PatternPro — not a
  //  standalone tool key, so no entry needed. It's accessible whenever
  //  a user can open one of its host render tools.)

  // Pro ($299) — full business toolkit on top of Starter
  wrapbox: "advanced",
  mightymail: "advanced",
  approvepro: "advanced",
  printpro: "advanced",
  revisionstudio: "advanced",
  productionflow: "advanced",

  // DesignPro ($699) — anchor creative tier
  designpro: "complete",
  graphicspro: "complete",
  logopro: "complete",
};

export const useToolAccess = (toolName: string) => {
  const userTier = useUserTier() as Tier;
  const requiredTier = (TOOL_TIER_REQUIREMENTS[toolName] || "starter") as Tier;

  const userTierIndex = TIER_HIERARCHY.indexOf(userTier);
  const requiredTierIndex = TIER_HIERARCHY.indexOf(requiredTier);

  // Free tier gets "try it" mode on every tool (browses UI, paywall at render).
  // Paid users below the required tier are hard-locked.
  const isFree = userTier === "free";
  const hasAccess = userTierIndex >= requiredTierIndex;
  const isTryMode = isFree && !hasAccess;

  return {
    hasAccess,
    isTryMode,
    requiredTier,
    requiredTierLabel: TIER_LABELS[requiredTier],
    requiredTierPricing: TIER_PRICING[requiredTier],
    userTier,
    userTierLabel: TIER_LABELS[userTier],
    userTierPricing: TIER_PRICING[userTier],
    upgradeUrl: "/pricing",
  };
};
