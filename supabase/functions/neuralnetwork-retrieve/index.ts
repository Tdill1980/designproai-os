import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchRAGDocuments } from "../_shared/neuralnetwork-rag.ts";

/**
 * NeuralNetwork Retrieve — Standalone RAG endpoint for admin tools and API access.
 *
 * POST /neuralnetwork-retrieve
 * Body: { collections?: string[], orgId?: string, limit?: number, status?: string }
 * Response: { documents: [...], totalChars: number, count: number }
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { collections, orgId, limit, status } = body;

    const result = await fetchRAGDocuments({
      collections: collections || [],
      orgId: orgId || null,
      limit: limit || 50,
      status: status || "active",
    });

    return new Response(
      JSON.stringify({
        documents: result.documents,
        totalChars: result.totalChars,
        count: result.documents.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[neuralnetwork-retrieve] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Retrieval failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
