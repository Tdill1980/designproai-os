import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";

export const RequireAdmin = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState<
    "loading" | "authorized" | "denied" | "unauthenticated"
  >("loading");

  useEffect(() => {
    let done = false;
    const finish = (s: "authorized" | "denied" | "unauthenticated") => {
      if (done) return;
      done = true;
      setStatus(s);
    };

    const evaluate = async (user: { id?: string; email?: string } | undefined | null) => {
      if (done) return;
      if (!user) {
        // Signed out entirely — send to login (with a way back) instead of
        // silently bouncing to the homepage, which reads as "the page is gone".
        finish("unauthenticated");
        return;
      }

      // Email allowlist fallback — lets new operators in immediately
      // even before the user_roles row is synced.
      if (isAllowlistedAdmin(user.email)) {
        finish("authorized");
        return;
      }

      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "tester"])
        .limit(1)
        .maybeSingle();

      finish(data ? "authorized" : "denied");
    };

    // Drive off onAuthStateChange (fires INITIAL_SESSION with the cached
    // session immediately) rather than getSession(), which can hang on a
    // token refresh and leave the gate spinning forever.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => { evaluate(session?.user); }
    );

    // Safety net: if no event arrives, fall through to the redirect instead
    // of an endless spinner.
    const timeout = setTimeout(() => finish("unauthenticated"), 6000);

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
  if (status === "unauthenticated") {
    // Login honors location.state.from as the post-login destination.
    return <Navigate to="/login" state={{ from: window.location.pathname }} replace />;
  }
  if (status === "denied") return <Navigate to="/" replace />;
  return <>{children}</>;
};
