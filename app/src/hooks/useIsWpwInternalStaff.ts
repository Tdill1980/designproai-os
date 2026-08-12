import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isWpwInternalStaffMember } from "@/lib/admin-allowlist";

/**
 * useIsWpwInternalStaff
 *
 * Returns true ONLY for the internal RestylePro / WePrintWraps team
 * (allowlist-only). Distinct from `useIsWpwTenant`, which returns true
 * for any onboarded WPW shop tenant including paying customers.
 *
 * Use this hook to gate admin-wide analytics views — "all-customer
 * revenue", "all-orders status board", cross-tenant aggregates — so
 * an onboarded WPW shop tenant only ever sees their own data and
 * cannot view other shops' orders, revenue, or rewards.
 *
 * Rule:
 *   - useIsWpwTenant       → "is this person on a WPW shop dashboard?"
 *   - useIsWpwInternalStaff → "is this person on RestylePro/WPW payroll?"
 */
export function useIsWpwInternalStaff() {
  return useQuery({
    queryKey: ["is-wpw-internal-staff"],
    queryFn: async (): Promise<boolean> => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return false;
      return isWpwInternalStaffMember(user.email);
    },
    staleTime: 5 * 60 * 1000,
  });
}
