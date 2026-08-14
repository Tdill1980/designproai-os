import { Card } from "./ui/card";
import { Button } from "./ui/button";

interface HeroRendererProps {
  selectedColor?: string;
  pattern?: string;
  product?: string;
  fallbackImage?: string;
  showFallback?: boolean;
  onGenerate?: () => void;
  canGenerate?: boolean;
}

export const HeroRenderer = ({ 
  selectedColor, 
  pattern, 
  product,
  fallbackImage,
  showFallback,
  onGenerate,
  canGenerate = true
}: HeroRendererProps) => {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">3D Preview</h3>
      <Card className="aspect-video border-border flex items-center justify-center bg-secondary/20 overflow-hidden">
        {showFallback && fallbackImage ? (
          <img src={fallbackImage} alt="Example 3D Preview" className="w-full h-full object-cover" />
        ) : selectedColor ? (
          <div 
            className="w-full h-full flex items-center justify-center" 
            style={{ backgroundColor: selectedColor }}
          >
            <span className="text-white bg-black/50 px-4 py-2 rounded">
              3D Car Preview
            </span>
          </div>
        ) : pattern ? (
          <div 
            className="w-full h-full flex items-center justify-center bg-cover bg-center" 
            style={{ backgroundImage: `url(${pattern})` }}
          >
            <span className="text-white bg-black/50 px-4 py-2 rounded">
              3D Car Preview
            </span>
          </div>
        ) : product ? (
          <div className="w-full h-full flex items-center justify-center">
            <img src={product} alt="Product" className="max-w-full max-h-full object-contain" />
          </div>
        ) : (
          <div className="text-center text-muted-foreground">
            <p className="mb-2">Select an option to preview</p>
            <p className="text-sm">3D render will appear here</p>
          </div>
        )}
      </Card>
      
      <div className="mt-4 p-4 bg-secondary/20 rounded-lg border border-border">
        <h4 className="font-semibold mb-2">Render Options</h4>
        {onGenerate && (
          <Button 
            onClick={onGenerate}
            disabled={!canGenerate}
            variant="default"
            className="w-full mb-3"
          >
            {canGenerate ? "Generate 3D Preview" : "Limit Reached"}
          </Button>
        )}
        <p className="text-sm text-muted-foreground">
          Upgrade to Pro for unlimited 3D rendering capabilities
        </p>
      </div>
    </div>
  );
};