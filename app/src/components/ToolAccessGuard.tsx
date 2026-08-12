import { ReactNode } from "react";
import { useToolAccess } from "@/hooks/useToolAccess";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Lock } from "lucide-react";
import { Link } from "react-router-dom";

interface ToolAccessGuardProps {
  toolName: string;
  children: ReactNode;
}

export const ToolAccessGuard = ({ toolName, children }: ToolAccessGuardProps) => {
  const { hasAccess, isTryMode, requiredTierLabel, upgradeUrl } = useToolAccess(toolName);

  // Free tier users get "try it" mode — they can browse the tool UI.
  // Rendering itself is paywalled at generation time via useSubscriptionLimits.
  if (!hasAccess && !isTryMode) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="max-w-2xl w-full p-8 text-center space-y-6">
          <div className="flex justify-center">
            <div className="rounded-full p-6 bg-primary/10">
              <Lock className="w-12 h-12 text-primary" />
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-foreground">
              Upgrade Required
            </h2>
            <p className="text-lg text-muted-foreground">
              This tool requires a <span className="font-semibold text-primary">{requiredTierLabel}</span> subscription or higher.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-muted-foreground">
              Unlock this tool and access the full <span className="text-foreground font-semibold">Restyle</span><span className="text-gradient-blue font-semibold">ProAI™</span> Suite to create stunning 3D wrap visualizations.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <Button size="lg" asChild>
              <Link to={upgradeUrl}>
                View Pricing Plans
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/dashboard">
                Back to Dashboard
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
};
