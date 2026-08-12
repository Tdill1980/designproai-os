import { RealisticSwatch } from "@/components/ui/realistic-swatch";
import { inkFusionColors, getColorsByFamily, type InkFusionColor } from "@/lib/restyleproai-colors";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SwatchDetailModal } from "@/components/SwatchDetailModal";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { FinishType } from "@/hooks/useColorProLogic";
import { getCleanColorName, getProductCode } from "@/lib/utils";
import { ManufacturerColorChartModal } from "@/components/colorpro/ManufacturerColorChartModal";
import { convertVinylSwatchToInkFusionColor, type VinylSwatch } from "@/lib/vinyl-intelligence";

interface ColorProModeCoreProps {
  selectedSwatch: InkFusionColor | null;
  onSwatchSelect: (swatch: InkFusionColor) => void;
  onViewOnVehicle?: (color: InkFusionColor) => void;
  selectedFinish?: FinishType;
  colorLibrary?: 'inkfusion';
  vinylSwatches?: VinylSwatch[];
}

export const ColorProModeCore = ({ 
  selectedSwatch, 
  onSwatchSelect,
  onViewOnVehicle,
  selectedFinish = 'Gloss',
  colorLibrary = 'inkfusion',
  vinylSwatches = []
}: ColorProModeCoreProps) => {
  const [selectedFamily, setSelectedFamily] = useState<InkFusionColor['family'] | 'all'>('all');
  const [isExpanded, setIsExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalColor, setModalColor] = useState<InkFusionColor | null>(null);
  const [showColorChartModal, setShowColorChartModal] = useState(false);

  const handleSwatchClick = (color: InkFusionColor) => {
    setModalColor(color);
    setModalOpen(true);
  };

  const handleViewOnVehicle = (color: InkFusionColor) => {
    onSwatchSelect(color);
    if (onViewOnVehicle) {
      onViewOnVehicle(color);
    }
  };
  
  // Convert verified vinyl swatches to InkFusionColor format
  const vinylSwatchColors: InkFusionColor[] = vinylSwatches
    .map(swatch => convertVinylSwatchToInkFusionColor(swatch));

  // Merge InkFusion colors with verified vinyl swatches
  const inkFusionColorsArray = Array.from(new Map(inkFusionColors.map(c => [c.name, c])).values());
  const allColors = [...inkFusionColorsArray, ...vinylSwatchColors];
  
  // Dedupe by name + manufacturer
  const dedupedMap = new Map<string, InkFusionColor>();
  allColors.forEach(color => {
    const key = `${color.manufacturer || 'inkfusion'}-${color.name}`;
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, color);
    }
  });
  
  const allUniqueColors = Array.from(dedupedMap.values());
  
  // Sort to show dark colors first
  const sortedColors = [...allUniqueColors].sort((a, b) => {
    const familyOrder = { 'Dark': 0, 'Mid': 1, 'Bright': 2, 'Neutral': 3 };
    return familyOrder[a.family] - familyOrder[b.family];
  });
  
  const displayColors = selectedFamily === 'all' 
    ? sortedColors 
    : sortedColors.filter(c => c.family === selectedFamily);

  const families: Array<{ value: InkFusionColor['family'] | 'all'; label: string; count: number }> = [
    { value: 'all', label: 'All Colors', count: allUniqueColors.length },
    { value: 'Dark', label: 'Dark', count: allUniqueColors.filter(c => c.family === 'Dark').length },
    { value: 'Mid', label: 'Mid', count: allUniqueColors.filter(c => c.family === 'Mid').length },
    { value: 'Bright', label: 'Bright', count: allUniqueColors.filter(c => c.family === 'Bright').length },
    { value: 'Neutral', label: 'Neutral', count: allUniqueColors.filter(c => c.family === 'Neutral').length },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-1">
          Verified Vinyl Colors
        </h3>
        <p className="text-sm text-muted-foreground mb-2">
          Professional Wrap Colors in {selectedFinish} finish
        </p>
        <p className="text-xs text-muted-foreground/80 italic border-l-2 border-primary/30 pl-3">
          Select any verified color → Get photorealistic 3D renders showing your chosen color on your vehicle
        </p>
      </div>

      {/* Browse Color Charts Button */}
      <Button
        onClick={() => setShowColorChartModal(true)}
        variant="outline"
        className="w-full border-primary/30 hover:bg-primary/5 flex items-center gap-2"
      >
        <BookOpen className="h-4 w-4" />
        Browse Manufacturer Color Charts
      </Button>

      <ManufacturerColorChartModal
        open={showColorChartModal}
        onClose={() => setShowColorChartModal(false)}
      />

      {/* Family Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {families.map((family) => (
          <button
            key={family.value}
            onClick={() => setSelectedFamily(family.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              selectedFamily === family.value
                ? 'bg-primary text-primary-foreground shadow-md'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            {family.label}
          </button>
        ))}
      </div>

      {/* Colors Display */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-foreground">
            {selectedFinish === 'All' ? 'All Finishes' : `${selectedFinish} Colors`} (Dark to Bright)
          </h4>
          <Badge variant="secondary" className="text-xs">{displayColors.length} colors</Badge>
        </div>
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
            {displayColors.slice(0, isExpanded ? displayColors.length : 8).map((color) => {
              // Apply selected finish to color
              const colorWithFinish = { ...color, finish: selectedFinish };
              return (
                <RealisticSwatch
                  key={color.id}
                  color={colorWithFinish}
                  selected={selectedSwatch?.name === color.name}
                  onClick={() => handleSwatchClick(colorWithFinish)}
                />
              );
            })}
          </div>
          {displayColors.length > 8 && (
            <CollapsibleTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full text-xs"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="mr-2 h-4 w-4" />
                    Show Less
                  </>
                ) : (
                  <>
                    <ChevronDown className="mr-2 h-4 w-4" />
                    Show All {displayColors.length} Colors
                  </>
                )}
              </Button>
            </CollapsibleTrigger>
          )}
        </Collapsible>
      </div>

      {/* Swatch Detail Modal */}
      <SwatchDetailModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        color={modalColor}
        onViewOnVehicle={handleViewOnVehicle}
        colorLibrary={colorLibrary}
      />

      {/* Selected Swatch Details */}
      {selectedSwatch && (
        <div className="p-4 bg-secondary/20 rounded-lg border border-border/30">
          <h4 className="text-sm font-semibold mb-2">Selected Color</h4>
          <div className="flex items-center gap-3">
            <RealisticSwatch color={selectedSwatch} size="lg" />
            <div className="flex-1">
              {/* Verified Vinyl Swatch Display */}
              {selectedSwatch.colorLibrary === 'verified_vinyl' ? (
                <>
                  <p className="font-medium">
                    {selectedSwatch.manufacturer} {selectedSwatch.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">
                      {selectedSwatch.finish}
                    </Badge>
                    <Badge variant="default" className="text-xs bg-green-600">
                      ✓ Verified
                    </Badge>
                  </div>
                </>
              ) : (
                <>
                  <p className="font-medium">{getCleanColorName(selectedSwatch.name)}</p>
                  {getProductCode(selectedSwatch.name) && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {getProductCode(selectedSwatch.name)}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">
                      {selectedSwatch.finish}
                    </Badge>
                    <Badge variant="secondary" className="text-xs font-mono">
                      {selectedSwatch.hex}
                    </Badge>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Backward compatibility alias
export const InkFusionModeCore = ColorProModeCore;
