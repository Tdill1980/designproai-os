/**
 * /affiliate/onboarding — single-page connect-bank surface.
 *
 * Replaces the previous 7-step wizard. One card, one CTA: connect
 * your Stripe bank so we can pay you. Anything more lives on
 * /affiliate/dashboard.
 *
 * State branches:
 *   - Not authed       → /affiliate/login (RequireAuth handles this)
 *   - No partner row   → /affiliate/join
 *   - status = pending → "Approval pending" state, no bank button yet
 *   - bank not linked  → "Connect Bank" CTA hits affiliate-stripe-connect
 *   - bank linked      → "Go to Dashboard" + small "Update banking" link
 */

import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { AffiliateLayout } from "@/components/affiliate/AffiliateLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Landmark,
  CheckCircle2,
  ExternalLink,
  ArrowRight,
  Clock,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAffiliateProfile } from "@/hooks/useAffiliateData";

const AffiliateOnboarding = () => {
  const navigate = useNavigate();
  const { data: profile, isLoading, refetch } = useAffiliateProfile();
  const [connecting, setConnecting] = useState(false);

  // Loading shell — matches AffiliateLayout chrome.
  if (isLoading) {
    return (
      <AffiliateLayout
        title="Affiliate Onboarding"
        subtitle="Welcome — connect your bank to start earning"
      >
        <div className="container mx-auto px-4 py-10 flex justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-[#0284C7]" />
        </div>
      </AffiliateLayout>
    );
  }

  // No partner row — bounce to the application form.
  if (!profile) {
    return <Navigate to="/affiliate/join" replace />;
  }

  const status = profile.status;
  const bankConnected = Boolean(profile.stripe_onboarded);
  const firstName = profile.full_name?.split(" ")[0] ?? "there";

  const handleConnectBank = async () => {
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "affiliate-stripe-connect",
        {
          body: {
            action: "create_account",
            return_url:
              typeof window !== "undefined"
                ? `${window.location.origin}/affiliate/onboarding`
                : undefined,
          },
        },
      );
      if (error) {
        // supabase-js wraps non-2xx in FunctionsHttpError and hides the body
        // behind a generic "Edge Function returned a non-2xx status code".
        // Pull the actual server error out of error.context (a Response) so
        // the user sees the real reason. We also log the raw body to the
        // console for debugging from DevTools.
        let detailed = error.message;
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.clone === "function") {
          try {
            const raw = await ctx.clone().text();
            console.error("affiliate-stripe-connect raw response:", raw);
            try {
              const body = JSON.parse(raw);
              if (body?.error) {
                const parts: string[] = [body.error];
                if (body.step) parts.push(`step: ${body.step}`);
                if (body.stripe?.code) parts.push(`stripe: ${body.stripe.code}`);
                detailed = parts.join(" — ");
              } else if (raw) {
                detailed = raw;
              }
            } catch {
              if (raw) detailed = raw;
            }
          } catch (readErr) {
            console.error("Could not read error response body:", readErr);
          }
        }
        throw new Error(detailed);
      }
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error("No onboarding URL returned");
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Couldn't start bank connection. Please try again.";
      console.error("affiliate-stripe-connect error:", err);
      toast.error(msg);
      setConnecting(false);
    }
  };

  return (
    <AffiliateLayout
      title="Affiliate Onboarding"
      subtitle="One step. Connect your bank to start earning."
    >
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Status pill */}
        <div className="flex items-center justify-center mb-5">
          {status === "pending" && (
            <Badge
              variant="outline"
              className="gap-1.5 bg-amber-50 border-amber-200 text-amber-700"
            >
              <Clock className="h-3 w-3" />
              Application pending review
            </Badge>
          )}
          {status === "suspended" && (
            <Badge
              variant="outline"
              className="gap-1.5 bg-red-50 border-red-200 text-red-700"
            >
              <AlertCircle className="h-3 w-3" />
              Account suspended — contact support
            </Badge>
          )}
          {(status === "approved" || status === "active") && (
            <Badge
              variant="outline"
              className="gap-1.5 bg-emerald-50 border-emerald-200 text-emerald-700"
            >
              <CheckCircle2 className="h-3 w-3" />
              Approved · {profile.referral_code}
            </Badge>
          )}
        </div>

        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent className="p-7 sm:p-9">
            {/* Welcome */}
            <div className="text-center mb-6">
              <div className="text-[11px] uppercase tracking-[0.3em] font-bold text-[#0284C7] mb-2">
                Welcome, {firstName}
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 leading-tight">
                {bankConnected ? (
                  <>You&apos;re set up to earn.</>
                ) : status === "pending" ? (
                  <>Hang tight — we&apos;ll email you when approved.</>
                ) : (
                  <>Connect your bank to start earning.</>
                )}
              </h1>
              <p className="text-sm text-gray-600 mt-2 max-w-md mx-auto leading-relaxed">
                {bankConnected
                  ? "Payouts route to the bank account you connected via Stripe. You can update it anytime from Settings."
                  : status === "pending"
                  ? "Your application is in our review queue. As soon as it's approved you'll get an email and this page will unlock the bank-connect button."
                  : "Commissions land in your bank account once a month via Stripe Connect. It takes about 2 minutes — Stripe handles the verification."}
              </p>
            </div>

            {/* Primary CTA — branches by state */}
            {status === "pending" ? (
              <div className="text-center">
                <Button
                  variant="outline"
                  onClick={() => navigate("/affiliate/dashboard")}
                  className="border-gray-300 text-gray-700"
                >
                  Preview my dashboard
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            ) : bankConnected ? (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5">
                <Button
                  onClick={() => navigate("/affiliate/dashboard")}
                  className="h-12 px-5 text-sm font-semibold text-white bg-gradient-to-r from-[#0284C7] to-[#38BDF8] hover:brightness-110 border-0"
                >
                  Go to my dashboard
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("/affiliate/settings")}
                  className="h-12 px-5 text-sm font-semibold border-gray-300 text-gray-700"
                >
                  Update banking
                  <ExternalLink className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <Button
                  onClick={handleConnectBank}
                  disabled={connecting}
                  className="h-12 px-6 text-base font-semibold text-white bg-gradient-to-r from-[#0284C7] to-[#38BDF8] hover:brightness-110 border-0 disabled:opacity-60"
                >
                  {connecting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Redirecting to Stripe…
                    </>
                  ) : (
                    <>
                      <Landmark className="h-4 w-4 mr-2" />
                      Connect Bank Account
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Trust strip — only when prompting for bank */}
            {!bankConnected && status !== "pending" && (
              <div className="mt-6 pt-5 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                <TrustItem
                  title="Secure"
                  desc="Bank details go to Stripe, not us"
                />
                <TrustItem
                  title="~2 minutes"
                  desc="Verify identity + add bank"
                />
                <TrustItem
                  title="Monthly payouts"
                  desc="Auto-deposited on the 1st"
                />
              </div>
            )}

            <p className="mt-6 text-center text-[11px] text-gray-500">
              Need a different account?{" "}
              <button
                type="button"
                onClick={() => refetch()}
                className="text-[#0284C7] hover:underline font-semibold"
              >
                Refresh status
              </button>
              {" "}or{" "}
              <a
                href="mailto:support@restyleproai.com"
                className="text-[#0284C7] hover:underline font-semibold"
              >
                email support
              </a>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </AffiliateLayout>
  );
};

const TrustItem = ({ title, desc }: { title: string; desc: string }) => (
  <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
    <div className="text-xs font-bold text-gray-900">{title}</div>
    <div className="text-[11px] text-gray-600 mt-0.5 leading-snug">{desc}</div>
  </div>
);

export default AffiliateOnboarding;
