/**
 * Tier Limits — single source of truth for subscription tiers.
 *
 * Mirrors what useSubscriptionLimits.ts enforces at runtime. Any UI
 * that labels tier quantities (e.g. the QuickQuote Design-Tools
 * upsell dropdown) should import from here so the label can never
 * drift from what the app actually allows.
 *
 * Public tiers (customer-purchasable, fixed monthly quantities):
 *   starter, advanced, complete.
 *
 * Agency is a custom enterprise tier — limit is set per-customer and
 * not displayed in customer-facing upsell captions. It also covers
 * internal admin + tester roles, which bypass limits via the
 * isAllowlistedAdmin short-circuit in useSubscriptionLimits.
 *
 * NOTE: productizing Agency-as-custom for real enterprise customers
 * needs a user_subscriptions.custom_render_limit column + a read
 * path through useSubscriptionLimits. Until that lands, Agency users
 * get the 999999 effectively-unlimited allowance used by admin/tester.
 */

export type PublicTier = "starter" | "advanced" | "complete";
export type Tier = "free" | PublicTier | "agency";

export interface TierMeta {
  id: Tier;
  label: string;
  /** Monthly render limit. null = custom / unlimited (Agency only). */
  monthlyRenders: number | null;
}

export const TIERS: Record<Tier, TierMeta> = {
  free: { id: "free", label: "Free", monthlyRenders: 0 },
  starter: { id: "starter", label: "Starter", monthlyRenders: 20 },
  advanced: { id: "advanced", label: "Advanced", monthlyRenders: 50 },
  complete: { id: "complete", label: "Complete", monthlyRenders: 200 },
  agency: { id: "agency", label: "Agency", monthlyRenders: null },
};

/** Tiers shown in pricing UI + upsell captions (Agency is internal). */
export const PUBLIC_TIERS: PublicTier[] = ["starter", "advanced", "complete"];

/** Human label for a tier's monthly render allowance. */
export function formatRenderLimit(tier: Tier): string {
  const limit = TIERS[tier].monthlyRenders;
  if (tier === "agency") return "Custom";
  if (limit == null) return "Unlimited";
  if (limit === 0) return "0 / mo";
  return `${limit} / mo`;
}


