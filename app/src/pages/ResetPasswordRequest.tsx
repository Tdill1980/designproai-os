import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ResetPasswordRequest = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Use our custom edge function (Resend on verified restyleproai.com
      // domain) instead of supabase.auth.resetPasswordForEmail, which relies
      // on Supabase's rate-limited built-in SMTP and frequently fails to
      // deliver. The edge function mints a recovery link via the admin API
      // and emails it reliably.
      const { data, error } = await supabase.functions.invoke(
        "send-password-reset",
        {
          body: {
            email: email.trim().toLowerCase(),
            redirectTo: `${window.location.origin}/reset-password`,
          },
        }
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setSent(true);
      toast.success("Password reset email sent! Check your inbox.");
    } catch (error: any) {
      console.error("Password reset error:", error);
      toast.error(error.message || "Failed to send reset email");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-lg p-8">
            <h1 className="text-2xl font-bold text-foreground mb-6">Reset Password</h1>
            
            {sent ? (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  We've sent a password reset link to <strong>{email}</strong>. 
                  Please check your inbox and follow the instructions.
                </p>
                <Link to="/login">
                  <Button variant="outline" className="w-full">
                    Back to Sign In
                  </Button>
                </Link>
              </div>
            ) : (
              <>
                <p className="text-muted-foreground mb-6">
                  Enter your email address and we'll send you a link to reset your password.
                </p>
                
                <form onSubmit={handleResetRequest} className="space-y-4">
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

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full"
                  >
                    {loading ? "Sending..." : "Send Reset Link"}
                  </Button>
                </form>

                <div className="mt-6 text-center text-sm text-muted-foreground">
                  Remember your password?{" "}
                  <Link to="/login" className="text-primary hover:underline">
                    Sign in
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </main>

    </div>
  );
};

export default ResetPasswordRequest;
