import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { isApproveProLive } from "../_shared/approvepro-runtime.ts";

/**
 * process-scheduled-emails
 *
 * Cron worker — picks up public.scheduled_emails rows where
 *   status = 'pending' AND send_at <= now()
 * and invokes send-templated-email for each. Updates rows to
 * 'sent', 'failed' (after MAX_ATTEMPTS), or leaves them 'pending'
 * for retry.
 *
 * Triggered every 5 minutes by the pg_cron job defined in
 * supabase/migrations/20260411230000_create_scheduled_emails.sql.
 * Can also be invoked manually by POST.
 *
 * Used by:
 *   - SavedQuotesTable quote retarget drips
 *   - MightyMail Booster Pack drip campaigns
 *   - Any one-off scheduled templated send
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_LIMIT = 50;
const MAX_ATTEMPTS = 3;

interface ScheduledEmailRow {
  id: string;
  send_at: string;
  template_slug: string;
  recipient_email: string;
  subject_override: string | null;
  merge_data: Record<string, unknown> | null;
  shop_id: string | null;
  attempts: number;
  source: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createExternalClient();
    if (!isApproveProLive()) {
      const { error: cancelError } = await supabase
        .from("scheduled_emails")
        .update({
          status: "cancelled",
          last_error: "ApprovePro disabled by owner on 2026-08-05",
          updated_at: new Date().toISOString(),
        })
        .in("status", ["pending", "processing"])
        .or(
          "source.eq.mightymail:approvepro,source_ref.like.approvepro:%,template_slug.like.ap-%",
        );
      if (cancelError) {
        throw new Error(`failed to cancel pending ApprovePro mail: ${cancelError.message}`);
      }
    }
    const projectUrl =
      Deno.env.get("SUPABASE_URL") ||
      Deno.env.get("EXTERNAL_SUPABASE_URL") ||
      "";
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") ||
      "";

    if (!projectUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const nowIso = new Date().toISOString();

    // Find due pending rows
    const { data: due, error: fetchError } = await supabase
      .from("scheduled_emails")
      .select("id, send_at, template_slug, recipient_email, subject_override, merge_data, shop_id, attempts, source")
      .eq("status", "pending")
      .lte("send_at", nowIso)
      .order("send_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (fetchError) {
      console.error("process-scheduled-emails fetch error:", fetchError);
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rows = (due || []) as ScheduledEmailRow[];

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: "No scheduled emails due" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`process-scheduled-emails: processing ${rows.length} row(s)`);

    const results: Array<{ id: string; status: string; error?: string }> = [];

    for (const row of rows) {
      const nextAttempts = (row.attempts || 0) + 1;

      try {
        // Claim the row atomically — flip pending → processing so concurrent
        // cron ticks can't double-send
        const { data: claimed, error: claimError } = await supabase
          .from("scheduled_emails")
          .update({
            status: "processing",
            attempts: nextAttempts,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();

        if (claimError || !claimed) {
          results.push({ id: row.id, status: "skipped", error: "claim failed or already processing" });
          continue;
        }

        // Invoke send-templated-email as a sub-request
        const sendResp = await fetch(`${projectUrl}/functions/v1/send-templated-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            templateSlug: row.template_slug,
            to: row.recipient_email,
            mergeData: row.merge_data || {},
            subject: row.subject_override || undefined,
            shopId: row.shop_id || undefined,
          }),
        });

        const body = await sendResp.json().catch(() => ({}));

        if (!sendResp.ok || !body?.success) {
          const errMsg = body?.error || `HTTP ${sendResp.status}`;
          console.error(`process-scheduled-emails: send failed for ${row.id}:`, errMsg);
          const nextStatus = nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending";
          await supabase
            .from("scheduled_emails")
            .update({
              status: nextStatus,
              last_error: String(errMsg).slice(0, 500),
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          results.push({ id: row.id, status: nextStatus, error: String(errMsg) });
          continue;
        }

        await supabase
          .from("scheduled_emails")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        results.push({ id: row.id, status: "sent" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`process-scheduled-emails: error on ${row.id}:`, message);
        const nextStatus = nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending";
        await supabase
          .from("scheduled_emails")
          .update({
            status: nextStatus,
            last_error: message.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        results.push({ id: row.id, status: nextStatus, error: message });
      }
    }

    const sentCount = results.filter((r) => r.status === "sent").length;
    const failedCount = results.filter((r) => r.status === "failed").length;
    const retryCount = results.filter((r) => r.status === "pending").length;

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        sent: sentCount,
        failed: failedCount,
        retry: retryCount,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("process-scheduled-emails error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
