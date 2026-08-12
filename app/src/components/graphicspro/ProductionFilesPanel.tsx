import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { FileCode, Layers, Grid, FileText, Sparkles } from "lucide-react";
import { CutPathPreview } from "./CutPathPreview";
import { BleedToggleSwitch } from "./BleedToggleSwitch";
import { ExportPanel } from "./ExportPanel";
import { ContinuityInspector360 } from "./ContinuityInspector360";

interface ViewData {
  type: string;
  url: string;
}

interface ProductionData {
  mask?: {
    coverageMask: string;
    panelMask: string;
    zoneMask: string;
  };
  vector?: {
    svg: string;
  };
  bleedVector?: {
    svg: string;
  };
  tiles?: string[];
  guide?: {
    materials: string[];
    panels: string[];
    sequence: string[];
    notes: string[];
  };
}

interface ProductionFilesPanelProps {
  productionData: ProductionData;
  views: ViewData[];
}

export const ProductionFilesPanel = ({ productionData, views }: ProductionFilesPanelProps) => {
  const [showBleed, setShowBleed] = useState(false);

  const currentSvg = showBleed && productionData.bleedVector?.svg 
    ? productionData.bleedVector.svg 
    : productionData.vector?.svg;

  return (
    <Card className="p-4 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-background border-blue-500/30">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-blue-500" />
        <h3 className="text-lg font-bold text-foreground">Production Files</h3>
        <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30">
          Pro Feature
        </Badge>
      </div>

      <Tabs defaultValue="vectors" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-4">
          <TabsTrigger value="vectors" className="text-xs">
            <FileCode className="w-3 h-3 mr-1" />
            Vectors
          </TabsTrigger>
          <TabsTrigger value="masks" className="text-xs">
            <Layers className="w-3 h-3 mr-1" />
            Masks
          </TabsTrigger>
          <TabsTrigger value="tiles" className="text-xs">
            <Grid className="w-3 h-3 mr-1" />
            Tiles
          </TabsTrigger>
          <TabsTrigger value="guide" className="text-xs">
            <FileText className="w-3 h-3 mr-1" />
            Guide
          </TabsTrigger>
        </TabsList>

        <TabsContent value="vectors" className="space-y-4">
          <BleedToggleSwitch showBleed={showBleed} onToggle={setShowBleed} />
          {currentSvg && (
            <CutPathPreview 
              svg={currentSvg} 
              title={showBleed ? "Cut Paths (with 0.5\" Bleed)" : "Cut Paths"} 
            />
          )}
        </TabsContent>

        <TabsContent value="masks" className="space-y-4">
          {productionData.mask?.coverageMask && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Coverage Mask</p>
              <div className="bg-white rounded-lg p-2 border border-border/50">
                <img 
                  src={`data:image/png;base64,${productionData.mask.coverageMask}`} 
                  alt="Coverage mask"
                  className="w-full h-auto max-h-[300px] object-contain"
                />
              </div>
            </div>
          )}
          {productionData.mask?.panelMask && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Panel Segmentation</p>
              <div className="bg-white rounded-lg p-2 border border-border/50">
                <img 
                  src={`data:image/png;base64,${productionData.mask.panelMask}`} 
                  alt="Panel mask"
                  className="w-full h-auto max-h-[300px] object-contain"
                />
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="tiles" className="space-y-4">
          {productionData.tiles && productionData.tiles.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {productionData.tiles.map((tile, idx) => (
                <Card key={idx} className="p-3 bg-white">
                  <p className="text-xs font-medium text-gray-700 mb-2">Panel {idx + 1}</p>
                  <div dangerouslySetInnerHTML={{ __html: tile }} />
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              No tile data generated. Design may fit on single panel.
            </p>
          )}
        </TabsContent>

        <TabsContent value="guide" className="space-y-4">
          {productionData.guide && (
            <div className="space-y-4">
              <div className="p-3 bg-secondary/30 rounded-lg">
                <p className="text-sm font-semibold mb-2">Materials</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {productionData.guide.materials.map((m, i) => (
                    <li key={i}>• {m}</li>
                  ))}
                </ul>
              </div>

              <div className="p-3 bg-secondary/30 rounded-lg">
                <p className="text-sm font-semibold mb-2">Panel Order</p>
                <ol className="text-sm text-muted-foreground space-y-1">
                  {productionData.guide.panels.map((p, i) => (
                    <li key={i}>{i + 1}. {p}</li>
                  ))}
                </ol>
              </div>

              <div className="p-3 bg-secondary/30 rounded-lg">
                <p className="text-sm font-semibold mb-2">Install Sequence</p>
                <ol className="text-sm text-muted-foreground space-y-1">
                  {productionData.guide.sequence.map((s, i) => (
                    <li key={i}>{i + 1}. {s}</li>
                  ))}
                </ol>
              </div>

              {productionData.guide.notes.length > 0 && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <p className="text-sm font-semibold mb-2 text-amber-600">Notes</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {productionData.guide.notes.map((n, i) => (
                      <li key={i}>⚠ {n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 360 Continuity */}
      <div className="mt-4">
        <ContinuityInspector360 views={views} />
      </div>

      {/* Export */}
      <div className="mt-4">
        <ExportPanel productionData={productionData} />
      </div>
    </Card>
  );
};
