import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * useAutoLinkWpw — fires wpw-oauth-link once per session if the user's
 * woo_customer_id is null. This catches WPW customers who logged in
 * through the normal login flow (without ?wpw=1) and never got linked.
 *
 * Safe to call on every dashboard mount — it no-ops if already linked
 * and only fires the edge function once per page session.
 */
export function useAutoLinkWpw() {
  const attempted = useRef(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;

        // Check if already linked
        const { data: sub } = await (supabase as any)
          .from("user_subscriptions")
          .select("woo_customer_id")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (sub?.woo_customer_id) {
          // Already linked — still try the 3-token grant in case the
          // user predates the token system. grant-wpw-tokens is fully
          // idempotent so this is safe to call every session.
          void grantWpwTokens(qc);
          return;
        }

        // Try to link
        const { data, error } = await supabase.functions.invoke("wpw-oauth-link", {
          body: { mode: "lookup" },
        });

        if (error || !data?.linked) return; // no WPW account found, that's fine

        // Linked! Invalidate so cards pick up the new data
        qc.invalidateQueries({ queryKey: ["wpw-orders"] });
        qc.invalidateQueries({ queryKey: ["is-wpw-tenant"] });
        qc.invalidateQueries({ queryKey: ["user-subscription"] });
        console.log("[auto-link-wpw] linked woo_customer_id:", data.woo_customer_id);

        // Grant the 3 try-and-buy tokens. Idempotent on the server —
        // if this user already received their grant in a prior session
        // the function no-ops.
        void grantWpwTokens(qc);
      } catch {
        // Silent fail — this is a best-effort background link
      }
    })();
  }, [qc]);
}

async function grantWpwTokens(qc: ReturnType<typeof useQueryClient>) {
  try {
    const { data, error } = await supabase.functions.invoke("grant-wpw-tokens", {
      body: {},
    });
    if (error) {
      console.warn("[auto-link-wpw] token grant invocation failed:", error.message);
      return;
    }
    if (data?.granted) {
      console.log(
        `[auto-link-wpw] granted ${data.amount} WPW tokens; new balance ${data.new_balance}`,
      );
      // Refresh anything that reads the token balance so the dashboard
      // strip flips from 0 → 3 immediately.
      qc.invalidateQueries({ queryKey: ["user-tokens"] });
      qc.invalidateQueries({ queryKey: ["token-balance"] });
      qc.invalidateQueries({ queryKey: ["user-subscription"] });

      // First-time grant → auto-launch the WPW Connect Portal wizard
      // so the shop immediately sees the "Here's what we just shipped"
      // step and the per-tier token explainer. The wizard listens for
      // this window event (src/components/onboarding/
      // WpwConnectPortalWizard.tsx). A short delay lets the dashboard
      // mount its own UI first so the wizard appears OVER a populated
      // dashboard, not a blank one.
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("restylepro:open-wpw-connect-portal"),
          );
        }, 600);
      }
    }
  } catch (e) {
    console.warn("[auto-link-wpw] token grant exception:", (e as Error).message);
  }
}
