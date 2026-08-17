import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TrackEventRequest {
  eventType: string;
  quoteId?: string;
  productType?: string;
  metadata?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Connect to EXTERNAL database for data operations
    const supabase = createExternalClient();

    const body: TrackEventRequest = await req.json();
    const { eventType, quoteId, productType, metadata } = body;

    if (!eventType) {
      console.error("[track-quote-event] Missing eventType");
      // Still return 200 to not break flow
      return new Response(JSON.stringify({ success: false, error: "Missing eventType" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    console.log(`[track-quote-event] Tracking: ${eventType}`, {
      quoteId,
      productType,
      metadata,
    });

    const { error } = await supabase.from("quote_events").insert({
      event_type: eventType,
      quote_id: quoteId || null,
      product_type: productType || null,
      source: "frontend",
      metadata: metadata || {},
    });

    if (error) {
      console.error("[track-quote-event] Insert error:", error);
      // Still return 200 - tracking failures should never break the flow
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    console.log(`[track-quote-event] Successfully tracked: ${eventType}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("[track-quote-event] Unexpected error:", err);
    // Always return 200 - never break the checkout flow
    return new Response(JSON.stringify({ success: false, error: "Internal error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  }
});
