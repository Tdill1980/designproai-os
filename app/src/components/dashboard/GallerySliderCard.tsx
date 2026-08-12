import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, ArrowRight, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGallerySlides } from "@/hooks/useGallerySlides";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dedicated Gallery card on the dashboard.
 *
 * A horizontal snap slider of gallery images with prev/next arrows,
 * dot indicators, and a "View all gallery →" link. Admin-curated via
 * gallery_items table (featured = true) with fallback to any recent
 * render in visualizations. Empty state when neither is available.
 */
export const GallerySliderCard = () => {
  const { data: slides, isLoading } = useGallerySlides(12);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const slideWidth = el.clientWidth * 0.8;
      if (slideWidth === 0) return;
      setActiveIndex(Math.round(el.scrollLeft / slideWidth));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [slides?.length]);

  const scrollBy = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const slideWidth = el.clientWidth * 0.8;
    el.scrollBy({ left: direction * slideWidth, behavior: "smooth" });
  };

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[#48484a] bg-rp-surface p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-rp-elevated border border-[#48484a] flex items-center justify-center">
            <ImageIcon className="w-4 h-4 text-[#60A5FA]" />
          </div>
          <h3 className="text-sm sm:text-base font-bold text-white uppercase tracking-[0.12em]">
            Gallery
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {/* Arrows — desktop only */}
          <div className="hidden sm:flex items-center gap-1">
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              className="w-8 h-8 rounded-md border border-[#48484a] text-white/70 hover:text-white hover:bg-rp-elevated transition flex items-center justify-center"
              aria-label="Previous slide"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              className="w-8 h-8 rounded-md border border-[#48484a] text-white/70 hover:text-white hover:bg-rp-elevated transition flex items-center justify-center"
              aria-label="Next slide"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <Link
            to="/gallery"
            className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/70 hover:text-white inline-flex items-center gap-1"
          >
            View all
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* Slider */}
      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              key={i}
              className="w-[80%] sm:w-[45%] lg:w-[30%] aspect-[4/3] rounded-xl bg-rp-elevated shrink-0"
            />
          ))}
        </div>
      ) : !slides || slides.length === 0 ? (
        <div className="py-10 text-center rounded-xl border border-dashed border-[#48484a] bg-[#0a0a0a]">
          <ImageIcon className="w-8 h-8 text-white/45 mx-auto mb-2" />
          <div className="text-sm text-white/80 font-inter">
            Gallery is empty
          </div>
          <div className="text-xs text-white/80 mt-1 font-inter">
            Generate renders or curate featured items from the admin panel.
          </div>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="snap-slider flex gap-3 overflow-x-auto pb-2 -mx-1 px-1"
          >
            {slides.map((slide, i) => (
              <Link
                key={slide.id}
                to={slide.href || "/gallery"}
                className={cn(
                  "group relative shrink-0 rounded-xl overflow-hidden border border-[#48484a] hover:border-[#48484a] transition",
                  "w-[80%] sm:w-[45%] lg:w-[30%] aspect-[4/3]",
                  "bg-[#0a0a0a]"
                )}
              >
                <img
                  src={slide.imageUrl}
                  alt={slide.title}
                  loading={i < 2 ? "eager" : "lazy"}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.opacity = "0.3";
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-bold text-white truncate drop-shadow font-poppins">
                      {slide.title}
                    </div>
                  </div>
                  {slide.tool && (
                    <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded text-white bg-gradient-rp-pop shrink-0">
                      {slide.tool}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>

          {/* Dot indicators */}
          {slides.length > 1 && (
            <div className="flex items-center justify-center gap-1.5 mt-2">
              {slides.slice(0, Math.min(slides.length, 8)).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1 rounded-full transition-all",
                    i === activeIndex ? "w-5 bg-gradient-rp-pop" : "w-1 bg-white/20"
                  )}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
};
