import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileText } from "lucide-react";

interface OrderDesignModalProps {
  isOpen: boolean;
  onClose: () => void;
  designName: string;
  designPreview?: string;
  productType: 'designpanel' | 'pattern' | 'fadewrap';
  designId?: string;
}

export const OrderDesignModal = ({
  isOpen,
  onClose,
  designName,
  designPreview,
  productType,
  designId
}: OrderDesignModalProps) => {
  
  const handleOrderProductionFiles = () => {
    const url = productType === 'designpanel' && designId
      ? `/printpro/design-packs?design_id=${designId}&type=files`
      : '/printpro';
    window.location.href = url;
  };

  const handleOrderPrintedWrap = () => {
    const url = productType === 'designpanel' && designId
      ? `/printpro/design-packs?design_id=${designId}&type=printed`
      : '/printpro';
    window.location.href = url;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Order This Design?</DialogTitle>
          <DialogDescription>
            Choose how you want to get your {designName} design
          </DialogDescription>
        </DialogHeader>

        {designPreview && (
          <div className="my-4 rounded-lg overflow-hidden border border-border">
            <img 
              src={designPreview} 
              alt={designName}
              className="w-full h-48 object-cover"
            />
          </div>
        )}

        <div className="space-y-3">
          <Button
            onClick={handleOrderProductionFiles}
            className="w-full justify-between h-auto py-4 px-6"
            variant="outline"
          >
            <div className="flex items-start gap-3 text-left">
              <FileText className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold text-base">Get Production Files</div>
                <div className="text-xs text-muted-foreground font-normal">
                  Print it yourself - $149
                </div>
              </div>
            </div>
            <ExternalLink className="h-4 w-4 flex-shrink-0" />
          </Button>

          <Button
            onClick={handleOrderPrintedWrap}
            className="w-full justify-between h-auto py-4 px-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          >
            <div className="flex items-start gap-3 text-left">
              <div className="text-2xl">🎁</div>
              <div>
                <div className="font-semibold text-base">Order Printed Panels</div>
                <div className="text-xs text-primary-foreground/80 font-normal">
                  We print & ship ready to install
                </div>
              </div>
            </div>
            <ExternalLink className="h-4 w-4 flex-shrink-0" />
          </Button>
        </div>

        <div className="mt-4 text-center">
          <Button variant="ghost" onClick={onClose} className="text-xs">
            Maybe Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
