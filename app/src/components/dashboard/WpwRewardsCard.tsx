import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Crown, Trophy, Star, Zap, Gift, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import { useIsWpwInternalStaff } from "@/hooks/useIsWpwInternalStaff";
import { useMyWpwOrders } from "@/hooks/useWpwOrders";

const db = supabase as never as { from: (t: string) => any };

function getRewardsTier(spend: number) {
  if (spend >= 10000) return { name: "Diamond", icon: Crown, color: "from-cyan-400 to-blue-500", progress: 100, next: null, nextAmount: 0 };
  if (spend >= 5000) return { name: "Gold", icon: Trophy, color: "from-amber-400 to-orange-500", progress: Math.round((spend / 10000) * 100), next: "Diamond", nextAmount: 10000 - spend };
  if (spend >= 2000) return { name: "Silver", icon: Star, color: "from-gray-300 to-gray-500", progress: Math.round((spend / 5000) * 100), next: "Gold", nextAmount: 5000 - spend };
  return { name: "Bronze", icon: Zap, color: "from-amber-600 to-amber-800", progress: Math.round((spend / 2000) * 100), next: "Silver", nextAmount: 2000 - spend };
}

const currency = (n: number) => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n); }
  catch { return `$${Math.round(n)}`; }
};

/** WPW internal team: aggregate spend across ALL customers. */
function useAllWpwStats(enabled: boolean) {
  return useQuery<{ count: number; spend: number }>({
    queryKey: ["wpw-all-rewards-admin"],
    enabled,
    queryFn: async () => {
      const { data, error } = await db
        .from("wpw_orders")
        .select("total");
      if (error) { console.warn("wpw all-rewards query:", error.message); return { count: 0, spend: 0 }; }
      let spend = 0;
      for (const o of (data || [])) spend += Number(o.total || 0);
      return { count: (data || []).length, spend };
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function WpwRewardsCard() {
  const navigate = useNavigate();
  const { data: isWpwTenant = false } = useIsWpwTenant();
  const { data: isWpwInternalStaff = false } = useIsWpwInternalStaff();
  const { data, isLoading } = useMyWpwOrders();
  const linked = data?.linked ?? false;
  const personalOrders = data?.orders || [];

  // PRIVACY: cross-tenant aggregate revenue is internal-staff only.
  // Onboarded WPW shop tenants see ONLY their own lifetime spend / rewards,
  // never other shops' aggregate revenue.
  const { data: allStats, isLoading: allLoading } = useAllWpwStats(isWpwInternalStaff);

  const isAdmin = isWpwInternalStaff;
  const loading = isAdmin ? allLoading : isLoading;

  const summary = useMemo(() => {
    if (isAdmin && allStats) {
      return { count: allStats.count, spend: allStats.spend, points: Math.round(allStats.spend / 10) };
    }
    let spend = 0;
    for (const o of personalOrders) spend += Number(o.total || 0);
    return { count: personalOrders.length, spend, points: Math.round(spend / 10) };
  }, [isAdmin, allStats, personalOrders]);

  const tier = getRewardsTier(summary.spend);
  const TierIcon = tier.icon;

  // Hide for non-WPW users who aren't linked
  if (!linked && !isWpwTenant) return null;

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#48484a] bg-rp-surface p-5 animate-pulse">
        <div className="h-5 w-32 bg-rp-elevated rounded mb-3" />
        <div className="h-8 w-48 bg-rp-elevated rounded mb-2" />
        <div className="h-2 w-full bg-rp-elevated rounded" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#48484a] bg-rp-surface overflow-hidden h-full">
      <div className={`h-1 bg-gradient-to-r ${tier.color}`} />
      <div className="p-6 sm:p-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-6">
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-[#D946EF]" />
            <span className="text-xs uppercase tracking-[0.2em] text-white/80 font-bold">
              Club WPW
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#D946EF]/20 text-[#D946EF] border border-[#D946EF]/30">
              {isAdmin ? "Admin View" : "Member"}
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate("/my-orders")}
            className="text-xs text-white/60 hover:text-[#3B82F6] hover:bg-rp-elevated rounded-xl hidden sm:flex"
          >
            View All Orders <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>

        {/* Main row: Tier badge + Stats grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 lg:gap-8 items-center">
          {/* Tier badge — big */}
          <div className="flex items-center gap-4">
            <div className={`w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br ${tier.color} flex items-center justify-center shrink-0 shadow-xl`}>
              <TierIcon className="w-10 h-10 sm:w-12 sm:h-12 text-white drop-shadow-md" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.15em] text-white/50 font-semibold mb-1">
                Current Tier
              </p>
              <span className={`text-3xl sm:text-4xl font-bold bg-gradient-to-r ${tier.color} bg-clip-text text-transparent`}>
                {tier.name}
              </span>
              <p className="text-sm text-white/60 mt-1">
                {currency(summary.spend)} {isAdmin ? "total revenue" : "lifetime spend"}
              </p>
            </div>
          </div>

          {/* Stats grid — bigger numbers */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-rp-elevated border border-[#48484a] p-4">
              <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider mb-1">
                {isAdmin ? "Revenue" : "Points"}
              </p>
              <p className="text-2xl font-bold bg-gradient-to-r from-[#3B82F6] to-[#D946EF] bg-clip-text text-transparent">
                {isAdmin ? currency(summary.spend) : summary.points.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-rp-elevated border border-[#48484a] p-4">
              <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider mb-1">Orders</p>
              <p className="text-2xl font-bold text-white">{summary.count}</p>
            </div>
            {tier.next ? (
              <div className="rounded-xl bg-rp-elevated border border-[#48484a] p-4 col-span-2 sm:col-span-1">
                <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider mb-1">
                  To {tier.next}
                </p>
                <p className="text-2xl font-bold text-white">{currency(tier.nextAmount)}</p>
              </div>
            ) : (
              <div className={`rounded-xl border p-4 col-span-2 sm:col-span-1 bg-gradient-to-br ${tier.color}/10 border-[#D946EF]/30`}>
                <p className="text-[10px] font-bold text-white/70 uppercase tracking-wider mb-1">Status</p>
                <p className="text-base font-bold text-white">Top Tier Unlocked</p>
              </div>
            )}
          </div>
        </div>

        {/* Progress to next tier */}
        {tier.next && (
          <div className="mt-6">
            <div className="flex justify-between text-xs mb-2">
              <span className="text-white/60 font-semibold">{tier.name}</span>
              <span className="text-white font-bold">{tier.next}</span>
            </div>
            <div className="h-2.5 bg-rp-elevated rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${tier.color} transition-all duration-500`}
                style={{ width: `${Math.min(tier.progress, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Mobile-only CTA */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate("/my-orders")}
          className="w-full text-xs text-white/60 hover:text-[#3B82F6] hover:bg-rp-elevated rounded-xl mt-6 sm:hidden"
        >
          View All Orders <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  );
}
