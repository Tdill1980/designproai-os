import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

// If a sb-{ref}-auth-token key exists in localStorage, the user has a stored
// session even if getSession() is hung — we can render the app and let the
// inner queries refresh the JWT themselves rather than blocking on a Promise
// that never settles (mobile Safari edge case observed in production).
function hasStoredSupabaseSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) return true;
    }
  } catch {
    // localStorage may throw in private modes — treat as no session
  }
  return false;
}

export const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stuck, setStuck] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let resolved = false;

    // Hard ceiling on the auth check. If getSession() never resolves
    // (observed on some mobile Safari sessions), fall through optimistically
    // when a stored session token exists; otherwise treat as anon.
    const hardTimeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      if (hasStoredSupabaseSession()) {
        // Optimistic: stored token exists, render the app. Inner Supabase
        // queries will hit getUser() / refreshSession() themselves and either
        // succeed or show their own error states.
        setUser({ id: "stored-session-pending-resolve" });
      } else {
        setUser(null);
      }
      setLoading(false);
    }, 6000);

    // Visual hint at 4s so the user knows something can be tapped.
    const stuckHint = setTimeout(() => setStuck(true), 4000);

    // Use getSession() instead of getUser() — getUser() makes a network call
    // that fails on expired JWT. getSession() uses cached session and auto-refreshes.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(hardTimeout);
      clearTimeout(stuckHint);
      setUser(session?.user ?? null);
      setLoading(false);
      // If session exists but is near expiry, proactively refresh
      if (session && (session.expires_at ?? 0) * 1000 - Date.now() < 120_000) {
        supabase.auth.refreshSession();
      }
    }).catch(() => {
      if (resolved) return;
      resolved = true;
      clearTimeout(hardTimeout);
      clearTimeout(stuckHint);
      // getSession() rejected — treat as optimistic if a stored token exists
      setUser(hasStoredSupabaseSession() ? { id: "stored-session-pending-resolve" } : null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Once the auth client recovers, replace any optimistic stub with the real user
      setUser(session?.user ?? null);
    });

    return () => {
      clearTimeout(hardTimeout);
      clearTimeout(stuckHint);
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] bg-black px-4 text-center">
        <img
          src="/characters/sproket/sproket-loading.png"
          alt="Loading"
          className="w-20 h-20 animate-bounce"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        {stuck && (
          <>
            <p className="text-white/60 text-sm mt-6 max-w-xs">
              Still loading? Your browser may have a stale cache.
            </p>
            <Button
              onClick={() => {
                try {
                  // Drop chunk-refresh guard so ErrorBoundary can retry on next reload
                  sessionStorage.removeItem("chunk-refresh");
                  sessionStorage.removeItem("chunk_reload");
                } catch {/* ignore */}
                window.location.reload();
              }}
              className="mt-4 bg-[#00C7FF] hover:bg-[#00B0E0] text-black font-bold px-6"
            >
              Reload
            </Button>
          </>
        )}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] bg-black px-4 text-center">
        <img
          src="/characters/sproket/sproket-welcome.png"
          alt="SPROKET"
          className="w-32 h-32 mb-6 drop-shadow-[0_0_20px_rgba(0,199,255,0.3)]"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <h1 className="text-2xl font-bold text-white mb-2 font-[Oswald]">
          Hold up, space cadet!
        </h1>
        <p className="text-zinc-400 max-w-md mb-6 text-sm leading-relaxed">
          SPROKET here — you need to be logged in to access this tool.
          Sign in or create an account to start designing wraps.
        </p>
        <div className="flex gap-3">
          <Button
            onClick={() => navigate("/login", { state: { from: location.pathname } })}
            className="bg-[#00C7FF] hover:bg-[#00B0E0] text-black font-bold px-6"
          >
            Log In
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/signup", { state: { from: location.pathname } })}
            className="border-zinc-600 text-zinc-300 hover:bg-zinc-800 px-6"
          >
            Sign Up
          </Button>
        </div>
        <p className="text-zinc-600 text-xs mt-8">
          RestyleProAI — Vehicle Wrap Design System
        </p>
      </div>
    );
  }

  return <>{children}</>;
};
