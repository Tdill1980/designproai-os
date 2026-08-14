import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { fetchAsPngBlob } from "@/lib/reencode-png";

interface DesktopRenderModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: Array<{ url: string; label: string; type: string }>;
  currentIndex: number;
  onIndexChange: (index: number) => void;
  vehicleInfo?: {
    year: string;
    make: string;
    model: string;
  };
  designInfo?: {
    name: string;
    finish?: string;
    tool?: string;
  };
}

export const DesktopRenderModal = ({
  isOpen,
  onClose,
  images,
  currentIndex,
  onIndexChange,
  vehicleInfo,
  designInfo,
}: DesktopRenderModalProps) => {
  const [zoom, setZoom] = useState(1);
  const [showInfo, setShowInfo] = useState(false);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
          onIndexChange(Math.max(0, currentIndex - 1));
          break;
        case "ArrowRight":
          onIndexChange(Math.min(images.length - 1, currentIndex + 1));
          break;
        case "Escape":
          onClose();
          break;
        case "d":
        case "D":
          handleDownload();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, currentIndex, images.length, onClose, onIndexChange]);

  const handleDownload = async () => {
    const currentImage = images[currentIndex];
    if (!currentImage) return;

    try {
      const blob = await fetchAsPngBlob(currentImage.url);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentImage.label.toLowerCase().replace(/\s+/g, "-")}.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  const currentImage = images[currentIndex];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl h-[90vh] p-0 gap-0 bg-black/95">
        {/* Top Bar */}
        <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/80 to-transparent p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-white border-white/20">
              {currentIndex + 1} / {images.length}
            </Badge>
            <span className="text-white font-medium">{currentImage?.label}</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowInfo(!showInfo)}
              className="text-white hover:bg-white/10"
            >
              <Info className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setZoom(Math.max(1, zoom - 0.25))}
              disabled={zoom <= 1}
              className="text-white hover:bg-white/10"
            >
              <ZoomOut className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setZoom(Math.min(3, zoom + 0.25))}
              disabled={zoom >= 3}
              className="text-white hover:bg-white/10"
            >
              <ZoomIn className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDownload}
              className="text-white hover:bg-white/10"
            >
              <Download className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-white hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Main Image */}
        <div className="flex-1 flex items-center justify-center p-16 relative overflow-hidden">
          <img
            src={currentImage?.url}
            alt={currentImage?.label}
            className="max-h-full max-w-full object-contain transition-transform duration-200"
            style={{ transform: `scale(${zoom})` }}
          />

          {/* Navigation Arrows */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onIndexChange(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            className="absolute left-4 text-white hover:bg-white/10 h-12 w-12"
          >
            <ChevronLeft className="h-8 w-8" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onIndexChange(Math.min(images.length - 1, currentIndex + 1))}
            disabled={currentIndex === images.length - 1}
            className="absolute right-4 text-white hover:bg-white/10 h-12 w-12"
          >
            <ChevronRight className="h-8 w-8" />
          </Button>
        </div>

        {/* Info Panel */}
        {showInfo && (vehicleInfo || designInfo) && (
          <div className="absolute right-4 top-20 bg-card/95 backdrop-blur-sm border border-border rounded-lg p-4 space-y-2 w-64">
            {vehicleInfo && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Vehicle</p>
                <p className="text-sm font-medium">
                  {vehicleInfo.year} {vehicleInfo.make} {vehicleInfo.model}
                </p>
              </div>
            )}
            {designInfo && (
              <>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Design</p>
                  <p className="text-sm font-medium">{designInfo.name}</p>
                </div>
                {designInfo.finish && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Finish</p>
                    <p className="text-sm font-medium">{designInfo.finish}</p>
                  </div>
                )}
                {designInfo.tool && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Tool</p>
                    <p className="text-sm font-medium">{designInfo.tool}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Bottom Filmstrip */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
          <div className="flex gap-2 justify-center overflow-x-auto">
            {images.map((img, idx) => (
              <button
                key={idx}
                onClick={() => onIndexChange(idx)}
                className={cn(
                  "flex-shrink-0 rounded overflow-hidden border-2 transition-all hover:scale-105",
                  idx === currentIndex
                    ? "border-primary shadow-lg shadow-primary/50"
                    : "border-white/20 opacity-60 hover:opacity-100"
                )}
              >
                <img
                  src={img.url}
                  alt={img.label}
                  className="w-24 h-14 object-cover"
                />
              </button>
            ))}
          </div>
        </div>

        {/* Keyboard Hints */}
        <div className="absolute bottom-20 left-4 text-xs text-white/60 space-y-1">
          <p>← → Navigate</p>
          <p>D Download</p>
          <p>ESC Close</p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
