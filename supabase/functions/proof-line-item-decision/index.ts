/**
 * proof-line-item-decision — Phase 8C.
 *
 * Customer action on a single line item within a multi-line proof. Accepts:
 *   - token                  (HMAC view token)
 *   - line_item_id           (uuid)
 *   - decision               ("approve" | "decline" | "revise")
 *   - note                   (required for decline/revise, min 3 chars)
 *   - reference_image_paths  (optional — up to 4 storage paths in proof-uploads)
 *   - Idempotency-Key header
 *
 * Flow:
 *   1. Verify HMAC + load proof. Confirm proof has_line_items and is
 *      non-terminal.
 *   2. Load line item, confirm it belongs to this proof.
 *   3. Check idempotency via proof_events payload.
 *   4. Update line item status + audit event.
 *   5. Return rollup counts so the client can show progress ("3 of 5 approved").
 *
 * Parent proof status is NOT flipped here. The customer signs on the parent
 * proof once the rollup is "all resolved" — that triggers proof-sign (legacy
 * path) which bakes per-line outcomes into the signed PDF. Declined lines
 * don't kill the whole proof on their own; the signature closes everything.
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyProofToken } from "../_shared/proof-tokens.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
};

type Decision = "approve" | "decline" | "revise";

interface DecisionRequest {
  token: string;
  line_item_id: string;
  decision: Decision;
  note?: string;
  reference_image_paths?: string[];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALID_DECISIONS: Decision[] = ["approve", "decline", "revise"];

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    let body: DecisionRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (!body.token) return jsonResponse({ error: "token required" }, 400);
    if (!body.line_item_id) {
      return jsonResponse({ error: "line_item_id required" }, 400);
    }
    if (!VALID_DECISIONS.includes(body.decision)) {
      return jsonResponse(
        { error: "decision must be approve, decline, or revise" },
        400,
      );
    }
    const needsNote = body.decision === "decline" || body.decision === "revise";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (needsNote && note.length < 3) {
      return jsonResponse(
        { error: "note required (min 3 chars) when declining or requesting a revision" },
        400,
      );
    }
    const refPaths = Array.isArray(body.reference_image_paths)
      ? body.reference_image_paths
          .filter((p): p is string => typeof p === "string" && p.length > 0)
          .slice(0, 4)
      : [];

    const idempotencyKey =
      req.headers.get("idempotency-key") ||
      req.headers.get("Idempotency-Key") || "";
    if (!idempotencyKey || idempotencyKey.length < 8) {
      return jsonResponse({ error: "Idempotency-Key header required" }, 400);
    }

    let verifiedUuid: string | null;
    try {
      verifiedUuid = await verifyProofToken(body.token, "view");
    } catch (err) {
      console.error("proof-line-item-decision: token verify threw:", err);
      return jsonResponse({ error: "Server misconfiguration" }, 500);
    }
    if (!verifiedUuid) return jsonResponse({ error: "Invalid token" }, 404);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: proof, error: fetchErr } = await db
      .from("proof_approvals")
      .select("id, status, mode, expires_at, has_line_items")
      .eq("view_token", body.token)
      .single();
    if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);

    if (!proof.has_line_items) {
      return jsonResponse(
        { error: "This proof has no line items" },
        409,
      );
    }
    if (["approved", "declined", "revoked", "expired"].includes(proof.status)) {
      return jsonResponse({ error: `Proof is ${proof.status}` }, 409);
    }
    if (proof.expires_at && new Date(proof.expires_at) < new Date()) {
      return jsonResponse({ error: "Proof has expired" }, 410);
    }
    if (body.decision === "revise" && proof.mode !== "revision_loop") {
      return jsonResponse(
        { error: "This proof is sign-only — revisions are not enabled" },
        409,
      );
    }

    const { data: lineItem, error: liErr } = await db
      .from("proof_line_items")
      .select("*")
      .eq("id", body.line_item_id)
      .eq("proof_id", proof.id)
      .maybeSingle();
    if (liErr || !lineItem) {
      return jsonResponse({ error: "Line item not found" }, 404);
    }

    // Idempotency: short-circuit on replay of the same key.
    const { data: priorEvent } = await db
      .from("proof_events")
      .select("created_at")
      .eq("proof_id", proof.id)
      .eq("event_type", "line_item_decision")
      .contains("payload", {
        idempotency_key: idempotencyKey,
        line_item_id: body.line_item_id,
      })
      .limit(1)
      .maybeSingle();
    if (priorEvent) {
      return jsonResponse({
        success: true,
        already_recorded: true,
        line_item_id: body.line_item_id,
        decision: body.decision,
        recorded_at: priorEvent.created_at,
      });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("x-real-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;
    const nowIso = new Date().toISOString();

    const update: Record<string, unknown> = { status: mapDecisionToStatus(body.decision) };
    if (body.decision === "approve") {
      update.approved_at = nowIso;
      update.decline_reason = null;
      update.change_request = null;
    } else if (body.decision === "decline") {
      update.declined_at = nowIso;
      update.decline_reason = note;
    } else {
      update.revision_requested_at = nowIso;
      update.change_request = note;
      update.reference_image_paths = refPaths;
    }

    const { error: updateErr } = await db
      .from("proof_line_items")
      .update(update)
      .eq("id", body.line_item_id)
      .eq("proof_id", proof.id);
    if (updateErr) {
      console.error("proof-line-item-decision: update failed:", updateErr);
      return jsonResponse(
        { error: "Failed to record decision", detail: updateErr.message },
        500,
      );
    }

    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: "line_item_decision",
      actor_role: "customer",
      ip,
      user_agent: userAgent,
      payload: {
        idempotency_key: idempotencyKey,
        line_item_id: body.line_item_id,
        line_number: lineItem.line_number,
        line_title: lineItem.title,
        decision: body.decision,
        note: needsNote ? note : null,
        reference_image_paths: refPaths,
      },
    });

    // If the proof was still "sent", bump to "viewed" so the shop dashboard
    // reflects activity even before any line is approved.
    if (proof.status === "sent") {
      await db
        .from("proof_approvals")
        .update({ status: "viewed", viewed_at: nowIso })
        .eq("id", proof.id)
        .eq("status", "sent");
    }

    // Bubble up rollup so the UI can show "3 of 5 resolved".
    const { data: rollupRows } = await db.rpc(
      "proof_line_items_rollup",
      { p_proof_id: proof.id },
    );
    const rollup = Array.isArray(rollupRows) && rollupRows.length > 0
      ? rollupRows[0]
      : null;

    return jsonResponse({
      success: true,
      line_item_id: body.line_item_id,
      decision: body.decision,
      recorded_at: nowIso,
      rollup,
    });
  } catch (err: any) {
    console.error("proof-line-item-decision: unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected server error", detail: err?.message },
      500,
    );
  }
});

function mapDecisionToStatus(d: Decision): string {
  if (d === "approve") return "approved";
  if (d === "decline") return "declined";
  return "revising";
}
