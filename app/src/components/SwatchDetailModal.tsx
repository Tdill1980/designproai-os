import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { InkFusionColor } from "@/lib/restyleproai-colors";
import { Sparkles, Eye } from "lucide-react";
import { getCleanColorName, getProductCode } from "@/lib/utils";

interface SwatchDetailModalProps {
  open: boolean;
  onClose: () => void;
  color: InkFusionColor | null;
  onViewOnVehicle: (color: InkFusionColor) => void;
  colorLibrary?: 'inkfusion' | 'avery' | '3m' | 'custom';
}

export const SwatchDetailModal = ({ 
  open, 
  onClose, 
  color,
  onViewOnVehicle,
  colorLibrary = 'inkfusion'
}: SwatchDetailModalProps) => {
  if (!color) return null;

  // Determine the branding based on color library
  const brandTitle = colorLibrary === 'inkfusion' 
    ? 'InkFusion™ Color Details'
    : colorLibrary === 'avery'
    ? 'Avery Dennison SW900 Details'
    : colorLibrary === '3m'
    ? '3M 2080 Series Details'
    : 'Custom Vinyl Color Details';

  const getGradientByFinish = (hex: string, finish: string) => {
    switch (finish) {
      case 'Gloss':
        return `
          radial-gradient(ellipse 80% 50% at 50% 40%, rgba(255,255,255,0.5) 0%, transparent 50%),
          radial-gradient(ellipse 60% 60% at 30% 30%, rgba(255,255,255,0.25) 0%, transparent 50%),
          linear-gradient(135deg, ${hex} 0%, ${hex} 100%)
        `;
      case 'Satin':
        return `
          radial-gradient(ellipse 70% 40% at 50% 35%, rgba(255,255,255,0.3) 0%, transparent 60%),
          radial-gradient(ellipse 50% 50% at 35% 35%, rgba(255,255,255,0.15) 0%, transparent 50%),
          linear-gradient(135deg, ${hex} 0%, ${hex} 100%)
        `;
      case 'Matte':
        return `
          radial-gradient(ellipse 60% 30% at 50% 30%, rgba(255,255,255,0.08) 0%, transparent 70%),
          linear-gradient(135deg, ${hex} 0%, ${hex} 100%)
        `;
      default:
        return hex;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">{brandTitle}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Large Gradient Swatch Preview - matching reference design */}
          <div className="relative aspect-[16/9] rounded-2xl overflow-hidden shadow-2xl">
            <div 
              className="absolute inset-0"
              style={{
                background: `radial-gradient(ellipse 100% 60% at 50% 30%, rgba(255,255,255,0.4) 0%, transparent 60%), 
                            radial-gradient(ellipse 120% 80% at 50% 50%, ${color.hex} 0%, ${color.hex} 100%)`
              }}
            />
            
            {/* Color name overlay at bottom */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/60 to-transparent p-6">
              <h3 className="text-3xl font-bold text-white mb-1">{getCleanColorName(color.name)}</h3>
              {getProductCode(color.name) && (
                <p className="text-white/70 text-sm mb-1">
                  {colorLibrary === 'avery' ? 'Avery Dennison' : colorLibrary === '3m' ? '3M' : ''} {getProductCode(color.name)}
                </p>
              )}
              <p className="text-white/90 font-medium">{color.finish} Finish</p>
            </div>
          </div>

          {/* Action Button */}
          <div className="flex gap-3">
            <Button 
              size="lg"
              variant="outline"
              className="flex-1 border-white/20 hover:bg-white/10 text-foreground font-semibold"
              onClick={() => {
                onViewOnVehicle(color);
                onClose();
              }}
            >
              <Eye className="h-5 w-5 mr-2" />
              View on Vehicle
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
