/**
 * proof-delete — permanently delete one or more ApprovePro proofs.
 *
 * Shop/staff action from the ApprovePro workbench. Accepts EITHER:
 *   - proof_id        — delete a single proof, or
 *   - proof_ids[]     — delete a batch (the queue's "Delete all shown" passes
 *                       the exact ids it is currently showing, so the server
 *                       never blind-wipes the table — it only deletes ids the
 *                       caller explicitly listed).
 *
 * Hard delete: every child table (proof_versions, proof_events,
 * proof_line_items, proof_messages, proof_team_views, proof_ai_jobs,
 * support_escalations) is ON DELETE CASCADE, so removing the proof_approvals
 * row cleans up all of its data with no orphans.
 *
 * Scoped to the caller's shop_id (same as proof-revoke) so a shop can only
 * delete its own proofs. Per JWT.md §1: verify_jwt = false in config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Hard cap so a runaway client can't issue a single delete of thousands of
// rows. The queue's "Delete all shown" batches are well under this.
const MAX_BATCH = 1000;

interface DeleteRequest {
  proof_id?: string;
  proof_ids?: string[];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "Authentication required" }, 401);

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Invalid auth token" }, 401);
    const shopId = user.id;

    let body: DeleteRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    // Normalize to a de-duped id list from either shape.
    const ids = Array.from(
      new Set(
        [
          ...(body.proof_id ? [body.proof_id] : []),
          ...(Array.isArray(body.proof_ids) ? body.proof_ids : []),
        ]
          .map((v) => String(v || "").trim())
          .filter(Boolean),
      ),
    );
    if (ids.length === 0) {
      return jsonResponse({ error: "proof_id or proof_ids required" }, 400);
    }
    if (ids.length > MAX_BATCH) {
      return jsonResponse(
        { error: `Too many proofs in one request (${ids.length} > ${MAX_BATCH})` },
        400,
      );
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Delete ONLY the caller's own proofs. The .select() returns the rows that
    // actually matched (id + shop guard), so the count is honest even when some
    // ids belonged to another shop or were already gone.
    const { data: deleted, error: delErr } = await db
      .from("proof_approvals")
      .delete()
      .in("id", ids)
      .eq("shop_id", shopId)
      .select("id");
    if (delErr) {
      console.error("proof-delete: delete failed:", delErr);
      return jsonResponse(
        { error: "Failed to delete proof(s)", detail: delErr.message },
        500,
      );
    }

    return jsonResponse({
      success: true,
      requested: ids.length,
      deleted: (deleted || []).length,
      deleted_ids: (deleted || []).map((r: any) => r.id),
    });
  } catch (err: any) {
    console.error("proof-delete: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error" }, 500);
  }
});
