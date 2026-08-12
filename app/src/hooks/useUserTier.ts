import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";

/**
 * localStorage key for the admin "View as customer" toggle.
 *
 * When set to "free", an admin/tester sees the platform with free-tier
 * gating instead of agency-tier bypass — their real account stays the
 * same, only the tier reported by useUserTier flips. Used to QA past
 * WPW orders, customer dashboards, render limits, etc. without having
 * to create a separate test account.
 *
 * Toggle UI lives in src/components/AdminViewAsCustomerToggle.tsx and
 * is only rendered when isAllowlistedAdmin(email) returns true.
 */
export const VIEW_AS_KEY = 'rp_view_as_customer';

function readViewAsOverride(): 'free' | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(VIEW_AS_KEY) === 'free' ? 'free' : null;
  } catch {
    return null;
  }
}

export const useUserTier = () => {
  const { data: subscription } = useQuery({
    queryKey: ['user-subscription'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) {
        return { tier: 'free', status: 'none' };
      }

      // Email allowlist check first — lets operators in immediately,
      // even before their user_roles row is synced or if RLS fails.
      if (isAllowlistedAdmin(user.email)) {
        // Admin "View as customer" override: when the toggle is on, an
        // allowlisted admin gets free-tier behaviour so they can QA the
        // customer dashboard / render limits / past-order surfaces under
        // their real account (and real WPW order history).
        if (readViewAsOverride() === 'free') {
          return { tier: 'free', status: 'active', viewAsCustomer: true };
        }
        return { tier: 'agency', status: 'active' };
      }

      // Check for admin or tester role first
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['admin', 'tester'])
        .limit(1)
        .maybeSingle();

      if (roleError) {
        console.error('Error checking user role (possible RLS issue):', roleError);
      }

      if (roleData) {
        if (readViewAsOverride() === 'free') {
          return { tier: 'free', status: 'active', viewAsCustomer: true };
        }
        return { tier: 'agency', status: 'active' };
      }

      const { data } = await supabase
        .from('user_subscriptions')
        .select('tier, status')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      return data || { tier: 'free', status: 'none' };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return subscription?.tier || 'free';
};
