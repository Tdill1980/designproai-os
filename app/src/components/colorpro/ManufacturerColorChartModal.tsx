import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Download, ExternalLink } from "lucide-react";
import { useState } from "react";

interface ManufacturerColorChartModalProps {
  open: boolean;
  onClose: () => void;
}

export const ManufacturerColorChartModal = ({ open, onClose }: ManufacturerColorChartModalProps) => {
  const [selectedManufacturer, setSelectedManufacturer] = useState("avery");

  const manufacturers = [
    {
      id: "avery",
      name: "Avery Dennison SW900",
      pdfUrl: "/color-charts/avery-sw900-color-chart.pdf",
      description: "Complete Avery Dennison SW900 Series color range with gloss, matte, and satin finishes"
    },
    {
      id: "3m",
      name: "3M 2080 Series",
      pdfUrl: "/color-charts/3m-2080-color-chart.pdf",
      description: "Full 3M 2080 Series wrap film color catalog with all finish types"
    },
  ];

  const currentManufacturer = manufacturers.find(m => m.id === selectedManufacturer);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Manufacturer Color Charts
          </DialogTitle>
        </DialogHeader>

        <div className="text-sm text-muted-foreground mb-4">
          Browse official manufacturer color charts. Click a color, note its name and code, then enter it in the Manual Entry tab to generate renders.
        </div>

        <Tabs value={selectedManufacturer} onValueChange={setSelectedManufacturer} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2 bg-muted/30">
            {manufacturers.map((mfr) => (
              <TabsTrigger key={mfr.id} value={mfr.id} className="text-xs sm:text-sm">
                {mfr.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {manufacturers.map((mfr) => (
            <TabsContent 
              key={mfr.id} 
              value={mfr.id} 
              className="flex-1 flex flex-col overflow-hidden mt-4"
            >
              <div className="mb-3">
                <p className="text-sm text-muted-foreground mb-2">{mfr.description}</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(mfr.pdfUrl, '_blank')}
                    className="flex items-center gap-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open in New Tab
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = mfr.pdfUrl;
                      link.download = `${mfr.name}-color-chart.pdf`;
                      link.click();
                    }}
                    className="flex items-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Download PDF
                  </Button>
                </div>
              </div>

              <div className="flex-1 bg-muted/20 rounded-lg border border-border overflow-hidden">
                <iframe
                  src={mfr.pdfUrl}
                  className="w-full h-full"
                  title={`${mfr.name} Color Chart`}
                />
              </div>
            </TabsContent>
          ))}
        </Tabs>

        <div className="mt-4 p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <p className="text-sm text-foreground">
            <strong>How to use:</strong> Browse the color chart, find your desired color, note its name and product code, 
            then close this window and enter those details in the "Manual Entry" tab to generate renders with accurate manufacturer branding.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
