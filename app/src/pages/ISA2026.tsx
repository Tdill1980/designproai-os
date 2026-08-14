import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import {
  Sparkles,
  ArrowRight,
  CheckCircle2,
  MapPin,
  Calendar,
  Zap,
  Eye,
  Printer,
  Layers,
  Brain,
  Palette,
  Store,
  Camera,
  FileText,
  Phone,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/* ─── Countdown Hook ────────────────────────────────────────────── */
const ISA_DATE = new Date("2026-04-08T09:00:00-04:00"); // EDT Orlando — show floor opens Wed Apr 8
function useISACountdown() {
  const calc = () => {
    const diff = Math.max(0, ISA_DATE.getTime() - Date.now());
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

/* ─── Lead Capture Form ─────────────────────────────────────────── */
function ISASignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [shopName, setShopName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !phone || !shopName) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("presale_signups" as any)
        .insert({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          shop_name: shopName.trim(),
          source: "isa-2026-booth",
        } as any);
      if (error && error.code !== "23505") throw error;
      if (error?.code === "23505") toast.info("You're already on the list!");
      else toast.success("You're in! We'll send you show specials.");
      setSubmitted(true);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8">
        <CheckCircle2 className="w-10 h-10 text-cyan-400" />
        <span className="text-white font-semibold text-xl">You're on the list!</span>
        <p className="text-sm text-[#888]">We'll text you exclusive ISA show pricing before the event.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-left max-w-md mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input type="text" placeholder="Your Name" value={name} onChange={(e) => setName(e.target.value)} required className="bg-[#111] border-white/10 h-12 text-white placeholder:text-[#555]" />
        <Input type="text" placeholder="Shop Name" value={shopName} onChange={(e) => setShopName(e.target.value)} required className="bg-[#111] border-white/10 h-12 text-white placeholder:text-[#555]" />
      </div>
      <Input type="email" placeholder="Email Address" value={email} onChange={(e) => setEmail(e.target.value)} required className="bg-[#111] border-white/10 h-12 text-white placeholder:text-[#555]" />
      <div className="relative">
        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555]" />
        <Input type="tel" placeholder="Phone (for text notifications)" value={phone} onChange={(e) => setPhone(e.target.value)} required className="bg-[#111] border-white/10 h-12 pl-10 text-white placeholder:text-[#555]" />
      </div>
      <Button type="submit" disabled={loading} className="w-full h-13 text-base font-bold text-white border-0 bg-gradient-to-r from-[#E040FB] via-[#8B5CF6] to-[#3B82F6] hover:opacity-90 transition-opacity">
        {loading ? "Submitting..." : "Get ISA Show Specials"}
      </Button>
      <p className="text-center text-[10px] text-[#555] font-mono">No spam. Unsubscribe anytime.</p>
    </form>
  );
}

/* ─── Countdown Display ─────────────────────────────────────────── */
function ISACountdown() {
  const countdown = useISACountdown();

  if (countdown.expired) {
    return (
      <div className="text-center my-8">
        <p className="text-2xl font-bold text-cyan-400 animate-pulse">ISA 2026 IS LIVE! Visit Us at Booth [TBD]</p>
      </div>
    );
  }

  return (
    <div className="text-center my-8">
      <p className="text-xs font-bold tracking-[3px] uppercase text-cyan-400/60 font-mono mb-4">Show Starts In</p>
      <div className="flex items-center justify-center gap-2 sm:gap-4">
        {(["days", "hours", "minutes", "seconds"] as const).map((unit, i) => (
          <div key={unit} className="flex items-center gap-2 sm:gap-4">
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 sm:w-22 sm:h-22 rounded-xl bg-[#0a0a0a] border border-cyan-500/20 flex items-center justify-center shadow-[0_0_20px_rgba(0,229,255,0.08)]">
                <span className="text-2xl sm:text-4xl font-black font-mono bg-gradient-to-b from-cyan-300 to-cyan-500 bg-clip-text text-transparent">
                  {String(countdown[unit]).padStart(2, "0")}
                </span>
              </div>
              <span className="text-[9px] sm:text-xs text-cyan-400/40 font-mono uppercase tracking-wider mt-1.5">{unit}</span>
            </div>
            {i < 3 && <span className="text-xl sm:text-2xl text-cyan-500/20 font-bold -mt-4">:</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── USP Data ──────────────────────────────────────────────────── */
const USP_ITEMS = [
  {
    title: "DesignIQ\u2122",
    tagline: "AI that designs like a real graphic designer",
    desc: "Describe any wrap concept in plain English. DesignIQ creates a custom, unique vehicle wrap design — not a template, not stock art. Engineered using 10+ years of real graphic design order data from WePrintWraps.com.",
    img: "/email-assets/porsche-martini-hook.png",
    icon: Brain,
  },
  {
    title: "VisionBoardIQ\u2122",
    tagline: "Upload references, AI matches your vision",
    desc: "Drop in mood boards, competitor wraps, or hand sketches. VisionBoard analyzes your references and generates designs that match your customer's exact vision.",
    img: "/visionboard-example.png",
    icon: Eye,
  },
  {
    title: "RevisionStudioIQ\u2122",
    tagline: "Every version is an asset",
    desc: "Full revision history with side-by-side comparison. Every iteration is saved, rated, and searchable \u2014 build a design library that compounds over time.",
    img: "/screenshots/revisionstudio-render.png",
    icon: Layers,
  },
  {
    title: "Universal Panelizer\u2122",
    tagline: "Print-ready panels, zero manual work",
    desc: "AI extracts flat production panels from your designs automatically. No more hours in Illustrator tracing body lines — go from design to RIP in minutes.",
    img: "/screenshots/productionflow-panelizer.png",
    icon: Printer,
  },
  {
    title: "ProductionFlow\u2122",
    tagline: "Complete automated pipeline",
    desc: "End-to-end production automation: design, panelize, proof, and prepare print files. One click from concept to production-ready output.",
    img: "/screenshots/productionflow-system.png",
    icon: Zap,
  },
  {
    title: "Design Approval Proofs",
    tagline: "Professional proof sheets",
    desc: "Auto-generated customer approval proofs with your branding, multiple angles, and material callouts. Send professional presentations in seconds, not hours.",
    img: "/screenshots/production-proof.png",
    icon: FileText,
  },
  {
    title: "Real Results",
    tagline: "See actual AI-generated designs",
    desc: "Every image below was generated by DesignIQ \u2014 no templates, no stock art, no Photoshop. Each one is a unique, original design created from a text prompt.",
    isGallery: true,
    galleryImages: [
      "/email-assets/lambo-xray-hook.png",
      "/email-assets/mini-cooper-hook.png",
      "/email-assets/bbq-sprinter-hook.png",
      "/renders/zombie-rust-hero.png",
    ],
    icon: Camera,
  },
  {
    title: "CreatorMarket\u2122",
    tagline: "Sell your designs to the community",
    desc: "Turn your best designs into passive income. List on the CreatorMarket and earn every time another shop licenses your work for their customer.",
    img: "/screenshots/designproai-system.png",
    icon: Store,
  },
];

/* ─── Gallery Images ────────────────────────────────────────────── */
const GALLERY_IMAGES = [
  { src: "/email-assets/porsche-martini-hook.png", alt: "Porsche Martini Racing Wrap" },
  { src: "/email-assets/lambo-xray-hook.png", alt: "Lamborghini X-Ray Design" },
  { src: "/hero-mustang.jpg", alt: "Mustang — Custom AI Wrap Design" },
  { src: "/email-assets/mini-cooper-hook.png", alt: "Mini Cooper Custom Wrap" },
  { src: "/renders/zombie-rust-hero.png", alt: "Zombie Rust Distressed Wrap" },
  { src: "/email-assets/bbq-sprinter-hook.png", alt: "BBQ Sprinter Commercial Wrap" },
  { src: "/screenshots/porsche-distressed-hero.png", alt: "Porsche Distressed Design" },
];

/* ─── Pricing Tiers ─────────────────────────────────────────────── */
const PRICING_TIERS = [
  { name: "Starter", price: "$449", period: "/yr", renders: "120 renders/yr", highlight: false },
  { name: "Professional", price: "$899", period: "/yr", renders: "600 renders/yr", highlight: true },
  { name: "Pro Shop", price: "$1,899", period: "/yr", renders: "2,400 renders/yr", highlight: false },
  { name: "Enterprise", price: "$3,799", period: "/yr", renders: "Unlimited", highlight: false },
];

/* ═══════════════════════════════════════════════════════════════════
   ISA 2026 LANDING PAGE
   ═══════════════════════════════════════════════════════════════════ */
export default function ISA2026() {
  return (
    <>
      <Helmet>
        <title>DesignProAI at ISA 2026 | AI Vehicle Wrap Design System</title>
        <meta name="description" content="Visit DesignProAI at ISA International Sign Expo 2026 in Orlando. See the world's first AI vehicle wrap design system live. From prompt to print-ready in minutes." />
        <meta property="og:title" content="DesignProAI at ISA International Sign Expo 2026" />
        <meta property="og:description" content="The world's first AI vehicle wrap design system. See it live at ISA 2026 in Orlando, April 8-10." />
        <meta property="og:image" content="/hero-mustang.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
      </Helmet>

      <div className="min-h-screen bg-black text-white">
        {/* ────────────────────────────────────────────────────────────
            SECTION 1: HERO
        ──────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          {/* Background glow */}
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-r from-[#E040FB]/8 via-[#8B5CF6]/8 to-[#00E5FF]/8 blur-[120px] pointer-events-none" />

          <div className="relative max-w-6xl mx-auto px-4 pt-8 pb-12 sm:pt-16 sm:pb-20">
            {/* Booth badge */}
            <div className="flex justify-center mb-6">
              <Badge className="bg-cyan-500/10 border-cyan-500/30 text-cyan-400 px-4 py-1.5 text-sm font-mono tracking-wide hover:bg-cyan-500/15">
                <MapPin className="w-3.5 h-3.5 mr-1.5" />
                See Us at ISA 2026 — Booth [TBD]
              </Badge>
            </div>

            {/* Headline */}
            <h1 className="text-center text-3xl sm:text-5xl lg:text-6xl font-black leading-tight tracking-tight mb-4">
              <span className="bg-gradient-to-r from-white via-white to-white/80 bg-clip-text text-transparent">The World's First</span>
              <br />
              <span className="bg-gradient-to-r from-[#00E5FF] via-[#8B5CF6] to-[#E040FB] bg-clip-text text-transparent">AI Vehicle Wrap Design System</span>
            </h1>

            <p className="text-center text-lg sm:text-xl text-[#999] max-w-2xl mx-auto mb-8 font-light">
              From Prompt to Print-Ready Production in Minutes
            </p>

            {/* Hero image */}
            <div className="relative max-w-4xl mx-auto mb-8 rounded-2xl overflow-hidden border border-white/5 shadow-[0_0_60px_rgba(0,229,255,0.08)]">
              <img
                src="/hero-mustang.jpg"
                alt="Custom AI-designed vehicle wrap by DesignIQ"
                className="w-full h-auto"
                loading="eager"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                <span className="text-xs font-mono text-white/50">Custom wrap designed by DesignIQ&#8482; in 30 seconds</span>
                <Badge className="bg-black/50 border-cyan-500/30 text-cyan-400 text-[10px] font-mono">AI DESIGNED</Badge>
              </div>
            </div>

            {/* Countdown */}
            <ISACountdown />

            {/* CTA */}
            <div className="flex justify-center mt-6">
              <Link to="/pricing">
                <Button className="h-14 px-10 text-base font-bold bg-gradient-to-r from-[#E040FB] via-[#8B5CF6] to-[#00E5FF] text-white border-0 hover:opacity-90 transition-opacity shadow-[0_0_30px_rgba(139,92,246,0.3)] rounded-xl">
                  Get ISA Show Special Pricing
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 2: LIVE DEMO — 3 Steps
        ──────────────────────────────────────────────────────────── */}
        <section className="relative py-16 sm:py-24">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#050505] to-transparent pointer-events-none" />
          <div className="relative max-w-6xl mx-auto px-4">
            <div className="text-center mb-12">
              <Badge className="bg-[#E040FB]/10 border-[#E040FB]/30 text-[#E040FB] px-3 py-1 text-xs font-mono mb-4">
                LIVE AT OUR BOOTH
              </Badge>
              <h2 className="text-2xl sm:text-4xl font-black mb-3">See It Live at ISA 2026</h2>
              <p className="text-[#777] max-w-xl mx-auto">Watch the complete workflow from concept to print-ready files in under 3 minutes.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  step: "01",
                  title: "Describe Your Vision",
                  desc: "Type a wrap concept in plain English. Add references, choose a vehicle, pick your finish.",
                  img: "/screenshots/designproai-system.png",
                },
                {
                  step: "02",
                  title: "AI Creates Custom Wrap Designs",
                  desc: "DesignIQ designs unique vehicle wraps like a real graphic designer — engineered on 10+ years of real design order data.",
                  img: "/screenshots/closeup-render.png",
                },
                {
                  step: "03",
                  title: "Get Print-Ready Files",
                  desc: "Universal Panelizer extracts flat production panels. Ready for your RIP software immediately.",
                  img: "/screenshots/productionflow-panelizer.png",
                },
              ].map((item) => (
                <Card key={item.step} className="bg-[#0a0a0a] border-white/5 overflow-hidden group hover:border-cyan-500/20 transition-all duration-300">
                  <div className="relative overflow-hidden">
                    <img
                      src={item.img}
                      alt={item.title}
                      className="w-full h-48 sm:h-56 object-cover object-top group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                    <div className="absolute top-3 left-3">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#00E5FF] to-[#8B5CF6] flex items-center justify-center text-sm font-black font-mono text-white shadow-lg">
                        {item.step}
                      </div>
                    </div>
                  </div>
                  <div className="p-5">
                    <h3 className="text-lg font-bold text-white mb-2">{item.title}</h3>
                    <p className="text-sm text-[#888] leading-relaxed">{item.desc}</p>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 3: USP SHOWCASE — 8 Reasons
        ──────────────────────────────────────────────────────────── */}
        <section className="py-16 sm:py-24">
          <div className="max-w-6xl mx-auto px-4">
            <div className="text-center mb-14">
              <Badge className="bg-cyan-500/10 border-cyan-500/30 text-cyan-400 px-3 py-1 text-xs font-mono mb-4">
                WHY VISIT OUR BOOTH
              </Badge>
              <h2 className="text-2xl sm:text-4xl font-black mb-3">8 Reasons to Stop By</h2>
              <p className="text-[#777] max-w-xl mx-auto">Every feature built for working wrap professionals. No gimmicks.</p>
            </div>

            <div className="space-y-12 sm:space-y-20">
              {USP_ITEMS.map((usp, i) => {
                const Icon = usp.icon;
                const isReversed = i % 2 === 1;
                return (
                  <div
                    key={usp.title}
                    className={`flex flex-col ${isReversed ? "md:flex-row-reverse" : "md:flex-row"} gap-6 sm:gap-10 items-center`}
                  >
                    {/* Image side */}
                    <div className="w-full md:w-1/2">
                      {usp.isGallery ? (
                        <div className="grid grid-cols-2 gap-2 rounded-2xl overflow-hidden">
                          {usp.galleryImages!.map((src) => (
                            <img
                              key={src}
                              src={src}
                              alt="AI-generated wrap design"
                              className="w-full h-36 sm:h-44 object-cover hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="relative rounded-2xl overflow-hidden border border-white/5 shadow-[0_0_40px_rgba(0,229,255,0.04)]">
                          <img
                            src={usp.img}
                            alt={usp.title}
                            className="w-full h-auto"
                            loading="lazy"
                          />
                        </div>
                      )}
                    </div>

                    {/* Text side */}
                    <div className="w-full md:w-1/2 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00E5FF]/20 to-[#8B5CF6]/20 border border-cyan-500/20 flex items-center justify-center">
                          <Icon className="w-5 h-5 text-cyan-400" />
                        </div>
                        <span className="text-xs font-mono text-[#555] tracking-wider">0{i + 1} / 08</span>
                      </div>
                      <h3 className="text-xl sm:text-2xl font-black text-white">{usp.title}</h3>
                      <p className="text-sm font-semibold bg-gradient-to-r from-[#00E5FF] to-[#8B5CF6] bg-clip-text text-transparent">{usp.tagline}</p>
                      <p className="text-[#888] leading-relaxed">{usp.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 4: GALLERY STRIP
        ──────────────────────────────────────────────────────────── */}
        <section className="py-16 sm:py-20 overflow-hidden">
          <div className="max-w-6xl mx-auto px-4 mb-8">
            <div className="text-center">
              <h2 className="text-2xl sm:text-3xl font-black mb-2">Real AI-Generated Designs</h2>
              <p className="text-sm text-[#666]">Every design generated by DesignIQ&#8482; \u2014 no templates, no stock art</p>
            </div>
          </div>

          <div className="relative">
            {/* Fade edges */}
            <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-black to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-black to-transparent z-10 pointer-events-none" />

            <div className="flex gap-4 overflow-x-auto pb-4 px-4 scrollbar-hide snap-x snap-mandatory" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
              {GALLERY_IMAGES.map((img) => (
                <div key={img.src} className="flex-none w-72 sm:w-96 snap-center">
                  <div className="relative rounded-xl overflow-hidden border border-white/5 group cursor-pointer">
                    <img
                      src={img.src}
                      alt={img.alt}
                      className="w-full h-48 sm:h-60 object-cover group-hover:scale-110 transition-transform duration-700"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="absolute bottom-3 left-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <span className="text-xs font-mono text-white/70">{img.alt}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 5: ISA SHOW SPECIAL PRICING
        ──────────────────────────────────────────────────────────── */}
        <section className="relative py-16 sm:py-24">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#8B5CF6]/3 to-transparent pointer-events-none" />
          <div className="relative max-w-5xl mx-auto px-4">
            <div className="text-center mb-10">
              <Badge className="bg-[#E040FB]/10 border-[#E040FB]/30 text-[#E040FB] px-4 py-1.5 text-sm font-mono mb-4">
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                ISA ATTENDEE EXCLUSIVE
              </Badge>
              <h2 className="text-2xl sm:text-4xl font-black mb-3">Lock In Show-Floor Pricing</h2>
              <p className="text-[#777]">These prices expire when the show ends. Don't miss out.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {PRICING_TIERS.map((tier) => (
                <Card
                  key={tier.name}
                  className={`relative bg-[#0a0a0a] p-6 text-center transition-all duration-300 ${
                    tier.highlight
                      ? "border-cyan-500/40 shadow-[0_0_30px_rgba(0,229,255,0.1)] scale-[1.02]"
                      : "border-white/5 hover:border-white/10"
                  }`}
                >
                  {tier.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-gradient-to-r from-[#00E5FF] to-[#8B5CF6] text-white text-[10px] font-mono px-3">MOST POPULAR</Badge>
                    </div>
                  )}
                  <h3 className="text-lg font-bold text-white mb-1">{tier.name}</h3>
                  <div className="mb-3">
                    <span className="text-3xl font-black bg-gradient-to-r from-[#00E5FF] to-[#8B5CF6] bg-clip-text text-transparent">{tier.price}</span>
                    <span className="text-sm text-[#666]">{tier.period}</span>
                  </div>
                  <p className="text-sm text-[#888] font-mono">{tier.renders}</p>
                </Card>
              ))}
            </div>

            <p className="text-center text-sm text-[#E040FB] font-semibold mt-6 animate-pulse">These prices expire when the show ends</p>

            <div className="flex justify-center mt-8">
              <Link to="/pricing">
                <Button className="h-13 px-8 text-base font-bold bg-gradient-to-r from-[#E040FB] via-[#8B5CF6] to-[#00E5FF] text-white border-0 hover:opacity-90 transition-opacity rounded-xl">
                  View Full Pricing Details
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 6: LEAD CAPTURE
        ──────────────────────────────────────────────────────────── */}
        <section className="py-16 sm:py-24">
          <div className="max-w-2xl mx-auto px-4">
            <Card className="bg-[#0a0a0a] border-white/5 p-8 sm:p-12 relative overflow-hidden">
              {/* Background glow */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-[#E040FB]/5 to-transparent pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr from-[#00E5FF]/5 to-transparent pointer-events-none" />

              <div className="relative text-center mb-8">
                <h2 className="text-2xl sm:text-3xl font-black mb-2">Can't Make It to the Booth?</h2>
                <p className="text-[#888]">Sign up and we'll send you the ISA show specials plus a personal demo link.</p>
              </div>

              <div className="relative">
                <ISASignupForm />
              </div>
            </Card>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 7: FOOTER
        ──────────────────────────────────────────────────────────── */}
        <section className="relative py-16 sm:py-20 border-t border-white/5">
          <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/3 to-transparent pointer-events-none" />
          <div className="relative max-w-4xl mx-auto px-4 text-center">
            <img
              src="/characters/sproket/sproket-welcome.png"
              alt="SPROKET mascot"
              className="w-20 h-20 mx-auto mb-6 object-contain"
            />

            <h2 className="text-xl sm:text-2xl font-black mb-4">Find Us at ISA International Sign Expo</h2>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 mb-6">
              <div className="flex items-center gap-2 text-[#888]">
                <Calendar className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-mono">April 8\u201310, 2026</span>
              </div>
              <div className="flex items-center gap-2 text-[#888]">
                <MapPin className="w-4 h-4 text-[#E040FB]" />
                <span className="text-sm font-mono">Orange County Convention Center \u2014 Orlando, FL</span>
              </div>
            </div>

            <Badge className="bg-cyan-500/10 border-cyan-500/30 text-cyan-400 px-4 py-1.5 text-sm font-mono mb-8">
              Booth [TBD]
            </Badge>

            <div className="flex flex-col items-center gap-3 mt-6">
              <a
                href="https://designproai.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors font-mono"
              >
                restyleproai.com
              </a>
              <p className="text-xs text-[#444] font-mono">
                &copy; {new Date().getFullYear()} DesignProAI. All rights reserved.
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
