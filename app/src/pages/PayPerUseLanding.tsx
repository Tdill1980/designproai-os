import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowRight, Info, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

const TRY_PACK_PRICE_CENTS = 2500;
const TRY_PACK_TOKENS = 3;
const PRODUCTION_PACK_PRICE = "$299";

type Tool = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  priceCents: number;
  unitLabel: string;
  accent: string;
  image: string;
  imageAlt: string;
};

const TOOLS: Tool[] = [
  {
    slug: "colorpro",
    name: "ColorPro",
    tagline: "See the color before you commit.",
    description:
      "Photorealistic color-change renders on your exact vehicle, with the real manufacturer film catalog.",
    priceCents: 2500,
    unitLabel: "1 render",
    accent: "from-cyan-500 to-sky-500",
    image: "/colorpro-hero-ferrari.png",
    imageAlt: "ColorPro render of a Ferrari in a custom wrap color",
  },
  {
    slug: "designpro",
    name: "DesignPro",
    tagline: "AI design for any panel.",
    description:
      "Generate panel-by-panel wrap designs from a prompt or reference image and drop them on the vehicle.",
    priceCents: 2500,
    unitLabel: "1 render",
    accent: "from-fuchsia-500 to-pink-500",
    image: "/screenshots/porsche-distressed-hero.png",
    imageAlt: "DesignPro render of a Porsche with a distressed-style wrap",
  },
  {
    slug: "fadewraps",
    name: "FadeWraps",
    tagline: "Gradients that actually look custom.",
    description:
      "Multiple fade and gradient styles rendered on body lines — preview before printing.",
    priceCents: 2500,
    unitLabel: "1 render",
    accent: "from-orange-500 to-red-500",
    image: "/inkfusion/celestial-aqua-hero.png",
    imageAlt: "FadeWraps celestial aqua gradient on a vehicle",
  },
  {
    slug: "wbty",
    name: "Wrap By The Yard",
    tagline: "Know the footage before you quote.",
    description:
      "Linear-footage calculator across every vehicle in the catalog. One-and-done answers.",
    priceCents: 2500,
    unitLabel: "1 calculation",
    accent: "from-emerald-500 to-green-500",
    image: "/wbty-yards-guide.jpg",
    imageAlt: "Wrap By The Yard linear-footage guide preview",
  },
  {
    slug: "approvemode",
    name: "ApproveMode",
    tagline: "Get the signoff. Skip the back-and-forth.",
    description:
      "Send proofs, track revisions, and close approvals in one branded workflow.",
    priceCents: 2500,
    unitLabel: "1 proof",
    accent: "from-violet-500 to-indigo-500",
    image: "/screenshots/production-proof.png",
    imageAlt: "ApproveMode production proof view",
  },
  {
    slug: "graphicspro",
    name: "GraphicsPro",
    tagline: "AI graphics, cut-contour ready.",
    description:
      "Generate door, hood, panel and side graphics tuned for cut-contour production.",
    priceCents: 2500,
    unitLabel: "1 render",
    accent: "from-yellow-400 to-amber-500",
    image: "/colorpro-hero-blue-genesis.png",
    imageAlt: "GraphicsPro render with custom panel graphics",
  },
  {
    slug: "printpro",
    name: "PrintPro",
    tagline: "Print-ready in one click.",
    description:
      "Take any design straight to a production-ready file with bleed, marks, and color management.",
    priceCents: 2500,
    unitLabel: "1 print-ready file",
    accent: "from-rose-500 to-fuchsia-500",
    image: "/screenshots/closeup-render.png",
    imageAlt: "PrintPro production close-up render detail",
  },
  {
    slug: "visualize",
    name: "Visualizer",
    tagline: "Show the customer the full spin.",
    description:
      "360° 3D vehicle visualization with your design wrapped from every angle.",
    priceCents: 2500,
    unitLabel: "1 spin",
    accent: "from-blue-500 to-cyan-500",
    image: "/colorpro-hero-purple-merc.png",
    imageAlt: "Visualizer 360° spin of a purple Mercedes wrap",
  },
  {
    slug: "material",
    name: "MaterialMode",
    tagline: "Matte. Gloss. Carbon. See it first.",
    description:
      "Texture and finish visualization so the buyer picks the right material the first time.",
    priceCents: 2500,
    unitLabel: "1 render",
    accent: "from-slate-400 to-zinc-500",
    image: "/colorpro-hero-bronze.png",
    imageAlt: "MaterialMode render showing a bronze metallic finish",
  },
  {
    slug: "gallery",
    name: "Gallery Feature",
    tagline: "Put your work in front of buyers.",
    description:
      "Feature one of your finished designs in the public RestylePro gallery.",
    priceCents: 2500,
    unitLabel: "1 feature credit",
    accent: "from-teal-400 to-cyan-500",
    image: "/renders/zombie-rust-hero.png",
    imageAlt: "Gallery feature render — zombie rust theme",
  },
];

const HERO_IMAGE =
  "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/email-assets/2014%20mini%20cooper%20s%20-%20Passenger%20Side.png";

// Real subscription rates pulled from PricingColorPro.tsx — token = $25 retail.
const SUB_TIERS = [
  { name: "Starter",          monthly: 350, perRender: 7.00 },
  { name: "DesignPro Lite",   monthly: 499, perRender: 6.65 },
  { name: "DesignPro Studio", monthly: 699, perRender: 4.66 },
  { name: "DesignPro Plus",   monthly: 995, perRender: 3.32 },
];

const SINGLE_USE_PER_RENDER = 25;
const BEST_TIER = SUB_TIERS[SUB_TIERS.length - 1];
const BEST_SAVINGS_PCT = Math.round(
  ((SINGLE_USE_PER_RENDER - BEST_TIER.perRender) / SINGLE_USE_PER_RENDER) * 100,
);

const fmtPrice = (cents: number) =>
  `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export default function PayPerUseLanding() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [buying, setBuying] = useState<string | null>(null);

  const canceledTool = params.get("canceled");
  useEffect(() => {
    if (!canceledTool) return;
    toast({
      title: "Checkout canceled",
      description: `No charge — your ${canceledTool} purchase was canceled.`,
    });
  }, [canceledTool]);

  // Single shared offer: $25 → 3 tokens. The buyer picks which tool to
  // spend them in afterwards. Tool slug is only used to mark the
  // loading button + record the entry point in metadata.
  const startCheckout = async (tool: Tool) => {
    setBuying(tool.slug);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate("/login", { state: { from: `/try?buy=1` } });
        return;
      }
      const { data, error } = await supabase.functions.invoke<{ url: string }>(
        "create-try-checkout",
        { body: {} },
      );
      if (error) throw error;
      if (!data?.url) throw new Error("Checkout URL missing");
      window.location.href = data.url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Couldn't start checkout";
      toast({
        title: "Checkout failed",
        description: msg,
        variant: "destructive",
      });
      setBuying(null);
    }
  };

  const sections = useMemo(() => TOOLS, []);

  return (
    <>
      <Helmet>
        <title>Pay-Per-Use — RestylePro</title>
        <meta
          name="description"
          content="Buy a single use of any RestylePro tool. No subscription. No commitment. Pay once, render once."
        />
      </Helmet>

      <main className="min-h-screen bg-black text-white">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-zinc-900">
          <img
            src={HERO_IMAGE}
            alt="MINI Cooper wrap render — Practical Magic Health & Wellness"
            className="absolute inset-0 w-full h-full object-cover opacity-60"
            loading="eager"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/60 to-black pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-fuchsia-500/20 pointer-events-none" />
          <div className="relative max-w-5xl mx-auto px-6 py-28 md:py-36 text-center">
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-400 font-semibold mb-4">
              Pay-Per-Use
            </p>
            <h1 className="font-display text-5xl md:text-7xl font-black leading-tight">
              Use any tool.{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">
                Pay once.
              </span>
            </h1>
            <p className="mt-6 text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto">
              One-off project?{" "}
              <span className="font-semibold text-white">
                $25 for {TRY_PACK_TOKENS} designs
              </span>
              , no subscription. Running these every week? A monthly plan drops
              the same render to{" "}
              <span className="font-semibold text-white">
                ${BEST_TIER.perRender.toFixed(2)}
              </span>{" "}
              —{" "}
              <span className="text-cyan-300 font-bold">
                {BEST_SAVINGS_PCT}% off
              </span>{" "}
              the single-use price.
            </p>
            <p className="mt-3 text-xs text-zinc-500 max-w-2xl mx-auto">
              Designs only. Production-ready print files are a separate{" "}
              <span className="text-zinc-300 font-semibold">
                {PRODUCTION_PACK_PRICE} Production Pack
              </span>{" "}
              (discounted on monthly plans).
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" variant="gradient">
                <a href="/pricing">See monthly plans</a>
              </Button>
              <a
                href="#tools"
                className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200"
              >
                Or buy a single use <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </section>

        {/* Tool sections */}
        <div id="tools">
          {sections.map((tool, i) => (
            <section
              key={tool.slug}
              id={tool.slug}
              className={`scroll-mt-20 border-b border-zinc-900 ${
                i % 2 === 0 ? "bg-black" : "bg-zinc-950"
              }`}
            >
              <div
                className={`max-w-6xl mx-auto px-6 py-20 md:py-28 grid md:grid-cols-2 gap-10 md:gap-14 items-center ${
                  i % 2 === 1 ? "md:[&>*:first-child]:order-2" : ""
                }`}
              >
                <div className="relative">
                  <div
                    className={`absolute -inset-3 rounded-3xl bg-gradient-to-r ${tool.accent} opacity-20 blur-2xl pointer-events-none`}
                  />
                  <div className="relative rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl aspect-[4/3] bg-zinc-900">
                    <img
                      src={tool.image}
                      alt={tool.imageAlt}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                </div>

                <div>
                  <p
                    className={`text-xs uppercase tracking-[0.25em] font-bold bg-gradient-to-r ${tool.accent} bg-clip-text text-transparent`}
                  >
                    {String(i + 1).padStart(2, "0")} · {tool.unitLabel}
                  </p>
                  <h2 className="font-display text-4xl md:text-5xl font-black mt-3">
                    {tool.name}
                  </h2>
                  <p className="mt-3 text-xl text-zinc-300">{tool.tagline}</p>
                  <p className="mt-4 text-zinc-400 leading-relaxed max-w-md">
                    {tool.description}
                  </p>

                  <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Try pack — single price, applies to every tool */}
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                      <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                        Try pack
                      </p>
                      <div className="flex items-baseline gap-1 mt-1">
                        <span className="text-3xl font-black">
                          {fmtPrice(TRY_PACK_PRICE_CENTS)}
                        </span>
                        <span className="text-xs text-zinc-500">
                          / {TRY_PACK_TOKENS} designs
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {TRY_PACK_TOKENS} tokens — renders OR revisions in any
                        tool. No subscription.
                      </p>
                      <Button
                        size="sm"
                        onClick={() => startCheckout(tool)}
                        disabled={buying === tool.slug}
                        variant="outline"
                        className="w-full mt-4 border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                      >
                        {buying === tool.slug ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Loading…
                          </>
                        ) : (
                          <>
                            Get {TRY_PACK_TOKENS} designs —{" "}
                            {fmtPrice(TRY_PACK_PRICE_CENTS)}
                          </>
                        )}
                      </Button>
                    </div>

                    {/* Subscription value — promoted */}
                    <div
                      className={`relative rounded-2xl border bg-zinc-900/60 p-5 overflow-hidden border-transparent`}
                    >
                      <div
                        className={`absolute inset-0 rounded-2xl bg-gradient-to-r ${tool.accent} opacity-20 pointer-events-none`}
                      />
                      <div
                        className={`absolute inset-px rounded-[15px] bg-zinc-950 pointer-events-none`}
                      />
                      <div className="relative">
                        <div className="flex items-center justify-between">
                          <p
                            className={`text-[11px] uppercase tracking-wider font-bold bg-gradient-to-r ${tool.accent} bg-clip-text text-transparent`}
                          >
                            On subscription
                          </p>
                          <span className="text-[10px] font-black bg-cyan-500/15 text-cyan-300 rounded px-1.5 py-0.5 border border-cyan-500/30">
                            SAVE {BEST_SAVINGS_PCT}%
                          </span>
                        </div>
                        <div className="flex items-baseline gap-1 mt-1">
                          <span className="text-xs text-zinc-500">as low as</span>
                          <span className="text-3xl font-black">
                            ${BEST_TIER.perRender.toFixed(2)}
                          </span>
                          <span className="text-xs text-zinc-500">
                            / {tool.unitLabel}
                          </span>
                        </div>
                        <ul className="mt-3 space-y-1 text-[11px] text-zinc-400">
                          {SUB_TIERS.map((t) => (
                            <li
                              key={t.name}
                              className="flex items-center justify-between gap-2"
                            >
                              <span>{t.name}</span>
                              <span className="font-mono text-zinc-300">
                                ${t.monthly}/mo · ${t.perRender.toFixed(2)} ea
                              </span>
                            </li>
                          ))}
                        </ul>
                        <Button
                          asChild
                          size="sm"
                          className={`w-full mt-4 bg-gradient-to-r ${tool.accent} hover:opacity-90 text-white font-bold border-0`}
                        >
                          <a href="/pricing">
                            Subscribe & save
                            <ArrowRight className="h-4 w-4 ml-1" />
                          </a>
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-start gap-2 text-[11px] text-zinc-500">
                    <Info className="h-3.5 w-3.5 text-cyan-400 mt-0.5 shrink-0" />
                    <p>
                      Designs only. Production-ready print files are a
                      separate{" "}
                      <span className="text-zinc-300 font-semibold">
                        {PRODUCTION_PACK_PRICE} Production Pack
                      </span>{" "}
                      (discounted on monthly plans). Tokens are shared across
                      every tool below.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* Footer band — subscription value close */}
        <section className="max-w-4xl mx-auto px-6 py-24">
          <div className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-cyan-500/10 via-zinc-900/40 to-fuchsia-500/10 p-8 md:p-12 text-center">
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-400 font-semibold">
              The math
            </p>
            <h3 className="font-display text-3xl md:text-5xl font-black mt-3">
              $25 = 3 designs ($8.33 each).{" "}
              <br className="hidden md:block" />
              <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">
                Starter is $350 for 50 ($7 each).
              </span>
            </h3>
            <p className="mt-5 text-zinc-300 max-w-2xl mx-auto">
              The Try Pack is for one-off testing. The minute you'd buy a
              second pack, the Starter plan is cheaper per design — and Plus
              customers run at $
              {BEST_TIER.perRender.toFixed(2)}/render,{" "}
              <span className="font-bold text-white">
                {BEST_SAVINGS_PCT}% under
              </span>{" "}
              the Try Pack rate. Production-ready print files are a separate{" "}
              <span className="font-bold text-white">
                {PRODUCTION_PACK_PRICE} Production Pack
              </span>{" "}
              (subscriber-discounted).
            </p>
            <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
              {SUB_TIERS.map((t) => (
                <div
                  key={t.name}
                  className="rounded-xl border border-zinc-800 bg-black/40 p-4"
                >
                  <p className="text-xs text-zinc-400 truncate">{t.name}</p>
                  <p className="text-2xl font-black mt-1">${t.monthly}</p>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                    per month
                  </p>
                  <p className="text-xs text-cyan-300 font-semibold mt-2">
                    ${t.perRender.toFixed(2)} / render
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" variant="gradient">
                <a href="/pricing">See monthly plans</a>
              </Button>
              <a
                href="#tools"
                className="text-sm font-semibold text-zinc-400 hover:text-zinc-200"
              >
                Or stay pay-per-use
              </a>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
