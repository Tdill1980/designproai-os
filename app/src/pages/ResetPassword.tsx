import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";

type SessionState = "checking" | "ready" | "invalid";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // When the user clicks the recovery link in the email, Supabase
  // establishes a short-lived session via detectSessionInUrl. We listen
  // for the PASSWORD_RECOVERY event (or an existing session) before
  // enabling the form. Without a valid session, updateUser() would
  // silently fail with "Auth session missing".
  useEffect(() => {
    let resolved = false;

    const authSub = supabase.auth.onAuthStateChange((event, session) => {
      if (resolved) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        resolved = true;
        setSessionState("ready");
      }
    });

    // Fallback: check for an existing session (in case the auth event
    // already fired before this listener attached) and start an expiry
    // timer so we don't hang forever on an invalid/expired link.
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && !resolved) {
        resolved = true;
        setSessionState("ready");
      }
    })();

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        setSessionState("invalid");
      }
    }, 4000);

    return () => {
      clearTimeout(timeout);
      authSub.data.subscription.unsubscribe();
    };
  }, []);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) throw error;

      // Sign out so the user has to log in with their new password —
      // avoids leaving a stale recovery session lying around.
      await supabase.auth.signOut();

      toast.success("Password updated! Please sign in with your new password.");
      navigate("/login");
    } catch (error: any) {
      console.error("Password update error:", error);
      toast.error(error.message || "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-lg p-8">
            <h1 className="text-2xl font-bold text-foreground mb-6">Set New Password</h1>

            {sessionState === "checking" && (
              <p className="text-muted-foreground text-sm">
                Verifying your reset link...
              </p>
            )}

            {sessionState === "invalid" && (
              <div className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  This password reset link is invalid or has expired. Please request a new one.
                </p>
                <Link to="/reset-password-request">
                  <Button className="w-full">Request New Reset Link</Button>
                </Link>
              </div>
            )}

            {sessionState === "ready" && (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <Label htmlFor="password">New Password</Label>
                  <div className="relative mt-1">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      className="pr-10"
                      autoComplete="new-password"
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum 6 characters
                  </p>
                </div>

                <div>
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <div className="relative mt-1">
                    <Input
                      id="confirmPassword"
                      type={showConfirm ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={6}
                      className="pr-10"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm((v) => !v)}
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? "Updating..." : "Update Password"}
                </Button>
              </form>
            )}
          </div>
        </div>
      </main>

    </div>
  );
};

export default ResetPassword;
