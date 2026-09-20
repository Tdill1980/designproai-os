import type { Session, SupabaseClient } from "@supabase/supabase-js";

type Auth = Pick<SupabaseClient["auth"], "getSession" | "onAuthStateChange">;
export type AuthObservation = { user: Session["user"] | null; unavailable: boolean };

/** Auth events outrank the initial read; a timeout never invents an identity. */
export function observeAuthSession(auth: Auth, receive: (state: AuthObservation) => void) {
  let active = true;
  let eventReceived = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = (session: Session | null, unavailable = false) => {
    if (!active) return;
    clearTimeout(timer);
    receive({ user: session?.user ?? null, unavailable });
  };
  timer = setTimeout(() => publish(null, true), 6000);
  const { data: { subscription } } = auth.onAuthStateChange((_event, session) => {
    eventReceived = true;
    publish(session);
  });
  void auth.getSession().then(({ data, error }) => {
    if (!eventReceived) publish(error ? null : data.session, Boolean(error));
  }).catch(() => {
    if (!eventReceived) publish(null, true);
  });
  return () => {
    active = false;
    clearTimeout(timer);
    subscription.unsubscribe();
  };
}
