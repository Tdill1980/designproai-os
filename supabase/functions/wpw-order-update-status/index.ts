/**
 * wpw-order-update-status — push a tightly-scoped status change from
 * RestylePro back to WooCommerce.
 *
 * The whole point of this function is to let four named WPW staff
 * members (Lance / Troy / Brice / Trish) advance an order through its
 * production pipeline without opening weprintwraps.com. EVERYTHING
 * outside the locked-down scope is denied here, not in the UI:
 *
 *   - Caller must be one of the four allowed staff emails. Any other
 *     auth user (admin or otherwise) gets 403.
 *   - Transition (from → to) must appear in ALLOWED_TRANSITIONS.
 *     Backwards transitions, jumps, refunds, cancellations, etc. are
 *     all rejected at this layer regardless of UI.
 *   - The `from_status` claimed by the caller must match the order's
 *     current status in our mirror — prevents stale-tab races.
 *
 * Preview mode: when env `WPW_STATUS_WRITE_PREVIEW=true` (default),
 * the function skips the actual Woo PUT and only writes an audit row
 * marked preview=true. Returns success to the UI so the team can
 * validate the flow without firing customer emails. Set the env var
 * to "false" to enable real writes.
 *
 * Per CLAUDE.md hard rule: this function MUST be listed in
 * supabase/config.toml with `verify_jwt = false`. Auth is verified
 * inside the function so we control 401 behaviour rather than the
 * platform gateway.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { wooFetch } from "../_shared/woo-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Lance / Troy / Brice / Trish (per Trish's instruction). tdill is the
// owner alias for Trish for testing. Lower-cased for compare.
const STAFF_ALLOWLIST = new Set([
  "lance@weprintwraps.com",
  "troy@weprintwraps.com",
  "brice@weprintwraps.com",
  "trish@weprintwraps.com",
  "trish@restyleproai.com",
  "tdill@restyleproai.com",
]);

// Forward-only pipeline transitions, derived from actual usage in
// wpw_orders (processing → in-design → design-complete →
// print-production → completed). Every other source/target combo is
// rejected here — the UI also hides their buttons but the function
// is the source of truth.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  "processing": ["in-design"],
  "in-design": ["design-complete"],
  "design-complete": ["print-production"],
  "print-production": ["completed"],
};

interface UpdateStatusBody {
  order_id?: number;
  from_status?: string;
  to_status?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return jsonResponse({ ok: false, error: "Authentication required" }, 401);

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await authClient.auth.getUser();
  if (authErr || !user) return jsonResponse({ ok: false, error: "Invalid auth token" }, 401);

  const email = (user.email || "").toLowerCase();
  if (!STAFF_ALLOWLIST.has(email)) {
    return jsonResponse({ ok: false, error: "Not authorised to change status" }, 403);
  }

  let body: UpdateStatusBody = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const orderId = Number(body.order_id);
  const fromStatus = String(body.from_status || "").trim();
  const toStatus = String(body.to_status || "").trim();

  if (!Number.isFinite(orderId) || orderId <= 0) {
    return jsonResponse({ ok: false, error: "Missing or invalid order_id" }, 400);
  }
  if (!fromStatus || !toStatus) {
    return jsonResponse({ ok: false, error: "Missing from_status or to_status" }, 400);
  }
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.includes(toStatus)) {
    return jsonResponse(
      { ok: false, error: `Transition ${fromStatus} → ${toStatus} is not allowed` },
      403,
    );
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: orderRow, error: readErr } = await db
    .from("wpw_orders")
    .select("id, order_number, status")
    .eq("id", orderId)
    .maybeSingle();

  if (readErr) return jsonResponse({ ok: false, error: readErr.message }, 500);
  if (!orderRow) return jsonResponse({ ok: false, error: "Order not found" }, 404);
  if (orderRow.status !== fromStatus) {
    return jsonResponse(
      {
        ok: false,
        error: "Order status has changed since you opened it",
        actual_status: orderRow.status,
      },
      409,
    );
  }

  const previewMode = (Deno.env.get("WPW_STATUS_WRITE_PREVIEW") || "true").toLowerCase() === "true";

  let wooStatus: number | null = null;
  let wooError: string | null = null;

  if (!previewMode) {
    try {
      await wooFetch(`/orders/${orderId}`, {
        method: "PUT",
        body: JSON.stringify({ status: toStatus }),
      });
      wooStatus = 200;
    } catch (e) {
      wooError = (e as Error).message;
    }
  }

  await db.from("wpw_order_status_changes").insert({
    order_id: orderId,
    order_number: orderRow.order_number,
    from_status: fromStatus,
    to_status: toStatus,
    changed_by: user.id,
    changed_by_email: email,
    preview: previewMode,
    woo_response_status: wooStatus,
    woo_error: wooError,
  });

  if (wooError) {
    return jsonResponse({ ok: false, error: `Woo rejected: ${wooError}` }, 502);
  }

  await db
    .from("wpw_orders")
    .update({ status: toStatus, date_modified: new Date().toISOString() })
    .eq("id", orderId);

  return jsonResponse({
    ok: true,
    preview: previewMode,
    order_id: orderId,
    new_status: toStatus,
  });
});
