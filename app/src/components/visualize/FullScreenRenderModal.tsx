import { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, X, Sun, Moon, ChevronLeft, ChevronRight } from 'lucide-react';

interface RenderView {
  type: string;
  url: string;
}

interface FullScreenRenderModalProps {
  view: RenderView | null;
  views?: RenderView[];
  onClose: () => void;
  onDownload: (url: string, fileName: string) => void;
  onViewChange?: (view: RenderView) => void;
}

const VIEW_LABELS: Record<string, string> = {
  front: 'Front',
  side: 'Driver Side',
  'driver-side': 'Driver Side',
  'passenger-side': 'Passenger Side',
  hood_detail: 'Hood',
  rear: 'Rear',
  'close-up': 'Close-Up',
  roof: 'Roof',
  top: 'Top View'
};

export function FullScreenRenderModal({ view, views = [], onClose, onDownload, onViewChange }: FullScreenRenderModalProps) {
  const [lightBg, setLightBg] = useState(false);

  const currentIndex = view ? views.findIndex(v => v.type === view.type) : -1;
  const hasMultiple = views.length > 1;

  const goPrev = useCallback(() => {
    if (!hasMultiple || currentIndex < 0) return;
    const prevIndex = (currentIndex - 1 + views.length) % views.length;
    onViewChange?.(views[prevIndex]);
  }, [currentIndex, views, hasMultiple, onViewChange]);

  const goNext = useCallback(() => {
    if (!hasMultiple || currentIndex < 0) return;
    const nextIndex = (currentIndex + 1) % views.length;
    onViewChange?.(views[nextIndex]);
  }, [currentIndex, views, hasMultiple, onViewChange]);

  // Keyboard navigation
  useEffect(() => {
    if (!view) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [view, goPrev, goNext]);

  if (!view) return null;

  const viewLabel = VIEW_LABELS[view.type] || view.type;

  return (
    <Dialog open={!!view} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-7xl w-full h-[90vh] p-0">
        <div className={`relative w-full h-full rounded-lg overflow-hidden transition-colors duration-300 ${lightBg ? 'bg-[#f0f0f0]' : 'bg-black'}`}>
          {/* Close button */}
          <Button
            variant="ghost"
            size="icon"
            className={`absolute top-4 right-4 z-10 ${lightBg ? 'text-black hover:bg-black/10' : 'text-white hover:bg-white/20'}`}
            onClick={onClose}
          >
            <X className="w-6 h-6" />
          </Button>

          {/* Studio background toggle */}
          <button
            onClick={() => setLightBg(prev => !prev)}
            className={`absolute top-4 right-16 z-10 flex items-center gap-1.5 px-3 py-2 rounded-full backdrop-blur-sm transition-all duration-200 active:scale-90 touch-manipulation ${
              lightBg ? 'bg-black/20 hover:bg-black/30 text-black' : 'bg-white/15 hover:bg-white/25 text-white'
            }`}
            title={lightBg ? 'Switch to dark studio' : 'Switch to light studio'}
          >
            {lightBg ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            <span className="text-xs font-semibold uppercase tracking-wider">{lightBg ? 'Dark' : 'Light'}</span>
          </button>

          {/* Previous arrow */}
          {hasMultiple && (
            <button
              onClick={goPrev}
              className={`absolute left-3 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-10 h-10 rounded-full backdrop-blur-sm transition-all duration-200 active:scale-90 touch-manipulation ${
                lightBg ? 'bg-black/15 hover:bg-black/25 text-black' : 'bg-white/15 hover:bg-white/25 text-white'
              }`}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {/* Next arrow */}
          {hasMultiple && (
            <button
              onClick={goNext}
              className={`absolute right-3 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-10 h-10 rounded-full backdrop-blur-sm transition-all duration-200 active:scale-90 touch-manipulation ${
                lightBg ? 'bg-black/15 hover:bg-black/25 text-black' : 'bg-white/15 hover:bg-white/25 text-white'
              }`}
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          {/* Download button */}
          <Button
            variant="default"
            className="absolute bottom-4 right-4 z-10"
            onClick={() => onDownload(view.url, `${view.type}-render.png`)}
          >
            <Download className="w-4 h-4 mr-2" />
            Download {viewLabel}
          </Button>

          {/* Dot indicators */}
          {hasMultiple && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex gap-2">
              {views.map((v, i) => (
                <button
                  key={v.type}
                  onClick={() => onViewChange?.(v)}
                  className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                    i === currentIndex
                      ? 'bg-cyan-400 shadow-[0_0_6px_rgba(0,200,255,0.6)]'
                      : lightBg ? 'bg-black/30 hover:bg-black/50' : 'bg-white/30 hover:bg-white/50'
                  }`}
                  title={VIEW_LABELS[v.type] || v.type}
                />
              ))}
            </div>
          )}

          {/* Full-screen image */}
          <img
            src={view.url}
            alt={viewLabel}
            className="w-full h-full object-contain"
          />

          {/* View label + counter */}
          <div className={`absolute top-4 left-4 px-4 py-2 rounded-lg backdrop-blur-sm ${lightBg ? 'bg-white/70 text-black' : 'bg-black/70 text-white'}`}>
            <h3 className="font-semibold">{viewLabel}</h3>
            {hasMultiple && (
              <p className="text-xs opacity-70">{currentIndex + 1} of {views.length}</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
