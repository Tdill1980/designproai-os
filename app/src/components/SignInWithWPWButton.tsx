import { useState } from "react";
import { Link2, KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useLinkWpwAccount,
  useRequestWpwLinkOtp,
  useVerifyWpwLinkOtp,
} from "@/hooks/useWpwOrders";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  className?: string;
  /** If true, render the compact "link only" variant used on the
   * dashboard / post-signup, which expects the user to already be
   * authed. Defaults to false — the big, free-tier marketing button
   * shown on /signup + /login. */
  compact?: boolean;
  onLinked?: () => void;
}

type AltStage = "hidden" | "email" | "code";

/**
 * "Sign in with WePrintWraps" — the primary Phase 1 funnel button.
 *
 * Flow:
 *   1. Click → tries auto-link by the auth user's email.
 *   2. If that misses, an alt-email form opens. The user enters the
 *      email their WPW orders are under (any domain — gmail, yahoo,
 *      personal, anything).
 *   3. We send a 6-digit verification code to that email. The user
 *      enters the code to prove inbox ownership; we then link the
 *      matching WPW customer to their RestylePro account.
 *
 * This OTP path replaces the old same-domain guardrail so shops whose
 * WPW orders are under a personal/different-domain email can still
 * self-serve the link without admin help.
 */
export function SignInWithWPWButton({ className, compact, onLinked }: Props) {
  const link = useLinkWpwAccount();
  const requestOtp = useRequestWpwLinkOtp();
  const verifyOtp = useVerifyWpwLinkOtp();

  const [checking, setChecking] = useState(false);
  const [stage, setStage] = useState<AltStage>("hidden");
  const [altEmail, setAltEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");

  const tryAutoLink = async () => {
    setChecking(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.user) {
        toast.message(
          "Create your RestylePro account first — then we'll sync your WePrintWraps orders automatically on your next sign-in.",
          { duration: 6000 },
        );
        return;
      }
      const result = await link.mutateAsync();
      if (result.linked) {
        setStage("hidden");
        setAltEmail("");
        setOtpCode("");
        if (onLinked) onLinked();
      } else {
        // Auto-link by auth email failed — surface the alt-email OTP form
        setStage("email");
      }
    } finally {
      setChecking(false);
    }
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = altEmail.trim();
    if (!trimmed) return;
    const result = await requestOtp.mutateAsync(trimmed);
    if (result.sent) {
      toast.success(`Code sent to ${trimmed}`);
      setStage("code");
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = otpCode.trim();
    if (trimmed.length !== 6) return;
    const result = await verifyOtp.mutateAsync({ email: altEmail, code: trimmed });
    if (result.linked) {
      setStage("hidden");
      setAltEmail("");
      setOtpCode("");
      if (onLinked) onLinked();
    } else if (result.verified) {
      // Verified but no customer match — let the user try a different email
      setStage("email");
      setOtpCode("");
    }
  };

  const handleResend = async () => {
    const result = await requestOtp.mutateAsync(altEmail);
    if (result.sent) toast.success(`New code sent to ${altEmail}`);
  };

  const handleChangeEmail = () => {
    setStage("email");
    setOtpCode("");
  };

  const busyAuto = checking || link.isPending;
  const busySend = requestOtp.isPending;
  const busyVerify = verifyOtp.isPending;

  const altForm = stage === "email" ? (
    <form onSubmit={handleSendCode} className="mt-3 flex flex-col gap-2">
      {!compact && (
        <p className="text-xs text-white/70">
          Enter the email your WePrintWraps orders are under — any email,
          any domain. We'll send a 6-digit code to confirm it's yours.
        </p>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          type="email"
          placeholder="orders@youremail.com"
          value={altEmail}
          onChange={(e) => setAltEmail(e.target.value)}
          className={compact ? "h-9 text-sm" : "h-10"}
          autoFocus
        />
        <Button
          type="submit"
          size={compact ? "sm" : "default"}
          className={compact ? undefined : "h-10"}
          disabled={busySend || !altEmail.trim()}
        >
          <Mail className="h-4 w-4 mr-1.5" />
          {busySend ? "Sending…" : "Send code"}
        </Button>
      </div>
    </form>
  ) : stage === "code" ? (
    <form onSubmit={handleVerifyCode} className="mt-3 flex flex-col gap-2">
      <p className="text-xs text-white/70">
        We sent a 6-digit code to <span className="font-semibold text-white">{altEmail}</span>.
        Enter it below to finish linking. Code expires in 10 minutes.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="123456"
          value={otpCode}
          onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
          className={`tracking-[0.4em] text-center font-mono ${compact ? "h-9 text-sm" : "h-10 text-base"}`}
          autoFocus
        />
        <Button
          type="submit"
          size={compact ? "sm" : "default"}
          className={compact ? undefined : "h-10"}
          disabled={busyVerify || otpCode.length !== 6}
        >
          <KeyRound className="h-4 w-4 mr-1.5" />
          {busyVerify ? "Linking…" : "Verify & link"}
        </Button>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={handleResend}
          disabled={busySend}
          className="text-cyan-400 hover:text-cyan-300 underline disabled:opacity-50"
        >
          {busySend ? "Resending…" : "Resend code"}
        </button>
        <span className="text-white/30">·</span>
        <button
          type="button"
          onClick={handleChangeEmail}
          className="text-white/60 hover:text-white underline"
        >
          Use a different email
        </button>
      </div>
    </form>
  ) : null;

  if (compact) {
    return (
      <div className={className}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={tryAutoLink}
          disabled={busyAuto}
        >
          <Link2 className="h-4 w-4 mr-2" />
          {busyAuto ? "Linking…" : "Link WePrintWraps account"}
        </Button>
        {altForm}
      </div>
    );
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        className="w-full h-11 bg-white text-black hover:bg-gray-100 border-0 font-semibold"
        onClick={tryAutoLink}
        disabled={busyAuto}
      >
        <img
          src="/wpw-logo-mark.png"
          alt=""
          className="h-5 w-5 mr-2"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        {busyAuto ? "Connecting…" : "Sign in with WePrintWraps"}
      </Button>
      {altForm}
    </div>
  );
}
