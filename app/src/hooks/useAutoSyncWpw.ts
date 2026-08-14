import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * useAutoSyncWpw — silently triggers wpw-sync-orders once per session
 * on dashboard mount, then invalidates dashboard query keys so cards
 * refetch with fresh data.
 *
 * Mirrors the existing manual Refresh button's behaviour minus the
 * toast — the user shouldn't see the spinner or success message
 * because this is a background freshness sync, not an explicit
 * refresh action.
 *
 * Without this, the dashboard reads from a Supabase mirror table
 * (wpw_orders) that only updates when (a) a WPW webhook fires or
 * (b) someone clicks Refresh. So a freshly-added or freshly-changed
 * WPW order may not appear until either trigger lands. Auto-syncing
 * on mount closes that gap for the common "user opens dashboard
 * after touching an order" case.
 */
export function useAutoSyncWpw() {
  const attempted = useRef(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;

        const { error } = await supabase.functions.invoke("wpw-sync-orders", {
          body: { days_back: 30, per_page: 100 },
        });
        if (error) return;

        qc.invalidateQueries({ queryKey: ["wpw-orders"] });
        qc.invalidateQueries({ queryKey: ["wpw-all-orders-admin"] });
        qc.invalidateQueries({ queryKey: ["wpw-all-rewards-admin"] });
        qc.invalidateQueries({ queryKey: ["pillar-wpw-orders"] });
        qc.invalidateQueries({ queryKey: ["pillar-wpw-past-jobs"] });
        qc.invalidateQueries({ queryKey: ["pillar-recent-activity"] });
        qc.invalidateQueries({ queryKey: ["dashboard-latest-quotes"] });
        qc.invalidateQueries({ queryKey: ["dashboard-business-metrics"] });
      } catch {
        // Best-effort background sync — silent failure
      }
    })();
  }, [qc]);
}
