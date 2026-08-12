import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useHeroRenderCarousel } from "@/hooks/useHeroRenderCarousel";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ImageOff } from "lucide-react";

interface HeroRenderCarouselProps {
  intervalMs?: number;
  className?: string;
}

/**
 * Auto-rotating hero image carousel.
 * - Cross-fades every `intervalMs` (default 5s)
 * - Pauses on hover
 * - Respects prefers-reduced-motion (static first slide)
 */
export const HeroRenderCarousel = ({
  intervalMs = 5000,
  className,
}: HeroRenderCarouselProps) => {
  const { data: slides, isLoading } = useHeroRenderCarousel();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!slides || slides.length <= 1 || paused || reducedMotion) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [slides, paused, reducedMotion, intervalMs]);

  if (isLoading) {
    return (
      <Skeleton
        className={cn(
          "w-full aspect-video rounded-xl bg-neutral-900 border border-white/10",
          className
        )}
      />
    );
  }

  if (!slides || slides.length === 0) {
    return (
      <div
        className={cn(
          "w-full aspect-video rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center",
          className
        )}
      >
        <ImageOff className="w-8 h-8 text-white/20" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative w-full aspect-video rounded-xl overflow-hidden border border-white/10 bg-neutral-900",
        className
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {slides.map((slide, i) => (
        <div
          key={slide.id}
          className={cn(
            "absolute inset-0 transition-opacity duration-1000",
            i === index ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          <img
            src={slide.imageUrl}
            alt={`${slide.toolLabel} — ${slide.vehicleLabel || "render"}`}
            className="w-full h-full object-cover"
            loading={i === 0 ? "eager" : "lazy"}
            onError={(e) => {
              (e.target as HTMLImageElement).style.opacity = "0.3";
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4 flex items-end justify-between gap-3">
            <div className="min-w-0">
              {slide.vehicleLabel && (
                <div className="text-white font-bold text-sm sm:text-base truncate drop-shadow-lg">
                  {slide.vehicleLabel}
                </div>
              )}
            </div>
            <Badge className="bg-black/70 border-cyan-500/50 text-cyan-300 backdrop-blur-sm text-[11px] font-bold px-2.5 py-1 shrink-0">
              Made with {slide.toolLabel}
            </Badge>
          </div>
        </div>
      ))}

      {/* Dot indicators */}
      {slides.length > 1 && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          {slides.slice(0, Math.min(slides.length, 6)).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show slide ${i + 1}`}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-5 bg-cyan-300" : "w-1.5 bg-white/40 hover:bg-white/70"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
};
