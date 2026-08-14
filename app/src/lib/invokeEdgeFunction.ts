import { supabase } from "@/integrations/supabase/client";
import { triggerSessionExpiredModal } from "@/components/SessionGuard";

/**
 * Invokes a Supabase Edge Function with a fresh access token.
 * If the call returns a 401/JWT error, refreshes the session and retries once.
 * If the retry also fails, triggers the session-expired modal.
 */
export async function invokeEdgeFunction<T = any>(
  functionName: string,
  body: Record<string, unknown>,
  options?: { timeoutMs?: number },
): Promise<{ data: T | null; error: any }> {
  // Step 1: Ensure we have a fresh token
  const token = await getFreshToken();
  if (!token) {
    triggerSessionExpiredModal();
    return { data: null, error: { message: "Session expired - please log in again." } };
  }

  // Step 2: Invoke via SDK (SDK attaches the current session token)
  const result = await doInvoke<T>(functionName, body);

  // Step 3: If auth error, refresh and retry once
  if (result.error && isAuthError(result.error)) {
    console.warn(`[invokeEdgeFunction] Auth error on "${functionName}", refreshing session...`);
    const retryToken = await getFreshToken(true);
    if (!retryToken) {
      triggerSessionExpiredModal();
      return { data: null, error: { message: "Session expired - please log in again." } };
    }
    const retryResult = await doInvoke<T>(functionName, body);
    if (retryResult.error && isAuthError(retryResult.error)) {
      triggerSessionExpiredModal();
    }
    return retryResult;
  }

  return result;
}

async function doInvoke<T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<{ data: T | null; error: any }> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  return { data: data as T | null, error };
}

async function getFreshToken(forceRefresh = false): Promise<string | null> {
  try {
    if (forceRefresh) {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session?.access_token) {
        return null;
      }
      return data.session.access_token;
    }

    // Check current session - if it expires within 60s, force refresh
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    const expiresAt = (session.expires_at ?? 0) * 1000;
    const remaining = expiresAt - Date.now();

    if (remaining < 60_000) {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session?.access_token) return null;
      return data.session.access_token;
    }

    return session.access_token;
  } catch {
    return null;
  }
}

function isAuthError(error: any): boolean {
  if (!error) return false;

  // Check HTTP status from SDK context
  try {
    const status = error?.context?.status ?? error?.status;
    if (status === 401 || status === 403) return true;
  } catch {}

  // Check error message patterns
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    msg.includes("invalid jwt") ||
    msg.includes("jwt expired") ||
    msg.includes("invalid claim") ||
    msg.includes("token is expired") ||
    msg.includes("session expired") ||
    msg.includes("not authenticated") ||
    /\b401\b/.test(msg)
  );
}
