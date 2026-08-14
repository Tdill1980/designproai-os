import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock, Sparkles, Zap, Users, Headphones } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ShowcaseCarousel } from "@/components/ui/ShowcaseCarousel";

interface PaywallModalProps {
  open: boolean;
  onClose: () => void;
  onShowExample?: () => void;
  productType?: string;
}

export const PaywallModal = ({ open, onClose, onShowExample, productType }: PaywallModalProps) => {
  const navigate = useNavigate();

  const handleUpgrade = () => {
    navigate('/pricing');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Lock className="h-6 w-6 text-amber-400" />
            You've Used All Free Renders
          </DialogTitle>
          <DialogDescription className="text-base pt-2">
            You've used all 4 free renders. Upgrade to continue creating stunning visualizations.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <ShowcaseCarousel />
          <div className="p-4 bg-gradient-to-br from-blue-500/10 to-blue-500/10 rounded-lg border border-blue-500/20">
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-400" />
              Upgrade for Unlimited Access
            </h4>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-blue-400" />
                Unlimited render generations
              </li>
              <li className="flex items-center gap-2">
                <Headphones className="h-4 w-4 text-blue-400" />
                Priority support
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <Button 
              onClick={handleUpgrade}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-500 hover:from-blue-600 hover:to-blue-600 text-white"
              size="lg"
            >
              View Pricing Plans
            </Button>
            
            {onShowExample && (
              <Button 
                variant="outline" 
                size="lg"
                onClick={() => {
                  onShowExample();
                  onClose();
                }}
              >
                See Example Render
              </Button>
            )}

            <Button 
              variant="ghost" 
              size="sm"
              onClick={onClose}
              className="text-muted-foreground"
            >
              Maybe Later
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
