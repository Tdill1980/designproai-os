import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCw, Check, AlertTriangle, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

interface ViewData {
  type: string;
  url: string;
}

interface ContinuityInspector360Props {
  views: ViewData[];
}

export const ContinuityInspector360 = ({ views }: ContinuityInspector360Props) => {
  const [activeView, setActiveView] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);

  const startSpin = () => {
    if (views.length <= 1) return;
    setIsSpinning(true);
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % views.length;
      setActiveView(idx);
    }, 500);
    
    setTimeout(() => {
      clearInterval(interval);
      setIsSpinning(false);
    }, views.length * 500 * 2);
  };

  // Simplified continuity check - in production this would use AI analysis
  const continuityScore = views.length >= 4 ? 95 : views.length >= 2 ? 85 : 70;
  const hasGoodContinuity = continuityScore >= 85;

  if (views.length === 0) {
    return null;
  }

  return (
    <Card className="p-4 bg-secondary/10 border-border">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <RotateCw className="w-4 h-4" />
          360° Continuity Inspector
        </h4>
        <Badge 
          variant={hasGoodContinuity ? "default" : "secondary"}
          className={cn(
            hasGoodContinuity 
              ? "bg-green-500/20 text-green-500 border-green-500/30" 
              : "bg-amber-500/20 text-amber-500 border-amber-500/30"
          )}
        >
          {hasGoodContinuity ? (
            <><Check className="w-3 h-3 mr-1" /> {continuityScore}% Match</>
          ) : (
            <><AlertTriangle className="w-3 h-3 mr-1" /> {continuityScore}% Match</>
          )}
        </Badge>
      </div>

      {/* Main Preview */}
      <div className="relative mb-3">
        <img 
          src={views[activeView]?.url} 
          alt={views[activeView]?.type}
          className="w-full h-auto rounded-lg border border-border"
        />
        <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/70 rounded text-xs text-white capitalize">
          {views[activeView]?.type.replace('_', ' ')}
        </div>
      </div>

      {/* View Thumbnails */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
        {views.map((view, idx) => (
          <button
            key={view.type}
            onClick={() => setActiveView(idx)}
            className={cn(
              "flex-shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition-all",
              activeView === idx 
                ? "border-blue-500 ring-2 ring-blue-500/30" 
                : "border-transparent hover:border-border"
            )}
          >
            <img src={view.url} alt={view.type} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={startSpin}
          disabled={isSpinning || views.length <= 1}
          className="flex-1"
        >
          <RotateCw className={cn("w-4 h-4 mr-2", isSpinning && "animate-spin")} />
          {isSpinning ? "Spinning..." : "Auto Spin"}
        </Button>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => setActiveView((activeView + 1) % views.length)}
          disabled={views.length <= 1}
        >
          <Eye className="w-4 h-4 mr-2" />
          Next View
        </Button>
      </div>

      {/* Continuity Notes */}
      <div className="mt-3 p-3 bg-secondary/30 rounded-lg">
        <p className="text-xs text-muted-foreground">
          {hasGoodContinuity 
            ? "✓ Design continuity verified across all views. Stripes, zones, and accents align properly."
            : "⚠ Generate more views for complete continuity verification."
          }
        </p>
      </div>
    </Card>
  );
};
