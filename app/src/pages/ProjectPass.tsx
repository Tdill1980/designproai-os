/**
 * ProjectPass — Pre-launch design preview of the RestyleProAI™
 * Design & Marketing Engine.
 *
 * Project Pass is a one-time $49 purchase: ONE AI design generation
 * on ONE tool of the buyer's choice (ColorPro, PatternPro, or
 * RestyleLibrary). 6 photorealistic 4K views of their vehicle in that
 * design, theirs to keep. Available only during the pre-launch window —
 * a limited-time on-ramp before monthly plans go live.
 *
 * Tier model:
 *   FREE (signup)    → Dashboard, basic CMS, Quote tool, Buy products
 *   PROJECT PASS     → ONE AI design gen on ONE chosen tool ($49)
 *   ANNUAL (launch)  → Unlimited gens, save prices/products,
 *                      customize, MightyMail, full Marketing Engine
 *
 * Positioning: this is a DESIGN PREVIEW, not the full engine. Every
 * piece of copy must make that distinction clear.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Clock, Zap, Car, Bike, Ship, Truck,
  Palette, Layers, Library, Download, Star, ArrowRight,
  LayoutDashboard, FileText, ShoppingCart, Sparkles, Mail, Lock,
} from "lucide-react";

// ── CONFIG ──────────────────────────────────────────────────────
const PROJECT_PASS_PRICE_ID = "price_1TQt4RH1V6OhfCAPy2Z7bW4u";
const PASS_PRICE = 49;
const REGULAR_PRICE = 99; // anchor: feels like "half off preview pricing"

// SaaS launch date — preview pricing ends here
const LAUNCH_DATE = new Date("2026-05-15T00:00:00-07:00");

// ── COUNTDOWN HOOK ──────────────────────────────────────────────
function useCountdown(target: Date) {
  const calc = () => {
    const diff = Math.max(0, target.getTime() - Date.now());
    return {
      days: Math.floor(diff / 86400000),
      hours: Math.floor((diff % 86400000) / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
      expired: diff <= 0,
    };
  };
  const [time, setTime] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setTime(calc), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

// ── STYLES ──────────────────────────────────────────────────────
const GRAD = "bg-gradient-to-r from-[#E040FB] via-[#8B5CF6] to-[#3B82F6]";
const GRAD_TEXT = "bg-gradient-to-r from-[#E040FB] via-[#8B5CF6] to-[#3B82F6] bg-clip-text text-transparent";

const FEATURES = [
  { icon: Sparkles, label: "1 AI design generation on the tool you choose" },
  { icon: Star, label: "Pick one: ColorPro, PatternPro, or RestyleLibrary" },
  { icon: Car, label: "Any vehicle — car, truck, SUV, van, moto, boat, RV" },
  { icon: Download, label: "6 photorealistic views, full 4K downloads" },
  { icon: Clock, label: "90 days to redeem your pass" },
  { icon: Zap, label: "Pre-launch only — limited time before monthly plans go live" },
];

// What you can pick when you redeem the pass
const TOOL_CHOICES = [
  { icon: Palette, name: "ColorPro", desc: "Any color, any finish — gloss, satin, matte, chrome" },
  { icon: Layers, name: "PatternPro", desc: "Camo, carbon, custom patterns on any panel" },
  { icon: Library, name: "RestyleLibrary", desc: "Premium designer wraps from our curated library" },
];

// What's free with signup — no Project Pass needed
const FREE_TIER = [
  { icon: LayoutDashboard, label: "Full dashboard access" },
  { icon: FileText, label: "Basic CMS for your shop" },
  { icon: FileText, label: "Quote tool — get pricing on any product" },
  { icon: ShoppingCart, label: "Buy products direct (one-off purchases)" },
];

// What unlocks at launch on monthly plans
const ANNUAL_UNLOCKS = [
  { icon: Sparkles, label: "Unlimited AI design generations on every tool" },
  { icon: Star, label: "DesignProAI · GraphicsPro · FadeWraps · WBTY · ApprovePro" },
  { icon: Library, label: "Save prices, products & customer lists" },
  { icon: Layers, label: "Customize products & build your catalog" },
  { icon: Mail, label: "MightyMail email marketing engine" },
  { icon: Star, label: "CreatorMarket · PrintPro Gateway · QuickQuote · Engine Room" },
];

const VEHICLES = [
  { icon: Car, label: "Cars & SUVs" },
  { icon: Truck, label: "Trucks & Vans" },
  { icon: Bike, label: "Motorcycles" },
  { icon: Ship, label: "Boats & RVs" },
];

function TimerBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-[#111] border border-[#222] flex items-center justify-center">
        <span className="text-2xl sm:text-3xl font-bold text-white font-mono">
          {String(value).padStart(2, "0")}
        </span>
      </div>
      <span className="text-[10px] text-[#555] uppercase tracking-wider mt-1.5">{label}</span>
    </div>
  );
}

const ProjectPass = () => {
  const navigate = useNavigate();
  const countdown = useCountdown(LAUNCH_DATE);

  const handleBuyPass = () => {
    navigate(`/checkout?priceId=${encodeURIComponent(PROJECT_PASS_PRICE_ID)}&tier=Project+Pass`);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Helmet>
        <title>Project Pass — $49 AI Design Gen | RestyleProAI Design & Marketing Engine</title>
        <meta name="description" content={`$${PASS_PRICE} buys one AI design generation on one tool of your choice — 6 photorealistic 4K views of your vehicle. Pre-launch preview of the RestyleProAI Design & Marketing Engine. Limited-time offer before monthly plans go live.`} />
      </Helmet>

      {/* Gradient bar */}
      <div className={`h-1 ${GRAD}`} />

      <div className="max-w-4xl mx-auto px-4 py-10 sm:py-16 space-y-10">

        {/* ── HEADER ─────────────────────────────────────────── */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 bg-[#111] border border-[#222] rounded-full px-4 py-1.5 text-[11px] text-cyan-400 uppercase tracking-widest font-mono">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            Design Preview · RestyleProAI™ Design & Marketing Engine
          </div>

          <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
            <span className={GRAD_TEXT}>Project Pass</span>
          </h1>

          <p className="text-base sm:text-lg text-[#bbb] max-w-2xl mx-auto leading-relaxed">
            <span className="text-white font-semibold">${PASS_PRICE} buys one AI design generation</span> on
            one tool of your choice — a hands-on preview of the
            <span className={`font-semibold ${GRAD_TEXT}`}> RestyleProAI Design & Marketing Engine</span>
            {" "}before it launches. 6 photorealistic 4K views of your vehicle, yours to keep.
          </p>

          <p className="text-xs text-[#666] max-w-xl mx-auto">
            One project per pass. Buy as many as you want. Pre-launch only — once monthly plans
            go live, this offer ends.
          </p>
        </div>

        {/* ── COUNTDOWN TIMER ────────────────────────────────── */}
        <div className="text-center space-y-3">
          <p className="text-xs text-amber-400 uppercase tracking-widest font-mono">
            Limited time · Pre-launch pricing ends at launch
          </p>
          <div className="flex justify-center gap-3">
            <TimerBox value={countdown.days} label="Days" />
            <TimerBox value={countdown.hours} label="Hours" />
            <TimerBox value={countdown.minutes} label="Min" />
            <TimerBox value={countdown.seconds} label="Sec" />
          </div>
        </div>

        {/* ── VIDEO DEMO ──────────────────────────────────────── */}
        {/* Replace YOUTUBE_VIDEO_ID with your real video ID after uploading */}
        <div className="max-w-3xl mx-auto">
          <p className="text-center text-xs text-[#666] uppercase tracking-widest font-mono mb-3">
            See It In Action
          </p>
          <div className="relative rounded-2xl overflow-hidden border border-[#1A1A1A] aspect-video bg-[#111]">
            <iframe
              src="https://www.youtube.com/embed/YOUTUBE_VIDEO_ID"
              title="Project Pass Demo — RestylePro"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
            />
          </div>
        </div>

        {/* ── VEHICLE TYPES ──────────────────────────────────── */}
        <div className="flex justify-center gap-4 sm:gap-6">
          {VEHICLES.map((v) => (
            <div key={v.label} className="flex flex-col items-center gap-1.5">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-[#111] border border-[#222] flex items-center justify-center">
                <v.icon className="w-6 h-6 text-cyan-400" />
              </div>
              <span className="text-[10px] text-[#666] font-medium">{v.label}</span>
            </div>
          ))}
        </div>

        {/* ── PICK ONE TOOL ──────────────────────────────────── */}
        <div className="space-y-4">
          <div className="text-center space-y-1.5">
            <p className="text-xs text-cyan-400 uppercase tracking-widest font-mono">Step 2 — Pick Your Tool</p>
            <h3 className="text-xl sm:text-2xl font-bold text-white">
              Each Project Pass = one tool of your choice
            </h3>
            <p className="text-xs text-[#666]">
              You'll select your tool inside the dashboard after checkout.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {TOOL_CHOICES.map((t) => (
              <div
                key={t.name}
                className="rounded-xl bg-[#0D0D0D] border border-[#1A1A1A] p-5 space-y-2 hover:border-[#333] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg ${GRAD} flex items-center justify-center`}>
                    <t.icon className="w-4 h-4 text-white" />
                  </div>
                  <h4 className="text-sm font-bold text-white">{t.name}</h4>
                </div>
                <p className="text-xs text-[#888] leading-relaxed">{t.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── PRICING CARD ───────────────────────────────────── */}
        <div className="max-w-md mx-auto">
          <div className="relative rounded-2xl border-2 border-[#8B5CF6] bg-[#0D0D0D] overflow-hidden">
            {/* Preview ribbon */}
            <div className={`${GRAD} text-center py-2 text-xs font-bold uppercase tracking-widest`}>
              <Zap className="w-3.5 h-3.5 inline mr-1 -mt-0.5 text-amber-300" />
              Limited Time · Pre-Launch Pricing
            </div>

            <div className="p-6 sm:p-8 space-y-6">
              <div className="text-center">
                <h2 className="text-2xl font-bold">Project Pass</h2>
                <p className="text-sm text-[#888] mt-1">
                  One AI design generation. One tool of your choice.
                </p>
              </div>

              {/* Price */}
              <div className="text-center">
                <div className="flex items-baseline justify-center gap-2">
                  <span className="text-lg text-[#555] line-through">${REGULAR_PRICE}</span>
                  <span className="text-5xl font-black text-white">${PASS_PRICE}</span>
                  <span className="text-sm text-[#666]">/ gen</span>
                </div>
                <p className="text-xs text-[#666] mt-1">A la carte. Buy as many as you want.</p>
              </div>

              {/* Features */}
              <ul className="space-y-3">
                {FEATURES.map((f) => (
                  <li key={f.label} className="flex items-start gap-3">
                    <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span className="text-sm text-[#ccc]">{f.label}</span>
                  </li>
                ))}
              </ul>

              {/* CTA Button */}
              <Button
                onClick={handleBuyPass}
                className={`w-full h-14 text-lg font-bold rounded-xl ${GRAD} hover:brightness-110 border-0 transition-all`}
              >
                Get Project Pass — ${PASS_PRICE}
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>

              <p className="text-center text-[10px] text-[#555]">
                Secure Stripe checkout · Pick your tool inside the dashboard
              </p>
            </div>
          </div>
        </div>

        {/* ── HOW IT WORKS ───────────────────────────────────── */}
        <div className="space-y-6">
          <h3 className="text-center text-lg font-bold text-white">How It Works</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { step: "1", title: "Buy a Pass", desc: `One-time $${PASS_PRICE}. Each pass = one AI design generation, redeemable on the tool you pick.` },
              { step: "2", title: "Pick Your Tool & Vehicle", desc: "Choose ColorPro, PatternPro, or RestyleLibrary inside the dashboard. Upload any vehicle photo." },
              { step: "3", title: "Get 6 Views", desc: "Side, front, rear, close-up, hood, passenger — full 4K resolution, yours to keep." },
            ].map((s) => (
              <div key={s.step} className="rounded-xl bg-[#111] border border-[#1A1A1A] p-5 text-center space-y-2">
                <div className={`w-10 h-10 rounded-full ${GRAD} flex items-center justify-center mx-auto text-white font-bold text-lg`}>
                  {s.step}
                </div>
                <h4 className="text-sm font-bold text-white">{s.title}</h4>
                <p className="text-xs text-[#888] leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── TIER COMPARISON: FREE / PASS / ANNUAL ───────────── */}
        <div className="rounded-2xl border border-[#1A1A1A] bg-[#0D0D0D] p-6 sm:p-10 space-y-6">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 bg-[#111] border border-[#222] rounded-full px-4 py-1.5 text-[11px] text-cyan-400 uppercase tracking-widest font-mono">
              How Project Pass Fits In
            </div>
            <h3 className="text-2xl sm:text-3xl font-bold">
              Three tiers. One <span className={GRAD_TEXT}>RestyleProAI™</span> engine.
            </h3>
            <p className="text-sm text-[#888] max-w-xl mx-auto leading-relaxed">
              Sign up for free and run your shop. Pay ${PASS_PRICE} only when you want a hands-on AI
              design gen. Upgrade to a monthly plan when you're ready to ship without limits.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            {/* FREE */}
            <div className="rounded-xl bg-[#0A0A0A] border border-[#1F1F1F] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">Free</h4>
                <span className="text-[10px] text-[#666] font-mono uppercase">on signup</span>
              </div>
              <ul className="space-y-2 text-sm text-[#ccc]">
                {FREE_TIER.map((f) => (
                  <li key={f.label} className="flex gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{f.label}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* PROJECT PASS */}
            <div className="rounded-xl bg-[#0A0A0A] border-2 border-[#8B5CF6] p-5 space-y-3 relative">
              <div className={`absolute -top-2.5 left-1/2 -translate-x-1/2 ${GRAD} text-[10px] font-bold uppercase tracking-widest px-3 py-0.5 rounded-full text-white`}>
                You're Here
              </div>
              <div className="flex items-center justify-between pt-1">
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">Project Pass</h4>
                <span className="text-[10px] text-[#666] font-mono uppercase">${PASS_PRICE} / gen</span>
              </div>
              <ul className="space-y-2 text-sm text-[#ccc]">
                <li className="flex gap-2"><Sparkles className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" /> 1 AI design gen on 1 tool</li>
                <li className="flex gap-2"><Sparkles className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" /> 6 photorealistic 4K views</li>
                <li className="flex gap-2"><Sparkles className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" /> Renders yours to keep</li>
                <li className="flex gap-2"><Sparkles className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" /> Buy as many as you want</li>
                <li className="flex gap-2"><Sparkles className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" /> Pre-launch only — limited time</li>
              </ul>
            </div>

            {/* ANNUAL */}
            <div className="rounded-xl bg-[#0A0A0A] border border-[#1F1F1F] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">Annual</h4>
                <span className="text-[10px] text-cyan-400 font-mono uppercase flex items-center gap-1">
                  <Lock className="w-3 h-3" /> at launch
                </span>
              </div>
              <ul className="space-y-2 text-sm text-[#ccc]">
                {ANNUAL_UNLOCKS.map((a) => (
                  <li key={a.label} className="flex gap-2">
                    <a.icon className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                    <span>{a.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="text-center text-xs text-[#555] pt-2">
            Production packs (print-ready cuts + install guides) are a separate <span className="text-[#888] font-semibold">$299</span> a la carte add-on at any tier.
          </p>
        </div>

        {/* ── FAQ ─────────────────────────────────────────────── */}
        <div className="space-y-6">
          <h3 className="text-center text-lg font-bold text-white">Common Questions</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              {
                q: "What exactly do I get for $49?",
                a: `One AI design generation on one tool of your choice (ColorPro, PatternPro, or RestyleLibrary), producing 6 photorealistic 4K views of your vehicle. Renders are yours to keep. Not a subscription — no recurring billing.`,
              },
              {
                q: "Is anything free without a Project Pass?",
                a: "Yes. Sign up for free and you get full dashboard access, basic CMS for your shop, the Quote tool to price any product, and direct product purchases. The Project Pass is only for AI design generations.",
              },
              {
                q: "Can I buy more than one pass?",
                a: `Buy as many as you want — each $${PASS_PRICE} is one a la carte design gen. Want to try all three tools? Buy three passes. Want to render five vehicles? Buy five.`,
              },
              {
                q: "What happens at launch?",
                a: `Project Pass is a pre-launch-only offer. When monthly plans go live, the $${PASS_PRICE} a la carte option ends and AI design gens move into the monthly tiers. We'll let you know when you're buying enough passes that a monthly plan would be cheaper — for example, "this is your 3rd gen this month, here's what Starter would save you."`,
              },
              {
                q: "What unlocks on monthly plans?",
                a: "Unlimited AI design generations, every tool (DesignProAI, GraphicsPro, FadeWraps, WBTY, ApprovePro), saved prices/products/customers, product customization, MightyMail email marketing, CreatorMarket, PrintPro Gateway, and the full Engine Room.",
              },
              {
                q: "What about production-ready files?",
                a: "Production packs (print-ready panel cuts + install guides) are a separate $299 a la carte add-on at any tier. The Project Pass is render previews only — not panelized output.",
              },
              {
                q: "How long do I have to redeem my pass?",
                a: "90 days from purchase. Use it before, during, or after the public launch.",
              },
              {
                q: "Refund policy?",
                a: "Full refund within 7 days if you haven't redeemed your gen. Once the gen runs, the pass is non-refundable.",
              },
            ].map((item) => (
              <div
                key={item.q}
                className="rounded-xl bg-[#0D0D0D] border border-[#1A1A1A] p-5 space-y-2"
              >
                <h4 className="text-sm font-bold text-white">{item.q}</h4>
                <p className="text-xs text-[#888] leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── BOTTOM CTA ─────────────────────────────────────── */}
        <div className="text-center space-y-3 pb-10">
          <p className="text-sm text-[#888]">
            Post your design + tag <span className="text-cyan-400 font-bold">@RestyleProAI</span> → get a second vehicle free.
          </p>
          <Button
            onClick={handleBuyPass}
            variant="outline"
            className="border-[#333] text-white hover:bg-[#111] h-12 px-8"
          >
            Get Project Pass — ${PASS_PRICE} / gen
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
          <p className="text-[10px] text-[#555] pt-1">
            Limited-time pre-launch offer · One project per pass · Offer ends when monthly plans go live
          </p>
        </div>
      </div>
    </div>
  );
};

export default ProjectPass;
