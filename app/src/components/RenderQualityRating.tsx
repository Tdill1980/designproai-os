import { useState } from "react";
import { Star, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface RenderQualityRatingProps {
  renderId: string;
  renderType: 'designpanelpro' | 'inkfusion' | 'colorpro' | 'wbty' | 'fadewraps' | 'graphicspro';
  renderUrl: string;
  // Optional fields for golden template saving
  promptSignature?: string;
  vehicleSignature?: string;
  allRenderUrls?: Record<string, string>;
  // NeuralNetwork feedback wiring
  designDnaId?: string | null;
}

export const RenderQualityRating = ({
  renderId,
  renderType,
  renderUrl,
  promptSignature,
  vehicleSignature,
  allRenderUrls,
  designDnaId
}: RenderQualityRatingProps) => {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [flagReason, setFlagReason] = useState("");
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const [showFlagReason, setShowFlagReason] = useState(false);
  const { toast } = useToast();

  const handleRatingSubmit = async (isFlagged: boolean) => {
    if (!isFlagged && rating === 0) {
      toast({
        title: "Rating Required",
        description: "Please select a rating before submitting.",
        variant: "destructive",
      });
      return;
    }

    if (isFlagged && !flagReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please provide a reason for flagging this render.",
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
          user_email: email || null,
          rating: isFlagged ? null : rating,
          is_flagged: isFlagged,
          flag_reason: isFlagged ? flagReason : null,
          notes: notes || null,
        });

      if (error) throw error;

      // NeuralNetwork feedback and golden template saving DISABLED -
      // these feedback loops were injecting data back into render prompts
      // via neuralnetwork-retrieve RAG and golden template cache,
      // causing prompt bloat and quality degradation.
      // Rating data is preserved in render_quality_ratings for analytics.

      toast({
        title: isFlagged ? "Render Flagged" : "Rating Submitted",
        description: isFlagged
          ? "Thank you for flagging this render. Our team will review it."
          : "Thank you for your feedback!",
      });

      // Reset form
      setRating(0);
      setFlagReason("");
      setNotes("");
      setEmail("");
      setShowFlagReason(false);
      setOpen(false);
    } catch (error) {
      console.error('Error submitting rating:', error);
      toast({
        title: "Submission Failed",
        description: "Unable to submit your feedback. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Star className="h-4 w-4" />
          Rate Quality
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rate Render Quality</DialogTitle>
          <DialogDescription>
            Help us improve by rating this render's photorealistic quality
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Quality Rating</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className="p-1 transition-transform hover:scale-110"
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                >
                  <Star
                    className={`h-6 w-6 ${
                      star <= (hoverRating || rating)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-gray-300'
                    }`}
                  />
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              1 = Poor, 5 = Excellent
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email (Optional)</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did you like or dislike about this render?"
              rows={3}
            />
          </div>

          {!showFlagReason ? (
            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => handleRatingSubmit(false)}
                disabled={isSubmitting || rating === 0}
                className="flex-1"
              >
                Submit Rating
              </Button>
              <Button
                onClick={() => setShowFlagReason(true)}
                disabled={isSubmitting}
                variant="destructive"
                className="flex-1 gap-2"
              >
                <Flag className="h-4 w-4" />
                Flag Issue
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="flag-reason">Reason for Flagging</Label>
                <Textarea
                  id="flag-reason"
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  placeholder="Describe what's wrong with this render (e.g., finish looks incorrect, pattern distorted, not photorealistic)"
                  rows={3}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => setShowFlagReason(false)}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => handleRatingSubmit(true)}
                  disabled={isSubmitting || !flagReason.trim()}
                  variant="destructive"
                  className="flex-1"
                >
                  Submit Flag
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
