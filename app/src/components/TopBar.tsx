import { useState, useEffect, memo } from "react";
import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { supabase } from "@/integrations/supabase/client";

const RENDER_LIMITS: Record<string, number> = {
  starter: 20,
  advanced: 50,
  complete: 200,
  agency: 999999,
  free: 0,
};

const TopBarComponent = () => {
  const [user, setUser] = useState<any>(null);
  const { subscription } = useSubscriptionLimits();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data?.session?.user ?? null);
    });

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => authSubscription.unsubscribe();
  }, []);

  const displayName =
    user?.user_metadata?.first_name ||
    user?.email?.split("@")[0] ||
    "there";

  const limit =
    subscription ? RENDER_LIMITS[subscription.tier] || 0 : 0;
  const used = subscription?.render_count || 0;
  const usedPct =
    limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const isAgency = subscription?.tier === "agency";

  return (
    <header className="sticky top-0 z-[60] bg-black/95 backdrop-blur-sm border-b border-border/50">
      <div className="container mx-auto px-2 sm:px-4">
        <div className="flex items-center h-9 text-xs gap-2 sm:gap-3">
          <Link
            to="/"
            className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-white/10 transition-colors flex-shrink-0"
            aria-label="Home"
          >
            <Home className="h-4 w-4 text-blue-400" />
          </Link>

          {user && (
            <span className="text-muted-foreground font-medium truncate">
              Hi,{" "}
              <span className="text-foreground">{displayName}</span>
            </span>
          )}

          {user && subscription && !isAgency && (
            <Link
              to="/billing"
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border/40 bg-white/5 hover:bg-white/10 transition-colors flex-shrink-0"
            >
              <span className="font-semibold text-foreground">
                {used}
                <span className="text-muted-foreground font-normal">
                  /{limit}
                </span>
              </span>
              <div className="w-8 h-1 rounded-full bg-border/60 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-fuchsia-500 transition-all duration-300"
                  style={{ width: `${usedPct}%` }}
                />
              </div>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};

export const TopBar = memo(TopBarComponent);
