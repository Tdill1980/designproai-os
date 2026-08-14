import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Download, FileText, Printer } from "lucide-react";
import { toast } from "sonner";

interface RenderView {
  type: string;
  url: string;
  label?: string;
}

interface DesignProofSheetProps {
  views: RenderView[];
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  manufacturer: string;
  colorName: string;
  productCode?: string;
  finish: string;
  hex?: string;
  proofId?: string;
}

const VIEW_ORDER = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];

export function DesignProofSheet({
  views,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  manufacturer,
  colorName,
  productCode,
  finish,
  hex,
  proofId
}: DesignProofSheetProps) {
  const [shopName, setShopName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [revisionChecked, setRevisionChecked] = useState(false);
  const [notes, setNotes] = useState("");

  // Sort views by order
  const sortedViews = [...views].sort((a, b) => {
    const aIndex = VIEW_ORDER.indexOf(a.type);
    const bIndex = VIEW_ORDER.indexOf(b.type);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  const primaryView = sortedViews[0];
  const additionalViews = sortedViews.slice(1, 5);

  const generatedProofId = proofId || `APR-${Date.now().toString(36).toUpperCase()}`;
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const handlePrint = () => {
    window.print();
    toast.success("Print dialog opened");
  };

  const handleDownloadPDF = async () => {
    // For now, trigger print as PDF
    toast.info("Use your browser's 'Save as PDF' option in the print dialog");
    window.print();
  };

  return (
    <div className="w-full max-w-5xl mx-auto bg-background">
      {/* Action Buttons - Hidden in print */}
      <div className="flex gap-2 mb-4 print:hidden">
        <Button onClick={handlePrint} className="gap-2">
          <Printer className="w-4 h-4" />
          Print Proof
        </Button>
        <Button onClick={handleDownloadPDF} className="gap-2">
          <Download className="w-4 h-4" />
          Download PDF
        </Button>
      </div>

      {/* Proof Sheet Container - 16:9 Aspect Ratio */}
      <Card className="aspect-video p-6 bg-card border-2 border-border overflow-hidden print:border-0 print:shadow-none">
        {/* Header */}
        <div className="flex justify-between items-start mb-4 pb-3 border-b border-border">
          <div>
            {shopName ? (
              <h2 className="text-xl font-bold text-foreground">{shopName}</h2>
            ) : (
              <div className="print:hidden">
                <Input
                  placeholder="Enter Shop Name (optional)"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  className="w-64 text-sm"
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Design Approval Proof</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-foreground">
              {vehicleYear} {vehicleMake} {vehicleModel}
            </p>
            <p className="text-xs text-muted-foreground">
              {manufacturer} {colorName}
            </p>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="flex gap-4 h-[calc(100%-140px)]">
          {/* Primary View - Large */}
          <div className="flex-1 relative rounded-lg overflow-hidden bg-muted/30">
            {primaryView ? (
              <img
                src={primaryView.url}
                alt="Primary View"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                No render available
              </div>
            )}
            <div className="absolute bottom-2 left-2 bg-background/80 px-2 py-1 rounded text-xs">
              {primaryView?.label || 'Primary View'}
            </div>
          </div>

          {/* Additional Views Grid */}
          <div className="w-1/3 grid grid-cols-2 gap-2">
            {additionalViews.map((view, index) => (
              <div key={index} className="relative rounded overflow-hidden bg-muted/30 aspect-video">
                <img
                  src={view.url}
                  alt={view.label || view.type}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-1 left-1 bg-background/80 px-1 py-0.5 rounded text-[10px]">
                  {view.label || view.type}
                </div>
              </div>
            ))}
            {/* Fill empty slots */}
            {[...Array(Math.max(0, 4 - additionalViews.length))].map((_, i) => (
              <div key={`empty-${i}`} className="rounded bg-muted/20 aspect-video flex items-center justify-center">
                <span className="text-xs text-muted-foreground">-</span>
              </div>
            ))}
          </div>
        </div>

        {/* Film Details Bar */}
        <div className="flex items-center gap-4 mt-3 py-2 px-3 bg-muted/30 rounded-lg text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Manufacturer:</span>
            <span className="font-semibold text-foreground">{manufacturer || 'N/A'}</span>
          </div>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Color:</span>
            <span className="font-semibold text-foreground">{colorName}</span>
          </div>
          {productCode && (
            <>
              <div className="w-px h-4 bg-border" />
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Code:</span>
                <span className="font-mono text-foreground">{productCode}</span>
              </div>
            </>
          )}
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Finish:</span>
            <span className="font-semibold text-foreground">{finish}</span>
          </div>
          {hex && (
            <>
              <div className="w-px h-4 bg-border" />
              <div className="flex items-center gap-2">
                <div 
                  className="w-4 h-4 rounded border border-border" 
                  style={{ backgroundColor: hex }}
                />
                <span className="font-mono text-xs text-foreground">{hex}</span>
              </div>
            </>
          )}
        </div>

        {/* Customer Approval Section */}
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-start gap-6">
            {/* Signature Area */}
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground mb-2">CUSTOMER APPROVAL</p>
              <div className="flex gap-4">
                <div className="flex-1">
                  <p className="text-[10px] text-muted-foreground mb-1">Customer Name</p>
                  <div className="border-b border-dashed border-muted-foreground h-6 print:bg-transparent">
                    <Input
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="h-full border-0 bg-transparent text-sm print:hidden"
                      placeholder="Enter name..."
                    />
                    <span className="hidden print:block text-sm">{customerName}</span>
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-[10px] text-muted-foreground mb-1">Signature</p>
                  <div className="border-b border-dashed border-muted-foreground h-6" />
                </div>
                <div className="w-32">
                  <p className="text-[10px] text-muted-foreground mb-1">Date</p>
                  <p className="text-xs text-foreground">{currentDate}</p>
                </div>
              </div>
            </div>

            {/* Checkboxes */}
            <div className="w-48">
              <div className="flex items-center gap-2 mb-1">
                <Checkbox
                  id="approve"
                  checked={approvalChecked}
                  onCheckedChange={(checked) => setApprovalChecked(!!checked)}
                  className="print:hidden"
                />
                <div className={`w-4 h-4 border rounded hidden print:block ${approvalChecked ? 'bg-primary' : 'bg-transparent'}`} />
                <label htmlFor="approve" className="text-xs text-foreground">
                  I approve this design
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="revisions"
                  checked={revisionChecked}
                  onCheckedChange={(checked) => setRevisionChecked(!!checked)}
                  className="print:hidden"
                />
                <div className={`w-4 h-4 border rounded hidden print:block ${revisionChecked ? 'bg-primary' : 'bg-transparent'}`} />
                <label htmlFor="revisions" className="text-xs text-foreground">
                  Revisions requested
                </label>
              </div>
            </div>
          </div>

          {/* Notes */}
          {(revisionChecked || notes) && (
            <div className="mt-2">
              <p className="text-[10px] text-muted-foreground mb-1">Notes:</p>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-12 text-xs resize-none print:hidden"
                placeholder="Enter revision notes..."
              />
              <p className="hidden print:block text-xs border border-dashed border-muted-foreground p-2 min-h-[48px]">
                {notes}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground">
          <span>Generated by RestyleProAI™ Vehicle Wrap Design Suite</span>
          <span>Proof ID: {generatedProofId}</span>
        </div>
      </Card>
    </div>
  );
}
