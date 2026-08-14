import { useEffect, useRef, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { onSessionExpired } from "@/lib/session-expired-emitter";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LogIn } from "lucide-react";

// Keep the named export so any existing static imports don't break,
// but the real trigger now comes through the emitter.
export function triggerSessionExpiredModal() {
  // no-op — wired via onSessionExpired emitter now
}

export const SessionGuard = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const [showExpired, setShowExpired] = useState(false);
  const hasShownExpired = useRef(false);

  const handleExpired = useCallback(() => {
    if (hasShownExpired.current) return;
    hasShownExpired.current = true;
    setShowExpired(true);
  }, []);

  // Subscribe to session-expired events from the supabase client interceptor
  useEffect(() => {
    onSessionExpired(handleExpired);
  }, [handleExpired]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") {
        console.log("[SessionGuard] Token refreshed successfully");
        toast("Refreshing your session\u2026", {
          duration: 2000,
          id: "session-refresh",
        });
      }

      if (event === "SIGNED_OUT") {
        console.log("[SessionGuard] Session ended");
        // Clear per-tab DesignPro state that must NOT survive a logout.
        // VisionBoard references live in sessionStorage so they persist
        // through a render cycle; sessionStorage outlives logout→login in
        // the same tab, so a returning (or different) user would otherwise
        // see the previous session's uploaded references. Wipe them here.
        try {
          sessionStorage.removeItem("designiq_visionboard_images_v1");
          sessionStorage.removeItem("designiq_visionboard_intent_v1");
        } catch { /* ignore */ }
        // Only show modal if user was previously signed in (unexpected sign-out)
        // Check if this was triggered by the user clicking "sign out" — if so,
        // they're already navigating away. We detect unexpected sign-out by
        // checking if the modal hasn't been shown yet and we're not on /login.
        if (
          window.location.pathname !== "/login" &&
          window.location.pathname !== "/signup"
        ) {
          handleExpired();
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [handleExpired]);

  const handleSignIn = () => {
    setShowExpired(false);
    hasShownExpired.current = false;
    // Clear any stale auth state
    supabase.auth.signOut().catch(() => {});
    navigate("/login", { replace: true });
  };

  return (
    <>
      {children}
      <Dialog open={showExpired} onOpenChange={() => {}}>
        <DialogContent
          className="sm:max-w-md"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="flex flex-col items-center text-center">
            <img
              src="/characters/sproket/sproket-welcome.png"
              alt="SPROKET"
              className="w-24 h-24 mb-2 drop-shadow-[0_0_15px_rgba(0,199,255,0.3)]"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <DialogTitle className="text-lg font-bold">
              Hey! Your session expired
            </DialogTitle>
            <DialogDescription className="pt-1">
              SPROKET here — please sign back in to keep designing. Your work is saved!
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-4">
            <Button onClick={handleSignIn} className="w-full bg-[#00C7FF] hover:bg-[#00B0E0] text-black font-bold">
              <LogIn className="h-4 w-4 mr-2" />
              Sign Back In
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
