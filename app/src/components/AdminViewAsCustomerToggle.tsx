/**
 * AdminViewAsCustomerToggle
 *
 * Floating pill (bottom-right) that lets an allowlisted admin flip their
 * tier reporting between "agency" (admin bypass) and "free" (real customer
 * gating) without changing any DB state. The toggle writes a localStorage
 * flag that useUserTier reads — see src/hooks/useUserTier.ts.
 *
 * Why: previously the only way to QA the customer dashboard, render
 * limits, or past-order surfaces was to sign up as a separate test user,
 * then borrow WPW orders via OTP. With this toggle, an admin can stay
 * signed in as themselves (so their real WPW order history loads) and
 * just flip the tier view.
 *
 * Hidden completely for non-admin emails so end users never see it.
 */
import { useEffect, useState } from "react";
import { Eye, ShieldCheck, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";
import { VIEW_AS_KEY } from "@/hooks/useUserTier";
import { cn } from "@/lib/utils";

function readFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(VIEW_AS_KEY) === "free";
  } catch {
    return false;
  }
}

export const AdminViewAsCustomerToggle = () => {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState<string | null>(null);
  const [viewingAsCustomer, setViewingAsCustomer] = useState<boolean>(readFlag);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setEmail(data.session?.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setEmail(session?.user?.email ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Only render for allowlisted admins
  if (!isAllowlistedAdmin(email)) return null;

  const toggle = () => {
    const next = !viewingAsCustomer;
    setViewingAsCustomer(next);
    try {
      if (next) localStorage.setItem(VIEW_AS_KEY, "free");
      else localStorage.removeItem(VIEW_AS_KEY);
    } catch {
      // ignore (storage disabled)
    }
    // Force every tier-aware component to re-read by invalidating the
    // user-subscription query and any caches keyed on tier.
    queryClient.invalidateQueries({ queryKey: ["user-subscription"] });
    queryClient.invalidateQueries({ queryKey: ["render-limits"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-quicktext-status"] });
  };

  const replayWizard = () => {
    if (typeof window === "undefined") return;
    // Fire the WPW Connect Portal tour — the customer-facing
    // "what you get as a WPW customer" tour. The generic
    // 7-step shop-setup wizard is fired separately and is not
    // what we want to preview here.
    window.dispatchEvent(new CustomEvent("restylepro:open-wpw-connect-portal"));
  };

  return (
    <div
      className={cn(
        "fixed bottom-24 left-4 z-[60] pointer-events-auto",
        "flex items-center gap-2",
      )}
    >
      {viewingAsCustomer && (
        <button
          type="button"
          onClick={replayWizard}
          title="Re-trigger the onboarding wizard so you can preview it as a fresh customer would see it."
          className={cn(
            "flex items-center gap-2 rounded-full px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider",
            "border shadow-lg transition-all",
            "bg-cyan-400 text-black border-cyan-300 hover:bg-cyan-300",
          )}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Replay Wizard
        </button>
      )}
      <button
        type="button"
        onClick={toggle}
        title={
          viewingAsCustomer
            ? "Currently seeing the customer view. Click to return to admin (agency tier)."
            : "Flip to the customer view (free tier) without leaving your admin account."
        }
        className={cn(
          "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider",
          "border shadow-lg transition-all",
          viewingAsCustomer
            ? "bg-amber-400 text-black border-amber-300 hover:bg-amber-300"
            : "bg-black/80 text-white border-white/20 hover:bg-black/90 backdrop-blur",
        )}
      >
        {viewingAsCustomer ? (
          <>
            <Eye className="w-3.5 h-3.5" />
            Viewing as Customer · Click to exit
          </>
        ) : (
          <>
            <ShieldCheck className="w-3.5 h-3.5" />
            View as Customer
          </>
        )}
      </button>
    </div>
  );
};
