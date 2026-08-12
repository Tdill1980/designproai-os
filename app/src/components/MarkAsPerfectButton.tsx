import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MarkAsPerfectButtonProps {
  promptSignature: string;
  vehicleSignature: string;
  renderUrls: Record<string, string>;
  sourceVisualizationId?: string;
  className?: string;
}

// Golden template cache DISABLED - ratings are collected for analytics only.
// The cache was serving stale renders instead of fresh AI generations.
export const MarkAsPerfectButton = ({ className }: MarkAsPerfectButtonProps) => {
  return (
    <Button
      disabled
      variant="outline"
      size="sm"
      className={`gap-2 opacity-50 cursor-not-allowed ${className}`}
      title="Golden template cache is disabled"
    >
      <Star className="h-4 w-4" />
      Mark as Perfect
    </Button>
  );
};
