/**
 * /try-design — Public single-purchase landing page.
 *
 * No auth required. $25 buys 1 AI design credit. After Stripe Checkout,
 * stripe-webhook creates the auth user (if new), grants 1 token, and
 * emails a magic-link that drops them straight into DesignPro.
 *
 * URL params:
 *   ?ref=troy|lance|brice|jackson|rj — attribution slug. Persists into
 *     Stripe session metadata and lands in stripe-webhook.
 *   ?promo=<CODE> — applies an affiliate_coupons code (e.g. TROY10) as
 *     a Stripe coupon on the $25 checkout. Resolved server-side.
 *
 * WPW reps paste their personal /wpw/<rep> link (which forwards both
 * params here) into customer email replies.
 */

import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Sparkles, Mail, ShieldCheck, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const MCLAREN_IMG =
  "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/email-assets/McLaren%20koi%20proof%203d.jpeg";

// Same 4 subscription tiers as /pricing (PricingColorPro). Duplicated here
// so the $25 page can upsell them in the identical vibrant card style.
const TIERS = [
  { key: "starter",  name: "Starter",   hi: "",       label: "Starter",          price: "$350", bestFor: "Solo operators, mobile installers, 1–2 person shops", tokens: "50 tokens / month",  priceId: "price_1TTTzSH1V6OhfCAPGVZDZlZd", cta: "Start with Starter",   badge: null,                featured: false, special: false, human: false },
  { key: "lite",     name: "DesignPro", hi: "Lite",   label: "DesignPro Lite",   price: "$499", bestFor: "For growing wrap shops and installers",             tokens: "75 tokens / month",  priceId: "price_1TTUyoH1V6OhfCAPaIf5OMDW", cta: "Start with Lite",      badge: "Most popular",      featured: true,  special: false, human: false },
  { key: "studio",   name: "DesignPro", hi: "Studio", label: "DesignPro Studio", price: "$699", bestFor: "For busy wrap shops with more active projects",      tokens: "150 tokens / month", priceId: "price_1TEFVxH1V6OhfCAPPATuqoGZ", cta: "Get DesignPro Studio", badge: null,                featured: false, special: false, human: true },
  { key: "plus",     name: "DesignPro", hi: "Plus",   label: "DesignPro Plus",   price: "$995", bestFor: "For high-volume wrap operations",                    tokens: "300 tokens / month", priceId: "price_1TTTzbH1V6OhfCAPkTef8yrl", cta: "Get DesignPro Plus",   badge: "Special — top tier", featured: false, special: true,  human: true },
];

const PERKS = [
  { icon: Sparkles, text: "One custom full wrap design — you design it in DesignPro by simply prompting it" },
  { icon: Sparkles, text: "Includes 3 revisions · 7 view angles · a 3D proof" },
  { icon: Mail, text: "Delivered to your inbox — no signup form to fill out" },
  { icon: ShieldCheck, text: "One-time $250. No subscription, no recurring charges." },
];

const TryDesign = () => {
  const [params] = useSearchParams();
  const refRaw = params.get("ref") || "";
  const promoRaw = params.get("promo") || "";
  const canceled = params.get("canceled") === "1";

  // Sanitize ref for display (matches what the edge function will accept).
  const ref = useMemo(
    () => refRaw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40),
    [refRaw],
  );

  // Sanitize promo — uppercase, alphanumeric + dash/underscore only.
  const promo = useMemo(
    () => promoRaw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40),
    [promoRaw],
  );

  const repName = useMemo(() => {
    if (!ref) return null;
    const known: Record<string, string> = {
      troy: "Troy",
      lance: "Lance",
      brice: "Brice",
    };
    return known[ref] || ref.charAt(0).toUpperCase() + ref.slice(1);
  }, [ref]);

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-guest-design-checkout",
        { body: { email: trimmed, ref, promo } },
      );
      if (error) throw error;
      if (!data?.url) throw new Error("No checkout URL returned");
      window.location.href = data.url;
    } catch (err: any) {
      console.error("[try-design] checkout error:", err);
      toast.error(err?.message || "Couldn't start checkout. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Custom Wrap Design — $250 | DesignProAI</title>
        <meta
          name="description"
          content="Design one custom full vehicle wrap yourself in DesignPro by DesignProAI — prompt-based, finished in under 5 minutes. Includes 3 revisions, 7 view angles + a 3D proof. $250, no subscription."
        />
        <link rel="canonical" href="https://designproai.com/try-design" />
      </Helmet>

      <div className="min-h-screen bg-white text-gray-900">
        {/* Signature blue→magenta top strip */}
        <div className="h-1.5 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-10 sm:py-14">
          {/* Top eyebrow */}
          <div className="text-center mb-8">
            <div className="text-gray-900 text-[20px] font-bold tracking-wide">
              DesignProAI
            </div>
            <div className="text-gray-500 text-[11px] font-semibold tracking-[2px] uppercase mt-2.5">
              Single Design · No Signup · $250
            </div>
          </div>

          {/* Hero */}
          <div className="grid grid-cols-1 md:grid-cols-2 items-center gap-8 mb-10">
            <div>
              {repName && (
                <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-3 py-1 mb-4">
                  <Sparkles className="w-3.5 h-3.5" />
                  Sent by {repName} @ WePrintWraps
                </div>
              )}
              <h1 className="text-[36px] sm:text-[48px] font-extrabold leading-[1.05] tracking-tight text-gray-900">
                One custom wrap design.
              </h1>
              <h1 className="text-[36px] sm:text-[48px] font-extrabold leading-[1.05] tracking-tight mt-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">
                $250. Skip the signup.
              </h1>
              <p className="text-base sm:text-lg text-gray-600 mt-5 leading-relaxed">
                Pay once and design one custom full wrap yourself in DesignPro
                by DesignProAI — prompt-based design software. Describe the
                wrap you want and get a finished design in under 5 minutes.
                Includes 3 revisions, 7 view angles, and a 3D proof. No
                subscription, ever.
              </p>

              <ul className="mt-7 space-y-3">
                {PERKS.map((p, i) => {
                  const Icon = p.icon;
                  return (
                    <li key={i} className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#ec4899] text-white shrink-0">
                        <Icon className="w-3.5 h-3.5" />
                      </span>
                      <span className="text-[15px] text-gray-700">{p.text}</span>
                    </li>
                  );
                })}
              </ul>

              {/* Checkout — email + Buy Now, above the scroll */}
              <div className="mt-7 max-w-md">
                {canceled && (
                  <div className="mb-3 px-3 py-2 text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-700">
                    Checkout was canceled — no charge made. Try again when you're ready.
                  </div>
                )}
                {promo && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                    <Tag className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="text-blue-900">
                      Code <span className="font-mono font-bold tracking-wider">{promo}</span> applied — discount shown on the Stripe page.
                    </span>
                  </div>
                )}
                <p className="text-sm text-gray-600 mb-3">
                  Enter your email — after payment we'll take you straight into DesignPro and email your login link too.
                </p>
                <form onSubmit={handleCheckout} className="space-y-3">
                  <Input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="h-12 text-base bg-white border-gray-300 text-gray-900"
                    disabled={submitting}
                    autoComplete="email"
                  />
                  <Button
                    type="submit"
                    disabled={submitting || !email.trim()}
                    className="w-full h-12 text-base font-semibold text-white border-0 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:brightness-110"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Redirecting to checkout…
                      </>
                    ) : (
                      <>Buy Now — $250</>
                    )}
                  </Button>
                </form>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-gray-500">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Secure checkout by Stripe · One-time charge · No recurring billing
                </div>
              </div>
            </div>

            <div className="order-first md:order-none">
              <img
                src={MCLAREN_IMG}
                alt="Example AI-rendered wrap proof"
                className="w-full rounded-xl border border-gray-200 shadow-xl"
                loading="eager"
              />
              <p className="text-[11px] text-gray-400 text-center mt-2">
                Example output — 7-view 3D proof
              </p>
            </div>
          </div>

          {/* What's next — the two paths after the $25 design */}
          <div className="max-w-xl mx-auto mt-12 mb-1 text-center">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">After your design — two ways to go</h2>
            <p className="text-sm text-gray-600 mt-1.5">
              Get this one design made print-ready, or unlock the full DesignProAI system and design as much as you want.
            </p>
          </div>

          {/* What's next — the two paths after the $25 design */}
          <div className="max-w-xl mx-auto mt-12 mb-1 text-center">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">After your design — two ways to go</h2>
            <p className="text-sm text-gray-600 mt-1.5">
              Get this one design made print-ready, or unlock the full DesignProAI system and design as much as you want.
            </p>
          </div>

          {/* Subscribe — the exact 4 tiers from /pricing, vibrant cards, one row */}
          <div className="mt-12">
            <div className="text-center mb-6">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900">
                Or subscribe &amp; design all you want
              </h2>
              <p className="text-sm text-gray-600 mt-1.5">
                The full DesignProAI DesignPro plans — pick one, cancel anytime.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {TIERS.map((t) => (
                <div
                  key={t.key}
                  className={cn(
                    "relative rounded-2xl border p-5 pt-7 flex flex-col bg-white",
                    t.featured
                      ? "border-fuchsia-400/70 shadow-[0_0_24px_rgba(217,70,239,0.18)]"
                      : t.special
                      ? "border-fuchsia-400/70 shadow-[0_0_28px_rgba(217,70,239,0.20)]"
                      : "border-slate-200 shadow-sm",
                  )}
                >
                  <div className="absolute top-0 left-0 right-0 h-2 rounded-t-2xl bg-gradient-to-r from-blue-500 to-fuchsia-500" />
                  {t.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="inline-block text-[10px] font-bold uppercase tracking-[0.15em] px-3 py-1 rounded-full text-white bg-gradient-to-r from-blue-600 to-fuchsia-500 whitespace-nowrap">
                        {t.badge}
                      </span>
                    </div>
                  )}
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 mb-2 min-h-[30px]">
                    {t.bestFor}
                  </div>
                  <h3 className="text-2xl font-extrabold tracking-tight mb-2 leading-none">
                    <span className="text-slate-900">{t.name}</span>
                    {t.hi && (
                      <span className="bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
                        {t.hi}
                      </span>
                    )}
                  </h3>
                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-4xl font-extrabold text-slate-900 tracking-tight">{t.price}</span>
                    <span className="text-sm text-slate-500">/mo</span>
                  </div>
                  <div className="flex items-start gap-2 mb-3 px-2.5 py-2 rounded-lg bg-gradient-to-r from-blue-500/10 to-fuchsia-500/10 border border-blue-400/40">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-800 leading-tight">
                      {t.tokens} · 1 token = 1 render or revision
                    </span>
                  </div>
                  {t.human && (
                    <div className="mb-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gradient-to-r from-blue-600 to-fuchsia-500 text-white text-[10px] font-bold uppercase tracking-wide">
                        Real human designer
                      </span>
                    </div>
                  )}
                  <a
                    href={`/checkout?priceId=${t.priceId}&tier=${encodeURIComponent(t.label)}&ref=wpw`}
                    className="mt-auto inline-flex items-center justify-center h-11 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-blue-500 to-fuchsia-500 hover:brightness-110"
                  >
                    {t.cta}
                  </a>
                </div>
              ))}
            </div>
          </div>

          {/* Print-Ready Production Pack — done-for-you add-on */}
          <div className="max-w-xl mx-auto mt-8 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
            <div className="p-6 sm:p-7">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700 mb-1">
                Add-on · Done for you
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-1">
                Print-Ready Production Pack — $299
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Got your design? Have it made production-ready.
              </p>
              <ul className="space-y-2 mb-5">
                {[
                  "A real human graphic designer outputs your design on the correct vehicle template",
                  "Paneled and print-ready",
                  "You own the print files",
                ].map((t, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[14px] text-gray-700">
                    <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#ec4899] text-white text-[11px] shrink-0">✓</span>
                    {t}
                  </li>
                ))}
              </ul>
              {/* Carry the design's generation id through to the Woo store so
                  the purchase auto-links back to the design (the Woo product
                  captures ?generation_id into line-item meta; wpw-orders-webhook
                  then flips the design/job to the Woo order number). Landing on
                  /try-design?generation_id=<id> passes it through automatically. */}
              <a
                href={(() => {
                  const base = "https://weprintwraps.com/our-products/production-pack-299/";
                  try {
                    const gid = new URLSearchParams(window.location.search).get("generation_id");
                    return gid ? `${base}?generation_id=${encodeURIComponent(gid)}` : base;
                  } catch { return base; }
                })()}
                className="inline-flex items-center justify-center h-11 px-6 rounded-xl text-[15px] font-bold text-white bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:brightness-110"
              >
                Get the Production Pack — $299
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default TryDesign;
