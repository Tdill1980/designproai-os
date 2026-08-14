import { useState, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileZoomImageModal } from "@/components/visualize/MobileZoomImageModal";

interface BeforeAfterViewerProps {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
  swatchHex?: string;
  swatchImageUrl?: string;
  swatchName?: string;
}

export const BeforeAfterViewer = ({
  beforeUrl,
  afterUrl,
  beforeLabel = "Original",
  afterLabel = "Wrapped",
  swatchHex,
  swatchImageUrl,
  swatchName,
}: BeforeAfterViewerProps) => {
  const [viewMode, setViewMode] = useState<"slider" | "side-by-side">("slider");
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedImage, setExpandedImage] = useState<{ url: string; title: string } | null>(null);

  const handleSliderMove = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSliderPosition(pct);
    },
    []
  );

  const handleMouseDown = () => setIsDragging(true);
  const handleMouseUp = () => setIsDragging(false);
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) handleSliderMove(e.clientX);
    },
    [isDragging, handleSliderMove]
  );
  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      handleSliderMove(e.touches[0].clientX);
    },
    [handleSliderMove]
  );

  return (
    <>
      <Card className="overflow-hidden bg-secondary/30 border-border/30">
        {/* Mode toggle */}
        <div className="flex items-center justify-between p-3 border-b border-border/30">
          <h3 className="text-sm font-semibold">Before / After</h3>
          <div className="flex gap-1">
            <Button
              variant={viewMode === "slider" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setViewMode("slider")}
            >
              <ArrowLeftRight className="w-3 h-3 mr-1" />
              Slider
            </Button>
            <Button
              variant={viewMode === "side-by-side" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setViewMode("side-by-side")}
            >
              Side by Side
            </Button>
          </div>
        </div>

        {viewMode === "slider" ? (
          /* ─── SLIDER MODE ───────────────────────────────── */
          <div
            ref={containerRef}
            className="relative w-full aspect-video select-none cursor-col-resize"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleMouseUp}
          >
            {/* After image (full width, underneath) */}
            <img
              src={afterUrl}
              alt={afterLabel}
              className="absolute inset-0 w-full h-full object-contain bg-black/20"
              draggable={false}
            />

            {/* Before image (clipped by slider) */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${sliderPosition}%` }}
            >
              <img
                src={beforeUrl}
                alt={beforeLabel}
                className="w-full h-full object-contain bg-black/20"
                style={{
                  width: containerRef.current
                    ? `${containerRef.current.offsetWidth}px`
                    : "100%",
                }}
                draggable={false}
              />
            </div>

            {/* Slider handle */}
            <div
              className="absolute top-0 bottom-0 z-10"
              style={{ left: `${sliderPosition}%`, transform: "translateX(-50%)" }}
              onMouseDown={handleMouseDown}
              onTouchStart={handleMouseDown}
            >
              <div className="w-0.5 h-full bg-white shadow-lg" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center">
                <ArrowLeftRight className="w-4 h-4 text-gray-700" />
              </div>
            </div>

            {/* Labels */}
            <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
              {beforeLabel}
            </div>
            <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
              {afterLabel}
            </div>

            {/* Swatch comparison chip (bottom-right of after side) */}
            {(swatchHex || swatchImageUrl) && (
              <div className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-black/70 rounded-lg px-2 py-1.5 backdrop-blur-sm">
                {swatchImageUrl ? (
                  <img src={swatchImageUrl} alt={swatchName || "Swatch"} className="w-6 h-6 rounded border border-white/30 object-cover" />
                ) : swatchHex ? (
                  <div className="w-6 h-6 rounded border border-white/30" style={{ backgroundColor: swatchHex }} />
                ) : null}
                {swatchName && <span className="text-[10px] text-white/80 max-w-[80px] truncate">{swatchName}</span>}
              </div>
            )}

            {/* Expand button for slider mode */}
            <Button
              variant="ghost"
              size="sm"
              className="absolute bottom-2 left-2 h-7 w-7 p-0 bg-black/40 hover:bg-black/60"
              onClick={() => setExpandedImage({ url: afterUrl, title: afterLabel })}
            >
              <Maximize2 className="w-3.5 h-3.5 text-white" />
            </Button>
          </div>
        ) : (
          /* ─── SIDE BY SIDE MODE ─────────────────────────── */
          <div className="grid grid-cols-2 gap-0.5 bg-border/30">
            <div className="relative">
              <img
                src={beforeUrl}
                alt={beforeLabel}
                className="w-full aspect-video object-contain bg-black/20 cursor-pointer"
                onClick={() => setExpandedImage({ url: beforeUrl, title: beforeLabel })}
              />
              <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                {beforeLabel}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="absolute bottom-2 right-2 h-6 w-6 p-0 bg-black/40 hover:bg-black/60"
                onClick={() => setExpandedImage({ url: beforeUrl, title: beforeLabel })}
              >
                <Maximize2 className="w-3 h-3 text-white" />
              </Button>
            </div>
            <div className="relative">
              <img
                src={afterUrl}
                alt={afterLabel}
                className="w-full aspect-video object-contain bg-black/20 cursor-pointer"
                onClick={() => setExpandedImage({ url: afterUrl, title: afterLabel })}
              />
              <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                {afterLabel}
              </div>
              {/* Swatch chip on after panel */}
              {(swatchHex || swatchImageUrl) && (
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 rounded px-1.5 py-1 backdrop-blur-sm">
                  {swatchImageUrl ? (
                    <img src={swatchImageUrl} alt={swatchName || "Swatch"} className="w-5 h-5 rounded border border-white/30 object-cover" />
                  ) : swatchHex ? (
                    <div className="w-5 h-5 rounded border border-white/30" style={{ backgroundColor: swatchHex }} />
                  ) : null}
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="absolute bottom-2 right-2 h-6 w-6 p-0 bg-black/40 hover:bg-black/60"
                onClick={() => setExpandedImage({ url: afterUrl, title: afterLabel })}
              >
                <Maximize2 className="w-3 h-3 text-white" />
              </Button>
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div className="p-2 border-t border-border/30">
          <p className="text-xs text-muted-foreground text-center italic">
            Colors shown are approximate visualizations. Actual wrap appearance varies
            with lighting conditions. Visit your installer for a physical swatch match.
          </p>
        </div>
      </Card>

      {/* Fullscreen modal for expanded view */}
      <MobileZoomImageModal
        imageUrl={expandedImage?.url || ""}
        title={expandedImage?.title}
        isOpen={!!expandedImage}
        onClose={() => setExpandedImage(null)}
      />
    </>
  );
};
