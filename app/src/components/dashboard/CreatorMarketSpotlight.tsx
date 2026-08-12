import { Link } from "react-router-dom";
import {
  Store,
  ArrowRight,
  Infinity as InfinityIcon,
  Stamp,
  Megaphone,
  Percent,
} from "lucide-react";
import { useUserTier } from "@/hooks/useUserTier";
import type { Tier } from "@/hooks/useToolAccess";
import { ToolWordmark } from "./ToolWordmark";

/**
 * Solo spotlight card for CreatorMarket — the RestylePro revenue channel.
 *
 * Business model (from Trish):
 *   - DesignPro-tier users create custom designs in DesignPro
 *   - Any custom design can be published to CreatorMarket
 *   - The marketplace is PUBLIC — anyone can browse and buy, no account
 *     needed, SEO-indexed, organic + paid traffic (Google + Meta ads)
 *   - Creators keep 60%, RestylePro takes 40% (reinvested into Google
 *     + Meta ads that drive paid traffic to every published design)
 *   - Unlimited sales per design — not a one-time license
 *   - Every delivered file is stamped with the creator's logo
 *
 * This is THE one card where the magenta→blue gradient covers the full
 * surface (everywhere else stays charcoal). It earns the pop because its
 * job — monetize your designs — is categorically different from every
 * other tool.
 *
 * Copy is tier-aware:
 *   - DesignPro tier: "Publish a design" primary CTA (they can actually sell)
 *   - Others:         "Browse marketplace" primary + "Upgrade to sell" hint
 */
export const CreatorMarketSpotlight = () => {
  const tier = useUserTier() as Tier;
  const canPublish = tier === "complete" || tier === "agency";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#48484a] bg-gradient-rp-pop p-5 sm:p-7">
      {/* Soft dark veil so text stays legible over the gradient */}
      <div className="absolute inset-0 bg-black/25 pointer-events-none" />

      <div className="relative grid gap-6 lg:grid-cols-[1fr,auto] items-center">
        {/* ── Left: headline + supporting copy + stat strip ── */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
              <Store className="w-4 h-4 text-white" />
            </div>
            <ToolWordmark toolKey="creatormarket" size="xl" />
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/20 text-white border border-white/30">
              Revenue
            </span>
          </div>

          <h3 className="font-montserrat text-xl sm:text-2xl md:text-3xl font-black text-white leading-tight mb-2">
            Your design. Our ads. <span className="text-white">60% yours, every sale.</span>
          </h3>

          <p className="text-sm sm:text-base text-white/90 leading-snug font-inter max-w-2xl">
            Publish any DesignPro creation to the public{" "}
            <strong className="text-white">CreatorMarket</strong>. Anyone can buy,
            no account required. You keep <strong className="text-white">60%</strong>{" "}
            of every sale — sell each design unlimited times. RestylePro reinvests
            the 40% into Google + Meta ads that drive paid traffic to your listing.
          </p>

          {/* ── Value-prop chips — why creators choose CreatorMarket ── */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-4">
            <Chip icon={Percent} label="60% creator payout" />
            <Chip icon={InfinityIcon} label="Unlimited sales per design" />
            <Chip icon={Stamp} label="Your logo on every delivery" />
            <Chip icon={Megaphone} label="40% funds Google + Meta ads" />
          </div>

          {!canPublish && (
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-black/30 border border-white/25 text-[11px] font-semibold text-white/95">
              <span className="text-white/70 uppercase tracking-wider text-[9px]">
                Tip
              </span>
              <span>
                Upgrade to <strong>DesignPro</strong> to publish your own designs
                and earn 60% per sale.
              </span>
            </div>
          )}
        </div>

        {/* ── Right: primary CTA stack ── */}
        <div className="flex flex-col gap-2 w-full lg:w-auto shrink-0">
          {canPublish ? (
            <>
              <Link
                to="/designpro?publish=1"
                className="inline-flex items-center justify-center w-full lg:w-auto px-6 py-3 rounded-lg bg-white text-[#0a0a0a] font-bold text-sm font-montserrat hover:bg-white/90 transition whitespace-nowrap"
              >
                Publish a design
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Link>
              <Link
                to="/creatormarket"
                className="inline-flex items-center justify-center w-full lg:w-auto px-6 py-2.5 rounded-lg bg-white/10 border border-white/30 text-white font-semibold text-xs font-montserrat hover:bg-white/20 transition whitespace-nowrap"
              >
                Browse marketplace
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/creatormarket"
                className="inline-flex items-center justify-center w-full lg:w-auto px-6 py-3 rounded-lg bg-white text-[#0a0a0a] font-bold text-sm font-montserrat hover:bg-white/90 transition whitespace-nowrap"
              >
                Browse marketplace
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Link>
              <Link
                to="/pricing"
                className="inline-flex items-center justify-center w-full lg:w-auto px-6 py-2.5 rounded-lg bg-white/10 border border-white/30 text-white font-semibold text-xs font-montserrat hover:bg-white/20 transition whitespace-nowrap"
              >
                Upgrade to sell
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Small value-prop chip ───────────────────────────────────────────
const Chip = ({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) => (
  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/15 border border-white/25 text-[11px] font-semibold text-white font-inter">
    <Icon className="w-3 h-3" />
    {label}
  </span>
);
