import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Download, FileCode, Layers, Grid, FileText, Image, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

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

interface ExportPanelProps {
  productionData: ProductionData;
}

export const ExportPanel = ({ productionData }: ExportPanelProps) => {
  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  };

  const downloadBase64Image = (base64: string, filename: string) => {
    const a = document.createElement('a');
    a.href = `data:image/png;base64,${base64}`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(`Downloaded ${filename}`);
  };

  return (
    <Card className="p-4 bg-secondary/10 border-border">
      <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Download className="w-4 h-4" />
        Export Production Files
      </h4>
      
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {productionData.vector?.svg && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => downloadFile(productionData.vector!.svg, 'cut-paths.svg', 'image/svg+xml')}
            className="flex flex-col h-auto py-3"
          >
            <FileCode className="w-5 h-5 mb-1 text-blue-500" />
            <span className="text-xs">Cut Paths</span>
            <span className="text-[10px] text-muted-foreground">SVG</span>
          </Button>
        )}

        {productionData.bleedVector?.svg && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => downloadFile(productionData.bleedVector!.svg, 'cut-paths-bleed.svg', 'image/svg+xml')}
            className="flex flex-col h-auto py-3"
          >
            <FileCode className="w-5 h-5 mb-1 text-purple-500" />
            <span className="text-xs">Bleed SVG</span>
            <span className="text-[10px] text-muted-foreground">0.5" bleed</span>
          </Button>
        )}

        {productionData.mask?.coverageMask && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => downloadBase64Image(productionData.mask!.coverageMask, 'coverage-mask.png')}
            className="flex flex-col h-auto py-3"
          >
            <Layers className="w-5 h-5 mb-1 text-amber-500" />
            <span className="text-xs">Coverage Mask</span>
            <span className="text-[10px] text-muted-foreground">PNG</span>
          </Button>
        )}

        {productionData.mask?.panelMask && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => downloadBase64Image(productionData.mask!.panelMask, 'panel-mask.png')}
            className="flex flex-col h-auto py-3"
          >
            <Image className="w-5 h-5 mb-1 text-green-500" />
            <span className="text-xs">Panel Mask</span>
            <span className="text-[10px] text-muted-foreground">PNG</span>
          </Button>
        )}

        {productionData.tiles && productionData.tiles.length > 0 && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => {
              productionData.tiles!.forEach((tile, idx) => {
                downloadFile(tile, `tile-${idx + 1}.svg`, 'image/svg+xml');
              });
            }}
            className="flex flex-col h-auto py-3"
          >
            <Grid className="w-5 h-5 mb-1 text-blue-500" />
            <span className="text-xs">Print Tiles</span>
            <span className="text-[10px] text-muted-foreground">{productionData.tiles.length} panels</span>
          </Button>
        )}

        {productionData.guide && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => downloadFile(JSON.stringify(productionData.guide, null, 2), 'installer-guide.json', 'application/json')}
            className="flex flex-col h-auto py-3"
          >
            <FileText className="w-5 h-5 mb-1 text-pink-500" />
            <span className="text-xs">Installer Guide</span>
            <span className="text-[10px] text-muted-foreground">JSON</span>
          </Button>
        )}
      </div>

      {/* PrepMyFile™ CTA - deep link to CutMap or other tools */}
      <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Need custom cut files, upscaling, or CMYK conversion?
        </p>
        <Link
          to="/productionflow?tool=cut_map"
          className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1"
        >
          Open in PrepMyFile™ <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </Card>
  );
};
