/**
 * Tier Pricing Display — DISPLAY-ONLY website tier copy.
 *
 * The runtime tier source of truth is `tier-limits.ts` (starter /
 * advanced / complete / agency, 20/50/200 renders) and that powers
 * subscription enforcement. It is not safe to change.
 *
 * The public website (weprintwraps / restylepro pricing page) markets
 * the tier set: Starter / DesignPro Lite / DesignPro Studio / DesignPro
 * Plus at $350 / $499 / $699 / $995. This file exists ONLY so the
 * QuickQuote comparison panel can show the website prices the customer
 * actually sees, mirroring TIER_PRICING in useToolAccess.ts.
 *
 * DO NOT import this for billing, gating, or render-limit enforcement.
 * Use `tier-limits.ts` for anything that touches real subscription
 * state.
 */

export type DisplayTierId = "starter" | "pro" | "designpro" | "designpro_plus";

export interface DisplayTier {
  id: DisplayTierId;
  label: string;
  /** Monthly price in USD as shown on the website. */
  priceMonthly: number;
  /** Marketed monthly render allowance (null = not advertised by count). */
  monthlyRenders: number | null;
  /** Short tagline shown under the tier name in comparison cards. */
  tagline: string;
}

export const DISPLAY_TIERS: Record<DisplayTierId, DisplayTier> = {
  starter: {
    id: "starter",
    label: "Starter",
    priceMonthly: 350,
    monthlyRenders: 50,
    tagline: "Every visualizer in one suite + 50 renders/mo",
  },
  pro: {
    id: "pro",
    label: "DesignPro Lite",
    priceMonthly: 499,
    monthlyRenders: 75,
    tagline: "Full DesignPro toolkit + 75 renders/mo",
  },
  designpro: {
    id: "designpro",
    label: "DesignPro Studio",
    priceMonthly: 699,
    monthlyRenders: 150,
    tagline: "Real human designer + 150 renders/mo",
  },
  designpro_plus: {
    id: "designpro_plus",
    label: "DesignPro Plus",
    priceMonthly: 995,
    monthlyRenders: 300,
    tagline: "Priority 24h turnaround + 300 renders/mo",
  },
};

export const DISPLAY_TIER_ORDER: DisplayTierId[] = [
  "starter",
  "pro",
  "designpro",
  "designpro_plus",
];

export function formatTierPrice(tier: DisplayTier): string {
  return `$${tier.priceMonthly}/mo`;
}
