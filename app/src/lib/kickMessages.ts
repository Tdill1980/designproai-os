/**
 * kickMessages — the words, with no I/O.
 *
 * Split out of `kickParse.ts` for the same reason `castTreatments.ts` was split
 * out of `useBrandCast.ts`: importing the Supabase client pulls in
 * `localStorage`, which does not exist in the node test environment. The rules
 * stay unit-testable; only the fetch lives next to the client.
 */

export interface KickResult {
  /** Did the worker actually get started on demand? */
  kicked: boolean;
  /** Machine-readable why-not: no_dispatch_token · github_4xx · dispatch_failed · unreachable */
  reason?: string;
}

/**
 * The sentence a user sees. It must distinguish "started now" from "queued for
 * whenever the schedule shows up" — those are minutes apart at best and three
 * hours apart at worst, and a toast that says the same thing for both is how
 * the suite came to look like it only worked when an agent poked it.
 */
export function kickMessage(r: KickResult, queuedLabel = "Queued"): string {
  if (r.kicked) return `${queuedLabel} — parsing now.`;
  if (r.reason === "no_dispatch_token") {
    return `${queuedLabel}. The on-demand trigger isn't configured, so this starts on the next scheduled run (up to ~1 hour).`;
  }
  return `${queuedLabel}. Couldn't start it on demand — it'll go on the next scheduled run.`;
}
