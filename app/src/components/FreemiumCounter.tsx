import { Sparkles, Gift, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface FreemiumCounterProps {
  phase: 'free' | 'engagement' | 'bonus' | 'paywall';
  totalRemaining: number;
  isPrivileged: boolean;
}

export const FreemiumCounter = ({ phase, totalRemaining, isPrivileged }: FreemiumCounterProps) => {
  if (isPrivileged) {
    return (
      <Badge variant="outline" className="text-xs border-green-500/50 text-green-400">
        <Sparkles className="h-3 w-3 mr-1" />
        Unlimited Access
      </Badge>
    );
  }

  if (phase === 'free' || phase === 'bonus') {
    return (
      <Badge variant="outline" className="text-xs border-blue-500/50 text-blue-400">
        <Sparkles className="h-3 w-3 mr-1" />
        {totalRemaining} free render{totalRemaining !== 1 ? 's' : ''} left
      </Badge>
    );
  }

  if (phase === 'engagement') {
    return (
      <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-400">
        <Gift className="h-3 w-3 mr-1" />
        Share for 2 more renders
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-xs border-red-500/50 text-red-400">
      <Lock className="h-3 w-3 mr-1" />
      Upgrade for more
    </Badge>
  );
};
