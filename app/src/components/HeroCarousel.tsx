import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BeforeAfterSlider } from "@/components/gallery/BeforeAfterSlider";

interface HeroSlide {
  id: string;
  image: string;
  title?: string;
  subtitle?: string;
  link?: string;
}

interface HeroCarouselProps {
  slides: HeroSlide[];
  /** When true and slides are empty, show a before/after example from recent ColorPro renders */
  showColorProExample?: boolean;
}

export const HeroCarousel = ({ slides, showColorProExample }: HeroCarouselProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fetch a recent completed ColorPro render for the before/after example
  const { data: colorProExample } = useQuery({
    queryKey: ["colorpro-hero-example"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("color_visualizations")
        .select("id, color_name, color_hex, finish_type, vehicle_year, vehicle_make, vehicle_model, render_urls")
        .eq("generation_status", "completed")
        .eq("mode_type", "inkfusion")
        .not("render_urls", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error || !data || data.length === 0) return null;
      const row = data[0];
      const urls = row.render_urls as Record<string, string> | null;
      if (!urls) return null;
      // Use hero or side view as the "after" image
      const afterUrl = urls.hero || urls.side || urls.front || Object.values(urls)[0];
      if (!afterUrl) return null;
      return {
        afterUrl,
        colorName: row.color_name,
        vehicleName: `${row.vehicle_year} ${row.vehicle_make} ${row.vehicle_model}`,
      };
    },
    enabled: showColorProExample && (!slides || slides.length === 0),
    staleTime: 5 * 60 * 1000,
  });

  // Only auto-rotate when there are multiple slides
  useEffect(() => {
    if (slides.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % slides.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [slides.length]);

  // Preload all slide images upfront for seamless transitions
  useEffect(() => {
    slides.forEach((slide) => {
      const img = new Image();
      img.src = slide.image;
    });
  }, [slides]);

  // Handle empty slides array
  if (!slides || slides.length === 0) {
    // Show ColorPro before/after example if available
    if (showColorProExample && colorProExample) {
      return (
        <div className="carousel-container space-y-2">
          <div className="carousel-image-wrapper rounded-lg overflow-hidden border border-border/50">
            <div className="relative w-full aspect-video">
              <img
                src={colorProExample.afterUrl}
                alt={`${colorProExample.vehicleName} in ${colorProExample.colorName}`}
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                <p className="text-white text-sm font-semibold">{colorProExample.colorName}</p>
                <p className="text-white/70 text-xs">{colorProExample.vehicleName}</p>
              </div>
              <div className="absolute top-2 left-2 bg-cyan-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                ColorPro™
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="carousel-container space-y-6">
        <div className="carousel-image-wrapper bg-card/50 rounded-lg aspect-video flex flex-col items-center justify-center border border-border/50">
          <Sparkles className="w-8 h-8 text-muted-foreground mb-2" />
          <p className="text-muted-foreground text-sm">Generate your first render!</p>
        </div>
      </div>
    );
  }

  const currentSlide = slides[currentIndex];

  return (
    <>
      <div className="carousel-container flex flex-col">
        {/* Image wrapper - all slides stacked, crossfade via opacity */}
        <div
          className="carousel-image-wrapper group cursor-pointer touch-manipulation relative"
          onClick={() => setIsFullscreen(true)}
        >
          {slides.map((slide, index) => (
            <img
              key={slide.id}
              src={slide.image}
              alt={slide.title || "Hero image"}
              className={`carousel-image absolute inset-0 transition-opacity duration-700 ease-in-out ${
                index === currentIndex ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
              loading={index === 0 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : undefined}
              decoding="async"
            />
          ))}
        </div>
      </div>

      {/* Fullscreen Modal */}
      <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
        <DialogContent className="max-w-full w-full h-full p-0 bg-black/95 border-0">
          <button
            onClick={() => setIsFullscreen(false)}
            className="absolute top-4 right-4 z-50 p-3 sm:p-2 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors touch-manipulation"
            aria-label="Close fullscreen"
          >
            <X className="h-7 w-7 sm:h-6 sm:w-6 text-white" />
          </button>
          <div className="w-full h-full flex items-center justify-center p-4">
            <img
              src={currentSlide.image}
              alt={currentSlide.title || "Hero image"}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
