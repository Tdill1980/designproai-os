import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight, Check, Gift, Loader2, ShieldCheck, CreditCard, User } from "lucide-react";
import { toast } from "sonner";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "");

const STEPS = [
  { label: "Account", icon: User },
  { label: "Payment", icon: CreditCard },
  { label: "Complete", icon: Check },
];

const CheckoutPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [step, setStep] = useState(0);

  // Auth form state
  const [authMode, setAuthMode] = useState<"login" | "signup">("signup");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authShopName, setAuthShopName] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const priceId = searchParams.get("priceId") || "";
  // Auto-apply WPW-FOUNDER coupon for visitors who landed via the founder
  // invitation page. The /from/weprintwraps page writes a referral object
  // to localStorage with campaign === "wpw-founder" — we honor it here so
  // recipients get $50 off without needing the URL ?coupon= param.
  const initialCoupon = (() => {
    const fromUrl = searchParams.get("coupon");
    if (fromUrl) return fromUrl;
    try {
      const ref = JSON.parse(localStorage.getItem("restylepro_referral") || "null");
      if (ref?.campaign === "wpw-founder") return "WPW-FOUNDER";
    } catch { /* ignore */ }
    return "";
  })();
  const tierName = searchParams.get("tier") || "Selected Plan";
  const [couponCode, setCouponCode] = useState(initialCoupon);
  const [couponApplied, setCouponApplied] = useState(!!initialCoupon);

  // Check auth on mount and listen for changes
  useEffect(() => {
    const checkUser = async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      setUser(u);
      setAuthLoading(false);
      if (u) setStep(1); // Skip to payment if already signed in
    };
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u && step === 0) setStep(1); // Advance to payment on sign-in
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) return;
    setAuthSubmitting(true);
    try {
      if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
          options: {
            data: {
              full_name: authName || undefined,
              shop_name: authShopName || undefined,
            },
          },
        });
        if (error) throw error;
        toast.success("Account created! Continuing to payment.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        toast.success("Signed in! Continuing to payment.");
      }
      // onAuthStateChange will advance step
    } catch (err: any) {
      toast.error(err?.message || "Authentication failed. Please try again.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const fetchClientSecret = useCallback(async () => {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) throw new Error("Not authenticated");

    const appliedCoupon = couponApplied ? couponCode.trim() : null;
    const { data, error: fnError } = await supabase.functions.invoke("create-checkout", {
      body: { priceId, couponCode: appliedCoupon, embedded: true },
    });

    if (fnError || !data?.clientSecret) {
      const serverMsg = data?.error || fnError?.message || "Unable to start checkout";
      console.error("Checkout error:", { fnError, data });
      setError(serverMsg);
      throw new Error(serverMsg);
    }

    return data.clientSecret;
  }, [priceId, couponCode, couponApplied]);

  if (!priceId) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">No plan selected</h1>
          <Button onClick={() => navigate("/pricing")}>View Plans</Button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-white mb-4">Checkout Error</h1>
          <p className="text-[#888] mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => navigate("/pricing")}>
              Back to Pricing
            </Button>
            <Button onClick={() => { setError(null); window.location.reload(); }}>
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center gap-4">
        <img src="/characters/sproket/sproket-loading.png" alt="SPROKET" className="w-16 h-16 object-contain animate-pulse" />
        <Loader2 className="w-6 h-6 text-[#00E5FF] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <div className="border-b border-white/10 bg-[#111]">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/pricing")}
            className="text-[#888] hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Pricing
          </Button>
          <div className="flex-1 text-center">
            <span className="text-white font-semibold">RestyleProAI</span>
            <span className="text-[#888] text-sm ml-2">Secure Checkout</span>
          </div>
          <div className="w-[120px]" />
        </div>
      </div>

      {/* Wizard Progress Bar */}
      <div className="max-w-2xl mx-auto w-full px-4 pt-8 pb-4">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isComplete = i < step;
            return (
              <div key={s.label} className="flex items-center flex-1 last:flex-initial">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                      isComplete
                        ? "bg-[#00E5FF] border-[#00E5FF] text-black"
                        : isActive
                        ? "border-[#00E5FF] text-[#00E5FF] bg-[#00E5FF]/10"
                        : "border-[#333] text-[#555] bg-transparent"
                    }`}
                  >
                    {isComplete ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                  </div>
                  <span
                    className={`text-xs mt-2 font-medium ${
                      isActive || isComplete ? "text-[#00E5FF]" : "text-[#555]"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-[2px] mx-3 mt-[-18px] ${
                      isComplete ? "bg-[#00E5FF]" : "bg-[#222]"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Plan Summary Banner */}
      <div className="max-w-2xl mx-auto w-full px-4 mb-6 space-y-3">
        <div className="bg-[#111] border border-[#222] rounded-xl px-5 py-3 flex items-center justify-between">
          <div>
            <span className="text-[#888] text-sm">Selected plan</span>
            <p className="text-white font-semibold text-lg">{tierName}</p>
          </div>
          <ShieldCheck className="w-6 h-6 text-[#00E5FF]" />
        </div>

        {/* Coupon Code Input */}
        {!couponApplied ? (
          <div className="bg-[#111] border border-[#222] rounded-xl px-5 py-3">
            <div className="flex items-center gap-3">
              <Gift className="w-5 h-5 text-[#888] shrink-0" />
              <Input
                type="text"
                placeholder="Coupon code"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                className="bg-[#1A1A1A] border-white/10 text-white placeholder:text-[#555] h-9 text-sm uppercase"
              />
              <Button
                size="sm"
                disabled={!couponCode.trim()}
                onClick={() => { setCouponApplied(true); toast.success(`Coupon "${couponCode}" applied!`); }}
                className="bg-[#00E5FF] text-black font-semibold hover:bg-[#00E5FF]/90 shrink-0"
              >
                Apply
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-[#111] border border-[#00E5FF]/30 rounded-xl px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Gift className="w-5 h-5 text-[#00E5FF]" />
              <span className="text-[#00E5FF] font-semibold text-sm">{couponCode}</span>
              <span className="text-[#888] text-sm">applied</span>
            </div>
            <button
              onClick={() => { setCouponApplied(false); setCouponCode(""); }}
              className="text-[#888] hover:text-white text-xs"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {/* Step Content */}
      <div className="flex-1 max-w-2xl mx-auto w-full px-4 pb-12">
        {/* Step 0: Account Creation / Sign In */}
        {step === 0 && !user && (
          <div className="bg-[#111] border border-[#222] rounded-2xl p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-1">
              <img src="/characters/sproket/sproket-welcome.png" alt="SPROKET" className="w-12 h-12 object-contain" />
              <h2 className="text-2xl font-bold text-white">
                {authMode === "signup" ? "Create your account" : "Welcome back"}
              </h2>
            </div>
            <p className="text-[#888] mb-6">
              {authMode === "signup"
                ? "Set up your RestyleProAI account to get started"
                : "Sign in to your existing account to continue"}
            </p>

            <form onSubmit={handleAuth} className="space-y-4">
              {authMode === "signup" && (
                <>
                  <div>
                    <Label htmlFor="name" className="text-[#ccc] text-sm">Full Name</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="Your name"
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      className="mt-1 bg-[#1A1A1A] border-white/10 text-white placeholder:text-[#555]"
                    />
                  </div>
                  <div>
                    <Label htmlFor="shop" className="text-[#ccc] text-sm">Shop / Business Name</Label>
                    <Input
                      id="shop"
                      type="text"
                      placeholder="Your shop name"
                      value={authShopName}
                      onChange={(e) => setAuthShopName(e.target.value)}
                      className="mt-1 bg-[#1A1A1A] border-white/10 text-white placeholder:text-[#555]"
                    />
                  </div>
                </>
              )}
              <div>
                <Label htmlFor="email" className="text-[#ccc] text-sm">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="mt-1 bg-[#1A1A1A] border-white/10 text-white placeholder:text-[#555]"
                  required
                />
              </div>
              <div>
                <Label htmlFor="password" className="text-[#ccc] text-sm">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={authMode === "signup" ? "Min. 6 characters" : "Your password"}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="mt-1 bg-[#1A1A1A] border-white/10 text-white placeholder:text-[#555]"
                  required
                  minLength={6}
                />
              </div>

              <Button
                type="submit"
                disabled={authSubmitting}
                className="w-full bg-[#00E5FF] text-black font-semibold hover:bg-[#00E5FF]/90 h-12 text-base"
              >
                {authSubmitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {authMode === "signup" ? "Create Account" : "Sign In"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t border-[#222] text-center">
              <img src="/characters/sproket/sproket-clipboard.png" alt="SPROKET" className="w-8 h-8 object-contain mx-auto mb-2 opacity-60" />
              <p className="text-[#888] text-sm">
                {authMode === "signup" ? (
                  <>
                    Already have an account?{" "}
                    <button onClick={() => setAuthMode("login")} className="text-[#00E5FF] hover:underline font-medium">
                      Sign in
                    </button>
                  </>
                ) : (
                  <>
                    Don't have an account?{" "}
                    <button onClick={() => setAuthMode("signup")} className="text-[#00E5FF] hover:underline font-medium">
                      Create one
                    </button>
                  </>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Step 1: Payment (Stripe Embedded Checkout) */}
        {step >= 1 && user && (
          <div key={`checkout-${couponApplied ? couponCode : "none"}`}>
            <EmbeddedCheckoutProvider stripe={stripePromise} options={{ fetchClientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckoutPage;
