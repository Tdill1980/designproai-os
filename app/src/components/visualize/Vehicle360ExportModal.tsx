import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { generateGIF, generateVideo, downloadBlob, type AspectRatio, type ExportFormat } from '@/lib/spin-export-utils';

interface Vehicle360ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: string[];
  vehicleName: string;
  designName: string;
}

export function Vehicle360ExportModal({
  isOpen,
  onClose,
  images,
  vehicleName,
  designName
}: Vehicle360ExportModalProps) {
  const { toast } = useToast();
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [format, setFormat] = useState<ExportFormat>('gif');
  const [quality, setQuality] = useState<'high' | 'medium' | 'low'>('medium');
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const blob = format === 'gif'
        ? await generateGIF({ images, aspectRatio, format, quality, fps: 10 })
        : await generateVideo({ images, aspectRatio, format, fps: 10 });

      const extension = format === 'gif' ? 'gif' : 'webm';
      const aspectStr = aspectRatio.replace(':', 'x');
      const filename = `${vehicleName.replace(/\s/g, '-')}-${designName.replace(/\s/g, '-')}-360-${aspectStr}.${extension}`;
      
      downloadBlob(blob, filename);
      
      toast({
        title: 'Export complete!',
        description: `360° spin view downloaded as ${extension.toUpperCase()}`,
      });
      
      onClose();
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Failed to export 360° view',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export 360° Spin View</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Aspect Ratio Selection */}
          <div className="space-y-3">
            <Label>Aspect Ratio</Label>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setAspectRatio('16:9')}
                className={cn(
                  'px-4 py-3 rounded-lg border-2 transition-all text-left',
                  aspectRatio === '16:9'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/50'
                )}
              >
                <div className="text-sm font-semibold">16:9</div>
                <div className="text-xs text-muted-foreground mt-1">Landscape</div>
              </button>
              <button
                onClick={() => setAspectRatio('9:16')}
                className={cn(
                  'px-4 py-3 rounded-lg border-2 transition-all text-left relative',
                  aspectRatio === '9:16'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/50'
                )}
              >
                <div className="text-sm font-semibold">9:16 ✨</div>
                <div className="text-xs text-muted-foreground mt-1">Reels/Stories</div>
              </button>
              <button
                onClick={() => setAspectRatio('1:1')}
                className={cn(
                  'px-4 py-3 rounded-lg border-2 transition-all text-left',
                  aspectRatio === '1:1'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/50'
                )}
              >
                <div className="text-sm font-semibold">1:1</div>
                <div className="text-xs text-muted-foreground mt-1">Square</div>
              </button>
            </div>
          </div>

          {/* Format Selection */}
          <div className="space-y-3">
            <Label>Export Format</Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setFormat('gif')}
                className={cn(
                  'px-4 py-3 rounded-lg border-2 transition-all text-left',
                  format === 'gif'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/50'
                )}
              >
                <div className="text-sm font-semibold">GIF Animation</div>
                <div className="text-xs text-muted-foreground mt-1">~2-5MB</div>
              </button>
              <button
                onClick={() => setFormat('video')}
                className={cn(
                  'px-4 py-3 rounded-lg border-2 transition-all text-left',
                  format === 'video'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/50'
                )}
              >
                <div className="text-sm font-semibold">Video (WebM)</div>
                <div className="text-xs text-muted-foreground mt-1">~1-3MB</div>
              </button>
            </div>
          </div>

          {/* Quality Selection (GIF only) */}
          {format === 'gif' && (
            <div className="space-y-3">
              <Label>Quality</Label>
              <div className="grid grid-cols-3 gap-3">
                {(['low', 'medium', 'high'] as const).map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuality(q)}
                    className={cn(
                      'px-4 py-2 rounded-lg border-2 transition-all text-center',
                      quality === q
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/50'
                    )}
                  >
                    <div className="text-sm font-semibold capitalize">{q}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Info */}
          <div className="bg-secondary/50 rounded-lg p-4 text-sm">
            <p className="text-muted-foreground">
              {aspectRatio === '9:16' && '📱 Perfect for Instagram Reels, TikTok, and YouTube Shorts'}
              {aspectRatio === '16:9' && '🖥️ Great for YouTube, websites, and presentations'}
              {aspectRatio === '1:1' && '📷 Ideal for Instagram feed posts'}
            </p>
          </div>

          {/* Export Button */}
          <Button
            onClick={handleExport}
            disabled={isExporting}
            className="w-full"
            size="lg"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                {aspectRatio === '9:16' ? 'Download for Reels' : 'Download 360° View'}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
