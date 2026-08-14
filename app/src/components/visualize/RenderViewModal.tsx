import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";
import { useEffect } from "react";
import { fetchAsPngBlob } from "@/lib/reencode-png";

interface RenderViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  viewName: string;
  colorName?: string;
}

export const RenderViewModal = ({ 
  isOpen, 
  onClose, 
  imageUrl, 
  viewName,
  colorName 
}: RenderViewModalProps) => {
  
  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, [isOpen]);
  
  const handleDownload = async () => {
    try {
      // Re-encode to true PNG bytes (source render is JPEG)
      const blob = await fetchAsPngBlob(imageUrl);

      // Create object URL and trigger download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${colorName || 'render'}-${viewName.replace(/\s+/g, '-').toLowerCase()}.png`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="max-w-7xl w-[95vw] sm:w-full p-0 gap-0 max-h-[95vh] overflow-auto"
        overlayClassName="touch-none"
      >
        <div className="relative bg-background">
          {/* Close button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 sm:top-4 sm:right-4 z-10 bg-background/80 hover:bg-background touch-manipulation"
            onClick={onClose}
          >
            <X className="h-5 w-5 sm:h-4 sm:w-4" />
          </Button>

          {/* Image */}
          <div className="w-full">
            <img 
              src={imageUrl} 
              alt={`${viewName} view`}
              className="w-full h-auto"
            />
          </div>

          {/* Download button - Mobile optimized */}
          <div className="p-4 sm:p-6 border-t border-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h3 className="font-semibold text-base sm:text-lg">{viewName} View</h3>
              {colorName && <p className="text-sm text-muted-foreground">{colorName}</p>}
            </div>
            <Button onClick={handleDownload} variant="default" size="lg" className="w-full sm:w-auto touch-manipulation">
              <Download className="mr-2 h-5 w-5 sm:h-4 sm:w-4" />
              Download
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
