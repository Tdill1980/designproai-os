import { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, ChevronRight, Play, Pause, Home,
  Maximize, Minimize, Monitor, Smartphone,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────────────────
   SLIDE DATA — Each slide = one tool UI page SPROKET breaks down

   Replace placeholder images with actual tool UI screenshots:
     /public/screenshots/tool-colorpro.png
     /public/screenshots/tool-designpro.png
     etc.
   ───────────────────────────────────────────────────────────────────────────── */

interface ShowcaseSlide {
  id: string;
  title: string;
  titleGradient: string;
  sproketText: string;
  sproketImage: string;
  /** 16:9 landscape screenshot of the tool UI */
  image16x9: string;
  /** 9:16 portrait screenshot of the tool UI (mobile view) */
  image9x16: string;
  glowColor: string;
  badge?: string;
  features?: string[];
  /** Route to the actual tool page */
  route?: string;
}

const SLIDES: ShowcaseSlide[] = [
  {
    id: "intro",
    title: "DesignProAI™",
    titleGradient: "from-cyan-400 via-blue-400 to-purple-500",
    sproketText: "Welcome to the world's first prompt-to-production vehicle wrap design system. Let me walk you through every tool in the suite. Engineered using 10+ years of real vehicle wrap design order data.",
    sproketImage: "/characters/sproket/sproket-presenting.png",
    image16x9: "/screenshots/designproai-system.png",
    image9x16: "/screenshots/designproai-system.png",
    glowColor: "cyan",
    badge: "THE PLATFORM",
    features: [
      "AI-powered wrap design & visualization",
      "7 camera angles per render",
      "Print-ready production files",
      "Built for wrap professionals",
    ],
  },
  {
    id: "colorpro",
    title: "ColorPro™",
    titleGradient: "from-blue-400 via-blue-500 to-cyan-500",
    sproketText: "This is ColorPro — your color visualization powerhouse. Browse verified manufacturer vinyl libraries from 3M 2080, Avery SW900, Hexis, KPMF, Inozetek, and more. Every color calibrated with LAB values and reflectivity profiles. Pick a color, pick a vehicle, see it rendered in seconds.",
    sproketImage: "/characters/sproket/sproket-camera.png",
    image16x9: "/inkfusion/celestial-aqua-hero.png",
    image9x16: "/inkfusion/celestial-aqua-hero.png",
    glowColor: "blue",
    badge: "COLOR TOOL",
    route: "/colorpro",
    features: [
      "6+ manufacturer vinyl libraries",
      "LAB color-calibrated accuracy",
      "Gloss, matte, satin, chrome, metallic",
      "Upload custom swatches",
    ],
  },
  {
    id: "designpro",
    title: "DesignProAI™",
    titleGradient: "from-purple-400 via-pink-500 to-red-500",
    sproketText: "This is where the magic happens. DesignProAI is your AI design workspace. Describe your vision in plain English — ACE generates photorealistic wrap renders trained on thousands of real wrap jobs. Upload a reference with VisionBoard or let ACE freestyle. Every design is unique and yours.",
    sproketImage: "/characters/sproket/sproket-designmasterpiece.png",
    image16x9: "/screenshots/designproai-system.png",
    image9x16: "/screenshots/designproai-system.png",
    glowColor: "purple",
    badge: "CORE TOOL",
    route: "/designpro",
    features: [
      "Natural language wrap design",
      "VisionBoard™ reference image upload",
      "7 photorealistic camera angles",
      "DesignIQ™ trained on real wrap data",
    ],
  },
  {
    id: "fadewraps",
    title: "FadeWraps™",
    titleGradient: "from-orange-400 via-red-500 to-pink-500",
    sproketText: "FadeWraps creates stunning gradient and fade effects that flow across the vehicle body. Pick your colors, choose a fade style — standard, cross-fade, tri-tone — and watch it render with photorealistic depth. Each design comes with panel kits for easy installation.",
    sproketImage: "/characters/sproket/sproket-pencil.png",
    image16x9: "/screenshots/closeup-render.png",
    image9x16: "/screenshots/closeup-render.png",
    glowColor: "orange",
    badge: "DESIGN TOOL",
    route: "/fadewraps",
    features: [
      "Multiple fade styles & directions",
      "Two-tone and tri-tone gradients",
      "Panel kits for installation",
      "Accurate material pricing",
    ],
  },
  {
    id: "approvepro",
    title: "ApprovePro™",
    titleGradient: "from-indigo-400 via-purple-500 to-pink-500",
    sproketText: "Got a 2D design proof from your client? Upload it and watch it come alive on any vehicle in seconds. Same vehicle, new vehicle, any vehicle. Turn flat artwork into photorealistic 3D renders for instant client approval. Professional proof sheets generated automatically.",
    sproketImage: "/characters/sproket/sproket-clipboard.png",
    image16x9: "/screenshots/production-proof.png",
    image9x16: "/screenshots/production-proof.png",
    glowColor: "indigo",
    badge: "APPROVAL TOOL",
    route: "/approvemode",
    features: [
      "Upload 2D design proof → 3D render",
      "Any vehicle, any angle",
      "Professional proof sheet generation",
      "Client approval workflow",
    ],
  },
  {
    id: "graphicspro",
    title: "GraphicsPro™",
    titleGradient: "from-emerald-400 via-teal-500 to-cyan-500",
    sproketText: "GraphicsPro lets you design complex multi-zone wraps using natural language. Two-tone color splits, racing stripes, chrome deletes, accent packages — just describe what you want. Perfect for fleet branding and commercial vehicle graphics.",
    sproketImage: "/characters/sproket/sproket-worlds-first.png",
    image16x9: "/screenshots/porsche-distressed-hero.png",
    image9x16: "/screenshots/porsche-distressed-hero.png",
    glowColor: "emerald",
    badge: "GRAPHICS TOOL",
    route: "/graphicspro",
    features: [
      "Multi-zone wrap design",
      "Natural language descriptions",
      "Racing stripes & chrome deletes",
      "Fleet branding ready",
    ],
  },
  {
    id: "myvehiclepro",
    title: "MyVehiclePro™",
    titleGradient: "from-blue-400 via-blue-500 to-blue-600",
    sproketText: "Upload photos of YOUR actual vehicle — front, sides, rear, all angles — and see the wrap applied directly to your photos. AI sorts photos by camera angle automatically. Show customers exactly what their car will look like. Not a stock render — their actual vehicle.",
    sproketImage: "/characters/sproket/sproket-phone.png",
    image16x9: "/screenshots/closeup-render.png",
    image9x16: "/screenshots/closeup-render.png",
    glowColor: "blue",
    badge: "PHOTO EDIT",
    route: "/colorpro",
    features: [
      "Upload real vehicle photos",
      "AI auto-sorts by camera angle",
      "Wrap applied to YOUR vehicle",
      "Before / after comparison",
    ],
  },
  {
    id: "revision",
    title: "RevisionStudioIQ™",
    titleGradient: "from-violet-400 via-purple-500 to-indigo-500",
    sproketText: "Your personal design gallery and revision workspace. Rate renders, star your favorites, request revisions with natural language. Clone any design and tweak it — swap colors, change finishes, try different vehicles. Build a library that's uniquely yours.",
    sproketImage: "/characters/sproket/sproket-revision.png",
    image16x9: "/screenshots/revisionstudio-render.png",
    image9x16: "/screenshots/revisionstudio-render.png",
    glowColor: "violet",
    badge: "REVISION TOOL",
    route: "/revisionstudio",
    features: [
      "Clone & revise any design",
      "5-star rating system",
      "Natural language revision requests",
      "Version history tracking",
    ],
  },
  {
    id: "panelizer",
    title: "Universal Panelizer™",
    titleGradient: "from-amber-400 via-orange-500 to-red-500",
    sproketText: "From render to print-ready panels — automatically. GENIE panelizes your designs, runs quality control, and packages everything at 150 DPI for your printer. No manual panel work required. When all panels glow green, it's production ready.",
    sproketImage: "/characters/sproket/sproket-launch.png",
    image16x9: "/screenshots/productionflow-panelizer.png",
    image9x16: "/screenshots/productionflow-panelizer.png",
    glowColor: "amber",
    badge: "PRODUCTION",
    features: [
      "Automatic panel extraction",
      "150 DPI print-ready output",
      "Built-in quality control",
      "Full bleed & crop marks",
    ],
  },
  {
    id: "productionflow",
    title: "ProductionFlow™",
    titleGradient: "from-green-400 via-emerald-500 to-teal-500",
    sproketText: "The complete automated production pipeline. Panelizing, optimizing, quality check, packaging, element detection, admin QC — all in one flow. From concept to print-ready in minutes, not hours. This is the system that turns a prompt into production files.",
    sproketImage: "/characters/sproket/sproket-success.png",
    image16x9: "/screenshots/productionflow-system.png",
    image9x16: "/screenshots/productionflow-system.png",
    glowColor: "green",
    badge: "PIPELINE",
    features: [
      "End-to-end automation",
      "Multi-stage quality checks",
      "Production packaging",
      "Concept to print in minutes",
    ],
  },
  {
    id: "closing",
    title: "Design. Output. Profit.",
    titleGradient: "from-cyan-400 via-purple-500 to-pink-500",
    sproketText: "That's DesignProAI — the complete vehicle wrap design system built for professionals. Every tool works together. Every render is production-ready. Your designs. Your IP. Your profit. Welcome to the future of vehicle wrap design.",
    sproketImage: "/characters/sproket/sproket-rocket-launch.png",
    image16x9: "/screenshots/designproai-system.png",
    image9x16: "/screenshots/designproai-system.png",
    glowColor: "cyan",
    badge: "RESTYLEPROAI™",
    features: [
      "All tools in one platform",
      "Built by wrap professionals",
      "Your designs = your IP",
      "DesignVault™ + CreatorMarket™ coming soon",
    ],
  },
];

/* ─────────────────────────────────────────────────────────────────────────────
   GLOW MAP
   ───────────────────────────────────────────────────────────────────────────── */
const GLOW: Record<string, { ring: string; shadow: string; bg: string }> = {
  cyan:    { ring: "ring-cyan-500/60",    shadow: "shadow-[0_0_60px_rgba(6,182,212,0.3)]",    bg: "bg-cyan-500/10" },
  purple:  { ring: "ring-purple-500/60",  shadow: "shadow-[0_0_60px_rgba(168,85,247,0.3)]",  bg: "bg-purple-500/10" },
  blue:    { ring: "ring-blue-500/60",    shadow: "shadow-[0_0_60px_rgba(59,130,246,0.3)]",   bg: "bg-blue-500/10" },
  orange:  { ring: "ring-orange-500/60",  shadow: "shadow-[0_0_60px_rgba(249,115,22,0.3)]",  bg: "bg-orange-500/10" },
  indigo:  { ring: "ring-indigo-500/60",  shadow: "shadow-[0_0_60px_rgba(99,102,241,0.3)]",  bg: "bg-indigo-500/10" },
  emerald: { ring: "ring-emerald-500/60", shadow: "shadow-[0_0_60px_rgba(16,185,129,0.3)]",  bg: "bg-emerald-500/10" },
  violet:  { ring: "ring-violet-500/60",  shadow: "shadow-[0_0_60px_rgba(139,92,246,0.3)]",  bg: "bg-violet-500/10" },
  amber:   { ring: "ring-amber-500/60",   shadow: "shadow-[0_0_60px_rgba(245,158,11,0.3)]",  bg: "bg-amber-500/10" },
  green:   { ring: "ring-green-500/60",   shadow: "shadow-[0_0_60px_rgba(34,197,94,0.3)]",   bg: "bg-green-500/10" },
};

/* ─────────────────────────────────────────────────────────────────────────────
   COMPONENT
   ───────────────────────────────────────────────────────────────────────────── */
const Showcase = () => {
  const [slideIdx, setSlideIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [typewriterDone, setTypewriterDone] = useState(false);
  const [featuresVisible, setFeaturesVisible] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** "landscape" = 16:9 (desktop/TV), "portrait" = 9:16 (phone) */
  const [aspectMode, setAspectMode] = useState<"landscape" | "portrait">("landscape");

  const slide = SLIDES[slideIdx];
  const glow = GLOW[slide.glowColor] || GLOW.cyan;
  const currentImage = aspectMode === "portrait" ? slide.image9x16 : slide.image16x9;

  // Reset typewriter on slide change
  useEffect(() => {
    setCharIdx(0);
    setTypewriterDone(false);
    setFeaturesVisible(false);
  }, [slideIdx]);

  // Typewriter effect
  useEffect(() => {
    if (typewriterDone) {
      const timer = setTimeout(() => setFeaturesVisible(true), 300);
      return () => clearTimeout(timer);
    }
    if (charIdx >= slide.sproketText.length) {
      setTypewriterDone(true);
      return;
    }
    const ch = slide.sproketText[charIdx];
    const delay = ch === " " ? 15 : ch === "." || ch === "—" ? 80 : 22;
    const timer = setTimeout(() => setCharIdx((prev) => prev + 1), delay);
    return () => clearTimeout(timer);
  }, [charIdx, typewriterDone, slide.sproketText]);

  // Auto-advance after typewriter + pause
  useEffect(() => {
    if (!autoPlay || !typewriterDone) return;
    const timer = setTimeout(() => {
      if (slideIdx < SLIDES.length - 1) setSlideIdx((i) => i + 1);
      else setAutoPlay(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, [autoPlay, typewriterDone, slideIdx]);

  const goNext = useCallback(() => {
    if (slideIdx < SLIDES.length - 1) setSlideIdx((i) => i + 1);
  }, [slideIdx]);

  const goPrev = useCallback(() => {
    if (slideIdx > 0) setSlideIdx((i) => i - 1);
  }, [slideIdx]);

  // Keyboard: arrows, space, F for fullscreen, escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); goNext(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      if (e.key === "Escape") { document.exitFullscreen?.(); setIsFullscreen(false); }
      if (e.key === "f" || e.key === "F") {
        if (!document.fullscreenElement) { document.documentElement.requestFullscreen?.(); setIsFullscreen(true); }
        else { document.exitFullscreen?.(); setIsFullscreen(false); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) { document.documentElement.requestFullscreen?.(); setIsFullscreen(true); }
    else { document.exitFullscreen?.(); setIsFullscreen(false); }
  };

  /* ──────────────────────────── PORTRAIT LAYOUT (9:16) ──────────────────── */
  if (aspectMode === "portrait") {
    return (
      <>
        <Helmet><title>DesignProAI Showcase</title></Helmet>
        <div className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden select-none">
          {/* Top bar */}
          <div className="flex items-center justify-between px-3 py-2 bg-zinc-950/80 backdrop-blur border-b border-white/5 shrink-0">
            <div className="flex items-center gap-2">
              <Link to="/"><Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white h-7 px-2"><Home className="w-3.5 h-3.5" /></Button></Link>
              <span className="text-xs font-bold">
                <span className="text-white">Restyle</span>
                <span className="bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">ProAI</span>
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setAspectMode("landscape")} className="text-zinc-400 h-7 px-2">
                <Monitor className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAutoPlay(!autoPlay)} className={cn("h-7 px-2", autoPlay ? "text-cyan-400" : "text-zinc-400")}>
                {autoPlay ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </Button>
              <span className="text-[10px] text-zinc-500 tabular-nums">{slideIdx + 1}/{SLIDES.length}</span>
            </div>
          </div>

          {/* Main content — stacked vertically for portrait */}
          <div className="flex-1 flex flex-col overflow-y-auto px-3 py-4 gap-4">
            {/* Title */}
            <div className="text-center">
              {slide.badge && (
                <Badge className={cn("text-[9px] tracking-widest font-bold border-0 mb-2", glow.bg, "text-white/90")}>
                  {slide.badge}
                </Badge>
              )}
              <h2 key={`t-${slide.id}`} className="text-2xl font-bold animate-in fade-in duration-500">
                <span className={cn("bg-gradient-to-r bg-clip-text text-transparent", slide.titleGradient)}>
                  {slide.title}
                </span>
              </h2>
            </div>

            {/* Image with glow — portrait-optimized */}
            <div className="relative mx-auto w-full max-w-sm">
              <div className={cn("absolute -inset-3 rounded-2xl opacity-50 blur-xl", glow.bg, typewriterDone && "animate-pulse")} />
              <div className={cn("relative rounded-xl overflow-hidden ring-2", glow.ring, glow.shadow)}>
                <img
                  key={slide.id}
                  src={currentImage}
                  alt={slide.title}
                  className="w-full aspect-[9/16] object-cover animate-in fade-in zoom-in-95 duration-700"
                />
              </div>
            </div>

            {/* SPROKET + text */}
            <div className="flex items-start gap-2">
              <img
                key={`sp-${slide.id}`}
                src={slide.sproketImage}
                alt="SPROKET"
                className="w-16 h-16 object-contain shrink-0 animate-in fade-in slide-in-from-left-4 duration-500"
              />
              <div className="relative flex-1 rounded-lg px-3 py-2 border border-white/5 bg-white/[0.03]">
                <div className="absolute -left-1.5 top-4 w-0 h-0 border-t-[5px] border-t-transparent border-r-[6px] border-r-white/10 border-b-[5px] border-b-transparent" />
                <p className="text-xs text-white/80 leading-relaxed">
                  {slide.sproketText.slice(0, charIdx)}
                  {!typewriterDone && <span className="inline-block w-0.5 h-[1em] bg-cyan-400 ml-0.5 animate-pulse align-text-bottom" />}
                </p>
              </div>
            </div>

            {/* Features */}
            {slide.features && (
              <div className={cn("grid grid-cols-1 gap-1.5 transition-all duration-700", featuresVisible ? "opacity-100" : "opacity-0 translate-y-3")}>
                {slide.features.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-white/60">
                    <span className={cn("mt-1 w-1.5 h-1.5 rounded-full shrink-0 bg-gradient-to-r", slide.titleGradient)} />
                    {f}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bottom nav */}
          <div className="shrink-0 bg-zinc-950/80 border-t border-white/5 px-3 py-2">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={goPrev} disabled={slideIdx === 0} className="text-zinc-400 h-7 px-2">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="flex gap-1">
                {SLIDES.map((s, idx) => (
                  <button
                    key={s.id}
                    onClick={() => setSlideIdx(idx)}
                    className={cn("h-1 rounded-full transition-all", idx === slideIdx ? cn("w-5", `bg-gradient-to-r ${slide.titleGradient}`) : "w-1 bg-white/20")}
                  />
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={goNext} disabled={slideIdx === SLIDES.length - 1} className="text-zinc-400 h-7 px-2">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ──────────────────────────── LANDSCAPE LAYOUT (16:9) ─────────────────── */
  return (
    <>
      <Helmet><title>DesignProAI Showcase</title></Helmet>
      <div className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden select-none">
        {/* ─── TOP BAR ─── */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-2.5 bg-zinc-950/80 backdrop-blur border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white gap-1.5">
                <Home className="w-4 h-4" />
                <span className="hidden sm:inline">Home</span>
              </Button>
            </Link>
            <div className="h-4 w-px bg-white/10" />
            <span className="text-sm font-bold">
              <span className="text-white">Restyle</span>
              <span className="bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">ProAI</span>
              <span className="text-white/40 text-xs ml-2">Showcase</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Aspect toggle */}
            <div className="flex items-center border border-white/10 rounded-md overflow-hidden">
              <button
                onClick={() => setAspectMode("landscape")}
                className={cn("px-2 py-1 flex items-center gap-1 text-[10px] transition-colors",
                  aspectMode === "landscape" ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                <Monitor className="w-3 h-3" /> 16:9
              </button>
              <button
                onClick={() => setAspectMode("portrait")}
                className={cn("px-2 py-1 flex items-center gap-1 text-[10px] transition-colors",
                  aspectMode === "portrait" ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                <Smartphone className="w-3 h-3" /> 9:16
              </button>
            </div>

            <Button variant="ghost" size="sm" onClick={() => setAutoPlay(!autoPlay)}
              className={cn("gap-1.5", autoPlay ? "text-cyan-400" : "text-zinc-400")}>
              {autoPlay ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{autoPlay ? "Pause" : "Auto"}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleFullscreen} className="text-zinc-400 hover:text-white">
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </Button>
            <span className="text-xs text-zinc-500 tabular-nums ml-1">{slideIdx + 1}/{SLIDES.length}</span>
          </div>
        </div>

        {/* ─── MAIN SLIDE ─── */}
        <div className="flex-1 flex flex-col lg:flex-row items-center justify-center gap-6 lg:gap-12 px-4 sm:px-8 lg:px-16 py-6 overflow-hidden">
          {/* LEFT: Tool UI image with glow */}
          <div className="relative w-full lg:w-[55%] max-w-3xl shrink-0">
            <div className={cn("absolute -inset-4 rounded-2xl opacity-60 blur-2xl transition-all duration-1000", glow.bg, typewriterDone ? "animate-pulse" : "opacity-30")} />
            <div className={cn("relative rounded-xl overflow-hidden ring-2 transition-all duration-700", glow.ring, glow.shadow)}>
              <img
                key={slide.id}
                src={currentImage}
                alt={slide.title}
                className="w-full aspect-video object-cover animate-in fade-in zoom-in-95 duration-700"
              />
              {slide.badge && (
                <Badge className={cn("absolute top-3 left-3 text-[10px] tracking-widest font-bold border-0", glow.bg, "text-white/90 backdrop-blur-sm")}>
                  {slide.badge}
                </Badge>
              )}
            </div>
          </div>

          {/* RIGHT: SPROKET breakdown */}
          <div className="w-full lg:w-[45%] flex flex-col items-start gap-4 min-w-0">
            {/* Title */}
            <h2 key={`title-${slide.id}`} className="text-3xl sm:text-4xl lg:text-5xl font-bold animate-in fade-in slide-in-from-right-4 duration-500">
              <span className={cn("bg-gradient-to-r bg-clip-text text-transparent", slide.titleGradient)}>
                {slide.title}
              </span>
            </h2>

            {/* SPROKET + speech bubble */}
            <div className="flex items-start gap-3 w-full">
              <img
                key={`sproket-${slide.id}`}
                src={slide.sproketImage}
                alt="SPROKET"
                className="w-20 h-20 sm:w-24 sm:h-24 lg:w-28 lg:h-28 object-contain shrink-0 animate-in fade-in slide-in-from-left-4 duration-500"
                style={{ filter: `drop-shadow(0 0 20px rgba(6,182,212,0.3))` }}
              />
              <div className={cn("relative flex-1 rounded-xl px-4 py-3 border transition-all duration-700 bg-white/[0.03] backdrop-blur-sm", typewriterDone ? "border-white/10" : "border-white/5")}>
                <div className="absolute -left-2 top-6 w-0 h-0 border-t-[6px] border-t-transparent border-r-[8px] border-r-white/10 border-b-[6px] border-b-transparent" />
                <p className="text-sm sm:text-base lg:text-lg text-white/80 leading-relaxed font-light">
                  {slide.sproketText.slice(0, charIdx)}
                  {!typewriterDone && <span className="inline-block w-0.5 h-[1em] bg-cyan-400 ml-0.5 animate-pulse align-text-bottom" />}
                </p>
              </div>
            </div>

            {/* Features — fade in after typewriter */}
            {slide.features && (
              <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-2 w-full pl-2 transition-all duration-700", featuresVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4")}>
                {slide.features.map((feat, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-white/60" style={{ transitionDelay: `${i * 100}ms` }}>
                    <span className={cn("mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 bg-gradient-to-r", slide.titleGradient)} />
                    {feat}
                  </div>
                ))}
              </div>
            )}

            {/* Try it link */}
            {slide.route && featuresVisible && (
              <Link to={slide.route} className="animate-in fade-in duration-500">
                <Button variant="outline" size="sm" className={cn("gap-1.5 border-white/10 text-white/60 hover:text-white hover:border-white/20")}>
                  Try {slide.title} <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* ─── BOTTOM NAV ─── */}
        <div className="shrink-0 bg-zinc-950/80 backdrop-blur border-t border-white/5 px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between max-w-6xl mx-auto">
            <Button variant="ghost" size="sm" onClick={goPrev} disabled={slideIdx === 0} className="text-zinc-400 hover:text-white gap-1.5">
              <ChevronLeft className="w-4 h-4" /><span className="hidden sm:inline">Prev</span>
            </Button>
            <div className="flex gap-1.5 sm:gap-2">
              {SLIDES.map((s, idx) => (
                <button
                  key={s.id}
                  onClick={() => setSlideIdx(idx)}
                  className={cn("h-1.5 rounded-full transition-all duration-300",
                    idx === slideIdx ? cn("w-6 sm:w-8", `bg-gradient-to-r ${slide.titleGradient}`) : "w-1.5 bg-white/20 hover:bg-white/40"
                  )}
                  aria-label={`Go to ${s.title}`}
                />
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={goNext} disabled={slideIdx === SLIDES.length - 1} className="text-zinc-400 hover:text-white gap-1.5">
              <span className="hidden sm:inline">Next</span><ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default Showcase;
