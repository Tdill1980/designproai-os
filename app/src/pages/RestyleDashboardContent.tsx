/**
 * RestyleDashboardContent — full dashboard.
 *
 * Loaded via React.lazy from RestyleDashboard.tsx shell.
 */
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { RefreshCw, Zap, Link2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getActiveUser } from "@/lib/auth-session";
import { Button } from "@/components/ui/button";
import { useUserTier } from "@/hooks/useUserTier";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { type Tier } from "@/hooks/useToolAccess";
import { DASHBOARD_PILLARS } from "@/lib/dashboard-nav";
import { useAutoLinkWpw } from "@/hooks/useAutoLinkWpw";
import { useAutoSyncWpw } from "@/hooks/useAutoSyncWpw";
import { useAutoOpenWpwPortal } from "@/hooks/useAutoOpenWpwPortal";
import { HeroRow } from "@/components/dashboard/HeroRow";
import { BusinessMetricsCard } from "@/components/dashboard/BusinessMetricsCard";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { PillarHeroCard } from "@/components/dashboard/PillarHeroCard";
import { GallerySliderCard } from "@/components/dashboard/GallerySliderCard";
import { RecentRendersStrip } from "@/components/dashboard/RecentRendersStrip";
import { RpDesignTeamCard } from "@/components/dashboard/RpDesignTeamCard";
import { MyProductionPacksCard } from "@/components/dashboard/MyProductionPacksCard";
import { JobsListTabs } from "@/components/dashboard/JobsListTabs";
import { TokenBalanceCard } from "@/components/dashboard/TokenBalanceCard";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import { useQuery } from "@tanstack/react-query";

const RENDER_LIMITS: Record<string, number> = {
  free: 0,
  starter: 50,
  advanced: 75,
  complete: 999999,
  agency: 999999,
};

export default function RestyleDashboardContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const tier = useUserTier() as Tier;
  const { subscription } = useSubscriptionLimits();
  useAutoLinkWpw();
  useAutoSyncWpw();
  useAutoOpenWpwPortal();
  const { data: isWpwTenant = false } = useIsWpwTenant();

  // Fetch shop name for welcome header
  const { data: shopProfile } = useQuery({
    queryKey: ["shop-profile-welcome"],
    queryFn: async () => {
      const user = await getActiveUser();
      if (!user) return null;
      const { data } = await (supabase as any)
        .from("shop_profiles")
        .select("shop_name")
        .eq("user_id", user.id)
        .maybeSingle();
      return {
        shopName: data?.shop_name || user.user_metadata?.company_name || user.email?.split("@")[0] || "Your Shop",
      };
    },
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data?.session?.user) navigate("/login", { replace: true });
    });
  }, [navigate]);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    // Kick off a live sync of the current user's linked WPW account (non-fatal).
    supabase.functions
      .invoke("wpw-orders-read", { body: { refresh: true } })
      .catch(() => {});
    try {
      // Pull ALL WPW orders (admin-wide) via REST API and run quote→order matching.
      // Treat upstream sync hiccups as non-fatal — WPW tenants still need their
      // analytics + cached queries to refresh even if the WooCommerce pull errors.
      let syncData: any = null;
      let syncErr: any = null;
      try {
        // Interactive refresh: pull recent orders fast and let the function
        // upsert items + run quote-matching in the background. Larger 90-day
        // backfills should call this with `background: true` from a cron.
        const res = await supabase.functions.invoke("wpw-sync-orders", {
          body: { days_back: 14, per_page: 100 },
        });
        syncData = res.data;
        syncErr = res.error;
      } catch (e) {
        syncErr = e;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["wpw-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["wpw-all-orders-admin"] }),
        queryClient.invalidateQueries({ queryKey: ["wpw-all-rewards-admin"] }),
        queryClient.invalidateQueries({ queryKey: ["pillar-wpw-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["wpw-analytics"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-latest-quotes"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-business-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-quote-rows"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-cold-quotes"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-revenue-activity"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-saved-quotes"] }),
      ]);

      if (syncErr) {
        console.warn("[dashboard] wpw-sync-orders failed:", syncErr);
        toast.success("Refreshed — WPW order sync skipped (will retry next time)");
      } else {
        const fetched = syncData?.orders_fetched ?? 0;
        toast.success(`Synced ${fetched} WPW orders`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't refresh — try again";
      toast.error(msg);
    } finally {
      setRefreshing(false);
    }
  };

  const limit = RENDER_LIMITS[tier] ?? 0;
  const used = subscription?.render_count ?? 0;
  const isUnlimited = tier === "agency" || tier === "complete";
  const pctUsed = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  const renderKpi = {
    icon: Zap, label: "Renders this cycle",
    value: isUnlimited ? "∞" : String(used),
    unit: isUnlimited ? "unlimited" : `of ${limit}`,
    progress: isUnlimited ? undefined : pctUsed, highlighted: true,
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6 sm:space-y-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* WpwShoppingButtons removed from the dashboard top — the same
            products are reachable from inside QuickQuote and from the
            Header dropdown, and the white pills broke the dark theme. */}
        <Button
          size="sm"
          variant="outline"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh dashboard data"
          className="rounded-xl border-white/20 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white ml-auto"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <WpwLinkBanner isWpwTenant={isWpwTenant} />

      {/* RP Design Team queue — only renders for users on the agency
          (admin / partner / tester) tier. Customers never see it. */}
      {tier === "agency" && <RpDesignTeamCard />}

      <HeroRow shopName={shopProfile?.shopName} isWpwTenant={isWpwTenant} />

      <section className="grid grid-cols-2 md:grid-cols-4 items-start gap-2 sm:gap-4 xl:gap-6" id="pillars">
        {DASHBOARD_PILLARS.map((pillar, i) => (
          <PillarHeroCard
            key={pillar.id}
            pillar={pillar}
            index={i + 1}
            replacePrimaryWith={
              pillar.id === "profit" ? <BusinessMetricsCard compact /> : undefined
            }
          />
        ))}
      </section>

      {/* Token card — sized like ONE pillar column, sits directly
          UNDER the pillar row. Full-width on mobile, one of four
          columns on desktop (other 3 cells render empty grid space,
          no visible artifact). */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 xl:gap-6">
        <TokenBalanceCard />
      </div>

      {/* The ApprovePro workbench and the booking schedule that sat here are
          RestylePro surfaces. ApprovePro is offline in this system -- its
          route renders the "not live" notice -- so the card advertised a
          product the operator cannot open, and queried tables this project
          does not have. */}


      <GallerySliderCard />
      <RecentRendersStrip />

      {/* Everything between the render strip and the production packs was the
          RestylePro/WPW commerce stack: shop pricing, the quote tools, the
          QuickText + BookingPro lead engine, the booking calendar, Club WPW
          membership, WPW order status and past orders. None of it is part of
          this product, and several of its cards linked to /bookingpro and
          /quick-quote, which this router does not serve. The render KPI stays
          -- it counts this system's own renders. */}
      <section>
        <KpiCard {...renderKpi} />
      </section>

      <section aria-label="My Production Packs">
        <MyProductionPacksCard />
      </section>

      <JobsListTabs />

      <div className="h-4" />
    </div>
  );
}

const WPW_BANNER_DISMISSED_KEY = "rp_wpw_link_banner_dismissed";

function WpwLinkBanner({ isWpwTenant }: { isWpwTenant: boolean }) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(WPW_BANNER_DISMISSED_KEY) === "true";
  });

  if (isWpwTenant || dismissed) return null;

  return (
    <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 via-fuchsia-500/10 to-orange-500/10 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
      <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center shrink-0">
        <Link2 className="w-5 h-5 text-cyan-300" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm sm:text-base font-bold text-white">
          Connect your WePrintWraps account
        </p>
        <p className="text-xs sm:text-sm text-white/70 mt-0.5">
          Pull in past orders, track shipments, reorder in one click — and unlock
          the WPW design + marketing engine, free.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to="/dashboard/my-orders"
          className="rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold px-4 py-2 text-sm transition-colors"
        >
          Connect now
        </Link>
        <button
          type="button"
          aria-label="Dismiss WePrintWraps banner"
          onClick={() => {
            sessionStorage.setItem(WPW_BANNER_DISMISSED_KEY, "true");
            setDismissed(true);
          }}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
