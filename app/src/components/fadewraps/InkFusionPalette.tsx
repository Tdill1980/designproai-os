import { useState } from "react";
import { inkFusionColors, InkFusionColor } from "@/lib/restyleproai-colors";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Sparkles } from "lucide-react";

type LaminationFinish = 'Gloss' | 'Satin' | 'Matte' | 'Sparkle';

interface InkFusionPaletteProps {
  onSelect: (color: InkFusionColor & { lamination: LaminationFinish }) => void;
  selectedColor?: (InkFusionColor & { lamination?: LaminationFinish }) | null;
}

type FamilyType = 'Bright' | 'Mid' | 'Dark' | 'Neutral';

const FAMILIES: { id: FamilyType; label: string; description: string }[] = [
  { id: 'Bright', label: 'Bright', description: 'Vibrant, high-saturation colors' },
  { id: 'Mid', label: 'Mid-Tones', description: 'Balanced, versatile colors' },
  { id: 'Dark', label: 'Dark', description: 'Deep, rich colors' },
  { id: 'Neutral', label: 'Neutral', description: 'Classic, timeless tones' }
];

const LAMINATION_OPTIONS: { id: LaminationFinish; label: string; description: string }[] = [
  { id: 'Gloss', label: 'Gloss', description: 'High shine, vibrant depth' },
  { id: 'Satin', label: 'Satin', description: 'Soft sheen, elegant look' },
  { id: 'Matte', label: 'Matte', description: 'No reflection, stealth finish' },
  { id: 'Sparkle', label: '✨ Sparkle', description: 'Fine metallic sparkle in highlights' }
];

export function InkFusionPalette({ onSelect, selectedColor }: InkFusionPaletteProps) {
  const [expandedFamily, setExpandedFamily] = useState<FamilyType | null>('Bright');
  const [selectedLamination, setSelectedLamination] = useState<LaminationFinish>('Gloss');
  const [internalSelectedColor, setInternalSelectedColor] = useState<InkFusionColor | null>(null);

  // Get unique gloss colors (no duplicates from satin/matte variants)
  const getUniqueGlossColors = (family: FamilyType) => {
    return inkFusionColors.filter(c => c.family === family && c.finish === 'Gloss');
  };

  // Handle color selection - combine with current lamination
  const handleColorSelect = (color: InkFusionColor) => {
    setInternalSelectedColor(color);
    onSelect({ ...color, lamination: selectedLamination });
  };

  // Handle lamination change - update selection if color already selected
  const handleLaminationChange = (lamination: LaminationFinish) => {
    setSelectedLamination(lamination);
    if (internalSelectedColor) {
      onSelect({ ...internalSelectedColor, lamination });
    }
  };

  return (
    <div className="space-y-3">
      {/* Header Badge */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-lg border border-purple-500/20">
        <Sparkles className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-semibold text-purple-300">InkFusion™ AI-Calibrated Colors</span>
      </div>
      
      {/* Lamination Finish Selector */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Lamination Finish</p>
        <div className="grid grid-cols-4 gap-1.5">
          {LAMINATION_OPTIONS.map((option) => (
            <button
              key={option.id}
              onClick={() => handleLaminationChange(option.id)}
              className={cn(
                "py-1.5 px-2 rounded-md text-xs font-medium transition-all border",
                selectedLamination === option.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:border-primary/50 text-muted-foreground hover:text-foreground"
              )}
              title={option.description}
            >
              {option.label}
            </button>
          ))}
        </div>
        {selectedLamination === 'Sparkle' && (
          <p className="text-[10px] text-purple-400 italic">
            Fine metallic sparkle visible on curves and highlights
          </p>
        )}
      </div>
      
      <p className="text-xs text-muted-foreground">
        50 exclusive printed colors on 3M IJ180mC-120 Silver Metallic substrate
      </p>

      {/* Color Families */}
      <ScrollArea className="h-[280px] pr-2">
        <div className="space-y-2">
          {FAMILIES.map((family) => {
            const colors = getUniqueGlossColors(family.id);
            const isExpanded = expandedFamily === family.id;
            
            return (
              <Collapsible
                key={family.id}
                open={isExpanded}
                onOpenChange={(open) => setExpandedFamily(open ? family.id : null)}
              >
                <CollapsibleTrigger className="w-full">
                  <div className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-lg border transition-all",
                    isExpanded 
                      ? "border-primary/30 bg-primary/5" 
                      : "border-border hover:border-primary/20"
                  )}>
                    <div className="flex items-center gap-2">
                      {/* Color preview dots */}
                      <div className="flex -space-x-1">
                        {colors.slice(0, 4).map((c, i) => (
                          <div
                            key={c.id}
                            className="w-4 h-4 rounded-full border border-background"
                            style={{ backgroundColor: c.hex, zIndex: 4 - i }}
                          />
                        ))}
                      </div>
                      <span className="text-sm font-medium">{family.label}</span>
                      <span className="text-xs text-muted-foreground">({colors.length})</span>
                    </div>
                    <ChevronDown className={cn(
                      "w-4 h-4 transition-transform",
                      isExpanded && "rotate-180"
                    )} />
                  </div>
                </CollapsibleTrigger>
                
                <CollapsibleContent>
                  <div className="grid grid-cols-7 gap-1.5 p-2 mt-1 bg-secondary/20 rounded-lg">
                    {colors.map((color) => {
                      const isSelected = internalSelectedColor?.id === color.id;
                      return (
                        <button
                          key={color.id}
                          onClick={() => handleColorSelect(color)}
                          className={cn(
                            "w-7 h-7 rounded-md border-2 transition-all hover:scale-110",
                            isSelected 
                              ? "border-primary ring-2 ring-primary/30 scale-110" 
                              : "border-transparent hover:border-primary/50"
                          )}
                          style={{ backgroundColor: color.hex }}
                          title={`${color.name}`}
                        />
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </ScrollArea>

      {/* Selected Color Display */}
      {internalSelectedColor && (
        <div className="flex items-center gap-3 px-3 py-2 bg-secondary/30 rounded-lg border border-border">
          <div 
            className="w-8 h-8 rounded-md border border-border shadow-inner"
            style={{ backgroundColor: internalSelectedColor.hex }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{internalSelectedColor.name}</p>
            <p className="text-xs text-muted-foreground">
              InkFusion™ • {selectedLamination} Lamination • {internalSelectedColor.family}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
