import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ClipboardSignature, Eye, FileText, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProofPreviewCardProps {
  onGenerateProof: () => void;
  hasRender: boolean;
  manufacturer?: string;
  colorName?: string;
  designName?: string;
  vehicleName?: string;
  className?: string;
}

export const ProofPreviewCard = ({
  onGenerateProof,
  hasRender,
  manufacturer,
  colorName,
  designName,
  vehicleName,
  className
}: ProofPreviewCardProps) => {
  // Sample proof features to highlight
  const proofFeatures = [
    "6-View Professional Layout",
    "Customer Signature Section", 
    "Terms & Conditions Option",
    "Film/Design Information"
  ];

  return (
    <Card className={cn(
      "p-4 bg-gradient-to-br from-secondary/30 via-secondary/20 to-primary/5 border-primary/20",
      className
    )}>
      <div className="flex items-start gap-4">
        {/* Preview Thumbnail */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="relative w-24 h-16 sm:w-32 sm:h-20 bg-white rounded-lg overflow-hidden flex-shrink-0 shadow-md cursor-pointer group">
                {/* Mini Proof Preview */}
                <div className="absolute inset-0 p-1">
                  <div className="w-full h-full bg-gray-100 rounded border border-gray-200 flex flex-col">
                    {/* Header bar */}
                    <div className="h-2 bg-gray-800 rounded-t-sm" />
                    {/* 6 grid preview */}
                    <div className="flex-1 grid grid-cols-3 gap-0.5 p-0.5">
                      {[...Array(6)].map((_, i) => (
                        <div key={i} className="bg-gray-300 rounded-sm" />
                      ))}
                    </div>
                    {/* Footer bar */}
                    <div className="h-2 bg-gray-200 rounded-b-sm" />
                  </div>
                </div>
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-primary/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Eye className="w-5 h-5 text-white" />
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs p-3">
              <p className="text-sm font-semibold mb-2">Professional Proof Sheet Preview</p>
              <div className="space-y-1">
                {proofFeatures.map((feature, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2 border-t pt-2">
                {manufacturer || designName 
                  ? `Branded with ${manufacturer || designName} info`
                  : "Includes manufacturer film details"}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-semibold">Customer Approval Proof</h4>
          </div>
          
          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
            Generate a professional 6-view proof sheet with {manufacturer || 'manufacturer'} film info, 
            signature section, and optional T&C for customer approval.
          </p>

          {/* Current context badges */}
          {(vehicleName || colorName || designName) && (
            <div className="flex flex-wrap gap-1 mb-3">
              {vehicleName && (
                <Badge variant="secondary" className="text-[10px]">{vehicleName}</Badge>
              )}
              {(colorName || designName) && (
                <Badge variant="secondary" className="text-[10px]">
                  {manufacturer ? `${manufacturer} ` : ''}{colorName || designName}
                </Badge>
              )}
            </div>
          )}

          <Button
            onClick={onGenerateProof}
            disabled={!hasRender}
            size="sm"
            className={cn(
              "gap-2 w-full sm:w-auto",
              hasRender && "bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90"
            )}
          >
            <ClipboardSignature className="w-4 h-4" />
            {hasRender ? "Generate Approval Proof" : "Generate render first"}
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default ProofPreviewCard;
