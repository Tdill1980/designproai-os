// pack-gate.ts — "one production pack per vehicle/job" entitlement gate.
//
// Gates the PRINT-FILE EXPORT (upscale-panel-to-print, and any other print
// producer that opts in) so a customer must have PAID for this design's
// production pack before print-ready files are produced/downloaded. Metered
// PER GENERATION, not per side — once a generation has a paid pack, EVERY side
// exports free.
//
// Three outcomes, mirroring token-gate.ts's shape:
//   1) admin / tester role            → bypass, no charge (so Trish can test)
//   2) a paid production_packs row for this generation → allow (already bought)
//   3) neither                        → 402 { code:"pack_required", generation_id }
//      The client fires the paywall and starts the print-pack checkout for
//      THIS generation. On payment the webhook upserts a paid production_packs
//      row, and the retry lands on outcome (2).
//
// Availability convention (matches the app's checkPackLimit): on a transient
// auth/DB error the gate FAILS OPEN so a blip never blocks a legitimate paying
// customer or breaks the page. Admin always bypasses regardless. Tighten to
// fail-closed later if the soft-paywall leak matters.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// production_packs.payment_status values that mean "entitled to download".
// Existing rows use 'included'; Stripe fulfilment will write 'paid'. 'pending'
// is a started-but-unpaid checkout and does NOT entitle.
const ENTITLED_STATUSES = ["paid", "included", "comp", "free"];

export interface PackGateResult {
  ok: boolean;
  source?: "privileged" | "paid" | "fail-open";
  generationId?: string | null;
  /** Fully formed 401 / 402 response when ok=false — the edge fn returns it as-is. */
  response?: Response;
}

export interface PackGateOptions {
  /** panelizer_jobs.id OR a generation id. Used to resolve the generation. */
  jobId?: string | null;
  /** Explicit generation id when the caller already knows it (skips the lookup). */
  generationId?: string | null;
  /** Pack price surfaced in the 402 paywall payload. */
  price?: number;
  /** Bypass entirely — internal callers that already paid. */
  skip?: boolean;
}

function deny(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export async function packGate(req: Request, opts: PackGateOptions = {}): Promise<PackGateResult> {
  if (opts.skip) return { ok: true, source: "privileged" };
  const price = opts.price ?? 299;

  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 1. Authenticate the caller from the JWT ──
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return { ok: false, response: deny(401, { error: "Missing Authorization bearer token", code: "no_auth" }) };
  }
  let userId: string;
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) {
      return { ok: false, response: deny(401, { error: "Invalid or expired session", code: "bad_auth" }) };
    }
    userId = data.user.id;
  } catch {
    // Auth service hiccup → fail open (never break the page on a blip).
    return { ok: true, source: "fail-open" };
  }

  // ── 2. Privileged bypass (admin / tester) — this is the TEST bypass ──
  try {
    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "tester"]);
    if (Array.isArray(roleRows) && roleRows.length > 0) {
      return { ok: true, source: "privileged" };
    }
  } catch {
    // Role lookup failed → fail open for safety (an admin must never be 402'd).
    return { ok: true, source: "fail-open" };
  }

  // ── 3. Resolve the generation id ──
  // The print export passes a panelizer_jobs id (or, for some callers, the
  // generation id directly). Resolve to the canonical generation the pack is
  // keyed on. A UUID that isn't a panelizer_jobs row is treated as the
  // generation id itself.
  let generationId: string | null = opts.generationId ?? null;
  if (!generationId && opts.jobId) {
    try {
      const { data: job } = await admin
        .from("panelizer_jobs")
        .select("generation_id")
        .eq("id", opts.jobId)
        .maybeSingle();
      generationId = (job?.generation_id as string) || opts.jobId;
    } catch {
      generationId = opts.jobId;
    }
  }
  if (!generationId) {
    // No way to key an entitlement → fail open rather than block.
    return { ok: true, source: "fail-open" };
  }

  // ── 4. Already-paid check (per generation → all sides free once bought) ──
  try {
    const { data: paid } = await admin
      .from("production_packs")
      .select("id")
      .eq("generation_id", generationId)
      .in("payment_status", ENTITLED_STATUSES)
      .limit(1)
      .maybeSingle();
    if (paid?.id) return { ok: true, source: "paid", generationId };
  } catch {
    // DB hiccup on the entitlement read → fail open (don't block a payer).
    return { ok: true, source: "fail-open", generationId };
  }

  // ── 5. Out of paths → paywall 402 (client buys THIS generation's pack) ──
  return {
    ok: false,
    generationId,
    response: deny(402, {
      error: "Production pack payment required",
      code: "pack_required",
      generation_id: generationId,
      paywall: { production_pack: { price } },
    }),
  };
}
