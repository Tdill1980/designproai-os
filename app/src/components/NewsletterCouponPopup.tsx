import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { trackLead } from "@/lib/pixel";
import { Gift, Tag, ArrowRight, Check, X } from "lucide-react";

const STORAGE_KEY = "newsletter_coupon_joined";
const SESSION_KEY = "newsletter_popup_seen";

interface NewsletterCouponPopupProps {
  /** How many card clicks before the popup triggers (default: 3) */
  triggerAfterClicks?: number;
  /** Delay in ms before auto-showing on scroll (0 = disabled) */
  scrollDelayMs?: number;
}

export function NewsletterCouponPopup({
  triggerAfterClicks = 3,
  scrollDelayMs = 0,
}: NewsletterCouponPopupProps) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);
  const [clickCount, setClickCount] = useState(0);

  // Check if already joined
  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "true") {
      setHasJoined(true);
    }
  }, []);

  // Listen for card click events dispatched by gallery/marketplace
  useEffect(() => {
    if (hasJoined) return;

    const handler = () => {
      setClickCount((c) => {
        const next = c + 1;
        if (next >= triggerAfterClicks && !sessionStorage.getItem(SESSION_KEY)) {
          setIsOpen(true);
          sessionStorage.setItem(SESSION_KEY, "true");
        }
        return next;
      });
    };

    window.addEventListener("gallery-card-click", handler);
    return () => window.removeEventListener("gallery-card-click", handler);
  }, [hasJoined, triggerAfterClicks]);

  // Show on deep scroll (bottom of page)
  useEffect(() => {
    if (hasJoined || scrollDelayMs <= 0) return;

    const handleScroll = () => {
      if (isOpen) return;
      const scrolledToBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 200;
      if (scrolledToBottom && !sessionStorage.getItem(SESSION_KEY)) {
        setIsOpen(true);
        sessionStorage.setItem(SESSION_KEY, "true");
      }
    };

    const timer = setTimeout(() => {
      window.addEventListener("scroll", handleScroll);
    }, scrollDelayMs);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [hasJoined, isOpen, scrollDelayMs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email");
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from("email_subscribers")
        .upsert(
          { email: email.toLowerCase().trim(), source: "gallery_coupon" } as any,
          { onConflict: "email" }
        );
      if (error) throw error;
      localStorage.setItem(STORAGE_KEY, "true");
      setIsSubmitted(true);
      setHasJoined(true);
      trackLead();
      toast.success("Coupon code sent! Check your email.");
    } catch (error: any) {
      console.error("Newsletter signup error:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (hasJoined) return null;

  return (
    <>
      {/* Floating CTA badge */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-20 sm:bottom-6 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 group"
          style={{
            background: "linear-gradient(135deg, #00E5FF, #8B5CF6)",
          }}
        >
          <Tag className="w-4 h-4 text-white group-hover:animate-pulse" />
          <span className="text-sm font-bold text-white">Get 5% Off</span>
        </button>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent
          className="max-w-[380px] p-0 border-0 bg-[#0a0a0a] rounded-2xl shadow-2xl overflow-hidden"
          overlayClassName="bg-black/70"
        >
          {/* Gradient header bar */}
          <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg, #00E5FF, #8B5CF6, #E040FB)" }} />

          <div className="px-6 pt-5 pb-6">
            {isSubmitted ? (
              /* Success state */
              <div className="text-center py-4">
                <img src="/characters/sproket/sproket-success.png" alt="SPROKET" className="w-16 h-16 object-contain mx-auto mb-3" />
                <h3 className="text-xl font-bold text-white mb-2">You're In!</h3>
                <p className="text-sm text-[#888] mb-2">
                  Your <span className="text-[#00E5FF] font-bold">5% off</span> coupon code:
                </p>
                <div className="bg-[#111] border border-[#00E5FF]/30 rounded-xl py-3 px-4 mb-4">
                  <span className="text-2xl font-black tracking-widest text-[#00E5FF] font-mono">GALLERY5</span>
                </div>
                <p className="text-xs text-[#666] mb-4">
                  Also sent to your email. Use at checkout on any plan.
                </p>
                <Button
                  onClick={() => {
                    setIsOpen(false);
                    navigate("/pricing");
                  }}
                  className="w-full h-11 text-sm font-bold bg-[#00E5FF] text-black hover:bg-[#00E5FF]/90 rounded-xl"
                >
                  View Plans <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>
            ) : (
              /* Signup form */
              <>
                <div className="text-center mb-5">
                  <img src="/characters/sproket/sproket-moneybag2.png" alt="SPROKET" className="w-16 h-16 object-contain mx-auto mb-2" />
                  <h3 className="text-xl font-bold text-white mb-1">
                    Get <span className="text-[#00E5FF]">5% Off</span> Your First Plan
                  </h3>
                  <p className="text-sm text-[#888]">
                    Join our newsletter for exclusive deals, new features, and a coupon code.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                  <Input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 bg-[#111] border-white/10 text-white placeholder:text-[#555] text-base rounded-xl"
                    disabled={isSubmitting}
                    required
                  />
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full h-12 text-sm font-bold rounded-xl text-white"
                    style={{
                      background: "linear-gradient(135deg, #00E5FF, #8B5CF6)",
                    }}
                  >
                    {isSubmitting ? "Joining..." : "Send My Coupon Code"}
                  </Button>
                </form>

                <p className="text-[10px] text-[#555] text-center mt-3">
                  No spam. Unsubscribe anytime. Coupon applies to any plan.
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
