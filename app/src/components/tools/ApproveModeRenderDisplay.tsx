import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Sun, Moon, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { MobileZoomImageModal } from "@/components/visualize/MobileZoomImageModal";
import { downloadWithOverlay, downloadAllWithOverlay, OverlaySpec } from "@/lib/download-with-overlay";
import { useToast } from "@/hooks/use-toast";
import { DesignIDBadge } from "@/components/DesignIDBadge";

interface RenderView {
  type: string;
  url: string | null;
  label: string;
}

interface ApproveModeRenderDisplayProps {
  views: RenderView[];
  vehicleInfo: { year: string; make: string; model: string };
  designName: string;
  isGenerating: boolean;
  generationProgress?: { current: number; total: number };
  onRemoveView?: (viewType: string) => void;
}

const VIEW_ORDER = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];

const VIEW_LABELS: Record<string, string> = {
  'side': 'Driver Side',
  'driver-side': 'Driver Side',
  'passenger-side': 'Passenger Side',
  'hood_detail': 'Hood',
  'front': 'Front',
  'rear': 'Rear',
  'close-up': 'Close-Up',
  'roof': 'Roof',
  'hero': 'Hero',
};

export const ApproveModeRenderDisplay = ({
  views,
  vehicleInfo,
  designName,
  isGenerating,
  generationProgress,
  onRemoveView,
}: ApproveModeRenderDisplayProps) => {
  const [modalViewIndex, setModalViewIndex] = useState<number | null>(null);
  const [cardLightBg, setCardLightBg] = useState<Record<string, boolean>>({});
  const isMobile = useIsMobile();
  const { toast } = useToast();

  // Flexible matching to handle backend view name variants (e.g., 'driver-side' → 'side')
  const findView = (type: string) => {
    const direct = views.find(v => v.type === type);
    if (direct) return direct;
    if (type === 'side') return views.find(v => v.type === 'driver-side' || v.type === 'driver_side');
    if (type === 'hood_detail') return views.find(v => v.type === 'hood' || v.type === 'closeup' || v.type === 'detail');
    return undefined;
  };

  const sortedViews = VIEW_ORDER.map(type =>
    findView(type) || { type, url: null, label: VIEW_LABELS[type] || type }
  );

  // Get all views with URLs for navigation
  const viewsWithUrls = sortedViews.filter(v => v.url);

  // Build overlay spec for ApproveMode downloads
  const getOverlay = (): OverlaySpec => ({
    toolName: 'ApprovePro',
    colorOrDesignName: designName,
  });

  const handleDownloadAll = async () => {
    const completedViews = views.filter(v => v.url);
    if (completedViews.length === 0) return;
    
    try {
      const overlay = getOverlay();
      const images = completedViews.map(view => ({
        url: view.url!,
        filename: `${vehicleInfo.year}-${vehicleInfo.make}-${vehicleInfo.model}-${view.type}`
      }));
      await downloadAllWithOverlay(images, overlay);
      toast({ title: "Downloads complete", description: `Downloaded ${images.length} views` });
    } catch (error) {
      console.error('Download all failed:', error);
      toast({ title: "Download failed", description: "Please try again", variant: "destructive" });
    }
  };

  const handleDownloadSingle = async (imageUrl: string, viewType: string) => {
    try {
      const overlay = getOverlay();
      const filename = `${vehicleInfo.year}-${vehicleInfo.make}-${vehicleInfo.model}-${viewType}`;
      await downloadWithOverlay(imageUrl, filename, overlay);
      toast({ title: "Download started", description: `Downloading ${filename}.png` });
    } catch (error) {
      console.error('Download failed:', error);
      toast({ title: "Download failed", description: "Please try again", variant: "destructive" });
    }
  };

  const handleOpenModal = (viewType: string) => {
    const index = viewsWithUrls.findIndex(v => v.type === viewType);
    if (index !== -1) {
      setModalViewIndex(index);
    }
  };

  const completedCount = views.filter(v => v.url).length;
  const currentModalView = modalViewIndex !== null ? viewsWithUrls[modalViewIndex] : null;

  return (
    <div className="w-full space-y-6 bg-gradient-to-b from-background/50 to-background p-6 rounded-xl border border-border">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-primary via-purple-500 to-pink-500 bg-clip-text text-transparent">
            DesignProAI™ ApprovePro™
          </h2>
          <p className="text-sm text-muted-foreground mt-1">PROFESSIONAL 3D WRAP PREVIEW</p>
        </div>
        <div className="text-right">
          <p className="font-semibold text-foreground">
            {vehicleInfo.year} {vehicleInfo.make} {vehicleInfo.model}
          </p>
          <p className="text-sm text-muted-foreground">{designName}</p>
        </div>
      </div>

      {/* Progress Indicator */}
      {isGenerating && generationProgress && (
        <div className="flex items-center gap-3 p-4 bg-secondary/50 rounded-lg border border-border/50">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              Generating professional renders...
            </p>
            <p className="text-xs text-muted-foreground">
              View {generationProgress.current} of {generationProgress.total}
            </p>
          </div>
          <span className="text-sm font-semibold text-primary">
            {Math.round((generationProgress.current / generationProgress.total) * 100)}%
          </span>
        </div>
      )}

      {/* 6-View Grid */}
      <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3")}>
        {sortedViews.map((view) => (
          <div key={view.type} className="space-y-2">
            {view.url ? (
              <button
                onClick={() => handleOpenModal(view.type)}
                className={cn(
                  "relative w-full rounded-lg overflow-hidden border border-border hover:border-primary/50 transition-all group cursor-pointer transition-colors duration-300",
                  "aspect-video",
                  cardLightBg[view.type] ? "bg-[#f0f0f0]" : ""
                )}
              >
                <img
                  src={view.url}
                  alt={`${view.label} view`}
                  className="w-full h-full object-contain transition-transform group-hover:scale-102"
                />
                <DesignIDBadge
                  toolName="ApprovePro™"
                  designName={designName}
                  showPT={false}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors z-20" />
                {/* Studio background toggle */}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setCardLightBg(prev => ({ ...prev, [view.type]: !prev[view.type] }));
                  }}
                  className={`absolute top-2 left-2 z-30 flex items-center gap-1 px-2 py-1 rounded-full backdrop-blur-sm transition-all duration-200 active:scale-90 touch-manipulation cursor-pointer ${
                    cardLightBg[view.type] ? 'bg-black/15 hover:bg-black/25 text-black' : 'bg-white/15 hover:bg-white/25 text-white'
                  }`}
                  title={cardLightBg[view.type] ? 'Switch to dark studio' : 'Switch to light studio'}
                >
                  {cardLightBg[view.type] ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                  <span className="text-[10px] font-semibold uppercase tracking-wider">{cardLightBg[view.type] ? 'Dark' : 'Light'}</span>
                </div>
                <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="bg-background/90 backdrop-blur-sm rounded-full p-2">
                    <Download className="h-4 w-4 text-foreground" />
                  </div>
                </div>
                {onRemoveView && (
                  <div
                    onClick={(e) => { e.stopPropagation(); onRemoveView(view.type); }}
                    className="absolute top-2 right-2 z-30 bg-red-500/80 hover:bg-red-600 rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title="Remove this view"
                  >
                    <X className="h-3 w-3 text-white" />
                  </div>
                )}
              </button>
            ) : (
              <Skeleton className={cn("w-full rounded-lg", "aspect-video")} />
            )}
            <p className="text-center text-sm font-semibold text-foreground uppercase tracking-wide">
              {view.label}
            </p>
          </div>
        ))}
      </div>

      {/* Footer Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-border">
        <p className="text-sm text-muted-foreground">
          {completedCount} of {VIEW_ORDER.length} views generated
        </p>
        <Button
          onClick={handleDownloadAll}
          disabled={completedCount === 0}
          size="lg"
          className="min-w-[200px]"
        >
          <Download className="mr-2 h-4 w-4" />
          Download All Views
        </Button>
      </div>

      {/* Modal with Navigation */}
      <MobileZoomImageModal
        imageUrl={currentModalView?.url || ''}
        title={`${currentModalView?.label} - ${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}`}
        isOpen={modalViewIndex !== null}
        onClose={() => setModalViewIndex(null)}
        showNavigation={viewsWithUrls.length > 1}
        onPrev={modalViewIndex !== null && modalViewIndex > 0 ? () => setModalViewIndex(modalViewIndex - 1) : undefined}
        onNext={modalViewIndex !== null && modalViewIndex < viewsWithUrls.length - 1 ? () => setModalViewIndex(modalViewIndex + 1) : undefined}
        currentIndex={modalViewIndex ?? 0}
        totalCount={viewsWithUrls.length}
      />
    </div>
  );
};
