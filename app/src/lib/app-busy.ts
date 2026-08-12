// app-busy — a tiny shared signal for "the user is doing work they'd hate to
// lose to a full page reload" (primarily an in-flight AI render).
//
// DeployVersionWatcher auto-reloads the page when a newer deploy is detected
// (to get users off stale cached HTML). That reload is harmless on an idle
// screen but brutal mid-render: it yanks the page out from under an active
// generation and, on mobile, can land on the login screen. The watcher
// consults isAppBusy() and defers its reload while work is in flight — it
// still picks up the new version on the next idle check.
//
// Reference-counted so overlapping renders (multi-view) don't end the busy
// state early. Begin/end MUST be paired (use try/finally at the call site).

let busyCount = 0;

export function beginAppBusy(): void {
  busyCount++;
}

export function endAppBusy(): void {
  busyCount = Math.max(0, busyCount - 1);
}

export function isAppBusy(): boolean {
  return busyCount > 0;
}
