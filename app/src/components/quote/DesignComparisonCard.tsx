/**
 * DesignComparisonCard — shows the website-pricing tiers next to the
 * one-off Full Wrap Design ($975) line item so the customer can see
 * the value of subscribing vs. paying à la carte.
 *
 * Reads from `tier-pricing-display.ts` (display-only). Does NOT touch
 * tier-limits.ts or any subscription enforcement code.
 */

import { Check } from "lucide-react";
import { DISPLAY_TIERS, DISPLAY_TIER_ORDER, formatTierPrice } from "@/lib/tier-pricing-display";
import { cn } from "@/lib/utils";

interface DesignComparisonCardProps {
  /** One-off design price (e.g. 975 for "Full Wrap Design"). */
  oneOffPrice: number;
  /** Optional: highlight a specific tier (currently selected by user). */
  highlightTier?: keyof typeof DISPLAY_TIERS;
  className?: string;
}

export function DesignComparisonCard({
  oneOffPrice,
  highlightTier,
  className,
}: DesignComparisonCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[#48484a] bg-rp-surface p-5 space-y-4",
        className,
      )}
    >
      <div>
        <div className="text-xs uppercase tracking-wide text-[#60A5FA]">
          Design pricing
        </div>
        <h3 className="text-lg font-semibold text-white mt-1">
          One-off vs. subscription
        </h3>
      </div>

      <div className="rounded-xl bg-black/40 border border-[#48484a] p-4">
        <div className="text-sm text-white/70">Full Wrap Design (one-off)</div>
        <div className="text-2xl font-bold text-white mt-1">
          ${oneOffPrice.toLocaleString()}
        </div>
        <div className="text-xs text-white/50 mt-1">
          Per project · concept + production-ready files
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {DISPLAY_TIER_ORDER.map((id) => {
          const tier = DISPLAY_TIERS[id];
          const isHighlight = highlightTier === id;
          return (
            <div
              key={id}
              className={cn(
                "rounded-xl border p-3 text-left",
                isHighlight
                  ? "border-[#60A5FA] bg-[#60A5FA]/5"
                  : "border-[#48484a] bg-black/30",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-white">{tier.label}</div>
                <div className="text-base font-bold text-[#60A5FA]">
                  {formatTierPrice(tier)}
                </div>
              </div>
              <div className="text-xs text-white/60 mt-1">{tier.tagline}</div>
              {tier.monthlyRenders != null && (
                <div className="flex items-center gap-1 text-xs text-white/70 mt-2">
                  <Check className="h-3 w-3 text-[#60A5FA]" />
                  {tier.monthlyRenders} renders / mo
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-white/40 leading-snug">
        Subscription pricing shown as marketed on the public pricing page.
        Render allowances on subscription billing are enforced separately.
      </p>
    </div>
  );
}
