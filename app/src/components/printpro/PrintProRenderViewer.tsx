import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, Loader2, Maximize2, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface RenderView {
  type: string;
  url: string;
}

interface PrintProRenderViewerProps {
  views: RenderView[];
  isPolling?: boolean;
  expectedViewCount?: number;
  onBack?: () => void;
}

const VIEW_LABELS: Record<string, string> = {
  side: 'Driver Side',
  'driver-side': 'Driver Side',
  hood_detail: 'Hood',
  'passenger-side': 'Passenger Side',
  rear: 'Rear',
  roof: 'Roof',
  front: 'Front',
};

export function PrintProRenderViewer({ 
  views, 
  isPolling, 
  expectedViewCount = 1, 
  onBack 
}: PrintProRenderViewerProps) {
  const [selectedView, setSelectedView] = useState<RenderView | null>(null);

  const downloadImage = async (url: string, fileName: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
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
    const order = ['side', 'passenger-side', 'hood_detail', 'rear', 'close-up', 'roof'];
    return (order.indexOf(a.type) === -1 ? 999 : order.indexOf(a.type)) - (order.indexOf(b.type) === -1 ? 999 : order.indexOf(b.type));
  });

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
        {onBack && (
          <Button onClick={onBack} variant="outline">
            Generate Another
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sortedViews.map((view) => (
          <Card 
            key={view.type}
            className="cursor-pointer hover:border-primary transition-all hover:shadow-lg group"
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{VIEW_LABELS[view.type] || view.type}</h3>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadImage(view.url, `${view.type}-render.png`);
                    }}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedView(view)}
                  >
                    <Maximize2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div 
                className="relative overflow-hidden rounded-lg"
                onClick={() => setSelectedView(view)}
              >
                <img
                  src={view.url}
                  alt={VIEW_LABELS[view.type]}
                  className="w-full rounded-lg transition-transform group-hover:scale-105"
                />
              </div>
            </CardContent>
          </Card>
        ))}

        {isPolling && skeletonCount > 0 && Array.from({ length: skeletonCount }).map((_, i) => (
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

      {/* Full Screen Modal */}
      <Dialog open={!!selectedView} onOpenChange={() => setSelectedView(null)}>
        <DialogContent className="max-w-7xl w-full h-[90vh] p-0">
          <div className="relative w-full h-full bg-black rounded-lg overflow-hidden">
            {/* Close button */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 z-10 text-white hover:bg-white/20"
              onClick={() => setSelectedView(null)}
            >
              <X className="w-6 h-6" />
            </Button>

            {/* Download button */}
            {selectedView && (
              <>
                <Button
                  variant="default"
                  className="absolute bottom-4 right-4 z-10"
                  onClick={() => downloadImage(selectedView.url, `${selectedView.type}-render.png`)}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download {VIEW_LABELS[selectedView.type]}
                </Button>

                {/* Full-screen image */}
                <img
                  src={selectedView.url}
                  alt={VIEW_LABELS[selectedView.type]}
                  className="w-full h-full object-contain"
                />

                {/* View label */}
                <div className="absolute top-4 left-4 bg-black/70 text-white px-4 py-2 rounded-lg backdrop-blur-sm">
                  <h3 className="font-semibold">{VIEW_LABELS[selectedView.type]}</h3>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
