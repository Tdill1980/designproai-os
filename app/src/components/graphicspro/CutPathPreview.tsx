import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

interface CutPathPreviewProps {
  svg: string;
  title?: string;
}

export const CutPathPreview = ({ svg, title = "Cut Paths" }: CutPathPreviewProps) => {
  const [zoom, setZoom] = useState(100);

  return (
    <Card className="p-4 bg-secondary/10 border-border">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="icon" 
            className="h-7 w-7"
            onClick={() => setZoom(Math.max(50, zoom - 25))}
          >
            <ZoomOut className="h-3 w-3" />
          </Button>
          <span className="text-xs text-muted-foreground w-12 text-center">{zoom}%</span>
          <Button 
            variant="outline" 
            size="icon" 
            className="h-7 w-7"
            onClick={() => setZoom(Math.min(200, zoom + 25))}
          >
            <ZoomIn className="h-3 w-3" />
          </Button>
          <Button 
            variant="outline" 
            size="icon" 
            className="h-7 w-7"
            onClick={() => setZoom(100)}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      </div>
      
      <div className="bg-white rounded-lg p-4 overflow-auto max-h-[400px] border border-border/50">
        <div 
          className="transition-transform origin-top-left"
          style={{ transform: `scale(${zoom / 100})` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      <div className="mt-3">
        <Slider
          value={[zoom]}
          onValueChange={([val]) => setZoom(val)}
          min={50}
          max={200}
          step={10}
          className="w-full"
        />
      </div>
    </Card>
  );
};
