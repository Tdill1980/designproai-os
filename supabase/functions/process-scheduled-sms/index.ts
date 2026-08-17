import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";

/**
 * process-scheduled-sms
 *
 * Cron worker — picks up public.scheduled_sms rows where
 *   status = 'pending' AND send_at <= now()
 * and sends each one via Twilio. Updates rows to 'sent', 'failed'
 * (after MAX_ATTEMPTS), or leaves them 'pending' for retry.
 *
 * Triggered every 5 minutes by the pg_cron job defined in
 * supabase/migrations/20260503000001_create_scheduled_sms.sql.
 * Can also be invoked manually by POST.
 *
 * Mirrors the process-scheduled-emails pattern. Bodies are stored
 * inline on each row (no SMS template table) — {{customer_name}}
 * is the only merge tag, substituted from row.recipient_name.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_LIMIT = 50;
const MAX_ATTEMPTS = 3;

interface ScheduledSmsRow {
  id: string;
  send_at: string;
  recipient_phone: string;
  recipient_name: string | null;
  body: string;
  campaign_name: string | null;
  source: string;
  attempts: number;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createExternalClient();

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!accountSid || !authToken || !fromNumber) {
      console.error("process-scheduled-sms: missing Twilio env vars");
      return new Response(
        JSON.stringify({ error: "Twilio credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const nowIso = new Date().toISOString();

    const { data: due, error: fetchError } = await supabase
      .from("scheduled_sms")
      .select("id, send_at, recipient_phone, recipient_name, body, campaign_name, source, attempts")
      .eq("status", "pending")
      .lte("send_at", nowIso)
      .order("send_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (fetchError) {
      console.error("process-scheduled-sms fetch error:", fetchError);
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rows = (due as ScheduledSmsRow[]) ?? [];
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const twilioAuth = btoa(`${accountSid}:${authToken}`);

    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      // Mark processing to prevent double-fire if cron overlaps
      await supabase
        .from("scheduled_sms")
        .update({ status: "processing", attempts: row.attempts + 1 })
        .eq("id", row.id);

      const customerName = (row.recipient_name?.trim() || "there").replace(/\{\{|\}\}/g, "");
      const body = row.body.replace(/\{\{customer_name\}\}/g, customerName);

      try {
        const formData = new URLSearchParams();
        formData.append("To", row.recipient_phone);
        formData.append("From", fromNumber);
        formData.append("Body", body);

        const resp = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${twilioAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Twilio ${resp.status}: ${errText}`);
        }

        const json = await resp.json();
        await supabase
          .from("scheduled_sms")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            twilio_sid: json.sid ?? null,
            last_error: null,
          })
          .eq("id", row.id);
        sent++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const exhausted = row.attempts + 1 >= MAX_ATTEMPTS;
        await supabase
          .from("scheduled_sms")
          .update({
            status: exhausted ? "failed" : "pending",
            last_error: message.slice(0, 500),
          })
          .eq("id", row.id);
        if (exhausted) failed++;
        console.error(`process-scheduled-sms row ${row.id} failed:`, message);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed: rows.length, sent, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("process-scheduled-sms unhandled:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
};

serve(handler);
