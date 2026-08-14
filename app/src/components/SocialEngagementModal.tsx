import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Gift, Sparkles, Users, Clock, Check, Zap } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface SocialEngagementModalProps {
  open: boolean;
  onClose: () => void;
  onUnlock: (email: string) => Promise<{ success: boolean }>;
}

export const SocialEngagementModal = ({ open, onClose, onUnlock }: SocialEngagementModalProps) => {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleUnlock = async () => {
    if (!email || !email.includes("@")) {
      toast({
        title: "Valid email required",
        description: "Please enter a valid email address to unlock your free renders.",
        variant: "destructive"
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onUnlock(email);
      if (result.success) {
        toast({
          title: "🎉 2 Bonus Renders Unlocked!",
          description: "You now have 2 additional free renders. Check your email for exclusive deals!",
        });
        onClose();
      }
    } catch (error) {
      toast({
        title: "Something went wrong",
        description: "Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center mb-2">
            <div className="relative">
              <Gift className="h-12 w-12 text-primary animate-pulse" />
              <Sparkles className="h-5 w-5 text-yellow-500 absolute -top-1 -right-1" />
            </div>
          </div>
          <DialogTitle className="text-center text-2xl">
            Unlock 2 FREE Bonus Renders
          </DialogTitle>
          <DialogDescription className="text-center pt-2">
            Join 497+ wrap shops already using RestylePro
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Value proposition */}
          <div className="bg-primary/10 rounded-lg p-4 space-y-2">
            <p className="text-sm font-medium text-center">What you'll get:</p>
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                <span>2 additional high-quality renders (instant)</span>
              </li>
              <li className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                <span>Exclusive wrap shop discounts & tips</span>
              </li>
              <li className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                <span>Early access to new features</span>
              </li>
            </ul>
          </div>

          {/* Social proof */}
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>497+ wrap professionals trust RestylePro</span>
          </div>

          {/* Email input */}
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              Your business email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="you@yourshop.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full"
            />
          </div>

          {/* Urgency */}
          <div className="flex items-center justify-center gap-2 text-xs text-orange-600 dark:text-orange-400">
            <Clock className="h-3 w-3" />
            <span>Limited time offer - unlock now before it expires</span>
          </div>

          {/* CTA Button */}
          <Button 
            onClick={handleUnlock} 
            disabled={isSubmitting || !email}
            className="w-full bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
            size="lg"
          >
            {isSubmitting ? (
              "Unlocking..."
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Unlock My Free Renders
              </>
            )}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            No spam, ever. Unsubscribe anytime.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
