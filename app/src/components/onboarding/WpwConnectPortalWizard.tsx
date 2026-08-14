/**
 * WpwConnectPortalWizard
 *
 * Purpose-built tour for past WPW customers landing on the DesignProAI
 * dashboard for the first time. NOT the generic 7-step shop-setup wizard
 * (that's ShopOnboardingWizard). This one just explains what they get
 * for free as a WPW customer:
 *
 *   1. Welcome — "you have free dashboard access"
 *   2. Past Orders — view + reorder every WPW job you've ever placed
 *   3. Pricing — calculate any wrap in seconds with QuickQuote
 *   4. Create a Quote — branded quotes you send to customers
 *   5. Revision Studio — AI-powered design revisions
 *   6. Compare Tool — diff two designs side-by-side
 *   7. Explore — links to every tool page
 *
 * Fired by:
 *   - The cyan "WPW Connect Portal" badge on the dashboard hero card
 *   - The "Replay Wizard" button in AdminViewAsCustomerToggle
 *
 * Both dispatch the `restylepro:open-wpw-connect-portal` window event.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Package,
  Calculator,
  FileText,
  Wand2,
  GitCompare,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";

interface Step {
  id: string;
  icon: LucideIcon;
  badge: string;
  title: string;
  body: string;
  hero?: string; // optional accent gradient class
  cta?: { label: string; route: string };
}

const STEPS: Step[] = [
  {
    id: "welcome",
    icon: Sparkles,
    badge: "What's new for WPW",
    title: "Here's what we just shipped for you",
    body: "Quick heads-up — as a WePrintWraps customer your DesignProAI dashboard is free: QuickQuote, past orders, and the customer quote tool. Design any wrap with our AI tools, then take it to print — one design at a time with a $299 Production Pack, or unlock unlimited with a DesignPro plan (WPW customers get $50/mo off, auto-applied).",
    hero: "from-cyan-500/30 via-fuchsia-500/20 to-purple-500/30",
  },
  {
    id: "past-orders",
    icon: Package,
    badge: "Step 1",
    title: "Every WPW order you've ever placed",
    body: "Thumbnails, line items, totals, tracking — every wrap you've ordered from us, in one screen. One-click reorder if you want it printed again. Production Packs ($299 each) are reorderable too.",
    cta: { label: "Open My Orders", route: "/my-wpw-orders" },
    hero: "from-blue-500/30 via-cyan-500/30 to-emerald-500/20",
  },
  {
    id: "pricing",
    icon: Calculator,
    badge: "Step 2",
    title: "Calculate any wrap in seconds — free",
    body: "QuickQuote does the math for you — vehicle year/make/model + finish + sq ft → film cost, labor, margin, customer total. Built for fast estimates while a customer is standing in your bay. Doesn't burn a token, ever.",
    cta: { label: "Try QuickQuote", route: "/quick-quote" },
    hero: "from-amber-500/30 via-orange-500/30 to-rose-500/20",
  },
  {
    id: "create-quote",
    icon: FileText,
    badge: "Step 3",
    title: "Branded quotes that close",
    body: "Multi-vehicle, line items, deposit invoicing, and a public link your customer signs on their phone. Your shop name and logo, not ours. Doesn't burn a token either.",
    cta: { label: "Build a Quote", route: "/quotetool" },
    hero: "from-emerald-500/30 via-cyan-500/30 to-blue-500/20",
  },
  {
    id: "revision-studio",
    icon: Wand2,
    badge: "Step 4",
    title: "Revision Studio — AI changes in plain English",
    body: "\"Make the stripes thicker.\" \"Try satin black.\" \"Add a carbon hood.\" Type what you want, RevisionStudioIQ regenerates the wrap with the change applied. No Photoshop. 1 token per revision — counts the same as a render because it spends the same compute.",
    cta: { label: "Open Revision Studio", route: "/revisionstudioiq" },
    hero: "from-purple-500/30 via-fuchsia-500/30 to-pink-500/20",
  },
  {
    id: "compare",
    icon: GitCompare,
    badge: "Done",
    title: "Side-by-side → customer signs off → print",
    body: "Two design versions in the same view, drag a slider to see the difference. Your customer points at exactly what they want — then you print it with confidence. Need print files without a subscription? $299 Production Pack gets you print-ready output one job at a time. Want unlimited iterations? Climb to a tier — WPW customers get $50/mo off, auto-applied.",
    cta: { label: "Try Compare", route: "/revisionstudioiq" },
    hero: "from-cyan-500/30 via-blue-500/30 to-purple-500/20",
  },
];

export function WpwConnectPortalWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      // eslint-disable-next-line no-console
      console.log("[WpwConnectPortalWizard] open event received");
      setStep(0);
      setOpen(true);
    };
    window.addEventListener("restylepro:open-wpw-connect-portal", handler);
    return () => window.removeEventListener("restylepro:open-wpw-connect-portal", handler);
  }, []);

  // Lock body scroll when open + close on Escape
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;

  const close = () => setOpen(false);
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step] ?? STEPS[0];
  const Icon = current.icon;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="WPW Connect Portal Tour"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-2xl rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
        {/* Close */}
        <button
          type="button"
          onClick={close}
          aria-label="Close tour"
          className="absolute top-3 right-3 z-30 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white/70 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Progress bar */}
        <div className="flex gap-0">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={cn(
                "h-1.5 flex-1 transition-all duration-500",
                i <= step
                  ? "bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-orange-400"
                  : "bg-zinc-800",
              )}
            />
          ))}
        </div>

        {/* Hero strip */}
        <div className={cn("relative h-32 bg-gradient-to-br", current.hero || "from-cyan-500/30 to-purple-500/20")}>
          <div className="absolute inset-0 bg-zinc-950/40" />
          <div className="relative h-full flex items-center justify-center">
            <div className="w-20 h-20 rounded-2xl bg-black/60 backdrop-blur border border-white/10 flex items-center justify-center shadow-[0_0_40px_rgba(34,211,238,0.3)]">
              <Icon className="w-10 h-10 text-white" />
            </div>
          </div>
          <div className="absolute top-3 left-4">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300 bg-black/60 px-2.5 py-1 rounded-full backdrop-blur border border-cyan-500/30">
              {current.badge}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-7">
          <h2 className="text-2xl font-bold text-white mb-3 leading-tight">
            {current.title}
          </h2>
          <p className="text-sm text-zinc-300 leading-relaxed mb-5">
            {current.body}
          </p>

          {current.cta && (
            <button
              type="button"
              onClick={() => {
                close();
                navigate(current.cta!.route);
              }}
              className="inline-flex items-center gap-2 mb-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500/20 to-fuchsia-500/20 border border-cyan-500/40 hover:border-cyan-400 text-cyan-200 hover:text-white text-xs font-bold uppercase tracking-wider transition-all"
            >
              {current.cta.label}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Step dots */}
          <div className="flex items-center justify-center gap-1.5 mt-6 mb-5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStep(i)}
                aria-label={`Step ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === step
                    ? "w-8 bg-gradient-to-r from-cyan-400 to-fuchsia-400"
                    : i < step
                      ? "w-1.5 bg-emerald-400/60 hover:bg-emerald-400"
                      : "w-1.5 bg-white/20 hover:bg-white/40",
                )}
              />
            ))}
          </div>

          {/* Nav */}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={back}
              disabled={step === 0}
              className="text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
            <span className="text-[11px] text-white/40 font-mono">
              {step + 1} / {STEPS.length}
            </span>
            {isLast ? (
              <Button
                size="sm"
                onClick={close}
                className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-semibold hover:brightness-110"
              >
                <CheckCircle2 className="w-4 h-4 mr-1" />
                Got it
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={next}
                className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-semibold hover:brightness-110"
              >
                Next
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
