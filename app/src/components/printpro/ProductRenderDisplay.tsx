import { useState } from "react";
import { Loader2 } from "lucide-react";

interface RenderImage {
  id: string;
  image_url: string;
  vehicle_type: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_year?: string;
}

interface ProductRenderDisplayProps {
  renders: RenderImage[];
  colorName: string;
  colorHex: string;
  finish: string;
  isLoading?: boolean;
}

export const ProductRenderDisplay = ({
  renders,
  colorName,
  colorHex,
  finish,
  isLoading
}: ProductRenderDisplayProps) => {
  const [selectedRender, setSelectedRender] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  if (isLoading) {
    return (
      <div className="w-full aspect-video bg-muted rounded-lg flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading 3D renders...</p>
      </div>
    );
  }

  if (renders.length === 0) {
    return (
      <div className="w-full aspect-video bg-muted rounded-lg flex flex-col items-center justify-center gap-2 border border-border">
        <p className="text-muted-foreground text-center px-4">
          No 3D renders available for this color yet
        </p>
        <p className="text-sm text-muted-foreground">More renders coming soon</p>
      </div>
    );
  }

  // Filter out rear views (check both vehicle_type and image_url)
  const filteredRenders = renders.filter(r => 
    !r.vehicle_type.toLowerCase().includes('rear') && 
    !r.image_url.toLowerCase().includes('rear')
  );
  const currentRender = filteredRenders[selectedRender];

  if (filteredRenders.length === 0) {
    return (
      <div className="w-full aspect-video bg-muted rounded-lg flex flex-col items-center justify-center gap-2 border border-border">
        <p className="text-muted-foreground text-center px-4">
          No 3D renders available for this color yet
        </p>
        <p className="text-sm text-muted-foreground">More renders coming soon</p>
      </div>
    );
  }

  // Show only the first available render
  const primaryRender = filteredRenders[0];

  return (
    <>
      <div className="space-y-3">
        <button
          onClick={() => setIsFullscreen(true)}
          className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border border-border hover:border-primary transition-colors cursor-pointer group"
        >
          <img
            src={primaryRender.image_url}
            alt={`${colorName} on ${primaryRender.vehicle_year && primaryRender.vehicle_make && primaryRender.vehicle_model
              ? `${primaryRender.vehicle_year} ${primaryRender.vehicle_make} ${primaryRender.vehicle_model}`
              : primaryRender.vehicle_type}`}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
          />
        </button>
        
        {/* Color Info Box - Below Photo */}
        <div className="bg-card backdrop-blur-sm rounded-lg p-3 border border-border">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded border border-border shrink-0"
              style={{ backgroundColor: colorHex }}
            />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground truncate">
                InkFusion™ {colorName}
              </h3>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>
                  {primaryRender.vehicle_year && primaryRender.vehicle_make && primaryRender.vehicle_model
                    ? `${primaryRender.vehicle_year} ${primaryRender.vehicle_make} ${primaryRender.vehicle_model}`
                    : primaryRender.vehicle_type}
                </span>
                <span>•</span>
                <span>Finish: {finish}</span>
                <span>•</span>
                <span className="font-mono text-xs">{colorHex}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div 
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
          onClick={() => setIsFullscreen(false)}
        >
          <button
            onClick={() => setIsFullscreen(false)}
            className="absolute top-4 right-4 text-white hover:text-primary transition-colors"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={primaryRender.image_url}
            alt={`${colorName} on ${primaryRender.vehicle_year && primaryRender.vehicle_make && primaryRender.vehicle_model
              ? `${primaryRender.vehicle_year} ${primaryRender.vehicle_make} ${primaryRender.vehicle_model}`
              : primaryRender.vehicle_type}`}
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
};
