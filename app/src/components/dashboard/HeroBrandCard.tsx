import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Link2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHeroRenderCarousel } from "@/hooks/useHeroRenderCarousel";

/**
 * Left card of Row 1 — Unilan-style hero banner.
 *
 * Full-bleed rotating photo background. Bottom-left text stack:
 *   - Eyebrow:     "Welcome back"
 *   - Headline:    "Design & Marketing Engine"  (Poppins bold, large)
 *   - Description: one-line value prop
 *   - CTA button:  gradient pop → /colorpro
 *
 * Right side: Welcome, {shopName} + WPW Connect Portal badge
 *
 * Does NOT repeat the "DesignProAI" wordmark — that's already the Header.
 */
interface HeroBrandCardProps {
  className?: string;
  shopName?: string;
  isWpwTenant?: boolean;
}

export const HeroBrandCard = ({ className, shopName, isWpwTenant }: HeroBrandCardProps) => {
  const { data: slides } = useHeroRenderCarousel();
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!slides || slides.length <= 1 || reducedMotion) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [slides, reducedMotion]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-[#48484a] bg-rp-surface",
        "aspect-[16/9] md:aspect-auto md:h-[260px] lg:h-[280px]",
        className
      )}
    >
      {/* Rotating photo layer */}
      {slides &&
        slides.length > 0 &&
        slides.map((slide, i) => (
          <div
            key={slide.id}
            className={cn(
              "absolute inset-0 transition-opacity duration-1000",
              i === index ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
          >
            <img
              src={slide.imageUrl}
              alt=""
              className="w-full h-full object-cover"
              loading={i === 0 ? "eager" : "lazy"}
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0";
              }}
            />
            {/* Tool badge — bottom right */}
            {slide.toolLabel && !slide.isFallback && (
              <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-sm border border-cyan-500/50 text-cyan-300 text-[10px] font-bold px-2.5 py-1 rounded-md">
                Made By {slide.toolLabel}
              </div>
            )}
          </div>
        ))}

      {/* Text block + CTA — bottom-left */}
      <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-6">
        <div className="relative flex flex-col gap-2 max-w-full rounded-xl bg-black/70 backdrop-blur-sm px-4 py-3 w-fit">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/80">
            Welcome back
          </div>
          <h1 className="font-montserrat text-2xl sm:text-3xl md:text-3xl lg:text-4xl font-bold leading-[1.05] tracking-tight drop-shadow-lg inline-flex items-baseline whitespace-nowrap">
            <span className="text-white">Shop</span>
            <span className="bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
              Engine
            </span>
          </h1>
          <p className="font-montserrat text-xs sm:text-sm md:text-sm text-white/85 font-medium tracking-wide drop-shadow">
            Your{" "}
            <span className="font-bold text-white">Design</span>{" "}
            <span className="font-bold text-white">Output</span>{" "}
            <span className="font-bold text-white">Profit</span>{" "}
            Dashboard
          </p>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Link
              to="/colorpro"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-rp-pop text-white text-xs font-bold font-poppins hover:brightness-110 transition"
            >
              Start a render
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              to="/gallery"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500/15 border border-cyan-400/40 text-cyan-100 text-xs font-bold font-poppins hover:bg-cyan-500/25 transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              See our examples
            </Link>
            <Link
              to="/quotes"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-xs font-bold font-poppins hover:bg-white/20 transition"
            >
              View quotes
            </Link>
          </div>
        </div>
      </div>

      {/* Right side — Welcome + WPW badge */}
      <div className="absolute top-0 right-0 flex flex-col items-end gap-2 p-4 sm:p-5">
        {shopName && (
          <div className="bg-black/70 backdrop-blur-sm rounded-xl px-4 py-2.5 text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/70">Welcome,</div>
            <div className="text-base sm:text-lg font-black tracking-tight">
              <span className="bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">{shopName}</span>
            </div>
            <div className="text-[10px] text-zinc-400 mt-0.5">
              <span className="text-white/80 font-semibold">Shop Engine</span> by DesignProAI
            </div>
          </div>
        )}
        {isWpwTenant && (
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("restylepro:open-wpw-connect-portal"));
              }
            }}
            title="Open the WPW Connect Portal tour — what you unlock as a WePrintWraps customer"
            className="inline-flex items-center gap-1.5 bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 hover:text-cyan-100 hover:bg-cyan-500/25 hover:border-cyan-400/60 text-[11px] font-bold uppercase tracking-wider rounded-full px-3 py-1 backdrop-blur-sm transition-all cursor-pointer shadow-[0_0_12px_rgba(34,211,238,0.25)]"
          >
            <Link2 className="w-3 h-3" />
            WPW Connect Portal
          </button>
        )}
      </div>

      {/* Slide indicator dots — below welcome block */}
      {slides && slides.length > 1 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          {slides.slice(0, Math.min(slides.length, 6)).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show slide ${i + 1}`}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-5 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
};
