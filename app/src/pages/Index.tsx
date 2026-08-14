import { useEffect, useState, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { Palette, Image, Eye, Layers, Sparkles, Car, ClipboardSignature, FileText, Camera, GitBranch, LayoutDashboard, Package, Store, Zap, ArrowRight, Quote, Lightbulb, Printer, Shield, Wand2, Brain, CheckCircle2, Bell, Calculator, MessageCircleQuestion } from "lucide-react";
import { DynamicRenderSlider } from "@/components/DynamicRenderSlider";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";


const uspFeatures = [
  {
    name: 'DesignIQ™',
    sectionKey: 'feature-designiq',
    tagline: 'AI that understands vehicle wraps.',
    description: 'DesignIQ™ was built on real commercial wrap production — not generic AI. It understands vinyl materials, body lines, panel geometry, and print-ready output. Every render is photorealistic, material-accurate, and production-aware from day one.',
    icon: Brain,
    gradient: 'from-[#8B5CF6] via-[#6366F1] to-[#3B82F6]',
    badge: 'Render Engine',
    badgeColor: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    useCase: 'WePrintWraps.com Use Case: "We replaced our $975 custom design fee with DesignIQ™ renders at $300. The AI output matched what our human designers produced — because it was built on real wrap production workflows."'
  },
  {
    name: 'VisionBoardIQ™',
    sectionKey: 'feature-visionboardiq',
    tagline: 'Upload reference images to guide AI - your vision, every time',
    description: 'Upload inspiration photos, competitor designs, or brand assets. Tag them as "Style Inspiration" or "Exact Reference" - the AI uses your vision to guide every design, ensuring the output matches your creative direction. This is the feature that makes DesignProAI™ truly unique.',
    icon: Lightbulb,
    gradient: 'from-[#60A5FA] via-[#5570F6] to-[#D946EF]',
    badge: 'Key Feature',
    badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    useCase: 'WePrintWraps.com Use Case: "Clients send us Pinterest boards and Instagram screenshots. We upload them to VisionBoardIQ and the AI nails their aesthetic on the first try."'
  },
  {
    name: 'Prompt-Based Wrap Designer',
    sectionKey: 'feature-prompt-designer',
    tagline: 'Every design is unique and creative',
    description: 'Describe what you want in plain English - our AI generates one-of-a-kind vehicle wrap designs that have never existed before. No templates, no cookie-cutter results. Every output is engineered to be original.',
    icon: Wand2,
    gradient: 'from-[#60A5FA] to-[#D946EF]',
    badge: 'Core Engine',
    badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    useCase: 'WePrintWraps.com Use Case: "We prompt full vehicle designs for client presentations in minutes - what used to take our designers 3-7 days per concept."'
  },
  {
    name: 'RevisionStudioIQ™',
    sectionKey: 'feature-revisionstudioiq',
    tagline: 'Never lose a design - every version is an asset',
    description: 'Full version timeline with Clone & Revise workflow. V1 → V2 → V3 - originals are never destroyed. Design Equity gallery treats every variation as a sellable asset. 200+ AI prompt presets for batch revisions.',
    icon: GitBranch,
    href: '/revision-studio',
    gradient: 'from-blue-400 via-blue-600 to-indigo-600',
    badge: 'Anchor Tool',
    badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    useCase: 'WePrintWraps.com Use Case: "We clone a popular Mustang design and revise it for Charger, Camaro, and Hellcat - each version sells independently. One design becomes four revenue streams."'
  },
  {
    name: 'UniversalPanelizer™',
    sectionKey: 'feature-universalpanelizer',
    tagline: '150 DPI print-ready production files',
    description: 'Our 7-stage AI production pipeline outputs print-ready panel files at 150 DPI - the exact specification professional wrap printers require. Full bleed, crop marks, and panel mapping included.',
    icon: Printer,
    gradient: 'from-blue-400 via-indigo-500 to-fuchsia-600',
    badge: 'Production',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    useCase: 'WePrintWraps.com Use Case: "We RIP the Panelizer output directly to our Roland TrueVIS printers. Zero manual file prep. Design to print in under 30 minutes."'
  },
  {
    name: 'DesignVault',
    sectionKey: 'feature-designvault',
    tagline: 'Your entire design library, organized',
    description: 'Every render, revision, and panel pack is automatically saved and organized. Search by vehicle, color, design style, or client. Your design portfolio grows with every project.',
    icon: Shield,
    gradient: 'from-blue-400 via-blue-500 to-indigo-600',
    badge: 'Included',
    badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    useCase: 'WePrintWraps.com Use Case: "We have 2,000+ designs in our vault. When a client says \'I want something like that Bronco you did\' - we find it in seconds and clone it for their vehicle."'
  },
  {
    name: 'WrapBox',
    sectionKey: 'feature-wrapbox',
    tagline: 'Store, parse, tag, and deliver entire wrap projects',
    description: 'WrapBox stores all project files and automatically parses info - design type (ReStyle or Commercial), vehicle specs, film data, and production specs. Tag with order numbers, client names, or custom labels. One shareable link with everything your printer or installer needs.',
    icon: Package,
    gradient: 'from-sky-400 via-blue-500 to-indigo-600',
    badge: 'Coming Soon',
    badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    useCase: 'WePrintWraps.com Use Case: "We tag every WrapBox with the order number and client name. When the installer asks \'where are the files for the Johnson Bronco?\' - we search by name and send the link. All renders, panels, proofs, and specs in one place."'
  },
  {
    name: 'CreatorMarket',
    sectionKey: 'feature-creatormarket',
    tagline: 'Sell your designs to the community',
    description: 'Turn your original wrap designs into passive income. List panel packs, design templates, and custom collections on the CreatorMarket. Other shops buy and apply them to their clients\' vehicles.',
    icon: Store,
    gradient: 'from-blue-400 via-indigo-500 to-blue-700',
    badge: 'Coming Soon',
    badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    useCase: 'WePrintWraps.com Use Case: "We plan to list our most popular fleet designs. Shops across the country can license them instead of designing from scratch - we earn while they save time."'
  }
];

const SYSTEM_SLIDES = [
  {
    image: "/screenshots/designproai-system.png",
    label: "DesignProAI™",
    desc: "Your AI design workspace. Describe your vision, pick a vehicle, and watch ACE generate photorealistic wrap renders in seconds. Like having a graphic designer at your fingertips.",
  },
  {
    image: "/screenshots/revisionstudio-render.png",
    label: "RevisionStudioIQ™",
    desc: "Your personal design gallery. Rate renders, star your favorites, request revisions with natural language, and build a library of designs that's uniquely yours.",
  },
  {
    image: "/screenshots/closeup-render.png",
    label: "True Photorealism",
    desc: "See the depth and texture of wrap vinyl in every render. Light catches the surface, shadows fall naturally, finishes look real. Matte, gloss, satin, chrome — all rendered with studio-quality lighting across 7 camera angles.",
  },
  {
    image: "/screenshots/productionflow-panelizer.png",
    label: "Universal Panelizer™",
    desc: "From render to print-ready panels. GENIE automatically panelizes your designs, runs quality control, and packages everything for your printer. No manual panel work required.",
  },
  {
    image: "/screenshots/productionflow-system.png",
    label: "ProductionFlow™",
    desc: "The complete production pipeline. Panelizing, optimizing, quality check, packaging, element detection, admin QC — all automated. When all panels glow, it's a go.",
  },
  {
    image: "/screenshots/production-proof.png",
    label: "Design Approval Proof",
    desc: "Professional proof sheets generated automatically. 6 camera angles, vehicle and film info, customer approval section. Designed and engineered using 10+ years of real vehicle wrap design order data.",
  },
];

const MeetYourSystemSection = () => {
  const [slideIdx, setSlideIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setSlideIdx(prev => (prev + 1) % SYSTEM_SLIDES.length);
    }, 7000);
    return () => clearInterval(timer);
  }, []);

  const slide = SYSTEM_SLIDES[slideIdx];

  return (
    <section className="relative border-t border-white/10">
      <div className="absolute inset-0 bg-black" />
      <div className="absolute top-0 left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
      <div className="relative container mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
        {/* Title with SPROKET laptop inline */}
        <div className="max-w-5xl mx-auto text-center space-y-1 mb-6">
          <p className="text-[11px] tracking-[5px] uppercase text-cyan-400/80 font-semibold">The Platform</p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white font-poppins flex items-center justify-center gap-2 flex-wrap">
            <img src="/characters/sproket/sproket-laptop.png" alt="SPROKET" className="w-8 h-8 sm:w-12 sm:h-12 md:w-20 md:h-20 object-contain inline-block" loading="lazy" />
            Meet Your New <span className="text-gradient-blue-subtle">Vehicle Wrap Design System</span>
          </h2>
          <p className="text-base sm:text-lg text-white/60 max-w-2xl mx-auto">
            It's like having a graphic designer at your fingertips
          </p>
        </div>

        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8 items-center min-h-[300px] sm:min-h-[350px]">
            {/* LEFT: Screenshot */}
            <div className="flex items-center justify-center overflow-hidden">
              <img
                key={slideIdx}
                src={slide.image}
                alt={slide.label}
                className="w-full rounded-xl border border-white/10 shadow-lg shadow-cyan-500/10 animate-sproket-slide-right"
                loading="lazy"
              />
            </div>

            {/* RIGHT: Label + description */}
            <div key={`text-${slideIdx}`} className="text-center md:text-left space-y-4 animate-sproket-slide-right">
              <h3 className="text-2xl sm:text-3xl font-bold text-white font-poppins">
                {slide.label}
              </h3>
              <p className="text-base sm:text-lg text-white/60 leading-relaxed">
                {slide.desc}
              </p>
            </div>
          </div>

          {/* Slide indicators */}
          <div className="flex justify-center gap-2 mt-8">
            {SYSTEM_SLIDES.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setSlideIdx(idx)}
                className={`slide-dot h-2 rounded-full transition-all duration-300 ${
                  idx === slideIdx ? "bg-cyan-400 w-6" : "bg-white/20 w-2"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

const HERO_HEADLINES = [
  "The World's First Prompt to Production Vehicle Wrap Design System",
  "SkyRocket Your Vehicle Wrap Designs",
  "Out of This World Premium Vehicle Wrap Designs",
];

const HeroHeadlineRotator = () => {
  const [index, setIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [done, setDone] = useState(false);

  // Rotate every 5s
  useEffect(() => {
    const timer = setInterval(() => {
      setIndex(prev => (prev + 1) % HERO_HEADLINES.length);
      setCharIndex(0);
      setDone(false);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Typewriter
  const text = HERO_HEADLINES[index];
  useEffect(() => {
    if (done) return;
    if (charIndex >= text.length) { setDone(true); return; }
    const t = setTimeout(() => setCharIndex(prev => prev + 1), 28);
    return () => clearTimeout(t);
  }, [charIndex, done, text.length]);

  return (
    <h3 className="text-[28px] sm:text-[32px] font-bold text-white leading-snug min-h-[2.5em]">
      {text.slice(0, charIndex)}
      {!done && <span className="inline-block w-0.5 h-[0.9em] bg-cyan-400 ml-0.5 animate-pulse align-text-bottom" />}
    </h3>
  );
};

const Index = () => {
  const [fullscreenImage, setFullscreenImage] = useState<any | null>(null);
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthed(!!data?.session?.user);
    });
    const { data: { subscription: sub } } = supabase.auth.onAuthStateChange((_e, s) => {
      setIsAuthed(!!s?.user);
    });
    return () => sub.unsubscribe();
  }, []);

  // Fetch showcase images (exclude section images)
  const { data: showcaseImages } = useQuery({
    queryKey: ["homepage_showcase"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homepage_showcase")
        .select("*")
        .eq("is_active", true)
        .not("name", "like", "section:%")
        .order("sort_order", { ascending: true });

      if (error) {
        console.error("[homepage_showcase] query error:", error.message, error.code);
        throw error;
      }
      return data;
    },
  });

  // Fetch section-specific images (founder, feature cards)
  const { data: sectionImages } = useQuery({
    queryKey: ["homepage_section_images"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homepage_showcase")
        .select("*")
        .like("name", "section:%")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const sectionImageMap = useMemo(() => {
    const map: Record<string, string> = {};
    sectionImages?.forEach((img) => {
      const key = img.name.replace("section:", "");
      map[key] = img.image_url;
    });
    return map;
  }, [sectionImages]);

  return (
    <div className="min-h-screen flex flex-col bg-black">
      <Helmet>
        <title>DesignProAI - AI Vehicle Wrap Design Software | Prompt to Production</title>
        <meta name="description" content="Design vehicle wraps in 60 seconds with AI. The world's first prompt-to-production wrap platform. Generate photorealistic designs, get print-ready EPS files." />
        <link rel="canonical" href="https://designproai.com" />
        <meta property="og:title" content="DesignProAI - AI Vehicle Wrap Design Software" />
        <meta property="og:description" content="Design vehicle wraps in 60 seconds with AI. From prompt to print-ready EPS files. The game changed." />
        <meta property="og:url" content="https://designproai.com" />
        <meta property="og:image" content="https://designproai.com/hero-mustang.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="DesignProAI - AI Vehicle Wrap Design Software" />
        <meta name="twitter:description" content="Design vehicle wraps in 60 seconds. From prompt to print-ready production files." />
        <meta name="twitter:image" content="https://designproai.com/hero-mustang.jpg" />
      </Helmet>

      <main className="flex-1">
        {/* ========== HERO - ABOVE THE FOLD ========== */}
        <section className="relative overflow-hidden">
          {/* Pure black background with subtle blue-magenta radial glow */}
          <div className="absolute inset-0 bg-black" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(59,130,246,0.08)_0%,_transparent_50%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(168,85,247,0.06)_0%,_transparent_50%)]" />

          <div className="relative container mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 pb-12 sm:pb-16">
            <div className="grid lg:grid-cols-[50%_50%] gap-8 md:gap-12 lg:gap-16 items-start">
              {/* LEFT TEXT COLUMN */}
              <div className="space-y-5 order-2 lg:order-1">
                {/* Thin subtitle text */}
                <p className="text-[11px] sm:text-[13px] md:text-[15px] font-light tracking-[0.25em] sm:tracking-[0.35em] uppercase" style={{ fontFamily: 'Inter, sans-serif' }}>
                  <span className="text-gradient-blue-subtle">DesignProAI™</span><span className="text-white"> Design. Output. Profit.</span>
                </p>
                {/* Line 1: Hero headline */}
                <h3 className="text-[28px] sm:text-[32px] font-bold text-white leading-snug min-h-[2.5em]">
                  The World's First Prompt to Production Vehicle Wrap Design System
                </h3>

                {/* Line 2: DesignProAI™ - largest text, two-tone like logo */}
                <h2 className="text-[48px] sm:text-[56px] font-bold leading-none">
                  <span className="text-white">Design</span><span className="text-gradient-blue-subtle">ProAI™</span>
                </h2>

                {/* Line 3: Description */}
                <p className="text-[18px] sm:text-[20px] text-white/70 font-normal leading-relaxed max-w-lg">
                  Engineered using 10+ years of real vehicle wrap design order data. ACE, your custom AI wrap designer, thinks like a real vehicle wrap designer because he was trained that way!
                </p>

                {/* CTA buttons */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  {isAuthed ? (
                    <Button asChild size="lg" variant="gradient" className="text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6">
                      <Link to="/tools">
                        Explore Tools <ArrowRight className="w-5 h-5 ml-2" />
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild size="lg" variant="gradient" className="text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6">
                      <Link to="/signup">
                        Start Free — 3 Tokens <ArrowRight className="w-5 h-5 ml-2" />
                      </Link>
                    </Button>
                  )}
                  <Button asChild variant="outline" size="lg" className="border-white/20 text-white hover:bg-white/5 text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6">
                    <Link to={isAuthed ? "/gallery" : "/tools"}>
                      {isAuthed ? "View Gallery" : "Explore Tools"}
                    </Link>
                  </Button>
                  {/* Above-the-fold entry into the site-wide Questions / Instant
                      Answers widget (mounted in App.tsx). Dispatches the same
                      window event the floating button uses. */}
                  <Button
                    type="button"
                    onClick={() => window.dispatchEvent(new Event("restylepro:open-questions"))}
                    variant="outline"
                    size="lg"
                    className="border-white/20 text-white hover:bg-white/5 text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6"
                  >
                    <MessageCircleQuestion className="w-5 h-5 mr-2" /> Questions? Instant Answers
                  </Button>
                </div>
                {!isAuthed && (
                  <p className="text-xs text-white/40">
                    Free account · 3 design tokens ($75 value) · No card required
                  </p>
                )}

                {/* Tool names */}
                <p className="text-xs sm:text-sm text-white/40 flex flex-wrap gap-x-2 gap-y-1 pt-1">
                  <span>Seven photoreal views</span>
                  <span>•</span>
                  <span>2D Production Proof</span>
                  <span>•</span>
                  <span>Six Production Layers</span>
                  <span>•</span>
                  <span>Print-ready files</span>
                  <span>•</span>
                  <span>Wrap<span className="text-gradient-blue-subtle">Box™</span> delivery</span>
                </p>
              </div>

              {/* RIGHT CAROUSEL */}
              <div className="order-1 lg:order-2 min-w-0 max-w-full overflow-hidden">
                <DynamicRenderSlider />
              </div>
            </div>
          </div>
        </section>

        {/* ========== MEET YOUR NEW DESIGN SYSTEM ========== */}
        <MeetYourSystemSection />

        {/* ========== PRICING SECTION — COMING SOON ========== */}
        {/* v2 launching with new subscription + production-pack model.    */}
        {/* Old $79/$199/$399 tiers removed pending finalized pricing.     */}
        <section className="relative border-t border-white/10">
          <div className="absolute inset-0 bg-black" />
          <div className="absolute top-0 left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
          <div className="relative container mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
            <div className="max-w-5xl mx-auto text-center mb-10">
              <p className="text-[11px] tracking-[5px] uppercase text-cyan-400/80 font-semibold mb-2">Pricing</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-white font-poppins mb-3">
                Coming Soon
              </h2>
              <p className="text-white/60 max-w-xl mx-auto">
                We're finalizing v2 pricing with input from 15-year industry veterans. Be first in line when it launches.
              </p>
            </div>
            <div className="max-w-xl mx-auto">
              <Card className="relative bg-card border-cyan-500/30 ring-1 ring-cyan-500/10 p-8 sm:p-10 text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 bg-cyan-500/10">
                  <CheckCircle2 className="w-7 h-7 text-cyan-400" />
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-white mb-3">
                  Get notified the moment pricing goes live
                </h3>
                <p className="text-sm text-white/60 mb-6 max-w-sm mx-auto">
                  Subscription tiers + à-la-carte production packs. New model designed by working wrap shops, for working wrap shops.
                </p>
                <Link to="/pricing">
                  <Button className="w-full sm:w-auto px-8" variant="default">
                    Join the Waitlist
                  </Button>
                </Link>
              </Card>
            </div>
          </div>
        </section>

        {/* ========== FOUNDER SECTION ========== */}
        <section className="relative border-t border-white/10">
          <div className="absolute inset-0 bg-black" />
          {/* Subtle top divider */}
          <div className="absolute top-0 left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-[#00E5FF]/15 to-transparent" />
          <div className="relative container mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
            <div className="max-w-[1100px] mx-auto">

              {/* Main grid: Photo LEFT, Copy RIGHT */}
              <div className="grid md:grid-cols-[380px_1fr] gap-10 lg:gap-16 items-center">

                {/* LEFT: Founder photo */}
                <div className="relative flex items-center justify-center order-1">
                  <div className="absolute w-[300px] h-[300px] bg-[radial-gradient(circle,rgba(0,229,255,0.06)_0%,transparent_70%)] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
                  <div className="relative w-[300px] sm:w-[340px] rounded-lg border border-[#00E5FF]/10 overflow-hidden">
                    <img
                      src={sectionImageMap['founder'] || "/founder-trish-dill.jpg"}
                      alt="Trish Dill, Co-Founder of DesignProAI™"
                      className="w-full h-auto object-cover"
                      loading="lazy"
                    />
                    <div className="absolute bottom-0 left-0 right-0 h-[120px] bg-gradient-to-t from-black to-transparent pointer-events-none" />
                  </div>
                </div>

                {/* RIGHT: Copy */}
                <div className="order-2 space-y-0">

                  {/* Eyebrow */}
                  <p className="text-[11px] tracking-[5px] uppercase text-[#00E5FF]/80 mb-7 font-semibold">
                    Why I Built This
                  </p>

                  {/* Headline */}
                  <h2 className="text-[26px] sm:text-[28px] font-extrabold text-white leading-[1.35] mb-6">
                    If your designer is constantly behind - or you don't have one at all -{" "}
                    <span className="text-[#00E5FF]">I built this for you.</span>
                  </h2>

                  {/* Paragraph 1 */}
                  <p className="text-base text-white/60 leading-[1.75] mb-5">
                    At WePrintWraps.com, we had to raise our custom wrap design price from{" "}
                    <span className="text-white/80 font-semibold">$500 to $975</span> just to keep up with the demand for custom wraps. I kept getting emails from my own friends in the industry fed up with our design turnaround and price increases. That told me everything - thousands of shops across the country all have the same problem.{" "}
                    <span className="text-white/80 font-semibold">Design is the bottleneck.</span>
                  </p>

                  {/* Paragraph 2 */}
                  <p className="text-base text-white/60 leading-[1.75] mb-5">
                    I realized I could build a system that gives you a{" "}
                    <span className="italic text-[#00E5FF]">designer at your fingertips.</span>{" "}
                    Because I've done every aspect of the printing industry - from FastSigns to wholesale - I knew exactly how to fix it.
                  </p>

                  {/* Paragraph 3 */}
                  <p className="text-base text-white/60 leading-[1.75] mb-5">
                    I built this system to solve my own problems at WePrintWraps.com but also for my friends and customers across the graphics industry. Whether you own a{" "}
                    <span className="text-white/80 font-semibold">sign company</span> or a{" "}
                    <span className="text-white/80 font-semibold">restyling shop</span>, DesignProAI is for you.
                  </p>

                  {/* Punchline - pull quote with cyan left border */}
                  <p className="text-lg font-bold text-white leading-[1.55] mt-2 pl-5 border-l-[3px] border-[#00E5FF]">
                    DesignProAI will{" "}
                    <span className="text-[#00E5FF]">10X your existing designer's output.</span>{" "}
                    And if you don't have a designer, you can finally{" "}
                    <span className="text-[#00FF88]">say goodbye to overpriced outsourcing.</span>
                  </p>

                  {/* Attribution */}
                  <div className="mt-8 flex flex-col gap-0.5">
                    <span className="font-bold text-[15px] text-white">- Trish Dill, Co-Founder</span>
                    <span className="text-xs text-white/40 tracking-wide">
                      DesignProAI™ & WePrintWraps.com
                    </span>
                  </div>

                </div>
              </div>

              {/* Tool pill bar */}
              <div className="flex justify-center gap-2 flex-wrap mt-10 sm:mt-14">
                {[
                  { name: "DesignProAI™", active: true },
                  { name: "Photoreal views" },
                  { name: "Revision Studio" },
                  { name: "2D Production Proof" },
                  { name: "Production Layers" },
                  { name: "PanelPro QC" },
                  { name: "WrapBox™" },
                ].map((tool) => (
                  <span
                    key={tool.name}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full border text-xs font-medium ${
                      tool.active
                        ? "border-[#00E5FF]/30 text-[#00E5FF] bg-[#00E5FF]/5"
                        : "border-white/10 text-white/50 bg-white/[0.02]"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00E5FF]" />
                    {tool.name}
                  </span>
                ))}
              </div>

            </div>
          </div>
        </section>

        {/* ========== USP DETAILED CALLOUTS ========== */}
        <section className="relative py-12 sm:py-16 lg:py-20 border-t border-white/10 overflow-hidden">
          <div className="absolute inset-0 bg-black" />
          <div className="relative container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-6xl mx-auto space-y-12">
              <div className="text-center space-y-3">
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold">
                  <span className="text-foreground">What Makes </span>
                  <span className="text-foreground">Design</span><span className="text-gradient-blue-subtle">ProAI™</span>
                  <span className="text-foreground"> Different</span>
                </h2>
                <p className="text-muted-foreground text-lg max-w-3xl mx-auto">
                  Built on real production workflows from WePrintWraps.com and powered by DesignIQ™ - a render engine built for the vehicle wrap industry
                </p>
              </div>

              <div className="space-y-6">
                {uspFeatures.map((item, index) => {
                  const Icon = item.icon;
                  const isEven = index % 2 === 0;

                  const card = (
                    <Card key={item.name} className="group relative overflow-hidden border-border hover:border-white/15 transition-all hover:shadow-[0_0_40px_rgba(255,255,255,0.05)]">
                      <div className={`absolute inset-0 bg-gradient-to-br ${item.gradient} opacity-0 group-hover:opacity-[0.03] transition-opacity`} />
                      <div className="relative p-6 sm:p-8">
                        <div className={`flex flex-col ${isEven ? 'lg:flex-row' : 'lg:flex-row-reverse'} gap-6 lg:gap-10`}>
                          {/* Content side */}
                          <div className="flex-1 space-y-4">
                            <div className="flex items-start gap-4">
                              <div className={`rounded-xl p-3 bg-gradient-to-br ${item.gradient} text-white shadow-lg flex-shrink-0`}>
                                <Icon className="w-7 h-7" />
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center gap-3 flex-wrap">
                                  <h3 className="text-xl sm:text-2xl font-bold text-foreground">
                                    {item.name}
                                  </h3>
                                  <Badge variant="outline" className={`${item.badgeColor} text-xs font-semibold`}>
                                    {item.badge}
                                  </Badge>
                                </div>
                                <p className="text-sm font-medium text-gradient-blue-subtle">
                                  {item.tagline}
                                </p>
                              </div>
                            </div>
                            <p className="text-base text-muted-foreground leading-relaxed">
                              {item.description}
                            </p>
                          </div>

                          {/* Use case side - with optional background image */}
                          <div className="lg:w-[45%] flex-shrink-0">
                            <div className="relative rounded-xl overflow-hidden h-full">
                              {/* Background image if uploaded */}
                              {sectionImageMap[item.sectionKey] && (
                                <div
                                  className="absolute inset-0 bg-cover bg-center"
                                  style={{ backgroundImage: `url(${sectionImageMap[item.sectionKey]})` }}
                                />
                              )}
                              {/* Dark overlay for readability */}
                              <div className={`relative ${sectionImageMap[item.sectionKey] ? 'bg-black/70 backdrop-blur-sm' : 'bg-card/60'} border border-border/50 rounded-xl p-5 h-full`}>
                                <div className="flex items-center gap-2 mb-3">
                                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                                  <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Real Production Use Case</span>
                                </div>
                                <p className="text-sm text-muted-foreground leading-relaxed italic">
                                  {item.useCase}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Card>
                  );

                  if (item.href) {
                    return <Link key={item.name} to={item.href}>{card}</Link>;
                  }
                  return <div key={item.name}>{card}</div>;
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ========== PRODUCTION PACK BREAKDOWN ========== */}
        <section className="relative py-12 sm:py-16 lg:py-20 border-t border-white/10 overflow-hidden">
          <div className="absolute inset-0 bg-black" />
          <div className="relative container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-6xl mx-auto space-y-10">
              <div className="text-center space-y-3">
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold">
                  <span className="text-foreground">What's In Your </span>
                  <span className="text-gradient-blue-subtle">Production Pack</span>
                </h2>
                <p className="text-muted-foreground text-lg max-w-3xl mx-auto">
                  Every design generates a complete production-ready deliverable package - the same output spec WePrintWraps.com uses to go from concept to printed wrap
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                {/* Pack Files */}
                <Card className="border-border overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-500/10 to-fuchsia-500/10 p-4 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-gradient-designpro text-white">
                        <Printer className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-foreground">Production Pack Files</h3>
                    </div>
                  </div>
                  <div className="p-5 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-2 flex-shrink-0" />
                      <div>
                        <p className="text-foreground font-semibold">Panel Layout Files</p>
                        <p className="text-sm text-muted-foreground">Individual panel PNGs at 150 DPI - hood, fenders, doors, bumpers, roof, trunk. Full bleed with crop marks.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-2 flex-shrink-0" />
                      <div>
                        <p className="text-foreground font-semibold">6-View Render Set</p>
                        <p className="text-sm text-muted-foreground">Driver side, passenger side, front, rear, top-down, and close-up detail views - all HD resolution.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-2 flex-shrink-0" />
                      <div>
                        <p className="text-foreground font-semibold">Hero Composite</p>
                        <p className="text-sm text-muted-foreground">Full vehicle render at maximum resolution for client presentations and social media.</p>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Production Proof */}
                <Card className="border-border overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-fuchsia-500/10 p-4 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-gradient-designpro text-white">
                        <ClipboardSignature className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-foreground">Production Proof</h3>
                    </div>
                  </div>
                  <div className="p-5 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />
                      <div>
                        <p className="text-foreground font-semibold">PDF Approval Sheet</p>
                        <p className="text-sm text-muted-foreground">Print-ready 16:9 layout with before/after comparison, dual signature lines (customer + shop rep), and vehicle identification.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />
                      <div>
                        <p className="text-foreground font-semibold">Film Documentation</p>
                        <p className="text-sm text-muted-foreground">Manufacturer, color name, product code, finish type, hex value, and material specs embedded in every proof.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />
                      <div>
                        <p className="text-foreground font-semibold">Vehicle Spec Card</p>
                        <p className="text-sm text-muted-foreground">Year, make, model, trim, and detected color - auto-parsed from AI analysis or manual entry.</p>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* File Specs */}
                <Card className="border-border overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-fuchsia-500/10 p-4 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-gradient-designpro text-white">
                        <FileText className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-foreground">File Specs</h3>
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-gradient-blue-subtle">150</p>
                        <p className="text-xs text-muted-foreground font-medium">DPI Resolution</p>
                      </div>
                      <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-gradient-blue-subtle">10%</p>
                        <p className="text-xs text-muted-foreground font-medium">Scale Factor</p>
                      </div>
                      <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-gradient-blue-subtle">PNG</p>
                        <p className="text-xs text-muted-foreground font-medium">Panel Format</p>
                      </div>
                      <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-gradient-blue-subtle">PDF</p>
                        <p className="text-xs text-muted-foreground font-medium">Proof Format</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3 text-center">
                      Output matches professional RIP software requirements - ready for Roland, Mimaki, HP Latex, and all major wide-format printers
                    </p>
                  </div>
                </Card>

                {/* WrapBox Storage */}
                <Card className="border-border overflow-hidden">
                  <div className="bg-gradient-to-r from-sky-500/10 via-blue-500/10 to-indigo-500/10 p-4 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 text-white">
                        <Package className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-foreground">WrapBox Storage & Tagging</h3>
                      <Badge variant="outline" className="bg-sky-500/20 text-sky-300 border-sky-500/30 text-xs">Coming Soon</Badge>
                    </div>
                  </div>
                  <div className="p-5 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-2 flex-shrink-0" />
                      <div>
                        <p className="text-foreground font-semibold">Auto-Parsed Metadata</p>
                        <p className="text-sm text-muted-foreground">WrapBox automatically extracts vehicle info, film specs, design type, and production data from every file.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-2 flex-shrink-0" />
                      <div>
                        <p className="text-foreground font-semibold">Design Type Classification</p>
                        <p className="text-sm text-muted-foreground">Every project is tagged as <span className="text-foreground font-medium">ReStyle</span> (color change, fade, pattern) or <span className="text-foreground font-medium">Commercial</span> (branded fleet, graphics, print wraps).</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-2 flex-shrink-0" />
                      <div>
                        <p className="text-foreground font-semibold">Custom Tags & Search</p>
                        <p className="text-sm text-muted-foreground">Add order numbers, client names, or any custom tag. Search your entire project library instantly - "Johnson Bronco" or "Order #4521".</p>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* ========== THE OPERATING PATH ========== */}
        {/* This was a six-card grid for the RestylePro suite -- ColorPro,
            DesignPanelPro, FadeWraps, PatternPro, ApprovePro, RestyleLibrary --
            every card linking to a route this system does not serve. It now
            describes what DesignProAI actually does, and each card opens a
            surface that exists. */}
        <section className="relative py-12 sm:py-16 lg:py-20 border-t border-white/10 overflow-hidden">
          <div className="absolute inset-0 bg-black" />
          <div className="relative container mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-3 sm:mb-4 text-foreground">
              <span className="text-foreground">Design</span><span className="text-gradient-blue-subtle">ProAI™</span> — brief to print-ready
            </h2>
            <p className="text-center text-muted-foreground text-lg mb-8 sm:mb-12 max-w-2xl mx-auto">
              One server-owned path from a written brief to verified production files
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                {
                  to: "/designpro/generate",
                  title: ["Seven photoreal ", "views"],
                  body: "Describe the wrap and the vehicle. The server generates seven distinct views — the passenger side is generated, never mirrored, so lettering and logos stay readable.",
                  icon: Sparkles,
                },
                {
                  to: "/designpro/jobs",
                  title: ["Revision ", "Studio"],
                  body: "Regenerate any single angle with an instruction. The old view is superseded, never overwritten, so anything already hashed downstream stays trustworthy.",
                  icon: Layers,
                },
                {
                  to: "/designpro/jobs",
                  title: ["2D Production ", "Proof"],
                  body: "The customer-facing proof, built from the approved flat wrap layout with GENIE trim sizes and total square footage.",
                  icon: Image,
                },
                {
                  to: "/designpro/jobs",
                  title: ["Six Production ", "Layers"],
                  body: "Deterministic per-side crops of the approved layout — driver, passenger, hood, roof, front and rear — each at five inches of bleed on all four edges.",
                  icon: Palette,
                },
                {
                  to: "/designpro/genie-qc",
                  title: ["PanelPro ", "QC"],
                  body: "Two human release gates and exact six-surface vehicle geometry. Nothing reaches print until an operator confirms every check.",
                  icon: Eye,
                },
                {
                  to: "/designpro/wrapbox",
                  title: ["Wrap", "Box™"],
                  body: "Eighteen verified production files — six surfaces in PNG, TIFF and EPS — delivered as one ZIP with immutable manifest hashes.",
                  icon: Package,
                },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <Link
                    key={card.title.join("")}
                    to={card.to}
                    className="group bg-card border border-border rounded-xl p-6 shadow-lg hover:scale-[1.02] hover:border-blue-500/40 hover:shadow-[0_0_20px_rgba(96,165,250,0.15)] transition-all duration-300 cursor-pointer relative overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-fuchsia-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-gradient-designpro text-white">
                          <Icon className="w-6 h-6" />
                        </div>
                        <h3 className="text-2xl font-bold">
                          <span className="text-foreground">{card.title[0]}</span>
                          <span className="text-gradient-blue-subtle">{card.title[1]}</span>
                        </h3>
                      </div>
                      <p className="text-muted-foreground text-base leading-relaxed">{card.body}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        {/* ========== PROFESSIONAL DELIVERABLES ========== */}
        <section className="relative py-12 sm:py-16 lg:py-20 border-t border-white/5 overflow-hidden">
          <div className="absolute inset-0 bg-black" />
          <div className="relative container mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl sm:text-4xl font-bold text-center mb-3 text-foreground">
              Every Design Includes{' '}
              <span className="text-gradient-blue-subtle">Professional Deliverables</span>
            </h2>
            <p className="text-center text-muted-foreground mb-8 max-w-2xl mx-auto">
              Not just renders - get everything you need for client approval and documentation
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              <div className="group bg-card border border-border rounded-xl p-6 text-center hover:border-blue-500/30 hover:shadow-[0_0_20px_rgba(96,165,250,0.1)] transition-all duration-300">
                <div className="w-14 h-14 rounded-xl bg-gradient-designpro mx-auto mb-4 flex items-center justify-center">
                  <Eye className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-bold text-xl mb-2 text-foreground">6 Vehicle Views</h3>
                <p className="text-muted-foreground">Driver Side, Passenger Side, Front, Rear, Top, and Detail views</p>
              </div>

              <div className="group bg-card border border-border rounded-xl p-6 text-center hover:border-blue-400/30 hover:shadow-[0_0_20px_rgba(56,189,248,0.1)] transition-all duration-300">
                <div className="w-14 h-14 rounded-xl bg-gradient-designpro mx-auto mb-4 flex items-center justify-center">
                  <ClipboardSignature className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-bold text-xl mb-2 text-foreground">Approval Proof Sheet</h3>
                <p className="text-muted-foreground">Print-ready 16:9 layout with dual signature lines (customer + shop rep)</p>
              </div>

              <div className="group bg-card border border-border rounded-xl p-6 text-center hover:border-fuchsia-500/30 hover:shadow-[0_0_20px_rgba(217,70,239,0.1)] transition-all duration-300">
                <div className="w-14 h-14 rounded-xl bg-gradient-designpro mx-auto mb-4 flex items-center justify-center">
                  <FileText className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-bold text-xl mb-2 text-foreground">Film Documentation</h3>
                <p className="text-muted-foreground">Manufacturer, color name, product code, finish type, and hex color</p>
              </div>
            </div>

            {/* PDF Proof Example Card */}
            <div className="mt-10 max-w-4xl mx-auto">
              <Card className="group relative overflow-hidden border-border hover:border-blue-500/30 transition-all hover:shadow-[0_0_40px_rgba(59,130,246,0.1)]">
                <div className="grid md:grid-cols-[1fr_1fr] gap-0">
                  {/* PDF Proof Image */}
                  <div className="relative aspect-video md:aspect-auto overflow-hidden">
                    <img
                      src={sectionImageMap['pdf-proof-example'] || "/pdf-proof-example.jpg"}
                      alt="PDF Approval Proof Sheet Example - DesignProAI"
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
                      loading="lazy"
                    />
                    <div className="absolute top-3 left-3 px-3 py-1 bg-blue-500/90 backdrop-blur-sm rounded-full">
                      <span className="text-xs font-bold text-white tracking-wide">PDF PROOF</span>
                    </div>
                  </div>
                  {/* PDF Info */}
                  <div className="p-6 sm:p-8 flex flex-col justify-center space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-gradient-designpro text-white">
                        <ClipboardSignature className="w-6 h-6" />
                      </div>
                      <h3 className="text-xl sm:text-2xl font-bold text-foreground">Client Approval Proof</h3>
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      Every design generates a professional PDF approval sheet - print-ready with before/after comparison, vehicle specs, film documentation, and dual signature lines for customer and shop rep sign-off.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
                        <p className="text-lg font-bold text-gradient-blue-subtle">16:9</p>
                        <p className="text-xs text-muted-foreground">Print Layout</p>
                      </div>
                      <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
                        <p className="text-lg font-bold text-gradient-blue-subtle">PDF</p>
                        <p className="text-xs text-muted-foreground">Ready to Print</p>
                      </div>
                      <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
                        <p className="text-lg font-bold text-gradient-blue-subtle">2x</p>
                        <p className="text-xs text-muted-foreground">Signature Lines</p>
                      </div>
                      <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
                        <p className="text-lg font-bold text-gradient-blue-subtle">Auto</p>
                        <p className="text-xs text-muted-foreground">Film Specs</p>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            <div className="text-center mt-8">
              <Button variant="outline" asChild className="border-white/15 hover:bg-white/5 hover:border-white/20">
                <Link to="/gallery">
                  See Example Proofs in Gallery
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* ========== SHOWCASE CAROUSEL ========== */}
        {showcaseImages && showcaseImages.length > 0 && (
          <section className="relative py-8 sm:py-12 lg:py-16 bg-black border-t border-border/30 overflow-hidden">
            <div className="relative container mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-6 sm:mb-8">
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-2 sm:mb-3 text-foreground">
                  Explore Your Wrap in <span className="text-foreground">Hyper-Realistic 3D</span>
                </h2>
                <p className="text-base sm:text-lg text-foreground italic">
                  Instant previews in dozens of premium finishes.
                </p>
              </div>

              <div className="flex flex-col md:flex-row items-center justify-center gap-4 sm:gap-6 lg:gap-8">
                {showcaseImages.map((showcase) => (
                  <div key={showcase.id} className="w-full md:w-auto flex-shrink-0 group touch-manipulation">
                    <div
                      className="rounded-xl sm:rounded-2xl shadow-xl transition-transform duration-300
                                 active:scale-95 md:hover:scale-[1.02] w-full
                                 md:w-[380px] lg:w-[420px] cursor-pointer"
                      onClick={() => setFullscreenImage(showcase)}
                    >
                      <img
                        src={showcase.image_url}
                        alt={showcase.alt_text}
                        className="w-full h-full object-cover rounded-xl sm:rounded-2xl"
                        loading="lazy"
                      />
                    </div>
                    <p className="text-center text-foreground font-bold mt-3 text-base sm:text-lg">{showcase.title}</p>
                  </div>
                ))}
              </div>

              <div className="text-center mt-6 sm:mt-8">
                <Button size="lg" variant="gradient" asChild className="text-base gap-2 h-12 sm:h-14 touch-manipulation">
                  <Link to="/tools">
                    <Sparkles className="w-5 h-5" />
                    Explore Design Tools
                  </Link>
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* ========== FAQ SECTION (AEO) ========== */}
        <section id="faq" className="relative py-16 sm:py-20 lg:py-24 border-t border-border/30">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl">
            <h2 className="text-3xl sm:text-4xl font-bold mb-10 text-center text-foreground">
              Frequently Asked Questions
            </h2>
            <div className="space-y-0">
              {[
                {
                  q: "What is DesignProAI?",
                  a: "DesignProAI is a complete Vehicle Wrap Design System — it's like having a custom vehicle wrap designer at your fingertips. From prompt to production. No designer. No outsourcing. No waiting."
                },
                {
                  q: "How fast can I design a vehicle wrap?",
                  a: "60 seconds. Describe what you want, and DesignProAI's AI generates a complete photorealistic wrap design across 7 views. The GENIE Panelizer then converts it to print-ready EPS files in minutes."
                },
                {
                  q: "What files do I get?",
                  a: "Production-ready EPS vector files at 10% scale with 0.5-inch bleed, sized to standard 59.5-inch wholesale vinyl roll widths. Files work with any RIP software or large-format printer. No post-processing needed."
                },
                {
                  q: "Do I need design experience?",
                  a: "No. DesignProAI replaces Adobe Illustrator and CorelDRAW for wrap design. Type a description of what you want, and AI handles the design, rendering, panelizing, and file output automatically."
                },
                {
                  q: "How many vehicles are supported?",
                  a: "Every major make and model is supported. Our system uses real vehicle dimensions for accurate panel sizing so your print files match exactly."
                },
                {
                  q: "Can I sell my wrap designs?",
                  a: "Yes. CreatorMarket lets you list and sell designs with an 80/20 revenue split in your favor. Every design includes PromptThumbprint\u2122 provenance and DesignID\u2122 ownership certification."
                },
                {
                  q: "What is the GENIE Panelizer?",
                  a: "The world's first prompt-to-production pipeline. GENIE takes AI-generated wrap renders and outputs flat, print-ready EPS panels at wholesale SKU dimensions. The installer trims to fit - files are production-ready out of the box."
                },
                {
                  q: "How is this different from other wrap visualizers?",
                  a: "DesignProAI is built on over 10 years of real vehicle wrap production experience. ACE, your dedicated AI designer inside DesignProAI, was engineered to think like a wrap designer — not just generate generic images. The entire system runs on our proprietary DesignIQ engine, trained on real wrap workflows. Other tools show color previews on 3D models. We generate original designs and output production-ready print files."
                }
              ].map((item, i) => (
                <details key={i} className="group border-b border-border/30">
                  <summary className="flex items-center justify-between py-5 cursor-pointer text-lg font-medium text-foreground hover:text-primary transition-colors list-none">
                    {item.q}
                    <span className="ml-4 text-muted-foreground group-open:rotate-45 transition-transform text-2xl leading-none">+</span>
                  </summary>
                  <p className="pb-5 text-muted-foreground leading-relaxed">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing section moved above Founder section */}
      </main>

      {/* Sproket Pre-Sale Nudge removed */}

      {/* Fullscreen Image Modal */}
      <Dialog open={!!fullscreenImage} onOpenChange={() => setFullscreenImage(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-black/95 border-none">
          <button
            onClick={() => setFullscreenImage(null)}
            className="absolute top-4 right-4 z-50 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          {fullscreenImage && (
            <img
              src={fullscreenImage.image_url}
              alt={fullscreenImage.alt_text}
              className="w-full h-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
