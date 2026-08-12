import { ReactNode } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock, Check, Sparkles, Crown, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUserTier } from "@/hooks/useUserTier";
import { ShowcaseCarousel } from "@/components/ui/ShowcaseCarousel";

const TIER_LEVELS: Record<string, number> = {
  free: 0,
  starter: 1,
  advanced: 2,
  complete: 3,
  agency: 99,
};

const PRICE_IDS: Record<string, string> = {
  starter: "price_1TTTzSH1V6OhfCAPGVZDZlZd",
  advanced: "price_1TTUyoH1V6OhfCAPaIf5OMDW",
  complete: "price_1TEFVxH1V6OhfCAPPATuqoGZ",
};

const TIER_INFO: Record<string, { name: string; price: number; icon: typeof Zap; features: string[] }> = {
  starter: {
    name: "Starter",
    price: 350,
    icon: Zap,
    features: ["50 renders / mo (combined)", "ColorPro + PatternPro + FadeWraps + RestyleLibrary", "$25 per token"],
  },
  advanced: {
    name: "DesignPro Lite",
    price: 499,
    icon: Sparkles,
    features: ["75 renders / mo (combined)", "Adds MyVehiclePro for customer demos", "ApprovePro + PrintPro + ProductionFlow", "$25 per token"],
  },
  complete: {
    name: "DesignPro Studio",
    price: 699,
    icon: Crown,
    features: ["150 renders / mo (combined)", "Real human designer · 48-hr turnaround", "Full DesignPro Design OS + GraphicsPro", "Production Packs $249 each (subscriber rate)"],
  },
};

interface SubscriptionGateProps {
  children: ReactNode;
  toolName: string;
  requiredTier: "starter" | "advanced" | "complete";
}

export const SubscriptionGate = ({ children, toolName, requiredTier }: SubscriptionGateProps) => {
  const userTier = useUserTier();
  const navigate = useNavigate();

  const userLevel = TIER_LEVELS[userTier] ?? 0;
  const requiredLevel = TIER_LEVELS[requiredTier] ?? 1;
  const hasAccess = userLevel >= requiredLevel;

  if (hasAccess) {
    return <>{children}</>;
  }

  const handleSubscribe = (tier: string) => {
    const priceId = PRICE_IDS[tier];
    if (!priceId) return;
    navigate(`/checkout?priceId=${encodeURIComponent(priceId)}`);
  };

  // Show tiers at or above required level
  const tiersToShow = Object.entries(TIER_INFO).filter(
    ([key]) => (TIER_LEVELS[key] ?? 0) >= requiredLevel
  );

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden border-0 bg-transparent [&>button]:hidden">
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl border border-white/10 shadow-2xl">
          {/* Showcase */}
          <div className="px-6 pt-6">
            <ShowcaseCarousel />
          </div>

          {/* Header */}
          <div className="px-8 pt-4 pb-6 text-center border-b border-white/10">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-primary/20 rounded-full mb-3">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              Unlock {toolName}
            </h2>
            <p className="text-slate-400">
              Choose a plan to access {toolName} and start creating today
            </p>
          </div>

          {/* Pricing Cards */}
          <div className={`px-6 py-6 grid gap-4 ${tiersToShow.length === 1 ? 'grid-cols-1 max-w-sm mx-auto' : tiersToShow.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
            {tiersToShow.map(([tierKey, info]) => {
              const Icon = info.icon;
              const isRecommended = tierKey === requiredTier;
              return (
                <div
                  key={tierKey}
                  className={`relative rounded-xl p-5 border ${
                    isRecommended
                      ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  {isRecommended && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full">
                      Recommended
                    </span>
                  )}
                  <div className="flex items-center gap-2 mb-3">
                    <Icon className="w-5 h-5 text-primary" />
                    <h3 className="text-base font-semibold text-white">{info.name}</h3>
                  </div>
                  <div className="mb-3">
                    <span className="text-3xl font-bold text-white">${info.price}</span>
                    <span className="text-slate-400 text-sm">/mo</span>
                  </div>
                  <ul className="space-y-1.5 mb-4">
                    {info.features.map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-slate-300">
                        <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    variant={isRecommended ? "default" : "outline"}
                    onClick={() => handleSubscribe(tierKey)}
                  >
                    Subscribe Now
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-8 pb-6 text-center space-y-2">
            <p className="text-xs text-slate-500">
              Cancel anytime - No contracts
            </p>
            <button
              onClick={() => navigate("/pricing")}
              className="text-sm text-primary hover:text-primary/80 underline underline-offset-4"
            >
              Compare all plans
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
