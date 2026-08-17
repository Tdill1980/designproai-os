/**
 * proof-escalate-support — Phase 5 Tier-3 escalation.
 *
 * Dual-path endpoint (customer via token, shop via proof_id + auth). Creates
 * a support_escalations row with a frozen snapshot of the proof + all
 * versions + all events, transitions proof.status → escalated_support, logs
 * 'support_escalated' event, and posts a rich Slack message with the proof
 * context to #proof-escalations (via SLACK_WEBHOOK_URL_PROOF_SUPPORT).
 *
 * Idempotency: if an OPEN escalation already exists for this proof, returns
 * that row instead of creating a duplicate. No Idempotency-Key header
 * required — an already-escalated proof is the de-dup signal.
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyProofToken } from "../_shared/proof-tokens.ts";
import { sendSlackMessage } from "../_shared/slack-webhook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface EscalateRequest {
  token?: string;
  proof_id?: string;
  reason?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getPublicProofBaseUrl(): string {
  return Deno.env.get("PROOF_PUBLIC_BASE_URL") || "https://restyleproai.com";
}

function buildSlackBlocks(opts: {
  proofId: string;
  designName: string;
  customerName: string;
  customerEmail: string;
  vehicleSummary: string;
  mode: string;
  status: string;
  escalatedByRole: "shop" | "customer";
  shopEmail: string | null;
  reason: string | null;
  viewUrl: string;
  manageUrl: string;
  versionCount: number;
  eventCount: number;
}) {
  const statusEmoji = opts.status === "revising" ? "🔁" :
                      opts.status === "escalated_shop" ? "🧰" :
                      opts.status === "viewed" ? "👀" : "📨";
  const initiator = opts.escalatedByRole === "shop"
    ? `Shop — ${opts.shopEmail || "unknown"}`
    : `Customer — ${opts.customerName || opts.customerEmail}`;

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🚨 Tier-3 Support Escalation — ${opts.designName}`.slice(0, 150),
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Design:*\n${opts.designName}` },
        { type: "mrkdwn", text: `*Vehicle:*\n${opts.vehicleSummary || "—"}` },
        { type: "mrkdwn", text: `*Customer:*\n${opts.customerName || "—"} <${opts.customerEmail}>` },
        { type: "mrkdwn", text: `*Shop:*\n${opts.shopEmail || "—"}` },
        { type: "mrkdwn", text: `*Status:*\n${statusEmoji} ${opts.status}` },
        { type: "mrkdwn", text: `*Mode:*\n${opts.mode}` },
        { type: "mrkdwn", text: `*Escalated by:*\n${initiator}` },
        { type: "mrkdwn", text: `*Context:*\n${opts.versionCount} versions · ${opts.eventCount} events` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: opts.reason
          ? `*Reason:*\n${opts.reason.slice(0, 2500)}`
          : "_No reason provided._",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open Admin View" },
          url: `${getPublicProofBaseUrl()}/admin/proof-support/${opts.proofId}`,
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Preview Client Page" },
          url: opts.viewUrl,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Open Shop Manage" },
          url: opts.manageUrl,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Proof \`${opts.proofId}\` · <!subteam^proof-support> please triage`,
        },
      ],
    },
  ];

  return blocks;
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    let body: EscalateRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (!body.token && !body.proof_id) {
      return jsonResponse({ error: "token or proof_id required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Resolve proof + actor ──
    let proofId: string | null = null;
    let actorRole: "customer" | "shop" = "customer";
    let actorUserId: string | null = null;

    if (body.token) {
      let verifiedUuid: string | null;
      try {
        verifiedUuid = await verifyProofToken(body.token, "view");
      } catch {
        return jsonResponse({ error: "Server misconfiguration" }, 500);
      }
      if (!verifiedUuid) return jsonResponse({ error: "Invalid token" }, 404);

      const { data: row, error } = await db
        .from("proof_approvals")
        .select("id")
        .eq("view_token", body.token)
        .single();
      if (error || !row) return jsonResponse({ error: "Proof not found" }, 404);
      proofId = row.id;
      actorRole = "customer";
    } else {
      const authHeader = req.headers.get("authorization");
      if (!authHeader) return jsonResponse({ error: "Authentication required" }, 401);
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await authClient.auth.getUser();
      if (authError || !user) return jsonResponse({ error: "Invalid auth token" }, 401);

      const { data: row, error } = await db
        .from("proof_approvals")
        .select("id")
        .eq("id", body.proof_id)
        .eq("shop_id", user.id)
        .single();
      if (error || !row) return jsonResponse({ error: "Proof not found" }, 404);
      proofId = row.id;
      actorRole = "shop";
      actorUserId = user.id;
    }

    // ── Load full proof + versions + events ──
    const { data: proof } = await db
      .from("proof_approvals")
      .select("*")
      .eq("id", proofId!)
      .single();
    if (!proof) return jsonResponse({ error: "Proof not found" }, 404);

    if (["approved", "declined", "revoked", "expired"].includes(proof.status)) {
      return jsonResponse(
        { error: `Cannot escalate proof in terminal state '${proof.status}'` },
        409,
      );
    }

    // Dedup: if an OPEN escalation already exists, return it
    const { data: existing } = await db
      .from("support_escalations")
      .select("id, created_at, status")
      .eq("proof_id", proof.id)
      .eq("status", "open")
      .maybeSingle();
    if (existing) {
      return jsonResponse({
        success: true,
        already_escalated: true,
        escalation_id: existing.id,
        status: proof.status,
      });
    }

    const { data: versions } = await db
      .from("proof_versions")
      .select("*")
      .eq("proof_id", proof.id)
      .order("version_number", { ascending: true });

    const { data: events } = await db
      .from("proof_events")
      .select("*")
      .eq("proof_id", proof.id)
      .order("created_at", { ascending: true });

    // ── Create escalation row with frozen snapshot ──
    const snapshot = {
      proof,
      versions: versions || [],
      events: events || [],
      snapshot_at: new Date().toISOString(),
    };

    const { data: esc, error: escErr } = await db
      .from("support_escalations")
      .insert({
        proof_id: proof.id,
        escalated_by_role: actorRole,
        escalated_by_user_id: actorUserId,
        reason: body.reason?.trim()?.slice(0, 5000) || null,
        status: "open",
        snapshot,
      })
      .select("id, created_at")
      .single();

    if (escErr || !esc) {
      console.error("proof-escalate-support: insert failed:", escErr);
      return jsonResponse(
        { error: "Failed to create escalation", detail: escErr?.message },
        500,
      );
    }

    // ── Flip proof status → escalated_support ──
    const { error: updateErr } = await db
      .from("proof_approvals")
      .update({ status: "escalated_support" })
      .eq("id", proof.id)
      .not("status", "in", "(approved,declined,revoked,expired,escalated_support)");
    if (updateErr) {
      // Soft failure — escalation row + Slack notification are what matter
      console.warn("proof-escalate-support: status update non-fatal failure:", updateErr);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("x-real-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;

    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: "support_escalated",
      actor_role: actorRole,
      actor_user_id: actorUserId,
      ip,
      user_agent: userAgent,
      payload: {
        escalation_id: esc.id,
        reason: body.reason?.trim() || null,
      },
    });

    // ── Post to Slack (best-effort) ──
    try {
      const { data: shopUser } = await db.auth.admin.getUserById(proof.shop_id);
      const shopEmail = shopUser?.user?.email || null;

      const viewUrl = `${getPublicProofBaseUrl()}/approve/${proof.view_token}`;
      const manageUrl = `${getPublicProofBaseUrl()}/approve/manage/${proof.manage_token}`;

      const blocks = buildSlackBlocks({
        proofId: proof.id,
        designName: proof.design_name || "Vehicle Wrap Design",
        customerName: proof.customer_name || "",
        customerEmail: proof.customer_email,
        vehicleSummary:
          [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model]
            .filter(Boolean)
            .join(" "),
        mode: proof.mode,
        status: proof.status,
        escalatedByRole: actorRole,
        shopEmail,
        reason: body.reason?.trim() || null,
        viewUrl,
        manageUrl,
        versionCount: (versions || []).length,
        eventCount: (events || []).length,
      });

      const slackResult = await sendSlackMessage(
        "SLACK_WEBHOOK_URL_PROOF_SUPPORT",
        {
          text: `🚨 Tier-3 Support escalation for "${proof.design_name || "Vehicle Wrap Design"}"`,
          blocks,
          username: "RestylePro Proofs",
          icon_emoji: ":lifebelt:",
        },
      );

      if (!slackResult.ok) {
        console.warn("proof-escalate-support: Slack post failed:", slackResult.reason);
      }
    } catch (slackErr) {
      console.warn("proof-escalate-support: Slack path threw (non-fatal):", slackErr);
    }

    return jsonResponse({
      success: true,
      escalation_id: esc.id,
      status: "escalated_support",
      escalated_at: esc.created_at,
    });
  } catch (err: any) {
    console.error("proof-escalate-support: unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected server error", detail: err?.message },
      500,
    );
  }
});
