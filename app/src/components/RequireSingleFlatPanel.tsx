import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { canSeeSingleFlatPanel } from "@/lib/admin-allowlist";

/**
 * RequireSingleFlatPanel — gates /admin/panel-batch to the
 * Single Flat Panel allowlist (Trish, Jackson, Carley).
 */
export const RequireSingleFlatPanel = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState<"loading" | "authorized" | "denied">("loading");

  useEffect(() => {
    let done = false;
    const decide = (user: { email?: string } | undefined | null) => {
      if (done) return;
      done = true;
      setStatus(user && canSeeSingleFlatPanel(user.email) ? "authorized" : "denied");
    };

    // Drive off onAuthStateChange (fires INITIAL_SESSION with the cached
    // session immediately) rather than getSession(), which can hang on a
    // token refresh and leave the gate spinning forever.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => decide(session?.user)
    );

    // Safety net: if no event arrives, fall through to the login redirect
    // instead of an endless spinner.
    const timeout = setTimeout(() => decide(null), 6000);

    return () => {
      done = true;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  if (status === "loading") return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "80vh" }}>
      <div style={{ width: 40, height: 40, border: "4px solid rgba(59,130,246,0.3)", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
  if (status === "denied") return <Navigate to="/login" replace />;
  return <>{children}</>;
};
