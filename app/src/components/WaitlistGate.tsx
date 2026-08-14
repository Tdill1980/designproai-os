import { ReactNode, useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Lock, Gift, Check, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

interface WaitlistGateProps {
  children: ReactNode;
  toolName: string;
}

export const WaitlistGate = ({ children, toolName }: WaitlistGateProps) => {
  const [hasAccess, setHasAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showGate, setShowGate] = useState(false);
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  useEffect(() => {
    const checkAccess = async () => {
      // Check localStorage first
      const waitlistJoined = localStorage.getItem("waitlist_joined") === "true";
      if (waitlistJoined) {
        setHasAccess(true);
        setIsLoading(false);
        return;
      }

      // Check if user has admin or tester role
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (user) {
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .in('role', ['admin', 'tester'])
          .limit(1)
          .maybeSingle();

        if (roleData) {
          setHasAccess(true);
          setIsLoading(false);
          return;
        }
      }

      // No access - show gate
      setShowGate(true);
      setIsLoading(false);
    };

    checkAccess();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      toast.error("Please enter a valid email");
      return;
    }

    setIsSubmitting(true);
    
    try {
      const { error } = await supabase
        .from('email_subscribers')
        .upsert(
          { email: email.toLowerCase().trim(), source: 'tool_gate_signup' },
          { onConflict: 'email' }
        );

      if (error) throw error;

      localStorage.setItem("waitlist_joined", "true");
      setIsSubmitted(true);
      toast.success("Welcome! You now have access to the tools.");
      setTimeout(() => {
        setHasAccess(true);
        setShowGate(false);
      }, 1500);
    } catch (error: any) {
      console.error('Signup error:', error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return null; // Or a loading spinner
  }

  if (hasAccess) {
    return <>{children}</>;
  }

  return (
    <Dialog open={showGate} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden border-0 bg-transparent [&>button]:hidden">
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl border border-white/10 shadow-2xl">
          {/* Header */}
          <div className="px-8 pt-8 pb-6 text-center border-b border-white/10">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/20 rounded-full mb-4">
              <Lock className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              Unlock {toolName}
            </h2>
            <p className="text-slate-400">
              Join our waitlist to access the full DesignProAI™ Vehicle Wrap Design Suite
            </p>
          </div>

          {/* Content */}
          <div className="px-8 py-6">
            {isSubmitted ? (
              <div className="text-center py-6">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500/20 rounded-full mb-4">
                  <Check className="w-8 h-8 text-green-400" />
                </div>
                <p className="text-xl font-semibold text-white mb-1">You're In!</p>
                <p className="text-slate-400">Loading {toolName}...</p>
              </div>
            ) : (
              <>
                <div className="bg-white/5 rounded-xl p-5 mb-6 border border-white/10">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-primary/20 rounded-lg">
                      <Gift className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-1">
                        Get Early Access
                      </h3>
                      <p className="text-slate-400 text-sm leading-relaxed">
                        Enter your email to unlock all visualization tools and get <span className="text-primary font-semibold">5 free renders</span>.
                      </p>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <Input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-primary"
                    disabled={isSubmitting}
                  />
                  <Button 
                    type="submit" 
                    className="w-full h-12 text-base font-semibold"
                    disabled={isSubmitting}
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {isSubmitting ? "Unlocking..." : "Unlock Tools"}
                  </Button>
                </form>

                <div className="mt-6 text-center">
                  <Link 
                    to="/gallery" 
                    className="text-sm text-primary hover:text-primary/80 underline underline-offset-4"
                  >
                    Or browse the Gallery first →
                  </Link>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-8 pb-6 text-center">
            <p className="text-xs text-slate-500">
              No spam, ever. Unsubscribe anytime.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
