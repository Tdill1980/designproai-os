/**
 * DesignProductsCompareCard
 *
 * Side-by-side design pricing comparison shown on every QuickQuote and
 * design-tool estimator. Left panel is WePrintWraps' a-la-carte design
 * pricing (real WooCommerce SKUs — anchor for what design typically
 * costs in the wrap industry). Right panel is the DesignProAI tier the
 * user is on (or could subscribe to) — bundled designs/renders for a
 * flat monthly fee.
 *
 * Renders for everyone: WPW tenants see "free for you" framing; non-
 * WPW shops see the same data as a market-rate anchor that nudges
 * them to upgrade their RP tier. Copy adapts based on isWpw.
 */
import { useNavigate } from "react-router-dom";
import {
  ExternalLink,
  Sparkles,
  Crown,
  Check,
  ArrowRight,
  Store,
  Infinity as InfinityIcon,
  Megaphone,
  BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import { useUserTier } from "@/hooks/useUserTier";
import {
  TIER_HIERARCHY,
  TIER_LABELS,
  TIER_PRICING,
  type Tier,
} from "@/hooks/useToolAccess";
import {
  WPW_DESIGN_PRODUCTS,
  buildWpwDesignCartUrl,
} from "@/lib/wpw-design-products";

interface DesignProductsCompareCardProps {
  className?: string;
}

const fmtMoney = (n: number) => `$${n.toLocaleString()}`;

const CUSTOMER_TIERS: Tier[] = TIER_HIERARCHY.filter(
  (t) => !TIER_PRICING[t].hidden,
);

export function DesignProductsCompareCard({
  className,
}: DesignProductsCompareCardProps) {
  const navigate = useNavigate();
  const { data: isWpw = false } = useIsWpwTenant();
  const currentTier = useUserTier() as Tier;

  const wpwTotal = WPW_DESIGN_PRODUCTS.reduce((sum, p) => {
    return sum + p.price * (p.minQuantity ?? 1);
  }, 0);

  const allWpwIds = WPW_DESIGN_PRODUCTS.map((p) => p.wooProductId);

  return (
    <div
      className={cn(
        "rounded-2xl border border-[#48484a] bg-rp-surface p-4 sm:p-5",
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">
            WPW Design Products
          </div>
          <h3 className="text-base font-bold text-white leading-tight mt-0.5">
            Pay-per-job at WePrintWraps vs. subscribe to a DesignProAI tier
          </h3>
          <p className="text-[11px] text-white/50 mt-1">
            Compare what design costs a-la-carte at WPW with what you'd pay
            monthly on DesignProAI — every tier below includes the same design
            work bundled in. Click a tier to subscribe.
          </p>
        </div>
        {isWpw && (
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
            <Sparkles className="w-3 h-3" />
            Free for WPW Family
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ─────────── WPW design products ─────────── */}
        <div className="rounded-xl border border-[#3a3a3c] bg-[#1c1c1e] p-3 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/60">
              {isWpw ? "WePrintWraps a-la-carte" : "What design typically costs"}
            </div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-white/30">
              Pay per job
            </div>
          </div>

          <ul className="space-y-1.5 flex-1">
            {WPW_DESIGN_PRODUCTS.map((p) => (
              <li
                key={p.slug}
                className="flex items-start justify-between gap-3 rounded-lg bg-[#2a2a2a] border border-[#3a3a3c] px-2.5 py-2"
              >
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-white leading-tight">
                    {p.label}
                  </div>
                  {p.fineprint && (
                    <div className="text-[10px] text-white/40 mt-0.5">
                      {p.fineprint}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0 flex items-center gap-1.5">
                  <div>
                    <div className="text-[13px] font-bold text-white leading-tight">
                      {fmtMoney(p.price)}
                    </div>
                    <div className="text-[9px] text-white/40 leading-tight">
                      {p.unit}
                    </div>
                  </div>
                  <a
                    href={buildWpwDesignCartUrl([p.wooProductId])}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Add to WPW cart"
                    className="p-1.5 rounded-md bg-[#1c1c1e] border border-[#3a3a3c] text-white/60 hover:text-white hover:border-white/20 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-2.5 pt-2.5 border-t border-[#3a3a3c] flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/40">
                Sample bundle min.
              </div>
              <div className="text-sm font-bold text-white">
                {fmtMoney(wpwTotal)}
              </div>
            </div>
            <a
              href={buildWpwDesignCartUrl(allWpwIds)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-bold uppercase tracking-wider text-cyan-300 hover:text-cyan-200 flex items-center gap-1"
            >
              All 3 to cart
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* ─────────── RP tier pricing ─────────── */}
        <div className="rounded-xl border border-[#3b82f6]/40 bg-gradient-to-br from-[#3b82f6]/10 via-[#8b5cf6]/5 to-[#ec4899]/10 p-3 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/70 flex items-center gap-1">
              <Crown className="w-3 h-3 text-[#ec4899]" />
              DesignProAI — included monthly
            </div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
              No per-design fees
            </div>
          </div>

          <ul className="space-y-1.5 flex-1">
            {CUSTOMER_TIERS.map((t) => {
              const p = TIER_PRICING[t];
              const isCurrent = t === currentTier;
              const isFree = t === "free";
              // DesignPro (complete) is the design-tier — describe the
              // full workflow: DesignPro AI designs from the shop's
              // prompt, the shop revises, and a real DesignProAI
              // graphic-design team member outputs the design on
              // vehicle templates as print-ready files. Bundles 1
              // Production Pack / mo, $299 each additional. Global
              // TIER_PRICING labels stay short for /pricing.
              const isDesignTier = t === "complete";
              const renderLine = isDesignTier
                ? "AI designs from your prompt · you revise · real designer outputs on vehicle templates"
                : p.renderLabel;
              const overageLine = isDesignTier
                ? "+$299 / extra print-ready Production Pack"
                : p.overageLabel;
              return (
                <li key={t}>
                  <button
                    type="button"
                    onClick={() => navigate("/pricing")}
                    className={cn(
                      "w-full text-left flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 border transition-colors hover:border-white/40 hover:bg-white/5",
                      isCurrent
                        ? "bg-emerald-500/10 border-emerald-500/40"
                        : "bg-[#2a2a2a] border-[#3a3a3c]",
                    )}
                  >
                    <div className="min-w-0 flex items-center gap-1.5">
                      {isCurrent && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/30 text-emerald-200 text-[8px] font-bold uppercase tracking-wider shrink-0">
                          <Check className="w-2.5 h-2.5 inline -mt-0.5" /> You
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-white leading-tight">
                          {TIER_LABELS[t]}
                        </div>
                        <div className="text-[10px] text-white/50 mt-0.5 truncate">
                          {renderLine}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 flex items-center gap-2">
                      <div>
                        <div className="text-[13px] font-bold text-white leading-tight">
                          {p.priceLabel}
                        </div>
                        {overageLine && (
                          <div className="text-[9px] text-white/40 leading-tight">
                            {overageLine}
                          </div>
                        )}
                      </div>
                      {!isFree && !isCurrent && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-0.5">
                          Subscribe
                          <ArrowRight className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-2.5 pt-2.5 border-t border-white/10">
            <Button
              size="sm"
              variant="default"
              onClick={() => navigate("/pricing")}
              className="w-full bg-gradient-to-r from-[#3b82f6] via-[#8b5cf6] to-[#ec4899] hover:brightness-110 text-white text-[11px] font-bold uppercase tracking-wider gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {currentTier === "free"
                ? "Subscribe to a tier"
                : "Compare tiers / upgrade"}
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Footer savings strip */}
      <div className="mt-3 space-y-1.5">
        <div className="text-[10px] text-white/50 leading-snug text-center">
          A single full wrap design on the open market is{" "}
          <span className="font-bold text-white">$500</span> — and at WPW the
          files stay with the print shop. Most DesignProAI tiers cost less than
          that <em>per month</em>, include unlimited design iterations + AI
          renders, and a real human designer signs off on every output.
        </div>
        <div className="text-[10px] text-cyan-200/80 leading-snug text-center">
          <span className="font-bold text-white">How DesignPro works:</span>{" "}
          DesignPro AI designs from your prompt → you revise until it's right →
          a real DesignProAI graphic-design team member outputs your design on
          vehicle templates and produces print-ready files. Production Packs
          are sold separately at{" "}
          <span className="font-bold text-white">
            $299 retail, $249 for Studio subscribers, $199 for Plus subscribers
          </span>
          .
        </div>
        <div className="text-[10px] text-emerald-300/90 leading-snug text-center font-semibold">
          The files are yours. That's your design equity — keep it, license
          it, send it to any printer.
        </div>
      </div>

      {/* CreatorMarket strip — every tier can publish, 60% creator
          payout, unlimited resales per design, free listings; the 40%
          platform cut funds Google + Meta ads that drive paid traffic
          to every published design. Turns design equity into a passive
          revenue stream. */}
      <div className="mt-3 rounded-xl border border-fuchsia-500/30 bg-gradient-to-r from-[#3b82f6]/15 via-[#8b5cf6]/15 to-[#ec4899]/15 p-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-200 flex items-center gap-1">
              <Store className="w-3 h-3" />
              CreatorMarket — your design equity, monetized
            </div>
            <p className="text-[11px] text-white/80 leading-snug mt-0.5">
              Publish any DesignPro creation to the public CreatorMarket.
              Anyone can buy — no account required. Sell the same design{" "}
              <span className="font-bold text-white">unlimited times</span> and
              keep <span className="font-bold text-white">60%</span> of every
              sale; the 40% platform cut funds Google + Meta ads that drive
              buyers to your listing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/creatormarket")}
            className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-white bg-white/10 hover:bg-white/20 border border-white/20 rounded-md px-2.5 py-1.5 flex items-center gap-1"
          >
            Browse
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        <ul className="grid grid-cols-2 gap-1.5 text-[10px] text-white/85">
          <li className="flex items-center gap-1.5">
            <BadgeCheck className="w-3 h-3 text-emerald-300 shrink-0" />
            <span>
              <span className="font-bold text-white">60%</span> creator payout
            </span>
          </li>
          <li className="flex items-center gap-1.5">
            <InfinityIcon className="w-3 h-3 text-cyan-300 shrink-0" />
            <span>
              <span className="font-bold text-white">Unlimited</span> resales
              per design
            </span>
          </li>
          <li className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-fuchsia-300 shrink-0" />
            <span>
              <span className="font-bold text-white">Free</span> to list — no
              fee, ever
            </span>
          </li>
          <li className="flex items-center gap-1.5">
            <Megaphone className="w-3 h-3 text-amber-300 shrink-0" />
            <span>40% funds Google + Meta ads</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

export default DesignProductsCompareCard;
