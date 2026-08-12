import { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useLocation, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Klaviyo "claim your dashboard" deep-link:
  //   /login?email=jane@example.com&wpw=1
  const prefillEmail = searchParams.get("email") || "";
  const isWpwFlow = searchParams.get("wpw") === "1";

  const returnTo =
    (location.state as any)?.from || (isWpwFlow ? "/designpro" : "/dashboard");
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [useMagicLink, setUseMagicLink] = useState(isWpwFlow);
  const [showPassword, setShowPassword] = useState(false);
  const [wpwHint, setWpwHint] = useState(false);

  // If user already has an active session, redirect to home - NOT /designpro/premium.
  // The /designpro/premium redirect should only happen on a fresh login (form submit).
  // Exception: a WPW Klaviyo deep-link (?wpw=1) sends them to /designpro so
  // they land on the design tool with their 3 tokens visible, and runs
  // the auto-link in the background to pull in past orders if any.
  useEffect(() => {
    const checkExistingSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        if (isWpwFlow) {
          try {
            await supabase.functions.invoke("wpw-oauth-link", {
              body: { mode: "lookup" },
            });
          } catch (err) {
            console.warn("[login] wpw auto-link failed", err);
          }
          navigate("/designpro", { replace: true });
        } else {
          navigate("/dashboard", { replace: true });
        }
      }
    };
    checkExistingSession();
  }, [navigate, isWpwFlow]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      if (data.user) {
        // If coming from the Klaviyo "claim your dashboard" deep-link,
        // run the auto-link so their orders show up on first load.
        if (isWpwFlow) {
          try {
            await supabase.functions.invoke("wpw-oauth-link", {
              body: { mode: "lookup" },
            });
          } catch (linkErr) {
            console.warn("[login] wpw auto-link failed", linkErr);
          }
        }
        toast.success("Login successful!");
        navigate(returnTo, { replace: true });
      }
    } catch (error: any) {
      console.error("Login error:", error);
      const msg = String(error?.message || "").toLowerCase();
      const isInvalidCreds =
        msg.includes("invalid login credentials") ||
        msg.includes("invalid_credentials") ||
        msg.includes("invalid grant");
      if (isInvalidCreds) {
        setWpwHint(true);
        toast.error("That password doesn't match a RestylePro account.");
      } else {
        toast.error(error.message || "Failed to login");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error("Please enter your email address");
      return;
    }
    setLoading(true);

    try {
      // Preserve the ?wpw=1 flag through the magic-link round-trip so
      // the auto-link fires when the user clicks the link in their email.
      const redirectTo = isWpwFlow
        ? `${window.location.origin}/login?wpw=1`
        : `${window.location.origin}/dashboard`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });

      if (error) throw error;

      toast.success("Magic link sent! Check your email.");
    } catch (error: any) {
      console.error("Magic link error:", error);
      toast.error(error.message || "Failed to send magic link");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>Sign In - RestyleProAI</title>
        <meta name="description" content="Sign in to RestyleProAI to design vehicle wraps with AI. Access ColorPro, DesignPro, FadeWraps, and more." />
        <link rel="canonical" href="https://www.restyleproai.com/login" />
      </Helmet>

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          {/* Sprocket Beam Me Up */}
          <div className="flex justify-center mb-6">
            <img
              src="/sprocket/sprocket-beam.png"
              alt="Sprocket - Beam Me Up"
              className="w-32 h-32 sm:w-40 sm:h-40 object-contain drop-shadow-[0_0_20px_rgba(168,85,247,0.3)]"
              style={{ animation: 'float 3s ease-in-out infinite' }}
            />
          </div>
          <div className="bg-card border border-border rounded-lg p-8">
            <div className="text-center mb-4">
              <div className="text-[11px] font-semibold tracking-[0.2em] uppercase text-cyan-300/90">
                WPW × RestylePro Connect Portal
              </div>
            </div>
            <div className="flex items-center gap-3 mb-6">
              <img src="/characters/sproket/sproket-welcome.png" alt="SPROKET" className="w-12 h-12 object-contain" />
              <h1 className="text-2xl font-bold text-foreground">
                Sign In
              </h1>
            </div>

            {/* WePrintWraps Connect Portal hint — past WPW customers get a
                free dashboard with their full order history. Their first
                sign-in claims the account; magic link works without a
                password. Surfaces by default + as recovery after failed
                password attempt. */}
            <div className="mb-5 rounded-md border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs leading-relaxed text-cyan-100">
              <div className="font-semibold text-cyan-300 mb-1">
                Ordered from WePrintWraps before?
              </div>
              <div className="text-muted-foreground">
                Your free Connect Portal dashboard — with your full WPW order
                history — is already waiting. Claim it with{" "}
                <button
                  type="button"
                  onClick={() => { setUseMagicLink(true); setWpwHint(false); }}
                  className="underline text-cyan-300 hover:text-cyan-200"
                >
                  Magic Link
                </button>{" "}
                using your WPW email (no password needed), or{" "}
                <Link to="/signup" className="underline text-cyan-300 hover:text-cyan-200">
                  Sign Up
                </Link>
                {" "}— we'll auto-link every past order.
              </div>
            </div>

            {wpwHint && !useMagicLink && (
              <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
                <div className="font-semibold text-amber-300 mb-1">
                  Looks like you haven't claimed your dashboard yet.
                </div>
                <div className="text-amber-100/80">
                  Your WPW password doesn't carry over — your Connect Portal
                  account is claimed on first sign-in. Tap{" "}
                  <button
                    type="button"
                    onClick={() => { setUseMagicLink(true); setWpwHint(false); }}
                    className="underline text-amber-200 hover:text-amber-100 font-semibold"
                  >
                    Magic Link
                  </button>{" "}
                  and we'll email you a one-click claim link.
                </div>
              </div>
            )}

            {/* Toggle between password and magic link */}
            <div className="flex gap-2 mb-6">
              <Button
                type="button"
                variant={!useMagicLink ? "default" : "outline"}
                size="sm"
                onClick={() => setUseMagicLink(false)}
                className="flex-1"
              >
                Password
              </Button>
              <Button
                type="button"
                variant={useMagicLink ? "default" : "outline"}
                size="sm"
                onClick={() => setUseMagicLink(true)}
                className="flex-1"
              >
                Magic Link
              </Button>
            </div>
            
            {useMagicLink ? (
              <form onSubmit={handleMagicLink} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="mt-1"
                    placeholder="Enter your email"
                  />
                </div>
                
                <p className="text-sm text-muted-foreground">
                  We'll send you a secure link to sign in instantly. No password needed.
                </p>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? "Sending..." : "Send Magic Link"}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="password">Password</Label>
                  <div className="relative mt-1">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            )}

            <div className="mt-6 space-y-2 text-center text-sm">
              <Link
                to="/reset-password-request"
                className="text-primary hover:underline block"
              >
                Forgot password?
              </Link>
              <div className="text-muted-foreground">
                Don't have an account?{" "}
                <Link to="/signup" className="text-primary hover:underline">
                  Sign up
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>

    </div>
  );
};

export default Login;
