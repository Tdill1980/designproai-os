import { useState, useEffect } from "react";
import { Star, Flag, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface PostRenderFeedbackPromptProps {
  renderId: string;
  renderType: 'designpanelpro' | 'inkfusion' | 'colorpro' | 'wbty' | 'fadewraps' | 'graphicspro';
  renderUrl: string;
  onDismiss: () => void;
  // Optional fields for golden template saving
  promptSignature?: string;
  vehicleSignature?: string;
  allRenderUrls?: Record<string, string>;
}

const STORAGE_KEY = 'rated-render-ids';

export const PostRenderFeedbackPrompt = ({
  renderId,
  renderType,
  renderUrl,
  onDismiss,
  promptSignature,
  vehicleSignature,
  allRenderUrls
}: PostRenderFeedbackPromptProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [showFlagInput, setShowFlagInput] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  // Check if already rated this render
  useEffect(() => {
    const ratedIds = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (ratedIds.includes(renderId)) {
      return; // Already rated, don't show
    }

    // Show prompt after 5 seconds
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 5000);

    return () => clearTimeout(timer);
  }, [renderId]);

  const markAsRated = () => {
    const ratedIds = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!ratedIds.includes(renderId)) {
      ratedIds.push(renderId);
      // Keep only last 100 to avoid storage bloat
      if (ratedIds.length > 100) {
        ratedIds.shift();
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ratedIds));
    }
  };

  const handleStarClick = async (selectedRating: number) => {
    setRating(selectedRating);
    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from('render_quality_ratings')
        .insert({
          render_id: renderId,
          render_type: renderType,
          rating: selectedRating,
          is_flagged: false,
        });

      if (error) throw error;

      // Golden template saving DISABLED - was feeding stale cached renders
      // back into the pipeline instead of generating fresh AI renders.

      toast({
        title: "Thanks!",
        description: "Your rating helps us improve",
      });

      markAsRated();
      setIsVisible(false);
      onDismiss();
    } catch (error) {
      console.error('Error submitting rating:', error);
      toast({
        title: "Couldn't save rating",
        description: "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFlagSubmit = async () => {
    if (!flagReason.trim()) {
      toast({
        title: "Please describe the issue",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from('render_quality_ratings')
        .insert({
          render_id: renderId,
          render_type: renderType,
          is_flagged: true,
          flag_reason: flagReason,
        });

      if (error) throw error;

      toast({
        title: "Issue Reported",
        description: "Our team will review this render",
      });

      markAsRated();
      setIsVisible(false);
      onDismiss();
    } catch (error) {
      console.error('Error flagging render:', error);
      toast({
        title: "Couldn't submit report",
        description: "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    markAsRated();
    setIsVisible(false);
    onDismiss();
  };

  if (!isVisible) return null;

  return (
    <div className={cn(
      "mt-4 p-4 rounded-xl border border-border/50 bg-gradient-to-r from-secondary/80 to-secondary/40",
      "animate-fade-in shadow-lg"
    )}>
      {!showFlagInput ? (
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">How did this render turn out?</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleSkip}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Star Rating */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  disabled={isSubmitting}
                  className={cn(
                    "p-1 transition-all hover:scale-110 disabled:opacity-50",
                    isSubmitting && "cursor-not-allowed"
                  )}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => handleStarClick(star)}
                >
                  <Star
                    className={cn(
                      "h-7 w-7 transition-colors",
                      star <= (hoverRating || rating)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-muted-foreground/40'
                    )}
                  />
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setShowFlagInput(true)}
                disabled={isSubmitting}
              >
                <Flag className="h-3 w-3 mr-1" />
                Flag Issue
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={handleSkip}
                disabled={isSubmitting}
              >
                Skip
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Your feedback helps us improve AI quality
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Flag Input Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-destructive">
              <Flag className="w-4 h-4" />
              <span className="text-sm font-medium">What's wrong with this render?</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowFlagInput(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <Textarea
            value={flagReason}
            onChange={(e) => setFlagReason(e.target.value)}
            placeholder="e.g., Colors look wrong, pattern distorted, not photorealistic..."
            rows={2}
            className="text-sm"
          />

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFlagInput(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleFlagSubmit}
              disabled={isSubmitting || !flagReason.trim()}
            >
              {isSubmitting ? "Submitting..." : "Submit Report"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
