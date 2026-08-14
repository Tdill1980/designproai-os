import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAffiliateProfile } from "@/hooks/useAffiliateData";
import { LogIn, Loader2, DollarSign, Mail } from "lucide-react";
import { toast } from "sonner";

const Affiliate = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const { data: profile, isLoading: profileLoading } = useAffiliateProfile();

  // If already logged in with an active affiliate profile, redirect to dashboard
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        setCheckingSession(false);
      }
    });
  }, []);

  useEffect(() => {
    if (profileLoading) return;
    if (profile) {
      if (profile.status === "pending") {
        navigate("/affiliate/join", { replace: true });
      } else if (profile.status === "approved" || profile.status === "active") {
        // Force Stripe Connect before the dashboard — affiliates who haven't
        // linked a payout account are routed to the connect-bank surface.
        if (profile.stripe_onboarded) {
          navigate("/affiliate/dashboard", { replace: true });
        } else {
          navigate("/affiliate/onboarding", { replace: true });
        }
      } else {
        setCheckingSession(false);
      }
    } else {
      setCheckingSession(false);
    }
  }, [profile, profileLoading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Logged in! Redirecting to your dashboard...");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async () => {
    if (!email) {
      toast.error("Please enter your email address first");
      return;
    }
    setMagicLinkLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/affiliate`,
        },
      });
      if (error) {
        toast.error(error.message);
      } else {
        setMagicLinkSent(true);
        toast.success("Magic link sent! Check your email.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setMagicLinkLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email) {
      toast.error("Please enter your email address first");
      return;
    }
    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast.error(error.message);
      } else {
        setResetSent(true);
        toast.success("Password reset email sent! Check your inbox.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setResetLoading(false);
    }
  };

  if (checkingSession || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>MightyAffiliate - Earn with DesignProAI</title>
        <meta name="description" content="Join MightyAffiliate by DesignProAI. Earn commissions by referring wrap shops to the world's first prompt-to-production vehicle wrap design software. Design it. Panel it. Print it." />
        <link rel="canonical" href="https://designproai.com/affiliate" />
      </Helmet>

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md space-y-6">
          {/* Branding */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-semibold">
              <DollarSign className="w-4 h-4" />
              MightyAffiliate
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              <span className="text-foreground">Mighty</span>
              <span className="text-gradient-blue">Affiliate</span>
              <span className="text-muted-foreground text-lg font-normal ml-2">by DesignProAI</span>
            </h1>
            <p className="text-muted-foreground">
              Sign in to your affiliate dashboard
            </p>
          </div>

          {/* Login Card */}
          <Card className="bg-card border-border">
            <CardContent className="p-6">
              {resetSent ? (
                <div className="text-center py-4 space-y-3">
                  <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
                    <Mail className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Reset link sent!</h3>
                  <p className="text-sm text-muted-foreground">
                    Check <span className="text-foreground font-medium">{email}</span> for a password reset link.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setResetSent(false)}
                    className="text-muted-foreground"
                  >
                    Back to login
                  </Button>
                </div>
              ) : magicLinkSent ? (
                <div className="text-center py-4 space-y-3">
                  <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                    <Mail className="h-7 w-7 text-green-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Check your email!</h3>
                  <p className="text-sm text-muted-foreground">
                    We sent a login link to <span className="text-foreground font-medium">{email}</span>. Click the link in the email to sign in.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setMagicLinkSent(false)}
                    className="text-muted-foreground"
                  >
                    Back to login
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="mt-1"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="mt-1"
                      required
                    />
                    <Button
                      type="button"
                      variant="link"
                      className="text-xs text-muted-foreground p-0 h-auto mt-1"
                      disabled={resetLoading}
                      onClick={handleResetPassword}
                    >
                      {resetLoading ? "Sending..." : "Forgot password?"}
                    </Button>
                  </div>
                  <Button
                    type="submit"
                    className="w-full gap-2"
                    size="lg"
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="h-4 w-4" />
                    )}
                    {loading ? "Signing in..." : "Sign In"}
                  </Button>

                  <div className="relative my-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">or</span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2"
                    size="lg"
                    disabled={magicLinkLoading}
                    onClick={handleMagicLink}
                  >
                    {magicLinkLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                    {magicLinkLoading ? "Sending..." : "Send me a login link"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          {/* Join link */}
          <div className="text-center text-sm text-muted-foreground">
            Not an affiliate yet?{" "}
            <Button
              variant="link"
              className="text-primary p-0 h-auto text-sm"
              onClick={() => navigate("/affiliate/join")}
            >
              Apply to join the program
            </Button>
          </div>
        </div>
      </main>

    </div>
  );
};

export default Affiliate;
