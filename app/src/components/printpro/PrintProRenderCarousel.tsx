import { useState } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface RenderView {
  type: string;
  url: string;
}

interface PrintProRenderCarouselProps {
  views: RenderView[];
  colorName: string;
  colorHex: string;
  finish: string;
  isGenerating: boolean;
}

export const PrintProRenderCarousel = ({
  views,
  colorName,
  colorHex,
  finish,
  isGenerating,
}: PrintProRenderCarouselProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const viewLabels: Record<string, string> = {
    hood_detail: "Hood Detail",
    front: "Front View",
    side: "Side View",
    rear: "Rear View",
    top: "Top View",
    swatch: "Original Swatch",
  };

  if (isGenerating) {
    return (
      <div className="w-full aspect-video bg-muted rounded-lg flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading renders...</p>
      </div>
    );
  }

  if (views.length === 0) {
    return (
      <div className="w-full aspect-video bg-muted rounded-lg flex flex-col items-center justify-center gap-2">
        <p className="text-muted-foreground">No renders available for this color yet</p>
        <p className="text-sm text-muted-foreground">Renders will be added soon</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <Carousel className="w-full" opts={{ loop: true }}>
        <CarouselContent>
          {views.map((view, index) => (
            <CarouselItem key={index}>
              <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
                <img
                  src={view.url}
                  alt={`${colorName} - ${viewLabels[view.type]}`}
                  className="w-full h-full object-contain"
                />
                
                {/* View Type Badge */}
                <Badge
                  variant="secondary"
                  className="absolute top-4 left-4 bg-background/80 backdrop-blur-sm"
                >
                  {viewLabels[view.type] || view.type}
                </Badge>

                {/* Color Info Overlay */}
                <div className="absolute bottom-4 left-4 right-4 bg-background/80 backdrop-blur-sm rounded-lg p-3 border border-border">
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
                        <span>Finish: {finish}</span>
                        <span>•</span>
                        <span className="font-mono text-xs">{colorHex}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="left-4" />
        <CarouselNext className="right-4" />
      </Carousel>

      {/* Dot Indicators */}
      <div className="flex items-center justify-center gap-2">
        {views.map((view, index) => (
          <button
            key={index}
            onClick={() => setSelectedIndex(index)}
            className={`h-2 rounded-full transition-all ${
              index === selectedIndex
                ? "w-8 bg-primary"
                : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
            }`}
            aria-label={`View ${viewLabels[view.type]}`}
          />
        ))}
      </div>
    </div>
  );
};
