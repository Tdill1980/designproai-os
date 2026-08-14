import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X, Sparkles, Star, ChevronLeft, ChevronRight } from "lucide-react";

interface HeroSlide {
  id: string;
  image_url: string;
  title?: string;
  subtitle?: string;
  link?: string;
}

// Static fallback slides — shown when the hero_carousel table is empty
const FALLBACK_SLIDES: HeroSlide[] = [
  { id: "fallback-1", image_url: "/renders/zombie-rust-hero.png", title: "Zombie Rust" },
  { id: "fallback-2", image_url: "/inkfusion/celestial-aqua-hero.png", title: "Celestial Aqua" },
  { id: "fallback-3", image_url: "/screenshots/porsche-distressed-hero.png", title: "Porsche Distressed" },
  { id: "fallback-4", image_url: "/inkfusion/celestial-aqua-side.png", title: "Celestial Aqua Side" },
  { id: "fallback-5", image_url: "/inkfusion/supernova-coral-hood.png", title: "Supernova Coral" },
  { id: "fallback-6", image_url: "/inkfusion/wine-burgundy-rear.png", title: "Wine Burgundy" },
];

// SPROKET-branded USP headlines with matching poses
const USP_SLIDES = [
  { text: "AI-designed wraps. Photorealistic in seconds.", image: "/characters/sproket/sproket-presenting.png" },
  { text: "10,000+ renders trained DesignIQ.", image: "/characters/sproket/sproket-clipboard.png" },
  { text: "Every design is unique. DesignIQ was engineered using 10+ years of real wrap data.", image: "/characters/sproket/sproket-worlds-first.png" },
  { text: "Meet Your Crew. ACE is powered by DesignIQ & SPROKET is your systems guide.", image: "/characters/sproket/sproket-ace-duo.png" },
  { text: "Build DesignEquity. Your designs. Your IP.", image: "/characters/sproket/sproket-milestone.png" },
  { text: "DesignVault. QC'd by real designers. Stamped with your DesignID.", image: "/characters/sproket/sproket-vault.png" },
  { text: "Sell on CreatorMarket. You keep 60%, we drive the buyers.", image: "/characters/sproket/sproket-moneybag.png" },
  { text: "7 camera angles. 7 fresh takes.", image: "/characters/sproket/sproket-camera.png" },
  { text: "From concept to print-ready. One platform.", image: "/characters/sproket/sproket-launch.png" },
  { text: "Your design, print-ready in minutes.", image: "/characters/sproket/sproket-designmasterpiece.png" },
  { text: "RevisionStudio. Dial in every detail.", image: "/characters/sproket/sproket-revision.png" },
  { text: "Did you know? Use DesignProAI from your cell phone or desktop!", image: "/characters/sproket/sproket-phone.png" },
];

interface DynamicRenderSliderProps {
  intervalMs?: number;
}

export function DynamicRenderSlider({ intervalMs = 9000 }: DynamicRenderSliderProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [uspIndex, setUspIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [typewriterDone, setTypewriterDone] = useState(false);
  const [firstImageLoaded, setFirstImageLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Curated slides from hero_carousel table
  const { data: curatedSlides = [], isLoading, isError } = useQuery({
    queryKey: ["hero_carousel"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hero_carousel")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) {
        console.error("[hero_carousel] query error:", error.message, error.code);
        return [] as HeroSlide[];
      }

      // Hide rosette studio bakery slide
      return ((data || []) as HeroSlide[]).filter(
        (s) => !s.title?.toLowerCase().includes("rosette studio")
      );
    },
    retry: 1,
    staleTime: 60_000,
  });

  // Starred renders from color_visualizations (is_featured_hero = true)
  const { data: starredUrls = [] } = useQuery({
    queryKey: ["hero-starred-renders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("color_visualizations")
        .select("render_urls")
        .eq("is_featured_hero", true)
        .order("created_at", { ascending: false })
        .limit(12);

      if (error || !data?.length) return [];
      const urls: string[] = [];
      for (const row of data) {
        const renderUrls = row.render_urls as any;
        if (!renderUrls) continue;
        const url = renderUrls.side || renderUrls.front || renderUrls.hood_detail
          || renderUrls.rear || renderUrls.top || renderUrls.roof;
        if (url) urls.push(url);
      }
      return urls;
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  // Merge: curated first, then starred renders after — fall back to static images if both empty
  const slides = useMemo(() => {
    const starredSet = new Set(curatedSlides.map(s => s.image_url));
    const starred: HeroSlide[] = starredUrls
      .filter(url => !starredSet.has(url)) // don't duplicate curated
      .map((url, i) => ({
        id: `starred-${i}`,
        image_url: url,
      }));
    const merged = [...curatedSlides, ...starred];
    return merged.length > 0 ? merged : FALLBACK_SLIDES;
  }, [starredUrls, curatedSlides]);

  // Preload the next slide image so transitions are seamless
  useEffect(() => {
    if (slides.length <= 1) return;
    const nextIndex = (currentIndex + 1) % slides.length;
    const img = new window.Image();
    const url = slides[nextIndex].image_url;
    img.src = url;
  }, [slides, currentIndex]);

  // Auto-advance slides + rotate USP text
  useEffect(() => {
    if (slides.length <= 1) return;
    timerRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % slides.length);
      setUspIndex((prev) => (prev + 1) % USP_SLIDES.length);
      setCharIndex(0);
      setTypewriterDone(false);
    }, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [slides.length, intervalMs]);

  // Typewriter effect for USP headline
  const currentUsp = USP_SLIDES[uspIndex];
  useEffect(() => {
    if (typewriterDone) return;
    if (charIndex >= currentUsp.text.length) {
      setTypewriterDone(true);
      return;
    }
    const timer = setTimeout(() => setCharIndex(prev => prev + 1), 30);
    return () => clearTimeout(timer);
  }, [charIndex, typewriterDone, currentUsp.text.length]);

  // Manual navigation — go to specific slide and reset auto-advance timer
  const goToSlide = (index: number) => {
    setCurrentIndex(index);
    setUspIndex(index % USP_SLIDES.length);
    setCharIndex(0);
    setTypewriterDone(false);
    // Reset the auto-advance timer
    if (timerRef.current) clearInterval(timerRef.current);
    if (slides.length > 1) {
      timerRef.current = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % slides.length);
        setUspIndex((prev) => (prev + 1) % USP_SLIDES.length);
        setCharIndex(0);
        setTypewriterDone(false);
      }, intervalMs);
    }
  };

  const goNext = () => goToSlide((currentIndex + 1) % slides.length);
  const goPrev = () => goToSlide((currentIndex - 1 + slides.length) % slides.length);

  if (isLoading || isError || !slides || slides.length === 0) {
    return (
      <div className="relative w-full max-w-full aspect-video rounded-2xl overflow-hidden bg-card/50 animate-pulse" />
    );
  }

  const currentSlide = slides[currentIndex];

  return (
    <>
      <div
        className="relative w-full max-w-full aspect-video rounded-2xl overflow-hidden cursor-pointer group"
        onClick={() => setIsFullscreen(true)}
      >
        {/* Shimmer placeholder while first image loads */}
        {!firstImageLoaded && (
          <div className="absolute inset-0 bg-card/50 animate-pulse z-[1]" />
        )}

        {/* Sliding track - all slides laid out horizontally, translateX to show current */}
        <div
          className="flex h-full transition-transform duration-700 ease-in-out will-change-transform"
          style={{ transform: `translateX(-${currentIndex * 100}%)`, zIndex: 2 }}
        >
          {slides.map((slide, idx) => {
            // Only render images within 1 slide of current to reduce network load
            const nearby = Math.abs(idx - currentIndex) <= 1
              || (currentIndex === 0 && idx === slides.length - 1)
              || (currentIndex === slides.length - 1 && idx === 0);
            return (
              <div
                key={slide.id}
                className="relative w-full h-full shrink-0"
                style={{ minWidth: '100%', maxWidth: '100%' }}
              >
                {nearby && (
                  <img
                    src={slide.image_url}
                    alt={slide.title || "AI-generated vehicle wrap render"}
                    className="w-full h-full object-cover"
                    loading={idx === 0 ? "eager" : "lazy"}
                    fetchPriority={idx === 0 ? "high" : undefined}
                    onLoad={idx === 0 ? () => setFirstImageLoaded(true) : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom gradient for text readability */}
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 via-black/60 to-transparent pointer-events-none z-10" />

        {/* SPROKET + Typewriter USP headline overlay — hidden on mobile */}
        <div className="hidden sm:flex absolute bottom-2 left-2 right-12 sm:bottom-4 sm:left-4 sm:right-16 z-20 pointer-events-none items-end gap-2 md:gap-4">
          {/* SPROKET pose — compact on mobile */}
          <img
            key={uspIndex}
            src={currentUsp.image}
            alt="SPROKET"
            className="hidden md:block md:w-28 md:h-28 lg:w-36 lg:h-36 object-contain animate-sproket-fade-up shrink-0"
          />
          {/* Typewriter text */}
          <div className="flex-1 min-w-0 pb-0.5 md:pb-2">
            <p className="text-white text-[10px] sm:text-sm md:text-2xl lg:text-3xl font-black font-poppins leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
              {currentUsp.text.slice(0, charIndex)}
              {!typewriterDone && <span className="inline-block w-0.5 h-[1em] bg-cyan-400 ml-0.5 animate-pulse align-text-bottom" />}
            </p>
          </div>
        </div>

        {/* Top-right starred badge — removed per Trish request */}

        {/* Hover zoom effect */}
        <div className="absolute inset-0 md:group-hover:scale-[1.02] active:scale-95 transition-transform duration-300 pointer-events-none" />

        {/* Left/Right navigation arrows */}
        {slides.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); goPrev(); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 p-1.5 sm:p-2 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label="Previous slide"
            >
              <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); goNext(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 p-1.5 sm:p-2 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label="Next slide"
            >
              <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </button>
          </>
        )}

        {/* Clickable slide indicators */}
        {slides.length > 1 && (
          <div className="absolute bottom-3 right-3 flex gap-1 sm:gap-1.5 z-20 max-w-[50%] flex-wrap justify-end">
            {slides.map((_, idx) => (
              <button
                key={idx}
                onClick={(e) => { e.stopPropagation(); goToSlide(idx); }}
                className={`slide-dot h-1 sm:h-1.5 rounded-full transition-all duration-300 ${
                  idx === currentIndex ? "bg-cyan-400 w-4 sm:w-5" : "bg-white/40 w-1 sm:w-1.5 hover:bg-white/60"
                }`}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Fullscreen Modal — SPROKET branding in corner */}
      <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
        <DialogContent className="max-w-full w-full h-full p-0 border-0 bg-black/95">
          <button
            onClick={() => setIsFullscreen(false)}
            className="absolute top-4 right-4 z-50 p-3 sm:p-2 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors"
            aria-label="Close fullscreen"
          >
            <X className="h-7 w-7 sm:h-6 sm:w-6 text-white" />
          </button>
          <div className="w-full h-full flex items-center justify-center p-4">
            <img
              src={currentSlide.image_url}
              alt={currentSlide.title || "AI-generated vehicle wrap render"}
              className="max-w-full max-h-full object-contain"
            />
          </div>
          {/* SPROKET in fullscreen modal bottom-left */}
          <div className="absolute bottom-6 left-6 z-50 flex items-end gap-3 pointer-events-none">
            <img
              src={currentUsp.image}
              alt="SPROKET"
              className="w-14 h-14 md:w-28 md:h-28 object-contain animate-sproket-bob"
            />
            <p className="text-white/80 text-sm md:text-lg font-poppins font-semibold drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)] pb-2">
              {currentUsp.text}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
