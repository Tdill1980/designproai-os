import { useEffect, useRef } from "react";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import { useIsWpwInternalStaff } from "@/hooks/useIsWpwInternalStaff";
import { supabase } from "@/integrations/supabase/client";

const SEEN_KEY_PREFIX = "restylepro:wpw-portal-seen:";

/**
 * useAutoOpenWpwPortal — auto-opens the WPW Connect Portal wizard the
 * first time a newly-linked WPW customer lands on the dashboard.
 *
 * The wizard is the same WpwConnectPortalWizard mounted globally in
 * App.tsx. We just fire its open event (restylepro:open-wpw-connect-portal)
 * once, on first qualifying mount, so a WPW customer doesn't have to
 * discover the cyan "WPW Connect Portal" badge to see what they get.
 *
 * Safety rails (all must pass before firing):
 *   1. User is authenticated (session present)
 *   2. User is a WPW tenant (useIsWpwTenant === true)
 *   3. User is NOT internal DesignProAI/WPW staff — they've seen the tour
 *   4. localStorage flag for this user.id is not already set
 *   5. Hook's own ref hasn't fired this mount (idempotent on re-render)
 *
 * Pairs with useAutoLinkWpw: the link hook can asynchronously flip
 * is-wpw-tenant from false → true; this effect re-runs when that
 * resolves, then fires the wizard for first-timers.
 */
export function useAutoOpenWpwPortal() {
  const fired = useRef(false);
  const { data: isWpwTenant, isLoading: tenantLoading } = useIsWpwTenant();
  const { data: isWpwInternalStaff, isLoading: staffLoading } = useIsWpwInternalStaff();

  useEffect(() => {
    if (fired.current) return;
    if (tenantLoading || staffLoading) return;
    if (!isWpwTenant) return;
    if (isWpwInternalStaff) return;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const key = `${SEEN_KEY_PREFIX}${session.user.id}`;
      if (localStorage.getItem(key)) return;

      // Mark seen BEFORE dispatch so a render race can't double-fire.
      localStorage.setItem(key, new Date().toISOString());
      fired.current = true;

      // Small delay so the dashboard hero card paints first and the
      // wizard doesn't slam in before the user gets oriented.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("restylepro:open-wpw-connect-portal"));
      }, 1500);
    })();
  }, [isWpwTenant, isWpwInternalStaff, tenantLoading, staffLoading]);
}
