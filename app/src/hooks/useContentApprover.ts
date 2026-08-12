/**
 * useContentApprover — "may this person approve content?"
 *
 * The Brand Board sits behind RequireAuth, not RequireAdmin, so the whole team
 * can reach it and upload their back catalog. Approving is the higher-up's
 * call, so the approve/reject controls gate on this.
 *
 * Same two-source check RequireAdmin uses: the `user_roles` table is the
 * source of truth, with the in-code admin allowlist as the frontend fallback
 * so a newly added operator is not locked out waiting on a role sync.
 *
 * EVERY approval gate in the content system must come through here. Approver
 * lists written inline are how a SECOND admin gets locked out: the Engine Room
 * approval board carried `const APPROVERS = ["trish@weprintwraps.com"]` and
 * printed "Waiting on Trish to approve" at every other admin — including
 * Jackson, who holds the `admin` role in `user_roles` AND sits on the allowlist,
 * and could approve everywhere else in the app. A hardcoded string cannot be
 * granted, revoked or audited, and nothing about it fails loudly when it is
 * wrong; it simply tells one person they are not trusted.
 *
 * ── WHY THE ROLE LOOKUP RUNS OUTSIDE THE AUTH CALLBACK ─────────────────────
 * supabase-js holds its auth lock for the duration of an `onAuthStateChange`
 * callback, so awaiting another supabase call inside it can deadlock. This hook
 * used to `await supabase.from("user_roles")` in exactly that position. An
 * ALLOWLISTED admin returned before the await and never noticed; an admin whose
 * only grant is a `user_roles` row — the normal way to add someone — hit the
 * await, and a hung lookup leaves `loading` true forever, which renders neither
 * the controls nor the explanation. So the callback now only captures the user,
 * and the lookup is scheduled after it returns.
 *
 * This is a UI gate. It hides controls from people who should not use them —
 * it is not a security boundary (RLS grants authenticated UPDATE on
 * agent_social_posts). Treat it as workflow, not enforcement.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";

export interface ContentApprover {
  /** True once we know this user may approve. */
  isApprover: boolean;
  /** Still resolving — render neither the controls nor a "denied" state yet. */
  loading: boolean;
  /** Signed-in email, used to stamp who approved what. */
  email: string | null;
}

export function useContentApprover(): ContentApprover {
  const [state, setState] = useState<ContentApprover>({
    isApprover: false,
    loading: true,
    email: null,
  });

  useEffect(() => {
    let cancelled = false;

    const evaluate = (user: { id?: string; email?: string } | null | undefined) => {
      if (cancelled) return;
      if (!user) {
        setState({ isApprover: false, loading: false, email: null });
        return;
      }
      const email = user.email || null;
      if (isAllowlistedAdmin(email)) {
        setState({ isApprover: true, loading: false, email });
        return;
      }
      // Answer with what is already known FIRST — the person's email — so the
      // UI can say who they are while the role read is still out. Then resolve
      // the role OUTSIDE the auth callback (see the header): a deadlocked
      // lookup must not be able to strand this hook in `loading`.
      setState({ isApprover: false, loading: true, email });
      const userId = user.id;
      if (!userId) {
        setState({ isApprover: false, loading: false, email });
        return;
      }
      setTimeout(async () => {
        if (cancelled) return;
        try {
          const { data } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", userId)
            .in("role", ["admin", "tester"])
            .limit(1)
            .maybeSingle();
          if (cancelled) return;
          setState({ isApprover: !!data, loading: false, email });
        } catch {
          // A failed read is "we could not confirm", not "denied silently".
          // `loading` must still clear or the caller shows nothing at all.
          if (!cancelled) setState({ isApprover: false, loading: false, email });
        }
      }, 0);
    };

    // INITIAL_SESSION fires with the cached session immediately; getSession()
    // can hang on a token refresh and leave the gate spinning (RequireAdmin
    // learned this the hard way).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      evaluate(session?.user);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}
