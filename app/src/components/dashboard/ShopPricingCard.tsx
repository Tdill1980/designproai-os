import { Link } from "react-router-dom";
import { ArrowRight, SlidersHorizontal, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useShopServicePrices } from "@/hooks/useShopServicePrices";
import { SERVICE_DEFAULTS } from "@/lib/shop-service-defaults";

/**
 * ShopPricingCard — primes the user to set their own film, labor, margin,
 * and add-on prices. Without these, QuickQuote and the customer quote tool
 * fall back to catalog defaults — which most shops do not actually charge.
 *
 * Two states:
 *   - No overrides yet  → amber "Action needed" card pointing at /admin/shop-pricing
 *   - Overrides set     → quiet "X of Y services priced" card with edit CTA
 */
export const ShopPricingCard = () => {
  const { rows, isLoading } = useShopServicePrices();

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-[#48484a] bg-rp-surface p-5 h-full">
        <Skeleton className="h-32 w-full bg-rp-elevated" />
      </div>
    );
  }

  const totalServices = SERVICE_DEFAULTS.length;
  const pricedCount = rows.filter((r) => r.is_active).length;
  const isConfigured = pricedCount > 0;

  if (!isConfigured) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-rp-surface to-orange-500/5 p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
              <SlidersHorizontal className="w-4 h-4 text-amber-300" />
            </div>
            <h3 className="text-sm font-bold text-white uppercase tracking-[0.1em]">Shop Pricing</h3>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-amber-100 bg-amber-500/30">
            <AlertCircle className="w-3 h-3" />
            Action needed
          </span>
        </div>
        <p className="text-xs text-white/75 mb-4 font-inter leading-relaxed">
          QuickQuote and your customer quotes are using our catalog defaults
          for film, labor, margin, and add-ons. Set your own numbers once and
          every quote you build will use them.
        </p>
        <Button
          asChild
          size="sm"
          className="bg-gradient-to-r from-amber-400 to-orange-400 hover:opacity-90 text-black font-semibold w-full h-9 text-xs"
        >
          <Link to="/admin/shop-pricing">
            Set your shop pricing
            <ArrowRight className="w-3 h-3 ml-1" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#48484a] bg-rp-surface p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-rp-elevated border border-[#48484a] flex items-center justify-center">
            <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
          </div>
          <h3 className="text-sm font-bold text-white uppercase tracking-[0.1em]">Shop Pricing</h3>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-emerald-100 bg-emerald-500/25 border border-emerald-500/40">
          <CheckCircle2 className="w-3 h-3" />
          {pricedCount} of {totalServices} priced
        </span>
      </div>
      <p className="text-xs text-white/70 mb-4 font-inter leading-relaxed">
        Your numbers are wired into QuickQuote and the customer quote tool.
        Adjust film, labor, margin, or add-ons anytime.
      </p>
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="w-full justify-between text-white/80 hover:text-white hover:bg-rp-elevated h-8 text-xs font-semibold"
      >
        <Link to="/admin/shop-pricing">
          Edit shop pricing
          <ArrowRight className="w-3 h-3" />
        </Link>
      </Button>
    </div>
  );
};
