/**
 * /club-wpw-drop (alias /design-drop) — "Club WPW Drop · Free Tool of the Week".
 *
 * Public, no auth. Ties to the weekly "Wrap of the Week" email (WPW × Paint Is
 * Dead) and the WePrintWraps × DesignProAI co-brand. Each Thursday drops a free,
 * branded, shareable digital tool for wrap shops. THIS WEEK: the WPW Wrap
 * Calculator™ (Excel + PDF instructions). Upsells printed fade wraps with a
 * 10%-off code (FADE10).
 *
 * Layout matches the email drop aesthetic: dark hero + collage + magenta coupon
 * sections, with clean white content sections between them. Global top/side nav
 * chrome stays black (handled by the app layout) per the White UI standard.
 *
 * NOTE FOR TRISH: the download button points at DOWNLOAD_URL below. Upload the
 * actual calculator (Excel + PDF instructions, zipped) to that Supabase storage
 * path (email-assets/club-wpw-drop/wpw-wrap-calculator.zip) and the button works
 * immediately — no code change needed. Swap the URL if you host it elsewhere.
 * To run next week's drop, just change TOOL_* + DOWNLOAD_URL constants.
 */

import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import {
  Calculator,
  Check,
  SquareStack,
  Ruler,
  DollarSign,
  Truck,
  Store,
  Palette,
  Package,
  Flag,
  Printer,
  ArrowRight,
  CalendarClock,
} from "lucide-react";

// Featured Wrap-of-the-Week collage (WPW × Paint Is Dead — purple BMW M3).
const COLLAGE_IMG = "/wpw-drop/wotw-collage.jpeg";

// ── This week's tool (swap these + DOWNLOAD_URL to run next week's drop) ──
const TOOL_NAME = "WPW × DesignProAI Wrap Calculator";
const TOOL_TAGLINE = "Estimate wrap material in seconds. Quote jobs with confidence.";

// Live tool — no download. Runs on a WePrintWraps-connected URL so it's always
// current and shareable by link (see WpwWrapCalculator.tsx).
const CALCULATOR_URL = "/wpw-wrap-calculator";

// Downstream destinations.
const ORDER_PRINTED_WRAP = "/printpro/fadewrap"; // printed fade wrap product
const BROWSE_FADE_DESIGNS = "/restylelibrary"; // fade + design library
const PRINT_MY_WRAP = "/printpro/custom-upload"; // upload your own artwork to print

// What's inside this week's tool.
const INSIDE = [
  { icon: SquareStack, emoji: "📐", title: "Calculate Total Square Feet" },
  { icon: Ruler, emoji: "📏", title: "Convert to Linear Feet / Yards" },
  { icon: DollarSign, emoji: "💲", title: "Estimate Material Cost" },
  { icon: Truck, emoji: "🚚", title: "Know When You Qualify for Free Shipping" },
  { icon: Store, emoji: "🖨", title: "Built for Wrap Shops" },
];

// The recurring Thursday lineup (branded drop series).
const LINEUP = [
  "WPW × DesignProAI Wrap Calculator",
  "WPW Profit Calculator™ ⭐",
  "WPW Bleed Guide™",
  "WPW Color Guide™",
  "WPW File Prep Guide™",
  "WPW Vehicle Measurement Guide™",
];

const WHY = [
  { icon: Truck, title: "Fast Production" },
  { icon: Palette, title: "Premium Print Quality" },
  { icon: Package, title: "Free Shipping $750+" },
  { icon: Flag, title: "Printed in the USA" },
];

export default function ClubWpwDrop() {
  return (
    <>
      <Helmet>
        <title>WPW × DesignProAI Wrap Calculator — Free Live Tool | WePrintWraps</title>
        <meta
          name="description"
          content="Free live wrap-shop tool: the WPW × DesignProAI Wrap Calculator estimates wrap material, linear feet/yards & material cost in seconds — right in your browser, no download. Plus 10% off printed fade wraps with code FADE10."
        />
        <link rel="canonical" href="https://weprintwraps.com/club-wpw-drop" />
      </Helmet>

      <div className="min-h-screen bg-white text-gray-900">
        {/* Signature brand hairline */}
        <div className="h-1.5 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />

        {/* ─────────────────────────── SECTION 1 · HERO ─────────────────────── */}
        <section className="relative overflow-hidden bg-black text-white">
          {/* Collage backdrop — this week's featured purple BMW, biased to top */}
          <img
            src={COLLAGE_IMG}
            alt="This week's featured purple BMW M3 wrap — WePrintWraps × Paint Is Dead"
            className="absolute inset-0 h-full w-full object-cover object-top opacity-60"
            loading="eager"
          />
          {/* Dark scrims for legibility */}
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/85 to-black/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/60" />

          <div className="relative max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold tracking-wide text-white bg-gradient-to-r from-[#3b82f6] to-[#ec4899] rounded-full px-4 py-1.5 mb-6 shadow-lg">
                🧮 Free Live Tool · WePrintWraps × DesignProAI
              </span>

              <h1 className="font-extrabold leading-[1.02] tracking-tight text-[38px] sm:text-[56px]">
                <span className="bg-gradient-to-r from-[#60a5fa] to-[#f472b6] bg-clip-text text-transparent">
                  WPW × DesignProAI
                </span>
                <br />
                Wrap Calculator
              </h1>

              <p className="mt-6 text-lg sm:text-xl text-gray-200 leading-relaxed max-w-xl">
                {TOOL_TAGLINE}
              </p>

              <div className="mt-9">
                <Link
                  to={CALCULATOR_URL}
                  className="inline-flex items-center justify-center gap-2.5 h-14 px-8 rounded-xl text-lg font-bold text-white bg-gradient-to-r from-[#3b82f6] to-[#ec4899] shadow-[0_10px_40px_rgba(236,72,153,0.45)] hover:brightness-110 transition"
                >
                  <Calculator className="w-5 h-5" />
                  Open the Wrap Calculator
                </Link>
                <p className="mt-4 text-[13px] text-gray-300 tracking-wide">
                  Free live tool • Works on any phone or desktop • Nothing to download
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ────────────────────── SECTION 2 · WHAT'S INSIDE ─────────────────── */}
        <section className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900">
              What's Inside
            </h2>
            <p className="text-sm text-gray-500 mt-2">
              Everything in the {TOOL_NAME}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {INSIDE.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 flex flex-col"
                >
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shadow-sm mb-4">
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="flex items-start gap-1.5 text-[15px] font-bold text-gray-900 leading-snug">
                    <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    {item.title}
                  </h3>
                </div>
              );
            })}
          </div>
        </section>

        {/* ─────────────── SECTION 2b · NEW DROP EVERY THURSDAY ─────────────── */}
        <section className="bg-gray-50 border-y border-gray-200">
          <div className="max-w-5xl mx-auto px-5 sm:px-8 py-12 text-center">
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-3 py-1 mb-4">
              <CalendarClock className="w-3.5 h-3.5" />
              New free tool every Thursday
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900">
              The Club WPW Drop{" "}
              <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">
                lineup
              </span>
            </h2>
            <p className="text-sm text-gray-600 mt-2 max-w-xl mx-auto">
              Free, branded, shop-ready tools you'll actually keep. Come back
              every Thursday for the next drop.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
              {LINEUP.map((name, i) => (
                <span
                  key={name}
                  className={
                    "inline-flex items-center rounded-full px-4 py-2 text-[13px] font-bold border " +
                    (i === 0
                      ? "text-white bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent shadow-sm"
                      : "text-gray-700 bg-white border-gray-200")
                  }
                >
                  {i === 0 && <Check className="w-3.5 h-3.5 mr-1.5" />}
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ───────────────────── SECTION 3 · THIS WEEK'S WRAP ───────────────── */}
        <section className="bg-black text-white">
          <div className="max-w-5xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
            <div className="text-center mb-8">
              <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
                THIS WEEK'S{" "}
                <span className="bg-gradient-to-r from-[#60a5fa] to-[#f472b6] bg-clip-text text-transparent">
                  WRAP
                </span>
              </h2>
            </div>
            <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
              <img
                src={COLLAGE_IMG}
                alt="WePrintWraps × Paint Is Dead Wrap of the Week — purple BMW M3 collage"
                className="w-full block"
                loading="lazy"
              />
            </div>
            <p className="text-center text-gray-300 text-[15px] sm:text-base mt-6 max-w-2xl mx-auto">
              Inspired by this week's{" "}
              <span className="font-semibold text-white">Paint Is Dead × WePrintWraps</span>{" "}
              Wrap of the Week.
            </p>
          </div>
        </section>

        {/* ──────────────────── SECTION 4 · FADE COUPON (dark) ──────────────── */}
        <section className="relative overflow-hidden bg-[#0a0a0a] text-white">
          {/* Magenta glow accents */}
          <div className="pointer-events-none absolute -top-24 -left-24 w-96 h-96 rounded-full bg-[#ec4899]/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-[#ec4899]/20 blur-3xl" />

          <div className="relative max-w-4xl mx-auto px-5 sm:px-8 py-16 sm:py-24 text-center">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400 mb-3">
              After Your Download
            </div>
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
              Need Us to Print It?
            </h2>
            <p className="mt-2 text-2xl sm:text-3xl font-bold bg-gradient-to-r from-[#f472b6] to-[#ec4899] bg-clip-text text-transparent">
              Save 10% on Any Fade Wrap This Week
            </p>
            <p className="mt-5 text-gray-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
              Bring your own fade design to life on premium Avery Dennison or 3M
              wrap film.
            </p>

            {/* Glowing coupon */}
            <div className="mt-10 inline-flex flex-col items-center">
              <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400 mb-3">
                Use Code
              </span>
              <div className="relative">
                <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-[#3b82f6] to-[#ec4899] blur-lg opacity-70" />
                <div className="relative rounded-2xl border-2 border-dashed border-[#ec4899] bg-black px-10 sm:px-16 py-6">
                  <span className="font-mono text-4xl sm:text-6xl font-extrabold tracking-[0.15em] text-white">
                    FADE10
                  </span>
                </div>
              </div>
            </div>

            {/* Two buttons */}
            <div className="mt-11 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to={ORDER_PRINTED_WRAP}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 py-3.5 rounded-xl text-base font-bold text-white bg-gradient-to-r from-[#ec4899] to-[#f472b6] shadow-[0_10px_30px_rgba(236,72,153,0.4)] hover:brightness-110 transition"
              >
                🩷 Order Your Wrap
              </Link>
              <Link
                to={BROWSE_FADE_DESIGNS}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 py-3.5 rounded-xl text-base font-bold text-white bg-white/10 border border-white/25 hover:bg-white/20 transition"
              >
                ⬜ Browse Fade Designs
              </Link>
            </div>
          </div>
        </section>

        {/* ───────────────── SECTION 5 · WHY WEPRINTWRAPS (white) ───────────── */}
        <section className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900">
              Why Wrap Shops Choose{" "}
              <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">
                WePrintWraps
              </span>
            </h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
            {WHY.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 text-center flex flex-col items-center"
                >
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shadow-sm mb-4">
                    <Icon className="w-7 h-7 text-white" />
                  </div>
                  <h3 className="text-base font-bold text-gray-900 leading-snug">
                    {item.title}
                  </h3>
                </div>
              );
            })}
          </div>
        </section>

        {/* ───────────────────────── SECTION 6 · HUGE CTA ───────────────────── */}
        <section className="relative overflow-hidden bg-black text-white">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#3b82f6]/20 via-transparent to-[#ec4899]/25" />
          <div className="relative max-w-4xl mx-auto px-5 sm:px-8 py-20 sm:py-28 text-center">
            <h2 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-[1.03]">
              Already Designed It?
              <br />
              <span className="bg-gradient-to-r from-[#60a5fa] to-[#f472b6] bg-clip-text text-transparent">
                We'll Print It.
              </span>
            </h2>
            <p className="mt-6 text-lg sm:text-xl text-gray-300">
              Your artwork. Our print quality. Delivered fast.
            </p>
            <div className="mt-10">
              <Link
                to={PRINT_MY_WRAP}
                className="inline-flex items-center justify-center gap-2.5 px-10 py-4 rounded-xl text-lg font-bold text-white bg-gradient-to-r from-[#ec4899] to-[#f472b6] shadow-[0_10px_40px_rgba(236,72,153,0.45)] hover:brightness-110 transition"
              >
                <Printer className="w-5 h-5" />
                🩷 PRINT MY WRAP
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
