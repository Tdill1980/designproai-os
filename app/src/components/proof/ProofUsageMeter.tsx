/**
 * ProofUsageMeter
 *
 * Reusable card showing the shop owner's WPrewards tier + remaining proofs
 * this month. Color shifts green → amber → red as the cap approaches.
 *
 * Used by:
 *   - /proofs dashboard (header)
 *   - Phase 7+ : RestyleDashboard widget
 */

import { useProofAllowance } from "@/hooks/useProofAllowance";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ClipboardSignature, Sparkles, Palette, Loader2, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface ProofUsageMeterProps {
  /** When true, render a more compact card suitable for inclusion in the
      main dashboard. Defaults to the full version used on /proofs. */
  compact?: boolean;
}

// Per-tier monthly caps (mirrored from the wprewards_tiers seed). Used here
// only to compute the progress bar fill — display values come from the RPC.
const TIER_CAP: Record<string, number> = {
  Free: 0,
  Bronze: 5,
  Silver: 25,
  Gold: 100,
  Platinum: -1,
};

export const ProofUsageMeter = ({ compact = false }: ProofUsageMeterProps) => {
  const { data: allowance, isLoading } = useProofAllowance();

  if (isLoading) {
    return (
      <Card className="p-4 flex items-center justify-center text-zinc-500">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span className="text-sm">Loading usage…</span>
      </Card>
    );
  }
  if (!allowance) {
    return (
      <Card className="p-4 text-sm text-zinc-500">
        Sign in to see your proof usage.
      </Card>
    );
  }

  const cap = TIER_CAP[allowance.tier] ?? -1;
  const isUnlimited = cap < 0;
  const used = isUnlimited ? 0 : Math.max(0, cap - allowance.remaining);
  const percent = isUnlimited ? 100 : cap === 0 ? 0 : Math.min(100, Math.round((used / cap) * 100));

  const tone =
    isUnlimited
      ? "from-purple-500 to-blue-500 text-white border-transparent"
      : allowance.remaining > Math.max(2, cap * 0.4)
      ? "from-green-50 to-emerald-50 text-green-900 border-green-200"
      : allowance.remaining > 0
      ? "from-amber-50 to-amber-50 text-amber-900 border-amber-200"
      : "from-red-50 to-red-50 text-red-900 border-red-200";

  return (
    <Card className={cn(
      "p-5 bg-gradient-to-br border",
      tone,
      compact && "p-4",
    )}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardSignature className="w-5 h-5" />
            <h3 className={cn("font-semibold", compact ? "text-sm" : "text-base")}>
              Proof Approvals
            </h3>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-bold uppercase tracking-wider",
                isUnlimited
                  ? "bg-white/20 text-white border-white/30"
                  : "bg-white/70 border-current/20",
              )}
            >
              {allowance.tier}
            </Badge>
          </div>
          <p className={cn("opacity-80", compact ? "text-xs mt-0.5" : "text-sm mt-1")}>
            {isUnlimited
              ? "Unlimited proofs this month."
              : `${allowance.remaining} of ${cap} proof${cap === 1 ? "" : "s"} remaining this month.`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {!isUnlimited && (
            <div className="text-right">
              <div className={cn("font-bold", compact ? "text-2xl" : "text-3xl")}>
                {allowance.remaining}
              </div>
              <div className="text-[10px] uppercase tracking-wider opacity-70">left</div>
            </div>
          )}
          {isUnlimited && (
            <div className={cn("font-bold", compact ? "text-2xl" : "text-3xl")}>∞</div>
          )}
        </div>
      </div>

      {!isUnlimited && (
        <div className="mt-3">
          <Progress value={percent} className="h-1.5 bg-white/40" />
        </div>
      )}

      <div className={cn(
        "mt-4 flex items-center gap-3 text-xs flex-wrap",
        isUnlimited ? "text-white/80" : "opacity-75",
      )}>
        <span className="flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          {allowance.ai_revisions_per_proof} AI revision{allowance.ai_revisions_per_proof === 1 ? "" : "s"}/proof
        </span>
        <span className="flex items-center gap-1">
          <Palette className="w-3 h-3" />
          {allowance.white_label_enabled ? "White-label enabled" : "RestylePro footer"}
        </span>
      </div>

      {!compact && (
        <div className="mt-4 flex gap-2">
          <Button asChild variant="outline" size="sm" className={cn(
            isUnlimited && "bg-white/15 border-white/40 text-white hover:bg-white/25 hover:text-white",
          )}>
            <Link to="/proofs">
              View all proofs <ArrowRight className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </div>
      )}
    </Card>
  );
};
