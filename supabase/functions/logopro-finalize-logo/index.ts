// ============================================================================
// logopro-finalize-logo
// ============================================================================
// Designer-facing finalization. Carley/Lance has reviewed the AI concept,
// finished it in their tool of choice, and uploaded the polished PNG to the
// logopro-finals bucket. This function:
//
//   1. Verifies caller is designer / admin
//   2. Loads the QC ticket + LogoPro project
//   3. Vectorizes the polished PNG via Vectorizer.AI -> SVG
//   4. Converts SVG -> EPS via _shared/svg-to-eps
//   5. Uploads SVG + EPS to logopro-finals
//   6. Marks project finalized + records final URLs
//   7. Updates shop's brand mark (logo_url + svg + eps + source)
//   8. Closes the QC ticket
//   9. Emails the customer with download links + DesignPro CTA
//
// Auth: JWT required + designer or admin role.
//
// Request:
//   {
//     ticketId: string         (required UUID, designer_qc_queue.id)
//     approvedPngUrl: string   (required, public URL in logopro-finals bucket)
//     designerNotes?: string
//   }
//
// Response:
//   200 { success: true, logoUrls: { png, svg, eps }, projectId, shopId }
//   401, 403, 404, 409, 502 (vectorize fail), 500
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import {
  createExternalAnonClient,
  createExternalClient,
  getExternalSupabaseUrl,
} from "../_shared/external-db.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { sendSlackMessage } from "../_shared/slack-webhook.ts";
import { svgToEps } from "../_shared/svg-to-eps.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FinalizeBody {
  ticketId?: string;
  approvedPngUrl?: string;
  designerNotes?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function vectorizePng(pngBytes: Uint8Array): Promise<string> {
  const apiId = Deno.env.get("VECTORIZER_AI_API_ID");
  const apiSecret = Deno.env.get("VECTORIZER_AI_API_SECRET");
  if (!apiId || !apiSecret) {
    throw new Error("VECTORIZER_AI credentials not configured");
  }
  const credentials = btoa(`${apiId}:${apiSecret}`);
  const form = new FormData();
  form.append("image", new Blob([pngBytes], { type: "image/png" }), "logo.png");
  form.append("output.file_format", "svg");
  form.append("mode", "production");

  const resp = await fetch("https://vectorizer.ai/api/v1/vectorize", {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Vectorizer.AI ${resp.status}: ${text.slice(0, 300)}`);
  }
  return await resp.text();
}

async function downloadPng(url: string): Promise<Uint8Array> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) throw new Error(`PNG fetch ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

function buildEmailHtml(companyName: string, urls: {
  png: string;
  svg: string;
  eps: string;
}): string {
  return `<!doctype html>
<html><body style="font-family: -apple-system, Segoe UI, sans-serif; background:#000; color:#fff; padding:40px;">
  <div style="max-width:560px; margin:0 auto; background:#0a0a0a; border:1px solid #1a1a1a; border-radius:12px; padding:32px;">
    <h1 style="color:#00C7FF; margin:0 0 8px;">Your LogoPro logo is ready</h1>
    <p style="color:#aaa; margin:0 0 24px;">Reviewed and finished by our design team for <strong style="color:#fff;">${companyName}</strong>.</p>
    <p style="margin:0 0 24px;">Download every format you need:</p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%; margin:0 0 24px;">
      <tr>
        <td style="padding:8px 0;"><a href="${urls.png}" style="color:#00C7FF; text-decoration:none; font-weight:600;">→ PNG (web, social, presentations)</a></td>
      </tr>
      <tr>
        <td style="padding:8px 0;"><a href="${urls.svg}" style="color:#00C7FF; text-decoration:none; font-weight:600;">→ SVG (scalable vector)</a></td>
      </tr>
      <tr>
        <td style="padding:8px 0;"><a href="${urls.eps}" style="color:#00C7FF; text-decoration:none; font-weight:600;">→ EPS (print, signage, vehicle wraps)</a></td>
      </tr>
    </table>
    <hr style="border:none; border-top:1px solid #1a1a1a; margin:24px 0;" />
    <p style="margin:0 0 16px;">Ready to put it on a vehicle?</p>
    <a href="https://restylepro.ai/designpro" style="display:inline-block; background:#00C7FF; color:#000; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:700;">Use this logo in DesignPro →</a>
    <p style="color:#666; font-size:12px; margin:32px 0 0;">RestylePro · Design. Output. Profit.</p>
  </div>
</body></html>`;
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

    const sb = createExternalClient();

    // Verify designer or admin role
    const { data: roleRows } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roles = (roleRows || []).map((r: any) => r.role);
    if (!roles.includes("designer") && !roles.includes("admin")) {
      return jsonResponse({ error: "Designer or admin role required" }, 403);
    }

    // Parse body
    const body: FinalizeBody = await req.json();
    if (!body.ticketId || !UUID_RE.test(body.ticketId)) {
      return jsonResponse({ error: "ticketId must be UUID" }, 400);
    }
    if (!body.approvedPngUrl || typeof body.approvedPngUrl !== "string") {
      return jsonResponse({ error: "approvedPngUrl required" }, 400);
    }

    // Load ticket
    const { data: ticket, error: ticketErr } = await sb
      .from("designer_qc_queue")
      .select("id, shop_id, project_id, project_table, ticket_type, status")
      .eq("id", body.ticketId)
      .maybeSingle();
    if (ticketErr) {
      console.error("[logopro-finalize-logo] ticket query", ticketErr);
      return jsonResponse({ error: "ticket_lookup_failed" }, 500);
    }
    if (!ticket) return jsonResponse({ error: "Ticket not found" }, 404);
    if (ticket.ticket_type !== "logo_qc") {
      return jsonResponse({ error: "Ticket is not a LogoPro ticket" }, 400);
    }
    if (ticket.status === "completed" || ticket.status === "cancelled") {
      return jsonResponse({ error: `Ticket already ${ticket.status}` }, 409);
    }
    if (ticket.project_table !== "logopro_projects") {
      return jsonResponse({ error: "Unexpected project_table on ticket" }, 400);
    }

    // Load project + customer email
    const { data: project } = await sb
      .from("logopro_projects")
      .select("id, shop_id, user_id, company_name")
      .eq("id", ticket.project_id)
      .maybeSingle();
    if (!project) return jsonResponse({ error: "Project not found" }, 404);

    const { data: customer } = await sb.auth.admin.getUserById(project.user_id);
    const customerEmail = customer?.user?.email || null;

    // Mark in-progress
    await sb
      .from("logopro_projects")
      .update({ status: "qc_completed", final_png_url: body.approvedPngUrl })
      .eq("id", project.id);

    // Vectorize
    let svgText: string;
    try {
      const pngBytes = await downloadPng(body.approvedPngUrl);
      svgText = await vectorizePng(pngBytes);
    } catch (e: any) {
      console.error("[logopro-finalize-logo] vectorize failed", e);
      // Don't roll project back — designer can retry. Alert via Slack.
      sendSlackMessage("SLACK_DESIGNER_QC_WEBHOOK", {
        text: `:warning: LogoPro vectorize failed for ticket ${ticket.id}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Vectorize failed*\nTicket: \`${ticket.id}\`\nProject: \`${project.id}\`\nReason: \`${(e?.message || e).toString().slice(0, 300)}\``,
            },
          },
        ],
      }).catch(() => {});
      return jsonResponse(
        { error: "vectorize_failed", detail: e?.message || String(e) },
        502,
      );
    }

    // Convert SVG -> EPS (8.5"x8.5" page = 612x612 pts)
    const epsBytes = svgToEps(svgText, {
      widthPts: 612,
      heightPts: 612,
      dscHeaders: [
        `%%Creator: RestylePro LogoPro`,
        `%%Title: logo.eps`,
        `%%CreationDate: ${new Date().toISOString()}`,
      ],
      creator: "RestylePro LogoPro",
      title: `${project.company_name} logo`,
    });

    // Upload SVG + EPS to logopro-finals
    const supabaseUrl = getExternalSupabaseUrl();
    const basePath = `${project.shop_id}/${project.id}`;

    const svgPath = `${basePath}/logo.svg`;
    const { error: svgUploadErr } = await sb.storage
      .from("logopro-finals")
      .upload(svgPath, new TextEncoder().encode(svgText), {
        contentType: "image/svg+xml",
        upsert: true,
      });
    if (svgUploadErr) {
      console.error("[logopro-finalize-logo] svg upload", svgUploadErr);
      return jsonResponse({ error: "svg_upload_failed" }, 500);
    }
    const svgUrl = `${supabaseUrl}/storage/v1/object/public/logopro-finals/${svgPath}`;

    const epsPath = `${basePath}/logo.eps`;
    const { error: epsUploadErr } = await sb.storage
      .from("logopro-finals")
      .upload(epsPath, epsBytes, {
        contentType: "application/postscript",
        upsert: true,
      });
    if (epsUploadErr) {
      console.error("[logopro-finalize-logo] eps upload", epsUploadErr);
      return jsonResponse({ error: "eps_upload_failed" }, 500);
    }
    const epsUrl = `${supabaseUrl}/storage/v1/object/public/logopro-finals/${epsPath}`;

    // If approvedPngUrl is in logopro-concepts (designer reused the AI concept
    // verbatim), copy it into logopro-finals for permanence.
    let finalPngUrl = body.approvedPngUrl;
    if (!body.approvedPngUrl.includes("/logopro-finals/")) {
      try {
        const pngBytes = await downloadPng(body.approvedPngUrl);
        const pngPath = `${basePath}/logo.png`;
        const { error: pngUploadErr } = await sb.storage
          .from("logopro-finals")
          .upload(pngPath, pngBytes, { contentType: "image/png", upsert: true });
        if (!pngUploadErr) {
          finalPngUrl = `${supabaseUrl}/storage/v1/object/public/logopro-finals/${pngPath}`;
        }
      } catch (e: any) {
        console.warn("[logopro-finalize-logo] png mirror failed", e?.message);
      }
    }

    // Update project as finalized
    const { error: finalUpdateErr } = await sb
      .from("logopro_projects")
      .update({
        status: "finalized",
        final_png_url: finalPngUrl,
        final_svg_url: svgUrl,
        final_eps_url: epsUrl,
        finalized_at: new Date().toISOString(),
      })
      .eq("id", project.id);
    if (finalUpdateErr) {
      console.error("[logopro-finalize-logo] project finalize", finalUpdateErr);
      return jsonResponse({ error: "project_finalize_failed" }, 500);
    }

    // Update shop's brand mark
    const { error: shopUpdateErr } = await sb
      .from("shops")
      .update({
        logo_url: finalPngUrl,
        logo_svg_url: svgUrl,
        logo_eps_url: epsUrl,
        logo_source: "logopro",
        logopro_project_id: project.id,
      })
      .eq("id", project.shop_id);
    if (shopUpdateErr) {
      console.warn("[logopro-finalize-logo] shop update failed (logo still saved)", shopUpdateErr);
    }

    // Close ticket
    await sb
      .from("designer_qc_queue")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        designer_id: user.id,
        designer_notes: body.designerNotes || null,
      })
      .eq("id", ticket.id);

    // Email customer (non-blocking)
    if (customerEmail) {
      try {
        const apiKey = Deno.env.get("RESEND_API_KEY");
        if (apiKey) {
          const resend = new Resend(apiKey);
          await resend.emails.send({
            from: Deno.env.get("LOGOPRO_FROM_EMAIL") ||
              "RestylePro <orders@restylepro.ai>",
            to: customerEmail,
            subject: `Your LogoPro logo is ready`,
            html: buildEmailHtml(project.company_name, {
              png: finalPngUrl,
              svg: svgUrl,
              eps: epsUrl,
            }),
          });
        }
      } catch (e: any) {
        console.warn("[logopro-finalize-logo] email failed", e?.message);
      }
    }

    return jsonResponse({
      success: true,
      projectId: project.id,
      shopId: project.shop_id,
      logoUrls: { png: finalPngUrl, svg: svgUrl, eps: epsUrl },
    });
  } catch (err: any) {
    console.error("[logopro-finalize-logo] unhandled", err);
    return jsonResponse({ error: err?.message || "Internal error" }, 500);
  }
});
