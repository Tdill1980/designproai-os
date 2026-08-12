import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Index from "@/pages/Index";

/**
 * Route guard for "/".
 *
 * - If the user is signed in, redirect to /dashboard (RestyleDashboard)
 * - If not signed in, render the public marketing homepage (Index.tsx)
 *
 * Renders nothing (invisible) while the auth check is in flight to avoid a
 * marketing-page flash for authed users.
 */
// Synchronously detect a persisted Supabase session from localStorage so a
// logged-in user is redirected to /dashboard INSTANTLY, even when
// onAuthStateChange/getSession stall (multi-tab auth-lock contention). If the
// stored token turns out to be stale, /dashboard's RequireAuth handles it.
const hasStoredSession = (): boolean => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token") && localStorage.getItem(k)) {
        return true;
      }
    }
  } catch {
    // ignore (privacy mode / no storage)
  }
  return false;
};

export const AuthedRootRedirect = () => {
  const [status, setStatus] = useState<"checking" | "authed" | "anon">(
    () => (hasStoredSession() ? "authed" : "checking")
  );

  useEffect(() => {
    let cancelled = false;

    // Drive the auth decision off onAuthStateChange. Supabase fires an
    // INITIAL_SESSION event immediately on subscribe with the current session,
    // and it does so without the token-refresh round-trip that can make
    // getSession() hang for several seconds. Relying on the listener means an
    // authed user gets redirected to /dashboard as soon as the session lands,
    // even when getSession() stalls.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setStatus(session?.user ? "authed" : "anon");
    });

    // Safety net: if the listener never reports (no event within the window),
    // fall back to the public marketing page instead of hanging on a blank
    // screen. A later event still corrects the status.
    const timeout = setTimeout(() => {
      if (!cancelled) setStatus((s) => (s === "checking" ? "anon" : s));
    }, 2500);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  if (status === "checking") {
    // Invisible spacer — no loading spinner so marketing page doesn't flash
    return <div className="min-h-[100dvh] bg-background" />;
  }

  if (status === "authed") {
    return <Navigate to="/dashboard" replace />;
  }

  return <Index />;
};
