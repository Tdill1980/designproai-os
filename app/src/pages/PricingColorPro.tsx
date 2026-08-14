import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { trackViewContent, trackInitiateCheckout } from "@/lib/pixel";
import { SEOBreadcrumb } from "@/components/SEOBreadcrumb";
import {
  CheckCircle2,
  XCircle,
  ArrowRight,
  User,
  Clock,
  Package,
  Sparkles,
  DollarSign,
  Palette,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TIER_PRICING, DESIGNPRO_PLUS_PRICING } from "@/hooks/useToolAccess";
import { ToolWordmark } from "@/components/dashboard/ToolWordmark";
import { useToolImages } from "@/hooks/useToolImages";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLandingHeroRenders } from "@/hooks/useLandingHeroRenders";

/**
 * Hero product views — three labeled windows that tell the
 * "ColorPro → DesignPro → RevisionStudio" story above the pricing.
 *
 * Order is locked: (1) ColorPro smaller, (2) DesignPro anchor (large),
 * (3) RevisionStudioIQ smaller.
 *
 * Each slot points at /landing-hero/<name>.png FIRST, falling back to
 * the closest existing image in /public/. Drop the real PNGs at those
 * exact paths in /public/landing-hero/ and they replace automatically
 * with no code change.
 *
 * Expected files:
 *   public/landing-hero/colorpro.png        → ColorPro vehicle visualizer
 *   public/landing-hero/designpro.png       → Finished DesignProAI render
 *                                              (e.g. Forged Fitness Sienna)
 *   public/landing-hero/revisionstudio.png  → RevisionStudioIQ gallery grid
 */
const HERO_VIEWS: {
  src: string;
  fallbackSrc: string;
  label: string;
  urlPath: string;
  caption: string;
  size: "small" | "anchor";
}[] = [
  {
    src: "/landing-hero/colorpro.png",
    fallbackSrc: "/colorpro-hero-corvette.png",
    label: "ColorPro™",
    urlPath: "colorpro",
    caption: "Vehicle color visualization",
    size: "small",
  },
  {
    src: "/landing-hero/designpro.png",
    fallbackSrc: "/screenshots/porsche-distressed-hero.png",
    label: "DesignProAI™",
    urlPath: "designpro",
    caption: "AI-designed custom wraps · logos, photos, layout",
    size: "anchor",
  },
  {
    src: "/landing-hero/revisionstudio.png",
    fallbackSrc: "/screenshots/designproai-system.png",
    label: "DesignPro™",
    urlPath: "revision-studio",
    caption: "Design it. Panel it. Print it.",
    size: "small",
  },
];

/**
 * /pricing — 4 standalone tiers
 *
 *   Starter        $350/mo   Solo operators + mobile installers
 *   DesignPro Lite $499/mo   Brick-and-mortar shops — adds MyVehiclePro
 *   DesignPro Studio $699/mo Working wrap shops — real human designer
 *   DesignPro Plus $995/mo   High-volume — 24h priority turnaround
 *
 * Each card shows a single hero product image (the strongest visual
 * story for that tier) instead of a strip of tool thumbnails.
 */

// One hero image per card — replaces the messy multi-tile showcase
// strip. The chosen tool is the strongest visual story for that tier.
const TOOL_DISPLAY_LABEL: Record<string, string> = {
  designpro: "DesignProAI™",
  myvehiclepro: "MyVehiclePro™",
  colorpro: "ColorPro",
};

// Live Stripe price IDs per tier — single source of truth for the
// "Subscribe" CTAs on /pricing. Clicking a card sends the user
// straight to /checkout?priceId=... (Stripe Embedded Checkout) — no
// /signup detour. Checkout.tsx handles inline auth for new users.
// WPW founder traffic still gets WPW-FOUNDER auto-applied via the
// referral object in localStorage.
const TIER_PRICE_IDS: Record<string, string> = {
  starter: "price_1TTTzSH1V6OhfCAPGVZDZlZd",
  "designpro-lite": "price_1TTUyoH1V6OhfCAPaIf5OMDW",
  "designpro-studio": "price_1TEFVxH1V6OhfCAPPATuqoGZ",
  "designpro-plus": "price_1TTTzbH1V6OhfCAPkTef8yrl",
};

// Hardcoded hero image per tier card. Bypasses homepage_showcase
// (useToolImages) because the public /pricing page has no shop-scoped
// rows tagged 'section:tool-*'. These URLs render real product visuals
// instead of empty placeholders.
const HERO_IMAGE_BY_TIER: Record<string, string> = {
  // Starter card features ColorPro (heroToolKey: "colorpro") — use a
  // real ColorPro hero image, not a DesignPanelPro render.
  starter: "/colorpro-hero-corvette.png",
  // designpro-lite hero is sourced LIVE from homepage_showcase row
  // 'wpw-founder:tool-myvehiclepro' (uploaded via /admin/wpw-founder-assets)
  // so swapping the image is just an admin re-upload, no code change.
  // This URL is the static fallback if the query is loading or missing.
  "designpro-lite":
    "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/wpw-founder/myvehiclepro-1778253166069-IMG_6538.jpeg",
  // Studio's selling point is the real human designer + studio-quality
  // Design Approval Proof — show the multi-angle proof sheet, not a
  // single AI render.
  "designpro-studio": "/screenshots/production-proof.png",
  "designpro-plus":
    "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/renders/61cc6c1c-554c-440c-8e07-a64469f1f4eb/DesignPanelPro/ai-generated/1777400453571_restyle.jpg",
};

interface TierCardConfig {
  key: string;
  name: string;
  nameHighlight?: string; // suffix rendered in the gradient
  price: string;
  priceLabel: string;
  bestFor: string;
  description?: string;
  coreBenefit?: string;
  quantityCallout?: string;
  bullets: string[];
  heroToolKey: string; // the single tool image shown on the card
  heroBadge?: string; // optional badge over the image
  toolList: string[]; // tools/features included in this tier — rendered as chips
  renderLine: string;
  overageLine?: string;
  turnaround?: string;
  ctaLabel: string;
  ctaRoute: string;
  featured?: boolean;
  special?: boolean; // DesignPro Plus
  humanBadge?: boolean; // Real human graphic designer
}

const PricingColorPro = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ?promo=TROY10 (preferred) or legacy ?coupon=TROY10 — forwarded to
  // /checkout so create-checkout can resolve it against affiliate_coupons.
  // Sanitized to the same shape the edge function accepts.
  const incomingPromo = (
    searchParams.get("promo") ||
    searchParams.get("coupon") ||
    ""
  )
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 40);

  useEffect(() => {
    trackViewContent("Pricing", "pricing");
  }, []);

  // Pulls "section:tool-<key>" rows from homepage_showcase so we can
  // render the actual tagged tool render thumbnails on each tier card.
  // Returns {} on miss — tiles fall back to a wordmark cleanly.
  const { data: toolImages = {} } = useToolImages();

  // Pulls the LIVE WPW-founder asset rows uploaded via
  // /admin/wpw-founder-assets. Lets Trish swap any card hero from the
  // admin UI without a code change. Keyed by the suffix after the
  // 'wpw-founder:' prefix — e.g. 'tool-myvehiclepro' or 'productionpack'.
  // The 'tool-' prefix is also stripped so 'tool-designproai' is keyed
  // as just 'designproai'. Returns {} on miss.
  const { data: wpwFounderImages = {} } = useQuery<Record<string, string>>({
    queryKey: ["pricing-wpw-founder-images"],
    queryFn: async () => {
      const { data, error } = await (supabase as never as { from: (t: string) => any })
        .from("homepage_showcase")
        .select("name, image_url")
        .like("name", "wpw-founder:%")
        .eq("is_active", true);
      if (error || !data) return {};
      const map: Record<string, string> = {};
      for (const row of data as { name: string; image_url: string | null }[]) {
        const stripped = row.name
          .replace(/^wpw-founder:/, "")
          .replace(/^tool-/, "");
        if (stripped && row.image_url) map[stripped] = row.image_url;
      }
      return map;
    },
    staleTime: 60 * 1000,
    retry: false,
  });

  // 3 starred renders from RevisionStudioIQ (is_featured_hero=true) —
  // 1 ColorPro + 2 DesignProAI. Falls back to HERO_VIEWS defaults if
  // the query is loading or empty.
  const { data: liveHero } = useLandingHeroRenders();
  const heroViews = HERO_VIEWS.map((view, i) => {
    const live = liveHero?.[i];
    if (!live?.src) return view;
    return {
      ...view,
      src: live.src,
      caption: live.vehicle
        ? `${view.caption} · ${live.vehicle}`
        : view.caption,
    };
  });

  const starter = TIER_PRICING.starter;
  const pro = TIER_PRICING.advanced;
  const designpro = TIER_PRICING.complete;
  const designproPlus = DESIGNPRO_PLUS_PRICING;

  const cards: TierCardConfig[] = [
    {
      key: "starter",
      name: "Starter",
      price: "$350",
      priceLabel: "/mo",
      bestFor: "Solo operators, mobile installers, 1-2 person shops",
      description:
        "The entry DesignPro plan — every visualizer in one suite so solo wrappers can pitch color, pattern, and fade concepts fast.",
      coreBenefit: "Every visualizer in one suite. Start pitching today.",
      quantityCallout: "50 renders + revisions / month",
      bullets: [
        "★ ColorPro + PatternPro + FadeWraps + RestyleLibrary — every visualizer in one suite",
        "✓ Gallery, QuickQuote, ShopEngine dashboard",
        "✓ 50 renders / month — shared across every tool, covers initial designs and revisions",
        "✓ $7 per render effective · $1,250 of work bundled into $350",
        "$$ CreatorMarket buyer access — license proven wraps from top shops, resell on customer jobs",
        "Does not include MyVehiclePro — upgrade to Lite for sales-floor demos",
        "$30 per extra token after cap (1 token = 1 render or revision)",
      ],
      heroToolKey: "colorpro",
      toolList: [
        "ColorPro",
        "PatternPro",
        "FadeWraps",
        "RestyleLibrary",
        "GraphicsPro",
        "RevisionStudioIQ",
        "Gallery",
        "QuickQuote",
        "CreatorMarket browse",
      ],
      renderLine: "50 tokens / month · 1 token = 1 render or revision",
      overageLine: "$30 per extra token after cap",
      ctaLabel: "Start with Starter",
      ctaRoute: "/signup?tier=starter",
    },
    {
      key: "designpro-lite",
      name: "DesignPro",
      nameHighlight: "Lite",
      price: "$499",
      priceLabel: "/mo",
      bestFor: "For growing wrap shops and installers",
      description:
        "The complete DesignPro toolkit — DesignProAI, MyVehiclePro, ApprovePro, PrintPro, and ProductionFlow — at a lower monthly render volume. You drive the design; step up to Studio for a real human designer and more capacity.",
      coreBenefit: "The full toolkit, sized for fewer jobs per month.",
      quantityCallout: "75 renders + revisions / month — lower-volume plan",
      bullets: [
        "✓ Everything in Starter",
        "★ DesignProAI — design custom AI wraps from scratch in any style",
        "★ MyVehiclePro — apply designs to your customer's actual vehicle photo on the sales floor",
        "★ ApprovePro + PrintPro + ProductionFlow + WrapBox + RevisionStudioIQ",
        "✓ 75 renders / month — shared across every tool, covers initial designs and revisions",
        "✓ $6.65 per render effective · $1,875 of work bundled into $499",
        "$$ CreatorMarket buyer access — license proven wraps from top shops",
        "$20 per extra token after cap (1 token = 1 render or revision, $10/token paying-tier discount)",
      ],
      heroToolKey: "myvehiclepro",
      heroBadge: "Sales-floor demo",
      toolList: [
        "Everything in Starter",
        "DesignProAI",
        "MyVehiclePro",
        "ApprovePro",
        "PrintPro",
        "ProductionFlow",
        "WrapBox",
        "RevisionStudioIQ",
      ],
      renderLine: "75 tokens / month · 1 token = 1 render or revision",
      overageLine: "$20 per extra token after cap (paying-tier discount)",
      ctaLabel: "Start with Lite",
      ctaRoute: "/signup?tier=designpro-lite",
      featured: true,
    },
    {
      key: "designpro-studio",
      name: "DesignPro",
      nameHighlight: "Studio",
      price: "$699",
      priceLabel: "/mo",
      bestFor: "For busy wrap shops managing more active customer projects",
      description:
        "Everything in Lite, plus increased monthly design volume, expanded workflow tools, and access to real designer-assisted production support.",
      coreBenefit: "More customer projects. More concepts. Faster workflow.",
      quantityCallout:
        "150 renders + revisions / month — more volume + production support",
      bullets: [
        "✓ Everything in Lite",
        "★ Real human graphic designer · 48-hour file turnaround on every Production Pack",
        "★ Full DesignPro Design OS + GraphicsPro + RecreatePro — the full creative stack",
        "$$ CreatorMarket publisher — list and sell your wraps to every DesignProAI shop, keep 60% of each sale",
        "✓ 150 renders / month — shared across every tool, covers initial designs and revisions",
        "✓ $4.66 per render effective · $3,750 of work bundled into $699",
        "✓ Overage stays at $20 / token — paying-tier discount",
        "Production Packs sold separately — Studio subscribers pay $249 each (save $50 vs $299 retail)",
      ],
      heroToolKey: "designpro",
      heroBadge: "Anchor",
      toolList: [
        "Everything in Lite",
        "DesignProAI",
        "Real human designer · 48h",
        "Full Design OS",
        "GraphicsPro",
        "RecreatePro",
        "CreatorMarket publish (60%)",
      ],
      renderLine: "150 tokens / month · 1 token = 1 render or revision",
      overageLine: "$20 per extra token after cap (paying-tier discount)",
      turnaround: "48-hour turnaround",
      ctaLabel: "Get DesignPro Studio",
      ctaRoute: "/signup?tier=designpro-studio",
      humanBadge: true,
    },
    {
      key: "designpro-plus",
      name: "DesignPro",
      nameHighlight: "Plus",
      price: "$995",
      priceLabel: "/mo",
      bestFor: "For high-volume wrap operations with priority workflow needs",
      description:
        "Everything in Studio with the highest monthly design volume, priority turnaround, and premium production support for wrap shops scaling aggressively.",
      coreBenefit: "Built for shops running multiple active wrap projects weekly.",
      quantityCallout:
        "300 renders + revisions / month — highest volume + priority turnaround",
      bullets: [
        "✓ Everything in Studio",
        "★ Priority 24-hour designer turnaround — front of the queue every time",
        "$$ CreatorMarket publisher — list and sell your wraps to every DesignProAI shop, keep 60% of each sale",
        "✓ 300 renders / month — shared across every tool, covers initial designs and revisions",
        "✓ $3.32 per render effective — our lowest rate · $7,500 of work bundled into $995",
        "✓ Overage stays at $15 / render — 40% off retail",
        "Production Packs sold separately — Plus subscribers pay $199 each (best subscriber discount, save $100 vs $299 retail)",
      ],
      heroToolKey: "designpro",
      heroBadge: "Top tier",
      toolList: [
        "Everything in Studio",
        "Priority 24h turnaround",
        "CreatorMarket publish (60%)",
        "Best pack discount",
      ],
      renderLine: "300 tokens / month · 1 token = 1 render or revision",
      overageLine: "$15 per extra token after cap (top-tier reward, ~40% off retail)",
      turnaround: "24-hour priority turnaround",
      ctaLabel: "Get DesignPro Plus",
      ctaRoute: "/signup?tier=designpro-plus",
      special: true,
      humanBadge: true,
    },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <Helmet>
        <title>Pricing — 4 Plans for Every Wrap Shop | DesignProAI</title>
        <meta
          name="description"
          content="Starter $350, DesignPro Lite $499 (adds MyVehiclePro + DesignProAI), DesignPro Studio $699 (real human designer), DesignPro Plus $995 (24-hr priority designer). Production Packs sold separately with subscriber discounts. 4 standalone plans. Render quota shared across all tools."
        />
      </Helmet>

      <SEOBreadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Pricing", href: "/pricing" },
        ]}
      />

      <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* ── Pricing header (TOP of page — pricing comes before the
            marketing hero so visitors can buy immediately) ── */}
        <div id="tier-grid-top" className="text-center mb-10 sm:mb-12 scroll-mt-24">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/60 mb-3">
            Pricing
          </div>
          <h1 className="font-montserrat text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.05] tracking-tight mb-4">
            Design.{" "}
            <span className="bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
              Output.
            </span>{" "}
            Profit.
          </h1>
          <p className="text-sm sm:text-base text-white/75 max-w-2xl mx-auto leading-relaxed">
            Four standalone plans. Pick one, cancel anytime.
          </p>
          <p className="mt-3 text-xs sm:text-sm text-cyan-200/80 max-w-2xl mx-auto leading-relaxed">
            <strong className="text-white">Each token = $25 retail value.</strong>{" "}
            One token covers a render OR a revision — no separate
            charge — across every tool on the platform:
            {" "}<strong className="text-white">ColorPro · DesignProAI · WallPro · PatternPro · FadeWraps · GraphicsPro · RevisionStudioIQ · MyVehiclePro</strong>.
            Every tier bundles tokens at a discounted effective rate
            below $25; overage tokens are priced per tier (Starter
            $30, Lite/Studio $20, Plus $15) so climbing the ladder
            makes every extra render cheaper.
          </p>
        </div>

        {incomingPromo && (
          <div className="max-w-2xl mx-auto -mt-4 mb-8 px-4 py-3 rounded-xl border border-cyan-400/40 bg-cyan-400/10 text-center text-sm text-cyan-100">
            Code{" "}
            <span className="font-mono font-bold tracking-wider">
              {incomingPromo}
            </span>{" "}
            will be applied at checkout.
          </div>
        )}

        {/* ── 4 tier grid (moved to top of page) ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 mb-16">
          {cards.map((card) => (
            <div
              key={card.key}
              className={cn(
                "relative rounded-2xl border p-5 sm:p-6 flex flex-col bg-white",
                (card.featured || card.special) && "pt-7 sm:pt-8",
                card.special
                  ? "border-fuchsia-400/70 shadow-[0_0_32px_rgba(217,70,239,0.18)]"
                  : card.featured
                  ? "border-fuchsia-400/60 shadow-[0_0_24px_rgba(217,70,239,0.14)] md:-translate-y-2"
                  : card.key === "starter"
                  ? "border-cyan-400/60 shadow-[0_0_22px_rgba(34,211,238,0.12)]"
                  : card.key === "designpro-lite"
                  ? "border-blue-400/60 shadow-[0_0_24px_rgba(59,130,246,0.14)]"
                  : "border-slate-200 shadow-sm"
              )}
            >
              {/* Top gradient accent bar — color identity per tier */}
              <div
                className={cn(
                  "absolute top-0 left-0 right-0 h-2 rounded-t-2xl",
                  card.special
                    ? "bg-gradient-to-r from-blue-600 via-fuchsia-500 to-pink-500"
                    : card.featured
                    ? "bg-gradient-to-r from-blue-500 via-fuchsia-500 to-fuchsia-600"
                    : "bg-gradient-to-r from-blue-500 to-fuchsia-500"
                )}
              />
              {card.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em] px-3 py-1 rounded-full text-white bg-gradient-rp-pop border border-fuchsia-400/60">
                    Most popular
                  </span>
                </div>
              )}
              {card.special && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em] px-3 py-1 rounded-full text-white bg-gradient-rp-pop border border-fuchsia-400/60">
                    <Sparkles className="w-2.5 h-2.5" />
                    Special — top tier
                  </span>
                </div>
              )}

              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2 min-h-[28px]">
                {card.bestFor}
              </div>

              <h2 className="font-montserrat text-2xl sm:text-3xl font-bold leading-none tracking-tight mb-3">
                <span className="text-slate-900">{card.name}</span>
                {card.nameHighlight && (
                  <span className="bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
                    {card.nameHighlight}
                  </span>
                )}
              </h2>

              <div className="flex items-baseline gap-1 mb-3">
                <span className="font-montserrat text-4xl font-bold text-slate-900 tracking-tight">
                  {card.price}
                </span>
                <span className="text-sm text-slate-500 font-inter">
                  {card.priceLabel}
                </span>
              </div>

              {card.description && (
                <p className="text-xs sm:text-sm text-slate-600 font-inter leading-snug mb-3">
                  {card.description}
                </p>
              )}

              {card.coreBenefit && (
                <p className="text-sm font-semibold text-blue-700 font-inter leading-snug mb-3">
                  {card.coreBenefit}
                </p>
              )}

              {card.quantityCallout && (
                <div className="flex items-start gap-2 mb-3 px-2.5 py-2 -mx-0.5 rounded-lg bg-gradient-to-r from-blue-500/10 to-fuchsia-500/10 border border-blue-400/40">
                  <Layers className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-800 leading-tight">
                    {card.quantityCallout}
                  </span>
                </div>
              )}

              {(card.humanBadge || card.turnaround) && (
                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  {card.humanBadge && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gradient-rp-pop text-white text-[10px] font-bold uppercase tracking-wide">
                      <User className="w-2.5 h-2.5" />
                      Real human designer
                    </span>
                  )}
                  {card.turnaround && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-bold uppercase tracking-wide">
                      <Clock className="w-2.5 h-2.5" />
                      {card.turnaround}
                    </span>
                  )}
                </div>
              )}

              {(() => {
                const heroLabel =
                  TOOL_DISPLAY_LABEL[card.heroToolKey] ?? card.heroToolKey;
                // Map the card's heroToolKey to the matching admin
                // upload slot in /admin/wpw-founder-assets.
                //   - DesignProStudio + Plus both have heroToolKey
                //     "designpro" so the literal lookup collides.
                //     Plus needs its OWN image (top-tier render)
                //     distinct from Studio's, so we key Plus off
                //     card.key first.
                //   - The "designpro" slot is stored as "designproai"
                //     in the DB; alias it so Studio still pulls the
                //     shared DesignProAI hero image.
                const wpwFounderKey =
                  card.key === "designpro-plus"
                    ? "designproplus"
                    : card.heroToolKey === "designpro"
                    ? "designproai"
                    : card.heroToolKey;
                const heroImage =
                  // Resolution order (first hit wins):
                  //   1) Hardcoded URL per tier (locked, code-controlled)
                  //   2) Live WPW-founder admin upload (Trish-editable)
                  //   3) Generic homepage_showcase tool tile
                  HERO_IMAGE_BY_TIER[card.key] ??
                  wpwFounderImages[wpwFounderKey] ??
                  toolImages[card.heroToolKey];
                return (
                  <div className="mb-4 pt-3 border-t border-slate-200">
                    <div className="relative w-full aspect-[16/9] rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                      {heroImage ? (
                        <img
                          src={heroImage}
                          alt={heroLabel}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-base font-bold bg-gradient-to-r from-blue-400 to-fuchsia-400 bg-clip-text text-transparent">
                            {heroLabel}
                          </span>
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/85 via-black/50 to-transparent" />
                      <div className="absolute inset-x-0 bottom-0 px-3 py-2">
                        <div className="text-xs font-bold text-white leading-tight">
                          {heroLabel}
                        </div>
                        {card.heroBadge && (
                          <div className="text-[9px] uppercase tracking-wider font-bold text-fuchsia-300">
                            {card.heroBadge}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {card.toolList.length > 0 && (() => {
                // Per-tier gradient identity for the "What's included"
                // chips so each card reads at a glance.
                const chipGradient = card.special
                  ? "from-fuchsia-500/25 via-pink-500/20 to-rose-500/25 border-fuchsia-400/40"
                  : card.featured
                  ? "from-fuchsia-500/25 to-purple-500/25 border-fuchsia-400/40"
                  : card.key === "starter"
                  ? "from-cyan-500/25 to-blue-500/25 border-cyan-400/40"
                  : card.key === "designpro-lite"
                  ? "from-blue-500/25 to-purple-500/25 border-blue-400/40"
                  : "from-zinc-500/20 to-zinc-700/20 border-zinc-500/40";
                return (
                  <div className="mb-4">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-2">
                      What's included
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {card.toolList.map((tool) => (
                        <span
                          key={tool}
                          className={cn(
                            "inline-flex items-center px-2 py-1 rounded-md bg-gradient-to-r border text-[11px] font-semibold text-slate-800 leading-none",
                            chipGradient
                          )}
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <ul className="flex-1 flex flex-col gap-2 mb-5 pt-3 border-t border-slate-200">
                {card.bullets.map((bullet, i) => {
                  // Bullet kinds — first marker wins.
                  //   ✗ → not included (red X, dimmed)
                  //   $ → revenue-generating feature (amber accent + dollar icon)
                  //   ★ → designer / creative tool (fuchsia accent + palette icon)
                  //   ✓ or no prefix → standard included feature (blue check)
                  const trimmed = bullet.trim();
                  const isExcluded = trimmed.startsWith("✗");
                  const isRevenue = trimmed.startsWith("$$");
                  const isDesigner = trimmed.startsWith("★");
                  const label = bullet.replace(/^\s*(✗|✓|\$\$|★)\s*/, "");

                  if (isRevenue) {
                    return (
                      <li
                        key={i}
                        className="flex items-start gap-2 px-2 py-1.5 -mx-1 rounded-md bg-gradient-to-r from-amber-500/15 to-yellow-500/10 border border-amber-500/40 text-xs font-inter leading-snug text-slate-800"
                      >
                        <DollarSign className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <span>
                          <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-amber-600 mr-1.5 align-middle">
                            Revenue
                          </span>
                          {label}
                        </span>
                      </li>
                    );
                  }

                  if (isDesigner) {
                    return (
                      <li
                        key={i}
                        className="flex items-start gap-2 px-2 py-1.5 -mx-1 rounded-md bg-gradient-to-r from-fuchsia-500/15 to-blue-500/10 border border-fuchsia-500/40 text-xs font-inter leading-snug text-slate-800"
                      >
                        <Palette className="w-3.5 h-3.5 text-fuchsia-600 shrink-0 mt-0.5" />
                        <span>
                          <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-fuchsia-600 mr-1.5 align-middle">
                            Designer
                          </span>
                          {label}
                        </span>
                      </li>
                    );
                  }

                  return (
                    <li
                      key={i}
                      className={cn(
                        "flex items-start gap-2 text-xs font-inter leading-snug",
                        isExcluded ? "text-slate-400" : "text-slate-700"
                      )}
                    >
                      {isExcluded ? (
                        <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                      )}
                      <span>{label}</span>
                    </li>
                  );
                })}
              </ul>

              <button
                onClick={() => {
                  const priceValue =
                    Number(card.price.replace(/[^\d.]/g, "")) || 0;
                  trackInitiateCheckout(priceValue);
                  const priceId = TIER_PRICE_IDS[card.key];
                  if (!priceId) {
                    navigate(card.ctaRoute);
                    return;
                  }
                  const tierLabel = card.nameHighlight
                    ? `${card.name} ${card.nameHighlight}`
                    : card.name;
                  const params = new URLSearchParams({
                    priceId,
                    tier: tierLabel,
                  });
                  if (incomingPromo) {
                    params.set("coupon", incomingPromo);
                  }
                  navigate(`/checkout?${params.toString()}`);
                }}
                className={cn(
                  "w-full h-11 rounded-xl font-bold text-sm font-montserrat transition inline-flex items-center justify-center gap-1.5",
                  card.featured || card.special
                    ? "bg-gradient-rp-pop hover:brightness-110 text-white"
                    : "bg-slate-900 text-white hover:bg-slate-800"
                )}
              >
                {card.ctaLabel}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* ── Hero — Meet your new design + marketing engine ── */}
        <section className="relative mb-16 sm:mb-20">
          {/* Background glow */}
          <div
            aria-hidden
            className="absolute inset-0 -z-10 overflow-hidden rounded-3xl"
          >
            <div className="absolute -top-32 -left-20 w-[480px] h-[480px] rounded-full bg-cyan-500/15 blur-3xl" />
            <div className="absolute -bottom-32 -right-20 w-[480px] h-[480px] rounded-full bg-fuchsia-500/15 blur-3xl" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(0,199,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(0,199,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center pt-6 sm:pt-10">
            {/* Copy */}
            <div className="lg:col-span-5 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 mb-5">
                <Sparkles className="w-3 h-3" />
                DesignProAI™ · Vehicle Wrap Design System
              </div>
              <h1 className="font-montserrat text-4xl sm:text-5xl md:text-[3.4rem] font-bold leading-[1.02] tracking-tight mb-5">
                Meet Your New Vehicle Wrap{" "}
                <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
                  Design and Marketing Engine
                </span>
              </h1>
              <p className="text-base sm:text-lg text-white/85 leading-relaxed mb-3 max-w-xl lg:max-w-none mx-auto">
                <span className="italic">
                  Like having a graphic designer trained in{" "}
                  <strong className="not-italic text-white">Photoshop</strong> and{" "}
                  <strong className="not-italic text-white">Adobe Illustrator</strong>{" "}
                  at your fingertips.
                </span>
              </p>
              <p className="text-sm sm:text-base text-cyan-300/90 font-semibold mb-7 max-w-xl lg:max-w-none mx-auto">
                ★ Built specifically for wrap shops.
              </p>

              <div className="flex flex-col sm:flex-row items-center lg:items-start lg:justify-start justify-center gap-3 mb-6">
                <button
                  onClick={() => navigate("/signup")}
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full font-bold text-sm font-montserrat uppercase tracking-[0.08em] text-white bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:brightness-110 shadow-[0_12px_36px_rgba(217,70,239,0.35),0_4px_16px_rgba(0,199,255,0.35)] transition"
                >
                  Enter DesignProAI™
                  <ArrowRight className="w-4 h-4" />
                </button>
                <a
                  href="#tier-grid"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full font-bold text-sm font-montserrat uppercase tracking-[0.08em] text-white/90 border border-white/20 hover:border-white/40 hover:bg-white/5 transition"
                >
                  See Plans
                </a>
              </div>

              <div className="inline-flex items-center gap-2 text-xs text-white/60">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <span>
                  DesignPro™ memberships from{" "}
                  <strong className="text-white">$350/mo</strong> · ProductionPacks™ from{" "}
                  <strong className="text-white">$299</strong>
                </span>
              </div>
            </div>

            {/* Staggered 3-up: ColorPro (small) → DesignPro (anchor) → RevisionStudio (small) */}
            <div className="lg:col-span-7">
              <HeroProductTriad views={heroViews} />
            </div>
          </div>
        </section>

        {/* ── À la carte — Production Packs (image card + pricing
            card sit side-by-side on md+, stack on mobile). The image
            is admin-editable via the 'Production Pack' slot in
            /admin/wpw-founder-assets and stays hidden until uploaded
            so we never ship an empty placeholder. ── */}
        <div
          className={cn(
            "grid gap-4 sm:gap-5 mb-10",
            wpwFounderImages["productionpack"]
              ? "grid-cols-1 md:grid-cols-2"
              : "grid-cols-1"
          )}
        >
          {wpwFounderImages["productionpack"] && (
            <div className="rounded-2xl border border-[#48484a] bg-[#1c1c1e] overflow-hidden">
              <div className="relative w-full h-full min-h-[220px] aspect-[16/9] md:aspect-auto bg-rp-elevated">
                <img
                  src={wpwFounderImages["productionpack"]}
                  alt="Production Pack"
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 px-5 sm:px-6 py-4">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-300 mb-1">
                    À la carte
                  </div>
                  <div className="font-montserrat text-xl sm:text-2xl font-bold text-white">
                    Production Pack
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-[#48484a] bg-[#1c1c1e] p-6 sm:p-8 flex">
            <div className="flex items-start justify-between flex-wrap gap-4 w-full">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-rp-elevated border border-[#48484a] flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5 text-[#60A5FA]" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/60 mb-1">
                    À la carte
                  </div>
                  <h3 className="font-montserrat text-xl font-bold text-white">
                    Production Packs
                  </h3>
                  <p className="text-sm text-white/75 font-inter mt-1 leading-snug">
                    A full print-ready panel pack for one vehicle, produced by
                    our real human graphic designer. Sold separately from every
                    subscription — Studio subscribers pay $249 each, Plus
                    subscribers pay $199 each, non-subscribers pay $299.
                    Revisions count against your monthly render total.
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-montserrat text-3xl sm:text-4xl font-bold text-white">
                  $299
                </div>
                <div className="text-xs text-white/60">each</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Marketing Add-Ons — bolt onto any tier ── */}
        <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-b from-cyan-500/5 to-transparent p-6 sm:p-8 mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.15em] px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              Add-ons
            </div>
          </div>
          <h3 className="font-montserrat text-xl sm:text-2xl font-bold text-white mb-2">
            Marketing engine.{" "}
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Bolt onto any plan.
            </span>
          </h3>
          <p className="text-sm text-white/60 mb-6">
            Your design tier stays clean — pick only the marketing tools you need.
            Add one, add all, cancel anytime. Everything integrates with your shop dashboard.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              {
                name: "QuoteTool",
                toolKey: "quotetool",
                price: "$99",
                comp: "3Dom Wraps: $249/mo",
                stat: "Average full wrap job: $3,500. One captured quote pays for a year of QuoteTool.",
                desc: "1,664-vehicle sq ft database. Regional labor rates. Branded customer quotes on your website 24/7 while you're in the booth.",
                route: "/quotetool",
              },
              {
                name: "BookingPro",
                toolKey: "bookingpro",
                price: "$59",
                comp: "Acuity: $26/mo (no vehicle data)",
                stat: "Online booking increases conversion 38%. SMS reminders cut no-shows 40%.",
                desc: "Customers self-book from any quote link. Deposits, reminders, no-show reduction. Each extra field on a form drops conversion 25%  — ours is 2 steps.",
                route: "/bookingpro",
              },
              {
                name: "QuickText",
                toolKey: "quicktext",
                price: "$199",
                comp: "Podium: $399+/mo",
                stat: "85% of missed callers never call back. Shops miss 62% of inbound calls. Each missed call = $1,200 in lost revenue.",
                desc: "Dedicated business number + AI voicemail transcription + auto-text with quote link in under 60 seconds. Parses vehicle make/model from voicemail.",
                route: "/never-miss-a-lead",
              },
              {
                name: "SeoPro",
                toolKey: "seopro",
                price: "$199",
                comp: "Semrush: $139/mo. SurferSEO: $99 for 5 articles.",
                stat: "SEO leads cost $31 vs $181 for PPC. Organic drives 53% of web traffic. SEO ROI: 748% long-term.",
                desc: "Unlimited AI blog posts auto-published to your WordPress. CTR sweep rewrites underperforming titles. Local landing pages for every city you serve.",
                route: "/seopro",
              },
              {
                name: "MightyMail",
                toolKey: "mightymail",
                price: "$99",
                comp: "Klaviyo: $150-300+/mo at real volume",
                stat: "45% of retargeting emails get opened. 50% of those convert. Top performers recover 10-14% of lost revenue.",
                desc: "Quote-aware retargeting. Knows which $4K wrap quote went cold 48 hours ago. Day-3 and day-7 drips with the actual vehicle and finish in the subject line.",
                route: "/mightymail",
              },
            ].map((addon: any) => (
              <div
                key={addon.name}
                className="rounded-xl border border-[#48484a] bg-[#1c1c1e] p-5 flex flex-col"
              >
                <h4 className="mb-1">
                  <ToolWordmark toolKey={addon.toolKey} size="lg" />
                </h4>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-2xl font-bold text-cyan-400">{addon.price}</span>
                  <span className="text-sm text-white/40">/mo</span>
                </div>
                {addon.comp && (
                  <div className="text-[10px] text-red-400/80 line-through mb-1">{addon.comp}</div>
                )}
                {addon.stat && (
                  <div className="text-[10px] text-emerald-400/90 leading-snug mb-2">{addon.stat}</div>
                )}
                <p className="text-xs text-white/50 flex-1 mb-4">{addon.desc}</p>
                <button
                  onClick={() => navigate(addon.route)}
                  className="w-full py-2 rounded-lg border border-cyan-500/30 text-cyan-400 text-sm font-semibold hover:bg-cyan-500/10 transition"
                >
                  Learn more
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-white/40 mt-4 text-center">
            Add one or add all — works with any design tier. Cancel anytime.
          </p>
          <div className="mt-6 pt-4 border-t border-white/5">
            <p className="text-[9px] text-white/25 leading-relaxed">
              Sources: Missed call cost data from{" "}
              <a href="https://www.dialora.ai/blog/missed-call-costs-smbs-revenue-loss-ai-solutions" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/40">Dialora</a> &{" "}
              <a href="https://www.oncehub.com/blog/the-true-cost-of-a-missed-call-for-small-businesses-and-how-to-stop-the-bleed" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/40">OnceHub</a>.
              {" "}SEO ROI data from{" "}
              <a href="https://seoprofy.com/blog/seo-roi-statistics/" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/40">SEOProfy</a> &{" "}
              <a href="https://blogs.workfx.ai/2026/04/21/organic-traffic-vs-paid-traffic-2026-growth-strategy-comparison/" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/40">WorkfxAI</a>.
              {" "}Email retargeting stats from{" "}
              <a href="https://www.emailvendorselection.com/cart-abandonment-rate-statistics/" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/40">EmailVendorSelection</a>.
              {" "}Booking conversion benchmarks from{" "}
              <a href="https://lunacal.ai/blogs/calendar-scheduling-benchmarks-report" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/40">LunaCal</a>.
              {" "}Wrap shop revenue data from{" "}
              <a href="https://financialmodelslab.com/blogs/profitability/vehicle-wrap" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/40">FinancialModelsLab</a>.
              {" "}Competitor pricing from{" "}
              <a href="https://www.g2.com/products/podium/pricing" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/40">G2 (Podium)</a>,{" "}
              <a href="https://mailsoftly.com/blog/klaviyo-pricing/" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/40">Mailsoftly (Klaviyo)</a>,{" "}
              <a href="https://ampifire.com/blog/semrush-subscription-cost-pricing-plans-in-2026/" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/40">Ampifire (Semrush)</a>.
              {" "}All figures reflect 2026 published data.
            </p>
          </div>
        </div>

        {/* ── Closer CTA ── */}
        <section className="relative my-14 sm:my-16">
          <div className="relative rounded-3xl border border-white/10 bg-gradient-to-br from-[#0e0e16] via-[#0a0a14] to-[#100515] p-8 sm:p-12 text-center overflow-hidden">
            <div
              aria-hidden
              className="absolute inset-0 -z-0 overflow-hidden rounded-3xl"
            >
              <div className="absolute -top-20 left-1/4 w-[400px] h-[400px] rounded-full bg-cyan-500/20 blur-3xl" />
              <div className="absolute -bottom-20 right-1/4 w-[400px] h-[400px] rounded-full bg-fuchsia-500/20 blur-3xl" />
            </div>
            <div className="relative">
              <h2 className="font-montserrat text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.05] tracking-tight mb-4">
                Custom Wrap Design.{" "}
                <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
                  Reimagined.
                </span>
              </h2>
              <p className="text-sm sm:text-base text-white/80 max-w-2xl mx-auto leading-relaxed mb-2">
                DesignPro™ memberships start at <strong className="text-white">$350/mo</strong>{" "}
                and give wrap shops access to powerful design, visualization, and proofing tools.
              </p>
              <p className="text-sm sm:text-base text-white/80 max-w-2xl mx-auto leading-relaxed mb-6">
                Need finalized output? <strong className="text-white">ProductionPacks™</strong>{" "}
                are just $299 with print-ready file ownership included.
              </p>
              <button
                onClick={() => navigate("/signup")}
                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full font-bold text-sm sm:text-base font-montserrat uppercase tracking-[0.08em] text-white bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:brightness-110 shadow-[0_16px_44px_rgba(217,70,239,0.4),0_6px_20px_rgba(0,199,255,0.4)] transition"
              >
                Enter DesignProAI™
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>

        {/* ── Footer fine print ── */}
        <div className="text-center text-xs text-white/50 font-inter max-w-2xl mx-auto">
          All plans billed monthly in USD. Cancel anytime from your billing
          settings. Render counts are shared across every tool in the plan.
          Admins and partners have internal unlimited access via role.
        </div>
      </div>
    </div>
  );
};

/**
 * Three product views in a "small → anchor → small" staggered cascade:
 *
 *   ┌──────────┐
 *   │ ColorPro │ small (top-left)
 *   └──────────┘
 *        ┌────────────────────┐
 *        │   DesignProAI      │ anchor (center, large)
 *        │    finished render │
 *        └────────────────────┘
 *                     ┌──────────────┐
 *                     │ RevisionStudio│ small (bottom-right)
 *                     └──────────────┘
 *
 * Each view is wrapped in a faux browser-window chrome so it reads as
 * "real product" rather than flat marketing art.
 */
function HeroProductTriad({ views }: { views: typeof HERO_VIEWS }) {
  if (views.length < 3) return null;
  const [colorpro, designpro, revisionstudio] = views;

  return (
    <div className="relative w-full aspect-[16/11]">
      {/* ColorPro — small, top-left */}
      <ProductWindow
        view={colorpro}
        accent="cyan"
        className="absolute top-0 left-0 w-[42%] aspect-[16/10] -rotate-[3deg] z-10"
      />
      {/* DesignPro — anchor, center, largest */}
      <ProductWindow
        view={designpro}
        accent="fuchsia"
        showLabelBadge
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[72%] aspect-[16/10] z-20 shadow-[0_30px_80px_rgba(217,70,239,0.25),0_0_0_1px_rgba(217,70,239,0.4)]"
      />
      {/* RevisionStudioIQ — small, bottom-right */}
      <ProductWindow
        view={revisionstudio}
        accent="cyan"
        className="absolute bottom-0 right-0 w-[44%] aspect-[16/10] rotate-[3deg] z-10"
      />
    </div>
  );
}

function ProductWindow({
  view,
  accent,
  showLabelBadge,
  className,
}: {
  view: typeof HERO_VIEWS[number];
  accent: "cyan" | "fuchsia";
  showLabelBadge?: boolean;
  className?: string;
}) {
  // Fall back from /landing-hero/<name>.png → fallbackSrc → solid bg.
  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.src.endsWith(view.fallbackSrc)) return;
    img.src = view.fallbackSrc;
  };
  const ringColor =
    accent === "fuchsia"
      ? "border-fuchsia-500/40"
      : "border-cyan-400/40";
  const tagBg =
    accent === "fuchsia"
      ? "from-fuchsia-500 to-cyan-500"
      : "from-cyan-500 to-fuchsia-500";

  return (
    <div className={cn("relative", className)}>
      {showLabelBadge && (
        <div
          className={cn(
            "absolute -top-3 left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] text-white bg-gradient-to-r shadow-[0_6px_16px_rgba(217,70,239,0.4)] whitespace-nowrap",
            tagBg
          )}
        >
          <Sparkles className="w-2.5 h-2.5" />
          {view.label}
        </div>
      )}
      <div
        className={cn(
          "w-full h-full rounded-xl overflow-hidden border bg-[#0e0e16] shadow-[0_18px_48px_rgba(0,0,0,0.55)]",
          ringColor
        )}
      >
        {/* Browser chrome */}
        <div className="h-5 sm:h-6 px-2.5 flex items-center gap-1.5 bg-[#15161f] border-b border-white/5">
          <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#ff5f57]" />
          <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#febc2e]" />
          <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#28c840]" />
          <span className="ml-1 text-[8px] sm:text-[9px] text-white/40 truncate">
            restyleproai.com / {view.urlPath}
          </span>
        </div>
        {/* Image */}
        <div className="relative w-full h-[calc(100%-1.5rem)]">
          <img
            src={view.src}
            alt={view.label}
            onError={handleError}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
          {/* Caption strip */}
          <div className="absolute inset-x-0 bottom-0 px-3 py-2 bg-gradient-to-t from-black/85 via-black/40 to-transparent">
            <div className="text-[10px] sm:text-[11px] font-bold text-white leading-tight">
              {view.label}
            </div>
            <div className="text-[9px] sm:text-[10px] text-white/70 leading-tight">
              {view.caption}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PricingColorPro;
