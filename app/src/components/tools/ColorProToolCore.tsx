import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Maximize2, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { MobileZoomImageModal } from "@/components/visualize/MobileZoomImageModal";
import { Skeleton } from "@/components/ui/skeleton";
import { RenderOverlay } from "@/components/tools/RenderOverlay";
import { downloadWithOverlay, downloadAllWithOverlay, OverlaySpec } from "@/lib/download-with-overlay";
import { useToast } from "@/hooks/use-toast";
import type { InkFusionColor } from "@/lib/restyleproai-colors";

interface ColorProToolCoreProps {
  allViews: Array<{ type: string; url: string }>;
  isGenerating: boolean;
  isGeneratingAdditional: boolean;
  selectedSwatch: InkFusionColor | null;
  vehicleName?: string;
  onGenerateAdditional: () => void;
  onClearLastRender: () => void;
  onRegenerateSingleView?: (viewType: string) => void;
  pendingViews?: string[];
  multiFilmInfo?: Array<{ zone: string; manufacturer: string; colorName: string; finish: string; yards?: number }>;
  toolLabel?: string;
}

const VIEW_ORDER = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];

const VIEW_LABELS: Record<string, string> = {
  side: "Driver Side",
  "driver-side": "Driver Side",
  hood_detail: "Hood",
  "passenger-side": "Passenger Side",
  rear: "Rear",
  roof: "Roof",
  front: "Front",
  "close-up": "Close-Up",
};

export const ColorProToolCore = ({
  allViews,
  isGenerating,
  isGeneratingAdditional,
  selectedSwatch,
  vehicleName = '',
  onGenerateAdditional,
  onClearLastRender,
  onRegenerateSingleView,
  pendingViews = [],
  multiFilmInfo,
  toolLabel = "ColorPro™",
}: ColorProToolCoreProps) => {
  const [modalViewIndex, setModalViewIndex] = useState<number | null>(null);
  const [cardLightBg, setCardLightBg] = useState<Record<string, boolean>>({});
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const getOverlaySpec = (): OverlaySpec => ({
    toolName: toolLabel.replace('™', ''),
    manufacturer: multiFilmInfo && multiFilmInfo.length > 0 ? undefined : getManufacturerName(),
    colorOrDesignName: multiFilmInfo && multiFilmInfo.length > 0 ? getMultiFilmOverlay() : getColorName(),
  });

  const handleDownload = async (url: string, viewType: string) => {
    try {
      const overlay = getOverlaySpec();
      const filename = `${selectedSwatch?.name || 'render'}-${viewType}`;
      await downloadWithOverlay(url, filename, overlay);
      toast({ title: "Download started", description: `Downloading ${filename}.png` });
    } catch (error) {
      console.error('Download failed:', error);
      toast({ title: "Download failed", description: "Please try again", variant: "destructive" });
    }
  };

  const handleDownloadAll = async () => {
    const completedViews = sortedViews.filter(v => v.url);
    if (completedViews.length === 0) return;
    try {
      const overlay = getOverlaySpec();
      const images = completedViews.map(view => ({
        url: view.url,
        filename: `${selectedSwatch?.name || 'render'}-${view.type}`
      }));
      await downloadAllWithOverlay(images, overlay);
      toast({ title: "Downloads complete", description: `Downloaded ${images.length} views` });
    } catch (error) {
      console.error('Download all failed:', error);
      toast({ title: "Download failed", description: "Please try again", variant: "destructive" });
    }
  };

  const handlePrevImage = () => {
    if (modalViewIndex !== null && modalViewIndex > 0) {
      setModalViewIndex(modalViewIndex - 1);
    }
  };

  const handleNextImage = () => {
    if (modalViewIndex !== null && modalViewIndex < viewsWithUrls.length - 1) {
      setModalViewIndex(modalViewIndex + 1);
    }
  };

  const getManufacturerName = () => {
    if (!selectedSwatch) return '';
    const manufacturer = (selectedSwatch as any).manufacturer;
    if (manufacturer && manufacturer !== 'Unknown' && manufacturer !== 'Custom') {
      return manufacturer;
    }
    const lib = (selectedSwatch as any)?.colorLibrary?.toLowerCase() || '';
    if (lib.includes('avery') || lib === 'avery_sw900') return 'Avery Dennison';
    if (lib.includes('3m') || lib === '3m_2080') return '3M';
    if (lib.includes('hexis')) return 'Hexis';
    if (lib.includes('kpmf')) return 'KPMF';
    if (lib.includes('oracal')) return 'Oracal';
    if (lib.includes('inozetek')) return 'Inozetek';
    if (lib.includes('arlon')) return 'Arlon';
    if (lib.includes('teckwrap')) return 'TeckWrap';
    if (lib.includes('vvivid')) return 'VViViD';
    return manufacturer || '';
  };

  const getColorName = () => {
    if (!selectedSwatch) return '';
    const name = selectedSwatch.name;
    if (!name || name === 'Unknown' || name === 'Unknown Color') return '';
    const swatch = selectedSwatch as any;
    const fullCode = swatch.code || swatch.sku || swatch.productCode || '';
    const skuOnly = fullCode.includes('-')
      ? fullCode.split('-').pop()
      : fullCode;
    return skuOnly ? `${skuOnly} ${name}` : name;
  };

  const getMultiFilmOverlay = () => {
    if (!multiFilmInfo || multiFilmInfo.length === 0) return '';
    return multiFilmInfo.map(f => {
      const zone = f.zone.charAt(0).toUpperCase() + f.zone.slice(1);
      const parts = [f.manufacturer, f.colorName].filter(Boolean);
      const yardsText = f.yards ? ` (${f.yards} yd)` : '';
      return `${zone}: ${parts.join(' ')} ${f.finish}${yardsText}`;
    }).join(' | ');
  };

  if (isGenerating) {
    return (
      <Card className="p-8 bg-card border-border">
        <div className="flex flex-col items-center justify-center space-y-4 py-12">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-lg font-medium">Generating Hero View...</p>
          <p className="text-sm text-muted-foreground">This may take 30-60 seconds</p>
        </div>
      </Card>
    );
  }

  // Sort views in canonical production order
  const sortedViews = [...allViews].sort((a, b) => {
    const aIdx = VIEW_ORDER.indexOf(a.type);
    const bIdx = VIEW_ORDER.indexOf(b.type);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  const viewsWithUrls = sortedViews.filter(v => v.url);
  const completedCount = viewsWithUrls.length;
  const currentModalView = modalViewIndex !== null ? viewsWithUrls[modalViewIndex] : null;

  const handleOpenModal = (viewType: string) => {
    const index = viewsWithUrls.findIndex(v => v.type === viewType);
    if (index !== -1) setModalViewIndex(index);
  };

  return (
    <>
      <div className="w-full space-y-4 bg-gradient-to-b from-background/50 to-background p-4 sm:p-6 rounded-xl border border-border">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-3 border-b border-border">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">
              <span className="text-white">Color</span>
              <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">Pro™</span>
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              {getManufacturerName()} {getColorName()}
            </p>
          </div>
          {vehicleName && (
            <p className="text-sm font-semibold text-foreground">{vehicleName}</p>
          )}
        </div>

        {/* ─── Swatch Comparison Strip ─── */}
        {selectedSwatch && (
          <div className="flex items-stretch gap-3 rounded-xl bg-secondary/40 border border-border/30 overflow-hidden">
            {/* Swatch image — large enough to compare */}
            <div className="shrink-0 w-24 sm:w-32 bg-zinc-950 flex items-center justify-center overflow-hidden">
              {(selectedSwatch as any).swatchImageUrl || (selectedSwatch as any).media_url ? (
                <img
                  src={(selectedSwatch as any).swatchImageUrl || (selectedSwatch as any).media_url}
                  alt={selectedSwatch.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div
                  className="w-full h-full"
                  style={{
                    backgroundColor: (selectedSwatch as any).hex || '#888',
                    backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.15) 25%, transparent 50%, rgba(0,0,0,0.1) 75%, rgba(0,0,0,0.2) 100%)',
                  }}
                />
              )}
            </div>
            {/* Film info */}
            <div className="py-2.5 pr-3 flex flex-col justify-center min-w-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Selected Film</p>
              <p className="text-sm sm:text-base font-bold text-foreground truncate mt-0.5">
                {(selectedSwatch as any).manufacturer || ''} {selectedSwatch.name}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                {((selectedSwatch as any).productCode || (selectedSwatch as any).code) && (
                  <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">
                    {(selectedSwatch as any).productCode || (selectedSwatch as any).code}
                  </span>
                )}
                <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground">
                  {(selectedSwatch as any).finish || 'Gloss'}
                </span>
                {(selectedSwatch as any).hex && (
                  <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-border/50 inline-block"
                      style={{ backgroundColor: (selectedSwatch as any).hex }}
                    />
                    {(selectedSwatch as any).hex}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Hero Render — full width, large ─── */}
        {sortedViews.length > 0 && (
          <div className="space-y-1.5">
            <button
              onClick={() => handleOpenModal(sortedViews[0].type)}
              className="relative w-full rounded-lg overflow-hidden border-2 border-border hover:border-cyan-500/50 transition-all group cursor-pointer"
            >
              <img
                src={sortedViews[0].url}
                alt={`${VIEW_LABELS[sortedViews[0].type]} view`}
                className="w-full h-auto object-contain transition-transform group-hover:scale-[1.01]"
              />
              <RenderOverlay
                toolName="ColorPro"
                manufacturer={multiFilmInfo && multiFilmInfo.length > 0 ? undefined : getManufacturerName()}
                colorOrDesignName={multiFilmInfo && multiFilmInfo.length > 0 ? getMultiFilmOverlay() : getColorName()}
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors z-20" />
              {/* Download + Retry on hover */}
              <div className="absolute bottom-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                {onRegenerateSingleView && (
                  <div
                    onClick={(e) => { e.stopPropagation(); onRegenerateSingleView(sortedViews[0].type); }}
                    className="bg-background/90 backdrop-blur-sm rounded-full p-2.5 hover:bg-background cursor-pointer"
                    title="Regenerate this view"
                  >
                    <RefreshCw className={cn("h-5 w-5 text-foreground", pendingViews.includes(sortedViews[0].type) && "animate-spin")} />
                  </div>
                )}
                <div
                  onClick={(e) => { e.stopPropagation(); handleDownload(sortedViews[0].url, sortedViews[0].type); }}
                  className="bg-background/90 backdrop-blur-sm rounded-full p-2.5 hover:bg-background cursor-pointer"
                >
                  <Download className="h-5 w-5 text-foreground" />
                </div>
              </div>
            </button>
            <p className="text-center text-sm font-semibold text-foreground uppercase tracking-wide">
              {VIEW_LABELS[sortedViews[0].type] || sortedViews[0].type}
            </p>
          </div>
        )}

        {/* ─── Additional Views — 2-column grid ─── */}
        {sortedViews.length > 1 && (
          <div className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-2")}>
            {sortedViews.slice(1).map((view) => (
              <div key={view.type} className="space-y-1.5">
                <button
                  onClick={() => handleOpenModal(view.type)}
                  className="relative w-full rounded-lg overflow-hidden border border-border hover:border-cyan-500/50 transition-all group cursor-pointer aspect-video"
                >
                  <img
                    src={view.url}
                    alt={`${VIEW_LABELS[view.type]} view`}
                    className="w-full h-full object-contain transition-transform group-hover:scale-102"
                  />
                  <RenderOverlay
                    toolName="ColorPro"
                    manufacturer={multiFilmInfo && multiFilmInfo.length > 0 ? undefined : getManufacturerName()}
                    colorOrDesignName={multiFilmInfo && multiFilmInfo.length > 0 ? getMultiFilmOverlay() : getColorName()}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors z-20" />
                  <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                    {onRegenerateSingleView && (
                      <div
                        onClick={(e) => { e.stopPropagation(); onRegenerateSingleView(view.type); }}
                        className="bg-background/90 backdrop-blur-sm rounded-full p-2 hover:bg-background cursor-pointer"
                        title="Regenerate this view"
                      >
                        <RefreshCw className={cn("h-4 w-4 text-foreground", pendingViews.includes(view.type) && "animate-spin")} />
                      </div>
                    )}
                    <div
                      onClick={(e) => { e.stopPropagation(); handleDownload(view.url, view.type); }}
                      className="bg-background/90 backdrop-blur-sm rounded-full p-2 hover:bg-background cursor-pointer"
                    >
                      <Download className="h-4 w-4 text-foreground" />
                    </div>
                  </div>
                </button>
                <p className="text-center text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide">
                  {VIEW_LABELS[view.type] || view.type}
                </p>
              </div>
            ))}

            {/* Progressive loading skeletons for pending views */}
            {pendingViews.map((viewType) => (
              <div key={`pending-${viewType}`} className="space-y-1.5">
                <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-border">
                  <Skeleton className="w-full h-full" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span className="text-xs text-muted-foreground font-medium">Generating...</span>
                  </div>
                </div>
                <p className="text-center text-xs sm:text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {VIEW_LABELS[viewType] || viewType}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Pending views when only hero exists */}
        {sortedViews.length <= 1 && pendingViews.length > 0 && (
          <div className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-2")}>
            {pendingViews.map((viewType) => (
              <div key={`pending-${viewType}`} className="space-y-1.5">
                <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-border">
                  <Skeleton className="w-full h-full" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span className="text-xs text-muted-foreground font-medium">Generating...</span>
                  </div>
                </div>
                <p className="text-center text-xs sm:text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {VIEW_LABELS[viewType] || viewType}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Sproket decision prompt after first render */}
        {allViews.length === 1 && !isGeneratingAdditional && pendingViews.length === 0 && (
          <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-blue-500/5 p-4">
            <div className="flex items-start gap-3">
              <img
                src="/characters/sproket/sproket-question.png"
                alt="SPROKET"
                className="w-14 h-14 object-contain shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white mb-1">Love this color?</p>
                <p className="text-xs text-muted-foreground mb-3">
                  SPROKET here — want to see this from every angle, or try a different film?
                </p>
                {/* Swatch comparison */}
                {selectedSwatch && (
                  <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-secondary/30 border border-border/30">
                    {(selectedSwatch as any).swatchImageUrl || (selectedSwatch as any).media_url ? (
                      <img
                        src={(selectedSwatch as any).swatchImageUrl || (selectedSwatch as any).media_url}
                        alt={selectedSwatch.name}
                        className="w-12 h-12 rounded-md object-cover border border-border/50"
                      />
                    ) : (
                      <div
                        className="w-12 h-12 rounded-md border border-border/50"
                        style={{
                          backgroundColor: (selectedSwatch as any).hex || '#888',
                          backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, transparent 50%, rgba(0,0,0,0.1) 100%)',
                        }}
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">
                        {(selectedSwatch as any).manufacturer || ''} {selectedSwatch.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {(selectedSwatch as any).productCode || (selectedSwatch as any).code || ''} • {(selectedSwatch as any).finish || 'Gloss'}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={onGenerateAdditional}
                    size="sm"
                    className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white flex-1"
                  >
                    Generate All Views
                  </Button>
                  <Button
                    onClick={onClearLastRender}
                    size="sm"
                    variant="outline"
                    className="border-zinc-600 text-zinc-300 hover:bg-zinc-800 flex-1"
                  >
                    Pick Another Color
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading additional views (fallback) */}
        {isGeneratingAdditional && pendingViews.length === 0 && (
          <div className="flex items-center justify-center gap-3 p-4 bg-secondary/50 rounded-lg border border-border/50">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-sm font-medium">Generating Additional Views...</p>
          </div>
        )}

        {/* Footer Actions */}
        {completedCount > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-border">
            <p className="text-sm text-muted-foreground">
              {completedCount} views generated
            </p>
            <Button
              onClick={handleDownloadAll}
              size="lg"
              className="min-w-[200px] bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white"
            >
              <Download className="mr-2 h-4 w-4" />
              Download All Views
            </Button>
          </div>
        )}
      </div>

      {/* Full screen modal with zoom + navigation */}
      <MobileZoomImageModal
        imageUrl={currentModalView?.url || ''}
        title={`${VIEW_LABELS[currentModalView?.type || ''] || currentModalView?.type} - ${selectedSwatch?.name || 'Color Wrap'}`}
        isOpen={modalViewIndex !== null}
        onClose={() => setModalViewIndex(null)}
        showNavigation={viewsWithUrls.length > 1}
        onPrev={modalViewIndex !== null && modalViewIndex > 0 ? handlePrevImage : undefined}
        onNext={modalViewIndex !== null && modalViewIndex < viewsWithUrls.length - 1 ? handleNextImage : undefined}
        currentIndex={modalViewIndex ?? 0}
        totalCount={viewsWithUrls.length}
      />
    </>
  );
};
