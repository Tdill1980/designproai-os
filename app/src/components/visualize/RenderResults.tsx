import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, Loader2, Maximize2, Sun, Moon, ChevronLeft, ChevronRight } from 'lucide-react';
import { FullScreenRenderModal } from './FullScreenRenderModal';
import { fetchAsPngBlob } from '@/lib/reencode-png';

interface RenderView {
  type: string;
  url: string;
}

interface RenderResultsProps {
  views: RenderView[];
  isPolling?: boolean;
  expectedViewCount?: number;
  onBack: () => void;
}

const VIEW_LABELS: Record<string, string> = {
  side: 'Driver Side',
  'driver-side': 'Driver Side',
  hood_detail: 'Hood',
  'passenger-side': 'Passenger Side',
  rear: 'Rear',
  roof: 'Roof',
  front: 'Front',
  'close-up': 'Close-Up',
};

export function RenderResults({ views, isPolling, expectedViewCount = 1, onBack }: RenderResultsProps) {
  const [selectedView, setSelectedView] = useState<RenderView | null>(null);
  const [cardLightBg, setCardLightBg] = useState<Record<string, boolean>>({});
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroLightBg, setHeroLightBg] = useState(false);

  const downloadImage = async (url: string, fileName: string) => {
    try {
      const blob = await fetchAsPngBlob(url);
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  const skeletonCount = expectedViewCount - views.length;

  // Sort views in desired order - matches locked VIEW_ORDER from view-angles-os.ts
  const sortedViews = [...views].sort((a, b) => {
    const order = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
    return (order.indexOf(a.type) === -1 ? 999 : order.indexOf(a.type)) - (order.indexOf(b.type) === -1 ? 999 : order.indexOf(b.type));
  });

  const heroView = sortedViews[heroIndex];
  const hasMultiple = sortedViews.length > 1;

  const goPrev = useCallback(() => {
    setHeroIndex(i => (i - 1 + sortedViews.length) % sortedViews.length);
  }, [sortedViews.length]);

  const goNext = useCallback(() => {
    setHeroIndex(i => (i + 1) % sortedViews.length);
  }, [sortedViews.length]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Generated Renders</h2>
          <p className="text-sm text-muted-foreground">
            {views.length} of {expectedViewCount} views ready
            {isPolling && ' • Generating more...'}
          </p>
        </div>
        <Button onClick={onBack} variant="outline">
          Generate Another
        </Button>
      </div>

      {/* Hero carousel - single view with arrows */}
      {heroView && (
        <Card className="overflow-hidden border-primary/20">
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <h3 className="font-semibold text-lg">{VIEW_LABELS[heroView.type] || heroView.type}</h3>
              <div className="flex items-center gap-2">
                {hasMultiple && (
                  <span className="text-xs text-muted-foreground">{heroIndex + 1} / {sortedViews.length}</span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => downloadImage(heroView.url, `${heroView.type}-render.png`)}
                >
                  <Download className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedView(heroView)}
                >
                  <Maximize2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div
              className={`relative overflow-hidden transition-colors duration-300 ${heroLightBg ? 'bg-[#f0f0f0]' : ''}`}
            >
              <img
                src={heroView.url}
                alt={VIEW_LABELS[heroView.type]}
                className={`w-full cursor-pointer ${heroLightBg ? 'object-contain' : ''}`}
                onClick={() => setSelectedView(heroView)}
              />

              {/* Light/Dark toggle */}
              <button
                onClick={() => setHeroLightBg(prev => !prev)}
                className={`absolute top-3 left-3 z-10 flex items-center gap-1 px-2 py-1 rounded-full backdrop-blur-sm transition-all duration-200 active:scale-90 touch-manipulation ${
                  heroLightBg ? 'bg-black/15 hover:bg-black/25 text-black' : 'bg-white/15 hover:bg-white/25 text-white'
                }`}
                title={heroLightBg ? 'Switch to dark studio' : 'Switch to light studio'}
              >
                {heroLightBg ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                <span className="text-[10px] font-semibold uppercase tracking-wider">{heroLightBg ? 'Dark' : 'Light'}</span>
              </button>

              {/* Left arrow */}
              {hasMultiple && (
                <button
                  onClick={goPrev}
                  className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white backdrop-blur-sm transition-all duration-200 active:scale-90 touch-manipulation"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
              )}

              {/* Right arrow */}
              {hasMultiple && (
                <button
                  onClick={goNext}
                  className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white backdrop-blur-sm transition-all duration-200 active:scale-90 touch-manipulation"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              )}
            </div>

            {/* Thumbnail strip */}
            {hasMultiple && (
              <div className="flex gap-2 px-4 py-3 overflow-x-auto">
                {sortedViews.map((view, i) => (
                  <button
                    key={view.type}
                    onClick={() => setHeroIndex(i)}
                    className={`flex-shrink-0 rounded-md overflow-hidden border-2 transition-all duration-200 ${
                      i === heroIndex
                        ? 'border-cyan-400 shadow-[0_0_8px_rgba(0,200,255,0.4)]'
                        : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                    style={{ width: 80, height: 52 }}
                  >
                    <img
                      src={view.url}
                      alt={VIEW_LABELS[view.type] || view.type}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Polling skeletons */}
      {isPolling && skeletonCount > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <Card key={`skeleton-${i}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-32" />
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
                <Skeleton className="w-full aspect-video rounded-lg" />
                <p className="text-xs text-center text-muted-foreground">Generating...</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <FullScreenRenderModal
        view={selectedView}
        views={sortedViews}
        onClose={() => setSelectedView(null)}
        onDownload={downloadImage}
        onViewChange={(v) => setSelectedView(v)}
      />
    </div>
  );
}
