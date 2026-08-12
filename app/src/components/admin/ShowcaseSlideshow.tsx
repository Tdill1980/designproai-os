import { useState, useEffect, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Play, Pause, ChevronLeft, ChevronRight, X,
  Maximize2, Minimize2, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const VIEW_ORDER = ["roof", "side", "passenger-side", "hood_detail", "front", "rear", "close-up"];

const MODE_LABELS: Record<string, string> = {
  colorpro: "ColorPro",
  ColorPro: "ColorPro",
  designpanelpro: "DesignProAI\u2122",
  fadewraps: "FadeWraps",
  wbty: "WBTY",
  approvemode: "ApproveMode",
  GraphicsPro: "GraphicsPro",
  CustomStyling: "CustomStyling",
  ColorProEnhanced: "ColorPro Enhanced",
  inkfusion: "InkFusion",
};

const MODE_COLORS: Record<string, string> = {
  colorpro: "bg-cyan-500/20 text-cyan-400 border-cyan-500/40",
  ColorPro: "bg-cyan-500/20 text-cyan-400 border-cyan-500/40",
  designpanelpro: "bg-purple-500/20 text-purple-400 border-purple-500/40",
  fadewraps: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  GraphicsPro: "bg-pink-500/20 text-pink-400 border-pink-500/40",
};

const USP_TAGLINES: Record<string, string> = {
  colorpro: "Visualize any color on any vehicle in seconds",
  ColorPro: "Visualize any color on any vehicle in seconds",
  designpanelpro: "World's First AI Prompt-to-Print Design System",
  fadewraps: "Professional fade and gradient designs",
  GraphicsPro: "AI graphic wrap designs",
  wbty: "Linear footage calculator and print tool",
  approvemode: "Customer approval workflow",
};

function getAvailableViews(render: any): { key: string; url: string }[] {
  const urls = render?.render_urls as Record<string, string> | null;
  if (!urls) return [];
  return VIEW_ORDER.filter((k) => urls[k]).map((k) => ({ key: k, url: urls[k] }));
}

function getHeroUrl(render: any): string | null {
  const urls = render?.render_urls as Record<string, string> | null;
  if (!urls) return null;
  return urls.roof || urls.side || Object.values(urls)[0] || null;
}

interface ShowcaseSlideshowProps {
  renders: any[];
  onExit: () => void;
}

export function ShowcaseSlideshow({ renders, onExit }: ShowcaseSlideshowProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentViewIdx, setCurrentViewIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [interval, setInterval_] = useState(8);
  const [showAllViews, setShowAllViews] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimer = useRef<number | null>(null);

  const currentRender = renders[currentIndex];
  const views = currentRender ? getAvailableViews(currentRender) : [];

  const goNext = useCallback(() => {
    if (showAllViews && views.length > 0) {
      if (currentViewIdx < views.length - 1) {
        setIsTransitioning(true);
        setTimeout(() => {
          setCurrentViewIdx((i) => i + 1);
          setIsTransitioning(false);
        }, 300);
        return;
      }
    }
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentIndex((i) => (i < renders.length - 1 ? i + 1 : 0));
      setCurrentViewIdx(0);
      setIsTransitioning(false);
    }, 300);
  }, [showAllViews, views.length, currentViewIdx, renders.length]);

  const goPrev = useCallback(() => {
    if (showAllViews && currentViewIdx > 0) {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentViewIdx((i) => i - 1);
        setIsTransitioning(false);
      }, 300);
      return;
    }
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentIndex((i) => (i > 0 ? i - 1 : renders.length - 1));
      setCurrentViewIdx(0);
      setIsTransitioning(false);
    }, 300);
  }, [showAllViews, currentViewIdx, renders.length]);

  // Auto-play
  useEffect(() => {
    if (!isPlaying || renders.length === 0) return;
    const timer = window.setInterval(goNext, interval * 1000);
    return () => clearInterval(timer);
  }, [isPlaying, interval, goNext, renders.length]);

  // Keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Space") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === "ArrowRight") {
        goNext();
      } else if (e.key === "ArrowLeft") {
        goPrev();
      } else if (e.key === "Escape") {
        onExit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev, onExit]);

  // Auto-hide controls
  useEffect(() => {
    const handleMouseMove = () => {
      setShowControls(true);
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
      controlsTimer.current = window.setTimeout(() => {
        if (isPlaying) setShowControls(false);
      }, 3000);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, [isPlaying]);

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  if (renders.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-zinc-400 text-lg">No renders selected for slideshow.</p>
          <p className="text-zinc-500 text-sm">Go to Grid Mode and select renders first.</p>
          <Button variant="outline" onClick={onExit}>Back</Button>
        </div>
      </div>
    );
  }

  const currentUrl = showAllViews && views[currentViewIdx]
    ? views[currentViewIdx].url
    : getHeroUrl(currentRender);

  const mode = currentRender?.mode_type || "";
  const tagline = USP_TAGLINES[mode] || "";

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 bg-black flex flex-col select-none">
      {/* Image area */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <img
          src={currentUrl || ""}
          alt=""
          className={cn(
            "max-w-full max-h-full object-contain transition-opacity duration-300",
            isTransitioning ? "opacity-0" : "opacity-100"
          )}
        />

        {/* Vehicle info overlay - bottom */}
        <div className={cn(
          "absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-8 transition-opacity duration-300",
          showControls ? "opacity-100" : "opacity-0"
        )}>
          <div className="max-w-4xl">
            <p className="text-white text-3xl font-bold tracking-tight">
              {currentRender.vehicle_year} {currentRender.vehicle_make} {currentRender.vehicle_model}
            </p>
            <p className="text-zinc-300 text-lg mt-1">
              {currentRender.color_name} &middot; {currentRender.finish_type}
            </p>
            {tagline && (
              <p className="text-cyan-400 text-sm mt-2 font-medium">{tagline}</p>
            )}
            <div className="flex items-center gap-3 mt-3">
              {mode && (
                <Badge className={cn(
                  "border text-xs",
                  MODE_COLORS[mode] || "bg-zinc-700/80 text-zinc-300 border-zinc-600"
                )}>
                  {MODE_LABELS[mode] || mode}
                </Badge>
              )}
              <span className="text-zinc-500 text-xs">
                {currentIndex + 1} / {renders.length}
              </span>
            </div>
          </div>
        </div>

        {/* Nav arrows */}
        <button
          className={cn(
            "absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 rounded-full p-3 text-white transition-opacity",
            showControls ? "opacity-100" : "opacity-0"
          )}
          onClick={goPrev}
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
        <button
          className={cn(
            "absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 rounded-full p-3 text-white transition-opacity",
            showControls ? "opacity-100" : "opacity-0"
          )}
          onClick={goNext}
        >
          <ChevronRight className="w-8 h-8" />
        </button>
      </div>

      {/* Top bar with controls */}
      <div className={cn(
        "absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-3 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300",
        showControls ? "opacity-100" : "opacity-0"
      )}>
        <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={onExit}>
          <X className="w-4 h-4 mr-2" /> Exit Slideshow
        </Button>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">All Views</span>
            <Switch checked={showAllViews} onCheckedChange={setShowAllViews} />
          </div>

          <Select value={String(interval)} onValueChange={(v) => setInterval_(Number(v))}>
            <SelectTrigger className="w-20 bg-black/50 border-zinc-700 text-white h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              <SelectItem value="5">5s</SelectItem>
              <SelectItem value="8">8s</SelectItem>
              <SelectItem value="12">12s</SelectItem>
              <SelectItem value="20">20s</SelectItem>
            </SelectContent>
          </Select>

          <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => setIsPlaying((p) => !p)}>
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>

          <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={toggleFullscreen}>
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800">
        <div
          className="h-full bg-cyan-500 transition-all duration-300"
          style={{ width: `${((currentIndex + 1) / renders.length) * 100}%` }}
        />
      </div>
    </div>
  );
}
