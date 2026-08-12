/**
 * WpwWizardElements — WPW-specific surfaces for ShopOnboardingWizard.
 *
 * The wizard reuses the same 7-step flow for every shop. WPW shops get
 * three additional surfaces that reframe the value:
 *
 *   1. WpwValueRibbon — persistent banner shown above every step,
 *      reminds them what non-WPW shops pay vs $0 for them.
 *   2. WpwWelcomeHero — replaces the generic step 0 copy with the
 *      "design and marketing engine to fuel your growth" pitch.
 *   3. WpwUpgradeReveal — replaces the step 6 toolkit grid with a
 *      side-by-side "free for you / what non-WPW pays / WPW family
 *      pricing" comparison so they can decide stay-free vs upgrade.
 *
 * All numbers must match useToolAccess.ts. Don't invent prices.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Sparkles, ArrowRight, Gift } from "lucide-react";
import { cn } from "@/lib/utils";
import { SocialShareUnlockModal } from "@/components/SocialShareUnlockModal";
import { useFreemiumLimits } from "@/hooks/useFreemiumLimits";

interface WpwValueRibbonProps {
  className?: string;
}

/** Persistent value-reveal banner on every wizard step. */
export function WpwValueRibbon({ className }: WpwValueRibbonProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-2 rounded-lg",
        "bg-gradient-to-r from-cyan-500/10 via-fuchsia-500/10 to-orange-500/10",
        "border border-cyan-500/20",
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
        <span className="text-[11px] sm:text-xs font-semibold text-white truncate">
          Other shops pay $199–$699/mo for this engine.
        </span>
      </div>
      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider shrink-0">
        $0 for WPW
      </Badge>
    </div>
  );
}

interface WpwWelcomeHeroProps {
  shopName: string;
}

/** Step-0 hero for WPW tenants — "we built a design and marketing engine". */
export function WpwWelcomeHero({ shopName }: WpwWelcomeHeroProps) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl sm:text-3xl font-black text-white leading-tight">
          We built a design and marketing engine
          <br />
          <span className="bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent">
            to fuel your growth.
          </span>
        </h2>
        <p className="text-zinc-300 mt-3 text-sm leading-relaxed">
          {shopName ? `${shopName} — here's what you get free for being a WePrintWraps customer.` : "Here's what you get free for being a WePrintWraps customer."}
        </p>
      </div>
      <div className="space-y-2">
        {[
          { label: "Free CMS", desc: "Publish blog + SEO content to your site" },
          { label: "Free Quoting", desc: "Send branded quotes to your customers" },
          { label: "1 Free Render", desc: "Your choice of tool — share us on social or sign up" },
        ].map((item) => (
          <div
            key={item.label}
            className="flex items-start gap-2.5 p-3 rounded-xl bg-zinc-900/60 border border-cyan-500/20"
          >
            <CheckCircle2 className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">{item.label}</p>
              <p className="text-xs text-zinc-400">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface WpwUpgradeRevealProps {
  shopName: string;
}

/**
 * Step-6 reveal for WPW tenants — comparison + upgrade ladder.
 *
 * Three columns (stack on mobile):
 *   1. Free for you (the WPW bundle)
 *   2. WPW Family pricing (loyalty discount on every paid tier)
 *   3. Standard pricing (what non-WPW shops see)
 *
 * Numbers locked from src/hooks/useToolAccess.ts. WPW Family discount
 * is $50/mo off every tier — Starter $149, Pro $249, DesignPro $649.
 */
export function WpwUpgradeReveal({ shopName }: WpwUpgradeRevealProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const { socialShareUnlocked } = useFreemiumLimits();

  return (
    <div className="flex-1 flex flex-col gap-5 relative">
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-fuchsia-500/5 rounded-xl pointer-events-none" />
      <SocialShareUnlockModal open={shareOpen} onClose={() => setShareOpen(false)} />

      <div className="relative text-center">
        <h2 className="text-2xl sm:text-3xl font-black">
          <span className="bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent">
            {shopName || "Your shop"}
          </span>
          <span className="text-white"> is live.</span>
        </h2>
        <p className="text-zinc-300 mt-2 text-sm max-w-lg mx-auto">
          Free CMS + Free Quoting + 1 free render. When you're ready to push the engine harder, here's the WPW family ladder.
        </p>
      </div>

      <div className="relative grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Column 1 — FREE for you */}
        <div className="rounded-xl border-2 border-emerald-500/40 bg-emerald-500/5 p-4 flex flex-col">
          <Badge className="self-start bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px] uppercase tracking-wider mb-2">
            Free for WPW
          </Badge>
          <p className="text-2xl font-black text-white mb-0.5">$0/mo</p>
          <p className="text-[11px] text-zinc-400 mb-3">Forever, no strings</p>
          <ul className="space-y-1.5 text-xs text-zinc-300 flex-1">
            <li className="flex gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" /> Free CMS publishing</li>
            <li className="flex gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" /> Free Quoting + customer portal</li>
            <li className="flex gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" /> See past jobs + Easy Reorder</li>
            <li className="flex gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" /> 1 free render of choice</li>
            <li className="flex gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" /> Extra renders à la carte $25</li>
          </ul>
        </div>

        {/* Column 2 — WPW Family pricing */}
        <div className="rounded-xl border-2 border-cyan-500/60 bg-gradient-to-br from-cyan-500/10 to-fuchsia-500/10 p-4 flex flex-col relative shadow-[0_0_30px_rgba(6,182,212,0.15)]">
          <Badge className="self-start bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white border-0 text-[10px] uppercase tracking-wider mb-2">
            WPW Family · save $50/mo
          </Badge>
          <p className="text-[11px] text-zinc-400 mb-2">Pick your tier — every one $50 off:</p>
          <ul className="space-y-2 text-xs flex-1">
            <li className="rounded-lg bg-zinc-900/60 border border-cyan-500/20 px-2.5 py-2">
              <div className="flex items-baseline justify-between">
                <span className="font-bold text-white">Starter</span>
                <div className="text-right">
                  <span className="text-cyan-300 font-bold">$149/mo</span>
                  <span className="text-zinc-500 line-through ml-1.5 text-[10px]">$199</span>
                </div>
              </div>
              <p className="text-[10px] text-zinc-400 mt-0.5">50 renders / mo</p>
            </li>
            <li className="rounded-lg bg-zinc-900/60 border border-cyan-500/20 px-2.5 py-2">
              <div className="flex items-baseline justify-between">
                <span className="font-bold text-white">Pro</span>
                <div className="text-right">
                  <span className="text-cyan-300 font-bold">$249/mo</span>
                  <span className="text-zinc-500 line-through ml-1.5 text-[10px]">$299</span>
                </div>
              </div>
              <p className="text-[10px] text-zinc-400 mt-0.5">75 renders / mo</p>
            </li>
            <li className="rounded-lg bg-zinc-900/60 border border-cyan-500/20 px-2.5 py-2">
              <div className="flex items-baseline justify-between">
                <span className="font-bold text-white">DesignPro</span>
                <div className="text-right">
                  <span className="text-cyan-300 font-bold">$649/mo</span>
                  <span className="text-zinc-500 line-through ml-1.5 text-[10px]">$699</span>
                </div>
              </div>
              <p className="text-[10px] text-zinc-400 mt-0.5">40 renders + Production Pack</p>
            </li>
          </ul>
        </div>

        {/* Column 3 — Standard (what non-WPW pays) */}
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/40 p-4 flex flex-col">
          <Badge variant="outline" className="self-start border-zinc-700 text-zinc-400 text-[10px] uppercase tracking-wider mb-2">
            Non-WPW shops pay
          </Badge>
          <p className="text-[11px] text-zinc-500 mb-2">Standard pricing for context:</p>
          <ul className="space-y-2 text-xs flex-1">
            <li className="flex items-baseline justify-between">
              <span className="text-zinc-400">Starter</span>
              <span className="text-zinc-500 font-semibold">$199/mo</span>
            </li>
            <li className="flex items-baseline justify-between">
              <span className="text-zinc-400">Pro</span>
              <span className="text-zinc-500 font-semibold">$299/mo</span>
            </li>
            <li className="flex items-baseline justify-between">
              <span className="text-zinc-400">DesignPro</span>
              <span className="text-zinc-500 font-semibold">$699/mo</span>
            </li>
            <li className="flex items-baseline justify-between pt-1 border-t border-zinc-800">
              <span className="text-zinc-500 text-[11px]">Extra render</span>
              <span className="text-zinc-500 text-[11px]">$10–$25</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Social-share render unlock — only shown if not already claimed. */}
      {!socialShareUnlocked && (
        <div className="relative rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 to-fuchsia-500/10 p-4 flex items-center gap-3 flex-wrap">
          <Gift className="w-6 h-6 text-cyan-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white">
              Want your free render now?
            </p>
            <p className="text-xs text-zinc-300">
              Share us on social — claim 1 free render of your choice (any tool except DesignPro).
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setShareOpen(true)}
            className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white border-0 hover:opacity-90 shrink-0"
          >
            Share + Claim
          </Button>
        </div>
      )}

      <div className="relative flex flex-wrap items-center justify-center gap-2 text-[11px] text-zinc-400">
        <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
        <span>Stay free, upgrade later, or jump to a tier now — your call.</span>
      </div>
    </div>
  );
}
