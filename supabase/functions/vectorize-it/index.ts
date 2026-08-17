// ============================================================
// VECTORIZE-IT — proxy to droplet vectorize-server
//
// The legacy in-edge VTracer pipeline hit Supabase's 256MB worker
// resource limit on real wrap source images (HTTP 546 /
// WORKER_RESOURCE_LIMIT) AND produced jaggy letter edges because the
// trace ran on the raw raster. Both problems are now solved on the
// droplet at vectorize-server:3200, which Topaz-4x-upscales the input
// before tracing and runs a path-simplification post-pass for clean
// vinyl-cut output.
//
// All consumers (run-production-flow, file-upload-output,
// quick-prep-vector-trace, frontend) keep their existing call shape —
// this edge function now just forwards the JSON payload to the droplet
// and pipes the response back. Same request body, same response shape.
//
// Deploy: npx supabase functions deploy vectorize-it --project-ref kfapjdyythzyvnpdeghu
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_DROPLET = "http://143.110.237.145:3200/vectorize";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const target = Deno.env.get("VECTORIZE_DROPLET_URL") || DEFAULT_DROPLET;

  try {
    const body = await req.text();
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(290_000),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (err) {
    console.error("[VECTORIZE proxy]", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: `vectorize-it proxy failed: ${String(err)}`,
        step: "vectorize_it",
      }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
