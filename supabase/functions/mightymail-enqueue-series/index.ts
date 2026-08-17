// ─────────────────────────────────────────────────────────────────────
// mightymail-enqueue-series
//
// Bulk-inserts rows into public.scheduled_emails for an entire MightyMail
// series in one call. The cron worker (process-scheduled-emails) picks
// them up at their send_at and dispatches via send-templated-email.
//
// Caller (UI / app code) is the source of truth for which emails are in
// the series — the function just does the date math and the insert. Keep
// the spec in src/lib/mightymail-series.ts and pass the resolved emails
// array to this function.
//
// Idempotency: pass a stable `sourceRef` (e.g. `proof_<id>`). The worker
// will not double-send because each row is a distinct id, but you can
// query by source_ref to know what was queued and call
// mightymail-cancel-series to nuke remaining pending rows.
//
// POST body:
//   {
//     seriesId:        string,                   // e.g. "approvepro"
//     sourceRef:       string,                   // unique-per-customer-event, e.g. "proof_<uuid>"
//     recipientEmail:  string,
//     shopId:          string | null,
//     mergeData:       Record<string, unknown>,  // merged into every email
//     emails: Array<{
//       slug:        string,
//       delayDays?:  number,                     // default 0
//       subjectOverride?: string,
//     }>,
//     anchorAt?: string,                         // ISO timestamp; default = now()
//   }
//
// Returns: { success, inserted, ids: string[] }
// ─────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EmailInput {
  slug: string;
  delayDays?: number;
  subjectOverride?: string;
}

interface RequestBody {
  seriesId: string;
  sourceRef: string;
  recipientEmail: string;
  shopId?: string | null;
  mergeData?: Record<string, unknown>;
  emails: EmailInput[];
  anchorAt?: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body: RequestBody = await req.json();
    const approveProSeries =
      String(body.seriesId || "").toLowerCase() === "approvepro" ||
      String(body.sourceRef || "").startsWith("approvepro:") ||
      (Array.isArray(body.emails) &&
        body.emails.some((email) => /^ap-/i.test(String(email?.slug || ""))));
    if (approveProSeries && !isApproveProLive()) {
      return approveProDisabledResponse();
    }
    if (!body.seriesId || !body.sourceRef || !body.recipientEmail || !Array.isArray(body.emails)) {
      return new Response(
        JSON.stringify({ error: "Missing seriesId, sourceRef, recipientEmail or emails" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (body.emails.length === 0) {
      return new Response(
        JSON.stringify({ success: true, inserted: 0, ids: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createExternalClient();
    const anchor = body.anchorAt ? new Date(body.anchorAt) : new Date();
    if (isNaN(anchor.getTime())) {
      return new Response(JSON.stringify({ error: "Invalid anchorAt" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency: if any rows already exist for this sourceRef (pending,
    // sent, or cancelled), skip the insert. Re-firing the same trigger
    // event is a no-op so customers don't get double-spammed.
    const { count: existing } = await supabase
      .from("scheduled_emails")
      .select("id", { count: "exact", head: true })
      .eq("source_ref", body.sourceRef);

    if ((existing ?? 0) > 0) {
      console.log(
        `mightymail-enqueue-series: skipped (existing rows) series=${body.seriesId} ref=${body.sourceRef}`,
      );
      return new Response(
        JSON.stringify({ success: true, inserted: 0, ids: [], skipped: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rows = body.emails.map((e) => {
      const offsetMs = (e.delayDays ?? 0) * MS_PER_DAY;
      const sendAt = new Date(anchor.getTime() + offsetMs).toISOString();
      return {
        send_at: sendAt,
        template_slug: e.slug,
        recipient_email: body.recipientEmail,
        subject_override: e.subjectOverride ?? null,
        merge_data: body.mergeData ?? {},
        shop_id: body.shopId ?? null,
        source: `mightymail:${body.seriesId}`,
        source_ref: body.sourceRef,
        status: "pending",
      };
    });

    const { data, error } = await supabase
      .from("scheduled_emails")
      .insert(rows)
      .select("id");

    if (error) {
      console.error("mightymail-enqueue-series insert error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids = (data ?? []).map((r: { id: string }) => r.id);
    console.log(
      `mightymail-enqueue-series: queued ${ids.length} email(s) for series=${body.seriesId} ref=${body.sourceRef}`,
    );

    return new Response(
      JSON.stringify({ success: true, inserted: ids.length, ids }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("mightymail-enqueue-series fatal:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
