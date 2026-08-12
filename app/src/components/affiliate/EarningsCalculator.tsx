import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { DollarSign, TrendingUp, Users, Star, Trophy } from "lucide-react";

const PLANS = [
  { name: 'Starter', price: 350 },
  { name: 'DesignPro Lite', price: 499 },
  { name: 'DesignPro Studio', price: 699 },
  { name: 'DesignPro Plus', price: 995 },
];

function getCommissionRate(referrals: number): { rate: number; tier: string; icon: any } {
  if (referrals >= 15) return { rate: 0.20, tier: 'Elite', icon: Trophy };
  if (referrals >= 5) return { rate: 0.15, tier: 'Growth', icon: TrendingUp };
  return { rate: 0.10, tier: 'Starter', icon: Star };
}

export function EarningsCalculator() {
  const [referrals, setReferrals] = useState(10);
  const [selectedPlan, setSelectedPlan] = useState(0);

  const avgPrice = PLANS[selectedPlan].price;
  const { rate, tier, icon: TierIcon } = getCommissionRate(referrals);
  const monthlyCommission = referrals * avgPrice * rate;
  const annualCommission = monthlyCommission * 12;

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-foreground">Earnings Calculator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Plan Selector */}
        <div>
          <label className="text-sm text-muted-foreground mb-2 block">Average Referred Plan</label>
          <div className="grid grid-cols-3 gap-2">
            {PLANS.map((plan, i) => (
              <button
                key={plan.name}
                onClick={() => setSelectedPlan(i)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  selectedPlan === i
                    ? 'bg-primary/20 border-primary text-primary'
                    : 'bg-muted border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {plan.name}
                <span className="block text-xs mt-0.5">${plan.price.toLocaleString()}/mo</span>
              </button>
            ))}
          </div>
        </div>

        {/* Referral Slider */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-muted-foreground">Active Referrals</label>
            <span className="text-lg font-bold text-primary">{referrals}</span>
          </div>
          <Slider
            value={[referrals]}
            onValueChange={([v]) => setReferrals(v)}
            min={1}
            max={100}
            step={1}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>1</span>
            <span>50</span>
            <span>100</span>
          </div>
        </div>

        {/* Tier Indicator */}
        <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-muted/50 border border-border">
          <TierIcon className="h-5 w-5 text-primary" />
          <span className="text-sm text-muted-foreground">
            Your tier:{" "}
            <span className="text-foreground font-semibold">{tier}</span>
            {" "}—{" "}
            <span className="text-primary font-bold">{(rate * 100).toFixed(0)}%</span> commission
          </span>
        </div>

        {/* Results */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-border">
          <div className="text-center p-4 rounded-lg bg-muted/50">
            <Users className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Referrals</p>
            <p className="text-2xl font-bold text-foreground">{referrals}</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-primary/10">
            <DollarSign className="h-5 w-5 mx-auto mb-1 text-primary" />
            <p className="text-xs text-muted-foreground">Monthly</p>
            <p className="text-2xl font-bold text-primary">${monthlyCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-green-500/10">
            <TrendingUp className="h-5 w-5 mx-auto mb-1 text-green-400" />
            <p className="text-xs text-muted-foreground">Annual</p>
            <p className="text-2xl font-bold text-green-400">${annualCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Based on {(rate * 100).toFixed(0)}% ({tier} tier) commission on {PLANS[selectedPlan].name} plan (${avgPrice.toLocaleString()}/mo)
        </p>
      </CardContent>
    </Card>
  );
}
