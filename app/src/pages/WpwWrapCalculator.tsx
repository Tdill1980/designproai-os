/**
 * /wpw-wrap-calculator — the WPW × RestyleProAI Wrap Calculator.
 *
 * Public, no auth. A live, in-browser wrap-material estimator for wrap shops:
 * pick a vehicle (or enter area) → get total square feet, linear feet/yards,
 * estimated material cost, and free-shipping eligibility instantly. Replaces the
 * old Excel/PDF download — it lives on a WePrintWraps-connected URL so it's
 * always current and can be announced by emailing the link.
 *
 * Stays tied to the weekly Wrap of the Week: this week's winner is shown right
 * on the tool. Upsells printed fade wraps with code FADE10.
 *
 * White UI standard. Global top/side nav chrome stays black (app layout).
 *
 * To run next week: update WEEK_WINNER + (optionally) the vehicle presets.
 */

import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import {
  Calculator,
  Ruler,
  SquareStack,
  DollarSign,
  Truck,
  Printer,
  ArrowRight,
  Trophy,
  RotateCcw,
} from "lucide-react";

const COLLAGE_IMG = "/wpw-drop/wotw-collage.jpeg";

// This week's Wrap of the Week winner (keeps the tool tied to the drop).
const WEEK_WINNER = {
  handle: "@pappiyanni",
  title: "Purple BMW M3 — WPW × Paint Is Dead",
  img: COLLAGE_IMG,
};

// Free-shipping threshold (matches weprintwraps.com "Free Shipping ($750+)").
const FREE_SHIP_THRESHOLD = 750;

// Rough full-wrap coverage by vehicle (sq ft). Estimates — the area field is
// editable, so shops can dial it in for their exact vehicle.
const VEHICLES: { label: string; sqft: number }[] = [
  { label: "Compact car", sqft: 200 },
  { label: "Sedan / coupe", sqft: 250 },
  { label: "Sports car", sqft: 220 },
  { label: "Crossover / small SUV", sqft: 275 },
  { label: "Full-size SUV", sqft: 325 },
  { label: "Pickup truck", sqft: 350 },
  { label: "Minivan", sqft: 300 },
  { label: "Cargo van (144\")", sqft: 450 },
  { label: "Sprinter (170\" ext)", sqft: 550 },
  { label: "Box truck", sqft: 600 },
];

const COVERAGE: { label: string; mult: number }[] = [
  { label: "Full wrap (100%)", mult: 1 },
  { label: "Three-quarter (75%)", mult: 0.75 },
  { label: "Half wrap (50%)", mult: 0.5 },
  { label: "Spot / quarter (25%)", mult: 0.25 },
];

const ROLL_WIDTHS = [60, 54]; // inches

const DEFAULTS = {
  vehicleIdx: 1, // Sedan / coupe
  baseSqft: 250,
  coverageIdx: 0,
  rollWidthIn: 60,
  wastePct: 10,
  pricePerSqft: 5.27, // 3M IJ180 printed film — editable
};

const fmt = (n: number, digits = 0) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const inputCls =
  "w-full h-11 rounded-lg border border-gray-300 bg-white px-3 text-gray-900 text-[15px] focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400";

export default function WpwWrapCalculator() {
  const [vehicleIdx, setVehicleIdx] = useState(DEFAULTS.vehicleIdx);
  const [baseSqft, setBaseSqft] = useState<string>(String(DEFAULTS.baseSqft));
  const [coverageIdx, setCoverageIdx] = useState(DEFAULTS.coverageIdx);
  const [rollWidthIn, setRollWidthIn] = useState(DEFAULTS.rollWidthIn);
  const [wastePct, setWastePct] = useState<string>(String(DEFAULTS.wastePct));
  const [pricePerSqft, setPricePerSqft] = useState<string>(
    String(DEFAULTS.pricePerSqft),
  );

  // Selecting a vehicle preset fills the (still editable) area field.
  const onVehicle = (idx: number) => {
    setVehicleIdx(idx);
    if (idx >= 0) setBaseSqft(String(VEHICLES[idx].sqft));
  };

  const reset = () => {
    setVehicleIdx(DEFAULTS.vehicleIdx);
    setBaseSqft(String(DEFAULTS.baseSqft));
    setCoverageIdx(DEFAULTS.coverageIdx);
    setRollWidthIn(DEFAULTS.rollWidthIn);
    setWastePct(String(DEFAULTS.wastePct));
    setPricePerSqft(String(DEFAULTS.pricePerSqft));
  };

  const r = useMemo(() => {
    const base = Math.max(0, Number(baseSqft) || 0);
    const mult = COVERAGE[coverageIdx]?.mult ?? 1;
    const waste = Math.max(0, Number(wastePct) || 0);
    const price = Math.max(0, Number(pricePerSqft) || 0);
    const rollFt = rollWidthIn / 12;

    const totalSqft = base * mult * (1 + waste / 100);
    const linearFt = rollFt > 0 ? totalSqft / rollFt : 0;
    const linearYd = linearFt / 3;
    const cost = totalSqft * price;
    const qualifiesFreeShip = cost >= FREE_SHIP_THRESHOLD;
    const toFreeShip = Math.max(0, FREE_SHIP_THRESHOLD - cost);

    return { totalSqft, linearFt, linearYd, cost, qualifiesFreeShip, toFreeShip };
  }, [baseSqft, coverageIdx, wastePct, pricePerSqft, rollWidthIn]);

  return (
    <>
      <Helmet>
        <title>WPW × RestyleProAI Wrap Calculator — Free Wrap Material Estimator</title>
        <meta
          name="description"
          content="Free live wrap calculator by WePrintWraps × RestyleProAI. Estimate total square feet, linear feet/yards and material cost for any vehicle wrap in seconds — right in your browser."
        />
        <link rel="canonical" href="https://weprintwraps.com/wpw-wrap-calculator" />
      </Helmet>

      <div className="min-h-screen bg-white text-gray-900">
        <div className="h-1.5 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />

        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 sm:py-14">
          {/* Header / wordmark */}
          <div className="text-center mb-9">
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-3 py-1 mb-4">
              <Calculator className="w-3.5 h-3.5" />
              Free live tool · No download
            </div>
            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">
                WPW × RestyleProAI
              </span>{" "}
              <span className="text-gray-900">Wrap Calculator</span>
            </h1>
            <p className="text-gray-600 mt-3 max-w-xl mx-auto">
              Estimate wrap material in seconds. Quote jobs with confidence.
            </p>
          </div>

          {/* Calculator grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Inputs */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
              <div className="p-6 sm:p-7 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-gray-900">Your job</h2>
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-500 hover:text-blue-700"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                </div>

                <label className="block">
                  <span className="text-[13px] font-semibold text-gray-700">Vehicle</span>
                  <select
                    className={inputCls + " mt-1.5"}
                    value={vehicleIdx}
                    onChange={(e) => onVehicle(Number(e.target.value))}
                  >
                    {VEHICLES.map((v, i) => (
                      <option key={v.label} value={i}>
                        {v.label} (~{v.sqft} sq ft full wrap)
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-[13px] font-semibold text-gray-700">
                      Wrap area (sq ft)
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      className={inputCls + " mt-1.5"}
                      value={baseSqft}
                      onChange={(e) => setBaseSqft(e.target.value)}
                    />
                    <span className="text-[11px] text-gray-400">Editable — override the preset</span>
                  </label>

                  <label className="block">
                    <span className="text-[13px] font-semibold text-gray-700">Coverage</span>
                    <select
                      className={inputCls + " mt-1.5"}
                      value={coverageIdx}
                      onChange={(e) => setCoverageIdx(Number(e.target.value))}
                    >
                      {COVERAGE.map((c, i) => (
                        <option key={c.label} value={i}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <label className="block">
                    <span className="text-[13px] font-semibold text-gray-700">Roll width</span>
                    <select
                      className={inputCls + " mt-1.5"}
                      value={rollWidthIn}
                      onChange={(e) => setRollWidthIn(Number(e.target.value))}
                    >
                      {ROLL_WIDTHS.map((w) => (
                        <option key={w} value={w}>
                          {w}"
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-[13px] font-semibold text-gray-700">Waste %</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      className={inputCls + " mt-1.5"}
                      value={wastePct}
                      onChange={(e) => setWastePct(e.target.value)}
                    />
                  </label>

                  <label className="block">
                    <span className="text-[13px] font-semibold text-gray-700">$ / sq ft</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      className={inputCls + " mt-1.5"}
                      value={pricePerSqft}
                      onChange={(e) => setPricePerSqft(e.target.value)}
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Results */}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 shadow-sm overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
              <div className="p-6 sm:p-7">
                <h2 className="text-lg font-bold text-gray-900 mb-4">Your estimate</h2>

                {/* Headline metrics */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl bg-white border border-gray-200 p-4">
                    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-500">
                      <SquareStack className="w-3.5 h-3.5 text-blue-600" />
                      Total square feet
                    </div>
                    <div className="text-3xl font-extrabold text-gray-900 mt-1">
                      {fmt(r.totalSqft)}
                      <span className="text-base font-semibold text-gray-400"> sq ft</span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-white border border-gray-200 p-4">
                    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-500">
                      <DollarSign className="w-3.5 h-3.5 text-blue-600" />
                      Est. material cost
                    </div>
                    <div className="text-3xl font-extrabold text-gray-900 mt-1">
                      ${fmt(r.cost, 2)}
                    </div>
                  </div>
                </div>

                {/* Secondary metrics */}
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="rounded-xl bg-white border border-gray-200 p-4">
                    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-500">
                      <Ruler className="w-3.5 h-3.5 text-blue-600" />
                      Linear feet
                    </div>
                    <div className="text-xl font-bold text-gray-900 mt-1">
                      {fmt(r.linearFt, 1)} ft
                    </div>
                  </div>
                  <div className="rounded-xl bg-white border border-gray-200 p-4">
                    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-500">
                      <Ruler className="w-3.5 h-3.5 text-blue-600" />
                      Linear yards
                    </div>
                    <div className="text-xl font-bold text-gray-900 mt-1">
                      {fmt(r.linearYd, 1)} yd
                    </div>
                  </div>
                </div>

                {/* Free shipping */}
                <div
                  className={
                    "mt-4 flex items-start gap-2.5 rounded-xl border p-4 " +
                    (r.qualifiesFreeShip
                      ? "bg-green-50 border-green-200"
                      : "bg-amber-50 border-amber-200")
                  }
                >
                  <Truck
                    className={
                      "w-5 h-5 shrink-0 mt-0.5 " +
                      (r.qualifiesFreeShip ? "text-green-600" : "text-amber-600")
                    }
                  />
                  <div className="text-[13px] leading-snug">
                    {r.qualifiesFreeShip ? (
                      <span className="text-green-800 font-semibold">
                        Qualifies for FREE shipping (${FREE_SHIP_THRESHOLD}+).
                      </span>
                    ) : (
                      <span className="text-amber-800 font-semibold">
                        Add ${fmt(r.toFreeShip, 2)} more to qualify for FREE
                        shipping (${FREE_SHIP_THRESHOLD}+).
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-gray-400 mt-3 leading-snug">
                  Estimates only. Actual material depends on vehicle, panel
                  layout, roll width and install method.
                </p>
              </div>
            </div>
          </div>

          {/* Print CTA + FADE10 */}
          <div className="mt-8 rounded-2xl overflow-hidden border border-gray-200 bg-black text-white relative">
            <div className="pointer-events-none absolute -top-20 -right-16 w-72 h-72 rounded-full bg-[#ec4899]/25 blur-3xl" />
            <div className="relative p-7 sm:p-9 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div>
                <h3 className="text-2xl sm:text-3xl font-extrabold">
                  Need us to print it?
                </h3>
                <p className="text-gray-300 mt-1.5">
                  Save 10% on any fade wrap this week — premium Avery Dennison or 3M film.
                </p>
                <div className="mt-4 inline-flex items-center gap-2 rounded-lg border-2 border-dashed border-[#ec4899] bg-black/60 px-4 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
                    Code
                  </span>
                  <span className="font-mono text-xl font-extrabold tracking-[0.12em] text-white">
                    FADE10
                  </span>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 shrink-0">
                <Link
                  to="/printpro/fadewrap"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[15px] font-bold text-white bg-gradient-to-r from-[#ec4899] to-[#f472b6] shadow-[0_10px_30px_rgba(236,72,153,0.4)] hover:brightness-110 transition"
                >
                  🩷 Order Your Wrap
                </Link>
                <Link
                  to="/printpro/custom-upload"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[15px] font-bold text-white bg-white/10 border border-white/25 hover:bg-white/20 transition"
                >
                  <Printer className="w-4 h-4" />
                  Print My Wrap
                </Link>
              </div>
            </div>
          </div>

          {/* This week's winner — keeps the tool tied to the drop */}
          <div className="mt-8 rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <img
                src={WEEK_WINNER.img}
                alt={`This week's Wrap of the Week winner — ${WEEK_WINNER.title}`}
                className="w-full h-full object-cover object-top max-h-[420px]"
                loading="lazy"
              />
              <div className="p-7 sm:p-8 flex flex-col justify-center">
                <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white bg-gradient-to-r from-[#3b82f6] to-[#ec4899] rounded-full px-3 py-1 w-fit mb-4">
                  <Trophy className="w-3.5 h-3.5" />
                  This Week's Winner
                </div>
                <h3 className="text-2xl font-extrabold text-gray-900">
                  {WEEK_WINNER.handle}
                </h3>
                <p className="text-gray-600 mt-1.5">{WEEK_WINNER.title}</p>
                <p className="text-sm text-gray-500 mt-3 leading-relaxed">
                  Curated for the{" "}
                  <span className="font-semibold text-gray-700">
                    Paint Is Dead × WePrintWraps
                  </span>{" "}
                  Wrap of the Week. Feeling inspired? Design yours and we'll print it.
                </p>
                <Link
                  to="/club-wpw-drop"
                  className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-bold text-blue-700 hover:text-blue-800 w-fit"
                >
                  See this week's drop
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
