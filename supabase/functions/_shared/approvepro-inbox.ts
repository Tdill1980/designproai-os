/**
 * approvepro-inbox — the design-mailbox API for ApprovePro intake.
 *
 * The WPW design mailbox (design@weprintwraps.com) is wired to Microsoft Graph
 * through the Azure app (MS_GRAPH_* / MICROSOFT_* secrets) and pulled by the
 * `intake-graph-poll` edge function. Customers routinely order first and EMAIL
 * the real material second — "I will send a follow up email with some basic
 * mockup images and their current Logo" (order #35635). Those attachments are
 * the design brief; without them A.C.E. invents a wrap and the shop ships slop.
 *
 * This module is the ONE call site pattern for "before designing, go read the
 * customer's email". It wraps `intake-graph-poll` mode:"search", which matches
 * the mailbox to the order (order # in the subject, else sender address), saves
 * every attachment to wrap-files, and folds the body + attachments into
 * `metadata.line_item_brief` + `metadata.customer_uploads`.
 *
 * Inert-safe: when the Graph secrets aren't set the poller returns
 * `{ configured:false }` and this returns `pulled:false` — never throws, never
 * blocks a design.
 */

export interface InboxPullResult {
  /** Graph was reachable and the search ran. */
  pulled: boolean;
  /** How many mailbox messages were folded into this order. */
  folded: number;
  /** The refreshed proof metadata (unchanged object when nothing was folded). */
  meta: Record<string, any>;
  /** Attachments on the order AFTER the pull. */
  uploads: string[];
  /** Attachments that the pull newly added. */
  gained: number;
  note?: string;
}

export interface InboxPullInput {
  db: any;
  supabaseUrl: string;
  serviceRoleKey: string;
  proofId: string;
  /** Current metadata; returned as-is if the search adds nothing. */
  meta: Record<string, any>;
  log?: (msg: string) => void;
}

function uploadsOf(meta: Record<string, any>): string[] {
  return Array.isArray(meta?.customer_uploads) ? meta.customer_uploads : [];
}

/**
 * Search the design mailbox for THIS order's email and fold what it finds into
 * the brief. Safe to call on every generation — `intake-graph-poll` dedupes by
 * Graph message id, so a re-run costs two Graph queries and changes nothing.
 */
export async function pullDesignInboxContext(input: InboxPullInput): Promise<InboxPullResult> {
  const log = input.log || (() => {});
  const before = uploadsOf(input.meta);
  try {
    const r = await fetch(`${input.supabaseUrl}/functions/v1/intake-graph-poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.serviceRoleKey}`,
        apikey: input.serviceRoleKey,
      },
      body: JSON.stringify({ mode: "search", proof_id: input.proofId }),
      signal: AbortSignal.timeout(90_000),
    });
    const j = await r.json().catch(() => ({}));

    if (j?.configured === false) {
      log("approvepro-inbox: Graph not configured — skipping mailbox pull");
      return { pulled: false, folded: 0, meta: input.meta, uploads: before, gained: 0, note: "graph_not_configured" };
    }

    const folded = Number(j?.found) || 0;

    // Re-read metadata whenever the search ran: the poller writes the brief +
    // attachments directly, so our in-memory copy is stale after a match.
    const { data: fresh } = await input.db
      .from("proof_approvals")
      .select("metadata")
      .eq("id", input.proofId)
      .maybeSingle();
    const meta = ((fresh?.metadata as any) || input.meta) as Record<string, any>;
    const after = uploadsOf(meta);
    const gained = Math.max(0, after.length - before.length);

    if (folded > 0 || gained > 0) {
      log(`approvepro-inbox: folded ${folded} mailbox message(s), ${gained} new attachment(s)`);
    } else {
      log("approvepro-inbox: no matching customer email found in the design mailbox");
    }
    return { pulled: true, folded, meta, uploads: after, gained };
  } catch (e) {
    log(`approvepro-inbox: mailbox pull failed (non-fatal): ${(e as any)?.message || e}`);
    return { pulled: false, folded: 0, meta: input.meta, uploads: before, gained: 0, note: "error" };
  }
}
