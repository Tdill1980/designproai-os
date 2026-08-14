import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Zap } from "lucide-react";
import { ShowcaseCarousel } from "@/components/ui/ShowcaseCarousel";

interface RenderLimitUpsellProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlan: string;
  rendersUsed: number;
  renderLimit: number;
}

export const RenderLimitUpsell = ({ 
  isOpen, 
  onClose, 
  currentPlan,
  rendersUsed,
  renderLimit
}: RenderLimitUpsellProps) => {
  const handleUpgradePlan = () => {
    window.location.assign('/pricing');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md" overlayClassName="bg-transparent">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-5 w-5 text-primary" />
            <DialogTitle>Don't Stop the Momentum</DialogTitle>
          </div>
          <DialogDescription className="pt-4 space-y-4">
            <ShowcaseCarousel />
            <p className="text-base text-foreground">
              You're creating amazing designs - unlock more renders instantly.
            </p>
            
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="text-sm text-muted-foreground mb-2">Your Current Plan</div>
              <div className="font-semibold capitalize mb-1">{currentPlan}</div>
              <div className="text-sm text-muted-foreground">
                {rendersUsed} of {renderLimit} renders used this month
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Get more renders now:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>✓ Instant access to additional renders</li>
                <li>✓ No waiting, no subscriptions changes</li>
                <li>✓ Keep your current plan benefits</li>
              </ul>
            </div>
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex flex-col gap-3 mt-4">
          <Button
            onClick={handleUpgradePlan}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            View Plans
          </Button>
          
          <Button
            variant="ghost"
            onClick={onClose}
            className="w-full text-muted-foreground"
          >
            Maybe Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
