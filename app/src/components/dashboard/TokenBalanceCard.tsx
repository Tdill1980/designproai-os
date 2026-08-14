import { Link } from "react-router-dom";
import { Car, ArrowUpRight } from "lucide-react";
import { useUserTier } from "@/hooks/useUserTier";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import {
  TIER_LABELS,
  TIER_PRICING,
  DESIGNPRO_PLUS_PRICING,
  type Tier,
} from "@/hooks/useToolAccess";
import { cn } from "@/lib/utils";

// Free-tier courtesy grant. Lives outside TIER_PRICING because the free
// slug stores renderCount: 0 (the platform-level "try mode" semantic),
// while the UI promises 3 free renders on signup.
const FREE_TIER_TOKENS = 3;

const resolveCap = (tier: Tier, planLabel?: string | null): number => {
  if (tier === "agency") return Infinity;
  if (tier === "free") return FREE_TIER_TOKENS;
  // Plus customers ride the `complete` slug with a different Stripe
  // price ID. We detect them by the Stripe plan label sitting in the
  // subscription row (if your billing webhook stamps it).
  if (
    tier === "complete" &&
    planLabel &&
    /plus/i.test(planLabel)
  ) {
    return DESIGNPRO_PLUS_PRICING.renderCount;
  }
  return TIER_PRICING[tier].renderCount;
};

const resolveOverage = (tier: Tier, planLabel?: string | null): number => {
  if (tier === "agency" || tier === "free") return 0;
  if (
    tier === "complete" &&
    planLabel &&
    /plus/i.test(planLabel)
  ) {
    return DESIGNPRO_PLUS_PRICING.overage;
  }
  return TIER_PRICING[tier].overage;
};

interface TokenBalanceCardProps {
  className?: string;
}

/**
 * Dashboard widget — at-a-glance design-token balance.
 *
 * Tokens are the shared currency for every generative tool (ColorPro,
 * DesignProAI, GraphicsPro, PatternPro, FadeWraps, RevisionStudioIQ,
 * MyVehiclePro). The monthly cap renews on the user's billing cycle.
 * After the cap, each extra token is charged at the tier's overage
 * rate via Stripe metered billing.
 */
export const TokenBalanceCard = ({ className }: TokenBalanceCardProps) => {
  const tier = useUserTier() as Tier;
  const { subscription, loading } = useSubscriptionLimits();

  const planLabel =
    (subscription as unknown as { plan_label?: string | null })?.plan_label ??
    null;
  const cap = resolveCap(tier, planLabel);
  const overage = resolveOverage(tier, planLabel);
  const used = subscription?.render_count ?? 0;
  const isUnlimited = cap === Infinity;
  const remaining = isUnlimited ? Infinity : Math.max(0, cap - used);
  const pct = isUnlimited ? 0 : cap > 0 ? Math.min(100, (used / cap) * 100) : 0;

  const tierLabel =
    tier === "complete" && planLabel && /plus/i.test(planLabel)
      ? "DesignPro Plus"
      : TIER_LABELS[tier] ?? "Free";

  // Color thermometer — green > 50% remaining, amber 15-50%, red < 15%.
  const barColor = isUnlimited
    ? "from-cyan-400 to-fuchsia-500"
    : pct < 50
    ? "from-emerald-400 to-cyan-400"
    : pct < 85
    ? "from-amber-300 to-orange-400"
    : "from-rose-400 to-red-500";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-[#48484a] bg-rp-surface p-5 sm:p-6 flex flex-col h-full",
        className
      )}
    >
      {/* Header — label + tier badge */}
      <div className="relative flex items-center justify-between gap-2 mb-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
          Design Tokens
        </span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[9px] font-bold uppercase tracking-wide text-white/70">
          {tierLabel}
        </span>
      </div>

      {/* Centered branded coin */}
      <div className="relative flex justify-center mb-4">
        <div
          aria-label="One RestylePro design token — $25 retail value"
          className="relative w-16 h-16 rounded-full bg-gradient-to-br from-cyan-400/40 to-fuchsia-500/40 ring-2 ring-cyan-300/80 flex items-center justify-center shrink-0 shadow-[0_0_18px_rgba(34,211,238,0.55)]"
        >
          {/* Value + brand stacked in the center of the coin */}
          <div className="flex flex-col items-center leading-none select-none">
            <span className="text-[9px] font-bold tracking-[0.18em] text-cyan-200">
              RP
            </span>
            <span className="text-lg font-extrabold text-white tracking-tight">
              $25
            </span>
          </div>
          {/* Tiny car icon badge pinned to the bottom edge */}
          <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-black/85 border border-cyan-400/60 shadow-md">
            <Car className="w-3 h-3 text-cyan-200" strokeWidth={2.6} />
          </span>
        </div>
      </div>

      {/* Balance */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-xs text-white/40">
          Loading…
        </div>
      ) : (
        <>
          <div className="text-center mb-1">
            <span className="font-montserrat text-3xl font-bold text-white leading-none tracking-tight">
              {isUnlimited ? "∞" : remaining}
            </span>
            <div className="text-[11px] text-white/55 mt-1">
              {isUnlimited ? "unlimited tokens" : "tokens left"}
            </div>
          </div>
          <div className="text-center text-[10px] text-white/45 mb-3">
            {isUnlimited
              ? "Admin / partner access"
              : `${used}/${cap} used · ≈$${remaining * 25} retail value`}
          </div>

          {!isUnlimited && (
            <div className="relative w-full h-1.5 rounded-full bg-white/5 overflow-hidden mb-3">
              <div
                className={cn(
                  "h-full bg-gradient-to-r transition-all",
                  barColor
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {/* CTAs */}
          <div className="mt-auto flex flex-col gap-1.5 text-[11px]">
            <Link
              to="/billing"
              className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 transition"
            >
              Billing
              <ArrowUpRight className="w-3 h-3" />
            </Link>
            {tier !== "complete" && tier !== "agency" && (
              <Link
                to="/pricing"
                className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-300 hover:bg-fuchsia-500/20 transition"
              >
                Upgrade · ${overage}/token
                <ArrowUpRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
};
