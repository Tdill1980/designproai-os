import { useState, useEffect } from "react";
import { Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAR_RATING_CONFIG } from "@/lib/sproket-config";

interface SproketStarRatingProps {
  /** Whether a render just completed successfully */
  renderComplete: boolean;
  /** Callback with rating 1-5 */
  onRate?: (rating: number) => void;
}

/**
 * Star Rating Prompt — appears 10s after a render completes.
 * SPROKET asks the user to rate the render.
 */
export const SproketStarRating = ({
  renderComplete,
  onRate,
}: SproketStarRatingProps) => {
  const [visible, setVisible] = useState(false);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [selectedStar, setSelectedStar] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!renderComplete) {
      setVisible(false);
      setSelectedStar(0);
      setSubmitted(false);
      return;
    }

    const timer = setTimeout(() => setVisible(true), STAR_RATING_CONFIG.delayMs);
    return () => clearTimeout(timer);
  }, [renderComplete]);

  const handleRate = (rating: number) => {
    setSelectedStar(rating);
    setSubmitted(true);
    onRate?.(rating);
    setTimeout(() => setVisible(false), 2000);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-16 sm:bottom-24 right-3 sm:right-4 left-3 sm:left-auto z-[58] animate-sproket-fade-up">
      <div className="bg-card/95 backdrop-blur-md border border-blue-500/20 rounded-xl p-3 sm:p-4 shadow-lg shadow-blue-500/10 sm:w-64">
        <button
          onClick={() => setVisible(false)}
          className="absolute top-2 right-2 p-1 rounded-full hover:bg-secondary/80 transition-colors text-muted-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-3 mb-3">
          <img
            src={STAR_RATING_CONFIG.image}
            alt="SPROKET"
            className="w-9 h-9 sm:w-12 sm:h-12 object-contain animate-sproket-bob"
          />
          <div>
            <p className="text-sm font-semibold font-poppins text-foreground">
              {submitted ? "Thanks!" : STAR_RATING_CONFIG.headline}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {submitted
                ? "SPROKET appreciates you."
                : STAR_RATING_CONFIG.subtext}
            </p>
          </div>
        </div>

        {!submitted && (
          <div className="flex items-center justify-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onMouseEnter={() => setHoveredStar(star)}
                onMouseLeave={() => setHoveredStar(0)}
                onClick={() => handleRate(star)}
                className="p-1 transition-transform hover:scale-125"
              >
                <Star
                  className={cn(
                    "w-6 h-6 transition-colors",
                    (hoveredStar || selectedStar) >= star
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground/40"
                  )}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
