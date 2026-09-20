import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { observeAuthSession } from "@/lib/observe-auth-session";

// Session events can finish before the initial read. The observer orders them
// and keeps an unresolved/failed check separate from an authenticated identity.
export const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stuck, setStuck] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Visual hint at 4s so the user knows something can be tapped.
    const stuckHint = setTimeout(() => setStuck(true), 4000);
    const stop = observeAuthSession(supabase.auth, ({ user, unavailable }) => {
      clearTimeout(stuckHint);
      setUser(user);
      setUnavailable(unavailable);
      setLoading(false);
      setStuck(false);
    });

    return () => {
      clearTimeout(stuckHint);
      stop();
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
          {unavailable
            ? "We couldn’t verify your session. Sign in again to continue."
            : "SPROKET here — you need to be logged in to access this tool. Sign in or create an account to start designing wraps."}
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
          DesignProAI — Prompt-Based Design + Production-Ready File Output
        </p>
      </div>
    );
  }

  return <>{children}</>;
};
