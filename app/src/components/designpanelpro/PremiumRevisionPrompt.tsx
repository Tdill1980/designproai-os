import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// Keywords/phrases that indicate a major redesign (>50% change).
// Users should order a new design instead of abusing revision renders.
const MAJOR_CHANGE_PATTERNS = [
  /\bcompletely\s+(change|redesign|redo|replace|different|new)\b/i,
  /\b(totally|entirely)\s+(change|different|new|redesign|redo|replace)\b/i,
  /\bmake\s+it\s+(completely|totally|entirely)\s+different\b/i,
  /\bnew\s+(design|wrap|look|style|concept)\b/i,
  /\b(redesign|redo|start\s+over|start\s+from\s+scratch|from\s+scratch)\b/i,
  /\b(change|replace|swap)\s+(everything|the\s+entire|the\s+whole|all)\b/i,
  /\bdifferent\s+(design|wrap|look|style|concept|color\s+scheme|pattern)\b/i,
  /\bscrap\s+(this|it|the\s+design)\b/i,
  /\b(remove|strip|delete)\s+(everything|all|the\s+entire|the\s+whole)\b/i,
];

function isMajorChangeRequest(prompt: string): boolean {
  return MAJOR_CHANGE_PATTERNS.some(pattern => pattern.test(prompt));
}

/**
 * Data shape for a revision request. Structured for future NeuralNetwork
 * DNA wiring - revision_parent_id links to the original design_dna record.
 */
export interface RevisionRequest {
  revisionText: string;
  revisionParentId: string | null;
  revisionDepth: number;
}

interface PremiumRevisionPromptProps {
  /** Called when user submits a revision request */
  onRevisionSubmit: (request: RevisionRequest) => Promise<void>;
  /** Whether a revision/generation is currently in progress */
  isGenerating: boolean;
  /** ID of the current design DNA record (for revision_parent_id) */
  currentDesignId: string | null;
  /** How many revisions have been made on this design chain */
  revisionCount: number;
  /** Max free revisions included per generation */
  freeRevisions?: number;
}

export const PremiumRevisionPrompt = ({
  onRevisionSubmit,
  isGenerating,
  currentDesignId,
  revisionCount,
  freeRevisions = 2,
}: PremiumRevisionPromptProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [revisionText, setRevisionText] = useState("");
  const [showMajorChangeWarning, setShowMajorChangeWarning] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!revisionText.trim()) return;

    // Block major redesign requests - user should order a new design instead
    if (isMajorChangeRequest(revisionText)) {
      setShowMajorChangeWarning(true);
      toast({
        title: "Major redesign detected",
        description: "Revisions are for small adjustments. For a completely new design, please generate a new render instead.",
        variant: "destructive",
      });
      return;
    }

    setShowMajorChangeWarning(false);
    await onRevisionSubmit({
      revisionText: revisionText.trim(),
      revisionParentId: currentDesignId,
      revisionDepth: revisionCount + 1,
    });
    setRevisionText("");
    setIsExpanded(false);
  };

  const isFree = revisionCount < freeRevisions;
  const revisionLabel = isFree
    ? `Revision ${revisionCount + 1} of ${freeRevisions} (free)`
    : `Revision ${revisionCount + 1}`;

  return (
    <div className="space-y-3">
      {/* Primary button - always visible after render */}
      {!isExpanded ? (
        <Button
          onClick={() => setIsExpanded(true)}
          variant="outline"
          className={cn(
            "w-full gap-2 font-semibold border-2 border-blue-500/40",
            "bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/60",
            "text-blue-400 transition-all"
          )}
          disabled={isGenerating}
        >
          <Pencil className="w-4 h-4" />
          Revise This Design
        </Button>
      ) : (
        <div
          className={cn(
            "rounded-lg border-2 border-blue-500/40 bg-blue-500/5 p-4 space-y-3",
            "shadow-[0_0_15px_rgba(0,199,255,0.1)]"
          )}
        >
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-semibold text-foreground">
                Revise This Design
              </span>
            </div>
            <span className="text-[11px] text-blue-400/80 font-medium">
              {revisionLabel}
            </span>
          </div>

          {/* Revision text input */}
          <Textarea
            placeholder={
              "What would you like to change?\nExamples: Make the phone number bigger, change blue to red, add flames to the hood, adjust the lighting"
            }
            value={revisionText}
            onChange={(e) => {
              setRevisionText(e.target.value);
              if (showMajorChangeWarning) setShowMajorChangeWarning(false);
            }}
            className={cn(
              "min-h-[90px] bg-background/80 resize-none",
              "border-blue-500/30 focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30",
              "placeholder:text-muted-foreground/60"
            )}
            disabled={isGenerating}
          />

          {showMajorChangeWarning && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
              <div className="text-xs text-destructive">
                <p className="font-semibold">This looks like a major redesign</p>
                <p className="mt-1">Revisions are for small, precise adjustments. For a completely new design, please generate a new render.</p>
              </div>
            </div>
          )}

          {/* Action row */}
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSubmit}
              disabled={isGenerating || !revisionText.trim()}
              className="flex-1 btn-designiq text-white font-semibold border-0 gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Revising...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Revise Design
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsExpanded(false);
                setRevisionText("");
              }}
              className="text-muted-foreground hover:text-foreground"
              disabled={isGenerating}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
