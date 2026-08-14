import { useState, useEffect } from "react";
import { Sparkles, RefreshCw, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRE_RENDER_SLIDES, type ShowcaseSlide } from "@/components/tools/GenerationWizard";

interface DesignIQExpectationsProps {
  className?: string;
  compact?: boolean;
  starredImageUrls?: string[];
}

const SLIDE_DURATION_MS = 5000;

export const DesignIQExpectations = ({ className, compact, starredImageUrls }: DesignIQExpectationsProps) => {
  const [slideIndex, setSlideIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [headlineDone, setHeadlineDone] = useState(false);
  const [bodyVisible, setBodyVisible] = useState(false);

  // Advance slides
  useEffect(() => {
    const interval = setInterval(() => {
      setSlideIndex(prev => (prev + 1) % PRE_RENDER_SLIDES.length);
      setCharIndex(0);
      setHeadlineDone(false);
      setBodyVisible(false);
    }, SLIDE_DURATION_MS);
    return () => clearInterval(interval);
  }, []);

  // Typewriter for headline
  const slide = PRE_RENDER_SLIDES[slideIndex];
  useEffect(() => {
    if (headlineDone) return;
    if (charIndex >= slide.headline.length) {
      setHeadlineDone(true);
      setTimeout(() => setBodyVisible(true), 200);
      return;
    }
    const timer = setTimeout(() => setCharIndex(prev => prev + 1), 25);
    return () => clearTimeout(timer);
  }, [charIndex, headlineDone, slide.headline.length]);

  if (compact) {
    return (
      <div className={cn("rounded-lg border border-cyan-500/20 bg-gradient-to-r from-cyan-500/5 to-purple-500/5 px-5 py-4", className)}>
        <div className="flex items-center gap-3">
          <img src="/sprocket/sprocket-painter.png" alt="ACE" className="w-8 h-8 object-contain flex-shrink-0" />
          <p className="text-sm text-muted-foreground">
            <span className="text-cyan-400 font-semibold">ACE</span> gave you options across angles.
            Love one view but not another? Hit <RefreshCw className="w-3.5 h-3.5 inline mx-1 text-cyan-400" /> in RevisionStudio to re-roll it.
            <span className="text-muted-foreground/70 ml-1">That's what revisions are for.</span>
          </p>
        </div>
      </div>
    );
  }

  const headlineColor = slide.category === "equity" ? "text-purple-400" : "text-cyan-400";

  return (
    <div className={cn(
      "relative flex flex-col items-start justify-start h-full min-h-[300px] overflow-hidden",
      className
    )}>
      {/* Content */}
      <div className="relative z-10 flex items-start justify-center w-full px-6 pt-6 pb-4 gap-6">
        {/* Character image — left side */}
        {slide.sproketImage && (
          <div className="hidden sm:flex items-center justify-center shrink-0">
            <img
              src={slide.sproketImage}
              alt="ACE"
              className="w-24 h-24 md:w-32 md:h-32 lg:w-40 lg:h-40 object-contain drop-shadow-[0_0_16px_rgba(168,85,247,0.4)]"
              style={{ animation: 'float 3s ease-in-out infinite' }}
            />
          </div>
        )}

        {/* Text content */}
        <div className="flex flex-col items-center sm:items-start flex-1 min-w-0">
          {/* Typewriter headline */}
          <h2 className={cn(
            "text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-center sm:text-left font-poppins leading-tight",
            headlineColor,
            "transition-colors duration-500"
          )}>
            {slide.headline.slice(0, charIndex)}
            {!headlineDone && (
              <span className="inline-block w-[3px] h-[1.1em] bg-cyan-400 ml-1 animate-pulse align-text-bottom" />
            )}
          </h2>

          {/* Body text - fades in */}
          <p className={cn(
            "text-base sm:text-lg md:text-xl text-center sm:text-left max-w-2xl mt-4 leading-relaxed transition-all duration-700 font-poppins",
            "text-muted-foreground",
            bodyVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          )}>
            {slide.body}
          </p>

          {/* Character image — mobile only */}
          {slide.sproketImage && (
            <div className="flex sm:hidden items-center justify-center mt-4">
              <img
                src={slide.sproketImage}
                alt="ACE"
                className="w-12 h-12 object-contain"
              />
            </div>
          )}
        </div>
      </div>

      {/* Slide progress dots */}
      <div className="relative z-10 flex items-center gap-2 mt-auto self-center pb-4">
        {PRE_RENDER_SLIDES.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-2 rounded-full transition-all duration-500",
              i === slideIndex ? "bg-cyan-400 w-6" : "bg-muted-foreground/15 w-2"
            )}
          />
        ))}
      </div>

      {/* CTA */}
      <p className={cn(
        "relative z-10 text-sm self-center pb-2",
        "text-muted-foreground/60"
      )}>
        Select a design above to get started
      </p>
    </div>
  );
};
