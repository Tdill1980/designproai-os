import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AffiliateLayout } from "@/components/affiliate/AffiliateLayout";
import { AffiliateContentUploader } from "@/components/affiliate/AffiliateContentUploader";
import { Megaphone, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { StatCard } from "@/components/affiliate/StatCard";
import { AffiliateStatusBadge } from "@/components/affiliate/AffiliateStatusBadge";
import { CopyButton } from "@/components/affiliate/CopyButton";
import { AffiliateAdUpload } from "@/components/affiliate/AffiliateAdUpload";
import { WpwRepToolkitCard } from "@/components/affiliate/WpwRepToolkitCard";
import { getWpwRepByPartnerCode } from "@/lib/wpw-reps";
import { PricingTiersSection } from "@/components/PricingTiersSection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  useAffiliateProfile,
  useAffiliateReferrals,
  useAffiliatePayouts,
  useMonthlyEarnings,
} from "@/hooks/useAffiliateData";
import {
  DollarSign,
  Users,
  Calendar,
  TrendingUp,
  Loader2,
  Share2,
  ExternalLink,
  Ticket,
  Video,
  Repeat,
  CreditCard,
  Shield,
  Zap,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";

const TIER_BREAKDOWN = [
  { plan: "Starter", price: 299 },
  { plan: "Professional", price: 649 },
  { plan: "Pro Shop", price: 1400 },
  { plan: "Agency", price: 2999 },
];

export default function AffiliateDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: profile, isLoading, refetch } = useAffiliateProfile();
  const { data: referrals } = useAffiliateReferrals(profile?.id);
  const { data: payouts } = useAffiliatePayouts(profile?.id);
  const { data: monthlyEarnings } = useMonthlyEarnings(profile?.id);
  const [stripeLoading, setStripeLoading] = useState(false);

  const handleConnectBank = async () => {
    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("affiliate-stripe-connect", {
        body: {
          action: "create_account",
          return_url: window.location.origin + "/affiliate/dashboard",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No Stripe URL returned");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to start Stripe onboarding");
      setStripeLoading(false);
    }
  };

  // Handle Stripe return — verify status and activate if needed
  useEffect(() => {
    const stripeStatus = searchParams.get("stripe");
    if (!stripeStatus || !profile) return;

    if (stripeStatus === "complete") {
      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("affiliate-stripe-connect", {
            body: { action: "check_status" },
          });
          if (error) throw error;
          if (data?.onboarded) {
            // Activate affiliate if still in approved status
            if (profile.status === "approved") {
              await supabase.functions.invoke("affiliate-activate", {
                body: { affiliate_id: profile.id },
              });
            }
            toast.success("Bank account connected! Payouts are now enabled.");
            refetch();
          } else {
            toast.info("Stripe setup needs a few more details — click Connect Bank to finish.");
          }
        } catch (err: any) {
          toast.error(err.message || "Could not verify Stripe status");
        } finally {
          setSearchParams({}, { replace: true });
        }
      })();
    } else if (stripeStatus === "refresh") {
      toast.info("Stripe setup was interrupted — click Connect Bank to try again.");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, profile?.id, profile?.status, refetch, setSearchParams]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    navigate("/affiliate/join");
    return null;
  }

  if (profile.status === "pending") {
    navigate("/affiliate/join");
    return null;
  }

  const activeReferrals = (referrals || []).filter(
    (r) => r.status === "subscribed" || r.status === "active"
  );
  const totalReferralSignups = (referrals || []).filter(
    (r) => r.status !== "clicked"
  ).length;
  const nextPayoutFormatted = profile.next_payout_date
    ? format(new Date(profile.next_payout_date), "MMMM d, yyyy")
    : "N/A";

  const shareText = `Check out RestyleProAI - the best vehicle wrap visualization tool. Use my code ${profile.referral_code} for 10% off! ${profile.referral_link}`;

  return (
    <AffiliateLayout
      title="Dashboard"
      subtitle={`Welcome back, ${profile.full_name}`}
    >
      {/* Connect Bank Banner — shown until Stripe onboarding is complete */}
      {!profile.stripe_onboarded && (
        <Card className="bg-white border-gray-200 shadow-sm mb-6 overflow-hidden relative">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-[#38BDF8]" />
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-[#0A0A0F] flex-shrink-0">
                  <CreditCard className="h-6 w-6 text-[#38BDF8]" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    Connect your bank to receive payouts
                  </h2>
                  <p className="text-sm text-gray-600 mt-1 max-w-xl">
                    We use Stripe to securely send your commissions directly to your bank account.
                    Takes about 2 minutes — Stripe handles all sensitive data.
                  </p>
                  <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-gray-600">
                    <span className="flex items-center gap-1.5">
                      <Shield className="h-3.5 w-3.5 text-[#38BDF8]" /> Bank-level security
                    </span>
                    <span className="flex items-center gap-1.5">
                      <DollarSign className="h-3.5 w-3.5 text-[#38BDF8]" /> Payouts on the 1st &amp; 15th
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5 text-[#38BDF8]" /> Direct to your bank
                    </span>
                  </div>
                </div>
              </div>
              <Button
                size="lg"
                className="gap-2 whitespace-nowrap bg-[#0A0A0F] hover:bg-[#1a1a24] text-[#38BDF8] border border-[#38BDF8]/30 shadow-sm"
                onClick={handleConnectBank}
                disabled={stripeLoading}
              >
                {stripeLoading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <CreditCard className="h-5 w-5" />
                    Connect Bank via Stripe
                    <ExternalLink className="h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {profile.stripe_onboarded && (
        <Card className="bg-white border-gray-200 shadow-sm mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-1.5 rounded-lg bg-emerald-50">
                <CheckCircle className="h-5 w-5 text-emerald-600 flex-shrink-0" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">
                  Bank connected — payouts enabled
                </p>
                <p className="text-xs text-gray-600">
                  Commissions will be deposited automatically on the 1st and 15th of each month.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() => navigate("/affiliate/settings")}
              >
                Manage
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* WPW Rep Toolkit — only renders for Troy/Lance/Brice/Jackson/RJ.
          Surfaces their branded /wpw/<slug> URL + paste-able snippets so
          they can self-serve sharing without asking us for the link. */}
      {(() => {
        const wpwRep = getWpwRepByPartnerCode(profile.referral_code);
        if (!wpwRep) return null;
        return (
          <div className="mb-8">
            <WpwRepToolkitCard rep={wpwRep} />
          </div>
        );
      })()}

      {/* Your Coupon Code - Prominent */}
      <Card className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-primary/30 mb-8">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-start gap-4">
              <img
                src="/characters/sproket/sproket-rocket-wave.png"
                alt="SPROKET"
                className="w-16 h-16 sm:w-20 sm:h-20 object-contain drop-shadow-[0_0_15px_rgba(139,92,246,0.3)] flex-shrink-0"
              />
              <div>
                <h2 className="text-lg font-bold text-foreground">
                  Your Dedicated Coupon Code
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Your audience gets <span className="text-primary font-semibold">10% off</span> any plan when they use your code
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <code className="bg-background border border-border rounded-lg px-5 py-3 text-xl font-mono font-bold text-primary tracking-wider">
                {profile.referral_code}
              </code>
              <CopyButton text={profile.referral_code} label="Copy" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* "You're live on WPW.com this week" — fires when this rep is
          featured on any active slider slot. Source of truth is
          wpw_homepage_sliders.affiliate_id set by Trish each Monday. */}
      <SpotlightTile affiliateId={profile.id} />

      {/* Submit Your Content — paid promotion incentive */}
      <Card className="bg-white border-gray-200 shadow-sm mb-6 overflow-hidden relative">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-fuchsia-500 via-purple-500 to-blue-500" />
        <CardContent className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-600 flex-shrink-0">
              <Megaphone className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-900">
                Submit your reels & ad creative — we'll boost the winners
              </h2>
              <p className="text-sm text-gray-600 mt-1 max-w-2xl">
                Upload <strong>raw clips, finished reels, or static ad images</strong>. Every
                week we pick the best submissions and <strong>spend our own ad budget</strong>{" "}
                running them as paid ads — pointed at <strong>your</strong> landing page with{" "}
                <strong>your</strong> coupon. Every sale from the boosted ad is your commission.
                Easiest first commission you'll ever earn.
              </p>
            </div>
          </div>
          <AffiliateContentUploader partnerId={profile.id} />
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Total Earned"
          value={`$${(profile.total_earned || 0).toFixed(2)}`}
          icon={DollarSign}
          iconColor="text-green-400"
        />
        <StatCard
          title="Pending Balance"
          value={`$${(profile.pending_balance || 0).toFixed(2)}`}
          icon={TrendingUp}
          iconColor="text-primary"
        />
        <StatCard
          title="Active Referrals"
          value={activeReferrals.length}
          subtitle={`${totalReferralSignups} total signups · ${profile.total_referrals || 0} link clicks`}
          icon={Users}
          iconColor="text-cyan-400"
        />
        <StatCard
          title="Total Paid Out"
          value={`$${(profile.total_paid || 0).toFixed(2)}`}
          icon={DollarSign}
          iconColor="text-emerald-400"
        />
      </div>

      {/* Fund Date + Share Row */}
      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        {/* Next Fund Date */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5 text-yellow-400" />
              Next Fund Date
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {nextPayoutFormatted}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {profile.pending_balance >= 10
                ? `$${profile.pending_balance.toFixed(2)} scheduled for payout`
                : "Min $10 balance required for payout"}
            </p>
            <p className="text-xs text-muted-foreground mt-3">
              Payouts process on the 1st and 15th of each month via Stripe.
            </p>
          </CardContent>
        </Card>

        {/* Quick Share */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Share Your Link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">
                Referral Link
              </label>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 bg-muted rounded px-3 py-2 text-xs text-foreground truncate">
                  {profile.referral_link}
                </code>
                <CopyButton text={profile.referral_link || ""} />
              </div>
            </div>
            <div className="pt-1 space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => {
                  window.open(
                    `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`,
                    "_blank"
                  );
                }}
              >
                <Share2 className="h-3.5 w-3.5" /> Share on X
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => {
                  window.open(
                    `https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(shareText)}`,
                    "_blank"
                  );
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" /> Share on Facebook
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Earnings Chart */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Monthly Earnings</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyEarnings && monthlyEarnings.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={monthlyEarnings}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="month"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickFormatter={(v) => `$${v}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      color: "hsl(var(--foreground))",
                    }}
                    formatter={(value: number) => [
                      `$${value.toFixed(2)}`,
                      "Earnings",
                    ]}
                  />
                  <Bar
                    dataKey="earnings"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-muted-foreground">
                <p className="text-sm">
                  Earnings chart will appear once commissions start.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Commission Tiers — or Flat Rate for special pay structures */}
      {profile.tool_access?.pay_type === "flat_per_pack" ? (
        <Card className="bg-card border-border mb-8">
          <CardHeader>
            <CardTitle className="text-lg">Your Pay Structure</CardTitle>
            <p className="text-sm text-muted-foreground">Flat rate per production pack</p>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-primary/40 bg-primary/10 p-6 text-center">
              <p className="text-xs text-muted-foreground mb-1">Per Production Pack</p>
              <p className="text-4xl font-black text-primary">${profile.tool_access?.flat_rate || 0}</p>
              <p className="text-xs text-muted-foreground mt-2">
                {profile.tool_access?.products_only
                  ? `Applies to: ${(profile.tool_access.products_only as string[]).join(", ").replace(/_/g, " ")}`
                  : "All products"}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
      <Card className="bg-card border-border mb-8">
        <CardHeader>
          <CardTitle className="text-lg">Your Commission</CardTitle>
          <p className="text-sm text-muted-foreground">
            {profile.recurring_rate > 0
              ? "What you earn on every subscriber you refer"
              : "What you earn on every new subscription you refer"}
          </p>
        </CardHeader>
        <CardContent>
          {/* Rate cards */}
          <div className={`grid ${profile.recurring_rate > 0 ? "grid-cols-2" : "grid-cols-1"} gap-3 mb-6`}>
            <div className="rounded-xl border border-primary/40 bg-primary/10 p-4 text-center">
              <p className="text-xs text-muted-foreground">
                {profile.recurring_rate > 0 ? "Initial Signup" : "Per New Subscription"}
              </p>
              <p className="text-3xl font-black text-primary">{profile.commission_rate}%</p>
              <p className="text-xs text-muted-foreground">
                {profile.recurring_rate > 0 ? "one-time, when they subscribe" : "one-time payment"}
              </p>
            </div>
            {profile.recurring_rate > 0 && (
              <div className="rounded-xl border border-primary/40 bg-primary/10 p-4 text-center">
                <p className="text-xs text-muted-foreground">Monthly Recurring</p>
                <p className="text-3xl font-black text-primary">{profile.recurring_rate}%</p>
                <p className="text-xs text-muted-foreground">every month they stay subscribed</p>
              </div>
            )}
          </div>

          {/* Plan earnings at this affiliate's actual rate */}
          <p className="text-sm font-medium text-foreground mb-3">
            What you earn per plan
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {TIER_BREAKDOWN.map((plan) => {
              const initial = (plan.price * profile.commission_rate) / 100;
              const recurring = (plan.price * profile.recurring_rate) / 100;
              return (
                <div
                  key={plan.plan}
                  className="rounded-xl border border-border bg-muted/30 p-4 text-center"
                >
                  <p className="text-sm font-medium text-muted-foreground">
                    {plan.plan}
                  </p>
                  <p className="text-foreground mt-1">${plan.price.toLocaleString()}/mo</p>
                  <div className="my-2 border-t border-border" />
                  <p className="text-xl font-bold text-primary">
                    ${initial.toFixed(2)}
                    <span className="text-xs text-muted-foreground font-normal">
                      {" "}{profile.recurring_rate > 0 ? "initial" : "one-time"}
                    </span>
                  </p>
                  {profile.recurring_rate > 0 && (
                    <p className="text-sm font-semibold text-primary mt-1">
                      + ${recurring.toFixed(2)}
                      <span className="text-xs text-muted-foreground font-normal">/mo</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      )}

      {/* Full Pricing Tiers */}
      <div className="mb-8">
        <PricingTiersSection
          heading="RestyleProAI\u2122 Pricing Tiers"
          subheading="Share these plans with your audience. Every subscription earns you 20% commission."
          compact
        />
      </div>

      {/* Keep Creating Content */}
      <Card className="bg-gradient-to-r from-cyan-500/10 via-blue-500/5 to-transparent border-cyan-500/20 mb-8">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <img
              src="/characters/sproket/sproket-designmasterpiece2.png"
              alt="SPROKET painting"
              className="w-20 sm:w-24 flex-shrink-0 drop-shadow-[0_0_15px_rgba(6,182,212,0.3)]"
            />
            <div>
              <h3 className="text-lg font-bold text-foreground">
                Keep Creating Content - Keep Earning
              </h3>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                Make videos, teach your audience, show them what RestyleProAI can
                do. The more content you create, the more subscribers you bring
                in. Share your code, grow your income.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SPROKET Tips from your Systems Guide */}
      <Card className="bg-gradient-to-br from-primary/10 via-purple-500/5 to-transparent border-primary/20 mb-8">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            <img
              src="/characters/sproket/sproket-clipboard.png"
              alt="SPROKET"
              className="w-12 h-12 object-contain"
            />
            <div>
              <CardTitle className="text-lg">SPROKET's Tips</CardTitle>
              <p className="text-xs text-muted-foreground">Your RestyleProAI Systems Guide</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-card p-4 text-center">
              <img
                src="/characters/sproket/sproket-camera2.png"
                alt="Photorealistic renders"
                className="w-20 mx-auto mb-3 "
              />
              <h4 className="font-semibold text-foreground text-sm mb-1">Photorealistic Renders</h4>
              <p className="text-xs text-muted-foreground">
                Don't forget to show off photorealistic renders — they're what sell the platform!
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 text-center">
              <img
                src="/characters/sproket/sproket-mobile-phone.png"
                alt="Design from mobile"
                className="w-20 mx-auto mb-3 "
              />
              <h4 className="font-semibold text-foreground text-sm mb-1">Design From Your Phone</h4>
              <p className="text-xs text-muted-foreground">
                You can use RestyleProAI to design wraps right from your mobile phone — anywhere, anytime.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 text-center">
              <img
                src="/characters/sproket/sproket-moneybag2.png"
                alt="Earn money"
                className="w-20 mx-auto mb-3 "
              />
              <h4 className="font-semibold text-foreground text-sm mb-1">Stack That Revenue</h4>
              <p className="text-xs text-muted-foreground">
                Every subscriber = commission earned. Share your code, create content, get paid.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── AFFILIATE PLAYBOOK ─────────────────────────────────── */}
      <Card className="bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent border-amber-500/20 mb-8">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            <img src="/characters/sproket/sproket-camera2.png" alt="Playbook" className="w-12 h-12 object-contain" />
            <div>
              <CardTitle className="text-lg">Creator Playbook</CardTitle>
              <p className="text-xs text-muted-foreground">Scripts, hooks, video ideas & content systems — everything you need to create converting content</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Core Creator Rules */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h4 className="font-bold text-foreground mb-3 flex items-center gap-2"><Video className="h-4 w-4 text-amber-500" /> Core Creator Rules</h4>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li>Hooks must match visuals.</li>
              <li>First 2 seconds = real-world moment, not UI.</li>
              <li><strong className="text-foreground">Show &gt; explain.</strong></li>
              <li><strong className="text-foreground">Speed &gt; perfection.</strong></li>
              <li>Every video must end with: <span className="text-amber-400 font-semibold">Win the job. Beat the competition.</span></li>
            </ul>
          </div>

          {/* Video Structure */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h4 className="font-bold text-foreground mb-3">Video Structure (20 seconds)</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="bg-secondary/50 rounded-lg p-2 text-center"><span className="font-mono text-amber-400">0:00–0:02</span><br/>Hook image</div>
              <div className="bg-secondary/50 rounded-lg p-2 text-center"><span className="font-mono text-amber-400">0:02–0:05</span><br/>Situation (1 line)</div>
              <div className="bg-secondary/50 rounded-lg p-2 text-center"><span className="font-mono text-amber-400">0:05–0:10</span><br/>Show tool in action</div>
              <div className="bg-secondary/50 rounded-lg p-2 text-center"><span className="font-mono text-amber-400">0:10–0:14</span><br/>Proof (render/result)</div>
              <div className="bg-secondary/50 rounded-lg p-2 text-center"><span className="font-mono text-amber-400">0:14–0:18</span><br/>Send / action</div>
              <div className="bg-secondary/50 rounded-lg p-2 text-center"><span className="font-mono text-amber-400">0:18–0:20</span><br/>Close</div>
            </div>
          </div>

          {/* Content Types */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <h5 className="font-semibold text-sm text-foreground mb-1">Show & Tell</h5>
              <p className="text-xs text-muted-foreground">Fast demo + result. Hook → Tell → Show → Proof → Send → Close.</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <h5 className="font-semibold text-sm text-foreground mb-1">Pro Tips</h5>
              <p className="text-xs text-muted-foreground">Call out bad behavior → show better way → proof → close.</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <h5 className="font-semibold text-sm text-foreground mb-1">In The Bay</h5>
              <p className="text-xs text-muted-foreground">Customer in bay → apply on phone → show render → send → close.</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <h5 className="font-semibold text-sm text-foreground mb-1">2D → 3D</h5>
              <p className="text-xs text-muted-foreground">Customer sends render → convert to photoreal → attach price → close.</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <h5 className="font-semibold text-sm text-foreground mb-1">Pimp My Ride</h5>
              <p className="text-xs text-muted-foreground">Before → After → WOW. Plain vehicle → transformation → dramatic zoom on render.</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <h5 className="font-semibold text-sm text-foreground mb-1">On Location</h5>
              <p className="text-xs text-muted-foreground">Shop name + city → their pain → demo on their vehicle → result → status close.</p>
            </div>
          </div>

          {/* Hooks Library */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h4 className="font-bold text-foreground mb-3">Hook Library</h4>
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <h5 className="text-xs font-semibold text-amber-400 uppercase mb-2">Core</h5>
                <ul className="text-muted-foreground space-y-1">
                  <li>"STOP leaving money on the table"</li>
                  <li>"Win the job. Beat the competition."</li>
                  <li>"Show it → close it"</li>
                </ul>
              </div>
              <div>
                <h5 className="text-xs font-semibold text-amber-400 uppercase mb-2">Status</h5>
                <ul className="text-muted-foreground space-y-1">
                  <li>"You're a wrap artist… right?"</li>
                  <li>"Real shops don't guess"</li>
                  <li>"Not everyone is at this level"</li>
                </ul>
              </div>
              <div>
                <h5 className="text-xs font-semibold text-amber-400 uppercase mb-2">FOMO</h5>
                <ul className="text-muted-foreground space-y-1">
                  <li>"Once they see this… they're not shopping anymore"</li>
                  <li>"Why would they go anywhere else?"</li>
                  <li>"This is where they switch"</li>
                </ul>
              </div>
              <div>
                <h5 className="text-xs font-semibold text-amber-400 uppercase mb-2">Tool Specific</h5>
                <ul className="text-muted-foreground space-y-1">
                  <li><strong>ColorPro:</strong> "Stop guessing color"</li>
                  <li><strong>PatternPro:</strong> "Any pattern → real car"</li>
                  <li><strong>FadeWraps:</strong> "Basic vs premium"</li>
                  <li><strong>ApprovePro:</strong> "If it's not signed, you're exposed"</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Video Idea Bank */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h4 className="font-bold text-foreground mb-3">Video Idea Bank</h4>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div className="flex gap-2"><span className="text-amber-400 font-bold">01</span><span className="text-muted-foreground">"How I Quote a Wrap Job in Under 5 Minutes"</span></div>
              <div className="flex gap-2"><span className="text-amber-400 font-bold">02</span><span className="text-muted-foreground">"The Revision That Almost Cost Me a Client"</span></div>
              <div className="flex gap-2"><span className="text-amber-400 font-bold">03</span><span className="text-muted-foreground">"Wrap Shop Tools I Actually Use Every Day"</span></div>
              <div className="flex gap-2"><span className="text-amber-400 font-bold">04</span><span className="text-muted-foreground">"Color Psychology in Vehicle Wraps"</span></div>
              <div className="flex gap-2"><span className="text-amber-400 font-bold">05</span><span className="text-muted-foreground">"Why Fade Wraps Are the Hottest Upsell Right Now"</span></div>
              <div className="flex gap-2"><span className="text-amber-400 font-bold">06</span><span className="text-muted-foreground">"What Shops Get Wrong About Client Approvals"</span></div>
              <div className="flex gap-2"><span className="text-amber-400 font-bold">07</span><span className="text-muted-foreground">"I Let AI Design a Wrap. Here's What Happened."</span></div>
              <div className="flex gap-2"><span className="text-amber-400 font-bold">08</span><span className="text-muted-foreground">"Fleet Wrap Pricing Explained"</span></div>
              <div className="flex gap-2"><span className="text-amber-400 font-bold">09</span><span className="text-muted-foreground">"Day in the Life of a Wrap Shop Using AI"</span></div>
              <div className="flex gap-2"><span className="text-amber-400 font-bold">10</span><span className="text-muted-foreground">"What Is a Wrap Production Pack?"</span></div>
            </div>
          </div>

          {/* Editing Style + Captions */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <h5 className="font-semibold text-sm text-foreground mb-2">Editing Style</h5>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>Hard cuts (no fades)</li>
                <li>Zoom slightly on every clip (100% → 110%)</li>
                <li>Fast pacing (0.5–2 sec per clip)</li>
                <li>Text appears instantly, not animated</li>
                <li>Phone footage is OK (even preferred)</li>
                <li>Slight shake = authenticity</li>
              </ul>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <h5 className="font-semibold text-sm text-foreground mb-2">Closing Lines</h5>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li className="text-amber-400 font-semibold">"Win the job. Beat the competition."</li>
                <li>"Show it → close it."</li>
                <li>"This is how pros sell wraps."</li>
                <li>"Now who are they choosing?"</li>
                <li>"Stop guessing. Start showing."</li>
                <li>"You're a wrap artist… act like it."</li>
              </ul>
            </div>
          </div>

        </CardContent>
      </Card>

      {/* Ad Upload Section */}
      <div className="mb-8">
        <AffiliateAdUpload
          affiliateId={profile.id}
          affiliateName={profile.full_name}
        />
      </div>

      {/* Referral Activity */}
      <Card className="bg-card border-border mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Referral Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {referrals && referrals.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-2 font-medium">Email</th>
                    <th className="text-left py-3 px-2 font-medium">Status</th>
                    <th className="text-left py-3 px-2 font-medium">Plan</th>
                    <th className="text-right py-3 px-2 font-medium">
                      Commission
                    </th>
                    <th className="text-right py-3 px-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((ref) => (
                    <tr
                      key={ref.id}
                      className="border-b border-border/50 hover:bg-muted/30"
                    >
                      <td className="py-3 px-2 text-foreground">
                        {ref.referred_email || "Anonymous"}
                      </td>
                      <td className="py-3 px-2">
                        <AffiliateStatusBadge status={ref.status} />
                      </td>
                      <td className="py-3 px-2 text-muted-foreground">
                        {ref.subscription_plan || "-"}
                      </td>
                      <td className="py-3 px-2 text-right text-foreground">
                        {ref.commission_amount
                          ? `$${ref.commission_amount.toFixed(2)}`
                          : "-"}
                      </td>
                      <td className="py-3 px-2 text-right text-muted-foreground">
                        {format(new Date(ref.created_at), "MMM d, yyyy")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No referrals yet. Share your code to get started!</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payout History */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg">Payout History</CardTitle>
        </CardHeader>
        <CardContent>
          {payouts && payouts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-2 font-medium">Date</th>
                    <th className="text-right py-3 px-2 font-medium">
                      Amount
                    </th>
                    <th className="text-left py-3 px-2 font-medium">Status</th>
                    <th className="text-left py-3 px-2 font-medium">
                      Transfer ID
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((payout) => (
                    <tr
                      key={payout.id}
                      className="border-b border-border/50 hover:bg-muted/30"
                    >
                      <td className="py-3 px-2 text-foreground">
                        {format(
                          new Date(payout.scheduled_date),
                          "MMM d, yyyy"
                        )}
                      </td>
                      <td className="py-3 px-2 text-right text-foreground font-medium">
                        ${payout.amount.toFixed(2)}
                      </td>
                      <td className="py-3 px-2">
                        <AffiliateStatusBadge status={payout.status} />
                      </td>
                      <td className="py-3 px-2 text-muted-foreground text-xs font-mono">
                        {payout.stripe_transfer_id || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <DollarSign className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>
                No payouts yet. Payouts process on the 1st and 15th of each
                month.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </AffiliateLayout>
  );
}

function SpotlightTile({ affiliateId }: { affiliateId: string }) {
  const { data: slots = [] } = useQuery({
    queryKey: ["wpw_homepage_sliders_for_rep", affiliateId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("wpw_homepage_sliders")
        .select("slot, name, headline")
        .eq("affiliate_id", affiliateId)
        .eq("is_active", true)
        .order("slot", { ascending: true });
      return (data || []) as Array<{ slot: number; name: string; headline: string }>;
    },
    enabled: !!affiliateId,
    staleTime: 60_000,
  });

  if (slots.length === 0) return null;

  return (
    <Card className="bg-white border-gray-200 shadow-sm mb-6 overflow-hidden relative">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-amber-400" />
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-gradient-to-br from-amber-400 to-fuchsia-500 flex-shrink-0">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-[11px] font-bold tracking-[2px] uppercase text-fuchsia-600 mb-1">
              You're live this week 🎉
            </div>
            <h2 className="text-lg font-bold text-gray-900">
              Featured on WePrintWraps.com homepage{" "}
              {slots.length === 1 ? "slider" : `${slots.length} sliders`}
            </h2>
            <p className="text-sm text-gray-600 mt-1 max-w-2xl">
              You're spotlighted on weprintwraps.com homepage right now —
              every visitor who lands on your slide and clicks through
              uses YOUR coupon and YOUR commission. Screenshot it and post.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {slots.map((s) => (
                <span
                  key={s.slot}
                  className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia-50 px-3 py-1 text-xs font-bold text-fuchsia-700 border border-fuchsia-200"
                >
                  Slot {s.slot} · {s.name}
                </span>
              ))}
              <a
                href="https://weprintwraps.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1 text-xs font-bold text-white hover:bg-gray-800"
              >
                See it live ↗
              </a>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
