/**
 * intake-graph-poll — pull customer emails to the WPW design mailbox
 * (design@weprintwraps.com) into the matching ApprovePro order's brief.
 *
 * Two modes (POST body { mode }):
 *   - "poll"     (default): list the last POLL_WINDOW_MIN of inbox mail. Driven
 *                 by the intake-graph-poll-10min cron for NEW mail.
 *   - "backfill": resumable one-time sweep of the WHOLE mailbox history,
 *                 ascending from a stored watermark, in budget-bounded batches
 *                 (intake_graph_state tracks progress). Driven by a separate
 *                 cron until backfill_done, then it no-ops.
 *
 * Each message is matched to a proof (order # in subject, else sender email),
 * its attachments saved to wrap-files, a proof_events 'customer_reply'
 * recorded (deduped by Graph message id), and the body + attachments folded
 * into the order's brief so they drive the design + the customer conversation.
 *
 * INERT until MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET
 * are set (returns { ok:true, configured:false }).
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH = "https://graph.microsoft.com/v1.0";
const POLL_WINDOW_MIN = 20;
const BACKFILL_BUDGET_MS = 90_000;
const SELECT = "id,subject,from,receivedDateTime,bodyPreview,hasAttachments";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getGraphToken(tenant: string, clientId: string, secret: string): Promise<{ token: string | null; error?: string }> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    console.error("intake-graph-poll: token error", res.status, detail);
    return { token: null, error: `${res.status} ${detail}` };
  }
  return { token: (await res.json())?.access_token || null };
}

// Match one message to a proof, save attachments, record the reply, fold into
// the brief. Returns "matched" | "skipped" | "unmatched".
async function processMessage(
  db: any, token: string, mailbox: string, msg: any,
): Promise<"matched" | "skipped" | "unmatched"> {
  const graphId: string = msg.id;
  const subject: string = msg.subject || "";
  const fromEmail: string = (msg.from?.emailAddress?.address || "").toLowerCase();
  const text: string = msg.bodyPreview || "";

  const { data: prior } = await db
    .from("proof_events").select("id")
    .eq("event_type", "customer_reply")
    .contains("payload", { graph_message_id: graphId })
    .limit(1).maybeSingle();
  if (prior) return "skipped";

  let proofId: string | null = null;
  const orderMatch = subject.match(/#?\s*(\d{4,7})/);
  if (orderMatch) {
    const ord = orderMatch[1];
    const { data } = await db
      .from("proof_approvals").select("id")
      .or(`metadata->>wpw_order_number.eq.${ord},metadata->>wpw_woo_order_id.eq.${ord}`)
      .limit(1).maybeSingle();
    if (data) proofId = (data as any).id;
  }
  if (!proofId && fromEmail) {
    const { data } = await db
      .from("proof_approvals").select("id")
      .ilike("customer_email", fromEmail)
      .neq("status", "revoked")
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    if (data) proofId = (data as any).id;
  }
  if (!proofId) {
    // Unmatched inbound = a potential NEW inquiry/quote request. Hand it
    // to the AI workforce (best-effort): the CS agent summarizes it,
    // proposes a quote when the email carries enough data, and drafts
    // the reply for Troy to approve. Skips our own/system senders.
    if (
      fromEmail &&
      !fromEmail.includes("weprintwraps.com") &&
      !fromEmail.includes("restyleproai.com") &&
      !fromEmail.startsWith("noreply") && !fromEmail.startsWith("no-reply")
    ) {
      try {
        await db.from("workforce_events").insert({
          event_type: "email.inbound",
          dedupe_key: `email_${graphId}`,
          source: "intake-graph-poll",
          payload: {
            matched: false, mailbox, from: fromEmail, subject,
            message: text, received_at: msg.receivedDateTime || null,
          },
        });
      } catch (_) { /* never block intake */ }
    }
    return "unmatched";
  }

  const attachmentUrls: string[] = [];
  if (msg.hasAttachments) {
    const aRes = await fetch(
      `${GRAPH}/users/${encodeURIComponent(mailbox)}/messages/${graphId}/attachments`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (aRes.ok) {
      for (const att of ((await aRes.json())?.value || [])) {
        if (att["@odata.type"] !== "#microsoft.graph.fileAttachment" || !att.contentBytes) continue;
        const bytes = Uint8Array.from(atob(att.contentBytes), (c) => c.charCodeAt(0));
        const safe = String(att.name || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
        const path = `intake/graph/${proofId}/${graphId}/${safe}`;
        const { error: upErr } = await db.storage.from("wrap-files").upload(path, bytes, {
          contentType: att.contentType || "application/octet-stream",
          upsert: true,
        });
        if (!upErr) {
          const { data: pub } = db.storage.from("wrap-files").getPublicUrl(path);
          if (pub?.publicUrl) attachmentUrls.push(pub.publicUrl);
        }
      }
    }
  }

  await db.from("proof_events").insert({
    proof_id: proofId,
    event_type: "customer_reply",
    actor_role: "customer",
    payload: {
      channel: "email", source: "graph", graph_message_id: graphId,
      from: fromEmail, subject, message: text, attachments: attachmentUrls,
    },
  });

  // Matched customer reply → AI workforce (best-effort): summarized card
  // with a drafted response for Troy, and a design brief for Lance when
  // the reply is a revision request.
  try {
    await db.from("workforce_events").insert({
      event_type: "email.inbound",
      dedupe_key: `email_${graphId}`,
      source: "intake-graph-poll",
      payload: {
        matched: true, proof_id: proofId, mailbox, from: fromEmail, subject,
        message: text, attachments: attachmentUrls,
        received_at: msg.receivedDateTime || null,
      },
    });
  } catch (_) { /* never block intake */ }

  const { data: pa } = await db.from("proof_approvals").select("metadata").eq("id", proofId).maybeSingle();
  const meta = (pa?.metadata as any) || {};
  const priorBrief = typeof meta.line_item_brief === "string" ? meta.line_item_brief : "";
  // Stamp the date we found it so ApprovePro shows "found in email (dated)".
  const when = msg.receivedDateTime ? new Date(msg.receivedDateTime).toISOString().slice(0, 10) : null;
  const header = `Found in customer email${when ? ` (${when})` : ""}${subject ? `: ${subject}` : ""}`;
  const emailBlock = [header, text].filter(Boolean).join("\n");
  const mergedBrief = [priorBrief, emailBlock].filter(Boolean).join("\n\n").slice(0, 6000);
  const customerUploads = Array.isArray(meta.customer_uploads) ? meta.customer_uploads : [];
  const mergedUploads = [...customerUploads, ...attachmentUrls].slice(0, 12);
  await db.from("proof_approvals").update({
    metadata: {
      ...meta,
      line_item_brief: mergedBrief,
      customer_uploads: mergedUploads,
      // Provenance: instructions/examples came from the customer's email.
      brief_source: "email",
      brief_found_at: msg.receivedDateTime || new Date().toISOString(),
      ...(attachmentUrls.length ? { email_examples_found: (Number(meta.email_examples_found) || 0) + attachmentUrls.length } : {}),
    },
  }).eq("id", proofId);

  return "matched";
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Accept either MS_GRAPH_* (this project's names) OR MICROSOFT_* (the names
  // wrapcommandai's check-inbox already uses), so the same weprintwraps.com
  // Graph app's 3 values can be copied over verbatim — no new Azure app.
  const tenant = Deno.env.get("MS_GRAPH_TENANT_ID") || Deno.env.get("MICROSOFT_TENANT_ID");
  const clientId = Deno.env.get("MS_GRAPH_CLIENT_ID") || Deno.env.get("MICROSOFT_CLIENT_ID");
  const secret = Deno.env.get("MS_GRAPH_CLIENT_SECRET") || Deno.env.get("MICROSOFT_CLIENT_SECRET");
  const mailbox = Deno.env.get("MS_GRAPH_MAILBOX") || Deno.env.get("MICROSOFT_MAILBOX") || "design@weprintwraps.com";

  if (!tenant || !clientId || !secret) {
    return jsonResponse({ ok: true, configured: false, message: "Graph secrets not set (MS_GRAPH_* or MICROSOFT_*)" });
  }

  let mode = "poll";
  let searchProofId: string | null = null;
  try {
    const body = await req.json();
    if (body?.mode === "backfill") mode = "backfill";
    if (body?.mode === "search") { mode = "search"; searchProofId = body?.proof_id || null; }
  } catch { /* default poll */ }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const auth = await getGraphToken(tenant, clientId, secret);
    const token = auth.token;
    // The WPW design-inbox email ingestion is not the live reply path (the
    // customer PORTAL + Resend is). If the Graph app's secret is stale/invalid,
    // fail SOFT (200) instead of 502 so the cron stays green and doesn't alarm.
    // Flip this on simply by setting valid MS_GRAPH_* secrets — no code change.
    if (!token) return jsonResponse({ ok: true, configured: false, graph_unavailable: true, detail: auth.error || "no token returned" });

    const counts = { matched: 0, skipped: 0, unmatched: 0 };
    const tally = (r: "matched" | "skipped" | "unmatched") => { counts[r]++; };

    if (mode === "backfill") {
      const { data: state } = await db.from("intake_graph_state")
        .select("backfill_watermark, backfill_done").eq("mailbox", mailbox).maybeSingle();
      if (state?.backfill_done) {
        return jsonResponse({ ok: true, configured: true, mode, done: true, ...counts });
      }
      const watermark = state?.backfill_watermark || "1970-01-01T00:00:00Z";
      let url: string | null =
        `${GRAPH}/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages` +
        `?$filter=receivedDateTime ge ${watermark}` +
        `&$select=${SELECT}&$orderby=receivedDateTime asc&$top=50`;
      let lastReceived = watermark;
      const started = Date.now();
      let exhausted = false;
      while (url && Date.now() - started < BACKFILL_BUDGET_MS) {
        const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          return jsonResponse({ error: "Graph list failed", detail: (await res.text()).slice(0, 300) }, 502);
        }
        const json = await res.json();
        for (const msg of (json?.value || [])) {
          tally(await processMessage(db, token, mailbox, msg));
          if (msg.receivedDateTime) lastReceived = msg.receivedDateTime;
        }
        url = json["@odata.nextLink"] || null;
        if (!url) exhausted = true;
      }
      await db.from("intake_graph_state").upsert({
        mailbox,
        backfill_watermark: lastReceived,
        backfill_done: exhausted,
        updated_at: new Date().toISOString(),
      });
      return jsonResponse({ ok: true, configured: true, mode, done: exhausted, watermark: lastReceived, ...counts });
    }

    // ── search mode — on-demand, for ONE order before A.C.E asks for info.
    // The agent calls this with a proof_id; we look up the customer's email +
    // order number and scan the mailbox for THEIR design email, folding any
    // instructions/attachments into the brief. Returns how many we folded in
    // so the caller can re-check before sending the request-instructions invite.
    if (mode === "search") {
      if (!searchProofId) return jsonResponse({ ok: true, configured: true, mode, found: 0, note: "proof_id required" });
      const { data: pa } = await db.from("proof_approvals")
        .select("customer_email, metadata").eq("id", searchProofId).maybeSingle();
      if (!pa) return jsonResponse({ ok: true, configured: true, mode, found: 0, note: "proof not found" });
      const email = String((pa as any).customer_email || "").toLowerCase().trim();
      const md = ((pa as any).metadata || {}) as any;
      const ord = md.wpw_order_number || md.wpw_woo_order_id || md.woo_order_number;
      const urls: string[] = [];
      if (email) {
        urls.push(
          `${GRAPH}/users/${encodeURIComponent(mailbox)}/messages` +
          `?$filter=${encodeURIComponent(`from/emailAddress/address eq '${email}'`)}` +
          `&$select=${SELECT}&$orderby=receivedDateTime desc&$top=25`,
        );
      }
      if (ord) {
        urls.push(
          `${GRAPH}/users/${encodeURIComponent(mailbox)}/messages` +
          `?$search=${encodeURIComponent(`"${ord}"`)}&$select=${SELECT}&$top=25`,
        );
      }
      let matched = 0;
      for (const u of urls) {
        const res = await fetch(u, {
          headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" },
        });
        if (!res.ok) continue;
        for (const msg of ((await res.json())?.value || [])) {
          const r = await processMessage(db, token, mailbox, msg);
          if (r === "matched") matched++;
        }
      }
      return jsonResponse({ ok: true, configured: true, mode, found: matched });
    }

    // ── poll mode (new mail) ──
    const since = new Date(Date.now() - POLL_WINDOW_MIN * 60 * 1000).toISOString();
    const url =
      `${GRAPH}/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages` +
      `?$filter=receivedDateTime ge ${since}&$select=${SELECT}&$orderby=receivedDateTime desc&$top=25`;
    const listRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!listRes.ok) {
      return jsonResponse({ error: "Graph list failed", detail: (await listRes.text()).slice(0, 300) }, 502);
    }
    const messages = (await listRes.json())?.value || [];
    for (const msg of messages) tally(await processMessage(db, token, mailbox, msg));

    return jsonResponse({ ok: true, configured: true, mode, scanned: messages.length, ...counts });
  } catch (err: any) {
    console.error("intake-graph-poll: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error", detail: err?.message }, 500);
  }
});
