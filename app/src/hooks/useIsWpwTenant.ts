import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isWpwTenantMember } from "@/lib/admin-allowlist";

/**
 * useIsWpwTenant
 *
 * Returns true when the signed-in user belongs to the WePrintWraps.com
 * enterprise tenant. The tenant signal is:
 *
 *   1. They linked their WPW customer account via `wpw-oauth-link`,
 *      which writes `user_subscriptions.woo_customer_id` — this is the
 *      durable "logged in with their WPW account" signal the owner
 *      described.
 *   2. OR they're on WPW_TENANT_ALLOWLIST (internal WPW team — Lance,
 *      Brice, Jackson, Troy, Trish, tdill) so the internal crew can QA
 *      the tenant view without a real Woo customer record.
 *
 * WPW tenants are free-tier by policy; callers on the QuickQuote,
 * render-limit, and upsell paths should short-circuit paywalls and
 * surface the WPW-branded catalog / design-tools upsell view.
 */
export function useIsWpwTenant() {
  return useQuery({
    queryKey: ["is-wpw-tenant"],
    queryFn: async (): Promise<boolean> => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return false;

      if (isWpwTenantMember(user.email)) return true;

      const { data } = await supabase
        .from("user_subscriptions")
        .select("woo_customer_id")
        .eq("user_id", user.id)
        .maybeSingle();

      return !!(data as { woo_customer_id: number | null } | null)?.woo_customer_id;
    },
    staleTime: 5 * 60 * 1000,
  });
}
