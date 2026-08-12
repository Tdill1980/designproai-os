import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Zap, Sparkles, Crown, Building2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface PricingTier {
  name: string;
  price: number;
  period: string;
  description: string;
  features: string[];
  icon: typeof Zap;
  isPopular?: boolean;
  highlight?: string;
}

const PRICING_TIERS: PricingTier[] = [
  {
    name: "Starter",
    price: 350,
    period: "/mo",
    description: "Solo wrappers, mobile installers, 1\u20132 person shops.",
    icon: Zap,
    features: [
      "ColorPro + PatternPro + FadeWraps + RestyleLibrary",
      "50 renders / month \u2014 combined across all tools",
      "$25 per token after cap",
      "Does NOT include MyVehiclePro \u2014 upgrade to Lite",
    ],
  },
  {
    name: "DesignPro Lite",
    price: 499,
    period: "/mo",
    description: "Brick-and-mortar shops doing customer-photo demos.",
    icon: Sparkles,
    features: [
      "Everything in Starter + MyVehiclePro",
      "ApprovePro + PrintPro + ProductionFlow + WrapBox",
      "75 renders / month \u2014 combined across all tools",
      "$25 per token after cap",
    ],
  },
  {
    name: "DesignPro Studio",
    price: 699,
    period: "/mo",
    description: "Working wrap shops scaling with a real human designer.",
    icon: Crown,
    isPopular: true,
    features: [
      "Real human graphic designer \u00b7 48-hr turnaround",
      "Full Design OS + GraphicsPro + RecreatePro",
      "150 renders / month \u2014 combined across all tools",
      "Production Packs sold separately \u00b7 $249 each at subscriber rate",
    ],
  },
  {
    name: "DesignPro Plus",
    price: 995,
    period: "/mo",
    description: "High-volume shops with priority needs.",
    icon: Building2,
    features: [
      "24-hour priority designer turnaround",
      "300 renders / month \u2014 combined across all tools",
      "Production Packs sold separately \u00b7 $199 each (best subscriber discount)",
      "CreatorMarket publisher — list and sell your wraps, keep 60% of every sale",
    ],
  },
];

interface PricingTiersSectionProps {
  /** Optional heading override */
  heading?: string;
  /** Optional subheading override */
  subheading?: string;
  /** Highlight a specific tier by name */
  highlightTier?: string;
  /** Compact mode for embedding in tool dashboards */
  compact?: boolean;
}

export const PricingTiersSection = ({
  heading = "Choose Your Plan",
  subheading = "From solo creators to full-service agencies - pick the plan that fits your shop.",
  highlightTier,
  compact = false,
}: PricingTiersSectionProps) => {
  const navigate = useNavigate();

  return (
    <section className={compact ? "py-12" : "py-16 md:py-20"}>
      <div className="container mx-auto px-4 sm:px-6">
        {/* Section Header */}
        <div className="text-center mb-10 space-y-3">
          <h2 className={`font-bold tracking-tight ${compact ? "text-2xl md:text-3xl" : "text-3xl md:text-4xl"}`}>
            <span className="text-foreground">{heading}</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            {subheading}
          </p>
        </div>

        {/* Tier Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 max-w-7xl mx-auto">
          {PRICING_TIERS.map((tier) => {
            const Icon = tier.icon;
            const isHighlighted = tier.isPopular || tier.name === highlightTier;

            return (
              <Card
                key={tier.name}
                className={`relative p-6 flex flex-col transition-all duration-200 hover:shadow-lg ${
                  isHighlighted
                    ? "border-primary border-2 shadow-lg shadow-primary/10 bg-card"
                    : "border-border bg-card hover:border-primary/40"
                }`}
              >
                {/* Badge */}
                {tier.isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap">
                    Most Popular
                  </div>
                )}
                {tier.highlight && !tier.isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-muted text-muted-foreground px-4 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap border border-border">
                    {tier.highlight}
                  </div>
                )}

                {/* Icon + Name */}
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isHighlighted ? "bg-primary/20" : "bg-muted"}`}>
                    <Icon className={`w-5 h-5 ${isHighlighted ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <h3 className="text-lg font-bold text-foreground">{tier.name}</h3>
                </div>

                {/* Price */}
                <div className="mb-3">
                  <span className="text-3xl font-bold text-foreground">
                    ${tier.price.toLocaleString()}
                  </span>
                  <span className="text-muted-foreground text-sm">{tier.period}</span>
                </div>

                {/* Description */}
                <p className="text-sm text-muted-foreground mb-4">
                  {tier.description}
                </p>

                {/* Features */}
                <ul className="space-y-2 mb-6 flex-1">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <Button
                  className="w-full"
                  variant={isHighlighted ? "default" : "outline"}
                  onClick={() => navigate("/pricing")}
                >
                  Get Started
                </Button>
              </Card>
            );
          })}
        </div>

        {/* Footer note */}
        <div className="text-center mt-8">
          <p className="text-sm text-muted-foreground">
            All plans month-to-month. No contracts. Cancel anytime.
          </p>
        </div>
      </div>
    </section>
  );
};
