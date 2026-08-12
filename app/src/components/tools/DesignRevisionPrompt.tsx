import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sparkles, ChevronDown, Loader2, Wand2, MessageSquarePlus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

// Keywords/phrases that indicate a major redesign (>50% change) rather than a minor revision.
// These requests should be rejected to prevent render abuse - users should order a new design instead.
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

interface DesignRevisionPromptProps {
  onRevisionSubmit: (revisionPrompt: string) => Promise<void>;
  isGenerating: boolean;
  disabled?: boolean;
  /** When provided, shows a "Move / reposition elements" button that opens the
   *  Revision Studio precision editor (LayerLift + drag-to-place). This edits
   *  the render in place instead of re-rendering the whole image, so the clean
   *  background never warps. */
  onPrecisionEdit?: () => void;
}

export const DesignRevisionPrompt = ({
  onRevisionSubmit,
  isGenerating,
  disabled = false,
  onPrecisionEdit,
}: DesignRevisionPromptProps) => {
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [isOpen, setIsOpen] = useState(!disabled);
  const [showMajorChangeWarning, setShowMajorChangeWarning] = useState(false);
  const { toast } = useToast();

  // Auto-open when disabled changes from true → false (first render completes)
  useEffect(() => {
    if (!disabled) {
      setIsOpen(true);
    }
  }, [disabled]);

  const handleSubmit = async () => {
    // Empty box → tell them to enter the edits instead of silently no-op'ing.
    if (!revisionPrompt.trim()) {
      toast({
        title: "Enter your edits first",
        description: "Type the change you want (e.g. \"make the stripe red, move the logo lower\") before tapping Regenerate.",
        variant: "destructive",
      });
      return;
    }

    // Block major redesign requests - user should order a new design instead
    if (isMajorChangeRequest(revisionPrompt)) {
      setShowMajorChangeWarning(true);
      toast({
        title: "Major redesign detected",
        description: "Revisions are for small adjustments (lighting, color tweaks, finish changes). For a completely new design, please generate a new render instead.",
        variant: "destructive",
      });
      return;
    }

    setShowMajorChangeWarning(false);
    await onRevisionSubmit(revisionPrompt.trim());
    setRevisionPrompt("");
  };

  const suggestionChips = [
    "Make the colors more vibrant",
    "Add more contrast",
    "Make it darker/moodier",
    "Brighter lighting",
    "Cleaner background",
    "Make it more glossy",
    "Add metallic sheen",
    "Darken the hood only",
    "Increase saturation",
  ];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className={cn(
        "border transition-all duration-300",
        disabled 
          ? "bg-gradient-to-r from-purple-500/5 to-pink-500/5 border-purple-500/20 opacity-80"
          : "bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-purple-500/30 hover:border-purple-500/50"
      )}>
        <CollapsibleTrigger className="w-full p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn(
                "p-1.5 rounded-md",
                disabled ? "bg-purple-500/10" : "bg-purple-500/20"
              )}>
                <MessageSquarePlus className={cn(
                  "w-4 h-4",
                  disabled ? "text-purple-400/60" : "text-purple-400"
                )} />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-sm font-semibold",
                    disabled ? "text-foreground/60" : "text-foreground"
                  )}>
                    AI Design Revisions
                  </span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400">
                    PRO
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {disabled ? "Generate a render first to enable revisions" : "Request changes via text prompt"}
                </span>
              </div>
            </div>
            <ChevronDown className={cn(
              "w-4 h-4 transition-transform text-muted-foreground",
              isOpen && "rotate-180"
            )} />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4">
            {disabled ? (
              <div className="text-center py-4 text-muted-foreground text-sm">
                <Wand2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>Generate your first render to unlock AI-powered revisions</p>
                <p className="text-xs mt-1 text-muted-foreground/70">
                  Request changes like "make it darker" or "add more gloss"
                </p>
              </div>
            ) : (
              <>
                {/* Precision editor handoff — physically move/reposition logos &
                    text in Revision Studio (LayerLift). Edits in place so the
                    clean background never warps the way a full re-render does. */}
                {onPrecisionEdit && (
                  <div>
                    <button
                      onClick={onPrecisionEdit}
                      disabled={isGenerating}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold text-sm hover:from-cyan-600 hover:to-blue-600 transition-colors disabled:opacity-50"
                    >
                      <Wand2 className="w-4 h-4" />
                      Move or reposition logos &amp; text →
                    </button>
                    <p className="text-[11px] text-cyan-300/80 text-center mt-1.5">
                      Opens the precision editor — drag a logo or text into place, or lift &amp; remove it, without re-rendering (keeps the background clean).
                    </p>
                    <div className="flex items-center gap-3 my-3">
                      <div className="flex-1 h-px bg-border/60" />
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">or describe a change</span>
                      <div className="flex-1 h-px bg-border/60" />
                    </div>
                  </div>
                )}
                <div>
                  <Label htmlFor="revision-prompt" className="text-xs text-muted-foreground mb-2 block">
                    Describe what you'd like changed in the render
                  </Label>
                  <Textarea
                    id="revision-prompt"
                    placeholder="e.g., Make the wrap color more saturated, adjust the lighting to be warmer, add more gloss..."
                    value={revisionPrompt}
                    onChange={(e) => {
                      setRevisionPrompt(e.target.value);
                      if (showMajorChangeWarning) setShowMajorChangeWarning(false);
                    }}
                    className="min-h-[80px] bg-background/50 border-border/50 resize-none"
                    disabled={isGenerating}
                  />
                </div>

                {/* Quick suggestion chips */}
                <div className="flex flex-wrap gap-2">
                  {suggestionChips.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setRevisionPrompt(suggestion)}
                      disabled={isGenerating}
                      className="px-3 py-1.5 text-xs bg-background/50 border border-border/50 rounded-full hover:bg-primary/10 hover:border-primary/30 transition-colors disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>

                {showMajorChangeWarning && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
                    <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                    <div className="text-xs text-destructive">
                      <p className="font-semibold">This looks like a major redesign</p>
                      <p className="mt-1">Revisions are for small, precise adjustments - not full redesigns. Please generate a new render for major changes.</p>
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleSubmit}
                  disabled={isGenerating}
                  className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Regenerating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Regenerate with Revision
                    </>
                  )}
                </Button>

                <p className="text-xs text-muted-foreground/70 text-center">
                  Revisions apply small, precise changes to your existing render
                </p>
              </>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
