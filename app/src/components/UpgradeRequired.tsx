import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface UpgradeRequiredProps {
  isOpen: boolean;
  onClose: () => void;
  requiredTier: "starter" | "advanced" | "complete";
  featureName?: string;
}

export const UpgradeRequired = ({ 
  isOpen, 
  onClose, 
  requiredTier,
  featureName = "This feature"
}: UpgradeRequiredProps) => {
  const navigate = useNavigate();

  const tierNames = {
    starter: "RestylePro Starter",
    advanced: "RestylePro Advanced",
    complete: "RestylePro Complete"
  };

  const handleUpgrade = () => {
    navigate('/pricing');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upgrade Required</DialogTitle>
          <DialogDescription className="pt-4">
            {featureName} requires {tierNames[requiredTier]} or higher.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex gap-3 mt-4">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpgrade}
            className="flex-1 bg-black hover:bg-gray-800 text-white"
          >
            View Plans
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
