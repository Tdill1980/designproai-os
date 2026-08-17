// ─────────────────────────────────────────────────────────────────────
// mightymail-cancel-series
//
// Cancels remaining pending rows in public.scheduled_emails by source_ref.
// Use case: customer takes the desired action (approves the proof, books
// the install, replies to a retarget email) and we don't want to keep
// nagging them with the rest of the drip series.
//
// Already-sent rows are NOT touched. Only `status = 'pending'` rows get
// flipped to 'cancelled'.
//
// POST body:
//   {
//     sourceRef: string,             // exact match
//     reason?:   string,             // optional, stored in last_error
//   }
//
// Returns: { success, cancelled }
// ─────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  sourceRef: string;
  reason?: string;
}

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
    if (!body.sourceRef) {
      return new Response(JSON.stringify({ error: "Missing sourceRef" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createExternalClient();

    const { data, error } = await supabase
      .from("scheduled_emails")
      .update({
        status: "cancelled",
        last_error: body.reason ?? "cancelled by mightymail-cancel-series",
        updated_at: new Date().toISOString(),
      })
      .eq("source_ref", body.sourceRef)
      .eq("status", "pending")
      .select("id");

    if (error) {
      console.error("mightymail-cancel-series update error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cancelled = data?.length ?? 0;
    console.log(`mightymail-cancel-series: cancelled ${cancelled} pending row(s) for ref=${body.sourceRef}`);

    return new Response(JSON.stringify({ success: true, cancelled }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("mightymail-cancel-series fatal:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
