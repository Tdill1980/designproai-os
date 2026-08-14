/**
 * MightyMail — public marketing landing.
 *
 * Pitches the automatic email retargeting system to wrap shops. Mirrors the
 * /quicktext (NeverMissALead) layout: dark theme, hero, math/ROI block,
 * how-it-works, retarget timeline, booster packs, inline signup, FAQ.
 *
 * Signup writes a lead row to public.email_subscribers with
 * source='mightymail-landing' so the marketing team can drip the WPW
 * onboarding series. The CTA also links to /signup for full DesignProAI
 * account creation.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  Mail,
  Sparkles,
  Clock,
  CheckCircle2,
  ChevronDown,
  Send,
  Image as ImageIcon,
  Repeat,
  Target,
  Calculator,
  ShieldCheck,
  Megaphone,
  HeartHandshake,
  Lightbulb,
  GraduationCap,
  Shield,
  Zap,
  MessageSquare,
  Camera,
  BarChart3,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useMightyMailLandingAssets } from "@/hooks/useMightyMailLandingAssets";

const db = supabase as any;

// ── 7-email retarget drip timeline (mirrors mightymail-series.ts) ──────
const DRIP_TIMELINE = [
  { day: "Same day", title: "What did you think?", note: "Soft check-in while the design is still on their mind." },
  { day: "Day 2", title: "Still thinking about the color?", note: "Reframe the decision around what matters: finish + fit." },
  { day: "Day 3-4", title: "We made another option", note: "Variation of the same design — keeps the conversation alive." },
  { day: "Day 5", title: "Most people decide right here", note: "Confidence nudge with social proof and finished examples." },
  { day: "Day 7", title: "Quick note (no pressure)", note: "Lightweight check-in. Customer-friendly, not salesy." },
  { day: "Day 10", title: "Soft close", note: "Lock-in slot offer for the install calendar." },
  { day: "Day 14", title: "Final nudge", note: "Door stays open. One last sincere touch." },
];

// ── 6 Booster Packs (mirrors MightyMail.tsx BOOSTER_PACKS) ─────────────
const PACKS = [
  { id: "authority", name: "Authority", icon: ShieldCheck, tagline: "Make your shop look professional and worth the price.", gradient: "from-blue-500 to-blue-300" },
  { id: "educate", name: "Educate", icon: GraduationCap, tagline: "Help customers understand before they decide.", gradient: "from-emerald-500 to-teal-300" },
  { id: "inspire", name: "Inspire", icon: Lightbulb, tagline: "Show what's possible and get customers excited.", gradient: "from-purple-500 to-violet-300" },
  { id: "promote", name: "Promote", icon: Megaphone, tagline: "Create momentum and drive action.", gradient: "from-green-500 to-emerald-300" },
  { id: "clientcare", name: "ClientCare", icon: HeartHandshake, tagline: "Make every customer feel taken care of, start to finish.", gradient: "from-sky-500 to-cyan-300" },
  { id: "protect", name: "Protect", icon: Shield, tagline: "Get sign-off and cover your shop before the wrap hits the wall.", gradient: "from-slate-500 to-slate-300" },
];

const FAQ = [
  {
    q: "What does the retargeting drip actually send?",
    a: "When you queue a follow-up from the Quote Manager, MightyMail emails the customer with the actual render from their quote, the vehicle details, and a one-click link back to the quote page. The cadence is up to 7 emails over 14 days — soft check-in, design variation, social proof, soft close, final nudge.",
  },
  {
    q: "Where do the renders come from?",
    a: "Whatever was attached to the quote when the shop saved it. The hero render lives on the quote, so the same image the customer saw in the original quote shows up at the top of every retarget email.",
  },
  {
    q: "What if the customer replies or books?",
    a: "The retarget series cancels automatically on conversion. No risk of nagging a customer who already said yes.",
  },
  {
    q: "Is this separate from QuickText?",
    a: "Yes — MightyMail is email. QuickText is the SMS / missed-call auto-text line. They work together: QuickText catches the inbound, MightyMail handles the long-tail follow-up. Same dashboard.",
  },
  {
    q: "Do I need a subscription?",
    a: "MightyMail is included with every DesignProAI plan. The booster packs (Authority, Educate, Inspire, Promote, ClientCare, Protect) are all built in — no add-ons, no per-email fees.",
  },
  {
    q: "Can I change the tone?",
    a: "Every retarget template ships in two voices — Formal and Witty. Pick your shop voice once in your profile and every email automatically resolves to the right tone.",
  },
];

export default function MightyMailInfo() {
  const { toast } = useToast();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const { data: assets = {} } = useMightyMailLandingAssets();

  // Signup form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [shopName, setShopName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // ROI calculator state
  const [quotesPerMonth, setQuotesPerMonth] = useState(40);
  const [avgTicket, setAvgTicket] = useState(3000);
  const [recoverRate, setRecoverRate] = useState(8);
  const recoveredJobs = Math.round((quotesPerMonth * recoverRate) / 100);
  const recoveredRevenue = recoveredJobs * avgTicket;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      toast({
        title: "Enter a valid email",
        description: "We need an email so MightyMail knows where to send things.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await db.from("email_subscribers").upsert(
        {
          email: trimmedEmail,
          phone: phone.trim() || null,
          source: "mightymail-landing",
          unsubscribed: false,
        },
        { onConflict: "email", ignoreDuplicates: false },
      );
      if (error) throw error;
      setSubmitted(true);
      toast({
        title: "You're in.",
        description: "Check your inbox — we'll show you how MightyMail works inside DesignProAI.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sign-up failed";
      toast({ title: "Sign-up failed", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <Helmet>
        <title>MightyMail — Automatic email retargeting for wrap shops · DesignProAI</title>
        <meta
          name="description"
          content="MightyMail follows up on every open quote with the actual design, on autopilot. Six booster packs, two tones, zero per-email fees — included with every DesignProAI plan."
        />
      </Helmet>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-20 pb-16 px-4">
        {assets.hero && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-25"
            style={{ backgroundImage: `url(${assets.hero})` }}
            aria-hidden="true"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-black/40 to-purple-500/10" />
        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold uppercase tracking-wider mb-6">
            <Mail className="w-3.5 h-3.5" /> Included with every DesignProAI plan
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
            Every quote you send.{" "}
            <span className="bg-gradient-to-r from-cyan-300 to-purple-400 bg-clip-text text-transparent">
              Followed up automatically.
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto mb-3">
            MightyMail is the auto-email retargeting engine inside DesignProAI. The customer goes silent,
            we keep showing up — with their <span className="text-cyan-300 font-semibold">actual design</span>{" "}
            in every email — until they book or politely tap out.
          </p>
          <p className="text-base text-white/50 max-w-2xl mx-auto mb-8">
            Built for wrap shops. Triggered from your Quote Manager. Two tones, six booster packs, zero
            per-email fees.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              size="lg"
              className="bg-gradient-to-r from-cyan-500 to-purple-500 hover:brightness-110 text-white font-bold px-8 text-base"
              asChild
            >
              <a href="#signup">
                <Send className="w-4 h-4 mr-2" /> Get MightyMail Free
              </a>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10 font-bold px-8 text-base"
              asChild
            >
              <Link to="/quicktext">
                <MessageSquare className="w-4 h-4 mr-2" /> See QuickText (SMS)
              </Link>
            </Button>
          </div>
          <p className="text-xs text-white/40 mt-3">
            Already a DesignProAI shop?{" "}
            <Link to="/mightymail" className="text-cyan-300 hover:underline">
              Open MightyMail
            </Link>
          </p>
        </div>
      </section>

      {/* ── ROI Calculator ───────────────────────────────────────────── */}
      <section className="py-12 px-4 border-t border-white/5 bg-white/[0.02]">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-bold uppercase tracking-wider mb-3">
              <Calculator className="w-3 h-3" /> Run your numbers
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold">
              What does an unfollowed quote cost you?
            </h2>
            <p className="text-sm text-white/50 mt-2">
              Industry data: 8–14% of cold quotes convert when retargeted with the design attached.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
            <div className="grid sm:grid-cols-3 gap-6 mb-8">
              <div>
                <Label className="text-xs uppercase tracking-wider text-white/50 mb-2 block">
                  Quotes / month
                </Label>
                <input
                  type="range"
                  min={5}
                  max={200}
                  value={quotesPerMonth}
                  onChange={(e) => setQuotesPerMonth(parseInt(e.target.value))}
                  className="w-full accent-cyan-400"
                />
                <div className="text-2xl font-bold text-cyan-300 mt-1">{quotesPerMonth}</div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-white/50 mb-2 block">
                  Avg wrap ticket
                </Label>
                <input
                  type="range"
                  min={500}
                  max={10000}
                  step={250}
                  value={avgTicket}
                  onChange={(e) => setAvgTicket(parseInt(e.target.value))}
                  className="w-full accent-cyan-400"
                />
                <div className="text-2xl font-bold text-cyan-300 mt-1">${avgTicket.toLocaleString()}</div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-white/50 mb-2 block">
                  Retarget recovery rate
                </Label>
                <input
                  type="range"
                  min={2}
                  max={20}
                  value={recoverRate}
                  onChange={(e) => setRecoverRate(parseInt(e.target.value))}
                  className="w-full accent-cyan-400"
                />
                <div className="text-2xl font-bold text-cyan-300 mt-1">{recoverRate}%</div>
              </div>
            </div>

            <div className="border-t border-white/10 pt-6 grid sm:grid-cols-2 gap-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-white/50 mb-1">
                  Recovered jobs / month
                </div>
                <div className="text-3xl font-bold text-emerald-300">{recoveredJobs}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-white/50 mb-1">
                  Recovered revenue / month
                </div>
                <div className="text-3xl font-bold text-emerald-300">
                  ${recoveredRevenue.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="py-16 px-4 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">How MightyMail works</h2>
            <p className="text-white/60">No template editing. No per-email fees. No drip-builder complexity.</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            {[
              {
                icon: Target,
                title: "Save the quote",
                body: "Build a quote in QuickQuote or any product tool. The hero render attaches automatically.",
              },
              {
                icon: Repeat,
                title: "Queue the drip",
                body: "Click the MightyMail icon in the Quote Manager. Pick 3, 5, or 7-day follow-up. Done.",
              },
              {
                icon: ImageIcon,
                title: "Customer sees the design",
                body: "Each email leads with the actual render they were quoted — not a generic stock photo.",
              },
            ].map((step, i) => (
              <div
                key={i}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
              >
                <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4">
                  <step.icon className="w-5 h-5 text-cyan-300" />
                </div>
                <div className="text-xs uppercase tracking-wider text-white/40 mb-1">Step {i + 1}</div>
                <h3 className="text-lg font-bold mb-2">{step.title}</h3>
                <p className="text-sm text-white/60 leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── USPs — Three things no other email tool does ─────────────── */}
      <section className="py-16 px-4 border-t border-white/5 bg-gradient-to-b from-transparent via-cyan-500/[0.04] to-transparent">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-[11px] font-bold uppercase tracking-wider mb-3">
              <Sparkles className="w-3 h-3" /> Why MightyMail wins
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">
              Three things <span className="bg-gradient-to-r from-cyan-300 to-purple-400 bg-clip-text text-transparent">no other email tool</span> does for wrap shops
            </h2>
            <p className="text-white/60 max-w-2xl mx-auto">
              Built for the way wrap quotes actually convert — visual first, automated second, measurable third.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-5">
            {/* USP 1 — Screenshot Tool */}
            <div className="relative rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/[0.08] to-transparent p-6 overflow-hidden">
              <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-400/30 text-[9px] font-bold uppercase tracking-wider text-cyan-200">
                USP 1
              </div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center mb-4 shadow-lg shadow-cyan-500/20">
                <Camera className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-bold mb-2">Screenshot Tool</h3>
              <p className="text-sm text-cyan-100/80 leading-relaxed mb-3">
                Every retarget email auto-embeds the <span className="text-cyan-300 font-semibold">actual render</span> from
                the quote — the same photoreal preview the customer saw the first time.
              </p>
              <ul className="space-y-1.5 text-sm text-white/70">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <span>Hero design embedded above the headline</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <span>Live template preview before you send</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <span>Falls back gracefully if no render exists</span>
                </li>
              </ul>
              {assets["usp-screenshot"] && (
                <img
                  src={assets["usp-screenshot"]}
                  alt="Screenshot tool demo"
                  loading="lazy"
                  className="mt-4 w-full rounded-lg border border-cyan-500/20"
                />
              )}
            </div>

            {/* USP 2 — Auto Retargeting */}
            <div className="relative rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.08] to-transparent p-6 overflow-hidden">
              <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-400/30 text-[9px] font-bold uppercase tracking-wider text-purple-200">
                USP 2
              </div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-400 to-fuchsia-600 flex items-center justify-center mb-4 shadow-lg shadow-purple-500/20">
                <RotateCcw className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-bold mb-2">Auto Retargeting</h3>
              <p className="text-sm text-purple-100/80 leading-relaxed mb-3">
                Queue the drip once — MightyMail keeps showing up across <span className="text-purple-300 font-semibold">14 days</span>,
                then stops the moment the customer converts.
              </p>
              <ul className="space-y-1.5 text-sm text-white/70">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                  <span>7-email cadence on autopilot</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                  <span>Auto-cancels on conversion (no nag)</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                  <span>Formal + Witty tones, picked per shop</span>
                </li>
              </ul>
              {assets["usp-autoretarget"] && (
                <img
                  src={assets["usp-autoretarget"]}
                  alt="Auto-retargeting cadence"
                  loading="lazy"
                  className="mt-4 w-full rounded-lg border border-purple-500/20"
                />
              )}
            </div>

            {/* USP 3 — Analytics */}
            <div className="relative rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] to-transparent p-6 overflow-hidden">
              <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-[9px] font-bold uppercase tracking-wider text-emerald-200">
                USP 3
              </div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/20">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-bold mb-2">Built-in Analytics</h3>
              <p className="text-sm text-emerald-100/80 leading-relaxed mb-3">
                Every send is tracked — opens, clicks, top CTAs, per-recipient timeline.{" "}
                <span className="text-emerald-300 font-semibold">Know which email closed the wrap.</span>
              </p>
              <ul className="space-y-1.5 text-sm text-white/70">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Open + click rates per campaign</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Top-clicked URLs ranked</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Per-recipient open/click timeline</span>
                </li>
              </ul>
              {assets["usp-analytics"] && (
                <img
                  src={assets["usp-analytics"]}
                  alt="Analytics dashboard"
                  loading="lazy"
                  className="mt-4 w-full rounded-lg border border-emerald-500/20"
                />
              )}
            </div>
          </div>

          {(assets["social-proof-1"] || assets["social-proof-2"]) && (
            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
              {assets["social-proof-1"] && (
                <img
                  src={assets["social-proof-1"]}
                  alt="Customer wrap"
                  loading="lazy"
                  className="w-full rounded-2xl border border-white/10"
                />
              )}
              {assets["social-proof-2"] && (
                <img
                  src={assets["social-proof-2"]}
                  alt="Customer wrap"
                  loading="lazy"
                  className="w-full rounded-2xl border border-white/10"
                />
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Retarget Drip Timeline ───────────────────────────────────── */}
      <section className="py-16 px-4 border-t border-white/5 bg-white/[0.02]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-bold uppercase tracking-wider mb-3">
              <Clock className="w-3 h-3" /> 14-day retarget engine
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">The full 7-email sequence</h2>
            <p className="text-white/60">
              Soft-touch, design-led, and shop-friendly. Cancels automatically the moment the customer converts.
            </p>
          </div>

          <div className="space-y-3">
            {DRIP_TIMELINE.map((email, i) => (
              <div
                key={i}
                className="flex items-start gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
              >
                <div className="shrink-0 w-20 sm:w-24 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-white/40">Email {i + 1}</div>
                  <div className="text-sm font-bold text-violet-300">{email.day}</div>
                </div>
                <div className="flex-1 border-l border-white/10 pl-4">
                  <h3 className="font-bold text-base mb-1">{email.title}</h3>
                  <p className="text-sm text-white/60">{email.note}</p>
                </div>
                <CheckCircle2 className="w-5 h-5 text-emerald-400/70 shrink-0 mt-1" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Booster Packs ────────────────────────────────────────────── */}
      <section className="py-16 px-4 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] font-bold uppercase tracking-wider mb-3">
              <Sparkles className="w-3 h-3" /> Six booster packs · all included
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">Beyond retargeting</h2>
            <p className="text-white/60 max-w-2xl mx-auto">
              MightyMail also ships six purpose-built email packs you can activate for any customer with
              one click. Each pack is a multi-email sequence written for wrap shops.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {PACKS.map((pack) => (
              <div
                key={pack.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-5 hover:bg-white/[0.05] transition-colors"
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center mb-3",
                    pack.gradient,
                  )}
                >
                  <pack.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-bold mb-1">{pack.name} Pack</h3>
                <p className="text-sm text-white/60 leading-relaxed">{pack.tagline}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Sign Up ──────────────────────────────────────────────────── */}
      <section id="signup" className="py-16 px-4 border-t border-white/5 bg-gradient-to-b from-cyan-500/5 to-purple-500/5">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[11px] font-bold uppercase tracking-wider mb-3">
              <Zap className="w-3 h-3" /> Get started
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">Start using MightyMail today</h2>
            <p className="text-white/60">
              Drop your details and we'll send you the inside tour. Already have a DesignProAI account?{" "}
              <Link to="/login" className="text-cyan-300 hover:underline">
                Log in
              </Link>{" "}
              and open <Link to="/mightymail" className="text-cyan-300 hover:underline">MightyMail</Link>.
            </p>
          </div>

          <form
            onSubmit={handleSignup}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8 space-y-4"
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="mm-name" className="text-xs uppercase tracking-wider text-white/50 mb-2 block">
                  Your name
                </Label>
                <Input
                  id="mm-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  className="bg-black/40 border-white/10 text-white placeholder:text-white/30"
                  autoComplete="name"
                />
              </div>
              <div>
                <Label htmlFor="mm-shop" className="text-xs uppercase tracking-wider text-white/50 mb-2 block">
                  Shop name
                </Label>
                <Input
                  id="mm-shop"
                  type="text"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="Apex Wraps"
                  className="bg-black/40 border-white/10 text-white placeholder:text-white/30"
                  autoComplete="organization"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="mm-email" className="text-xs uppercase tracking-wider text-white/50 mb-2 block">
                Email <span className="text-rose-400">*</span>
              </Label>
              <Input
                id="mm-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourshop.com"
                className="bg-black/40 border-white/10 text-white placeholder:text-white/30"
                autoComplete="email"
              />
            </div>

            <div>
              <Label htmlFor="mm-phone" className="text-xs uppercase tracking-wider text-white/50 mb-2 block">
                Phone (optional)
              </Label>
              <Input
                id="mm-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 555-0123"
                className="bg-black/40 border-white/10 text-white placeholder:text-white/30"
                autoComplete="tel"
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                type="submit"
                disabled={submitting || submitted}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-purple-500 hover:brightness-110 text-white font-bold disabled:opacity-60"
              >
                {submitted ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" /> You're in
                  </>
                ) : submitting ? (
                  "Submitting…"
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" /> Sign Me Up
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1 border-white/20 text-white hover:bg-white/10"
                asChild
              >
                <Link to="/signup">Create a DesignProAI Account</Link>
              </Button>
            </div>

            <p className="text-[11px] text-white/40 text-center pt-2">
              We email shop-owner-relevant updates only. Unsubscribe anytime.
            </p>
          </form>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section className="py-16 px-4 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-10">Questions</h2>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-white/[0.02]"
                >
                  <span className="font-semibold">{item.q}</span>
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 text-white/40 shrink-0 transition-transform",
                      openFaq === i && "rotate-180",
                    )}
                  />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4 text-sm text-white/70 leading-relaxed">{item.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer CTA ───────────────────────────────────────────────── */}
      <section className="py-16 px-4 border-t border-white/5 bg-gradient-to-b from-transparent to-cyan-500/5">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">
            Quote sent. Wrap installed. No follow-up missed.
          </h2>
          <p className="text-white/60 mb-6">
            MightyMail is included with every DesignProAI plan. QuickText handles the SMS side.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild className="bg-gradient-to-r from-cyan-500 to-purple-500 hover:brightness-110 text-white font-bold px-8">
              <a href="#signup">
                <Mail className="w-4 h-4 mr-2" /> Sign up for MightyMail
              </a>
            </Button>
            <Button asChild variant="outline" className="border-white/20 text-white hover:bg-white/10 font-bold px-8">
              <Link to="/quicktext">
                <MessageSquare className="w-4 h-4 mr-2" /> Pair it with QuickText
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
