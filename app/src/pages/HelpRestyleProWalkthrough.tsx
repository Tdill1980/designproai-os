/**
 * /help/restylepro-walkthrough — Customer-facing walkthrough.
 *
 * Public, indexable. Linked from the WPW rep landing pages
 * (/wpw/:rep) and from the rep guide. Designed for someone who has
 * never seen RestylePro before — explains the $25 design path, the
 * subscription path, and the core tools at a "what does it do" level
 * with screenshot placeholders ready to fill in.
 */

import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  ArrowRight,
  Sparkles,
  Mail,
  Palette,
  Car,
  Layers,
  ShieldCheck,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScreenshotSlot } from "@/components/help/ScreenshotSlot";

const TOOLS = [
  {
    name: "ColorPro",
    icon: Palette,
    blurb:
      "Drop a manufacturer color (3M, Avery, KPMF, Inozetek, Hexis) onto a vehicle and see exactly how it'll read in real light.",
  },
  {
    name: "DesignProAI",
    icon: Sparkles,
    blurb:
      "Type a wrap idea (\"stealth bomber matte black with cyan accents\") and get a custom AI-rendered design on a real vehicle.",
  },
  {
    name: "MyVehiclePro",
    icon: Car,
    blurb:
      "Upload a photo of your actual truck and see the wrap rendered on YOUR vehicle, not a stock 3D model.",
  },
  {
    name: "FadeWraps",
    icon: Layers,
    blurb:
      "Gradient and fade effects across hood, doors, and roof — preview before you commit to print.",
  },
];

const HelpRestyleProWalkthrough = () => {
  return (
    <>
      <Helmet>
        <title>How RestyleProAI works — walkthrough for customers</title>
        <meta
          name="description"
          content="See exactly how to use RestyleProAI: get a $25 AI wrap design rendered on your vehicle, subscribe to the full design suite, or just price a job in 60 seconds."
        />
        <link
          rel="canonical"
          href="https://restyleproai.com/help/restylepro-walkthrough"
        />
      </Helmet>

      <div className="min-h-screen bg-black text-white">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-10 sm:py-14">
          {/* Header */}
          <div className="text-[11px] font-semibold tracking-[2px] uppercase text-cyan-300/80 mb-3">
            Walkthrough · For customers
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold leading-[1.05] tracking-tight">
            How RestyleProAI works.
          </h1>
          <p className="text-base sm:text-lg text-white/75 mt-4 leading-relaxed">
            Three ways in: price a job in 60 seconds, pay $25 to see your idea
            rendered on a vehicle, or subscribe to the full design suite. Pick
            the path that fits — they all start from the same place.
          </p>

          {/* TOC */}
          <nav className="mt-8 mb-12 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <a
              href="#path-quote"
              className="rounded-lg border border-border bg-muted/30 px-3 py-2 hover:border-cyan-400/40 transition"
            >
              1. Quick quote (free)
            </a>
            <a
              href="#path-design"
              className="rounded-lg border border-border bg-muted/30 px-3 py-2 hover:border-cyan-400/40 transition"
            >
              2. $25 AI design
            </a>
            <a
              href="#path-subscribe"
              className="rounded-lg border border-border bg-muted/30 px-3 py-2 hover:border-cyan-400/40 transition"
            >
              3. Full subscription
            </a>
          </nav>

          {/* Path 1 — Quick quote */}
          <section id="path-quote" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              1. Get a price in 60 seconds
            </h2>
            <p className="text-white/75 mt-2 leading-relaxed">
              You don't need an account to see a ballpark. Open the QuickQuote
              builder, pick your vehicle, choose the coverage (full wrap, hood
              only, roof + pillars, etc.) and the finish (gloss, matte,
              satin, chrome). The total updates live.
            </p>
            <ScreenshotSlot
              label="QuickQuote builder — empty state"
              note="Show the /quick-quote page with an empty vehicle picker and the line-item area on the right."
            />
            <ol className="mt-4 space-y-2 text-sm text-white/80">
              <li className="flex gap-2">
                <span className="text-cyan-400 font-bold">1.</span>
                Pick your year/make/model — drives the square footage.
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400 font-bold">2.</span>
                Add the coverage you want (full wrap, color change only,
                graphics, etc.).
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400 font-bold">3.</span>
                Choose the finish — gloss, matte, satin, brushed, chrome.
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400 font-bold">4.</span>
                Total + deposit shows at the bottom. Save the quote, send it
                to yourself, or take a screenshot.
              </li>
            </ol>
            <ScreenshotSlot
              label="QuickQuote builder — filled with a vehicle + line items"
              note="Show a populated quote with running total and the Save/Send buttons visible."
            />
            <Button asChild variant="outline" className="mt-2">
              <Link to="/quick-quote">
                Open QuickQuote
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Link>
            </Button>
          </section>

          {/* Path 2 — $25 design */}
          <section id="path-design" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              2. See your idea on a real vehicle — 3 designs for $25
            </h2>
            <p className="text-white/75 mt-2 leading-relaxed">
              The fastest way to know if an idea actually works is to see it.
              $25 loads 3 design credits — use them however you want: three
              different wrap concepts, or one design plus two refinements
              to dial it in. Delivered by magic link — no signup form.
            </p>
            <ScreenshotSlot
              label="/try-design landing page"
              note="Show the McLaren hero image, the email field, and the $25 CTA button. If a coupon banner is showing, capture that too."
            />
            <ol className="mt-4 space-y-2 text-sm text-white/80">
              <li className="flex gap-2">
                <Check className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                Enter your email and pay $25 (or $22.50 with a rep coupon).
              </li>
              <li className="flex gap-2">
                <Mail className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                Check your inbox — you'll get a magic link that drops you
                straight into DesignProAI with 3 design credits loaded.
              </li>
              <li className="flex gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                Type your wrap idea (or paste a reference photo), pick the
                vehicle and finish, hit render.
              </li>
              <li className="flex gap-2">
                <Layers className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                Don't love the first render? Spend a credit on a revision —
                tell the AI what to change — or use the remaining credits
                on a fresh concept instead.
              </li>
            </ol>
            <ScreenshotSlot
              label="DesignProAI — example finished render"
              note="Show a completed render in DesignProAI with the 6-view 3D proof visible."
            />
            <Button
              asChild
              className="mt-2 bg-cyan-400 hover:bg-cyan-300 text-black font-semibold"
            >
              <Link to="/try-design">
                Get my 3 designs — $25
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Link>
            </Button>
          </section>

          {/* Path 3 — Subscription */}
          <section id="path-subscribe" className="mb-14 scroll-mt-20">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              3. Full design suite — from $350/mo
            </h2>
            <p className="text-white/75 mt-2 leading-relaxed">
              If you're going to design more than a few wraps, a subscription
              is cheaper per render and unlocks the full tool suite — ColorPro,
              DesignProAI, MyVehiclePro, FadeWraps, GraphicsPro,
              RevisionStudioIQ, RestyleLibrary.
            </p>
            <ScreenshotSlot
              label="/pricing — 4-tier grid"
              note="Capture the 4-card pricing layout: Starter, DesignPro Lite, DesignPro Studio, DesignPro Plus."
            />
            <ul className="mt-4 space-y-3 text-sm text-white/80">
              <li className="flex gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                <ShieldCheck className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold">Starter — $350/mo:</span>{" "}
                  50 renders, ColorPro / PatternPro / FadeWraps /
                  RestyleLibrary.
                </div>
              </li>
              <li className="flex gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                <ShieldCheck className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold">
                    DesignPro Lite — $499/mo:
                  </span>{" "}
                  Adds DesignProAI + MyVehiclePro for upload-your-truck demos
                  on the sales floor.
                </div>
              </li>
              <li className="flex gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                <ShieldCheck className="w-4 h-4 text-fuchsia-400 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold">
                    DesignPro Studio — $699/mo:
                  </span>{" "}
                  Adds a real human graphic designer with 48-hour file
                  turnaround.
                </div>
              </li>
              <li className="flex gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                <ShieldCheck className="w-4 h-4 text-fuchsia-400 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold">
                    DesignPro Plus — $995/mo:
                  </span>{" "}
                  Priority 24-hour designer turnaround + lowest per-render
                  rate.
                </div>
              </li>
            </ul>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/pricing">
                See all plans
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Link>
            </Button>
          </section>

          {/* Tools overview */}
          <section className="mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              The tools inside
            </h2>
            <p className="text-white/75 mt-2 leading-relaxed">
              Whichever path you pick, these are the tools you'll use. Each
              one is a single page — open it, try the demo, see the output.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
              {TOOLS.map(({ name, blurb, icon: Icon }) => (
                <div
                  key={name}
                  className="rounded-lg border border-border bg-muted/20 p-4"
                >
                  <div className="flex items-center gap-2 text-sm font-bold mb-1.5">
                    <Icon className="w-4 h-4 text-cyan-400" />
                    {name}
                  </div>
                  <p className="text-xs text-white/70 leading-relaxed">
                    {blurb}
                  </p>
                </div>
              ))}
            </div>
            <ScreenshotSlot
              label="Tool gallery / dashboard tile view"
              note="Optional — a grid screenshot of the main dashboard tiles linking to each tool."
            />
          </section>

          {/* CTA footer */}
          <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-6 sm:p-8 text-center">
            <h3 className="text-xl font-bold">Ready to try it?</h3>
            <p className="text-sm text-white/70 mt-1">
              $25 gets you one AI render of your wrap idea on a real vehicle.
              No subscription, magic-link delivery.
            </p>
            <Button
              asChild
              className="mt-4 bg-cyan-400 hover:bg-cyan-300 text-black font-semibold"
            >
              <Link to="/try-design">
                Get my 3 designs — $25
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Link>
            </Button>
            <div className="mt-4 text-xs text-white/50">
              Got a rep coupon? Paste it on the next page — discount applies
              automatically.
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default HelpRestyleProWalkthrough;
