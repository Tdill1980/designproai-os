/**
 * Tiny event emitter for the session-expired modal.
 *
 * Lives outside the supabase-client ↔ SessionGuard circular dependency.
 * client.ts calls `emitSessionExpired()` when a retry fails.
 * SessionGuard subscribes via `onSessionExpired()` and opens the modal.
 *
 * No imports from supabase/client or SessionGuard — that's the point.
 */

type Listener = () => void;

let _listener: Listener | null = null;

export function emitSessionExpired() {
  _listener?.();
}

export function onSessionExpired(fn: Listener) {
  _listener = fn;
}
