import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { X, ChevronLeft, ChevronRight, Download, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileZoomImageModal } from "@/components/visualize/MobileZoomImageModal";

interface StudioGalleryViewerProps {
  toolName: string;
  vehicleName: string;
  designName: string;
  views: Array<{ type: string; url: string; label: string }>;
  isOpen: boolean;
  onClose: () => void;
}

export const StudioGalleryViewer = ({
  toolName,
  vehicleName,
  designName,
  views,
  isOpen,
  onClose,
}: StudioGalleryViewerProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset when opened
  useEffect(() => {
    if (isOpen) setSelectedIndex(0);
  }, [isOpen]);

  // Scroll thumbnails to keep selected visible
  useEffect(() => {
    if (!scrollRef.current) return;
    const thumb = scrollRef.current.children[selectedIndex] as HTMLElement;
    if (thumb) thumb.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selectedIndex]);

  if (!isOpen || views.length === 0) return null;

  const selected = views[selectedIndex];

  const goPrev = () => setSelectedIndex((i) => (i === 0 ? views.length - 1 : i - 1));
  const goNext = () => setSelectedIndex((i) => (i === views.length - 1 ? 0 : i + 1));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowLeft") goPrev();
    if (e.key === "ArrowRight") goNext();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex flex-col overflow-hidden"
        style={{ background: "linear-gradient(to bottom, #f5f5f5 0%, #e8e8e8 50%, #2a2a2a 100%)" }}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-white/95 backdrop-blur-sm border-b border-neutral-200 shadow-sm">
          <div className="min-w-0 flex-1 mr-3">
            <h2 className="text-sm font-bold text-cyan-600 truncate">{toolName} Studio</h2>
            <p className="text-xs text-neutral-500 truncate">{vehicleName} &middot; {designName}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-neutral-700 hover:bg-neutral-200 h-9 w-9 rounded-full flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Hero Render */}
        <div className="flex-1 relative flex items-center justify-center min-h-0 bg-neutral-100">
          {/* Studio ambient lighting strips */}
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-neutral-300 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-neutral-400 to-transparent" />

          {/* Image */}
          <div
            className="w-full h-full flex items-center justify-center p-2 cursor-pointer"
            onClick={() => setZoomOpen(true)}
          >
            <img
              src={selected.url}
              alt={selected.label}
              className="max-w-full max-h-full object-contain rounded-lg"
              draggable={false}
            />
          </div>

          {/* View label badge */}
          <div className="absolute bottom-4 left-4 bg-cyan-500 px-3 py-1.5 rounded-lg shadow-lg">
            <span className="text-sm font-bold text-white">{selected.label}</span>
          </div>

          {/* Counter */}
          <div className="absolute bottom-4 right-4 bg-black/70 px-3 py-1.5 rounded-lg backdrop-blur-sm">
            <span className="text-sm text-white/80 font-medium">
              {selectedIndex + 1} / {views.length}
            </span>
          </div>

          {/* Nav arrows */}
          {views.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-10 h-10 backdrop-blur-sm"
                onClick={(e) => { e.stopPropagation(); goPrev(); }}
              >
                <ChevronLeft className="w-6 h-6" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-10 h-10 backdrop-blur-sm"
                onClick={(e) => { e.stopPropagation(); goNext(); }}
              >
                <ChevronRight className="w-6 h-6" />
              </Button>
            </>
          )}

          {/* Tap to zoom hint */}
          <div className="absolute top-3 right-3 bg-white/70 backdrop-blur-sm px-2 py-1 rounded-md shadow-sm">
            <span className="text-[10px] text-neutral-500 flex items-center gap-1">
              <Maximize2 className="w-3 h-3" /> Tap to zoom
            </span>
          </div>
        </div>

        {/* Thumbnail Strip */}
        <div className="flex-shrink-0 bg-neutral-800 border-t border-neutral-600">
          <div
            ref={scrollRef}
            className="flex gap-2 px-3 py-3 overflow-x-auto"
            style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
          >
            {views.map((view, idx) => (
              <button
                key={view.type}
                onClick={() => setSelectedIndex(idx)}
                className={cn(
                  "relative flex-shrink-0 w-20 aspect-video rounded-lg overflow-hidden border-2 transition-all",
                  selectedIndex === idx
                    ? "border-cyan-400 ring-1 ring-cyan-400/40 scale-105"
                    : "border-neutral-500 opacity-60 hover:opacity-90"
                )}
              >
                <img
                  src={view.url}
                  alt={view.label}
                  className="w-full h-full object-cover"
                  draggable={false}
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-0.5">
                  <span className="text-[8px] font-medium text-white truncate block text-center">
                    {view.label}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Pinch-zoom modal */}
      <MobileZoomImageModal
        imageUrl={selected.url}
        title={selected.label}
        isOpen={zoomOpen}
        onClose={() => setZoomOpen(false)}
        showNavigation={views.length > 1}
        currentIndex={selectedIndex}
        totalCount={views.length}
        onPrev={() => setSelectedIndex((i) => (i === 0 ? views.length - 1 : i - 1))}
        onNext={() => setSelectedIndex((i) => (i === views.length - 1 ? 0 : i + 1))}
      />
    </>
  );
};
