/**
 * NeuralNetwork Embed — Vector Embedding Generator
 *
 * Generates 768-dimensional embeddings via Gemini text-embedding-004
 * and stores them in pgvector columns for similarity search.
 *
 * Called:
 *   - After every render (non-blocking, via design-dna-capture)
 *   - When knowledge docs are added/updated
 *   - During batch backfill of existing renders
 *
 * Supported tables:
 *   - neuralnetwork_design_dna (embedding column)
 *   - neuralnetwork_knowledge (embedding column)
 *   - neuralnetwork_prompt_scores (embedding column)
 *
 * Cost: ~$0.0001 per embedding
 * Fail-safe: If embedding fails, the record still exists — just without a vector.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// ============================================================================
// Types
// ============================================================================

interface EmbedRequest {
  text: string;
  table: "neuralnetwork_design_dna" | "neuralnetwork_knowledge" | "neuralnetwork_prompt_scores";
  record_id: string;
}

interface BatchEmbedRequest {
  items: EmbedRequest[];
}

// ============================================================================
// Gemini Embedding API
// ============================================================================

const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_DIMENSION = 768;
const GEMINI_EMBEDDING_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  // Truncate to ~8000 chars to stay within token limits
  const truncated = text.substring(0, 8000);

  const response = await fetch(`${GEMINI_EMBEDDING_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: {
        parts: [{ text: truncated }],
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini embedding API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const embedding = data?.embedding?.values;

  if (!embedding || embedding.length !== EMBEDDING_DIMENSION) {
    throw new Error(`Invalid embedding: expected ${EMBEDDING_DIMENSION} dimensions, got ${embedding?.length || 0}`);
  }

  return embedding;
}

// ============================================================================
// Store Embedding in Database
// ============================================================================

async function storeEmbedding(
  supabase: any,
  table: string,
  recordId: string,
  embedding: number[]
): Promise<void> {
  // pgvector expects array format: [0.1, 0.2, ...]
  const vectorString = `[${embedding.join(",")}]`;

  const { error } = await supabase
    .from(table)
    .update({ embedding: vectorString })
    .eq("id", recordId);

  if (error) {
    throw new Error(`Failed to store embedding in ${table}: ${error.message}`);
  }
}

// ============================================================================
// Edge Function Handler
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase env vars");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    // Support both single and batch requests
    const items: EmbedRequest[] = body.items || [body];
    const validTables = ["neuralnetwork_design_dna", "neuralnetwork_knowledge", "neuralnetwork_prompt_scores"];

    const results: Array<{ record_id: string; success: boolean; error?: string }> = [];

    for (const item of items) {
      try {
        // Validate table name
        if (!validTables.includes(item.table)) {
          results.push({ record_id: item.record_id, success: false, error: `Invalid table: ${item.table}` });
          continue;
        }

        if (!item.text || item.text.trim().length === 0) {
          results.push({ record_id: item.record_id, success: false, error: "Empty text" });
          continue;
        }

        if (!item.record_id) {
          results.push({ record_id: item.record_id, success: false, error: "Missing record_id" });
          continue;
        }

        // Generate embedding
        const embedding = await generateEmbedding(item.text, geminiKey);

        // Store in database
        await storeEmbedding(supabase, item.table, item.record_id, embedding);

        results.push({ record_id: item.record_id, success: true });
        console.log(`[NeuralNetwork Embed] Stored ${EMBEDDING_DIMENSION}-dim vector for ${item.table}/${item.record_id.substring(0, 8)}`);
      } catch (err) {
        console.error(`[NeuralNetwork Embed] Failed for ${item.record_id}:`, err);
        results.push({ record_id: item.record_id, success: false, error: err.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`[NeuralNetwork Embed] Completed: ${successCount}/${results.length} embeddings`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        succeeded: successCount,
        failed: results.length - successCount,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[NeuralNetwork Embed] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Embedding failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
