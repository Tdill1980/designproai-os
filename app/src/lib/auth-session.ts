import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve the current signed-in user from the cached session, refreshing the
 * token first when it's within 2 minutes of expiry.
 *
 * Use this for gating checks instead of supabase.auth.getUser(): getUser()
 * makes a network call to the auth server and returns null on a slightly
 * stale JWT (inside the refresh window), which wrongly tells a signed-in
 * user they need to sign in. getSession() reads the persisted session and,
 * paired with refreshSession(), survives that window — the same approach
 * RequireAuth and the global functions.invoke interceptor already use.
 */
export async function getActiveUser() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  if (expiresAtMs - Date.now() < 120_000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    return refreshed.session?.user ?? session.user ?? null;
  }

  return session.user ?? null;
}
