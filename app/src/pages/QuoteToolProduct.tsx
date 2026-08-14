/**
 * QuoteToolProduct — public-facing product / SaaS upgrade landing page
 * for QuickQuote. Mirrors the pattern used by other tool product pages
 * (ColorPro, FadeWraps) — public route, no auth required, designed
 * to convert prospective shops into trial signups or paid subscribers.
 *
 * Numbers are pulled from the source-of-truth tier prices:
 *   src/hooks/useToolAccess.ts (TIER_PRICING)
 *
 * WPW family discount is the same +$50/mo savings pattern used in
 * the wizard so messaging stays consistent across surfaces.
 */

import { Link } from "react-router-dom";
import {
  ArrowRight,
  Briefcase,
  Calculator,
  CheckCircle2,
  Mail,
  Send,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

const FEATURES = [
  {
    icon: Calculator,
    title: "Real-time pricing math",
    body: "Plug in vehicle, film, finish, coverage. QuickQuote computes labor, material, markup, and tax in real time. Numbers match your shop's pricing config — not guesses.",
  },
  {
    icon: Send,
    title: "Branded customer quotes",
    body: "Your logo, your shop, your colors. Customers receive a clean professional quote that closes — not a sketchy spreadsheet attachment.",
  },
  {
    icon: Briefcase,
    title: "Quote → order tracking built-in",
    body: "When a customer pays, QuickQuote auto-matches the order and updates status to 'converted'. Your dashboard shows real customer revenue, not just costs.",
  },
  {
    icon: TrendingUp,
    title: "Profit per job, not just spend",
    body: "Every quote feeds the Profit pillar — Revenue, Cost, Profit, and Margin per job. Show your team the numbers that actually matter.",
  },
  {
    icon: Mail,
    title: "Automated follow-ups",
    body: "Cold quotes get reactivation emails. Warm quotes get nudges. MightyMail integration handles it without you lifting a finger.",
  },
  {
    icon: Sparkles,
    title: "Works with the whole stack",
    body: "Plug in renders from ColorPro, designs from DesignPro, panels from PrintPro. Quotes inherit everything — no double entry.",
  },
];

const COMPARE = [
  { feature: "Branded customer-facing quotes", standard: true, wpw: true },
  { feature: "Real-time labor + material math", standard: true, wpw: true },
  { feature: "Quote → order auto-matching", standard: true, wpw: true },
  { feature: "Per-job profit + margin analytics", standard: true, wpw: true },
  { feature: "WPW catalog 1:1 (vs PrintPro rebrand)", standard: false, wpw: true },
  { feature: "Easy reorder from past WPW jobs", standard: false, wpw: true },
  { feature: "Free CMS publishing add-on", standard: false, wpw: true },
];

export default function QuoteToolProduct() {
  return (
    <div className="min-h-screen bg-black text-white">
      <Header />

      {/* Hero */}
      <section className="relative pt-20 pb-16 sm:pt-28 sm:pb-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-fuchsia-500/5" />
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-fuchsia-500/10 rounded-full blur-[120px]" />

        <div className="relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl text-center">
          <Badge className="mb-5 bg-cyan-500/10 text-cyan-300 border-cyan-500/30 text-[11px] font-bold uppercase tracking-wider">
            QuickQuote · Web Tool
          </Badge>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black leading-tight">
            Quote a wrap in 90 seconds.
            <br />
            <span className="bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent">
              Close it the same day.
            </span>
          </h1>
          <p className="mt-5 text-lg text-zinc-300 max-w-2xl mx-auto leading-relaxed">
            A real quoting engine for wrap shops — branded, on-the-go, and wired into the same dashboard that tracks your profit per job. No more pricing on a napkin.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white border-0 hover:opacity-90 px-8">
              <Link to="/signup">
                Start free <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/20 hover:bg-white/5">
              <Link to="/quick-quote">Try the live tool</Link>
            </Button>
          </div>

          <p className="mt-4 text-xs text-zinc-500">
            Included on every paid tier · Free for WePrintWraps customers
          </p>
        </div>
      </section>

      {/* Features grid */}
      <section className="relative py-16 border-t border-white/10">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-3">
            What's inside QuickQuote
          </h2>
          <p className="text-center text-zinc-400 mb-12 max-w-2xl mx-auto">
            Everything a wrap shop needs to send a professional quote, track conversion, and see the profit on every closed job.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-5 hover:border-cyan-500/40 transition group"
                >
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-fuchsia-500 flex items-center justify-center mb-3 shadow-lg">
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-1.5">{f.title}</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">{f.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="relative py-16 border-t border-white/10 bg-gradient-to-b from-transparent to-cyan-500/5">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-3">
            QuoteTool — $99/mo
          </h2>
          <p className="text-center text-zinc-400 mb-10 max-w-2xl mx-auto">
            Standalone add-on. Bolt onto any design tier — Starter through DesignPro Plus. One tool that captures leads 24/7 while you're in the booth.
          </p>

          <div className="max-w-lg mx-auto rounded-xl border-2 border-cyan-500/60 bg-gradient-to-br from-cyan-500/10 to-fuchsia-500/10 p-8 text-center shadow-[0_0_30px_rgba(6,182,212,0.15)]">
            <div className="flex items-baseline justify-center gap-2 mb-4">
              <span className="text-5xl font-black text-white">$99</span>
              <span className="text-zinc-400 text-lg">/mo</span>
            </div>
            <ul className="space-y-2 text-sm text-zinc-300 text-left max-w-sm mx-auto mb-6">
              <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" /> Branded QuickQuote on your website</li>
              <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" /> Instant wrap estimates for customers</li>
              <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" /> 1,664 vehicle database with sq ft lookup</li>
              <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" /> Regional labor rates + film cost calculator</li>
              <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" /> Customer CRM — every quote builds your database</li>
              <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" /> Dashboard analytics — funnel, conversion, revenue</li>
              <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" /> Works with any design tier or standalone</li>
            </ul>
            <Button asChild className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white border-0 hover:opacity-90 px-8 h-12 text-base font-semibold">
              <Link to="/pricing">Get QuoteTool</Link>
            </Button>
            <p className="mt-4 text-xs text-zinc-500">Cancel anytime. No design tier required.</p>
          </div>
        </div>
      </section>

      {/* WPW comparison */}
      <section className="relative py-16 border-t border-white/10">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-3">
            Standard vs WePrintWraps customer
          </h2>
          <p className="text-center text-zinc-400 mb-10 max-w-2xl mx-auto">
            QuickQuote works for everyone. WePrintWraps customers get an extra layer that ties quoting straight into their existing reorder + production flow — at no extra cost.
          </p>

          <div className="rounded-2xl border border-zinc-800 overflow-hidden bg-zinc-950/40">
            <div className="grid grid-cols-[1fr,auto,auto] text-sm">
              <div className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-white/60 border-b border-zinc-800">
                Feature
              </div>
              <div className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-zinc-400 text-center border-b border-zinc-800">
                Standard
              </div>
              <div className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-cyan-300 text-center border-b border-zinc-800 bg-cyan-500/5">
                WPW Customer
              </div>
              {COMPARE.map((row, i) => (
                <div key={row.feature} className="contents">
                  <div className={`px-4 py-3 text-zinc-300 ${i < COMPARE.length - 1 ? "border-b border-zinc-900" : ""}`}>
                    {row.feature}
                  </div>
                  <div className={`px-4 py-3 text-center ${i < COMPARE.length - 1 ? "border-b border-zinc-900" : ""}`}>
                    {row.standard ? (
                      <CheckCircle2 className="w-4 h-4 text-zinc-500 inline" />
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </div>
                  <div className={`px-4 py-3 text-center bg-cyan-500/5 ${i < COMPARE.length - 1 ? "border-b border-zinc-900" : ""}`}>
                    {row.wpw ? (
                      <CheckCircle2 className="w-4 h-4 text-cyan-400 inline" />
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative py-20 border-t border-white/10 text-center">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-3xl">
          <Zap className="w-10 h-10 mx-auto mb-4 text-cyan-400" />
          <h2 className="text-3xl sm:text-4xl font-bold mb-3">
            Stop quoting on napkins.
          </h2>
          <p className="text-zinc-400 mb-7 leading-relaxed">
            Try QuickQuote free. Send your first branded quote in 90 seconds. See the profit on every closed job.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white border-0 hover:opacity-90 px-8">
              <Link to="/signup">
                Start free <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/20 hover:bg-white/5">
              <Link to="/pricing">Compare tiers</Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
