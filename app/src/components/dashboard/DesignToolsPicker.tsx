/**
 * DesignToolsPicker
 *
 * Secondary dropdown rendered beneath the Print Products picker in
 * QuickQuote. Lists the six RestylePro design & visualization tools
 * (DesignPro, RecreatePro, PatternPro, RestyleLibrary, WallPro,
 * GraphicsPro) with a per-tier quantity caption so the shop can see
 * exactly what each paid tier includes — the compelling upgrade path
 * the owner wants to illustrate every time a WPW customer picks up
 * the quote tool.
 *
 * This picker never drives pricing. Selecting a tool records which
 * design workflow the shop will use for this quote; the line-item
 * pricing stays governed by the Print Products picker (film + labor
 * calc).
 */

import { Sparkles, ChevronDown, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DESIGN_TOOLS,
  findDesignTool,
  type DesignToolId,
} from "@/lib/quote-design-tools";
import { cn } from "@/lib/utils";

interface UpsellTier {
  name: string;
  nameSecondLine?: string;
  price: number;
  wpwPrice: number;
  rendersPerMonth: number;
  /** Stripe price ID for the standard (non-WPW) checkout. */
  stripePriceId: string;
  /** Stripe price ID for the WPW Family ($50 off) checkout. */
  stripePriceIdWpw: string;
  blurb: string;
  highlight?: "pro" | "plus";
}

// Four standalone tiers — Starter / DesignPro Lite / DesignPro Studio /
// DesignPro Plus. Stripe price IDs created via MCP. Render quota is
// SHARED across the entire suite (ColorPro, DesignProAI, GraphicsPro,
// PatternPro, FadeWraps, RestyleLibrary, MyVehiclePro, RevisionStudioIQ);
// $5/render after cap regardless of tier.
const UPSELL_TIERS: UpsellTier[] = [
  {
    name: "Starter",
    price: 350,
    wpwPrice: 300,
    rendersPerMonth: 50,
    stripePriceId: "price_1TTTzSH1V6OhfCAPGVZDZlZd",
    stripePriceIdWpw: "price_1TTTzhH1V6OhfCAP8VEk52tv",
    blurb: "Solo / mobile shops · AI tools only · no MyVehiclePro",
  },
  {
    name: "DesignPro",
    nameSecondLine: "Lite",
    price: 499,
    wpwPrice: 449,
    rendersPerMonth: 75,
    stripePriceId: "price_1TTUyoH1V6OhfCAPaIf5OMDW",
    stripePriceIdWpw: "price_1TTUyvH1V6OhfCAPddCu27xk",
    blurb: "Adds MyVehiclePro · sales-floor demos on real photos",
  },
  {
    name: "DesignPro",
    nameSecondLine: "Studio",
    price: 699,
    wpwPrice: 649,
    rendersPerMonth: 150,
    stripePriceId: "price_1TEFVxH1V6OhfCAPPATuqoGZ",
    stripePriceIdWpw: "price_1TTTzoH1V6OhfCAPqcDURY6T",
    blurb: "Real human designer · 48-hr · Production Packs $249 each (subscriber rate)",
    highlight: "pro",
  },
  {
    name: "DesignPro",
    nameSecondLine: "Plus",
    price: 995,
    wpwPrice: 945,
    rendersPerMonth: 300,
    stripePriceId: "price_1TTTzbH1V6OhfCAPkTef8yrl",
    stripePriceIdWpw: "price_1TTTzuH1V6OhfCAP9zEqAlBh",
    blurb: "24-hr priority · Production Packs $199 each (best subscriber discount)",
    highlight: "plus",
  },
];

interface DesignToolsPickerProps {
  /** Currently-selected tool id, or null for "no tool picked yet". */
  toolId: DesignToolId | null;
  onChange: (id: DesignToolId) => void;
  /**
   * When true, the caption up-sells RestylePro ("RestylePro Design &
   * Visualization Tools" with tier-qty breakdown). When false, the
   * heading matches the non-WPW branding ("Design Gen Tools"). Pricing
   * and behavior don't change between variants.
   */
  isWpwTenant: boolean;
  /** Compact variant used inside the dashboard QuickQuote card. */
  compact?: boolean;
}

export const DesignToolsPicker = ({
  toolId,
  onChange,
  isWpwTenant,
  compact = false,
}: DesignToolsPickerProps) => {
  const navigate = useNavigate();
  const selected = toolId ? findDesignTool(toolId) : undefined;

  // Click-through goes straight to /checkout with the correct Stripe
  // price id. WPW tenants get the $50-off price; everyone else gets
  // the standard. No /signup interstitial — one click to checkout.
  const handleUpgrade = (tier: UpsellTier) => {
    const priceId = isWpwTenant ? tier.stripePriceIdWpw : tier.stripePriceId;
    navigate(`/checkout?priceId=${encodeURIComponent(priceId)}`);
  };

  const heading = isWpwTenant
    ? "RestylePro Design & Visualization Tools"
    : "Design & Visualization Tools";

  const subheading = isWpwTenant
    ? "Render studios included with your RestylePro subscription."
    : "Choose the design workflow this quote will use.";

  const triggerCls = compact
    ? "h-9 text-xs bg-black border-[#48484a] text-white font-semibold"
    : "h-10 text-sm bg-black border-[#48484a] text-white font-semibold";

  return (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-md bg-black border border-[#48484a] flex items-center justify-center shrink-0">
        <Sparkles className="w-4 h-4 text-[#a855f7]" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <p
            className={cn(
              "font-semibold text-white",
              compact ? "text-xs" : "text-sm",
            )}
          >
            {heading}
          </p>
          <p className="text-[10px] text-white/55">{subheading}</p>
        </div>

        <Select
          value={selected?.id ?? ""}
          onValueChange={(v) => onChange(v as DesignToolId)}
        >
          <SelectTrigger
            className={triggerCls}
            aria-label="Design & visualization tool"
          >
            <SelectValue placeholder="Select a design tool…" />
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </SelectTrigger>
          <SelectContent className="bg-rp-surface border-[#48484a] text-white max-h-80">
            {DESIGN_TOOLS.map((t) => (
              <SelectItem key={t.id} value={t.id} className="text-xs">
                <div className="flex flex-col">
                  <span className="font-semibold">{t.name}</span>
                  <span className="text-[10px] text-white/60">
                    {t.description}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Tier upsell — 3 standalone plans, mirrors /pricing.
            Click → /signup?tier=<slug>, same path as the Pricing page CTAs.
            WPW Family customers see $50 off on every tier. */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/65">
              Pick a tier · click to subscribe
            </div>
            {isWpwTenant && (
              <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 whitespace-nowrap">
                WPW Family · $50 off
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {UPSELL_TIERS.map((tier) => {
              const isPro = tier.highlight === "pro";
              const isPlus = tier.highlight === "plus";
              return (
                <button
                  key={tier.name}
                  type="button"
                  onClick={() => handleUpgrade(tier)}
                  className={cn(
                    "group relative rounded-lg border p-2 text-left transition-all hover:scale-[1.02]",
                    isPlus
                      ? "border-fuchsia-500/70 bg-fuchsia-500/10 hover:bg-fuchsia-500/15"
                      : isPro
                        ? "border-[#60A5FA]/70 bg-[#60A5FA]/10 hover:bg-[#60A5FA]/15"
                        : "border-[#48484a] bg-black/40 hover:border-[#60A5FA]/60 hover:bg-[#60A5FA]/5",
                  )}
                >
                  {isPro && (
                    <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full text-[7px] font-bold uppercase tracking-wider bg-[#60A5FA] text-black whitespace-nowrap">
                      Most Popular
                    </span>
                  )}
                  {isPlus && (
                    <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full text-[7px] font-bold uppercase tracking-wider bg-gradient-rp-pop text-white whitespace-nowrap">
                      Special
                    </span>
                  )}
                  <div className="text-[10px] font-bold text-white leading-tight">
                    {tier.name}
                    {tier.nameSecondLine && (
                      <span
                        className={cn(
                          "ml-0.5",
                          isPlus ? "text-fuchsia-300" : "text-[#60A5FA]",
                        )}
                      >
                        {tier.nameSecondLine}
                      </span>
                    )}
                  </div>
                  <div className="font-montserrat text-base font-bold text-white leading-none mt-0.5 flex items-baseline gap-1">
                    <span>
                      ${isWpwTenant ? tier.wpwPrice : tier.price}
                      <span className="text-[8px] font-inter text-white/55 font-normal">
                        /mo
                      </span>
                    </span>
                    {isWpwTenant && (
                      <span className="text-[9px] font-inter text-white/40 line-through font-normal">
                        ${tier.price}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[9px] text-white/70 font-inter leading-snug">
                    {tier.blurb}
                  </div>
                  <div
                    className={cn(
                      "mt-1.5 inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider",
                      isPlus
                        ? "text-fuchsia-300"
                        : isPro
                          ? "text-[#60A5FA]"
                          : "text-white/80",
                    )}
                  >
                    Get {tier.name}
                    {tier.nameSecondLine ? ` ${tier.nameSecondLine}` : ""}
                    <ArrowRight className="w-2.5 h-2.5" />
                  </div>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => navigate("/pricing")}
            className="text-[9px] text-white/55 hover:text-white/80 underline font-inter"
          >
            Compare all tiers
          </button>
        </div>
      </div>
    </div>
  );
};
