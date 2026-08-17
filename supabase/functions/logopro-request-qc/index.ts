// ============================================================================
// logopro-request-qc
// ============================================================================
// User has selected one of the 4 generated concepts. This function:
//   1. Validates ownership of project + concept
//   2. Marks the chosen concept selected
//   3. Transitions project status to pending_designer_qc
//   4. Inserts a designer_qc_queue ticket (logo_qc)
//   5. Pings Slack so Carley/Lance see new work in #designer-qc
//
// Auth: JWT required. Caller must be a shop member of the project's shop.
//
// Request:
//   {
//     projectId: string         (required UUID)
//     selectedConceptId: string (required UUID)
//     customerFeedback?: string (≤2000 chars)
//     priority?: 'low' | 'normal' | 'high' | 'urgent'
//   }
//
// Response:
//   200 { success: true, ticketId, status: 'pending_designer_qc',
//         estimatedReviewTime: string }
//   401 unauthenticated, 403 not a shop member, 404 not found,
//   409 wrong status, 400 bad input, 500 internal
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createExternalAnonClient,
  createExternalClient,
} from "../_shared/external-db.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { sendSlackMessage } from "../_shared/slack-webhook.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_PRIORITY = ["low", "normal", "high", "urgent"] as const;
type Priority = (typeof VALID_PRIORITY)[number];

interface RequestQCBody {
  projectId?: string;
  selectedConceptId?: string;
  customerFeedback?: string;
  priority?: Priority;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const anonClient = createExternalAnonClient();
    const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
    if (userErr || !userData?.user) return jsonResponse({ error: "Invalid token" }, 401);
    const user = userData.user;

    // Validate body
    const body: RequestQCBody = await req.json();
    if (!body.projectId || !UUID_RE.test(body.projectId)) {
      return jsonResponse({ error: "projectId must be UUID" }, 400);
    }
    if (!body.selectedConceptId || !UUID_RE.test(body.selectedConceptId)) {
      return jsonResponse({ error: "selectedConceptId must be UUID" }, 400);
    }
    if (body.customerFeedback && body.customerFeedback.length > 2000) {
      return jsonResponse({ error: "customerFeedback ≤ 2000 chars" }, 400);
    }
    const priority: Priority =
      body.priority && VALID_PRIORITY.includes(body.priority) ? body.priority : "normal";

    const sb = createExternalClient();

    // Load project
    const { data: project, error: projectErr } = await sb
      .from("logopro_projects")
      .select("id, shop_id, user_id, status, company_name")
      .eq("id", body.projectId)
      .maybeSingle();
    if (projectErr) {
      console.error("[logopro-request-qc] project query", projectErr);
      return jsonResponse({ error: "project_lookup_failed" }, 500);
    }
    if (!project) return jsonResponse({ error: "Project not found" }, 404);

    // Verify caller is a shop member
    const { data: memberRow } = await sb
      .from("shop_members")
      .select("shop_id, role")
      .eq("user_id", user.id)
      .eq("shop_id", project.shop_id)
      .maybeSingle();
    if (!memberRow) {
      return jsonResponse({ error: "Not a member of this shop" }, 403);
    }

    if (project.status !== "concepts_ready") {
      return jsonResponse(
        { error: `Project is in status "${project.status}", expected "concepts_ready"` },
        409,
      );
    }

    // Load concept
    const { data: concept, error: conceptErr } = await sb
      .from("logopro_concepts")
      .select("id, project_id, image_url")
      .eq("id", body.selectedConceptId)
      .maybeSingle();
    if (conceptErr) {
      console.error("[logopro-request-qc] concept query", conceptErr);
      return jsonResponse({ error: "concept_lookup_failed" }, 500);
    }
    if (!concept) return jsonResponse({ error: "Concept not found" }, 404);
    if (concept.project_id !== project.id) {
      return jsonResponse({ error: "Concept does not belong to project" }, 400);
    }

    // Update project + concept
    const { error: projectUpdateErr } = await sb
      .from("logopro_projects")
      .update({
        status: "pending_designer_qc",
        selected_concept_id: concept.id,
      })
      .eq("id", project.id);
    if (projectUpdateErr) {
      console.error("[logopro-request-qc] project update", projectUpdateErr);
      return jsonResponse({ error: "project_update_failed" }, 500);
    }

    await sb
      .from("logopro_concepts")
      .update({ is_selected: true })
      .eq("id", concept.id);

    // Insert QC ticket
    const { data: ticket, error: ticketErr } = await sb
      .from("designer_qc_queue")
      .insert({
        shop_id: project.shop_id,
        user_id: user.id,
        ticket_type: "logo_qc",
        project_id: project.id,
        project_table: "logopro_projects",
        status: "pending",
        priority,
        ai_output_url: concept.image_url,
        customer_feedback: body.customerFeedback || null,
      })
      .select("id")
      .single();

    if (ticketErr || !ticket) {
      // Rollback project status so user can retry
      await sb
        .from("logopro_projects")
        .update({ status: "concepts_ready", selected_concept_id: null })
        .eq("id", project.id);
      console.error("[logopro-request-qc] ticket insert", ticketErr);
      return jsonResponse({ error: "ticket_create_failed" }, 500);
    }

    // Slack notification (non-blocking)
    sendSlackMessage("SLACK_DESIGNER_QC_WEBHOOK", {
      text: `New LogoPro QC ticket: ${project.company_name}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: ":sparkles: New LogoPro Ticket" },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Company:*\n${project.company_name}` },
            { type: "mrkdwn", text: `*Priority:*\n${priority}` },
            { type: "mrkdwn", text: `*Ticket:*\n${ticket.id}` },
            { type: "mrkdwn", text: `*Project:*\n${project.id}` },
          ],
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: "Review in QC Admin to claim this ticket." },
          accessory: concept.image_url
            ? {
                type: "image",
                image_url: concept.image_url,
                alt_text: "Selected concept",
              }
            : undefined,
        },
      ],
    }).catch((e) => console.warn("[logopro-request-qc] slack failed", e));

    return jsonResponse({
      success: true,
      ticketId: ticket.id,
      status: "pending_designer_qc",
      estimatedReviewTime: "1-2 business days",
    });
  } catch (err: any) {
    console.error("[logopro-request-qc] unhandled", err);
    return jsonResponse({ error: err?.message || "Internal error" }, 500);
  }
});
